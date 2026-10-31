import type { Diagnostic } from '../compiler/types'

export type CompilerTarget = 'docx' | 'pptx'
export type CompilerSource =
  | { kind: 'sample' }
  | { kind: 'file' }
  | { kind: 'current'; content: string; root?: string; path?: string }

/** Display labels are not filesystem grants. Only opaque IDs can authorize later actions. */
export interface CompilerSession {
  id: string
  sourceKind: CompilerSource['kind']
  sourceLabel: string
  assetRootLabel: string
  presentationLabel: string | null
  fonts: { family: string; fileLabel: string }[]
}
export type CompilerSelection = 'presentation' | 'assets' | 'font'
export interface CompilerExportRequest { sessionId: string; target: CompilerTarget }
export type CompilerExportResult =
  | { status: 'cancelled' }
  | { status: 'error'; diagnostics: Diagnostic[] }
  | { status: 'success'; artifactId: string; path: string; warnings: Diagnostic[] }

export interface CompilerAPI {
  compilerCreate(source: CompilerSource): Promise<CompilerSession | null>
  compilerChoose(sessionId: string, selection: CompilerSelection, family?: string): Promise<CompilerSession | null>
  compilerUseAutomatic(sessionId: string): Promise<CompilerSession>
  compilerExport(request: CompilerExportRequest): Promise<CompilerExportResult>
  compilerOpen(artifactId: string, reveal?: boolean): Promise<void>
  compilerRelease(sessionId: string): Promise<void>
}
