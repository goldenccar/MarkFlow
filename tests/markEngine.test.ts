import test from 'node:test'
import assert from 'node:assert/strict'
import { applyMarkCommands, createMarkId, MarkEngine, MarkEngineError, reconcileSnapshot, resolveTypography, type MarkInput, type MarkSnapshot } from '../src/engine/runtime'
import { SnapshotHistory } from '../src/engine/history'

const factory = () => { let next = 0; return () => `generated-${++next}` }
const empty = <C>(): MarkSnapshot<C> => ({ revision: 0, roots: [], retiredIds: [] })
const leaf = (id: string, content = id): MarkInput<string> => ({ id, content })
const code = (expected: MarkEngineError['code']) => (error: unknown) => error instanceof MarkEngineError && error.code === expected

test('all adapter Marks get identities; pure reconciliation is atomic and rejects reused/deleted IDs', () => {
  const idFactory = factory()
  const first = reconcileSnapshot(empty<string>(), [{ content: 'alpha' }, leaf('explicit')], { idFactory })
  assert.deepEqual(first.roots.map(node => node.id), ['generated-1', 'explicit'])
  const changed = reconcileSnapshot(first, [{ id: first.roots[0].id, content: 'alpha edited' }, { content: 'new' }], { idFactory, expectedRevision: 1 })
  assert.equal(changed.roots[0].id, first.roots[0].id)
  assert.deepEqual(changed.retiredIds, ['explicit'])
  assert.throws(() => reconcileSnapshot(changed, [leaf('explicit')]), code('retired-id'))
  assert.throws(() => reconcileSnapshot(first, [leaf('same'), leaf('same')]), code('duplicate-id'))
  assert.throws(() => reconcileSnapshot(first, [], { expectedRevision: 0 }), code('revision-conflict'))
  assert.equal(first.roots[0].content, 'alpha')
  assert.equal(first.revision, 1)
  assert.deepEqual(first.retiredIds, [])
  assert.match(createMarkId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('edit/move/style preserve identity; defaults and ancestor typography remain inherited', () => {
  const engine = new MarkEngine<string>([{ id: 'group', content: 'container', style: { fontFamily: 'parent-font' }, children: [{ ...leaf('a'), style: { fontSize: 24 } }, leaf('b')] }, leaf('outside')])
  const result = engine.transact([
    { type: 'edit', id: 'a', content: 'edited' },
    { type: 'move', id: 'a', parentId: 'group', index: 1 },
    { type: 'style', id: 'a', patch: { fontSize: null } },
  ])
  assert.deepEqual(result.roots[0].children.map(node => node.id), ['b', 'a'])
  assert.equal(result.roots[0].children[1].content, 'edited')
  assert.deepEqual(resolveTypography(result, 'a', { fontFamily: 'default', fontSize: 16 }), { fontFamily: 'parent-font', fontSize: 16 })
  assert.deepEqual(result.roots[0].children[1].style, {})
  engine.transact([{ type: 'move', id: 'a', parentId: null, index: 2 }])
  assert.deepEqual(resolveTypography(engine.snapshot, 'a', { fontFamily: 'default', fontSize: 16 }), { fontFamily: 'default', fontSize: 16 })
})

test('copy recursively allocates fresh identities, preserves content/styles, and shares no mutable objects', () => {
  const engine = new MarkEngine([{ id: 'group', content: { text: 'group' }, style: { fontSize: 20 }, children: [{ id: 'child', content: { text: 'child' }, style: { fontFamily: 'kaiti' } }] }], { idFactory: factory() })
  const copied = engine.transact([{ type: 'copy', id: 'group', parentId: null, index: 1 }])
  assert.equal(copied.roots[1].id, 'generated-1')
  assert.equal(copied.roots[1].children[0].id, 'generated-2')
  assert.deepEqual(copied.roots[1].children[0].style, { fontFamily: 'kaiti' })
  engine.transact([{ type: 'edit', id: 'generated-2', content: { text: 'changed copy' } }])
  assert.equal(engine.snapshot.roots[0].children[0].content.text, 'child')
  copied.roots[0].content.text = 'outside mutation'
  assert.equal(engine.snapshot.roots[0].content.text, 'group')
})

test('split keeps first identity/style; new parts default to inheritance and may explicitly override', () => {
  const engine = new MarkEngine([{ id: 'a', content: 'one two three', style: { fontFamily: 'kaiti', fontSize: 24 } }], { idFactory: factory() })
  const split = engine.transact([{ type: 'split', id: 'a', parts: [{ content: 'one' }, { content: 'two' }, { content: 'three', style: { fontSize: 18 } }] }])
  assert.deepEqual(split.roots.map(node => node.id), ['a', 'generated-1', 'generated-2'])
  assert.deepEqual(split.roots.map(node => node.style), [{ fontFamily: 'kaiti', fontSize: 24 }, {}, { fontSize: 18 }])
  const merged = engine.transact([{ type: 'merge', ids: ['a', 'generated-1', 'generated-2'], content: 'one two three' }])
  assert.equal(merged.roots[0].id, 'a')
  assert.deepEqual(merged.roots[0].style, { fontFamily: 'kaiti', fontSize: 24 })
  assert.deepEqual(merged.retiredIds, ['generated-1', 'generated-2'])
  assert.throws(() => engine.transact([{ type: 'insert', parentId: null, index: 1, marks: [leaf('generated-1')] }]), code('retired-id'))
})

test('a batch rejects bad topology, collisions and invalid payloads without committing earlier commands', () => {
  const engine = new MarkEngine<string>([{ id: 'group', content: 'group', children: [leaf('child')] }, leaf('a'), leaf('b'), leaf('c')])
  const original = engine.snapshot
  const badBatches = [
    [{ type: 'edit', id: 'a', content: 'should not commit' }, { type: 'remove', id: 'missing' }],
    [{ type: 'move', id: 'group', parentId: 'child', index: 0 }],
    [{ type: 'move', id: 'a', parentId: null, index: 99 }],
    [{ type: 'insert', parentId: null, index: 0, marks: [leaf('a')] }],
    [{ type: 'merge', ids: ['a', 'c'], content: 'nonadjacent' }],
    [{ type: 'merge', ids: ['b', 'a'], content: 'reverse' }],
    [{ type: 'split', id: 'group', parts: [{ content: 'left' }, { content: 'right' }] }],
    [{ type: 'style', id: 'a', patch: { fontSize: Infinity } }],
    [{ type: 'edit', id: 'a', content: undefined }],
  ]
  for (const commands of badBatches) {
    assert.throws(() => engine.transact(commands as never))
    assert.deepEqual(engine.snapshot, original)
  }
  assert.equal(engine.undo(), null)
})

test('remove retires the whole subtree; atomic remove/reinsert cannot repurpose an ID', () => {
  const before = reconcileSnapshot(empty<string>(), [{ id: 'group', content: 'g', children: [leaf('child')] }, leaf('outside')])
  const removed = applyMarkCommands(before, [{ type: 'remove', id: 'group' }])
  assert.deepEqual(removed.retiredIds, ['group', 'child'])
  assert.deepEqual(removed.roots.map(node => node.id), ['outside'])
  assert.throws(() => applyMarkCommands(before, [{ type: 'remove', id: 'group' }, { type: 'insert', parentId: null, index: 0, marks: [leaf('group')] }]), code('retired-id'))
  assert.equal(before.roots.length, 2)
})

test('undo/redo restores identities atomically, advances versions, and reserves abandoned redo IDs', () => {
  const engine = new MarkEngine([leaf('a')], { idFactory: factory() })
  engine.transact([{ type: 'copy', id: 'a', parentId: null, index: 1 }])
  engine.transact([{ type: 'remove', id: 'a' }])
  const restored = engine.undo()!
  assert.deepEqual(restored.roots.map(node => node.id), ['a', 'generated-1'])
  assert.equal(restored.revision, 3)
  const redone = engine.redo()!
  assert.deepEqual(redone.roots.map(node => node.id), ['generated-1'])
  assert.equal(redone.revision, 4)
  engine.undo(); engine.undo()
  assert.deepEqual(engine.snapshot.roots.map(node => node.id), ['a'])
  assert.deepEqual(engine.snapshot.retiredIds, ['generated-1'])
  assert.throws(() => engine.reconcile([leaf('a'), leaf('generated-1')]), code('retired-id'))
  engine.transact([{ type: 'edit', id: 'a', content: 'new branch' }])
  assert.equal(engine.redo(), null)
  assert.throws(() => engine.transact([{ type: 'remove', id: 'a' }], { expectedRevision: 0 }), code('revision-conflict'))
})

test('adapter snapshots handle arbitrary JSON content and never retain caller-owned references', () => {
  const supplied = { kind: 'shape', bounds: { x: 10, y: 20 }, asset: 'asset-1' }
  const engine = new MarkEngine([{ id: 'slide-object', content: supplied }], { validateContent: value => value.kind === 'shape' })
  supplied.bounds.x = 999
  assert.equal(engine.snapshot.roots[0].content.bounds.x, 10)
  const before = engine.snapshot
  assert.throws(() => engine.reconcile([{ id: 'slide-object', content: { ...supplied, kind: 'unsupported' } }]), code('invalid'))
  assert.deepEqual(engine.snapshot, before)
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
  assert.throws(() => reconcileSnapshot(empty(), [{ content: cyclic }]), code('invalid'))
  assert.throws(() => reconcileSnapshot(empty(), [{ content: new Date() }]), code('invalid'))
  assert.throws(() => reconcileSnapshot(empty(), [{ content: 'x' }], { idFactory: () => '' }), code('invalid'))
})

test('repeated same-ID edits do not grow tombstones; IDs remain stable for unstyled Marks', () => {
  let snapshot = reconcileSnapshot(empty<string>(), [leaf('a'), leaf('b')])
  for (let i = 0; i < 100; i++) snapshot = reconcileSnapshot(snapshot, [leaf('a', `edit ${i}`), leaf('b')])
  assert.deepEqual(snapshot.retiredIds, [])
  assert.deepEqual(snapshot.roots.map(node => node.id), ['a', 'b'])
  assert.deepEqual(snapshot.roots.map(node => node.style), [{}, {}])
})

test('generic snapshot history groups edits, bounds retained checkpoints and detaches caller data', () => {
  const initial = { values: [0] }
  const history = new SnapshotHistory(initial, { maxEntries: 2, maxBytes: 60, groupMs: 600 })
  initial.values.push(99)
  assert.deepEqual(history.current, { values: [0] })
  history.change({ values: [1] }, 'typing', 10)
  history.change({ values: [2] }, 'typing', 20)
  assert.deepEqual(history.undo(), { values: [0] })
  assert.deepEqual(history.redo(), { values: [2] })
  history.boundary()
  history.change({ values: [3] }, 'typing', 30)
  history.change({ values: [4] }, 'typing', 1000)
  assert.deepEqual(history.undo(), { values: [3] })
  assert.deepEqual(history.undo(), { values: [2] })
  assert.equal(history.undo(), null)
  assert.ok(history.bytes <= 100)
  const oversized = new SnapshotHistory('start', { maxBytes: 1 })
  oversized.change('one'); oversized.change('two')
  assert.equal(oversized.undo(), 'one')
  assert.equal(oversized.undo(), null)
})
