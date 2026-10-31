import { createHash } from 'node:crypto'
import { parseMarkdown, type MarkdownAst } from '../shared/blocks.js'
import { parseMarks, readMarkDocument } from '../shared/marks.js'
import { fontCatalog } from '../shared/fonts.js'
import { markdownToDocument } from './markdown.js'
import { CompilationError, failCompilation } from './diagnostics.js'
import type { Diagnostic, SourceLocation, TextRun } from './types.js'
import type { PaperContent, PaperDocumentInput, PaperRun } from './latexTypes.js'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')

/** Reuse the Office adapter for ordinary Markdown; add only typed paper math/citation interpretation. */
export function markdownToPaperDocument(source: string, sourcePath: string): { document: PaperDocumentInput; diagnostics: Diagnostic[] } {
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(source)) failCompilation('MARKDOWN_INVALID_TEXT', 'Source contains invalid Unicode or control characters.')
  const bom = source.startsWith('\uFEFF') ? 1 : 0, raw = source.slice(bom), normalized = raw.replace(/\r\n|\r/g, '\n')
  let identitySource = raw, identityDocument = readMarkDocument(raw), originals = parseMarks(raw)
  if (identityDocument.issue) failCompilation('MARKDOWN_METADATA_INVALID', identityDocument.issue)
  if (identityDocument.metadata && originals.some(mark => mark.id.startsWith('snapshot:'))) {
    const candidate = readMarkDocument(normalized), marks = parseMarks(normalized)
    if (candidate.metadata && !candidate.issue && marks.every(mark => !mark.id.startsWith('snapshot:'))) { identitySource = normalized; identityDocument = candidate; originals = marks }
  }
  const metadata = identityDocument.metadata
  if (metadata && (typeof metadata.documentId !== 'string' || !/^[\w-]{1,100}$/.test(metadata.documentId) || !Number.isSafeInteger(metadata.revision) || (metadata.revision as number) < 0 || originals.some(mark => mark.id.startsWith('snapshot:')) || metadata.marks.some(entry => !entry.orphan && !originals.some(mark => mark.id === entry.id)))) failCompilation('MARKDOWN_METADATA_MISMATCH', 'Mark metadata does not match this source snapshot. Save in the editor before generating a paper.')
  const documentId = metadata ? metadata.documentId as string : `temporary-${digest(sourcePath + '\0' + source).slice(0, 40)}`
  const normalizedOffsets: number[] = []
  if (identitySource !== raw) {
    for (let at = 0; at < raw.length; at++) { normalizedOffsets.push(at); if (raw[at] === '\r' && raw[at + 1] === '\n') at++ }
    normalizedOffsets.push(raw.length)
  }
  const toRaw = (offset: number) => (identitySource === raw ? offset : normalizedOffsets[offset]) + bom
  const location = (from: number, to: number): SourceLocation => {
    const before = source.slice(0, toRaw(from)), matches = [...before.matchAll(/\r\n|\r|\n/g)], last = matches.at(-1)
    return { file: sourcePath, from: toRaw(from), to: toRaw(to), line: matches.length + 1, column: before.length - (last ? last.index! + last[0].length : 0) + 1 }
  }
  originals = originals.map(mark => ({ ...mark, id: metadata ? mark.id : `temporary-${digest(documentId + '\0' + mark.type + '\0' + mark.from + '\0' + mark.to).slice(0, 40)}` }))
  const byFrom = new Map(originals.map(mark => [mark.from, mark]))
  const replacements: { from: number; to: number; token: string; tex: string; display: boolean; start: number; end: number }[] = []
  const prefix = `MARKFLOWMATH${digest(identityDocument.body).slice(0, 20).toUpperCase()}TOKEN`
  const visit = (node: MarkdownAst) => {
    if (node.type === 'math' || node.type === 'inlineMath') {
      if (node.meta) failCompilation('PAPER_MATH_METADATA', 'Equation fence metadata is unsupported; the original source is retained.')
      replacements.push({ from: node.position!.start.offset, to: node.position!.end.offset, token: `${prefix}${replacements.length}END`, tex: node.value ?? '', display: node.type === 'math', start: 0, end: 0 })
    } else for (const child of node.children ?? []) visit(child)
  }
  visit(parseMarkdown(identityDocument.body))
  let shadow = '', previous = 0
  for (const replacement of replacements) {
    shadow += identityDocument.body.slice(previous, replacement.from)
    replacement.start = shadow.length
    shadow += replacement.display ? `\n\n${replacement.token}${identityDocument.body.slice(replacement.to).trim() ? '\n\n' : ''}` : replacement.token
    replacement.end = shadow.length; previous = replacement.to
  }
  shadow += identityDocument.body.slice(previous)
  const toOriginal = (offset: number) => {
    let delta = 0
    for (const replacement of replacements) {
      if (offset < replacement.start) break
      if (offset < replacement.end) return replacement.from
      delta = replacement.to - replacement.end
    }
    return offset + delta
  }
  const remap = (at: SourceLocation): SourceLocation => location(toOriginal(at.from ?? 0), toOriginal(at.to ?? at.from ?? 0))
  let converted: ReturnType<typeof markdownToDocument>
  try { converted = markdownToDocument(shadow, sourcePath) }
  catch (error) {
    if (error instanceof CompilationError) throw new CompilationError(error.diagnostics.map(item => ({ ...item, documentId, ...(item.source ? { source: remap(item.source), markId: byFrom.get(toOriginal(item.source.from ?? 0))?.id } : {}) })))
    throw error
  }
  const document = converted.document, extensions: PaperDocumentInput['extensions'] = []
  const tokenPattern = new RegExp(`${prefix}(\\d+)END|\\[@([A-Za-z0-9][A-Za-z0-9_-]*(?:;[ \\t]*@[A-Za-z0-9][A-Za-z0-9_-]*)*)\\]|\\[#([A-Za-z0-9][A-Za-z0-9_-]*)\\]`, 'g')
  const runs = (values: TextRun[]): PaperRun[] => values.flatMap(run => {
    const result: PaperRun[] = []; let start = 0
    for (const match of run.text.matchAll(tokenPattern)) {
      if (match.index > start) result.push({ ...run, text: run.text.slice(start, match.index) })
      if (run.format && Object.keys(run.format).length) failCompilation('PAPER_FORMATTED_INLINE', 'Math, citations and cross-references cannot carry text formatting; remove the surrounding text format.')
      result.push(match[1] !== undefined ? { kind: 'math', tex: replacements[Number(match[1])].tex } : match[2] ? { kind: 'citation', keys: match[2].split(/;\s*@/) } : { kind: 'cross-reference', targetId: match[3] })
      start = match.index + match[0].length
    }
    if (start < run.text.length || !result.length) result.push({ ...run, text: run.text.slice(start) })
    return result
  })
  for (const mark of document.marks) {
    const original = byFrom.get(toOriginal(mark.source!.from!))
    if (!original) failCompilation('PAPER_MARK_IDENTITY', 'Cannot match generated content to its original Mark.')
    mark.id = original.id; mark.source = location(original.from, original.to)
    if (Object.keys(original.style).some(key => !['fontFamily', 'fontSize'].includes(key))) failCompilation('MARKDOWN_UNSUPPORTED_STYLE', 'Unsupported Mark typography.', { markId: mark.id })
    if (original.style.fontFamily || original.style.fontSize !== undefined) {
      const family = fontCatalog.find(font => font.id === original.style.fontFamily)
      mark.style = { ...(family ? { fontFamily: family.aliases[0] ?? 'Microsoft YaHei' } : {}), ...(original.style.fontSize !== undefined ? { fontSize: original.style.fontSize } : {}) }
    }
    const equation = replacements.find(replacement => replacement.display && replacement.from === original.from)
    let content: PaperContent = mark.content
    if (equation) { mark.content = { kind: 'paragraph', runs: [{ text: equation.tex }] }; content = { kind: 'equation', tex: equation.tex } }
    else if ('runs' in mark.content) content = { ...mark.content, runs: runs(mark.content.runs) }
    else if (mark.content.kind === 'table') content = { ...mark.content, rows: mark.content.rows.map(row => row.map(runs)) }
    if (JSON.stringify(content) !== JSON.stringify(mark.content)) extensions.push({ markId: mark.id, content })
    // The shared document keeps readable literal formula/citation text, never internal adapter tokens.
    const restore = (values: TextRun[]) => values.map(run => ({ ...run, text: run.text.replace(new RegExp(`${prefix}(\\d+)END`, 'g'), (_, index) => `$${replacements[Number(index)].tex}$`) }))
    if ('runs' in mark.content && !equation) mark.content.runs = restore(mark.content.runs)
    else if (mark.content.kind === 'table') mark.content.rows = mark.content.rows.map(row => row.map(restore))
  }
  for (const item of document.consumedSources ?? []) {
    const original = byFrom.get(toOriginal(item.source.from!))
    if (!original) failCompilation('PAPER_MARK_IDENTITY', 'Cannot match a definition to its original Mark.')
    item.id = original.id; item.source = location(original.from, original.to)
  }
  for (const original of originals) if (original.type === 'empty' && !document.marks.some(mark => mark.id === original.id)) document.marks.push({ id: original.id, content: { kind: 'paragraph', runs: [] }, source: location(original.from, original.to), ...(original.style.fontSize !== undefined ? { style: { fontSize: original.style.fontSize } } : {}) })
  document.marks.sort((a, b) => a.source!.from! - b.source!.from!)
  document.documentId = documentId; document.revision = metadata ? metadata.revision as number : 0
  if (metadata) document.retiredIds = [...new Set([...(metadata.retiredIds ?? []), ...metadata.marks.filter(mark => mark.orphan).map(mark => mark.id)])]
  const diagnostics = converted.diagnostics.filter(item => item.code !== 'MARKDOWN_TEMPORARY_IDENTITIES').map(item => ({ ...item, documentId, ...(item.source ? { source: remap(item.source) } : {}) }))
  if (!metadata) diagnostics.unshift({ code: 'MARKDOWN_TEMPORARY_IDENTITIES', severity: 'warning', message: '未登记 Mark 身份；此源路径和内容生成可重复的临时 ID，编辑后会变化。原文保持不变。', documentId, source: location(0, 0) })
  return { document: { format: 'markflow-paper', version: 1, document, extensions }, diagnostics }
}
