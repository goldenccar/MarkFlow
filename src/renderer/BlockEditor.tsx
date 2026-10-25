import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { Compartment, EditorState, Prec, StateField } from '@codemirror/state'
import { Decoration, EditorView, keymap, placeholder, type DecorationSet } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { StreamLanguage } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { openSearchPanel } from '@codemirror/search'
import { oneDark } from '@codemirror/theme-one-dark'
import { Editor as RichEditor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { importMarkdown, exportMarkdownWithMap, type RichMarkdownDocument, type RichSourceSpan, type RichMarkSpan } from '../shared/richMarkdown'
import { applyMarkdownMarkCommand, ensureMarkDocument, markAt, parseMarks, readMarkDocument, reconcileMarkDocument, setMarkStyle, type MarkSelection, type MarkStylePatch, type MarkdownMarkCommand } from '../shared/marks'
import { fontFamilyCss } from '../shared/fonts'
import { EditHistory } from './editHistory'
import { richExtensions } from './richExtensions'
import type { EditorHandle, EditorProps } from './editorTypes'
import { sourceMarkMappings } from './sourceMarkMapping'

export type FormatCommand = 'bold' | 'italic' | 'underline' | 'strike' | 'superscript' | 'subscript' | 'highlight'
export interface SearchResult { count: number; index: number }
export interface BlockEditorHandle extends EditorHandle {
  jump(from: number): void; search(query?: string, direction?: 1 | -1): SearchResult; replace(value: string): void; format(command: FormatCommand): void; flush(): void
  applyMarkStyle(patch: MarkStylePatch | null): void
  markCommand(command: MarkdownMarkCommand): void
}
export interface BlockEditorProps extends EditorProps {
  live?: boolean; path: string; localFiles?: boolean; fontFamily?: string
  onNavigate(path: string, anchor?: string): void; onExternal(url: string): void
  onMarkSelection?(state: MarkSelection | null, documentKey: string): void
  onError?(message: string): void
}
interface Runtime {
  source: EditorView; rich: RichEditor; history: EditHistory; base: RichMarkdownDocument
  spans: RichSourceSpan[]; richValue: string; sourceValue: string; applying: boolean; composing: boolean
  query: string; match: number; structural: boolean; marks: RichMarkSpan[]; reportedMark: string
}
const histories = new Map<string, EditHistory>()
function trimHistories(current: string) {
  let bytes = [...histories.values()].reduce((sum, history) => sum + history.bytes, 0)
  for (const [key, history] of histories) {
    if (histories.size <= 20 && bytes <= 64 * 1024 * 1024) break
    if (key !== current) { histories.delete(key); bytes -= history.bytes }
  }
}
const liveMode = (props: BlockEditorProps) => props.live !== false && props.mode === 'markdown'
const sourceLanguage = (props: BlockEditorProps) => props.mode === 'markdown' ? markdown({ codeLanguages: languages }) : StreamLanguage.define(stex)
function appearance(props: BlockEditorProps) {
  return [props.theme === 'dark' ? oneDark : [], EditorView.theme({
    '&': { height: '100%', fontSize: `${props.fontSize}px` },
    '.cm-scroller': { overflow: 'auto', fontFamily: props.fontFamily || 'Consolas, "Cascadia Code", monospace', lineHeight: String(props.lineHeight) },
    '.cm-content': { padding: '20px 0' }, '.cm-line': { padding: '0 20px 0 8px' },
  })]
}
function sourceMarkStyles(source: string, mode: EditorProps['mode']) {
  const lines = new Map<number, string>()
  if (mode === 'markdown' && readMarkDocument(source).metadata?.marks.length) for (const mark of parseMarks(source)) {
    if (!mark.explicit) continue
    const style = `${mark.style.fontFamily ? `font-family:${fontFamilyCss(mark.style.fontFamily)};` : ''}${mark.style.fontSize ? `font-size:${mark.style.fontSize}px;` : ''}`
    let position = source.lastIndexOf('\n', Math.max(0, mark.from - 1)) + 1
    do { lines.set(position, style); const next = source.indexOf('\n', position); if (next < 0) break; position = next + 1 } while (position < mark.to)
  }
  const decorations = Decoration.set([...lines].sort(([a], [b]) => a - b).map(([position, style]) => Decoration.line({ attributes: { style } }).range(position)))
  return StateField.define<DecorationSet>({ create: () => decorations, update: (value, transaction) => value.map(transaction.changes), provide: field => EditorView.decorations.from(field) })
}

export const BlockEditor = forwardRef<BlockEditorHandle, BlockEditorProps>(function BlockEditor(props, ref) {
  const sourceHost = useRef<HTMLDivElement>(null), richHost = useRef<HTMLDivElement>(null)
  const latest = useRef(props); latest.current = props
  const runtime = useRef<Runtime | null>(null)
  const language = useRef(new Compartment()), theme = useRef(new Compartment()), editable = useRef(new Compartment()), markStyles = useRef(new Compartment())
  const flush = () => { const active = document.activeElement; if (active instanceof HTMLTextAreaElement && richHost.current?.contains(active)) active.blur() }
  const topPositions = (editor: RichEditor) => { const values: number[] = []; editor.state.doc.forEach((_node, pos) => values.push(pos)); return values }
  const selectedRichSpan = (state: Runtime) => {
    const head = state.rich.state.selection.$head, index = Math.min(head.index(0), state.rich.state.doc.childCount - 1)
    const top = state.rich.state.doc.child(index), itemIndex = ['bulletList', 'orderedList', 'taskList'].includes(top.type.name) ? Math.min(head.depth >= 1 ? head.index(1) : 0, top.childCount - 1) : undefined
    return state.marks.find(mark => mark.index === index && mark.itemIndex === itemIndex)
  }
  const selectedMark = (state: Runtime): MarkSelection | null => {
    if (latest.current.mode !== 'markdown') return null
    if (liveMode(latest.current)) {
      const span = selectedRichSpan(state); if (!span) return null
      const top = state.rich.state.doc.child(span.index), node = span.itemIndex === undefined ? top : top.child(span.itemIndex)
      const type = span.from === span.to ? 'empty' : ({ codeBlock: 'code', mathBlock: 'math', listItem: 'listItem', taskItem: 'listItem', opaqueBlock: 'html', horizontalRule: 'thematicBreak' }[node.type.name] ?? node.type.name)
      const style = { ...(node.attrs.markFontFamily ? { fontFamily: node.attrs.markFontFamily } : {}), ...(node.attrs.markFontSize ? { fontSize: node.attrs.markFontSize } : {}) }
      return { id: node.attrs.markId ?? `snapshot:${type}-${span.from}`, from: span.from, to: span.to, label: node.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) || node.attrs.label || '空白 Mark', type, style, explicit: Object.keys(style).length > 0 }
    }
    const value = state.history.current.value, position = state.source.state.selection.main.head
    if (position > readMarkDocument(value).body.length) return null
    const mark = markAt(value, position)
    if (!mark) return null
    const { id, from, to, label, type, style, explicit } = mark
    return { id, from, to, label, type, style, explicit }
  }
  const reportMark = (state: Runtime) => {
    const mark = selectedMark(state), signature = JSON.stringify(mark)
    if (signature !== state.reportedMark) { state.reportedMark = signature; latest.current.onMarkSelection?.(mark, latest.current.documentKey) }
  }
  const rawPosition = (state: Runtime) => {
    const span = selectedRichSpan(state); if (!span) return readMarkDocument(state.history.current.value).body.length
    const { start } = markNode(state, span)
    return Math.min(span.to, span.from + Math.max(0, state.rich.state.selection.head - start - 1))
  }
  const markNode = (state: Runtime, span: RichMarkSpan) => {
    const top = state.rich.state.doc.child(span.index)
    let start = topPositions(state.rich)[span.index]
    if (span.itemIndex === undefined) return { node: top, start }
    start++
    for (let index = 0; index < span.itemIndex; index++) start += top.child(index).nodeSize
    return { node: top.child(span.itemIndex), start }
  }
  const richPosition = (state: Runtime, raw: number) => {
    const span = state.marks.find(item => raw >= item.from && raw <= item.to) ?? state.marks.find(item => raw < item.from) ?? state.marks.at(-1)
    if (!span) return 1
    const { node, start } = markNode(state, span)
    let contentStart = start + 1
    if (!node.isTextblock) {
      let first: number | undefined
      node.descendants((child, pos) => { if (first === undefined && child.isTextblock) first = start + pos + 2 })
      contentStart = first ?? contentStart
    }
    return Math.max(start, Math.min(start + node.nodeSize - 1, contentStart + raw - span.from))
  }
  const moveRich = (state: Runtime, position: number, focus = true) => {
    const doc = state.rich.state.doc, resolved = doc.resolve(Math.max(0, Math.min(doc.content.size, position)))
    state.rich.view.dispatch(state.rich.state.tr.setSelection(TextSelection.near(resolved)).scrollIntoView())
    if (focus) state.rich.view.focus()
  }
  const synchronize = (state: Runtime, cursor = state.history.current.cursor, force = false) => {
    state.applying = true
    try {
      const value = state.history.current.value
      const body = readMarkDocument(value).body
      if (force || state.sourceValue !== body) {
        state.source.dispatch({ changes: { from: 0, to: state.source.state.doc.length, insert: body }, selection: { anchor: Math.min(cursor, body.length) } }); state.sourceValue = body
      }
      if (latest.current.mode === 'markdown' && (force || state.richValue !== value)) {
        state.base = importMarkdown(value); state.rich.commands.setContent(state.base.doc, { emitUpdate: false })
        const result = exportMarkdownWithMap(state.rich.getJSON(), state.base); state.spans = result.spans; state.marks = result.marks; state.richValue = value; moveRich(state, richPosition(state, cursor), false)
      }
      state.source.dispatch({ effects: markStyles.current.reconfigure(sourceMarkStyles(value, latest.current.mode)) })
    } finally { state.applying = false }
    reportMark(state)
  }
  const rejectEdit = (state: Runtime, error: unknown) => {
    const snapshot = state.history.current, cursor = snapshot.cursor
    state.structural = false
    queueMicrotask(() => {
      if (runtime.current !== state || state.history.current !== snapshot) return
      synchronize(state, cursor, true)
      latest.current.onError?.(error instanceof Error ? error.message : String(error))
    })
  }
  const focus = () => { const state = runtime.current; if (state) liveMode(latest.current) ? state.rich.view.focus() : state.source.focus() }
  const jump = (position: number) => {
    const state = runtime.current; if (!state) return
    const from = Math.max(0, Math.min(position, state.history.current.value.length))
    if (liveMode(latest.current)) moveRich(state, richPosition(state, from))
    else { state.source.dispatch({ selection: { anchor: from }, effects: EditorView.scrollIntoView(from, { y: 'center' }) }); state.source.focus() }
    state.history.current.cursor = from
    reportMark(state)
  }
  const historyStep = (redo: boolean) => {
    const state = runtime.current; if (!state || latest.current.readOnly || state.composing) return
    const snapshot = redo ? state.history.redo() : state.history.undo()
    if (snapshot) { synchronize(state, snapshot.cursor, true); latest.current.onChange(snapshot.value); focus() }
  }
  const replace = (value: string) => {
    const state = runtime.current; if (!state || latest.current.readOnly) return
    if (state.history.change({ value, cursor: Math.min(state.history.current.cursor, value.length) })) { synchronize(state); latest.current.onChange(value) }
  }
  const applyMarkStyle = (patch: MarkStylePatch | null) => {
    const state = runtime.current; if (!state || latest.current.readOnly || state.composing || latest.current.mode !== 'markdown') return
    flush()
    const mark = selectedMark(state); if (!mark) return
    const cursor = liveMode(latest.current) ? rawPosition(state) : state.source.state.selection.main.head
    const richSelection = state.rich.state.selection
    const value = setMarkStyle(state.history.current.value, mark.from, patch)
    state.history.boundary()
    if (state.history.change({ value, cursor })) {
      synchronize(state, cursor)
      if (liveMode(latest.current)) state.rich.view.dispatch(state.rich.state.tr.setSelection(richSelection.map(state.rich.state.doc, state.rich.state.tr.mapping)))
      latest.current.onChange(value)
    }
    state.history.boundary(); reportMark(state)
  }
  const markCommand = (command: MarkdownMarkCommand) => {
    const state = runtime.current; if (!state || latest.current.readOnly || state.composing || latest.current.mode !== 'markdown') return
    flush(); state.history.boundary()
    const value = applyMarkdownMarkCommand(state.history.current.value, command)
    replace(value)
    const marks = parseMarks(value), target = command.type === 'move' ? marks.find(mark => mark.id === command.id) : marks[command.index]
    if (target) jump(target.from)
    state.history.boundary(); reportMark(state)
  }
  const search = (query?: string, direction: 1 | -1 = 1): SearchResult => {
    const state = runtime.current; if (!state) return { count: 0, index: 0 }
    if (query === undefined) { if (!liveMode(latest.current)) openSearchPanel(state.source); else focus(); return { count: 0, index: 0 } }
    if (!query) { state.query = ''; state.match = -1; return { count: 0, index: 0 } }
    const matches: Array<{ from: number; to: number }> = []
    if (liveMode(latest.current)) {
      let value = ''; const positions: number[] = []
      state.rich.state.doc.descendants((node, pos) => {
        if (node.isText) { for (let index = 0; index < node.text!.length; index++) { value += node.text![index]; positions.push(pos + index) } }
        else if (node.isBlock && value && !value.endsWith('\n')) { value += '\n'; positions.push(pos) }
      })
      for (let from = value.indexOf(query); from >= 0; from = value.indexOf(query, from + Math.max(1, query.length))) matches.push({ from: positions[from], to: positions[from + query.length - 1] + 1 })
    } else {
      const value = state.source.state.doc.toString()
      for (let from = value.indexOf(query); from >= 0; from = value.indexOf(query, from + Math.max(1, query.length))) matches.push({ from, to: from + query.length })
    }
    state.match = state.query === query ? (state.match + direction + matches.length) % Math.max(1, matches.length) : direction === -1 ? matches.length - 1 : 0; state.query = query
    const match = matches[state.match]
    if (match) {
      if (liveMode(latest.current)) { state.rich.commands.setTextSelection(match); state.rich.commands.scrollIntoView() }
      else state.source.dispatch({ selection: { anchor: match.from, head: match.to }, effects: EditorView.scrollIntoView(match.from, { y: 'center' }) })
    }
    return { count: matches.length, index: matches.length ? state.match + 1 : 0 }
  }
  const format = (command: FormatCommand) => {
    const state = runtime.current; if (!state || latest.current.readOnly) return
    state.history.boundary()
    if (liveMode(latest.current)) state.rich.chain().focus().toggleMark(command).run()
    else {
      const selection = state.source.state.selection.main
      const tags: Record<FormatCommand, [string, string]> = { bold: ['**', '**'], italic: ['*', '*'], strike: ['~~', '~~'], underline: ['<u>', '</u>'], superscript: ['<sup>', '</sup>'], subscript: ['<sub>', '</sub>'], highlight: ['<mark>', '</mark>'] }
      const [before, after] = tags[command], text = state.source.state.sliceDoc(selection.from, selection.to); state.structural = true
      state.source.dispatch({ changes: { from: selection.from, to: selection.to, insert: before + text + after }, selection: { anchor: selection.from + before.length, head: selection.to + before.length } }); state.source.focus()
    }
    state.history.boundary()
  }
  useImperativeHandle(ref, () => ({ focus, flush, jump, jumpTo: line => {
    const value = runtime.current?.history.current.value ?? '', lines = value.split('\n'); jump(lines.slice(0, Math.max(0, Math.min(lines.length - 1, line - 1))).reduce((sum, text) => sum + text.length + 1, 0))
  }, find: () => { search() }, search, undo: () => historyStep(false), redo: () => historyStep(true), replace, format, applyMarkStyle, markCommand }), [])

  useEffect(() => {
    const initial = latest.current
    let history = histories.get(initial.documentKey)
    if (!history) { history = new EditHistory({ value: initial.value, cursor: initial.initialPosition?.cursor ?? 0 }); histories.set(initial.documentKey, history) }
    else if (history.current.value !== initial.value) history.change({ value: initial.value, cursor: Math.min(history.current.cursor, initial.value.length) })
    histories.delete(initial.documentKey); histories.set(initial.documentKey, history); trimHistories(initial.documentKey)
    history.boundary()
    const base = importMarkdown(initial.mode === 'markdown' ? initial.value : '')
    const initialBody = readMarkDocument(initial.value).body
    const source = new EditorView({ parent: sourceHost.current!, state: EditorState.create({ doc: initialBody, selection: { anchor: Math.min(history.current.cursor, initialBody.length) }, extensions: [
      basicSetup, EditorView.lineWrapping, placeholder('开始写作…'),
      Prec.highest(keymap.of([{ key: 'Mod-z', run: () => { historyStep(false); return true } }, { key: 'Mod-Shift-z', run: () => { historyStep(true); return true } }, { key: 'Mod-y', run: () => { historyStep(true); return true } }, { key: 'Mod-s', run: () => { latest.current.onSave(); return true } }, indentWithTab])),
      language.current.of(sourceLanguage(initial)), theme.current.of(appearance(initial)), markStyles.current.of(sourceMarkStyles(initial.value, initial.mode)), editable.current.of([EditorState.readOnly.of(!!initial.readOnly), EditorView.editable.of(!initial.readOnly)]),
      EditorView.updateListener.of(update => {
        const state = runtime.current; if (!state || state.applying) return
        const cursor = update.state.selection.main.head
        if (update.docChanged) {
          try {
          const before = state.history.current.value, document = readMarkDocument(before), raw = update.state.doc.toString(); state.sourceValue = raw
          const managed = latest.current.mode === 'markdown' || !!document.metadata
          const beforeIdentity = managed && !document.metadata ? ensureMarkDocument(before) : before
          const mappings = managed ? sourceMarkMappings(beforeIdentity, raw, update.changes) : undefined
          const value = mappings ? reconcileMarkDocument(beforeIdentity, raw, mappings) : raw
          if (state.history.change({ value, cursor }, state.structural ? '' : 'source')) latest.current.onChange(value)
          trimHistories(latest.current.documentKey)
          state.structural = false
          queueMicrotask(() => {
            if (runtime.current !== state || state.history.current.value !== value) return
            state.applying = true
            try {
              const body = readMarkDocument(value).body
              if (body !== state.sourceValue) { state.source.dispatch({ changes: { from: 0, to: state.source.state.doc.length, insert: body }, selection: { anchor: Math.min(cursor, body.length) } }); state.sourceValue = body }
              state.source.dispatch({ effects: markStyles.current.reconfigure(sourceMarkStyles(value, latest.current.mode)) })
            } finally { state.applying = false }
            reportMark(state)
          })
          } catch (error) { rejectEdit(state, error); return }
        }
        if (update.selectionSet || update.docChanged) { state.history.current.cursor = cursor; latest.current.onPosition({ cursor, scroll: update.view.scrollDOM.scrollTop }); reportMark(state) }
      }), EditorView.domEventHandlers({
        keydown: event => { if (runtime.current && ['Enter', 'Backspace', 'Delete'].includes(event.key)) runtime.current.structural = true; return false },
        compositionstart: () => { if (runtime.current) runtime.current.composing = true; latest.current.onComposition(true); return false },
        compositionend: () => { if (runtime.current) runtime.current.composing = false; latest.current.onComposition(false); return false },
        scroll: (_event, view) => { latest.current.onPosition({ cursor: view.state.selection.main.head, scroll: view.scrollDOM.scrollTop }); return false },
      }), EditorView.contentAttributes.of({ 'aria-label': '文档内容', spellcheck: 'false' }),
    ] }) })
    const rich = new RichEditor({ element: richHost.current!, extensions: richExtensions(() => latest.current, () => historyStep(false), () => historyStep(true), () => latest.current.onSave()), content: base.doc, editable: !initial.readOnly,
      editorProps: { attributes: { 'aria-label': '文档内容', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'false' }, handleDOMEvents: {
        keydown: (_view, event) => { if (runtime.current && ['Enter', 'Backspace', 'Delete'].includes(event.key)) runtime.current.structural = true; return false },
        paste: () => { if (runtime.current) runtime.current.structural = true; return false },
        compositionstart: () => { if (runtime.current) runtime.current.composing = true; latest.current.onComposition(true); return false },
        compositionend: () => { if (runtime.current) runtime.current.composing = false; latest.current.onComposition(false); return false },
      } },
      onUpdate: ({ editor, transaction }) => {
        const state = runtime.current; if (!state || state.applying || !transaction.docChanged) return
        try {
        const result = exportMarkdownWithMap(editor.getJSON(), state.base, state.history.current.value); state.spans = result.spans; state.marks = result.marks; state.richValue = result.source
        const cursor = rawPosition(state)
        if (state.history.change({ value: result.source, cursor }, state.structural ? '' : 'rich')) latest.current.onChange(result.source)
        trimHistories(latest.current.documentKey)
        state.structural = false
        reportMark(state)
        } catch (error) { rejectEdit(state, error) }
      },
      onSelectionUpdate: () => {
        const state = runtime.current; if (!state || state.applying) return
        const cursor = rawPosition(state); state.history.current.cursor = cursor; latest.current.onPosition({ cursor, scroll: richHost.current?.scrollTop ?? 0 })
        reportMark(state)
      },
    })
    const exported = exportMarkdownWithMap(rich.getJSON(), base)
    runtime.current = { source, rich, history, base, spans: exported.spans, marks: exported.marks, richValue: initial.mode === 'markdown' ? initial.value : '', sourceValue: initialBody, applying: false, composing: false, query: '', match: -1, structural: false, reportedMark: '' }
    const state = runtime.current
    if (initial.mode === 'markdown') moveRich(state, richPosition(state, history.current.cursor), false)
    reportMark(state)
    const frame = requestAnimationFrame(() => { if (richHost.current) richHost.current.scrollTop = initial.initialPosition?.scroll ?? 0; source.scrollDOM.scrollTop = initial.initialPosition?.scroll ?? 0 })
    return () => { cancelAnimationFrame(frame); latest.current.onComposition(false); source.destroy(); rich.destroy(); runtime.current = null }
  }, [props.documentKey])
  useEffect(() => {
    const state = runtime.current; if (!state || state.history.current.value === props.value) return
    state.history.change({ value: props.value, cursor: Math.min(state.history.current.cursor, props.value.length) }); synchronize(state)
  }, [props.value])
  useEffect(() => {
    const state = runtime.current; if (!state) return
    const cursor = state.history.current.cursor
    state.history.boundary(); synchronize(state, cursor)
    state.applying = true
    try {
      state.source.dispatch({ effects: language.current.reconfigure(sourceLanguage(props)) })
      if (liveMode(props)) moveRich(state, richPosition(state, cursor), false)
      else {
        const anchor = Math.min(cursor, state.source.state.doc.length)
        state.source.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: 'center' }) })
      }
    } finally { state.applying = false }
    reportMark(state)
  }, [props.mode, props.live])
  useEffect(() => { runtime.current?.source.dispatch({ effects: theme.current.reconfigure(appearance(props)) }) }, [props.theme, props.fontSize, props.lineHeight, props.fontFamily])
  useEffect(() => {
    const state = runtime.current; if (!state) return
    state.source.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(!!props.readOnly), EditorView.editable.of(!props.readOnly)]) }); state.rich.setEditable(!props.readOnly)
  }, [props.readOnly])
  const assetContext = useRef(`${props.documentKey}\0${props.path}\0${props.localFiles}`)
  useEffect(() => {
    const key = `${props.documentKey}\0${props.path}\0${props.localFiles}`, state = runtime.current
    if (key === assetContext.current) return
    assetContext.current = key
    if (!state) return
    flush(); state.rich.createNodeViews()
  }, [props.documentKey, props.path, props.localFiles])
  return <div className={`block-editor ${liveMode(props) ? 'is-live' : 'source-editor'}`} style={{ fontSize: props.fontSize, lineHeight: props.lineHeight, fontFamily: props.fontFamily }}>
    <div ref={sourceHost} className="source-surface" hidden={liveMode(props)} />
    <div ref={richHost} className="rich-editor" hidden={!liveMode(props)} onScroll={event => { const state = runtime.current; if (state) latest.current.onPosition({ cursor: state.history.current.cursor, scroll: event.currentTarget.scrollTop }) }} />
  </div>
})
export default BlockEditor
