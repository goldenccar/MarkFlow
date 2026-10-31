import assert from 'node:assert/strict'
import test from 'node:test'
import { paperTemplate } from '../src/main/paperTemplates'
import { applyPaperPageSettings, defaultPaperPageSettings, paperDimensions, readPaperPageSettings, validatePaperPageSettings } from '../src/shared/paperPageSettings'

const template = (kind: 'article' | 'chinese' | 'twocolumn' = 'article') => paperTemplate({ name: 'page-settings', template: kind, title: 'Title', author: 'Author' }).files['main.tex']
const body = (source: string) => source.slice(source.indexOf('\\begin{document}'))

test('all built-in templates round-trip settings without changing the body, and repeated application is idempotent', () => {
  for (const kind of ['article', 'chinese', 'twocolumn'] as const) {
    const original = template(kind), settings = defaultPaperPageSettings()
    settings.paper = 'a5'; settings.orientation = 'landscape'; settings.columns = 2; settings.fontSize = 12
    settings.header.left = 'Report {title}'; settings.footer.right = 'Page {page} / {pages}'; settings.pageNumber = 'none'; settings.hideFirstPage = true
    const updated = applyPaperPageSettings(original, settings)
    assert.equal(body(updated), body(original))
    assert.equal(applyPaperPageSettings(updated, settings), updated)
    assert.deepEqual(readPaperPageSettings(updated), { settings, managed: true })
    assert.equal((updated.match(/\\usepackage.*geometry/g) ?? []).length, 1)
    assert.match(updated, /a5paper,landscape/)
    assert.match(updated, /\\AddToHook\{cmd\/maketitle\/after\}/)
  }
})

test('form initialization reflects class paper size, columns, and font size', () => {
  const initial = readPaperPageSettings(template('twocolumn'))
  assert.equal(initial.managed, false); assert.equal(initial.error, undefined)
  assert.equal(initial.settings.columns, 2); assert.equal(initial.settings.fontSize, 11)
  assert.deepEqual(paperDimensions({ paper: 'letter', orientation: 'landscape' }), [279.4, 215.9])
})

test('ordinary header text is escaped while only supported placeholders become commands', () => {
  const settings = defaultPaperPageSettings()
  settings.header.left = 'A&B_50% \\input{evil} $x^2$ ~ # {unknown} {title} {author}'
  settings.footer.center = '{page} / {pages}'; settings.pageNumber = 'none'
  const source = applyPaperPageSettings(template(), settings)
  const executable = source.split('\n').filter(line => !line.startsWith('%')).join('\n')
  assert.ok(executable.includes('A\\&B\\_50\\% \\textbackslash{}input\\{evil\\} \\$x\\textasciicircum{}2\\$ \\textasciitilde{} \\# \\{unknown\\} \\MFPageTitle{} {\\def\\and{, }\\MFPageAuthor}'))
  assert.ok(executable.includes('\\thepage{} / \\pageref{LastPage}'))
  assert.ok(!executable.includes('\\input{evil}'))
})

test('placeholder commands terminate before adjacent letters and preserve following whitespace', () => {
  const settings = defaultPaperPageSettings()
  settings.header.left = '{title}Suffix {page}Next 中文{page}页 {page} / {pages}'
  const updated = applyPaperPageSettings(template(), settings)
  assert.ok(updated.includes('\\MFPageTitle{}Suffix \\thepage{}Next 中文\\thepage{}页 \\thepage{} / \\pageref{LastPage}'))
})

test('validation rejects impossible margins, non-numeric options, and injected image paths', () => {
  const settings = defaultPaperPageSettings()
  for (const margins of [{ ...settings.margins, top: NaN }, { ...settings.margins, left: 7 }, { ...settings.margins, top: 61 }]) assert.throws(() => validatePaperPageSettings({ ...settings, margins }), /页边距/)
  assert.throws(() => validatePaperPageSettings({ ...settings, paper: 'a5', margins: { top: 25, bottom: 25, left: 60, right: 60 } }), /正文区域/)
  assert.throws(() => validatePaperPageSettings({ ...settings, columns: '2' }), /栏数/)
  assert.throws(() => validatePaperPageSettings({ ...settings, header: { ...settings.header, left: 'line\nbreak' } }), /控制字符/)
  for (const path of ['../logo.png', '/logo.png', 'C:/logo.png', 'assets/x%evil.png', 'assets/{x}.png', 'assets/x\\evil.png', 'assets/a.svg']) assert.throws(() => validatePaperPageSettings({ ...settings, logo: { path, position: 'left', widthMm: 20 } }), /页眉图片/)
})

test('logo dimensions are capped to their column; header/footer heights are measured before the body', () => {
  const settings = defaultPaperPageSettings()
  settings.paper = 'a5'; settings.logo = { path: 'assets/logo with spaces.png', position: 'right', widthMm: 50 }
  const updated = applyPaperPageSettings(template(), settings)
  assert.match(updated, /width=29\.40mm,height=10mm,keepaspectratio/)
  assert.ok(updated.includes('\\detokenize{assets/logo with spaces.png}'))
  assert.ok(updated.includes('\\newsavebox{\\MFPageMeasure}'))
  assert.ok(updated.includes('\\geometry{headheight=\\MFPageHeadHeight,footskip=\\MFPageFootHeight}'))
  assert.ok(updated.indexOf('\\ifdim\\textheight<80mm') < updated.indexOf('\\begin{document}'))
})

test('custom layout declarations are refused rather than silently overridden', () => {
  const original = template(), settings = defaultPaperPageSettings()
  for (const conflict of ['\\usepackage[margin=1in]{geometry}', '\\usepackage [margin=1in] {geometry}', '\\usepackage{fancyhdr}', '\\usepackage{fullpage}', '\\geometry{left=10mm}', '\\setlength{\\parindent}{0pt}', '\\parindent 0pt', '\\pagestyle{empty}', '\\linespread{1.5}', '\\input{custom-layout}']) {
    const source = original.replace('\\usepackage[margin=25mm]{geometry}', conflict)
    assert.throws(() => applyPaperPageSettings(source, settings), /自定义/)
    assert.match(readPaperPageSettings(source).error ?? '', /自定义/)
  }
  assert.throws(() => applyPaperPageSettings(original.replace('a4paper,11pt', 'a4paper,11pt,draft'), settings), /自定义选项/)
  assert.throws(() => applyPaperPageSettings(original.replace('\\maketitle', '\\maketitle\n\\pagestyle{empty}'), settings), /自定义/)
})

test('comments, unrelated custom macros, and line endings survive repeated changes', () => {
  const original = template().replace('{article}', '{article} % Keep this class comment').replace('\\title{Title}', '% \\geometry{left=2mm} is only an example\n\\newcommand{\\hello}{Hello}\n\\title{Title}').replaceAll('\n', '\r\n')
  const settings = defaultPaperPageSettings(), updated = applyPaperPageSettings(original, settings)
  assert.ok(updated.includes(' % Keep this class comment\r\n'))
  assert.ok(updated.includes('% \\geometry{left=2mm} is only an example\r\n\\newcommand{\\hello}{Hello}'))
  assert.equal(body(updated), body(original))
  assert.equal(updated.replaceAll('\r\n', '').includes('\n'), false)
  assert.equal(applyPaperPageSettings(updated, settings), updated)
})

test('duplicate, corrupt, or hand-edited configuration blocks cannot be overwritten', () => {
  const settings = defaultPaperPageSettings(), updated = applyPaperPageSettings(template(), settings)
  for (const source of [updated + '\n% markflow:page-settings:start\n', updated.replace('% markflow:page-settings:end', ''), updated.replace('\\setstretch{1.25}', '\\setstretch{2}'), updated.replace('"version":1', '"version":99')]) {
    assert.throws(() => applyPaperPageSettings(source, settings), /页面配置/)
  }
  assert.match(readPaperPageSettings('x^2 + y^2').error ?? '', /公式片段/)
})
