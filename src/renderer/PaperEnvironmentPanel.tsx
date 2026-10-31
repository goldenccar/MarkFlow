import { useEffect, useState } from 'react'
import type { PaperEnvironmentStatus, PaperRuntimeStatus } from '../shared/paper'
import { Icon } from './Icons'

export default function PaperEnvironmentPanel({ runtime, onChange }: { runtime: PaperRuntimeStatus | null; onChange(): Promise<void> }) {
  const [status, setStatus] = useState<PaperEnvironmentStatus | null>(null), [working, setWorking] = useState(false), [error, setError] = useState('')
  useEffect(() => { let live = true; void window.oops.paperEnvironment().then(value => { if (live) setStatus(value) }).catch(cause => { if (live) setError(String(cause)) }); return () => { live = false } }, [])
  useEffect(() => {
    if (!working) return
    let live = true
    const timer = setInterval(() => { void window.oops.paperEnvironment().then(value => { if (live) setStatus(value) }).catch(() => {}) }, 500)
    return () => { live = false; clearInterval(timer) }
  }, [working])
  const act = async (operation: () => Promise<PaperEnvironmentStatus | null>) => {
    setWorking(true); setError('')
    try { const next = await operation(); if (next) setStatus(next); await onChange() }
    catch (cause) { setError(String(cause).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
    finally { setWorking(false) }
  }
  return <section className="paper-environment" aria-label="论文编译环境">
    <div className="paper-runtime"><Icon name={runtime?.available ? 'checkCircle' : 'settings'} /><span><strong>{runtime?.available ? '论文环境已就绪' : '安装论文环境'}</strong><small>{status?.activeVersion ?? runtime?.label} · 编译器、中文字体和文献工具</small><small>{error || (working || status?.error || status?.phase === 'cancelled' ? status?.message : '安装一次后可离线使用，不改变系统环境。')}</small></span></div>
    {working && <progress aria-label="论文环境安装进度" max={100} value={status?.progress ?? 0} />}
    <div className="paper-environment-actions">
      {working ? <button className="outline-button" onClick={() => void window.oops.paperCancelEnvironment().catch(cause => setError(String(cause)))}>取消安装</button> : <>
        <button className="outline-button" disabled={!status?.availableBundle} onClick={() => void act(() => window.oops.paperInstallEnvironment())}>{status?.activeVersion ? '重新安装论文环境' : '安装论文环境'}</button>
        <button onClick={() => void act(() => window.oops.paperInstallEnvironment(true))}>导入离线环境包</button>
        {status?.canRollback && <button onClick={() => void act(() => window.oops.paperRollbackEnvironment())}>回退上一版本</button>}
        <button onClick={() => void act(() => window.oops.paperEnvironment())}>重新检查</button>
      </>}
    </div>
  </section>
}
