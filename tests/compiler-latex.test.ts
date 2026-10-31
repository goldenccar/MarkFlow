import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { generatePaperSource, markdownToPaperDocument, type PaperDocumentInput, type PaperPresentation } from '../src/compiler/latex'
import { CompilationError } from '../src/compiler/diagnostics'
import { ensureMarkDocument, parseMarks, readMarkDocument, reconcileMarkDocument, setMarkStyle } from '../src/shared/marks'
import { normalizeDocument } from '../src/compiler/model'
import type { MarkDocumentInput } from '../src/compiler/types'

const config: PaperPresentation = { format: 'markflow-paper-presentation', version: 1, template: 'chinese', title: 'Paper & 100% {safe}', authors: ['A_B', 'C \\ D'], abstract: 'A < B; $100 #1' }
const base = (): MarkDocumentInput => ({ format: 'markflow', version: 1, documentId: 'shared', revision: 2, marks: [{ id: 'head', content: { kind: 'heading', level: 1, runs: [{ text: 'Section' }] } }, { id: 'fact', content: { kind: 'paragraph', runs: [{ text: '12 cities & 24 checks' }] } }], assets: [] })
const paper = (): PaperDocumentInput => ({ format: 'markflow-paper', version: 1, document: base(), extensions: [] })

test('paper consumes unchanged shared Mark data, deterministic map and preserved original source', async () => {
  const input = JSON.parse(await readFile('examples/compiler/content.json', 'utf8')) as MarkDocumentInput
  const before = structuredClone(input), result = generatePaperSource(input, config)
  assert.deepEqual(input, before)
  assert.deepEqual(result, generatePaperSource(input, config))
  assert.deepEqual(result.sourceMap.marks.map(mark => mark.markId), input.marks.map(mark => mark.id))
  assert.equal(result.sourceMap.revision, input.revision)
  assert.ok(result.files['main.tex'].includes('12 个城市'))
  assert.ok(result.files['main.tex'].includes('assets/asset-test-blocks.png'))
  assert.deepEqual(result.assets, [{ id: 'asset-test-blocks', path: 'assets/test-blocks.png', targetPath: 'assets/asset-test-blocks.png' }])
  for (const item of result.sourceMap.marks) assert.equal(result.files[item.file].split('\n')[item.fromLine - 1], `% Mark ${item.markId}`)
  assert.deepEqual(JSON.parse(result.files['markflow-source.json']), input)
  assert.deepEqual(JSON.parse(result.files['markflow-source-map.json']), result.sourceMap)
})

test('plain text, metadata, formatting and bibliography are escaped rather than executed', () => {
  const input = base()
  input.marks[1].content = { kind: 'paragraph', runs: [{ text: '\\input{secret} & % _ $ # ~ ^', format: { bold: true, italic: true, underline: true, strike: true, script: 'superscript', highlight: '#fff2a8' } }] }
  const result = generatePaperSource(input, { ...config, references: [{ id: 'source', type: 'misc', title: '\\input{secret} % &', author: 'A_B', year: '2026' }] })
  assert.ok(result.files['main.tex'].includes('Paper \\& 100\\% \\{safe\\}'))
  assert.ok(result.files['main.tex'].includes('\\textsuperscript{\\sout{\\uline{\\textit{\\textbf{'))
  assert.ok(result.files['main.tex'].includes('\\textbackslash{}input\\{secret\\}'))
  assert.ok(result.files['references.bib'].includes('\\textbackslash{}input\\{secret\\} \\% \\&'))
  assert.ok(!result.files['main.tex'].includes('\\input{secret}'))
})

test('typed equations, inline math, citations and stable-ID cross-references generate real TeX constructs', () => {
  const input = paper()
  input.document.marks.push({ id: 'equation', content: { kind: 'paragraph', runs: [{ text: 'E = mc^2' }] } })
  input.extensions.push({ markId: 'equation', content: { kind: 'equation', tex: 'E = mc^2' } }, { markId: 'fact', content: { kind: 'paragraph', runs: [{ text: 'See ' }, { kind: 'cross-reference', targetId: 'equation' }, { kind: 'math', tex: '\\frac{a}{b}' }, { kind: 'citation', keys: ['knuth1984'] }] } })
  const result = generatePaperSource(input, { ...config, references: [{ id: 'knuth1984', type: 'book', author: 'Donald E. Knuth', title: 'The TeXbook', publisher: 'Addison-Wesley', year: '1984' }] })
  assert.ok(result.files['main.tex'].includes('\\begin{equation}\\label{mark:equation}'))
  assert.ok(result.files['main.tex'].includes('\\ref{mark:equation}\\(\\frac{a}{b}\\)\\cite{knuth1984}'))
  assert.ok(result.files['main.tex'].includes('\\bibliography{references}'))
  normalizeDocument(input.document)
})

test('unknown structures, macros, malformed math and unresolved links fail without mutating inputs', () => {
  for (const tex of ['\\input{file}', '\\write18{cmd}', '\\def\\foo{bar}', '\\begin{document}', '\\begin{aligned}a', '\\frac{a}{b', 'x%comment', 'x^^5cinput']) {
    const input = paper(); input.extensions.push({ markId: 'fact', content: { kind: 'equation', tex } })
    const before = structuredClone(input)
    assert.throws(() => generatePaperSource(input, config), CompilationError, tex)
    assert.deepEqual(input, before)
  }
  for (const content of [{ kind: 'unknown' }, { kind: 'paragraph', runs: [{ kind: 'citation', keys: ['missing'] }] }, { kind: 'paragraph', runs: [{ kind: 'cross-reference', targetId: 'fact' }] }, { kind: 'paragraph', runs: [{ text: 'A', format: { unknown: true } }] }]) {
    assert.throws(() => generatePaperSource({ ...paper(), extensions: [{ markId: 'fact', content }] }, config), CompilationError)
  }
  assert.throws(() => generatePaperSource({ ...base(), unknown: true }, config), CompilationError)
  assert.throws(() => generatePaperSource(base(), { ...config, unknown: true }), CompilationError)
  assert.throws(() => generatePaperSource({ ...base(), assets: [{ id: 'escape', path: '../secret.png' }] }, config), CompilationError)
  let invoked = false
  assert.throws(() => generatePaperSource({ get format() { invoked = true; return 'markflow' } }, config), CompilationError)
  assert.equal(invoked, false)
})

test('Markdown math adapter preserves registered IDs, typography and original CRLF/BOM source spans', () => {
  const body = '# 标题\n\n共享 **12 个城市**，公式 $x^2$。\n\n$$\nE = mc^2\n$$\n\n见 [@knuth1984]。'
  const registered = setMarkStyle(ensureMarkDocument(body), body.indexOf('共享'), { fontFamily: 'fangsong', fontSize: 21 })
  for (const source of [registered, '\uFEFF' + registered.replaceAll('\n', '\r\n')]) {
    const original = source, converted = markdownToPaperDocument(source, 'paper.md'), data = converted.document.document
    assert.equal(source, original)
    assert.equal(data.documentId, readMarkDocument(registered).metadata!.documentId)
    assert.deepEqual(data.marks.map(mark => mark.id), parseMarks(registered).map(mark => mark.id))
    assert.deepEqual(data.marks[1].style, { fontFamily: 'FangSong', fontSize: 21 })
    assert.ok(!JSON.stringify(data).includes('MARKFLOWMATH'))
    assert.equal(source.slice(data.marks[2].source!.from, data.marks[2].source!.to), source.includes('\r\n') ? '$$\r\nE = mc^2\r\n$$' : '$$\nE = mc^2\n$$')
    assert.equal(data.marks[3].source!.line, 9)
    assert.equal(converted.diagnostics.length, 0)
    const result = generatePaperSource(converted.document, { ...config, references: [{ id: 'knuth1984', type: 'book', title: 'The TeXbook', author: 'Donald E. Knuth', year: '1984' }] })
    assert.ok(result.files['main.tex'].includes('\\(x^2\\)'))
    assert.ok(result.files['main.tex'].includes('\\cite{knuth1984}'))
  }
})

test('Markdown plain source has deterministic snapshot IDs, definitions and citations resolve', () => {
  const source = '# Title\n\nSee $x$, $y$ and [@one; @two].\n\n![Image][asset]\n\n[asset]: assets/test.png "Caption"'
  const result = markdownToPaperDocument(source, 'same.md')
  assert.deepEqual(result, markdownToPaperDocument(source, 'same.md'))
  assert.equal(result.diagnostics[0].code, 'MARKDOWN_TEMPORARY_IDENTITIES')
  assert.equal(result.document.document.consumedSources?.length, 1)
  assert.equal(result.document.extensions[0].content.kind, 'paragraph')
  assert.deepEqual(result.document.extensions[0].content.kind === 'paragraph' && result.document.extensions[0].content.runs.at(-2), { kind: 'citation', keys: ['one', 'two'] })
  assert.equal(result.document.document.marks[2].source?.line, 5)
  assert.throws(() => markdownToPaperDocument('before\n\n$$\nx\n$$\n\n> unsupported', 'bad.md'), (error: unknown) => error instanceof CompilationError && error.diagnostics.some(item => item.code === 'MARKDOWN_UNSUPPORTED_BLOCK' && item.source?.line === 7))
})

test('Markdown keeps invalid metadata and unsupported structures explicit', () => {
  assert.throws(() => markdownToPaperDocument('Text\n\n<!-- oops:marks {broken} -->', 'bad.md'), CompilationError)
  assert.throws(() => markdownToPaperDocument('**$x$**', 'bad.md'), CompilationError)
  assert.throws(() => markdownToPaperDocument('```python\nprint(1)\n```', 'code.md'), CompilationError)
})

test('display math boundaries stay separate even without surrounding blank lines', () => {
  const source = ensureMarkDocument('Before\n$$\nx^2\n$$\nAfter')
  const result = markdownToPaperDocument(source, 'adjacent.md')
  assert.deepEqual(result.document.document.marks.map(mark => mark.id), parseMarks(source).map(mark => mark.id))
  assert.equal(result.document.document.marks.length, 3)
  assert.equal(result.document.document.marks[2].source?.line, 5)
  assert.equal(result.document.extensions[0].content.kind, 'equation')
})

test('content references retain shared typography and convert engine pixels to TeX points', () => {
  const source = base()
  source.marks[1].style = { fontSize: 20, fontFamily: 'FangSong' }
  source.marks.push({ id: 'copy', content: { kind: 'reference', targetId: 'fact' } })
  const result = generatePaperSource(source, config)
  assert.equal(result.files['main.tex'].match(/\\fontsize\{15\}\{21\}/g)?.length, 2)
  assert.equal(result.diagnostics.filter(item => item.code === 'PAPER_TEMPLATE_FONT').length, 1)
})

test('a final display equation never invents a trailing Mark', () => {
  for (const body of ['$$\nx\n$$', 'Before\n\n$$\nx\n$$\n', 'Before\n$$\nx\n$$\n\n']) {
    for (const source of [body, ensureMarkDocument(body)]) {
      const result = markdownToPaperDocument(source, 'equation.md')
      assert.equal(result.document.document.marks.length, parseMarks(source).length)
      if (readMarkDocument(source).metadata) assert.deepEqual(result.document.document.marks.map(mark => mark.id), parseMarks(source).map(mark => mark.id))
      assert.ok(generatePaperSource(result.document, config).files['main.tex'].includes('\\begin{equation}'))
    }
  }
})

test('unsaved rich Markdown with one final newline keeps its registered empty Mark in paper source maps', () => {
  const original = ensureMarkDocument('# 原文保留\n\nUNSAVED_MARK_SNAPSHOT 引用 [@ref1]。'), marks = parseMarks(original), body = readMarkDocument(original).body + '\n', emptyId = crypto.randomUUID()
  const source = reconcileMarkDocument(original, body, [...marks.map(mark => ({ id: mark.id, type: mark.type, from: mark.from, to: mark.to })), { id: emptyId, type: 'empty', from: body.length, to: body.length }])
  const converted = markdownToPaperDocument(source, '未命名.md'), ids = [...marks.map(mark => mark.id), emptyId]
  assert.deepEqual(converted.document.document.marks.map(mark => mark.id), ids)
  assert.equal(converted.diagnostics.length, 0)
  const generated = generatePaperSource(converted.document, { ...config, references: [{ id: 'ref1', type: 'misc', author: 'Author', title: 'Source', year: '2026' }] })
  assert.deepEqual(generated.sourceMap.marks.map(mark => mark.markId), ids)
  assert.equal(generated.sourceMap.marks.at(-1)?.source?.from, body.length)
  assert.ok(generated.files['main.tex'].includes('UNSAVED\\_MARK\\_SNAPSHOT'))
  assert.throws(() => markdownToPaperDocument(source.replace(/"bodyHash":"[^"]+"/, '"bodyHash":"0:0:0"'), 'stale.md'), CompilationError)
})
