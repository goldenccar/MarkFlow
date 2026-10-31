import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { CompilationError } from '../src/compiler/diagnostics'
import { prepareCompilation, validatePresentation } from '../src/compiler/layout'
import { FontMetrics, hashObject, resolveAssets, sha256 } from '../src/compiler/resources'
import type { CompilationPlan, Diagnostic, MarkDocumentInput, Presentation, SemanticMark, StagePresentation } from '../src/compiler/types'

const family = 'Microsoft YaHei'
const fontFile = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts', 'msyh.ttc')
const fontAvailable = existsSync(fontFile)
function pngImage(width: number, height: number): Buffer {
  const chunk = (name: string, bytes: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(name), bytes]), size = Buffer.alloc(4), checksum = Buffer.alloc(4)
    size.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc32(body))
    return Buffer.concat([size, body, checksum])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc((width + 1) * height))), chunk('IEND', Buffer.alloc(0))])
}
const png = pngImage(1, 1)
const source = { file: 'source.md', from: 12, to: 40, line: 3, column: 1 }
let fixture: string, assetRoot: string
let metrics: FontMetrics
before(async () => {
  fixture = await mkdtemp(path.join(os.tmpdir(), 'markflow-layout-'))
  assetRoot = path.join(fixture, 'assets')
  await mkdir(assetRoot)
  await mkdir(path.join(fixture, 'outside'))
  await writeFile(path.join(assetRoot, 'space 汉字.png'), png)
  await writeFile(path.join(fixture, 'outside', 'external.png'), png)
  await writeFile(path.join(fixture, 'not-font.bin'), 'not a font')
  if (fontAvailable) { metrics = new FontMetrics(); await metrics.load([family], { [family]: fontFile }) }
})
after(async () => { if (fixture) await rm(fixture, { recursive: true, force: true }) })

const paragraph = (id: string, text: string): SemanticMark => ({ id, content: { kind: 'paragraph', runs: [{ text }] }, source: { ...source } })
function document(marks: SemanticMark[] = [paragraph('title', 'Title'), paragraph('body', '中文 English')]): MarkDocumentInput {
  return { format: 'markflow', version: 1, documentId: 'layout-fixture', revision: 7, marks, assets: [] }
}
function stage(layout: StagePresentation['slides'][number]['layout'] = 'body', marks = ['body']): StagePresentation {
  return { format: 'markflow-presentation', version: 1, target: 'pptx', theme: 'standard-v1', slides: [{ layout, title: 'title', marks }] }
}
const note = (marks = ['title', 'body']): Presentation => ({ format: 'markflow-presentation', version: 1, target: 'docx', theme: 'standard-v1', sections: [{ marks }] })
const options = () => ({ assetRoot, fontFiles: { [family]: fontFile } })
async function rejected(operation: () => unknown | Promise<unknown>, code?: string, markId?: string): Promise<Diagnostic> {
  try { await operation(); assert.fail('Expected a compilation diagnostic') }
  catch (error) {
    assert.ok(error instanceof CompilationError, `Expected CompilationError, received ${String(error)}`)
    const item = error.diagnostics.find(item => item.severity === 'error')!
    assert.ok(item)
    if (code) assert.equal(item.code, code)
    if (markId) assert.equal(item.markId, markId)
    return item
  }
}
function fontTest(name: string, body: () => Promise<void> | void): void {
  test(name, { skip: fontAvailable ? false : `Real Microsoft YaHei fixture not installed at ${fontFile}` }, body)
}
function bounds(plan: CompilationPlan): void {
  const { widthPt, heightPt, marginPt } = plan.theme.stage
  for (const slide of plan.slides) for (const { box } of [slide.title, ...slide.items]) {
    assert.ok(Object.values(box).every(Number.isFinite))
    assert.ok(box.width > 0 && box.height > 0)
    assert.ok(box.x >= marginPt && box.y >= marginPt)
    assert.ok(box.x + box.width <= widthPt - marginPt + 1e-8)
    assert.ok(box.y + box.height <= heightPt - marginPt + 1e-8)
  }
}

test('presentation validation rejects unsupported fields, malformed layouts and non-JSON values without invoking code', async () => {
  for (const input of [
    { ...stage(), extension: true }, { ...stage(), version: 2 }, { ...stage(), theme: 'system' },
    { ...stage(), slides: [{ layout: 'freeform', title: 'title', marks: [] }] },
    { ...stage(), slides: [{ layout: ['body'], title: 'title', marks: [] }] },
    { ...note(), slides: [] }, { ...stage(), slides: [] },
    { ...stage(), slides: [{ layout: 'body', title: 'title', marks: new Array(1) }] },
  ]) await rejected(() => validatePresentation(input))
  let calls = 0
  const getter = { ...stage() }
  Object.defineProperty(getter, 'slides', { enumerable: true, get() { calls++; return [] } })
  await rejected(() => validatePresentation(getter))
  const coercion = { ...stage(), slides: [{ layout: { toString() { calls++; return 'body' } }, title: 'title', marks: [] }] }
  await rejected(() => validatePresentation(coercion))
  assert.equal(calls, 0)
  const cycle: Record<string, unknown> = { ...stage() }; cycle.slides = [cycle]
  await rejected(() => validatePresentation(cycle))
})

test('presentation output is detached from its caller', () => {
  const input = stage(), result = validatePresentation(input) as StagePresentation
  input.slides[0].marks[0] = 'changed'
  assert.deepEqual(result.slides[0].marks, ['body'])
})

test('an adapter error prevents resource loading and planning', async () => {
  const error = await rejected(() => prepareCompilation(document(), stage(), { assetRoot: 'missing-root', fontFiles: {} }, [{ code: 'SOURCE_UNSUPPORTED', severity: 'error', message: 'Unsupported source', markId: 'body' }]), 'SOURCE_UNSUPPORTED', 'body')
  assert.equal(error.message, 'Unsupported source')
})

test('asset paths preserve Unicode and spaces, and bytes have explicit evidence', async () => {
  const result = await resolveAssets([{ id: 'image', path: 'space 汉字.png' }], assetRoot)
  const image = result.get('image')!
  assert.equal(image.relativePath, 'space 汉字.png')
  assert.equal(image.mime, 'image/png')
  assert.deepEqual([image.width, image.height], [1, 1])
  assert.deepEqual(image.data, png)
  assert.equal(image.sha256, sha256(png))
})

test('resource scope rejects traversal, URLs, absolute paths and a missing root', async () => {
  for (const value of ['../outside/external.png', 'https://example.org/image.png', 'data:image/png;base64,AAA', path.join(fixture, 'outside', 'external.png'), '..\\outside\\external.png']) {
    const diagnostic = await rejected(() => resolveAssets([{ id: 'image', path: value }], assetRoot), 'ASSET_SCOPE')
    assert.equal(diagnostic.field, 'assets.image')
  }
  await rejected(() => resolveAssets([], path.join(fixture, 'missing')), 'ASSET_ROOT')
})

test('resource realpath rejects a directory link escaping the allowed root', async context => {
  const link = path.join(assetRoot, 'linked')
  try { await symlink(path.join(fixture, 'outside'), link, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') { context.skip('Creating test filesystem links is not permitted'); return } throw error }
  await rejected(() => resolveAssets([{ id: 'image', path: 'linked/external.png' }], assetRoot), 'ASSET_SCOPE')
})

test('missing, non-image and header-only images are rejected instead of embedded as broken objects', async () => {
  await rejected(() => resolveAssets([{ id: 'image', path: 'missing.png' }], assetRoot), 'ASSET_MISSING')
  await writeFile(path.join(assetRoot, 'text.png'), 'text with a .png extension')
  await rejected(() => resolveAssets([{ id: 'image', path: 'text.png' }], assetRoot), 'ASSET_FORMAT')
  await writeFile(path.join(assetRoot, 'truncated.png'), png.subarray(0, 33))
  await rejected(() => resolveAssets([{ id: 'image', path: 'truncated.png' }], assetRoot), 'ASSET_FORMAT')
})

test('image byte and pixel limits apply before a large resource reaches an output writer', async () => {
  const file = await open(path.join(assetRoot, 'oversized.png'), 'w')
  try { await file.truncate(20 * 1024 * 1024 + 1) } finally { await file.close() }
  await rejected(() => resolveAssets([{ id: 'image', path: 'oversized.png' }], assetRoot), 'ASSET_LIMIT')
  const huge = Buffer.from(png); huge.writeUInt32BE(40001, 16)
  await writeFile(path.join(assetRoot, 'huge.png'), huge)
  await rejected(() => resolveAssets([{ id: 'image', path: 'huge.png' }], assetRoot), 'ASSET_DIMENSIONS')
})

test('font declaration is mandatory and a non-font file has a structured error', async () => {
  await rejected(() => new FontMetrics().load([family], {}), 'FONT_MISSING')
  await rejected(() => new FontMetrics().load([family], { [family]: path.join(fixture, 'not-font.bin') }), 'FONT_FORMAT')
})

fontTest('real Windows collection resolves the exact family and records file evidence', async () => {
  assert.equal(metrics.evidence.length, 1)
  assert.equal(metrics.evidence[0].family, family)
  assert.equal(metrics.evidence[0].file, 'msyh.ttc')
  assert.equal(metrics.evidence[0].sha256, sha256(await readFile(fontFile)))
  assert.ok(metrics.evidence[0].unitsPerEm > 0)
  assert.ok(metrics.width('中文 English', family, 21) > 0)
  assert.ok(metrics.width('中文 English', family, 21, true) > metrics.width('中文 English', family, 21))
  await rejected(() => new FontMetrics().load(['Not This Family'], { 'Not This Family': fontFile }), 'FONT_FAMILY')
})

fontTest('glyph, tab and font-size failures identify the affected Mark and original source', async () => {
  for (const [text, code] of [['a\tb', 'TEXT_TAB'], [String.fromCodePoint(0x10ffff), 'FONT_GLYPH']]) {
    const result = await rejected(() => prepareCompilation(document([paragraph('title', 'Title'), paragraph('body', text)]), stage(), options()), code, 'body')
    assert.deepEqual(result.source, source)
  }
  const small = document(); small.marks[1].style = { fontSize: 23 }
  await rejected(() => prepareCompilation(small, stage(), options()), 'STAGE_FONT_SIZE', 'body')
  small.marks[1].style = { fontSize: 10 }
  await rejected(() => prepareCompilation(small, note(), options()), 'NOTE_FONT_SIZE', 'body')
})

fontTest('wrapping keeps formatting across empty runs, reordered keys, hard breaks and automatic line breaks', () => {
  const runs = [
    { text: 'A', format: { bold: true, italic: true } }, { text: '', format: { underline: true } },
    { text: 'B', format: { italic: true, bold: true } }, { text: '\r\nC', format: {} },
    { text: 'D' }, { text: '\rE', format: { underline: true } }, { text: 'F', format: { underline: true } },
  ]
  const mark = { id: 'formatted', content: { kind: 'paragraph' as const, runs }, style: {} }
  assert.deepEqual(metrics.wrap(runs, mark, family, 12, 1000), [
    [{ text: 'AB', format: { bold: true, italic: true } }],
    [{ text: 'C', format: {} }, { text: 'D' }], [{ text: 'EF', format: { underline: true } }],
  ])
  const input = [{ text: 'WWW', format: { bold: true } }]
  const lines = metrics.wrap(input, mark, family, 12, metrics.width('W', family, 12, true))
  assert.deepEqual(lines, Array.from({ length: 3 }, () => [{ text: 'W', format: { bold: true } }]))
  lines[0][0].format!.bold = false
  assert.equal(lines[1][0].format!.bold, true)
  assert.equal(input[0].format.bold, true)
})

fontTest('layout mismatches and missing title selections fail without silently dropping Marks', async () => {
  const missing = await rejected(() => prepareCompilation(document(), stage('body', ['missing']), options()), 'PRESENTATION_REFERENCE', 'missing')
  assert.equal(missing.documentId, 'layout-fixture')
  const table = { id: 'body', content: { kind: 'table', header: false, rows: [[[ { text: 'one' } ]]] } } as SemanticMark
  await rejected(() => prepareCompilation(document([paragraph('title', 'Title'), table]), stage(), options()), 'LAYOUT_CONTENT')
  await rejected(() => prepareCompilation(document([table]), { ...stage(), slides: [{ layout: 'table', title: 'body', marks: [] }] }, options()), 'SLIDE_TITLE', 'body')
})

fontTest('reference aliases preserve selected identity and inherit typography while producing detached content', async () => {
  const input = document()
  input.marks[1].style = { fontFamily: family, fontSize: 28 }
  input.marks.push({ id: 'alias', content: { kind: 'reference', targetId: 'body' }, source: { file: 'alias.md' } })
  const plan = await prepareCompilation(input, stage('body', ['alias']), options())
  const placed = plan.slides[0].items[0]
  assert.equal(placed.mark.id, 'alias')
  assert.equal(placed.mark.content.kind, 'paragraph')
  assert.deepEqual(placed.mark.style, { fontFamily: family, fontSize: 28 })
  assert.equal(placed.fontSizePt, 21)
  assert.deepEqual(placed.mark.source, { file: 'alias.md' })
  input.marks[1].style.fontSize = 60
  assert.equal(placed.mark.style.fontSize, 28)
})

fontTest('same input produces stable plan evidence and semantic or layout changes alter its hash', async () => {
  const input = document(), presentation = stage()
  const first = await prepareCompilation(input, presentation, options())
  const again = await prepareCompilation(structuredClone(input), structuredClone(presentation), options())
  assert.deepEqual(first.manifest, again.manifest)
  assert.match(first.manifest.planSha256, /^[a-f0-9]{64}$/)
  const changed = document([paragraph('title', 'Title'), paragraph('body', 'Changed')])
  const revised = await prepareCompilation(changed, presentation, options())
  assert.notEqual(first.manifest.inputSha256, revised.manifest.inputSha256)
  assert.notEqual(first.manifest.planSha256, revised.manifest.planSha256)
  const cover = await prepareCompilation(input, stage('cover'), options())
  assert.notEqual(first.manifest.presentationSha256, cover.manifest.presentationSha256)
  assert.equal(hashObject({ z: 1, a: 2 }), hashObject({ a: 2, z: 1 }))
  bounds(first); bounds(cover)
})

fontTest('body overflow is rejected with a source-aware diagnostic rather than automatic shrinking', async () => {
  const input = document([paragraph('title', 'Title'), paragraph('body', 'Line\n'.repeat(35))])
  const result = await rejected(() => prepareCompilation(input, stage(), options()), 'LAYOUT_OVERFLOW', 'body')
  assert.deepEqual(result.source, source)
  assert.equal(result.documentId, 'layout-fixture')
  assert.ok(result.suggestion)
  assert.equal(input.marks[1].style, undefined)
})

fontTest('implicit bold slide titles use the same safety margin as explicit bold text', async () => {
  const width = 864, count = Math.floor(width / metrics.width('W', family, 30))
  assert.ok(count * metrics.width('W', family, 30, true) > width)
  const plan = await prepareCompilation(document([paragraph('title', 'W'.repeat(count))]), stage('body', []), options())
  const title = plan.slides[0].title
  assert.ok(title.lines!.length > 1, 'Title must wrap using the bold style actually written to Office')
  for (const line of title.lines!) assert.ok(line.reduce((sum, run) => sum + metrics.width(run.text, family, title.fontSizePt, true), 0) <= title.box.width)
  bounds(plan)
})

fontTest('native table plans retain wrapped cell text and reject rows that cannot fit', async () => {
  const content = { kind: 'table' as const, header: true, rows: [[[{ text: 'Heading' }], [{ text: 'Value' }]], [[{ text: 'Short cell text with spacing' }], [{ text: '中文' }]]] }
  const input = document([paragraph('title', 'Title'), { id: 'table', content, source: { ...source } }])
  const plan = await prepareCompilation(input, stage('table', ['table']), options())
  const item = plan.slides[0].items[0]
  assert.equal(item.rowHeightsPt?.length, 2)
  assert.equal(item.tableLines?.[1][0].flat().map(run => run.text).join(''), content.rows[1][0][0].text)
  bounds(plan)
  content.rows[1][0][0].text = 'long cell '.repeat(500)
  await rejected(() => prepareCompilation(input, stage('table', ['table']), options()), 'LAYOUT_OVERFLOW', 'table')
  await rejected(() => prepareCompilation(input, note(['table']), options()), 'TABLE_ROW_HEIGHT', 'table')
})

fontTest('empty cells do not bypass minimum table column widths on either target', async () => {
  const input = document([paragraph('title', 'Title'), { id: 'table', content: { kind: 'table', header: false, rows: [Array.from({ length: 100 }, () => [])] } }])
  await rejected(() => prepareCompilation(input, stage('table', ['table']), options()), 'TABLE_COLUMN_WIDTH', 'table')
  await rejected(() => prepareCompilation(input, note(['table']), options()), 'TABLE_COLUMN_WIDTH', 'table')
})

fontTest('large image aspect ratio stays inside the slide and long captions are rejected', async () => {
  const data = pngImage(10000, 1000)
  await writeFile(path.join(assetRoot, 'wide.png'), data)
  const image: SemanticMark = { id: 'image', content: { kind: 'image', assetId: 'img', alt: 'Wide figure', caption: 'Short caption' }, source: { ...source } }
  const input = document([paragraph('title', 'Title'), image, paragraph('body', 'Supporting explanation')])
  input.assets = [{ id: 'img', path: 'wide.png' }]
  const plan = await prepareCompilation(input, stage('image', ['image', 'body']), options())
  const box = plan.slides[0].items[0].box
  assert.ok(Math.abs(box.width / box.height - 10) < 1e-8)
  bounds(plan)
  if (image.content.kind !== 'image') assert.fail('Fixture kind changed')
  image.content.caption = 'Caption\n'.repeat(30)
  await rejected(() => prepareCompilation(input, stage('image', ['image']), options()), 'LAYOUT_OVERFLOW', 'image')
})

fontTest('DOCX explicitly records its deferred pagination boundary and template font', async () => {
  const plan = await prepareCompilation(document(), note(), options())
  assert.equal(plan.theme.fontFamily, family)
  assert.equal(plan.manifest.fonts[0].family, family)
  assert.ok(plan.manifest.diagnostics.some(item => item.code === 'DOCX_PAGINATION' && item.severity === 'warning'))
  assert.equal(plan.sections[0].marks.length, 2)
})

fontTest('deep alias chains keep selection order, inherited overrides and per-alias source without recursive expansion', async () => {
  const count = 3000
  const input = document(Array.from({ length: count }, (_, index): SemanticMark => ({
    id: `m${index}`,
    content: index === count - 1 ? { kind: 'paragraph', runs: [{ text: 'Shared text' }] } : { kind: 'reference', targetId: `m${index + 1}` },
    style: index === count - 1 ? { fontFamily: family, fontSize: 16 } : index === count - 2 ? { fontSize: 20 } : {},
    source: { file: 'chain.json', pointer: `/marks/${index}` },
  })))
  // Each section stays within the presentation's 2,000 selections limit.
  const presentation: Presentation = { format: 'markflow-presentation', version: 1, target: 'docx', theme: 'standard-v1', sections: [
    { marks: input.marks.slice(0, 1500).map(mark => mark.id) }, { marks: input.marks.slice(1500).map(mark => mark.id) },
  ] }
  const plan = await prepareCompilation(input, presentation, options())
  const selected = plan.sections.flatMap(section => section.marks)
  assert.deepEqual(selected.map(mark => mark.id), input.marks.map(mark => mark.id))
  for (let index = 0; index < count; index++) {
    assert.deepEqual(selected[index].style, { fontFamily: family, fontSize: index === count - 1 ? 16 : 20 })
    assert.deepEqual(selected[index].source, { file: 'chain.json', pointer: `/marks/${index}` })
    assert.deepEqual(selected[index].content, { kind: 'paragraph', runs: [{ text: 'Shared text' }] })
  }
  assert.equal(plan.manifest.planSha256, hashObject({ sections: plan.sections, slides: [], theme: plan.theme }))
  if (selected[0].content.kind !== 'paragraph' || selected[1].content.kind !== 'paragraph') assert.fail('Resolved alias kind')
  selected[0].content.runs[0].text = 'Changed output'
  assert.equal(selected[1].content.runs[0].text, 'Shared text')
  assert.deepEqual(input.marks.at(-1)!.content, { kind: 'paragraph', runs: [{ text: 'Shared text' }] })
  input.marks.at(-1)!.content = { kind: 'reference', targetId: 'm0' }
  await rejected(() => prepareCompilation(input, presentation, options()), 'REFERENCE_CYCLE')
})
