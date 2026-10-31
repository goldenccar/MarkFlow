import { memo, useMemo } from 'react'
import katex from 'katex'
import { mathOptions } from './mathOptions'
import { isLatexDocument, toFormulaSource } from './formulaSource'
import type { DocumentPreviewProps } from './types'

/** Pure LaTeX rendering; this module never imports the Markdown parser or Mark registry. */
export const FormulaPreview = memo(function FormulaPreview({ content, onOpenDocument }: DocumentPreviewProps) {
  const result = useMemo(() => {
    const body = toFormulaSource(content)
    if (isLatexDocument(body)) return { document: true }
    try { return { html: katex.renderToString(body, { ...mathOptions(), displayMode: true, throwOnError: true }) } }
    catch (error) { return { error: error instanceof Error ? error.message : String(error), body } }
  }, [content])
  return <article className="document-preview math-preview">
    {result.document ? <div className="empty-preview"><strong>LaTeX 文档</strong><p>这份内容包含完整页面结构。保存到项目后，可编译为分页 PDF。</p><button onClick={onOpenDocument}>打开文档与 PDF 预览</button></div> : <>
    <p className="math-mode-note">LaTeX 数学片段</p>
    {result.error ? <div className="math-error" role="status"><strong>公式尚不能渲染</strong><p>{result.error}</p><pre>{result.body}</pre></div>
      : <div dangerouslySetInnerHTML={{ __html: result.html! }} />}</>}
  </article>
})
export default FormulaPreview
