import { openLocalProject } from './ui-test-utils.mjs'
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { markdownBody, readRegistry } from './mark-test-utils.mjs'

// Delay the status response after save and draft persistence, exactly where closing
// used to allow late input that would miss the final durable draft.
const root = process.cwd()
await mkdir(path.join(root, '.test-data'), { recursive: true })
const temporary = await mkdtemp(path.join(root, '.test-data', 'close-save-race-'))
const project = path.join(temporary, 'project')
const profile = path.join(temporary, 'profile')
await mkdir(project)
const initial = '# Closing safely\n'
const content = initial + '\nCLOSE_CAPTURED'
const target = path.join(project, 'doc.md')
await writeFile(target, initial)
const gitBin = process.env.OOPSMD_SMOKE_EXE ? path.join(path.dirname(process.env.OOPSMD_SMOKE_EXE), 'resources', 'git', 'cmd', 'git.exe') : 'git'
const git = (...args) => execFileSync(gitBin, args, { cwd: project, windowsHide: true, encoding: 'utf8' }).trim()
git('init', '-b', 'main'); git('config', 'user.name', 'Close Race Test'); git('config', 'user.email', 'test@example.invalid'); git('add', '.'); git('commit', '-m', 'baseline')
const env = { ...process.env, MARKFLOW_USER_DATA: profile }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ ...(process.env.OOPSMD_SMOKE_EXE ? { executablePath: process.env.OOPSMD_SMOKE_EXE, args: [] } : { args: [root] }), env })
let page
try {
  page = await app.firstWindow()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await expect(page.locator('.document-name')).toHaveText('未命名.md')
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, project)
  await openLocalProject(page)
  await page.locator('.tree-scroll').getByRole('button', { name: 'doc.md', exact: true }).click()
  await page.getByRole('button', { name: '源码', exact: true }).click()
  await expect(page.locator('.editor-area')).toHaveClass(/layout-source/)
  const source = page.locator('.cm-content')
  await expect(source).toHaveAttribute('contenteditable', 'true')
  expect(await source.evaluate(element => element.cmTile.root.view.state.doc.toString())).toBe(initial)
  await source.click(); await page.keyboard.press('ControlOrMeta+End')
  expect(await source.evaluate(element => element.cmTile.root.view.state.selection.main.head)).toBe(initial.length)
  await page.keyboard.press('Enter'); await page.keyboard.insertText('CLOSE_CAPTURED')
  expect(await source.evaluate(element => element.cmTile.root.view.state.doc.toString())).toBe(content)
  await expect(page.locator('.unsaved-dot')).toBeVisible()
  await expect.poll(async () => markdownBody((await page.evaluate(() => window.oops.read('doc.md'))).draft?.content)).toBe(content)
  const captured = (await page.evaluate(() => window.oops.read('doc.md'))).draft.content
  expect(readRegistry(captured)?.complete).toBe(true)
  await app.evaluate(({ ipcMain }) => {
    const save = ipcMain._invokeHandlers.get('files:save')
    ipcMain._invokeHandlers.set('files:save', async (...args) => { globalThis.__closeSavedSnapshot = args.at(-1).content; return save(...args) })
    const original = ipcMain._invokeHandlers.get('git:status')
    if (!original) throw new Error('Git status handler missing')
    globalThis.__closeStatusReady = false
    ipcMain._invokeHandlers.set('git:status', async (...args) => {
      const result = await original(...args)
      ipcMain._invokeHandlers.set('git:status', original)
      globalThis.__closeStatusReady = true
      await new Promise(resolve => { globalThis.__releaseCloseStatus = resolve })
      return result
    })
  })
  await page.getByRole('button', { name: '关闭标签 doc.md', exact: true }).click()
  await page.locator('.modal').getByRole('button', { name: '保存并记录', exact: true }).click()
  await expect.poll(() => app.evaluate(() => globalThis.__closeStatusReady)).toBe(true)
  expect(await app.evaluate(() => globalThis.__closeSavedSnapshot)).toBe(captured)
  expect(await readFile(target, 'utf8')).toBe(captured)
  expect(git('show', 'HEAD:doc.md')).toBe(captured)
  await expect(source).toHaveAttribute('contenteditable', 'false')
  await source.focus()
  await page.keyboard.insertText('MUST_NOT_ENTER_DURING_CLOSE')
  await expect(source).not.toContainText('MUST_NOT_ENTER_DURING_CLOSE')
  await app.evaluate(() => globalThis.__releaseCloseStatus())
  await expect(page.getByRole('tab', { name: 'doc.md', exact: true })).toHaveCount(0)
  await expect(page.locator('.document-name')).toHaveText('未命名.md')
  await page.keyboard.press('ControlOrMeta+Shift+T')
  await expect(page.getByRole('tab', { name: 'doc.md', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: '源码', exact: true }).click()
  await expect(source).toContainText('CLOSE_CAPTURED')
  await expect(source).not.toContainText('MUST_NOT_ENTER_DURING_CLOSE')
  await expect(source).toHaveAttribute('contenteditable', 'true')
  const reopened = await page.evaluate(() => window.oops.read('doc.md'))
  expect(reopened.file.content).toBe(captured)
  expect(reopened.draft).toBeNull()
  expect(git('rev-list', '--count', 'HEAD')).toBe('2')
  expect(errors).toEqual([])
  console.log('PASS closing a dirty tab locks input through the post-save Git-status wait, durably saves the snapshot and safely reopens the document')
  console.log(JSON.stringify({ ok: true, checks: 1, temporary, profile, target }, null, 2))
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(temporary, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(JSON.stringify({ ok: false, temporary, error: String(error) }, null, 2))
  throw error
} finally {
  const closed = app.waitForEvent('close', { timeout: 10000 })
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await closed
}
