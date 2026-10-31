import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { parseMarks, readMarkDocument, type MarkdownMark } from '../shared/marks.js'
import { fontCatalog } from '../shared/fonts.js'
import type { InlineFormat } from '../engine/index.js'
import { CompilationError } from './diagnostics.js'
import type { Diagnostic, MarkDocumentInput, SemanticContent, SemanticMark, SourceLocation, TextRun } from './types.js'

interface Ast {
  type: string; value?: string; children?: Ast[]; depth?: number; url?: string; title?: string | null; alt?: string | null
  identifier?: string; ordered?: boolean; start?: number | null; checked?: boolean | null; align?: Array<string | null>
  position?: { start: { offset: number }; end: { offset: number } }
}
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath)
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const identifier = (value: string) => value.replace(/\s+/g, ' ').trim().toUpperCase()

function lineMaps(source: string) {
  const original = [0], normalized = [0]
  let removed = 0
  for (const match of source.matchAll(/\r\n|\r|\n/g)) {
    removed += match[0].length - 1
    original.push(match.index + match[0].length); normalized.push(match.index + match[0].length - removed)
  }
  const at = (starts: number[], offset: number) => {
    let low = 0, high = starts.length
    while (low + 1 < high) { const middle = (low + high) >>> 1; if (starts[middle] <= offset) low = middle; else high = middle }
    return low
  }
  return {
    original, at,
    toNormalized(offset: number) { const line = at(original, offset); return normalized[line] + offset - original[line] },
    toOriginal(offset: number) { const line = at(normalized, offset); return original[line] + offset - normalized[line] },
  }
}

/** Plain Markdown identities describe this exact source snapshot, never an edit-stable document. */
export function markdownToDocument(source: string, sourcePath: string): { document: MarkDocumentInput; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const bom = source.startsWith('\uFEFF') ? 1 : 0, raw = source.slice(bom), maps = lineMaps(raw)
  const canonical = raw.replace(/\r\n|\r/g, '\n')
  const originalDocument = readMarkDocument(raw), normalizedDocument = readMarkDocument(canonical)
  let documentId = `temporary-${digest(sourcePath + '\0' + source).slice(0, 40)}`
  const location = (from: number, to = from): SourceLocation => {
    const line = maps.at(maps.original, from)
    return { file: sourcePath, from: from + bom, to: to + bom, line: line + 1, column: from - maps.original[line] + 1 + (line === 0 ? bom : 0) }
  }
  const nodeLocation = (node: Ast) => location(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0)
  function fail(code: string, message: string, node?: Ast, mark?: MarkdownMark, field?: string): never {
    throw new CompilationError([...diagnostics, { code, severity: 'error', message, documentId, ...(mark ? { markId: mark.id } : {}), ...(field ? { field } : {}), source: node ? nodeLocation(node) : location(0) }])
  }
  const footerAt = raw.lastIndexOf('<!-- oops:marks ')
  const footer = footerAt < 0 ? undefined : { type: 'html', position: { start: { offset: footerAt }, end: { offset: raw.length } } }
  const invalidText = /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.exec(raw)
  if (invalidText) fail('MARKDOWN_INVALID_TEXT', '源文本包含非法 Unicode 或控制字符，不能静默替换后编译。', { type: 'text', position: { start: { offset: invalidText.index }, end: { offset: invalidText.index + invalidText[0].length } } })
  if (originalDocument.issue || normalizedDocument.issue) fail('MARKDOWN_METADATA_INVALID', originalDocument.issue ?? normalizedDocument.issue!, footer)
  let identitySource = raw, identityDocument = originalDocument, identityMarks = parseMarks(raw), normalizedIdentity = false
  const resolved = (marks: MarkdownMark[]) => marks.every(mark => !mark.id.startsWith('snapshot:'))
  // Saved files can use CRLF while their registry anchors were generated from the editor's LF buffer.
  if ((!identityDocument.metadata || !resolved(identityMarks)) && normalizedDocument.metadata) {
    identitySource = canonical; identityDocument = normalizedDocument; identityMarks = parseMarks(identitySource); normalizedIdentity = true
  }
  const metadata = identityDocument.metadata
  const body = normalizedIdentity ? raw.slice(0, maps.toOriginal(identityDocument.body.length)) : identityDocument.body
  const rawOffset = (offset: number) => normalizedIdentity ? maps.toOriginal(offset) : offset
  const identityOffset = (offset: number) => normalizedIdentity ? maps.toNormalized(offset) : offset
  let revision = 0
  if (metadata) {
    if (typeof metadata.documentId !== 'string' || !/^[\w-]{1,100}$/.test(metadata.documentId) || !Number.isSafeInteger(metadata.revision) || (metadata.revision as number) < 0) fail('MARKDOWN_METADATA_INVALID', 'Mark 元数据缺少有效的文档身份或修订号，请在编辑器中保存后再编译。', footer)
    documentId = metadata.documentId; revision = metadata.revision as number
    const live = metadata.marks.filter(mark => !mark.orphan), ids = new Set(identityMarks.map(mark => mark.id))
    if (!resolved(identityMarks) || live.some(mark => !ids.has(mark.id))) fail('MARKDOWN_METADATA_MISMATCH', '正文与已登记的 Mark 身份不能完整对应；请先在编辑器中确认并保存，不会猜测或替换身份。', footer)
  } else {
    diagnostics.push({ code: 'MARKDOWN_TEMPORARY_IDENTITIES', severity: 'warning', message: '输入没有 Mark 身份登记。生成的临时身份仅在源路径与内容完全相同时可重复，不保证编辑后稳定；输入未被改写。', documentId, source: location(0) })
    identityMarks = identityMarks.map(mark => ({ ...mark, id: `temporary-${digest(documentId + '\0' + mark.type + '\0' + mark.from + '\0' + mark.to).slice(0, 40)}` }))
  }
  const byFrom = new Map(identityMarks.map(mark => [mark.from, mark]))
  const tree = parser.parse(body) as Ast
  const definitions = new Map<string, Ast>()
  for (const node of tree.children ?? []) if (node.type === 'definition' && !definitions.has(identifier(node.identifier ?? ''))) definitions.set(identifier(node.identifier ?? ''), node)
  const assets = new Map<string, { id: string; path: string }>()
  const marks: SemanticMark[] = [], consumedSources: NonNullable<MarkDocumentInput['consumedSources']> = []
  const findMark = (node: Ast): MarkdownMark => {
    const mark = byFrom.get(identityOffset(node.position?.start.offset ?? 0))
    if (!mark) fail('MARKDOWN_IDENTITY_MISSING', '无法定位此结构对应的 Mark。', node)
    return mark
  }
  function safeLink(value: string, node: Ast, mark: MarkdownMark): string {
    try {
      if (/[\u0000-\u0020\u007f\\]/.test(value)) throw new Error('control')
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('scheme')
      return value
    } catch { return fail('MARKDOWN_UNSAFE_LINK', '首版只支持不带用户名或密码的 HTTP/HTTPS 链接。', node, mark, 'content.runs.format.link') }
  }
  function target(node: Ast, mark: MarkdownMark): Ast {
    if (!['linkReference', 'imageReference'].includes(node.type)) return node
    const definition = definitions.get(identifier(node.identifier ?? ''))
    if (!definition) fail('MARKDOWN_REFERENCE_MISSING', '找不到引用式链接或图片的定义。', node, mark)
    return definition
  }
  function inline(nodes: Ast[], mark: MarkdownMark, inherited: InlineFormat = {}): TextRun[] {
    const runs: TextRun[] = [], tags: Array<{ tag: string; node: Ast; format: InlineFormat }> = []
    let active = { ...inherited }
    const append = (text: string, format = active) => {
      if (!text) return
      const value = Object.keys(format).length ? { ...format } : undefined
      if (runs.length && JSON.stringify(runs.at(-1)!.format) === JSON.stringify(value)) runs.at(-1)!.text += text
      else runs.push({ text, ...(value ? { format: value } : {}) })
    }
    for (const node of nodes) {
      if (node.type === 'html') {
        const open = /^<(u|sup|sub|mark)>$/i.exec(node.value ?? ''), close = /^<\/(u|sup|sub|mark)>$/i.exec(node.value ?? '')
        if (open) {
          const tag = open[1].toLowerCase(); tags.push({ tag, node, format: active })
          active = { ...active, ...({ u: { underline: true }, sup: { script: 'superscript' }, sub: { script: 'subscript' }, mark: { highlight: '#fff2a8' } } as Record<string, InlineFormat>)[tag] }
          continue
        }
        if (close && tags.at(-1)?.tag === close[1].toLowerCase()) { active = tags.pop()!.format; continue }
        fail('MARKDOWN_UNSUPPORTED_HTML', '只支持正确配对且不带属性的 u、sup、sub、mark 内联标签。', node, mark)
      }
      if (node.type === 'text') append((node.value ?? '').replace(/\r\n|\r|\n/g, ' '))
      else if (node.type === 'break') append('\n')
      else if (['strong', 'emphasis', 'delete'].includes(node.type)) {
        const key = { strong: 'bold', emphasis: 'italic', delete: 'strike' }[node.type]!
        for (const run of inline(node.children ?? [], mark, { ...active, [key]: true })) append(run.text, run.format)
      } else if (['link', 'linkReference'].includes(node.type)) {
        const destination = target(node, mark)
        if (destination.title) fail('MARKDOWN_UNSUPPORTED_LINK_TITLE', '首版语义输入不支持链接提示标题，不能静默丢弃。', node, mark)
        const link = safeLink(destination.url ?? '', node, mark)
        for (const run of inline(node.children ?? [], mark, { ...active, link })) append(run.text, run.format)
      } else fail('MARKDOWN_UNSUPPORTED_INLINE', `首版不能编译内联结构 ${node.type}；原文未被删除。`, node, mark)
    }
    if (tags.length) fail('MARKDOWN_UNSUPPORTED_HTML', '内联格式标签没有正确闭合。', tags[0].node, mark)
    return runs
  }
  function image(node: Ast, mark: MarkdownMark): SemanticContent {
    const reference = target(node, mark)
    let path: string
    try { path = decodeURIComponent(reference.url ?? '').replaceAll('\\', '/') } catch { return fail('MARKDOWN_ASSET_PATH_INVALID', '图片路径的 URL 编码无效。', node, mark, 'content.assetId') }
    if (!path || /[\u0000-\u001f\u007f]/.test(path) || /^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('/') || /[?#]/.test(path)) fail('MARKDOWN_ASSET_PATH_INVALID', '图片必须使用本地相对路径；不下载远程素材，也不接受 URL 查询或片段。', node, mark, 'content.assetId')
    path = posix.normalize(path)
    const asset = assets.get(path) ?? { id: `asset-${digest(path).slice(0, 40)}`, path }
    assets.set(path, asset)
    return { kind: 'image', assetId: asset.id, alt: node.alt ?? '', ...(reference.title ? { caption: reference.title } : {}) }
  }
  function emit(node: Ast, content: SemanticContent, mark = findMark(node)) {
    const style = { ...mark.style }
    if (Object.keys(style).some(key => !['fontFamily', 'fontSize'].includes(key))) fail('MARKDOWN_UNSUPPORTED_STYLE', '此 Mark 含首版无法表达的局部样式。', node, mark, 'style')
    const family = style.fontFamily ? fontCatalog.find(font => font.id === style.fontFamily) : undefined
    if (style.fontFamily === 'system') diagnostics.push({ code: 'MARKDOWN_SYSTEM_FONT_FIXED', severity: 'warning', message: '系统默认字体在编译中固定映射为 Microsoft YaHei，避免依赖当前设备的默认字体。', documentId, markId: mark.id, source: nodeLocation(node) })
    marks.push({ id: mark.id, content, ...(style.fontFamily || style.fontSize !== undefined ? { style: { ...(family ? { fontFamily: family.aliases[0] ?? 'Microsoft YaHei' } : {}), ...(style.fontSize !== undefined ? { fontSize: style.fontSize } : {}) } } : {}), source: nodeLocation(node) })
  }
  for (const node of tree.children ?? []) {
    if (node.type === 'list') {
      if (node.ordered && (node.start ?? 1) < 1) fail('MARKDOWN_UNSUPPORTED_LIST', '首版有序列表的序号必须从 1 或更大的整数开始。', node, node.children?.[0] ? findMark(node.children[0]) : undefined)
      for (const [index, item] of (node.children ?? []).entries()) {
        const mark = findMark(item), children = item.children ?? []
        if (item.checked !== null && item.checked !== undefined) fail('MARKDOWN_UNSUPPORTED_LIST', '首版暂不支持任务复选框列表。', item, mark)
        if (children.length !== 1 || children[0].type !== 'paragraph') fail('MARKDOWN_UNSUPPORTED_LIST', '首版只支持单段文字的简单列表项，不能包含嵌套列表或多个段落。', item, mark)
        emit(item, { kind: 'list-item', ordered: !!node.ordered, ...(node.ordered ? { ordinal: (node.start ?? 1) + index } : {}), runs: inline(children[0].children ?? [], mark) }, mark)
      }
      continue
    }
    const mark = findMark(node)
    if (node.type === 'definition') { consumedSources.push({ id: mark.id, source: nodeLocation(node) }); continue }
    if (node.type === 'paragraph') {
      const children = node.children ?? []
      emit(node, children.length === 1 && ['image', 'imageReference'].includes(children[0].type) ? image(children[0], mark) : { kind: 'paragraph', runs: inline(children, mark) }, mark)
    } else if (node.type === 'heading') emit(node, { kind: 'heading', level: node.depth as 1 | 2 | 3 | 4 | 5 | 6, runs: inline(node.children ?? [], mark) }, mark)
    else if (node.type === 'table') {
      if (node.align?.some(align => align !== null)) fail('MARKDOWN_UNSUPPORTED_TABLE', '首版表格暂不支持单独的列对齐设置。', node, mark)
      const rows = node.children ?? [], width = rows[0]?.children?.length ?? 0
      if (!width || rows.some(row => row.children?.length !== width)) fail('MARKDOWN_UNSUPPORTED_TABLE', '表格的每一行必须具有相同列数，不能忽略多余或缺失的单元格。', node, mark)
      emit(node, { kind: 'table', header: true, rows: rows.map(row => row.children!.map(cell => inline(cell.children ?? [], mark))) }, mark)
    } else fail(node.type === 'html' && node.value?.startsWith('<!-- oops:marks ') ? 'MARKDOWN_METADATA_INVALID' : 'MARKDOWN_UNSUPPORTED_BLOCK', `首版不能编译结构 ${node.type}；原文未被删除。`, node, mark)
  }
  for (const mark of identityMarks) if (mark.type === 'empty') {
    const from = rawOffset(mark.from), to = rawOffset(mark.to)
    emit({ type: 'paragraph', position: { start: { offset: from }, end: { offset: to } } }, { kind: 'paragraph', runs: [] }, mark)
  }
  marks.sort((a, b) => a.source!.from! - b.source!.from!)
  return { document: { format: 'markflow', version: 1, documentId, revision, marks, assets: [...assets.values()], ...(consumedSources.length ? { consumedSources } : {}), ...(metadata ? { retiredIds: [...new Set([...(metadata.retiredIds ?? []), ...metadata.marks.filter(mark => mark.orphan).map(mark => mark.id)])] } : {}) }, diagnostics }
}
