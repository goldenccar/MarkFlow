import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

export interface MarkdownAst {
  type: string; value?: string; children?: MarkdownAst[]; depth?: number; url?: string; title?: string | null; alt?: string | null
  identifier?: string; label?: string; referenceType?: string; ordered?: boolean; start?: number | null; spread?: boolean; checked?: boolean | null
  lang?: string | null; meta?: string | null; align?: Array<string | null>
  position?: { start: { offset: number; line: number }; end: { offset: number; line: number } }
}

export interface MarkdownBlock {
  id: string
  type: string
  label: string
  from: number
  to: number
  raw: string
  line: number
  endLine: number
  level?: number
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath)
let lastParse: { source: string; tree: MarkdownAst } | undefined
/** Shared read-only syntax: one exact body, at most 64 Ki UTF-16 units, replaced on the next parse. */
export function parseMarkdown(source: string): MarkdownAst {
  if (lastParse?.source === source) return lastParse.tree
  const tree = parser.parse(source) as MarkdownAst
  lastParse = source.length <= 64 * 1024 ? { source, tree } : undefined
  return tree
}
function label(node: MarkdownAst): string {
  if (node.type === 'break') return ' '
  if (node.children) return node.children.map(label).join(['list', 'listItem', 'blockquote', 'table', 'tableRow'].includes(node.type) ? ' · ' : '')
  return node.alt ?? node.value ?? (node.type === 'thematicBreak' ? '分隔线' : '')
}

/** Offsets point into the original string. Gaps and trailing newlines stay in the editor document. */
export function parseBlocks(content: string): MarkdownBlock[] {
  const tree = parseMarkdown(content)
  const nodes = (tree.children ?? []).flatMap(node => node.type === 'list' ? node.children ?? [] : [node])
  const blocks = nodes.flatMap(node => {
    if (!node.position) return []
    const { start, end } = node.position
    return [{
      id: `${node.type}-${start.offset}`, type: node.type,
      label: label(node).replace(/\s+/g, ' ').trim().slice(0, 80) || ({ code: '代码', math: '数学公式', html: 'HTML', definition: '链接定义', listItem: '列表项' }[node.type] ?? 'Mark'),
      from: start.offset, to: end.offset, raw: content.slice(start.offset, end.offset),
      line: start.line, endLine: end.line, ...(node.depth ? { level: node.depth } : {}),
    }]
  })
  if (!content.trim() || /(?:\r?\n[ \t]*){2,}$/.test(content)) {
    const line = content.split(/\r\n|\r|\n/).length
    blocks.push({ id: `empty-${content.length}`, type: 'empty', label: '空白 Mark', from: content.length, to: content.length, raw: '', line, endLine: line })
  }
  return blocks
}

export interface BlockBreak { from: number; to: number; insert: string; anchor: number }

/** A targeted edit, never a Markdown reserialization. Structured literals keep their internal newlines. */
export function blockBreak(content: string, selectionFrom: number, selectionTo = selectionFrom, soft = false): BlockBreak {
  let from = Math.max(0, Math.min(content.length, selectionFrom))
  const to = Math.max(from, Math.min(content.length, selectionTo))
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const block = parseBlocks(content).find(item => item.from <= from && from <= item.to)
  const lineStart = content.lastIndexOf('\n', Math.max(0, from - 1)) + 1
  const before = content.slice(lineStart, from)
  let insert: string
  if (block && ['code', 'math', 'table', 'html'].includes(block.type) && (soft || from < block.to)) {
    insert = eol
  } else {
    const list = /^(\s*)([-+*]|\d+[.)])([ \t]+)(\[[ xX]\][ \t]+)?/.exec(before)
    const quote = /^(?:[ \t]{0,3}>[ \t]?)+/.exec(before)
    if (soft) {
      const continuation = list ? ' '.repeat(list[0].length) : quote?.[0] ?? ''
      insert = '  ' + eol + continuation
    } else if (list && block?.type === 'listItem') {
      if (!before.slice(list[0].length).trim()) { from = lineStart; insert = eol }
      else {
        const marker = /^\d/.test(list[2]) ? `${Number.parseInt(list[2]) + 1}${list[2].slice(-1)}` : list[2]
        insert = eol + list[1] + marker + list[3] + (list[4] ? '[ ] ' : '')
      }
    } else if (quote && block?.type === 'blockquote') {
      if (!before.slice(quote[0].length).trim()) { from = lineStart; insert = eol }
      else insert = eol + eol + quote[0]
    } else insert = eol + eol
  }
  return { from, to, insert, anchor: from + insert.length }
}
