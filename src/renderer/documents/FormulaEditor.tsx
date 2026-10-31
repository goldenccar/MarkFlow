import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { EditorView, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, placeholder } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { StreamLanguage, bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { openSearchPanel, searchKeymap } from '@codemirror/search'
import { closeCompletion } from '@codemirror/autocomplete'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditHistory } from '../editHistory'
import type { DocumentEditorHandle, DocumentEditorProps } from './types'
import { sourceCompletion } from '../sourceCompletion'
import { defaultCompletionSettings } from '../../shared/completionSettings'

interface Runtime { view: EditorView; history: EditHistory; applying: boolean; composing: boolean; structural: boolean; query: string; match: number }
const histories = new Map<string, EditHistory>()
function trimHistories(current: string) {
  let bytes = [...histories.values()].reduce((sum, history) => sum + history.bytes, 0)
  for (const [key, history] of histories) {
    if (histories.size <= 20 && bytes <= 64 * 1024 * 1024) break
    if (key !== current) { histories.delete(key); bytes -= history.bytes }
  }
}
function appearance(props: DocumentEditorProps) {
  return [props.theme === 'dark' ? oneDark : [], EditorView.theme({
    '&': { height: '100%', fontSize: `${props.fontSize}px` },
    '.cm-scroller': { overflow: 'auto', fontFamily: props.fontFamily || 'Consolas, "Cascadia Code", monospace', lineHeight: String(props.lineHeight) },
    '.cm-content': { padding: '20px 0' }, '.cm-line': { padding: '0 20px 0 8px' },
  })]
}

/** A LaTeX-only editor. No hidden rich view, Markdown conversion, or Mark registry. */
export const FormulaEditor = forwardRef<DocumentEditorHandle, DocumentEditorProps>(function FormulaEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null), runtime = useRef<Runtime | null>(null), latest = useRef(props)
  latest.current = props
  const completionEngine = () => latest.current.completionEngine ?? 'formula'
  const completionRules = () => latest.current.completion?.[completionEngine()] ?? defaultCompletionSettings[completionEngine()]
  const theme = useRef(new Compartment()), editable = useRef(new Compartment())
  const focus = () => runtime.current?.view.focus()
  const synchronize = (state: Runtime) => {
    const snapshot = state.history.current
    state.applying = true
    try {
      state.view.dispatch({ changes: { from: 0, to: state.view.state.doc.length, insert: snapshot.value }, selection: { anchor: Math.min(snapshot.cursor, snapshot.value.length) } })
    } finally { state.applying = false }
    latest.current.onPosition({ cursor: state.view.state.selection.main.head, scroll: state.view.scrollDOM.scrollTop })
  }
  const historyStep = (redo: boolean) => {
    const state = runtime.current
    if (!state || latest.current.readOnly || state.composing) return
    const snapshot = redo ? state.history.redo() : state.history.undo()
    if (snapshot) { synchronize(state); latest.current.onChange(snapshot.value); focus() }
  }
  const replace = (value: string) => {
    const state = runtime.current
    if (!state || latest.current.readOnly || state.composing) return
    state.history.boundary()
    if (state.history.change({ value, cursor: Math.min(state.history.current.cursor, value.length) })) { synchronize(state); latest.current.onChange(value) }
    state.history.boundary()
  }
  const flush = () => {
    const state = runtime.current
    if (!state) return
    if (state.composing) state.view.contentDOM.blur()
    const value = state.view.state.doc.toString(), cursor = state.view.state.selection.main.head
    if (!latest.current.readOnly && state.history.change({ value, cursor }, 'source')) latest.current.onChange(value)
    state.history.boundary()
  }
  const jumpTo = (line: number) => {
    const state = runtime.current
    if (!state) return
    const position = state.view.state.doc.line(Math.max(1, Math.min(state.view.state.doc.lines, line))).from
    state.view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'center' }) }); focus()
  }
  const search = (query?: string, direction: 1 | -1 = 1) => {
    const state = runtime.current
    if (!state) return { count: 0, index: 0 }
    if (query === undefined) { openSearchPanel(state.view); return { count: 0, index: 0 } }
    if (!query) { state.query = ''; state.match = -1; return { count: 0, index: 0 } }
    const value = state.view.state.doc.toString(), matches: number[] = []
    for (let from = value.indexOf(query); from >= 0; from = value.indexOf(query, from + query.length)) matches.push(from)
    state.match = state.query === query ? (state.match + direction + matches.length) % Math.max(1, matches.length) : direction === -1 ? matches.length - 1 : 0
    state.query = query
    const from = matches[state.match]
    if (from !== undefined) state.view.dispatch({ selection: { anchor: from, head: from + query.length }, effects: EditorView.scrollIntoView(from, { y: 'center' }) })
    return { count: matches.length, index: matches.length ? state.match + 1 : 0 }
  }
  useImperativeHandle(ref, () => ({ focus, flush, jumpTo, find: () => { search() }, search, undo: () => historyStep(false), redo: () => historyStep(true), replace }), [])
  useEffect(() => {
    const initial = latest.current
    let history = histories.get(initial.documentKey)
    if (!history) history = new EditHistory({ value: initial.value, cursor: initial.initialPosition?.cursor ?? 0 })
    else if (history.current.value !== initial.value) history.change({ value: initial.value, cursor: Math.min(history.current.cursor, initial.value.length) })
    histories.delete(initial.documentKey); histories.set(initial.documentKey, history); trimHistories(initial.documentKey); history.boundary()
    const view = new EditorView({ parent: host.current!, state: EditorState.create({ doc: initial.value, selection: { anchor: Math.min(history.current.cursor, initial.value.length) }, extensions: [
      lineNumbers(), highlightSpecialChars(), drawSelection(), dropCursor(), highlightActiveLine(), highlightActiveLineGutter(), EditorView.lineWrapping,
      indentOnInput(), bracketMatching(), syntaxHighlighting(defaultHighlightStyle, { fallback: true }), StreamLanguage.define(stex), placeholder('输入 LaTeX 公式…'),
      sourceCompletion(completionEngine, () => { history.boundary(); if (runtime.current) runtime.current.structural = true }, completionRules),
      Prec.highest(keymap.of([{ key: 'Mod-z', run: () => { historyStep(false); return true } }, { key: 'Mod-Shift-z', run: () => { historyStep(true); return true } }, { key: 'Mod-y', run: () => { historyStep(true); return true } }, { key: 'Mod-s', run: () => { latest.current.onSave(); return true } }])),
      keymap.of([...defaultKeymap, ...searchKeymap]), theme.current.of(appearance(initial)), editable.current.of([EditorState.readOnly.of(!!initial.readOnly), EditorView.editable.of(!initial.readOnly)]),
      EditorView.updateListener.of(update => {
        const state = runtime.current
        if (!state || state.applying) return
        const cursor = update.state.selection.main.head
        if (update.docChanged) {
          const value = update.state.doc.toString()
          if (state.history.change({ value, cursor }, state.structural ? '' : 'source')) latest.current.onChange(value)
          state.structural = false; trimHistories(latest.current.documentKey)
        }
        if (update.selectionSet || update.docChanged) { state.history.current.cursor = cursor; latest.current.onPosition({ cursor, scroll: view.scrollDOM.scrollTop }) }
      }),
      EditorView.domEventHandlers({
        keydown: event => { if (runtime.current && ['Enter', 'Backspace', 'Delete'].includes(event.key)) runtime.current.structural = true; return false },
        paste: () => { if (runtime.current) runtime.current.structural = true; return false },
        compositionstart: () => { if (runtime.current) runtime.current.composing = true; latest.current.onComposition(true); return false },
        compositionend: () => { if (runtime.current) runtime.current.composing = false; latest.current.onComposition(false); return false },
        scroll: (_event, editor) => { latest.current.onPosition({ cursor: editor.state.selection.main.head, scroll: editor.scrollDOM.scrollTop }); return false },
      }), EditorView.contentAttributes.of({ 'aria-label': 'LaTeX 文档内容', spellcheck: 'false' }),
    ] }) })
    runtime.current = { view, history, applying: false, composing: false, structural: false, query: '', match: -1 }
    latest.current.onMarkSelection?.(null, initial.documentKey); latest.current.onHeadingSelection?.(null, initial.documentKey)
    const frame = requestAnimationFrame(() => { view.scrollDOM.scrollTop = initial.initialPosition?.scroll ?? 0 })
    return () => { cancelAnimationFrame(frame); latest.current.onComposition(false); view.destroy(); runtime.current = null }
  }, [props.documentKey])
  useEffect(() => { if (runtime.current) closeCompletion(runtime.current.view) }, [props.completion, props.completionEngine])
  useEffect(() => {
    const state = runtime.current
    if (!state || state.history.current.value === props.value) return
    state.history.change({ value: props.value, cursor: Math.min(state.history.current.cursor, props.value.length) }); synchronize(state)
  }, [props.value])
  useEffect(() => { runtime.current?.view.dispatch({ effects: theme.current.reconfigure(appearance(props)) }) }, [props.theme, props.fontSize, props.lineHeight, props.fontFamily])
  useEffect(() => { runtime.current?.view.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(!!props.readOnly), EditorView.editable.of(!props.readOnly)]) }) }, [props.readOnly])
  return <div className="block-editor source-editor formula-editor"><div ref={host} className="source-surface" /></div>
})
export default FormulaEditor
