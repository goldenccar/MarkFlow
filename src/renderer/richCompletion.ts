import { Extension, type Editor, type JSONContent } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { rankCompletions, recordCompletion, slashToken, type SlashCommand, type SlashToken } from './completion'
import { defaultCompletionSettings, type EngineCompletionSettings } from '../shared/completionSettings'
import { importMarkdown } from '../shared/richMarkdown'

// Three en spaces are 24px at 16px text size; Unicode whitespace survives Markdown round trips.
export const richIndent = '\u2002\u2002\u2002'
export const richCompletionCommand = 'slashCompletionCommand'
const activity = new PluginKey<boolean>('slashCompletionActivity')
export function allowsRichCompletion(transaction: Transaction) {
  const origin = (transaction.getMeta('appendedTransaction') as Transaction | undefined) ?? transaction
  return !origin.getMeta('preventUpdate') && !origin.getMeta(richCompletionCommand)
}
export function indentRichParagraphs(state: EditorState, dispatch: (transaction: Transaction) => void, reverse = false) {
  const { from, to } = state.selection, changes: { from: number; to: number; insert: string }[] = []
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return
    if (!['paragraph', 'heading', 'codeBlock'].includes(node.type.name)) return false
    const code = node.type.name === 'codeBlock', unit = code ? '  ' : richIndent, text = node.textContent
    const starts = code ? [0, ...[...text.matchAll(/\n/g)].map(match => match.index! + 1)].filter((start, index, lines) =>
      pos + 1 + (lines[index + 1] ?? text.length + 1) > from && pos + 1 + start <= to && (from === to || pos + 1 + start < to)) : [0]
    for (const start of starts) {
      const tail = text.slice(start)
      if (reverse) {
        const count = tail.startsWith(unit) ? unit.length : /^[ \t]{1,2}/.exec(tail)?.[0].length ?? 0
        if (count) changes.push({ from: pos + 1 + start, to: pos + 1 + start + count, insert: '' })
      } else changes.push({ from: pos + 1 + start, to: pos + 1 + start, insert: unit })
    }
    return false
  })
  const transaction = state.tr.setMeta(richCompletionCommand, true)
  for (const change of changes.reverse()) transaction.insertText(change.insert, change.from, change.to)
  if (transaction.docChanged) dispatch(transaction.scrollIntoView())
  return true
}
function currentToken(view: Pick<EditorView, 'state'>, settings = defaultCompletionSettings.markdown): SlashToken | null {
  const { empty, $from } = view.state.selection
  if (!empty || !['paragraph', 'heading'].includes($from.parent.type.name) || $from.marks().some(mark => ['code', 'link'].includes(mark.type.name))) return null
  const parent = $from.parent, token = slashToken(parent.textBetween(0, $from.parentOffset, '\n', '\ufffc'), parent.textBetween($from.parentOffset, Math.min(parent.content.size, $from.parentOffset + 1)), 'markdown', settings)
  return token && { ...token, from: token.from + $from.start(), to: $from.pos }
}
/** Parse Markdown into safe schema nodes; never pass snippet strings to Tiptap's HTML parser. */
export function customRichContent(content: string): JSONContent[] {
  const clean = (node: JSONContent): JSONContent => ({ ...node,
    ...(node.attrs ? { attrs: { ...node.attrs, markId: null, sourceId: null } } : {}),
    ...(node.content ? { content: node.content.map(clean) } : {}),
  })
  return (importMarkdown(content).doc.content ?? []).map(clean)
}
export function applyRichCompletion(editor: Editor, token: SlashToken, command: SlashCommand) {
  if (!editor.isEditable || editor.view.composing) return false
  const chain = editor.chain().setMeta(richCompletionCommand, true).deleteRange({ from: token.from, to: token.to })
  if (command.custom) {
    const content = customRichContent(command.insert), { $from } = editor.state.selection
    if (content.length === 1 && content[0].type === 'paragraph') return chain.insertContent(content[0].content ?? [{ type: 'text', text: command.insert }]).run()
    if (token.from === $from.start() && token.to === $from.end() && content.length) {
      content[0].attrs = { ...$from.parent.attrs, ...content[0].attrs, markId: $from.parent.attrs.markId, sourceId: $from.parent.attrs.sourceId }
      return editor.chain().setMeta(richCompletionCommand, true).insertContentAt({ from: $from.before(), to: $from.after() }, content).run()
    }
    return chain.insertContent(content).run()
  }
  if (!command.block) return chain.insertContent({ type: 'mathInline', attrs: { latex: command.insert } }).run()
  if (command.block.startsWith('heading')) return chain.setHeading({ level: Number(command.block.slice(-1)) as 1 | 2 | 3 }).run()
  if (command.block === 'bulletList') return chain.toggleBulletList().run()
  if (command.block === 'orderedList') return chain.toggleOrderedList().run()
  if (command.block === 'taskList') return chain.toggleTaskList().run()
  if (command.block === 'blockquote') return chain.setBlockquote().run()
  if (command.block === 'codeBlock') return chain.setCodeBlock().run()
  const { $from } = editor.state.selection, attrs = { ...$from.parent.attrs }
  const node = command.block === 'mathBlock' ? { type: 'mathBlock', attrs: { ...attrs, latex: '' } }
    : { type: 'table', attrs, content: [true, false].map(header => ({ type: 'tableRow', content: [0, 1].map(() => ({ type: header ? 'tableHeader' : 'tableCell', content: [{ type: 'paragraph' }] })) })) }
  // Replacing the empty paragraph explicitly retains the semantic Mark identity.
  return editor.chain().setMeta(richCompletionCommand, true).insertContentAt({ from: $from.before(), to: $from.after() }, node).run()
}

export function richCompletion(boundary: () => void, getSettings: () => EngineCompletionSettings = () => defaultCompletionSettings.markdown) {
  return Extension.create({ name: 'slashCompletion', priority: 1100,
    addProseMirrorPlugins() {
      const editor = this.editor
      let settings = getSettings()
      let menu: HTMLDivElement | null = null, token: SlashToken | null = null, options: SlashCommand[] = [], selected = 0, signature = ''
      const close = () => { menu?.remove(); menu = null; token = null; options = []; signature = ''; editor.view.dom.removeAttribute('aria-activedescendant'); editor.view.dom.removeAttribute('aria-controls') }
      const choose = (index: number) => {
        const current = currentToken(editor.view, getSettings())
        const command = current && rankCompletions(current, 'markdown', undefined, getSettings()).find(item => item.id === options[index]?.id)
        if (!token || !current || current.from !== token.from || current.query !== token.query || !command || !editor.isEditable || editor.view.composing) { close(); return }
        close(); boundary()
        if (applyRichCompletion(editor, current, command)) recordCompletion(command.id, 'markdown')
        editor.view.focus()
      }
      const position = () => {
        if (!menu || !token) return
        const rect = editor.view.coordsAtPos(token.to), gap = 8
        menu.style.left = `${Math.max(gap, Math.min(rect.left, window.innerWidth - menu.offsetWidth - gap))}px`
        menu.style.top = `${Math.max(gap, rect.bottom + menu.offsetHeight + gap > window.innerHeight ? rect.top - menu.offsetHeight - gap : rect.bottom + gap)}px`
      }
      const highlight = () => {
        menu?.querySelectorAll<HTMLButtonElement>('[role=option]').forEach((button, index) => button.setAttribute('aria-selected', String(index === selected)))
        const option = menu?.querySelector<HTMLButtonElement>('[aria-selected=true]')
        if (option) { editor.view.dom.setAttribute('aria-activedescendant', option.id); option.scrollIntoView({ block: 'nearest' }) }
      }
      const show = () => {
        if (!token) return
        menu?.remove(); menu = document.createElement('div'); menu.className = 'slash-completion-menu'; menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', '插入标记'); menu.id = `slash-menu-${editor.instanceId}`
        const hint = document.createElement('div'); hint.className = 'slash-completion-hint'; hint.textContent = '插入标记 · ↑↓ 选择 · Tab 插入 · Esc 关闭'; menu.append(hint)
        options.forEach((command, index) => {
          const option = document.createElement('button'); option.type = 'button'; option.tabIndex = -1; option.setAttribute('role', 'option'); option.id = `${menu!.id}-${index}`
          const name = document.createElement('strong'), detail = document.createElement('span'), preview = document.createElement('code')
          name.textContent = `${token!.marker}${command.label}`; detail.textContent = command.description; preview.textContent = command.preview
          option.append(name, detail, preview); option.onmousedown = event => { event.preventDefault(); choose(index) }; menu!.append(option)
        })
        editor.view.dom.parentElement!.append(menu); editor.view.dom.setAttribute('aria-controls', menu.id); position(); highlight()
      }
      return [new Plugin({ key: activity, state: { init: () => false, apply: (transaction, previous) => transaction.docChanged ? allowsRichCompletion(transaction) : previous }, props: {
        handleKeyDown(view, event) {
          if (!editor.isEditable || view.composing || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return false
          if (menu && event.key === 'Escape') { close(); return true }
          if (menu && ['ArrowDown', 'ArrowUp'].includes(event.key)) { selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length; highlight(); return true }
          if (event.key !== 'Tab') return false
          if (menu && !event.shiftKey) { choose(selected); return true }
          close(); boundary()
          const list = editor.isActive('taskItem') ? 'taskItem' : editor.isActive('listItem') ? 'listItem' : null
          if (list) { const chain = editor.chain().setMeta(richCompletionCommand, true); if (event.shiftKey) chain.liftListItem(list).run(); else chain.sinkListItem(list).run(); return true }
          return indentRichParagraphs(view.state, transaction => view.dispatch(transaction), event.shiftKey)
        },
        handleDOMEvents: { blur: () => { close(); return false }, compositionstart: () => { close(); return false } },
      }, view: () => {
        const scroll = () => { if (menu) position() }; window.addEventListener('resize', scroll); document.addEventListener('scroll', scroll, true)
        return { update(view, previous) {
          if (settings !== getSettings()) { settings = getSettings(); close(); return }
          if (!activity.getState(view.state)) { close(); return }
          if (!editor.isEditable || view.composing || !view.hasFocus()) { close(); return }
          const current = currentToken(view, settings)
          if (!current) { close(); return }
          if (previous.doc === view.state.doc && !token) return
          if (previous.doc === view.state.doc && previous.selection.eq(view.state.selection)) return
          const before = currentToken({ state: previous }, settings)
          if (!token && before?.marker === current.marker && before?.query === current.query) return
          const nextSignature = `${current.from}:${current.marker}:${current.query}`
          if (nextSignature === signature) return
          signature = nextSignature; token = current; selected = 0
          const onlyToken = view.state.selection.$from.parent.textContent.trim() === `${token.marker}${token.query}`
          options = rankCompletions(token, 'markdown', undefined, settings).filter(command => onlyToken || !['mathBlock', 'table'].includes(command.block ?? '')).slice(0, 12)
          if (options.length) show(); else close()
        }, destroy() { close(); window.removeEventListener('resize', scroll); document.removeEventListener('scroll', scroll, true) } }
      } })]
    },
  })
}
