import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { getHeadings, type Heading } from './markdown'

const richHeadings = new WeakMap<ProseMirrorNode, number[]>()
const sourceHeadings = new Map<string, Heading[]>()
export function richHeadingPositions(doc: ProseMirrorNode): number[] {
  const cached = richHeadings.get(doc)
  if (cached) return cached
  const positions: number[] = []
  doc.descendants((node, position) => { if (node.type.name === 'heading') positions.push(position) })
  richHeadings.set(doc, positions)
  return positions
}
export function sourceHeadingList(body: string): Heading[] {
  const cached = sourceHeadings.get(body)
  if (cached) return cached
  const headings = getHeadings(body)
  if (sourceHeadings.size >= 3) sourceHeadings.delete(sourceHeadings.keys().next().value!)
  sourceHeadings.set(body, headings)
  return headings
}
function precedingIndex(values: number[], position: number): number | null {
  let low = 0, high = values.length
  while (low < high) { const middle = (low + high) >>> 1; if (values[middle] <= position) low = middle + 1; else high = middle }
  return low ? low - 1 : null
}
/** Headings nested in quotes/lists have their own selection positions, independent of root Marks. */
export function richHeadingIndex(doc: ProseMirrorNode, cursor: number): number | null {
  return precedingIndex(richHeadingPositions(doc), cursor)
}
export function sourceHeadingIndex(body: string, cursor: number): number | null {
  const line = body.slice(0, Math.max(0, Math.min(cursor, body.length))).split(/\r\n|\r|\n/).length
  return precedingIndex(sourceHeadingList(body).map(heading => heading.line), line)
}
