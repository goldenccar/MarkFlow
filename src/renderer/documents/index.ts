import type { ContentMode, Layout } from '../../shared/types'
import { readMarkDocument } from '../../shared/marks'
import { getHeadings } from '../markdown'
import { FormulaEditor } from './FormulaEditor'
import { FormulaPreview } from './FormulaPreview'
import { initializeFormulaContent } from './formulaSource'
import { MarkdownEditor } from './MarkdownEditor'
import { MarkdownPreview } from './MarkdownPreview'
import { initializeMarkdownContent } from './markdownContent'
import type { DocumentModule } from './types'

export type { DocumentEditorHandle, DocumentEditorProps, DocumentPreviewProps, DocumentContent, DocumentModule, DocumentCapabilities, FutureDocumentModule, FutureDocumentFamily, FutureDocumentLayout, DocumentCodec, DocumentSource, DocumentCommand, DocumentSnapshot, DocumentRuntime } from './types'
export { toFormulaSource } from './formulaSource'
export { MarkdownPreview, FormulaPreview }

const modules: Readonly<Record<ContentMode, DocumentModule>> = {
  markdown: {
    id: 'markdown', family: 'markdown', label: 'Markdown', defaultExtension: '.md', defaultLayout: 'preview', layouts: ['preview', 'source', 'split'],
    capabilities: { richEditing: true, blockFormatting: true, outline: true, livePreview: true },
    editor: MarkdownEditor, preview: MarkdownPreview, initialize: initializeMarkdownContent,
    getOutline: content => getHeadings(readMarkDocument(content).body),
  },
  'latex-math': {
    id: 'latex-math', family: 'formula', label: 'Fomula', defaultExtension: '.tex', defaultLayout: 'split', layouts: ['split', 'source'],
    capabilities: { richEditing: false, blockFormatting: false, outline: false, livePreview: true },
    editor: FormulaEditor, preview: FormulaPreview, initialize: initializeFormulaContent, getOutline: () => [],
  },
}
export function getDocumentModule(mode: ContentMode | string): DocumentModule {
  if (!Object.hasOwn(modules, mode)) throw new Error(`不支持的文档类型：${mode}`)
  return modules[mode as ContentMode]
}
export function normalizeDocumentLayout(mode: ContentMode, layout?: string): Layout {
  const module = getDocumentModule(mode)
  return module.layouts.includes(layout as Layout) ? layout as Layout : module.defaultLayout
}
export const registeredDocumentModules: readonly DocumentModule[] = Object.freeze(Object.values(modules))
export function modeForPath(path: string): ContentMode | undefined {
  if (/\.tex$/i.test(path)) return 'latex-math'
  if (/\.(?:md|markdown|mdown|txt)$/i.test(path)) return 'markdown'
  return undefined
}
export function getDocumentModuleForPath(path: string): DocumentModule | undefined {
  const mode = modeForPath(path)
  return mode ? getDocumentModule(mode) : undefined
}
