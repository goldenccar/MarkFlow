import { parseMarks } from '../shared/marks'

self.onmessage = (event: MessageEvent<string>) => {
  try { self.postMessage({ blocks: parseMarks(event.data) }) }
  catch { self.postMessage({ error: '大纲解析失败，正文仍可继续编辑。' }) }
}
