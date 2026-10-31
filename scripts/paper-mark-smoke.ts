import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { compile, applySemanticCommands, type MarkDocumentInput } from '../src/compiler/index.js'
import { generatePaperSource, markdownToPaperDocument, type PaperDocumentInput, type PaperPresentation } from '../src/compiler/latex.js'
import { resolveAssets, sha256 } from '../src/compiler/resources.js'
import { controlledTeXEnvironment, inspectPaperRuntime } from '../src/main/paperRuntime.js'

const execute = promisify(execFile)
await fs.mkdir('.test-data', { recursive: true })
const base = await fs.mkdtemp(path.resolve('.test-data/paper-mark-'))
const runtime = await inspectPaperRuntime()
assert.ok(runtime.available, runtime.message)
const original: MarkDocumentInput = JSON.parse(await fs.readFile('examples/compiler/content.json', 'utf8'))
const config: PaperPresentation = JSON.parse(await fs.readFile('examples/compiler/paper.json', 'utf8'))
const options = { assetRoot: path.resolve('examples/compiler'), fontFiles: { 'Microsoft YaHei': process.env.MARKFLOW_SMOKE_FONT ?? 'C:/Windows/Fonts/msyh.ttc' } }
const results: unknown[] = []

async function paper(input: MarkDocumentInput | PaperDocumentInput, settings: PaperPresentation, name: string) {
  const started = performance.now(), result = generatePaperSource(input, settings), directory = path.join(base, name)
  await fs.mkdir(path.join(directory, '.runtime'), { recursive: true })
  await fs.mkdir(path.join(directory, 'build'))
  for (const [file, content] of Object.entries(result.files)) await fs.writeFile(path.join(directory, file), content)
  const assets = await resolveAssets(result.assets, options.assetRoot)
  for (const asset of result.assets) { const file = path.join(directory, asset.targetPath); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, assets.get(asset.id)!.data) }
  const engine = runtime.engines.xelatex!.replaceAll('\\', '/')
  let log: string
  try {
    const output = await execute(runtime.latexmk, ['-norc', '-cd', '-pdfxe', `-xelatex="${engine}" -no-shell-escape -interaction=nonstopmode -halt-on-error -file-line-error -synctex=1 %O %S`, '-outdir=build', '-jobname=markflow', './main.tex'], { cwd: directory, env: controlledTeXEnvironment(runtime, directory), windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })
    log = output.stdout + output.stderr
  } catch (error) { const failure = error as Error & { stdout?: string; stderr?: string }; await fs.writeFile(path.join(directory, 'compile.log'), (failure.stdout ?? '') + (failure.stderr ?? '')); throw new Error(`${name} failed; inspect ${directory}/compile.log`, { cause: error }) }
  await fs.writeFile(path.join(directory, 'compile.log'), log)
  const finalLog = await fs.readFile(path.join(directory, 'build/markflow.log'), 'utf8')
  assert.ok(!/undefined references|Citation .* undefined|Missing character:/.test(finalLog), `${name} must resolve text, citations and cross-references.`)
  const loading = getDocument({ data: new Uint8Array(await fs.readFile(path.join(directory, 'build/markflow.pdf'))), useSystemFonts: false, cMapUrl: path.resolve('node_modules/pdfjs-dist/cmaps').replaceAll('\\', '/') + '/', cMapPacked: true, standardFontDataUrl: path.resolve('node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/' })
  let text = '', pages = 0
  try { const pdf = await loading.promise; pages = pdf.numPages; for (let page = 1; page <= pdf.numPages; page++) text += (await (await pdf.getPage(page)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join('') }
  finally { await loading.destroy() }
  results.push({ name, pages, markCount: result.sourceMap.marks.length, durationMs: Math.round(performance.now() - started), imageSha256: [...assets.values()].map(asset => asset.sha256) })
  return text.replace(/\s/g, '')
}

try {
  for (const count of [12, 18]) {
    const fact = original.marks.find(mark => mark.id === 'fact-coverage')!
    assert.equal(fact.content.kind, 'paragraph')
    const document = count === 12 ? original : applySemanticCommands(original, [{ type: 'edit', id: fact.id, content: { kind: 'paragraph', runs: fact.content.kind === 'paragraph' ? fact.content.runs.map(run => ({ ...run, text: run.text.replace('12', '18') })) : [] } }], original.revision)
    const text = await paper(document, config, `shared-${count}`)
    assert.ok(text.includes(`${count}个城市`), 'Generated PDF must contain the exact shared fact.')
    for (const [target, extension, pattern] of [['note', 'docx', /^word\/document.xml$/], ['stage', 'pptx', /^ppt\/slides\/slide\d+.xml$/]] as const) {
      const presentation = JSON.parse(await fs.readFile(`examples/compiler/${target}.json`, 'utf8'))
      const output = await compile(document, presentation, options), zip = await JSZip.loadAsync(output.bytes)
      const xml = (await Promise.all(zip.file(pattern).map(file => file.async('string')))).join('').replace(/<[^>]+>/g, '').replace(/\s/g, '')
      assert.ok(xml.includes(`${count}个城市`), `${extension} must contain the same updated shared fact.`)
      const imageHash = sha256(await fs.readFile('examples/compiler/assets/test-blocks.png'))
      const images = await Promise.all(zip.file(/^(?:word|ppt)\/media\/.*\.png$/).map(file => file.async('uint8array')))
      assert.ok(images.some(image => sha256(image) === imageHash), `${extension} must reuse the same image bytes.`)
      await fs.writeFile(path.join(base, `shared-${count}.${extension}`), output.bytes)
    }
  }
  const converted = markdownToPaperDocument('# Formula & citation\n\nA shared inline equation $x^2 + y^2 = z^2$ and a reference [@knuth1984].\n\n**bold** *italic* ~~strike~~ <u>underline</u> <sup>2</sup> <sub>n</sub> <mark>highlight</mark> [link](https://example.org/?a=1&b=2).\n\n$$\n\\begin{aligned} E &= mc^2 \\\\ F &= ma \\end{aligned}\n$$\n\n| A | B |\n| --- | --- |\n| one | **two** |', 'formula.md')
  const equation = converted.document.extensions.find(item => item.content.kind === 'equation')!
  converted.document.document.marks.push({ id: 'equation-ref', content: { kind: 'paragraph', runs: [{ text: 'Equation reference' }] } })
  converted.document.extensions.push({ markId: 'equation-ref', content: { kind: 'paragraph', runs: [{ text: 'Equation ' }, { kind: 'cross-reference', targetId: equation.markId }] } })
  for (const template of ['article', 'twocolumn'] as const) {
    const text = await paper(converted.document, { ...config, template, title: 'Formula & 100% {safe}', authors: ['A_B'], abstract: 'Plain text: $100; #1; \\input{nothing}.' }, `math-${template}`)
    assert.ok(text.includes('Knuth'), 'BibTeX must produce the cited bibliography.')
    assert.ok(text.includes('Equation1'), 'Cross-reference must resolve to the actual equation number.')
    assert.ok(text.includes('100%{safe}'), 'Escaped metadata must appear as literal visible text.')
  }
  await fs.writeFile(path.join(base, 'results.json'), JSON.stringify({ runtime: runtime.version, results, sameFactsAndImageInDocxPptxPdf: true }, null, 2))
  console.log(JSON.stringify({ base, results, sameFactsAndImageInDocxPptxPdf: true }, null, 2))
} catch (error) { console.error(`Artifacts retained at ${base}`); throw error }
