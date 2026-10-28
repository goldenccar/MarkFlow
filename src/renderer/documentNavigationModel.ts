export interface NavigationHeading { id: string; text: string; level: number; line: number }
export type NavigationLayout = 'source' | 'preview' | 'split'
export interface HeadingBranch { heading: NavigationHeading; depth: number; children: HeadingBranch[] }
export interface NavigationRow {
  heading: NavigationHeading; depth: number; hasChildren: boolean; expanded: boolean
  match: boolean; containsActive: boolean
}

/** Keep enough room for the editor; split view needs space for two readable panes. */
export function canDockNavigation(surfaceWidth: number, layout: NavigationLayout = 'preview') {
  return surfaceWidth >= (layout === 'split' ? 900 : 600)
}

/** The saved preference survives both narrow windows and closing a temporary overlay. */
export function navigationPresentation(input: { documentKey: string; headingCount: number; pinnedPreference: boolean; explicitDocumentKey: string | null; peekDocumentKey: string | null; canDock?: boolean; dismissedOverlayDocumentKey?: string | null }) {
  const autoPeek = input.headingCount >= 2, explicitlyOpened = input.explicitDocumentKey === input.documentKey
  const requestedPin = input.pinnedPreference && (autoPeek || explicitlyOpened), canDock = input.canDock ?? true
  const pinned = requestedPin && canDock
  const overlayPinned = requestedPin && !canDock && input.dismissedOverlayDocumentKey !== input.documentKey
  const peek = input.peekDocumentKey === input.documentKey && (autoPeek || explicitlyOpened)
  const open = pinned || overlayPinned || peek
  return { autoPeek, explicitlyOpened, pinned, overlayPinned, peek, open, state: pinned ? 'pinned' as const : overlayPinned ? 'overlay' as const : open ? 'peek' as const : 'closed' as const }
}

/** Heading levels describe ancestry; skipped levels do not create empty headings. */
export function buildHeadingTree(headings: readonly NavigationHeading[]): HeadingBranch[] {
  const roots: HeadingBranch[] = [], stack: HeadingBranch[] = []
  for (const heading of headings) {
    while (stack.length && stack.at(-1)!.heading.level >= heading.level) stack.pop()
    const branch: HeadingBranch = { heading, depth: stack.length, children: [] }
    if (stack.length) stack.at(-1)!.children.push(branch)
    else roots.push(branch)
    stack.push(branch)
  }
  return roots
}

const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase().trim()

/** Search includes matching headings and their ancestors; it never changes collapse state. */
export function headingNavigationRows(tree: readonly HeadingBranch[], collapsed: ReadonlySet<string>, query = '', activeId?: string): NavigationRow[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean), rows: NavigationRow[] = []
  const visit = (branch: HeadingBranch): { rows: NavigationRow[]; matches: boolean; containsActive: boolean } => {
    const descendants = branch.children.map(visit)
    const match = terms.length > 0 && terms.every(term => normalize(branch.heading.text).includes(term))
    const matches = match || descendants.some(child => child.matches)
    const containsActive = branch.heading.id === activeId || descendants.some(child => child.containsActive)
    if (terms.length && !matches) return { rows: [], matches, containsActive }
    const expanded = branch.children.length > 0 && (terms.length > 0 || !collapsed.has(branch.heading.id))
    return {
      rows: [{ heading: branch.heading, depth: branch.depth, hasChildren: branch.children.length > 0, expanded, match, containsActive }, ...(expanded ? descendants.flatMap(child => child.rows) : [])],
      matches, containsActive,
    }
  }
  tree.forEach(branch => rows.push(...visit(branch).rows))
  return rows
}

export type NavigationKeyAction = { type: 'focus' | 'expand' | 'collapse'; id: string }
/** Keyboard movement follows visible hierarchy, never a hidden descendant. */
export function headingNavigationKeyAction(rows: readonly NavigationRow[], id: string, key: string, allowCollapse = true): NavigationKeyAction | null {
  const index = rows.findIndex(row => row.heading.id === id), row = rows[index]
  if (!row) return null
  const focus = (next: number): NavigationKeyAction => ({ type: 'focus', id: rows[next].heading.id })
  if (key === 'Home') return focus(0)
  if (key === 'End') return focus(rows.length - 1)
  if (key === 'ArrowDown') return focus(Math.min(rows.length - 1, index + 1))
  if (key === 'ArrowUp') return focus(Math.max(0, index - 1))
  if (key === 'ArrowRight') {
    if (row.hasChildren && !row.expanded && allowCollapse) return { type: 'expand', id }
    if (rows[index + 1]?.depth > row.depth) return focus(index + 1)
  }
  if (key === 'ArrowLeft') {
    if (row.hasChildren && row.expanded && allowCollapse) return { type: 'collapse', id }
    for (let previous = index - 1; previous >= 0; previous--) if (rows[previous].depth < row.depth) return focus(previous)
  }
  return null
}

/** A long document keeps a bounded rail while its current section always remains visible. */
export function headingRailItems(headings: readonly NavigationHeading[], activeId?: string, limit = 24): NavigationHeading[] {
  if (limit < 1) return []
  if (headings.length <= limit) return [...headings]
  const active = headings.findIndex(heading => heading.id === activeId)
  if (limit === 1) return [headings[active < 0 ? 0 : active]]
  const indexes = new Set(Array.from({ length: limit }, (_, index) => Math.round(index * (headings.length - 1) / (limit - 1))))
  if (active >= 0 && !indexes.has(active)) {
    const nearest = [...indexes].filter(index => index !== 0 && index !== headings.length - 1).sort((a, b) => Math.abs(a - active) - Math.abs(b - active))[0]
    indexes.delete(nearest ?? [...indexes].at(-1)!)
    indexes.add(active)
  }
  return [...indexes].sort((a, b) => a - b).map(index => headings[index])
}
