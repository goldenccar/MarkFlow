import { parseBlocks, type MarkdownBlock } from './blocks'
import { fontFamilies, type FontFamily } from './types'
import { patchTypography, createMarkId, reconcileSnapshot, applyMarkCommands, type MarkTypography, type MarkSnapshot } from '../engine/index'

export interface MarkStyle extends MarkTypography { fontFamily?: FontFamily }
export interface MarkStylePatch { fontFamily?: FontFamily | null; fontSize?: number | null }
export interface MarkSelection { id: string; from: number; to: number; label: string; type: string; style: MarkStyle; explicit: boolean }
export interface MarkdownMark extends MarkdownBlock { style: MarkStyle; explicit: boolean }
export interface MarkEntry {
  id: string; type: string; from: number; to: number; raw: string; before: string; after: string; style: MarkStyle; orphan?: boolean
  occurrences?: number
  [key: string]: unknown
}
export interface MarkMetadata { v: 1; marks: MarkEntry[]; retiredIds?: string[]; [key: string]: unknown }
export interface MarkDocument { body: string; metadata: MarkMetadata | null; suffix: string; issue?: string }
export interface MarkMapping { id: string; from: number; to: number; type?: string; style?: MarkStyle }
export type MarkdownMarkCommand = { type: 'move' | 'copy'; id: string; index: number }
type MarkAnchor = Pick<MarkdownBlock, 'from' | 'to' | 'raw' | 'type'>
interface MarkdownPayload { type: string; raw: string }
const marker = '<!-- oops:marks '
const maxMetadata = 32 * 1024 * 1024
const documents = new Map<string, MarkDocument>()
const parsed = new Map<string, MarkdownMark[]>()
const structures = new Map<string, MarkdownBlock[]>()
const prepared = new Map<string, true>()
function structure(body: string) { return structures.get(body) ?? cache(structures, body, parseBlocks(body)) }
/** Markdown omits some blank paragraphs; exact registered zero-width Marks retain those editor nodes. */
function documentStructure(document: MarkDocument): MarkdownBlock[] {
  const { body, metadata } = document, marks = structure(body)
  if (metadata?.bodyHash !== bodyHash(body)) return marks
  const offsets = new Set(marks.map(mark => mark.from)), empty: MarkdownBlock[] = []
  for (const entry of metadata.marks) {
    if (entry.orphan || entry.type !== 'empty' || entry.from !== entry.to || entry.raw || entry.from > body.length || offsets.has(entry.from)) continue
    let low = 0, high = marks.length
    while (low < high) { const mid = (low + high) >>> 1; if (marks[mid].from <= entry.from) low = mid + 1; else high = mid }
    const previous = marks[low - 1], next = marks[low]
    const gap = entry.from === body.length ? /(?:\r?\n[ \t]*)+$/ : /(?:\r?\n[ \t]*){2,}$/
    if (previous && (previous.to > entry.from || !gap.test(body.slice(previous.to, entry.from)))) continue
    if (body.slice(entry.from, next?.from ?? body.length).trim()) continue
    const line = body.slice(0, entry.from).split(/\r\n|\r|\n/).length
    empty.push({ id: `empty-${entry.from}`, type: 'empty', label: '空白 Mark', raw: '', from: entry.from, to: entry.from, line, endLine: line })
    offsets.add(entry.from)
  }
  return empty.length ? [...marks, ...empty].sort((a, b) => a.from - b.from) : marks
}
/** Snapshot discriminator, not a security hash. Every resolved anchor also checks exact original text. */
function bodyHash(body: string) {
  let a = 2166136261, b = 5381
  for (let i = 0; i < body.length; i++) { const code = body.charCodeAt(i); a = Math.imul(a ^ code, 16777619); b = Math.imul(b, 33) ^ code }
  return `${body.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`
}
function cache<T>(map: Map<string, T>, key: string, value: T): T {
  if (map.size >= 3) map.delete(map.keys().next().value!)
  map.set(key, value); return value
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function validStyle(value: unknown): value is MarkStyle {
  return object(value) && (value.fontFamily === undefined || fontFamilies.includes(value.fontFamily as FontFamily))
    && (value.fontSize === undefined || typeof value.fontSize === 'number' && Number.isFinite(value.fontSize) && value.fontSize >= 10 && value.fontSize <= 96)
}
const typography = (style: MarkStyle): MarkStyle => ({ ...(style.fontFamily !== undefined ? { fontFamily: style.fontFamily } : {}), ...(style.fontSize !== undefined ? { fontSize: style.fontSize } : {}) })
function validEntry(value: unknown): value is MarkEntry {
  return object(value) && typeof value.id === 'string' && /^[\w-]{1,100}$/.test(value.id)
    && typeof value.type === 'string' && typeof value.raw === 'string' && typeof value.before === 'string' && typeof value.after === 'string'
    && Number.isSafeInteger(value.from) && Number.isSafeInteger(value.to) && (value.from as number) >= 0 && (value.to as number) >= (value.from as number)
    && validStyle(value.style) && (value.orphan === undefined || typeof value.orphan === 'boolean')
    && (value.occurrences === undefined || Number.isSafeInteger(value.occurrences) && (value.occurrences as number) >= 1)
}

/** Markdown wire format belongs to this adapter, never to the format-independent Mark engine. */
export function readMarkDocument(source: string): MarkDocument {
  const cached = documents.get(source); if (cached) return cached
  const index = source.lastIndexOf(marker)
  if (index < 0) return cache(documents, source, { body: source, metadata: null, suffix: '' })
  const candidate = source.slice(index).trimEnd()
  const separator = /(?:\r?\n){2}$/.exec(source.slice(0, index))
  if (!candidate.endsWith(' -->') || !separator) return cache(documents, source, { body: source, metadata: null, suffix: '' })
  const htmlFooter = () => {
    const tail = structure(source).filter(mark => mark.type !== 'empty').at(-1)
    return tail?.type === 'html' && tail.from === index && tail.to === index + candidate.length
  }
  let issue = 'Mark 元数据无法识别，原文已保留；修复元数据后再设置局部样式。'
  try {
    if (candidate.length > maxMetadata) throw new Error('size')
    const value: unknown = JSON.parse(candidate.slice(marker.length, -4))
    if (!object(value) || value.v !== 1) { issue = 'Mark 元数据版本暂不支持，原文已保留。'; throw new Error('version') }
    if (!Array.isArray(value.marks) || !value.marks.every(validEntry) || new Set(value.marks.map(entry => entry.id)).size !== value.marks.length) throw new Error('entries')
    if (value.retiredIds !== undefined) {
      if (!Array.isArray(value.retiredIds) || !value.retiredIds.every(id => typeof id === 'string' && /^[\w-]{1,100}$/.test(id))) throw new Error('retired')
      const retired = new Set(value.retiredIds)
      if (retired.size !== value.retiredIds.length || value.marks.some(entry => !entry.orphan && retired.has(entry.id))) throw new Error('retired')
    }
    if (value.revision !== undefined && (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0)) throw new Error('revision')
    // A registered footer stays separate while a code fence is unfinished; short examples stay code.
    if (!(typeof value.bodyHash === 'string' && /^\d+:[\da-f]+:[\da-f]+$/.test(value.bodyHash) && value.marks.length) && !htmlFooter()) return cache(documents, source, { body: source, metadata: null, suffix: '' })
    return cache(documents, source, { body: source.slice(0, index - separator[0].length), metadata: value as unknown as MarkMetadata, suffix: source.slice(index - separator[0].length) })
  } catch { return cache(documents, source, { body: source, metadata: null, suffix: '', ...(htmlFooter() ? { issue } : {}) }) }
}

function resolveEntries(body: string, entries: MarkEntry[], marks = structure(body), exactSnapshot = false) {
  const resolved = new Map<string, MarkdownBlock>(), used = new Set<number>()
  const at = new Map(marks.map(mark => [mark.from, mark]))
  const groups = new Map<string, MarkdownBlock[]>()
  const key = (mark: { type: string; raw: string }) => JSON.stringify([mark.type, mark.raw])
  for (const mark of marks) { const value = key(mark), group = groups.get(value); if (group) group.push(mark); else groups.set(value, [mark]) }
  for (const entry of entries) {
    if (entry.orphan) continue
    let mark = exactSnapshot ? at.get(entry.from) : undefined
    if (mark && (mark.to !== entry.to || mark.raw !== entry.raw || mark.type !== entry.type)) mark = undefined
    if (!mark) {
      const candidates = groups.get(key(entry)) ?? []
      if (entry.raw && candidates.length === 1 && entry.occurrences === 1) mark = candidates[0]
      else if (candidates.length) {
        const contextual = candidates.filter(item => body.slice(Math.max(0, item.from - 48), item.from) === entry.before && body.slice(item.to, item.to + 48) === entry.after)
        if (contextual.length === 1) mark = contextual[0]
      }
    }
    if (mark && !used.has(mark.from)) { resolved.set(entry.id, mark); used.add(mark.from) }
  }
  return resolved
}
export function parseMarks(source: string): MarkdownMark[] {
  const cached = parsed.get(source); if (cached) return cached
  const document = readMarkDocument(source), { body, metadata } = document, marks = documentStructure(document)
  const resolved = resolveEntries(body, metadata?.marks ?? [], marks, metadata?.bodyHash === bodyHash(body))
  const entries = new Map(metadata?.marks.map(entry => [entry.id, entry]))
  const byFrom = new Map([...resolved].map(([id, mark]) => [mark.from, entries.get(id)!]))
  return cache(parsed, source, marks.map(mark => {
    const entry = byFrom.get(mark.from)
    // Unregistered parser results are only source locators. App hydration gives every live Mark a UUID.
    return { ...mark, id: entry?.id ?? `snapshot:${mark.id}`, style: entry?.style ?? {}, explicit: !!entry && (entry.style.fontFamily !== undefined || entry.style.fontSize !== undefined) }
  }))
}
export function markAt(source: string, position: number): MarkdownMark | null {
  const marks = parseMarks(source)
  return marks.find(mark => position >= mark.from && position <= mark.to) ?? marks.find(mark => position < mark.from) ?? marks.at(-1) ?? null
}
function snapshot(metadata: MarkMetadata | null): MarkSnapshot<MarkdownPayload> {
  return { revision: typeof metadata?.revision === 'number' ? metadata.revision : 0,
    roots: (metadata?.marks ?? []).filter(entry => !entry.orphan).sort((a, b) => a.from - b.from).map(entry => ({ id: entry.id, content: { type: entry.type, raw: entry.raw }, style: typography(entry.style), children: [] })),
    retiredIds: [...new Set([...(metadata?.retiredIds ?? []), ...(metadata?.marks ?? []).filter(entry => entry.orphan).map(entry => entry.id)])] }
}
function anchored(entry: MarkEntry, mark: MarkAnchor, body: string, counts: Map<string, number>): MarkEntry {
  const { orphan: _orphan, ...rest } = entry
  return { ...rest, type: mark.type, from: mark.from, to: mark.to, raw: mark.raw, before: body.slice(Math.max(0, mark.from - 48), mark.from), after: body.slice(mark.to, mark.to + 48), occurrences: counts.get(mark.raw) ?? 1 }
}
function write(body: string, metadata: MarkMetadata) {
  const payload = JSON.stringify({ ...metadata, bodyHash: bodyHash(body) }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/--/g, '\\u002d\\u002d')
  if (payload.length > maxMetadata) throw new Error('Mark 身份数据过大，本次操作未写入。')
  const eol = body.includes('\r\n') ? '\r\n' : '\n'
  const source = `${body}${eol}${eol}${marker}${payload} -->`
  cache(prepared, source, true)
  return source
}
function persist(body: string, previous: MarkMetadata | null, next: MarkSnapshot<MarkdownPayload>, anchors: MarkAnchor[]): string {
  const prior = new Map(previous?.marks.map(entry => [entry.id, entry])), counts = new Map<string, number>()
  for (const mark of anchors) counts.set(mark.raw, (counts.get(mark.raw) ?? 0) + 1)
  const entries = next.roots.map((node, index) => {
    const { fontFamily: _family, fontSize: _size, ...unknown } = prior.get(node.id)?.style ?? {}
    return anchored({ ...prior.get(node.id), id: node.id, type: anchors[index].type, from: anchors[index].from, to: anchors[index].to, raw: anchors[index].raw, before: '', after: '', style: { ...unknown, ...node.style } as MarkStyle }, anchors[index], body, counts)
  })
  // Undo snapshots retain deleted content; the file only needs tombstone IDs, never deleted prose.
  return write(body, { ...previous, v: 1, complete: true, documentId: previous?.documentId ?? createMarkId(), revision: next.revision, retiredIds: next.retiredIds, marks: entries })
}

/** Hydrate each document independently. The caller decides when this in-memory registry is saved. */
export function ensureMarkDocument(source: string): string {
  if (prepared.has(source)) return source
  const document = readMarkDocument(source)
  if (document.issue) return source
  const marks = documentStructure(document), resolved = resolveEntries(document.body, document.metadata?.marks ?? [], marks, document.metadata?.bodyHash === bodyHash(document.body))
  if (document.metadata?.complete === true && document.metadata.bodyHash === bodyHash(document.body) && resolved.size === marks.length) { cache(prepared, source, true); return source }
  const entries = new Map(document.metadata?.marks.map(entry => [entry.id, entry])), byFrom = new Map([...resolved].map(([id, mark]) => [mark.from, entries.get(id)!]))
  const next = reconcileSnapshot(snapshot(document.metadata), marks.map(mark => {
    const entry = byFrom.get(mark.from)
    return { ...(entry ? { id: entry.id } : {}), content: { type: mark.type, raw: mark.raw }, style: typography(entry?.style ?? {}), children: [] }
  }))
  return persist(document.body, document.metadata, next, marks)
}
export function setMarkStyle(source: string, position: number, patch: MarkStylePatch | null): string {
  const document = readMarkDocument(source)
  if (document.issue) throw new Error(document.issue)
  const hydrated = ensureMarkDocument(source), target = markAt(hydrated, Math.min(position, document.body.length))
  if (!target) return source
  const style = patchTypography(target.style, patch)
  if (!validStyle(style)) throw new Error('Mark 字体或字号无效。')
  if (JSON.stringify(style) === JSON.stringify(target.style)) return source
  const registered = readMarkDocument(hydrated), marks = parseMarks(hydrated)
  const next = reconcileSnapshot(snapshot(registered.metadata), marks.map(mark => ({ id: mark.id, content: { type: mark.type, raw: mark.raw }, style: typography(mark.id === target.id ? style : mark.style), children: [] })))
  return persist(document.body, registered.metadata, next, marks)
}

/** Editor mappings identify survivors; every other semantic Mark is a new identity. */
export function reconcileMarkDocument(beforeSource: string, newSource: string, mappings?: MarkMapping[]): string {
  if (beforeSource === newSource) return newSource
  const before = readMarkDocument(ensureMarkDocument(beforeSource)), after = readMarkDocument(newSource)
  if (before.issue || after.issue || after.metadata && after.suffix !== readMarkDocument(beforeSource).suffix) return newSource
  const body = after.body, entries = new Map(before.metadata?.marks.map(entry => [entry.id, entry]))
  let anchors: MarkAnchor[], inputs: Array<{ id?: string; content: MarkdownPayload; style: MarkStyle; children: [] }>
  if (mappings) {
    const ranges = mappings.map(mapping => {
      if (!Number.isSafeInteger(mapping.from) || !Number.isSafeInteger(mapping.to) || mapping.from < 0 || mapping.to < mapping.from || mapping.to > body.length) throw new Error('Mark 编辑范围无效。')
      if (mapping.style !== undefined && !validStyle(mapping.style)) throw new Error('Mark 字体或字号无效。')
      return mapping
    }).sort((a, b) => a.from - b.from || a.to - b.to)
    // Complete typed mappings come from the rich adapter; source/legacy callers use the parser.
    const complete = ranges.length > 0 && ranges.every(mapping => mapping.type) && ranges[0].from <= (body.search(/\S/) < 0 ? body.length : body.search(/\S/))
      && ranges.every((mapping, index) => index === 0 || mapping.from >= ranges[index - 1].to && !body.slice(ranges[index - 1].to, mapping.from).trim())
      && !body.slice(ranges.at(-1)!.to).trim()
    anchors = complete ? ranges.map(mapping => ({ from: mapping.from, to: mapping.to, raw: body.slice(mapping.from, mapping.to), type: mapping.type! })) : structure(body)
    const byFrom = new Map(ranges.map(mapping => [mapping.from, mapping]))
    inputs = anchors.map(mark => {
      const candidate = byFrom.get(mark.from), mapping = candidate?.to === mark.to ? candidate : undefined
      return { ...(mapping ? { id: mapping.id } : {}), content: { type: mark.type, raw: mark.raw }, style: typography(mapping?.style ?? (mapping ? entries.get(mapping.id)?.style : undefined) ?? {}), children: [] }
    })
  } else {
    anchors = structure(body)
    const resolved = resolveEntries(body, before.metadata?.marks ?? [], anchors as MarkdownBlock[]), byFrom = new Map([...resolved].map(([id, mark]) => [mark.from, entries.get(id)!]))
    inputs = anchors.map(mark => { const entry = byFrom.get(mark.from); return { ...(entry ? { id: entry.id } : {}), content: { type: mark.type, raw: mark.raw }, style: typography(entry?.style ?? {}), children: [] } })
  }
  const next = reconcileSnapshot(snapshot(before.metadata), inputs)
  return persist(body, before.metadata, next, anchors)
}

/** Explicit outline commands use the same engine as every format; source assembly stays here. */
export function applyMarkdownMarkCommand(source: string, command: MarkdownMarkCommand): string {
  const hydrated = ensureMarkDocument(source), document = readMarkDocument(hydrated)
  if (document.issue) throw new Error(document.issue)
  const marks = parseMarks(hydrated), old = new Map(marks.map((mark, index) => [mark.id, { mark, index }]))
  const next = applyMarkCommands(snapshot(document.metadata), [{ ...command, parentId: null }])
  if (command.type === 'move' && marks.every((mark, index) => next.roots[index]?.id === mark.id)) return source
  const eol = document.body.includes('\r\n') ? '\r\n' : '\n'
  let body = ''
  const anchors: MarkAnchor[] = []
  next.roots.forEach((node, index) => {
    const original = old.get(node.id), previous = index ? old.get(next.roots[index - 1].id) : undefined
    if (!index && original?.index === 0) body += document.body.slice(0, original.mark.from)
    else if (index) body += previous && original && original.index === previous.index + 1 ? document.body.slice(previous.mark.to, original.mark.from) : eol + eol
    const from = body.length; body += node.content.raw; anchors.push({ from, to: body.length, raw: node.content.raw, type: node.content.type })
  })
  const last = next.roots.at(-1), original = last && old.get(last.id)
  if (original?.index === marks.length - 1) body += document.body.slice(original.mark.to)
  // Moving list items can change Markdown context. Validate semantics before publishing.
  const actual = structure(body).filter(mark => mark.type !== 'empty'), nonempty = anchors.filter(mark => mark.type !== 'empty')
  if (actual.length !== nonempty.length || actual.some((mark, index) => mark.from !== nonempty[index].from || mark.to !== nonempty[index].to || mark.type !== nonempty[index].type)
    || anchors.some(mark => mark.type === 'empty' && (mark.from !== mark.to || actual.some(node => node.from < mark.from && node.to > mark.from)))) throw new Error('此 Mark 在目标位置会改变 Markdown 结构，操作未应用。')
  return persist(body, document.metadata, next, anchors)
}

/** Registry bytes never count as user-authored text for the save threshold. */
export const markBody = (source: string) => readMarkDocument(source).body
