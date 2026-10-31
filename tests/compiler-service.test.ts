import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { CompilerService, type CompilerJob, type CompilerServiceOptions, type CompilerWorkerReply } from '../src/main/compilerService'
import { automaticPresentation, runCompilerJob } from '../src/main/compiler-worker'
import { FileService } from '../src/main/files'
import type { MarkDocumentInput } from '../src/compiler/types'

const font = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts', 'msyh.ttc')
const hasFont = existsSync(font)
const sampleAsset = path.resolve('examples/compiler/assets/test-blocks.png')
const doc: MarkDocumentInput = { format: 'markflow', version: 1, documentId: 'service-test', revision: 2, assets: [], marks: [
  { id: 'title', content: { kind: 'heading', level: 1, runs: [{ text: 'Title' }] } },
  { id: 'body', content: { kind: 'paragraph', runs: [{ text: 'Body' }] } },
] }
function reply(job: CompilerJob): CompilerWorkerReply {
  return { ok: true, protectedInputs: [], result: { bytes: Buffer.from('complete artifact'), manifest: {
    compiler: { name: 'markflow', version: 'test' }, target: job.target, documentId: 'test', revision: 0,
    inputSha256: '', presentationSha256: '', planSha256: '', template: { id: 'test', version: 1, sha256: '' }, fonts: [], assets: [], writer: { name: 'test', version: 'test' }, diagnostics: [{ code: 'TEST_WARNING', severity: 'warning', message: 'Check output' }],
  } } }
}
async function harness(context: TestContext, overrides: Partial<CompilerServiceOptions> = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'markflow-service-')), root = path.join(base, 'project')
  await mkdir(root)
  const sources = new FileService(root, path.join(base, 'profile'))
  const files: (string | null)[] = [], dirs: (string | null)[] = [], outputs: (string | null)[] = []
  const jobs: CompilerJob[] = [], opened: { file: string; reveal: boolean }[] = []
  let saveDialogs = 0
  const service = new CompilerService({
    defaultFontFile: font,
    chooseFile: async () => files.shift() ?? null, chooseDirectory: async () => dirs.shift() ?? null,
    chooseOutput: async () => { saveDialogs++; return outputs.shift() ?? null },
    authorizeCurrent: async source => {
      if (!source.root) return {}
      if (source.root !== root || !source.path) throw new Error('Wrong project')
      return { sourcePath: await sources.resolve(source.path), assetRoot: root }
    },
    openPath: async (file, reveal) => { opened.push({ file, reveal }) },
    runJob: async job => { jobs.push(job); return reply(job) }, ...overrides,
  })
  context.after(async () => { service.dispose(); await rm(base, { recursive: true, force: true }) })
  return { root, service, files, dirs, outputs, jobs, opened, saves: () => saveDialogs }
}

test('only session IDs authorize export, and only successful artifact IDs authorize opening', async context => {
  const h = await harness(context)
  const unknown = await h.service.export({ sessionId: h.root, target: 'docx' })
  assert.equal(unknown.status, 'error'); assert.equal(h.saves(), 0)
  await assert.rejects(() => h.service.choose(h.root, 'assets'))
  await assert.rejects(() => h.service.open(path.join(h.root, 'outside.docx')))
  assert.equal(h.opened.length, 0)
  const session = (await h.service.create({ kind: 'sample' }))!
  h.outputs.push(path.join(h.root, 'report.docx'))
  const result = await h.service.export({ sessionId: session.id, target: 'docx' })
  assert.equal(result.status, 'success'); if (result.status !== 'success') return
  await h.service.open(result.artifactId); await h.service.open(result.artifactId, true)
  assert.deepEqual(h.opened, [{ file: result.path, reveal: false }, { file: result.path, reveal: true }])
  assert.equal(result.warnings[0].code, 'TEST_WARNING')
})

test('current snapshots require main authorization and keep detached content and display metadata', async context => {
  const h = await harness(context)
  await assert.rejects(() => h.service.create({ kind: 'current', content: 'x', root: '/ungranted', path: 'x.md' }))
  await assert.rejects(() => h.service.create({ kind: 'current', content: 'x', root: h.root, path: '../secret.md' }))
  await assert.rejects(() => h.service.create({ kind: 'current', content: 'x', path: 'x.md' }))
  const input = { kind: 'current' as const, content: '# Original', root: h.root, path: 'note.md' }
  const session = (await h.service.create(input))!
  input.content = 'Later edit'; session.fonts[0].fileLabel = '/not-authorized'
  h.outputs.push(path.join(h.root, 'saved.docx'))
  assert.equal((await h.service.export({ sessionId: session.id, target: 'docx' })).status, 'success')
  assert.deepEqual(h.jobs[0].source, { kind: 'current', content: '# Original', sourcePath: path.join(h.root, 'note.md') })
  assert.equal(h.jobs[0].assetRoot, h.root)
  assert.equal(h.jobs[0].fontFiles['Microsoft YaHei'], font)
})

test('native file selection does not implicitly authorize sibling resources, and picker cancellation keeps grants', async context => {
  const h = await harness(context), input = path.join(h.root, 'input.json')
  await writeFile(input, JSON.stringify(doc)); h.files.push(input)
  const session = (await h.service.create({ kind: 'file' }))!
  assert.equal(session.sourceLabel, input)
  assert.equal(await h.service.choose(session.id, 'assets'), null)
  assert.equal(await h.service.choose(session.id, 'presentation'), null)
  assert.equal(await h.service.create({ kind: 'file' }), null)
  h.outputs.push(path.join(h.root, 'output.docx'))
  await h.service.export({ sessionId: session.id, target: 'docx' })
  assert.equal(h.jobs[0].assetRoot, undefined)
  assert.deepEqual(h.jobs[0].source, { kind: 'file', path: input })
})

test('font and custom presentation paths come only from native selection; restoring sample defaults is explicit', async context => {
  const h = await harness(context), presentation = path.join(h.root, 'stage.json'), selectedFont = path.join(h.root, 'chosen.ttf')
  await writeFile(presentation, '{}'); await writeFile(selectedFont, 'test font')
  const session = (await h.service.create({ kind: 'sample' }))!
  assert.equal(session.presentationLabel, '内置示例布局')
  h.files.push(presentation, selectedFont)
  assert.equal((await h.service.choose(session.id, 'presentation'))!.presentationLabel, presentation)
  const mapped = await h.service.choose(session.id, 'font', 'Other Family')
  assert.equal(mapped!.fonts.find(item => item.family === 'Other Family')!.fileLabel, selectedFont)
  await assert.rejects(() => h.service.choose(session.id, 'font', 'bad\0name'))
  assert.equal((await h.service.useAutomatic(session.id)).presentationLabel, '内置示例布局')
  h.outputs.push(path.join(h.root, 'output.docx'))
  await h.service.export({ sessionId: session.id, target: 'docx' })
  assert.equal(h.jobs[0].presentationPath, undefined)
  assert.equal(h.jobs[0].fontFiles['Other Family'], selectedFont)
})

test('save cancellation never starts compilation or changes an existing output', async context => {
  const h = await harness(context), output = path.join(h.root, 'old.docx')
  await writeFile(output, 'old artifact')
  const session = (await h.service.create({ kind: 'sample' }))!
  assert.deepEqual(await h.service.export({ sessionId: session.id, target: 'docx' }), { status: 'cancelled' })
  assert.equal(h.jobs.length, 0); assert.equal(await readFile(output, 'utf8'), 'old artifact')
})

test('a pending generation rejects duplicate exports and setting changes without releasing its busy guard', async context => {
  let finish!: (reply: CompilerWorkerReply) => void, pendingJob!: CompilerJob
  const h = await harness(context, { runJob: job => { pendingJob = job; return new Promise(resolve => { finish = resolve }) } })
  const session = (await h.service.create({ kind: 'sample' }))!
  h.outputs.push(path.join(h.root, 'output.docx'))
  const pending = h.service.export({ sessionId: session.id, target: 'docx' })
  while (!finish) await new Promise(resolve => setImmediate(resolve))
  for (let i = 0; i < 2; i++) {
    const duplicate = await h.service.export({ sessionId: session.id, target: 'docx' })
    assert.equal(duplicate.status === 'error' && duplicate.diagnostics[0].code, 'COMPILER_BUSY')
  }
  await assert.rejects(() => h.service.choose(session.id, 'assets'))
  assert.equal(h.saves(), 1)
  finish(reply(pendingJob)); assert.equal((await pending).status, 'success')
})

test('worker diagnostics and protected-input failures retain previous bytes and leave no temporary file', async context => {
  const h = await harness(context, { runJob: async () => ({ ok: false, diagnostics: [{ code: 'LAYOUT_OVERFLOW', severity: 'error', message: 'Too long', markId: 'body' }] }) })
  const output = path.join(h.root, 'old.docx'); await writeFile(output, 'old artifact'); h.outputs.push(output)
  const session = (await h.service.create({ kind: 'sample' }))!
  const failed = await h.service.export({ sessionId: session.id, target: 'docx' })
  assert.equal(failed.status === 'error' && failed.diagnostics[0].markId, 'body')
  assert.equal(await readFile(output, 'utf8'), 'old artifact')
  const guarded = await harness(context, { runJob: async job => ({ ...reply(job), protectedInputs: [output] }) as CompilerWorkerReply })
  const second = (await guarded.service.create({ kind: 'sample' }))!; guarded.outputs.push(output)
  const protectedResult = await guarded.service.export({ sessionId: second.id, target: 'docx' })
  assert.equal(protectedResult.status === 'error' && protectedResult.diagnostics[0].code, 'OUTPUT_INPUT')
  assert.equal(await readFile(output, 'utf8'), 'old artifact')
  assert.equal((await readdir(h.root)).some(name => name.endsWith('.tmp')), false)
})

test('worker timeout and crash return diagnostics while keeping the previous output intact', async context => {
  const h = await harness(context, { runJob: undefined, timeoutMs: 50 })
  const hungWorker = path.join(h.root, 'hung.mjs'); await writeFile(hungWorker, 'setInterval(() => {}, 1000)')
  const service = new CompilerService({ chooseFile: async () => null, chooseDirectory: async () => null, chooseOutput: async () => path.join(h.root, 'output.docx'), authorizeCurrent: async () => ({}), openPath: async () => {}, workerFile: hungWorker, timeoutMs: 50 })
  context.after(() => service.dispose())
  await writeFile(path.join(h.root, 'output.docx'), 'old')
  const session = (await service.create({ kind: 'sample' }))!
  const result = await service.export({ sessionId: session.id, target: 'docx' })
  assert.equal(result.status === 'error' && result.diagnostics[0].code, 'COMPILER_TIMEOUT')
  assert.equal(await readFile(path.join(h.root, 'output.docx'), 'utf8'), 'old')
  const crashedWorker = path.join(h.root, 'crashed.mjs'); await writeFile(crashedWorker, 'throw new Error("deliberate worker error")')
  const crashed = new CompilerService({ chooseFile: async () => null, chooseDirectory: async () => null, chooseOutput: async () => path.join(h.root, 'output.docx'), authorizeCurrent: async () => ({}), openPath: async () => {}, workerFile: crashedWorker })
  context.after(() => crashed.dispose())
  const crashSession = (await crashed.create({ kind: 'sample' }))!
  const crashResult = await crashed.export({ sessionId: crashSession.id, target: 'docx' })
  assert.equal(crashResult.status === 'error' && crashResult.diagnostics[0].code, 'COMPILER_WORKER')
  assert.equal(await readFile(path.join(h.root, 'output.docx'), 'utf8'), 'old')
})

test('release and session/artifact limits discard authority without deleting user files', async context => {
  const h = await harness(context), first = (await h.service.create({ kind: 'sample' }))!
  for (let i = 0; i < 8; i++) await h.service.create({ kind: 'sample' })
  assert.equal((await h.service.export({ sessionId: first.id, target: 'docx' })).status, 'error')
  const live = (await h.service.create({ kind: 'sample' }))!
  let oldest = ''
  for (let i = 0; i < 17; i++) {
    h.outputs.push(path.join(h.root, `artifact-${i}.docx`))
    const result = await h.service.export({ sessionId: live.id, target: 'docx' })
    assert.equal(result.status, 'success'); if (result.status === 'success' && i === 0) oldest = result.artifactId
  }
  await assert.rejects(() => h.service.open(oldest))
  assert.equal(await readFile(path.join(h.root, 'artifact-0.docx'), 'utf8'), 'complete artifact')
  await h.service.release(live.id)
  assert.equal((await h.service.export({ sessionId: live.id, target: 'docx' })).status, 'error')
})

test('automatic Note/Stage select every original identity without altering content and keep image/table pages separate', () => {
  const input = structuredClone(doc)
  input.marks.unshift({ id: 'preface', content: { kind: 'paragraph', runs: [{ text: 'Preface' }] } })
  input.marks.push({ id: 'img', content: { kind: 'image', assetId: 'asset', alt: 'Picture' } }, { id: 'tbl', content: { kind: 'table', header: false, rows: [[[{ text: 'Cell' }]]] } }, { id: 'alias', content: { kind: 'reference', targetId: 'body' } })
  input.retiredIds = ['compiler-title-1']
  const original = structuredClone(input)
  const note = automaticPresentation(input, 'docx'), stage = automaticPresentation(input, 'pptx')
  assert.deepEqual(input, original)
  assert.equal(note.presentation.target, 'docx'); assert.equal(stage.presentation.target, 'pptx')
  if (note.presentation.target !== 'docx' || stage.presentation.target !== 'pptx') return
  assert.deepEqual(note.presentation.sections[0].marks, input.marks.map(mark => mark.id))
  const selected = new Set(stage.presentation.slides.flatMap(slide => [slide.title, ...slide.marks]))
  for (const mark of input.marks) { assert.ok(selected.has(mark.id)); assert.deepEqual(stage.document.marks.find(item => item.id === mark.id), mark) }
  assert.ok(stage.document.marks.some(mark => mark.id === 'compiler-title-2'))
  assert.deepEqual(stage.presentation.slides.filter(slide => ['image', 'table'].includes(slide.layout)).map(slide => slide.marks), [['img'], ['tbl']])
})

test('real job rejects image reads without a grant and preserves UTF-8/schema diagnostics', { skip: !hasFont }, async context => {
  const h = await harness(context), base: CompilerJob = { source: { kind: 'current', content: '![x](secret.png)', sourcePath: '未命名.md' }, target: 'docx', fontFiles: { 'Microsoft YaHei': font } }
  const denied = await runCompilerJob(base)
  assert.equal(!denied.ok && denied.diagnostics[0].code, 'ASSET_ROOT_REQUIRED')
  const bad = path.join(h.root, 'bad.md'); await writeFile(bad, Buffer.from([0xc3, 0x28]))
  const corrupt = await runCompilerJob({ ...base, source: { kind: 'file', path: bad } })
  assert.equal(!corrupt.ok && corrupt.diagnostics[0].code, 'INPUT_ENCODING')
  const presentation = path.join(h.root, 'presentation.json'); await writeFile(presentation, JSON.stringify({ target: 'pptx' }))
  const mismatch = await runCompilerJob({ ...base, source: { kind: 'current', content: '# Title', sourcePath: '未命名.md' }, presentationPath: presentation })
  assert.equal(!mismatch.ok && mismatch.diagnostics[0].code, 'PRESENTATION_TARGET')
})

test('real current snapshot exports unsaved text, rebases image paths within the project, and guards every input', { skip: !hasFont }, async context => {
  const h = await harness(context)
  await mkdir(path.join(h.root, 'notes')); await copyFile(sampleAsset, path.join(h.root, 'image.png'))
  const source = path.join(h.root, 'notes', 'note.md'); await writeFile(source, 'OLD DISK CONTENT')
  const result = await runCompilerJob({ source: { kind: 'current', sourcePath: source, content: '# Unsaved title\n\nUnsaved content\n\n![Picture](../image.png)' }, target: 'docx', assetRoot: h.root, fontFiles: { 'Microsoft YaHei': font } })
  assert.equal(result.ok, true, JSON.stringify(result)); if (!result.ok) return
  const zip = await JSZip.loadAsync(result.result.bytes), xml = await zip.file('word/document.xml')!.async('string')
  assert.match(xml, /Unsaved content/); assert.doesNotMatch(xml, /OLD DISK CONTENT/)
  for (const file of [source, font, path.join(h.root, 'image.png')]) assert.ok(result.protectedInputs.includes(file))
  assert.equal(await readFile(source, 'utf8'), 'OLD DISK CONTENT')
})

test('packaged sample logic uses a supplied asset location and retains the checked four-slide layout', { skip: !hasFont }, async () => {
  const result = await runCompilerJob({ source: { kind: 'sample' }, target: 'pptx', fontFiles: { 'Microsoft YaHei': font } }, sampleAsset)
  assert.equal(result.ok, true, JSON.stringify(result)); if (!result.ok) return
  const zip = await JSZip.loadAsync(result.result.bytes)
  assert.equal(Object.keys(zip.files).filter(file => /^ppt\/slides\/slide\d+\.xml$/.test(file)).length, 4)
  assert.equal(result.result.manifest.assets[0].relativePath, path.basename(sampleAsset))
  assert.ok(result.protectedInputs.includes(sampleAsset))
})

test('real core overflow leaves an existing artifact unchanged through the desktop service', { skip: !hasFont }, async context => {
  const h = await harness(context, { runJob: job => runCompilerJob(job, sampleAsset) })
  const output = path.join(h.root, 'deck.pptx'); await writeFile(output, 'old successful artifact')
  const session = (await h.service.create({ kind: 'current', content: '# Heading\n\n' + 'Long body text '.repeat(2000) }))!
  h.outputs.push(output)
  const result = await h.service.export({ sessionId: session.id, target: 'pptx' })
  assert.equal(result.status === 'error' && result.diagnostics.some(item => item.code === 'LAYOUT_OVERFLOW'), true)
  assert.equal(await readFile(output, 'utf8'), 'old successful artifact')
})
