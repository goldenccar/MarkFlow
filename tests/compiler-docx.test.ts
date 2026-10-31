import assert from 'node:assert/strict'
import test from 'node:test'
import JSZip from 'jszip'
import { writeDocx } from '../src/compiler/docx.js'
import type { CompilationPlan, ResolvedMark, SemanticContent } from '../src/compiler/types.js'

const mark = (id: string, content: ResolvedMark['content']): ResolvedMark => ({ id, content, style: {} })
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iRZkAAAAASUVORK5CYII=', 'base64')
function plan(marks: ResolvedMark[]): CompilationPlan {
  return {
    target: 'docx', documentId: 'test-document', revision: 4,
    theme: {
      id: 'standard-v1', version: 1, fontFamily: 'Microsoft YaHei', ink: '223344', muted: '657585', accent: '3377AA', background: 'FFFFFF',
      note: { widthPt: 595.28, heightPt: 841.89, marginPt: 54, bodyPt: 11, headingPt: [24, 20, 17, 15, 13, 12], lineHeight: 1.5 },
      stage: { widthPt: 960, heightPt: 540, marginPt: 40, titlePt: 28, coverPt: 36, bodyPt: 18, minimumPt: 16, lineHeight: 1.4 },
    },
    sections: [{ marks, breakBefore: false }], slides: [],
    assets: new Map([['photo', { id: 'photo', relativePath: 'photo.png', mime: 'image/png', data: new Uint8Array(png), width: 1200, height: 600, sha256: 'fixture' }]]),
    manifest: {
      compiler: { name: 'markflow', version: '0.1.0' }, target: 'docx', documentId: 'test-document', revision: 4,
      inputSha256: 'input', presentationSha256: 'presentation', planSha256: 'plan', template: { id: 'standard-v1', version: 1, sha256: 'theme' },
      fonts: [], assets: [], writer: { name: 'docx', version: '9.15.0' }, diagnostics: [],
    },
  }
}
async function unpack(input: CompilationPlan) {
  const zip = await JSZip.loadAsync(await writeDocx(input))
  const xml = async (name: string) => { const entry = zip.file(name); assert.ok(entry, `Missing OOXML part ${name}`); return entry.async('string') }
  return { zip, xml, document: await xml('word/document.xml') }
}

test('DOCX writes editable native content, exact runs, links, image and repeating table header', async () => {
  const input = plan([
    mark('title', { kind: 'heading', level: 1, runs: [{ text: '项目报告 Project' }] }),
    mark('intro', { kind: 'paragraph', runs: [
      { text: '中文 & English <facts>', format: { bold: true, italic: true, underline: true, strike: true, highlight: '#FFFF00' } },
      { text: '2', format: { script: 'superscript' } }, { text: 'n', format: { script: 'subscript' } },
      { text: '定制高亮', format: { highlight: 'A1B2C3' } },
      { text: '来源\n继续', format: { link: 'https://example.com/report?a=1&b=2' } },
    ] }),
    mark('heading', { kind: 'heading', level: 2, runs: [{ text: '实际内容' }] }),
    mark('figure', { kind: 'image', assetId: 'photo', alt: '项目示意', caption: '图注来自输入' }),
    mark('table', { kind: 'table', header: true, rows: [
      [[{ text: '项目' }], [{ text: '值' }]], [[{ text: '交付数' }], [{ text: '42', format: { bold: true } }]],
    ] }),
  ])
  input.sections[0].marks[1].style = { fontFamily: 'Microsoft YaHei', fontSize: 24 }
  const original = structuredClone(input)
  const { zip, xml, document } = await unpack(input)
  assert.deepEqual(input, original, 'writer must not mutate a prepared plan')
  assert.match(document, /w:pStyle w:val="Title"/)
  assert.match(document, /w:pStyle w:val="Heading2"/)
  assert.match(document, /中文 &amp; English &lt;facts&gt;/)
  assert.match(document, /<w:b\/>/); assert.match(document, /<w:i\/>/)
  assert.match(document, /<w:u w:val="single"\/>/); assert.match(document, /<w:strike\/>/)
  assert.match(document, /<w:vertAlign w:val="superscript"\/>/)
  assert.match(document, /<w:vertAlign w:val="subscript"\/>/)
  assert.match(document, /<w:highlight w:val="yellow"\/>/)
  assert.match(document, /<w:shd[^>]*w:fill="A1B2C3"/)
  assert.match(document, /<w:sz w:val="36"\/>/)
  assert.match(document, /<w:rFonts[^>]*w:eastAsia="Microsoft YaHei"/)
  assert.match(document, /<w:hyperlink[^>]*r:id=/); assert.match(document, /<w:br\/>/)
  assert.match(await xml('word/_rels/document.xml.rels'), /Target="https:\/\/example.com\/report\?a=1&amp;b=2"/)
  assert.equal((document.match(/<w:tbl>/g) ?? []).length, 1)
  assert.equal((document.match(/<w:tr>/g) ?? []).length, 2)
  assert.equal((document.match(/<w:tc>/g) ?? []).length, 4)
  assert.match(document, /<w:tblHeader\/>/)
  assert.match(document, /<w:tblLayout w:type="fixed"\/>/)
  assert.match(document, /<w:drawing>/); assert.match(document, /descr="项目示意"/)
  assert.match(document, /图注来自输入/)
  const images = Object.keys(zip.files).filter(name => name.startsWith('word/media/') && !zip.files[name].dir)
  assert.equal(images.length, 1)
  assert.deepEqual(await zip.file(images[0])!.async('uint8array'), new Uint8Array(png))
  const extent = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(document)
  assert.ok(extent)
  assert.ok(Number(extent[1]) <= Math.ceil((input.theme.note.widthPt - 108) * 12700))
  assert.equal(Number(extent[1]), Number(extent[2]) * 2)
  assert.doesNotMatch(document, /test-document|inputSha256|Source:|来源 Mark/)
})

test('DOCX lists keep native numbering, start ordinals, continuation and explicit restarts', async () => {
  const input = plan([
    mark('seven', { kind: 'list-item', ordered: true, ordinal: 7, runs: [{ text: 'first' }] }),
    mark('eight', { kind: 'list-item', ordered: true, ordinal: 8, runs: [{ text: 'second' }] }),
    mark('three', { kind: 'list-item', ordered: true, ordinal: 3, runs: [{ text: 'restart' }] }),
    mark('bullet', { kind: 'list-item', ordered: false, runs: [{ text: 'bullet item' }] }),
  ])
  const { xml, document } = await unpack(input)
  const numbering = await xml('word/numbering.xml')
  assert.match(numbering, /<w:start w:val="7"\/>/)
  assert.match(numbering, /<w:start w:val="3"\/>/)
  assert.match(numbering, /<w:numFmt w:val="decimal"\/>/)
  assert.match(numbering, /<w:numFmt w:val="bullet"\/>/)
  const ids = [...document.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map(match => match[1])
  assert.equal(ids.length, 4); assert.equal(ids[0], ids[1]); assert.notEqual(ids[1], ids[2]); assert.notEqual(ids[2], ids[3])
  assert.doesNotMatch(document, />7\. first|>8\. second|>• bullet item/)
})

test('DOCX sections break only when requested and preserve A4 geometry and default typography', async () => {
  const input = plan([mark('one', { kind: 'paragraph', runs: [{ text: 'page one' }] })])
  input.sections.push({ breakBefore: true, marks: [mark('two', { kind: 'heading', level: 1, runs: [{ text: 'page two' }] }), mark('body', { kind: 'paragraph', runs: [{ text: 'same page' }] })] })
  input.sections.push({ breakBefore: false, marks: [mark('three', { kind: 'paragraph', runs: [{ text: 'continuous section' }] })] })
  const { xml, document } = await unpack(input)
  assert.equal((document.match(/<w:pageBreakBefore\/>/g) ?? []).length, 1)
  assert.match(document, /w:pStyle w:val="Heading1"/)
  assert.match(document, /<w:pgSz[^>]*w:w="11906"[^>]*w:h="16838"/)
  assert.match(document, /<w:pgMar[^>]*w:top="1080"/)
  assert.match(await xml('word/styles.xml'), /<w:sz w:val="22"\/>/)
  assert.match(document, /page one[\s\S]*page two[\s\S]*same page[\s\S]*continuous section/)
})

test('DOCX table-first page breaks and unsupported payloads fail explicitly without resource reads', async () => {
  const input = plan([mark('one', { kind: 'paragraph', runs: [{ text: 'before' }] })])
  input.sections.push({ breakBefore: true, marks: [mark('next-table', { kind: 'table', header: false, rows: [[[{ text: 'after' }]]] })] })
  assert.equal(((await unpack(input)).document.match(/<w:pageBreakBefore\/>/g) ?? []).length, 1)
  const cases: ResolvedMark[] = [
    mark('missing-image', { kind: 'image', assetId: 'absent', alt: '' }),
    mark('ragged-table', { kind: 'table', header: false, rows: [[[{ text: 'one' }]], []] }),
    mark('bad-highlight', { kind: 'paragraph', runs: [{ text: 'color', format: { highlight: 'invalid' } }] }),
    mark('bad-link', { kind: 'paragraph', runs: [{ text: 'link', format: { link: 'file:///private.txt' } }] }),
    mark('unresolved', { kind: 'reference', targetId: 'other' } as SemanticContent as ResolvedMark['content']),
  ]
  for (const item of cases) await assert.rejects(writeDocx(plan([item])), new RegExp(`DOCX \\[${item.id}\\]`))
  input.target = 'pptx'
  await assert.rejects(writeDocx(input), /requires a docx/)
})
