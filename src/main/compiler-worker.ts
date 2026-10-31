/// <reference types="electron-vite/node" />
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import sampleDocument from '../../examples/compiler/content.json'
import sampleNote from '../../examples/compiler/note.json'
import sampleStage from '../../examples/compiler/stage.json'
import { compile, CompilationError, failCompilation, markdownToDocument, normalizeDocument } from '../compiler/index.js'
import type { Diagnostic, MarkDocumentInput, Presentation, SemanticContent, StagePresentation } from '../compiler/types'
import type { CompilerJob, CompilerWorkerReply } from './compilerService.js'
import type { CompilerTarget } from '../shared/compilerUi'

/** Every input Mark is selected; only neutral titles are added when the source has no heading. */
export function automaticPresentation(input: MarkDocumentInput, target: CompilerTarget): { document: MarkDocumentInput; presentation: Presentation } {
  const document = structuredClone(input)
  if (!document.marks.length) failCompilation('EMPTY_DOCUMENT', 'The document has no exportable content.')
  if (target === 'docx') return { document, presentation: { format: 'markflow-presentation', version: 1, target, theme: 'standard-v1', sections: [{ marks: document.marks.map(mark => mark.id) }] } }
  const nodes = new Map(document.marks.map(mark => [mark.id, mark]))
  const used = new Set([...nodes.keys(), ...(document.retiredIds ?? []), ...(document.consumedSources ?? []).map(item => item.id)])
  const kind = (content: SemanticContent): SemanticContent['kind'] => { while (content.kind === 'reference') content = nodes.get(content.targetId)!.content; return content.kind }
  const slides: StagePresentation['slides'] = []
  let title = '', current: StagePresentation['slides'][number] | undefined
  for (const mark of input.marks) {
    const type = kind(mark.content)
    if (type === 'heading') { title = mark.id; current = { layout: 'body', title, marks: [] }; slides.push(current); continue }
    if (!title) {
      let count = 1; while (used.has(`compiler-title-${count}`)) count++
      title = `compiler-title-${count}`; used.add(title)
      document.marks.push({ id: title, content: { kind: 'heading', level: 1, runs: [{ text: '导出文档' }] } })
    }
    const layout = type === 'image' || type === 'table' ? type : 'body'
    if (!current || current.marks.length > 0 && (current.layout !== layout || layout !== 'body' || current.marks.length >= 3)) { current = { layout, title, marks: [] }; slides.push(current) }
    current.layout = layout; current.marks.push(mark.id)
  }
  return { document, presentation: { format: 'markflow-presentation', version: 1, target, theme: 'standard-v1', slides } }
}

async function granted(file: string, directory = false): Promise<string> {
  const actual = await realpath(file), info = await stat(actual)
  if (path.relative(file, actual) !== '' || (directory ? !info.isDirectory() : !info.isFile())) failCompilation('GRANT_CHANGED', 'The selected path changed; choose it again.', { source: { file } })
  return actual
}
async function sourceText(file: string): Promise<string> {
  await granted(file)
  const info = await stat(file)
  if (info.size > 8 * 1024 * 1024) failCompilation('INPUT_LIMIT', 'Source and presentation must be at most 8 MiB.', { source: { file } })
  const bytes = await readFile(file)
  if (bytes.length > 8 * 1024 * 1024) failCompilation('INPUT_LIMIT', 'Source changed beyond the 8 MiB limit.', { source: { file } })
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { return failCompilation('INPUT_ENCODING', 'Input must be valid UTF-8.', { source: { file } }) }
}
function json(text: string, file: string): unknown {
  try { return JSON.parse(text.replace(/^\uFEFF/, '')) }
  catch { return failCompilation('JSON_SYNTAX', 'Invalid JSON syntax.', { source: { file } }) }
}

/** Input/resource parsing and Office generation stay off the Electron main thread. No output is written here. */
export async function runCompilerJob(job: CompilerJob, sampleAssetForTest?: string): Promise<CompilerWorkerReply> {
  try {
    let input: MarkDocumentInput, assetRoot = job.assetRoot
    let diagnostics: Diagnostic[] = []
    const protectedInputs: string[] = []
    if (assetRoot) await granted(assetRoot, true)
    if (job.source.kind === 'sample') {
      input = structuredClone(sampleDocument) as MarkDocumentInput
      if (!assetRoot) {
        const sampleAsset = sampleAssetForTest ?? (await import('../../examples/compiler/assets/test-blocks.png?asset')).default
        assetRoot = path.dirname(sampleAsset)
        input.assets[0].path = path.basename(sampleAsset)
      }
    } else {
      const sourcePath = job.source.kind === 'file' ? job.source.path : job.source.sourcePath
      const text = job.source.kind === 'file' ? await sourceText(sourcePath) : job.source.content
      if (path.isAbsolute(sourcePath)) protectedInputs.push(sourcePath)
      if (job.source.kind === 'file' && path.extname(sourcePath).toLowerCase() === '.json') input = json(text, sourcePath) as MarkDocumentInput
      else {
        const adapted = markdownToDocument(text, sourcePath)
        input = adapted.document; diagnostics = adapted.diagnostics
        if (assetRoot && path.isAbsolute(sourcePath)) for (const asset of input.assets) asset.path = path.relative(assetRoot, path.resolve(path.dirname(sourcePath), asset.path)).replaceAll('\\', '/')
      }
    }
    normalizeDocument(input)
    if (!assetRoot && input.assets.length) failCompilation('ASSET_ROOT_REQUIRED', 'Select the resource folder before exporting images.', { field: 'assets', suggestion: 'Choose the folder containing the referenced local images.' })
    // With no assets this directory is only checked for existence; it grants no file reads.
    assetRoot ??= os.tmpdir()
    for (const file of Object.values(job.fontFiles)) {
      try { await granted(file) } catch { failCompilation('FONT_MISSING', 'The selected font is missing or changed; choose its file again.', { source: { file } }) }
      protectedInputs.push(file)
    }
    let presentation: unknown
    if (job.presentationPath) {
      presentation = json(await sourceText(job.presentationPath), job.presentationPath)
      protectedInputs.push(job.presentationPath)
      if (!presentation || typeof presentation !== 'object' || !('target' in presentation) || presentation.target !== job.target) failCompilation('PRESENTATION_TARGET', 'The selected presentation target does not match the chosen output format.', { source: { file: job.presentationPath } })
    } else if (job.source.kind === 'sample') presentation = job.target === 'docx' ? sampleNote : sampleStage
    else {
      const automatic = automaticPresentation(input, job.target)
      input = automatic.document; presentation = automatic.presentation
    }
    protectedInputs.push(...input.assets.map(asset => path.resolve(assetRoot!, asset.path)))
    return { ok: true, result: await compile(input, presentation, { assetRoot, fontFiles: job.fontFiles }, diagnostics), protectedInputs }
  } catch (error) {
    return { ok: false, diagnostics: error instanceof CompilationError ? error.diagnostics : [{ code: 'COMPILER_IO', severity: 'error', message: error instanceof Error ? error.message : String(error) }] }
  }
}

if (!isMainThread) {
  void runCompilerJob(workerData as CompilerJob).then(reply => { parentPort!.postMessage(reply); parentPort!.close() })
}
