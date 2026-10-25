import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkStringify from 'remark-stringify'
import type { JSONContent } from '@tiptap/core'
import { ensureMarkDocument, parseMarks, readMarkDocument, reconcileMarkDocument, type MarkMapping, type MarkStyle } from './marks'
import { parseBlocks } from './blocks'
import { createMarkId } from '../engine/mark'

interface Ast {
  type: string; value?: string; children?: Ast[]; depth?: number; url?: string; title?: string | null; alt?: string | null
  identifier?: string; label?: string; referenceType?: string; ordered?: boolean; start?: number | null; spread?: boolean; checked?: boolean | null
  lang?: string | null; meta?: string | null; align?: Array<string | null>
  position?: { start: { offset: number }; end: { offset: number } }
}
export interface SourceBlock { id: string; type: string; from: number; to: number; raw: string; json: string }
export interface RichMarkdownDocument { source: string; originalSource: string; identitySource: string; doc: JSONContent; blocks: SourceBlock[]; markMappings: MarkMapping[]; fingerprints: string[] }
export interface RichSourceSpan { from: number; to: number; index: number }
export interface RichMarkSpan extends RichSourceSpan { itemIndex?: number; id?: string; type?: string; style?: MarkStyle }
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath)
const writer = unified().use(remarkGfm).use(remarkMath).use(remarkStringify, { bullet: '-', fences: true, listItemIndent: 'one', emphasis: '*', rule: '-' })
const inlineTags: Record<string, string> = { u: 'underline', sup: 'superscript', sub: 'subscript', mark: 'highlight' }
const tagForMark: Record<string, string> = Object.fromEntries(Object.entries(inlineTags).map(([tag, mark]) => [mark, tag]))

function clean(node: JSONContent): unknown {
  const attrs = Object.fromEntries(Object.entries(node.attrs ?? {}).filter(([key, value]) => !['sourceId', 'id', 'markId', 'markFontFamily', 'markFontSize'].includes(key) && value !== null && value !== undefined && !(key === 'colspan' && value === 1) && !(key === 'rowspan' && value === 1)).sort(([a], [b]) => a.localeCompare(b)))
  return { type: node.type, ...(node.text ? { text: node.text } : {}), ...(Object.keys(attrs).length ? { attrs } : {}), ...(node.marks?.length ? { marks: [...node.marks].sort((a, b) => a.type!.localeCompare(b.type!)).map(mark => clean(mark)) } : {}), ...(node.content?.length ? { content: node.content.map(clean) } : {}) }
}
export const richFingerprint = (node: JSONContent) => JSON.stringify(clean(node))

/** Reading is lossless: the AST supplies ranges; original bytes remain the source of truth. */
export function importMarkdown(originalSource: string): RichMarkdownDocument {
  const identitySource = ensureMarkDocument(originalSource), document = readMarkDocument(identitySource), source = document.body
  const activeMarks = document.metadata?.marks.length ? parseMarks(identitySource).filter(mark => !mark.id.startsWith('snapshot:')) : []
  const styled = new Map(activeMarks.map(mark => [mark.from, mark]))
  const markAttrs = (from: number) => {
    const mark = styled.get(from)
    return mark ? { markId: mark.id, markFontFamily: mark.style.fontFamily ?? null, markFontSize: mark.style.fontSize ?? null } : {}
  }
  const tree = parser.parse(source) as Ast
  const definitions = new Map<string, Ast>()
  for (const node of tree.children ?? []) if (node.type === 'definition') definitions.set(node.identifier?.toLowerCase() ?? '', node)
  const raw = (node: Ast) => source.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0)
  function inline(nodes: Ast[], marks: NonNullable<JSONContent['marks']> = []): JSONContent[] {
    const result: JSONContent[] = [], active = [...marks], tags: string[] = []
    const closingTags = new Map<string, number>()
    nodes.forEach((node, index) => { const close = node.type === 'html' && /^<\/(u|sup|sub|mark)>$/i.exec(node.value ?? ''); if (close) closingTags.set(close[1].toLowerCase(), index) })
    for (const [index, node] of nodes.entries()) {
      if (node.type === 'html') {
        const open = /^<(u|sup|sub|mark)>$/i.exec(node.value ?? ''), close = /^<\/(u|sup|sub|mark)>$/i.exec(node.value ?? '')
        if (open && (closingTags.get(open[1].toLowerCase()) ?? -1) > index) { tags.push(open[1].toLowerCase()); active.push({ type: inlineTags[open[1].toLowerCase()] }); continue }
        if (close && tags.at(-1) === close[1].toLowerCase()) { tags.pop(); active.pop(); continue }
      }
      const withMarks = (value: JSONContent) => ({ ...value, ...(active.length ? { marks: [...active] } : {}) })
      switch (node.type) {
        case 'text': if (node.value) result.push(withMarks({ type: 'text', text: node.value })); break
        case 'strong': case 'emphasis': case 'delete': result.push(...inline(node.children ?? [], [...active, { type: { strong: 'bold', emphasis: 'italic', delete: 'strike' }[node.type]! }])); break
        case 'inlineCode': if (node.value) result.push({ type: 'text', text: node.value, marks: [...active, { type: 'code' }] }); break
        case 'break': result.push({ type: 'hardBreak' }); break
        case 'inlineMath': result.push(withMarks({ type: 'mathInline', attrs: { latex: node.value ?? '' } })); break
        case 'link': result.push(...inline(node.children ?? [], [...active, { type: 'link', attrs: { href: node.url ?? '', title: node.title ?? null } }])); break
        case 'linkReference': {
          const target = definitions.get(node.identifier?.toLowerCase() ?? '')
          if (target) result.push(...inline(node.children ?? [], [...active, { type: 'link', attrs: { href: target.url, title: target.title ?? null, refId: node.identifier, refType: node.referenceType, refLabel: node.label ?? node.identifier } }]))
          else result.push(withMarks({ type: 'opaqueInline', attrs: { raw: raw(node), label: node.label ?? '未解析引用' } }))
          break
        }
        case 'image': result.push(withMarks({ type: 'image', attrs: { src: node.url ?? '', alt: node.alt ?? '', title: node.title ?? null } })); break
        case 'imageReference': {
          const target = definitions.get(node.identifier?.toLowerCase() ?? '')
          result.push(withMarks(target ? { type: 'image', attrs: { src: target.url, alt: node.alt ?? '', title: target.title ?? null, refId: node.identifier, refType: node.referenceType, refLabel: node.label ?? node.identifier } } : { type: 'opaqueInline', attrs: { raw: raw(node), label: node.alt ?? '图片引用' } })); break
        }
        default: result.push(withMarks({ type: 'opaqueInline', attrs: { raw: raw(node) || node.value || '', label: node.type === 'footnoteReference' ? `[${node.label ?? node.identifier}]` : '保留的内嵌内容' } }))
      }
    }
    return result
  }
  function convert(node: Ast): JSONContent {
    switch (node.type) {
      case 'paragraph': return { type: 'paragraph', content: inline(node.children ?? []) }
      case 'heading': return { type: 'heading', attrs: { level: node.depth ?? 1 }, content: inline(node.children ?? []) }
      case 'blockquote': return { type: 'blockquote', content: node.children?.length ? node.children.map(convert) : [{ type: 'paragraph' }] }
      case 'code': return { type: 'codeBlock', attrs: { language: node.lang ?? null, meta: node.meta ?? null }, content: node.value ? [{ type: 'text', text: node.value }] : [] }
      case 'math': return { type: 'mathBlock', attrs: { latex: node.value ?? '' } }
      case 'thematicBreak': return { type: 'horizontalRule' }
      case 'list': {
        const tasks = !node.ordered && (node.children ?? []).some(item => item.checked !== null && item.checked !== undefined)
        return { type: tasks ? 'taskList' : node.ordered ? 'orderedList' : 'bulletList', ...(node.ordered ? { attrs: { start: node.start ?? 1 } } : {}), content: (node.children ?? []).map(item => ({ type: tasks ? 'taskItem' : 'listItem', ...(tasks ? { attrs: { checked: !!item.checked, task: item.checked !== null && item.checked !== undefined } } : {}), content: item.children?.length ? item.children.map(convert) : [{ type: 'paragraph' }] })) }
      }
      case 'table': return { type: 'table', content: (node.children ?? []).map((row, rowIndex) => ({ type: 'tableRow', content: (row.children ?? []).map((cell, column) => ({ type: rowIndex === 0 ? 'tableHeader' : 'tableCell', attrs: { align: node.align?.[column] ?? null }, content: [{ type: 'paragraph', content: inline(cell.children ?? []) }] })) })) }
      default: return { type: 'opaqueBlock', attrs: { raw: raw(node), label: node.type === 'definition' ? `链接定义：${node.label ?? node.identifier}` : node.type === 'footnoteDefinition' ? `脚注：${node.label ?? node.identifier}` : node.type === 'html' ? 'HTML / 注释 · 原文保留' : `${node.type} · 原文保留` } }
    }
  }
  const blocks: SourceBlock[] = [], content: JSONContent[] = []
  const emptyMarks = activeMarks.filter(mark => mark.type === 'empty')
  const entries: Array<{ node?: Ast; from: number; to: number; empty?: boolean }> = [
    ...(tree.children ?? []).map(node => ({ node, from: node.position!.start.offset, to: node.position!.end.offset })),
    ...emptyMarks.map(mark => ({ from: mark.from, to: mark.to, empty: true })),
  ].sort((a, b) => a.from - b.from || a.to - b.to)
  entries.forEach((entry, index) => {
    const { node } = entry
    if (!node) {
      const id = `source-${index}`, converted = { type: 'paragraph', attrs: { sourceId: id, ...markAttrs(entry.from) } }
      blocks.push({ id, type: 'empty', from: entry.from, to: entry.to, raw: '', json: richFingerprint(converted) }); content.push(converted); return
    }
    const id = `source-${index}`, converted = convert(node)
    converted.attrs = { ...converted.attrs, sourceId: id }
    if (node.type === 'list') converted.content?.forEach((item, itemIndex) => { item.attrs = { ...item.attrs, ...markAttrs(node.children![itemIndex].position!.start.offset) } })
    else converted.attrs = { ...converted.attrs, ...markAttrs(node.position!.start.offset) }
    blocks.push({ id, type: node.type, from: node.position!.start.offset, to: node.position!.end.offset, raw: raw(node), json: richFingerprint(converted) })
    content.push(converted)
  })
  if (!content.length || (!emptyMarks.some(mark => mark.from === source.length) && /(?:\r?\n[ \t]*){2,}$/.test(source))) content.push({ type: 'paragraph', attrs: { sourceId: 'source-empty', ...markAttrs(source.length) } })
  return { source, originalSource, identitySource, doc: { type: 'doc', content }, blocks, markMappings: activeMarks.map(({ id, from, to, type, style }) => ({ id, from, to, type, style })), fingerprints: content.map(richFingerprint) }
}

function inlineAst(nodes: JSONContent[]): Ast[] {
  const output: Ast[] = []
  for (const node of nodes) {
    let converted: Ast
    if (node.type === 'text') converted = { type: 'text', value: node.text ?? '' }
    else if (node.type === 'hardBreak') converted = { type: 'break' }
    else if (node.type === 'mathInline') converted = { type: 'inlineMath', value: node.attrs?.latex ?? '' }
    else if (node.type === 'image') converted = node.attrs?.refId ? { type: 'imageReference', identifier: node.attrs.refId, label: node.attrs.refLabel ?? node.attrs.refId, referenceType: node.attrs.refType ?? 'full', alt: node.attrs.alt ?? '' } : { type: 'image', url: node.attrs?.src ?? '', alt: node.attrs?.alt ?? '', title: node.attrs?.title }
    else converted = { type: 'html', value: node.attrs?.raw ?? '' }
    const tags: string[] = []
    for (const mark of [...(node.marks ?? [])].reverse()) {
      if (tagForMark[mark.type!]) { tags.unshift(tagForMark[mark.type!]); continue }
      if (mark.type === 'code') converted = { type: 'inlineCode', value: node.text ?? '' }
      else if (mark.type === 'link') converted = mark.attrs?.refId ? { type: 'linkReference', identifier: mark.attrs.refId, label: mark.attrs.refLabel ?? mark.attrs.refId, referenceType: mark.attrs.refType ?? 'full', children: [converted] } : { type: 'link', url: mark.attrs?.href ?? '', title: mark.attrs?.title, children: [converted] }
      else if (['bold', 'italic', 'strike'].includes(mark.type!)) converted = { type: { bold: 'strong', italic: 'emphasis', strike: 'delete' }[mark.type!]!, children: [converted] }
    }
    for (const tag of tags) output.push({ type: 'html', value: `<${tag}>` })
    output.push(converted)
    for (const tag of [...tags].reverse()) output.push({ type: 'html', value: `</${tag}>` })
  }
  return output
}
function blockAst(node: JSONContent): Ast {
  const children = node.content ?? []
  switch (node.type) {
    case 'paragraph': return { type: 'paragraph', children: inlineAst(children) }
    case 'heading': return { type: 'heading', depth: node.attrs?.level ?? 1, children: inlineAst(children) }
    case 'blockquote': return { type: 'blockquote', children: children.map(blockAst) }
    case 'codeBlock': return { type: 'code', lang: node.attrs?.language, meta: node.attrs?.meta, value: children.map(item => item.text ?? '').join('') }
    case 'mathBlock': return { type: 'math', value: node.attrs?.latex ?? '' }
    case 'horizontalRule': return { type: 'thematicBreak' }
    case 'bulletList': case 'orderedList': case 'taskList': return { type: 'list', ordered: node.type === 'orderedList', start: node.attrs?.start ?? 1, spread: false, children: children.map(item => ({ type: 'listItem', spread: false, ...(node.type === 'taskList' && item.attrs?.task !== false ? { checked: !!item.attrs?.checked } : {}), children: (item.content ?? []).map(blockAst) })) }
    case 'table': return { type: 'table', align: children[0]?.content?.map(cell => cell.attrs?.align ?? null), children: children.map(row => ({ type: 'tableRow', children: (row.content ?? []).map(cell => ({ type: 'tableCell', children: inlineAst((cell.content ?? []).flatMap((paragraph, index) => [...(index ? [{ type: 'hardBreak' }] : []), ...(paragraph.content ?? [])])) })) })) }
    default: return { type: 'html', value: node.attrs?.raw ?? '' }
  }
}
function serializeBlock(node: JSONContent, eol: string): string {
  if (node.type === 'opaqueBlock') return node.attrs?.raw ?? ''
  if (node.type === 'paragraph' && !node.content?.length) return ''
  const tree = blockAst(node), preserved: string[] = []
  let prefix = '\uE000OopsRaw'
  while (JSON.stringify(tree).includes(prefix)) prefix += '_'
  const protect = (item: Ast) => {
    if (item.type === 'html') { preserved.push(item.value ?? ''); item.value = `${prefix}${preserved.length - 1}\uE001` }
    item.children?.forEach(protect)
  }
  protect(tree)
  let result = String(writer.stringify({ type: 'root', children: [tree] } as never)).replace(/\n$/, '').replace(/\r?\n/g, eol)
  preserved.forEach((value, index) => { result = result.replace(`${prefix}${index}\uE001`, () => value) })
  return result
}

/** Only changed top-level blocks are regenerated; unrelated syntax and gaps are copied exactly. */
function exportBodyWithMap(doc: JSONContent, base: RichMarkdownDocument): { source: string; spans: RichSourceSpan[] } {
  const nodes = doc.content ?? [], fingerprints = nodes.map(richFingerprint)
  if (fingerprints.length === base.fingerprints.length && fingerprints.every((value, index) => value === base.fingerprints[index] && nodes[index].attrs?.sourceId === base.doc.content?.[index].attrs?.sourceId)) return { source: base.source, spans: [
    ...base.blocks.map((block, index) => ({ from: block.from, to: block.to, index })),
    ...(base.doc.content?.at(-1)?.attrs?.sourceId === 'source-empty' ? [{ from: base.source.length, to: base.source.length, index: base.doc.content.length - 1 }] : []),
  ] }
  const originals = new Map(base.blocks.map(block => [block.id, block])), originalIndexes = new Map(base.blocks.map((block, index) => [block.id, index])), used = new Set<string>()
  const eol = base.source.includes('\r\n') ? '\r\n' : '\n'
  const pieces = nodes.map((node, index) => {
    const id = node.attrs?.sourceId as string | undefined
    const original = id && !used.has(id) ? originals.get(id) : undefined
    if (id) used.add(id)
    const value = original && fingerprints[index] === original.json ? original.raw : serializeBlock(node, eol)
    return { node, original, value }
  })
  let source = '', previous: typeof pieces[number] | undefined
  const spans: RichSourceSpan[] = []
  pieces.forEach((piece, index) => {
    let gap = ''
    if (!previous) {
      if (piece.original && piece.original === base.blocks[0]) gap = base.source.slice(0, piece.original.from)
      else if (!base.blocks.length && piece.node.attrs?.sourceId === 'source-empty') gap = base.source
    } else if (previous.original && previous.original === base.blocks.at(-1) && piece.node.attrs?.sourceId === 'source-empty') gap = base.source.slice(previous.original.to)
    else if (previous.original && piece.original && originalIndexes.get(piece.original.id) === originalIndexes.get(previous.original.id)! + 1) gap = base.source.slice(previous.original.to, piece.original.from)
    else gap = eol + eol
    source += gap
    const from = source.length; source += piece.value; spans.push({ from, to: source.length, index }); previous = piece
  })
  const last = pieces.at(-1)
  if (last?.original && last.original === base.blocks.at(-1)) source += base.source.slice(last.original.to)
  return { source, spans }
}
/** Product Marks are root blocks or items of a root list, distinct from inline formatting marks. */
export function richMarkSpans(doc: JSONContent, body: string, spans: RichSourceSpan[], originals: SourceBlock[] = []): RichMarkSpan[] {
  const result: RichMarkSpan[] = []
  const byId = new Map(originals.map(block => [block.id, block]))
  const containsOpaque = (node: JSONContent): boolean => node.type === 'opaqueInline' || node.type === 'opaqueBlock' || !!node.content?.some(containsOpaque)
  const semanticType = (node: JSONContent, span: RichSourceSpan): string | undefined => {
    const original = byId.get(node.attrs?.sourceId)
    if (original && original.raw === body.slice(span.from, span.to)) return original.type
    if (span.from === span.to) return 'empty'
    // Opaque payloads can change Markdown structure when their surroundings change.
    // Keep the parser as the authority for those uncommon cases.
    if (containsOpaque(node)) {
      const local = parseBlocks(body.slice(span.from, span.to))
      return local.length === 1 && local[0].from === 0 && local[0].to === span.to - span.from ? local[0].type : undefined
    }
    return ({ paragraph: 'paragraph', heading: 'heading', blockquote: 'blockquote', codeBlock: 'code', mathBlock: 'math', horizontalRule: 'thematicBreak', table: 'table' } as Record<string, string>)[node.type!]
  }
  const identity = (node: JSONContent) => {
    node.attrs ??= {}
    node.attrs.markId ??= createMarkId()
    const style: MarkStyle = { ...(node.attrs.markFontFamily ? { fontFamily: node.attrs.markFontFamily } : {}), ...(node.attrs.markFontSize ? { fontSize: node.attrs.markFontSize } : {}) }
    return { id: node.attrs.markId as string, style }
  }
  for (const span of spans) {
    const node = doc.content?.[span.index]; if (!node) continue
    if (['bulletList', 'orderedList', 'taskList'].includes(node.type!)) {
      const items = parseBlocks(body.slice(span.from, span.to)).filter(mark => mark.type === 'listItem')
      if (items.length !== node.content?.length) continue
      items.forEach((mark, itemIndex) => result.push({ from: span.from + mark.from, to: span.from + mark.to, index: span.index, itemIndex, ...identity(node.content![itemIndex]), type: 'listItem' }))
    } else result.push({ ...span, ...identity(node), type: semanticType(node, span) })
  }
  return result
}
export function exportMarkdownWithMap(doc: JSONContent, base: RichMarkdownDocument, identitySource = base.identitySource): { source: string; spans: RichSourceSpan[]; marks: RichMarkSpan[] } {
  const result = exportBodyWithMap(doc, base), marks = richMarkSpans(doc, result.source, result.spans, base.blocks)
  const mappings: MarkMapping[] = marks.flatMap(mark => mark.id ? [{ id: mark.id, from: mark.from, to: mark.to, style: mark.style, ...(mark.type ? { type: mark.type } : {}) }] : [])
  const current = readMarkDocument(identitySource), sameBody = result.source === current.body
  const originalMarks = identitySource === base.identitySource ? base.markMappings : current.metadata?.marks.filter(mark => !mark.orphan) ?? []
  const byId = new Map(mappings.map(mapping => [mapping.id, mapping]))
  const sameIdentities = sameBody && originalMarks.length === mappings.length && originalMarks.every(mark => { const mapping = byId.get(mark.id); return mapping?.from === mark.from && mapping.to === mark.to && mapping.type === mark.type && JSON.stringify(mapping.style ?? {}) === JSON.stringify(mark.style ?? {}) })
  return { ...result, marks, source: sameIdentities ? identitySource === base.identitySource ? base.originalSource : identitySource : reconcileMarkDocument(identitySource, result.source, mappings) }
}
export function exportMarkdown(doc: JSONContent, base: RichMarkdownDocument): string { return exportMarkdownWithMap(doc, base).source }
