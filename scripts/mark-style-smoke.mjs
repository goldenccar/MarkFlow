import { openLocalProject, newDocument, showBlockInspector } from './ui-test-utils.mjs'
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { markdownBody, readRegistry } from './mark-test-utils.mjs'

const root = process.cwd()
await mkdir(path.join(root, '.test-data'), { recursive: true })
const temporary = await mkdtemp(path.join(root, '.test-data', 'mark-style-'))
const library = path.join(temporary, 'Mark 项目')
await mkdir(path.join(library, '资料'), { recursive: true })
const initial = '# Mark 排版\n\n第一段 Alpha 内容。\n\n第二段 Bravo 内容。\n'
await writeFile(path.join(library, '样式.md'), initial)
await writeFile(path.join(library, '公式.tex'), 'x^2 + y^2 = z^2')
const gitBin = process.env.OOPSMD_SMOKE_EXE ? path.join(path.dirname(process.env.OOPSMD_SMOKE_EXE), 'resources', 'git', 'cmd', 'git.exe') : 'git'
const git = (...args) => execFileSync(gitBin, args, { cwd: library, encoding: 'utf8', windowsHide: true }).trim()
git('init', '-b', 'main'); git('config', 'user.name', 'MarkFlow Mark Test'); git('config', 'user.email', 'test@example.invalid'); git('add', '.'); git('commit', '-m', 'baseline')
const env = { ...process.env, MARKFLOW_USER_DATA: path.join(temporary, 'profile') }
delete env.ELECTRON_RUN_AS_NODE
const checks = [], errors = [], screenshots = []
let app, page
const rich = () => page.locator('.live-pane [contenteditable="true"]:visible')
const source = () => page.locator('.cm-content:visible')
const paragraph = text => rich().locator('p').filter({ hasText: text })
const fontControl = () => page.getByRole('combobox', { name: 'Mark 字体', exact: true })
const sizeControl = () => page.getByRole('combobox', { name: 'Mark 字号', exact: true })
const passed = name => { checks.push(name); console.log(`PASS ${name}`) }
function documentParts(value) {
  return { body: markdownBody(value), marks: readRegistry(value)?.marks ?? [] }
}
async function launch() {
  app = await electron.launch({ ...(process.env.OOPSMD_SMOKE_EXE ? { executablePath: process.env.OOPSMD_SMOKE_EXE, args: [] } : { args: [root] }), env })
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 940))
}
async function close() {
  if (!app) return
  const exiting = app; app = undefined
  const closed = exiting.waitForEvent('close', { timeout: 10000 })
  await exiting.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await closed
}
async function selectParagraph(text) {
  await expect(page.locator('.navigation-shield')).toHaveCount(0)
  await paragraph(text).click()
  await expect(page.locator('.font-control')).toHaveAttribute('title', `当前 Mark：${text}`)
  await expect(sizeControl()).toBeEnabled()
}
async function save() {
  const button = page.locator('.document-bar').getByRole('button', { name: /^保存(?: (?:Ctrl|⌘) S)?$/ })
  await button.click(); await expect(page.locator('.unsaved-dot')).toHaveCount(0); await expect(button).toBeEnabled()
}
async function live() { await page.getByRole('button', { name: '实时预览', exact: true }).click(); await expect(rich()).toBeVisible() }
async function sourceMode() {
  await page.getByRole('button', { name: '源码', exact: true }).click()
  await expect(page.locator('.editor-area')).toHaveClass(/layout-source/)
  await expect(source()).toBeVisible()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
async function computedSize(locator, value) { await expect.poll(() => locator.evaluate(element => getComputedStyle(element).fontSize)).toBe(`${value}px`) }
async function capture(name) { const file = path.join(temporary, `${name}.png`); await page.screenshot({ path: file, animations: 'disabled' }); screenshots.push(file) }
async function jump(label) {
  await showBlockInspector(page)
  await page.locator('.block-tree').getByRole('button', { name: new RegExp(`^跳转 Mark \\d+ ${label}$`) }).click()
  await expect(page.locator('.font-control')).toHaveAttribute('title', `当前 Mark：${label}`)
}

try {
  await launch(); await expect(rich()).toBeVisible()
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, library)
  await openLocalProject(page)
  await page.locator('.tree-scroll').getByRole('button', { name: '样式.md', exact: true }).click()
  await expect(rich()).toContainText('第一段 Alpha 内容。')
  const fonts = await page.evaluate(() => window.oops.fonts())
  const font = fonts.find(item => item.available && item.id === 'alibaba-puhuiti') ?? fonts.find(item => item.available && item.id !== 'system')
  expect(font).toBeTruthy()
  const defaults = await page.evaluate(async () => { const settings = await window.oops.settings(); return { fontFamily: settings.fontFamily, fontSize: settings.fontSize } })
  await selectParagraph('第一段 Alpha 内容。')
  await fontControl().selectOption(font.id); await sizeControl().selectOption('24')
  await computedSize(paragraph('第一段 Alpha 内容。'), 24)
  await computedSize(paragraph('第二段 Bravo 内容。'), defaults.fontSize)
  expect((await paragraph('第一段 Alpha 内容。').evaluate(element => getComputedStyle(element).fontFamily)).toLowerCase()).toContain(font.family.split(',')[0].replaceAll('"', '').trim().toLowerCase())
  expect(await page.evaluate(async () => { const settings = await window.oops.settings(); return { fontFamily: settings.fontFamily, fontSize: settings.fontSize } })).toEqual(defaults)
  await selectParagraph('第二段 Bravo 内容。'); await expect(sizeControl()).toHaveValue(String(defaults.fontSize)); await expect(fontControl()).toHaveValue(defaults.fontFamily)
  await sizeControl().selectOption('20'); await computedSize(paragraph('第二段 Bravo 内容。'), 20)
  await paragraph('第二段 Bravo 内容。').click(); await page.keyboard.press('ArrowRight'); await expect(rich()).toBeFocused(); await expect(sizeControl()).toHaveValue('20')
  await page.keyboard.press('ControlOrMeta+z'); await computedSize(paragraph('第二段 Bravo 内容。'), defaults.fontSize)
  await page.keyboard.press('ControlOrMeta+Shift+Z'); await computedSize(paragraph('第二段 Bravo 内容。'), 20)
  await computedSize(paragraph('第一段 Alpha 内容。'), 24)
  await jump('第一段 Alpha 内容。'); await expect(sizeControl()).toHaveValue('24'); await expect(fontControl()).toHaveValue(font.id)
  await capture('independent-mark-styles')
  passed('each Mark has independent font and size; selection and outline synchronize the toolbar without moving focus; undo/redo preserve adjacent styles')

  await sourceMode(); await expect(source()).toContainText('第一段 Alpha 内容。'); await expect(source()).not.toContainText('<!-- oops:marks ')
  await jump('第二段 Bravo 内容。'); await expect(sizeControl()).toHaveValue('20'); await sizeControl().selectOption('22')
  await page.getByRole('button', { name: '对照', exact: true }).click()
  await computedSize(page.locator('.preview-pane p').filter({ hasText: '第一段 Alpha 内容。' }), 24)
  await computedSize(page.locator('.preview-pane p').filter({ hasText: '第二段 Bravo 内容。' }), 22)
  await source().focus(); await page.keyboard.press('ControlOrMeta+z')
  await computedSize(page.locator('.preview-pane p').filter({ hasText: '第二段 Bravo 内容。' }), 20)
  await live(); await save()
  const saved = documentParts(await readFile(path.join(library, '样式.md'), 'utf8'))
  expect(saved.body).toBe(initial)
  expect(saved.marks.filter(mark => !mark.orphan)).toHaveLength(3)
  expect(saved.marks.filter(mark => !mark.orphan && Object.keys(mark.style).length)).toHaveLength(2)
  expect(new Set(saved.marks.map(mark => mark.id)).size).toBe(saved.marks.length)
  expect(saved.marks.every(mark => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(mark.id))).toBe(true)
  const alphaId = saved.marks.find(mark => mark.raw === '第一段 Alpha 内容。').id
  const bravoId = saved.marks.find(mark => mark.raw === '第二段 Bravo 内容。').id
  expect(saved.marks.find(mark => mark.id === alphaId).style).toEqual({ fontFamily: font.id, fontSize: 24 })
  expect(git('show', 'HEAD:样式.md')).toContain('oops:marks')
  passed('source and comparison share Mark styles and undo; a style-only save preserves exact Markdown body and records the metadata in Git')

  await selectParagraph('第一段 Alpha 内容。'); await sizeControl().selectOption('26'); await expect(page.locator('.unsaved-dot')).toBeVisible()
  await page.getByRole('button', { name: '关闭标签 样式.md', exact: true }).click()
  await page.getByRole('dialog', { name: '当前文档尚未保存' }).getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('tab', { name: '样式.md', exact: true })).toBeVisible()
  await expect.poll(async () => documentParts((await page.evaluate(() => window.oops.read('样式.md'))).draft?.content ?? '').marks.find(mark => mark.id === alphaId)?.style.fontSize).toBe(26)
  expect(documentParts(await readFile(path.join(library, '样式.md'), 'utf8')).marks.find(mark => mark.id === alphaId).style.fontSize).toBe(24)
  await close(); await launch()
  await page.getByRole('dialog', { name: '发现恢复草稿' }).getByRole('button', { name: '恢复草稿', exact: true }).click()
  await expect(rich()).toBeVisible(); await selectParagraph('第一段 Alpha 内容。'); await expect(sizeControl()).toHaveValue('26')
  await computedSize(paragraph('第一段 Alpha 内容。'), 26); await save()
  passed('style-only edits trigger dirty-close protection, survive device draft recovery after restart, and leave the saved snapshot unchanged until save')

  await page.locator('.tree-scroll').getByRole('button', { name: '样式.md', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
  await page.getByRole('dialog', { name: '重命名' }).getByRole('textbox').fill('资料/移动后.md')
  await page.getByRole('dialog', { name: '重命名' }).getByRole('button', { name: '确定', exact: true }).click()
  await expect(page.locator('.document-name')).toHaveText('移动后.md'); await selectParagraph('第一段 Alpha 内容。'); await expect(sizeControl()).toHaveValue('26')
  await sourceMode(); await jump('第一段 Alpha 内容。'); await source().focus(); await page.keyboard.press('End'); await page.keyboard.insertText(' 追加。')
  await live(); await computedSize(paragraph('第一段 Alpha 内容。 追加。'), 26); await save()
  const moved = documentParts(await readFile(path.join(library, '资料/移动后.md'), 'utf8'))
  expect(moved.body).toBe(initial.replace('第一段 Alpha 内容。', '第一段 Alpha 内容。 追加。'))
  expect(moved.marks.find(mark => mark.id === alphaId).style.fontSize).toBe(26)
  passed('renaming and moving retain Mark identity and styles; editing the same Mark in source preserves its style and all other Markdown bytes')

  await sourceMode(); await jump('第二段 Bravo 内容。'); await source().focus()
  await expect.poll(() => page.evaluate(() => { const node = getSelection()?.anchorNode; return (node instanceof Element ? node : node?.parentElement)?.closest('.cm-line')?.textContent })).toBe('第二段 Bravo 内容。')
  await page.keyboard.press('End'); await page.keyboard.press('Backspace')
  await live(); await computedSize(paragraph('第二段 Bravo 内容'), 20); await save()
  const trimmed = documentParts(await readFile(path.join(library, '资料/移动后.md'), 'utf8'))
  expect(trimmed.marks.find(mark => mark.id === bravoId).raw).toBe('第二段 Bravo 内容')
  expect(trimmed.marks.find(mark => mark.id === bravoId).style.fontSize).toBe(20)
  await paragraph('第二段 Bravo 内容').click(); await page.keyboard.press('ControlOrMeta+z'); await expect(paragraph('第二段 Bravo 内容。')).toBeVisible()
  await computedSize(paragraph('第二段 Bravo 内容。'), 20)
  passed('Backspace at the end of a styled source Mark retains its identity and style, and undo restores the original text')

  await selectParagraph('第一段 Alpha 内容。 追加。'); await page.getByRole('button', { name: '恢复 Mark 默认样式', exact: true }).click()
  await computedSize(paragraph('第一段 Alpha 内容。 追加。'), defaults.fontSize); await computedSize(paragraph('第二段 Bravo 内容。'), 20)
  await expect(sizeControl()).toHaveValue(String(defaults.fontSize)); await expect(fontControl()).toHaveValue(defaults.fontFamily)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '默认字体', exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: '默认字体', exact: true }).selectOption(font.id)
  await page.getByRole('slider', { name: '默认字号', exact: true }).focus(); await page.keyboard.press('End')
  await expect(page.getByRole('slider', { name: '默认字号', exact: true })).toHaveValue('28')
  await page.getByRole('button', { name: '关闭面板', exact: true }).click()
  await computedSize(paragraph('第一段 Alpha 内容。 追加。'), 28); await computedSize(paragraph('第二段 Bravo 内容。'), 20)
  await save()
  await page.locator('.tree-scroll').getByRole('button', { name: '公式.tex', exact: true }).click()
  await page.getByRole('combobox', { name: '字号', exact: true }).selectOption('18')
  await expect.poll(() => page.evaluate(async () => (await window.oops.settings()).fontSize)).toBe(18)
  await expect(page.getByRole('button', { name: '恢复 Mark 默认样式', exact: true })).toHaveCount(0)
  passed('restore-default clears only the active Mark overrides; defaults affect inherited Marks while Formula keeps global typography')

  await newDocument(page); await expect(rich()).toBeVisible(); await sizeControl().selectOption('22')
  await computedSize(rich().locator('p').first(), 22)
  await expect(page.locator('.document-name')).toHaveText('未命名.md')
  await expect(page.locator('.document-tab.active .tab-title')).toHaveText('未命名')
  await expect.poll(async () => (await page.evaluate(() => window.oops.listUntitled())).some(draft => documentParts(draft.content).marks.some(mark => mark.style.fontSize === 22))).toBe(true)
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, path.join(library, '空白样式.md'))
  await save(); await expect(page.locator('.document-name')).toHaveText('空白样式.md')
  const empty = documentParts(await readFile(path.join(library, '空白样式.md'), 'utf8'))
  expect(empty.body.trim()).toBe(''); expect(empty.marks.some(mark => mark.style.fontSize === 22)).toBe(true)
  await capture('empty-mark-saved')
  passed('an empty styled Mark remains an unnamed device draft and survives first save with its style')
  expect(errors).toEqual([])
  console.log(JSON.stringify({ ok: true, checks, temporary, screenshots }, null, 2))
} catch (error) {
  if (page && !page.isClosed()) { await capture('failure').catch(() => {}); console.error((await page.locator('body').innerText()).slice(0, 5500)) }
  console.error(JSON.stringify({ ok: false, checks, errors, temporary, error: String(error) }, null, 2)); throw error
} finally { await close() }
