import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { markdownBody, readRegistry } from './mark-test-utils.mjs'

const root = process.cwd()
await mkdir(path.join(root, '.test-data'), { recursive: true })
const temporary = await mkdtemp(path.join(root, '.test-data', 'tabs-toolbar-'))
const library = path.join(temporary, '文档项目')
await mkdir(path.join(library, '文件夹'), { recursive: true })
const longName = '用于检查标签标题省略和横向滚动的长文档名称.md'
const originals = { 'Alpha.md': '# Alpha\n\nAlpha original.\n', 'Bravo.md': '# Bravo\n\nBravo original.\n', 'Charlie.md': '# Charlie\n\nCharlie original.\n', [longName]: '# Long title\n\nFind target, find target.\n', 'Delta.md': '# Delta\n', 'Echo.md': '# Echo\n', 'Foxtrot.md': '# Foxtrot\n', '公式.tex': 'x^2 + y^2 = z^2', '文件夹/内部.md': '# 文件夹内部\n' }
await Promise.all(Object.entries(originals).map(([name, content]) => writeFile(path.join(library, name), content)))
const gitBin = process.env.OOPSMD_SMOKE_EXE ? path.join(path.dirname(process.env.OOPSMD_SMOKE_EXE), 'resources', 'git', 'cmd', 'git.exe') : 'git'
const git = (...args) => execFileSync(gitBin, args, { cwd: library, encoding: 'utf8', windowsHide: true }).trim()
git('init', '-b', 'main'); git('config', 'user.name', 'OopsMD Tabs Test'); git('config', 'user.email', 'test@example.invalid'); git('add', '.'); git('commit', '-m', 'baseline')
const env = { ...process.env, OOPSMD_USER_DATA: path.join(temporary, 'profile') }
delete env.ELECTRON_RUN_AS_NODE
const checks = [], errors = [], screenshots = []
let app, page
const source = () => page.locator('.cm-content:visible')
const rich = () => page.locator('.live-pane [contenteditable="true"]:visible')
const tab = name => page.getByRole('tab', { name, exact: true })
const tabRow = name => page.locator('.document-tab').filter({ has: tab(name) })
const tree = name => page.locator('.tree-scroll').getByRole('button', { name, exact: true })
const passed = name => { checks.push(name); console.log(`PASS ${name}`) }
async function launch() {
  app = await electron.launch({ ...(process.env.OOPSMD_SMOKE_EXE ? { executablePath: process.env.OOPSMD_SMOKE_EXE, args: [] } : { args: [root] }), env })
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await resize(1440, 940)
}
async function close() {
  if (!app) return
  const exiting = app; app = undefined
  const closed = exiting.waitForEvent('close', { timeout: 10000 })
  await exiting.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await closed
}
async function resize(width, height) {
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height])
  await expect.poll(() => page.evaluate(size => Math.max(Math.abs(innerWidth - size[0]), Math.abs(innerHeight - size[1])), [width, height])).toBeLessThanOrEqual(2)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
async function capture(name) { const file = path.join(temporary, `${name}.png`); await page.screenshot({ path: file, animations: 'disabled' }); screenshots.push(file) }
async function sourceMode() { await page.getByRole('button', { name: '源码', exact: true }).click(); await expect(source()).toBeVisible() }
async function activate(name) { await tab(name).click(); await expect(tab(name)).toHaveAttribute('aria-selected', 'true'); await expect(page.locator('.navigation-shield')).toHaveCount(0) }
async function append(text) { await source().click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(text) }
async function save() { const button = page.locator('.document-bar').getByRole('button', { name: /^保存(?: Ctrl S)?$/ }); await button.click(); await expect(page.locator('.unsaved-dot')).toHaveCount(0); await expect(button).toBeEnabled() }
async function menu(name, action) { await tab(name).click({ button: 'right' }); await expect(page.getByRole('menu', { name: '标签操作' })).toBeVisible(); await page.getByRole('menuitem', { name: action, exact: true }).click() }
async function noOverflow() {
  const failures = await page.evaluate(() => ['.document-bar', '.editor-toolbar', '.statusbar'].flatMap(selector => {
    const region = document.querySelector(selector), bounds = region.getBoundingClientRect()
    return Array.from(region.querySelectorAll('button, select')).filter(control => control.offsetWidth && !control.closest('.format-menu')).filter(control => { const rect = control.getBoundingClientRect(); return rect.left < bounds.left - 1 || rect.right > bounds.right + 1 }).map(control => `${selector}: ${control.getAttribute('aria-label') || control.textContent}`)
  }))
  expect(failures).toEqual([])
}
async function visibleTabs(checkActive = false) {
  const geometry = await page.evaluate(() => {
    const strip = document.querySelector('.tab-strip').getBoundingClientRect()
    const pinned = Array.from(document.querySelectorAll('.tab-pinned')).map(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right } })
    const active = document.querySelector('.document-tab.active').getBoundingClientRect()
    return { strip: { left: strip.left, right: strip.right }, pinned, active: { left: active.left, right: active.right } }
  })
  for (const [index, pinned] of geometry.pinned.entries()) expect(Math.abs(pinned.left - geometry.strip.left - index * 44)).toBeLessThanOrEqual(1)
  if (checkActive) {
    expect(geometry.active.left).toBeGreaterThanOrEqual(geometry.strip.left + geometry.pinned.length * 44 - 1)
    expect(geometry.active.right).toBeLessThanOrEqual(geometry.strip.right + 1)
  }
}

try {
  await launch()
  await expect(rich()).toBeVisible()
  await expect(page.locator('.draft-list, .draft-item')).toHaveCount(0)
  const chrome = await page.evaluate(() => {
    const header = document.querySelector('.window-drag'), sidebar = document.querySelector('.sidebar'), strip = document.querySelector('.tab-strip'), add = document.querySelector('.tab-new')
    return { height: header.getBoundingClientRect().height, padding: parseFloat(getComputedStyle(header).paddingRight), sidebarRight: sidebar.getBoundingClientRect().right, tabsLeft: strip.getBoundingClientRect().left, addRight: add.getBoundingClientRect().right, width: innerWidth, drag: getComputedStyle(header).getPropertyValue('-webkit-app-region'), tabDrag: getComputedStyle(strip).getPropertyValue('-webkit-app-region') }
  })
  expect(chrome.height).toBe(40); expect(chrome.padding).toBeGreaterThanOrEqual(140)
  expect(Math.abs(chrome.tabsLeft - chrome.sidebarRight)).toBeLessThanOrEqual(1)
  expect(chrome.addRight).toBeLessThanOrEqual(chrome.width - 140)
  expect(chrome.drag).toBe('drag'); expect(chrome.tabDrag).toBe('no-drag')
  passed('40px draggable titlebar aligns with the sidebar and reserves native caption buttons')

  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, library)
  await page.getByRole('button', { name: '打开项目', exact: true }).click()
  await tree('Alpha.md').click(); await sourceMode(); await append('ALPHA_EDIT')
  await expect(tabRow('Alpha.md').locator('.tab-dirty')).toBeVisible()
  await tree('Bravo.md').click(); await sourceMode(); await append('BRAVO_EDIT')
  await activate('Alpha.md'); await expect(page.locator('.editor-area')).toHaveClass(/layout-source/); await expect(source()).toContainText('ALPHA_EDIT')
  await source().click(); await page.keyboard.press('Control+z'); await expect(source()).not.toContainText('ALPHA_EDIT')
  await page.keyboard.press('Control+Shift+Z'); await expect(source()).toContainText('ALPHA_EDIT'); await save()
  const savedAlpha = await readFile(path.join(library, 'Alpha.md'), 'utf8')
  expect(markdownBody(savedAlpha)).toBe(originals['Alpha.md'] + 'ALPHA_EDIT')
  expect(readRegistry(savedAlpha)?.complete).toBe(true)
  expect(await readFile(path.join(library, 'Bravo.md'), 'utf8')).toBe(originals['Bravo.md'])
  await activate('Bravo.md'); await sourceMode(); await expect(source()).toContainText('BRAVO_EDIT'); await save()
  passed('tabs retain independent unsaved buffers and undo history; saving affects only the active file')

  await tree('Charlie.md').click(); await sourceMode(); await append('CHARLIE_DRAFT')
  await tabRow('Charlie.md').getByRole('button', { name: '关闭标签 Charlie.md', exact: true }).click()
  await page.getByRole('dialog', { name: '当前文档尚未保存' }).getByRole('button', { name: '取消', exact: true }).click()
  await expect(tab('Charlie.md')).toHaveCount(1)
  await tabRow('Charlie.md').getByRole('button', { name: '关闭标签 Charlie.md', exact: true }).click()
  await page.getByRole('dialog', { name: '当前文档尚未保存' }).getByRole('button', { name: '保留草稿', exact: true }).click()
  await expect(tab('Charlie.md')).toHaveCount(0)
  await menu('Alpha.md', '重新打开关闭的标签'); await sourceMode(); await expect(source()).toContainText('CHARLIE_DRAFT'); await save()
  await menu('Alpha.md', '固定标签'); await expect(page.locator('.document-tab').first()).toHaveClass(/tab-pinned/)
  await menu('Bravo.md', '关闭其他标签'); await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(tab('Alpha.md')).toHaveCount(1); await expect(tab('Bravo.md')).toHaveCount(1)
  await menu('Bravo.md', '重新打开关闭的标签'); await expect(tab('Charlie.md')).toHaveCount(1)
  await menu('Bravo.md', '关闭右侧标签'); await expect(tab('Charlie.md')).toHaveCount(0)
  await menu('Bravo.md', '重新打开关闭的标签'); await expect(tab('Charlie.md')).toHaveCount(1)
  await tabRow('Charlie.md').dragTo(tabRow('Bravo.md'))
  await expect(page.getByRole('tab')).toHaveCount(3)
  expect(await page.getByRole('tab').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')))).toEqual(['Alpha.md', 'Charlie.md', 'Bravo.md'])
  passed('dirty-close cancellation and draft recovery, pinning, close-other/right and native drag reorder work')

  await menu('Charlie.md', '固定标签')
  for (const name of ['Delta.md', 'Echo.md', 'Foxtrot.md', longName]) await tree(name).click()
  await resize(920, 620)
  const tabsGeometry = await page.locator('.tab-strip').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth, right: element.getBoundingClientRect().right }))
  expect(tabsGeometry.scroll).toBeGreaterThan(tabsGeometry.width)
  const title = await tabRow(longName).locator('.tab-title').evaluate(element => ({ overflow: getComputedStyle(element).textOverflow, clipped: element.scrollWidth > element.clientWidth }))
  expect(title).toEqual({ overflow: 'ellipsis', clipped: true })
  await expect(tab(longName)).toBeInViewport()
  await noOverflow(); await visibleTabs(); await capture('tabs-compact')
  passed('many tabs scroll horizontally while two pinned tabs remain visible at 920px')

  const fonts = await page.evaluate(() => window.oops.fonts())
  const font = fonts.find(item => item.available && item.id === 'alibaba-puhuiti') ?? fonts.find(item => item.available && item.id !== 'system')
  expect(font).toBeTruthy()
  const defaultTypography = await page.evaluate(async () => { const settings = await window.oops.settings(); return { fontFamily: settings.fontFamily, fontSize: settings.fontSize } })
  await expect(page.locator('.navigation-shield')).toHaveCount(0)
  await page.getByRole('button', { name: '实时预览', exact: true }).click()
  await expect(rich()).toBeVisible()
  await rich().locator('p').first().click()
  await expect(page.locator('.font-control')).toHaveAttribute('title', '当前 Mark：Find target, find target.')
  await page.getByRole('combobox', { name: 'Mark 字体', exact: true }).selectOption(font.id)
  await expect(page.getByRole('combobox', { name: 'Mark 字体', exact: true })).toHaveValue(font.id)
  await expect(page.locator('.font-family-select option:checked')).toHaveText(font.name)
  await page.getByRole('combobox', { name: 'Mark 字号', exact: true }).selectOption('20')
  const typography = await rich().locator('p').first().evaluate(element => ({ family: getComputedStyle(element).fontFamily, size: getComputedStyle(element).fontSize, synthesis: getComputedStyle(element).fontSynthesis }))
  expect(typography.family.toLowerCase()).toContain(font.family.split(',')[0].replaceAll('"', '').replaceAll("'", '').trim().toLowerCase())
  expect(typography.size).toBe('20px'); expect(typography.synthesis).not.toBe('none')
  const devtools = await page.context().newCDPSession(page)
  await devtools.send('DOM.enable'); await devtools.send('CSS.enable')
  const { root: domRoot } = await devtools.send('DOM.getDocument')
  const { nodeId } = await devtools.send('DOM.querySelector', { nodeId: domRoot.nodeId, selector: '.live-pane [contenteditable="true"] p' })
  const { fonts: renderedFonts } = await devtools.send('CSS.getPlatformFontsForNode', { nodeId })
  await devtools.detach()
  const expectedFont = font.id === 'alibaba-puhuiti' ? /alibaba|普惠/i : new RegExp(font.family.split(',')[0].replaceAll('"', '').replaceAll("'", '').trim(), 'i')
  expect(renderedFonts.some(item => item.glyphCount > 0 && expectedFont.test(item.familyName))).toBe(true)
  for (const missing of fonts.filter(item => !item.available)) await expect(page.locator(`.font-family-select option[value="${missing.id}"]`)).toBeDisabled()
  await expect(page.locator('.format-tools').getByRole('button', { name: '加粗', exact: true })).toBeVisible()
  await expect(page.locator('.format-tools').getByRole('button', { name: '斜体', exact: true })).toBeVisible()
  await rich().locator('p').first().click()
  await page.keyboard.press('Home'); await page.keyboard.press('Shift+End')
  await page.getByRole('button', { name: '更多排版', exact: true }).click()
  await expect(page.locator('.format-menu button')).toHaveCount(7)
  for (const format of ['加粗', '下划线', '删除线', '斜体', '上标', '下标', '荧光笔']) await expect(page.locator('.format-menu').getByRole('button', { name: format, exact: true })).toBeVisible()
  await page.locator('.format-menu').getByRole('button', { name: '加粗', exact: true }).click()
  await expect(rich().locator('strong')).toHaveText('Find target, find target.')
  await sourceMode(); await expect(source()).toContainText('**Find target, find target.**')
  expect(await page.evaluate(async () => { const settings = await window.oops.settings(); return { fontFamily: settings.fontFamily, fontSize: settings.fontSize } })).toEqual(defaultTypography)
  await save(); await page.getByRole('button', { name: '实时预览', exact: true }).click()
  await page.getByRole('button', { name: '查找', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '页内查找', exact: true })).toBeFocused()
  await page.getByRole('textbox', { name: '页内查找', exact: true }).fill('target')
  await expect(page.locator('.find-bar')).toContainText('2')
  await noOverflow(); await capture('toolbar-search-compact')
  await page.getByRole('textbox', { name: '页内查找', exact: true }).press('Escape')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setMinimumSize(780, 560))
  await resize(840, 620); await noOverflow(); await visibleTabs(); await capture('toolbar-narrow')
  await resize(1440, 940); await expect(page.locator('.format-tools')).toBeVisible(); await noOverflow(); await capture('toolbar-wide')
  passed('available fonts and size are visibly applied; unavailable fonts are disabled; compact formatting and live search fit')

  await page.getByRole('button', { name: '文件夹树', exact: true }).click()
  await expect(page.locator('.folder-hierarchy').getByRole('button', { name: 'Alpha.md', exact: true })).toHaveCount(0)
  await page.locator('.folder-hierarchy').getByRole('button', { name: '文件夹', exact: true }).click()
  await expect(page.locator('.folder-list').getByRole('button', { name: '内部.md', exact: true })).toBeVisible()
  await expect(page.locator('.folder-list .block-tree')).toHaveCount(0)
  await expect(page.locator('.document-blocks')).toBeVisible()
  await expect(page.locator('.document-blocks').getByRole('button', { name: '跳转 Mark 1 Long title', exact: true })).toBeEnabled()
  await expect(page.getByText('大纲暂时不可用，正文仍可继续编辑。', { exact: true })).toHaveCount(0)
  await capture('folder-hierarchy')
  passed('folder view separates folder hierarchy, selected-folder files and current-document outline')

  await page.keyboard.press('Control+t')
  await expect(page.getByRole('tab')).toHaveCount(8); await expect(rich()).toBeVisible()
  await rich().click(); await page.keyboard.insertText('KEYBOARD_DRAFT')
  await expect(page.locator('.document-tab.active .tab-dirty')).toBeVisible()
  await page.keyboard.press('Control+Tab'); await expect(tab('Alpha.md')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.navigation-shield')).toHaveCount(0)
  await page.keyboard.press('Control+Shift+Tab'); await expect(rich()).toContainText('KEYBOARD_DRAFT')
  await expect(page.locator('.navigation-shield')).toHaveCount(0)
  await page.keyboard.press('Control+f'); await expect(page.getByRole('textbox', { name: '页内查找', exact: true })).toBeFocused()
  await page.getByRole('textbox', { name: '页内查找', exact: true }).press('Escape')
  await page.keyboard.press('Control+w')
  await page.getByRole('dialog', { name: '当前文档尚未保存' }).getByRole('button', { name: '保留草稿', exact: true }).click()
  await expect(page.getByRole('tab')).toHaveCount(7); await expect(page.locator('.navigation-shield')).toHaveCount(0)
  await page.keyboard.press('Control+Shift+T'); await expect(page.getByRole('tab')).toHaveCount(8); await expect(rich()).toContainText('KEYBOARD_DRAFT')
  await expect(page.locator('.navigation-shield')).toHaveCount(0)
  await page.keyboard.press('Control+w')
  await page.getByRole('dialog', { name: '当前文档尚未保存' }).getByRole('button', { name: '保留草稿', exact: true }).click()
  await expect(page.getByRole('tab')).toHaveCount(7); await expect(tab(longName)).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.navigation-shield')).toHaveCount(0)
  passed('Ctrl T/W/Tab/Shift Tab/Shift T/F shortcuts create, cycle, protect, reopen and search real documents')

  await resize(920, 620); await visibleTabs(true)
  await resize(840, 620); await visibleTabs(true)
  await resize(1440, 940)
  passed('resizing reveals the complete active tab including close control without covering pinned tabs')

  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('oopsmd.tabs.v1')).tabs.length)).toBe(7)
  await close(); await launch()
  await expect(tab(longName)).toHaveAttribute('aria-selected', 'true')
  await expect(tabRow('Alpha.md')).toHaveClass(/tab-pinned/)
  await rich().locator('p').first().click()
  await expect(page.getByRole('combobox', { name: 'Mark 字体', exact: true })).toHaveValue(font.id)
  await expect(page.getByRole('combobox', { name: 'Mark 字号', exact: true })).toHaveValue('20')
  passed('tab session, pinned state, current document and typography survive restart')
  expect(errors).toEqual([])
  console.log(JSON.stringify({ ok: true, checks, temporary, font: font.name, renderedFonts, screenshots }, null, 2))
} catch (error) {
  if (page && !page.isClosed()) { await capture('failure').catch(() => {}); console.error((await page.locator('body').innerText()).slice(0, 5000)) }
  console.error(JSON.stringify({ ok: false, checks, errors, temporary, error: String(error) }, null, 2))
  throw error
} finally { await close() }
