import type { ContentMode } from '../shared/types'

export interface EditorHandle { focus(): void; jumpTo(line: number): void; find(): void; undo(): void; redo(): void }
export interface EditorProps {
  documentKey: string
  value: string
  mode: ContentMode
  theme: 'light' | 'dark'
  onChange(value: string): void
  onComposition(active: boolean): void
  onSave(): void
  onPosition(position: { cursor: number; scroll: number }): void
  initialPosition?: { cursor: number; scroll: number }
  fontSize: number
  lineHeight: number
  readOnly?: boolean
}
