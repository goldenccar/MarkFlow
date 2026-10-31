import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile, applySemanticCommands, CompilationError, writeCompilation, type MarkDocumentInput } from '../src/compiler/index.js'
import { sha256 } from '../src/compiler/resources.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const font = args[args.indexOf('--font') + 1]
if (!args.includes('--font') || !font) throw new Error('Usage: npm run compiler:demo -- --font C:/Windows/Fonts/msyh.ttc [--out directory]')
const output = args.includes('--out') ? path.resolve(args[args.indexOf('--out') + 1]) : path.join(root, 'examples/compiler/generated')
await mkdir(output, { recursive: true })
const source = path.join(root, 'examples/compiler/content.json')
const document: MarkDocumentInput = JSON.parse(await readFile(source, 'utf8'))
const note = JSON.parse(await readFile(path.join(root, 'examples/compiler/note.json'), 'utf8'))
const stage = JSON.parse(await readFile(path.join(root, 'examples/compiler/stage.json'), 'utf8'))
const options = { assetRoot: path.join(root, 'examples/compiler'), fontFiles: { 'Microsoft YaHei': path.resolve(font) } }
const records: Record<string, unknown> = {}
async function generate(input: MarkDocumentInput, presentation: unknown, filename: string): Promise<void> {
  const result = await compile(input, presentation, options)
  await writeCompilation(result, path.join(output, filename), [source, font])
  records[filename] = result.manifest
}
await generate(document, note, 'report.docx')
await generate(document, stage, 'deck.pptx')
const fact = document.marks.find(mark => mark.id === 'fact-coverage')!
if (fact.content.kind !== 'paragraph') throw new Error('Sample fact must be a paragraph.')
const changed = applySemanticCommands(document, [{ type: 'edit', id: fact.id, content: { ...fact.content, runs: fact.content.runs.map(run => ({ ...run, text: run.text.replace('12', '18') })) } }], document.revision)
await writeFile(path.join(output, 'updated-content.json'), JSON.stringify(changed, null, 2))
await generate(changed, note, 'updated-report.docx')
await generate(changed, stage, 'updated-deck.pptx')
const overflow = applySemanticCommands(document, [{ type: 'edit', id: fact.id, content: { kind: 'paragraph', runs: [{ text: '故意超出页面容量的中文文本。'.repeat(300) }] } }], document.revision)
const before = sha256(await readFile(path.join(output, 'deck.pptx')))
let blocked = false
try { await generate(overflow, stage, 'deck.pptx') } catch (error) {
  if (!(error instanceof CompilationError) || !error.diagnostics.some(item => item.code === 'LAYOUT_OVERFLOW' && item.markId === fact.id)) throw error
  blocked = true; records.overflow = error.diagnostics
}
if (!blocked || sha256(await readFile(path.join(output, 'deck.pptx'))) !== before) throw new Error('Overflow protection failed.')
// The unchanged valid sample is the explicit repair: it must compile again after the failure.
await generate(document, stage, 'repaired-deck.pptx')
const longTable = structuredClone(document)
const table = longTable.marks.find(mark => mark.id === 'status-table')!
if (table.content.kind !== 'table') throw new Error('Sample table is missing.')
table.content.rows = [table.content.rows[0], ...Array.from({ length: 60 }, (_, i) => [[{ text: `检查行 ${i + 1}` }], [{ text: '中文长表格跨页验证' }], [{ text: '待检查' }]])]
await generate(longTable, { ...note, sections: [{ marks: ['report-title', 'status-table'] }] }, 'long-table.docx')
await writeFile(path.join(output, 'demonstration.json'), JSON.stringify({ source, blocked, previousArtifactPreserved: true, records }, null, 2))
process.stdout.write(`${JSON.stringify({ output, files: Object.keys(records), overflowBlocked: blocked, previousArtifactPreserved: true }, null, 2)}\n`)
