import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react'
import BlockEditor, { type BlockEditorHandle } from './BlockEditor'
import Preview, { getHeadings } from './Preview'
import { Icon } from './Icons'
import { fileTabId, orderTabs, readTabSession, reorderTabs, sessionKey, type DocumentTab } from './tabs'
import { useOutline } from './useOutline'
import { archiveOwner, filterTree, moveDestination } from './treeModel'
import { shouldAutoCommit } from '../shared/changes'
import { countChanges } from './changeCounter'
import { initializeDocumentContent, isDocDirty, type DocumentContent } from './documentSession'
import { ensureMarkDocument, readMarkDocument, type MarkSelection, type MarkStylePatch } from '../shared/marks'
import { defaultSettings, type FontOption, type ArchiveEntry, type ContentMode, type DiskFile, type FileEntry, type GitStatus, type HistoryEntry, type Library, type Settings, type UntitledDraft } from '../shared/types'

type Doc = DocumentContent & { tabId?: string; root?: string; file: DiskFile; baseline: string; mode: ContentMode; untitledId?: string; editorKey?: string }
type DocInput = Omit<Doc, 'cleanContent'> & { cleanContent?: string }
type Question = { title: string; detail?: string; initial?: string; buttons: string[]; resolve: (answer: string | null) => void }
const api = window.oops
const isText = (path: string) => /\.(md|markdown|mdown|txt|tex)$/i.test(path)
const normalize = (s: string) => s.replace(/\r\n|\r/g, '\n')
const baselineText = (version: string | null, disk: string) => normalize(version === null ? disk : version.replace(/^\uFEFF/, ''))
const dirname = (s: string) => s.includes('/') ? s.slice(0, s.lastIndexOf('/')) : ''
const basename = (s: string) => s.split('/').at(-1) ?? s
const failure = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const draftTitle = (draft: Pick<UntitledDraft, 'content'>) => readMarkDocument(draft.content).body.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '').slice(0, 36) || '未命名'
function flatten(entries: FileEntry[]): FileEntry[] { return entries.flatMap((entry) => [entry, ...flatten(entry.children ?? [])]) }

export default function App() {
  const [library, setLibrary] = useState<Library | null>(null)
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
  const initialSession = useRef(readTabSession(localStorage.getItem(sessionKey)))
  const [tabs, renderTabs] = useState<DocumentTab[]>(initialSession.current.tabs)
  const tabsRef = useRef(tabs)
  const setTabs = (value: DocumentTab[] | ((items: DocumentTab[]) => DocumentTab[])) => { const next = typeof value === 'function' ? value(tabsRef.current) : value; tabsRef.current = next; renderTabs(next) }
  const buffers = useRef(new Map<string, Doc>())
  const tabPositions = useRef(new Map<string, { cursor: number; scroll: number; previewScroll: number }>())
  const tabConflicts = useRef(new Map<string, DiskFile>())
  const [activeTab, setActiveTab] = useState('')
  const [closedTabs, setClosedTabs] = useState<DocumentTab[]>(initialSession.current.closed)
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [fonts, setFonts] = useState<FontOption[]>([])
  const [formatMenu, setFormatMenu] = useState(false)
  const [markSelection, setMarkSelection] = useState<{ documentKey: string; mark: MarkSelection } | null>(null)
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
      const item: DocumentTab = { id: value.tabId, root: value.root, path: value.file.path, title: value.untitledId ? draftTitle(value) : basename(value.file.path), mode: value.mode, untitledId: value.untitledId, pinned: previous?.pinned ?? false, layout: previous?.layout ?? (value.mode === 'latex-math' ? 'split' : 'preview'), dirty: isDocDirty(value) }
      if (JSON.stringify(previous) !== JSON.stringify(item)) setTabs(orderTabs(previous ? tabsRef.current.map(tab => tab.id === item.id ? item : tab) : [...tabsRef.current, item]))
    } else setActiveTab('')
    docRef.current = value; renderDoc(value)
  }
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const settingsQueue = useRef<Promise<unknown>>(Promise.resolve())
  const settingsRef = useRef(settings); settingsRef.current = settings
  const [git, setGit] = useState<GitStatus | null>(null)
  const [treeMode, setTreeMode] = useState<'files' | 'folders'>('files')
  const [folder, setFolder] = useState('')
  const [selected, setSelected] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sidebar, setSidebar] = useState(true)
  const [panel, setPanel] = useState<'none' | 'settings' | 'git' | 'history'>('none')
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
  const [answer, setAnswer] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [split, setSplit] = useState(50)
  const [query, setQuery] = useState<string | null>(null)
  const [gitForm, setGitForm] = useState({ remote: '', branch: 'main', name: '', email: '' })
  const [recordPaths, setRecordPaths] = useState<string[]>([])
  const [attachments, setAttachments] = useState<string[]>([])
  const [recordMessage, setRecordMessage] = useState('记录文件与附件变更')
  const blockEditor = useRef<BlockEditorHandle>(null)
  const activeEditor = () => blockEditor.current
  const previewEl = useRef<HTMLElement>(null)
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
  const { blocks, content: outlineContent, error: outlineError } = useOutline(preview, doc?.editorKey ?? '', doc?.mode === 'markdown')
  useEffect(() => { if (outlineError) setNotice(outlineError) }, [outlineError])
  const headings = useMemo(() => getHeadings(preview), [preview])
  const documentFont = fonts.find(font => font.id === settings.fontFamily)?.family ?? 'system-ui, sans-serif'
  const activeMark = doc?.mode === 'markdown' && markSelection && markSelection.documentKey === doc.editorKey ? markSelection.mark : null
  const markMenuIndex = markMenu ? blocks.findIndex(mark => mark.id === markMenu.id) : -1
  const markMenuReady = !!markMenu && !busy && !navigating && markMenu.documentKey === doc?.editorKey && markMenu.content === doc?.content && outlineContent === doc?.content && markMenuIndex >= 0
  const toolbarFont = activeMark?.style.fontFamily ?? settings.fontFamily
  const toolbarSize = activeMark?.style.fontSize ?? settings.fontSize
  const toolbarSizes = [...new Set([...Array.from({ length: 17 }, (_, index) => index + 12), ...(doc?.mode === 'markdown' ? [10, 11, 32, 36, 40, 48, 56, 64, 72, 96] : []), toolbarSize])].sort((a, b) => a - b)
  const receiveMarkSelection = useCallback((mark: MarkSelection | null, documentKey: string) => {
    if (documentKey !== docRef.current?.editorKey) return
    setMarkSelection(previous => {
      if (!mark) return previous === null ? previous : null
      if (previous?.documentKey === documentKey && JSON.stringify(previous.mark) === JSON.stringify(mark)) return previous
      return { documentKey, mark }
    })
  }, [])
  const ask = (title: string, detail: string, buttons: string[], initial?: string): Promise<string | null> => new Promise((resolve) => {
    setAnswer(initial ?? ''); setQuestion({ title, detail, buttons, initial, resolve })
  })
  const run = async (operation: () => Promise<unknown>) => {
    try { await operation() } catch (error) { setNotice(failure(error)) }
  }
  async function refreshGit() {
    const value = await api.gitStatus(); setGit(value)
    setGitForm({ remote: value.remote, branch: value.branch || 'main', ...value.identity })
    return value
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
  async function save(automatic = false): Promise<boolean> {
    activeEditor()?.flush()
    const snapshot = docRef.current
    if (!snapshot || busyRef.current || composingRef.current) return false
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
        setStatus(result.version.committed ? '已记录本地版本 · 待同步' : '已保存 · 无新版本')
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
      if (choice === saveLabel && !(await save())) return false
      if (choice === '取消' || choice === null) return false
      if (choice === '保留草稿') await persistDraft(current)
    }
    await persistPosition()
    return true
  }
  async function navigate(operation: () => Promise<unknown>) {
    if (loadingRef.current || busyRef.current) { setNotice('正在保存或切换文档，请等待当前操作完成。'); return }
    activeEditor()?.flush()
    loadingRef.current = true; setNavigating(true)
    try { await persistDraft(); await persistPosition(); await operation() }
    finally { loadingRef.current = false; setNavigating(false) }
  }
  async function activateTab(id: string) {
    const tab = tabsRef.current.find(item => item.id === id)
    if (!tab) return
    if (docRef.current?.tabId === id) return
    if (tab.root && libraryRootRef.current !== tab.root) await adoptLibrary(await api.openProject(tab.root))
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
      await updateSettings({ layout: cached.mode === 'latex-math' ? (tab.layout === 'source' ? 'source' : 'split') : (tab.layout ?? 'preview') })
      setPreview(docRef.current?.content ?? '')
      setStatus(isDocDirty(docRef.current) ? '未保存 · 草稿已保护' : '已打开')
    } else if (tab.untitledId) {
      const draft = (await api.listUntitled()).find(item => item.id === tab.untitledId)
      startUntitled(draft ?? { id: tab.untitledId, content: '', mode: tab.mode, updatedAt: new Date().toISOString() })
    } else await readIntoEditor(tab.path, undefined, id)
  }
  async function switchTab(id: string) { if (docRef.current?.tabId === id) return; await navigate(() => activateTab(id)) }
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
      try { activeEditor()?.applyMarkStyle(patch) } catch (error) { setNotice(failure(error)) }
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
    activeEditor()?.markCommand({ type, id: target.id, index })
  }
  async function setMode(mode: ContentMode) {
    activeEditor()?.flush()
    const current = docRef.current
    if (!current) return
    const content = mode === 'markdown' && current.mode !== mode ? ensureMarkDocument(current.content) : current.content
    setDoc({ ...current, mode, content, cleanContent: isDocDirty(current) ? current.cleanContent : content })
    setPreview(docRef.current?.content ?? '')
    await updateSettings({ layout: mode === 'latex-math' ? 'split' : 'preview' })
  }
  async function loadDocument(relative: string, anchor?: string) {
    if (!isText(relative)) { await api.openAttachment(relative); return }
    if (!docRef.current?.untitledId && docRef.current?.file.path === relative) { if (anchor) jumpToAnchor(anchor); return }
    const existing = tabsRef.current.find(tab => !tab.untitledId && fileTabId(tab.root, tab.path) === fileTabId(libraryRootRef.current, relative))
    await navigate(async () => { if (existing) { await activateTab(existing.id); if (anchor) jumpToAnchor(anchor) } else await readIntoEditor(relative, anchor) })
  }
  async function readIntoEditor(relative: string, anchor?: string, tabId?: string) {
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
      const mode = tabsRef.current.find(tab => tab.id === tabId)?.mode ?? (/\.tex$/i.test(relative) ? 'latex-math' : 'markdown')
      setDoc({ tabId, root: libraryRootRef.current, file: opened.file, content, baseline: baselineText(opened.baseline, opened.file.content), mode })
      const layout = tabsRef.current.find(tab => tab.id === tabId)?.layout
      await updateSettings({ layout: mode === 'latex-math' ? (layout === 'source' ? 'source' : 'split') : (layout ?? 'preview') })
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
    libraryRootRef.current = next.root
    setStartup(false)
    setDoc(null); setExternal(null); setLibrary(next); setArchives(await api.listArchive()); setShowArchive(false); setContextMenu(null); setExpanded(new Set()); setFolder(''); setSelected(''); setAttachments([]); setPanel('none')
    const savedSettings = await api.settings(); settingsRef.current = savedSettings; setSettings(savedSettings)
    if (relative) await readIntoEditor(relative)
    else await refreshGit()
  }
  function startUntitled(draft?: UntitledDraft) {
    const id = draft?.id ?? crypto.randomUUID()
    const mode = draft?.mode ?? 'markdown'
    const content = draft?.content ?? ''
    setDoc({ file: { path: mode === 'latex-math' ? '未命名.tex' : '未命名.md', content: '', revision: '', eol: '\n', bom: false }, content, baseline: '', mode, untitledId: id, editorKey: `untitled:${id}` })
    setStartup(false); setExternal(null); setSelected(''); setAttachments([]); setPanel('none'); setPreview(docRef.current?.content ?? '')
    setAutoPaused(false); autoAttempt.current = ''; editedRef.current = false
    positionRef.current = { cursor: 0, scroll: 0 }; previewScrollRef.current = 0
    setStatus(draft ? '已恢复草稿' : '未保存到项目 · 首次保存时选择项目')
    const savedLayout = tabsRef.current.find(tab => tab.untitledId === id)?.layout
    const layout = mode === 'latex-math' ? (savedLayout === 'source' ? 'source' : 'split') : (savedLayout ?? 'preview')
    if (settingsRef.current.layout !== layout) void run(() => updateSettings({ layout }))
    requestAnimationFrame(() => activeEditor()?.focus())
  }
  async function newDocument() { await navigate(async () => startUntitled()) }
  async function openDraft(draft: UntitledDraft) {
    if (docRef.current?.untitledId === draft.id) return
    await navigate(async () => startUntitled((await api.listUntitled()).find((item) => item.id === draft.id) ?? draft))
  }
  async function openProject(root: string) {
    await navigate(async () => {
      const existing = tabsRef.current.find(tab => tab.root === root)
      if (existing) { await activateTab(existing.id); return }
      const next = await api.openProject(root)
      const recent = settingsRef.current.recent.find((item) => item.root === root && flatten(next.entries).some((file) => file.path === item.path && !file.directory))
      await adoptLibrary(next, recent?.path)
      if (!recent) setStatus('项目已打开')
    })
  }
  async function choose(kind: 'library' | 'file') {
    await navigate(async () => {
      if (kind === 'library') { const next = await api.chooseLibrary(); if (next) await adoptLibrary(next) }
      else { const next = await api.chooseFile(); if (next) await adoptLibrary(next.library, next.path) }
    })
  }
  function jumpToAnchor(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  async function newEntry(directory: boolean) {
    if (!directory) { await newDocument(); return }
    if (!library) { await choose('library'); return }
    const value = await ask(directory ? '新建文件夹' : '新建文档', '输入相对于文档库的路径。文件名可包含中文和空格。', ['创建', '取消'], `${folder ? folder + '/' : ''}${directory ? '新文件夹' : '未命名.md'}`)
    if (value === null) return
    setLibrary({ ...library, entries: await api.create(value, directory) })
    if (!directory) await loadDocument(value)
  }
  async function mutate(kind: 'move' | 'remove', target: string, destination?: string) {
    if (!target) return
    setContextMenu(null)
    await navigate(async () => {
      const original = docRef.current
      const affectsCurrent = original && !original.untitledId && (original.file.path === target || original.file.path.startsWith(target + '/'))
      if (kind === 'move') {
        const value = destination ?? await ask('重命名', '输入新的相对路径。拖动文件或文件夹也可以移动位置。', ['确定', '取消'], target)
        if (!value || value === target) return
        const result = await api.move(target, value)
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
        try { result = await api.remove(target) } catch (error) { await persistDraft(); throw error }
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
      await persistDraft()
      const owner = archiveOwner(archives, target)
      setArchives(restore ? await api.unarchive(owner?.path ?? target) : await api.archive(target))
      setStatus(restore ? '已恢复到工作树' : '已归档 · 文件保留原位置')
    } finally { busyRef.current = false; setBusy(false) }
  }
  function openContext(event: MouseEvent<HTMLElement>, node: FileEntry) {
    event.preventDefault(); event.stopPropagation()
    contextSource.current = event.currentTarget
    setSelected(node.path)
    setContextMenu({ path: node.path, directory: node.directory, x: Math.min(event.clientX || event.currentTarget.getBoundingClientRect().left, window.innerWidth - 220), y: Math.min(event.clientY || event.currentTarget.getBoundingClientRect().bottom, window.innerHeight - 190) })
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
  async function sync() {
    if (!library || busyRef.current || loadingRef.current) return
    busyRef.current = true; setBusy(true); setStatus('同步中…')
    try {
      await persistDraft()
      if (isDocDirty(docRef.current)) {
        setNotice('当前编辑已保护为恢复草稿。请先保存并记录版本，再执行同步。'); setStatus('未同步 · 请先保存编辑'); return
      }
      const result = await api.sync(); setGit(result)
      setStatus(result.conflicts.length ? '同步冲突 · 请在 Git 面板处理' : '最后同步成功：' + new Date(result.lastSync ?? Date.now()).toLocaleTimeString())
      if (result.conflicts.length) setPanel('git')
    } catch (error) { setStatus('同步失败'); setNotice(failure(error)); await refreshGit(); setPanel('git') }
    finally { busyRef.current = false; setBusy(false); await checkExternal() }
  }
  async function showHistory() {
    if (!docRef.current || docRef.current.untitledId) return
    setHistory(await api.history(docRef.current.file.path)); setPanel('history')
  }
  async function restoreVersion(entry: HistoryEntry) {
    await navigate(async () => {
    const current = docRef.current
    if (!current) return
    const confirmed = await ask('恢复版本到编辑器', `${entry.subject}\n${entry.date}\n当前编辑将先导出备份，再载入该版本；手动保存可记录为新版本。`, ['恢复', '取消'])
    if (confirmed !== '恢复') return
    if (isDocDirty(current) && !(await api.exportCopy(current.content))) return
    const raw = normalize((await api.version(current.file.path, entry.oid)).replace(/^\uFEFF/, ''))
    const content = current.mode === 'markdown' ? ensureMarkDocument(raw) : raw
    setDoc({ ...current, content }); setPreview(docRef.current?.content ?? ''); editedRef.current = false; await persistDraft(); setPanel('none'); setStatus('已载入历史版本 · 尚未保存')
    })
  }
  async function gitAction(operation: () => Promise<unknown>, refreshDisk = false) {
    await navigate(async () => {
      if (refreshDisk && isDocDirty(docRef.current)) throw new Error('请先保存当前编辑，再切换分支或处理合并。')
      await operation()
      await refreshGit(); await refreshTree()
      const current = docRef.current
      if (!current || current.untitledId) return
      try {
        const opened = await api.read(current.file.path)
        setDoc((latest) => latest?.file.path === current.file.path ? {
          ...latest, baseline: baselineText(opened.baseline, opened.file.content),
          ...(refreshDisk && opened.file.revision !== latest.file.revision ? { file: opened.file, content: normalize(opened.file.content), cleanContent: undefined } : {}),
        } : latest)
        setPreview(docRef.current?.content ?? '')
      } catch (error) { if (refreshDisk) { setDoc(null); setNotice('分支中没有当前文档，请从文件树重新选择。') } else throw error }
    })
  }

  useEffect(() => {
    let cancelled = false
    if (api) void run(async () => {
      try {
        const [savedSettings, drafts] = await Promise.all([api.settings(), api.listUntitled()])
        if (cancelled) return
        settingsRef.current = savedSettings; setSettings(savedSettings); setUntitled(drafts)
        const restored = initialSession.current.tabs.filter(tab => tab.untitledId || savedSettings.projects.some(project => project.root === tab.root))
        for (const draft of drafts) if (!restored.some(tab => tab.untitledId === draft.id) && !initialSession.current.closed.some(tab => tab.untitledId === draft.id)) restored.push({ id: 'untitled:' + draft.id, root: '', path: draft.mode === 'latex-math' ? '未命名.tex' : '未命名.md', title: draftTitle(draft), mode: draft.mode, untitledId: draft.id, pinned: false, dirty: !!draft.content })
        setTabs(restored)
        if (restored.length) { try { await activateTab(restored.find(tab => tab.id === initialSession.current.active)?.id ?? restored[0].id) } catch (error) { setNotice('部分标签未能恢复：' + failure(error)); startUntitled(drafts[0]) } }
        else if (savedSettings.projects.length) { setStartup(true); setStatus('选择项目，或开始新文档') }
        else startUntitled(drafts[0])
      } finally { if (!cancelled) setInitializing(false) }
    })
    return () => { cancelled = true }
  }, [])
  useEffect(() => { let cancelled = false; if (api) void api.fonts().then(options => { if (!cancelled) setFonts(options) }).catch(error => { if (!cancelled) setNotice(failure(error)) }); return () => { cancelled = true } }, [])
  useEffect(() => { const keep = new Set([...tabs, ...closedTabs].map(tab => tab.id)); for (const id of buffers.current.keys()) if (!keep.has(id)) { buffers.current.delete(id); tabPositions.current.delete(id); tabConflicts.current.delete(id) } }, [tabs, closedTabs])
  useEffect(() => { const reveal = () => document.querySelector('[role=tab][aria-selected=true]')?.closest('.document-tab')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); reveal(); window.addEventListener('resize', reveal); return () => window.removeEventListener('resize', reveal) }, [activeTab])
  useEffect(() => { if (!initializing) { const timer = setTimeout(() => localStorage.setItem(sessionKey, JSON.stringify({ tabs, active: activeTab, closed: closedTabs })), 150); return () => clearTimeout(timer) } }, [tabs, activeTab, closedTabs, initializing])
  useEffect(() => { if (doc?.tabId) { if (external) tabConflicts.current.set(doc.tabId, external); else tabConflicts.current.delete(doc.tabId) } }, [external, doc?.tabId])
  useEffect(() => { document.documentElement.dataset.theme = settings.theme }, [settings.theme])
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
    if (!doc || doc.untitledId || !editedRef.current || autoPaused || busy || navigating || !git?.repository || git.blocked || external || question || counted?.baseline !== doc.baseline || counted.content !== doc.content) return
    const actualCount = counted.count
    const attempt = JSON.stringify([doc.file.path, doc.content, doc.baseline, settings.threshold])
    if (shouldAutoCommit(actualCount, settings.threshold, composing, settings.autoCommit) && autoAttempt.current !== attempt) {
      const timer = setTimeout(() => { autoAttempt.current = attempt; void save(true) }, 300)
      return () => clearTimeout(timer)
    }
  }, [doc?.content, doc?.baseline, counted, composing, busy, navigating, autoPaused, settings.threshold, settings.autoCommit, git?.repository, git?.blocked, external, question])
  useEffect(() => {
    if (!api) return
    return api.onFilesChanged(() => { void run(checkExternal) })
  })
  useEffect(() => {
    if (!api) return
    return api.onAction((action) => { void run(async () => {
      if (action === 'save') await save()
      if (action === 'open-library') await choose('library')
      if (action === 'open-file') await choose('file')
      if (action === 'new-file') await newEntry(false)
      if (action === 'sync') await sync()
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
    return api.onCloseRequest(() => { void run(() => navigate(async () => { if (await guardSwitch(true)) { await persistDraft(); localStorage.setItem(sessionKey, JSON.stringify({ tabs: tabsRef.current, active: docRef.current?.tabId ?? '', closed: closedTabs })); api.closeReady() } })) })
  })

  useEffect(() => {
    if (!contextMenu) return
    const frame = requestAnimationFrame(() => contextEl.current?.querySelector<HTMLButtonElement>('button')?.focus())
    const close = (event: Event) => { if (!contextEl.current?.contains(event.target as Node)) setContextMenu(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setContextMenu(null); contextSource.current?.focus() } }
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', escape)
    window.addEventListener('resize', close)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape); window.removeEventListener('resize', close) }
  }, [contextMenu])
  useEffect(() => { setMarkMenu(null) }, [doc?.editorKey, doc?.mode])
  useEffect(() => {
    if (!markMenu) return
    const frame = requestAnimationFrame(() => markMenuEl.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus())
    const close = (event: Event) => { if (!markMenuEl.current?.contains(event.target as Node)) setMarkMenu(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMarkMenu(null); markMenuSource.current?.focus() } }
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', escape); window.addEventListener('resize', close)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape); window.removeEventListener('resize', close) }
  }, [markMenu])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.altKey && !event.isComposing) {
        const key = event.key.toLowerCase()
        const handled = ['t', 'n', 'w', 'tab', 'f'].includes(key)
        if (handled) {
          event.preventDefault(); event.stopPropagation()
          if (question || initializing) return
          if (key === 'f') openSearch()
          else if (key === 't' && event.shiftKey) void run(reopenTab)
          else if (key === 't' || key === 'n') void run(newDocument)
          else if (key === 'w' && docRef.current?.tabId) void run(() => closeTab(docRef.current!.tabId!))
          else if (key === 'tab') { const list = tabsRef.current, at = list.findIndex(tab => tab.id === docRef.current?.tabId); if (list.length) void run(() => switchTab(list[(at + (event.shiftKey ? list.length - 1 : 1)) % list.length].id)) }
          return
        }
      }
      if (event.ctrlKey && /^[1-9]$/.test(event.key)) { event.preventDefault(); if (question || initializing) return; const tab = event.key === '9' ? tabsRef.current.at(-1) : tabsRef.current[Number(event.key) - 1]; if (tab) void run(() => switchTab(tab.id)) }
      if (event.key === 'Escape') { setTabMenu(null); setFormatMenu(false) }
    }
    const outside = (event: PointerEvent) => { const target = event.target as HTMLElement; if (!target.closest('.tab-context-menu')) setTabMenu(null); if (!target.closest('.format-overflow')) setFormatMenu(false) }
    window.addEventListener('keydown', keydown, true); window.addEventListener('pointerdown', outside)
    return () => { window.removeEventListener('keydown', keydown, true); window.removeEventListener('pointerdown', outside) }
  })
  function blockNodes(depth = 0) {
    return <div className="block-tree" aria-label="文档 Mark" style={{ "--mark-rail": `${20 + depth * 16}px` } as CSSProperties}>{blocks.map((block, index) => <button disabled={busy || navigating || outlineContent !== doc?.content} key={block.id} data-mark-id={block.id} data-kind={block.type} title={block.label || '空白 Mark'} aria-label={'跳转 Mark ' + (index + 1) + ' ' + (block.label || '空白 Mark')} aria-current={activeMark?.from === block.from ? 'true' : undefined} style={{ paddingLeft: 28 + depth * 16 }} onClick={() => blockEditor.current?.jump(block.from)} onContextMenu={event => { event.preventDefault(); openMarkMenu(event.currentTarget, block.id, event.clientX || undefined, event.clientY || undefined) }} onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); openMarkMenu(event.currentTarget, block.id) } }}><span className="block-kind">{block.type === 'heading' ? 'H' + block.level : block.type === 'code' ? '</>' : block.type === 'math' ? '∑' : block.type === 'list' ? '≡' : '·'}</span><span>{block.label || '空白 Mark'}</span></button>)}</div>
  }
  function treeNodes(nodes: FileEntry[], depth = 0, inArchive = false) {
    return nodes.filter(node => inArchive || treeMode === 'files' || node.directory).map(node => {
      const current = !doc?.untitledId && doc?.file.path === node.path
      return <div className="tree-node" key={node.path}>
        <div className="tree-node-row"><button disabled={busy || navigating} className={'tree-item ' + (selected === node.path ? 'selected ' : '') + (dropTarget === node.path ? 'drop-target' : '')} style={{ paddingLeft: 12 + depth * 16 }}
          draggable={!busy && !navigating} onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData('application/x-oopsmd-path', JSON.stringify({ root: libraryRootRef.current, path: node.path })); event.dataTransfer.effectAllowed = 'move'; setContextMenu(null) }} onDragEnd={() => setDropTarget(null)}
          onDragOver={event => { if (node.directory) dragOver(event, node.path) }} onDragLeave={() => setDropTarget(null)} onDrop={event => { if (node.directory) dropInto(event, node.path) }}
          onContextMenu={event => openContext(event, node)} title={node.path} aria-label={node.name}
          onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); contextSource.current = event.currentTarget; setSelected(node.path); setContextMenu({ path: node.path, directory: node.directory, x: bounds.left + 24, y: Math.min(bounds.bottom, window.innerHeight - 190) }) } }}
          onClick={() => { setSelected(node.path); if (node.directory) { setFolder(node.path); setExpanded(old => { const next = new Set(old); next.has(node.path) ? next.delete(node.path) : next.add(node.path); return next }) } else void run(() => loadDocument(node.path)) }}>
          <Icon name={node.directory ? (expanded.has(node.path) ? 'chevronDown' : 'chevronRight') : node.name.endsWith('.tex') ? 'math' : 'file'} />{node.directory && <Icon name={expanded.has(node.path) ? 'folderOpen' : 'folder'} />}<span>{node.name}</span>
        </button></div>
        {node.directory && expanded.has(node.path) && treeNodes(node.children ?? [], depth + 1, inArchive)}
        {current && treeMode === 'files' && doc.mode === 'markdown' && blockNodes(depth)}
      </div>
    })
  }
  function followLink(path: string, anchor?: string) {
    void run(async () => {
      if (doc?.untitledId) {
        if (path === doc.file.path && anchor) jumpToAnchor(anchor)
        else setNotice('先将文档保存到项目，再打开相对链接。')
      } else await loadDocument(path, anchor)
    })
  }
  const editorProps = doc ? {
    readOnly: navigating, documentKey: doc.editorKey ?? library?.root + '/' + doc.file.path, value: doc.content, mode: doc.mode, theme: settings.theme,
    fontSize: settings.fontSize, fontFamily: documentFont, lineHeight: settings.lineHeight,
    initialPosition: tabPositions.current.get(doc.tabId!) ?? (doc.untitledId ? undefined : settings.positions[library?.root + '/' + doc.file.path]),
    onChange: (content: string) => { editedRef.current = true; setDoc(current => current ? { ...current, content } : null); setStatus(docRef.current?.untitledId ? '草稿自动保留在本机' : '未保存') },
    onComposition: (active: boolean) => { composingRef.current = active; setComposing(active) }, onSave: () => void save(),
    onPosition: (position: { cursor: number; scroll: number }) => { positionRef.current = position },
    onMarkSelection: receiveMarkSelection,
    onError: (message: string) => setNotice(message),
  } : null
  const formatItems = [{ command: 'bold', label: '加粗', icon: 'bold' }, { command: 'underline', label: '下划线', icon: 'underline' }, { command: 'strike', label: '删除线', icon: 'strikethrough' }, { command: 'italic', label: '斜体', icon: 'italic' }, { command: 'superscript', label: '上标', icon: 'superscript' }, { command: 'subscript', label: '下标', icon: 'subscript' }, { command: 'highlight', label: '荧光笔', icon: 'highlight' }] as const
  const formatButtons = () => formatItems.map(item => <button key={item.command} title={item.label} aria-label={item.label} disabled={doc?.mode === 'latex-math'} onMouseDown={event => event.preventDefault()} onClick={() => { activeEditor()?.format(item.command); setFormatMenu(false) }}><Icon name={item.icon} /></button>)
  const lastProject = settings.projects.find((project) => project.root === settings.lastProject) ?? settings.projects[0]

  if (!api) return <div className="browser-notice"><h1>OopsMD</h1><p>文件与 Git 功能需要桌面主进程。</p><p>请在项目目录运行 <code>npm run dev</code> 打开 Electron 窗口。</p></div>
  return <div className="app" data-mode={doc?.mode ?? 'markdown'} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
    event.preventDefault(); const file = event.dataTransfer.files[0]
    if (file) void run(() => navigate(async () => { const result = await api.openDropped(file); if (result) await adoptLibrary(result.library, result.path) }))
  }}>
    <header className="window-drag">
      {sidebar && <div className="window-sidebar-space" />}
      <div className="tab-strip" style={{ '--pinned-count': tabs.filter(tab => tab.pinned).length } as CSSProperties} role="tablist" aria-label="文档标签">
        {tabs.map((tab, index) => <div key={tab.id} style={{ '--pinned-index': index } as CSSProperties} className={`document-tab ${activeTab === tab.id ? 'active' : ''} ${tab.pinned ? 'tab-pinned' : ''}`} draggable={!busy && !navigating} onDragStart={event => { event.dataTransfer.setData('application/x-oopsmd-tab', tab.id); event.dataTransfer.effectAllowed = 'move' }} onDragOver={event => { if (event.dataTransfer.types.includes('application/x-oopsmd-tab')) { event.preventDefault(); event.stopPropagation() } }} onDrop={event => { const id = event.dataTransfer.getData('application/x-oopsmd-tab'); if (id) { event.preventDefault(); event.stopPropagation(); setTabs(reorderTabs(tabsRef.current, id, tab.id)) } }} onAuxClick={event => { if (event.button === 1) { event.preventDefault(); void run(() => closeTab(tab.id)) } }} onContextMenu={event => { event.preventDefault(); setTabMenu({ id: tab.id, x: Math.min(event.clientX, window.innerWidth - 225), y: event.clientY }) }}>
          <button className="tab-select" role="tab" tabIndex={activeTab === tab.id ? 0 : -1} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const at = tabs.findIndex(item => item.id === tab.id); const next = tabs[(at + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; void run(() => switchTab(next.id)) } }} aria-selected={activeTab === tab.id} aria-label={tab.title} title={tab.untitledId ? tab.title + ' · 草稿' : tab.root + '/' + tab.path} onClick={() => void run(() => switchTab(tab.id))}><Icon name={tab.pinned ? 'pin' : tab.mode === 'latex-math' ? 'math' : 'file'} /><span className="tab-title">{tab.title}</span>{tab.dirty && <span className="tab-dirty" title="未保存" />}</button>
          {!tab.pinned && <button className="tab-close" aria-label={`关闭标签 ${tab.title}`} title="关闭 Ctrl W" onClick={() => void run(() => closeTab(tab.id))}><Icon name="close" /></button>}
        </div>)}
      </div><button className="tab-new icon-button" aria-label="新建标签" title="新建文档 Ctrl T" disabled={initializing || busy} onClick={() => void run(newDocument)}><Icon name="plus" /></button>
    </header>
    <div className="workspace">
      {sidebar && <aside className="sidebar">
        <div className="sidebar-heading"><span>项目</span><button className="icon-button" title="打开文件夹作为项目" aria-label="打开项目" disabled={initializing || busy} onClick={() => void run(() => choose('library'))}><Icon name="plus" /></button></div>
        <div className="project-list">{settings.projects.map((project) => <button key={project.root} className={`project-item ${library?.root === project.root ? 'active' : ''}`} title={project.root} aria-label={`打开项目 ${basename(project.root.replaceAll('\\', '/'))}`} disabled={busy} onClick={() => void run(() => openProject(project.root))}><Icon name={library?.root === project.root ? 'folderOpen' : 'folder'} /><span className="project-name">{basename(project.root.replaceAll('\\', '/'))}</span>{library?.root === project.root && <span className="project-current" />}</button>)}
          {!settings.projects.length && <button className="project-item muted" onClick={() => void run(() => choose('library'))}><Icon name="folderPlus" /><span>添加文件夹</span></button>}</div>
        {library ? <div className="project-files"><div className="sidebar-heading"><span>项目文件</span><button className="icon-button" title="新建文件夹" aria-label="新建文件夹" onClick={() => void run(() => newEntry(true))}><Icon name="folderPlus" /></button></div>
          <div className="segmented tree-switch" aria-label="目录显示方式"><button aria-pressed={treeMode === 'files'} className={treeMode === 'files' ? 'active' : ''} onClick={() => setTreeMode('files')}>文件树</button><button aria-pressed={treeMode === 'folders'} className={treeMode === 'folders' ? 'active' : ''} onClick={() => setTreeMode('folders')}>文件夹树</button></div>
          <button aria-label="项目根目录" title={library.root} onDragOver={event => dragOver(event, '')} onDragLeave={() => setDropTarget(null)} onDrop={event => dropInto(event, '')} className={`tree-item root-folder ${selected === '' ? 'selected' : ''} ${dropTarget === '' ? 'drop-target' : ''}`} onClick={() => { setFolder(''); setSelected('') }}><Icon name="folderOpen" /><span>根目录</span></button>
          <div className={`tree-scroll ${treeMode === 'folders' ? 'folder-hierarchy' : ''}`}>{treeNodes(entries)}{!entries.length && <p className="muted inset">此目录还没有文件</p>}</div>
          {treeMode === 'folders' && <div className="folder-list"><div className="section-label">{folder || '根目录'} · {allFiles.filter(file => !file.directory && dirname(file.path) === folder).length} 个文件</div>{treeNodes(allFiles.filter(file => !file.directory && dirname(file.path) === folder), 0, true)}</div>}
          <div className="archive-section"><button className="archive-toggle" aria-expanded={showArchive} onClick={() => setShowArchive(!showArchive)}><Icon name="archive" /><span>归档</span><Icon name={showArchive ? 'chevronDown' : 'chevronRight'} /></button>{showArchive && <div className="archive-tree" aria-label="归档树">{treeNodes(archivedEntries, 0, true)}{!archivedEntries.length && <p className="muted inset">归档的资料会保留在这里</p>}</div>}</div></div>
          : <div className="project-files empty-project-hint"><p>首次保存时，选择一个文件夹作为项目。</p></div>}
        {doc && (doc.untitledId || treeMode === 'folders') && <div className="document-blocks"><div className="section-label">当前文档 · Mark 大纲</div>{blockNodes()}</div>}
        <div className="sidebar-footer"><button aria-pressed={panel === 'settings'} onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}><Icon name="settings" />设置</button><button disabled={!library} aria-pressed={panel === 'git'} onClick={() => void run(async () => { await refreshGit(); setPanel(panel === 'git' ? 'none' : 'git') })}><Icon name="gitBranch" />Git 与同步</button></div>
      </aside>}
      <main className="main">
        <div className="document-bar"><button className="icon-button" title="收起 / 展开侧栏" aria-label="收起 / 展开侧栏" onClick={() => setSidebar(!sidebar)}><Icon name="sidebar" /></button><span className="document-project title-path" title={library?.root}>{library ? basename(library.root.replaceAll('\\', '/')) : '本地工作区'}</span><span className="breadcrumb-separator">/</span><span className="document-name">{doc ? basename(doc.file.path) : '项目'}</span>{dirty && <span className="unsaved-dot" title="未保存" />}{doc?.untitledId && <span className="document-state">草稿</span>}{doc && !doc.untitledId && archiveOwner(archives, doc.file.path) && <span className="document-state">已归档</span>}<span className="document-spacer" />
          <button className="icon-button" title="打开文件" aria-label="打开文件" onClick={() => void run(() => choose('file'))}><Icon name="folderOpen" /></button>
          <button className="icon-button" title={settings.theme === 'light' ? '切换深色' : '切换浅色'} aria-label="切换主题" onClick={() => void run(() => updateSettings({ theme: settings.theme === 'light' ? 'dark' : 'light' }))}><Icon name={settings.theme === 'light' ? 'moon' : 'sun'} /></button>
          {doc && <><button className="icon-button" title="版本历史" aria-label="版本历史" disabled={busy || !!doc.untitledId} onClick={() => void run(showHistory)}><Icon name="history" /></button><button className="primary" disabled={busy} onClick={() => void save()}><Icon name="save" />保存 <kbd>Ctrl S</kbd></button></>}
        </div>
        {notice && <div className="notice" role="alert"><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}>×</button></div>}
        {external && <div className="conflict"><strong>检测到外部修改</strong><span>你的编辑和磁盘内容均已保留。</span><button onClick={() => void run(() => api.exportCopy(external.content))}>导出磁盘副本</button><button onClick={() => void run(async () => { if (!(await api.exportCopy(docRef.current!.content))) return; setDoc((current) => current ? { ...current, file: external, content: normalize(external.content), cleanContent: undefined } : null); setPreview(docRef.current?.content ?? ''); setExternal(null); await persistDraft() })}>备份编辑并载入磁盘</button><button onClick={() => void run(async () => { if (!(await api.exportCopy(external.content))) return; setDoc((current) => current ? { ...current, file: external, cleanContent: normalize(external.content) } : null); setExternal(null); await persistDraft(); setNotice('磁盘副本已导出。当前编辑尚未写盘，请手动保存。') })}>备份磁盘并保留编辑</button></div>}
        {!doc ? <section className="startup">
          {initializing ? <p className="muted">正在打开工作区…</p> : <>
            <div className="startup-heading"><h1>{startup ? '继续你的工作' : '项目已打开'}</h1><p>{startup ? '回到上次的项目，或从一份新文档开始。' : '从左侧选择文件，或创建一份新文档。'}</p></div>
            {startup && lastProject && <button className="project-card" aria-label="继续上次项目" onClick={() => void run(() => openProject(lastProject.root))}><Icon name="folderOpen" size={24} /><span><strong>{basename(lastProject.root.replaceAll('\\', '/'))}</strong><small>{lastProject.root}</small></span><Icon name="arrowRight" /></button>}
            <div className="startup-actions"><button className="primary" onClick={() => void run(newDocument)}><Icon name="filePlus" />新建文档</button><button onClick={() => void run(() => choose('library'))}><Icon name="folderOpen" />打开其他项目</button></div>
            {startup && untitled.length > 0 && <button className="resume-draft" onClick={() => void run(() => openDraft(untitled[0]))}><Icon name="clock" />继续未保存文档<span>{draftTitle(untitled[0])}</span><Icon name="arrowRight" /></button>}
          </>}
        </section>
          : <><div className="editor-toolbar"><div className="mode-capsule" aria-label="内容模式"><button title="Markdown" aria-label="Markdown" aria-pressed={doc.mode === 'markdown'} className={doc.mode === 'markdown' ? 'active' : ''} onClick={() => void run(() => setMode('markdown'))}>MD</button><button title="LaTeX 数学片段" aria-label="Geek" aria-pressed={doc.mode === 'latex-math'} className={doc.mode === 'latex-math' ? 'active' : ''} onClick={() => void run(() => setMode('latex-math'))}><Icon name="math" />Geek</button></div>
            <div className="font-control" title={doc.mode === 'markdown' ? `当前 Mark：${activeMark?.label || '请选择正文'}` : 'Geek 默认排版'}>
              {doc.mode === 'markdown' && <span className="font-scope">Mark</span>}
              <select className="font-family-select" aria-label={doc.mode === 'markdown' ? 'Mark 字体' : '字体'} disabled={navigating || (doc.mode === 'markdown' && !activeMark)} value={toolbarFont} onChange={event => applyTypography({ fontFamily: event.target.value as Settings['fontFamily'] })}>{fonts.map(font => <option key={font.id} value={font.id} disabled={!font.available}>{font.name}{!font.available ? ' · 未安装' : ''}</option>)}</select>
              <select className="font-size-select" aria-label={doc.mode === 'markdown' ? 'Mark 字号' : '字号'} disabled={navigating || (doc.mode === 'markdown' && !activeMark)} value={toolbarSize} onChange={event => applyTypography({ fontSize: +event.target.value })}>{toolbarSizes.map(size => <option key={size} value={size}>{size}</option>)}</select>
              {doc.mode === 'markdown' && <button className="icon-button mark-style-reset" aria-label="恢复 Mark 默认样式" title="恢复默认字体和字号" disabled={navigating || !activeMark?.explicit} onMouseDown={event => event.preventDefault()} onClick={() => applyTypography(null)}><Icon name="reopen" /></button>}
            </div>
            <div className="format-tools" aria-label="文字格式">{formatButtons()}</div><div className="format-overflow"><button className="icon-button" aria-label="更多排版" title="更多排版" aria-expanded={formatMenu} onMouseDown={event => event.preventDefault()} onClick={() => setFormatMenu(!formatMenu)}><Icon name="more" /></button>{formatMenu && <div className="format-menu" aria-label="文字格式">{formatButtons()}</div>}</div>
            <div className={`toolbar-search ${query !== null ? 'search-open' : ''}`}><button className="icon-button" aria-label="查找" title="查找 Ctrl F" onClick={openSearch}><Icon name="search" /></button><input ref={searchInput} aria-label="页内查找" placeholder="搜索" value={query ?? ''} onFocus={() => setQuery(previous => previous ?? '')} onChange={event => { setQuery(event.target.value); search(event.target.value) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); search(query ?? '', event.shiftKey ? -1 : 1) } if (event.key === 'Escape') { setQuery(null); search(''); activeEditor()?.focus() } }} /><kbd>Ctrl F</kbd></div>
            <div className="segmented layout-switch" aria-label="显示布局">{(doc.mode === 'latex-math' ? ['split', 'source'] as const : ['preview', 'source', 'split'] as const).map(layout => <button key={layout} aria-label={({ source: '源码', preview: '实时预览', split: '对照' })[layout]} title={({ source: '查看 Markdown 源码', preview: '实时排版与编辑', split: '源码与预览对照' })[layout]} aria-pressed={settings.layout === layout} className={settings.layout === layout ? 'active' : ''} onClick={() => void run(() => updateSettings({ layout }))}><Icon name={layout} />{({ source: '源码', preview: '实时预览', split: '对照' })[layout]}</button>)}</div></div>
            {query !== null && query.length > 0 && <div className="find-bar"><span>{searchResult.count ? searchResult.index + ' / ' + searchResult.count : '没有匹配'}</span><button aria-label="上一个匹配" onClick={() => search(query, -1)}>上一个</button><button aria-label="下一个匹配" onClick={() => search(query)}>下一个</button><button aria-label="关闭查找" onClick={() => { setQuery(null); search('') }}>关闭</button></div>}
            <div className={`editor-area layout-${settings.layout} ${doc.mode === 'latex-math' && settings.layout === 'preview' ? 'math-live' : ''}`} style={{ '--document-font': documentFont, '--split': `${split}%`, '--font-size': `${settings.fontSize}px`, '--line-height': settings.lineHeight, '--line-width': `${settings.lineWidth}px` } as CSSProperties}>
              <section className={settings.layout === 'preview' && doc.mode === 'markdown' ? 'live-pane' : 'source-pane'} aria-label={settings.layout === 'preview' && doc.mode === 'markdown' ? '实时编辑器' : '源码编辑器'}><BlockEditor ref={blockEditor} {...editorProps!} live={settings.layout === 'preview'} path={doc.file.path} localFiles={!doc.untitledId} onNavigate={followLink} onExternal={url => void run(() => api.openExternal(url))} /></section>
              {settings.layout === 'split' && <div className="splitter" role="separator" aria-label="调整分屏比例" aria-orientation="vertical" aria-valuenow={split} tabIndex={0} onKeyDown={(event) => { if (event.key === 'ArrowLeft') setSplit(Math.max(20, split - 2)); if (event.key === 'ArrowRight') setSplit(Math.min(80, split + 2)) }} onPointerDown={(event) => { const target = event.currentTarget; const bounds = target.parentElement!.getBoundingClientRect(); target.setPointerCapture(event.pointerId); const move = (e: PointerEvent) => setSplit(Math.max(20, Math.min(80, (e.clientX - bounds.left) / bounds.width * 100))); const end = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', end) }; target.addEventListener('pointermove', move); target.addEventListener('pointerup', end) }} />}
              {settings.layout === 'split' && <section className="preview-pane" aria-label="文档预览" ref={previewEl} onScroll={event => { previewScrollRef.current = event.currentTarget.scrollTop }}>{!preview ? <div className="empty-preview"><Icon name="preview" size={24} /><span>实时预览</span><p>写下内容，排版会出现在这里。</p></div> : <Preview content={preview} mode={doc.mode} path={doc.file.path} localFiles={!doc.untitledId} onNavigate={followLink} onExternal={url => void run(() => api.openExternal(url))} />}</section>}
            </div>
            {settings.layout !== 'preview' && doc.mode === 'markdown' && headings.length > 0 && <div className="outline-inline"><span>大纲</span><select disabled={preview !== doc.content} aria-label="跳转标题" value="" onChange={(event) => { const heading = headings.find((item) => item.id === event.target.value); if (heading) { activeEditor()?.jumpTo(heading.line); jumpToAnchor(heading.id) } }}><option value="">选择标题…</option>{headings.map((heading) => <option key={heading.id} value={heading.id}>{'　'.repeat(heading.level - 1)}{heading.text}</option>)}</select><button onClick={() => void run(() => api.exportCopy(doc.content))}>导出副本</button></div>}
          </>}
        <footer className="statusbar"><span className={`status-light ${busy ? 'working' : dirty ? 'dirty' : ''}`} /><span>{status}</span><span className="status-spacer" /><span>{doc ? `净修改 ${count} / ${settings.threshold}` : 'UTF-8'}</span><button disabled={!library || busy} onClick={() => void run(sync)}>{git?.repository ? `↑ ${git.ahead} ↓ ${git.behind}　同步` : '未启用 Git'}</button></footer>
      </main>
      {panel !== 'none' && <aside className="panel"><div className="panel-heading"><h2>{{ settings: '阅读与保存', git: 'Git 与同步', history: '文档版本' }[panel]}</h2><button aria-label="关闭面板" onClick={() => setPanel('none')}>×</button></div>
        {panel === 'settings' && <div className="panel-content">
          <label className="field">主题<select value={settings.theme} onChange={(event) => void run(() => updateSettings({ theme: event.target.value as Settings['theme'] }))}><option value="light">浅色</option><option value="dark">深色</option></select></label>
          <label className="field">默认字体<select aria-label="默认字体" value={settings.fontFamily} onChange={event => void run(() => updateSettings({ fontFamily: event.target.value as Settings['fontFamily'] }))}>{fonts.map(font => <option key={font.id} value={font.id} disabled={!font.available}>{font.name}{!font.available ? ' · 未安装' : ''}</option>)}</select></label>
          <label className="field">默认字号 · {settings.fontSize}px<input aria-label="默认字号" type="range" min="12" max="28" value={settings.fontSize} onChange={(event) => void run(() => updateSettings({ fontSize: +event.target.value }))} /></label>
          <p className="muted">默认字体和字号用于未单独排版的 Mark 与 Geek。工具栏中的 Mark 排版只修改当前 Mark。</p>
          <label className="field">行距 · {settings.lineHeight}<input type="range" min="1.2" max="2.5" step="0.1" value={settings.lineHeight} onChange={(event) => void run(() => updateSettings({ lineHeight: +event.target.value }))} /></label>
          <label className="field">阅读宽度 · {settings.lineWidth}px<input type="range" min="480" max="1200" step="20" value={settings.lineWidth} onChange={(event) => void run(() => updateSettings({ lineWidth: +event.target.value }))} /></label>
          <hr /><label className="check"><input type="checkbox" checked={settings.autoCommit} onChange={(event) => void run(() => updateSettings({ autoCommit: event.target.checked }))} />字符阈值自动记录版本</label>
          <label className="field">有效修改量阈值<input type="number" min="1" step="1" defaultValue={settings.threshold} key={settings.threshold} onBlur={(event) => void run(() => updateSettings({ threshold: Number(event.target.value) }))} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
          <p className="muted">按用户可见字符计算净修改。输入法确认后判断，撤销回到版本基线时归零。草稿独立保存在此设备。</p>
          <p className="muted">Ctrl+S 保存当前文档；启用 Git 后同时记录本地版本。同步需要手动触发。</p>
        </div>}
        {panel === 'history' && <div className="panel-content">{!history.length && <p className="muted">该文档尚无本地版本。</p>}{history.map((entry) => <button className="history-item" key={entry.oid} onClick={() => void run(() => restoreVersion(entry))}><strong>{entry.subject}</strong><span>{new Date(entry.date).toLocaleString()}</span><code>{entry.oid.slice(0, 10)}</code><small>载入此版本 →</small></button>)}</div>}
        {panel === 'git' && <div className="panel-content">
          <div className="git-summary"><strong>{git?.repository ? git.branch || '尚无分支' : '未启用版本记录'}</strong><span>待上传 {git?.ahead ?? 0} · 待下载 {git?.behind ?? 0}</span></div>
          {git?.blocked && <p className="warning">{git.blocked}</p>}
          <label className="field">提交者姓名<input value={gitForm.name} onChange={(event) => setGitForm({ ...gitForm, name: event.target.value })} /></label>
          <label className="field">提交者邮箱<input value={gitForm.email} onChange={(event) => setGitForm({ ...gitForm, email: event.target.value })} /></label>
          {!git?.repository ? <><p className="muted">首次启用将为此文档库建立初始版本。请先检查目录内容。</p><button className="primary" disabled={busy} onClick={() => void run(() => gitAction(async () => { const choice = await ask('建立初始版本', '将记录当前文档库现有文件。请确认其中没有凭据、私钥或其他不应进入 Git 的文件。', ['建立初始版本', '取消']); if (choice === '建立初始版本') { await api.gitInit({ name: gitForm.name, email: gitForm.email }); setStatus('已建立本地初始版本') } }))}>启用 Git 并建立基线</button></> : <>
            <label className="field">GitHub 仓库 URL<input placeholder="https://github.com/owner/repo.git" value={gitForm.remote} onChange={(event) => setGitForm({ ...gitForm, remote: event.target.value })} /></label>
            <label className="field">分支<input value={gitForm.branch} onChange={(event) => setGitForm({ ...gitForm, branch: event.target.value })} /></label>
            <button onClick={() => void run(() => gitAction(() => api.gitConfigure(gitForm.remote, gitForm.branch, { name: gitForm.name, email: gitForm.email }), true))}>保存仓库配置</button>
            <p className="muted">认证使用 Git Credential Manager 或 SSH。请先在终端完成一次授权；账号密码不会写入应用设置。</p>
            <button className="primary full" disabled={busy} onClick={() => void run(sync)}>同步到 GitHub</button><small className="muted">{git.lastSync ? '最后成功：' + new Date(git.lastSync).toLocaleString() : '尚未成功同步'}<br />远端计数基于上次 fetch。</small>
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
    {tabMenu && <div className="context-menu tab-context-menu" role="menu" aria-label="标签操作" style={{ left: tabMenu.x, top: tabMenu.y }}>
      <button role="menuitem" onClick={() => { setTabs(orderTabs(tabsRef.current.map(tab => tab.id === tabMenu.id ? { ...tab, pinned: !tab.pinned } : tab))); setTabMenu(null) }}><Icon name="pin" />{tabs.find(tab => tab.id === tabMenu.id)?.pinned ? '取消固定标签' : '固定标签'}</button>
      <button role="menuitem" onClick={() => void run(() => closeTab(tabMenu.id))}>关闭标签<kbd>Ctrl W</kbd></button>
      <button role="menuitem" onClick={() => { const id = tabMenu.id; setTabMenu(null); void run(() => closeOtherTabs(id, false)) }}>关闭其他标签</button>
      <button role="menuitem" onClick={() => { const id = tabMenu.id; setTabMenu(null); void run(() => closeOtherTabs(id, true)) }}>关闭右侧标签</button>
      <hr /><button role="menuitem" disabled={!closedTabs.length} onClick={() => { setTabMenu(null); void run(reopenTab) }}><Icon name="reopen" />重新打开关闭的标签</button>
    </div>}
    {markMenu && <div className="context-menu mark-context-menu" role="menu" aria-label="Mark 操作" ref={markMenuEl} style={{ left: markMenu.x, top: markMenu.y }} onKeyDown={event => {
      const items = Array.from(markMenuEl.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      const at = items.indexOf(document.activeElement as HTMLButtonElement)
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus() }
      if (event.key === 'Tab') setMarkMenu(null)
    }}>
      <button role="menuitem" disabled={!markMenuReady || markMenuIndex <= 0} onClick={() => void run(async () => runMarkCommand('move', markMenuIndex - 1))}>上移 Mark</button>
      <button role="menuitem" disabled={!markMenuReady || markMenuIndex >= blocks.length - 1} onClick={() => void run(async () => runMarkCommand('move', markMenuIndex + 1))}>下移 Mark</button>
      <button role="menuitem" disabled={!markMenuReady} onClick={() => void run(async () => runMarkCommand('copy', markMenuIndex + 1))}>复制 Mark</button>
    </div>}
    {contextMenu && <div className="context-menu" role="menu" aria-label="文件操作" ref={contextEl} style={{ left: contextMenu.x, top: contextMenu.y }} onKeyDown={event => {
      const items = Array.from(contextEl.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      const at = items.indexOf(document.activeElement as HTMLButtonElement)
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus() }
      if (event.key === 'Tab') setContextMenu(null)
    }}>
      <button role="menuitem" disabled={busy || navigating} onClick={() => void run(() => mutate('move', contextMenu.path))}><Icon name="edit" />重命名</button>
      {archiveOwner(archives, contextMenu.path) ? <button role="menuitem" disabled={busy || navigating} onClick={() => void run(() => setArchived(contextMenu.path, true))}><Icon name="restore" />{archiveOwner(archives, contextMenu.path)?.path === contextMenu.path ? '恢复到工作树' : '恢复所在归档'}</button> : <button role="menuitem" disabled={busy || navigating} onClick={() => void run(() => setArchived(contextMenu.path, false))}><Icon name="archive" />归档</button>}
      <button className="danger" role="menuitem" disabled={busy || navigating} onClick={() => void run(() => mutate('remove', contextMenu.path))}><Icon name="trash" />移到回收站</button>
    </div>}
    {navigating && <div className="navigation-shield"><span>正在切换文档状态…</span></div>}
    {question && <div className="modal-backdrop"><form className="modal" role="dialog" aria-modal="true" aria-label={question.title} onKeyDown={(event) => { if (event.key === 'Escape') { const q = question; setQuestion(null); q.resolve(null) } }} onSubmit={(event) => { event.preventDefault(); const q = question; setQuestion(null); q.resolve(q.initial !== undefined ? answer : q.buttons[0]) }}><h2>{question.title}</h2><p>{question.detail}</p>{question.initial !== undefined && <input autoFocus value={answer} onChange={(event) => setAnswer(event.target.value)} aria-label={question.title} />}<div className="modal-buttons">{question.buttons.map((label, index) => <button autoFocus={index === 0 && question.initial === undefined} key={label} type={index === 0 ? 'submit' : 'button'} className={index === 0 ? 'primary' : ''} onClick={index === 0 ? undefined : () => { const q = question; setQuestion(null); q.resolve(label === '取消' ? null : label) }}>{label}</button>)}</div></form></div>}
  </div>
}
