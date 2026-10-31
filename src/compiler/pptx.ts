import pptxgen from 'pptxgenjs'
import type { CompilationPlan, PlacedMark, TextRun } from './types.js'

const inch = (pt: number) => pt / 72
function rich(runs: TextRun[]): pptxgen.TextProps[] {
  return runs.map(run => ({ text: run.text, options: {
    bold: run.format?.bold, italic: run.format?.italic, underline: run.format?.underline ? { style: 'sng' } : undefined,
    strike: run.format?.strike, superscript: run.format?.script === 'superscript', subscript: run.format?.script === 'subscript',
    highlight: run.format?.highlight?.replace('#', ''), hyperlink: run.format?.link ? { url: run.format.link } : undefined,
  } }))
}
function joined(lines: TextRun[][]): TextRun[] {
  return lines.flatMap((line, index) => [...(index ? [{ text: '\n' }] : []), ...line])
}

/** Native Office objects only. The prepared plan supplies all image bytes and measured boxes. */
export async function writePptx(plan: CompilationPlan): Promise<Uint8Array> {
  if (plan.target !== 'pptx') throw new Error('PPTX writer requires a pptx plan.')
  const deck = new pptxgen()
  const { theme } = plan
  deck.defineLayout({ name: 'MARKFLOW', width: inch(theme.stage.widthPt), height: inch(theme.stage.heightPt) })
  deck.layout = 'MARKFLOW'
  deck.author = 'MarkFlow'; deck.subject = plan.documentId; deck.title = plan.documentId
  deck.theme = { headFontFace: theme.fontFamily, bodyFontFace: theme.fontFamily }

  for (const page of plan.slides) {
    const slide = deck.addSlide()
    slide.background = { color: theme.background }
    slide.addShape(deck.ShapeType.rect, { x: inch(theme.stage.marginPt), y: inch(25), w: inch(36), h: inch(3), fill: { color: theme.accent }, line: { color: theme.accent }, objectName: 'theme-accent' })
    function text(item: PlacedMark, title = false): void {
      const { mark, box, fontSizePt } = item
      const options: pptxgen.TextPropsOptions = {
        x: inch(box.x), y: inch(box.y), w: inch(box.width), h: inch(box.height),
        fontFace: mark.style.fontFamily ?? theme.fontFamily, fontSize: fontSizePt, color: theme.ink,
        bold: title || mark.content.kind === 'heading', margin: 0, valign: 'top',
        lineSpacingMultiple: theme.stage.lineHeight, paraSpaceAfter: 0, breakLine: false,
        fit: 'none', wrap: false, objectName: mark.id, lang: 'zh-CN',
      }
      if (mark.content.kind === 'list-item') {
        // A wrapped item's continuation is separate from its first native bullet paragraph.
        // This prevents each measured continuation from acquiring another bullet in Office.
        for (const [index, line] of (item.lines ?? []).entries()) {
          slide.addText(rich(line), { ...options, x: inch(box.x + (index ? 28 : 0)), y: inch(box.y + index * fontSizePt * theme.stage.lineHeight), w: inch(box.width - (index ? 28 : 0)), h: inch(fontSizePt * theme.stage.lineHeight + 4),
            bullet: index ? undefined : mark.content.ordered ? { type: 'number', numberType: 'arabicPeriod', numberStartAt: mark.content.ordinal ?? 1, indent: fontSizePt } : { indent: fontSizePt },
          })
        }
      } else slide.addText(rich(joined(item.lines ?? [])), options)
    }
    text(page.title, true)
    for (const item of page.items) {
      const { content } = item.mark
      const { box } = item
      if (content.kind === 'image') {
        const asset = plan.assets.get(content.assetId)!
        slide.addImage({ data: `data:${asset.mime};base64,${Buffer.from(asset.data).toString('base64')}`, x: inch(box.x), y: inch(box.y), w: inch(box.width), h: inch(box.height), altText: content.alt, objectName: item.mark.id })
      } else if (content.kind === 'table') {
        const rows: pptxgen.TableRow[] = content.rows.map((row, rowIndex) => row.map((cell, colIndex) => ({
          text: rich(joined(item.tableLines?.[rowIndex][colIndex] ?? [cell])) as pptxgen.TableCell[],
          options: { bold: content.header && rowIndex === 0, fill: { color: content.header && rowIndex === 0 ? 'E4EBE7' : theme.background } },
        })))
        slide.addTable(rows, { x: inch(box.x), y: inch(box.y), w: inch(box.width), h: inch(box.height),
          rowH: item.rowHeightsPt!.map(inch), colW: inch(box.width / content.rows[0].length),
          fontFace: item.mark.style.fontFamily ?? theme.fontFamily, fontSize: item.fontSizePt, color: theme.ink,
          margin: 10, border: { type: 'solid', color: 'C8D2CD', pt: 0.6 }, valign: 'top',
          autoPage: false, objectName: item.mark.id,
        })
      } else text(item)
    }
  }
  const bytes = await deck.write({ outputType: 'uint8array' })
  if (!(bytes instanceof Uint8Array)) throw new Error('PPTX writer returned unexpected bytes.')
  return bytes
}
