import { useState, type Ref } from 'react'
import type { FontOption, Settings } from '../shared/types'
import type { CompletionEngine } from '../shared/completionSettings'
import CompletionSettings from './CompletionSettings'
import SelectControl from './SelectControl'
import ThresholdField from './ThresholdField'
import { Icon } from './Icons'
import './settings-panel.css'

export default function SettingsPanel({ settings, fonts, onChange, onClose, panelRef, engine, shortcut }: {
  settings: Settings; fonts: FontOption[]; onChange(patch: Partial<Settings>): Promise<void>; onClose(): void
  panelRef?: Ref<HTMLElement>; engine: CompletionEngine; shortcut: string
}) {
  const [section, setSection] = useState<'general' | 'completion'>('general'), [error, setError] = useState('')
  const commit = async (patch: Partial<Settings>) => { setError(''); try { await onChange(patch) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } }
  return <aside ref={panelRef} className={`panel settings-panel settings-${section}`} aria-label="设置" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
    <div className="panel-heading"><h2>设置</h2><button className="icon-button" aria-label="关闭面板" title="关闭面板 Esc" onClick={onClose}><Icon name="close" /></button></div>
    <nav className="settings-navigation segmented" aria-label="设置分类"><button className={section === 'general' ? 'active' : ''} aria-pressed={section === 'general'} onClick={() => setSection('general')}>通用</button><button className={section === 'completion' ? 'active' : ''} aria-pressed={section === 'completion'} onClick={() => setSection('completion')}>自动补全</button></nav>
    <div className="panel-content">
      {section === 'completion' ? <CompletionSettings value={settings.completion} initialEngine={engine} onChange={completion => onChange({ completion })} /> : <>
        <section className="settings-section"><h3>外观</h3><label className="field">主题<SelectControl aria-label="主题" value={settings.theme} onChange={event => void commit({ theme: event.target.value as Settings['theme'] })}><option value="system">跟随本机</option><option value="light">浅色</option><option value="dark">深色</option></SelectControl></label></section>
        <section className="settings-section"><h3>阅读</h3><label className="field">默认字体<SelectControl aria-label="默认字体" value={settings.fontFamily} onChange={event => void commit({ fontFamily: event.target.value as Settings['fontFamily'] })}>{fonts.map(font => <option key={font.id} value={font.id} disabled={!font.available}>{font.name}{!font.available ? ' · 未安装' : ''}</option>)}</SelectControl></label>
          <label className="field">默认字号 · {settings.fontSize}px<input aria-label="默认字号" type="range" min="12" max="28" value={settings.fontSize} onChange={event => void commit({ fontSize: +event.target.value })} /></label>
          <p className="muted">应用于未单独设置样式的内容。选中内容块后，可在工具栏单独调整。</p>
          <label className="field">行距 · {settings.lineHeight}<input type="range" min="1.2" max="2.5" step="0.1" value={settings.lineHeight} onChange={event => void commit({ lineHeight: +event.target.value })} /></label>
          <label className="field">阅读宽度 · {settings.lineWidth}px<input type="range" min="480" max="1200" step="20" value={settings.lineWidth} onChange={event => void commit({ lineWidth: +event.target.value })} /></label>
        </section>
        <section className="settings-section"><h3>版本记录</h3><label className="check"><input type="checkbox" checked={settings.autoCommit} onChange={event => void commit({ autoCommit: event.target.checked })} />字符阈值自动记录版本</label><ThresholdField value={settings.threshold} onCommit={threshold => onChange({ threshold })} /><p className="muted">按用户可见字符计算净修改。输入法确认后判断，撤销回到版本基线时归零。草稿独立保存在此设备。</p><p className="muted">{shortcut} 保存当前文档；启用 Git 后同时记录本地版本。同步需要手动触发。</p></section>
      </>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  </aside>
}
