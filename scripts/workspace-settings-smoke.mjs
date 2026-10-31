import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'

const root = process.cwd()
const { values } = parseArgs({ options: { app: { type: 'string' }, 'evidence-dir': { type: 'string' } } })
const evidence = path.resolve(values['evidence-dir'] ?? 'D:/MarkFlow-Workspace-20261031')
await mkdir(evidence, { recursive: true })
const temporary = await mkdtemp(path.join(evidence, 'workspace-settings-'))
const projects = path.join(temporary, 'projects')
await mkdir(projects)
const env = { ...process.env, MARKFLOW_USER_DATA: path.join(temporary, 'profile') }
delete env.ELECTRON_RUN_AS_NODE
const checks = [], errors = [], geometry = [], motion = []
let app, page, application
const pass = name => { checks.push(name); console.log(`PASS ${name}`) }
const pane = () => page.getByRole('region', { name: 'Fomula 文档工作区', exact: true })
const source = () => page.locator('.cm-content:visible')
const sourceText = () => source().evaluate(element => element.cmTile.root.view.state.doc.toString())
const settings = () => page.getByRole('complementary', { name: '设置', exact: true })
const completion = () => page.getByRole('region', { name: '自动补全设置', exact: true })
const persisted = () => page.evaluate(() => window.oops.settings().then(settings => settings.completion))
const rich = () => page.getByRole('textbox', { name: '文档内容', exact: true })

async function launch() {
  app = await electron.launch({ ...(values.app ? { executablePath: path.resolve(values.app), args: [] } : { args: [root] }), env })
  application = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), platform: process.platform, resources: process.resourcesPath }))
  page = await app.firstWindow(); page.setDefaultTimeout(20000)
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(page.locator('.app')).toBeVisible()
  await app.evaluate(({ dialog }, destination) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [destination] })
    dialog.showSaveDialog = async () => ({ canceled: true })
  }, projects)
}
async function stop() {
  if (!app) return
  const current = app, closed = current.waitForEvent('close').catch(() => {})
  app = undefined
  await current.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await closed
}
async function openSettings(engine) {
  if (!await settings().isVisible()) await page.getByRole('button', { name: '设置', exact: true }).filter({ visible: true }).click()
  await expect(settings()).toBeVisible()
  if (engine) {
    await settings().getByRole('button', { name: '自动补全', exact: true }).click()
    await completion().getByLabel('补全适用页面', { exact: true }).selectOption(engine)
    await expect(completion()).toHaveAttribute('aria-busy', 'false')
  }
}
async function closeSettings() {
  await settings().getByRole('button', { name: '关闭面板', exact: true }).click()
  await expect(settings()).toHaveCount(0)
}
async function changeRuleOption(label, checked, engine, field) {
  const input = completion().getByLabel(label, { exact: true })
  if (await input.isChecked() !== checked) await input.click()
  await expect.poll(async () => field((await persisted())[engine])).toBe(checked)
  await expect(completion()).toHaveAttribute('aria-busy', 'false')
  await expect(input).toBeChecked({ checked })
}
async function addRule(engine, trigger, content) {
  await openSettings(engine)
  await completion().getByRole('button', { name: '添加', exact: true }).click()
  await completion().getByLabel('自定义补全触发词', { exact: true }).fill(trigger)
  await completion().getByLabel('自定义补全提示说明', { exact: true }).fill(`${engine} custom example`)
  await completion().getByLabel('自定义补全插入内容', { exact: true }).fill(content)
  await completion().getByRole('button', { name: '保存规则', exact: true }).click()
  await expect(completion().getByRole('form')).toHaveCount(0)
  await expect.poll(async () => (await persisted())[engine].customCommands.find(rule => rule.trigger === trigger)?.content).toBe(content)
}
async function replace(text) {
  await source().click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText(text)
  await expect.poll(sourceText).toBe(text)
}
async function insertCompletion(trigger, expected) {
  await replace(trigger)
  await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible()
  await page.keyboard.press('Tab')
  await expect.poll(sourceText).toBe(expected)
}
async function newDocument(page, label) {
  await page.getByRole('button', { name: '新建标签', exact: true }).click()
  await page.getByRole('menuitem', { name: new RegExp(`^${label}\\b`) }).click()
  if (label === 'Fomula') {
    await expect(pane()).toBeVisible()
    await pane().getByRole('button', { name: '公式片段', exact: true }).click()
  }
  await expect(pane()).toBeHidden()
  await expect(page.locator('.document-name:visible')).toHaveText(label === 'Fomula' ? '未命名.tex' : '未命名.md')
}
async function setTheme(theme) {
  await openSettings()
  await settings().getByRole('button', { name: '通用', exact: true }).click()
  await settings().getByLabel('主题', { exact: true }).selectOption(theme)
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  await closeSettings()
  await page.waitForTimeout(200) // Let the shared 160ms theme transition finish before screenshots.
}
async function sampleMotion(open) {
  const samples = await page.evaluate(async expectedOpen => {
    const panel = document.querySelector('#paper-page-config')
    const trigger = document.querySelector('.paper-settings-trigger')
    const values = [], start = performance.now()
    trigger.click()
    while (performance.now() - start < 300) {
      await new Promise(requestAnimationFrame)
      const style = getComputedStyle(panel)
      values.push({ ms: performance.now() - start, opacity: Number(style.opacity), transform: style.transform, visibility: style.visibility, open: panel.dataset.open })
    }
    return { expectedOpen, samples: values }
  }, open)
  motion.push(samples)
  expect(samples.samples.some(item => item.opacity > 0 && item.opacity < 1)).toBe(true)
  expect(samples.samples.at(-1).open).toBe(String(open))
  expect(samples.samples.at(-1).opacity).toBe(open ? 1 : 0)
}
async function measure(mode, width, theme) {
  await page.setViewportSize({ width, height: 920 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  const result = await page.evaluate(() => {
    const visible = selector => [...document.querySelectorAll(selector)].find(element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0)
    const rect = element => element ? { width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, font: getComputedStyle(element).fontSize } : null
    const header = visible('.workspace-header'), toolbar = visible('.workspace-editor-toolbar'), sidebar = visible('.workspace-sidebar')
    return { headerCount: document.querySelectorAll('.workspace-header').length, sidebarCount: document.querySelectorAll('.workspace-sidebar').length, header: rect(header), toolbar: rect(toolbar), sidebar: rect(sidebar), overflow: [...document.querySelectorAll('.workspace-header,.workspace-editor-toolbar,.workspace-sidebar')].filter(element => element.getBoundingClientRect().width > 0).map(element => ({ className: element.className, overflow: element.scrollWidth - element.clientWidth })), documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }
  })
  expect(result.headerCount).toBe(1); expect(result.sidebarCount).toBe(1)
  expect(result.header).not.toBeNull(); expect(result.toolbar).not.toBeNull(); expect(result.sidebar).not.toBeNull()
  for (const item of result.overflow) expect(item.overflow, `${mode} ${width} ${item.className}`).toBeLessThanOrEqual(1)
  geometry.push({ mode, width, theme, ...result })
  await page.screenshot({ path: path.join(temporary, `${mode}-${width}-${theme}.png`) })
}

try {
  await launch()
  await expect(page.locator('.document-name')).toHaveText('未命名.md')
  const markdownContent = 'MD_CUSTOM_MEETING'
  await addRule('markdown', 'meeting', markdownContent)
  await completion().getByLabel('补全匹配方式', { exact: true }).selectOption('prefix')
  await expect.poll(async () => (await persisted()).markdown.matching).toBe('prefix')
  await completion().getByLabel('补全候选排序', { exact: true }).selectOption('alphabetical')
  await expect.poll(async () => (await persisted()).markdown.sort).toBe('alphabetical')
  await page.screenshot({ path: path.join(temporary, 'completion-markdown.png') })
  await closeSettings()
  await rich().click(); await page.keyboard.insertText('/meeting')
  await expect(page.locator('.slash-completion-menu')).toBeVisible()
  await expect(page.locator('.slash-completion-menu')).toContainText('markdown custom example')
  await page.keyboard.press('Tab')
  await expect(rich()).toHaveText(markdownContent)
  pass('Markdown custom rule saves through settings and inserts into the real rich editor')
  await page.keyboard.press('Enter'); await page.keyboard.insertText('/meeting')
  await expect(page.locator('.slash-completion-menu')).toBeVisible()
  await page.keyboard.press('Escape'); await page.keyboard.press('Tab')
  await expect(page.locator('.slash-completion-menu')).not.toBeVisible()
  await expect.poll(() => rich().locator('p').last().textContent()).toBe('\u2002\u2002\u2002/meeting')
  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => rich().locator('p').last().textContent()).toBe('/meeting')
  await expect(page.locator('.slash-completion-menu')).not.toBeVisible()
  pass('Dismissing a rich-editor suggestion with Escape keeps Tab and Shift+Tab as indentation without reopening it')

  await newDocument(page, 'Fomula')
  await replace('/meeting')
  await expect(page.locator('.cm-tooltip-autocomplete')).not.toBeVisible()
  await openSettings('formula')
  await expect(completion().locator('.completion-custom-row')).toHaveCount(0)
  await completion().getByLabel('补全适用页面', { exact: true }).selectOption('latex')
  await expect(completion().locator('.completion-custom-row')).toHaveCount(0)
  const formulaContent = '\\alpha + 1'
  await addRule('formula', 'meeting', formulaContent)
  await closeSettings()
  await insertCompletion('\\meeting', formulaContent)
  expect((await persisted()).markdown.customCommands[0].content).toBe(markdownContent)
  expect((await persisted()).latex.customCommands).toHaveLength(0)
  pass('Formula and full LaTeX have independent rules; the same trigger can insert different content')

  await replace('HISTORY_BEFORE_SETTINGS')
  await page.keyboard.press('End'); await page.keyboard.insertText('_AFTER')
  await openSettings('formula')
  await changeRuleOption('\\ 触发补全', false, 'formula', config => config.triggers.backslash)
  await closeSettings()
  await source().click(); await page.keyboard.press('ControlOrMeta+Z')
  await expect.poll(sourceText).toBe(formulaContent)
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await expect.poll(sourceText).toBe('HISTORY_BEFORE_SETTINGS_AFTER')
  await replace('\\meeting')
  await expect(page.locator('.cm-tooltip-autocomplete')).not.toBeVisible()
  await page.keyboard.press('Tab'); await expect.poll(sourceText).toBe('  \\meeting')
  await page.keyboard.press('Shift+Tab'); await expect.poll(sourceText).toBe('\\meeting')
  await openSettings('formula')
  await changeRuleOption('启用自动补全', false, 'formula', config => config.enabled)
  await closeSettings()
  await replace('/meeting')
  await expect(page.locator('.cm-tooltip-autocomplete')).not.toBeVisible()
  await page.keyboard.press('Tab'); await expect.poll(sourceText).toBe('  /meeting')
  await openSettings('formula')
  await changeRuleOption('启用自动补全', true, 'formula', config => config.enabled)
  await changeRuleOption('\\ 触发补全', true, 'formula', config => config.triggers.backslash)
  await closeSettings()
  await insertCompletion('\\meeting', formulaContent)
  pass('Disabling one trigger or all completion retains Tab indentation; settings update immediately without resetting editor undo')

  const beforeRestart = await persisted()
  await stop(); await launch()
  await expect.poll(persisted).toEqual(beforeRestart)
  await openSettings('markdown')
  await expect(completion().locator('.completion-custom-row')).toContainText('meeting')
  await expect(completion().getByLabel('补全匹配方式', { exact: true })).toHaveValue('prefix')
  await expect(completion().getByLabel('补全候选排序', { exact: true })).toHaveValue('alphabetical')
  await completion().getByLabel('补全适用页面', { exact: true }).selectOption('formula')
  await expect(completion().locator('.completion-custom-row')).toContainText('formula custom example')
  await completion().getByTitle('编辑规则', { exact: true }).click()
  await expect(completion().getByLabel('自定义补全插入内容', { exact: true })).toHaveValue(formulaContent)
  await completion().getByRole('button', { name: '取消', exact: true }).click()
  await closeSettings()
  pass('A full Electron restart restores per-engine settings in the main process and in the visible settings form')

  await page.getByRole('button', { name: '新建标签', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Fomula/ }).click()
  await expect(pane()).toBeVisible()
  await pane().getByRole('radio', { name: /英文单栏/ }).check()
  await pane().getByLabel('论文项目名称', { exact: true }).fill('Workspace settings acceptance')
  await pane().getByRole('button', { name: '选择位置并创建', exact: true }).click()
  await expect(source()).toBeVisible()
  const latexContent = '\\section{LATEX_CUSTOM_MEETING}'
  await addRule('latex', 'meeting', latexContent)
  await page.screenshot({ path: path.join(temporary, 'completion-full-latex.png') })
  await closeSettings()
  await insertCompletion('/meeting', latexContent)
  expect((await persisted()).formula.customCommands[0].content).toBe(formulaContent)
  expect((await persisted()).markdown.customCommands[0].content).toBe(markdownContent)
  pass('The full TeX workspace exposes shared settings and applies its own custom rule immediately')

  const manuscript = '\\documentclass{article}\n\\begin{document}\nWorkspace settings acceptance.\n\\newpage\nSecond page.\n\\newpage\nThird page.\n\\end{document}\n'
  await replace(manuscript)
  await pane().getByRole('button', { name: '编译', exact: true }).click()
  await expect(pane().getByRole('button', { name: '取消编译', exact: true })).toBeVisible()
  await expect(pane().getByRole('button', { name: '编译', exact: true })).toBeVisible({ timeout: 120000 })
  await expect(pane().locator('.paper-pdf-page canvas').first()).toBeVisible({ timeout: 30000 })
  await expect(pane().locator('.paper-pdf-page')).toHaveCount(3)
  const pdfBefore = await page.evaluate(() => {
    const scroll = document.querySelector('.paper-pdf-scroll')
    scroll.scrollTop = 180
    globalThis.__workspacePdfNode = document.querySelector('.paper-pdf-page canvas')
    return { scrollTop: scroll.scrollTop, pages: document.querySelectorAll('.paper-pdf-page').length }
  })
  await pane().getByRole('button', { name: '页面设置', exact: true }).click()
  const pageConfig = pane().getByRole('region', { name: '页面设置', exact: true })
  await pageConfig.getByLabel('上边距（毫米）', { exact: true }).fill('29')
  await page.keyboard.press('Escape')
  await expect(pane().locator('#paper-page-config')).toBeHidden()
  await expect(pane().getByRole('button', { name: '页面设置', exact: true })).toBeFocused()
  await pane().getByRole('button', { name: '页面设置', exact: true }).click()
  await expect(pageConfig.getByLabel('上边距（毫米）', { exact: true })).toHaveValue('29')
  await expect.poll(sourceText).toBe(manuscript)
  await pageConfig.getByRole('button', { name: '关闭页面设置', exact: true }).click()
  await expect(pane().locator('#paper-page-config')).toBeHidden()
  pass('Escape closes page settings and returns focus; reopening preserves unapplied values without changing the document')
  await sampleMotion(true)
  await sampleMotion(false)
  await page.evaluate(async () => {
    const trigger = document.querySelector('.paper-settings-trigger')
    for (let index = 0; index < 6; index++) { trigger.click(); await new Promise(resolve => setTimeout(resolve, 35)) }
  })
  await expect(pane().locator('#paper-page-config')).toHaveAttribute('data-open', 'false')
  await expect(pane().locator('#paper-page-config')).toBeHidden()
  const pdfAfter = await page.evaluate(() => ({ sameNode: globalThis.__workspacePdfNode === document.querySelector('.paper-pdf-page canvas'), scrollTop: document.querySelector('.paper-pdf-scroll').scrollTop, pages: document.querySelectorAll('.paper-pdf-page').length }))
  expect(pdfAfter.sameNode).toBe(true); expect(pdfAfter.scrollTop).toBe(pdfBefore.scrollTop); expect(pdfAfter.pages).toBe(pdfBefore.pages)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const open of [true, false]) {
    await pane().getByRole('button', { name: '页面设置', exact: true }).click()
    await expect(pane().locator('#paper-page-config')).toHaveAttribute('data-open', String(open))
    const state = await pane().locator('#paper-page-config').evaluate(element => ({ opacity: getComputedStyle(element).opacity, duration: getComputedStyle(element).transitionDuration, running: element.getAnimations().filter(animation => animation.playState === 'running').length }))
    expect(state.opacity).toBe(open ? '1' : '0'); expect(state.duration).toBe('0s'); expect(state.running).toBe(0)
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect.poll(sourceText).toBe(manuscript)
  pass('Page settings animate both ways, survive rapid toggles, respect reduced motion, and preserve the PDF canvas, pages, scroll and source')

  await newDocument(page, 'Markdown')
  await rich().click(); await page.keyboard.insertText('Workspace design acceptance')
  const mdTab = await page.getByRole('tab', { selected: true }).getAttribute('aria-label')
  await newDocument(page, 'Fomula')
  await replace('x^2 + y^2 = 1')
  const formulaTab = await page.getByRole('tab', { selected: true }).getAttribute('aria-label')
  await page.getByRole('tab', { name: 'Fomula', exact: true }).click()
  await page.locator('.project-list').getByTitle(path.join(projects, 'Workspace settings acceptance'), { exact: true }).click()
  await page.getByRole('complementary', { name: '项目导航', exact: true }).getByTitle('main.tex', { exact: true }).click()
  await expect(pane().locator('.cm-content')).toBeVisible()
  await expect.poll(sourceText).toBe(manuscript)
  const trustOwnFixture = pane().getByRole('button', { name: '信任并启用本地编译', exact: true })
  if (await trustOwnFixture.isVisible()) await trustOwnFixture.click()
  await pane().getByRole('button', { name: '编译', exact: true }).click()
  await expect(pane().getByRole('button', { name: '取消编译', exact: true })).toBeVisible()
  await expect(pane().getByRole('button', { name: '编译', exact: true })).toBeVisible({ timeout: 120000 })
  await expect(pane().locator('.paper-pdf-page canvas').first()).toBeVisible({ timeout: 30000 })
  await expect(pane().locator('.paper-pdf-page')).toHaveCount(3)
  await openSettings()
  await settings().getByRole('button', { name: '通用', exact: true }).click()
  const fontSize = settings().getByLabel('默认字号', { exact: true })
  await fontSize.focus(); await fontSize.press('Home')
  await expect.poll(() => page.evaluate(() => window.oops.settings().then(settings => settings.fontSize))).toBe(12)
  await expect(fontSize).toHaveValue('12')
  for (let size = 13; size <= 18; size++) {
    await fontSize.press('ArrowRight')
    await expect.poll(() => page.evaluate(() => window.oops.settings().then(settings => settings.fontSize))).toBe(size)
    await expect(fontSize).toHaveValue(String(size))
  }
  await closeSettings()
  await expect.poll(() => source().evaluate(element => getComputedStyle(element).fontSize)).toBe('18px')
  await page.getByRole('tab', { name: formulaTab, exact: true }).click()
  await expect.poll(() => source().evaluate(element => getComputedStyle(element).fontSize)).toBe('18px')
  pass('Changing the shared font size updates both formula and full TeX editors to 18px')
  for (const name of [mdTab, formulaTab, 'Fomula']) {
    await page.getByRole('tab', { name, exact: true }).click()
    await page.getByRole('button', { name: '收起 / 展开侧栏', exact: true }).click()
    await expect(page.locator('.workspace-sidebar:visible')).toHaveCount(0)
    await page.getByRole('button', { name: '收起 / 展开侧栏', exact: true }).click()
    await expect(page.locator('.workspace-sidebar:visible')).toHaveCount(1)
  }
  pass('The global sidebar button opens and closes the shared sidebar in all three editing modes')
  for (const theme of ['light', 'dark']) {
    await setTheme(theme)
    for (const width of [1440, 1100, 920]) {
      for (const [mode, name] of [['markdown', mdTab], ['formula', formulaTab], ['latex', 'Fomula']]) {
        await page.getByRole('tab', { name, exact: true }).click()
        if (mode === 'latex') await expect(pane()).toBeVisible()
        else await expect(pane()).toBeHidden()
        await measure(mode, width, theme)
      }
    }
  }
  for (const theme of ['light', 'dark']) for (const width of [1440, 1100, 920]) {
    const baseline = geometry.filter(item => item.theme === theme && item.width === width)
    for (const item of baseline.slice(1)) {
      expect(item.header.height, `${theme} ${width} header ${item.mode}`).toBe(baseline[0].header.height)
      expect(item.sidebar.width, `${theme} ${width} sidebar ${item.mode}`).toBe(baseline[0].sidebar.width)
    }
  }
  pass('Markdown, formula and full TeX share one sidebar and header with matching dimensions at 1440/1100/920 in both themes; engine toolbars may wrap without horizontal overflow')
  expect(errors).toEqual([])
  pass('No renderer page errors throughout the workspace checks')
} catch (error) {
  console.error(error)
  if (page) {
    await page.screenshot({ path: path.join(temporary, 'failure.png') }).catch(() => {})
    await writeFile(path.join(temporary, 'failure.txt'), (await page.locator('body').innerText().catch(() => '')) + '\n' + String(error))
  }
  process.exitCode = 1
} finally {
  await writeFile(path.join(temporary, 'results.json'), JSON.stringify({ application, checks, errors, geometry, motion }, null, 2))
  console.log(JSON.stringify({ temporary, checks, errors }, null, 2))
  await stop()
}
