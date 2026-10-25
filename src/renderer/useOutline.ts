import { useEffect, useRef, useState } from 'react'
import type { MarkdownMark } from '../shared/marks'

/** Parse the outline off the input thread, cancel obsolete work, reuse an idle worker. */
export function useOutline(content: string, key: string, enabled: boolean) {
  const worker = useRef<Worker | null>(null)
  const [result, setResult] = useState<{ key: string; content: string; blocks: MarkdownMark[]; error?: string }>({ key: '', content: '', blocks: [] })
  useEffect(() => {
    if (!enabled || !key) return
    let pending = true
    try {
      worker.current ??= new Worker(new URL('./outline.worker.ts', import.meta.url), { type: 'module' })
      const instance = worker.current
      instance.onmessage = (event: MessageEvent<{ blocks?: MarkdownMark[]; error?: string }>) => {
        pending = false
        setResult({ key, content, blocks: event.data.blocks ?? [], error: event.data.error })
      }
      instance.onerror = () => { pending = false; instance.terminate(); worker.current = null; setResult({ key, content, blocks: [], error: '大纲暂时不可用，正文仍可继续编辑。' }) }
      instance.postMessage(content)
    } catch { pending = false; setResult({ key, content, blocks: [], error: '大纲暂时不可用，正文仍可继续编辑。' }) }
    return () => { if (pending) { worker.current?.terminate(); worker.current = null } }
  }, [content, key, enabled])
  useEffect(() => () => { worker.current?.terminate(); worker.current = null }, [])
  return enabled && result.key === key ? result : { key, content: '', blocks: [] }
}
