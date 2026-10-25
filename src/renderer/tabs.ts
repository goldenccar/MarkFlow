import type { ContentMode, Layout } from '../shared/types'

export interface DocumentTab {
  id: string; root: string; path: string; title: string; mode: ContentMode
  untitledId?: string; pinned: boolean; dirty: boolean
  layout?: Layout
}
export const sessionKey = 'oopsmd.tabs.v1'
export function fileTabId(root: string, path: string) { return `${root.replaceAll('\\', '/').toLowerCase()}/${path.toLowerCase()}` }
export function orderTabs(tabs: DocumentTab[]) { return [...tabs.filter(tab => tab.pinned), ...tabs.filter(tab => !tab.pinned)] }
export function reorderTabs(tabs: DocumentTab[], source: string, target: string) {
  const moving = tabs.find(tab => tab.id === source), destination = tabs.find(tab => tab.id === target)
  if (!moving || !destination || moving.pinned !== destination.pinned || source === target) return tabs
  const next = tabs.filter(tab => tab.id !== source)
  next.splice(next.findIndex(tab => tab.id === target), 0, moving)
  return next
}
export function readTabSession(raw: string | null): { tabs: DocumentTab[]; active: string; closed: DocumentTab[] } {
  const empty = { tabs: [], active: '', closed: [] }
  try {
    const value = JSON.parse(raw ?? '{}')
    const valid = (tab: DocumentTab) => tab && typeof tab.id === 'string' && typeof tab.root === 'string' && typeof tab.path === 'string' && typeof tab.title === 'string' && ['markdown', 'latex-math'].includes(tab.mode) && (!tab.untitledId || /^[a-z0-9-]+$/i.test(tab.untitledId))
    const clean = (items: unknown): DocumentTab[] => Array.isArray(items) ? items.filter(valid).slice(0, 100)
      .filter((tab, index, all) => all.findIndex(other => other.id === tab.id) === index)
      .map(tab => ({ id: tab.id, root: tab.root, path: tab.path, title: tab.title, mode: tab.mode, untitledId: tab.untitledId, pinned: tab.pinned === true, dirty: tab.dirty === true,
        layout: ['source', 'preview', 'split'].includes(tab.layout) ? tab.layout : undefined })) : []
    return { tabs: orderTabs(clean(value.tabs)), active: typeof value.active === 'string' ? value.active : '', closed: clean(value.closed).slice(0, 20) }
  } catch { return empty }
}
