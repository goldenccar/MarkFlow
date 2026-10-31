import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import JSZip from 'jszip'
import { compile, applySemanticCommands, CompilationError, writeCompilation } from '../src/compiler/index.js'
import type { MarkDocumentInput, NotePresentation, StagePresentation } from '../src/compiler/types.js'

const font = process.env.MARKFLOW_TEST_FONT ?? 'C:/Windows/Fonts/msyh.ttc'
const available = existsSync(font)
const document: MarkDocumentInput = {
  format: 'markflow', version: 1, documentId: 'shared-demo', revision: 0, assets: [],
  marks: [
    { id: 'title', content: { kind: 'heading', level: 1, runs: [{ text: '共同资料' }] } },
    { id: 'fact', source: { file: 'source.json', pointer: '/marks/1' }, content: { kind: 'paragraph', runs: [{ text: '覆盖 12 个城市。' }] } },
    { id: 'table', content: { kind: 'table', header: true, rows: [[[{ text: '类别' }], [{ text: '数量' }]], [[{ text: '计划' }], [{ text: '12' }]]] } },
  ],
}
const note: NotePresentation = { format: 'markflow-presentation', version: 1, target: 'docx', theme: 'standard-v1', sections: [{ marks: ['title', 'fact', 'table'] }] }
const stage: StagePresentation = { format: 'markflow-presentation', version: 1, target: 'pptx', theme: 'standard-v1', slides: [{ layout: 'body', title: 'title', marks: ['fact'] }, { layout: 'table', title: 'title', marks: ['table'] }] }
const options = { assetRoot: process.cwd(), fontFiles: { 'Microsoft YaHei': font } }
async function xml(bytes: Uint8Array, file: string): Promise<string> { return (await JSZip.loadAsync(bytes)).file(file)!.async('string') }

test('prototype-like portable IDs do not acquire fabricated source locations during commands', () => {
  const input: MarkDocumentInput = { format: 'markflow', version: 1, documentId: 'constructor', revision: 0, assets: [], marks: [{ id: 'constructor', content: { kind: 'paragraph', runs: [{ text: 'source-free' }] } }] }
  const changed = applySemanticCommands(input, [{ type: 'style', id: 'constructor', patch: { fontSize: 16 } }], 0)
  assert.equal(changed.marks[0].source, undefined)
})

test('shared fact edit reuses Mark identity/revision and updates native DOCX and PPTX with an embedded manifest', { skip: !available }, async () => {
  const changed = applySemanticCommands(document, [{ type: 'edit', id: 'fact', content: { kind: 'paragraph', runs: [{ text: '覆盖 18 个城市。' }] } }], 0)
  assert.equal(changed.revision, 1)
  for (const presentation of [note, stage]) {
    const first = await compile(document, presentation, options)
    const next = await compile(changed, presentation, options)
    const file = presentation.target === 'docx' ? 'word/document.xml' : 'ppt/slides/slide1.xml'
    assert.match(await xml(first.bytes, file), /覆盖 12 个城市/)
    assert.match(await xml(next.bytes, file), /覆盖 18 个城市/)
    assert.doesNotMatch(await xml(next.bytes, file), /覆盖 12 个城市/)
    const embedded = JSON.parse(await xml(next.bytes, 'markflow/manifest.json'))
    assert.equal(embedded.revision, 1)
    assert.equal(embedded.inputSha256, next.manifest.inputSha256)
    assert.notEqual(first.manifest.inputSha256, next.manifest.inputSha256)
  }
})

test('native PPTX table, format and explicit line boxes remain editable; no shrink or page raster', { skip: !available }, async () => {
  const styled = structuredClone(document)
  styled.marks[1].content = { kind: 'paragraph', runs: [{ text: '带格式的文字', format: { bold: true, italic: true, underline: true, strike: true, highlight: '#FFFF00', script: 'superscript', link: 'https://example.com' } }] }
  const result = await compile(styled, stage, options)
  const first = await xml(result.bytes, 'ppt/slides/slide1.xml'), second = await xml(result.bytes, 'ppt/slides/slide2.xml')
  assert.match(first, /<a:t>带格式的文字<\/a:t>/)
  assert.match(first, /<a:highlight>/)
  assert.match(first, /baseline="30000"/)
  assert.match(first, /<a:hlinkClick/)
  assert.match(first, /wrap="none"/)
  assert.doesNotMatch(first, /<a:normAutofit|<p:pic>/)
  assert.match(second, /<a:tbl>/)
  assert.match(second, /<a:t>类别<\/a:t>/)
})

test('overflow and invalid versions preserve an existing successful artifact; repair succeeds', { skip: !available }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'markflow-compiler-'))
  try {
    const output = path.join(root, 'deck.pptx')
    const original = await compile(document, stage, options)
    await writeCompilation(original, output)
    const before = await readFile(output)
    const oversized = structuredClone(document)
    oversized.marks[1].content = { kind: 'paragraph', runs: [{ text: '这是长文本。'.repeat(1000) }] }
    await assert.rejects(async () => writeCompilation(await compile(oversized, stage, options), output), error => error instanceof CompilationError && error.diagnostics.some(item => item.code === 'LAYOUT_OVERFLOW' && item.markId === 'fact' && item.source?.pointer === '/marks/1'))
    await assert.rejects(async () => writeCompilation(await compile({ ...document, version: 9 }, stage, options), output), CompilationError)
    assert.deepEqual(await readFile(output), before)
    await writeCompilation(await compile(document, stage, options), output)
    assert.equal((await JSZip.loadAsync(await readFile(output))).file('ppt/slides/slide2.xml') !== null, true)
    await assert.rejects(() => writeCompilation(original, output, [output]), error => error instanceof CompilationError && error.diagnostics[0].code === 'OUTPUT_INPUT')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('CLI runs without model keys and produces structured errors without replacing prior output', { skip: !available }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'markflow-cli-'))
  try {
    const input = path.join(root, 'content.json'), presentation = path.join(root, 'stage.json'), output = path.join(root, 'deck.pptx')
    await writeFile(input, JSON.stringify(document)); await writeFile(presentation, JSON.stringify(stage))
    const args = ['--import', 'tsx', 'src/compiler/cli.ts', '--input', input, '--presentation', presentation, '--assets', root, '--output', output, '--font', `Microsoft YaHei=${font}`]
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/API.?KEY|TOKEN|SECRET/i.test(key)))
    const ok = spawnSync(process.execPath, args, { encoding: 'utf8', env })
    assert.equal(ok.status, 0, ok.stderr)
    assert.equal(JSON.parse(ok.stdout).manifest.target, 'pptx')
    const before = await readFile(output)
    await writeFile(input, '{broken')
    const failed = spawnSync(process.execPath, args, { encoding: 'utf8', env })
    assert.equal(failed.status, 1)
    assert.equal(JSON.parse(failed.stderr).diagnostics[0].code, 'JSON_SYNTAX')
    assert.deepEqual(await readFile(output), before)
    await writeFile(input, Buffer.concat([Buffer.from(JSON.stringify(document).slice(0, -1)), Buffer.from([0xC3, 0x28]), Buffer.from('}')]))
    const encoding = spawnSync(process.execPath, args, { encoding: 'utf8', env })
    assert.equal(encoding.status, 1)
    assert.equal(JSON.parse(encoding.stderr).diagnostics[0].code, 'INPUT_ENCODING')
    assert.deepEqual(await readFile(output), before)
  } finally { await rm(root, { recursive: true, force: true }) }
})
