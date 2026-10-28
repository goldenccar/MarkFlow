import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from './Icons'
import './threshold-field.css'

interface Props {
  value: number
  onCommit: (value: number) => Promise<void>
}

export default function ThresholdField({ value, onCommit }: Props) {
  const [draft, setDraft] = useState(String(value))
  const [error, setError] = useState<'invalid' | 'save' | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const fieldId = useId(), helpId = useId()
  const edited = useRef(false)
  const pending = useRef(false)
  const saved = useRef(value)
  saved.current = value

  useEffect(() => {
    if (!edited.current) { setDraft(String(value)); setError(null) }
  }, [value])

  const commit = async (text: string) => {
    if (pending.current) return
    const input = text.trim(), next = Number(input)
    if (!/^\d+$/.test(input) || !Number.isSafeInteger(next) || next < 1) {
      setError('invalid')
      return
    }
    setError(null)
    if (next === saved.current) { edited.current = false; setDraft(String(next)); return }
    pending.current = true
    setSaving(true)
    setConfirmed(false)
    try {
      await onCommit(next)
      edited.current = false
      setDraft(String(next))
      setConfirmed(true)
    } catch {
      setError('save')
    } finally {
      pending.current = false
      setSaving(false)
    }
  }

  const dirty = draft.trim() !== String(value)
  const state = saving ? 'saving' : confirmed && !dirty ? 'saved' : dirty ? 'ready' : 'idle'
  const hint = error === 'invalid' ? '请输入大于 0 的整数。'
    : error === 'save' ? '保存失败，修改已保留，请重试。'
    : saving ? '正在保存设置…'
    : dirty ? `尚未保存 · 当前生效 ${value} 字符`
    : confirmed ? `已保存 · 当前阈值 ${value} 字符`
    : '修改后点击保存，或按 Enter 确认。'

  return <div className="field threshold-field">
    <label htmlFor={fieldId}>有效修改量阈值</label>
    <div className="threshold-controls">
      <div className="threshold-input">
      <input id={fieldId} type="text" inputMode="numeric" value={draft} disabled={saving} aria-invalid={!!error} aria-describedby={helpId}
      onChange={event => { edited.current = true; setDraft(event.target.value); setError(null); setConfirmed(false) }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.key === 'Enter') { event.preventDefault(); void commit(event.currentTarget.value) }
        if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation()
          if (!pending.current) { edited.current = false; setDraft(String(saved.current)); setError(null); setConfirmed(false) }
        }
      }} />
      <span className="threshold-unit" aria-hidden="true">字符</span>
      </div>
      <button type="button" className="threshold-save" data-state={state} disabled={saving || !dirty} aria-label="保存修改量阈值" aria-busy={saving} onClick={() => void commit(draft)}>
        <Icon name={saving ? 'clock' : state === 'saved' ? 'check' : 'save'} size={14} />
        <span>{saving ? '保存中…' : state === 'saved' ? '已保存' : '保存'}</span>
      </button>
    </div>
    <span id={helpId} className={error ? 'field-error' : state === 'saved' ? 'field-success' : 'field-hint'} role="status">{hint}</span>
  </div>
}
