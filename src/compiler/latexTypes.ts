import type { Diagnostic, MarkDocumentInput, SemanticContent, SourceLocation, TextRun } from './types.js'

export type PaperRun = TextRun | { kind: 'math'; tex: string } | { kind: 'citation'; keys: string[] } | { kind: 'cross-reference'; targetId: string }
export type PaperContent = Exclude<SemanticContent, { runs: TextRun[] } | { kind: 'table' }>
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; runs: PaperRun[] }
  | { kind: 'paragraph'; runs: PaperRun[] }
  | { kind: 'list-item'; ordered: boolean; ordinal?: number; runs: PaperRun[] }
  | { kind: 'table'; header: boolean; rows: PaperRun[][][] }
  | { kind: 'equation'; tex: string }

/** Paper interpretation is derived separately; the shared Office document remains unchanged. */
export interface PaperDocumentInput {
  format: 'markflow-paper'; version: 1; document: MarkDocumentInput
  extensions: { markId: string; content: PaperContent }[]
}
export interface PaperReference {
  id: string; type: 'book' | 'article' | 'misc'; title: string; author: string; year: string
  publisher?: string; journal?: string; url?: string
}
export interface PaperPresentation {
  format: 'markflow-paper-presentation'; version: 1; template: 'chinese' | 'article' | 'twocolumn'
  title: string; authors: string[]; abstract?: string; references?: PaperReference[]
}
export interface PaperSourceMap {
  format: 'markflow-latex-map'; version: 1; documentId: string; revision: number
  marks: { markId: string; file: string; fromLine: number; toLine: number; source?: SourceLocation }[]
}
export interface PaperSource {
  engine: 'xelatex'; mainFile: 'main.tex'; files: Record<string, string>
  /** The caller must resolve these through the existing authorized-resource boundary before writing. */
  assets: { id: string; path: string; targetPath: string }[]
  sourceMap: PaperSourceMap; diagnostics: Diagnostic[]
}
