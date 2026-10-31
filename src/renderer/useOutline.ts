import { useEffect, useRef, useState } from 'react'
import type { MarkdownMark } from '../shared/marks'
import type { Heading } from './markdown'

interface Outline { key: string; content: string; blocks: MarkdownMark[]; headings: Heading[]; error?: string }
const emptyOutline: Outline = { key: '', content: '', blocks: [], headings: [] }

/** Parse the outline off the input thread, cancel obsolete work, reuse an idle worker. */
export function useOutline(content: string, key: string, enabled: boolean) {
  const worker = useRef<Worker | null>(null)
  const [result, setResult] = useState<Outline>(emptyOutline)
  useEffect(() => {
    if (!enabled || !key) return
    let pending = true
    try {
      worker.current ??= new Worker(new URL('./outline.worker.ts', import.meta.url), { type: 'module' })
      const instance = worker.current
      instance.onmessage = (event: MessageEvent<Pick<Partial<Outline>, 'blocks' | 'headings' | 'error'>>) => {
        pending = false
        setResult({ key, content, blocks: event.data.blocks ?? [], headings: event.data.headings ?? [], error: event.data.error })
      }
      instance.onerror = () => { pending = false; instance.terminate(); worker.current = null; setResult({ ...emptyOutline, key, content, error: '大纲暂时不可用，正文仍可继续编辑。' }) }
      instance.postMessage(content)
    } catch { pending = false; setResult({ ...emptyOutline, key, content, error: '大纲暂时不可用，正文仍可继续编辑。' }) }
    return () => { if (pending) { worker.current?.terminate(); worker.current = null } }
  }, [content, key, enabled])
  useEffect(() => () => { worker.current?.terminate(); worker.current = null }, [])
  return enabled && result.key === key ? result : emptyOutline
}
