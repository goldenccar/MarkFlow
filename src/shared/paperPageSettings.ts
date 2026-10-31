export type PaperSize = 'a4' | 'a5' | 'letter'
export type PageSlot = 'left' | 'center' | 'right'
export interface PaperPageSettings {
  version: 1
  paper: PaperSize
  orientation: 'portrait' | 'landscape'
  margins: { top: number; bottom: number; left: number; right: number }
  columns: 1 | 2
  fontSize: 10 | 11 | 12
  lineSpacing: number
  indentEm: number
  header: Record<PageSlot, string>
  footer: Record<PageSlot, string>
  pageNumber: 'none' | `header-${PageSlot}` | `footer-${PageSlot}`
  hideFirstPage: boolean
  headerRule: boolean
  logo: { path: string; position: PageSlot; widthMm: number } | null
}

const startMarker = '% markflow:page-settings:start'
const endMarker = '% markflow:page-settings:end'
const metadataMarker = '% markflow:page-settings '
const slots: PageSlot[] = ['left', 'center', 'right']
const paperSizes: Record<PaperSize, [number, number]> = { a4: [210, 297], a5: [148, 210], letter: [215.9, 279.4] }
export const paperDimensions = (settings: Pick<PaperPageSettings, 'paper' | 'orientation'>): [number, number] => settings.orientation === 'landscape' ? [...paperSizes[settings.paper]].reverse() as [number, number] : [...paperSizes[settings.paper]]
export function defaultPaperPageSettings(): PaperPageSettings {
  return { version: 1, paper: 'a4', orientation: 'portrait', margins: { top: 25, bottom: 25, left: 25, right: 25 }, columns: 1, fontSize: 11, lineSpacing: 1.25, indentEm: 2, header: { left: '', center: '', right: '' }, footer: { left: '', center: '', right: '' }, pageNumber: 'footer-center', hideFirstPage: false, headerRule: false, logo: null }
}
const fail = (message: string): never => { throw new Error(message) }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const shortText = (value: unknown): value is string => typeof value === 'string' && value.length <= 160 && !/[\x00-\x1f\x7f]/.test(value)

export function validatePaperPageSettings(input: unknown): PaperPageSettings {
  if (!object(input) || input.version !== 1 || !['a4', 'a5', 'letter'].includes(String(input.paper)) || !['portrait', 'landscape'].includes(String(input.orientation))) return fail('请选择支持的纸张和方向。')
  const margins = input.margins, header = input.header, footer = input.footer
  if (!object(margins) || !['top', 'bottom', 'left', 'right'].every(key => finite(margins[key], 8, 60))) return fail('页边距应为 8–60 毫米。')
  if (![1, 2].includes(Number(input.columns)) || ![10, 11, 12].includes(Number(input.fontSize)) || typeof input.columns !== 'number' || typeof input.fontSize !== 'number' || !finite(input.lineSpacing, 1, 2.5) || !finite(input.indentEm, 0, 4)) return fail('请检查栏数、字号、行距和段首缩进。')
  if (!object(header) || !object(footer) || !slots.every(slot => shortText(header[slot]) && shortText(footer[slot]))) return fail('页眉、页脚每项限 160 字符，不支持换行或控制字符。')
  if (!['none', ...['header', 'footer'].flatMap(place => slots.map(slot => `${place}-${slot}`))].includes(String(input.pageNumber)) || typeof input.hideFirstPage !== 'boolean' || typeof input.headerRule !== 'boolean') return fail('页眉页脚设置无效。')
  if (input.logo !== null && (!object(input.logo) || typeof input.logo.path !== 'string' || input.logo.path.length > 800 || /[\\%#{}\x00-\x1f\x7f]/.test(input.logo.path) || input.logo.path.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':')) || !/\.(png|jpe?g)$/i.test(input.logo.path) || !slots.includes(input.logo.position as PageSlot) || !finite(input.logo.widthMm, 8, 50))) return fail('页眉图片须为项目内的 PNG/JPEG，宽度为 8–50 毫米。')
  const settings = input as unknown as PaperPageSettings, [width, height] = paperDimensions(settings)
  if (width - settings.margins.left - settings.margins.right < 60 || height - settings.margins.top - settings.margins.bottom < 80) return fail('页边距过大，正文区域至少需要 60 × 80 毫米。')
  return structuredClone(settings)
}

const escapeText = (value: string) => value.replace(/[\\{}%&#_$~^]/g, character => ({ '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '%': '\\%', '&': '\\&', '#': '\\#', '_': '\\_', '$': '\\$', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' })[character]!)
function fieldText(value: string) {
  return value.split(/(\{(?:page|pages|title|author)\})/g).map(part => ({ '{page}': '\\thepage{}', '{pages}': '\\pageref{LastPage}', '{title}': '\\MFPageTitle{}', '{author}': '{\\def\\and{, }\\MFPageAuthor}' })[part] ?? escapeText(part)).join('')
}
function renderSettings(input: PaperPageSettings): string {
  const settings = validatePaperPageSettings(input), [width] = paperDimensions(settings)
  const { margins, header, footer } = settings, slotWidth = (width - margins.left - margins.right) * 0.3
  const lines = [startMarker, metadataMarker + JSON.stringify(settings), '\\usepackage{geometry,fancyhdr,lastpage,setspace,graphicx}',
    `\\geometry{${settings.paper}paper,${settings.orientation},top=${margins.top}mm,bottom=${margins.bottom}mm,left=${margins.left}mm,right=${margins.right}mm,includeheadfoot,headheight=${settings.logo ? 20 : 14}mm,headsep=5mm,footskip=10mm}`,
    `\\setstretch{${settings.lineSpacing}}`, `\\setlength{\\parindent}{${settings.indentEm}em}`, '\\makeatletter', '\\let\\MFPageTitle\\@title', '\\let\\MFPageAuthor\\@author', '\\makeatother']
  const layout = ['\\fancyhf{}', `\\renewcommand{\\headrulewidth}{${settings.headerRule ? '0.4' : '0'}pt}`, '\\renewcommand{\\footrulewidth}{0pt}']
  const measured: Record<'header' | 'footer', string[]> = { header: [], footer: [] }
  for (const place of ['header', 'footer'] as const) for (const slot of slots) {
    let content = fieldText((place === 'header' ? header : footer)[slot])
    if (settings.pageNumber === `${place}-${slot}`) content += `${content ? '\\quad ' : ''}\\thepage`
    if (place === 'header' && settings.logo?.position === slot) content = `\\includegraphics[width=${Math.min(settings.logo.widthMm, slotWidth).toFixed(2)}mm,height=10mm,keepaspectratio]{\\detokenize{${settings.logo.path}}}${content ? '\\par ' + content : ''}`
    if (content) {
      const box = `\\parbox[b]{0.3\\headwidth}{${slot === 'left' ? '\\raggedright' : slot === 'right' ? '\\raggedleft' : '\\centering'}\\small ${content}}`
      layout.push(`\\fancy${place === 'header' ? 'head' : 'foot'}[${slot[0].toUpperCase()}]{${box}}`)
      // References are loaded only after the preamble; reserve four digits while measuring.
      measured[place].push(box.replaceAll('\\pageref{LastPage}', '9999').replaceAll('\\thepage', '9999'))
    }
  }
  lines.push('\\pagestyle{fancy}', ...layout, `\\fancypagestyle{plain}{${layout.join('\n')}}`)
  // Measure the typeset slots, including wrapped text and images, before geometry allocates the text area.
  lines.push('\\newsavebox{\\MFPageMeasure}', '\\newlength{\\MFPageHeadHeight}', '\\newlength{\\MFPageFootHeight}',
    `\\sbox{\\MFPageMeasure}{${measured.header.join('')}}`,
    '\\setlength{\\MFPageHeadHeight}{\\dimexpr\\ht\\MFPageMeasure+\\dp\\MFPageMeasure+2pt\\relax}',
    `\\sbox{\\MFPageMeasure}{${measured.footer.join('')}}`,
    '\\setlength{\\MFPageFootHeight}{\\dimexpr\\ht\\MFPageMeasure+\\dp\\MFPageMeasure+5mm\\relax}',
    '\\geometry{headheight=\\MFPageHeadHeight,footskip=\\MFPageFootHeight}',
    '\\ifdim\\textheight<80mm\\PackageError{markflow}{Page header or footer leaves too little text space}{Shorten the header/footer or reduce margins.}\\fi')
  if (settings.hideFirstPage) lines.push('\\AtBeginDocument{\\thispagestyle{empty}}', '\\AddToHook{cmd/maketitle/after}{\\thispagestyle{empty}}')
  lines.push(endMarker)
  return lines.join('\n')
}

function commentsRemoved(source: string): string {
  return source.split('\n').map(line => {
    for (let at = 0; at < line.length; at++) if (line[at] === '%') {
      let slashes = 0; for (let before = at - 1; before >= 0 && line[before] === '\\'; before--) slashes++
      if (slashes % 2 === 0) return line.slice(0, at)
    }
    return line
  }).join('\n')
}
interface SourceParts { source: string; preamble: string; body: string; classLine: string; className: string; options: string[]; managed?: { text: string; settings: PaperPageSettings } }
function sourceParts(original: string): SourceParts {
  const source = original.replace(/\r\n?|\n/g, '\n'), starts = [...source.matchAll(/^% markflow:page-settings:start\r?$/gm)], ends = [...source.matchAll(/^% markflow:page-settings:end\r?$/gm)]
  let clean = source, managed: SourceParts['managed']
  if (starts.length || ends.length) {
    if (starts.length !== 1 || ends.length !== 1 || ends[0].index! < starts[0].index!) fail('页面配置区域不完整或重复，请先在源码中修复；未改写文档。')
    const from = starts[0].index!, to = ends[0].index! + endMarker.length, text = source.slice(from, to), metadata = text.split('\n')[1]
    if (!metadata?.startsWith(metadataMarker)) fail('页面配置记录缺失，请先在源码中修复。')
    let settings: PaperPageSettings
    try { settings = validatePaperPageSettings(JSON.parse(metadata.slice(metadataMarker.length))) } catch { return fail('页面配置记录无法读取，源码保持不变。') }
    if (text !== renderSettings(settings)) fail('页面配置区域已被手动修改，请保留源码修改，或恢复原配置区域后再使用表单。')
    managed = { text, settings }; clean = source.slice(0, from) + source.slice(to).replace(/^\n/, '')
  }
  const begin = /^[ \t]*\\begin\{document\}[ \t]*(?:%[^\n]*)?$/m.exec(clean)
  if (!begin) return fail('当前是公式片段或不支持的工程结构，请先新建完整 LaTeX 文档。')
  const preamble = clean.slice(0, begin.index), body = clean.slice(begin.index)
  if (managed && source.indexOf(managed.text) > source.indexOf('\\begin{document}')) fail('页面配置区域必须位于正文之前。')
  const active = commentsRemoved(preamble), classes = [...active.matchAll(/^[ \t]*\\documentclass(?:\[([^\]\n]*)\])?\{([a-zA-Z]+)\}[ \t]*$/gm)]
  if (classes.length !== 1 || !['article', 'report', 'book', 'ctexart', 'ctexrep', 'ctexbook'].includes(classes[0][2])) fail('此文档类含自定义页面规则，暂不自动覆盖；请在源码中设置页面。')
  const match = classes[0], classLine = preamble.split('\n').find(line => commentsRemoved(line).trim() === match[0].trim())!
  const options = (match[1] ?? '').split(',').map(option => option.trim()).filter(Boolean)
  const unknown = options.filter(option => !/^(?:UTF8|fontset=fandol|scheme=plain|a[45]paper|letterpaper|landscape|portrait|10pt|11pt|12pt|onecolumn|twocolumn|oneside|twoside)$/.test(option))
  if (unknown.length) fail(`文档类包含自定义选项 ${unknown.join('、')}，暂不自动修改。`)
  const untouched = commentsRemoved(clean).replace(/^[ \t]*\\usepackage\[margin=25mm\]\{geometry\}[ \t]*$/m, '')
  const packages = /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\]\s*)?\{[^}]*\b(?:geometry|fancyhdr|lastpage|setspace|fullpage|typearea|vmargin|titleps|scrlayer-scrpage)\b/
  const commands = /\\(?:geometry|newgeometry|restoregeometry|pagestyle|thispagestyle|fancyhead|fancyfoot|fancyhf|fancypagestyle|lhead|chead|rhead|lfoot|cfoot|rfoot|setstretch|linespread|onehalfspacing|doublespacing|singlespacing|baselinestretch|headrulewidth|footrulewidth|MFPage\w+)\b/
  const lengths = /\\(?:setlength|addtolength)\s*\{\\(?:parindent|headheight|headsep|footskip|textwidth|textheight|topmargin|oddsidemargin|evensidemargin)\}/
  const assignments = /\\(?:parindent|headheight|headsep|footskip|textwidth|textheight|topmargin|oddsidemargin|evensidemargin)\s*(?:=|[-+.\d])/
  if (/\\(?:input|include)\s*\{/.test(active)) fail('导言区引入了外部文件，可能包含自定义版式，暂不自动修改。请在源码中设置页面。')
  if (packages.test(untouched) || commands.test(untouched) || lengths.test(untouched) || assignments.test(untouched)) fail('源码已有自定义页边距、行距或页眉页脚设置。为避免覆盖，请继续使用源码，或先移除冲突配置。')
  return { source, preamble, body, classLine, className: match[2], options, managed }
}

export function readPaperPageSettings(source: string): { settings: PaperPageSettings; managed: boolean; error?: string } {
  try {
    const parts = sourceParts(source)
    if (parts.managed) return { settings: parts.managed.settings, managed: true }
    const settings = defaultPaperPageSettings()
    settings.fontSize = Number(parts.options.find(option => /^(10|11|12)pt$/.test(option))?.slice(0, -2) ?? 10) as 10 | 11 | 12
    settings.columns = parts.options.includes('twocolumn') ? 2 : 1
    settings.paper = parts.options.includes('a5paper') ? 'a5' : parts.options.includes('letterpaper') ? 'letter' : 'a4'
    settings.orientation = parts.options.includes('landscape') ? 'landscape' : 'portrait'
    return { settings, managed: false }
  } catch (error) { return { settings: defaultPaperPageSettings(), managed: false, error: error instanceof Error ? error.message : String(error) } }
}

/** Only controlled class options and our own preamble block change; content and custom macros remain intact. */
export function applyPaperPageSettings(source: string, input: unknown): string {
  const settings = validatePaperPageSettings(input), parts = sourceParts(source)
  const options = parts.options.filter(option => !/^(?:a[45]paper|letterpaper|landscape|portrait|10pt|11pt|12pt|onecolumn|twocolumn)$/.test(option))
  options.push(`${settings.paper}paper`, `${settings.fontSize}pt`, ...(settings.columns === 2 ? ['twocolumn'] : []))
  const classLine = parts.classLine.replace(/\\documentclass(?:\[[^\]]*\])?\{[^}]*\}/, `\\documentclass[${options.join(',')}]{${parts.className}}`)
  const preamble = parts.preamble.replace(parts.classLine, classLine).replace(/^[ \t]*\\usepackage\[margin=25mm\]\{geometry\}[ \t]*(?:%[^\n]*)?(?:\n|$)/m, '')
  const output = `${preamble.replace(/\n*$/, '\n')}${renderSettings(settings)}\n${parts.body}`
  const eol = source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n'
  return output.replaceAll('\n', eol)
}
