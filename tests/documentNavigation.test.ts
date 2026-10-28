import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHeadingTree, canDockNavigation, headingNavigationKeyAction, headingNavigationRows, headingRailItems, navigationPresentation, type NavigationHeading } from '../src/renderer/documentNavigationModel'

const headings: NavigationHeading[] = [
  { id: 'intro', text: '介绍', level: 1, line: 1 },
  { id: 'details', text: '安装说明', level: 3, line: 4 },
  { id: 'mac', text: 'Mac 设置', level: 4, line: 8 },
  { id: 'win', text: 'Windows 设置', level: 4, line: 12 },
  { id: 'use', text: '使用', level: 2, line: 16 },
  { id: 'end', text: '结束', level: 1, line: 20 },
]

test('navigation uses real ancestry when heading levels skip or restart', () => {
  const tree = buildHeadingTree(headings)
  assert.deepEqual(tree.map(node => node.heading.id), ['intro', 'end'])
  assert.deepEqual(tree[0].children.map(node => node.heading.id), ['details', 'use'])
  assert.deepEqual(headingNavigationRows(tree, new Set()).map(row => [row.heading.id, row.depth]), [['intro', 0], ['details', 1], ['mac', 2], ['win', 2], ['use', 1], ['end', 0]])
  assert.deepEqual(headingNavigationRows(buildHeadingTree([{ id: 'a', text: 'A', level: 4, line: 1 }, { id: 'b', text: 'B', level: 2, line: 3 }]), new Set()).map(row => row.depth), [0, 0])
})

test('collapse hides descendants and preserves the active ancestor hint', () => {
  const collapsed = new Set(['details']), rows = headingNavigationRows(buildHeadingTree(headings), collapsed, '', 'mac')
  assert.deepEqual(rows.map(row => row.heading.id), ['intro', 'details', 'use', 'end'])
  assert.equal(rows.find(row => row.heading.id === 'details')?.expanded, false)
  assert.equal(rows.find(row => row.heading.id === 'details')?.containsActive, true)
  assert.deepEqual([...collapsed], ['details'])
})

test('search retains ancestors and opens collapsed paths without mutating user choices', () => {
  const tree = buildHeadingTree(headings), collapsed = new Set(['intro', 'details'])
  const rows = headingNavigationRows(tree, collapsed, 'ｍａｃ 设置')
  assert.deepEqual(rows.map(row => row.heading.id), ['intro', 'details', 'mac'])
  assert.deepEqual(rows.map(row => row.match), [false, false, true])
  assert.ok(rows[0].expanded && rows[1].expanded)
  assert.deepEqual([...collapsed], ['intro', 'details'])
  assert.deepEqual(headingNavigationRows(tree, collapsed).map(row => row.heading.id), ['intro', 'end'])
  assert.deepEqual(headingNavigationRows(tree, collapsed, '不存在'), [])
})

test('empty outlines and whitespace searches are safe', () => {
  assert.deepEqual(buildHeadingTree([]), [])
  assert.deepEqual(headingNavigationRows([], new Set(), 'anything'), [])
  assert.deepEqual(headingNavigationRows(buildHeadingTree(headings), new Set(), '  ').map(row => row.heading.id), headings.map(heading => heading.id))
})

test('the compact rail remains bounded and includes the current heading in document order', () => {
  const long = Array.from({ length: 200 }, (_, index) => ({ id: String(index), text: String(index), level: 2, line: index + 1 }))
  const rail = headingRailItems(long, '91')
  assert.equal(rail.length, 24)
  assert.ok(rail.some(heading => heading.id === '91'))
  assert.equal(rail[0].id, '0'); assert.equal(rail.at(-1)!.id, '199')
  assert.ok(rail.every((heading, index) => index === 0 || rail[index - 1].line < heading.line))
  assert.deepEqual(headingRailItems(long, '91', 1).map(heading => heading.id), ['91'])
  assert.deepEqual(headingRailItems([], undefined), [])
})

test('saved pin preferences keep new empty and single-heading documents compact until explicitly opened', () => {
  const input = { documentKey: 'short', headingCount: 0, pinnedPreference: true, explicitDocumentKey: null, peekDocumentKey: null }
  for (const headingCount of [0, 1]) {
    const initial = navigationPresentation({ ...input, headingCount })
    assert.equal(initial.pinned, false); assert.equal(initial.open, false); assert.equal(initial.state, 'closed')
    const explicit = navigationPresentation({ ...input, headingCount, explicitDocumentKey: 'short', peekDocumentKey: 'short' })
    assert.equal(explicit.pinned, true); assert.equal(explicit.state, 'pinned')
    const unpinned = navigationPresentation({ ...input, headingCount, pinnedPreference: false, explicitDocumentKey: 'short', peekDocumentKey: 'short' })
    assert.equal(unpinned.pinned, false); assert.equal(unpinned.state, 'peek')
  }
  assert.equal(input.pinnedPreference, true)
})

test('document switches immediately discard another document\'s explicit and hover state while long documents restore pin preference', () => {
  const previous = { pinnedPreference: true, explicitDocumentKey: 'previous', peekDocumentKey: 'previous' }
  assert.equal(navigationPresentation({ ...previous, documentKey: 'new', headingCount: 0 }).state, 'closed')
  assert.equal(navigationPresentation({ ...previous, documentKey: 'new', headingCount: 1 }).state, 'closed')
  assert.equal(navigationPresentation({ ...previous, documentKey: 'new', headingCount: 2 }).state, 'pinned')
  assert.equal(navigationPresentation({ ...previous, pinnedPreference: false, documentKey: 'new', headingCount: 2 }).state, 'closed')
})

test('narrow surfaces keep room for one editor or both split panes', () => {
  for (const width of [380, 480, 599]) assert.equal(canDockNavigation(width), false)
  assert.equal(canDockNavigation(600), true)
  assert.equal(canDockNavigation(680, 'source'), true)
  assert.equal(canDockNavigation(680, 'split'), false)
  assert.equal(canDockNavigation(899, 'split'), false)
  assert.equal(canDockNavigation(900, 'split'), true)
})

test('a saved pin becomes an overlay in narrow windows and docks again without changing preference', () => {
  const input = { documentKey: 'long', headingCount: 5, pinnedPreference: true, explicitDocumentKey: null, peekDocumentKey: null }
  const narrow = navigationPresentation({ ...input, canDock: false })
  assert.equal(narrow.pinned, false); assert.equal(narrow.overlayPinned, true); assert.equal(narrow.state, 'overlay')
  const wide = navigationPresentation({ ...input, canDock: true })
  assert.equal(wide.pinned, true); assert.equal(wide.overlayPinned, false); assert.equal(wide.state, 'pinned')
  assert.equal(input.pinnedPreference, true)
})

test('closing a narrow overlay keeps its pin preference and allows hover, reopening, or wider docking', () => {
  const input = { documentKey: 'long', headingCount: 5, pinnedPreference: true, explicitDocumentKey: 'long', peekDocumentKey: null, canDock: false, dismissedOverlayDocumentKey: 'long' }
  assert.equal(navigationPresentation(input).state, 'closed')
  assert.equal(navigationPresentation({ ...input, peekDocumentKey: 'long' }).state, 'peek')
  assert.equal(navigationPresentation({ ...input, dismissedOverlayDocumentKey: null }).state, 'overlay')
  assert.equal(navigationPresentation({ ...input, canDock: true }).state, 'pinned')
  const unpinned = navigationPresentation({ ...input, pinnedPreference: false, peekDocumentKey: 'long', dismissedOverlayDocumentKey: null })
  assert.equal(unpinned.pinned, false); assert.equal(unpinned.overlayPinned, false); assert.equal(unpinned.state, 'peek')
})

test('narrow empty documents stay compact and an overlay dismissal only belongs to its document', () => {
  const input = { documentKey: 'new', headingCount: 0, pinnedPreference: true, explicitDocumentKey: 'previous', peekDocumentKey: 'previous', canDock: false, dismissedOverlayDocumentKey: 'previous' }
  assert.equal(navigationPresentation(input).state, 'closed')
  assert.equal(navigationPresentation({ ...input, explicitDocumentKey: 'new' }).state, 'overlay')
  assert.equal(navigationPresentation({ ...input, headingCount: 3 }).state, 'overlay')
})

test('keyboard navigation opens branches, enters children and returns to their visible parent', () => {
  const tree = buildHeadingTree(headings), openRows = headingNavigationRows(tree, new Set())
  assert.deepEqual(headingNavigationKeyAction(openRows, 'intro', 'ArrowRight'), { type: 'focus', id: 'details' })
  assert.deepEqual(headingNavigationKeyAction(openRows, 'mac', 'ArrowLeft'), { type: 'focus', id: 'details' })
  assert.deepEqual(headingNavigationKeyAction(openRows, 'details', 'ArrowLeft'), { type: 'collapse', id: 'details' })
  const closedRows = headingNavigationRows(tree, new Set(['details']))
  assert.deepEqual(headingNavigationKeyAction(closedRows, 'details', 'ArrowRight'), { type: 'expand', id: 'details' })
  assert.deepEqual(headingNavigationKeyAction(closedRows, 'details', 'ArrowDown'), { type: 'focus', id: 'use' })
  assert.deepEqual(headingNavigationKeyAction(closedRows, 'details', 'ArrowLeft'), { type: 'focus', id: 'intro' })
  assert.deepEqual(headingNavigationKeyAction(closedRows, 'intro', 'ArrowUp'), { type: 'focus', id: 'intro' })
  assert.deepEqual(headingNavigationKeyAction(closedRows, 'intro', 'End'), { type: 'focus', id: 'end' })
  assert.deepEqual(headingNavigationKeyAction(closedRows, 'end', 'Home'), { type: 'focus', id: 'intro' })
  assert.equal(headingNavigationKeyAction([], 'missing', 'ArrowDown'), null)
})

test('search keyboard navigation preserves temporarily expanded ancestry and does not collapse matches', () => {
  const rows = headingNavigationRows(buildHeadingTree(headings), new Set(['intro']), 'mac')
  assert.equal(headingNavigationKeyAction(rows, 'intro', 'ArrowLeft', false), null)
  assert.deepEqual(headingNavigationKeyAction(rows, 'details', 'ArrowLeft', false), { type: 'focus', id: 'intro' })
  assert.deepEqual(headingNavigationKeyAction(rows, 'details', 'ArrowRight', false), { type: 'focus', id: 'mac' })
})
