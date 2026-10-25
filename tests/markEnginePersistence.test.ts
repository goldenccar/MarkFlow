import test from 'node:test'
import assert from 'node:assert/strict'
import { MarkEngine, MarkEngineError, encodeMarkSnapshot, decodeMarkSnapshot, type MarkReferences, type MarkSnapshot } from '../src/engine/index'

const factory = () => { let next = 0; return () => `copy-${++next}` }
const invalid = (error: unknown) => error instanceof MarkEngineError
interface Payload { rows: string[][]; label: string; assetId: string }
const payload = (rows: string[][] = []): Payload => ({ rows, label: 'cell', assetId: 'cell' })
const references: MarkReferences<Payload> = {
  get: value => value.rows.flat(),
  remap: (value, ids) => ({ ...value, rows: value.rows.map(row => row.map(id => ids.get(id) ?? id)) }),
}

test('copy remaps subtree references after allocating every ID, retaining external references and ordinary strings', () => {
  const engine = new MarkEngine<Payload>([
    { id: 'table', content: payload([['cell', 'other', 'outside']]), children: [
      { id: 'cell', content: payload([['other', 'table', 'cell']]), style: { fontSize: 20 } },
      { id: 'other', content: payload([['cell']]) },
    ] },
    { id: 'outside', content: payload() },
  ], { references, idFactory: factory() })
  const next = engine.transact([{ type: 'copy', id: 'table', parentId: null, index: 2 }])
  const copied = next.roots[2]
  assert.deepEqual(copied.content.rows, [['copy-2', 'copy-3', 'outside']])
  assert.deepEqual(copied.children[0].content.rows, [['copy-3', 'copy-1', 'copy-2']])
  assert.deepEqual(copied.children[1].content.rows, [['copy-2']])
  assert.deepEqual(copied.children[0].style, { fontSize: 20 })
  assert.equal(copied.content.assetId, 'cell')
  assert.equal(copied.content.label, 'cell')
  assert.deepEqual(next.roots[0].content.rows, [['cell', 'other', 'outside']])
  engine.transact([{ type: 'remove', id: 'table' }])
  assert.deepEqual(engine.snapshot.roots[1].content.rows, [['copy-2', 'copy-3', 'outside']])
  copied.content.rows[0][0] = 'mutation'
  assert.equal(engine.snapshot.roots[1].content.rows[0][0], 'copy-2')
})

test('reference validation accepts forward references and same-batch repair, rejecting dangling results atomically', () => {
  const engine = new MarkEngine<Payload>([], { references })
  engine.transact([
    { type: 'insert', parentId: null, index: 0, marks: [{ id: 'referrer', content: payload([['target']]) }] },
    { type: 'insert', parentId: null, index: 1, marks: [{ id: 'target', content: payload() }] },
  ])
  const before = engine.snapshot
  assert.throws(() => engine.transact([
    { type: 'style', id: 'referrer', patch: { fontSize: 24 } },
    { type: 'remove', id: 'target' },
  ]), error => error instanceof MarkEngineError && error.code === 'invalid-reference')
  assert.deepEqual(engine.snapshot, before)
  assert.throws(() => engine.reconcile([{ id: 'referrer', content: payload([['missing']]) }]), invalid)
  assert.deepEqual(engine.snapshot, before)
  const repaired = engine.transact([
    { type: 'remove', id: 'target' },
    { type: 'edit', id: 'referrer', content: payload() },
  ])
  assert.deepEqual(repaired.retiredIds, ['target'])
  assert.deepEqual(engine.undo()!.roots, before.roots)
  engine.transact([{ type: 'remove', id: 'target' }, { type: 'remove', id: 'referrer' }])
  assert.deepEqual(engine.snapshot.roots, [])
  assert.throws(() => new MarkEngine([{ id: 'bad', content: payload([['absent']]) }], { references }), invalid)
})

test('reference callback failures and invalid remap output never commit, reserve identities, or retain mutable results', () => {
  let shouldThrow = true
  let retained: Payload | undefined
  const adapter: MarkReferences<Payload> = {
    get: references.get,
    remap: value => {
      if (shouldThrow) throw new Error('adapter failed')
      retained = { ...value, rows: [] }
      return retained
    },
  }
  const engine = new MarkEngine([{ id: 'cell', content: payload() }], { references: adapter, idFactory: () => 'copied' })
  const before = engine.snapshot
  assert.throws(() => engine.transact([{ type: 'copy', id: 'cell', parentId: null, index: 1 }]), /adapter failed/)
  assert.deepEqual(engine.snapshot, before)
  assert.equal(engine.undo(), null)
  shouldThrow = false
  engine.transact([{ type: 'copy', id: 'cell', parentId: null, index: 1 }])
  retained!.label = 'later mutation'
  assert.equal(engine.snapshot.roots[1].content.label, 'cell')
  const invalidOutput = new MarkEngine([{ id: 'cell', content: payload() }], {
    idFactory: factory(), references: { ...references, remap: () => undefined as never },
  })
  assert.throws(() => invalidOutput.transact([{ type: 'copy', id: 'cell', parentId: null, index: 1 }]), invalid)
  assert.equal(invalidOutput.snapshot.revision, 0)
})

test('copy rejects adapters that miss internal references, alter external references, or mutate the shared ID map', () => {
  for (const remap of [
    (value: Payload) => value,
    (value: Payload, ids: ReadonlyMap<string, string>) => ({ ...value, rows: value.rows.map(row => row.map(id => ids.get(id) ?? 'table')) }),
    (value: Payload, ids: ReadonlyMap<string, string>) => { (ids as Map<string, string>).set('cell', 'table'); return value },
  ]) {
    const engine = new MarkEngine<Payload>([
      { id: 'table', content: payload([['cell', 'outside']]), children: [{ id: 'cell', content: payload() }] },
      { id: 'outside', content: payload() },
    ], { references: { ...references, remap }, idFactory: factory() })
    const before = engine.snapshot
    assert.throws(() => engine.transact([{ type: 'copy', id: 'table', parentId: null, index: 2 }]))
    assert.deepEqual(engine.snapshot, before)
    assert.equal(engine.undo(), null)
  }
})

test('content and reference validation callbacks cannot retain or mutate committed payloads', () => {
  const retained: Payload[] = []
  const options = {
    validateContent: (value: Payload) => { retained.push(value); value.label = 'validator mutation'; return true },
    references: { ...references, get: (value: Payload) => { retained.push(value); value.label = 'reference mutation'; return value.rows.flat() } },
  }
  const engine = new MarkEngine([{ id: 'cell', content: payload() }], options)
  engine.transact([{ type: 'edit', id: 'cell', content: payload() }])
  const loaded = MarkEngine.fromSnapshot(decodeMarkSnapshot<Payload>(encodeMarkSnapshot(engine.snapshot, options), options), options)
  retained.forEach(value => { value.label = 'late mutation'; value.rows.push(['missing']) })
  assert.equal(engine.snapshot.roots[0].content.label, 'cell')
  assert.deepEqual(engine.snapshot.roots[0].content.rows, [])
  assert.deepEqual(loaded.snapshot, engine.snapshot)
})

test('unconfigured payloads remain opaque; no implicit replacement of ID-looking values', () => {
  const engine = new MarkEngine([{ id: 'table', content: payload([['unresolved']]) }], { idFactory: factory() })
  const next = engine.transact([{ type: 'copy', id: 'table', parentId: null, index: 1 }])
  assert.deepEqual(next.roots[0].content, next.roots[1].content)
})

test('versioned snapshots round-trip all state; loading preserves revision, tombstones, ownership and a fresh undo boundary', () => {
  const original = new MarkEngine<Payload>([
    { id: 'table', content: payload([['cell']]), children: [{ id: 'cell', content: payload(), style: { fontFamily: 'test-font', fontSize: 20 } }] },
    { id: 'deleted', content: payload() },
  ], { references })
  original.transact([{ type: 'remove', id: 'deleted' }])
  original.transact([{ type: 'style', id: 'table', patch: { fontSize: 24 } }])
  const wire = encodeMarkSnapshot(original.snapshot, { references })
  assert.equal(JSON.parse(wire).schemaVersion, 1)
  assert.equal(JSON.parse(wire).format, 'oops-mark')
  const saved = decodeMarkSnapshot<Payload>(wire, { references })
  assert.deepEqual(saved, original.snapshot)
  const reopened = MarkEngine.fromSnapshot(saved, { references, idFactory: factory() })
  const baseline = reopened.snapshot
  saved.roots[0].content.rows[0][0] = 'mutated'
  saved.retiredIds.length = 0
  assert.deepEqual(reopened.snapshot, baseline)
  assert.equal(reopened.undo(), null)
  assert.equal(reopened.redo(), null)
  assert.throws(() => reopened.transact([{ type: 'insert', parentId: null, index: 1, marks: [{ id: 'deleted', content: payload() }] }]), /cannot be reused/)
  assert.throws(() => reopened.transact([], { expectedRevision: 0 }), /changed since/)
  reopened.transact([{ type: 'copy', id: 'table', parentId: null, index: 1 }], { expectedRevision: 2 })
  const undo = reopened.undo()!
  assert.equal(undo.revision, 4)
  assert.deepEqual(undo.roots, baseline.roots)
  assert.deepEqual(new Set(undo.retiredIds), new Set(['deleted', 'copy-1', 'copy-2']))
  assert.throws(() => reopened.transact([{ type: 'insert', parentId: null, index: 1, marks: [{ id: 'copy-1', content: payload() }] }]), /cannot be reused/)
  const redo = reopened.redo()!
  assert.equal(redo.revision, 5)
  assert.deepEqual(redo.retiredIds, ['deleted'])
})

test('snapshot boundaries reject incompatible, incomplete and non-JSON data instead of silently repairing it', () => {
  const snapshot = new MarkEngine([{ id: 'a', content: { value: 1 } }]).snapshot
  const wire = JSON.parse(encodeMarkSnapshot(snapshot))
  const rejected = [
    { ...wire, schemaVersion: 2 }, { ...wire, format: 'other' }, { ...wire, extra: true },
    { ...wire, snapshot: { ...snapshot, revision: -1 } },
    { ...wire, snapshot: { ...snapshot, revision: 1.5 } },
    { ...wire, snapshot: { ...snapshot, revision: Number.MAX_SAFE_INTEGER } },
    { ...wire, snapshot: { ...snapshot, retiredIds: ['a'] } },
    { ...wire, snapshot: { ...snapshot, retiredIds: ['old', 'old'] } },
    { ...wire, snapshot: { ...snapshot, roots: [snapshot.roots[0], snapshot.roots[0]] } },
    ...['id', 'content', 'style', 'children'].map(key => {
      const node = { ...snapshot.roots[0] } as Record<string, unknown>; delete node[key]
      return { ...wire, snapshot: { ...snapshot, roots: [node] } }
    }),
    { ...wire, snapshot: { ...snapshot, roots: [{ ...snapshot.roots[0], extra: true }] } },
    { ...wire, snapshot: { ...snapshot, roots: [{ ...snapshot.roots[0], style: { fontSize: 0 } }] } },
  ]
  for (const value of rejected) assert.throws(() => decodeMarkSnapshot(JSON.stringify(value)), invalid)
  assert.throws(() => decodeMarkSnapshot('{broken'), invalid)
  const invalidContents = [undefined, NaN, Infinity, new Date(), Array(2), { [Symbol('hidden')]: 'lost' }]
  for (const value of invalidContents) {
    const bad = { ...snapshot, roots: [{ ...snapshot.roots[0], content: value }] } as MarkSnapshot<unknown>
    assert.throws(() => encodeMarkSnapshot(bad), invalid)
    assert.throws(() => MarkEngine.fromSnapshot(bad), invalid)
  }
  assert.throws(() => MarkEngine.fromSnapshot(snapshot, { validateContent: () => false }), invalid)
  const dangling = new MarkEngine([{ id: 'a', content: payload([['missing']]) }]).snapshot
  assert.throws(() => decodeMarkSnapshot(encodeMarkSnapshot(dangling), { references }), invalid)
  assert.throws(() => MarkEngine.fromSnapshot(dangling, { references }), invalid)
  const exhausted = MarkEngine.fromSnapshot({ ...snapshot, revision: Number.MAX_SAFE_INTEGER - 1 })
  assert.throws(() => exhausted.transact([{ type: 'edit', id: 'a', content: { value: 2 } }]), /exhausted/)
  assert.throws(() => exhausted.reconcile([]), /exhausted/)
  assert.equal(exhausted.snapshot.revision, Number.MAX_SAFE_INTEGER - 1)
  assert.throws(() => new MarkEngine(Array(2)), invalid)
})

test('mixed structural batches refresh cached locations while edit/style batches keep targeting current objects', () => {
  const engine = new MarkEngine<string>([
    { id: 'group', content: 'g', children: [{ id: 'a', content: 'a' }, { id: 'b', content: 'b' }] },
    { id: 'outside', content: 'outside' },
  ], { idFactory: factory() })
  const next = engine.transact([
    { type: 'edit', id: 'a', content: 'before move' },
    { type: 'style', id: 'a', patch: { fontSize: 20 } },
    { type: 'move', id: 'a', parentId: null, index: 2 },
    { type: 'edit', id: 'a', content: 'after move' },
    { type: 'split', id: 'a', parts: [{ content: 'left' }, { content: 'right' }] },
    { type: 'edit', id: 'copy-1', content: 'right edited' },
    { type: 'merge', ids: ['a', 'copy-1'], content: 'merged' },
    { type: 'style', id: 'a', patch: { fontSize: 22 } },
    { type: 'copy', id: 'group', parentId: 'a', index: 0 },
    { type: 'edit', id: 'copy-3', content: 'copied b' },
    { type: 'insert', parentId: 'copy-2', index: 1, marks: [{ id: 'inserted', content: 'new' }] },
    { type: 'move', id: 'inserted', parentId: null, index: 0 },
    { type: 'remove', id: 'group' },
    { type: 'edit', id: 'inserted', content: 'final' },
  ])
  assert.deepEqual(next.roots.map(node => node.id), ['inserted', 'outside', 'a'])
  assert.equal(next.roots[0].content, 'final')
  assert.equal(next.roots[2].content, 'merged')
  assert.equal(next.roots[2].style.fontSize, 22)
  assert.equal(next.roots[2].children[0].children[0].content, 'copied b')
  assert.deepEqual(new Set(next.retiredIds), new Set(['copy-1', 'group', 'b']))
  assert.throws(() => engine.transact([{ type: 'remove', id: 'a' }, { type: 'edit', id: 'copy-3', content: 'gone' }]), /Unknown Mark ID/)
  assert.deepEqual(engine.snapshot, next)
})
