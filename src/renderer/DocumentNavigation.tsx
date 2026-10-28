import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { buildHeadingTree, canDockNavigation, headingNavigationKeyAction, headingNavigationRows, headingRailItems, navigationPresentation, type NavigationHeading, type NavigationLayout } from './documentNavigationModel'
import './document-navigation.css'

export type { NavigationHeading } from './documentNavigationModel'
export interface DocumentNavigationProps {
  documentKey: string
  headings: NavigationHeading[]
  activeId?: string
  disabled?: boolean
  pinned: boolean
  layout?: NavigationLayout
  onPinnedChange(pinned: boolean): void
  onNavigate(heading: NavigationHeading): void
  blockContent?: ReactNode
  title?: string
}

function NavigationIcon({ kind }: { kind: 'outline' | 'pin' | 'close' | 'search' | 'more' | 'chevron' | 'back' }) {
  const paths = {
    outline: 'M4 4h12M4 8h8M4 12h12M4 16h8',
    pin: 'm7 3 6 0-1 5 3 3v2H5v-2l3-3-1-5M10 13v5',
    close: 'm5 5 10 10M15 5 5 15',
    search: 'm14 14 4 4M15 8.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0',
    more: 'M4 10h.01M10 10h.01M16 10h.01',
    chevron: 'm7 4 6 6-6 6',
    back: 'm12 4-6 6 6 6',
  }
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={kind === 'more' ? 3 : 1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>
}

export function DocumentNavigation({ documentKey, headings, activeId, disabled = false, pinned, layout = 'preview', onPinnedChange, onNavigate, blockContent, title = '文档目录' }: DocumentNavigationProps) {
  const [peekDocument, setPeekDocument] = useState<string | null>(null), [explicitDocument, setExplicitDocument] = useState<string | null>(null)
  const [canDock, setCanDock] = useState(true), [dismissedOverlayDocument, setDismissedOverlayDocument] = useState<string | null>(null)
  const [query, setQuery] = useState(''), [inspector, setInspector] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const root = useRef<HTMLElement>(null), trigger = useRef<HTMLButtonElement>(null), list = useRef<HTMLDivElement>(null), searchInput = useRef<HTMLInputElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), suppressHover = useRef(false)
  const searchComposing = useRef(false)
  const panelId = useId(), searching = query.trim().length > 0
  const { autoPeek, explicitlyOpened, pinned: effectivePinned, overlayPinned, peek, open, state } = navigationPresentation({ documentKey, headingCount: headings.length, pinnedPreference: pinned, explicitDocumentKey: explicitDocument, peekDocumentKey: peekDocument, canDock, dismissedOverlayDocumentKey: dismissedOverlayDocument })
  const locked = effectivePinned || overlayPinned
  const setPeek = (value: boolean) => setPeekDocument(value ? documentKey : null)
  const tree = useMemo(() => buildHeadingTree(headings), [headings])
  const rows = useMemo(() => headingNavigationRows(tree, collapsed, query, activeId), [tree, collapsed, query, activeId])
  const rail = useMemo(() => headingRailItems(headings, activeId), [headings, activeId])
  const hasBlockContent = blockContent !== null && blockContent !== undefined

  const cancelClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = undefined }
  const ownsNode = (node: Node | null) => root.current?.contains(node) || node instanceof Element && node.closest('[data-navigation-document-key]')?.getAttribute('data-navigation-document-key') === documentKey
  const dismiss = (restoreFocus = false) => {
    cancelClose(); suppressHover.current = true; setPeek(false)
    if (overlayPinned) setDismissedOverlayDocument(documentKey)
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus())
  }
  const showPeek = () => { cancelClose(); if (autoPeek && !suppressHover.current) setPeek(true) }
  const deferClose = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => { if (!ownsNode(document.activeElement)) setPeek(false) }, 180)
  }
  const toggleBranch = (id: string) => setCollapsed(previous => {
    const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next
  })
  const showInspector = (value: boolean) => {
    setInspector(value)
    requestAnimationFrame(() => {
      const target = root.current?.querySelector<HTMLElement>(value ? '.document-navigator-back' : '.document-navigator-search input') ?? root.current?.querySelector<HTMLElement>('.document-navigator-heading button')
      target?.focus()
    })
  }
  const clearSearch = () => { setQuery(''); searchInput.current?.focus() }
  const focusHeading = (id: string) => list.current?.querySelector<HTMLButtonElement>(`[data-heading-id="${CSS.escape(id)}"]:not(:disabled)`)?.focus()

  useLayoutEffect(() => {
    const surface = root.current?.parentElement
    if (!surface) return
    const update = (width: number) => setCanDock(canDockNavigation(width, layout))
    update(surface.getBoundingClientRect().width)
    const observer = new ResizeObserver(entries => { if (entries[0]) update(entries[0].contentRect.width) })
    observer.observe(surface)
    return () => observer.disconnect()
  }, [layout])
  useEffect(() => {
    cancelClose(); suppressHover.current = false; searchComposing.current = false; setPeek(false); setExplicitDocument(null); setDismissedOverlayDocument(null); setQuery(''); setInspector(false); setCollapsed(new Set())
  }, [documentKey])
  useEffect(() => () => cancelClose(), [])
  useEffect(() => { if (!autoPeek && !explicitlyOpened) setPeek(false) }, [autoPeek, explicitlyOpened])
  useEffect(() => {
    if (!open || effectivePinned) return
    const outside = (event: PointerEvent) => { if (!overlayPinned && !ownsNode(event.target as Node)) dismiss() }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || searchComposing.current || event.isComposing || event.keyCode === 229) return
      // Capture listeners can restore focus before this listener runs. The original
      // event path still identifies the menu/dialog that owns this Escape press.
      if (event.defaultPrevented || event.composedPath().some(node => node instanceof Element && node.matches('dialog, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], select, [aria-haspopup]:not([aria-haspopup="false"])[aria-expanded="true"], [role="search"], .cm-search'))) return
      // A portalled block menu handles Escape first and returns focus to its source row.
      if (!root.current?.contains(document.activeElement) && ownsNode(document.activeElement)) return
      event.preventDefault(); event.stopPropagation()
      if (document.activeElement === searchInput.current && searching) clearSearch()
      else dismiss(root.current?.contains(document.activeElement))
    }
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true) }
  }, [open, effectivePinned, overlayPinned, documentKey, searching])
  useEffect(() => {
    if (!open || inspector || searching || !activeId) return
    const container = list.current, selected = container?.querySelector<HTMLElement>('[aria-current="location"]') ?? container?.querySelector<HTMLElement>('[data-contains-active="true"]')
    if (!container || !selected) return
    const box = selected.getBoundingClientRect(), viewport = container.getBoundingClientRect()
    if (box.top < viewport.top) container.scrollTop -= viewport.top - box.top + 6
    else if (box.bottom > viewport.bottom) container.scrollTop += box.bottom - viewport.bottom + 6
  }, [activeId, open, inspector, searching, rows])

  return <aside ref={root} className="document-navigator" data-document-key={documentKey} data-navigation-state={state} data-navigation-pinned={String(effectivePinned)} aria-label="文档导航"
    onPointerEnter={showPeek}
    onPointerLeave={() => { suppressHover.current = false; deferClose() }}
    onFocus={showPeek}
    onBlur={event => { if (!ownsNode(event.relatedTarget as Node | null)) deferClose() }}>
    <div className="document-navigator-rail" aria-hidden={effectivePinned} inert={effectivePinned}>
      <button ref={trigger} type="button" className="document-navigator-trigger" aria-label="打开文档导航" title="打开并固定文档导航" aria-expanded={open} aria-controls={panelId} onClick={() => { cancelClose(); suppressHover.current = false; setExplicitDocument(documentKey); setDismissedOverlayDocument(null); setPeek(true); onPinnedChange(true); requestAnimationFrame(() => { const target = root.current?.querySelector<HTMLElement>(inspector ? '.document-navigator-back' : '.document-navigator-search input') ?? root.current?.querySelector<HTMLElement>('.document-navigator-heading button'); target?.focus() }) }}><NavigationIcon kind="outline" /></button>
      {autoPeek && <div className="document-navigator-ticks" aria-hidden="true">{rail.map(heading => <span key={heading.id} data-current={heading.id === activeId ? 'true' : undefined} style={{ '--heading-level': Math.min(heading.level, 4) } as CSSProperties} />)}</div>}
    </div>
    <section id={panelId} className="document-navigator-panel" aria-label={title} aria-hidden={!open} inert={!open}>
      <header className="document-navigator-heading">
        {inspector && <button type="button" className="document-navigator-icon document-navigator-back" aria-label="返回文档目录" title="返回文档目录" onClick={() => showInspector(false)}><NavigationIcon kind="back" /></button>}
        <strong>{inspector ? '内容块' : title}</strong>
        {!inspector && hasBlockContent && <button type="button" className="document-navigator-icon" aria-label="查看内容块" title="查看内容块" onClick={() => showInspector(true)}><NavigationIcon kind="more" /></button>}
        <button type="button" className="document-navigator-icon" data-active={locked ? 'true' : undefined} aria-label={locked ? '取消固定文档导航' : '固定文档导航'} title={locked ? '取消固定文档导航' : '固定文档导航'} aria-pressed={locked} onClick={() => { setExplicitDocument(documentKey); setDismissedOverlayDocument(null); setPeek(true); onPinnedChange(!locked) }}><NavigationIcon kind="pin" /></button>
        <button type="button" className="document-navigator-icon" aria-label="关闭文档导航" title="关闭文档导航" onClick={() => { if (effectivePinned) onPinnedChange(false); dismiss(true) }}><NavigationIcon kind="close" /></button>
      </header>
      {inspector ? <div className="document-navigator-inspector">{blockContent}</div> : <>
        {headings.length > 0 && <div className="document-navigator-search"><NavigationIcon kind="search" /><input ref={searchInput} type="search" aria-label="搜索文档目录" placeholder="搜索标题" value={query} onChange={event => setQuery(event.target.value)} onCompositionStart={() => { searchComposing.current = true }} onCompositionEnd={() => { searchComposing.current = false }} onKeyDown={event => {
          if (searchComposing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
          if (event.key === 'Escape' && searching) { event.preventDefault(); event.stopPropagation(); clearSearch() }
          if ((event.key === 'ArrowDown' || event.key === 'Enter') && !disabled) {
            const first = rows.find(row => row.match) ?? rows[0]
            if (first) { event.preventDefault(); event.key === 'ArrowDown' ? focusHeading(first.heading.id) : onNavigate(first.heading) }
          }
        }} />{query && <button type="button" className="document-navigator-clear" aria-label="清除目录搜索" title="清除搜索" onMouseDown={event => event.preventDefault()} onClick={clearSearch}><NavigationIcon kind="close" /></button>}</div>}
        <div ref={list} className="document-navigator-list" aria-label="标题列表" onKeyDown={event => {
          const target = event.target as HTMLElement
          if (!target.matches('.document-navigator-link')) return
          const action = headingNavigationKeyAction(rows, target.dataset.headingId ?? '', event.key, !searching)
          if (!action) return
          event.preventDefault()
          if (action.type === 'focus') focusHeading(action.id)
          else toggleBranch(action.id)
        }}>
          {rows.map(row => <div key={row.heading.id} className="document-navigator-row" data-heading-depth={row.depth} style={{ '--heading-depth': row.depth } as CSSProperties} data-contains-active={row.containsActive && !row.expanded ? 'true' : undefined}>
            {row.hasChildren ? <button type="button" className="document-navigator-fold" aria-label={`${row.expanded ? '折叠' : '展开'} ${row.heading.text || '未命名标题'}`} aria-expanded={row.expanded} disabled={searching} onClick={() => toggleBranch(row.heading.id)}><NavigationIcon kind="chevron" /></button> : <span className="document-navigator-fold-space" aria-hidden="true" />}
            <button type="button" className="document-navigator-link" data-heading-id={row.heading.id} data-match={row.match ? 'true' : undefined} title={row.heading.text || '未命名标题'} aria-label={`跳转标题 ${row.heading.text || '未命名标题'}`} aria-current={row.heading.id === activeId ? 'location' : undefined} disabled={disabled} onClick={() => onNavigate(row.heading)}><span>{row.heading.text || '未命名标题'}</span></button>
          </div>)}
          {!rows.length && <div className="document-navigator-empty" role="status"><p>{searching ? '没有找到匹配的标题' : '添加标题后，可在这里快速定位。'}</p>{searching && <button type="button" onClick={clearSearch}>清除搜索</button>}</div>}
        </div>
      </>}
    </section>
  </aside>
}

export default DocumentNavigation
