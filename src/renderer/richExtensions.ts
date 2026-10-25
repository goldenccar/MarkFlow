import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit, TableView } from '@tiptap/extension-table'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Highlight from '@tiptap/extension-highlight'
import Superscript from '@tiptap/extension-superscript'
import Subscript from '@tiptap/extension-subscript'
import { Plugin } from '@tiptap/pm/state'
import katex from 'katex'
import { assetUrl, resolveLink } from './markdown'
import { fontFamilyCss } from '../shared/fonts'
import type { FontFamily } from '../shared/types'
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Mapping } from '@tiptap/pm/transform'
import { createMarkId } from '../engine/mark'

interface RichContext { path: string; localFiles?: boolean; readOnly?: boolean; onExternal(url: string): void; onNavigate(path: string, anchor?: string): void }
function styleMark(dom: HTMLElement, attrs: Record<string, unknown>) {
  const family = attrs.markFontFamily ? fontFamilyCss(attrs.markFontFamily as FontFamily) : ''
  dom.style.fontFamily = family; dom.style.setProperty('--mark-font', family)
  dom.style.fontSize = attrs.markFontSize ? `${Number(attrs.markFontSize)}px` : ''
  if (attrs.markId) dom.dataset.markId = String(attrs.markId); else delete dom.dataset.markId
}
class MarkTableView extends TableView {
  constructor(...args: ConstructorParameters<typeof TableView>) { super(...args); styleMark(this.table, args[0].attrs) }
  override update(node: ProseMirrorNode) { const accepted = super.update(node); if (accepted) styleMark(this.table, node.attrs); return accepted }
}
/** A copied Mark has a new identity and keeps its appearance and content. */
export function cleanPastedMarkSlice(slice: Slice): Slice {
  const clean = (node: ProseMirrorNode): ProseMirrorNode => {
    if (node.isText) return node
    const children: ProseMirrorNode[] = []; node.content.forEach(child => children.push(clean(child)))
    return node.type.create({ ...node.attrs, sourceId: null, markId: node.attrs.markId ? createMarkId() : null }, Fragment.from(children), node.marks)
  }
  const children: ProseMirrorNode[] = []; slice.content.forEach(node => children.push(clean(node)))
  return new Slice(Fragment.from(children), slice.openStart, slice.openEnd)
}
interface RichMarkRef { node: ProseMirrorNode; pos: number }
function semanticMarks(doc: ProseMirrorNode): RichMarkRef[] {
  const result: RichMarkRef[] = []
  doc.forEach((node, pos) => {
    if (['bulletList', 'orderedList', 'taskList'].includes(node.type.name)) node.forEach((item, offset) => result.push({ node: item, pos: pos + 1 + offset }))
    else result.push({ node, pos })
  })
  return result
}
/** Identity belongs to semantic root Marks, not every nested ProseMirror paragraph. */
export function createRichIdentityPlugin() {
  let splitId: string | null = null
  return new Plugin({
    props: {
      // Internal drag moves retain their IDs. If the drop copies, duplicate repair
      // uses the transaction mapping to keep the original, even when pasted before it.
      transformPasted: (slice, view) => view.dragging ? slice : cleanPastedMarkSlice(slice),
      handleKeyDown: (view, event) => {
        splitId = event.key === 'Enter' && !event.shiftKey ? semanticMarks(view.state.doc).find(mark => view.state.selection.head >= mark.pos && view.state.selection.head <= mark.pos + mark.node.nodeSize)?.node.attrs.markId ?? null : null
        return false
      },
    },
    appendTransaction(transactions, oldState, state) {
      if (!transactions.some(transaction => transaction.docChanged)) return null
      const transaction = state.tr, mapping = new Mapping()
      const restoring = transactions.some(item => item.getMeta('preventUpdate') === true)
      transactions.forEach(item => mapping.appendMapping(item.mapping))
      const previous = semanticMarks(oldState.doc), current = semanticMarks(state.doc)
      const oldById = new Map(previous.filter(mark => mark.node.attrs.markId).map(mark => [mark.node.attrs.markId as string, mark]))
      const groups = new Map<string, RichMarkRef[]>()
      current.forEach(mark => { if (mark.node.attrs.markId) { const group = groups.get(mark.node.attrs.markId) ?? []; group.push(mark); groups.set(mark.node.attrs.markId, group) } })
      const assignments = new Map<number, Record<string, unknown>>()
      const put = (mark: RichMarkRef, attrs: Record<string, unknown>) => assignments.set(mark.pos, { ...mark.node.attrs, ...assignments.get(mark.pos), ...attrs })
      // Block-type commands may replace the attribute set. A mapped, surviving
      // node is still the same Mark when it becomes a heading or list item.
      if (!restoring && current.length === previous.length && current.some(mark => !mark.node.attrs.markId)) {
        for (const old of previous) {
          const id = old.node.attrs.markId
          if (!id || groups.has(id)) continue
          const anchor = mapping.mapResult(old.pos + 1, 1)
          if (anchor.deletedAcross) continue
          let low = 0, high = current.length
          while (low < high) { const middle = (low + high) >>> 1; if (current[middle].pos <= anchor.pos) low = middle + 1; else high = middle }
          const mark = current[low - 1]
          if (mark && anchor.pos < mark.pos + mark.node.nodeSize && !mark.node.attrs.markId && !assignments.has(mark.pos)) {
            put(mark, { markId: id, markFontFamily: old.node.attrs.markFontFamily, markFontSize: old.node.attrs.markFontSize, sourceId: old.node.attrs.sourceId })
          }
        }
      }
      if (splitId && current.length > previous.length) {
        const old = oldById.get(splitId)
        if (old) {
          const start = mapping.map(old.pos, -1), first = current.find(mark => mark.pos === start)
          if (first) {
            put(first, { markId: splitId, markFontFamily: old.node.attrs.markFontFamily, markFontSize: old.node.attrs.markFontSize })
            for (const other of groups.get(splitId) ?? []) if (other.pos !== first.pos) put(other, { markId: null, markFontFamily: null, markFontSize: null })
          }
        }
      }
      splitId = null
      for (const [id, group] of groups) {
        if (group.length < 2) continue
        const old = oldById.get(id), anchor = old ? mapping.map(old.pos + 1, 1) : -1
        const survivor = group.find(mark => assignments.get(mark.pos)?.markId === id)
          ?? group.find(mark => anchor >= mark.pos && anchor < mark.pos + mark.node.nodeSize)
          ?? group[0]
        for (const mark of group) if (mark !== survivor && !assignments.has(mark.pos)) put(mark, { markId: createMarkId(), sourceId: null })
      }
      const ids = new Set<string>()
      for (const mark of current) {
        const attrs = assignments.get(mark.pos) ?? mark.node.attrs
        if (!attrs.markId || ids.has(String(attrs.markId)) || (!restoring && !oldById.has(String(attrs.markId)) && !assignments.has(mark.pos))) put(mark, { markId: createMarkId() })
        ids.add(String((assignments.get(mark.pos) ?? attrs).markId))
      }
      // Source IDs only identify raw byte slices. A moved original keeps its source
      // ID; a copied original must never take the raw slice away from its survivor.
      const oldSources = new Map<string, number>(); oldState.doc.forEach((node, pos) => { if (node.attrs.sourceId) oldSources.set(node.attrs.sourceId, pos) })
      const sourceGroups = new Map<string, RichMarkRef[]>()
      state.doc.forEach((node, pos) => { if (node.attrs.sourceId) { const group = sourceGroups.get(node.attrs.sourceId) ?? []; group.push({ node, pos }); sourceGroups.set(node.attrs.sourceId, group) } })
      for (const [id, group] of sourceGroups) {
        if (group.length < 2) continue
        const old = oldSources.get(id), anchor = old === undefined ? -1 : mapping.map(old + 1, 1)
        const survivor = group.find(mark => anchor >= mark.pos && anchor < mark.pos + mark.node.nodeSize) ?? group[0]
        for (const mark of group) if (mark !== survivor) put(mark, { sourceId: null })
      }
      for (const [pos, attrs] of assignments) transaction.setNodeMarkup(pos, undefined, attrs)
      return transaction.docChanged ? transaction : null
    },
  })
}

export function richExtensions(context: () => RichContext, undo: () => void, redo: () => void, save: () => void) {
  const SourceIdentity = Extension.create({
    name: 'sourceIdentity', priority: 1000,
    addGlobalAttributes: () => [{
      types: ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'blockquote', 'codeBlock', 'horizontalRule', 'table', 'tableRow', 'tableCell', 'tableHeader', 'image', 'mathBlock', 'opaqueBlock'],
      attributes: { sourceId: { default: null, rendered: false } },
    }, {
      types: ['paragraph', 'heading', 'listItem', 'taskItem', 'blockquote', 'codeBlock', 'horizontalRule', 'table', 'mathBlock', 'opaqueBlock'],
      attributes: {
        markId: { default: null, keepOnSplit: false, renderHTML: attrs => attrs.markId ? { 'data-mark-id': attrs.markId } : {} },
        markFontFamily: { default: null, keepOnSplit: false, renderHTML: attrs => attrs.markFontFamily ? { style: `font-family:${fontFamilyCss(attrs.markFontFamily)};--mark-font:${fontFamilyCss(attrs.markFontFamily)}` } : {} },
        markFontSize: { default: null, keepOnSplit: false, renderHTML: attrs => attrs.markFontSize ? { style: `font-size:${attrs.markFontSize}px` } : {} },
      },
    }, {
      types: ['tableCell', 'tableHeader'], attributes: { align: { default: null, renderHTML: attrs => attrs.align ? { style: `text-align:${['left', 'right', 'center'].includes(attrs.align) ? attrs.align : 'left'}` } : {} } },
    }],
    addProseMirrorPlugins: () => [createRichIdentityPlugin()],
    addKeyboardShortcuts: () => ({
      'Mod-z': () => { undo(); return true }, 'Mod-Shift-z': () => { redo(); return true }, 'Mod-y': () => { redo(); return true },
      'Mod-s': () => { save(); return true },
    }),
  })
  const SafeLink = Mark.create({
    name: 'link', priority: 1000, inclusive: false,
    addAttributes: () => ({ href: { default: '' }, title: { default: null }, refId: { default: null, rendered: false }, refType: { default: null, rendered: false }, refLabel: { default: null, rendered: false } }),
    parseHTML: () => [{ tag: 'a[href]', getAttrs: element => ({ href: element.getAttribute('href'), title: element.getAttribute('title') }) }],
    renderHTML: ({ HTMLAttributes }) => ['a', { href: '#', 'data-link': HTMLAttributes.href, title: HTMLAttributes.title || 'Ctrl + 单击打开链接' }, 0],
    addProseMirrorPlugins: () => [new Plugin({ props: { handleClick(_view, _pos, event) {
      const anchor = (event.target as HTMLElement).closest('a[data-link]')
      if (!anchor || !(event.ctrlKey || event.metaKey)) return false
      event.preventDefault()
      const target = resolveLink(anchor.getAttribute('data-link') ?? '', context().path)
      if (target.kind === 'external') context().onExternal(target.url)
      else if (target.kind === 'local') context().onNavigate(target.path, target.anchor)
      return true
    } } })],
  })
  const Image = Node.create({
    name: 'image', inline: true, group: 'inline', atom: true, draggable: false,
    addAttributes: () => ({ src: { default: '' }, alt: { default: '' }, title: { default: null }, refId: { default: null }, refType: { default: null }, refLabel: { default: null } }),
    parseHTML: () => [{ tag: 'img[src]' }],
    renderHTML: ({ node }) => ['span', { class: 'blocked-image' }, node.attrs.alt || '图片'],
    addNodeView: () => ({ node }) => {
      const dom = document.createElement('span'); dom.className = 'rich-image'; dom.contentEditable = 'false'
      const target = resolveLink(node.attrs.src, context().path)
      if (context().localFiles !== false && target.kind === 'local' && target.path !== context().path) {
        const image = document.createElement('img'); image.src = assetUrl(target.path); image.alt = node.attrs.alt ?? ''; image.title = node.attrs.title ?? ''; image.loading = 'lazy'; dom.append(image)
      } else { dom.textContent = `[图片：${node.attrs.alt || '不支持的地址'}]`; dom.title = '仅加载项目内的相对图片' }
      return { dom }
    },
  })
  const opaque = (inline: boolean) => Node.create({
    name: inline ? 'opaqueInline' : 'opaqueBlock', inline, group: inline ? 'inline' : 'block', atom: true, selectable: true,
    addAttributes: () => ({ raw: { default: '' }, label: { default: '保留内容' } }),
    parseHTML: () => [],
    renderHTML: ({ node, HTMLAttributes }) => [inline ? 'span' : 'div', mergeAttributes(HTMLAttributes, { class: 'rich-opaque', contenteditable: 'false', title: '原文完整保留，可在源码中编辑' }), node.attrs.label],
  })
  const math = (inline: boolean) => Node.create({
    name: inline ? 'mathInline' : 'mathBlock', inline, group: inline ? 'inline' : 'block', atom: true,
    addAttributes: () => ({ latex: { default: '' } }), parseHTML: () => [],
    renderHTML: ({ node }) => [inline ? 'span' : 'div', { class: 'rich-math' }, node.attrs.latex],
    addNodeView: () => ({ node, editor, getPos }) => {
      const dom = document.createElement(inline ? 'span' : 'div'); dom.className = `rich-math ${inline ? 'is-inline' : 'is-block'}`; dom.contentEditable = 'false'
      styleMark(dom, node.attrs)
      const rendered = document.createElement('span'); dom.append(rendered)
      const render = () => {
        try { rendered.innerHTML = katex.renderToString(node.attrs.latex, { displayMode: !inline, throwOnError: true, trust: false, maxExpand: 1000, maxSize: 20, macros: {}, strict: code => code === 'unicodeTextInMathMode' ? 'ignore' : 'warn' }) }
        catch { rendered.textContent = '公式尚不能渲染'; rendered.className = 'math-error' }
      }
      render()
      const button = document.createElement('button'); button.type = 'button'; button.className = 'rich-math-edit'; button.textContent = '编辑公式'; button.setAttribute('aria-label', '编辑公式'); dom.append(button)
      button.onclick = event => {
        event.preventDefault(); if (context().readOnly || dom.querySelector('textarea')) return
        const field = document.createElement('textarea'); field.value = node.attrs.latex; field.setAttribute('aria-label', 'LaTeX 公式'); field.rows = inline ? 2 : 4; dom.append(field); rendered.hidden = true; button.hidden = true
        let complete = false
        const finish = (commit: boolean) => {
          if (complete) return; complete = true
          const position = getPos()
          if (commit && typeof position === 'number' && field.value !== node.attrs.latex) editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, latex: field.value }))
          else { field.remove(); rendered.hidden = false; button.hidden = false }
          editor.commands.focus()
        }
        field.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); finish(false) } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); finish(true) } })
        field.addEventListener('blur', () => finish(true)); field.focus()
      }
      return { dom, stopEvent: event => event.target instanceof HTMLElement && !!event.target.closest('button,textarea'), ignoreMutation: () => true }
    },
  })
  // The code content stays editable; the copy button is outside its contentDOM.
  const kit = StarterKit.configure({ undoRedo: false, link: false, codeBlock: false, trailingNode: false })
  const CodeBlock = Node.create({
    name: 'codeBlock', group: 'block', content: 'text*', marks: '', code: true, defining: true,
    addAttributes: () => ({ language: { default: null }, meta: { default: null } }),
    parseHTML: () => [{ tag: 'pre', preserveWhitespace: 'full' }],
    renderHTML: ({ HTMLAttributes }) => ['pre', mergeAttributes(HTMLAttributes), ['code', 0]],
    addKeyboardShortcuts() { return { Tab: () => this.editor.isActive('codeBlock') && this.editor.commands.insertContent('\t') } },
    addNodeView: () => ({ node }) => {
      const dom = document.createElement('div'); dom.className = 'code-block rich-code'
      styleMark(dom, node.attrs)
      const button = document.createElement('button'); button.type = 'button'; button.className = 'copy-code'; button.contentEditable = 'false'; button.textContent = '复制'; button.setAttribute('aria-label', '复制代码')
      const pre = document.createElement('pre'), contentDOM = document.createElement('code'); pre.append(contentDOM); dom.append(button, pre)
      button.onclick = async event => { event.preventDefault(); try { await window.oops.copyText(contentDOM.textContent ?? node.textContent); button.textContent = '已复制' } catch { button.textContent = '复制失败' } }
      return { dom, contentDOM, stopEvent: event => event.target === button }
    },
  })
  return [kit, SourceIdentity, SafeLink, Image, opaque(false), opaque(true), math(false), math(true), CodeBlock,
    TableKit.configure({ table: { resizable: false, View: MarkTableView }, tableCell: {}, tableHeader: {} }), TaskList,
    TaskItem.extend({
      addAttributes() { return { ...this.parent?.(), task: { default: true, rendered: false } } },
      addKeyboardShortcuts() { return { ...this.parent?.(), Enter: () => this.editor.commands.splitListItem(this.name, { task: this.editor.getAttributes(this.name).task !== false, checked: false }) } },
      addNodeView() {
        const parent = this.parent!()!
        return props => {
          if (props.node.attrs.task !== false) {
            const view = parent(props); styleMark(view.dom as HTMLElement, props.node.attrs)
            const update = view.update
            view.update = (node, decorations, innerDecorations) => { const accepted = update?.(node, decorations, innerDecorations) ?? false; if (accepted) styleMark(view.dom as HTMLElement, node.attrs); return accepted }
            return view
          }
          const dom = document.createElement('li'), contentDOM = document.createElement('div')
          dom.dataset.type = 'taskItem'; dom.className = 'rich-plain-list-item'; dom.append(contentDOM)
          styleMark(dom, props.node.attrs)
          return { dom, contentDOM, update: node => { if (node.type !== props.node.type || node.attrs.task !== false) return false; styleMark(dom, node.attrs); return true } }
        }
      },
    }).configure({ nested: true, HTMLAttributes: { 'data-type': 'taskItem' } }), Highlight, Superscript, Subscript]
}
