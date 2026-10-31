import { diffArrays } from 'diff'
import { markBody } from './marks'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function characters(text: string): string[] {
  return Array.from(segmenter.segment(text), part => part.segment)
}

/** Strip equal edges, then use Myers diff: adjacent edits form one replacement; equal text ends it. */
export function changeCount(baseline: string, current: string, options?: { timeout: number }): number {
  baseline = markBody(baseline).replace(/\r\n?/g, '\n'); current = markBody(current).replace(/\r\n?/g, '\n')
  if (baseline === current) return 0
  // A newline is a grapheme boundary: unchanged whole lines need no segmentation.
  let prefix = 0, suffix = 0
  while (prefix < baseline.length && prefix < current.length && baseline[prefix] === current[prefix]) prefix++
  prefix = prefix ? baseline.lastIndexOf('\n', prefix - 1) + 1 : 0
  while (suffix < baseline.length - prefix && suffix < current.length - prefix && baseline[baseline.length - suffix - 1] === current[current.length - suffix - 1]) suffix++
  const boundary = baseline.indexOf('\n', baseline.length - suffix)
  suffix = boundary < 0 ? 0 : baseline.length - boundary
  baseline = baseline.slice(prefix, baseline.length - suffix); current = current.slice(prefix, current.length - suffix)
  const before = characters(baseline)
  const after = characters(current)
  let start = 0
  let beforeEnd = before.length
  let afterEnd = after.length
  while (start < beforeEnd && start < afterEnd && before[start] === after[start]) start++
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) { beforeEnd--; afterEnd-- }
  const removedText = before.slice(start, beforeEnd)
  const addedText = after.slice(start, afterEnd)
  if (!removedText.length || !addedText.length) return Math.max(removedText.length, addedText.length)
  // Entirely unrelated replacements have no equal run and need no quadratic diff.
  const alphabet = new Set(removedText)
  if (!addedText.some(character => alphabet.has(character))) return Math.max(removedText.length, addedText.length)
  const parts = options ? diffArrays(removedText, addedText, options) : diffArrays(removedText, addedText)
  if (!parts) throw new Error('改动计数超过处理时限，请手动保存。编辑内容和恢复草稿仍保留。')
  let total = 0
  let added = 0
  let removed = 0
  for (const part of parts) {
    if (part.added) added += part.value.length
    else if (part.removed) removed += part.value.length
    else {
      total += Math.max(added, removed)
      added = removed = 0
    }
  }
  return total + Math.max(added, removed)
}

export function shouldAutoCommit(count: number, threshold: number, composing: boolean, enabled: boolean): boolean {
  return enabled && !composing && Number.isInteger(threshold) && threshold > 0 && count >= threshold
}
