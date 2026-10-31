import {
  AlignmentType, Document, ExternalHyperlink, HeadingLevel, HighlightColor, ImageRun, LevelFormat,
  Packer, Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun as WordRun,
  UnderlineType, WidthType, type ILevelsOptions, type IParagraphOptions, type IRunOptions, type ParagraphChild,
} from 'docx'
import type { CompilationPlan, ResolvedMark, TextRun } from './types.js'

const headings = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6]
const highlightColors: Record<string, typeof HighlightColor[keyof typeof HighlightColor]> = {
  '000000': HighlightColor.BLACK, '0000FF': HighlightColor.BLUE, '00FFFF': HighlightColor.CYAN,
  '00FF00': HighlightColor.GREEN, FF00FF: HighlightColor.MAGENTA, FF0000: HighlightColor.RED,
  FFFF00: HighlightColor.YELLOW, FFFFFF: HighlightColor.WHITE, '000080': HighlightColor.DARK_BLUE,
  '008080': HighlightColor.DARK_CYAN, '008000': HighlightColor.DARK_GREEN, '800080': HighlightColor.DARK_MAGENTA,
  '800000': HighlightColor.DARK_RED, '808000': HighlightColor.DARK_YELLOW, '808080': HighlightColor.DARK_GRAY,
  C0C0C0: HighlightColor.LIGHT_GRAY,
}
const formatKeys = new Set(['bold', 'italic', 'underline', 'strike', 'script', 'highlight', 'link'])
const twips = (pt: number) => Math.round(pt * 20)
const halfPoints = (pt: number) => Math.round(pt * 2)
const font = (family: string) => ({ ascii: family, hAnsi: family, eastAsia: family, cs: family })
function fail(mark: ResolvedMark, message: string): never { throw new Error(`DOCX [${mark.id}] ${message}`) }

/** A prepared plan in, native OOXML bytes out. The caller owns validation, resources and safe file writes. */
export async function writeDocx(plan: CompilationPlan): Promise<Uint8Array> {
  if (plan.target !== 'docx') throw new Error('DOCX writer requires a docx compilation plan.')
  const { theme } = plan
  const bodyWidth = theme.note.widthPt - 2 * theme.note.marginPt
  const bodyHeight = theme.note.heightPt - 2 * theme.note.marginPt
  const content: (Paragraph | Table)[] = []
  const numbering: { reference: string; levels: ILevelsOptions[] }[] = []
  let list: { reference: string; ordered: boolean; next: number } | undefined

  function runStyle(mark: ResolvedMark, sizePt: number): IRunOptions {
    const size = halfPoints(mark.style.fontSize === undefined ? sizePt : mark.style.fontSize * 0.75)
    return { font: font(mark.style.fontFamily ?? theme.fontFamily), size, sizeComplexScript: size, color: theme.ink, language: { value: 'zh-CN', eastAsia: 'zh-CN' } }
  }
  function runs(mark: ResolvedMark, values: TextRun[], sizePt: number, bold = false): ParagraphChild[] {
    return values.flatMap<ParagraphChild>(value => {
      const format = value.format ?? {}
      if (Object.keys(format).some(key => !formatKeys.has(key))) fail(mark, 'Unsupported inline format.')
      if (format.script && !['superscript', 'subscript'].includes(format.script)) fail(mark, 'Unsupported script format.')
      let highlight: IRunOptions = {}
      if (format.highlight) {
        const color = format.highlight.replace(/^#/, '').toUpperCase()
        if (!/^[\dA-F]{6}$/.test(color)) fail(mark, 'Highlight must be an RGB color.')
        highlight = highlightColors[color] ? { highlight: highlightColors[color] } : { shading: { type: ShadingType.CLEAR, fill: color } }
      }
      const style: IRunOptions = {
        ...runStyle(mark, sizePt), bold: format.bold ?? bold, boldComplexScript: format.bold ?? bold,
        italics: format.italic, italicsComplexScript: format.italic,
        underline: format.underline ? { type: UnderlineType.SINGLE } : undefined,
        strike: format.strike, superScript: format.script === 'superscript', subScript: format.script === 'subscript', ...highlight,
      }
      const children = value.text.split(/\r\n|\r|\n/).map((text, index) => new WordRun({ ...style, text, break: index ? 1 : undefined }))
      if (!format.link) return children
      if (!/^(https?:\/\/|mailto:)/i.test(format.link)) fail(mark, 'Unsupported hyperlink protocol.')
      return [new ExternalHyperlink({ link: format.link, children })]
    })
  }
  const spacing = { before: 0, after: twips(8), line: Math.round(theme.note.lineHeight * 240) }
  const paragraph = (mark: ResolvedMark, children: ParagraphChild[], pageBreakBefore: boolean, options: IParagraphOptions = {}) =>
    new Paragraph({ children, spacing, widowControl: true, pageBreakBefore, ...options, run: runStyle(mark, theme.note.bodyPt) })

  for (const [sectionIndex, section] of plan.sections.entries()) {
    list = undefined
    for (const [markIndex, mark] of section.marks.entries()) {
      const item = mark.content
      const pageBreakBefore = section.breakBefore && markIndex === 0 && content.length > 0
      if (item.kind !== 'list-item') list = undefined
      switch (item.kind) {
        case 'heading': {
          if (!headings[item.level - 1]) fail(mark, 'Unsupported heading level.')
          content.push(paragraph(mark, runs(mark, item.runs, theme.note.headingPt[item.level - 1], true), pageBreakBefore, {
            heading: sectionIndex === 0 && markIndex === 0 && item.level === 1 ? HeadingLevel.TITLE : headings[item.level - 1],
            keepNext: true, spacing: { ...spacing, before: twips(markIndex ? 12 : 0) },
          }))
          break
        }
        case 'paragraph':
          content.push(paragraph(mark, runs(mark, item.runs, theme.note.bodyPt), pageBreakBefore))
          break
        case 'list-item': {
          const ordinal: number = item.ordinal ?? (list?.ordered ? list.next : 1)
          if (!list || list.ordered !== item.ordered || item.ordered && ordinal !== list.next) {
            list = { reference: `markflow-list-${numbering.length}`, ordered: item.ordered, next: ordinal }
            numbering.push({ reference: list.reference, levels: [{
              level: 0, format: item.ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET,
              text: item.ordered ? '%1.' : '•', start: item.ordered ? ordinal : 1, alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: twips(18), hanging: twips(12) } }, run: runStyle(mark, theme.note.bodyPt) },
            }] })
          }
          content.push(paragraph(mark, runs(mark, item.runs, theme.note.bodyPt), pageBreakBefore, { numbering: { reference: list.reference, level: 0 } }))
          list.next = ordinal + 1
          break
        }
        case 'image': {
          const asset = plan.assets.get(item.assetId)
          if (!asset) fail(mark, `Missing prepared image: ${item.assetId}`)
          const availableHeight = bodyHeight - (item.caption ? theme.note.bodyPt * theme.note.lineHeight + 16 : 8)
          const ratio = Math.min(1, bodyWidth / (asset.width * 0.75), availableHeight / (asset.height * 0.75))
          content.push(paragraph(mark, [new ImageRun({
            type: asset.mime === 'image/png' ? 'png' : 'jpg', data: asset.data,
            transformation: { width: asset.width * ratio, height: asset.height * ratio },
            altText: { name: item.alt, title: item.alt, description: item.alt },
          })], pageBreakBefore, { keepNext: !!item.caption }))
          if (item.caption) content.push(paragraph(mark, runs(mark, [{ text: item.caption }], theme.note.bodyPt), false, { style: 'Caption' }))
          break
        }
        case 'table': {
          const columns = item.rows[0]?.length ?? 0
          if (!columns || item.rows.some(row => row.length !== columns)) fail(mark, 'Table rows must have the same nonzero column count.')
          if (pageBreakBefore) content.push(new Paragraph({ pageBreakBefore: true, spacing: { before: 0, after: 0, line: 1 }, run: { size: 2 } }))
          const width = twips(bodyWidth), columnWidth = Math.floor(width / columns)
          const widths = Array.from({ length: columns }, (_, index) => index === columns - 1 ? width - columnWidth * (columns - 1) : columnWidth)
          content.push(new Table({
            width: { size: width, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED,
            margins: { top: twips(5), bottom: twips(5), left: twips(6), right: twips(6) },
            rows: item.rows.map((row, rowIndex) => new TableRow({
              tableHeader: item.header && rowIndex === 0,
              children: row.map((cell, columnIndex) => new TableCell({
                width: { size: widths[columnIndex], type: WidthType.DXA },
                children: [paragraph(mark, runs(mark, cell, theme.note.bodyPt, item.header && rowIndex === 0), false, { spacing: { ...spacing, after: 0 } })],
              })),
            })),
          }))
          break
        }
        default: fail(mark, 'Unsupported semantic content. References must be resolved before writing.')
      }
    }
  }
  const doc = new Document({
    creator: 'MarkFlow', title: plan.documentId,
    styles: { default: {
      document: { run: { font: font(theme.fontFamily), size: halfPoints(theme.note.bodyPt), color: theme.ink }, paragraph: { spacing } },
      title: { run: { font: font(theme.fontFamily), size: halfPoints(theme.note.headingPt[0]), bold: true }, paragraph: { keepNext: true } },
    }, paragraphStyles: headings.map((id, index) => ({
      id, name: id, basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { font: font(theme.fontFamily), size: halfPoints(theme.note.headingPt[index]), bold: true, color: theme.ink },
      paragraph: { keepNext: true, outlineLevel: index },
    })) },
    numbering: { config: numbering },
    sections: [{ properties: { page: {
      size: { width: twips(theme.note.widthPt), height: twips(theme.note.heightPt) },
      margin: { top: twips(theme.note.marginPt), bottom: twips(theme.note.marginPt), left: twips(theme.note.marginPt), right: twips(theme.note.marginPt) },
    } }, children: content }],
  })
  return Packer.toBuffer(doc)
}
