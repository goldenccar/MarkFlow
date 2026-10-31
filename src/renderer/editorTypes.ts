import type { ContentMode, ResolvedTheme } from '../shared/types'
import type { CompletionEngine, CompletionSettings } from '../shared/completionSettings'

export interface EditorHandle { focus(): void; jumpTo(line: number): void; find(): void; undo(): void; redo(): void }
export interface EditorProps {
  completion?: CompletionSettings
  completionEngine?: CompletionEngine
  documentKey: string
  value: string
  mode: ContentMode
  theme: ResolvedTheme
  onChange(value: string): void
  onComposition(active: boolean): void
  onSave(): void
  onPosition(position: { cursor: number; scroll: number }): void
  initialPosition?: { cursor: number; scroll: number }
  fontSize: number
  lineHeight: number
  readOnly?: boolean
}
