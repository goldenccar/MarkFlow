import { memo } from 'react'
import type { ContentMode } from '../shared/types'
import { MarkdownPreview } from './documents/MarkdownPreview'
import { FormulaPreview } from './documents/FormulaPreview'
import type { DocumentPreviewProps } from './documents/types'

export { getHeadings } from './markdown'
export { MarkdownPreview, FormulaPreview }
export interface PreviewProps extends DocumentPreviewProps { mode: ContentMode }

/** Compatibility facade; only the selected module renders or parses its content. */
export const Preview = memo(function Preview(props: PreviewProps) {
  return props.mode === 'latex-math' ? <FormulaPreview {...props} /> : <MarkdownPreview {...props} />
})
export default Preview
