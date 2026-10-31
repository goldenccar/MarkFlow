import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { crc32, inflateSync } from 'node:zlib'
import { imageSize } from 'image-size'
import * as fontkit from 'fontkit'
import { failCompilation } from './diagnostics.js'
import type { AssetInput, FontEvidence, ResolvedAsset, ResolvedMark, TextRun } from './types.js'

export const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex')
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value)
}
export const hashObject = (value: unknown): string => sha256(canonical(value))
export function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function completeImage(data: Buffer, png: boolean): boolean {
  if (!png) return data.subarray(-2).equals(Buffer.from([255, 217])) && data.indexOf(Buffer.from([255, 218]), 2) > 0
  const compressed: Buffer[] = []
  let offset = 8, first = true, ended = false
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset)
    if (length > data.length - offset - 12) return false
    const type = data.toString('ascii', offset + 4, offset + 8)
    if (first && (type !== 'IHDR' || length !== 13)) return false
    first = false
    if (crc32(data.subarray(offset + 4, offset + 8 + length)) !== data.readUInt32BE(offset + 8 + length)) return false
    if (type === 'IDAT') compressed.push(data.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
    if (type === 'IEND') { ended = length === 0 && offset === data.length; break }
  }
  if (!ended || !compressed.length) return false
  try { return inflateSync(Buffer.concat(compressed), { maxOutputLength: 160 * 1024 * 1024 }).length > 0 } catch { return false }
}

/** No network, data URLs, absolute paths, or symlinks escaping the granted root. */
export async function resolveAssets(inputs: AssetInput[], assetRoot: string): Promise<Map<string, ResolvedAsset>> {
  const root = await realpath(assetRoot).catch(() => failCompilation('ASSET_ROOT', 'The declared asset root does not exist.'))
  const result = new Map<string, ResolvedAsset>()
  let total = 0
  for (const input of inputs) {
    const location = { field: `assets.${input.id}`, source: { file: input.path } }
    if (path.isAbsolute(input.path) || /^[a-z][a-z\d+.-]*:/i.test(input.path) || input.path.includes('\\') || input.path.includes('\0')) failCompilation('ASSET_SCOPE', 'Use a relative forward-slash path within the declared asset root.', location)
    const requested = path.resolve(root, input.path)
    if (!contained(root, requested)) failCompilation('ASSET_SCOPE', 'Asset path escapes the declared root.', location)
    const resolved = await realpath(requested).catch(() => failCompilation('ASSET_MISSING', 'The declared image does not exist.', location))
    if (!contained(root, resolved)) failCompilation('ASSET_SCOPE', 'Asset symlink escapes the declared root.', location)
    const info = await stat(resolved)
    total += info.size
    if (!info.isFile() || info.size > 20 * 1024 * 1024 || total > 64 * 1024 * 1024) failCompilation('ASSET_LIMIT', 'Images must be files up to 20 MiB each and 64 MiB in total.', location)
    const data = await readFile(resolved)
    const png = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255
    if (!png && !jpeg) failCompilation('ASSET_FORMAT', 'Only PNG and JPEG images are supported.', location)
    let dimensions: ReturnType<typeof imageSize>
    try { dimensions = imageSize(data) } catch { return failCompilation('ASSET_FORMAT', 'Invalid image header.', location) }
    const { width, height } = dimensions
    if (!width || !height || width > 32768 || height > 32768 || width * height > 40_000_000) failCompilation('ASSET_DIMENSIONS', 'Image exceeds the 40 megapixel or 32768 pixel dimension limit.', location)
    if (!completeImage(data, png)) failCompilation('ASSET_FORMAT', 'Truncated or corrupt image; PNG checksums/compressed stream and JPEG end markers must be intact.', location)
    if (dimensions.orientation && dimensions.orientation !== 1) failCompilation('IMAGE_ORIENTATION', 'Normalize JPEG orientation before compiling.', location)
    result.set(input.id, { id: input.id, relativePath: input.path, mime: png ? 'image/png' : 'image/jpeg', width, height, data, sha256: sha256(data) })
  }
  return result
}

export class FontMetrics {
  readonly evidence: FontEvidence[] = []
  private readonly fonts = new Map<string, fontkit.Font>()
  private readonly widths = new Map<string, number>()

  async load(families: string[], files: Record<string, string>): Promise<void> {
    for (const family of [...new Set(families)].sort()) {
      const file = files[family]
      if (!file) failCompilation('FONT_MISSING', `Declare a local font file for ${family}.`, { field: 'fontFiles', suggestion: 'Pass --font "Family=absolute/font/file"; fonts are not embedded.' })
      const info = await stat(file).catch(() => failCompilation('FONT_MISSING', `Cannot read declared font ${family}.`, { field: 'fontFiles' }))
      if (!info.isFile() || info.size > 64 * 1024 * 1024) failCompilation('FONT_LIMIT', 'Font must be a file of at most 64 MiB.')
      const data = await readFile(file)
      let parsed: fontkit.Font | fontkit.FontCollection
      try { parsed = fontkit.create(data) } catch { return failCompilation('FONT_FORMAT', `Cannot parse declared font ${family}.`) }
      const candidates = 'fonts' in parsed ? parsed.fonts : [parsed]
      const matching = candidates.filter(item => item.familyName.toLowerCase() === family.toLowerCase())
      const font = matching.find(item => /regular|normal|book/i.test(item.subfamilyName)) ?? matching[0]
      if (!font) failCompilation('FONT_FAMILY', `The declared file does not contain family ${family}.`)
      this.fonts.set(family, font)
      this.evidence.push({ family, file: path.basename(file), sha256: sha256(data), postscriptName: font.postscriptName, unitsPerEm: font.unitsPerEm })
    }
  }

  /** Conservative widths include a safety margin for synthetic bold/italic in Office. */
  width(text: string, family: string, sizePt: number, styled = false): number {
    const key = `${family}\0${text}`
    let em = this.widths.get(key)
    if (em === undefined) {
      const font = this.fonts.get(family)!
      em = font.layout(text).positions.reduce((sum, item) => sum + item.xAdvance, 0) / font.unitsPerEm
      this.widths.set(key, em)
    }
    return em * sizePt * (styled ? 1.12 : 1.04)
  }

  wrap(runs: TextRun[], mark: ResolvedMark, family: string, sizePt: number, widthPt: number): TextRun[][] {
    const font = this.fonts.get(family)!
    const lines: TextRun[][] = [[]]
    let used = 0, previousFormat: string | undefined
    for (const run of runs) {
      const format = canonical(run.format), styled = !!(run.format?.bold || run.format?.italic)
      for (const char of run.text.replace(/\r\n|\r/g, '\n')) {
        if (char === '\n') { lines.push([]); used = 0; continue }
        if (char === '\t') failCompilation('TEXT_TAB', 'Tabs are not supported in the first layout subset; use spaces.', { markId: mark.id, source: mark.source })
        if (!font.hasGlyphForCodePoint(char.codePointAt(0)!)) failCompilation('FONT_GLYPH', `Font ${family} lacks character U+${char.codePointAt(0)!.toString(16).toUpperCase()}.`, { markId: mark.id, source: mark.source, suggestion: 'Declare a font covering the source characters.' })
        const width = this.width(char, family, sizePt, styled)
        if (width > widthPt) failCompilation('TEXT_WIDTH', 'A character is wider than the available text box.', { markId: mark.id, source: mark.source })
        if (used + width > widthPt && lines.at(-1)!.length) { lines.push([]); used = 0 }
        const line = lines.at(-1)!
        const last = line.at(-1)
        if (last && previousFormat === format) last.text += char
        else line.push({ text: char, ...(run.format ? { format: { ...run.format } } : {}) })
        used += width; previousFormat = format
      }
    }
    return lines
  }
}
