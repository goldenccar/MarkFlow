import { diffArrays } from 'diff'
import { markBody } from './marks'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function characters(text: string): string[] {
  return Array.from(segmenter.segment(text.replace(/\r\n?/g, '\n')), part => part.segment)
}

/** Strip equal edges, then use Myers diff: adjacent edits form one replacement; equal text ends it. */
export function changeCount(baseline: string, current: string, options?: { timeout: number }): number {
  baseline = markBody(baseline); current = markBody(current)
  if (baseline === current) return 0
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
