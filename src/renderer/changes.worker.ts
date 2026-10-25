import { changeCount } from '../shared/changes'

self.onmessage = (event: MessageEvent<{ baseline: string; current: string }>) => {
  try {
    self.postMessage({ count: changeCount(event.data.baseline, event.data.current, { timeout: 5000 }) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
