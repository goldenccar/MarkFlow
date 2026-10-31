import { Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentLess, indentMore } from '@codemirror/commands'
import { indentUnit } from '@codemirror/language'
import { acceptCompletion, autocompletion, closeCompletion, completionStatus, moveCompletionSelection, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { insertionCursor, rankCompletions, recordCompletion, slashToken, type CompletionMode, type SlashCommand } from './completion'
import { defaultCompletionSettings, type EngineCompletionSettings } from '../shared/completionSettings'

type EngineSource = CompletionMode | (() => CompletionMode)
const currentEngine = (engine: EngineSource) => typeof engine === 'function' ? engine() : engine
function tokenAt(context: Pick<CompletionContext, 'state' | 'pos'>, mode: CompletionMode, settings: EngineCompletionSettings) {
  const { state, pos } = context, line = state.doc.lineAt(pos)
  if (state.readOnly || !state.selection.main.empty) return null
  const token = slashToken(state.sliceDoc(line.from, pos), state.sliceDoc(pos, Math.min(pos + 1, line.to)), mode, settings)
  return token && { ...token, from: token.from + line.from, to: pos }
}
function applyCommand(view: EditorView, command: SlashCommand, from: number, to: number, mode: CompletionMode, boundary: () => void) {
  if (view.state.readOnly || view.composing) return
  const prefix = view.state.sliceDoc(view.state.doc.lineAt(from).from, from)
  const inMath = (prefix.match(/(?<!\\)\$(?!\$)/g)?.length ?? 0) % 2 === 1 || (view.state.sliceDoc(0, from).match(/(?<!\\)\$\$/g)?.length ?? 0) % 2 === 1
  const math = mode === 'markdown' && !command.custom && !command.block && !inMath
  const insert = math ? `$${command.insert}$` : command.insert
  boundary()
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insertionCursor(command) + (math ? 1 : 0) }, userEvent: 'input.complete', scrollIntoView: true })
  recordCompletion(command.id, mode)
  closeCompletion(view)
}
export function slashCompletionSource(engine: EngineSource, boundary: () => void = () => {}, getSettings?: () => EngineCompletionSettings) {
  const source = (context: CompletionContext): CompletionResult | null => {
    const mode = currentEngine(engine), settings = getSettings?.() ?? defaultCompletionSettings[mode], token = tokenAt(context, mode, settings)
    if (!token) return null
    return { from: token.from, to: token.to, filter: false,
      options: rankCompletions(token, mode, undefined, settings).map(command => ({
        label: `${token.marker}${command.label}`, detail: command.description, info: `${command.preview}\n\nTab 插入 · ↑↓ 选择 · Esc 关闭`,
        apply: (view, _completion, from, to) => {
          const current = currentEngine(engine), rules = getSettings?.() ?? defaultCompletionSettings[current]
          const active = tokenAt({ state: view.state, pos: view.state.selection.main.head }, current, rules)
          const accepted = active && active.from === from && active.to === to && rankCompletions(active, current, undefined, rules).find(item => item.id === command.id)
          if (accepted) applyCommand(view, accepted, from, to, current, boundary)
        },
      })), update: (_result, _from, _to, next) => source(next),
    }
  }
  return source
}
export function sourceCompletion(engine: EngineSource, boundary: () => void, getSettings?: () => EngineCompletionSettings): Extension {
  const editable = (view: EditorView) => !view.state.readOnly && !view.composing
  return [indentUnit.of('  '), autocompletion({ override: [slashCompletionSource(engine, boundary, getSettings)], defaultKeymap: false, activateOnTypingDelay: 0, interactionDelay: 0, icons: false, maxRenderedOptions: 12,
    optionClass: () => 'slash-completion-option',
    addToOptions: [{ position: 90, render: completion => { const hint = document.createElement('span'); hint.className = 'slash-completion-key'; hint.textContent = 'Tab'; return hint } }],
  }), Prec.highest(keymap.of([
    { key: 'Tab', run: view => {
      if (!editable(view)) return false
      const mode = currentEngine(engine), settings = getSettings?.() ?? defaultCompletionSettings[mode]
      const token = tokenAt({ state: view.state, pos: view.state.selection.main.head }, mode, settings)
      if (token && completionStatus(view.state)) {
        if (acceptCompletion(view)) return true
        const first = rankCompletions(token, mode, undefined, settings)[0]
        if (first) { applyCommand(view, first, token.from, token.to, mode, boundary); return true }
      }
      boundary(); return indentMore(view)
    } },
    { key: 'Shift-Tab', run: view => { if (!editable(view)) return false; closeCompletion(view); boundary(); return indentLess(view) } },
    { key: 'Escape', run: closeCompletion },
    { key: 'ArrowDown', run: moveCompletionSelection(true) }, { key: 'ArrowUp', run: moveCompletionSelection(false) },
  ])), EditorView.domEventHandlers({ compositionstart: (_event, view) => { closeCompletion(view); return false } })]
}
