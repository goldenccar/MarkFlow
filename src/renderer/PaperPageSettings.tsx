import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { applyPaperPageSettings, defaultPaperPageSettings, paperDimensions, readPaperPageSettings, validatePaperPageSettings, type PageSlot, type PaperPageSettings as Settings } from '../shared/paperPageSettings'
import { Icon } from './Icons'
import SelectControl from './SelectControl'
import './paper-page-settings.css'

interface Props {
  source: string
  active?: boolean
  readOnly?: boolean
  busy?: boolean
  onApply(source: string): void | Promise<void>
  onClose(): void
  onImportLogo?(): Promise<string | null>
}
const positions: [PageSlot, string][] = [['left', '左侧'], ['center', '居中'], ['right', '右侧']]
const marginNames = { top: '上', bottom: '下', left: '左', right: '右' }
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

export default function PaperPageSettings({ source, active = true, readOnly, busy, onApply, onClose, onImportLogo }: Props) {
  const initial = useMemo(() => active ? readPaperPageSettings(source) : null, [active, source])
  const [settings, setSettings] = useState(() => initial?.settings ?? defaultPaperPageSettings())
  const loadedSource = useRef(active ? source : null)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [working, setWorking] = useState(false)
  useEffect(() => {
    if (active && initial && loadedSource.current !== source) {
      loadedSource.current = source; setSettings(initial.settings); setError(''); setNotice('')
    }
  }, [active, initial, source])
  const unavailable = !!(readOnly || busy || working || initial?.error)
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => { setSettings(previous => ({ ...previous, [key]: value })); setError(''); setNotice('') }
  const apply = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setNotice(''); setWorking(true)
    try { await onApply(applyPaperPageSettings(source, settings)); setNotice('页面设置已应用，可在编辑器中撤销。编译后查看实际 PDF。') }
    catch (cause) { setError(message(cause)) }
    finally { setWorking(false) }
  }
  const importLogo = async () => {
    if (!onImportLogo) return
    setWorking(true); setError('')
    try {
      const path = await onImportLogo()
      if (path) { const logo = { path, position: settings.logo?.position ?? 'left', widthMm: settings.logo?.widthMm ?? 20 }; validatePaperPageSettings({ ...settings, logo }); update('logo', logo) }
    } catch (cause) { setError(message(cause)) }
    finally { setWorking(false) }
  }
  return <section className="paper-page-settings" aria-label="页面设置" onKeyDown={event => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); onClose() }
  }}>
    <header className="pps-heading"><div><h2>页面设置</h2><p>一次配置纸张、正文和页眉页脚，应用到当前文档。</p></div><button type="button" className="icon-button" title="关闭页面设置" aria-label="关闭页面设置" onClick={onClose}><Icon name="close" /></button></header>
    <form onSubmit={event => void apply(event)}>
      <div className="pps-layout">
        <fieldset className="pps-fields" disabled={unavailable}>
          <section className="pps-section"><h3>纸张与版心</h3><div className="pps-grid">
            <label>纸张<SelectControl value={settings.paper} onChange={event => update('paper', event.target.value as Settings['paper'])}><option value="a4">A4 · 210 × 297 mm</option><option value="a5">A5 · 148 × 210 mm</option><option value="letter">Letter · 216 × 279 mm</option></SelectControl></label>
            <label>方向<SelectControl value={settings.orientation} onChange={event => update('orientation', event.target.value as Settings['orientation'])}><option value="portrait">纵向</option><option value="landscape">横向</option></SelectControl></label>
          </div><div className="pps-margins">{(Object.keys(marginNames) as (keyof Settings['margins'])[]).map(side => <label key={side}>{marginNames[side]}边距 <span>mm</span><input aria-label={`${marginNames[side]}边距（毫米）`} type="number" min="8" max="60" step="0.5" value={settings.margins[side]} onChange={event => update('margins', { ...settings.margins, [side]: Number(event.target.value) })} /></label>)}</div></section>
          <section className="pps-section"><h3>正文排版</h3><div className="pps-grid">
            <label>分栏<SelectControl value={settings.columns} onChange={event => update('columns', Number(event.target.value) as 1 | 2)}><option value="1">单栏</option><option value="2">双栏</option></SelectControl></label>
            <label>正文字号<SelectControl value={settings.fontSize} onChange={event => update('fontSize', Number(event.target.value) as Settings['fontSize'])}>{[10, 11, 12].map(size => <option key={size} value={size}>{size} pt</option>)}</SelectControl></label>
            <label>行距<SelectControl value={settings.lineSpacing} onChange={event => update('lineSpacing', Number(event.target.value))}>{[1, 1.25, 1.5, 2, 2.5].map(value => <option key={value} value={value}>{value} 倍</option>)}</SelectControl></label>
            <label>段首缩进 <span>字宽</span><input type="number" min="0" max="4" step="0.5" value={settings.indentEm} onChange={event => update('indentEm', Number(event.target.value))} /></label>
          </div></section>
          <section className="pps-section"><h3>页眉与页脚</h3>
            {(['header', 'footer'] as const).map(place => <div className="pps-slots" key={place}><span>{place === 'header' ? '页眉' : '页脚'}</span>{positions.map(([position, label]) => <label key={position}><span>{label}</span><input aria-label={`${place === 'header' ? '页眉' : '页脚'} ${label}`} maxLength={160} placeholder="留空" value={settings[place][position]} onChange={event => update(place, { ...settings[place], [position]: event.target.value })} /></label>)}</div>)}
            <p className="pps-hint">可填写普通文字，或用 {'{title}'}、{'{author}'}、{'{page}'}、{'{pages}'} 插入标题、作者、页码和总页数。</p>
            <label className="pps-page-number">页码位置<SelectControl value={settings.pageNumber} onChange={event => update('pageNumber', event.target.value as Settings['pageNumber'])}><option value="none">不另加页码</option>{(['footer', 'header'] as const).flatMap(place => positions.map(([position, label]) => <option key={`${place}-${position}`} value={`${place}-${position}`}>{place === 'header' ? '页眉' : '页脚'} · {label}</option>))}</SelectControl></label>
            <div className="pps-checks"><label><input type="checkbox" checked={settings.hideFirstPage} onChange={event => update('hideFirstPage', event.target.checked)} />首页隐藏页眉页脚</label><label><input type="checkbox" checked={settings.headerRule} onChange={event => update('headerRule', event.target.checked)} />页眉分隔线</label></div>
            <div className="pps-logo"><div><strong>页眉图片</strong><small>{settings.logo ? settings.logo.path.split('/').at(-1) : '添加标志或其他图片，保持比例自动适配。'}</small></div><button type="button" className="outline-button" disabled={!onImportLogo} onClick={() => void importLogo()}>{settings.logo ? '更换图片' : '选择图片'}</button>{settings.logo && <button type="button" aria-label="移除页眉图片" onClick={() => update('logo', null)}>移除</button>}</div>
            {settings.logo && <div className="pps-grid"><label>图片位置<SelectControl value={settings.logo.position} onChange={event => update('logo', { ...settings.logo!, position: event.target.value as PageSlot })}>{positions.map(([position, label]) => <option key={position} value={position}>{label}</option>)}</SelectControl></label><label>图片最大宽度 <span>mm</span><input type="number" min="8" max="50" step="1" value={settings.logo.widthMm} onChange={event => update('logo', { ...settings.logo!, widthMm: Number(event.target.value) })} /></label></div>}
          </section>
        </fieldset>
        <PageDiagram settings={settings} />
      </div>
      {(readOnly || initial?.error || error) && <p className="pps-error" role="alert">{readOnly ? '当前为自动生成的只读源码。请先创建独立副本，再调整页面。' : error || initial?.error}</p>}
      {notice && <p className="pps-notice" role="status">{notice}</p>}
      <footer className="pps-actions"><span>设置会写入主文档，可随文档一起保存。</span><button type="submit" className="primary" disabled={unavailable}>{working ? '正在应用…' : '应用页面设置'}</button></footer>
    </form>
  </section>
}

function PageDiagram({ settings }: { settings: Settings }) {
  const [width, height] = paperDimensions(settings)
  const percent = (value: number, dimension: number) => `${Math.min(45, Math.max(0, value / dimension * 100))}%`
  const slotText = (place: 'header' | 'footer', slot: PageSlot) => (settings[place][slot].replace(/\{(?:page|pages|title|author)\}/g, value => ({ '{page}': '1', '{pages}': '3', '{title}': '文档标题', '{author}': '作者' })[value]!) + (settings.pageNumber === `${place}-${slot}` ? ' 1' : '')).trim()
  return <aside className="pps-preview"><div className="pps-paper" style={{ aspectRatio: `${width}/${height}` }} aria-label="页面布局示意">
    <div className="pps-print-area" style={{ top: percent(settings.margins.top, height), bottom: percent(settings.margins.bottom, height), left: percent(settings.margins.left, width), right: percent(settings.margins.right, width) }}>
      <div className={`pps-diagram-slots${settings.headerRule ? ' has-rule' : ''}`}>{positions.map(([slot]) => <span key={slot}>{settings.logo?.position === slot && <i>图片</i>}{slotText('header', slot)}</span>)}</div>
      <div className="pps-diagram-body" style={{ gridTemplateColumns: `repeat(${settings.columns},1fr)` }}>{Array.from({ length: settings.columns }, (_, column) => <div key={column}>{Array.from({ length: 12 }, (_, row) => <i key={row} style={{ marginBottom: `${settings.lineSpacing * 2 + 2}px`, width: row === 0 ? `${100 - settings.indentEm * 5}%` : row === 5 || row === 11 ? '64%' : '100%', marginLeft: row === 0 ? 'auto' : undefined }} />)}</div>)}</div>
      <div className="pps-diagram-slots">{positions.map(([slot]) => <span key={slot}>{slotText('footer', slot)}</span>)}</div>
    </div>
  </div><strong>{settings.paper.toUpperCase()} · {settings.orientation === 'portrait' ? '纵向' : '横向'}</strong><p>页面比例示意{settings.hideFirstPage ? '（显示非首页）' : ''}<br />最终效果以编译后的 PDF 为准。</p></aside>
}
