import { defaultCompletionSettings, type CompletionEngine, type EngineCompletionSettings } from '../shared/completionSettings'
export type CompletionMode = CompletionEngine
export interface SlashToken { from: number; to: number; marker: '/' | '\\'; query: string }
export interface SlashCommand {
  id: string; label: string; description: string; insert: string; preview: string
  custom?: boolean
  block?: 'heading1' | 'heading2' | 'heading3' | 'bulletList' | 'orderedList' | 'taskList' | 'blockquote' | 'codeBlock' | 'table' | 'mathBlock'
}
const markdown: SlashCommand[] = [
  { id: 'heading1', label: 'h1', description: '一级标题', insert: '# ', preview: '# 标题', block: 'heading1' },
  { id: 'heading2', label: 'h2', description: '二级标题', insert: '## ', preview: '## 标题', block: 'heading2' },
  { id: 'heading3', label: 'h3', description: '三级标题', insert: '### ', preview: '### 标题', block: 'heading3' },
  { id: 'bulletList', label: 'list', description: '无序列表', insert: '- ', preview: '• 列表项', block: 'bulletList' },
  { id: 'orderedList', label: 'number', description: '有序列表', insert: '1. ', preview: '1. 列表项', block: 'orderedList' },
  { id: 'taskList', label: 'todo', description: '待办事项', insert: '- [ ] ', preview: '☐ 待办事项', block: 'taskList' },
  { id: 'blockquote', label: 'quote', description: '引用', insert: '> ', preview: '> 引用内容', block: 'blockquote' },
  { id: 'codeBlock', label: 'code', description: '代码块', insert: '```\n\n```', preview: '``` 代码 ```', block: 'codeBlock' },
  { id: 'table', label: 'table', description: '两列表格', insert: '| 标题 | 标题 |\n| --- | --- |\n|  |  |', preview: '标题 │ 标题', block: 'table' },
  { id: 'mathBlock', label: 'math', description: '独立公式', insert: '$$\n\n$$', preview: '$$ 公式 $$', block: 'mathBlock' },
]
const tex = [
  ['frac', '分数', '\\frac{}{}'], ['sqrt', '平方根', '\\sqrt{}'],
  ['sum', '求和', '\\sum_{i=1}^{n}'], ['int', '积分', '\\int_{a}^{b}'],
  ['lim', '极限', '\\lim_{x\\to 0}'], ['alpha', '希腊字母 α', '\\alpha'],
  ['beta', '希腊字母 β', '\\beta'], ['gamma', '希腊字母 γ', '\\gamma'],
  ['theta', '希腊字母 θ', '\\theta'], ['pi', '圆周率 π', '\\pi'],
  ['infty', '无穷 ∞', '\\infty'], ['times', '乘号 ×', '\\times'],
  ['cdot', '点乘 ·', '\\cdot'], ['leq', '小于等于 ≤', '\\leq'],
  ['geq', '大于等于 ≥', '\\geq'], ['neq', '不等于 ≠', '\\neq'],
  ['text', '公式中的文字', '\\text{}'], ['mathbf', '粗体数学字母', '\\mathbf{}'],
  ['aligned', '多行对齐公式', '\\begin{aligned}\n  a &= b \\\\\n  c &= d\n\\end{aligned}'],
  ['pmatrix', '带括号的矩阵', '\\begin{pmatrix}\n  a & b \\\\\n  c & d\n\\end{pmatrix}'],
].map(([label, description, insert]) => ({ id: `tex:${label}`, label, description, insert, preview: insert }))
const documentTex = [
  ['section', '章节标题', '\\section{}'], ['subsection', '小节标题', '\\subsection{}'],
  ['label', '设置交叉引用标签', '\\label{}'], ['ref', '引用章节或图表编号', '\\ref{}'],
  ['cite', '引用参考文献', '\\cite{}'], ['textbf', '粗体文字', '\\textbf{}'],
  ['emph', '强调文字', '\\emph{}'], ['itemize', '无序列表环境', '\\begin{itemize}\n  \\item \n\\end{itemize}'],
  ['enumerate', '有序列表环境', '\\begin{enumerate}\n  \\item \n\\end{enumerate}'],
  ['figure', '图片环境', '\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{}\n  \\caption{}\n\\end{figure}'],
  ['table', '表格环境', '\\begin{table}[htbp]\n  \\centering\n  \\begin{tabular}{ll}\n    A & B \\\\\n  \\end{tabular}\n  \\caption{}\n\\end{table}'],
  ['newpage', '另起一页', '\\newpage\n'],
].map(([label, description, insert]) => ({ id: `tex:${label}`, label, description, insert, preview: insert }))
export const slashCommands: readonly SlashCommand[] = [...markdown, ...tex, ...documentTex]
const knownIds = new Set(slashCommands.map(command => command.id))
export function builtinCompletionCommands(engine: CompletionEngine): readonly SlashCommand[] {
  return engine === 'markdown' ? [...markdown, ...tex] : engine === 'formula' ? tex : [...tex, ...documentTex]
}

/** Only a fresh token is eligible: never a URL, fraction, escaped slash or command interior. */
export function slashToken(before: string, after = '', mode: CompletionMode = 'latex', settings = defaultCompletionSettings[mode]): SlashToken | null {
  if (!settings.enabled) return null
  const match = /([/\\])([a-zA-Z0-9]*)$/.exec(before)
  if (!match || /[a-zA-Z0-9]/.test(after[0] ?? '')) return null
  const prefix = before.slice(0, match.index), marker = match[1] as SlashToken['marker']
  if (!settings.triggers[marker === '/' ? 'slash' : 'backslash']) return null
  if (prefix && !/[\s([{=$+*^-]$/.test(prefix)) return null
  if (marker === '/' && (/[\p{L}\p{N})\]}]\s*$/u.test(prefix) || mode === 'markdown' && prefix.trim())) return null
  return { from: match.index, to: before.length, marker, query: match[2].toLowerCase() }
}
export type CompletionUsage = Record<string, { count: number; last: number }>
export const completionUsageKey = 'rea-office:completion-usage:v2'
export function parseCompletionUsage(raw: string | null): CompletionUsage {
  const result: CompletionUsage = Object.create(null)
  try {
    if (!raw || raw.length > 16_384) return result
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result
    for (const [id, entry] of Object.entries(value).slice(0, 128)) {
      if (!(knownIds.has(id) || /^custom:[a-zA-Z0-9_-]{1,64}$/.test(id)) || !entry || typeof entry !== 'object') continue
      const { count, last } = entry as { count?: unknown; last?: unknown }
      if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0 || typeof last !== 'number' || !Number.isFinite(last) || last < 0) continue
      result[id] = { count: Math.min(10_000, Math.floor(count)), last: Math.min(Date.now(), last) }
    }
  } catch { /* Corrupt or unavailable browser storage must not interrupt typing. */ }
  return result
}
const usage = new Map<CompletionEngine, CompletionUsage>()
function localUsage(engine: CompletionEngine) {
  let value = usage.get(engine)
  if (!value) { try { value = parseCompletionUsage(localStorage.getItem(`${completionUsageKey}:${engine}`)) } catch { value = Object.create(null) as CompletionUsage }; usage.set(engine, value) }
  return value
}
export function recordCompletion(id: string, engine: CompletionEngine = 'latex') {
  if (!(knownIds.has(id) || /^custom:[a-zA-Z0-9_-]{1,64}$/.test(id))) return
  const values = localUsage(engine); values[id] = { count: Math.min(10_000, (values[id]?.count ?? 0) + 1), last: Date.now() }
  for (const stale of Object.keys(values).filter(key => key !== id).sort((a, b) => values[b].last - values[a].last).slice(127)) delete values[stale]
  try { localStorage.setItem(`${completionUsageKey}:${engine}`, JSON.stringify(values)) } catch { /* Still usable with session-only ranking. */ }
}
export function rankCompletions(token: SlashToken, mode: CompletionMode, values: CompletionUsage = localUsage(mode), settings: EngineCompletionSettings = defaultCompletionSettings[mode]): SlashCommand[] {
  if (!settings.enabled || !settings.triggers[token.marker === '/' ? 'slash' : 'backslash']) return []
  const builtins = mode === 'markdown' ? token.marker === '/' ? markdown : tex : builtinCompletionCommands(mode)
  const disabled = new Set(settings.disabledCommands), custom = settings.customCommands.map(item => ({ id: `custom:${item.id}`, label: item.trigger, description: item.description, insert: item.content, preview: item.content.length > 240 ? item.content.slice(0, 240) + '…' : item.content, custom: true }))
  const replaced = new Set(custom.map(command => command.label))
  const commands = [...builtins.filter(command => !replaced.has(command.label)), ...custom].filter(command => !disabled.has(command.id))
  const relevance = (command: SlashCommand) => command.label === token.query ? 3 : command.label.startsWith(token.query) ? 2 : settings.matching === 'contains' && command.label.includes(token.query) ? 1 : 0
  return commands.filter(command => relevance(command) > 0).sort((a, b) => relevance(b) - relevance(a) || (settings.sort === 'alphabetical' ? a.label.localeCompare(b.label, 'en') : (values[b.id]?.count ?? 0) - (values[a.id]?.count ?? 0) || (values[b.id]?.last ?? 0) - (values[a.id]?.last ?? 0)))
}
export function insertionCursor(command: SlashCommand) {
  if (command.custom) return command.insert.length
  const empty = command.insert.indexOf('{}')
  return empty >= 0 ? empty + 1 : ['codeBlock', 'mathBlock'].includes(command.block ?? '') ? command.insert.indexOf('\n') + 1 : command.insert.length
}
