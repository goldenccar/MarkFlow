import { parseMarks, readMarkDocument } from '../shared/marks'
import { getHeadings } from './markdown'

self.onmessage = (event: MessageEvent<string>) => {
  try { self.postMessage({ blocks: parseMarks(event.data), headings: getHeadings(readMarkDocument(event.data).body) }) }
  catch { self.postMessage({ error: '大纲解析失败，正文仍可继续编辑。' }) }
}
