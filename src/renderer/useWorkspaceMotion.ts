import { useCallback, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'

const duration = 190
const easing = 'cubic-bezier(.22, .8, .22, 1)'
const movingSurfaces = '.main, .editor-area, .rich-editor .tiptap, .preview-pane > .document-preview, .tab-strip, .titlebar-navigation .icon-button, .tab-new'
type EndReason = 'finished' | 'interrupted' | 'resized' | 'reduced-motion' | 'unmounted'
interface Rect { left: number; top: number }
export interface WorkspaceMotionSample {
  duration: number
  commitMs: number
  setupMs: number
  animationMs: number
  firstFrameMs: number | undefined
  reason: EndReason
  animations: number
  geometryReads: number
  frameIntervals: number[]
  sidebar: string | undefined
  navigation: string | undefined
}
declare global {
  interface Window {
    /** Development-only opt-in; samples have no document text or file paths. */
    __workspaceMotionDebug?: { enabled: boolean; samples: WorkspaceMotionSample[] }
  }
}

/** Layout changes once; the intervening frames animate only translations and opacity. */
export function useWorkspaceMotion() {
  const rootRef = useRef<HTMLDivElement>(null)
  const active = useRef<{ stop: (reason: EndReason, notify?: boolean) => void } | null>(null)
  const transitionLayout = useCallback((update: () => void) => {
    const root = rootRef.current
    if (!root) { flushSync(update); return }
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion || document.hidden) {
      active.current?.stop('reduced-motion')
      flushSync(update)
      return
    }

    const started = performance.now()
    // Read the current visual positions before cancelling a possibly interrupted motion.
    const candidates = [...root.querySelectorAll<HTMLElement>(movingSurfaces)]
    const elements = candidates.filter(element => element.getClientRects().length > 0)
    let geometryReads = candidates.length
    const before = new Map<HTMLElement, Rect>()
    for (const element of elements) {
      const rect = element.getBoundingClientRect(); geometryReads++
      before.set(element, { left: rect.left, top: rect.top })
    }
    const sidebar = root.querySelector<HTMLElement>('.sidebar-shell .sidebar')
    const previousSidebar = sidebar ? { transform: getComputedStyle(sidebar).transform, opacity: getComputedStyle(sidebar).opacity } : null
    active.current?.stop('interrupted', false)
    root.dataset.layoutAnimating = 'true'
    document.dispatchEvent(new CustomEvent('workspace-layout-motion', { detail: { active: true } }))
    const commitStarted = performance.now()
    try { flushSync(update) } catch (error) {
      delete root.dataset.layoutAnimating
      document.dispatchEvent(new CustomEvent('workspace-layout-motion', { detail: { active: false } }))
      throw error
    }
    const commitMs = performance.now() - commitStarted

    // All endpoint reads precede animation writes. Nested targets subtract their parent's
    // displacement, so an editor inside the moving main surface is never translated twice.
    const movement = new Map<HTMLElement, { x: number; y: number }>()
    for (const [element, old] of before) {
      if (!element.isConnected) continue
      const rect = element.getBoundingClientRect(); geometryReads++
      movement.set(element, { x: old.left - rect.left, y: old.top - rect.top })
    }
    const finalSidebar = sidebar ? { transform: getComputedStyle(sidebar).transform, opacity: getComputedStyle(sidebar).opacity } : null
    const animations: Animation[] = []
    const restore: (() => void)[] = []
    for (const [element, total] of movement) {
      let parent = element.parentElement
      while (parent && !movement.has(parent)) parent = parent.parentElement
      const parentOffset = parent ? movement.get(parent)! : { x: 0, y: 0 }
      const x = total.x - parentOffset.x, y = total.y - parentOffset.y
      if (Math.abs(x) < .5 && Math.abs(y) < .5) continue
      animations.push(element.animate([
        { transform: `translate3d(${x}px, ${y}px, 0)` },
        { transform: 'translate3d(0, 0, 0)' },
      ], { duration, easing, fill: 'both' }))
    }
    if (sidebar && previousSidebar && finalSidebar && (previousSidebar.transform !== finalSidebar.transform || previousSidebar.opacity !== finalSidebar.opacity)) {
      const visibility = sidebar.style.visibility
      sidebar.style.visibility = 'visible'
      restore.push(() => { sidebar.style.visibility = visibility })
      animations.push(sidebar.animate([previousSidebar, finalSidebar], { duration, easing, fill: 'both' }))
      // The titlebar continues the sidebar border. Share exact endpoints and timing,
      // including interrupted toggles, without animating either layout width.
      const titlebar = root.querySelector<HTMLElement>('.window-drag')
      if (titlebar) animations.push(titlebar.animate([previousSidebar, finalSidebar], { duration, easing, fill: 'both', pseudoElement: '::before' }))
    }

    const debug = import.meta.env.DEV && window.__workspaceMotionDebug?.enabled ? window.__workspaceMotionDebug : null
    const animationStarted = performance.now(), frameIntervals: number[] = []
    let frame = 0, lastFrame: number | undefined, firstFrameMs: number | undefined, stopped = false
    const measureFrame = (time: number) => {
      firstFrameMs ??= time - started
      if (lastFrame !== undefined) frameIntervals.push(time - lastFrame)
      lastFrame = time
      frame = requestAnimationFrame(measureFrame)
    }
    if (debug) frame = requestAnimationFrame(measureFrame)
    const current = {
      stop: (reason: EndReason, notify = true) => {
        if (stopped) return
        stopped = true
        cancelAnimationFrame(frame)
        animations.forEach(animation => animation.cancel())
        restore.forEach(reset => reset())
        if (debug) {
          const ended = performance.now()
          debug.samples.push({ duration: ended - started, commitMs, setupMs: animationStarted - started, animationMs: ended - animationStarted, firstFrameMs, reason, animations: animations.length, geometryReads, frameIntervals, sidebar: root.dataset.sidebar, navigation: root.querySelector<HTMLElement>('.document-navigator')?.dataset.navigationState })
          if (debug.samples.length > 60) debug.samples.shift()
        }
        if (active.current === current) active.current = null
        if (notify) {
          delete root.dataset.layoutAnimating
          document.dispatchEvent(new CustomEvent('workspace-layout-motion', { detail: { active: false } }))
        }
      },
    }
    active.current = current
    void Promise.allSettled(animations.map(animation => animation.finished)).then(() => { if (!stopped) current.stop('finished') })
  }, [])

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const resize = () => active.current?.stop('resized')
    const reduce = () => { if (media.matches) active.current?.stop('reduced-motion') }
    window.addEventListener('resize', resize)
    media.addEventListener('change', reduce)
    return () => { active.current?.stop('unmounted'); window.removeEventListener('resize', resize); media.removeEventListener('change', reduce) }
  }, [])
  return { rootRef, transitionLayout }
}
