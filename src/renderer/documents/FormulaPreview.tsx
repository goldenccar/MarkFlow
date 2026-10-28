import { memo, useMemo } from 'react'
import katex from 'katex'
import { mathOptions } from './mathOptions'
import { toFormulaSource } from './formulaSource'
import type { DocumentPreviewProps } from './types'

/** Pure LaTeX rendering; this module never imports the Markdown parser or Mark registry. */
export const FormulaPreview = memo(function FormulaPreview({ content }: DocumentPreviewProps) {
  const result = useMemo(() => {
    const body = toFormulaSource(content)
    try { return { html: katex.renderToString(body, { ...mathOptions(), displayMode: true, throwOnError: true }) } }
    catch (error) { return { error: error instanceof Error ? error.message : String(error), body } }
  }, [content])
  return <article className="document-preview math-preview">
    <p className="math-mode-note">LaTeX 数学片段</p>
    {result.error ? <div className="math-error" role="status"><strong>公式尚不能渲染</strong><p>{result.error}</p><pre>{result.body}</pre></div>
      : <div dangerouslySetInnerHTML={{ __html: result.html! }} />}
  </article>
})
export default FormulaPreview
