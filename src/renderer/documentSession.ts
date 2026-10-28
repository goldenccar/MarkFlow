import type { ContentMode } from '../shared/types'
import { initializeMarkdownContent } from './documents/markdownContent'
import { initializeFormulaContent } from './documents/formulaSource'

export type DocumentContent = { content: string; cleanContent: string }

/** Prepare a newly opened version once; disk bytes remain the save/revision authority. */
export function initializeDocumentContent(source: string, diskSource: string, mode: ContentMode): DocumentContent {
  if (mode === 'markdown') return initializeMarkdownContent(source, diskSource)
  if (mode === 'latex-math') return initializeFormulaContent(source, diskSource)
  throw new Error(`不支持的文档类型：${mode}`)
}

export function isDocDirty(doc: DocumentContent | null): boolean {
  return !!doc && doc.content !== doc.cleanContent
}
