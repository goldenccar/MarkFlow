import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const root = process.cwd()
const { values } = parseArgs({ options: { app: { type: 'string' }, 'evidence-dir': { type: 'string' } } })
const evidence = path.resolve(values['evidence-dir'] ?? '.test-data')
await mkdir(evidence, { recursive: true })
const temporary = await mkdtemp(path.join(evidence, 'fomula-'))
const projects = path.join(temporary, 'projects'), fixtures = path.join(temporary, 'fixtures'), fragments = path.join(temporary, 'fragments')
await mkdir(projects); await mkdir(fixtures); await mkdir(fragments)
// A standalone formula is outside the multi-file TeX project's root.
const complete = path.join(fixtures, 'complete.tex'), fragment = path.join(fragments, 'fragment.tex')
await writeFile(complete, '\\documentclass{article}\n\\begin{document}\nOpened complete document.\n\\end{document}\n')
await writeFile(fragment, '\\sqrt{x^2+1}')
const env = { ...process.env, MARKFLOW_USER_DATA: path.join(temporary, 'profile') }
delete env.ELECTRON_RUN_AS_NODE
const checks = [], errors = []
let app, page, application
const pass = name => { checks.push(name); console.log(`PASS ${name}`) }
const pane = () => page.getByRole('region', { name: 'Fomula 文档工作区', exact: true })
const header = () => page.locator('.workspace-header')
const source = () => page.locator('.cm-content:visible')
const sourceText = () => source().evaluate(element => element.cmTile.root.view.state.doc.toString())
async function replace(text) {
  await source().click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText(text)
  await expect.poll(sourceText).toBe(text)
}
async function openFomula() {
  await page.getByRole('button', { name: '新建标签', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: /^Fomula/ })).toHaveCount(1)
  await expect(page.getByRole('menuitem', { name: /^LaTeX 论文/ })).toHaveCount(0)
  await page.getByRole('menuitem', { name: /^Fomula/ }).click()
  await expect(pane()).toBeVisible()
}
async function compile() {
  await pane().getByRole('button', { name: '编译', exact: true }).click()
  await expect(pane().getByRole('button', { name: '取消编译', exact: true })).toBeVisible()
  await expect(pane().getByRole('button', { name: '编译', exact: true })).toBeVisible({ timeout: 120000 })
  await expect(pane().locator('.paper-notice').filter({ hasText: '编译完成' }).first()).toBeVisible()
  await expect(pane().locator('.paper-pdf-page canvas').first()).toBeVisible({ timeout: 30000 })
}
async function chooseFile(file) {
  await app.evaluate((_electron, value) => { globalThis.__fomulaInput = value }, file)
  await header().getByRole('button', { name: '打开文件', exact: true }).click()
}
async function nativeMenu(menu, label) {
  await app.evaluate(({ Menu, BrowserWindow }, { menu, label }) => {
    const item = Menu.getApplicationMenu().items.find(item => item.label === menu).submenu.items.find(item => item.label === label)
    item.click(item, BrowserWindow.getAllWindows()[0], {})
  }, { menu, label })
}
async function narrow(screenshot) {
  await page.setViewportSize({ width: 920, height: 740 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: path.join(temporary, screenshot) })
  await page.setViewportSize({ width: 1440, height: 1000 })
}
try {
  app = await electron.launch({ ...(values.app ? { executablePath: path.resolve(values.app), args: [] } : { args: [root] }), env })
  application = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), platform: process.platform, resources: process.resourcesPath }))
  page = await app.firstWindow(); page.setDefaultTimeout(20000)
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(page.locator('.document-name')).toHaveText('未命名.md')
  await app.evaluate(({ dialog }, destination) => {
    dialog.showOpenDialog = async (...args) => ({ canceled: false, filePaths: [args.at(-1).properties?.includes('openDirectory') ? destination : globalThis.__fomulaInput] })
    dialog.showSaveDialog = async () => ({ canceled: !globalThis.__fomulaOutput, filePath: globalThis.__fomulaOutput })
  }, projects)

  const rich = page.getByRole('textbox', { name: '文档内容', exact: true })
  await rich.click(); await page.keyboard.insertText('/h1')
  await expect(page.getByRole('option').filter({ hasText: '一级标题' }).first()).toBeVisible()
  await page.keyboard.press('Tab'); await page.keyboard.insertText('Heading by slash')
  await expect(rich.locator('h1')).toHaveText('Heading by slash')
  await page.keyboard.press('Enter'); await page.keyboard.insertText('Indented paragraph'); await page.keyboard.press('Tab')
  await expect.poll(() => rich.locator('p').last().textContent()).toBe('\u2002\u2002\u2002Indented paragraph')
  await page.keyboard.press('Shift+Tab')
  await expect(rich.locator('p').last()).toHaveText('Indented paragraph')
  pass('Markdown rendered editing supports slash suggestions and reversible paragraph indentation')

  await openFomula()
  await expect(pane().getByRole('heading', { name: '新建 LaTeX 文档', exact: true })).toBeVisible()
  await pane().getByRole('button', { name: '公式片段', exact: true }).click()
  await expect(source()).toBeVisible()
  await expect(page.getByRole('button', { name: '公式片段', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await replace('\\fr')
  await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible()
  await expect(page.locator('.cm-tooltip-autocomplete').getByRole('option').first()).toContainText('分数')
  await page.keyboard.press('Tab'); await expect.poll(sourceText).toBe('\\frac{}{}')
  await page.keyboard.press('ControlOrMeta+Z'); await expect.poll(sourceText).toBe('\\fr')
  await replace('/sq')
  await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible()
  await page.keyboard.press('Tab'); await expect.poll(sourceText).toBe('\\sqrt{}')
  await replace('plain'); await page.keyboard.press('Tab'); await expect.poll(sourceText).toBe('  plain')
  await page.keyboard.press('Shift+Tab'); await expect.poll(sourceText).toBe('plain')
  await replace('\\')
  await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible()
  await page.keyboard.press('Escape'); await replace('')
  pass('one Fomula entry contains formula fragments, both slash triggers, prefix hints, Tab acceptance, undo and plain indentation')

  const preservedFragment = 'x^2 + PRESERVED'
  await replace(preservedFragment)
  await expect(page.getByRole('tab', { name: preservedFragment, exact: true })).toBeVisible()
  const tabCount = await page.getByRole('tab').count()
  await openFomula()
  await pane().getByRole('button', { name: '公式片段', exact: true }).click()
  await expect(page.getByRole('tab')).toHaveCount(tabCount + 1)
  await expect.poll(sourceText).toBe('')
  const newFragmentLabel = await page.getByRole('tab', { selected: true }).getAttribute('aria-label')
  await page.getByRole('tab', { name: preservedFragment, exact: true }).click()
  await expect.poll(sourceText).toBe(preservedFragment)
  await page.getByRole('tab', { name: newFragmentLabel, exact: true }).click()
  await expect.poll(sourceText).toBe('')
  pass('new Fomula fragment creates a separate empty tab while retaining the previous fragment and its content')

  await page.getByRole('button', { name: 'LaTeX 文档', exact: true }).click()
  await pane().getByRole('radio', { name: /英文单栏/ }).check()
  await pane().getByLabel('论文项目名称', { exact: true }).fill('Same name')
  await pane().getByRole('button', { name: '选择位置并创建', exact: true }).click()
  await expect(source()).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.oops.paperRuntime().then(runtime => runtime.available))).toBe(true)
  await nativeMenu('视图', '源码'); await expect(pane()).toHaveAttribute('data-layout', 'source')
  await nativeMenu('视图', '对照'); await expect(pane()).toHaveAttribute('data-layout', 'split')
  const manuscript = '\\documentclass[11pt]{article}\n\\title{Fomula Document}\n\\author{Test Author}\n\\begin{document}\n\\maketitle\nFirst page content.\n\\newpage\nSecond page content.\n\\end{document}\n'
  await replace(manuscript)
  await pane().getByRole('button', { name: '页面设置', exact: true }).click()
  const settings = pane().getByRole('region', { name: '页面设置', exact: true })
  await expect(settings).toBeVisible()
  await pane().getByRole('button', { name: '页面设置', exact: true }).click()
  await expect(settings).not.toBeVisible()
  await expect.poll(sourceText).toBe(manuscript)
  await pane().getByRole('button', { name: '页面设置', exact: true }).click()
  await expect(settings).toBeVisible()
  const headerInput = settings.getByLabel('页眉 左侧', { exact: true })
  await headerInput.click(); await page.keyboard.type('KEYBOARD_UNDO_PROBE')
  await page.keyboard.press('ControlOrMeta+Z'); await expect(headerInput).toHaveValue('')
  await page.keyboard.type('NATIVE_UNDO_PROBE')
  await nativeMenu('编辑', '撤销')
  await expect(headerInput).toHaveValue('')
  await settings.getByRole('button', { name: '关闭页面设置', exact: true }).click()
  await expect.poll(sourceText).toBe(manuscript)
  await pane().getByRole('button', { name: '页面设置', exact: true }).click()
  await expect(settings).toBeVisible()
  pass('keyboard and native-menu undo in page-setting inputs leave document source and its history unchanged')
  await settings.getByLabel(/^纸张/).selectOption('a5')
  await settings.getByLabel(/^方向/).selectOption('landscape')
  await settings.getByLabel('上边距（毫米）', { exact: true }).fill('18')
  await settings.getByLabel('页眉 左侧', { exact: true }).fill('FOMULA HEADER')
  await settings.getByLabel('页脚 居中', { exact: true }).fill('PAGE {page} / {pages}')
  await settings.getByLabel(/^页码位置/).selectOption('none')
  await narrow('page-settings-narrow.png')
  await settings.getByRole('button', { name: '应用页面设置', exact: true }).click()
  await expect.poll(sourceText).toContain('markflow:page-settings:start')
  const configured = await sourceText()
  expect(configured).toContain('a5paper,landscape'); expect(configured).toContain('top=18mm')
  await header().getByRole('button', { name: /^保存/ }).click()
  await compile()
  expect(await pane().locator('.paper-pdf-page').count()).toBe(2)
  const pdfPath = path.join(temporary, 'configured.pdf')
  await app.evaluate((_electron, value) => { globalThis.__fomulaOutput = value }, pdfPath)
  await pane().locator('.paper-export summary').click()
  await pane().getByRole('button', { name: '导出 PDF', exact: true }).click()
  await expect(pane().locator('.paper-notice').filter({ hasText: '已导出' }).first()).toBeVisible()
  await pane().locator('.paper-export summary').click()
  const loading = getDocument({ data: new Uint8Array(await readFile(pdfPath)), useSystemFonts: false, standardFontDataUrl: path.join(root, 'node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/' })
  try {
    const pdf = await loading.promise
    expect(pdf.numPages).toBe(2)
    for (let index = 1; index <= pdf.numPages; index++) {
      const pdfPage = await pdf.getPage(index), viewport = pdfPage.getViewport({ scale: 1 })
      expect(Math.abs(viewport.width - 210 * 72 / 25.4)).toBeLessThan(1)
      expect(Math.abs(viewport.height - 148 * 72 / 25.4)).toBeLessThan(1)
      const text = (await pdfPage.getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' ')
      expect(text).toContain('FOMULA HEADER'); expect(text.replace(/\s/g, '')).toContain(`PAGE${index}/2`)
    }
  } finally { await loading.destroy() }
  await page.screenshot({ path: path.join(temporary, 'configured-pdf.png') })
  pass('visual page settings compile to a real two-page A5 landscape PDF with the requested header, footer and page numbers')

  const firstMain = path.join(projects, 'Same name', 'main.tex'), original = await readFile(firstMain, 'utf8')
  await nativeMenu('文件', '新建文档')
  await expect(pane().getByRole('heading', { name: '新建 LaTeX 文档', exact: true })).toBeVisible()
  await pane().getByRole('button', { name: '选择位置并创建', exact: true }).click()
  await expect(header().locator('.document-project')).toHaveText('Same name (2)')
  const secondProject = path.join(projects, 'Same name (2)')
  await expect(header().locator('.document-project')).toHaveAttribute('title', secondProject)
  expect(await readFile(firstMain, 'utf8')).toBe(original)
  for (let index = 0; index < 7; index++) {
    await page.getByRole('button', { name: '关闭 Fomula 文档', exact: true }).click()
    await page.locator('.project-list').getByTitle(secondProject, { exact: true }).click()
    await page.getByRole('complementary', { name: '项目导航', exact: true }).getByTitle('main.tex', { exact: true }).click()
    await expect(pane()).toBeVisible()
    await expect(header().locator('.document-project')).toHaveText('Same name (2)')
    await expect(source()).toBeVisible()
  }
  pass('same-name creation preserves prior files and closing/reopening beyond six sessions does not exhaust the session limit')

  await pane().getByRole('button', { name: '公式片段', exact: true }).click()
  await chooseFile(complete)
  await expect(pane()).toBeVisible()
  await expect(header().locator('.document-project')).toHaveAttribute('title', fixtures)
  await expect.poll(sourceText).toContain('Opened complete document.')
  await expect(pane().getByRole('button', { name: '信任并启用本地编译', exact: true })).toBeVisible()
  await expect(pane().getByRole('button', { name: '编译', exact: true })).toBeDisabled()
  await pane().getByRole('button', { name: '信任并启用本地编译', exact: true }).click()
  await compile()
  await narrow('complete-document-narrow.png')
  pass('opening a complete .tex file automatically selects the document renderer and requires project trust before real PDF compilation')

  await pane().getByRole('button', { name: '公式片段', exact: true }).click()
  await chooseFile(fragment)
  await expect(source()).toBeVisible()
  await expect.poll(sourceText).toBe('\\sqrt{x^2+1}')
  await expect(page.locator('.math-preview .katex')).toBeVisible()
  await expect(pane()).not.toBeVisible()
  await page.screenshot({ path: path.join(temporary, 'formula-fragment.png') })
  expect(await readFile(complete, 'utf8')).toContain('Opened complete document.')
  expect(errors).toEqual([])
  pass('opening a formula-only .tex file keeps immediate KaTeX rendering; original sources and renderer stability are preserved')
} catch (error) {
  console.error(error)
  if (page) {
    await page.screenshot({ path: path.join(temporary, 'failure.png') }).catch(() => {})
    await writeFile(path.join(temporary, 'failure.txt'), (await page.locator('body').innerText().catch(() => '')) + '\n' + String(error))
  }
  process.exitCode = 1
} finally {
  await writeFile(path.join(temporary, 'results.json'), JSON.stringify({ application, checks, errors }, null, 2))
  console.log(JSON.stringify({ temporary, checks, errors }, null, 2))
  if (app) { const closed = app.waitForEvent('close').catch(() => {}); await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await closed }
}
