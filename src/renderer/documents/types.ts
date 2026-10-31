import type { ComponentType, ForwardRefExoticComponent, RefAttributes } from 'react'
import type { ContentMode, Layout } from '../../shared/types'
import type { MarkSelection, MarkStylePatch, MarkdownMarkCommand } from '../../shared/marks'
import type { EditorProps } from '../editorTypes'
import type { FormatCommand, SearchResult } from '../BlockEditor'
import type { BlockFormat } from '../blockConversion'
import type { Heading } from '../markdown'

export interface DocumentEditorHandle {
  focus(): void
  flush(): void
  jumpTo(line: number): void
  find(): void
  search(query?: string, direction?: 1 | -1): SearchResult
  undo(): void
  redo(): void
  replace(value: string): void
  jump?(from: number): void
  format?(command: FormatCommand): void
  applyMarkStyle?(patch: MarkStylePatch | null): void
  markCommand?(command: MarkdownMarkCommand): void
  convertBlock?(format: BlockFormat): void
}
export interface DocumentEditorProps extends EditorProps {
  live?: boolean
  path: string
  localFiles?: boolean
  fontFamily?: string
  onNavigate(path: string, anchor?: string): void
  onExternal(url: string): void
  onMarkSelection?(state: MarkSelection | null, documentKey: string): void
  onHeadingSelection?(index: number | null, documentKey: string): void
  onError?(message: string): void
}
export interface DocumentPreviewProps {
  onOpenDocument?(): void
  content: string
  mode?: ContentMode
  path: string
  localFiles?: boolean
  onNavigate(path: string, anchor?: string): void
  onExternal(url: string): void
}
export interface DocumentContent { content: string; cleanContent: string }
export interface DocumentCapabilities { richEditing: boolean; blockFormatting: boolean; outline: boolean; livePreview: boolean }
export interface DocumentModule {
  id: ContentMode
  family: 'markdown' | 'formula'
  label: string
  defaultExtension: '.md' | '.tex'
  defaultLayout: Layout
  layouts: readonly Layout[]
  capabilities: Readonly<DocumentCapabilities>
  editor: ForwardRefExoticComponent<DocumentEditorProps & RefAttributes<DocumentEditorHandle>>
  preview: ComponentType<DocumentPreviewProps>
  initialize(source: string, diskSource: string): DocumentContent
  getOutline(content: string): Heading[]
}

/** Extension contracts only. New families need their own codec, state and renderer. */
export type FutureDocumentFamily = 'rich-document' | 'spreadsheet' | 'pdf'
export type FutureDocumentLayout = 'pages' | 'sheet' | 'continuous' | 'presentation'
export interface DocumentCodec<Model> {
  readonly extensions: readonly string[]
  readonly mimeTypes: readonly string[]
  decode(bytes: Uint8Array): Promise<Model>
  encode(model: Model): Promise<Uint8Array>
}
export interface DocumentSource { kind: 'file' | 'draft'; id: string; revision: string | null }
export interface DocumentCommand<Target = unknown> { type: string; target?: Target; payload?: unknown }
export interface DocumentSnapshot<Model> { model: Model; revision: number; dirty: boolean }
/** Each module owns command targets (blocks, cells or pages) and its history/model. */
export interface DocumentRuntime<Model, Command extends DocumentCommand = DocumentCommand> {
  readonly source: DocumentSource
  snapshot(): DocumentSnapshot<Model>
  canExecute(command: Command): boolean
  execute(command: Command, expectedRevision: number): DocumentSnapshot<Model>
  flush(): Promise<DocumentSnapshot<Model>>
  dispose(): void
}
export interface FutureDocumentModule<Model, Command extends DocumentCommand = DocumentCommand> {
  family: FutureDocumentFamily
  label: string
  codec: DocumentCodec<Model>
  layouts: readonly FutureDocumentLayout[]
  defaultLayout: FutureDocumentLayout
  createRuntime(source: DocumentSource, model: Model): DocumentRuntime<Model, Command> | Promise<DocumentRuntime<Model, Command>>
  render: ComponentType<{ snapshot: DocumentSnapshot<Model>; readOnly: boolean; onCommand(command: Command, expectedRevision: number): void }>
}
