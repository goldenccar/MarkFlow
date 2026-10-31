import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { PaperAPI, PaperBuffer, PaperBuildResult, PaperCreateRequest, PaperDiagnostic, PaperEngine, PaperProject, PaperRuntimeStatus, PaperMarkRequest } from '../shared/paper'
import { defaultSettings, type ResolvedTheme } from '../shared/types'
import type { CompletionSettings } from '../shared/completionSettings'
import type { Diagnostic } from '../compiler/types'
import type { CompileCurrentDocument } from './CompileDialog'
import type { DocumentEditorHandle } from './documents/types'
import { FormulaEditor } from './documents/FormulaEditor'
import { Icon } from './Icons'
import PaperPdfPreview from './PaperPdfPreview'
import PaperEnvironmentPanel from './PaperEnvironmentPanel'
import PaperPageSettings from './PaperPageSettings'
import FomulaModeSwitch from './FomulaModeSwitch'
import SelectControl from './SelectControl'
import { WorkspaceToolbar, WorkspacePaneHeading, WorkspaceLayoutSwitch } from './WorkspaceFrame'
import { insertPaperSnippet, openPaperBuffer, paperCitations, paperDraftNeeded, paperOutline, paperRenderInputsChanged, paperSnippets, savedPaperBuffer, type PaperEditorBuffer } from './paperWorkspaceModel'
import './paper-workspace.css'

export interface PaperWorkspaceHandle {
  flushDrafts(): Promise<void>
  performAction(action: string): void | Promise<void>
  requestClose(): Promise<boolean>
  openFile(path: string, line?: number): Promise<void>
  createFile(path: string): Promise<void>
  refresh(): Promise<void>
  replaceContent(content: string): void
  remapPath(from: string, to?: string): Promise<void>
  assertMutable(path: string): void
  getActiveContent(): string | undefined
}
export interface PaperWorkspaceState {
  project: PaperProject | null
  activePath: string
  dirtyPaths: string[]
  busy: boolean
  building: boolean
  outline: ReturnType<typeof paperOutline>
}
interface Props { onClose(): void; onFragment(): void; onStateChange?(state: PaperWorkspaceState): void; onProjectReady?(project: PaperProject): Promise<void>; fontSize?: number; lineHeight?: number; fontFamily?: string; completion?: CompletionSettings; startRequest?: string; documentRequest?: { id: string; root: string; path: string; project?: PaperProject }; theme?: ResolvedTheme; currentDocument?: CompileCurrentDocument; onLocateMark?(diagnostic: Diagnostic, source: CompileCurrentDocument): void }
const reason = (cause: unknown) => String(cause instanceof Error ? cause.message : cause).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const PaperWorkspace = forwardRef<PaperWorkspaceHandle, Props>(function PaperWorkspace({ onClose, onFragment, onStateChange, onProjectReady, fontSize = defaultSettings.fontSize, lineHeight = defaultSettings.lineHeight, fontFamily, completion, startRequest, documentRequest, theme = 'light', currentDocument, onLocateMark }, ref) {
  const api = window.oops as typeof window.oops & PaperAPI
  const editor = useRef<DocumentEditorHandle>(null), mounted = useRef(true), composing = useRef(false)
  const projectRef = useRef<PaperProject | null>(null), buffersRef = useRef<Record<string, PaperEditorBuffer>>({}), activeRef = useRef('')
  const revisionRef = useRef(0), buildSequence = useRef(0), operationRef = useRef(false), buildingRef = useRef(false), lastAttempt = useRef(-1)
  const draftChain = useRef(Promise.resolve()), drafted = useRef(new Map<string, string>())
  const refreshTask = useRef<Promise<void> | null>(null)
  const editorKeys = useRef(new Map<string, string>()), editorSequence = useRef(0)
  const [project, setProject] = useState<PaperProject | null>(null), [buffers, setBuffers] = useState<Record<string, PaperEditorBuffer>>({}), [active, setActive] = useState('')
  const [runtime, setRuntime] = useState<PaperRuntimeStatus | null>(null), [busy, setBusy] = useState(''), [building, setBuilding] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [revision, setRevision] = useState(0)
  const [result, setResult] = useState<PaperBuildResult | null>(null), [pdf, setPdf] = useState<Uint8Array | null>(null), [artifact, setArtifact] = useState<{ id: string; revision: number } | null>(null)
  const [automatic, setAutomatic] = useState(false), [showLog, setShowLog] = useState(false)
  const [creation, setCreation] = useState<PaperCreateRequest>({ template: 'chinese', name: '我的论文', title: '论文标题', author: '作者' })
  const [sourceKind, setSourceKind] = useState<'template' | 'current' | 'file'>('template'), [abstract, setAbstract] = useState('')
  const [references, setReferences] = useState<NonNullable<PaperMarkRequest['references']>>([])
  const [markDiagnostics, setMarkDiagnostics] = useState<Diagnostic[]>([]), [originDocument, setOriginDocument] = useState<CompileCurrentDocument | undefined>()
  const [environmentOpen, setEnvironmentOpen] = useState(false)
  const [pageSettingsOpen, setPageSettingsOpen] = useState(false)
  const settingsButton = useRef<HTMLButtonElement>(null), settingsPanel = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<'source' | 'split'>('split')
  const openedRequest = useRef('')
  const startedRequest = useRef('')
  const [citationPicker, setCitationPicker] = useState(false), [citationQuery, setCitationQuery] = useState('')
  const [narrowPane, setNarrowPane] = useState<'source' | 'pdf'>('source')
  const [pdfLocation, setPdfLocation] = useState<{ page: number; x?: number; y?: number; nonce: number } | null>(null)
  const locationSequence = useRef(0)
  const actions = useRef<(action: string) => void | Promise<void>>(() => {})
  const stateChange = useRef(onStateChange)
  stateChange.current = onStateChange
  const updateBuffers = (next: Record<string, PaperEditorBuffer>) => { buffersRef.current = next; setBuffers(next) }
  const touch = () => { revisionRef.current += 1; setRevision(revisionRef.current) }
  const acceptProject = (next: PaperProject) => { projectRef.current = next; setProject(next) }
  const flushDrafts = useCallback(async (force: readonly string[] = []) => {
    editor.current?.flush()
    const current = projectRef.current
    if (!current) return
    const pending = Object.values(buffersRef.current).filter(buffer => force.includes(buffer.path) || paperDraftNeeded(buffer, drafted.current.get(buffer.path)))
    const save = async () => {
      for (const buffer of pending) {
        await api.paperDraft(current.id, { path: buffer.path, content: buffer.content, revision: buffer.revision })
        if (projectRef.current?.id === current.id) drafted.current.set(buffer.path, buffer.content)
      }
    }
    // Serialize device drafts so a slow old write cannot replace a newer draft.
    const task = draftChain.current.catch(() => {}).then(save)
    draftChain.current = task
    await task
  }, [api])
  const perform = async (label: string, fn: () => Promise<void>, propagate = false) => {
    if (operationRef.current || composing.current) { if (propagate) throw new Error('当前操作尚未结束，请稍后重试。'); return }
    operationRef.current = true; setBusy(label); setError(''); setNotice('')
    try { await fn() } catch (cause) { if (mounted.current) setError(reason(cause)); if (propagate) throw cause }
    finally { operationRef.current = false; if (mounted.current) setBusy('') }
  }
  const refreshRuntime = async () => {
    try { const next = await api.paperRuntime(); if (mounted.current) setRuntime(next) }
    catch (cause) { if (mounted.current) setError(reason(cause)) }
  }
  const loadFile = async (path: string, select = true, line?: number) => {
    const current = projectRef.current
    if (!current) return
    if (!editorKeys.current.has(path)) editorKeys.current.set(path, `paper:${current.id}:${++editorSequence.current}`)
    let buffer = buffersRef.current[path]
    if (!buffer) {
      const file = await api.paperRead(current.id, path)
      if (!mounted.current || projectRef.current?.id !== current.id) return
      buffer = openPaperBuffer(file); updateBuffers({ ...buffersRef.current, [path]: buffer })
      if (file.draft) drafted.current.set(path, file.draft.content)
      if (buffer.recovered) setNotice(`已恢复 ${path} 的设备草稿，源文件尚未保存。`)
    }
    if (select) {
      setPageSettingsOpen(false)
      editor.current?.flush(); activeRef.current = path; setActive(path)
      if (line) requestAnimationFrame(() => editor.current?.jumpTo(line))
    }
  }
  const enterProject = async (next: PaperProject) => {
    let accepted = false
    try {
      if (!mounted.current) return
      await flushDrafts()
      if (!mounted.current) return
      await onProjectReady?.(next)
      if (!mounted.current) return
      const previous = projectRef.current
      buildSequence.current += 1
      if (previous) { await api.paperCancel(previous.id); await api.paperRelease(previous.id) }
      if (!mounted.current) return
      drafted.current.clear(); editorKeys.current.clear(); refreshTask.current = null; updateBuffers({}); activeRef.current = ''; setActive('')
      acceptProject(next); accepted = true
      setPdf(null); setArtifact(null); setResult(null); setShowLog(false); setAutomatic(false); setCitationPicker(false); setPdfLocation(null); setPageSettingsOpen(false)
      buildingRef.current = false; setBuilding(false); lastAttempt.current = -1; touch()
      const first = next.mainFile ?? next.mainCandidates[0] ?? next.files.find(file => file.editable)?.path
      if (first) await loadFile(first)
      await refreshRuntime()
    } finally { if (!accepted) await api.paperRelease(next.id) }
  }
  const openProject = (kind: 'folder' | 'zip' | 'recent') => perform('正在打开项目…', async () => {
    await flushDrafts(); const next = await api.paperOpen(kind); if (next) await enterProject(next)
  })
  const createProject = () => perform('正在创建论文…', async () => {
    await flushDrafts(); setMarkDiagnostics([])
    if (sourceKind === 'template') { const next = await api.paperCreate(creation); if (next) { setOriginDocument(undefined); await enterProject(next) }; return }
    const source = sourceKind === 'current' && currentDocument ? { kind: 'current' as const, content: currentDocument.content, root: currentDocument.root, path: currentDocument.path } : { kind: 'file' as const }
    const next = await api.paperFromMark({ ...creation, abstract, references, source })
    if (next) { setMarkDiagnostics(next.diagnostics); if (next.project) { setOriginDocument(sourceKind === 'current' ? currentDocument : undefined); await enterProject(next.project) } }
  })
  const newProject = () => perform('正在关闭论文项目…', async () => {
    await flushDrafts(); const current = projectRef.current
    if (current) { await api.paperCancel(current.id); await api.paperRelease(current.id) }
    buildSequence.current += 1; projectRef.current = null; setProject(null); updateBuffers({}); setActive(''); activeRef.current = ''; setPdf(null); setArtifact(null); setMarkDiagnostics([]); setOriginDocument(undefined)
    drafted.current.clear(); editorKeys.current.clear(); refreshTask.current = null; buildingRef.current = false; setBuilding(false); setAutomatic(false); setResult(null); setShowLog(false); setPageSettingsOpen(false)
  })
  const locateMark = (file: string, line: number) => {
    const mark = project?.origin?.marks.find(item => item.file === file && item.fromLine <= line && item.toLine >= line)
    if (mark && originDocument && onLocateMark) onLocateMark({ code: 'PAPER_SOURCE_MARK', severity: 'warning', message: '', markId: mark.markId, source: mark.source }, originDocument)
    else setNotice(mark ? `对应 Mark：${mark.markId}。来源：${project?.origin?.label}` : '此位置没有对应的 Mark，模板和页面结构不属于正文 Mark。')
  }
  const selectTemplate = (template: PaperCreateRequest['template']) => setCreation(value => ({
    ...value, template,
    title: ['论文标题', 'Paper title'].includes(value.title) ? template === 'chinese' ? '论文标题' : 'Paper title' : value.title,
    author: ['作者', 'Author'].includes(value.author) ? template === 'chinese' ? '作者' : 'Author' : value.author,
  }))
  const saveAll = () => perform('正在保存…', async () => {
    editor.current?.flush()
    const current = projectRef.current
    if (!current) return
    const dirty = Object.values(buffersRef.current).filter(buffer => buffer.content !== buffer.baseline)
    if (dirty.some(buffer => buffer.conflict)) throw new Error('恢复的草稿与磁盘版本不同，请先打开对应文件，核对并合并磁盘修改。')
    await draftChain.current.catch(() => {})
    for (const buffer of dirty) {
      const snapshot: PaperBuffer = { path: buffer.path, content: buffer.content, revision: buffer.revision }
      let written
      try { written = await api.paperSave(current.id, snapshot) }
      catch (cause) {
        try {
          const disk = await api.paperRead(current.id, buffer.path), latest = buffersRef.current[buffer.path]
          if (latest && disk.revision !== snapshot.revision && projectRef.current?.id === current.id) updateBuffers({ ...buffersRef.current, [buffer.path]: { ...latest, baseline: disk.content, diskRevision: disk.revision, conflict: true } })
        } catch { /* Preserve the edit when the conflicting disk file cannot be read. */ }
        throw cause
      }
      if (!mounted.current || projectRef.current?.id !== current.id) return
      const latest = buffersRef.current[buffer.path]
      if (latest) updateBuffers({ ...buffersRef.current, [buffer.path]: savedPaperBuffer(latest, snapshot, written) })
      await draftChain.current.catch(() => {})
      // The native save may retain an older, different recovery record. Rebase this
      // file now, even if a later file fails to save; preserve any newer edit as well.
      await flushDrafts([buffer.path])
    }
    await flushDrafts(); setNotice(dirty.length ? `已保存 ${dirty.length} 个文件。` : '源文件已是最新。')
  })
  const cancelBuild = async () => {
    const current = projectRef.current
    if (!current) return
    buildSequence.current += 1; lastAttempt.current = revisionRef.current
    await api.paperCancel(current.id); buildingRef.current = false; setBuilding(false); setNotice('编译已取消，上一份 PDF 保留。')
  }
  const compile = async () => {
    if (composing.current || operationRef.current || buildingRef.current) return
    editor.current?.flush()
    const current = projectRef.current
    if (!current?.mainFile || !current.trusted) return
    const inputRevision = revisionRef.current, sequence = ++buildSequence.current
    buildingRef.current = true; setBuilding(true); setError(''); setNotice(''); lastAttempt.current = inputRevision
    try {
      const outcome = await api.paperBuild({ projectId: current.id, mainFile: current.mainFile, engine: current.engine, revision: inputRevision, buffers: Object.values(buffersRef.current).map(({ path, content, revision }) => ({ path, content, revision })) })
      if (!mounted.current || sequence !== buildSequence.current || projectRef.current?.id !== current.id) return
      if (inputRevision !== revisionRef.current) { setNotice('内容已更新，旧编译结果未替换当前预览。'); return }
      setResult(outcome)
      if (outcome.status === 'success' && outcome.artifactId) {
        const bytes = await api.paperPdf(current.id, outcome.artifactId)
        if (!mounted.current || sequence !== buildSequence.current || inputRevision !== revisionRef.current || projectRef.current?.id !== current.id) return
        setPdf(bytes); setArtifact({ id: outcome.artifactId, revision: inputRevision })
        setNotice(`编译完成 · ${(outcome.durationMs / 1000).toFixed(1)} 秒`)
      } else if (outcome.status === 'error') setShowLog(true)
      else setNotice('编译已取消，上一份 PDF 保留。')
    } catch (cause) { if (mounted.current && sequence === buildSequence.current) setError(reason(cause)) }
    finally { if (sequence === buildSequence.current) { buildingRef.current = false; if (mounted.current) setBuilding(false) } }
  }
  const requestClose = useCallback(async () => {
    if (operationRef.current || composing.current) { setError('请先完成当前操作或输入，再关闭文档。'); return false }
    try {
      await flushDrafts()
      const current = projectRef.current
      if (current) await api.paperCancel(current.id)
      buildSequence.current += 1; buildingRef.current = false; setBuilding(false); setAutomatic(false)
      return true
    } catch (cause) { setError(`设备草稿未能保存：${reason(cause)}`); return false }
  }, [api, flushDrafts])
  useEffect(() => {
    mounted.current = true; void refreshRuntime()
    return () => { mounted.current = false; const current = projectRef.current; if (current) void draftChain.current.catch(() => {}).then(() => api.paperRelease(current.id)).catch(() => {}) }
  }, [])
  useEffect(() => {
    if (!documentRequest || openedRequest.current === documentRequest.id || busy) return
    openedRequest.current = documentRequest.id
    void perform('正在打开 LaTeX 文档…', async () => {
      await flushDrafts()
      await enterProject(documentRequest.project ?? await api.paperOpenDocument(documentRequest.root, documentRequest.path)); await loadFile(documentRequest.path)
    })
  }, [documentRequest?.id, busy])
  useEffect(() => {
    if (!startRequest || startedRequest.current === startRequest || busy) return
    startedRequest.current = startRequest; void newProject()
  }, [startRequest, busy])
  useEffect(() => {
    if (!project) return
    const timer = setTimeout(() => { if (!composing.current) void flushDrafts().catch(cause => { if (mounted.current) setError(`草稿保存失败：${reason(cause)}`) }) }, 600)
    return () => clearTimeout(timer)
  }, [buffers, project?.id, flushDrafts])
  useEffect(() => {
    if (!automatic || !project?.trusted || !runtime?.available || !project.mainFile || building || busy || lastAttempt.current === revision) return
    const timer = setTimeout(() => { if (!composing.current) void compile() }, 1200)
    return () => clearTimeout(timer)
  }, [automatic, project?.id, project?.trusted, project?.mainFile, runtime?.available, revision, building, busy])
  const configure = (mainFile: string, engine: PaperEngine) => perform('正在设置项目…', async () => {
    const current = projectRef.current
    if (!current || !mainFile) return
    acceptProject(await api.paperConfigure(current.id, mainFile, engine)); touch()
  })
  const refresh = (): Promise<void> => {
    if (refreshTask.current) return refreshTask.current
    const current = projectRef.current
    if (!current || operationRef.current || composing.current) return Promise.resolve()
    const unchangedProject = () => mounted.current && projectRef.current === current && !operationRef.current && !composing.current
    const task = (async () => {
      await flushDrafts()
      if (!unchangedProject()) return
      const refreshed = await api.paperRefresh(current.id)
      if (!unchangedProject()) return
      const paths = new Set(refreshed.files.filter(file => file.editable).map(file => file.path))
      const snapshots = Object.values(buffersRef.current)
      const reads = await Promise.allSettled(snapshots.map(buffer => paths.has(buffer.path) ? api.paperRead(current.id, buffer.path) : Promise.resolve(null)))
      // Background disk checks must never lock navigation or apply an older project snapshot.
      if (!unchangedProject()) return
      const next = { ...buffersRef.current }, problems: string[] = []
      let changed = false, conflicts = false
      reads.forEach((read, index) => {
        const before = snapshots[index], latest = next[before.path]
        if (!latest || latest.revision !== before.revision || latest.diskRevision !== before.diskRevision) return
        if (read.status === 'rejected') { problems.push(`${before.path}：${reason(read.reason)}`); return }
        const disk = read.value, dirty = latest.content !== latest.baseline
        if (!disk) {
          if (dirty) {
            if (!latest.conflict) { next[before.path] = { ...latest, conflict: true }; changed = true }
            problems.push(`${before.path} 已在磁盘上删除；未保存内容和设备草稿仍保留，请先恢复文件或复制正文。`)
          } else { delete next[before.path]; drafted.current.delete(before.path); editorKeys.current.delete(before.path); changed = true }
          return
        }
        if (disk.revision === latest.diskRevision && (dirty || latest.revision === disk.revision && !latest.conflict)) return
        if (!dirty || latest.content === disk.content) {
          // An old clean recovery record should follow the new disk baseline, not reappear on reopen.
          if (disk.draft?.content === latest.content && disk.draft.revision === latest.revision) drafted.current.set(before.path, disk.draft.content)
          next[before.path] = { ...latest, content: disk.content, baseline: disk.content, revision: disk.revision, diskRevision: disk.revision, recovered: false, conflict: false, position: { ...latest.position, cursor: Math.min(latest.position.cursor, disk.content.length) } }
        } else {
          next[before.path] = { ...latest, baseline: disk.content, diskRevision: disk.revision, conflict: true }
          conflicts = true
        }
        changed = true
      })
      const projectChanged = JSON.stringify(current) !== JSON.stringify(refreshed)
      const inputChanged = paperRenderInputsChanged(current, refreshed, buffersRef.current, next)
      if (changed) {
        updateBuffers(next)
        if (activeRef.current && !next[activeRef.current]) {
          const fallback = refreshed.mainFile && next[refreshed.mainFile] ? refreshed.mainFile : Object.keys(next)[0] ?? ''
          activeRef.current = fallback; setActive(fallback); setPageSettingsOpen(false)
        }
      }
      if (projectChanged) acceptProject(refreshed)
      if (inputChanged) touch()
      if (changed) await flushDrafts()
      if (problems.length) throw new Error(problems.join('\n'))
      if (conflicts) setNotice('磁盘与当前编辑均有修改；两端内容已保留，请核对后再保存。')
    })().catch(cause => { if (!mounted.current || projectRef.current?.id !== current.id) return; setError(reason(cause)); throw cause })
    refreshTask.current = task
    void task.finally(() => { if (refreshTask.current === task) refreshTask.current = null }).catch(() => {})
    return task
  }
  const assertMutable = (_path: string) => {
    if (projectRef.current?.origin) throw new Error('此项目由 Mark 资料生成，请修改原资料，或先另存为独立 LaTeX 项目。')
    if (operationRef.current || buildingRef.current || composing.current) throw new Error('请等待当前操作完成，或先取消编译，再修改项目文件。')
  }
  const createFile = (path: string) => {
    assertMutable(path)
    return perform('正在创建源文件…', async () => {
      const current = projectRef.current
      if (!current) throw new Error('请先打开 LaTeX 项目。')
      acceptProject(await api.paperAddFile(current.id, path)); await loadFile(path); touch()
    }, true)
  }
  const remapPath = (from: string, to?: string) => {
    assertMutable(from)
    return perform('正在同步文件路径…', async () => {
      const current = projectRef.current
      if (!current) return
      const normalize = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '')
      from = normalize(from); if (to !== undefined) to = normalize(to)
      if (!from || from.startsWith('/') || from.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':')) || (to !== undefined && (!to || to.startsWith('/') || to.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))))) throw new Error('文件路径必须位于当前项目中。')
      if (from === to) return
      const matches = (path: string) => path === from || path.startsWith(`${from}/`)
      const moved = (path: string) => to === undefined ? '' : to + path.slice(from.length)
      await draftChain.current
      editor.current?.flush()
      const affected = Object.keys(buffersRef.current).filter(matches)
      for (const old of affected) if (to && buffersRef.current[moved(old)] && !matches(moved(old))) throw new Error('目标路径已有编辑缓冲，请先保存并关闭目标文档后重试。')
      // Includes recovery records from files that were not opened during this session.
      if (to !== undefined) await api.paperMoveDraft(current.id, from, to)
      else for (const file of new Set([...current.files.filter(file => file.editable && matches(file.path)).map(file => file.path), ...affected])) await api.paperDiscardDraft(current.id, file)
      const next: Record<string, PaperEditorBuffer> = {}
      for (const [path, buffer] of Object.entries(buffersRef.current)) {
        if (!matches(path)) { next[path] = buffer; continue }
        const destination = moved(path), previousDraft = drafted.current.get(path), editorKey = editorKeys.current.get(path)
        drafted.current.delete(path); editorKeys.current.delete(path)
        if (destination) {
          next[destination] = { ...buffer, path: destination }
          if (editorKey) editorKeys.current.set(destination, editorKey)
          if (previousDraft !== undefined) drafted.current.set(destination, previousDraft)
        }
      }
      const previousActive = activeRef.current, nextActive = matches(previousActive) ? moved(previousActive) : previousActive
      updateBuffers(next); activeRef.current = nextActive; setActive(nextActive); setPageSettingsOpen(false)
      let refreshed = await api.paperRefresh(current.id)
      const main = current.mainFile && matches(current.mainFile) ? moved(current.mainFile) : refreshed.mainFile
      if (main && /\.tex$/i.test(main) && refreshed.files.some(file => file.path === main && file.editable) && refreshed.mainFile !== main) refreshed = await api.paperConfigure(current.id, main, refreshed.engine)
      acceptProject(refreshed); touch()
      if (!nextActive) {
        const fallback = refreshed.mainFile ?? refreshed.files.find(file => file.editable)?.path
        if (fallback) await loadFile(fallback)
      }
      await flushDrafts()
    }, true)
  }
  const insert = (snippet: string) => {
    const buffer = buffersRef.current[activeRef.current]
    if (!buffer || composing.current) return
    editor.current?.replace(insertPaperSnippet(buffer.content, buffer.position.cursor, snippet)); editor.current?.focus()
  }
  const addFigure = () => perform('正在选择图片…', async () => {
    const current = projectRef.current
    if (!current) return
    const selection = await api.paperImportAsset(current.id)
    if (!selection) return
    acceptProject(selection.project)
    if (/[{}\r\n]/.test(selection.path)) throw new Error('图片文件名不能包含花括号或换行。')
    insert(`\n\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{\\detokenize{${selection.path}}}\n  \\caption{Figure caption}\n  \\label{fig:example}\n\\end{figure}\n`)
  })
  const showCitations = () => perform('正在读取文献…', async () => {
    const current = projectRef.current
    if (!current) return
    for (const file of current.files.filter(file => file.editable && /\.bib$/i.test(file.path))) await loadFile(file.path, false)
    setCitationQuery(''); setCitationPicker(true)
  })
  const exportArtifact = (target: 'pdf' | 'source') => perform('正在导出…', async () => {
    const current = projectRef.current
    if (!current || !artifact) return
    const output = await api.paperExport(current.id, artifact.id, target)
    if (output) setNotice(`已导出：${output}`)
  })
  const locate = (diagnostic: PaperDiagnostic) => { if (diagnostic.file) void perform('正在定位…', () => loadFile(diagnostic.file!, true, diagnostic.line ?? 1)) }
  const locatePdf = () => perform('正在定位 PDF…', async () => {
    const current = projectRef.current, source = buffersRef.current[activeRef.current]
    if (!current || !source || !artifact || artifact.revision !== revisionRef.current) return
    const sourceRevision = revisionRef.current, line = source.content.slice(0, source.position.cursor).split('\n').length
    const location = await api.paperLocate(current.id, artifact.id, { kind: 'source', file: source.path, line })
    if (projectRef.current?.id !== current.id || sourceRevision !== revisionRef.current || location.revision !== sourceRevision) return
    if (!location.page) { setNotice('当前位置没有对应的 PDF 排版位置。'); return }
    setPdfLocation({ page: location.page, x: location.x, y: location.y, nonce: ++locationSequence.current }); setNarrowPane('pdf')
  })
  const locateSource = (page: number, x: number, y: number) => perform('正在定位源码…', async () => {
    const current = projectRef.current
    if (!current || !artifact || artifact.revision !== revisionRef.current) return
    const sourceRevision = revisionRef.current
    const location = await api.paperLocate(current.id, artifact.id, { kind: 'pdf', page, x, y })
    if (projectRef.current?.id !== current.id || sourceRevision !== revisionRef.current || location.revision !== sourceRevision) return
    if (!location.file) { setNotice('此位置没有对应的项目源码。'); return }
    setNarrowPane('source'); await loadFile(location.file, true, location.line)
  })
  actions.current = action => {
    if (action === 'new-file') return newProject()
    if (action === 'source' || action === 'split' || action === 'preview') { setLayout(action === 'source' ? 'source' : 'split'); return }
    if ((action === 'undo' || action === 'redo') && document.activeElement?.matches('input, textarea')) { if (!composing.current) document.execCommand(action); return }
    if (action === 'save') return saveAll()
    if (action === 'find') editor.current?.find()
    if (action === 'undo') editor.current?.undo()
    if (action === 'redo') editor.current?.redo()
    if (action === 'paper-build' || action === 'compile') return compile()
    if (action === 'open' || action === 'open-file' || action === 'open-library') return openProject('folder')
    if (action === 'close-tab') return requestClose().then(ok => { if (ok) onClose() })
  }
  const buffer = buffers[active]
  const dirtyKey = JSON.stringify(Object.values(buffers).filter(item => item.content !== item.baseline).map(item => item.path).sort())
  const dirtyPaths = useMemo(() => JSON.parse(dirtyKey) as string[], [dirtyKey])
  const outlineKey = useMemo(() => JSON.stringify(paperOutline(buffer?.content ?? '')), [buffer?.content])
  const outline = useMemo(() => JSON.parse(outlineKey) as ReturnType<typeof paperOutline>, [outlineKey])
  const shellState = useMemo(() => ({ project, activePath: active, dirtyPaths, busy: !!busy, building, outline }), [project, active, dirtyPaths, !!busy, building, outline])
  useEffect(() => { stateChange.current?.(shellState) }, [shellState])
  useImperativeHandle(ref, () => ({
    flushDrafts, requestClose, performAction: action => actions.current(action),
    openFile: (path, line) => perform('正在打开文件…', () => loadFile(path, true, line), true),
    createFile, refresh, remapPath, assertMutable,
    getActiveContent: () => buffersRef.current[activeRef.current]?.content,
    replaceContent: content => {
      if (projectRef.current?.origin) throw new Error('生成源码为只读，请先另存为独立 LaTeX 项目。')
      if (composing.current || operationRef.current || !editor.current) throw new Error('请等待当前操作完成后再替换正文。')
      editor.current.replace(content)
    },
  }))
  const citations = useMemo(() => paperCitations(Object.values(buffers)).filter(item => item.key.toLowerCase().includes(citationQuery.toLowerCase())), [buffers, citationQuery])
  const disabled = !!busy || !buffer || !!project?.origin
  const openPageSettings = () => perform('正在读取页面设置…', async () => {
    const main = projectRef.current?.mainFile
    if (!main) return
    await loadFile(main); setLayout('split'); setNarrowPane('source'); setPageSettingsOpen(true)
  })
  const closePageSettings = () => { setPageSettingsOpen(false); settingsButton.current?.focus({ preventScroll: true }) }
  useEffect(() => {
    if (pageSettingsOpen) settingsPanel.current?.querySelector<HTMLSelectElement>('select:not(:disabled)')?.focus({ preventScroll: true })
  }, [pageSettingsOpen])
  return <section className="paper-workspace" aria-label="Fomula 文档工作区" data-layout={layout} data-pane={narrowPane} onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.nativeEvent.isComposing && event.key === 'Enter') { event.preventDefault(); void compile() }
  }}>
    <WorkspaceToolbar className="fomula-toolbar"><FomulaModeSwitch mode="document" disabled={!!busy || building} onChange={() => void requestClose().then(ok => { if (ok) onFragment() })} />
      {project && <button className="paper-new-trigger" title="新建 LaTeX 文档" disabled={!!busy || building} onClick={() => void newProject()}><Icon name="filePlus" /><span>新建文档</span></button>}
      {project && <button ref={settingsButton} className="paper-settings-trigger" disabled={!!busy || !project.mainFile} aria-expanded={pageSettingsOpen} aria-pressed={pageSettingsOpen} aria-controls="paper-page-config" onClick={() => { if (pageSettingsOpen) closePageSettings(); else void openPageSettings() }}><Icon name="settings" />页面设置</button>}
      <button className="icon-button paper-environment-trigger" title="编译环境" aria-label="编译环境" aria-expanded={environmentOpen} aria-pressed={environmentOpen} onClick={() => setEnvironmentOpen(value => !value)}><Icon name="monitor" /></button>
      {project && <details className="paper-options"><summary aria-label="编译选项"><Icon name="more" /><span>编译选项</span></summary><div className="paper-project-controls"><label>主文件<SelectControl aria-label="论文主文件" disabled={!!busy || building} value={project.mainFile ?? ''} onChange={event => void configure(event.target.value, project.engine)}><option value="" disabled>请选择主文件</option>{project.files.filter(file => file.editable && /\.tex$/i.test(file.path)).map(file => <option key={file.path} value={file.path}>{file.path}</option>)}</SelectControl></label><label>引擎<SelectControl aria-label="论文编译引擎" disabled={!!busy || building || !project.mainFile} value={project.engine} onChange={event => void configure(project.mainFile!, event.target.value as PaperEngine)}><option value="xelatex">XeLaTeX</option><option value="pdflatex">pdfLaTeX</option><option value="lualatex">LuaLaTeX</option></SelectControl></label><label className="paper-auto"><input type="checkbox" checked={automatic} onChange={event => setAutomatic(event.target.checked)} />停笔后编译</label></div></details>}
      <span className="spacer" />{project && <><div className="paper-narrow-toggle"><button aria-pressed={narrowPane === 'source'} onClick={() => setNarrowPane('source')}>源码</button><button aria-pressed={narrowPane === 'pdf'} onClick={() => setNarrowPane('pdf')}>PDF</button></div><button className="toolbar-search" aria-label="查找" onClick={() => editor.current?.find()}><Icon name="search" /><span>搜索</span><kbd>Ctrl F</kbd></button><WorkspaceLayoutSwitch layouts={['split', 'source']} value={layout} onChange={value => setLayout(value === 'preview' ? 'split' : value)} /></>}
      {project && <div className="paper-action-group paper-build-actions" role="group" aria-label="编译与导出">
        <button className="primary" title="编译当前快照 · Ctrl+Enter" disabled={!!busy || (!building && (!project.mainFile || !project.trusted || !runtime?.available))} onClick={() => void (building ? cancelBuild() : compile())}><Icon name={building ? 'close' : 'refresh'} /><span>{building ? '取消编译' : '编译'}</span></button>
        <details className="paper-export"><summary aria-label="导出论文"><Icon name="arrowUp" /><span>导出</span><Icon name="chevronDown" size={13} /></summary><div><button disabled={!!busy || !artifact} onClick={() => void exportArtifact('pdf')}><Icon name="file" />导出 PDF</button><button disabled={!!busy || !artifact} onClick={() => void exportArtifact('source')}><Icon name="archive" />导出可复现源包</button>{artifact && artifact.revision !== revision && <p>导出上次成功编译的版本 {artifact.revision}。</p>}</div></details>
      </div>}
    </WorkspaceToolbar>

    {(error || notice || busy) && <div className={`paper-notice${error ? ' paper-error' : ''}`} role={error ? 'alert' : 'status'}><span>{error || busy || notice}</span>{!busy && <button className="icon-button" aria-label="关闭提示" onClick={() => { setError(''); setNotice('') }}><Icon name="close" size={13} /></button>}</div>}
    {project && environmentOpen && <PaperEnvironmentPanel runtime={runtime} onChange={refreshRuntime} />}
    {!!markDiagnostics.length && <div className="paper-mark-diagnostics" role="status">{markDiagnostics.map((item, index) => <p key={index}>{item.message}{sourceKind === 'current' && currentDocument && onLocateMark && <button onClick={() => onLocateMark(item, currentDocument)}>定位原文</button>}</p>)}</div>}
    {!project ? <div className="paper-start">
      <div className="paper-start-heading"><h1>新建 LaTeX 文档</h1><p>选择模板，一次配置页面。源码在左，实际分页在右。</p></div>
      <form className="paper-create" onSubmit={event => { event.preventDefault(); void createProject() }}>
        <fieldset className="paper-source-options"><legend>资料来源</legend>{([['template', '空白模板'], ['current', '当前 Markdown'], ['file', '本地 Mark / Markdown']] as const).map(([kind, label]) => <label key={kind}><input type="radio" name="paper-source" checked={sourceKind === kind} disabled={!!busy || (kind === 'current' && !currentDocument)} onChange={() => { setSourceKind(kind); setMarkDiagnostics([]) }} />{label}</label>)}</fieldset>
        {sourceKind !== 'template' && <p className="paper-source-description">{sourceKind === 'current' ? `使用 ${currentDocument?.label ?? '当前文档'} 的内容快照，包含未保存修改。` : '选择已有 Mark JSON 或 Markdown，图片从资料所在文件夹读取。'}原文保留，生成的 LaTeX 默认只读。</p>}
        <div className="paper-template-options">{([{ id: 'chinese', label: '中文论文', hint: 'XeLaTeX · 中文与公式' }, { id: 'article', label: '英文单栏', hint: 'pdfLaTeX · 标准文章' }, { id: 'twocolumn', label: '英文双栏', hint: 'pdfLaTeX · 双栏版式' }] as const).map(template => <label key={template.id} data-selected={creation.template === template.id}><input type="radio" name="paper-template" value={template.id} checked={creation.template === template.id} onChange={() => selectTemplate(template.id)} /><span><strong>{template.label}</strong><small>{template.hint}</small></span></label>)}</div>
        <div className="paper-create-fields"><label>项目名称<input aria-label="论文项目名称" required maxLength={80} value={creation.name} onChange={event => setCreation(value => ({ ...value, name: event.target.value }))} /></label><label>论文标题<input aria-label="论文标题" required maxLength={300} value={creation.title} onChange={event => setCreation(value => ({ ...value, title: event.target.value }))} /></label><label>作者<input aria-label="论文作者" maxLength={200} value={creation.author} onChange={event => setCreation(value => ({ ...value, author: event.target.value }))} /></label></div>
        {sourceKind !== 'template' && <label className="paper-abstract">摘要（可选）<textarea aria-label="论文摘要" value={abstract} maxLength={8000} onChange={event => setAbstract(event.target.value)} rows={3} /></label>}
        {sourceKind !== 'template' && <details className="paper-references"><summary>参考文献{references.length ? ` · ${references.length}` : '（可选）'}</summary><p>正文使用 [@标识] 引用，例如 [@ref1]。</p>{references.map((reference, index) => <div key={index}>{([['id', '标识'], ['title', '文献标题'], ['author', '作者'], ['year', '年份']] as const).map(([field, label]) => <label key={field}>{label}<input aria-label={`文献 ${index + 1} ${label}`} maxLength={field === 'title' ? 1000 : 200} value={reference[field]} onChange={event => setReferences(values => values.map((value, at) => at === index ? { ...value, [field]: event.target.value } : value))} /></label>)}<button type="button" onClick={() => setReferences(values => values.filter((_, at) => at !== index))}>移除</button></div>)}<button type="button" onClick={() => setReferences(values => [...values, { id: `ref${values.length + 1}`, title: '', author: '', year: '' }])}>添加文献</button></details>}
        <button className="primary" type="submit" disabled={!!busy}>选择位置并创建<Icon name="arrowRight" /></button>
      </form>
      <div className="paper-start-open"><button disabled={!!busy} onClick={() => void openProject('zip')}><Icon name="archive" />导入源文件 ZIP</button><button disabled={!!busy} onClick={() => void openProject('recent')}><Icon name="history" />打开最近项目</button></div>
      <PaperEnvironmentPanel runtime={runtime} onChange={refreshRuntime} />
    </div> : <>
      {project.origin && <div className="paper-notice"><span>来自 {project.origin.label} · Mark 修订 {project.origin.revision} · 生成源码只读</span><button disabled={!!busy || building} onClick={() => void perform('正在创建独立 LaTeX 项目…', async () => { const next = await api.paperDetach(project.id); if (next) { setOriginDocument(undefined); await enterProject(next) } })}>另存为独立 LaTeX</button></div>}
      {!project.trusted && <div className="paper-trust"><span><strong>此项目尚未启用编译</strong>LaTeX 项目可能执行代码。当前尚无操作系统级隔离，请仅编译你信任的项目。</span><button className="outline-button" disabled={!!busy} onClick={() => void perform('正在启用编译…', async () => acceptProject(await api.paperTrust(project.id)))}>信任并启用本地编译</button></div>}
      {runtime && !runtime.available && <div className="paper-notice paper-error" role="status"><span>{runtime.message}</span><button onClick={() => void refreshRuntime()}>重新检查编译环境</button></div>}

      <div className="paper-columns" data-settings={pageSettingsOpen ? "open" : undefined}>

        <section className="paper-source" aria-label="论文源码编辑" inert={pageSettingsOpen}><WorkspacePaneHeading className="paper-pane-heading"><span><Icon name="source" size={14} />{active || '选择源文件'}</span><span className="paper-file-state">{buffer ? buffer.content !== buffer.baseline ? '未保存' : '已保存' : ''}</span></WorkspacePaneHeading>
          {buffer?.conflict && <div className="paper-draft-conflict"><strong>草稿恢复后发现磁盘也已修改</strong><p>当前编辑区保留草稿。请核对磁盘版本，将需要的修改合并到编辑区。</p><details><summary>查看磁盘版本</summary><pre>{buffer.baseline}</pre></details><button className="outline-button" onClick={() => { updateBuffers({ ...buffersRef.current, [active]: { ...buffersRef.current[active], revision: buffer.diskRevision, conflict: false } }); drafted.current.delete(active) }}>已核对合并，允许保存当前内容</button></div>}
          <div className="paper-insert-toolbar" aria-label="论文插入工具"><button disabled={disabled} onClick={() => insert(paperSnippets.section)}>章节</button><button disabled={disabled} onClick={() => insert(paperSnippets.equation)}>公式</button><button disabled={disabled} onClick={() => void addFigure()}>图片</button><button disabled={disabled} onClick={() => insert(paperSnippets.table)}>表格</button><button disabled={disabled} onClick={() => void showCitations()}>引用</button><span className="spacer" />{project.origin && <button disabled={!buffer || !!busy} onClick={() => locateMark(active, buffer.content.slice(0, buffer.position.cursor).split("\n").length)}>定位原文 Mark</button>}<button className="paper-locate-pdf" title={artifact?.revision === revision ? '将当前源码位置定位到 PDF' : '重新编译后可定位到 PDF'} disabled={!!busy || !buffer || !artifact || artifact.revision !== revision} onClick={() => void locatePdf()}>定位 PDF</button><button className="icon-button" disabled={!buffer} aria-label="搜索论文源码" onClick={() => editor.current?.find()}><Icon name="search" size={14} /></button></div>
          {citationPicker && <div className="paper-citations"><div><input autoFocus aria-label="搜索文献标识" placeholder="搜索文献标识…" value={citationQuery} onChange={event => setCitationQuery(event.target.value)} /><button className="icon-button" aria-label="关闭文献选择" onClick={() => setCitationPicker(false)}><Icon name="close" size={14} /></button></div>{citations.length ? citations.map(item => <button key={item.key} onClick={() => { insert(`\\cite{${item.key}}`); setCitationPicker(false) }}><strong>{item.key}</strong><small>{item.file}</small></button>) : <p>项目中没有匹配的文献。可创建或编辑 .bib 文件后插入引用。</p>}</div>}
          <div className="paper-source-editor">{buffer ? <FormulaEditor ref={editor} completion={completion} completionEngine="latex" readOnly={!!project.origin || !!busy} documentKey={editorKeys.current.get(active) ?? `paper:${project.id}:${active}`} path={active} value={buffer.content} mode="latex-math" theme={theme} fontSize={fontSize} lineHeight={lineHeight} fontFamily={fontFamily} initialPosition={buffer.position} onChange={content => { const path = activeRef.current, current = buffersRef.current[path]; if (!current || current.content === content) return; updateBuffers({ ...buffersRef.current, [path]: { ...current, content } }); touch() }} onSave={() => void saveAll()} onPosition={position => { const current = buffersRef.current[activeRef.current]; if (current) current.position = position }} onComposition={value => { composing.current = value }} onNavigate={() => {}} onExternal={() => {}} /> : <div className="paper-source-empty">在左侧选择一个 .tex 或 .bib 文件。</div>}</div>
        </section>
        <div id="paper-page-config" ref={settingsPanel} className="paper-page-config-panel" data-open={pageSettingsOpen} aria-hidden={!pageSettingsOpen} inert={!pageSettingsOpen}>{project?.mainFile && buffers[project.mainFile] && <PaperPageSettings key={`${project.id}:${project.mainFile}`} active={pageSettingsOpen} source={buffers[project.mainFile].content} readOnly={!!project.origin} busy={!!busy || building} onClose={closePageSettings} onImportLogo={async () => {
      const selection = await api.paperImportAsset(project.id)
      if (!selection) return null
      acceptProject(selection.project); return selection.path
    }} onApply={content => {
      if (project.origin || composing.current || activeRef.current !== project.mainFile) throw new Error('请返回主文件后再应用页面设置。')
      editor.current?.replace(content); closePageSettings(); setNotice('页面设置已应用。编译后可查看实际分页；Ctrl+Z 可撤销。')
    }} />}</div>
        <PaperPdfPreview data={pdf} revision={artifact?.revision ?? null} stale={artifact?.revision !== revision} busy={building} location={pdfLocation} onLocate={artifact?.revision === revision ? (page, x, y) => void locateSource(page, x, y) : undefined} />
      </div>
      <section className={`paper-build-log${showLog ? ' expanded' : ''}`} aria-label="论文编译诊断"><button className="paper-log-toggle" onClick={() => setShowLog(value => !value)}><Icon name={showLog ? 'chevronDown' : 'chevronRight'} size={13} /><span>{result?.status === 'error' ? '编译未完成' : '编译日志'}</span>{result && <small>{result.diagnostics.length} 条诊断 · 源版本 {result.revision}</small>}<span className="spacer" /><small>{runtime?.label}</small></button>{showLog && <div className="paper-log-body">{result?.diagnostics.map((item, index) => <div className={`paper-diagnostic ${item.severity}`} key={index}><button disabled={!item.file || result.revision !== revision} onClick={() => locate(item)}>{item.file ?? '编译器'}{item.line ? `:${item.line}` : ''}</button><span>{item.message}</span>{project.origin && item.file && item.line && <button disabled={result.revision !== revision} onClick={() => locateMark(item.file!, item.line!)}>定位 Mark</button>}</div>)}{result?.revision !== undefined && result.revision !== revision && <p>诊断来自较早版本，重新编译后可定位。</p>}<pre>{result?.log || '编译后显示日志。编译不会自动保存或覆盖源码。'}</pre></div>}</section>
    </>}
  </section>
})

export default PaperWorkspace
