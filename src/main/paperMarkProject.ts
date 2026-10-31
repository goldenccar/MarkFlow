import { createHash } from 'node:crypto'
import path from 'node:path'
import type { PaperMarkRequest, PaperOrigin } from '../shared/paper'
import type { Diagnostic } from '../compiler/types'

export const paperOriginFile = 'markflow-origin.json'
export interface PaperOriginRecord extends PaperOrigin {
  format: 'markflow-paper-origin'; version: 1; hashes: Record<string, string>
}
export const paperHash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')

/** Loaded lazily: the normal editor and native TeX path do not load Office/compiler dependencies. */
export async function prepareMarkPaper(content: string, label: string, assetRoot: string | undefined, request: PaperMarkRequest): Promise<{ files: Record<string, string | Buffer>; diagnostics: Diagnostic[] }> {
  const { generatePaperSource, markdownToPaperDocument } = await import('../compiler/latex')
  const markdown = /\.json$/i.test(label) ? undefined : markdownToPaperDocument(content, label)
  const parsed = markdown ?? { document: JSON.parse(content) as unknown, diagnostics: [] as Diagnostic[] }
  if (markdown && assetRoot && path.isAbsolute(label)) {
    for (const asset of markdown.document.document.assets) asset.path = path.relative(assetRoot, path.resolve(path.dirname(label), asset.path)).replaceAll('\\', '/')
  }
  const output = generatePaperSource(parsed.document, {
    format: 'markflow-paper-presentation', version: 1, template: request.template,
    title: request.title, authors: request.author ? [request.author] : [], abstract: request.abstract ?? '',
    references: (request.references ?? []).map(reference => ({ ...reference, type: 'misc' as const })),
  })
  const files: Record<string, string | Buffer> = { ...output.files }
  if (output.assets.length) {
    if (!assetRoot) throw new Error('此文档包含本地图片，请先将文档保存到项目，或选择带有图片的本地资料文件。')
    const { resolveAssets } = await import('../compiler/resources')
    const assets = await resolveAssets(output.assets, assetRoot)
    for (const input of output.assets) files[input.targetPath] = Buffer.from(assets.get(input.id)!.data)
  }
  files['markflow-source.json'] = JSON.stringify({ format: 'markflow-paper-source', version: 1, label, content }, null, 2)
  const origin: PaperOriginRecord = {
    format: 'markflow-paper-origin', version: 1, label,
    documentId: output.sourceMap.documentId, revision: output.sourceMap.revision, marks: output.sourceMap.marks,
    hashes: Object.fromEntries(Object.entries(files).map(([file, bytes]) => [file, paperHash(bytes)])),
  }
  files[paperOriginFile] = JSON.stringify(origin, null, 2)
  return { files, diagnostics: [...parsed.diagnostics, ...output.diagnostics] }
}

/** Untrusted source bundles may contain a provenance file; validate before exposing navigation. */
export function readPaperOrigin(content: string): PaperOriginRecord {
  const value = JSON.parse(content) as PaperOriginRecord
  if (value?.format !== 'markflow-paper-origin' || value.version !== 1 || typeof value.label !== 'string' || value.label.length > 4096 || typeof value.documentId !== 'string' || !Number.isSafeInteger(value.revision) || value.revision < 0 || !value.hashes || Array.isArray(value.hashes) || !Array.isArray(value.marks) || value.marks.length > 10_000) throw new Error('Mark 来源记录无效。')
  if (Object.entries(value.hashes).some(([file, hash]) => !file || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) throw new Error('Mark 来源文件校验无效。')
  for (const mark of value.marks) {
    if (typeof mark.markId !== 'string' || !Object.hasOwn(value.hashes, mark.file) || !Number.isSafeInteger(mark.fromLine) || !Number.isSafeInteger(mark.toLine) || mark.fromLine < 1 || mark.toLine < mark.fromLine) throw new Error('Mark 来源位置无效。')
  }
  return value
}
