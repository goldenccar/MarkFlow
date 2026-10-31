import { applyMarkCommands, type MarkTypography } from '../engine/index.js'
import { normalizeDocument } from './model.js'
import { CompilationError, failCompilation } from './diagnostics.js'
import type { Diagnostic, MarkDocumentInput, SemanticContent, TextRun } from './types.js'
import type { PaperContent, PaperDocumentInput, PaperPresentation, PaperReference, PaperRun, PaperSource, PaperSourceMap } from './latexTypes.js'

export * from './latexTypes.js'
export { markdownToPaperDocument } from './latexMarkdown.js'

function fail(message: string, markId?: string): never { return failCompilation('PAPER_INVALID_INPUT', message, markId ? { markId } : {}) }
function record(value: unknown, allowed: string[], required = allowed): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected a paper configuration object.')
  const data = value as Record<string, unknown>
  if (Object.keys(data).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(data, key))) fail('Unknown or missing paper configuration field.')
  return data
}
function text(value: unknown, nonempty = false): string {
  if (typeof value !== 'string' || (nonempty && !value.trim()) || /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value)) fail('Expected valid Unicode text.')
  return value as string
}
function list(value: unknown): unknown[] { if (!Array.isArray(value)) fail('Expected an array.'); return value as unknown[] }
function id(value: unknown): string { const result = text(value, true); if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(result)) fail('Expected a portable Mark or bibliography ID.'); return result }
function json<T>(value: T): T {
  try { return applyMarkCommands<T>({ revision: 0, roots: [], retiredIds: [] }, [{ type: 'insert', parentId: null, index: 0, marks: [{ id: 'paper-input', content: value }] }]).roots[0].content }
  catch (error) { return fail(error instanceof Error ? error.message : String(error)) }
}
export function escapeLatexText(value: string): string {
  return value.replace(/[\\{}%&#_$~^]/g, char => ({ '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '%': '\\%', '&': '\\&', '#': '\\#', '_': '\\_', '$': '\\$', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' })[char]!)
}

// Generated math has a deliberately finite language; arbitrary TeX belongs in the trusted source workspace.
const mathCommands = new Set(('frac dfrac tfrac sqrt binom dbinom tbinom overset underset overline underline widehat widetilde hat tilde bar vec dot ddot acute grave breve check mathrm mathbf mathit mathsf mathtt mathcal mathbb mathnormal boldsymbol text textrm textbf textit textsf texttt operatorname left right middle big Big bigg Bigg bigl bigr Bigl Bigr biggl biggr Biggl Biggr limits nolimits displaystyle textstyle scriptstyle scriptscriptstyle begin end tag nonumber notag quad qquad thinspace medspace thickspace negthinspace phantom hphantom vphantom boxed substack color ' +
  'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi omicron pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega ' +
  'sum prod coprod int iint iiint oint bigcup bigcap bigvee bigwedge bigoplus bigotimes lim limsup liminf max min sup inf arg det dim gcd ker log ln lg exp sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh coth ' +
  'infty partial nabla ell hbar imath jmath Re Im emptyset varnothing aleph forall exists nexists neg land lor lnot wedge vee cap cup setminus in notin ni subset supset subseteq supseteq nsubseteq nsupseteq subsetneq supsetneq ' +
  'times div cdot ast star circ bullet pm mp oplus ominus otimes oslash odot le leq ge geq neq ne equiv approx sim simeq cong propto ll gg prec succ preceq succeq asymp parallel perp mid nmid ' +
  'to mapsto gets leftarrow rightarrow leftrightarrow Leftarrow Rightarrow Leftrightarrow longrightarrow longleftarrow longleftrightarrow Longrightarrow Longleftarrow Longleftrightarrow uparrow downarrow updownarrow implies iff ' +
  'langle rangle lceil rceil lfloor rfloor lbrace rbrace vert Vert lvert rvert lVert rVert ldots cdots vdots ddots dots colon mod bmod pmod').split(/\s+/))
const mathEnvironments = new Set(['aligned', 'alignedat', 'gathered', 'split', 'matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix', 'cases', 'array'])
function math(value: unknown, markId: string): string {
  const source = text(value, true)
  if (source.length > 100_000 || /[%#$]|\^\^/.test(source)) fail('Math contains unsupported TeX syntax; the original source is retained.', markId)
  let depth = 0
  const environments: string[] = []
  for (let at = 0; at < source.length; at++) {
    const char = source[at]
    if (char === '\\') {
      const command = /^[A-Za-z]+|[^\r\n]/.exec(source.slice(at + 1))?.[0]
      if (!command || (/[A-Za-z]/.test(command[0]) ? !mathCommands.has(command) : !' ,;:!{}|_\\'.includes(command))) fail(`Unsupported math command: \\${command ?? ''}`, markId)
      at += command.length
      if (command === 'begin' || command === 'end') {
        const environment = /^\{([A-Za-z]+)\}/.exec(source.slice(at + 1))
        if (!environment || !mathEnvironments.has(environment[1])) fail('Unsupported math environment.', markId)
        if (command === 'begin') environments.push(environment[1])
        else if (environments.pop() !== environment[1]) fail('Math environments are not balanced.', markId)
        at += environment[0].length
      }
    } else if (char === '{') depth++
    else if (char === '}' && --depth < 0) fail('Math braces are not balanced.', markId)
  }
  if (depth || environments.length) fail('Math braces or environments are not balanced.', markId)
  return source
}

function presentation(input: unknown): PaperPresentation {
  const data = record(json(input), ['format', 'version', 'template', 'title', 'authors', 'abstract', 'references'], ['format', 'version', 'template', 'title', 'authors'])
  if (data.format !== 'markflow-paper-presentation' || data.version !== 1 || !['chinese', 'article', 'twocolumn'].includes(String(data.template))) fail('Unsupported paper presentation version or template.')
  const ids = new Set<string>()
  const references = data.references === undefined ? [] : list(data.references).map(value => {
    const item = record(value, ['id', 'type', 'title', 'author', 'year', 'publisher', 'journal', 'url'], ['id', 'type', 'title', 'author', 'year'])
    const key = id(item.id)
    if (ids.has(key)) fail(`Duplicate bibliography ID: ${key}`)
    ids.add(key)
    if (!['book', 'article', 'misc'].includes(String(item.type))) fail('Unsupported bibliography entry type.')
    const result: PaperReference = { id: key, type: item.type as PaperReference['type'], title: text(item.title, true), author: text(item.author, true), year: text(item.year, true) }
    for (const field of ['publisher', 'journal', 'url'] as const) if (item[field] !== undefined) result[field] = text(item[field], true)
    if (result.url) { try { const url = new URL(result.url); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || /[\x00-\x20\\]/.test(result.url)) throw new Error() } catch { fail('Bibliography links must be HTTP or HTTPS without credentials.') } }
    return result
  })
  return { format: 'markflow-paper-presentation', version: 1, template: data.template as PaperPresentation['template'], title: text(data.title, true), authors: list(data.authors).map(value => text(value, true)), ...(data.abstract !== undefined ? { abstract: text(data.abstract) } : {}), references }
}

/** Pure, deterministic source generation. It neither reads assets nor writes the original document. */
export function generatePaperSource(input: unknown, configuration: unknown): PaperSource {
  const owned = json(input), options = presentation(configuration)
  const envelope = owned && typeof owned === 'object' && (owned as { format?: string }).format === 'markflow-paper' ? record(owned, ['format', 'version', 'document', 'extensions']) : null
  if (envelope && envelope.version !== 1) fail('Unsupported paper document version.')
  const document = normalizeDocument(envelope ? envelope.document : owned)
  const sourceDocument = (envelope ? envelope.document : owned) as MarkDocumentInput
  const content = new Map<string, PaperContent>(document.snapshot.roots.map(mark => [mark.id, mark.content]))
  const extensionIds = new Set<string>()
  for (const value of envelope ? list(envelope.extensions) : []) {
    const extension = record(value, ['markId', 'content']), markId = id(extension.markId)
    if (!content.has(markId) || extensionIds.has(markId)) fail('Paper extension must refer to one unique live Mark.', markId)
    extensionIds.add(markId)
    const data = record(extension.content, ['kind', 'runs', 'level', 'ordered', 'ordinal', 'header', 'rows', 'tex'], ['kind'])
    const normalizeRuns = (value: unknown): TextRun[] => list(value).map(run => {
      if (run && typeof run === 'object' && Object.hasOwn(run, 'kind')) {
        const special = run as Record<string, unknown>
        if (special.kind === 'math') { record(run, ['kind', 'tex']); math(special.tex, markId) }
        else if (special.kind === 'citation') { record(run, ['kind', 'keys']); if (!list(special.keys).length) fail('A citation requires at least one bibliography ID.', markId); list(special.keys).forEach(id) }
        else if (special.kind === 'cross-reference') { record(run, ['kind', 'targetId']); id(special.targetId) }
        else fail('Unsupported paper inline content.', markId)
        return { text: 'paper-inline' }
      }
      return run as TextRun
    })
    let shadow: SemanticContent
    if (data.kind === 'equation') { record(data, ['kind', 'tex']); math(data.tex, markId); shadow = { kind: 'paragraph', runs: [] } }
    else if (data.kind === 'heading' || data.kind === 'paragraph' || data.kind === 'list-item') shadow = { ...data, runs: normalizeRuns(data.runs) } as SemanticContent
    else if (data.kind === 'table') shadow = { ...data, rows: list(data.rows).map(row => list(row).map(normalizeRuns)) } as SemanticContent
    else fail('Paper extensions support equations and typed inline content only.', markId)
    // Reuse the Office schema for all shared shape, text-format, table and style validation.
    normalizeDocument({ format: 'markflow', version: 1, documentId: 'paper-validation', revision: 0, marks: [{ id: markId, content: shadow }], assets: [] })
    content.set(markId, extension.content as PaperContent)
  }
  const diagnostics: Diagnostic[] = []
  const assets = document.assets.map(asset => {
    const extension = /\.(png|jpe?g)$/i.exec(asset.path)?.[1].toLowerCase()
    if (!extension) fail(`Paper images require PNG or JPEG: ${asset.path}`)
    return { ...asset, targetPath: `assets/${asset.id}.${extension}` }
  })
  const assetPaths = new Map(assets.map(asset => [asset.id, asset.targetPath]))
  const refs = new Set(options.references!.map(item => item.id)), cited = new Set<string>()
  const marks = new Map(document.snapshot.roots.map(mark => [mark.id, mark]))
  const resolved = new Map<string, { content: PaperContent; style: MarkTypography }>(), warnedFonts = new Set<string>()
  const resolve = (markId: string): { content: PaperContent; style: MarkTypography } => {
    const chain: string[] = []; let current = markId
    while (!resolved.has(current)) {
      const value = content.get(current)!
      if (value.kind !== 'reference') { resolved.set(current, { content: value, style: marks.get(current)!.style }); break }
      chain.push(current); current = value.targetId
    }
    for (const alias of chain.reverse()) { const target = resolved.get(current)!; resolved.set(alias, { content: target.content, style: { ...target.style, ...marks.get(alias)!.style } }); current = alias }
    return resolved.get(markId)!
  }
  const renderRuns = (runs: PaperRun[], markId: string): string => runs.map(run => {
    if ('kind' in run) {
      if (run.kind === 'math') return `\\(${math(run.tex, markId)}\\)`
      if (run.kind === 'citation') { for (const key of run.keys) { if (!refs.has(key)) fail(`Unknown bibliography ID: ${key}`, markId); cited.add(key) } return `\\cite{${run.keys.join(',')}}` }
      if (!content.has(run.targetId) || !['heading', 'equation', 'image', 'table'].includes(resolve(run.targetId).content.kind)) fail(`Cross-reference must target a numbered heading, equation, image or table: ${run.targetId}`, markId)
      return `\\ref{mark:${run.targetId}}`
    }
    const format = run.format ?? {}
    let value = escapeLatexText(run.text).replace(/\r\n|\r|\n/g, '\\newline{}\n')
    if (format.bold) value = `\\textbf{${value}}`
    if (format.italic) value = `\\textit{${value}}`
    if (format.underline) value = `\\uline{${value}}`
    if (format.strike) value = `\\sout{${value}}`
    if (format.script) value = `\\text${format.script}{${value}}`
    if (format.highlight) value = `\\colorbox[HTML]{${format.highlight.slice(1).toUpperCase()}}{${value}}`
    if (format.link) value = `\\href{${escapeLatexText(format.link)}}{${value}}`
    return value
  }).join('')
  const chinese = options.template === 'chinese', columns = options.template === 'twocolumn'
  const lines = [chinese ? '\\documentclass[UTF8,fontset=fandol,a4paper,11pt]{ctexart}' : `\\documentclass[a4paper,11pt${columns ? ',twocolumn' : ''}]{article}`, '\\usepackage[margin=25mm]{geometry}', '\\usepackage{amsmath,amssymb,graphicx,booktabs,longtable,tabularx,xcolor}', '\\usepackage[normalem]{ulem}', '\\usepackage[hidelinks]{hyperref}', '\\setcounter{secnumdepth}{5}', '\\setlength{\\emergencystretch}{2em}', `\\title{${escapeLatexText(options.title)}}`, `\\author{${options.authors.map(escapeLatexText).join(' \\and ')}}`, '\\date{}', '\\begin{document}', '\\maketitle']
  if (!chinese) lines.splice(1, 0, '\\usepackage[UTF8,fontset=fandol,scheme=plain]{ctex}')
  if (options.abstract) lines.push('\\begin{abstract}', escapeLatexText(options.abstract), '\\end{abstract}')
  const sourceMap: PaperSourceMap = { format: 'markflow-latex-map', version: 1, documentId: document.documentId, revision: document.snapshot.revision, marks: [] }
  for (const mark of document.snapshot.roots) {
    const fromLine = lines.length + 1, { content: value, style } = resolve(mark.id), label = `\\label{mark:${mark.id}}`
    lines.push(`% Mark ${mark.id}`)
    let rendered: string
    if (value.kind === 'equation') rendered = `\\begin{equation}${label}\n${math(value.tex, mark.id)}\n\\end{equation}`
    else if (value.kind === 'heading') rendered = `\\${['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph', 'subparagraph'][value.level - 1]}{${renderRuns(value.runs, mark.id)}}${label}`
    else if (value.kind === 'paragraph') rendered = `\\phantomsection${label}\n${renderRuns(value.runs, mark.id)}\\par`
    else if (value.kind === 'list-item') rendered = `\\begin{${value.ordered ? 'enumerate' : 'itemize'}}\n${value.ordered ? `\\setcounter{enumi}{${(value.ordinal ?? 1) - 1}}\n` : ''}\\item ${renderRuns(value.runs, mark.id)}${label}\n\\end{${value.ordered ? 'enumerate' : 'itemize'}}`
    else if (value.kind === 'image') rendered = `\\begin{figure}[htbp]\n\\centering\n\\includegraphics[width=0.88\\linewidth,height=0.55\\textheight,keepaspectratio]{${assetPaths.get(value.assetId)}}\n\\caption{${escapeLatexText(value.caption ?? value.alt)}}${label}\n\\end{figure}`
    else if (value.kind === 'table') {
      const width = value.rows[0].length, table = columns ? 'tabularx' : 'longtable'
      const spec = columns ? `\\linewidth}{${'X'.repeat(width)}` : `${Array.from({ length: width }, () => `p{\\dimexpr\\linewidth/${width}-2\\tabcolsep\\relax}`).join('')}`
      const rows = value.rows.map(row => row.map(cell => renderRuns(cell, mark.id)).join(' & ') + ' \\\\')
      const start = columns ? `\\begin{table}[htbp]\n\\caption{}${label}\n\\begin{${table}}{${spec}}` : `\\begin{${table}}{${spec}}\n\\caption{}${label}\\\\`
      rendered = `${start}\n\\toprule\n${value.header ? `${rows[0]}\n\\midrule\n${columns ? '' : '\\endfirsthead\n\\toprule\n' + rows[0] + '\n\\midrule\n\\endhead\n'}` : ''}${rows.slice(value.header ? 1 : 0).join('\n')}\n\\bottomrule\n\\end{${table}}${columns ? '\n\\end{table}' : ''}`
      if (columns) diagnostics.push({ code: 'PAPER_TWOCOLUMN_TABLE', severity: 'warning', message: '双栏模板的表格保持在单栏中；过长表格请改用单栏模板。', markId: mark.id })
    } else throw new Error('Unresolved paper content reference.')
    if (style.fontFamily && !warnedFonts.has(style.fontFamily)) { warnedFonts.add(style.fontFamily); diagnostics.push({ code: 'PAPER_TEMPLATE_FONT', severity: 'warning', message: `论文采用模板字体；Mark 的字体 ${style.fontFamily} 未嵌入。`, markId: mark.id }) }
    if (style.fontSize) { const pt = style.fontSize * 0.75; rendered = `{\\fontsize{${pt}}{${pt * 1.4}}\\selectfont\n${rendered}\n}` }
    lines.push(...rendered.split('\n'), '')
    sourceMap.marks.push({ markId: mark.id, file: 'main.tex', fromLine, toLine: lines.length - 1, ...(document.sources[mark.id] ? { source: document.sources[mark.id] } : {}) })
  }
  if (cited.size) lines.push('\\bibliographystyle{plain}', '\\bibliography{references}')
  lines.push('\\end{document}', '')
  const bibliography = options.references!.map(item => `@${item.type}{${item.id},\n${(['author', 'title', 'year', 'publisher', 'journal', 'url'] as const).flatMap(field => item[field] ? [`  ${field} = {${escapeLatexText(item[field]!)}}`] : []).join(',\n')}\n}`).join('\n\n') + '\n'
  return { engine: 'xelatex', mainFile: 'main.tex', assets, sourceMap, diagnostics, files: {
    'main.tex': lines.join('\n'), 'references.bib': bibliography,
    'markflow-source-map.json': JSON.stringify(sourceMap, null, 2) + '\n',
    'markflow-source.json': JSON.stringify(envelope ? owned : sourceDocument, null, 2) + '\n',
    'markflow-presentation.json': JSON.stringify(options, null, 2) + '\n',
  } }
}
