export interface HistoryOptions<T> {
  equal?: (left: T, right: T) => boolean
  sizeOf?: (value: T) => number
  clone?: (value: T) => T
  maxEntries?: number
  maxBytes?: number
  groupMs?: number
}

/** Snapshot values are owned by this history; current may hold view state such as the cursor. */
export class SnapshotHistory<T> {
  private past: T[] = []
  private pastBytes = 0
  private future: T[] = []
  private group = ''
  private time = 0
  private readonly equal: (left: T, right: T) => boolean
  private readonly sizeOf: (value: T) => number
  private readonly clone: (value: T) => T
  private readonly maxEntries: number
  private readonly maxBytes: number
  private readonly groupMs: number
  public current: T

  constructor(initial: T, options: HistoryOptions<T> = {}) {
    this.equal = options.equal ?? ((a, b) => JSON.stringify(a) === JSON.stringify(b))
    this.sizeOf = options.sizeOf ?? (value => JSON.stringify(value).length * 2)
    this.clone = options.clone ?? (value => (globalThis as unknown as { structuredClone<T>(value: T): T }).structuredClone(value))
    this.maxEntries = options.maxEntries ?? 100
    this.maxBytes = options.maxBytes ?? 32 * 1024 * 1024
    this.groupMs = options.groupMs ?? 600
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1 || !Number.isFinite(this.maxBytes) || this.maxBytes < 0 || !Number.isFinite(this.groupMs) || this.groupMs < 0) throw new Error('Invalid history limits')
    this.current = this.clone(initial)
  }
  get bytes() { return this.pastBytes + [...this.future, this.current].reduce((sum, item) => sum + this.sizeOf(item), 0) }
  boundary() { this.group = '' }
  change(next: T, group = '', now = Date.now()) {
    const owned = this.clone(next)
    if (this.equal(owned, this.current)) { this.current = owned; return false }
    if (!group || group !== this.group || now < this.time || now - this.time > this.groupMs) { this.past.push(this.current); this.pastBytes += this.sizeOf(this.current) }
    this.current = owned; this.future = []; this.group = group; this.time = now
    // Keep one undo checkpoint even when a single document exceeds the budget.
    while (this.past.length > this.maxEntries || (this.pastBytes > this.maxBytes && this.past.length > 1)) this.pastBytes -= this.sizeOf(this.past.shift()!)
    return true
  }
  undo() {
    const previous = this.past.pop()
    if (previous === undefined) return null
    this.pastBytes -= this.sizeOf(previous)
    this.future.push(this.current); this.current = previous; this.boundary(); return previous
  }
  redo() {
    const next = this.future.pop()
    if (next === undefined) return null
    this.past.push(this.current); this.pastBytes += this.sizeOf(this.current); this.current = next; this.boundary(); return next
  }
}

export interface EditSnapshot { value: string; cursor: number }
/** Compatibility facade: source/rich surfaces share the same engine history. */
export class EditHistory extends SnapshotHistory<EditSnapshot> {
  constructor(current: EditSnapshot) {
    super(current, { equal: (a, b) => a.value === b.value, sizeOf: value => value.value.length * 2, clone: value => ({ ...value }) })
  }
}
