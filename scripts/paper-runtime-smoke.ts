import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PaperService } from '../src/main/paperService'
import { inspectPaperRuntime, controlledTeXEnvironment } from '../src/main/paperRuntime'

const { values } = parseArgs({ options: { runtime: { type: 'string' }, 'evidence-dir': { type: 'string' } } })
const evidence = path.resolve(values['evidence-dir'] ?? '.test-data')
await fs.mkdir(evidence, { recursive: true })
const base = await fs.mkdtemp(path.join(evidence, 'paper-native-'))
const projects = path.join(base, 'projects'), exports = path.join(base, 'exports')
await fs.mkdir(projects); await fs.mkdir(exports)
const runtime = await inspectPaperRuntime({ root: values.runtime })
assert.ok(runtime.available, runtime.message)
const outputs: string[] = []
const files: string[] = []
const service = new PaperService({
  userData: path.join(base, 'profile'), chooseDirectory: async () => projects, chooseFile: async () => files.shift() ?? null,
  chooseOutput: async () => outputs.shift() ?? null, runtime: async () => runtime, environment: controlledTeXEnvironment,
})
const results: unknown[] = []
async function pdfText(pdf: Uint8Array) {
  assert.equal(Buffer.from(pdf.subarray(0, 5)).toString(), '%PDF-')
  const loading = getDocument({ data: pdf, useSystemFonts: false, cMapUrl: path.resolve('node_modules/pdfjs-dist/cmaps').replaceAll('\\', '/') + '/', cMapPacked: true, standardFontDataUrl: path.resolve('node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/' })
  try {
    const document = await loading.promise
    assert.ok(document.numPages >= 1)
    let text = ''
    for (let n = 1; n <= document.numPages; n++) text += (await (await document.getPage(n)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ')
    return text
  } finally { await loading.destroy() }
}
try {
  for (const template of ['chinese', 'article', 'twocolumn'] as const) {
    const project = await service.create({ template, name: template, title: template === 'chinese' ? '本地论文工作区验证' : 'Local paper workspace validation', author: 'MarkFlow' })
    assert.ok(project)
    const section = await service.read(project.id, 'sections/introduction.tex')
    const unsaved = { ...section, content: section.content + '\nUnsaved source snapshot.\n' }
    const result = await service.build({ projectId: project.id, mainFile: 'main.tex', engine: project.engine, buffers: [unsaved], revision: 1 })
    await fs.writeFile(path.join(base, `${template}.log`), result.log)
    results.push({ template, engine: project.engine, status: result.status, durationMs: result.durationMs, diagnostics: result.diagnostics })
    assert.equal(result.status, 'success', JSON.stringify(result.diagnostics))
    assert.ok(result.artifactId)
    const text = await pdfText(await service.pdf(project.id, result.artifactId))
    assert.ok(text.includes('Unsaved source snapshot.'), 'The PDF must include the unsaved section snapshot.')
    assert.ok(text.includes('Knuth'), 'The actual bibliography must be resolved.')
    if (template === 'chinese') assert.ok(text.includes('本地论文工作区验证'), 'Bundled CMaps must preserve Chinese text.')
    assert.equal((await service.read(project.id, section.path)).content, section.content)
    outputs.push(path.join(exports, `${template}.pdf`), path.join(exports, `${template}.zip`))
    await service.export(project.id, result.artifactId, 'pdf')
    await service.export(project.id, result.artifactId, 'source')
    // A failed source revision must not discard a valid preview or write unsaved buffers.
    const main = await service.read(project.id, 'main.tex')
    const broken = { ...main, content: main.content.replace('\\begin{document}', '\\begin{document}\n\\undefinedMarkFlowCommand') }
    const failure = await service.build({ projectId: project.id, mainFile: 'main.tex', engine: project.engine, buffers: [broken], revision: 2 })
    assert.equal(failure.status, 'error')
    assert.ok((await service.pdf(project.id, result.artifactId)).length)
    assert.equal((await service.read(project.id, 'main.tex')).content, main.content)
    await service.release(project.id)
    files.push(path.join(exports, `${template}.zip`))
    const imported = await service.open('zip')
    assert.ok(imported)
    assert.equal(imported.trusted, false)
    assert.equal(imported.engine, project.engine)
    assert.equal(imported.mainFile, 'main.tex')
    await service.trust(imported.id)
    const rebuilt = await service.build({ projectId: imported.id, mainFile: imported.mainFile!, engine: imported.engine, buffers: [], revision: 3 })
    await fs.writeFile(path.join(base, `${template}-roundtrip.log`), rebuilt.log)
    assert.equal(rebuilt.status, 'success', JSON.stringify(rebuilt.diagnostics))
    results.push({ template: `${template}-source-roundtrip`, engine: imported.engine, status: rebuilt.status, durationMs: rebuilt.durationMs, diagnostics: rebuilt.diagnostics })
    await service.release(imported.id)
  }
  const nested = await service.create({ template: 'article', name: 'nested-biber', title: 'Nested Biber verification', author: 'MarkFlow' })
  assert.ok(nested)
  await service.addFile(nested.id, 'chapters/paper.tex')
  const nestedMain = await service.read(nested.id, 'chapters/paper.tex')
  const nestedSource = String.raw`\documentclass{article}
\usepackage[backend=biber]{biblatex}\addbibresource{../references.bib}
\begin{document}\section{Nested project}A resolved reference \cite{knuth1984}.\printbibliography\end{document}`
  const nestedResult = await service.build({ projectId: nested.id, mainFile: nestedMain.path, engine: 'pdflatex', buffers: [{ ...nestedMain, content: nestedSource }], revision: 4 })
  await fs.writeFile(path.join(base, 'nested-biber.log'), nestedResult.log)
  results.push({ template: 'nested-biber', engine: 'pdflatex', status: nestedResult.status, durationMs: nestedResult.durationMs, diagnostics: nestedResult.diagnostics })
  assert.equal(nestedResult.status, 'success', JSON.stringify(nestedResult.diagnostics))
  assert.ok(nestedResult.artifactId)
  assert.ok((await pdfText(await service.pdf(nested.id, nestedResult.artifactId))).includes('Knuth'), 'Biber must produce the actual bibliography in the PDF.')
  outputs.push(path.join(exports, 'nested-biber.pdf'))
  await service.export(nested.id, nestedResult.artifactId, 'pdf')
  await service.release(nested.id)
} finally {
  service.dispose()
  await fs.writeFile(path.join(base, 'results.json'), JSON.stringify({ platform: process.platform, architecture: process.arch, runtime, results }, null, 2))
  console.log(JSON.stringify({ base, results }, null, 2))
}
