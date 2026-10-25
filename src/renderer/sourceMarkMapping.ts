import type { ChangeSet } from '@codemirror/state'
import { createMarkId } from '../engine/mark'
import { parseBlocks } from '../shared/blocks'
import { ensureMarkDocument, parseMarks, type MarkMapping } from '../shared/marks'

/** Exact source transactions retain surviving identities; new semantic ranges get new IDs. */
export function sourceMarkMappings(before: string, body: string, changes: ChangeSet): MarkMapping[] {
  const old = parseMarks(ensureMarkDocument(before)), next = parseBlocks(body)
  const assigned = new Map<number, MarkMapping>(), extra: typeof next = []
  const edits: Array<{ from: number; to: number; inserted: number }> = []
  changes.iterChanges((from, to, _nextFrom, _nextTo, insert) => edits.push({ from, to, inserted: insert.length }))
  const at = (position: number) => {
    let lo = 0, hi = next.length
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (next[mid].from <= position) lo = mid + 1; else hi = mid }
    const left = next[lo - 1]
    return left && position <= left.to ? left : undefined
  }
  let editIndex = 0
  for (const mark of old) {
    while (editIndex < edits.length && (edits[editIndex].to < mark.from || (mark.from < mark.to && edits[editIndex].to === mark.from))) editIndex++
    const edit = edits[editIndex], covering = edit && edit.from <= mark.from && edit.to >= mark.to && edit.to > edit.from ? edit : undefined
    if (covering && !covering.inserted) continue
    const anchor = changes.mapPos(mark.from, covering ? -1 : 1)
    let target = at(anchor)
    if (!target && mark.type === 'empty' && anchor <= body.length && !assigned.has(anchor)) {
      target = { ...mark, from: anchor, to: anchor, raw: '' }; extra.push(target)
    }
    if (target && !assigned.has(target.from)) assigned.set(target.from, { id: mark.id, from: target.from, to: target.to, type: target.type, style: mark.style })
  }
  return [...next, ...extra].sort((a, b) => a.from - b.from || a.to - b.to).map(mark => assigned.get(mark.from) ?? { id: createMarkId(), from: mark.from, to: mark.to, type: mark.type, style: {} })
}
