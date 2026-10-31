import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { compile, CompilationError, failCompilation, markdownToDocument, writeCompilation } from './index.js'
import type { Diagnostic, MarkDocumentInput } from './types.js'

const help = `MarkFlow offline compiler
  npm run compile -- --input content.json --presentation stage.json --output deck.pptx
    --assets <resource root> --font "Microsoft YaHei=C:/Windows/Fonts/msyh.ttc"
  Repeat --font for other explicit families. Input: .json or supported .md subset.
  Output directory must exist. Success: JSON manifest on stdout. Failure: JSON diagnostics on stderr, exit 1.
  No API key, network service or desktop app is used. Fonts are measured, not embedded.`

async function readSource(file: string): Promise<string> {
  const info = await stat(file)
  if (!info.isFile() || info.size > 8 * 1024 * 1024) failCompilation('INPUT_LIMIT', 'Source and presentation must be files no larger than 8 MiB.', { source: { file } })
  const bytes = await readFile(file)
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { return failCompilation('INPUT_ENCODING', 'Input must be valid UTF-8; no replacement characters were inserted.', { source: { file } }) }
}
function json(text: string, file: string): unknown {
  try { return JSON.parse(text.replace(/^\uFEFF/, '')) } catch { return failCompilation('JSON_SYNTAX', 'Invalid JSON syntax.', { source: { file } }) }
}
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 0 || args.includes('--help')) { process.stdout.write(`${help}\n`); return }
  const values: Record<string, string> = {}, fontFiles: Record<string, string> = Object.create(null)
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1]
    if (!['--input', '--presentation', '--output', '--assets', '--font'].includes(key) || !value || value.startsWith('--')) failCompilation('CLI_ARGUMENT', `Invalid or incomplete argument ${key}.`)
    if (key === '--font') {
      const separator = value.indexOf('=')
      if (separator < 1 || separator === value.length - 1) failCompilation('CLI_FONT', 'Font argument must be Family=local-file.')
      const family = value.slice(0, separator)
      if (Object.hasOwn(fontFiles, family)) failCompilation('CLI_FONT', `Duplicate font family ${family}.`)
      fontFiles[family] = path.resolve(value.slice(separator + 1))
    } else {
      if (values[key]) failCompilation('CLI_ARGUMENT', `Duplicate argument ${key}.`)
      values[key] = path.resolve(value)
    }
  }
  for (const key of ['--input', '--presentation', '--output', '--assets']) if (!values[key]) failCompilation('CLI_ARGUMENT', `Missing ${key}.`)
  const sourcePath = values['--input'], presentationPath = values['--presentation']
  const source = await readSource(sourcePath)
  let input: unknown, diagnostics: Diagnostic[] = []
  if (path.extname(sourcePath).toLowerCase() === '.md') {
    const adapted = markdownToDocument(source, sourcePath)
    input = adapted.document; diagnostics = adapted.diagnostics
    // Markdown paths are source-relative; JSON paths are relative to --assets.
    for (const asset of (input as MarkDocumentInput).assets) asset.path = path.relative(values['--assets'], path.resolve(path.dirname(sourcePath), asset.path)).replaceAll('\\', '/')
  } else if (path.extname(sourcePath).toLowerCase() === '.json') input = json(source, sourcePath)
  else failCompilation('INPUT_FORMAT', 'Input must be .json or .md.')
  const presentation = json(await readSource(presentationPath), presentationPath)
  const result = await compile(input, presentation, { assetRoot: values['--assets'], fontFiles }, diagnostics)
  const protectedInputs = [sourcePath, presentationPath, ...Object.values(fontFiles), ...(input as MarkDocumentInput).assets.map(asset => path.resolve(values['--assets'], asset.path))]
  await writeCompilation(result, values['--output'], protectedInputs)
  process.stdout.write(`${JSON.stringify({ output: values['--output'], manifest: result.manifest }, null, 2)}\n`)
}

main().catch(error => {
  const diagnostics = error instanceof CompilationError ? error.diagnostics : [{ code: 'CLI_IO', severity: 'error', message: error instanceof Error ? error.message : String(error) }]
  process.stderr.write(`${JSON.stringify({ diagnostics }, null, 2)}\n`)
  process.exitCode = 1
})
