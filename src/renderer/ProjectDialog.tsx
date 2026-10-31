import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { ProjectLinkInfo } from '../shared/types'
import { Icon } from './Icons'
import { isExternalShare } from './projectState'
import './project-controls.css'

type Props = {
  onClose(): void
  onLocal(): Promise<boolean>
  onCreate(name: string): Promise<boolean>
  onClone(remote: string, name: string): Promise<boolean>
  onReuse(root: string): Promise<boolean>
  onRelocate(root: string): Promise<boolean>
  inspect(url: string): Promise<ProjectLinkInfo>
}

export default function ProjectDialog(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const [mode, setMode] = useState<'choices' | 'create' | 'link'>('choices')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [info, setInfo] = useState<ProjectLinkInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const mounted = useRef(true)
  const composing = useRef(false)
  const external = isExternalShare(url)
  useLayoutEffect(() => {
    mounted.current = true
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => { mounted.current = false; generation.current++; dialog.current?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  const perform = async (operation: () => Promise<boolean>) => {
    if (busy) return
    setBusy(true); setError('')
    try { if (await operation()) props.onClose() } catch (cause) { if (mounted.current) setError(String(cause instanceof Error ? cause.message : cause).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
    finally { if (mounted.current) setBusy(false) }
  }
  const inspect = async () => {
    const request = ++generation.current
    setBusy(true); setInfo(null); setError('')
    try { const result = await props.inspect(url); if (mounted.current && request === generation.current) { setInfo(result); setName(result.name) } }
    catch (cause) { if (mounted.current && request === generation.current) setError(String(cause instanceof Error ? cause.message : cause).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
    finally { if (mounted.current && request === generation.current) setBusy(false) }
  }
  return <dialog ref={dialog} className="modal project-dialog" aria-labelledby={title} onCancel={event => { event.preventDefault(); if (!busy && !composing.current) props.onClose() }}
    onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
    onKeyDown={event => { if (['Enter', 'Escape'].includes(event.key) && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) { event.preventDefault(); event.stopPropagation() } }}>
    <div className="project-dialog-heading"><h2 id={title}>{mode === 'choices' ? '添加项目' : mode === 'create' ? '新建项目' : '从链接获取项目'}</h2><button className="icon-button" aria-label="关闭项目窗口" disabled={busy} onClick={props.onClose}><Icon name="close" /></button></div>
    {mode === 'choices' ? <div className="project-entry-options">
      <button disabled={busy} onClick={() => { setMode('create'); setName('新项目') }}><Icon name="folderPlus" /><span><strong>新建项目</strong><small>选择位置，创建一个新文件夹</small></span><Icon name="chevronRight" /></button>
      <button disabled={busy} onClick={() => void perform(props.onLocal)}><Icon name="folderOpen" /><span><strong>打开本地项目</strong><small>已有文件夹，包括云盘已同步的文件夹</small></span><Icon name="chevronRight" /></button>
      <button disabled={busy} onClick={() => setMode('link')}><Icon name="gitBranch" /><span><strong>从链接获取</strong><small>识别 GitHub 仓库与已登记的本地副本</small></span><Icon name="chevronRight" /></button>
    </div> : <form onSubmit={event => { event.preventDefault(); if (busy || composing.current) return; if (mode === 'create') void perform(() => props.onCreate(name.trim())); else if (!external && !info) void inspect() }}>
      {mode === 'create' ? <><label className="field">项目名称<input autoFocus aria-label="项目名称" value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label><p>下一步选择父文件夹。不会覆盖同名目录。</p><button className="primary full" disabled={busy || !name.trim()} type="submit">选择位置并创建</button></> : <>
        <label className="field">项目链接<input autoFocus aria-label="项目链接" placeholder="https://github.com/owner/repository" value={url} disabled={busy} onChange={event => { generation.current++; setUrl(event.target.value); setInfo(null); setError('') }} /></label>
        {external ? <div className="project-link-hint"><p>坚果云分享链接不能直接作为 Git 仓库。请先用云盘客户端同步，然后选择此设备上的本地文件夹。</p><button type="button" disabled={busy} onClick={() => void perform(props.onLocal)}>选择已同步的本地文件夹</button></div> : <button type="submit" disabled={busy || !url.trim()}>{busy ? '正在识别…' : '识别链接'}</button>}
        {info && <div className="project-link-result"><p className="muted">{info.remote}</p>{info.matches.length > 0 ? <><h3>已登记的本地副本</h3><p>优先继续已有副本；新副本会放到另一个新目录。</p><div className="project-matches">{info.matches.map((match, index) => <div className="project-match" key={match.root}><div><strong>{match.available ? '本地可用' : '位置已缺失'}</strong><code>{match.root}</code><small>分支：{match.branch || '未知'}</small></div><button type="button" className={index === 0 && match.available ? 'primary' : ''} disabled={busy} onClick={() => void perform(() => match.available ? props.onReuse(match.root) : props.onRelocate(match.root))}>{match.available ? '打开此副本' : '重新定位'}</button></div>)}</div></> : <p>未找到已登记的本地副本。可获取到一个新文件夹。</p>}
          <label className="field">新副本名称<input aria-label="新副本名称" disabled={busy} value={name} onChange={event => setName(event.target.value)} /></label><button type="button" disabled={busy || !name.trim()} onClick={() => void perform(() => props.onClone(info.remote, name.trim()))}>{info.matches.length ? '获取新副本…' : '选择位置并获取'}</button>
        </div>}
      </>}
    </form>}
    {error && <p className="warning" role="alert">{error}</p>}
    <div className="project-dialog-footer">{mode !== 'choices' && <button disabled={busy} onClick={() => { setMode('choices'); setError('') }}>返回</button>}<span className="muted" role="status">{busy ? '请等待当前操作完成…' : '项目保存在本地；新文档仍从独立草稿开始。'}</span></div>
  </dialog>
}
