import { ensureMarkDocument } from '../../shared/marks'
import type { DocumentContent } from './types'

export function initializeMarkdownContent(source: string, diskSource: string): DocumentContent {
  const raw = source.replace(/\r\n|\r/g, '\n'), disk = diskSource.replace(/\r\n|\r/g, '\n')
  const content = ensureMarkDocument(raw)
  return { content, cleanContent: raw === disk ? content : disk }
}
