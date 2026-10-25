import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { markdownBody, replaceMarkdownBody } from './mark-test-utils.mjs'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
await mkdir(path.join(root, '.test-data'), { recursive: true })
const temporary = await mkdtemp(path.join(root, '.test-data', 'safety-'))
const plainLibrary = path.join(temporary, 'plain')
const gitLibrary = path.join(temporary, 'versioned')
const nextLibrary = path.join(temporary, 'next')
const profile = path.join(temporary, 'profile')
for (const folder of [plainLibrary, gitLibrary, nextLibrary]) await mkdir(folder)
const initial = '# Safety checks\n\nInitial content.\n'
for (const folder of [plainLibrary, gitLibrary, nextLibrary]) await writeFile(path.join(folder, 'doc.md'), initial)
const gitBin = process.env.OOPSMD_SMOKE_EXE ? path.join(path.dirname(process.env.OOPSMD_SMOKE_EXE), 'resources', 'git', 'cmd', 'git.exe') : 'git'
const git = (...args) => execFileSync(gitBin, args, { cwd: gitLibrary, encoding: 'utf8', windowsHide: true }).trim()
const commits = () => Number(git('rev-list', '--count', 'HEAD'))
git('init', '-b', 'main'); git('config', 'user.name', 'OopsMD Safety Test'); git('config', 'user.email', 'test@example.invalid'); git('add', '.'); git('commit', '-m', 'baseline')
const env = { ...process.env, OOPSMD_USER_DATA: profile }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ ...(process.env.OOPSMD_SMOKE_EXE ? { executablePath: process.env.OOPSMD_SMOKE_EXE, args: [] } : { args: [root] }), env })
const checks = []
const failures = []
const workers = []
const sleep = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds))
const passed = (name) => { checks.push(name); console.log(`PASS ${name}`) }
async function drafts(folder) {
  const result = []
  for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
    const target = path.join(folder, entry.name)
    if (entry.isDirectory()) result.push(...await drafts(target))
    else if (entry.name.endsWith('.json')) {
      try { const value = JSON.parse(await readFile(target, 'utf8')); if (typeof value.content === 'string' && value.path) result.push(value) } catch {}
    }
  }
  return result
}

try {
  const page = await app.firstWindow()
  page.on('pageerror', error => failures.push(error.message))
  page.on('worker', worker => workers.push(worker.url()))
  await page.waitForLoadState('domcontentloaded')
  expect(page.url()).toMatch(/^file:/)
  const source = page.locator('.cm-content')
  async function openLibrary(folder) {
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, folder)
    await page.locator('.sidebar').getByRole('button', { name: '打开项目', exact: true }).click()
    await page.locator('.tree-scroll').getByRole('button', { name: 'doc.md', exact: true }).click()
    await page.getByRole('button', { name: '源码', exact: true }).click()
    await expect(page.locator('.editor-area')).toHaveClass(/layout-source/)
    await expect(source).toContainText('Initial content.')
    await expect(source).toHaveAttribute('contenteditable', 'true')
  }
  async function append(value) {
    await source.click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(value)
  }
  async function save() {
    await expect(page.getByRole('button', { name: /保存.*Ctrl S/ })).toBeEnabled()
    await source.click(); await page.keyboard.press('Control+s')
    await expect(page.locator('.unsaved-dot')).toHaveCount(0)
    await expect(page.locator('.statusbar')).toContainText(/已保存|已记录/)
    await expect(page.getByRole('button', { name: /保存.*Ctrl S/ })).toBeEnabled()
  }

  await openLibrary(plainLibrary)
  await append('PLAIN_SAVE')
  await save()
  await expect(page.locator('.statusbar')).toContainText('未启用版本记录')
  expect(markdownBody(await readFile(path.join(plainLibrary, 'doc.md'), 'utf8'))).toBe(initial + 'PLAIN_SAVE')
  passed('plain file Ctrl+S succeeds without a Git repository')

  await openLibrary(gitLibrary)
  await append('MODE_TEST')
  await page.getByRole('button', { name: 'Geek', exact: true }).click()
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  await page.getByRole('button', { name: '实时预览', exact: true }).click()
  await page.getByRole('button', { name: '源码', exact: true }).click()
  await source.click(); await page.keyboard.press('Control+z')
  await expect(source).not.toContainText('MODE_TEST')
  await page.keyboard.press('Control+Shift+Z')
  await expect(source).toContainText('MODE_TEST')
  await page.keyboard.press('Control+z')
  await expect(source).not.toContainText('MODE_TEST')
  await page.keyboard.press('Control+y')
  await expect(source).toContainText('MODE_TEST')
  await page.keyboard.press('Control+z')
  await expect(source).not.toContainText('MODE_TEST')
  passed('content mode/layout switches retain undo and both redo shortcuts')

  // Delay only the response: the real write/commit completes, then editing continues.
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('files:save')
    globalThis.__safetySaveReady = false
    ipcMain._invokeHandlers.set('files:save', async (...args) => {
      globalThis.__safetySnapshot = args.at(-1).content
      const result = await original(...args)
      globalThis.__safetySaveReady = true
      await new Promise(resolve => { globalThis.__safetyReleaseSave = resolve })
      ipcMain._invokeHandlers.set('files:save', original)
      return result
    })
  })
  await append('SNAPSHOT_A')
  await page.keyboard.press('Control+s')
  await expect.poll(() => app.evaluate(() => globalThis.__safetySaveReady)).toBe(true)
  await append('\nLATER_B')
  const snapshot = await app.evaluate(() => globalThis.__safetySnapshot)
  expect(markdownBody(snapshot)).toBe(initial + 'SNAPSHOT_A')
  expect(await readFile(path.join(gitLibrary, 'doc.md'), 'utf8')).toBe(snapshot)
  expect(git('show', 'HEAD:doc.md')).toBe(snapshot.trim())
  await app.evaluate(() => globalThis.__safetyReleaseSave())
  await expect(source).toContainText('LATER_B')
  await expect(page.locator('.unsaved-dot')).toBeVisible()
  await expect.poll(async () => (await drafts(profile)).some(draft => markdownBody(draft.content) === initial + 'SNAPSHOT_A\nLATER_B')).toBe(true)
  expect(commits()).toBe(2)
  passed('typing during save retains later buffer/draft while disk and HEAD contain captured snapshot')
  await save()
  await expect.poll(commits).toBe(3)
  await expect(page.locator('.statusbar')).toContainText('净修改 0')

  await append('汉'.repeat(499))
  await expect(page.locator('.statusbar')).toContainText('净修改 499 / 500')
  await sleep(1200)
  expect(commits()).toBe(3)
  await append('汉')
  await expect.poll(commits, { timeout: 15000 }).toBe(4)
  await expect(page.locator('.statusbar')).toContainText('净修改 0')
  passed('499 graphemes do not commit; the 500th triggers one exact worker-counted commit')

  await append('字'.repeat(1200))
  await expect.poll(commits, { timeout: 15000 }).toBe(5)
  await expect(page.locator('.statusbar')).toContainText('净修改 0')
  await sleep(900)
  expect(commits()).toBe(5)
  passed('1200-character paste produces one complete snapshot')

  await source.click(); await page.keyboard.press('Control+End')
  await source.dispatchEvent('compositionstart', { data: '' })
  await page.keyboard.insertText('中'.repeat(500))
  await expect(page.locator('.statusbar')).toContainText('净修改 500 / 500')
  await sleep(1200)
  expect(commits()).toBe(5)
  await source.dispatchEvent('compositionend', { data: '中'.repeat(500) })
  await expect.poll(commits, { timeout: 15000 }).toBe(6)
  await expect(page.locator('.statusbar')).toContainText('净修改 0')
  passed('synthetic IME composition prevents auto-commit until confirmation')
  expect(workers.some(url => url.startsWith('file:'))).toBe(true)
  passed('exact counter Worker loads in production file:// renderer')

  const beforeInvalid = await readFile(path.join(gitLibrary, 'doc.md'), 'utf8')
  const rejectedWrite = await page.evaluate(async () => {
    try { await window.oops.save({ path: 'doc.md', content: 'MUST_NOT_WRITE', revision: 'invalid-revision' }); return false }
    catch { return true }
  })
  expect(rejectedWrite).toBe(true)
  expect(await readFile(path.join(gitLibrary, 'doc.md'), 'utf8')).toBe(beforeInvalid)
  expect(commits()).toBe(6)
  passed('failed disk revision check stops before Git, preserving disk and HEAD')

  await writeFile(path.join(gitLibrary, 'doc.md'), replaceMarkdownBody(beforeInvalid, markdownBody(beforeInvalid) + '\nSTAGED_EXTERNAL'))
  git('add', 'doc.md')
  const stagedBytes = git('show', ':doc.md')
  await expect(source).toContainText('STAGED_EXTERNAL')
  await append('\nSAVE_WITH_STAGING')
  await save()
  await expect(page.locator('.statusbar')).toContainText('版本记录失败')
  expect(commits()).toBe(6)
  expect(git('show', ':doc.md')).toBe(stagedBytes)
  expect(await readFile(path.join(gitLibrary, 'doc.md'), 'utf8')).toContain('SAVE_WITH_STAGING')
  await append('停'.repeat(500))
  await sleep(1800)
  expect(commits()).toBe(6)
  expect(await readFile(path.join(gitLibrary, 'doc.md'), 'utf8')).not.toContain('停'.repeat(500))
  git('reset', 'HEAD', '--', 'doc.md')
  await save()
  await expect.poll(commits, { timeout: 15000 }).toBe(7)
  await expect(page.locator('.statusbar')).toContainText('净修改 0')
  passed('commit failure keeps successful save and existing staging, pauses auto retry, manual retry resumes')

  const current = await page.evaluate(() => window.oops.read('doc.md'))
  await app.evaluate(({ dialog }) => {
    globalThis.__safetyChooserReady = false
    dialog.showOpenDialog = () => {
      globalThis.__safetyChooserReady = true
      return new Promise(resolve => { globalThis.__safetyChooseResolve = resolve })
    }
  })
  await page.evaluate(() => { window.__safetyChoice = window.oops.chooseLibrary() })
  await expect.poll(() => app.evaluate(() => globalThis.__safetyChooserReady)).toBe(true)
  await page.evaluate((file) => {
    window.__safetyStale = Promise.allSettled([
      window.oops.draft({ path: 'doc.md', content: 'STALE_DRAFT', revision: file.revision, updatedAt: new Date().toISOString() }),
      window.oops.save({ path: 'doc.md', content: 'STALE_SAVE', revision: file.revision }),
    ])
  }, current.file)
  await app.evaluate((_electron, folder) => globalThis.__safetyChooseResolve({ canceled: false, filePaths: [folder] }), nextLibrary)
  const stale = await page.evaluate(async () => {
    await window.__safetyChoice
    return (await window.__safetyStale).map(item => ({ status: item.status, message: item.status === 'rejected' ? String(item.reason) : '' }))
  })
  expect(stale.map(item => item.status)).toEqual(['rejected', 'rejected'])
  for (const item of stale) expect(item.message).toContain('文档库已切换')
  expect(await readFile(path.join(nextLibrary, 'doc.md'), 'utf8')).toBe(initial)
  const nextRead = await page.evaluate(() => window.oops.read('doc.md'))
  expect(nextRead.draft).toBeNull()
  passed('queued stale draft/save requests reject after library chooser changes scope')

  expect(failures).toEqual([])
  console.log(JSON.stringify({ ok: true, checks, temporary, pageErrors: failures, executable: process.env.OOPSMD_SMOKE_EXE || 'Electron with production build' }, null, 2))
} catch (error) {
  const pages = app.windows()
  if (pages[0]) {
    await pages[0].screenshot({ path: path.join(temporary, 'failure.png') }).catch(() => {})
    console.error((await pages[0].locator('body').innerText()).slice(0, 4500))
  }
  console.error('Safety fixture:', temporary, 'Page errors:', failures)
  throw error
} finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
