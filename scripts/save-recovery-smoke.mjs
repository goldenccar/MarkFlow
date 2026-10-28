import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import path from 'node:path'
import { markdownBody, readRegistry } from './mark-test-utils.mjs'

// One fault-injection regression: disk succeeds, then first-save archive lookup fails.
const root = process.cwd()
await mkdir(path.join(root, '.test-data'), { recursive: true })
const temporary = await mkdtemp(path.join(root, '.test-data', 'save-recovery-'))
const project = path.join(temporary, '项目')
const profile = path.join(temporary, 'profile')
await mkdir(project)
const target = path.join(project, 'saved.md')
const env = { ...process.env, MARKFLOW_USER_DATA: profile }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ ...(process.env.OOPSMD_SMOKE_EXE ? { executablePath: process.env.OOPSMD_SMOKE_EXE, args: [] } : { args: [root] }), env })
let page
try {
  page = await app.firstWindow()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await expect(page.locator('.document-name')).toHaveText('未命名.md')
  await page.getByRole('button', { name: '源码', exact: true }).click()
  await expect(page.locator('.editor-area')).toHaveClass(/layout-source/)
  const source = page.locator('.cm-content')
  const content = '# Saved before metadata failure\n\n完整正文。'
  await source.click()
  await page.keyboard.insertText(content)
  await expect.poll(async () => markdownBody((await page.evaluate(() => window.oops.listUntitled()))[0]?.content)).toBe(content)
  const draft = (await page.evaluate(() => window.oops.listUntitled()))[0]
  expect(readRegistry(draft.content)?.complete).toBe(true)

  await app.evaluate(({ ipcMain, dialog }, filename) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename })
    const save = ipcMain._invokeHandlers.get('untitled:save')
    ipcMain._invokeHandlers.set('untitled:save', async (...args) => { globalThis.__savedSnapshot = args.at(-1).content; return save(...args) })
    const original = ipcMain._invokeHandlers.get('files:archive-list')
    if (!original) throw new Error('Archive handler missing')
    globalThis.__archiveLookupFailures = 0
    ipcMain._invokeHandlers.set('files:archive-list', async () => {
      ipcMain._invokeHandlers.set('files:archive-list', original)
      globalThis.__archiveLookupFailures++
      throw new Error('TEST_ARCHIVE_LOOKUP_FAILED_AFTER_DISK_SAVE')
    })
  }, target)
  await page.keyboard.press('ControlOrMeta+s')
  await expect(page.locator('.document-name')).toHaveText('saved.md')
  await expect(page.locator('.title-path')).toHaveAttribute('title', project)
  await expect(page.locator('.document-state')).toHaveCount(0)
  await expect(page.locator('.statusbar')).toContainText('正文已保存 · 后续处理未完成')
  await expect(page.locator('.statusbar')).not.toContainText('保存失败')
  await expect(page.getByRole('alert')).toContainText('正文已写入文件')
  await expect(page.getByRole('alert')).toContainText('TEST_ARCHIVE_LOOKUP_FAILED_AFTER_DISK_SAVE')
  await expect(page.getByRole('button', { name: /^保存(?: (?:Ctrl|⌘) S)?$/ })).toBeEnabled()
  expect(await app.evaluate(() => globalThis.__archiveLookupFailures)).toBe(1)
  const captured = await app.evaluate(() => globalThis.__savedSnapshot)
  expect(captured).toBe(draft.content)
  expect(await readFile(target, 'utf8')).toBe(captured)
  expect((await page.evaluate(() => window.oops.listUntitled())).find(item => item.id === draft.id)?.content).toBe(draft.content)
  expect(JSON.parse(await readFile(path.join(profile, 'untitled', `${draft.id}.json`), 'utf8')).content).toBe(draft.content)
  const screenshot = path.join(temporary, 'saved-with-metadata-warning.png')
  await page.screenshot({ path: screenshot, fullPage: true })

  await expect(source).toHaveAttribute('contenteditable', 'true')
  await source.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText('\nLATER_EDIT_RETAINED')
  await expect(source).toContainText('LATER_EDIT_RETAINED')
  await expect(page.locator('.unsaved-dot')).toBeVisible()
  await expect.poll(async () => markdownBody((await page.evaluate(() => window.oops.read('saved.md'))).draft?.content)).toBe(content + '\nLATER_EDIT_RETAINED')
  const later = (await page.evaluate(() => window.oops.read('saved.md'))).draft.content
  expect(readRegistry(later)?.documentId).toBe(readRegistry(draft.content).documentId)
  expect(await readFile(target, 'utf8')).toBe(captured)
  expect((await page.evaluate(() => window.oops.listUntitled())).some(item => item.id === draft.id)).toBe(true)
  expect(errors).toEqual([])
  console.log('PASS first-save metadata failure preserves the written file, new document binding, recovery scratch and later editing; status accurately says the body is saved')
  console.log(JSON.stringify({ ok: true, checks: 1, temporary, profile, target, screenshot }, null, 2))
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(temporary, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(JSON.stringify({ ok: false, temporary, error: String(error) }, null, 2))
  throw error
} finally {
  const closed = app.waitForEvent('close', { timeout: 10000 })
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await closed
}
