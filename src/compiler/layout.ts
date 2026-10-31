import { diagnostic, failCompilation, throwIfErrors } from './diagnostics.js'
import { applyMarkCommands } from '../engine/index.js'
import { normalizeDocument } from './model.js'
import { FontMetrics, hashObject, resolveAssets } from './resources.js'
import { standardTheme } from './theme.js'
import type { CompileOptions, CompilationPlan, Diagnostic, PlacedMark, Presentation, ResolvedMark, SemanticContent, TextRun } from './types.js'

function schema(value: unknown, keys: string[], required = keys): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) failCompilation('PRESENTATION_SCHEMA', 'Expected a presentation object.')
  const data = value as Record<string, unknown>
  for (const key of Object.keys(data)) if (!keys.includes(key)) failCompilation('PRESENTATION_SCHEMA', `Unknown presentation field: ${key}.`, { field: key })
  for (const key of required) if (!Object.hasOwn(data, key)) failCompilation('PRESENTATION_SCHEMA', `Missing presentation field: ${key}.`, { field: key })
  return data
}
function ids(value: unknown): void {
  if (!Array.isArray(value) || value.length > 2000 || value.some(item => typeof item !== 'string' || !item)) failCompilation('PRESENTATION_SCHEMA', 'marks must be an array of at most 2000 Mark IDs.')
}
export function validatePresentation(input: unknown): Presentation {
  try { input = applyMarkCommands({ revision: 0, roots: [], retiredIds: [] }, [{ type: 'insert', parentId: null, index: 0, marks: [{ id: 'presentation', content: input }] }]).roots[0].content }
  catch { failCompilation('PRESENTATION_SCHEMA', 'Presentation must be plain JSON data without getters, sparse arrays or cycles.') }
  const data = schema(input, ['format', 'version', 'target', 'theme', 'sections', 'slides'], ['format', 'version', 'target', 'theme'])
  if (data.format !== 'markflow-presentation' || data.version !== 1) failCompilation('PRESENTATION_VERSION', 'Expected markflow-presentation version 1.')
  if (data.theme !== 'standard-v1') failCompilation('THEME_UNKNOWN', 'Only the explicit standard-v1 theme is supported.')
  if (data.target === 'docx') {
    if (data.slides !== undefined || !Array.isArray(data.sections) || !data.sections.length || data.sections.length > 100) failCompilation('PRESENTATION_SCHEMA', 'DOCX requires 1–100 sections and no slides.')
    for (const section of data.sections) {
      const item = schema(section, ['marks', 'breakBefore'], ['marks'])
      ids(item.marks)
      if (!(item.marks as string[]).length || (item.breakBefore !== undefined && typeof item.breakBefore !== 'boolean')) failCompilation('PRESENTATION_SCHEMA', 'Each section requires marks and an optional boolean breakBefore.')
    }
  } else if (data.target === 'pptx') {
    if (data.sections !== undefined || !Array.isArray(data.slides) || !data.slides.length || data.slides.length > 100) failCompilation('PRESENTATION_SCHEMA', 'PPTX requires 1–100 slides and no sections.')
    for (const slide of data.slides) {
      const item = schema(slide, ['layout', 'title', 'marks'])
      if (typeof item.layout !== 'string' || !['cover', 'body', 'image', 'table'].includes(item.layout) || typeof item.title !== 'string' || !item.title) failCompilation('PRESENTATION_SCHEMA', 'Slide requires a supported layout and title Mark ID.')
      ids(item.marks)
    }
  } else failCompilation('TARGET_UNKNOWN', 'Only docx and pptx generation are supported.')
  return data as unknown as Presentation
}

const textRuns = (content: SemanticContent): TextRun[] => 'runs' in content ? content.runs : content.kind === 'image' ? [{ text: content.caption ?? '' }] : []

export async function prepareCompilation(input: unknown, presentationInput: unknown, options: CompileOptions, sourceDiagnostics: Diagnostic[] = []): Promise<CompilationPlan> {
  throwIfErrors(sourceDiagnostics)
  const normalized = normalizeDocument(input)
  const presentation = validatePresentation(presentationInput)
  const theme = structuredClone(standardTheme)
  const diagnostics = structuredClone(sourceDiagnostics)
  const nodes = new Map(normalized.snapshot.roots.map(mark => [mark.id, mark]))
  const resolved = new Map<string, ResolvedMark>()
  function resolveCached(id: string): ResolvedMark {
    const chain: typeof normalized.snapshot.roots = [], visited = new Set<string>()
    let next = id
    while (!resolved.has(next)) {
      const node = nodes.get(next)
      if (!node) failCompilation('PRESENTATION_REFERENCE', `Presentation references missing Mark ${next}.`, { documentId: normalized.documentId, markId: next })
      if (visited.has(next)) failCompilation('REFERENCE_CYCLE', `Reference cycle at ${next}.`, { markId: next })
      visited.add(next); chain.push(node)
      if (node.content.kind !== 'reference') break
      next = node.content.targetId
    }
    let target = resolved.get(next)
    for (let index = chain.length - 1; index >= 0; index--) {
      const node = chain[index]
      const content = node.content.kind === 'reference' ? target!.content : node.content
      target = { id: node.id, content, style: { ...target?.style, ...node.style }, source: normalized.sources[node.id] }
      resolved.set(node.id, target)
    }
    return resolved.get(id)!
  }
  const resolve = (id: string): ResolvedMark => { const mark = resolveCached(id); return { ...mark, content: structuredClone(mark.content), style: { ...mark.style } } }
  const selected = presentation.target === 'docx' ? presentation.sections.flatMap(section => section.marks) : presentation.slides.flatMap(slide => [slide.title, ...slide.marks])
  const marks = [...new Set(selected)].map(id => resolveCached(id))
  const metrics = new FontMetrics()
  await metrics.load([theme.fontFamily, ...marks.map(mark => mark.style.fontFamily ?? theme.fontFamily)], options.fontFiles)
  const assets = await resolveAssets(normalized.assets, options.assetRoot)
  const size = (mark: ResolvedMark, defaultSize: number): number => mark.style.fontSize === undefined ? defaultSize : mark.style.fontSize * 0.75
  const wrap = (mark: ResolvedMark, runs: TextRun[], pt: number, width: number, bold = mark.content.kind === 'heading') => metrics.wrap(runs.map(run => ({ ...run, format: { ...run.format, bold: run.format?.bold ?? bold } })), mark, mark.style.fontFamily ?? theme.fontFamily, pt, width)
  function overflow(mark: ResolvedMark, reason: string): never {
    return failCompilation('LAYOUT_OVERFLOW', reason, { documentId: normalized.documentId, markId: mark.id, source: mark.source, suggestion: 'Shorten this Mark or select it on another slide; font size is never reduced automatically.' })
  }
  const plan: CompilationPlan = {
    target: presentation.target, documentId: normalized.documentId, revision: normalized.snapshot.revision, theme,
    sections: [], slides: [], assets,
    manifest: {
      compiler: { name: 'markflow', version: '0.1.0-compiler.1' }, target: presentation.target,
      documentId: normalized.documentId, revision: normalized.snapshot.revision,
      inputSha256: hashObject(normalized), presentationSha256: hashObject(presentation), planSha256: '',
      template: { id: theme.id, version: theme.version, sha256: hashObject(theme) },
      fonts: metrics.evidence, assets: [...assets.values()].map(({ id, relativePath, sha256 }) => ({ id, relativePath, sha256 })),
      writer: presentation.target === 'docx' ? { name: 'docx', version: '9.15.0' } : { name: 'pptxgenjs', version: '4.0.1' }, diagnostics,
    },
  }
  if (presentation.target === 'docx') {
    const width = theme.note.widthPt - 2 * theme.note.marginPt
    for (const section of presentation.sections) {
      const resolved = section.marks.map(id => resolve(id))
      for (const mark of resolved) {
        const content = mark.content
        const pt = size(mark, content.kind === 'heading' ? theme.note.headingPt[content.level - 1] : theme.note.bodyPt)
        if (pt < 8 || pt > 72) failCompilation('NOTE_FONT_SIZE', 'DOCX font size must be between 8 and 72 pt.', { markId: mark.id, source: mark.source })
        if (content.kind === 'table') {
          const colWidth = width / content.rows[0].length - 12
          if (colWidth < pt * 2) failCompilation('TABLE_COLUMN_WIDTH', 'Table columns need at least two character widths after cell padding.', { markId: mark.id, source: mark.source })
          for (const [rowIndex, row] of content.rows.entries()) {
            const heights = row.map(cell => wrap(mark, cell, pt, colWidth, content.header && rowIndex === 0).length * pt * theme.note.lineHeight + 12)
            if (Math.max(...heights) > theme.note.heightPt - 2 * theme.note.marginPt) failCompilation('TABLE_ROW_HEIGHT', 'A table row cannot fit on a report page.', { markId: mark.id, source: mark.source })
          }
        } else wrap(mark, textRuns(content), pt, width - (content.kind === 'list-item' ? 24 : 0))
      }
      plan.sections.push({ marks: resolved, breakBefore: section.breakBefore ?? false })
    }
    diagnostics.push(diagnostic('DOCX_PAGINATION', 'Final line wrapping and pagination are performed by Word/WPS; inspect the generated document in the declared application.', { severity: 'warning', documentId: normalized.documentId }))
  } else {
    const { marginPt: margin, widthPt: pageWidth, heightPt: pageHeight, bodyPt, minimumPt, lineHeight } = theme.stage
    const width = pageWidth - 2 * margin
    function textPlacement(mark: ResolvedMark, x: number, y: number, width: number, defaultPt = bodyPt, bold = mark.content.kind === 'heading'): PlacedMark {
      if (!('runs' in mark.content)) failCompilation('LAYOUT_CONTENT', 'This position requires a heading, paragraph or list item.', { markId: mark.id, source: mark.source })
      const pt = size(mark, defaultPt)
      if (pt < minimumPt || pt > 60) failCompilation('STAGE_FONT_SIZE', `Stage font size must be between ${minimumPt} and 60 pt.`, { markId: mark.id, source: mark.source })
      const lines = wrap(mark, mark.content.runs, pt, width - (mark.content.kind === 'list-item' ? 28 : 0), bold)
      const height = Math.max(1, lines.length) * pt * lineHeight + 6
      if (y + height > pageHeight - margin) overflow(mark, `Text needs ${Math.ceil(height)} pt; the remaining slide area is ${Math.floor(pageHeight - margin - y)} pt.`)
      return { mark, box: { x, y, width, height }, fontSizePt: pt, lines }
    }
    for (const slide of presentation.slides) {
      const titleMark = resolve(slide.title)
      if (!['heading', 'paragraph'].includes(titleMark.content.kind)) failCompilation('SLIDE_TITLE', 'Slide title must select a heading or paragraph.', { markId: titleMark.id })
      const title = textPlacement(titleMark, margin, slide.layout === 'cover' ? 120 : margin, width, slide.layout === 'cover' ? theme.stage.coverPt : theme.stage.titlePt, true)
      if (title.lines!.length > (slide.layout === 'cover' ? 3 : 2)) overflow(titleMark, 'Slide title exceeds the declared title area.')
      const resolved = slide.marks.map(id => resolve(id))
      const items: PlacedMark[] = []
      let y = title.box.y + title.box.height + 24
      const image = resolved.filter(mark => mark.content.kind === 'image')
      const tables = resolved.filter(mark => mark.content.kind === 'table')
      if ((slide.layout === 'image' && (image.length !== 1 || tables.length)) || (slide.layout === 'table' && (tables.length !== 1 || image.length)) || (['cover', 'body'].includes(slide.layout) && (image.length || tables.length))) failCompilation('LAYOUT_CONTENT', `Content does not match the ${slide.layout} layout.`, { markId: resolved[0]?.id, documentId: normalized.documentId })
      if (slide.layout === 'image') {
        const mark = image[0]
        const content = mark.content as Extract<SemanticContent, { kind: 'image' }>
        const asset = assets.get(content.assetId)!
        const maxHeight = pageHeight - margin - y - (content.caption ? 62 : 0)
        if (maxHeight <= 0) overflow(mark, 'No room remains for the image.')
        const maxWidth = width * 0.57
        const scale = Math.min(maxWidth / asset.width, maxHeight / asset.height)
        items.push({ mark, box: { x: margin, y, width: asset.width * scale, height: asset.height * scale }, fontSizePt: minimumPt })
        if (content.caption) {
          const captionMark: ResolvedMark = { ...mark, content: { kind: 'paragraph', runs: [{ text: content.caption }] } }
          const caption = textPlacement(captionMark, margin, y + asset.height * scale + 8, maxWidth, minimumPt)
          items.push(caption)
        }
        for (const mark of resolved.filter(item => item.content.kind !== 'image')) {
          const placed = textPlacement(mark, margin + width * 0.62, y, width * 0.38)
          items.push(placed); y += placed.box.height + 16
        }
      } else if (slide.layout === 'table') {
        for (const mark of resolved) {
          if (mark.content.kind !== 'table') {
            const placed = textPlacement(mark, margin, y, width); items.push(placed); y += placed.box.height + 18; continue
          }
          const pt = size(mark, bodyPt)
          if (pt < minimumPt || pt > 40) failCompilation('STAGE_FONT_SIZE', `Table text must be ${minimumPt}–40 pt.`, { markId: mark.id })
          const colWidth = width / mark.content.rows[0].length - 20
          if (colWidth < pt * 2) failCompilation('TABLE_COLUMN_WIDTH', 'Table columns need at least two character widths after cell padding.', { markId: mark.id, source: mark.source })
          const tableLines = mark.content.rows.map((row, rowIndex) => row.map(cell => wrap(mark, cell, pt, colWidth, mark.content.kind === 'table' && mark.content.header && rowIndex === 0)))
          const rowHeightsPt = tableLines.map(row => Math.max(...row.map(lines => lines.length * pt * lineHeight)) + 20)
          const height = rowHeightsPt.reduce((sum, item) => sum + item, 0)
          if (y + height > pageHeight - margin) overflow(mark, 'The table exceeds the available slide height.')
          items.push({ mark, box: { x: margin, y, width, height }, fontSizePt: pt, rowHeightsPt, tableLines }); y += height + 18
        }
      } else {
        for (const mark of resolved) {
          const placed = textPlacement(mark, margin, y, width, slide.layout === 'cover' ? 24 : bodyPt)
          items.push(placed); y += placed.box.height + 18
        }
      }
      plan.slides.push({ layout: slide.layout, title, items })
    }
  }
  plan.manifest.planSha256 = hashObject({ sections: plan.sections, slides: plan.slides, theme })
  return plan
}
