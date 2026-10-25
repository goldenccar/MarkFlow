import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

interface MarkdownNode {
  type: string
  value?: string
  alt?: string
  depth?: number
  children?: MarkdownNode[]
  position?: { start: { line: number } }
  data?: { hProperties?: Record<string, unknown> }
}

export interface Heading { id: string; text: string; level: number; line: number }
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath)

function plainText(node: MarkdownNode): string {
  if (node.type === 'html') return ''
  return node.children?.map(plainText).join('') ?? node.alt ?? node.value ?? ''
}

function annotateHeadings(tree: MarkdownNode): Heading[] {
  const headings: Heading[] = []
  const used = new Set<string>()
  function visit(node: MarkdownNode) {
    if (node.type === 'heading') {
      const text = plainText(node)
      const base = text.toLowerCase().trim().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-') || 'section'
      let id = base
      let suffix = 0
      while (used.has(id)) id = `${base}-${++suffix}`
      used.add(id)
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } }
      headings.push({ id, text, level: node.depth ?? 1, line: node.position?.start.line ?? 1 })
    }
    node.children?.forEach(visit)
  }
  visit(tree)
  return headings
}

export function getHeadings(content: string): Heading[] {
  return annotateHeadings(parser.parse(content) as MarkdownNode)
}

export function remarkHeadingIds() {
  return (tree: MarkdownNode) => { annotateHeadings(tree) }
}

export type LinkTarget = { kind: 'local'; path: string; anchor?: string } | { kind: 'external'; url: string } | { kind: 'blocked' }

/** The main process validates scope again before reading the resolved library path. */
export function resolveLink(value: string, documentPath: string): LinkTarget {
  const href = value.trim()
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
    try {
      const url = new URL(href)
      if (url.username || url.password) return { kind: 'blocked' }
      return { kind: 'external', url: url.href }
    } catch { return { kind: 'blocked' } }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || /^[\\/]/.test(href)) return { kind: 'blocked' }
  try {
    const hash = href.indexOf('#')
    const sourcePath = decodeURIComponent(hash < 0 ? href : href.slice(0, hash)).replace(/\\/g, '/')
    const anchor = hash < 0 ? undefined : decodeURIComponent(href.slice(hash + 1))
    if (/[\u0000-\u001f\u007f:]/.test(sourcePath) || sourcePath.startsWith('/') || (anchor && /[\u0000-\u001f\u007f]/.test(anchor))) return { kind: 'blocked' }
    const pieces = sourcePath ? documentPath.replace(/\\/g, '/').split('/').slice(0, -1) : []
    if (!sourcePath) return { kind: 'local', path: documentPath, anchor }
    for (const part of sourcePath.split('/')) {
      if (!part || part === '.') continue
      if (part === '..') {
        if (!pieces.length) return { kind: 'blocked' }
        pieces.pop()
      } else pieces.push(part)
    }
    return pieces.length ? { kind: 'local', path: pieces.join('/'), anchor } : { kind: 'blocked' }
  } catch { return { kind: 'blocked' } }
}

export function assetUrl(path: string): string {
  return `oops-asset://library/${path.split('/').map(encodeURIComponent).join('/')}`
}
