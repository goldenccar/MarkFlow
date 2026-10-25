// Reuse completed workers; cancel unfinished comparisons so stale diffs never queue.
let idleWorker: Worker | undefined
export function countChanges(baseline: string, current: string, onResult: (count: number) => void, onError: (message: string) => void): () => void {
  if (baseline === current) { onResult(0); return () => {} }
  let worker: Worker
  try { worker = idleWorker ?? new Worker(new URL('./changes.worker.ts', import.meta.url), { type: 'module' }); idleWorker = undefined }
  catch { onError('无法启动改动计数，请手动保存。编辑内容仍保留。'); return () => {} }
  let complete = false
  const timer = setTimeout(() => {
    complete = true
    worker.terminate()
    onError('改动计数超过处理时限，请手动保存。编辑内容和恢复草稿仍保留。')
  }, 7000)
  worker.onmessage = (event: MessageEvent<{ count?: number; error?: string }>) => {
    clearTimeout(timer); complete = true
    idleWorker?.terminate(); idleWorker = worker
    worker.onmessage = null; worker.onerror = null
    if (typeof event.data.count === 'number') onResult(event.data.count)
    else onError(event.data.error ?? '改动计数失败，请手动保存。')
  }
  worker.onerror = () => { complete = true; clearTimeout(timer); worker.terminate(); onError('改动计数失败，请手动保存。编辑内容仍保留。') }
  worker.postMessage({ baseline, current })
  return () => { if (!complete) { complete = true; clearTimeout(timer); worker.terminate() } }
}
