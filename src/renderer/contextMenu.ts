import { useLayoutEffect, type KeyboardEvent, type RefObject } from 'react'
import { useLatestEvent } from './useLatestEvent'

export function navigateMenu(event: KeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  const index = items.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
  items[next]?.focus()
}

/** Context menus share viewport bounds, dismissal and keyboard focus restoration. */
export function useContextMenu(position: { x: number; y: number } | null, ref: RefObject<HTMLElement | null>, source: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useLatestEvent(onClose)
  useLayoutEffect(() => {
    const menu = ref.current
    if (!position || !menu) return
    const bounds = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(position.x, window.innerWidth - bounds.width - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(position.y, window.innerHeight - bounds.height - 8))}px`
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
    const restore = () => { if (source.current?.isConnected) source.current.focus({ preventScroll: true }) }
    const dismiss = () => { if (menu.contains(document.activeElement)) restore(); close() }
    const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node)) close() }
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); restore(); close() } }
    window.addEventListener('resize', dismiss); document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape, true)
    return () => { window.removeEventListener('resize', dismiss); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true) }
  }, [position, ref, source, close])
}
