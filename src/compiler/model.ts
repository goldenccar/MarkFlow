import { applyMarkCommands, MarkEngineError, resolveTypography, type MarkCommand, type MarkSnapshot, type MarkTypography } from '../engine/index.js'
import { CompilationError, failCompilation, type DiagnosticLocation } from './diagnostics.js'
import type { AssetInput, MarkDocumentInput, NormalizedDocument, SemanticContent, SemanticEngineOptions, SourceLocation, TextRun } from './types.js'

type Context = DiagnosticLocation
const field = (context: Context, name: string): Context => ({ ...context, field: context.field ? `${context.field}.${name}` : name })
const bad = (message: string, context: Context, code = 'INVALID_SCHEMA'): never => failCompilation(code, message, context)

/** Reuse the engine's JSON boundary before inspecting unknown data; never invoke input getters. */
function jsonData<T>(input: T, context: Context = {}): T {
  try {
    return applyMarkCommands<T>({ revision: 0, roots: [], retiredIds: [] }, [{ type: 'insert', parentId: null, index: 0, marks: [{ id: 'compiler-input', content: input }] }]).roots[0].content
  } catch (error) { return bad(error instanceof Error ? error.message : String(error), context, 'INVALID_JSON') }
}

function object(value: unknown, allowed: string[], required: string[], context: Context): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('Expected an object.', context)
  const result = value as Record<string, unknown>
  for (const key of Object.keys(result)) if (!allowed.includes(key)) bad(`Unknown field: ${key}`, field(context, key), 'UNKNOWN_FIELD')
  for (const key of required) if (!Object.hasOwn(result, key)) bad(`Missing required field: ${key}`, field(context, key))
  return result
}
function array(value: unknown, context: Context): unknown[] {
  if (!Array.isArray(value)) return bad('Expected an array.', context)
  return value
}
function text(value: unknown, context: Context, nonempty = false): string {
  if (typeof value !== 'string' || (nonempty && !value.trim()) || /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value)) return bad('Expected valid Unicode text.', context)
  return value
}
function id(value: unknown, context: Context): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) return bad('Expected a portable ID (1–128 letters, digits, underscores or hyphens, starting with a letter or digit).', context, 'INVALID_ID')
  return value
}
function integer(value: unknown, minimum: number, maximum: number, context: Context): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) return bad(`Expected an integer between ${minimum} and ${maximum}.`, context)
  return value
}
function boolean(value: unknown, context: Context): boolean {
  if (typeof value !== 'boolean') return bad('Expected a boolean.', context)
  return value
}

function link(value: unknown, context: Context): string {
  const href = text(value, context, true)
  try {
    if (href !== href.trim() || /[\x00-\x20\x7f\\]/.test(href)) throw new Error()
    const url = new URL(href)
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol) || url.username || url.password || (url.protocol === 'mailto:' && !url.pathname)) throw new Error()
  } catch { return bad('Links must use HTTP, HTTPS or mailto without credentials or control characters.', context, 'UNSAFE_LINK') }
  return href
}

function runs(value: unknown, context: Context): TextRun[] {
  return array(value, context).map((item, index) => {
    const location = field(context, String(index)), run = object(item, ['text', 'format'], ['text'], location)
    const result: TextRun = { text: text(run.text, field(location, 'text')) }
    if (run.format !== undefined) {
      const locationFormat = field(location, 'format')
      const format = object(run.format, ['bold', 'italic', 'underline', 'strike', 'script', 'highlight', 'link'], [], locationFormat)
      const output: NonNullable<TextRun['format']> = {}
      for (const key of ['bold', 'italic', 'underline', 'strike'] as const) if (format[key] !== undefined) output[key] = boolean(format[key], field(locationFormat, key))
      if (format.script !== undefined) {
        if (format.script !== 'superscript' && format.script !== 'subscript') bad('Script must be superscript or subscript.', field(locationFormat, 'script'))
        output.script = format.script as 'superscript' | 'subscript'
      }
      if (format.highlight !== undefined) {
        if (typeof format.highlight !== 'string' || !/^#[0-9a-f]{6}$/i.test(format.highlight)) bad('Highlight must be a #RRGGBB color.', field(locationFormat, 'highlight'), 'INVALID_COLOR')
        output.highlight = format.highlight as string
      }
      if (format.link !== undefined) output.link = link(format.link, field(locationFormat, 'link'))
      result.format = output
    }
    return result
  })
}

function semanticContent(value: unknown, context: Context = {}): SemanticContent {
  const valueObject = object(value, ['kind', 'level', 'runs', 'ordered', 'ordinal', 'assetId', 'alt', 'caption', 'header', 'rows', 'targetId'], ['kind'], context)
  const required = (keys: string[], optional: string[] = []) => object(value, ['kind', ...keys, ...optional], ['kind', ...keys], context)
  switch (valueObject.kind) {
    case 'heading': {
      const data = required(['level', 'runs'])
      return { kind: 'heading', level: integer(data.level, 1, 6, field(context, 'level')) as 1 | 2 | 3 | 4 | 5 | 6, runs: runs(data.runs, field(context, 'runs')) }
    }
    case 'paragraph': return { kind: 'paragraph', runs: runs(required(['runs']).runs, field(context, 'runs')) }
    case 'list-item': {
      const data = required(['ordered', 'runs'], ['ordinal']), ordered = boolean(data.ordered, field(context, 'ordered'))
      if (!ordered && data.ordinal !== undefined) bad('Unordered list items cannot declare an ordinal.', field(context, 'ordinal'), 'INVALID_LIST')
      return { kind: 'list-item', ordered, ...(ordered ? { ordinal: integer(data.ordinal, 1, Number.MAX_SAFE_INTEGER, field(context, 'ordinal')) } : {}), runs: runs(data.runs, field(context, 'runs')) }
    }
    case 'image': {
      const data = required(['assetId', 'alt'], ['caption'])
      return { kind: 'image', assetId: id(data.assetId, field(context, 'assetId')), alt: text(data.alt, field(context, 'alt')), ...(data.caption !== undefined ? { caption: text(data.caption, field(context, 'caption')) } : {}) }
    }
    case 'table': {
      const data = required(['header', 'rows']), rows = array(data.rows, field(context, 'rows'))
      if (!rows.length) bad('A table needs at least one row and one column.', field(context, 'rows'), 'INVALID_TABLE')
      let width = 0
      const output = rows.map((row, rowIndex) => {
        const location = field(context, `rows.${rowIndex}`), cells = array(row, location)
        if (!rowIndex) width = cells.length
        if (!width || cells.length !== width) bad('Table rows must form a nonempty rectangle; merged cells are unsupported.', location, 'INVALID_TABLE')
        return cells.map((cell, column) => runs(cell, field(location, String(column))))
      })
      return { kind: 'table', header: boolean(data.header, field(context, 'header')), rows: output }
    }
    case 'reference': return { kind: 'reference', targetId: id(required(['targetId']).targetId, field(context, 'targetId')) }
    default: return bad(`Unsupported content kind: ${String(valueObject.kind)}`, field(context, 'kind'), 'UNSUPPORTED_CONTENT')
  }
}

function sourceLocation(value: unknown, context: Context): SourceLocation {
  const source = object(value, ['file', 'pointer', 'from', 'to', 'line', 'column'], ['file'], context)
  const result: SourceLocation = { file: text(source.file, field(context, 'file'), true) }
  if (source.pointer !== undefined) {
    const pointer = text(source.pointer, field(context, 'pointer'))
    if (pointer !== '' && (!pointer.startsWith('/') || /~(?:[^01]|$)/.test(pointer))) bad('Source pointer must be a JSON Pointer.', field(context, 'pointer'))
    result.pointer = pointer
  }
  if ((source.from === undefined) !== (source.to === undefined)) bad('Source offsets must provide both from and to.', context)
  if (source.from !== undefined) {
    result.from = integer(source.from, 0, Number.MAX_SAFE_INTEGER, field(context, 'from'))
    result.to = integer(source.to, result.from, Number.MAX_SAFE_INTEGER, field(context, 'to'))
  }
  for (const key of ['line', 'column'] as const) if (source[key] !== undefined) result[key] = integer(source[key], 1, Number.MAX_SAFE_INTEGER, field(context, key))
  if (result.column !== undefined && result.line === undefined) bad('Source column requires a line.', field(context, 'column'))
  return result
}

function typography(value: unknown, context: Context): MarkTypography {
  object(value, ['fontFamily', 'fontSize'], [], context)
  let style: MarkTypography
  try { style = resolveTypography({ revision: 0, roots: [{ id: 'style', content: null, style: value as MarkTypography, children: [] }], retiredIds: [] }, 'style') }
  catch (error) { return bad(error instanceof Error ? error.message : String(error), context, 'INVALID_STYLE') }
  if (style.fontFamily && (/^(?:system|system-ui|serif|sans-serif|monospace|cursive|fantasy|inherit|initial|unset|revert|ui-serif|ui-sans-serif|ui-monospace|ui-rounded)$/i.test(style.fontFamily.trim()) || /[,;{}<>]/.test(style.fontFamily))) bad('Output font must name one explicit family; device or CSS fallback fonts are unsupported.', field(context, 'fontFamily'), 'IMPLICIT_FONT')
  return style
}

/** Content validation and local Mark-reference semantics can be reused by any typed MarkEngine. */
export const semanticEngineOptions: SemanticEngineOptions = {
  validateContent: value => { semanticContent(value) },
  references: {
    get: value => value.kind === 'reference' ? [value.targetId] : [],
    remap: (value, ids) => value.kind === 'reference' ? { ...value, targetId: ids.get(value.targetId) ?? value.targetId } : value,
  },
}

export function normalizeDocument(input: unknown): NormalizedDocument {
  const owned = jsonData(input)
  const data = object(owned, ['format', 'version', 'documentId', 'revision', 'marks', 'assets', 'retiredIds', 'consumedSources'], ['format', 'version', 'documentId', 'revision', 'marks', 'assets'], {})
  const documentId = id(data.documentId, { field: 'documentId' }), context: Context = { documentId }
  if (data.format !== 'markflow' || data.version !== 1) bad('Expected markflow document version 1.', field(context, 'version'), 'UNSUPPORTED_VERSION')
  const revision = integer(data.revision, 0, Number.MAX_SAFE_INTEGER - 1, field(context, 'revision'))
  const knownIds = new Set<string>(), sources: Record<string, SourceLocation> = Object.create(null)
  const uniqueId = (value: unknown, location: Context): string => {
    const result = id(value, location)
    if (knownIds.has(result)) bad(`Duplicate or retired Mark ID: ${result}`, location, 'DUPLICATE_ID')
    knownIds.add(result); return result
  }
  const roots = array(data.marks, field(context, 'marks')).map((value, index) => {
    let location = field(context, `marks.${index}`)
    const mark = object(value, ['id', 'content', 'style', 'source'], ['id', 'content'], location)
    const markId = uniqueId(mark.id, field(location, 'id'))
    location = { ...location, markId }
    if (mark.source !== undefined) { sources[markId] = sourceLocation(mark.source, field(location, 'source')); location = { ...location, source: sources[markId] } }
    return { id: markId, content: semanticContent(mark.content, field(location, 'content')), style: mark.style === undefined ? {} : typography(mark.style, field(location, 'style')), children: [] }
  })
  const retiredIds = array(data.retiredIds === undefined ? [] : data.retiredIds, field(context, 'retiredIds')).map((value, index) => uniqueId(value, field(context, `retiredIds.${index}`)))
  const consumedSources = array(data.consumedSources === undefined ? [] : data.consumedSources, field(context, 'consumedSources')).map((value, index) => {
    const location = field(context, `consumedSources.${index}`), item = object(value, ['id', 'source'], ['id', 'source'], location)
    return { id: uniqueId(item.id, field(location, 'id')), source: sourceLocation(item.source, field(location, 'source')) }
  })
  const assetIds = new Set<string>()
  const assets: AssetInput[] = array(data.assets, field(context, 'assets')).map((value, index) => {
    const location = field(context, `assets.${index}`), asset = object(value, ['id', 'path'], ['id', 'path'], location), assetId = id(asset.id, field(location, 'id'))
    if (assetIds.has(assetId)) bad(`Duplicate asset ID: ${assetId}`, field(location, 'id'), 'DUPLICATE_ASSET')
    assetIds.add(assetId)
    const path = text(asset.path, field(location, 'path'), true).replaceAll('\\', '/')
    if (path.split('/').some(part => !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || part.toLowerCase() === '.git' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) bad('Assets must use a safe relative path inside the granted asset root.', field(location, 'path'), 'UNSAFE_ASSET_PATH')
    return { id: assetId, path }
  })
  const byId = new Map(roots.map(mark => [mark.id, mark]))
  for (let index = 0; index < roots.length; index++) {
    const mark = roots[index], location: Context = { ...context, markId: mark.id, field: `marks.${index}.content`, ...(sources[mark.id] ? { source: sources[mark.id] } : {}) }
    if (mark.content.kind === 'image' && !assetIds.has(mark.content.assetId)) bad(`Missing asset: ${mark.content.assetId}`, field(location, 'assetId'), 'MISSING_ASSET')
    if (mark.content.kind === 'reference' && !byId.has(mark.content.targetId)) bad(`Reference target is not a renderable Mark: ${mark.content.targetId}`, field(location, 'targetId'), 'INVALID_REFERENCE')
  }
  const resolved = new Set<string>()
  for (const start of roots) {
    const chain = new Set<string>(); let current = start
    while (!resolved.has(current.id) && current.content.kind === 'reference') {
      if (chain.has(current.id)) bad(`Content reference cycle involving ${current.id}.`, { ...context, markId: current.id, field: 'content.targetId', ...(sources[current.id] ? { source: sources[current.id] } : {}) }, 'REFERENCE_CYCLE')
      chain.add(current.id); current = byId.get(current.content.targetId)!
    }
    for (const markId of chain) resolved.add(markId)
  }
  return { documentId, snapshot: { revision, roots, retiredIds }, assets, sources, consumedSources }
}

export function applySemanticCommands(input: MarkDocumentInput, commands: MarkCommand<SemanticContent>[], expectedRevision: number): MarkDocumentInput {
  const before = normalizeDocument(input), context = { documentId: before.documentId, field: 'commands' }
  integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1, { ...context, field: 'expectedRevision' })
  const owned = jsonData(commands, context)
  const required: Record<string, string[]> = {
    insert: ['parentId', 'index', 'marks'], edit: ['id', 'content'], style: ['id', 'patch'], move: ['id', 'parentId', 'index'], copy: ['id', 'parentId', 'index'], split: ['id', 'parts'], merge: ['ids', 'content'], remove: ['id'],
  }
  array(owned, context).forEach((command, index) => {
    const location = field(context, String(index)), value = object(command, ['type', 'id', 'ids', 'parentId', 'index', 'marks', 'content', 'patch', 'parts'], ['type'], location)
    if (typeof value.type !== 'string' || !Object.hasOwn(required, value.type)) bad('Unknown Mark command.', field(location, 'type'), 'INVALID_COMMAND')
    const keys = required[value.type as string]
    object(command, ['type', ...keys], ['type', ...keys], location)
    const commandLocation = typeof value.id === 'string' ? { ...location, markId: value.id, ...(before.sources[value.id] ? { source: before.sources[value.id] } : {}) } : location
    if (value.type === 'edit' || value.type === 'merge') semanticContent(value.content, field(commandLocation, 'content'))
    if (value.type === 'insert') array(value.marks, field(location, 'marks')).forEach((mark, at) => {
      const markLocation = field(location, `marks.${at}`), item = object(mark, ['id', 'content', 'style', 'children'], ['content'], markLocation)
      if (item.children !== undefined && array(item.children, field(markLocation, 'children')).length) bad('Semantic documents use flat Marks.', field(markLocation, 'children'), 'UNSUPPORTED_STRUCTURE')
      semanticContent(item.content, field(markLocation, 'content'))
      if (item.style !== undefined) typography(item.style, field(markLocation, 'style'))
    })
    if (value.type === 'split') array(value.parts, field(location, 'parts')).forEach((part, at) => {
      const partLocation = field(commandLocation, `parts.${at}`), item = object(part, ['content', 'style'], ['content'], partLocation)
      semanticContent(item.content, field(partLocation, 'content'))
      if (item.style !== undefined) typography(item.style, field(partLocation, 'style'))
    })
  })
  let snapshot: MarkSnapshot<SemanticContent>
  try { snapshot = applyMarkCommands(before.snapshot, owned, { ...semanticEngineOptions, expectedRevision }) }
  catch (error) {
    if (error instanceof CompilationError) throw new CompilationError(error.diagnostics.map(item => ({ ...context, ...item })))
    const codes: Record<MarkEngineError['code'], string> = { 'revision-conflict': 'REVISION_CONFLICT', 'invalid-reference': 'INVALID_REFERENCE', 'retired-id': 'RETIRED_ID', 'duplicate-id': 'DUPLICATE_ID', 'unknown-id': 'UNKNOWN_MARK', invalid: 'INVALID_COMMAND' }
    return bad(error instanceof Error ? error.message : String(error), context, error instanceof MarkEngineError ? codes[error.code] : 'INVALID_COMMAND')
  }
  const sources: Record<string, SourceLocation> = Object.assign(Object.create(null), before.sources)
  for (const command of owned) {
    if (command.type === 'edit' || command.type === 'split') delete sources[command.id]
    else if (command.type === 'merge') for (const markId of command.ids) delete sources[markId]
  }
  const result: MarkDocumentInput = {
    format: 'markflow', version: 1, documentId: before.documentId, revision: snapshot.revision,
    marks: snapshot.roots.map(mark => {
      if (mark.children.length) bad('Semantic documents use flat Marks.', { documentId: before.documentId, markId: mark.id }, 'UNSUPPORTED_STRUCTURE')
      return { id: mark.id, content: mark.content, style: mark.style, ...(sources[mark.id] ? { source: sources[mark.id] } : {}) }
    }),
    assets: before.assets, retiredIds: snapshot.retiredIds, consumedSources: before.consumedSources,
  }
  normalizeDocument(result)
  return result
}
