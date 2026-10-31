import { createMarkId, patchTypography, type MarkTypography } from './mark.js'
import { SnapshotHistory } from './history.js'

export { createMarkId } from './mark.js'
export interface MarkInput<C> { id?: string; content: C; style?: MarkTypography; children?: MarkInput<C>[] }
export interface MarkNode<C> { id: string; content: C; style: MarkTypography; children: MarkNode<C>[] }
export interface MarkSnapshot<C> { revision: number; roots: MarkNode<C>[]; retiredIds: string[] }
/** Only same-document Mark references belong here; asset IDs and arbitrary text are not references. */
export interface MarkReferences<C> {
  get(content: C): readonly string[]
  /** Map only declared references present in idMap; keep other references unchanged. */
  remap(content: C, idMap: ReadonlyMap<string, string>): C
}
export interface EngineOptions<C> { idFactory?: () => string; validateContent?: (content: C) => boolean | void; references?: MarkReferences<C> }
export interface MarkSnapshotEnvelope<C> { format: 'oops-mark'; schemaVersion: 1; snapshot: MarkSnapshot<C> }
export interface ReconcileOptions<C> extends EngineOptions<C> { expectedRevision?: number }
export interface TransactionOptions { expectedRevision?: number; group?: string; now?: number }
export type TypographyPatch = { fontFamily?: string | null; fontSize?: number | null }
export type MarkCommand<C> =
  | { type: 'insert'; parentId: string | null; index: number; marks: MarkInput<C>[] }
  | { type: 'edit'; id: string; content: C }
  | { type: 'style'; id: string; patch: TypographyPatch | null }
  | { type: 'move' | 'copy'; id: string; parentId: string | null; index: number }
  | { type: 'split'; id: string; parts: Array<{ content: C; style?: MarkTypography }> }
  | { type: 'merge'; ids: string[]; content: C }
  | { type: 'remove'; id: string }

export class MarkEngineError extends Error {
  constructor(public readonly code: 'invalid' | 'duplicate-id' | 'retired-id' | 'unknown-id' | 'revision-conflict' | 'invalid-reference', message: string) {
    super(message); this.name = 'MarkEngineError'
  }
}
function fail(message: string): never { throw new MarkEngineError('invalid', message) }
function validId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) fail('Mark ID must be a nonempty portable identifier')
}
function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
/** Content is portable JSON data, never an executable callback, class instance or cyclic object. */
function copyData<T>(value: T, ancestors = new Set<object>()): T {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('Content contains a non-finite number'); return value }
  if (!Array.isArray(value) && !record(value)) fail('Content must be JSON data')
  if (ancestors.has(value as object)) fail('Content contains a cycle')
  ancestors.add(value as object)
  const array = Array.isArray(value)
  const keys = Reflect.ownKeys(value as object).filter(key => !array || key !== 'length')
  if (array && (keys.length !== value.length || keys.some((key, at) => key !== String(at)))) fail('Content contains a sparse array or extra array properties')
  const entries = keys.map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (typeof key !== 'string' || !descriptor.enumerable || !('value' in descriptor)) fail('Content contains a non-JSON property')
    return [key, copyData(descriptor.value, ancestors)] as const
  })
  const copy = array ? entries.map(([, item]) => item) : Object.fromEntries(entries)
  ancestors.delete(value as object)
  return copy as T
}
function content<C>(value: C, options: EngineOptions<C>): C {
  const owned = copyData(value)
  if (options.validateContent?.(copyData(owned)) === false) fail('Content rejected by the format adapter')
  return owned
}
function style(value: MarkTypography = {}): MarkTypography {
  if (!record(value) || Object.keys(value).some(key => !['fontFamily', 'fontSize'].includes(key))) fail('Unknown typography property')
  if (value.fontFamily !== undefined && (typeof value.fontFamily !== 'string' || !value.fontFamily.trim() || value.fontFamily.length > 256 || /[\x00-\x1f]/.test(value.fontFamily))) fail('Invalid font family')
  if (value.fontSize !== undefined && (typeof value.fontSize !== 'number' || !Number.isFinite(value.fontSize) || value.fontSize <= 0)) fail('Invalid font size')
  return { ...(value.fontFamily !== undefined ? { fontFamily: value.fontFamily } : {}), ...(value.fontSize !== undefined ? { fontSize: value.fontSize } : {}) }
}
interface Location<C> { node: MarkNode<C>; siblings: MarkNode<C>[]; parentId: string | null }
function indexTree<C>(roots: MarkNode<C>[]): Map<string, Location<C>> {
  if (!Array.isArray(roots)) fail('Mark roots must be an array')
  const index = new Map<string, Location<C>>()
  const visit = (nodes: MarkNode<C>[], parentId: string | null, depth: number) => {
    if (depth > 256) fail('Mark tree exceeds the nesting limit')
    for (const node of nodes) {
      if (!record(node)) fail('Invalid Mark node')
      validId(node.id)
      if (index.has(node.id)) throw new MarkEngineError('duplicate-id', `Duplicate Mark ID: ${node.id}`)
      if (!Array.isArray(node.children)) fail('Mark children must be an array')
      index.set(node.id, { node, siblings: nodes, parentId })
      visit(node.children, node.id, depth + 1)
    }
  }
  visit(roots, null, 0)
  return index
}
function inspect<C>(before: MarkSnapshot<C>, expected?: number) {
  if (!record(before) || !Number.isSafeInteger(before.revision) || before.revision < 0 || before.revision >= Number.MAX_SAFE_INTEGER) fail('Invalid snapshot revision')
  if (expected !== undefined && expected !== before.revision) throw new MarkEngineError('revision-conflict', 'Mark document changed since the command was prepared')
  const live = indexTree(before.roots)
  if (!Array.isArray(before.retiredIds)) fail('Retired IDs must be an array')
  const retired = new Set<string>()
  for (const id of before.retiredIds) {
    validId(id)
    if (live.has(id) || retired.has(id)) throw new MarkEngineError('duplicate-id', `ID is both live/retired or repeated: ${id}`)
    retired.add(id)
  }
  return { live, retired }
}
function buildNodes<C>(inputs: MarkInput<C>[], options: EngineOptions<C>, allowed: Set<string>, reserved: Set<string>, seen = new Set<string>(), ancestors = new Set<object>(), depth = 0): MarkNode<C>[] {
  if (!Array.isArray(inputs) || depth > 256) fail('Invalid Mark children or excessive nesting')
  return Array.from(inputs, input => {
    if (!record(input) || ancestors.has(input)) fail('Invalid or cyclic Mark input')
    const id = input.id ?? (options.idFactory ?? createMarkId)()
    validId(id)
    if (seen.has(id)) throw new MarkEngineError('duplicate-id', `Duplicate Mark ID: ${id}`)
    if (reserved.has(id) && !(input.id !== undefined && allowed.has(id))) throw new MarkEngineError('retired-id', `Mark ID cannot be reused: ${id}`)
    seen.add(id); reserved.add(id); ancestors.add(input)
    const node = { id, content: content(input.content, options), style: style(input.style), children: buildNodes(input.children ?? [], options, allowed, reserved, seen, ancestors, depth + 1) }
    ancestors.delete(input)
    return node
  })
}

function declaredReferences<C>(value: C, adapter: MarkReferences<C>): readonly string[] {
  const references = adapter.get(copyData(value))
  if (!Array.isArray(references)) fail('Mark references must be an array')
  for (const id of references) validId(id)
  return references
}

/** One immutable view avoids exposing mutators or cloning the entire ID map for each payload. */
function readonlyIds(ids: Map<string, string>): ReadonlyMap<string, string> {
  const view: ReadonlyMap<string, string> = {
    size: ids.size, get: id => ids.get(id), has: id => ids.has(id),
    entries: () => ids.entries(), keys: () => ids.keys(), values: () => ids.values(),
    [Symbol.iterator]: () => ids[Symbol.iterator](),
    forEach: (callback, thisArg) => ids.forEach((value, key) => callback.call(thisArg, value, key, view)),
  }
  return Object.freeze(view)
}

function validateReferences<C>(index: Map<string, Location<C>>, options: EngineOptions<C>): void {
  if (!options.references) return
  for (const { node } of index.values()) {
    // Adapter callbacks receive detached data, so they cannot mutate a committed snapshot later.
    for (const id of declaredReferences(node.content, options.references)) {
      if (!index.has(id)) throw new MarkEngineError('invalid-reference', `Mark ${node.id} references missing Mark: ${id}`)
    }
  }
}

function exactKeys(value: Record<string, unknown>, expected: string[]): void {
  const keys = Object.keys(value)
  if (keys.length !== expected.length || keys.some(key => !expected.includes(key))) fail('Invalid snapshot fields')
}

/** Persisted snapshots are complete values, never partial MarkInput objects with generated defaults. */
function copySnapshot<C>(value: unknown, options: EngineOptions<C>): MarkSnapshot<C> {
  const snapshot = copyData(value) as MarkSnapshot<C>
  const { live, retired } = inspect(snapshot)
  exactKeys(snapshot as unknown as Record<string, unknown>, ['revision', 'roots', 'retiredIds'])
  for (const { node } of live.values()) {
    exactKeys(node as unknown as Record<string, unknown>, ['id', 'content', 'style', 'children'])
    if (!record(node.style)) fail('Snapshot typography must be an object')
    node.style = style(node.style)
    if (options.validateContent?.(copyData(node.content)) === false) fail('Content rejected by the format adapter')
  }
  validateReferences(live, options)
  return { revision: snapshot.revision, roots: snapshot.roots, retiredIds: [...retired] }
}

/** Schema version describes the wire format, independently of the document's transaction revision. */
export function encodeMarkSnapshot<C>(snapshot: MarkSnapshot<C>, options: EngineOptions<C> = {}): string {
  const envelope: MarkSnapshotEnvelope<C> = { format: 'oops-mark', schemaVersion: 1, snapshot: copySnapshot<C>(snapshot, options) }
  return JSON.stringify(envelope)
}

export function decodeMarkSnapshot<C>(json: string, options: EngineOptions<C> = {}): MarkSnapshot<C> {
  if (typeof json !== 'string') fail('Snapshot JSON must be a string')
  let envelope: unknown
  try { envelope = JSON.parse(json) } catch { fail('Invalid snapshot JSON') }
  if (!record(envelope)) fail('Invalid snapshot envelope')
  exactKeys(envelope, ['format', 'schemaVersion', 'snapshot'])
  if (envelope.format !== 'oops-mark' || envelope.schemaVersion !== 1) fail('Unsupported Mark snapshot format or schema version')
  return copySnapshot<C>(envelope.snapshot, options)
}

/** Authoritative adapter mapping; absent IDs get new identities, removed identities become tombstones. */
export function reconcileSnapshot<C>(before: MarkSnapshot<C>, inputs: MarkInput<C>[], options: ReconcileOptions<C> = {}): MarkSnapshot<C> {
  const { live, retired } = inspect(before, options.expectedRevision)
  if (before.revision >= Number.MAX_SAFE_INTEGER - 1) fail('Snapshot revision exhausted')
  const seen = new Set<string>()
  const roots = buildNodes(inputs, options, new Set(live.keys()), new Set([...retired, ...live.keys()]), seen)
  for (const id of live.keys()) if (!seen.has(id)) retired.add(id)
  if (options.references) validateReferences(indexTree(roots), options)
  return { revision: before.revision + 1, roots, retiredIds: [...retired] }
}

/** Document defaults and ancestor overrides are resolved without persisting the computed values. */
export function resolveTypography<C>(snapshot: MarkSnapshot<C>, id: string, defaults: MarkTypography = {}): MarkTypography {
  const { live } = inspect(snapshot)
  const chain: MarkTypography[] = []
  let current: string | null = id
  while (current !== null) {
    const item = live.get(current)
    if (!item) throw new MarkEngineError('unknown-id', `Unknown Mark ID: ${current}`)
    chain.push(item.node.style); current = item.parentId
  }
  return chain.reverse().reduce((value, override) => ({ ...value, ...style(override) }), style(defaults))
}

/** Commands run on a detached working tree; any failure leaves the caller's snapshot untouched. */
export function applyMarkCommands<C>(before: MarkSnapshot<C>, commands: MarkCommand<C>[], options: ReconcileOptions<C> = {}): MarkSnapshot<C> {
  const { live, retired } = inspect(before, options.expectedRevision)
  if (before.revision >= Number.MAX_SAFE_INTEGER - 1) fail('Snapshot revision exhausted')
  if (!Array.isArray(commands)) fail('Commands must be an array')
  const roots = buildNodes(before.roots, options, new Set(live.keys()), new Set(retired))
  const reserved = new Set([...retired, ...live.keys()])
  let cachedIndex: Map<string, Location<C>> | undefined
  const index = () => cachedIndex ??= indexTree(roots)
  const removeIds = (node: MarkNode<C>) => { retired.add(node.id); node.children.forEach(removeIds) }
  for (const command of commands) {
    if (!record(command)) fail('Invalid Mark command')
    const location = (id: string) => {
      const result = index().get(id)
      if (!result) throw new MarkEngineError('unknown-id', `Unknown Mark ID: ${String(id)}`)
      return result
    }
    const destination = (parentId: string | null) => parentId === null ? roots : location(parentId).node.children
    const insertAt = (nodes: MarkNode<C>[], at: number, inserted: MarkNode<C>[]) => {
      if (!Number.isSafeInteger(at) || at < 0 || at > nodes.length) fail('Invalid insertion index')
      nodes.splice(at, 0, ...inserted)
    }
    switch (command.type) {
      case 'insert': {
        if (!Array.isArray(command.marks) || !command.marks.length) fail('Insert needs at least one Mark')
        const nodes = buildNodes(command.marks, options, new Set(), reserved)
        insertAt(destination(command.parentId), command.index, nodes)
        break
      }
      case 'edit': location(command.id).node.content = content(command.content, options); break
      case 'style': {
        if (command.patch !== null && (!record(command.patch) || Object.keys(command.patch).some(key => !['fontFamily', 'fontSize'].includes(key)))) fail('Invalid typography patch')
        const node = location(command.id).node
        node.style = style(patchTypography(node.style, command.patch))
        break
      }
      case 'remove': {
        const { node, siblings } = location(command.id)
        siblings.splice(siblings.indexOf(node), 1); removeIds(node)
        break
      }
      case 'move': {
        const source = location(command.id)
        let ancestor = command.parentId
        while (ancestor !== null) {
          if (ancestor === command.id) fail('Cannot move a Mark into its own subtree')
          ancestor = location(ancestor).parentId
        }
        const target = destination(command.parentId)
        source.siblings.splice(source.siblings.indexOf(source.node), 1)
        insertAt(target, command.index, [source.node])
        break
      }
      case 'copy': {
        const fresh = (node: MarkNode<C>): MarkInput<C> => ({ content: node.content, style: node.style, children: node.children.map(fresh) })
        const original = location(command.id).node
        const copies = buildNodes([fresh(original)], options, new Set(), reserved)
        if (options.references) {
          const idMap = new Map<string, string>()
          const pair = (source: MarkNode<C>, copy: MarkNode<C>) => {
            idMap.set(source.id, copy.id)
            source.children.forEach((child, at) => pair(child, copy.children[at]))
          }
          pair(original, copies[0])
          const ids = readonlyIds(idMap)
          const remap = (node: MarkNode<C>) => {
            const adapter = options.references!
            const expected = new Map<string, number>()
            for (const id of declaredReferences(node.content, adapter)) {
              const target = idMap.get(id) ?? id
              expected.set(target, (expected.get(target) ?? 0) + 1)
            }
            node.content = content(adapter.remap(node.content, ids), options)
            for (const id of declaredReferences(node.content, adapter)) expected.set(id, (expected.get(id) ?? 0) - 1)
            if ([...expected.values()].some(count => count !== 0)) throw new MarkEngineError('invalid-reference', 'Copy adapter must remap internal references and preserve external references')
            node.children.forEach(remap)
          }
          copies.forEach(remap)
        }
        insertAt(destination(command.parentId), command.index, copies)
        break
      }
      case 'split': {
        const { node, siblings } = location(command.id)
        if (node.children.length || !Array.isArray(command.parts) || command.parts.length < 2) fail('Split requires a leaf and at least two parts')
        if (command.parts.some(part => !record(part))) fail('Invalid split part')
        const parts = command.parts.map((part, at) => ({ id: at === 0 ? node.id : undefined, content: part.content, style: part.style ?? (at === 0 ? node.style : {}) }))
        const nodes = buildNodes(parts, options, new Set([node.id]), reserved)
        siblings.splice(siblings.indexOf(node), 1, ...nodes)
        break
      }
      case 'merge': {
        if (!Array.isArray(command.ids) || command.ids.length < 2 || new Set(command.ids).size !== command.ids.length) fail('Merge needs distinct adjacent Mark IDs')
        const sources = command.ids.map(location), first = sources[0], at = first.siblings.indexOf(first.node)
        if (sources.some((source, offset) => source.siblings !== first.siblings || source.node.children.length || first.siblings[at + offset] !== source.node)) fail('Merge requires adjacent leaves in document order')
        first.node.content = content(command.content, options)
        first.siblings.splice(at + 1, sources.length - 1)
        sources.slice(1).forEach(source => removeIds(source.node))
        break
      }
      default: fail('Unknown Mark command')
    }
    if (command.type !== 'edit' && command.type !== 'style') cachedIndex = undefined
  }
  validateReferences(index(), options)
  return { revision: before.revision + 1, roots, retiredIds: [...retired] }
}

/** Stateful editing uses the same pure transactions and the shared, bounded snapshot history. */
export class MarkEngine<C> {
  private history: SnapshotHistory<MarkSnapshot<C>>
  private issued: Set<string>
  private sequence = 0
  constructor(initial: MarkInput<C>[] = [], private readonly options: EngineOptions<C> = {}) {
    const first = reconcileSnapshot({ revision: 0, roots: [], retiredIds: [] }, initial, options)
    first.revision = 0
    this.issued = new Set(indexTree(first.roots).keys())
    this.history = new SnapshotHistory(first, { clone: value => value, equal: (a, b) => JSON.stringify(a.roots) === JSON.stringify(b.roots) })
  }
  /** Loading starts a fresh undo history while preserving all issued identities and the revision. */
  static fromSnapshot<C>(snapshot: MarkSnapshot<C>, options: EngineOptions<C> = {}): MarkEngine<C> {
    const first = copySnapshot<C>(snapshot, options)
    const engine = new MarkEngine<C>([], options)
    engine.sequence = first.revision
    engine.issued = new Set([...indexTree(first.roots).keys(), ...first.retiredIds])
    engine.history = new SnapshotHistory(first, { clone: value => value, equal: (a, b) => JSON.stringify(a.roots) === JSON.stringify(b.roots) })
    return engine
  }
  get snapshot(): MarkSnapshot<C> { return (globalThis as unknown as { structuredClone<T>(value: T): T }).structuredClone(this.history.current) }
  get bytes() { return this.history.bytes }
  boundary() { this.history.boundary() }
  private commit(next: MarkSnapshot<C>, options: TransactionOptions) {
    this.sequence = next.revision
    for (const id of [...indexTree(next.roots).keys(), ...next.retiredIds]) this.issued.add(id)
    this.history.change(next, options.group, options.now)
    return this.snapshot
  }
  transact(commands: MarkCommand<C>[], options: TransactionOptions = {}): MarkSnapshot<C> {
    return this.commit(applyMarkCommands(this.history.current, commands, { ...this.options, expectedRevision: options.expectedRevision }), options)
  }
  reconcile(inputs: MarkInput<C>[], options: TransactionOptions = {}): MarkSnapshot<C> {
    return this.commit(reconcileSnapshot(this.history.current, inputs, { ...this.options, expectedRevision: options.expectedRevision }), options)
  }
  private restore(redo: boolean): MarkSnapshot<C> | null {
    if (this.sequence >= Number.MAX_SAFE_INTEGER - 1) fail('Snapshot revision exhausted')
    const restored = redo ? this.history.redo() : this.history.undo()
    if (!restored) return null
    const live = indexTree(restored.roots)
    this.history.current = { revision: ++this.sequence, roots: restored.roots, retiredIds: [...this.issued].filter(id => !live.has(id)) }
    return this.snapshot
  }
  undo() { return this.restore(false) }
  redo() { return this.restore(true) }
}
