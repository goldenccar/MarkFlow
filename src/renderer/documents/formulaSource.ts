import type { DocumentContent } from './types'

const normalize = (source: string) => source.replace(/\r\n|\r/g, '\n')
/** Only actual preamble/document commands select the PDF renderer, not commented examples. */
export function isLatexDocument(source: string): boolean {
  return /^\s*\\(?:documentclass(?:\s*\[[^\]\r\n]*\])?\s*\{|begin\s*\{document\})/m.test(source)
}
export function initializeFormulaContent(source: string, diskSource: string): DocumentContent {
  return { content: normalize(source), cleanContent: normalize(diskSource) }
}

/** Read old mixed-mode documents without sending their registry to KaTeX. Never used in Formula's edit loop. */
export function toFormulaSource(source: string): string {
  const marker = '<!-- oops:marks ', start = source.lastIndexOf(marker)
  if (start < 0 || !/(?:\r?\n){2}$/.test(source.slice(0, start))) return source
  const footer = source.slice(start).trimEnd()
  if (!footer.endsWith(' -->')) return source
  try {
    const value: unknown = JSON.parse(footer.slice(marker.length, -4))
    if (!value || typeof value !== 'object') return source
    const metadata = value as Record<string, unknown>
    if (metadata.v !== 1 || !Array.isArray(metadata.marks) || typeof metadata.bodyHash !== 'string' || !/^\d+:[\da-f]+:[\da-f]+$/.test(metadata.bodyHash)) return source
    if (!metadata.marks.every(entry => entry && typeof entry === 'object' && typeof entry.id === 'string' && typeof entry.raw === 'string' && typeof entry.type === 'string' && Number.isSafeInteger(entry.from) && Number.isSafeInteger(entry.to))) return source
    const body = source.slice(0, start).replace(/(?:\r?\n){2}$/, '')
    let first = 2166136261, second = 5381
    for (let index = 0; index < body.length; index++) { const code = body.charCodeAt(index); first = Math.imul(first ^ code, 16777619); second = Math.imul(second, 33) ^ code }
    const fingerprint = `${body.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`
    return metadata.bodyHash === fingerprint ? body : source
  } catch { return source }
}
