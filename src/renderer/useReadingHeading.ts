import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Layout } from '../shared/types'
import type { NavigationHeading } from './documentNavigationModel'
import { readingHeadingAt, type ReadingHeadingOffset, type ReadingHeadingViewport } from './readingHeadingModel'

export interface ReadingHeadingOptions {
  scopeRef: RefObject<HTMLElement | null>
  documentKey: string
  headings: readonly NavigationHeading[]
  layout: Layout
  caretHeadingId?: string
}
interface ReadingSelection { key: string; layout: Layout; caretId?: string; id?: string }
const headingSelector = 'h1, h2, h3, h4, h5, h6'

/** Reading scroll temporarily owns navigation; editing selection returns ownership to the caret. */
export function useReadingHeading({ scopeRef, documentKey, headings, layout, caretHeadingId }: ReadingHeadingOptions): string | undefined {
  const [reading, setReading] = useState<ReadingSelection | null>(null)
  const readingRef = useRef<ReadingSelection | null>(null), caret = useRef(caretHeadingId)
  caret.current = caretHeadingId
  useEffect(() => { readingRef.current = null; setReading(null) }, [documentKey, layout, caretHeadingId])
  useEffect(() => {
    const scope = scopeRef.current
    if (!scope || !documentKey || layout === 'source' || !headings.length) return
    const scrollSelector = layout === 'split' ? '.preview-pane' : '.rich-editor'
    const contentSelector = layout === 'split' ? '.document-preview' : '.tiptap'
    let scroller: HTMLElement | null = null, content: HTMLElement | null = null
    let offsets: ReadingHeadingOffset[] = [], viewport: ReadingHeadingViewport = { anchor: 32, maxScroll: 0 }
    let measureFrame = 0, scrollFrame = 0, timer: ReturnType<typeof setTimeout> | undefined, disposed = false
    let paused = scope.closest<HTMLElement>('.app')?.dataset.layoutAnimating === 'true'
    let lastScrollTop = 0
    const ownsReading = () => readingRef.current?.key === documentKey && readingRef.current.layout === layout
    const publish = (scrollTop: number) => {
      if (!scroller || !offsets.length || disposed) return
      const id = readingHeadingAt(offsets, scrollTop, viewport)
      const next = { key: documentKey, layout, caretId: caret.current, id }
      readingRef.current = next
      setReading(previous => previous?.key === next.key && previous.layout === next.layout && previous.caretId === next.caretId && previous.id === next.id ? previous : next)
    }
    const scroll = () => {
      if (!scroller || paused || disposed) return
      // No element geometry is read here. One cached lookup per paint, even for a long document.
      if (!scrollFrame) scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0
        if (!scroller || paused) return
        const current = scroller.scrollTop
        if (current !== lastScrollTop) { lastScrollTop = current; publish(current) }
      })
    }
    const resize = new ResizeObserver(() => scheduleMeasure())
    const bind = () => {
      const nextScroller = scope.querySelector<HTMLElement>(scrollSelector), nextContent = nextScroller?.querySelector<HTMLElement>(contentSelector) ?? null
      if (scroller === nextScroller && content === nextContent) return
      scroller?.removeEventListener('scroll', scroll)
      resize.disconnect(); resize.observe(scope)
      scroller = nextScroller; content = nextContent
      if (scroller) { scroller.addEventListener('scroll', scroll, { passive: true }); resize.observe(scroller); lastScrollTop = scroller.scrollTop }
      if (content) resize.observe(content)
    }
    const measure = () => {
      measureFrame = 0
      if (paused || disposed) return
      bind()
      if (!scroller || !content) { offsets = []; return }
      const nodes = [...content.querySelectorAll<HTMLElement>(headingSelector)], top = scroller.getBoundingClientRect().top + scroller.clientTop, current = scroller.scrollTop
      const byId = new Map(headings.map(heading => [heading.id, heading]))
      offsets = nodes.flatMap((node, index) => {
        // Rendered previews expose stable heading anchors. Rich headings use document order.
        const heading = node.id && byId.has(node.id) ? byId.get(node.id) : headings[index]
        return heading ? [{ id: heading.id, top: node.getBoundingClientRect().top - top + current }] : []
      }).sort((left, right) => left.top - right.top)
      viewport = { anchor: Math.min(48, Math.max(24, scroller.clientHeight * .08)), maxScroll: Math.max(0, scroller.scrollHeight - scroller.clientHeight) }
      if (ownsReading()) publish(current)
    }
    function scheduleMeasure(delay = 0) {
      if (disposed) return
      clearTimeout(timer)
      cancelAnimationFrame(measureFrame); measureFrame = 0
      if (paused) return
      if (delay) timer = setTimeout(() => { timer = undefined; measureFrame = requestAnimationFrame(measure) }, delay)
      else measureFrame = requestAnimationFrame(measure)
    }
    const mutations = new MutationObserver(records => {
      // Ignore editor handles and CodeMirror's scroll-time DOM work: only the measured
      // content, its inherited styles, or replacement of its root can change these offsets.
      const affectsContent = records.some(record => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement
        if (!target?.closest('.editor-area')) return false
        if (content?.contains(target)) return true
        if (record.type === 'attributes') return !!content && target.contains(content)
        return [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches(`${scrollSelector}, ${contentSelector}`) || !!node.querySelector(`${scrollSelector}, ${contentSelector}`)))
      })
      if (affectsContent) scheduleMeasure(80)
    })
    mutations.observe(scope, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style'] })
    const motion = (event: Event) => {
      paused = (event as CustomEvent<{ active?: boolean }>).detail?.active === true
      clearTimeout(timer); cancelAnimationFrame(measureFrame); cancelAnimationFrame(scrollFrame); measureFrame = 0; scrollFrame = 0
      if (!paused) scheduleMeasure()
    }
    const selection = () => {
      const node = document.getSelection()?.anchorNode
      const element = node instanceof Element ? node : node?.parentElement
      const editor = element?.closest('.tiptap, .cm-content')
      if (editor && scope.contains(editor)) {
        cancelAnimationFrame(scrollFrame); scrollFrame = 0
        if (ownsReading()) { readingRef.current = null; setReading(null) }
      }
    }
    const loaded = () => scheduleMeasure()
    document.addEventListener('workspace-layout-motion', motion)
    document.addEventListener('selectionchange', selection)
    scope.addEventListener('load', loaded, true)
    document.fonts?.addEventListener('loadingdone', loaded)
    window.addEventListener('resize', loaded)
    bind(); scheduleMeasure()
    return () => {
      disposed = true; clearTimeout(timer); cancelAnimationFrame(measureFrame); cancelAnimationFrame(scrollFrame)
      scroller?.removeEventListener('scroll', scroll); resize.disconnect(); mutations.disconnect()
      document.removeEventListener('workspace-layout-motion', motion); document.removeEventListener('selectionchange', selection)
      scope.removeEventListener('load', loaded, true); document.fonts?.removeEventListener('loadingdone', loaded); window.removeEventListener('resize', loaded)
    }
  }, [scopeRef, documentKey, headings, layout])
  return layout !== 'source' && reading?.key === documentKey && reading.layout === layout && reading.caretId === caretHeadingId ? reading.id : caretHeadingId
}
export default useReadingHeading
