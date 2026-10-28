import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ResolvedTheme, ThemePreference } from '../shared/types'
import { Icon, type IconName } from './Icons'
import './theme-picker.css'

const choices: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: 'system', label: '跟随本机', icon: 'monitor' },
  { value: 'light', label: '浅色', icon: 'sun' },
  { value: 'dark', label: '深色', icon: 'moon' },
]

export default function ThemePicker({ preference, resolved, onChange }: { preference: ThemePreference; resolved: ResolvedTheme; onChange: (theme: ThemePreference) => void }) {
  const [open, setOpen] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()
  const selected = choices.find(choice => choice.value === preference)!
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return
    const bounds = trigger.current.getBoundingClientRect()
    menu.current.style.left = `${Math.max(8, Math.min(bounds.right - menu.current.offsetWidth, window.innerWidth - menu.current.offsetWidth - 8))}px`
    menu.current.style.top = `${bounds.bottom + 6}px`
    menu.current.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
  }, [open])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!host.current?.contains(event.target as Node)) setOpen(false) }
    const close = () => setOpen(false)
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', close)
    document.addEventListener('workspace-layout-motion', close)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', close); document.removeEventListener('workspace-layout-motion', close) }
  }, [open])
  return <div ref={host} className="theme-control" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }} onKeyDown={event => { if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus() } }}>
    <button ref={trigger} className="icon-button" aria-label={`主题：${selected.label}`} title={`主题 · ${selected.label}${preference === 'system' ? `（当前${resolved === 'dark' ? '深色' : '浅色'}）` : ''}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) } }}><Icon name={selected.icon} /></button>
    {open && <div ref={menu} id={id} className="theme-menu" role="menu" aria-label="主题" onKeyDown={event => {
      if (event.key === 'Tab' && event.shiftKey) { event.preventDefault(); setOpen(false); trigger.current?.focus(); return }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    }}><span className="theme-menu-caption">主题</span>{choices.map(choice => <button key={choice.value} role="menuitemradio" aria-checked={preference === choice.value} tabIndex={-1} onClick={() => { onChange(choice.value); setOpen(false); trigger.current?.focus() }}><Icon name={choice.icon} /><span>{choice.label}</span>{preference === choice.value && <Icon name="check" className="theme-check" size={14} />}</button>)}</div>}
  </div>
}
