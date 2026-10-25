import { ensureMarkDocument } from '../shared/marks'
import type { ContentMode } from '../shared/types'

export type DocumentContent = { content: string; cleanContent: string }

/** Prepare a newly opened version once; disk bytes remain the save/revision authority. */
export function initializeDocumentContent(source: string, diskSource: string, mode: ContentMode): DocumentContent {
  const raw = source.replace(/\r\n|\r/g, '\n')
  const disk = diskSource.replace(/\r\n|\r/g, '\n')
  const content = mode === 'markdown' ? ensureMarkDocument(raw) : raw
  return { content, cleanContent: raw === disk ? content : disk }
}

export function isDocDirty(doc: DocumentContent | null): boolean {
  return !!doc && doc.content !== doc.cleanContent
}
