import { forwardRef, useCallback } from 'react'
import BlockEditor from '../BlockEditor'
import type { DocumentEditorHandle, DocumentEditorProps } from './types'

export const MarkdownEditor = forwardRef<DocumentEditorHandle, DocumentEditorProps>(function MarkdownEditor(props, ref) {
  const attach = useCallback((handle: DocumentEditorHandle | null) => { if (typeof ref === 'function') ref(handle); else if (ref) ref.current = handle }, [ref])
  return <BlockEditor {...props} mode="markdown" ref={attach} />
})
export default MarkdownEditor
