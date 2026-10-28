export interface ReadingHeadingOffset { id: string; top: number }
export interface ReadingHeadingViewport { anchor: number; maxScroll: number }

/** Offsets are measured once in document order; a scroll lookup is logarithmic. */
export function readingHeadingAt(offsets: readonly ReadingHeadingOffset[], scrollTop: number, viewport: ReadingHeadingViewport): string | undefined {
  if (!offsets.length) return undefined
  const scroll = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0)
  if (viewport.maxScroll > 0 && scroll >= viewport.maxScroll - 1) return offsets.at(-1)?.id
  const position = scroll + viewport.anchor
  let low = 0, high = offsets.length
  while (low < high) { const middle = (low + high) >>> 1; if (offsets[middle].top <= position) low = middle + 1; else high = middle }
  return low ? offsets[low - 1].id : undefined
}
