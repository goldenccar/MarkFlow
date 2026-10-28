export type ContentMode = 'markdown' | 'latex-math'
export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'
export interface WindowAppearance { theme: ThemePreference; mode: ContentMode }
export type Layout = 'source' | 'preview' | 'split'
export const fontFamilies = ['system', 'fangsong', 'fangsong-gb2312', 'kaiti', 'kaiti-gb2312', 'microsoft-yahei', 'alibaba-puhuiti'] as const
export type FontFamily = typeof fontFamilies[number]
export interface FontOption { id: FontFamily; name: string; family: string; available: boolean; source: 'system' | 'bundled' | 'fallback' }
export interface Settings {
  autoCommit: boolean
  threshold: number
  theme: ThemePreference
  fontSize: number
  fontFamily: FontFamily
  lineHeight: number
  lineWidth: number
  layout: Layout
  recent: { root: string; path: string }[]
  projects: { root: string; lastOpened: string }[]
  lastProject: string | null
  positions: Record<string, { cursor: number; scroll: number; previewScroll?: number }>
}
export const defaultSettings: Settings = {
  autoCommit: true, threshold: 500, theme: 'system', fontSize: 16, fontFamily: 'system',
  lineHeight: 1.8, lineWidth: 780, layout: 'preview', recent: [], projects: [], lastProject: null, positions: {},
}
export interface FileEntry { path: string; name: string; directory: boolean; children?: FileEntry[] }
export interface ArchiveEntry { path: string; archivedAt: string }
export interface DiskFile { path: string; content: string; revision: string; eol: '\n' | '\r\n' | '\r'; bom: boolean }
export interface Draft { path: string; content: string; revision: string; updatedAt: string }
export interface UntitledDraft { id: string; content: string; mode: ContentMode; updatedAt: string }
export interface SaveUntitledRequest { id: string; content: string; mode: ContentMode; projectRoot?: string }
export interface SaveUntitledResult { library: Library; file: DiskFile; version: GitCommitResult; warning?: string }
export interface GitStatus {
  available: boolean; repository: boolean; branch: string; remote: string;
  ahead: number; behind: number; changes: string[]; conflicts: string[];
  identity: { name: string; email: string }; blocked: string | null; lastSync: string | null
}
export interface GitCommitResult { committed: boolean; oid?: string; error?: string }
export interface HistoryEntry { oid: string; date: string; subject: string }
export interface SaveRequest { path: string; content: string; revision: string; attachments?: string[] }
export interface SaveResult { file: DiskFile; version: GitCommitResult }
export interface Library { root: string; entries: FileEntry[] }
export interface OpenDocument { file: DiskFile; draft: Draft | null; baseline: string | null }
export interface MutationResult { path: string; affectedLinks: string[]; warning?: string }
export interface OopsAPI {
  readonly platform: string
  setWindowAppearance(appearance: WindowAppearance): Promise<void>
  fonts(): Promise<FontOption[]>
  chooseLibrary(): Promise<Library | null>
  openProject(root: string): Promise<Library>
  listUntitled(): Promise<UntitledDraft[]>
  putUntitled(draft: UntitledDraft): Promise<void>
  deleteUntitled(id: string): Promise<void>
  saveUntitled(request: SaveUntitledRequest): Promise<SaveUntitledResult | null>
  chooseFile(): Promise<{ library: Library; path: string } | null>
  openRecent(root: string, path: string): Promise<{ library: Library; path: string }>
  openDropped(file: File): Promise<{ library: Library; path?: string } | null>
  tree(): Promise<FileEntry[]>
  listArchive(): Promise<ArchiveEntry[]>
  archive(path: string): Promise<ArchiveEntry[]>
  unarchive(path: string): Promise<ArchiveEntry[]>
  read(path: string): Promise<OpenDocument>
  save(request: SaveRequest): Promise<SaveResult>
  draft(draft: Draft): Promise<void>
  clearDraft(path: string): Promise<void>
  create(path: string, directory: boolean): Promise<FileEntry[]>
  move(from: string, to: string): Promise<MutationResult>
  remove(path: string): Promise<MutationResult>
  exportCopy(content: string): Promise<boolean>
  settings(): Promise<Settings>
  updateSettings(settings: Settings): Promise<Settings>
  gitStatus(): Promise<GitStatus>
  gitInit(identity: { name: string; email: string }): Promise<GitStatus>
  gitConfigure(remote: string, branch: string, identity: { name: string; email: string }): Promise<GitStatus>
  gitRecord(paths: string[], message: string): Promise<GitCommitResult>
  history(path: string): Promise<HistoryEntry[]>
  version(path: string, oid: string): Promise<string>
  sync(): Promise<GitStatus>
  abortMerge(): Promise<GitStatus>
  resolveConflict(path: string, choice: 'ours' | 'theirs'): Promise<GitStatus>
  finishMerge(): Promise<GitStatus>
  openExternal(url: string): Promise<void>
  openAttachment(path: string): Promise<void>
  copyText(value: string): Promise<void>
  find(query: string): Promise<void>
  stopFind(): Promise<void>
  onAction(listener: (action: string) => void): () => void
  onFilesChanged(listener: () => void): () => void
  onCloseRequest(listener: () => void): () => void
  closeReady(): void
}
declare global { interface Window { oops: OopsAPI } }
