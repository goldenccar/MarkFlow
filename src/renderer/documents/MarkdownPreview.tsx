import { memo, useMemo, useRef, useState, type ComponentProps } from 'react'
import ReactMarkdown, { type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { assetUrl, remarkHeadingIds, resolveLink } from '../markdown'
import { remarkSafeFormatting } from '../safeFormatting'
import { parseMarks, readMarkDocument } from '../../shared/marks'
import { fontFamilyCss } from '../../shared/fonts'

import type { DocumentPreviewProps } from './types'
import { mathOptions } from './mathOptions'

interface HastNode { type: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] }
/** KaTeX replaces a display formula's pre/code nodes; its Mark remains on a stable parent. */
function preserveMathMarks() {
  return function visit(node: HastNode) {
    node.children = node.children?.map(child => {
      visit(child)
      if (child.tagName !== 'pre') return child
      const code = child.children?.find(item => item.tagName === 'code')
      const classes = code?.properties?.className
      if (!Array.isArray(classes) || !classes.includes('language-math')) return child
      const marked = [child, code].find(item => item?.properties?.['data-mark-id'] || item?.properties?.dataMarkId)
      if (!marked?.properties) return child
      const properties: Record<string, unknown> = {}
      for (const key of ['data-mark-id', 'dataMarkId', 'style']) if (marked.properties[key] !== undefined) { properties[key] = marked.properties[key]; delete marked.properties[key] }
      return { type: 'element', tagName: 'div', properties, children: [child] }
    })
  }
}

function CodeBlock({ children, node: _node, ...props }: ComponentProps<'pre'> & ExtraProps) {
  const element = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  return <div className="code-block">
    <button className="copy-code" type="button" aria-label="复制代码" onClick={async () => {
      try {
        await window.oops.copyText(element.current?.textContent ?? '')
        setCopied(true); setFailed(false)
      } catch { setFailed(true) }
    }}>{failed ? '复制失败' : copied ? '已复制' : '复制'}</button>
    <pre ref={element} {...props}>{children}</pre>
  </div>
}

export const MarkdownPreview = memo(function MarkdownPreview({ content, path, localFiles = true, onNavigate, onExternal }: DocumentPreviewProps) {
  const markdown = useMemo(() => {
    const body = readMarkDocument(content).body, marks = new Map(parseMarks(content).map(mark => [mark.from, mark]))
    interface Node { type: string; position?: { start: { offset?: number }; end: { offset?: number } }; data?: Record<string, unknown>; children?: Node[] }
    const styles = () => (tree: Node) => {
      const visit = (node: Node) => {
        const mark = marks.get(node.position?.start.offset ?? -1)
        if (mark && node.type === mark.type && node.position?.end.offset === mark.to) {
          const style = `${mark.style.fontFamily ? `font-family:${fontFamilyCss(mark.style.fontFamily)};--mark-font:${fontFamilyCss(mark.style.fontFamily)};` : ''}${mark.style.fontSize ? `font-size:${mark.style.fontSize}px;` : ''}`
          node.data = { ...node.data, hProperties: { ...(node.data?.hProperties as object ?? {}), ...(style ? { style } : {}), 'data-mark-id': mark.id } }
        }
        node.children?.forEach(visit)
      }
      visit(tree)
    }
    return { body, styles }
  }, [content])
  return <article className="document-preview markdown-preview">
    <ReactMarkdown skipHtml remarkPlugins={[remarkGfm, remarkMath, remarkSafeFormatting, remarkHeadingIds, markdown.styles]}
      rehypePlugins={[preserveMathMarks, [rehypeKatex, mathOptions()], [rehypeHighlight, { detect: false, ignoreMissing: true }]]}
      urlTransform={(url) => url}
      components={{
        a: ({ href = '', children }) => {
          const target = resolveLink(href, path)
          if (target.kind === 'blocked') return <span className="blocked-link" title="该链接的协议或路径不受支持">{children}</span>
          return <a href={target.kind === 'external' ? target.url : target.anchor && target.path === path ? `#${encodeURIComponent(target.anchor)}` : assetUrl(target.path)} onClick={(event) => {
            event.preventDefault()
            if (target.kind === 'external') onExternal(target.url)
            else onNavigate(target.path, target.anchor)
          }}>{children}</a>
        },
        img: ({ src = '', alt = '', title }) => {
          const target = resolveLink(typeof src === 'string' ? src : '', path)
          return localFiles && target.kind === 'local' && target.path !== path
            ? <img src={assetUrl(target.path)} alt={alt} title={title} loading="lazy" />
            : <span className="blocked-image" title="预览仅加载文档库内的相对图片">[图片：{alt || '不支持的地址'}]</span>
        },
        pre: CodeBlock,
        table: ({ node: _node, ...props }) => <div className="table-scroll"><table {...props} /></div>,
      }}>{markdown.body}</ReactMarkdown>
  </article>
})

export default MarkdownPreview
