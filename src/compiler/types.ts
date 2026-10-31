import type { EngineOptions, MarkCommand, MarkSnapshot, MarkTypography, TextRun } from '../engine/index.js'

export type { MarkCommand, MarkTypography, TextRun }

/** Positions refer to the unmodified source. Offsets count UTF-16 code units. */
export interface SourceLocation { file: string; pointer?: string; from?: number; to?: number; line?: number; column?: number }
export interface Diagnostic {
  code: string; severity: 'error' | 'warning'; message: string
  documentId?: string; markId?: string; field?: string; source?: SourceLocation; suggestion?: string
}
export type SemanticContent =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; runs: TextRun[] }
  | { kind: 'paragraph'; runs: TextRun[] }
  | { kind: 'list-item'; ordered: boolean; ordinal?: number; runs: TextRun[] }
  | { kind: 'image'; assetId: string; alt: string; caption?: string }
  | { kind: 'table'; header: boolean; rows: TextRun[][][] }
  | { kind: 'reference'; targetId: string }

export interface SemanticMark { id: string; content: SemanticContent; style?: MarkTypography; source?: SourceLocation }
export interface AssetInput { id: string; path: string }
/** The public input carries no undo history, UI state or writer-specific objects. */
export interface MarkDocumentInput {
  format: 'markflow'; version: 1; documentId: string; revision: number
  marks: SemanticMark[]; assets: AssetInput[]
  retiredIds?: string[]
  /** Definitions consumed by Markdown resolution retain their original identity and location. */
  consumedSources?: { id: string; source: SourceLocation }[]
}
export interface NormalizedDocument {
  documentId: string; snapshot: MarkSnapshot<SemanticContent>; assets: AssetInput[]
  sources: Record<string, SourceLocation>
  consumedSources: { id: string; source: SourceLocation }[]
}
export type SemanticEngineOptions = EngineOptions<SemanticContent>

export interface NotePresentation {
  format: 'markflow-presentation'; version: 1; target: 'docx'; theme: 'standard-v1'
  sections: { marks: string[]; breakBefore?: boolean }[]
}
export type SlideLayout = 'cover' | 'body' | 'image' | 'table'
export interface StagePresentation {
  format: 'markflow-presentation'; version: 1; target: 'pptx'; theme: 'standard-v1'
  slides: { layout: SlideLayout; title: string; marks: string[] }[]
}
export type Presentation = NotePresentation | StagePresentation
export interface Theme {
  id: 'standard-v1'; version: 1; fontFamily: string
  ink: string; muted: string; accent: string; background: string
  note: { widthPt: number; heightPt: number; marginPt: number; bodyPt: number; headingPt: number[]; lineHeight: number }
  stage: { widthPt: number; heightPt: number; marginPt: number; titlePt: number; coverPt: number; bodyPt: number; minimumPt: number; lineHeight: number }
}
export interface ResolvedAsset {
  id: string; relativePath: string; mime: 'image/png' | 'image/jpeg'; data: Uint8Array
  width: number; height: number; sha256: string
}
export interface FontEvidence { family: string; file: string; sha256: string; postscriptName: string; unitsPerEm: number }
export interface ResolvedMark { id: string; content: Exclude<SemanticContent, { kind: 'reference' }>; style: MarkTypography; source?: SourceLocation }
export interface Box { x: number; y: number; width: number; height: number }
export interface PlacedMark { mark: ResolvedMark; box: Box; fontSizePt: number; lines?: TextRun[][]; rowHeightsPt?: number[]; tableLines?: TextRun[][][][] }
export interface SlidePlan { layout: SlideLayout; title: PlacedMark; items: PlacedMark[] }
export interface CompilationManifest {
  compiler: { name: 'markflow'; version: string }; target: 'docx' | 'pptx'; documentId: string; revision: number
  inputSha256: string; presentationSha256: string; planSha256: string
  template: { id: string; version: number; sha256: string }
  fonts: FontEvidence[]; assets: { id: string; relativePath: string; sha256: string }[]
  writer: { name: string; version: string }; diagnostics: Diagnostic[]
}
export interface CompilationPlan {
  target: 'docx' | 'pptx'; documentId: string; revision: number; theme: Theme
  sections: { marks: ResolvedMark[]; breakBefore: boolean }[]; slides: SlidePlan[]
  assets: Map<string, ResolvedAsset>; manifest: CompilationManifest
}
export interface CompileOptions {
  /** Filesystem root explicitly granted by the caller; sources and output remain separate. */
  assetRoot: string
  /** Font family -> local font file. Fonts are measured, never embedded or redistributed. */
  fontFiles: Record<string, string>
}
export interface CompileResult { bytes: Uint8Array; manifest: CompilationManifest }
