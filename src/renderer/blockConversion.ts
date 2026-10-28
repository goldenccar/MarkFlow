import type { JSONContent } from '@tiptap/core'
import { importMarkdown, exportMarkdownWithMap, type RichMarkSpan } from '../shared/richMarkdown'
import { readMarkDocument } from '../shared/marks'

export type BlockFormat = 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'bulletList' | 'orderedList' | 'taskList' | 'blockquote' | 'codeBlock'
export const blockFormats: ReadonlyArray<{ value: BlockFormat; label: string; icon: string; detail: string }> = [
  { value: 'paragraph', label: '正文', icon: '¶', detail: '普通文本段落' },
  { value: 'heading1', label: '标题 1', icon: 'H1', detail: '章节标题' },
  { value: 'heading2', label: '标题 2', icon: 'H2', detail: '小节标题' },
  { value: 'heading3', label: '标题 3', icon: 'H3', detail: '段落标题' },
  { value: 'bulletList', label: '无序列表', icon: '•', detail: '项目列表' },
  { value: 'orderedList', label: '有序列表', icon: '1.', detail: '按顺序排列' },
  { value: 'taskList', label: '待办事项', icon: '☑', detail: '带复选框的列表' },
  { value: 'blockquote', label: '引用', icon: '❝', detail: '引用内容' },
  { value: 'codeBlock', label: '代码块', icon: '</>', detail: '保留为纯文本代码' },
]
const lists = new Set(['bulletList', 'orderedList', 'taskList'])
const texts = new Set(['paragraph', 'heading', 'codeBlock'])
const supported = new Set([...texts, 'blockquote', 'listItem', 'taskItem'])
const identity = (node: JSONContent) => Object.fromEntries(['markId', 'markFontFamily', 'markFontSize', 'sourceId'].filter(key => node.attrs?.[key] != null).map(key => [key, node.attrs![key]]))
const withoutIdentity = (node: JSONContent): JSONContent => ({ ...node, attrs: Object.fromEntries(Object.entries(node.attrs ?? {}).filter(([key]) => !['markId', 'markFontFamily', 'markFontSize', 'sourceId'].includes(key))) })
function parts(node: JSONContent): JSONContent[] { return texts.has(node.type!) ? [withoutIdentity(node)] : node.content ?? [] }
function inline(node: JSONContent): JSONContent[] {
  if (node.type !== 'codeBlock') return node.content ?? []
  return (node.content ?? []).flatMap(child => (child.text ?? '').split('\n').flatMap((line, index) => [...(index ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : [])]))
}
export function currentBlockFormat(node: JSONContent, parentType?: string): BlockFormat | null {
  if (node.type === 'heading') return `heading${node.attrs?.level ?? 1}` as BlockFormat
  if (node.type === 'taskItem' && node.attrs?.task === false) return 'bulletList'
  if (node.type === 'listItem' || node.type === 'taskItem') return parentType as BlockFormat
  return supported.has(node.type!) ? node.type as BlockFormat : null
}
export function blockConversionReason(node: JSONContent, target: BlockFormat): string | null {
  if (!supported.has(node.type!)) return '此内容暂不支持转换，请在源码中编辑'
  const content = parts(node)
  if ((target === 'paragraph' || target.startsWith('heading')) && (content.length !== 1 || !texts.has(content[0].type!))) return '包含子块，转换为标题或正文会改变层级'
  if (target.startsWith('heading') && inline(content[0]).some(child => child.type === 'hardBreak' || child.text?.includes('\n'))) return '多行内容请先拆成独立段落'
  return null
}
/** Transform one semantic Mark. Unrelated top-level blocks keep their original source slices. */
export function convertMarkdownBlock(source: string, id: string, target: BlockFormat): { value: string; from: number } {
  const base = importMarkdown(source), exported = exportMarkdownWithMap(base.doc, base)
  const span: RichMarkSpan | undefined = exported.marks.find(mark => mark.id === id)
  if (!span) throw new Error('此内容块已变化，请重新选择')
  const roots = base.doc.content!, top = roots[span.index], node = span.itemIndex === undefined ? top : top.content![span.itemIndex]
  const reason = blockConversionReason(node, target)
  if (reason) throw new Error(reason)
  if (currentBlockFormat(node, top.type) === target) return { value: source, from: span.from }
  const attrs = identity(node), children = parts(node)
  let replacement: JSONContent
  if (target === 'codeBlock') {
    const plainDocument = { type: 'doc', content: texts.has(node.type!) ? [{ type: 'paragraph', content: inline(node) }] : children }
    // Keep links, images, math, inline formatting and nested children as literal Markdown.
    const code = readMarkDocument(exportMarkdownWithMap(plainDocument, importMarkdown('')).source).body
    replacement = { type: 'codeBlock', attrs: { ...attrs, language: null, meta: null }, content: code ? [{ type: 'text', text: code }] : [] }
  } else if (target === 'paragraph' || target.startsWith('heading')) {
    replacement = { type: target === 'paragraph' ? 'paragraph' : 'heading', attrs: { ...attrs, ...(target === 'paragraph' ? {} : { level: Number(target.slice(-1)) }) }, content: inline(children[0]) }
  } else if (target === 'blockquote') {
    replacement = { type: 'blockquote', attrs, content: children }
  } else {
    const listChildren = children.map((child, index) => index === 0 && child.type !== 'paragraph' && texts.has(child.type!) ? { type: 'paragraph', content: inline(child) } : child)
    if (listChildren[0]?.type !== 'paragraph') listChildren.unshift({ type: 'paragraph' })
    replacement = { type: target, attrs: { ...(attrs.sourceId ? { sourceId: attrs.sourceId } : {}), ...(target === 'orderedList' ? { start: 1 } : {}) }, content: [{ type: target === 'taskList' ? 'taskItem' : 'listItem', attrs: { ...attrs, sourceId: null, ...(target === 'taskList' ? { checked: node.attrs?.checked ?? false, task: true } : {}) }, content: listChildren }] }
  }
  if (span.itemIndex === undefined) roots.splice(span.index, 1, replacement)
  else {
    const before = top.content!.slice(0, span.itemIndex), after = top.content!.slice(span.itemIndex + 1), pieces: JSONContent[] = []
    if (before.length) pieces.push({ ...top, content: before })
    if (!before.length) replacement.attrs = { ...replacement.attrs, sourceId: top.attrs?.sourceId ?? null }
    pieces.push(replacement)
    if (after.length) pieces.push({ ...top, attrs: { ...top.attrs, sourceId: null, ...(top.type === 'orderedList' ? { start: (top.attrs?.start ?? 1) + span.itemIndex + 1 } : {}) }, content: after })
    roots.splice(span.index, 1, ...pieces)
  }
  roots.forEach(root => {
    if (root.type === 'taskList' && root.content?.every(item => item.attrs?.task === false)) {
      root.type = 'bulletList'
      root.content = root.content.map(item => ({ ...item, type: 'listItem', attrs: Object.fromEntries(Object.entries(item.attrs ?? {}).filter(([key]) => !['checked', 'task'].includes(key))) }))
    }
  })
  // Adjacent lists of the same kind serialize as one Markdown list. Merge their JSON
  // roots as well so source ranges and stable item identities stay aligned.
  for (let index = roots.length - 1; index > 0; index--) {
    const previous = roots[index - 1], current = roots[index]
    if (lists.has(current.type!) && previous.type === current.type && (current.type !== 'orderedList' || (previous.attrs?.start ?? 1) + previous.content!.length === (current.attrs?.start ?? 1))) {
      previous.content = [...previous.content!, ...current.content!]; roots.splice(index, 1)
    }
  }
  const result = exportMarkdownWithMap(base.doc, base, base.identitySource)
  const converted = result.marks.find(mark => mark.id === id)
  if (!converted) throw new Error('转换后无法保留内容块身份，操作未应用')
  return { value: result.source, from: converted.from }
}
