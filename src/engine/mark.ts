/** Format-neutral content contracts. Editing and identity transactions live in runtime.ts. */
export type MarkId = string
export type AssetId = string

/** Adapters may inject a factory for deterministic tests; production identities never encode positions. */
export const createMarkId = (): MarkId => (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID()

/** Font IDs, never executable CSS. Font size uses CSS px; page adapters convert px to pt explicitly. */
export interface MarkTypography { fontFamily?: string; fontSize?: number }
/** Undefined inherits; null deliberately clears a manual override. No storage or UI dependency. */
export function patchTypography<T extends MarkTypography>(current: T, patch: { fontFamily?: T['fontFamily'] | null; fontSize?: number | null } | null): T {
  const next = { ...current }
  for (const key of ['fontFamily', 'fontSize'] as const) {
    if (patch === null || patch[key] === null) delete next[key]
    else if (patch[key] !== undefined) Object.assign(next, { [key]: patch[key] })
  }
  return next
}
export interface InlineFormat {
  bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean
  script?: 'superscript' | 'subscript'; highlight?: string; link?: string
}
export interface TextRun { text: string; format?: InlineFormat }
/** Optional payload vocabulary for future adapters; runtime tree ownership is MarkNode.children. */
export type MarkContent =
  | { kind: 'text'; runs: TextRun[] }
  | { kind: 'image'; assetId: AssetId; alt: string }
  | { kind: 'math'; latex: string; display: boolean }
  | { kind: 'code'; text: string; language?: string }
  | { kind: 'table'; rows: MarkId[][] }
  | { kind: 'group' }
  | { kind: 'field'; field: 'pageNumber' | 'pageCount'; fallback: string }
  | { kind: 'opaque'; format: string; assetId: AssetId; label: string }

export interface MarkSource {
  documentId: string; revision: string; format: 'markdown' | 'docx' | 'pptx' | 'pdf'
  locator: { kind: 'text'; encoding: 'utf16'; from: number; to: number } | { kind: 'object'; objectId: string } | { kind: 'page'; page: number; boundsPt?: [number, number, number, number] }
}
export interface Asset {
  id: AssetId; mimeType: string; contentHash: string; relativePath: string
  width?: number; height?: number
}
