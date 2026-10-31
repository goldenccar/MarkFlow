/** Both TeX renderers share one visible workspace; their document models stay independent. */
export default function FomulaModeSwitch({ mode, onChange, disabled = false }: {
  mode: 'fragment' | 'document'; onChange(mode: 'fragment' | 'document'): void; disabled?: boolean
}) {
  return <div className="fomula-mode-switch segmented" aria-label="Fomula 内容类型">
    {([['fragment', '公式片段'], ['document', 'LaTeX 文档']] as const).map(([value, label]) =>
      <button key={value} type="button" disabled={disabled} aria-pressed={mode === value} className={mode === value ? 'active' : ''} onClick={() => { if (mode !== value) onChange(value) }}>{label}</button>)}
  </div>
}
