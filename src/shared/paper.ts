import type { CompilerSource } from './compilerUi'
import type { Diagnostic, SourceLocation } from '../compiler/types'
import type { Library } from './types'

export const paperTextExtensions = ['.tex', '.bib', '.cls', '.sty', '.bst', '.bbx', '.cbx', '.lbx', '.cfg', '.def', '.clo', '.txt'] as const
export const isPaperTextPath = (file: string): boolean => paperTextExtensions.some(extension => file.toLowerCase().endsWith(extension))

export type PaperEngine = 'xelatex' | 'pdflatex' | 'lualatex'
export type PaperTemplate = 'chinese' | 'article' | 'twocolumn'
export interface PaperEntry { path: string; directory: boolean; editable: boolean; size: number }
export interface PaperProject {
  id: string; rootLabel: string; name: string; files: PaperEntry[]; mainFile: string | null
  mainCandidates: string[]; engine: PaperEngine; trusted: boolean
  origin?: PaperOrigin
}
export interface PaperOrigin {
  label: string; documentId: string; revision: number
  marks: { markId: string; file: string; fromLine: number; toLine: number; source?: SourceLocation }[]
}
export interface PaperFile {
  path: string; content: string; revision: string
  draft?: { content: string; revision: string; updatedAt: string }
}
export interface PaperBuffer { path: string; content: string; revision: string }
export interface PaperDiagnostic { severity: 'error' | 'warning'; message: string; file?: string; line?: number }
export interface PaperBuildRequest {
  projectId: string; mainFile: string; engine: PaperEngine; buffers: PaperBuffer[]; revision: number
}
export interface PaperBuildResult {
  status: 'success' | 'error' | 'cancelled'; revision: number; snapshotId?: string
  artifactId?: string; diagnostics: PaperDiagnostic[]; log: string; durationMs: number
}
export interface PaperRuntimeStatus {
  available: boolean; label: string; message: string; engines: PaperEngine[]
}
export interface PaperEnvironmentStatus {
  phase: 'idle' | 'verifying' | 'extracting' | 'validating' | 'ready' | 'cancelled' | 'error'
  progress: number; message: string; activeVersion?: string; availableBundle?: string
  canRollback?: boolean; bundleBytes?: number; error?: string
}
export interface PaperMarkRequest extends PaperCreateRequest {
  source: Exclude<CompilerSource, { kind: 'sample' }>; abstract?: string
  references?: { id: string; title: string; author: string; year: string }[]
}
export type PaperMarkResult = { project: PaperProject; diagnostics: Diagnostic[] } | { diagnostics: Diagnostic[]; project?: undefined } | null
export type PaperLocateQuery = { kind: 'source'; file: string; line: number; column?: number } | { kind: 'pdf'; page: number; x: number; y: number }
export interface PaperLocation { revision: number; file?: string; line?: number; column?: number; page?: number; x?: number; y?: number; width?: number; height?: number }
export interface PaperCreateRequest { template: PaperTemplate; name: string; title: string; author: string }
export interface PaperAPI {
  paperRuntime(): Promise<PaperRuntimeStatus>
  paperEnvironment(): Promise<PaperEnvironmentStatus>
  paperInstallEnvironment(importFile?: boolean): Promise<PaperEnvironmentStatus | null>
  paperCancelEnvironment(): Promise<void>
  paperRollbackEnvironment(): Promise<PaperEnvironmentStatus>
  paperOpen(kind?: 'folder' | 'zip' | 'recent'): Promise<PaperProject | null>
  paperOpenDocument(root: string, path: string): Promise<PaperProject>
  paperActivate(projectId: string): Promise<Library>
  paperCreate(request: PaperCreateRequest): Promise<PaperProject | null>
  paperFromMark(request: PaperMarkRequest): Promise<PaperMarkResult>
  paperDetach(projectId: string): Promise<PaperProject | null>
  paperRefresh(projectId: string): Promise<PaperProject>
  paperConfigure(projectId: string, mainFile: string, engine: PaperEngine): Promise<PaperProject>
  paperTrust(projectId: string): Promise<PaperProject>
  paperRead(projectId: string, file: string): Promise<PaperFile>
  paperSave(projectId: string, buffer: PaperBuffer): Promise<PaperFile>
  paperDraft(projectId: string, buffer: PaperBuffer): Promise<void>
  paperDiscardDraft(projectId: string, path: string): Promise<void>
  paperMoveDraft(projectId: string, from: string, to: string): Promise<void>
  paperAddFile(projectId: string, file: string): Promise<PaperProject>
  paperImportAsset(projectId: string): Promise<{ project: PaperProject; path: string } | null>
  paperBuild(request: PaperBuildRequest): Promise<PaperBuildResult>
  paperCancel(projectId: string): Promise<void>
  paperPdf(projectId: string, artifactId: string): Promise<Uint8Array>
  paperLocate(projectId: string, artifactId: string, query: PaperLocateQuery): Promise<PaperLocation>
  paperExport(projectId: string, artifactId: string, target: 'pdf' | 'source'): Promise<string | null>
  paperRelease(projectId: string): Promise<void>
}
