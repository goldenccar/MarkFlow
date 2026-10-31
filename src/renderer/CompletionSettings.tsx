import { useMemo, useRef, useState } from 'react'
import { validateCompletionSettings, type CompletionEngine, type CompletionSettings as Settings, type EngineCompletionSettings } from '../shared/completionSettings'
import { builtinCompletionCommands } from './completion'
import { Icon } from './Icons'
import SelectControl from './SelectControl'
import './completion-settings.css'

interface Props { value: Settings; onChange(value: Settings): Promise<void>; disabled?: boolean; initialEngine?: CompletionEngine }
type CustomCommand = EngineCompletionSettings['customCommands'][number]
type Draft = CustomCommand & { isNew: boolean }
const engines = [
  { id: 'markdown', label: 'Markdown', hint: '实时编辑与源码共用这些规则。' },
  { id: 'formula', label: 'Fomula · 公式片段', hint: '用于即时数学公式，不影响完整文档。' },
  { id: 'latex', label: 'Fomula · LaTeX 文档', hint: '用于完整文档中的源文件编辑。' },
] as const

export default function CompletionSettings({ value, onChange, disabled = false, initialEngine = 'markdown' }: Props) {
  const [engine, setEngine] = useState<CompletionEngine>(initialEngine)
  const [query, setQuery] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [drafts, setDrafts] = useState<Partial<Record<CompletionEngine, Draft | null>>>({})
  const current = useRef(value), pending = useRef(false)
  current.current = value
  const config = value[engine], draft = drafts[engine], unavailable = disabled || saving
  const commands = useMemo(() => builtinCompletionCommands(engine), [engine])
  const matches = useMemo(() => commands.filter(command => `${command.label} ${command.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [commands, query])
  const enabledCount = commands.filter(command => !config.disabledCommands.includes(command.id)).length
  const updateDraft = (patch: Partial<Draft>) => setDrafts(previous => ({ ...previous, [engine]: previous[engine] ? { ...previous[engine]!, ...patch } : null }))
  const commit = async (next: EngineCompletionSettings, message = '已保存，立即生效') => {
    if (pending.current || disabled) return false
    pending.current = true; setSaving(true); setError(''); setNotice('')
    try {
      await onChange(validateCompletionSettings({ ...current.current, [engine]: next }))
      setNotice(message); return true
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return false }
    finally { pending.current = false; setSaving(false) }
  }
  const patch = (update: Partial<EngineCompletionSettings>) => commit({ ...current.current[engine], ...update })
  const saveRule = async () => {
    if (!draft) return
    const { isNew: _isNew, ...rule } = draft
    const existing = current.current[engine]
    const customCommands = existing.customCommands.some(command => command.id === rule.id)
      ? existing.customCommands.map(command => command.id === rule.id ? rule : command)
      : [...existing.customCommands, rule]
    if (await commit({ ...existing, customCommands }, '规则已保存')) setDrafts(previous => ({ ...previous, [engine]: null }))
  }
  const removeRule = async (command: CustomCommand) => {
    const existing = current.current[engine]
    if (await commit({ ...existing, customCommands: existing.customCommands.filter(item => item.id !== command.id), disabledCommands: existing.disabledCommands.filter(id => id !== `custom:${command.id}`) }, '规则已移除')) {
      if (draft?.id === command.id) setDrafts(previous => ({ ...previous, [engine]: null }))
    }
  }
  return <section className="completion-settings" aria-label="自动补全设置" aria-busy={saving}>
    <label className="field completion-engine">适用页面<SelectControl aria-label="补全适用页面" value={engine} disabled={unavailable} onChange={event => { setEngine(event.target.value as CompletionEngine); setQuery(''); setError(''); setNotice('') }}>{engines.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</SelectControl></label>
    <p className="completion-caption">{engines.find(item => item.id === engine)!.hint}</p>

    <div className="completion-preferences">
      <label className="completion-enabled"><span><strong>自动补全</strong><small>{config.enabled ? '输入斜线后显示候选提示' : '此页面已暂停补全，Tab 仍可缩进'}</small></span><input type="checkbox" aria-label="启用自动补全" disabled={unavailable} checked={config.enabled} onChange={event => void patch({ enabled: event.target.checked })} /></label>
      <fieldset className="completion-trigger-options" disabled={unavailable}><legend>触发符号</legend>{([['slash', '/'], ['backslash', '\\']] as const).map(([key, marker]) => <label key={key} data-checked={config.triggers[key]}><input type="checkbox" aria-label={`${marker} 触发补全`} checked={config.triggers[key]} onChange={event => void patch({ triggers: { ...config.triggers, [key]: event.target.checked } })} /><kbd>{marker}</kbd><span>{key === 'slash' ? '斜线' : '反斜线'}</span></label>)}</fieldset>
      {config.enabled && !config.triggers.slash && !config.triggers.backslash && <p className="completion-caption completion-paused">两个触发符均已关闭，当前不会弹出提示。</p>}
      <div className="completion-choice-grid">
        <label className="field">匹配方式<SelectControl aria-label="补全匹配方式" disabled={unavailable} value={config.matching} onChange={event => void patch({ matching: event.target.value as EngineCompletionSettings['matching'] })}><option value="contains">包含输入的字母</option><option value="prefix">以输入的字母开头</option></SelectControl></label>
        <label className="field">候选排序<SelectControl aria-label="补全候选排序" disabled={unavailable} value={config.sort} onChange={event => void patch({ sort: event.target.value as EngineCompletionSettings['sort'] })}><option value="usage">常用优先</option><option value="alphabetical">字母顺序</option></SelectControl></label>
      </div>
      <p className="completion-caption">匹配程度始终优先。常用排序只统计此页面类型在本机的使用情况。</p>
    </div>

    <details className="completion-builtins">
      <summary><Icon name="chevronRight" size={14} /><span>内置标记</span><small>{enabledCount} / {commands.length} 已启用</small></summary>
      <div className="completion-builtin-content">
        <label className="completion-filter"><Icon name="search" size={14} /><input aria-label="搜索内置补全标记" placeholder="搜索名称或用途" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className="completion-command-list">{matches.length ? matches.map(command => <label className="completion-command" key={command.id} title={command.preview}><input type="checkbox" aria-label={`启用内置 ${command.label}`} disabled={unavailable} checked={!config.disabledCommands.includes(command.id)} onChange={event => void patch({ disabledCommands: event.target.checked ? config.disabledCommands.filter(id => id !== command.id) : [...config.disabledCommands, command.id] })} /><code>{command.label}</code><span>{command.description}</span></label>) : <p className="completion-caption">没有匹配的标记。</p>}</div>
      </div>
    </details>

    <section className="completion-custom" aria-label="自定义补全规则">
      <div className="completion-section-heading"><h3>自定义规则</h3><small>{config.customCommands.length} / 32</small><button className="outline-button" disabled={unavailable || !!draft || config.customCommands.length >= 32} onClick={() => { setDrafts(previous => ({ ...previous, [engine]: { id: crypto.randomUUID(), trigger: '', description: '', content: '', isNew: true } })); setError(''); setNotice('') }}><Icon name="plus" size={14} />添加</button></div>
      <p className="completion-caption">同名规则覆盖此页面的内置提示。补全只插入内容，不执行命令。</p>
      {!config.customCommands.length && !draft && <div className="completion-custom-empty">把常用内容保存为简短的触发词。</div>}
      {config.customCommands.length > 0 && <div className="completion-custom-list">{config.customCommands.map(command => <div className="completion-custom-row" key={command.id}><button className="completion-rule-edit" title="编辑规则" disabled={unavailable || !!draft} onClick={() => { setDrafts(previous => ({ ...previous, [engine]: { ...command, isNew: false } })); setError(''); setNotice('') }}><code>{command.trigger}</code><span>{command.description || '未填写提示说明'}</span><Icon name="edit" size={14} /></button><button className="icon-button completion-rule-delete" title="移除规则" aria-label={`移除规则 ${command.trigger}`} disabled={unavailable} onClick={() => void removeRule(command)}><Icon name="trash" size={14} /></button></div>)}</div>}
      {draft && <form className="completion-rule-form" aria-label={draft.isNew ? '新增补全规则' : '编辑补全规则'} onSubmit={event => { event.preventDefault(); void saveRule() }}>
        <label className="field">触发词<input aria-label="自定义补全触发词" autoFocus required maxLength={32} pattern="[A-Za-z][A-Za-z0-9]{0,31}" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder={engine === 'markdown' ? 'meeting' : 'matrix'} value={draft.trigger} disabled={unavailable} onChange={event => updateDraft({ trigger: event.target.value })} /><small>字母开头，最多 32 个字母或数字，不含斜线。</small></label>
        <label className="field">提示说明<input aria-label="自定义补全提示说明" maxLength={120} placeholder="说明这条规则的用途" value={draft.description} disabled={unavailable} onChange={event => updateDraft({ description: event.target.value })} /></label>
        <label className="field">插入内容<textarea aria-label="自定义补全插入内容" required maxLength={4096} rows={5} spellCheck={false} placeholder={engine === 'markdown' ? '## 会议记录\n\n- 议题：\n- 结论：' : '\\begin{pmatrix}\na & b \\\\\nc & d\n\\end{pmatrix}'} value={draft.content} disabled={unavailable} onChange={event => updateDraft({ content: event.target.value })} /><small>保留换行，最多 4,096 字符。点击保存后生效。</small></label>
        <div className="completion-rule-actions"><button type="button" disabled={unavailable} onClick={() => { setDrafts(previous => ({ ...previous, [engine]: null })); setError('') }}>取消</button><button type="submit" className="primary" disabled={unavailable}><Icon name="check" size={14} />保存规则</button></div>
      </form>}
    </section>
    <div className="completion-save-state" aria-live="polite">{error ? <p role="alert" className="completion-error">{error}</p> : <span>{saving ? '正在保存…' : notice}</span>}</div>
    <p className="completion-footnote"><kbd>Tab</kbd> 接受提示；没有提示时缩进。<kbd>Shift Tab</kbd> 取消一级缩进。</p>
  </section>
}
