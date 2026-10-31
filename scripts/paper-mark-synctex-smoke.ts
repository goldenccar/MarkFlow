import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import { controlledTeXEnvironment, inspectPaperRuntime } from '../src/main/paperRuntime.js'
import type { PaperSourceMap } from '../src/compiler/latexTypes.js'

// Reuse an actual native-smoke output; no generated source or PDF is modified or recompiled.
const project = path.resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw new Error('Usage: tsx scripts/paper-mark-synctex-smoke.ts <native-smoke-project>')
const map: PaperSourceMap = JSON.parse(await fs.readFile(path.join(project, 'markflow-source-map.json'), 'utf8'))
const pdf = path.join(project, 'build/markflow.pdf'), runtime = await inspectPaperRuntime()
assert.ok(runtime.available && runtime.synctex, 'A verified local SyncTeX executable is required.')
assert.equal((await fs.readFile(pdf)).subarray(0, 5).toString(), '%PDF-')
await fs.access(path.join(project, 'build/markflow.synctex.gz'))
const run = promisify(execFile), results: unknown[] = []
function fields(output: string): Record<string, string> {
  const block = output.split('SyncTeX result begin')[1]?.split('SyncTeX result end')[0]
  assert.ok(block, 'SyncTeX must return an actual location.')
  const result: Record<string, string> = {}
  for (const line of block.split(/\r?\n/)) { const colon = line.indexOf(':'); if (colon > 0 && !Object.hasOwn(result, line.slice(0, colon))) result[line.slice(0, colon)] = line.slice(colon + 1).trim() }
  return result
}
for (const markId of ['fact-coverage', 'report-context', 'image-context']) {
  const mark = map.marks.find(item => item.markId === markId)
  assert.ok(mark, `${markId} must exist in the emitted source map.`)
  const file = path.resolve(project, mark.file), lines = (await fs.readFile(file, 'utf8')).split('\n')
  const line = Array.from({ length: mark.toLine - mark.fromLine + 1 }, (_, index) => mark.fromLine + index).find(number => lines[number - 1].endsWith('\\par'))
  assert.ok(line, 'The chosen source line must render the mapped paragraph.')
  const forward = await run(runtime.synctex!, ['view', '-i', `${line}:1:${file}`, '-o', pdf], { cwd: project, env: controlledTeXEnvironment(runtime, project), windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 })
  const view = fields(forward.stdout), page = Number(view.Page), x = Number(view.x), y = Number(view.y)
  assert.ok(Number.isInteger(page) && page >= 1 && Number.isFinite(x) && Number.isFinite(y))
  const reverse = await run(runtime.synctex!, ['edit', '-o', `${page}:${x}:${y}:${pdf}`], { cwd: project, env: controlledTeXEnvironment(runtime, project), windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 })
  const edit = fields(reverse.stdout), returnedFile = path.resolve(project, edit.Input), returnedLine = Number(edit.Line)
  const returnedMark = map.marks.find(item => path.resolve(project, item.file) === returnedFile && returnedLine >= item.fromLine && returnedLine <= item.toLine)
  assert.ok(returnedMark, 'The PDF position must resolve into an existing generated Mark range.')
  assert.equal(returnedMark.markId, markId, 'Round-trip must return to the same stable Mark, not just another nearby paragraph.')
  results.push({ markId, source: mark.source, sourceMapRange: [mark.fromLine, mark.toLine], texLine: line, pdf: { page, x, y }, reverse: { file: path.relative(project, returnedFile), line: returnedLine, markId: returnedMark.markId }, forwardOutput: forward.stdout, reverseOutput: reverse.stdout })
}
const report = { project, runtime: runtime.version, documentId: map.documentId, revision: map.revision, realSyncTeX: true, sameMarkRoundTrips: results.length, results }
await fs.writeFile(path.join(project, 'mark-synctex-proof.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
