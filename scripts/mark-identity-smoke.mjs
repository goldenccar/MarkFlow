import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { markdownBody, readRegistry } from './mark-test-utils.mjs'

const root = process.cwd()
await mkdir(path.join(root, '.test-data'), { recursive: true })
const temporary = await mkdtemp(path.join(root, '.test-data', 'mark-identity-'))
const library = path.join(temporary, 'identity-project')
await mkdir(library)
const initial = 'Alpha text\n\nBravo text\n\nCharlie text\n'
for (const name of ['alpha.md', 'duplicate.md']) await writeFile(path.join(library, name), initial)
await writeFile(path.join(library, 'split.md'), 'LeftRight\n\nLast')
const gitBin = process.env.OOPSMD_SMOKE_EXE ? path.join(path.dirname(process.env.OOPSMD_SMOKE_EXE), 'resources', 'git', 'cmd', 'git.exe') : 'git'
const git = (...args) => execFileSync(gitBin, args, { cwd: library, encoding: 'utf8', windowsHide: true })
git('init', '-b', 'main'); git('config', 'user.name', 'OopsMD Identity Test'); git('config', 'user.email', 'test@example.invalid'); git('add', '.'); git('commit', '-m', 'baseline')
const env = { ...process.env, OOPSMD_USER_DATA: path.join(temporary, 'profile') }; delete env.ELECTRON_RUN_AS_NODE
const checks = [], errors = []
let app, page
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const passed = name => { checks.push(name); console.log('PASS ' + name) }
const rich = () => page.locator('.live-pane .tiptap:visible')
const outline = () => page.getByLabel('文档 Mark', { exact: true }).first()
const saveButton = () => page.locator('.document-bar').getByRole('button', { name: /^保存(?: Ctrl S)?$/ })
function parts(source) {
  const metadata = readRegistry(source)
  return { body: markdownBody(source), metadata, marks: metadata?.marks.filter(mark => !mark.orphan) ?? [] }
}
async function launch() {
  app = await electron.launch({ ...(process.env.OOPSMD_SMOKE_EXE ? { executablePath: process.env.OOPSMD_SMOKE_EXE, args: [] } : { args: [root] }), env })
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 940))
}
async function close() {
  if (!app) return
  const current = app; app = undefined
  const exited = current.waitForEvent('close', { timeout: 10000 })
  await current.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await exited
}
async function ready() {
  await expect(page.locator('.navigation-shield')).toHaveCount(0)
  await expect(saveButton()).toBeEnabled()
  await expect(outline().locator('button').first()).toBeEnabled()
  await expect(outline().locator('button:disabled')).toHaveCount(0)
}
async function ids() { await ready(); return outline().locator('button').evaluateAll(elements => elements.map(element => element.dataset.markId)) }
async function labels() { await ready(); return outline().locator('button').evaluateAll(elements => elements.map(element => element.getAttribute('title'))) }
async function open(name) {
  await page.locator('.tree-scroll').getByRole('button', { name, exact: true }).click()
  await expect(page.locator('.document-name')).toHaveText(name); await ready()
}
async function jump(label) {
  await ready(); await outline().getByRole('button', { name: new RegExp(`^跳转 Mark \\d+ ${label}$`) }).click()
  await expect(page.locator('.font-control')).toHaveAttribute('title', '当前 Mark：' + label)
}
async function save(name) {
  await ready(); await saveButton().click()
  await expect(page.locator('.unsaved-dot')).toHaveCount(0); await ready()
  const source = await readFile(path.join(library, name), 'utf8'), value = parts(source)
  expect(value.metadata.complete).toBe(true)
  expect(value.marks.map(mark => mark.id)).toEqual(await ids())
  expect(value.marks.every(mark => uuid.test(mark.id))).toBe(true)
  return { ...value, source }
}
async function draft(name) { return parts((await page.evaluate(name => window.oops.read(name), name)).draft?.content ?? '') }
async function undo() { await rich().focus(); await page.keyboard.press('Control+z') }
async function redo() { await rich().focus(); await page.keyboard.press('Control+Shift+Z') }
async function menu(id, action, keyboard = false) {
  await ready()
  const button = outline().locator(`button[data-mark-id="${id}"]`)
  if (keyboard) { await button.focus(); await page.keyboard.press('Shift+F10') } else await button.click({ button: 'right' })
  await page.getByRole('menu', { name: 'Mark 操作', exact: true }).getByRole('menuitem', { name: action, exact: true }).click()
}

try {
  await launch(); await expect(rich()).toBeVisible()
  await expect(page.locator('.unsaved-dot')).toHaveCount(0)
  await page.waitForTimeout(400)
  expect(await page.evaluate(() => window.oops.listUntitled())).toEqual([])
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, library)
  await page.getByRole('button', { name: '打开项目', exact: true }).click(); await open('alpha.md')
  await expect(outline().locator('button')).toHaveCount(3)
  const originalIds = await ids()
  expect(originalIds.every(id => uuid.test(id))).toBe(true); expect(new Set(originalIds).size).toBe(3)
  expect(await rich().locator(':scope > [data-mark-id]').evaluateAll(elements => elements.map(element => element.dataset.markId))).toEqual(originalIds)
  await expect(page.locator('.unsaved-dot')).toHaveCount(0); await expect(page.locator('.statusbar')).toContainText('净修改 0 / 500')
  expect(await readFile(path.join(library, 'alpha.md'), 'utf8')).toBe(initial)
  expect((await page.evaluate(() => window.oops.read('alpha.md'))).draft).toBeNull()
  expect(git('status', '--porcelain')).toBe('')
  passed('blank startup creates no phantom draft; raw Markdown opens with UUIDs in memory while disk, Git, dirty state and net count stay unchanged')

  await open('duplicate.md'); const duplicateIds = await ids()
  expect(duplicateIds.every(id => uuid.test(id) && !originalIds.includes(id))).toBe(true)
  await open('alpha.md'); expect(await ids()).toEqual(originalIds)
  const firstSaved = await save('alpha.md')
  expect(firstSaved.body).toBe(initial); expect(firstSaved.marks.map(mark => mark.id)).toEqual(originalIds)
  expect(git('show', 'HEAD:alpha.md')).toBe(firstSaved.source)
  expect(await readFile(path.join(library, 'duplicate.md'), 'utf8')).toBe(initial)
  passed('identical-body documents have independent identities, cached tabs preserve their IDs, and explicit first save persists the complete registry to file and Git')

  await jump('Alpha text'); await rich().focus(); await page.keyboard.press('End'); await page.keyboard.insertText('!')
  await expect.poll(() => labels()).toEqual(['Alpha text!', 'Bravo text', 'Charlie text'])
  expect(await ids()).toEqual(originalIds)
  await expect.poll(async () => (await draft('alpha.md')).body).toBe(initial.replace('Alpha text', 'Alpha text!'))
  await expect(page.locator('.statusbar')).toContainText('净修改 1 / 500')
  await undo(); await expect.poll(() => labels()).toEqual(['Alpha text', 'Bravo text', 'Charlie text'])
  expect(await ids()).toEqual(originalIds); await expect(page.locator('.unsaved-dot')).toHaveCount(0)
  await expect(page.locator('.statusbar')).toContainText('净修改 0 / 500')
  await redo(); await expect.poll(() => labels()).toEqual(['Alpha text!', 'Bravo text', 'Charlie text'])
  expect(await ids()).toEqual(originalIds); await save('alpha.md')
  passed('ordinary typing preserves every Mark identity; undo returns to the exact clean snapshot and zero net changes, and redo restores the same edited IDs')

  await jump('Alpha text!'); await page.getByRole('combobox', { name: 'Mark 字号', exact: true }).selectOption('24')
  await expect(page.locator('.unsaved-dot')).toBeVisible(); await expect(page.locator('.statusbar')).toContainText('净修改 0 / 500')
  const styled = await save('alpha.md')
  expect(styled.marks[0].style.fontSize).toBe(24); expect(await ids()).toEqual(originalIds)
  await menu(originalIds[1], '上移 Mark', true)
  await expect.poll(() => ids()).toEqual([originalIds[1], originalIds[0], originalIds[2]])
  await expect.poll(() => labels()).toEqual(['Bravo text', 'Alpha text!', 'Charlie text'])
  await expect.poll(async () => (await draft('alpha.md')).marks.find(mark => mark.id === originalIds[0])?.style.fontSize).toBe(24)
  await expect.poll(async () => (await draft('alpha.md')).body).toBe('Bravo text\n\nAlpha text!\n\nCharlie text\n')
  await undo(); await expect.poll(() => ids()).toEqual(originalIds)
  await redo(); await expect.poll(() => ids()).toEqual([originalIds[1], originalIds[0], originalIds[2]])
  await menu(originalIds[1], '下移 Mark'); await expect.poll(() => ids()).toEqual(originalIds)
  passed('style-only edits preserve IDs and count zero; keyboard/context-menu moves retain identity and style and support exact undo/redo')

  await menu(originalIds[0], '复制 Mark')
  await expect(outline().locator('button')).toHaveCount(4)
  const copiedIds = await ids(), copyId = copiedIds[1]
  expect(copiedIds).toEqual([originalIds[0], copyId, originalIds[1], originalIds[2]])
  expect(uuid.test(copyId) && !originalIds.includes(copyId)).toBe(true)
  await expect.poll(async () => (await draft('alpha.md')).marks.find(mark => mark.id === copyId)?.style.fontSize).toBe(24)
  await undo(); await expect.poll(() => ids()).toEqual(originalIds)
  await redo(); await expect.poll(() => ids()).toEqual(copiedIds)
  const copied = await save('alpha.md')
  expect(copied.body).toBe('Alpha text!\n\nAlpha text!\n\nBravo text\n\nCharlie text\n')
  passed('copy creates a fresh UUID with inherited Mark style, leaves the original identity intact, and redo restores the same copied UUID')

  await open('split.md'); const splitIds = await ids()
  await jump('LeftRight'); await rich().focus(); await page.keyboard.press('Home')
  const richOffset = () => rich().evaluate(element => element.editor.state.selection.$head.parentOffset)
  await expect.poll(richOffset).toBe(0)
  for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowRight'); await expect.poll(richOffset).toBe(i + 1) }
  await page.keyboard.press('Enter')
  await expect.poll(() => labels()).toEqual(['Left', 'Right', 'Last'])
  const afterSplit = await ids(), rightId = afterSplit[1]
  expect(afterSplit).toEqual([splitIds[0], rightId, splitIds[1]])
  expect(uuid.test(rightId) && !splitIds.includes(rightId)).toBe(true)
  await jump('Right'); await rich().focus(); await page.keyboard.press('Home'); await expect.poll(richOffset).toBe(0); await page.keyboard.press('Backspace')
  await expect.poll(() => labels()).toEqual(['LeftRight', 'Last']); expect(await ids()).toEqual(splitIds)
  await undo(); await expect.poll(() => ids()).toEqual(afterSplit)
  await redo(); await expect.poll(() => ids()).toEqual(splitIds)
  const merged = await save('split.md')
  expect(merged.body).toBe('LeftRight\n\nLast')
  expect(merged.metadata.retiredIds).toContain(rightId)
  expect(merged.marks.some(mark => mark.id === rightId)).toBe(false)
  passed('splitting keeps the left identity and assigns a fresh right identity; merging retains the left and retires the right, with reversible IDs')

  await page.getByRole('button', { name: '源码', exact: true }).click(); await expect(page.locator('.cm-content:visible')).toBeVisible()
  await jump('LeftRight'); await page.locator('.cm-content:visible').focus(); await page.keyboard.press('End'); await page.keyboard.insertText('?')
  await expect.poll(() => labels()).toEqual(['LeftRight?', 'Last']); expect(await ids()).toEqual(splitIds)
  await page.getByRole('button', { name: '对照', exact: true }).click()
  await expect.poll(() => page.locator('.preview-pane [data-mark-id]').evaluateAll(elements => elements.map(element => element.dataset.markId))).toEqual(splitIds)
  await page.locator('.cm-content:visible').focus(); await page.keyboard.press('Control+z')
  await expect.poll(() => labels()).toEqual(['LeftRight', 'Last']); expect(await ids()).toEqual(splitIds)
  await expect(page.locator('.unsaved-dot')).toHaveCount(0)
  await page.getByRole('button', { name: '实时预览', exact: true }).click()
  await open('alpha.md'); expect(await ids()).toEqual(copiedIds)
  await expect.poll(() => page.evaluate(() => { const session = JSON.parse(localStorage.getItem('oopsmd.tabs.v1')); return session.tabs.find(tab => tab.id === session.active)?.path })).toBe('alpha.md')
  await close(); await launch(); await expect(rich()).toBeVisible(); await expect(page.locator('.document-name')).toHaveText('alpha.md')
  expect(await ids()).toEqual(copiedIds); await expect(page.locator('.unsaved-dot')).toHaveCount(0)
  const restarted = parts(await readFile(path.join(library, 'alpha.md'), 'utf8'))
  expect(restarted.marks.map(mark => mark.id)).toEqual(copiedIds)
  expect(restarted.marks.filter(mark => mark.style.fontSize === 24).map(mark => mark.id)).toEqual([originalIds[0], copyId])
  await page.screenshot({ path: path.join(temporary, 'identity-restarted.png'), animations: 'disabled' })
  passed('source edits and comparison use the same identities; undo returns clean, and restarting restores every saved original/copy ID and style')
  expect(errors).toEqual([])
  console.log(JSON.stringify({ ok: true, checks, temporary }, null, 2))
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: path.join(temporary, 'failure.png') }).catch(() => {}); console.error((await page.locator('body').innerText()).slice(0, 5000)) }
  console.error(JSON.stringify({ ok: false, checks, errors, temporary, error: String(error) }, null, 2)); throw error
} finally { await close() }
