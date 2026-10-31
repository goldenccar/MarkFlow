export const completionEngines = ['markdown', 'formula', 'latex'] as const
export type CompletionEngine = typeof completionEngines[number]
export interface CustomCompletionCommand { id: string; trigger: string; description: string; content: string }
export interface EngineCompletionSettings {
  enabled: boolean
  triggers: { slash: boolean; backslash: boolean }
  matching: 'prefix' | 'contains'
  sort: 'usage' | 'alphabetical'
  disabledCommands: string[]
  customCommands: CustomCompletionCommand[]
}
export type CompletionEngineSettings = EngineCompletionSettings
export type CompletionSettings = Record<CompletionEngine, EngineCompletionSettings>
export const completionLimits = { customCommands: 32, content: 4096, totalContent: 65_536, description: 120, trigger: 32, disabledCommands: 128 } as const
export function createDefaultCompletionSettings(): CompletionSettings {
  const engine = (): EngineCompletionSettings => ({ enabled: true, triggers: { slash: true, backslash: true }, matching: 'contains', sort: 'usage', disabledCommands: [], customCommands: [] })
  return { markdown: engine(), formula: engine(), latex: engine() }
}
export const defaultCompletionSettings = createDefaultCompletionSettings()
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function readSettings(input: unknown, strict: boolean): CompletionSettings {
  const result = createDefaultCompletionSettings()
  const invalid = (message: string) => { if (strict) throw new Error(`补全设置无效：${message}`) }
  if (input === undefined) return result
  if (!record(input)) { invalid('需要按编辑器保存规则。'); return result }
  for (const engine of completionEngines) {
    const raw = input[engine], next = result[engine]
    if (raw === undefined) continue
    if (!record(raw)) { invalid(`${engine} 规则格式不正确。`); continue }
    if (raw.enabled !== undefined) { if (typeof raw.enabled === 'boolean') next.enabled = raw.enabled; else invalid('启用状态应为开关。') }
    if (raw.triggers !== undefined) {
      if (!record(raw.triggers)) invalid('触发符设置格式不正确。')
      else for (const key of ['slash', 'backslash'] as const) if (raw.triggers[key] !== undefined) {
        if (typeof raw.triggers[key] === 'boolean') next.triggers[key] = raw.triggers[key]; else invalid('触发符应为开关。')
      }
    }
    if (raw.matching !== undefined) { if (raw.matching === 'prefix' || raw.matching === 'contains') next.matching = raw.matching; else invalid('匹配方式只能为前缀或包含。') }
    if (raw.sort !== undefined) { if (raw.sort === 'usage' || raw.sort === 'alphabetical') next.sort = raw.sort; else invalid('排序方式只能为使用频率或字母顺序。') }
    if (raw.disabledCommands !== undefined) {
      if (!Array.isArray(raw.disabledCommands)) invalid('禁用命令应为列表。')
      else {
        if (raw.disabledCommands.length > completionLimits.disabledCommands) invalid('禁用命令不能超过 128 项。')
        for (const id of raw.disabledCommands.slice(0, completionLimits.disabledCommands)) {
          if (typeof id !== 'string' || !/^[a-zA-Z0-9:_-]{1,80}$/.test(id)) { invalid('禁用命令编号无效。'); continue }
          if (!next.disabledCommands.includes(id)) next.disabledCommands.push(id)
        }
      }
    }
    if (raw.customCommands === undefined) continue
    if (!Array.isArray(raw.customCommands)) { invalid('自定义命令应为列表。'); continue }
    if (raw.customCommands.length > completionLimits.customCommands) invalid('每种编辑器最多添加 32 个自定义命令。')
    const ids = new Set<string>(), triggers = new Set<string>(); let total = 0
    for (const item of raw.customCommands.slice(0, completionLimits.customCommands)) {
      if (!record(item) || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id)) { invalid('自定义命令编号无效。'); continue }
      const trigger = typeof item.trigger === 'string' ? item.trigger.trim().toLowerCase() : ''
      if (!/^[a-z][a-z0-9]{0,31}$/.test(trigger)) { invalid('关键词需以英文字母开头，只含字母和数字，最多 32 个字符，不包含斜线。'); continue }
      if (typeof item.description !== 'string' || item.description.length > completionLimits.description || /[\x00-\x1f]/.test(item.description)) { invalid('命令说明最多 120 个字符，不含换行或控制字符。'); continue }
      if (typeof item.content !== 'string' || !item.content.length || item.content.length > completionLimits.content || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(item.content)) { invalid('插入内容需为 1–4096 个字符，不含无效控制字符。'); continue }
      if (ids.has(item.id) || triggers.has(trigger)) { invalid(`自定义命令编号或关键词 ${trigger} 重复。`); continue }
      if (total + item.content.length > completionLimits.totalContent) { invalid('同一编辑器的自定义插入内容总计不能超过 65536 个字符。'); continue }
      ids.add(item.id); triggers.add(trigger); total += item.content.length
      next.customCommands.push({ id: item.id, trigger, description: item.description, content: item.content })
    }
  }
  return result
}
/** Old or partially corrupt on-disk preferences retain the valid rules. */
export const normalizeCompletionSettings = (input: unknown) => readSettings(input, false)
/** The save boundary rejects bad edits instead of silently discarding user snippets. */
export const validateCompletionSettings = (input: unknown) => readSettings(input, true)
