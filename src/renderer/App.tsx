import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { getDocumentModule, normalizeDocumentLayout, registeredDocumentModules, modeForPath, type DocumentEditorHandle } from './documents'
import DocumentNavigation from './DocumentNavigation'
import FomulaModeSwitch from './FomulaModeSwitch'
import { isLatexDocument } from './documents/formulaSource'
import { useWorkspaceMotion } from './useWorkspaceMotion'
import { useLatestEvent } from './useLatestEvent'
import { useReadingHeading } from './useReadingHeading'
import { useResolvedTheme } from './useResolvedTheme'
import ApplicationBar from './ApplicationBar'
import ProjectSidebar from './ProjectSidebar'
import SelectControl from './SelectControl'
import SettingsPanel from './SettingsPanel'
import { WorkspaceToolbar, WorkspacePaneHeading, WorkspaceLayoutSwitch } from './WorkspaceFrame'
import QuestionDialog from './QuestionDialog'
import ProjectDialog from './ProjectDialog'
import CompileDialog, { type CompileCurrentDocument } from './CompileDialog'
import type { Diagnostic } from '../compiler/types'
import type { PaperWorkspaceHandle, PaperWorkspaceState } from './PaperWorkspace'
import { isPaperTextPath, type PaperProject } from '../shared/paper'
const PaperWorkspace = lazy(() => import('./PaperWorkspace'))
import { dirtyProjectPaths, remoteSummary } from './projectState'
import './document-workspace.css'
import { Icon } from './Icons'
import { canStickPinnedTabs, fileTabId, orderTabs, readTabSession, reorderTabs, sessionKey, type DocumentTab } from './tabs'
import { useOutline } from './useOutline'
import { archiveOwner, filterTree, moveDestination } from './treeModel'
import { shouldAutoCommit } from '../shared/changes'
import { countChanges } from './changeCounter'
import { navigateMenu, useContextMenu } from './contextMenu'
import { initializeDocumentContent, isDocDirty, type DocumentContent } from './documentSession'
import { parseMarks, readMarkDocument, type MarkSelection, type MarkStylePatch } from '../shared/marks'
import { defaultSettings, type FontOption, type ArchiveEntry, type ContentMode, type DiskFile, type FileEntry, type GitStatus, type HistoryEntry, type Library, type Settings, type UntitledDraft } from '../shared/types'

type Doc = DocumentContent & { tabId?: string; root?: string; file: DiskFile; baseline: string; mode: ContentMode; untitledId?: string; editorKey?: string }
type DocInput = Omit<Doc, 'cleanContent'> & { cleanContent?: string }
type Question = { id: string; title: string; detail?: string; initial?: string; buttons: string[]; resolve: (answer: string | null) => void }
const api = window.oops
const isMac = api?.platform === 'darwin'
const shortcut = (key: string) => `${isMac ? '⌘' : 'Ctrl'} ${key}`
const isText = (path: string) => /\.(md|markdown|mdown|txt|tex)$/i.test(path)
const normalize = (s: string) => s.replace(/\r\n|\r/g, '\n')
const baselineText = (version: string | null, disk: string) => normalize(version === null ? disk : version.replace(/^\uFEFF/, ''))
const dirname = (s: string) => s.includes('/') ? s.slice(0, s.lastIndexOf('/')) : ''
const basename = (s: string) => s.split('/').at(-1) ?? s
const sameRoot = (a: string | undefined, b: string | undefined) => !!a && !!b && (api.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
const affectsPath = (path: string, parent: string) => path === parent || path.startsWith(parent + '/')
const emptyPaperState: PaperWorkspaceState = { project: null, activePath: '', dirtyPaths: [], busy: false, building: false, outline: [] }
const failure = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const draftTitle = (draft: Pick<UntitledDraft, 'content'>) => readMarkDocument(draft.content).body.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '').slice(0, 36) || '未命名'
function flatten(entries: FileEntry[]): FileEntry[] { return entries.flatMap((entry) => [entry, ...flatten(entry.children ?? [])]) }

export default function App() {
  const [library, setLibrary] = useState<Library | null>(null)
  const [projectDialog, setProjectDialog] = useState(false)
  const [paperOpened, setPaperOpened] = useState(false)
  const [paperActive, setPaperActive] = useState(false)
  const paperActiveRef = useRef(false); paperActiveRef.current = paperActive
  const [paperState, setPaperState] = useState<PaperWorkspaceState>(emptyPaperState)
  const paperStateRef = useRef(paperState); paperStateRef.current = paperState
  const [paperDocumentRequest, setPaperDocumentRequest] = useState<{ id: string; root: string; path: string; project?: PaperProject }>()
  const [paperStartRequest, setPaperStartRequest] = useState<string>()
  const newFragmentRequested = useRef(false)
  const routedDocument = useRef('')
  const [paperSource, setPaperSource] = useState<CompileCurrentDocument | undefined>()
  const paperWorkspace = useRef<PaperWorkspaceHandle>(null)
  const openPaper = async (restore = true) => {
    if (composingRef.current || busyRef.current || loadingRef.current || paperStateRef.current.busy || initializing) return
    activeEditor()?.flush()
    const source = docRef.current
    setPaperSource(source?.mode === 'markdown' ? { content: source.content, documentKey: source.editorKey!, label: source.untitledId ? draftTitle(source) : basename(source.file.path), ...(!source.untitledId ? { root: source.root, path: source.file.path } : {}) } : undefined)
    if (restore && paperStateRef.current.project) {
      if (!await navigate(async () => { await adoptLibrary(await api.paperActivate(paperStateRef.current.project!.id)); selectPaperPath(paperStateRef.current.activePath) })) return
    } else { await persistDraft(); await persistPosition() }
    setNewMenu(false); setPanel('none'); setPaperOpened(true); setPaperActive(true)
  }
  const openFullDocument = async () => {
    activeEditor()?.flush()
    const before = docRef.current
    if (!before || before.mode !== 'latex-math') { await openPaper(); return }
    if ((before.untitledId || isDocDirty(before)) && !(await save())) return
    const current = docRef.current
    if (!current?.root || current.untitledId || isDocDirty(current)) return
    newFragmentRequested.current = false; setPaperStartRequest(undefined)
    setPaperDocumentRequest({ id: crypto.randomUUID(), root: current.root, path: current.file.path })
    await openPaper(false)
  }
  const newFomula = () => {
    if (composingRef.current || busyRef.current || loadingRef.current || paperStateRef.current.busy || initializing) return
    newFragmentRequested.current = true
    setPaperDocumentRequest(undefined); setPaperStartRequest(crypto.randomUUID()); void run(() => openPaper(false))
  }
  const [compileSource, setCompileSource] = useState<{ current?: CompileCurrentDocument } | null>(null)
  const [projectMenu, setProjectMenu] = useState<{ root: string; x: number; y: number } | null>(null)
  const projectMenuEl = useRef<HTMLDivElement>(null)
  const projectMenuSource = useRef<HTMLElement | null>(null)
  const [missingProject, setMissingProject] = useState<string | null>(null)
  const [startup, setStartup] = useState(false)
  const [initializing, setInitializing] = useState(true)
  const [untitled, setUntitled] = useState<UntitledDraft[]>([])
  const [archives, setArchives] = useState<ArchiveEntry[]>([])
  const [showArchive, setShowArchive] = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ path: string; directory: boolean; x: number; y: number } | null>(null)
  const contextEl = useRef<HTMLDivElement>(null)
  const contextSource = useRef<HTMLElement | null>(null)
  const libraryRootRef = useRef('')
  const [initialSession] = useState(() => readTabSession(localStorage.getItem(sessionKey)))
  const [tabs, renderTabs] = useState<DocumentTab[]>(initialSession.tabs)
  const tabsRef = useRef(tabs)
  const setTabs = (value: DocumentTab[] | ((items: DocumentTab[]) => DocumentTab[])) => { const next = typeof value === 'function' ? value(tabsRef.current) : value; tabsRef.current = next; renderTabs(next) }
  const buffers = useRef(new Map<string, Doc>())
  const tabPositions = useRef(new Map<string, { cursor: number; scroll: number; previewScroll: number }>())
  const tabConflicts = useRef(new Map<string, DiskFile>())
  const [activeTab, setActiveTab] = useState('')
  const [closedTabs, setClosedTabs] = useState<DocumentTab[]>(initialSession.closed)
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const tabMenuEl = useRef<HTMLDivElement>(null)
  const tabMenuSource = useRef<HTMLButtonElement | null>(null)
  const openTabMenu = (element: HTMLElement, id: string, x?: number, y?: number) => {
    const bounds = element.getBoundingClientRect()
    tabMenuSource.current = element.querySelector<HTMLButtonElement>('.tab-select')
    setTabMenu({ id, x: Math.max(8, Math.min(x ?? bounds.left, window.innerWidth - 225)), y: Math.max(8, y ?? bounds.bottom + 4) })
  }
  const [fonts, setFonts] = useState<FontOption[]>([])
  const [formatMenu, setFormatMenu] = useState(false)
  const formatMenuHost = useRef<HTMLDivElement>(null)
  const formatMenuTrigger = useRef<HTMLButtonElement>(null)
  const [newMenu, setNewMenu] = useState(false)
  const newMenuHost = useRef<HTMLDivElement>(null)
  const [markSelection, setMarkSelection] = useState<{ documentKey: string; mark: MarkSelection } | null>(null)
  const [headingSelection, setHeadingSelection] = useState<{ documentKey: string; index: number | null } | null>(null)
  const [markMenu, setMarkMenu] = useState<{ documentKey: string; content: string; id: string; x: number; y: number } | null>(null)
  const markMenuEl = useRef<HTMLDivElement>(null)
  const markMenuSource = useRef<HTMLButtonElement>(null)
  const [searchResult, setSearchResult] = useState({ count: 0, index: 0 })
  const searchInput = useRef<HTMLInputElement>(null)
  const [doc, renderDoc] = useState<Doc | null>(null)
  const docRef = useRef<Doc | null>(null)
  const setDoc = (next: DocInput | null | ((previous: Doc | null) => DocInput | null)) => {
    const input = typeof next === 'function' ? next(docRef.current) : next
    const value: Doc | null = input ? { ...input, ...(input.cleanContent === undefined ? initializeDocumentContent(input.content, input.file.content, input.mode) : { cleanContent: input.cleanContent }) } : null
    if (value) {
      value.root ??= value.untitledId ? '' : libraryRootRef.current
      value.tabId ??= value.untitledId ? 'untitled:' + value.untitledId : 'file:' + crypto.randomUUID()
      value.editorKey ??= value.tabId
      buffers.current.set(value.tabId, value)
      setActiveTab(value.tabId)
      const previous = tabsRef.current.find(tab => tab.id === value.tabId)
      const item: DocumentTab = { id: value.tabId, root: value.root, path: value.file.path, title: value.untitledId ? draftTitle(value) : basename(value.file.path), mode: value.mode, untitledId: value.untitledId, pinned: previous?.pinned ?? false, layout: normalizeDocumentLayout(value.mode, previous?.layout), dirty: isDocDirty(value) }
      if (JSON.stringify(previous) !== JSON.stringify(item)) setTabs(orderTabs(previous ? tabsRef.current.map(tab => tab.id === item.id ? item : tab) : [...tabsRef.current, item]))
    } else setActiveTab('')
    docRef.current = value; renderDoc(value)
  }
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const resolvedTheme = useResolvedTheme(settings.theme)
  const settingsQueue = useRef<Promise<unknown>>(Promise.resolve())
  const settingsRef = useRef(settings); settingsRef.current = settings
  const [git, setGit] = useState<GitStatus | null>(null)
  const gitRequest = useRef(0)
  const checkRequest = useRef(0)
  const [checkingRoot, setCheckingRoot] = useState('')
  const [treeMode, setTreeMode] = useState<'files' | 'folders'>('files')
  const [folder, setFolder] = useState('')
  const [selected, setSelected] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sidebar, setSidebar] = useState(true)
  const [navigationPinned, setNavigationPinned] = useState(() => localStorage.getItem('oopsmd.navigation.pinned') === 'true')
  const { rootRef, transitionLayout } = useWorkspaceMotion()
  const [panel, setPanel] = useState<'none' | 'settings' | 'git' | 'history'>('none')
  const panelRef = useRef<HTMLElement>(null)
  const panelSource = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (panel === 'none') return
    const focused = document.activeElement as HTMLElement | null
    if (focused && focused !== document.body && !panelRef.current?.contains(focused)) panelSource.current = focused
    panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [panel])
  const closePanel = () => {
    setPanel('none')
    const source = panelSource.current
    if (source?.isConnected && !source.closest('[inert]')) source.focus({ preventScroll: true })
  }
  const [status, setStatus] = useState('本地文件 · 离线可用')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [composing, setComposing] = useState(false)
  const composingRef = useRef(false)
  const [count, setCount] = useState(0)
  const [counted, setCounted] = useState<{ baseline: string; content: string; count: number } | null>(null)
  const [preview, setPreview] = useState('')
  const [external, setExternal] = useState<DiskFile | null>(null)
  const [question, setQuestion] = useState<Question | null>(null)
  const questionRef = useRef<Question | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [split, setSplit] = useState(50)
  const [query, setQuery] = useState<string | null>(null)
  const [gitForm, setGitForm] = useState({ remote: '', branch: 'main', name: '', email: '' })
  const [recordPaths, setRecordPaths] = useState<string[]>([])
  const [attachments, setAttachments] = useState<string[]>([])
  const [recordMessage, setRecordMessage] = useState('记录文件与附件变更')
  const blockEditor = useRef<DocumentEditorHandle>(null)
  const activeEditor = () => blockEditor.current
  const openCompiler = () => {
    if (composingRef.current || busyRef.current || loadingRef.current || initializing) return
    activeEditor()?.flush()
    const current = docRef.current
    setNewMenu(false)
    setCompileSource({ current: current?.mode === 'markdown' ? {
      content: current.content, documentKey: current.editorKey!, label: current.untitledId ? draftTitle(current) : basename(current.file.path),
      ...(!current.untitledId ? { root: current.root, path: current.file.path } : {}),
    } : undefined })
  }
  const locateCompilerMark = (diagnostic: Diagnostic, documentKey: string) => {
    const current = docRef.current
    if (!current || current.editorKey !== documentKey || current.content !== compileSource?.current?.content) {
      setNotice('文档已变化，请重新生成后定位。'); return
    }
    const mark = diagnostic.markId ? parseMarks(current.content).find(item => item.id === diagnostic.markId) : undefined
    const from = mark?.from ?? diagnostic.source?.from
    if (from === undefined || from < 0 || from > current.content.length) return
    setCompileSource(null)
    requestAnimationFrame(() => blockEditor.current?.jump?.(from))
  }
  const locatePaperMark = (diagnostic: Diagnostic, source: CompileCurrentDocument) => {
    const current = [...buffers.current.values()].find(item => item.editorKey === source.documentKey)
    if (!current || current.editorKey !== source.documentKey || current.content !== source.content) { setNotice('原文已变化或已切换，请返回原文重新生成后定位。'); return }
    const mark = diagnostic.markId ? parseMarks(current.content).find(item => item.id === diagnostic.markId) : undefined
    const from = mark?.from ?? diagnostic.source?.from
    if (from === undefined || from < 0 || from > current.content.length) return
    void run(async () => {
      if (await navigate(async () => { setPaperActive(false); await activateTab(current.tabId!) })) requestAnimationFrame(() => blockEditor.current?.jump?.(from))
    })
  }
  useEffect(() => {
    setQuery(null)
    setSearchResult({ count: 0, index: 0 })
    blockEditor.current?.search('')
  }, [doc?.editorKey, settings.layout])
  const previewEl = useRef<HTMLElement>(null)
  const documentSurface = useRef<HTMLDivElement>(null)
  const autoAttempt = useRef('')
  const [autoPaused, setAutoPaused] = useState(false)
  const loadingRef = useRef(false)
  const [navigating, setNavigating] = useState(false)
  const editedRef = useRef(false)
  const positionRef = useRef({ cursor: 0, scroll: 0 })
  const previewScrollRef = useRef(0)
  const dirty = isDocDirty(doc)
  const entries = useMemo(() => filterTree(library?.entries ?? [], archives, false), [library?.entries, archives])
  const archivedEntries = useMemo(() => filterTree(library?.entries ?? [], archives, true), [library?.entries, archives])
  const allFiles = useMemo(() => flatten(entries), [entries])
  const { blocks, headings, content: outlineContent, error: outlineError } = useOutline(preview, doc?.editorKey ?? '', doc?.mode === 'markdown')
  useEffect(() => { if (outlineError) setNotice(outlineError) }, [outlineError])
  const documentModule = getDocumentModule(doc?.mode ?? 'markdown')
  const DocumentEditor = documentModule.editor, DocumentPreview = documentModule.preview
  const documentFont = fonts.find(font => font.id === settings.fontFamily)?.family ?? 'system-ui, sans-serif'
  const activeMark = doc?.mode === 'markdown' && markSelection && markSelection.documentKey === doc.editorKey ? markSelection.mark : null
  const currentHeadingId = headingSelection?.documentKey === doc?.editorKey && headingSelection?.index != null ? headings[headingSelection.index]?.id : undefined
  const activeHeadingId = useReadingHeading({ scopeRef: documentSurface, documentKey: doc?.editorKey ?? '', headings, layout: settings.layout, caretHeadingId: currentHeadingId })
  const markMenuIndex = markMenu ? blocks.findIndex(mark => mark.id === markMenu.id) : -1
  const markMenuReady = !!markMenu && !busy && !navigating && markMenu.documentKey === doc?.editorKey && markMenu.content === doc?.content && outlineContent === doc?.content && markMenuIndex >= 0
  const toolbarFont = activeMark?.style.fontFamily ?? settings.fontFamily
  const toolbarSize = activeMark?.style.fontSize ?? settings.fontSize
  const toolbarSizes = [...new Set([...Array.from({ length: 17 }, (_, index) => index + 12), ...(doc?.mode === 'markdown' ? [10, 11, 32, 36, 40, 48, 56, 64, 72, 96] : []), toolbarSize])].sort((a, b) => a - b)
  useEffect(() => {
    if (initializing || !api?.setWindowAppearance) return
    void api.setWindowAppearance({ theme: settings.theme, mode: paperActive ? 'latex-math' : doc?.mode ?? 'markdown' }).catch(error => setNotice(failure(error)))
  }, [settings.theme, doc?.mode, paperActive, initializing])
  const receiveMarkSelection = useCallback((mark: MarkSelection | null, documentKey: string) => {
    if (documentKey !== docRef.current?.editorKey) return
    setMarkSelection(previous => {
      if (!mark) return previous === null ? previous : null
      if (previous?.documentKey === documentKey && JSON.stringify(previous.mark) === JSON.stringify(mark)) return previous
      return { documentKey, mark }
    })
  }, [])
  const receiveHeadingSelection = useCallback((index: number | null, documentKey: string) => {
    if (documentKey !== docRef.current?.editorKey) return
    setHeadingSelection(previous => previous?.documentKey === documentKey && previous.index === index ? previous : { documentKey, index })
  }, [])
  const ask = (title: string, detail: string, buttons: string[], initial?: string): Promise<string | null> => new Promise((resolve) => {
    if (questionRef.current) { resolve(null); return }
    const next = { id: crypto.randomUUID(), title, detail, buttons, initial, resolve }
    questionRef.current = next; setQuestion(next)
  })
  const run = async (operation: () => Promise<unknown>) => {
    try { await operation() } catch (error) { setNotice(failure(error)) }
  }
  async function refreshGit() {
    const root = libraryRootRef.current, request = ++gitRequest.current
    const value = await api.gitStatus()
    if (root !== libraryRootRef.current || request !== gitRequest.current) return value
    setGit(value)
    setGitForm({ remote: value.remote, branch: value.trackingBranch || value.branch || 'main', ...value.identity })
    return value
  }
  async function checkRemote(background = false) {
    const root = libraryRootRef.current
    if (!root || settingsRef.current.projects.find(project => project.root === root)?.syncMode === 'external') return
    const request = ++checkRequest.current, statusRequest = ++gitRequest.current
    setCheckingRoot(root)
    try {
      const value = await api.checkRemote()
      if (root !== libraryRootRef.current || request !== checkRequest.current || statusRequest !== gitRequest.current) return
      setGit(value)
      if (!background) setStatus(remoteSummary(value))
    } catch (error) {
      if (root !== libraryRootRef.current || request !== checkRequest.current || statusRequest !== gitRequest.current) return
      setGit(previous => previous ? { ...previous, remoteState: 'unavailable', remoteError: failure(error) } : previous)
      if (!background) setNotice('远端检查失败，本地文件仍可使用。' + failure(error))
    } finally { if (request === checkRequest.current) setCheckingRoot('') }
  }
  async function refreshTree() {
    const root = libraryRootRef.current
    const [tree, archived] = await Promise.all([api.tree(), api.listArchive()])
    if (root !== libraryRootRef.current) return
    setLibrary((current) => current ? { ...current, entries: tree } : current); setArchives(archived)
  }
  async function persistDraft(current = docRef.current) {
    if (!current) return
    if (current.untitledId) {
      const draft: UntitledDraft = { id: current.untitledId, content: current.content, mode: current.mode, updatedAt: new Date().toISOString() }
      if (isDocDirty(current)) {
        await api.putUntitled(draft)
        setUntitled((items) => [draft, ...items.filter((item) => item.id !== draft.id)])
      } else {
        await api.deleteUntitled(draft.id)
        setUntitled((items) => items.filter((item) => item.id !== draft.id))
      }
      return
    }
    if (isDocDirty(current)) {
      await api.draft({ path: current.file.path, content: current.content, revision: current.file.revision, updatedAt: new Date().toISOString() })
    } else await api.clearDraft(current.file.path)
  }
  async function persistPosition() {
    const current = docRef.current
    if (!current) return
    if (current.tabId) tabPositions.current.set(current.tabId, { ...positionRef.current, previewScroll: previewScrollRef.current })
    if (current.untitledId || !library) return
    const key = `${libraryRootRef.current}/${current.file.path}`
    const next = { ...settingsRef.current, positions: { ...settingsRef.current.positions, [key]: { ...positionRef.current, previewScroll: previewScrollRef.current } } }
    await updateSettings({ positions: next.positions })
  }
  async function updateSettings(patch: Partial<Settings>) {
    if (patch.layout) activeEditor()?.flush()
    if (patch.layout && docRef.current?.tabId) { const id = docRef.current.tabId; setTabs(items => items.map(tab => tab.id === id ? { ...tab, layout: patch.layout } : tab)) }
    const result = settingsQueue.current.catch(() => {}).then(async () => {
      const saved = await api.updateSettings({ ...settingsRef.current, ...patch })
      settingsRef.current = saved; setSettings(saved)
    })
    settingsQueue.current = result
    await result
  }
  async function save(automatic = false, insideNavigation = false): Promise<boolean> {
    activeEditor()?.flush()
    const snapshot = docRef.current
    if (!snapshot || busyRef.current || composingRef.current || loadingRef.current && !insideNavigation) return false
    if (!automatic) setAutoPaused(false)
    if (external) { setNotice('磁盘内容已更新。先在冲突提示中选择要保留的内容。'); return false }
    busyRef.current = true; setBusy(true); setStatus(automatic ? '自动保存并记录版本…' : '保存中…')
    let diskSaved = false
    try {
      if (snapshot.untitledId) {
        if (automatic) return false
        await persistDraft(snapshot)
        const result = await api.saveUntitled({ id: snapshot.untitledId, content: snapshot.content, mode: snapshot.mode, projectRoot: library?.root })
        if (!result) { setStatus('已取消保存 · 草稿已保留'); return false }
        diskSaved = true
        libraryRootRef.current = result.library.root
        setLibrary(result.library); setArchives([]); setStartup(false); setSelected(result.file.path); setFolder(dirname(result.file.path)); setAttachments([])
        setExpanded(() => { const parents = new Set<string>(); let parent = dirname(result.file.path); while (parent) { parents.add(parent); parent = dirname(parent) } return parents })
        setDoc((current) => current && current.untitledId === snapshot.untitledId ? { ...current, root: result.library.root, file: result.file, cleanContent: normalize(result.file.content), untitledId: undefined, baseline: result.version.error ? '' : snapshot.content } : current)
        // Keep later typing in a project draft before removing the independent scratch copy.
        await persistDraft()
        setArchives(await api.listArchive())
        if (!result.warning) {
          await api.deleteUntitled(snapshot.untitledId)
          setUntitled((items) => items.filter((item) => item.id !== snapshot.untitledId))
        }
        const savedSettings = await api.settings(); settingsRef.current = savedSettings; setSettings(savedSettings)
        await refreshGit()
        if (result.warning) setNotice(result.warning)
        if (result.version.error) { setAutoPaused(true); setStatus('已保存，但版本记录失败'); setNotice(result.version.error) }
        else setStatus(result.version.committed ? '已保存到项目 · 已记录本地版本' : '已保存到项目')
        if (isDocDirty(docRef.current)) setStatus('快照已保存 · 后续输入尚未保存')
        return !result.version.error
      }
      const result = await api.save({ path: snapshot.file.path, content: snapshot.content, revision: snapshot.file.revision, attachments })
      diskSaved = true
      setDoc((current) => current?.file.path === snapshot.file.path ? {
        ...current, file: result.file, cleanContent: normalize(result.file.content),
        baseline: result.version.committed ? snapshot.content : current.baseline,
      } : current)
      await persistDraft()
      const currentGit = await refreshGit().catch(() => git)
      if (result.version.error) {
        setAutoPaused(true); setStatus('已保存，但版本记录失败'); setNotice(result.version.error + '\n自动记录已暂停；处理原因后，手动保存可重试。')
      } else if (!currentGit?.repository) {
        setDoc((current) => current ? { ...current, baseline: snapshot.content } : null)
        setStatus('已保存 · 未启用版本记录')
        if (currentGit?.blocked) setNotice(currentGit.blocked)
      } else {
        setStatus(result.version.committed ? '已保存 · 已记录本地版本' : '已保存 · 无新版本')
        setAttachments([])
      }
      if (isDocDirty(docRef.current)) setStatus('快照已保存 · 后续输入尚未保存')
      return !result.version.error
    } catch (error) { setAutoPaused(true); setStatus(diskSaved ? '正文已保存 · 后续处理未完成' : '保存失败 · 内容仍保留'); setNotice((diskSaved ? '正文已写入文件，当前编辑仍保留。恢复记录或项目状态更新失败：\n' : '') + failure(error)); return false }
    finally { busyRef.current = false; setBusy(false); void run(checkExternal) }
  }
  async function guardSwitch(insideNavigation = false) {
    if (busyRef.current || (loadingRef.current && !insideNavigation)) { setNotice('请等待当前操作结束'); return false }
    const current = docRef.current
    if (current && isDocDirty(current)) {
      const saveLabel = current.untitledId ? '保存到项目' : '保存并记录'
      const choice = await ask('当前文档尚未保存', current.untitledId ? '选择保存文件夹，或把这份文档保留在本机草稿中。' : '可以先保存并记录版本，或将修改保留在本机恢复草稿中。', [saveLabel, '保留草稿', '取消'])
      if (choice === saveLabel && !(await save(false, insideNavigation))) return false
      if (choice === '取消' || choice === null) return false
      if (choice === '保留草稿') await persistDraft(current)
    }
    await persistPosition()
    return true
  }
  async function navigate(operation: () => Promise<unknown>, paperContinuation = false) {
    if (loadingRef.current || busyRef.current || paperStateRef.current.busy && !paperContinuation) { setNotice('正在保存或切换文档，请等待当前操作完成。'); return false }
    if (composingRef.current) { setNotice('请先确认输入法中的文字。'); return false }
    activeEditor()?.flush()
    loadingRef.current = true; setNavigating(true)
    try { await paperWorkspace.current?.flushDrafts(); await persistDraft(); await persistPosition(); await operation(); return true }
    finally { loadingRef.current = false; setNavigating(false) }
  }
  async function activateTab(id: string) {
    const tab = tabsRef.current.find(item => item.id === id)
    if (!tab) return
    if (docRef.current?.tabId === id && (!tab.root || sameRoot(tab.root, libraryRootRef.current))) return
    if (tab.root && libraryRootRef.current !== tab.root) await adoptLibrary(await openRegisteredProject(tab.root))
    const cached = buffers.current.get(id)
    if (cached) {
      positionRef.current = tabPositions.current.get(id) ?? { cursor: 0, scroll: 0 }
      previewScrollRef.current = tabPositions.current.get(id)?.previewScroll ?? 0
      setDoc(cached); setPreview(docRef.current?.content ?? ''); setExternal(tabConflicts.current.get(id) ?? null); setSelected(cached.untitledId ? '' : cached.file.path); setFolder(dirname(cached.file.path)); setAttachments([]); setPanel('none'); editedRef.current = false
      if (!cached.untitledId) {
        const opened = await api.read(cached.file.path)
        if (opened.file.revision !== cached.file.revision) {
          if (isDocDirty(cached)) setExternal(opened.file)
          else setDoc({ ...cached, file: opened.file, content: normalize(opened.file.content), cleanContent: undefined, baseline: baselineText(opened.baseline, opened.file.content) })
        }
      }
      await updateSettings({ layout: normalizeDocumentLayout(cached.mode, tab.layout) })
      setPreview(docRef.current?.content ?? '')
      setStatus(isDocDirty(docRef.current) ? '未保存 · 草稿已保护' : '已打开')
    } else if (tab.untitledId) {
      const draft = (await api.listUntitled()).find(item => item.id === tab.untitledId)
      startUntitled(draft ?? { id: tab.untitledId, content: '', mode: tab.mode, updatedAt: new Date().toISOString() })
    } else await readIntoEditor(tab.path, undefined, id)
  }
  async function switchTab(id: string) { await navigate(async () => { setPaperActive(false); await activateTab(id) }) }
  async function closeTab(id: string) {
    activeEditor()?.flush()
    if (busyRef.current || loadingRef.current) return
    const tab = tabsRef.current.find(item => item.id === id)
    if (!tab) return
    if (tab.dirty && docRef.current?.tabId !== id) { await switchTab(id); if (docRef.current?.tabId !== id) return }
    await navigate(async () => {
      if (docRef.current?.tabId === id) {
        if (!(await guardSwitch(true))) return
        await persistDraft()
      }
      const at = tabsRef.current.findIndex(item => item.id === id)
      const latest = tabsRef.current.find(item => item.id === id) ?? tab
      setClosedTabs(previous => [latest, ...previous.filter(item => item.id !== id)].slice(0, 20))
      const remaining = tabsRef.current.filter(item => item.id !== id)
      setTabs(remaining); setTabMenu(null)
      if (docRef.current?.tabId === id) {
        setDoc(null); setExternal(null)
        if (remaining.length) await activateTab(remaining[Math.min(at, remaining.length - 1)].id)
        else startUntitled()
      }
    })
  }
  async function reopenTab() {
    const tab = closedTabs[0]
    if (!tab) return
    setClosedTabs(items => items.slice(1))
    const existing = tabsRef.current.find(item => item.id === tab.id || (!item.untitledId && !tab.untitledId && fileTabId(item.root, item.path) === fileTabId(tab.root, tab.path)))
    if (!existing) setTabs(orderTabs([...tabsRef.current, tab]))
    await switchTab(existing?.id ?? tab.id)
  }
  async function closeOtherTabs(id: string, rightOnly: boolean) {
    const index = tabsRef.current.findIndex(tab => tab.id === id)
    const targets = tabsRef.current.filter((tab, at) => tab.id !== id && !tab.pinned && (!rightOnly || at > index))
    for (const tab of targets) { await closeTab(tab.id); if (tabsRef.current.some(item => item.id === tab.id)) break }
    await switchTab(id)
  }
  function search(queryValue: string, direction: 1 | -1 = 1) { setSearchResult(activeEditor()?.search(queryValue, direction) ?? { count: 0, index: 0 }) }
  function openSearch() { setQuery(previous => previous ?? ''); requestAnimationFrame(() => searchInput.current?.focus()) }
  function applyTypography(patch: MarkStylePatch | null) {
    if (docRef.current?.mode === 'markdown') {
      try { activeEditor()?.applyMarkStyle?.(patch) } catch (error) { setNotice(failure(error)) }
    } else if (patch) {
      const next: Partial<Settings> = {}
      if (patch.fontFamily != null) next.fontFamily = patch.fontFamily
      if (patch.fontSize != null) next.fontSize = patch.fontSize
      void run(() => updateSettings(next))
    }
  }
  function openMarkMenu(button: HTMLButtonElement, id: string, x?: number, y?: number) {
    const current = docRef.current
    if (!current || busyRef.current || loadingRef.current || outlineContent !== current.content) return
    const bounds = button.getBoundingClientRect()
    markMenuSource.current = button
    setMarkMenu({ documentKey: current.editorKey!, content: current.content, id, x: Math.min(x ?? bounds.left + 24, window.innerWidth - 220), y: Math.min(y ?? bounds.bottom, window.innerHeight - 130) })
  }
  function runMarkCommand(type: 'move' | 'copy', index: number) {
    const target = markMenu
    setMarkMenu(null)
    activeEditor()?.flush()
    if (!target || busyRef.current || loadingRef.current || target.documentKey !== docRef.current?.editorKey || target.content !== docRef.current?.content) return
    activeEditor()?.markCommand?.({ type, id: target.id, index })
  }
  async function loadDocument(relative: string, anchor?: string) {
    if (isPaperTextPath(relative)) {
      const cached = [...buffers.current.values()].find(item => !item.untitledId && sameRoot(item.root, libraryRootRef.current) && item.file.path === relative)
      if (cached && isDocDirty(cached)) { await switchTab(cached.tabId!); return }
      await navigate(async () => {
        const current = paperStateRef.current.project
        if (current && sameRoot(current.rootLabel, libraryRootRef.current)) {
          await paperWorkspace.current?.openFile(relative); setDoc(null); setPaperActive(true); selectPaperPath(relative); return
        }
        const project = await api.paperOpenDocument(libraryRootRef.current, relative)
        if (/\.tex$/i.test(relative) && !project.mainCandidates.length && !project.origin) {
          await api.paperRelease(project.id); setPaperActive(false); await readIntoEditor(relative, anchor, undefined, true); return
        }
        setDoc(null); setPaperStartRequest(undefined); setPaperOpened(true); setPaperActive(true)
        setPaperDocumentRequest({ id: crypto.randomUUID(), root: libraryRootRef.current, path: relative, project })
      })
      return
    }
    if (!isText(relative)) { await api.openAttachment(relative); return }
    if (!paperActive && !docRef.current?.untitledId && docRef.current?.file.path === relative) { if (anchor) jumpToAnchor(anchor); return }
    const existing = tabsRef.current.find(tab => !tab.untitledId && fileTabId(tab.root, tab.path) === fileTabId(libraryRootRef.current, relative))
    await navigate(async () => { setPaperActive(false); if (existing) { await activateTab(existing.id); if (anchor) jumpToAnchor(anchor) } else await readIntoEditor(relative, anchor) })
  }
  async function readIntoEditor(relative: string, anchor?: string, tabId?: string, fragment = false) {
      if (!fragment && isPaperTextPath(relative)) {
        const project = await api.paperOpenDocument(libraryRootRef.current, relative)
        if (project.mainCandidates.length || project.origin || !/\.tex$/i.test(relative)) {
          setDoc(null); setPaperOpened(true); setPaperActive(true); setPaperStartRequest(undefined)
          setPaperDocumentRequest({ id: crypto.randomUUID(), root: libraryRootRef.current, path: relative, project }); return
        }
        await api.paperRelease(project.id)
      }
      if (!tabId) {
        const existing = tabsRef.current.find(tab => !tab.untitledId && fileTabId(tab.root, tab.path) === fileTabId(libraryRootRef.current, relative))
        if (existing) { await activateTab(existing.id); if (anchor) jumpToAnchor(anchor); return }
      }
      const opened = await api.read(relative)
      let content = normalize(opened.file.content)
      let conflict: DiskFile | null = null
      if (opened.draft && normalize(opened.draft.content) !== content) {
        const choice = await ask('发现恢复草稿', `${relative}\n草稿时间：${new Date(opened.draft.updatedAt).toLocaleString()}${opened.draft.revision !== opened.file.revision ? '\n磁盘也有更新，恢复后可查看和导出两端内容。' : ''}`, ['恢复草稿', '使用磁盘内容', '取消'])
        if (!choice || choice === '取消') return
        if (choice === '恢复草稿') { content = normalize(opened.draft.content); if (opened.draft.revision !== opened.file.revision) conflict = opened.file }
        else await api.clearDraft(relative)
      }
      const savedSettings = await api.settings(); settingsRef.current = savedSettings; setSettings(savedSettings)
      positionRef.current = savedSettings.positions[`${libraryRootRef.current}/${relative}`] ?? { cursor: 0, scroll: 0 }
      previewScrollRef.current = savedSettings.positions[`${libraryRootRef.current}/${relative}`]?.previewScroll ?? 0
      const mode = modeForPath(relative) ?? 'markdown'
      setDoc({ tabId, root: libraryRootRef.current, file: opened.file, content, baseline: baselineText(opened.baseline, opened.file.content), mode })
      const layout = tabsRef.current.find(tab => tab.id === tabId)?.layout
      await updateSettings({ layout: normalizeDocumentLayout(mode, layout) })
      editedRef.current = false
      setAutoPaused(false)
      setPreview(docRef.current?.content ?? ''); setExternal(conflict); setSelected(relative); setFolder(dirname(relative)); setAttachments([])
      setExpanded((old) => { const next = new Set(old); let parent = dirname(relative); while (parent) { next.add(parent); parent = dirname(parent) } return next })
      const currentGit = await refreshGit()
      setStatus(isDocDirty(docRef.current) ? '未保存 · 已恢复草稿' : '已打开 · ' + (currentGit.repository ? '本地版本已就绪' : '未启用版本记录'))
      autoAttempt.current = ''
      if (anchor) setTimeout(() => jumpToAnchor(anchor), 250)
      else setTimeout(() => { if (previewEl.current && docRef.current?.file.path === relative) previewEl.current.scrollTop = previewScrollRef.current }, 250)
  }
  async function adoptLibrary(next: Library, relative?: string) {
    ++gitRequest.current; ++checkRequest.current; setCheckingRoot(''); setGit(null)
    libraryRootRef.current = next.root
    setMissingProject(null)
    setStartup(false); setPaperActive(false)
    setDoc(null); setExternal(null); setLibrary(next); setArchives(await api.listArchive()); setShowArchive(false); setContextMenu(null); setExpanded(new Set()); setFolder(''); setSelected(''); setAttachments([]); setPanel('none')
    const savedSettings = await api.settings(); settingsRef.current = savedSettings; setSettings(savedSettings)
    if (relative) await readIntoEditor(relative)
    else await refreshGit()
    if (libraryRootRef.current === next.root && settingsRef.current.projects.find(project => project.root === next.root)?.syncMode !== 'external') {
      void api.gitStatus().then(value => { if (libraryRootRef.current === next.root && value.repository && value.remote) void checkRemote(true) }).catch(() => {})
    }
  }
  function selectPaperPath(path: string) {
    setSelected(path); setFolder(dirname(path))
    setExpanded(previous => { const next = new Set(previous); let parent = dirname(path); while (parent) { next.add(parent); parent = dirname(parent) }; return next })
  }
  function clearPaperState() { paperStateRef.current = emptyPaperState; setPaperState(emptyPaperState) }
  async function activatePaperProject(project: PaperProject) {
    if (!await navigate(async () => { await adoptLibrary(await api.paperActivate(project.id)) }, true)) throw new Error('项目正在切换，请稍后重新打开。')
    setPaperActive(true)
  }
  const receivePaperState = useLatestEvent((next: PaperWorkspaceState) => {
    paperStateRef.current = next; setPaperState(next)
    if (next.project && next.activePath) {
      const transferred = tabsRef.current.filter(tab => !tab.untitledId && sameRoot(tab.root, next.project!.rootLabel) && tab.path === next.activePath && tab.mode === 'latex-math' && !isDocDirty(buffers.current.get(tab.id) ?? null))
      if (transferred.length) { const ids = new Set(transferred.map(tab => tab.id)); setTabs(tabsRef.current.filter(tab => !ids.has(tab.id))); for (const id of ids) { buffers.current.delete(id); tabConflicts.current.delete(id) } }
    }
    if (paperActiveRef.current && sameRoot(next.project?.rootLabel, libraryRootRef.current)) selectPaperPath(next.activePath)
  })
  async function newPaperFile() {
    const value = await ask('新建源文件', '文件存入当前项目，可使用子文件夹路径。', ['创建', '取消'], (folder ? folder + '/' : '') + 'new.tex')
    if (!value) return
    await paperWorkspace.current?.createFile(value); await refreshTree()
  }
  function startUntitled(draft?: UntitledDraft, requestedMode: ContentMode = 'markdown') {
    const id = draft?.id ?? crypto.randomUUID()
    const mode = draft?.mode ?? requestedMode
    const content = draft?.content ?? ''
    setDoc({ file: { path: '未命名' + getDocumentModule(mode).defaultExtension, content: '', revision: '', eol: '\n', bom: false }, content, baseline: '', mode, untitledId: id, editorKey: `untitled:${id}` })
    setStartup(false); setExternal(null); setSelected(''); setAttachments([]); setPanel('none'); setPreview(docRef.current?.content ?? '')
    setAutoPaused(false); autoAttempt.current = ''; editedRef.current = false
    positionRef.current = { cursor: 0, scroll: 0 }; previewScrollRef.current = 0
    setStatus(draft ? '已恢复草稿' : '未保存到项目 · 首次保存时选择项目')
    const savedLayout = tabsRef.current.find(tab => tab.untitledId === id)?.layout
    const layout = normalizeDocumentLayout(mode, savedLayout)
    if (settingsRef.current.layout !== layout) void run(() => updateSettings({ layout }))
    requestAnimationFrame(() => activeEditor()?.focus())
  }
  async function newDocument(mode: ContentMode = 'markdown') { await navigate(async () => { setPaperActive(false); setNewMenu(false); startUntitled(undefined, mode) }) }
  async function openDraft(draft: UntitledDraft) {
    if (docRef.current?.untitledId === draft.id) return
    await navigate(async () => startUntitled((await api.listUntitled()).find((item) => item.id === draft.id) ?? draft))
  }
  async function openProject(root: string) {
    let recentPath: string | undefined
    await navigate(async () => {
      const next = await openRegisteredProject(root)
      await adoptLibrary(next)
      if (sameRoot(paperStateRef.current.project?.rootLabel, root)) {
        setPaperActive(true); selectPaperPath(paperStateRef.current.activePath); return
      }
      setPaperActive(false)
      const existing = tabsRef.current.find(tab => sameRoot(tab.root, root))
      if (existing) { await activateTab(existing.id); return }
      recentPath = settingsRef.current.recent.find(item => sameRoot(item.root, root) && flatten(next.entries).some(file => file.path === item.path && !file.directory))?.path
      setStatus('项目已打开')
    })
    if (recentPath) await loadDocument(recentPath)
  }
  async function openRegisteredProject(root: string) {
    try { return await api.openProject(root) }
    catch (error) { setMissingProject(root); throw new Error('项目无法打开，草稿仍保留。可重新定位此文件夹。\n' + failure(error)) }
  }
  function openProjectMenu(element: HTMLElement, root: string, x?: number, y?: number) {
    if (busyRef.current || loadingRef.current) return
    const bounds = element.getBoundingClientRect(); projectMenuSource.current = element.matches('button') ? element : element.querySelector<HTMLElement>('button') ?? element
    setProjectMenu({ root, x: Math.max(8, Math.min(x ?? bounds.right, window.innerWidth - 280)), y: Math.max(8, Math.min(y ?? bounds.bottom, window.innerHeight - 245)) })
  }
  async function addProject(kind: 'local' | 'create' | 'clone', name = '', remote = '') {
    let opened = false
    await navigate(async () => {
      const next = kind === 'local' ? await api.chooseLibrary() : kind === 'create' ? await api.createProject(name) : await api.cloneProject(remote, name)
      if (next) { await adoptLibrary(next); setPaperActive(false); setStatus(kind === 'create' ? '项目已创建' : kind === 'clone' ? '已获取项目副本' : '项目已打开'); opened = true }
    })
    return opened
  }
  async function relocateProject(root: string) {
    setProjectMenu(null)
    let changed = false
    await navigate(async () => {
      const result = await api.relocateProject(root)
      if (!result) return
      if (sameRoot(paperStateRef.current.project?.rootLabel, root)) { setPaperActive(false); setPaperOpened(false); clearPaperState(); setPaperDocumentRequest(undefined); setPaperStartRequest(undefined) }
      const previousActive = docRef.current?.root === root ? docRef.current.tabId : undefined
      for (const [id, buffer] of buffers.current) if (buffer.root === result.previousRoot) buffers.current.set(id, { ...buffer, root: result.library.root })
      setTabs(items => items.map(tab => tab.root === result.previousRoot ? { ...tab, root: result.library.root } : tab))
      setClosedTabs(items => items.map(tab => tab.root === result.previousRoot ? { ...tab, root: result.library.root } : tab))
      await adoptLibrary(result.library)
      const target = previousActive ?? tabsRef.current.find(tab => tab.root === result.library.root)?.id
      if (target) await activateTab(target)
      setMissingProject(null); setNotice('项目位置已更新，原有草稿与标签已保留。'); changed = true
    })
    return changed
  }
  async function forgetProject(root: string) {
    setProjectMenu(null)
    await navigate(async () => {
      const dirtyPaths = dirtyProjectPaths(root, tabsRef.current, buffers.current, docRef.current)
      const unloaded = tabsRef.current.filter(tab => tab.root === root && tab.dirty && !buffers.current.has(tab.id))
      if (unloaded.length) throw new Error('此项目还有未恢复的草稿标签。请先打开或重新定位项目并恢复这些标签，再移除登记：\n' + unloaded.map(tab => tab.path).join('\n'))
      const answer = await ask('移除项目登记', `${root}\n只从项目列表移除，不删除文件。${dirtyPaths.length ? `\n${dirtyPaths.length} 份未保存内容将保留为独立草稿。相对图片和链接需另存后使用，原附件仍留在原目录。` : ''}`, ['移除登记', '取消'])
      if (answer !== '移除登记') return
      const savedDrafts: UntitledDraft[] = []
      for (const buffer of buffers.current.values()) if (buffer.root === root && !buffer.untitledId && isDocDirty(buffer)) {
        const draft = { id: crypto.randomUUID(), content: buffer.content, mode: buffer.mode, updatedAt: new Date().toISOString() }
        await api.putUntitled(draft); savedDrafts.push(draft)
      }
      const saved = await api.forgetProject(root)
      if (sameRoot(paperStateRef.current.project?.rootLabel, root)) { setPaperActive(false); setPaperOpened(false); clearPaperState(); setPaperDocumentRequest(undefined); setPaperStartRequest(undefined) }
      settingsRef.current = saved; setSettings(saved)
      setUntitled(items => [...savedDrafts, ...items])
      for (const [id, buffer] of buffers.current) if (buffer.root === root) { buffers.current.delete(id); tabPositions.current.delete(id); tabConflicts.current.delete(id) }
      setTabs(items => orderTabs([...items.filter(tab => tab.root !== root), ...savedDrafts.map(draft => ({ id: 'untitled:' + draft.id, root: '', path: '未命名' + getDocumentModule(draft.mode).defaultExtension, title: draftTitle(draft), mode: draft.mode, untitledId: draft.id, pinned: false, dirty: true }))]))
      setClosedTabs(items => items.filter(tab => tab.root !== root))
      if (libraryRootRef.current === root) {
        libraryRootRef.current = ''; ++gitRequest.current; ++checkRequest.current; setCheckingRoot(''); setLibrary(null); setGit(null); setArchives([]); setPanel('none')
        if (docRef.current?.root === root) { setDoc(null); setExternal(null); startUntitled(savedDrafts[0]) }
      }
      if (missingProject === root) setMissingProject(null)
      setStatus('项目登记已移除 · 本地文件保留')
    })
  }
  async function setSyncMode(root: string, mode: 'local' | 'git' | 'external') {
    setProjectMenu(null)
    await navigate(async () => {
      const saved = await api.setProjectSyncMode(root, mode)
      settingsRef.current = saved; setSettings(saved)
      if (mode === 'external') { ++checkRequest.current; ++gitRequest.current; setCheckingRoot('') }
      setStatus(mode === 'external' ? '由外部云盘客户端同步 · 应用内 Git 网络操作已停用' : '已启用应用内 Git 管理')
    })
  }
  async function choose(kind: 'library' | 'file') {
    let relative: string | undefined
    await navigate(async () => {
      if (kind === 'library') { const next = await api.chooseLibrary(); if (next) { await adoptLibrary(next); setPaperActive(false) } }
      else { const next = await api.chooseFile(); if (next) { await adoptLibrary(next.library); relative = next.path } }
    })
    if (relative) await loadDocument(relative)
  }
  function jumpToAnchor(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
  }
  async function newEntry(directory: boolean) {
    if (!directory) { await newDocument(); return }
    if (!library) { await choose('library'); return }
    const value = await ask(directory ? '新建文件夹' : '新建文档', '输入相对于文档库的路径。文件名可包含中文和空格。', ['创建', '取消'], `${folder ? folder + '/' : ''}${directory ? '新文件夹' : '未命名.md'}`)
    if (value === null) return
    if (sameRoot(paperStateRef.current.project?.rootLabel, libraryRootRef.current)) paperWorkspace.current?.assertMutable(value)
    setLibrary({ ...library, entries: await api.create(value, directory) })
    if (!directory) await loadDocument(value)
  }
  async function mutate(kind: 'move' | 'remove', target: string, destination?: string) {
    if (!target) return
    setContextMenu(null)
    await navigate(async () => {
      const paper = paperStateRef.current
      const paperOwnsRoot = sameRoot(paper.project?.rootLabel, libraryRootRef.current)
      if (paperOwnsRoot) { paperWorkspace.current?.assertMutable(target); if (paper.building) throw new Error('请先结束编译，再移动或删除文件。'); if (kind === 'remove' && paper.dirtyPaths.some(path => affectsPath(path, target))) throw new Error('请先保存此路径下未保存的 LaTeX 源文件，再移到回收站。') }
      const original = docRef.current
      const affectsCurrent = original && !original.untitledId && (original.file.path === target || original.file.path.startsWith(target + '/'))
      if (kind === 'move') {
        const value = destination ?? await ask('重命名', '输入新的相对路径。拖动文件或文件夹也可以移动位置。', ['确定', '取消'], target)
        if (!value || value === target) return
        const entry = allFiles.find(item => item.path === target)
        if (!entry?.directory && isPaperTextPath(target) && !isPaperTextPath(value)) throw new Error('LaTeX 源文件重命名需保留可编辑的源文件扩展名。')
        if (!entry?.directory && modeForPath(target) && modeForPath(target) !== modeForPath(value)) {
          throw new Error('重命名不能转换文档类型。请保留当前类型的扩展名；Markdown 与 Fomula 请分别新建文档。')
        }
        const result = await api.move(target, value)
        if (paperOwnsRoot) await paperWorkspace.current?.remapPath(target, result.path)
        if (affectsCurrent) {
          const movedPath = result.path + original.file.path.slice(target.length)
          const moved = await api.read(movedPath)
          const changedOnDisk = moved.file.revision !== original.file.revision
          const keepEditing = changedOnDisk && isDocDirty(original)
          setDoc({ ...original, editorKey: original.editorKey ?? libraryRootRef.current + '/' + original.file.path,
            file: keepEditing ? { ...original.file, path: movedPath } : moved.file,
            ...(changedOnDisk && !keepEditing ? { content: normalize(moved.file.content), cleanContent: undefined } : {}) })
          setPreview(docRef.current?.content ?? '')
          setExternal(keepEditing ? moved.file : null)
          await persistDraft()
        }
        const affected = (root: string | undefined, path: string) => root === libraryRootRef.current && (path === target || path.startsWith(target + '/'))
        for (const [id, cached] of buffers.current) {
          if (!cached.untitledId && affected(cached.root, cached.file.path)) {
            const path = result.path + cached.file.path.slice(target.length)
            buffers.current.set(id, { ...cached, file: { ...cached.file, path } })
            const conflict = tabConflicts.current.get(id)
            if (conflict) tabConflicts.current.set(id, { ...conflict, path })
          }
        }
        setClosedTabs(items => items.map(tab => !tab.untitledId && affected(tab.root, tab.path) ? { ...tab, path: result.path + tab.path.slice(target.length), title: basename(result.path + tab.path.slice(target.length)) } : tab))
        const changed = tabsRef.current.map(tab => {
          if (tab.untitledId || tab.root !== libraryRootRef.current || !(tab.path === target || tab.path.startsWith(target + '/'))) return tab
          const path = result.path + tab.path.slice(target.length), cached = buffers.current.get(tab.id)
          if (cached) buffers.current.set(tab.id, { ...cached, file: { ...cached.file, path } })
          return { ...tab, path, title: basename(path) }
        })
        setTabs(changed)
        setSelected(result.path); setFolder(dirname(result.path))
        setExpanded(previous => { const next = new Set(previous); let parent = dirname(result.path); while (parent) { next.add(parent); parent = dirname(parent) } return next })
        setStatus('已移动 · 可在 Git 面板记录变更')
        if (result.warning || result.affectedLinks.length) setNotice([result.warning, result.affectedLinks.length ? '可能受影响的链接：' + result.affectedLinks.join('、') : ''].filter(Boolean).join('\n'))
      } else {
        const confirmed = await ask('移到回收站', target + '\n删除后可从系统回收站找回。保留备用资料请使用“归档”。', ['移到回收站', '取消'])
        if (confirmed !== '移到回收站') return
        if (affectsCurrent && isDocDirty(original) && !(await api.exportCopy(original.content))) return
        if (affectsCurrent && isDocDirty(original)) await api.clearDraft(original.file.path)
        let result
        try { result = await api.remove(target); if (paperOwnsRoot) await paperWorkspace.current?.remapPath(target) } catch (error) { await persistDraft(); throw error }
        const removed = tabsRef.current.filter(tab => !tab.untitledId && tab.root === libraryRootRef.current && (tab.path === target || tab.path.startsWith(target + '/')))
        setTabs(tabsRef.current.filter(tab => !removed.includes(tab)))
        const affected = (root: string | undefined, path: string) => root === libraryRootRef.current && (path === target || path.startsWith(target + '/'))
        setClosedTabs(items => items.filter(tab => tab.untitledId || !affected(tab.root, tab.path)))
        for (const [id, cached] of buffers.current) if (!cached.untitledId && affected(cached.root, cached.file.path)) { buffers.current.delete(id); tabConflicts.current.delete(id); tabPositions.current.delete(id) }
        if (affectsCurrent) { setDoc(null); setExternal(null) }
        setSelected(''); setStatus('已移到回收站')
        if (result.warning || result.affectedLinks.length) setNotice([result.warning, result.affectedLinks.length ? '可能受影响的链接：' + result.affectedLinks.join('、') : ''].filter(Boolean).join('\n'))
      }
      await refreshTree(); await refreshGit()
    })
  }
  async function setArchived(target: string, restore: boolean) {
    setContextMenu(null)
    if (busyRef.current || loadingRef.current) return
    busyRef.current = true; setBusy(true)
    try {
      await paperWorkspace.current?.flushDrafts(); await persistDraft()
      const owner = archiveOwner(archives, target)
      setArchives(restore ? await api.unarchive(owner?.path ?? target) : await api.archive(target))
      setStatus(restore ? '已恢复到工作树' : '已归档 · 文件保留原位置')
    } finally { busyRef.current = false; setBusy(false) }
  }
  function dragOver(event: DragEvent, destination: string) {
    if (!event.dataTransfer.types.includes('application/x-oopsmd-path') || busy || navigating) return
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDropTarget(destination)
  }
  function dropInto(event: DragEvent, destination: string) {
    const raw = event.dataTransfer.getData('application/x-oopsmd-path')
    if (!raw) return
    event.preventDefault(); event.stopPropagation(); setDropTarget(null)
    if (busy || navigating) return
    try {
      const item = JSON.parse(raw)
      if (item.root !== libraryRootRef.current || typeof item.path !== 'string') return
      const target = moveDestination(item.path, destination)
      if (target) void run(() => mutate('move', item.path, target))
    } catch { setNotice('无法读取拖动的文件路径。') }
  }
  async function checkExternal() {
    if (loadingRef.current || busyRef.current || !library) return
    await refreshTree()
    if (sameRoot(paperStateRef.current.project?.rootLabel, libraryRootRef.current) && !paperStateRef.current.busy && !paperStateRef.current.building) await paperWorkspace.current?.refresh()
    const current = docRef.current
    if (!current || current.untitledId) return
    try {
      const opened = await api.read(current.file.path)
      if (docRef.current !== current || opened.file.revision === current.file.revision) return
      if (isDocDirty(current)) { setExternal(opened.file); setNotice('磁盘文件与当前编辑均有变化，两端内容已保留。') }
      else {
        setDoc({ ...current, file: opened.file, content: normalize(opened.file.content), cleanContent: undefined, baseline: baselineText(opened.baseline, opened.file.content) })
        setPreview(docRef.current?.content ?? '')
        setStatus('已刷新外部修改')
      }
    } catch (error) { setNotice('当前文件可能已被移动或删除。可导出编辑内容。' + failure(error)) }
  }
  async function networkAction(kind: 'update' | 'push' | 'publish') {
    const root = libraryRootRef.current
    if (!root) return
    if (settingsRef.current.projects.find(project => project.root === root)?.syncMode === 'external') throw new Error('此项目由外部云盘客户端同步，应用内 Git 网络操作已停用。')
    await gitAction(async () => {
      if (kind === 'publish' && await ask('发布远端分支', `将在配置的远端创建分支 ${git?.trackingBranch || git?.branch || ''}，上传已记录的本地版本。不会上传未保存的编辑。`, ['发布分支', '取消']) !== '发布分支') return
      setStatus(kind === 'update' ? '正在更新本地文件…' : kind === 'push' ? '正在上传已记录的版本…' : '正在发布分支…')
      const result = await (kind === 'update' ? api.updateFromRemote() : kind === 'push' ? api.pushChanges() : api.publishBranch())
      if (libraryRootRef.current !== root) return
      setGit(result); setStatus(result.conflicts.length ? '更新有冲突 · 请在 Git 面板处理' : kind === 'update' ? '本地更新完成' : '已上传本地版本')
    }, kind === 'update')
  }
  async function showGit() {
    if (!libraryRootRef.current) return
    const root = libraryRootRef.current
    setPanel('git')
    await refreshGit()
    if (root !== libraryRootRef.current) return
  }
  async function showHistory() {
    const path = paperActive ? paperStateRef.current.activePath : docRef.current?.untitledId ? undefined : docRef.current?.file.path
    if (!path) return
    setHistory(await api.history(path)); setPanel('history')
  }
  async function restoreVersion(entry: HistoryEntry) {
    await navigate(async () => {
    const current = docRef.current
    const paperPath = paperActive ? paperStateRef.current.activePath : undefined
    if (!current && !paperPath) return
    const confirmed = await ask('恢复版本到编辑器', `${entry.subject}\n${entry.date}\n当前编辑将先导出备份，再载入该版本；手动保存可记录为新版本。`, ['恢复', '取消'])
    if (confirmed !== '恢复') return
    if (paperPath) {
      const content = paperWorkspace.current?.getActiveContent()
      if (paperStateRef.current.dirtyPaths.includes(paperPath) && content !== undefined && !(await api.exportCopy(content))) return
      await paperWorkspace.current?.replaceContent(normalize(await api.version(paperPath, entry.oid))); await paperWorkspace.current?.flushDrafts(); setPanel('none'); return
    }
    if (!current) return
    if (isDocDirty(current) && !(await api.exportCopy(current.content))) return
    const raw = normalize((await api.version(current.file.path, entry.oid)).replace(/^\uFEFF/, ''))
    const content = getDocumentModule(current.mode).initialize(raw, raw).content
    setDoc({ ...current, content }); setPreview(docRef.current?.content ?? ''); editedRef.current = false; await persistDraft(); setPanel('none'); setStatus('已载入历史版本 · 尚未保存')
    })
  }
  async function gitAction(operation: () => Promise<unknown>, refreshDisk = false) {
    await navigate(async () => {
      const root = libraryRootRef.current
      if (!root) return
      const dirtyPaths = dirtyProjectPaths(root, tabsRef.current, buffers.current, docRef.current)
      const paper = paperStateRef.current
      if (refreshDisk && sameRoot(paper.project?.rootLabel, root) && paper.dirtyPaths.length) throw new Error('更新前请先保存全部 LaTeX 源文件：\n' + paper.dirtyPaths.join('\n'))
      if (refreshDisk && dirtyPaths.length) throw new Error('更新本地文件前，请先保存此项目所有未保存的标签（含未激活标签）：\n' + dirtyPaths.join('\n'))
      if (refreshDisk && [...tabConflicts.current].some(([id]) => buffers.current.get(id)?.root === root)) throw new Error('此项目仍有磁盘冲突，请先处理保留内容，再更新本地文件。')
      let operationError: unknown
      try { await operation() } catch (error) { operationError = error }
      if (root === libraryRootRef.current) {
        // Invalidate even after a failed merge, before status reads that can themselves fail.
        if (refreshDisk) for (const [id, buffer] of buffers.current) if (buffer.root === root && !isDocDirty(buffer) && id !== docRef.current?.tabId) { buffers.current.delete(id); tabConflicts.current.delete(id) }
        const current = docRef.current
        if (current && !current.untitledId && current.root === root) {
          try {
            const opened = await api.read(current.file.path)
            setDoc((latest) => latest?.tabId === current.tabId && latest?.root === root ? {
              ...latest, baseline: baselineText(opened.baseline, opened.file.content),
              ...(refreshDisk && opened.file.revision !== latest.file.revision ? { file: opened.file, content: normalize(opened.file.content), cleanContent: undefined } : {}),
            } : latest)
            setPreview(docRef.current?.content ?? '')
          } catch (error) {
            if (refreshDisk) { buffers.current.delete(current.tabId!); setDoc(null); setNotice('更新后无法读取当前文档，请从文件树重新选择。' + failure(error)) }
            operationError ??= error
          }
        }
        if (refreshDisk && sameRoot(paperStateRef.current.project?.rootLabel, root)) await paperWorkspace.current?.refresh()
        const refreshed = await Promise.allSettled([refreshGit(), refreshTree()])
        for (const result of refreshed) if (result.status === 'rejected') operationError ??= result.reason
      }
      if (operationError) throw operationError
    })
  }

  useEffect(() => {
    let cancelled = false
    if (api) void run(async () => {
      try {
        const [savedSettings, drafts] = await Promise.all([api.settings(), api.listUntitled()])
        if (cancelled) return
        settingsRef.current = savedSettings; setSettings(savedSettings); setUntitled(drafts)
        const restored = initialSession.tabs.filter(tab => tab.untitledId || savedSettings.projects.some(project => project.root === tab.root))
        for (const draft of drafts) if (!restored.some(tab => tab.untitledId === draft.id) && !initialSession.closed.some(tab => tab.untitledId === draft.id)) restored.push({ id: 'untitled:' + draft.id, root: '', path: draft.mode === 'latex-math' ? '未命名.tex' : '未命名.md', title: draftTitle(draft), mode: draft.mode, untitledId: draft.id, pinned: false, dirty: !!draft.content })
        setTabs(restored)
        if (restored.length) { try { await activateTab(restored.find(tab => tab.id === initialSession.active)?.id ?? restored[0].id) } catch (error) { setNotice('部分标签未能恢复：' + failure(error)); startUntitled(drafts[0]) } }
        else if (savedSettings.projects.length) { setStartup(true); setStatus('选择项目，或开始新文档') }
        else startUntitled(drafts[0])
      } finally { if (!cancelled) setInitializing(false) }
    })
    return () => { cancelled = true }
  }, [])
  useEffect(() => { let cancelled = false; if (api) void api.fonts().then(options => { if (!cancelled) setFonts(options) }).catch(error => { if (!cancelled) setNotice(failure(error)) }); return () => { cancelled = true } }, [])
  useEffect(() => { const keep = new Set([...tabs, ...closedTabs].map(tab => tab.id)); for (const id of buffers.current.keys()) if (!keep.has(id)) { buffers.current.delete(id); tabPositions.current.delete(id); tabConflicts.current.delete(id) } }, [tabs, closedTabs])
  const tabLayout = JSON.stringify(tabs.map(tab => [tab.id, tab.pinned]))
  useEffect(() => {
    let pending = false
    const reveal = () => {
      // Wait for the sidebar to settle so scrolling does not fight its translation.
      if (rootRef.current?.dataset.layoutAnimating === 'true') { pending = true; return }
      pending = false
      const strip = rootRef.current?.querySelector<HTMLElement>('.tab-strip')
      const tab = strip?.querySelector<HTMLElement>('.document-tab.active')
      if (!strip || !tab) return
      const pins = strip.querySelectorAll<HTMLElement>('.tab-pinned')
      const regular = strip.querySelector<HTMLElement>('.document-tab:not(.tab-pinned)')
      strip.dataset.scrollPins = String(!canStickPinnedTabs({
        viewportWidth: strip.clientWidth,
        pinnedCount: pins.length,
        pinnedWidth: pins[0]?.getBoundingClientRect().width ?? 40,
        gap: parseFloat(getComputedStyle(strip).columnGap) || 0,
        regularWidth: regular?.getBoundingClientRect().width ?? 0
      }))
      const viewport = strip.getBoundingClientRect(), target = tab.getBoundingClientRect()
      const pinnedSpace = tab.classList.contains('tab-pinned') ? 0 : parseFloat(getComputedStyle(tab).scrollMarginInlineStart) || 0
      const left = viewport.left + pinnedSpace
      // Scroll this rail only; scrollIntoView can also move overflow-hidden ancestors.
      if (target.left < left) strip.scrollLeft += target.left - left
      else if (target.right > viewport.right) strip.scrollLeft += target.right - viewport.right
    }
    const layoutChanged = (event: Event) => { if (pending && !(event as CustomEvent<{ active: boolean }>).detail.active) reveal() }
    reveal()
    window.addEventListener('resize', reveal)
    document.addEventListener('workspace-layout-motion', layoutChanged)
    return () => { window.removeEventListener('resize', reveal); document.removeEventListener('workspace-layout-motion', layoutChanged) }
  }, [activeTab, sidebar, tabLayout])
  useEffect(() => { if (!initializing) { const timer = setTimeout(() => localStorage.setItem(sessionKey, JSON.stringify({ tabs, active: activeTab, closed: closedTabs })), 150); return () => clearTimeout(timer) } }, [tabs, activeTab, closedTabs, initializing])
  useEffect(() => { if (doc?.tabId) { if (external) tabConflicts.current.set(doc.tabId, external); else tabConflicts.current.delete(doc.tabId) } }, [external, doc?.tabId])
  useLayoutEffect(() => { document.documentElement.dataset.theme = resolvedTheme }, [resolvedTheme])
  useEffect(() => {
    if (!doc) { setCount(0); setCounted(null); return }
    let cancel: (() => void) | undefined
    const timer = setTimeout(() => {
      setPreview(doc.content)
      cancel = countChanges(doc.baseline, doc.content, (value) => { setCount(value); setCounted({ baseline: doc.baseline, content: doc.content, count: value }) }, (message) => { setCounted(null); setNotice(message) })
    }, 200)
    return () => { clearTimeout(timer); cancel?.() }
  }, [doc?.content, doc?.baseline, doc?.file.path])
  useEffect(() => {
    if (!doc || composing || navigating) return
    const timer = setTimeout(() => { void run(() => persistDraft()) }, 250)
    return () => clearTimeout(timer)
  }, [doc?.content, doc?.file.path, doc?.untitledId, doc?.mode, composing, navigating])
  useEffect(() => {
    if (!doc || doc.untitledId || !editedRef.current || autoPaused || busy || navigating || compileSource || !git?.repository || git.blocked || external || question || counted?.baseline !== doc.baseline || counted.content !== doc.content) return
    const actualCount = counted.count
    const attempt = JSON.stringify([doc.file.path, doc.content, doc.baseline, settings.threshold])
    if (shouldAutoCommit(actualCount, settings.threshold, composing, settings.autoCommit) && autoAttempt.current !== attempt) {
      const timer = setTimeout(() => { autoAttempt.current = attempt; void save(true) }, 300)
      return () => clearTimeout(timer)
    }
  }, [doc?.content, doc?.baseline, counted, composing, busy, navigating, compileSource, autoPaused, settings.threshold, settings.autoCommit, git?.repository, git?.blocked, external, question])
  useEffect(() => {
    if (!api) return
    return api.onFilesChanged(() => { void run(checkExternal) })
  })
  useEffect(() => {
    if (!api) return
    return api.onAction((action) => { void run(async () => {
      if (questionRef.current || projectDialog || compileSource) {
        if ((action === 'undo' || action === 'redo') && document.activeElement?.matches('dialog input:not(:disabled), dialog textarea:not(:disabled)') && !composingRef.current) document.execCommand(action)
        return
      }
      if (loadingRef.current) return
      if (action === 'paper') { await openPaper(); return }
      if (action === 'open-library') { await choose('library'); return }
      if (action === 'open-file') { await choose('file'); return }
      if (action === 'sync') { await showGit(); return }
      if (paperActive) { await paperWorkspace.current?.performAction(action); return }
      if (action === 'compile') openCompiler()
      if (action === 'save') await save()

      if (action === 'new-file') await newEntry(false)
      if (action === 'find') openSearch()
      if (action === 'close-tab' && docRef.current?.tabId) await closeTab(docRef.current.tabId)
      if (action === 'reopen-tab') await reopenTab()
      if (action === 'next-tab' || action === 'previous-tab') { const at = tabsRef.current.findIndex(tab => tab.id === docRef.current?.tabId); const list = tabsRef.current; if (list.length) await switchTab(list[(at + (action === 'next-tab' ? 1 : list.length - 1)) % list.length].id) }
      if (action === 'undo' || action === 'redo') {
        if (document.activeElement?.matches('input, textarea')) document.execCommand(action)
        else if (action === 'undo') activeEditor()?.undo()
        else activeEditor()?.redo()
      }
      if (['source', 'preview', 'split'].includes(action)) await updateSettings({ layout: action === 'preview' && docRef.current?.mode === 'latex-math' ? 'split' : action as Settings['layout'] })
    }) })
  })
  useEffect(() => {
    if (!api) return
    return api.onCloseRequest(() => { if (questionRef.current || compileSource) return; void run(() => navigate(async () => { if (paperOpened && !(await paperWorkspace.current?.requestClose())) return; if (await guardSwitch(true)) { await persistDraft(); localStorage.setItem(sessionKey, JSON.stringify({ tabs: tabsRef.current, active: docRef.current?.tabId ?? '', closed: closedTabs })); api.closeReady() } })) })
  })

  useContextMenu(contextMenu, contextEl, contextSource, () => setContextMenu(null))
  useContextMenu(projectMenu, projectMenuEl, projectMenuSource, () => setProjectMenu(null))
  useContextMenu(markMenu, markMenuEl, markMenuSource, () => setMarkMenu(null))
  useContextMenu(tabMenu, tabMenuEl, tabMenuSource, () => setTabMenu(null))
  useEffect(() => { setMarkMenu(null) }, [doc?.editorKey, doc?.mode])
  useEffect(() => { setFormatMenu(false) }, [doc?.editorKey])
  useLayoutEffect(() => {
    if (!formatMenu) return
    const host = formatMenuHost.current, menu = host?.querySelector<HTMLElement>('.format-menu'), container = host?.closest<HTMLElement>('.main')
    if (!host || !menu || getComputedStyle(host).display === 'none') { setFormatMenu(false); return }
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
    const restore = () => {
      if (formatMenuTrigger.current?.getClientRects().length) formatMenuTrigger.current.focus({ preventScroll: true })
      else activeEditor()?.focus()
    }
    const dismiss = () => { if (host.contains(document.activeElement)) restore(); setFormatMenu(false) }
    const outside = (event: PointerEvent) => { if (!host.contains(event.target as Node)) setFormatMenu(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); restore(); setFormatMenu(false) } }
    const initialWidth = container?.clientWidth
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { if (container?.clientWidth !== initialWidth) dismiss() })
    if (container) observer?.observe(container)
    window.addEventListener('resize', dismiss); document.addEventListener('workspace-layout-motion', dismiss)
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape, true)
    return () => { observer?.disconnect(); window.removeEventListener('resize', dismiss); document.removeEventListener('workspace-layout-motion', dismiss); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true) }
  }, [formatMenu])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (paperActive) return
      const primary = isMac ? event.metaKey : event.ctrlKey
      if ((primary || event.ctrlKey) && !event.altKey && !event.isComposing) {
        const key = event.key.toLowerCase()
        const handled = key === 'tab' ? event.ctrlKey : primary && ['t', 'n', 'w', 'f'].includes(key)
        if (handled) {
          event.preventDefault(); event.stopPropagation()
          if (question || projectDialog || compileSource || initializing || loadingRef.current) return
          if (key === 'f') openSearch()
          else if (key === 't' && event.shiftKey) void run(reopenTab)
          else if (key === 't' || key === 'n') void run(newDocument)
          else if (key === 'w' && docRef.current?.tabId) void run(() => closeTab(docRef.current!.tabId!))
          else if (key === 'tab') { const list = tabsRef.current, at = list.findIndex(tab => tab.id === docRef.current?.tabId); if (list.length) void run(() => switchTab(list[(at + (event.shiftKey ? list.length - 1 : 1)) % list.length].id)) }
          return
        }
      }
      if (primary && !event.altKey && !event.isComposing && /^[1-9]$/.test(event.key)) { event.preventDefault(); if (question || projectDialog || compileSource || initializing || loadingRef.current) return; const tab = event.key === '9' ? tabsRef.current.at(-1) : tabsRef.current[Number(event.key) - 1]; if (tab) void run(() => switchTab(tab.id)) }
    }
    window.addEventListener('keydown', keydown, true)
    return () => { window.removeEventListener('keydown', keydown, true) }
  })
  function blockNodes(depth = 0) {
    return <div className="block-tree" aria-label="文档 Mark" style={{ "--mark-rail": `${20 + depth * 16}px` } as CSSProperties}>{blocks.map((block, index) => <button disabled={busy || navigating || outlineContent !== doc?.content} key={block.id} data-mark-id={block.id} data-kind={block.type} title={block.label || '空白 Mark'} aria-label={'跳转 Mark ' + (index + 1) + ' ' + (block.label || '空白 Mark')} aria-current={activeMark?.from === block.from ? 'true' : undefined} style={{ paddingLeft: 28 + depth * 16 }} onClick={() => blockEditor.current?.jump?.(block.from)} onContextMenu={event => { event.preventDefault(); openMarkMenu(event.currentTarget, block.id, event.clientX || undefined, event.clientY || undefined) }} onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); openMarkMenu(event.currentTarget, block.id) } }}><span className="block-kind">{block.type === 'heading' ? 'H' + block.level : block.type === 'code' ? '</>' : block.type === 'math' ? '∑' : block.type === 'list' ? '≡' : '·'}</span><span>{block.label || '空白 Mark'}</span></button>)}</div>
  }
  function followLink(path: string, anchor?: string) {
    void run(async () => {
      if (doc?.untitledId) {
        if (path === doc.file.path && anchor) jumpToAnchor(anchor)
        else setNotice('先将文档保存到项目，再打开相对链接。')
      } else await loadDocument(path, anchor)
    })
  }
  const handleEditorChange = useLatestEvent((content: string) => { editedRef.current = true; setDoc(current => current ? { ...current, content } : null); setStatus(docRef.current?.untitledId ? '草稿自动保留在本机' : '未保存') })
  const handleComposition = useLatestEvent((active: boolean) => { composingRef.current = active; setComposing(active) })
  const handleEditorSave = useLatestEvent(() => { void save() })
  const handlePosition = useLatestEvent((position: { cursor: number; scroll: number }) => { positionRef.current = position })
  const handleEditorNavigate = useLatestEvent(followLink)
  const handleExternal = useLatestEvent((url: string) => { void run(() => api.openExternal(url)) })
  useLayoutEffect(() => {
    if (!newMenu) return
    const position = () => {
      const host = newMenuHost.current, menu = host?.querySelector<HTMLElement>('.new-document-menu')
      if (!host || !menu) return
      const bounds = host.getBoundingClientRect()
      menu.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - menu.offsetWidth - 12))}px`
      menu.style.top = `${bounds.bottom + 6}px`
    }
    position(); window.addEventListener('resize', position)
    newMenuHost.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const dismiss = (event: PointerEvent) => { if (!newMenuHost.current?.contains(event.target as Node)) setNewMenu(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setNewMenu(false); newMenuHost.current?.querySelector<HTMLButtonElement>('.tab-new')?.focus() } }
    document.addEventListener('pointerdown', dismiss, true); document.addEventListener('keydown', escape)
    return () => { window.removeEventListener('resize', position); document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('keydown', escape) }
  }, [newMenu])
  const editorProps = doc ? {
    readOnly: navigating, documentKey: doc.editorKey ?? library?.root + '/' + doc.file.path, value: doc.content, mode: doc.mode, theme: resolvedTheme,
    fontSize: settings.fontSize, fontFamily: documentFont, lineHeight: settings.lineHeight, completion: settings.completion,
    initialPosition: tabPositions.current.get(doc.tabId!) ?? (doc.untitledId ? undefined : settings.positions[library?.root + '/' + doc.file.path]),
    onChange: handleEditorChange, onComposition: handleComposition, onSave: handleEditorSave,
    onPosition: handlePosition,
    onMarkSelection: receiveMarkSelection,
    onError: setNotice,
  } : null
  const formatItems = [{ command: 'bold', label: '加粗', icon: 'bold' }, { command: 'underline', label: '下划线', icon: 'underline' }, { command: 'strike', label: '删除线', icon: 'strikethrough' }, { command: 'italic', label: '斜体', icon: 'italic' }, { command: 'superscript', label: '上标', icon: 'superscript' }, { command: 'subscript', label: '下标', icon: 'subscript' }, { command: 'highlight', label: '荧光笔', icon: 'highlight' }] as const
  const formatButtons = (inMenu = false) => formatItems.map(item => <button key={item.command} role={inMenu ? 'menuitem' : undefined} tabIndex={inMenu ? -1 : undefined} title={item.label} aria-label={item.label} disabled={navigating || doc?.mode === 'latex-math'} onMouseDown={event => event.preventDefault()} onClick={() => { activeEditor()?.format?.(item.command); setFormatMenu(false) }}><Icon name={item.icon} /></button>)
  const lastProject = settings.projects.find((project) => project.root === settings.lastProject) ?? settings.projects[0]
  const externallyManaged = settings.projects.find(project => project.root === library?.root)?.syncMode === 'external'
  const checking = checkingRoot === library?.root

  useEffect(() => {
    if (initializing || busy || navigating || paperActive || !doc || doc.mode !== 'latex-math' || doc.untitledId || isDocDirty(doc) || !isLatexDocument(doc.content) || routedDocument.current === doc.editorKey) return
    routedDocument.current = doc.editorKey ?? ''
    void openFullDocument()
  }, [initializing, busy, navigating, doc?.editorKey])

  const paperInLibrary = sameRoot(paperState.project?.rootLabel, library?.root)
  const workspaceBusy = busy || navigating || paperState.busy || paperState.building
  const settingsPanel = <SettingsPanel panelRef={panelRef} settings={settings} fonts={fonts} onChange={updateSettings} onClose={closePanel} engine={paperActive ? 'latex' : doc?.mode === 'latex-math' ? 'formula' : 'markdown'} shortcut={shortcut('S')} />
  if (!api) return <div className="browser-notice"><h1>MarkFlow</h1><p>文件与 Git 功能需要桌面主进程。</p><p>请在项目目录运行 <code>npm run dev</code> 打开 Electron 窗口。</p></div>
  return <div ref={rootRef} className="app" data-mode={paperActive ? 'latex-math' : doc?.mode ?? 'markdown'} data-platform={api.platform} data-paper={paperActive ? 'active' : undefined} data-sidebar={sidebar ? 'open' : 'closed'} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
    event.preventDefault(); const file = event.dataTransfer.files[0]
    if (file) void run(() => navigate(async () => { const result = await api.openDropped(file); if (result) await adoptLibrary(result.library, result.path) }))
  }}>
    <header className="window-drag">
      <div className="titlebar-navigation"><button className="icon-button" title={sidebar ? '收起侧栏' : '展开侧栏'} aria-label="收起 / 展开侧栏" aria-expanded={sidebar} onClick={() => transitionLayout(() => setSidebar(value => !value))}><Icon name="sidebar" /></button></div>
      <div className="tab-strip" style={{ '--pinned-count': tabs.filter(tab => tab.pinned).length } as CSSProperties} role="tablist" aria-label="文档标签">
        {tabs.map((tab, index) => <div key={tab.id} style={{ '--pinned-index': index } as CSSProperties} className={`document-tab ${!paperActive && activeTab === tab.id ? 'active' : ''} ${tab.pinned ? 'tab-pinned' : ''}`} draggable={!busy && !navigating} onDragStart={event => { event.dataTransfer.setData('application/x-oopsmd-tab', tab.id); event.dataTransfer.effectAllowed = 'move' }} onDragOver={event => { if (event.dataTransfer.types.includes('application/x-oopsmd-tab')) { event.preventDefault(); event.stopPropagation() } }} onDrop={event => { const id = event.dataTransfer.getData('application/x-oopsmd-tab'); if (id) { event.preventDefault(); event.stopPropagation(); setTabs(reorderTabs(tabsRef.current, id, tab.id)) } }} onAuxClick={event => { if (event.button === 1) { event.preventDefault(); void run(() => closeTab(tab.id)) } }} onContextMenu={event => { event.preventDefault(); openTabMenu(event.currentTarget, tab.id, event.clientX || undefined, event.clientY || undefined) }} onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); openTabMenu(event.currentTarget, tab.id) } }}>
          <button className="tab-select" role="tab" disabled={busy || navigating || paperState.busy} tabIndex={activeTab === tab.id ? 0 : -1} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const at = tabs.findIndex(item => item.id === tab.id); const next = tabs[(at + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; void run(() => switchTab(next.id)) } }} aria-selected={!paperActive && activeTab === tab.id} aria-label={tab.title} title={tab.untitledId ? tab.title + ' · 草稿' : tab.root + '/' + tab.path} onClick={() => void run(() => switchTab(tab.id))}><Icon name={tab.pinned ? 'pin' : tab.mode === 'latex-math' ? 'math' : 'file'} /><span className="tab-title">{tab.title}</span>{tab.dirty && <span className="tab-dirty" title="未保存" />}</button>
          {!tab.pinned && <button className="tab-close" disabled={busy || navigating || paperState.busy} aria-label={`关闭标签 ${tab.title}`} title={`关闭 ${shortcut('W')}`} onClick={() => void run(() => closeTab(tab.id))}><Icon name="close" /></button>}
        </div>)}
        {paperOpened && <div className={`document-tab ${paperActive ? 'active' : ''}`}><button className="tab-select" role="tab" disabled={busy || navigating || paperState.busy} aria-selected={paperActive} onClick={() => void run(() => openPaper())}><Icon name="math" /><span className="tab-title">Fomula</span></button><button className="tab-close" disabled={busy || navigating || paperState.busy} aria-label="关闭 Fomula 文档" onClick={() => void run(async () => { if (await paperWorkspace.current?.requestClose()) { setPaperActive(false); setPaperOpened(false); clearPaperState(); setPaperDocumentRequest(undefined); setPaperStartRequest(undefined) } })}><Icon name="close" /></button></div>}
      </div><div className="new-document-control" ref={newMenuHost}>
        <button className="tab-new icon-button" aria-label="新建标签" aria-haspopup="menu" aria-expanded={newMenu} title={`新建文档 ${shortcut('T')}`} disabled={initializing || busy || navigating || paperState.busy} onClick={() => setNewMenu(value => !value)}><Icon name="plus" /></button>
        {newMenu && <div className="new-document-menu" role="menu" aria-label="新建文档类型" onKeyDown={event => {
          if (event.key === 'Tab') { setNewMenu(false); return }
          navigateMenu(event)
        }}><span className="new-document-caption">新建</span>{registeredDocumentModules.map(module => <button key={module.id} role="menuitem" onClick={() => module.id === 'latex-math' ? newFomula() : void run(() => newDocument(module.id))}><Icon name={module.id === 'latex-math' ? 'math' : 'file'} /><span><strong>{module.label}</strong><small>{module.id === 'latex-math' ? '公式与 LaTeX 文档' : '笔记与长文写作'}</small></span><span className="document-extension">{module.defaultExtension}</span></button>)}<div className="new-document-separator" role="separator" /><button role="menuitem" onClick={openCompiler}><Icon name="file" /><span><strong>生成 Word / PPT…</strong><small>将内容生成为报告或演示</small></span></button></div>}
      </div>
    </header>
    <div className="workspace">
      <div className="sidebar-shell" inert={!sidebar} aria-hidden={!sidebar}><ProjectSidebar projects={settings.projects} library={library} treeMode={treeMode} onTreeModeChange={setTreeMode} entries={entries} archivedEntries={archivedEntries} allFiles={allFiles} selected={selected} folder={folder} expanded={expanded} dropTarget={dropTarget} showArchive={showArchive} onShowArchiveChange={setShowArchive} busy={workspaceBusy} initializing={initializing} readOnly={paperInLibrary && !!paperState.project?.origin} settingsOpen={panel === 'settings'} gitOpen={panel === 'git'}
        onSettings={() => setPanel(panel === 'settings' ? 'none' : 'settings')} onGit={() => void run(async () => { if (panel === 'git') setPanel('none'); else await showGit() })} onAddProject={() => setProjectDialog(true)} onOpenProject={root => void run(() => openProject(root))} onProjectMenu={openProjectMenu}
        onOpenFile={path => { setSelected(path); void run(() => loadDocument(path)) }} onFolderClick={path => { setSelected(path); setFolder(path); if (path) setExpanded(old => { const next = new Set(old); next.has(path) ? next.delete(path) : next.add(path); return next }) }}
        onNewFolder={() => void run(() => newEntry(true))} onNewFile={paperActive && paperInLibrary ? () => void run(newPaperFile) : undefined}
        onContextMenu={(element, node, x, y) => { contextSource.current = element; setSelected(node.path); setContextMenu({ path: node.path, directory: node.directory, x: Math.min(x, window.innerWidth - 220), y: Math.min(y, window.innerHeight - 190) }) }} onDragOver={dragOver} onDrop={dropInto} onDragEnd={() => setDropTarget(null)} onDragStart={() => setContextMenu(null)}
        engineOutline={paperActive && paperInLibrary && !!paperState.outline.length ? <section className="project-outline"><div className="sidebar-heading">当前文件章节</div>{paperState.outline.map(item => <button className="tree-item" key={item.line} onClick={() => void run(async () => { await paperWorkspace.current?.openFile(paperState.activePath, item.line) })}><span>{item.label}</span><small>{item.line}</small></button>)}</section> : undefined} /></div>
      <main className="main">
        <ApplicationBar project={library ? basename(library.root.replaceAll('\\', '/')) : '本地工作区'} root={library?.root} filename={paperActive ? paperState.activePath || '新建 LaTeX 文档' : doc ? basename(doc.file.path) : '项目'} type={paperActive ? 'Fomula' : documentModule.label} formula={paperActive || doc?.mode === 'latex-math'} dirty={paperActive ? !!paperState.dirtyPaths.length : dirty} state={paperActive ? paperState.project?.origin ? '生成稿' : undefined : doc?.untitledId ? '草稿' : doc && archiveOwner(archives, doc.file.path) ? '已归档' : undefined} busy={busy || navigating || paperActive && paperState.busy} canSave={paperActive ? !!paperState.project && !paperState.project.origin : !!doc} canHistory={paperActive ? paperInLibrary && !!paperState.activePath && !paperState.project?.origin : !!doc && !doc.untitledId} theme={settings.theme} resolvedTheme={resolvedTheme} saveShortcut={shortcut('S')} onOpen={() => void run(() => choose('file'))} onTheme={theme => void run(() => updateSettings({ theme }))} onHistory={() => void run(showHistory)} onSave={() => void run(async () => { if (paperActive) { await paperWorkspace.current?.performAction('save'); await refreshGit() } else await save() })} />
        {notice && <div className="notice" role="alert"><span>{notice}</span>{missingProject && <button disabled={busy || navigating} onClick={() => void run(() => relocateProject(missingProject))}>重新定位项目</button>}<button aria-label="关闭提示" onClick={() => setNotice('')}><Icon name="close" /></button></div>}
        <div className="workspace-mode" style={paperActive ? { display: 'none' } : undefined} inert={paperActive}>
        {external && <div className="conflict"><strong>检测到外部修改</strong><span>你的编辑和磁盘内容均已保留。</span><button onClick={() => void run(() => api.exportCopy(external.content))}>导出磁盘副本</button><button onClick={() => void run(async () => { if (!(await api.exportCopy(docRef.current!.content))) return; setDoc((current) => current ? { ...current, file: external, content: normalize(external.content), cleanContent: undefined } : null); setPreview(docRef.current?.content ?? ''); setExternal(null); await persistDraft() })}>备份编辑并载入磁盘</button><button onClick={() => void run(async () => { if (!(await api.exportCopy(external.content))) return; setDoc((current) => current ? { ...current, file: external, cleanContent: normalize(external.content) } : null); setExternal(null); await persistDraft(); setNotice('磁盘副本已导出。当前编辑尚未写盘，请手动保存。') })}>备份磁盘并保留编辑</button></div>}
        {!doc ? <section className="startup">
          {initializing ? <p className="muted">正在打开工作区…</p> : <>
            <div className="startup-heading"><h1>{startup ? '继续你的工作' : '项目已打开'}</h1><p>{startup ? '回到上次的项目，或从一份新文档开始。' : '从左侧选择文件，或创建一份新文档。'}</p></div>
            {startup && lastProject && <button className="project-card" aria-label="继续上次项目" onClick={() => void run(() => openProject(lastProject.root))}><Icon name="folderOpen" size={24} /><span><strong>{basename(lastProject.root.replaceAll('\\', '/'))}</strong><small>{lastProject.root}</small></span><Icon name="arrowRight" /></button>}
            <div className="startup-actions"><button className="primary" onClick={() => void run(newDocument)}><Icon name="filePlus" />新建文档</button><button onClick={() => setProjectDialog(true)}><Icon name="folderOpen" />添加项目</button></div>
            {startup && untitled.length > 0 && <button className="resume-draft" onClick={() => void run(() => openDraft(untitled[0]))}><Icon name="clock" />继续未保存文档<span>{draftTitle(untitled[0])}</span><Icon name="arrowRight" /></button>}
          </>}
        </section>
          : <><WorkspaceToolbar>
            {doc.mode === "latex-math" && <FomulaModeSwitch mode="fragment" disabled={busy || navigating} onChange={() => void run(async () => { if (isLatexDocument(doc.content)) await openFullDocument(); else await openPaper() })} />}
            <div className="font-control" title={doc.mode === 'markdown' ? `当前 Mark：${activeMark?.label || '请选择正文'}` : 'Fomula 公式排版'}>
              {doc.mode === 'markdown' && <span className="font-scope" title="字体和字号仅应用到光标所在的内容块（Mark）">块样式</span>}
              <SelectControl className="font-family-select" aria-label={doc.mode === 'markdown' ? 'Mark 字体' : '字体'} disabled={navigating || (doc.mode === 'markdown' && !activeMark)} value={toolbarFont} onChange={event => applyTypography({ fontFamily: event.target.value as Settings['fontFamily'] })}>{fonts.map(font => <option key={font.id} value={font.id} disabled={!font.available}>{font.name}{!font.available ? ' · 未安装' : ''}</option>)}</SelectControl>
              <SelectControl className="font-size-select" aria-label={doc.mode === 'markdown' ? 'Mark 字号' : '字号'} disabled={navigating || (doc.mode === 'markdown' && !activeMark)} value={toolbarSize} onChange={event => applyTypography({ fontSize: +event.target.value })}>{toolbarSizes.map(size => <option key={size} value={size}>{size}</option>)}</SelectControl>
              {doc.mode === 'markdown' && <button className="icon-button mark-style-reset" aria-label="恢复 Mark 默认样式" title="恢复默认字体和字号" disabled={navigating || !activeMark?.explicit} onMouseDown={event => event.preventDefault()} onClick={() => applyTypography(null)}><Icon name="reopen" /></button>}
            </div>
            {doc.mode === "markdown" && <><div className="format-tools" aria-label="文字格式">{formatButtons()}</div><div ref={formatMenuHost} className="format-overflow" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFormatMenu(false) }}><button ref={formatMenuTrigger} className="icon-button" aria-label="更多排版" title="更多排版" aria-haspopup="menu" aria-expanded={formatMenu} onMouseDown={event => event.preventDefault()} onClick={() => { if (formatMenu) formatMenuTrigger.current?.focus({ preventScroll: true }); setFormatMenu(!formatMenu) }} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setFormatMenu(true) } }}><Icon name="more" /></button>{formatMenu && <div className="format-menu" role="menu" aria-label="文字格式" onKeyDown={event => {
              if (event.key === 'Tab') { formatMenuTrigger.current?.focus({ preventScroll: true }); setFormatMenu(false); return }
              navigateMenu(event)
            }}>{formatButtons(true)}</div>}</div></>}
            <button className="compile-trigger" aria-label="生成 Word / PPT" title="生成 Word 报告或 PPT 演示" disabled={initializing || busy || navigating || composing} onClick={openCompiler}><Icon name="file" /><span>生成</span></button>
            <button className="toolbar-search" aria-label="查找" aria-expanded={query !== null} aria-controls={query !== null ? 'document-find' : undefined} title={`查找 ${shortcut('F')}`} onClick={openSearch}><Icon name="search" /><span>搜索</span><kbd>{shortcut('F')}</kbd></button>
            <WorkspaceLayoutSwitch layouts={documentModule.layouts} value={settings.layout} onChange={layout => void run(() => updateSettings({ layout }))} /></WorkspaceToolbar>
            {query !== null && <div className="find-bar" id="document-find" role="search" aria-label="文档内查找"><div className="find-input"><Icon name="search" /><input ref={searchInput} aria-label="页内查找" placeholder="在文档中查找" value={query} onChange={event => { setQuery(event.target.value); if (!(event.nativeEvent as InputEvent).isComposing) search(event.target.value) }} onCompositionEnd={event => search(event.currentTarget.value)} onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter') { event.preventDefault(); search(query, event.shiftKey ? -1 : 1) } if (event.key === 'Escape') { event.preventDefault(); setQuery(null); search(''); activeEditor()?.focus() } }} /></div><span className="find-count" aria-live="polite">{query ? searchResult.count ? searchResult.index + ' / ' + searchResult.count : '没有匹配' : ''}</span><button className="icon-button" aria-label="上一个匹配" title="上一个匹配 Shift Enter" disabled={!query || !searchResult.count} onClick={() => search(query, -1)}><Icon name="arrowUp" /></button><button className="icon-button" aria-label="下一个匹配" title="下一个匹配 Enter" disabled={!query || !searchResult.count} onClick={() => search(query)}><Icon name="arrowDown" /></button><button className="icon-button" aria-label="关闭查找" title="关闭查找 Esc" onClick={() => { setQuery(null); search(''); activeEditor()?.focus() }}><Icon name="close" /></button></div>}
            <div className="document-surface" ref={documentSurface}>
            <div className={`editor-area layout-${settings.layout} ${doc.mode === 'latex-math' && settings.layout === 'preview' ? 'math-live' : ''}`} style={{ '--document-font': documentFont, '--split': `${split}%`, '--font-size': `${settings.fontSize}px`, '--line-height': settings.lineHeight, '--line-width': `${settings.lineWidth}px` } as CSSProperties}>
              <section className={settings.layout === 'preview' && doc.mode === 'markdown' ? 'live-pane' : doc.mode === 'latex-math' ? 'source-pane formula-source-pane' : 'source-pane'} aria-label={settings.layout === 'preview' && doc.mode === 'markdown' ? '实时编辑器' : '源码编辑器'}>{doc.mode === 'latex-math' && <WorkspacePaneHeading><span><Icon name="source" size={14} />{basename(doc.file.path)}</span><small>{dirty ? '未保存' : '已保存'}</small></WorkspacePaneHeading>}<div className="formula-pane-content"><DocumentEditor ref={blockEditor} {...editorProps!} live={settings.layout === 'preview'} path={doc.file.path} localFiles={!doc.untitledId} onNavigate={handleEditorNavigate} onExternal={handleExternal} onHeadingSelection={receiveHeadingSelection} /></div></section>
              {settings.layout === 'split' && <div className="splitter" role="separator" aria-label="调整分屏比例" aria-orientation="vertical" aria-valuenow={split} tabIndex={0} onKeyDown={(event) => { if (event.key === 'ArrowLeft') setSplit(Math.max(20, split - 2)); if (event.key === 'ArrowRight') setSplit(Math.min(80, split + 2)) }} onPointerDown={(event) => { const target = event.currentTarget; const bounds = target.parentElement!.getBoundingClientRect(); target.setPointerCapture(event.pointerId); const move = (e: PointerEvent) => setSplit(Math.max(20, Math.min(80, (e.clientX - bounds.left) / bounds.width * 100))); const end = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', end) }; target.addEventListener('pointermove', move); target.addEventListener('pointerup', end) }} />}
              {settings.layout === 'split' && <div className={doc.mode === "latex-math" ? "preview-frame formula-preview-frame" : "preview-frame"}>{doc.mode === "latex-math" && <WorkspacePaneHeading><span><Icon name="preview" size={14} />公式预览</span><small>即时更新</small></WorkspacePaneHeading>}<section className="preview-pane" aria-label="文档预览" ref={previewEl} onScroll={event => { previewScrollRef.current = event.currentTarget.scrollTop }}>{!preview ? <div className="empty-preview"><Icon name="preview" size={24} /><span>实时预览</span><p>写下内容，排版会出现在这里。</p></div> : <DocumentPreview onOpenDocument={() => void openFullDocument()} content={preview} mode={doc.mode} path={doc.file.path} localFiles={!doc.untitledId} onNavigate={handleEditorNavigate} onExternal={handleExternal} />}</section></div>}
            </div>

              {panel === 'none' && documentModule.capabilities.outline && <DocumentNavigation documentKey={doc.editorKey!} layout={settings.layout} headings={headings} activeId={activeHeadingId} disabled={busy || navigating || preview !== doc.content || outlineContent !== preview} pinned={navigationPinned} onPinnedChange={value => { transitionLayout(() => setNavigationPinned(value)); localStorage.setItem('oopsmd.navigation.pinned', String(value)) }} onNavigate={heading => { activeEditor()?.jumpTo(heading.line); jumpToAnchor(heading.id) }} blockContent={documentModule.capabilities.blockFormatting ? blockNodes() : undefined} />}
            </div>
          </>}
        <footer className="statusbar"><span className={`status-light ${busy || navigating ? 'working' : dirty ? 'dirty' : ''}`} /><span>{status}</span><span className="status-spacer" /><span>{doc ? `净修改 ${count} / ${settings.threshold}` : 'UTF-8'}</span><button disabled={!library || busy || navigating} onClick={() => void run(showGit)}>{externallyManaged ? '外部云盘管理' : checking ? '正在检查远端…' : remoteSummary(git)}</button></footer>
        </div>
    {paperOpened && <div className="paper-workspace-host" style={{ flex: 1, minHeight: 0, display: paperActive ? 'flex' : 'none' }} inert={!paperActive || busy || navigating}><Suspense fallback={<p className="muted">正在打开 Fomula…</p>}><PaperWorkspace ref={paperWorkspace} fontSize={settings.fontSize} lineHeight={settings.lineHeight} fontFamily={documentFont} completion={settings.completion} onStateChange={receivePaperState} onProjectReady={activatePaperProject} startRequest={navigating || initializing ? undefined : paperStartRequest} documentRequest={navigating || initializing ? undefined : paperDocumentRequest} onFragment={() => void run(async () => { if (!newFragmentRequested.current && docRef.current?.mode === "latex-math" && !isLatexDocument(docRef.current.content)) setPaperActive(false); else { newFragmentRequested.current = false; await newDocument("latex-math") } })} theme={resolvedTheme} currentDocument={paperSource} onLocateMark={locatePaperMark} onClose={() => setPaperActive(false)} /></Suspense></div>}
      </main>
      {panel === 'settings' && settingsPanel}
      {panel !== 'none' && panel !== 'settings' && <aside ref={panelRef} className="panel" aria-label={{ git: 'Git 与同步', history: '文档版本' }[panel]} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closePanel() } }}><div className="panel-heading"><h2>{{ git: 'Git 与同步', history: '文档版本' }[panel]}</h2><button className="icon-button" aria-label="关闭面板" title="关闭面板 Esc" onClick={closePanel}><Icon name="close" /></button></div>
        {panel === 'history' && <div className="panel-content">{!history.length && <p className="muted">该文档尚无本地版本。</p>}{history.map((entry) => <button className="history-item" key={entry.oid} onClick={() => void run(() => restoreVersion(entry))}><strong>{entry.subject}</strong><span>{new Date(entry.date).toLocaleString()}</span><code>{entry.oid.slice(0, 10)}</code><small>载入此版本 →</small></button>)}</div>}
        {panel === 'git' && <div className="panel-content">
          <div className="git-summary"><strong>{git?.repository ? '本地分支 · ' + (git.branch || '尚无分支') : '未启用版本记录'}</strong><span>{externallyManaged ? '由外部云盘客户端负责同步' : remoteSummary(git)}</span>{git?.repository && <small className="git-check-time">{git.checkedAt ? '最后检查：' + new Date(git.checkedAt).toLocaleString() : '尚未成功检查远端'}{checking && ' · 正在检查…'}</small>}</div>
          {externallyManaged && <p className="warning">请通过坚果云等客户端同步此文件夹。应用内检查、下载和上传均已停用；保存与本地版本仍可使用。</p>}
          {git?.remoteError && !externallyManaged && <p className="warning">远端检查未完成，本地内容仍可使用。<br />{git.remoteError}</p>}
          {git?.blocked && <p className="warning">{git.blocked}</p>}
          <label className="field">提交者姓名<input value={gitForm.name} onChange={(event) => setGitForm({ ...gitForm, name: event.target.value })} /></label>
          <label className="field">提交者邮箱<input value={gitForm.email} onChange={(event) => setGitForm({ ...gitForm, email: event.target.value })} /></label>
          {!git?.repository ? <><p className="muted">首次启用将为此文档库建立初始版本。请先检查目录内容。</p><button className="primary" disabled={busy} onClick={() => void run(() => gitAction(async () => { const choice = await ask('建立初始版本', '将记录当前文档库现有文件。请确认其中没有凭据、私钥或其他不应进入 Git 的文件。', ['建立初始版本', '取消']); if (choice === '建立初始版本') { await api.gitInit({ name: gitForm.name, email: gitForm.email }); setStatus('已建立本地初始版本') } }))}>启用 Git 并建立基线</button></> : <>
            <label className="field">GitHub 仓库 URL<input placeholder="https://github.com/owner/repo.git" value={gitForm.remote} onChange={(event) => setGitForm({ ...gitForm, remote: event.target.value })} /></label>
            <label className="field">远端分支<input value={gitForm.branch} onChange={(event) => setGitForm({ ...gitForm, branch: event.target.value })} /></label>
            <p className="muted">用于检查、更新与上传的远端分支。保存配置不会切换当前本地分支。</p>
            <button disabled={busy || navigating} onClick={() => void run(() => gitAction(() => api.gitConfigure(gitForm.remote, gitForm.branch, { name: gitForm.name, email: gitForm.email })))}>保存仓库配置</button>
            <p className="muted">认证使用 Git Credential Manager 或 SSH。请先在终端完成一次授权；账号密码不会写入应用设置。</p>
            <div className="git-network-actions">
              <button disabled={busy || navigating || checking || externallyManaged || !git.remote} onClick={() => void run(() => checkRemote())}><Icon name="refresh" />{checking ? '正在检查更新…' : '检查更新'}</button>
              <button disabled={busy || navigating || checking || externallyManaged || !git.remote || !['behind', 'diverged'].includes(git.remoteState)} onClick={() => void run(() => networkAction('update'))}><Icon name="arrowDown" />更新到本地</button>
              <button disabled={busy || navigating || checking || externallyManaged || !git.remote || git.remoteState !== 'ahead'} onClick={() => void run(() => networkAction('push'))}><Icon name="arrowUp" />上传更改</button>
              {git.remoteState === 'missing-branch' && <button disabled={busy || navigating || externallyManaged} onClick={() => void run(() => networkAction('publish'))}>发布远端分支…</button>}
            </div>
            <p className="muted">检查只获取远端状态，不改本地文件。更新前需保存此项目所有标签；上传只发送已记录的版本，未保存的编辑不会上传。</p>
            {['unchecked', 'unavailable'].includes(git.remoteState) && <p className="muted">先检查更新，再决定下载或上传。旧的远端引用不代表当前远端状态。</p>}
            {git.remoteState === 'missing-branch' && <p className="warning">配置的远端分支不存在。不会自动重建；确认需要时才发布本地分支。</p>}
            {git.remoteState === 'unrelated' && <p className="warning">远端与本地没有共同历史，不能直接合并。请核对仓库链接，或从该链接获取单独的副本。</p>}
            <small className="git-check-time">{git.lastSync ? '最后完成传输：' + new Date(git.lastSync).toLocaleString() : '尚未完成远端传输'}</small>
            <hr /><h3>记录指定变更</h3><p className="muted">重命名选择旧、新两条路径。附件可与当前文档一起提交。</p>
            <button onClick={() => void run(refreshGit)}>刷新变更</button><div className="change-list">{git.changes.map((item) => <label className="check" key={item}><input type="checkbox" checked={recordPaths.includes(item)} onChange={(event) => setRecordPaths(event.target.checked ? [...recordPaths, item] : recordPaths.filter((path) => path !== item))} /><span>{item}</span></label>)}</div>
            <input aria-label="版本说明" className="full" value={recordMessage} onChange={(event) => setRecordMessage(event.target.value)} />
            <button disabled={!recordPaths.length || busy} onClick={() => void run(() => gitAction(async () => { await persistDraft(); const result = await api.gitRecord(recordPaths, recordMessage); if (result.error) throw new Error(result.error); setRecordPaths([]); setStatus(result.committed ? '已记录指定变更 · 待同步' : '没有可记录的变更') }))}>记录所选文件</button>
            {doc && <><h3>下次保存关联附件</h3><div className="change-list">{allFiles.filter((entry) => !entry.directory && entry.path !== doc.file.path).map((entry) => <label className="check" key={entry.path}><input type="checkbox" checked={attachments.includes(entry.path)} onChange={(event) => setAttachments(event.target.checked ? [...attachments, entry.path] : attachments.filter((path) => path !== entry.path))} /><span>{entry.path}</span></label>)}</div></>}
            {(git.conflicts.length > 0 || git.blocked?.toLowerCase().includes('merge') || git.blocked?.includes('合并')) && <><hr /><h3>处理同步冲突</h3><p className="muted">每个文件选择完整的本地或远端版本；也可在外部工具中解决后完成合并。中止会恢复合并前状态。</p>{git.conflicts.map((path) => <div className="conflict-file" key={path}><code>{path}</code><div className="row"><button onClick={() => void run(() => gitAction(() => api.resolveConflict(path, 'ours'), true))}>保留本地</button><button onClick={() => void run(() => gitAction(() => api.resolveConflict(path, 'theirs'), true))}>使用远端</button></div></div>)}<button disabled={!!git.conflicts.length} onClick={() => void run(() => gitAction(() => api.finishMerge(), true))}>完成合并</button><button onClick={() => void run(() => gitAction(() => api.abortMerge(), true))}>中止合并</button></>}
          </>}
        </div>}
      </aside>}
    </div>
    {tabMenu && <div ref={tabMenuEl} className="context-menu tab-context-menu" role="menu" aria-label="标签操作" style={{ left: tabMenu.x, top: tabMenu.y }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setTabMenu(null) }} onKeyDown={event => {
      if (event.key === 'Tab') { if (tabMenuSource.current?.isConnected) tabMenuSource.current.focus({ preventScroll: true }); setTabMenu(null); return }
      navigateMenu(event)
    }}>
      <button role="menuitem" onClick={() => { setTabs(orderTabs(tabsRef.current.map(tab => tab.id === tabMenu.id ? { ...tab, pinned: !tab.pinned } : tab))); setTabMenu(null) }}><Icon name="pin" />{tabs.find(tab => tab.id === tabMenu.id)?.pinned ? '取消固定标签' : '固定标签'}</button>
      <button role="menuitem" onClick={() => void run(() => closeTab(tabMenu.id))}>关闭标签<kbd>{shortcut('W')}</kbd></button>
      <button role="menuitem" onClick={() => { const id = tabMenu.id; setTabMenu(null); void run(() => closeOtherTabs(id, false)) }}>关闭其他标签</button>
      <button role="menuitem" onClick={() => { const id = tabMenu.id; setTabMenu(null); void run(() => closeOtherTabs(id, true)) }}>关闭右侧标签</button>
      <hr /><button role="menuitem" disabled={!closedTabs.length} onClick={() => { setTabMenu(null); void run(reopenTab) }}><Icon name="reopen" />重新打开关闭的标签</button>
    </div>}
    {markMenu && <div className="context-menu mark-context-menu" data-navigation-document-key={doc?.editorKey} role="menu" aria-label="Mark 操作" ref={markMenuEl} style={{ left: markMenu.x, top: markMenu.y }} onKeyDown={event => {
      navigateMenu(event)
      if (event.key === 'Tab') setMarkMenu(null)
    }}>
      <button role="menuitem" disabled={!markMenuReady || markMenuIndex <= 0} onClick={() => void run(async () => runMarkCommand('move', markMenuIndex - 1))}>上移 Mark</button>
      <button role="menuitem" disabled={!markMenuReady || markMenuIndex >= blocks.length - 1} onClick={() => void run(async () => runMarkCommand('move', markMenuIndex + 1))}>下移 Mark</button>
      <button role="menuitem" disabled={!markMenuReady} onClick={() => void run(async () => runMarkCommand('copy', markMenuIndex + 1))}>复制 Mark</button>
    </div>}
    {contextMenu && <div className="context-menu" role="menu" aria-label="文件操作" ref={contextEl} style={{ left: contextMenu.x, top: contextMenu.y }} onKeyDown={event => {
      navigateMenu(event)
      if (event.key === 'Tab') setContextMenu(null)
    }}>
      <button role="menuitem" disabled={workspaceBusy || paperInLibrary && !!paperState.project?.origin} onClick={() => void run(() => mutate('move', contextMenu.path))}><Icon name="edit" />重命名</button>
      {archiveOwner(archives, contextMenu.path) ? <button role="menuitem" disabled={busy || navigating} onClick={() => void run(() => setArchived(contextMenu.path, true))}><Icon name="restore" />{archiveOwner(archives, contextMenu.path)?.path === contextMenu.path ? '恢复到工作树' : '恢复所在归档'}</button> : <button role="menuitem" disabled={busy || navigating} onClick={() => void run(() => setArchived(contextMenu.path, false))}><Icon name="archive" />归档</button>}
      <button className="danger" role="menuitem" disabled={workspaceBusy || paperInLibrary && !!paperState.project?.origin} onClick={() => void run(() => mutate('remove', contextMenu.path))}><Icon name="trash" />移到回收站</button>
    </div>}
    {projectMenu && <div className="context-menu project-context-menu" role="menu" aria-label="项目操作" ref={projectMenuEl} style={{ left: projectMenu.x, top: projectMenu.y }} onKeyDown={event => {
      navigateMenu(event)
      if (event.key === 'Tab') setProjectMenu(null)
    }}>
      <span className="project-menu-caption">{projectMenu.root}</span>
      <button role="menuitem" onClick={() => void run(() => relocateProject(projectMenu.root))}><Icon name="folderOpen" />重新定位项目…</button>
      {settings.projects.find(project => project.root === projectMenu.root)?.syncMode === 'external'
        ? <button role="menuitem" onClick={() => void run(() => setSyncMode(projectMenu.root, 'git'))}><Icon name="gitBranch" />使用应用内 Git 管理</button>
        : <button role="menuitem" onClick={() => void run(() => setSyncMode(projectMenu.root, 'external'))}><Icon name="external" />由外部云盘管理</button>}
      <hr /><button role="menuitem" onClick={() => void run(() => forgetProject(projectMenu.root))}><Icon name="close" />移除项目登记…</button>
    </div>}
    {navigating && <div className="navigation-shield"><span>正在处理项目与文档，请稍候…</span></div>}
    {projectDialog && <ProjectDialog onClose={() => setProjectDialog(false)} inspect={url => api.inspectProjectLink(url)} onLocal={() => addProject('local')} onCreate={name => addProject('create', name)} onClone={(remote, name) => addProject('clone', name, remote)} onReuse={async root => { await openProject(root); return libraryRootRef.current === root }} onRelocate={relocateProject} />}
    {compileSource && <CompileDialog current={compileSource.current} onClose={() => setCompileSource(null)} onLocateMark={locateCompilerMark} />}
    {question && <QuestionDialog key={question.id} title={question.title} detail={question.detail} initial={question.initial} buttons={question.buttons} onAnswer={answer => { const q = question; questionRef.current = null; setQuestion(null); q.resolve(answer) }} />}
  </div>
}
