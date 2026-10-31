import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { Diagnostic } from '../compiler/types'
import type { CompilerAPI, CompilerExportResult, CompilerSelection, CompilerSession, CompilerSource, CompilerTarget } from '../shared/compilerUi'
import { Icon } from './Icons'
import { canLocateCompilerDiagnostic, compilerDiagnosticLocation, compilerDiagnosticReason } from './compilerDialogModel'
import './compiler-dialog.css'

export interface CompileCurrentDocument { content: string; root?: string; path?: string; label: string; documentKey: string }
interface Props {
  current?: CompileCurrentDocument
  onClose(): void
  onLocateMark?(diagnostic: Diagnostic, documentKey: string): void
}
type Success = Extract<CompilerExportResult, { status: 'success' }>

export default function CompileDialog({ current, onClose, onLocateMark }: Props) {
  // A modal operates on one frozen input, including unsaved content; it never saves the editor.
  const snapshot = useRef(current).current
  const api: CompilerAPI = window.oops
  const dialog = useRef<HTMLDialogElement>(null)
  const mounted = useRef(false), busyRef = useRef(false), composing = useRef(false), locating = useRef(false)
  const sessionRef = useRef<CompilerSession | null>(null)
  const [session, setSession] = useState<CompilerSession | null>(null)
  const [sourceKind, setSourceKind] = useState<CompilerSource['kind']>(snapshot ? 'current' : 'sample')
  const [target, setTarget] = useState<CompilerTarget>('docx')
  const [busy, setBusy] = useState('')
  const [fontFamily, setFontFamily] = useState('Microsoft YaHei')
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [success, setSuccess] = useState<Success | null>(null)
  const [status, setStatus] = useState('')
  const titleId = useId(), descriptionId = useId(), sourceName = useId(), targetName = useId()

  const release = (id: string) => { void api.compilerRelease(id).catch(() => { /* Closing never changes source files. */ }) }
  useLayoutEffect(() => {
    mounted.current = true
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.showModal()
    dialog.current?.querySelector<HTMLElement>('input[name]:checked')?.focus({ preventScroll: true })
    return () => {
      mounted.current = false
      dialog.current?.close()
      if (sessionRef.current) { release(sessionRef.current.id); sessionRef.current = null }
      if (!locating.current && previous?.isConnected && !previous.matches(':disabled') && !previous.closest('[inert]')) previous.focus({ preventScroll: true })
    }
  }, [])

  const close = () => { if (!busyRef.current && !composing.current) onClose() }
  const clearOutcome = () => { setDiagnostics([]); setSuccess(null); setStatus('') }
  const acceptSession = (next: CompilerSession) => {
    if (!mounted.current) { release(next.id); return }
    const previous = sessionRef.current
    sessionRef.current = next; setSession(next)
    if (previous && previous.id !== next.id) release(previous.id)
  }
  const perform = async (label: string, action: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(label); setStatus('')
    try { await action() }
    catch (cause) {
      if (mounted.current) {
        const message = String(cause instanceof Error ? cause.message : cause).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
        setDiagnostics([{ code: 'DESKTOP_ACTION', severity: 'error', message }])
      }
    } finally { busyRef.current = false; if (mounted.current) setBusy('') }
  }
  const ensureSession = async (): Promise<CompilerSession | null> => {
    if (sessionRef.current) return sessionRef.current
    const source: CompilerSource = sourceKind === 'current' && snapshot
      ? { kind: 'current', content: snapshot.content, root: snapshot.root, path: snapshot.path }
      : { kind: sourceKind === 'current' ? 'sample' : sourceKind }
    const next = await api.compilerCreate(source)
    if (next) acceptSession(next)
    return mounted.current ? next : null
  }
  const changeSource = (kind: CompilerSource['kind']) => {
    if (busyRef.current || kind === sourceKind) return
    if (sessionRef.current) release(sessionRef.current.id)
    sessionRef.current = null; setSession(null); setSourceKind(kind); clearOutcome()
  }
  const chooseFile = () => void perform('正在选择资料…', async () => {
    const next = await api.compilerCreate({ kind: 'file' })
    if (next && mounted.current) { acceptSession(next); clearOutcome() }
    else if (next) release(next.id)
  })
  const choose = (selection: CompilerSelection) => void perform('正在选择文件…', async () => {
    const active = await ensureSession()
    if (!active) return
    const next = await api.compilerChoose(active.id, selection, selection === 'font' ? fontFamily.trim() : undefined)
    if (next && mounted.current) { acceptSession(next); clearOutcome() }
  })
  const generate = () => void perform('正在准备资料…', async () => {
    const active = await ensureSession()
    if (!active) return
    setBusy('正在选择输出位置并生成文件…')
    const result = await api.compilerExport({ sessionId: active.id, target })
    if (!mounted.current) return
    if (result.status === 'cancelled') { setStatus('已取消输出选择，资料和设置已保留。'); return }
    if (result.status === 'error') { setSuccess(null); setDiagnostics(result.diagnostics); return }
    setDiagnostics([]); setSuccess(result); setStatus('生成完成。')
  })
  const locate = (diagnostic: Diagnostic) => {
    if (busyRef.current || !snapshot || !onLocateMark || !canLocateCompilerDiagnostic(diagnostic, session)) return
    locating.current = true
    dialog.current?.close()
    onClose()
    onLocateMark(diagnostic, snapshot.documentKey)
  }
  const renderDiagnostics = (items: Diagnostic[], warnings = false) => <section className={`compiler-diagnostics${warnings ? ' is-warning' : ''}`} aria-label={warnings ? '生成提示' : '生成诊断'}>
    <h3>{warnings ? '生成提示' : success ? '操作未完成' : '生成未完成'}</h3>
    <ul>{items.map((item, index) => {
      const reason = compilerDiagnosticReason(item), location = compilerDiagnosticLocation(item)
      return <li key={`${item.code}-${index}`}>
        <div className="compiler-diagnostic-reason">{reason}</div>
        {location && <div className="compiler-diagnostic-location">{location}</div>}
        {snapshot && onLocateMark && canLocateCompilerDiagnostic(item, session) && <button type="button" disabled={!!busy} onClick={() => locate(item)}>定位当前文档 Mark<Icon name="arrowRight" size={14} /></button>}
        <details className="compiler-diagnostic-details"><summary>详细信息 · {item.code}</summary><div>{item.message !== reason && <p>{item.message}</p>}{item.suggestion && <p>{item.suggestion}</p>}</div></details>
      </li>
    })}</ul>
  </section>

  return <dialog ref={dialog} className="modal compiler-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); close() }}
    onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
    onKeyDown={event => {
      if (!['Enter', 'Escape'].includes(event.key)) return
      if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) { event.preventDefault(); event.stopPropagation(); return }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    }}>
    <div className="compiler-heading"><h2 id={titleId}>生成 Word / PPT</h2><button className="icon-button" aria-label="关闭生成窗口" disabled={!!busy} onClick={close}><Icon name="close" /></button></div>
    <p className="compiler-intro" id={descriptionId}>将同一份资料生成报告或演示文稿。这里负责生成文件，后续请在 Word、PowerPoint 或 WPS 中查看和编辑。</p>
    <div className="compiler-body">
      <fieldset className="compiler-fieldset" disabled={!!busy}><legend>资料来源</legend>
        <div className="compiler-source-options">
          <label><input type="radio" name={sourceName} value="current" checked={sourceKind === 'current'} disabled={!snapshot || !!busy} onChange={() => changeSource('current')} /><span>当前 Markdown</span></label>
          <label><input type="radio" name={sourceName} value="sample" checked={sourceKind === 'sample'} onChange={() => changeSource('sample')} /><span>内置示例</span></label>
          <label><input type="radio" name={sourceName} value="file" checked={sourceKind === 'file'} onChange={() => changeSource('file')} /><span>本地资料</span></label>
        </div>
        <div className="compiler-source-summary">
          {sourceKind === 'current' ? <><strong>{snapshot?.label}</strong><span>使用打开本窗口时的内容，包含未保存修改；不会保存或改写原文。</span></> : sourceKind === 'sample' ? <><strong>青屿项目记录 · 虚构示例</strong><span>含文字、图片和表格；可直接生成，无需准备资料。</span></> : <><div className="compiler-file-choice"><span>{session?.sourceLabel ?? '选择 .md 或 MarkFlow 资料 .json 文件'}</span><button type="button" className="outline-button" onClick={chooseFile}>选择资料文件…</button></div><span>文件仅用于生成，不会导入或覆盖当前文档。</span></>}
        </div>
      </fieldset>
      <fieldset className="compiler-fieldset" disabled={!!busy}><legend>生成目标</legend>
        <div className="compiler-target-options">{([{ value: 'docx', label: 'Word 报告 (.docx)', detail: '连续文稿 · 文字、图片与表格' }, { value: 'pptx', label: 'PPT 演示 (.pptx)', detail: '固定版式 · 按资料自动组织页面' }] as const).map(option => <label key={option.value} data-selected={target === option.value}>
          <input type="radio" name={targetName} value={option.value} checked={target === option.value} onChange={() => { setTarget(option.value); clearOutcome() }} /><span><strong>{option.label}</strong><small>{option.detail}</small></span>
        </label>)}</div>
      </fieldset>
      <details className="compiler-advanced"><summary aria-disabled={!!busy} onClick={event => { if (busyRef.current) event.preventDefault() }}>高级设置<span>排版、素材、字体</span></summary>
        <fieldset disabled={!!busy} className="compiler-fieldset">
          <div className="compiler-setting-row"><div><strong>呈现规则</strong><span>{session?.presentationLabel ?? (sourceKind === 'sample' ? '内置示例布局 · 2 页报告 / 4 页演示' : '自动组织，使用固定排版')}</span></div><div className="compiler-setting-actions"><button type="button" onClick={() => choose('presentation')}>选择呈现 JSON…</button>{session?.presentationLabel && <button type="button" onClick={() => void perform('正在恢复默认布局…', async () => { const next = await api.compilerUseAutomatic(session.id); if (mounted.current) { acceptSession(next); clearOutcome() } })}>恢复默认布局</button>}</div></div>
          <div className="compiler-setting-row"><div><strong>素材文件夹</strong><span>{session?.assetRootLabel || (sourceKind === 'sample' ? '使用内置示例自带的素材' : sourceKind === 'current' && snapshot?.root ? '使用当前项目内的素材' : '尚未指定；资料含图片时，请选择素材文件夹')}</span></div><button type="button" onClick={() => choose('assets')}>选择素材文件夹…</button></div>
          <div className="compiler-font-setting"><strong>字体文件</strong><p>默认使用 Microsoft YaHei。需要其他字体或缺少默认字体时，在此指定本地文件；生成文件不嵌入字体。</p>
            {session?.fonts.length ? <ul className="compiler-font-list">{session.fonts.map(font => <li key={font.family}><span>{font.family}</span><code>{font.fileLabel}</code></li>)}</ul> : null}
            <div className="compiler-font-picker"><label>字体名称<input aria-label="字体名称" placeholder="例如 Microsoft YaHei" value={fontFamily} maxLength={200} onChange={event => setFontFamily(event.target.value)} /></label><button type="button" disabled={!!busy || !fontFamily.trim()} onClick={() => choose('font')}>选择字体文件…</button></div>
          </div>
        </fieldset>
      </details>
      {diagnostics.length > 0 && <div role="alert">{renderDiagnostics(diagnostics)}</div>}
      {success && <section className="compiler-success" aria-label="生成结果"><div className="compiler-success-heading"><Icon name="checkCircle" /><h3>生成完成</h3></div><div className="compiler-output-path">{success.path}</div><div className="compiler-success-actions"><button type="button" className="outline-button" disabled={!!busy} onClick={() => void perform('正在打开文件…', () => api.compilerOpen(success.artifactId))}>打开生成文件<Icon name="external" size={14} /></button><button type="button" disabled={!!busy} onClick={() => void perform('正在打开文件夹…', () => api.compilerOpen(success.artifactId, true))}>打开所在文件夹</button></div>{success.warnings.length > 0 && renderDiagnostics(success.warnings, true)}</section>}
    </div>
    <div className="compiler-footer"><span role="status" aria-live="polite">{busy || status || '原始资料保留；输出另存为新的 Office 文件。'}</span><button type="button" className="primary" disabled={!!busy || (sourceKind === 'file' && !session)} onClick={generate}>{busy ? '请稍候…' : '选择输出位置并生成'}</button></div>
  </dialog>
}
