import { _electron as electron, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { openLocalProject } from './ui-test-utils.mjs'

// Real Electron + real local repositories; no user profile or online credentials.
const root = process.cwd()
await mkdir(path.join(root, '.test-data'), { recursive: true })
const temporary = await mkdtemp(path.join(root, '.test-data', 'project-lifecycle-'))
const profile = path.join(temporary, 'profile')
const local = path.join(temporary, '本地项目')
const moved = path.join(temporary, '移动后的项目')
const github = path.join(temporary, '已有 GitHub 副本')
const remote = path.join(temporary, 'remote.git')
const producer = path.join(temporary, 'producer')
const consumer = path.join(temporary, 'consumer')
const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', windowsHide: true }).trim()
await Promise.all([mkdir(local), mkdir(github), mkdir(producer), mkdir(remote)])
for (const folder of [local, producer, github]) {
  await writeFile(path.join(folder, 'alpha.md'), '# Alpha\n\nOriginal alpha.\n')
  await writeFile(path.join(folder, 'beta.md'), '# Beta\n\nOriginal beta.\n')
}
for (const folder of [producer, github]) {
  git(folder, 'init', '-b', 'main'); git(folder, 'config', 'user.name', 'Project Test'); git(folder, 'config', 'user.email', 'test@example.invalid')
  git(folder, 'add', '.'); git(folder, 'commit', '-m', 'initial')
}
git(github, 'remote', 'add', 'origin', 'https://github.com/Example/Fixture.git')
git(remote, 'init', '--bare', '--initial-branch=main')
git(producer, 'remote', 'add', 'origin', remote); git(producer, 'push', '-u', 'origin', 'main')
git(temporary, 'clone', remote, consumer)
git(consumer, 'config', 'user.name', 'Project Test'); git(consumer, 'config', 'user.email', 'test@example.invalid')
const env = { ...process.env, MARKFLOW_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
let app, page
const checks = [], errors = []
const pass = name => { checks.push(name); console.log('PASS ' + name) }
const settings = () => page.evaluate(() => window.oops.settings())
const editor = () => page.locator('.cm-content')
const settle = () => expect(page.locator('.navigation-shield')).toHaveCount(0, { timeout: 45000 })
async function chooser(folder) { await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => folder ? { canceled: false, filePaths: [folder] } : { canceled: true, filePaths: [] } }, folder) }
async function addDialog() { await page.getByRole('button', { name: '添加项目', exact: true }).first().click(); return page.locator('.project-dialog') }
async function open(folder) { await chooser(folder); await openLocalProject(page); await expect(page.locator('.title-path')).toHaveAttribute('title', folder) }
async function file(name) { await page.locator('.tree-scroll').getByRole('button', { name, exact: true }).click(); await settle(); await page.getByRole('button', { name: '源码', exact: true }).click(); await expect(editor()).toHaveAttribute('contenteditable', 'true') }
async function edit(text) { await editor().click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.press('Enter'); await page.keyboard.insertText(text) }
async function menu(folder) { await page.getByRole('button', { name: `项目选项 ${path.basename(folder)}`, exact: true }).click(); return page.getByRole('menu', { name: '项目操作', exact: true }) }
async function showGit() {
  const trigger = page.getByRole('button', { name: 'Git 与同步', exact: true })
  if (await trigger.getAttribute('aria-pressed') !== 'true') await trigger.click()
  await expect(page.getByRole('button', { name: '检查更新', exact: true })).toBeEnabled({ timeout: 15000 })
}
try {
  app = await electron.launch({ args: [root], env })
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message))
  await expect(page.locator('.document-name')).toHaveText('未命名.md')
  // The GitHub identity fixture never goes online; local bare-repository checks are real.
  await app.evaluate(({ ipcMain }, githubRoot) => {
    const check = ipcMain._invokeHandlers.get('git:check'), status = ipcMain._invokeHandlers.get('git:status')
    ipcMain._invokeHandlers.set('git:check', async (event, scope) => scope === githubRoot
      ? { ...await status(event, scope), remoteState: 'unavailable', remoteError: 'Offline test fixture', checkedAt: null }
      : check(event, scope))
  }, github)
  let dialog = await addDialog()
  await expect(dialog.getByRole('button', { name: /^新建项目/ })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /^打开本地项目/ })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /^从链接获取/ })).toBeVisible()
  await dialog.getByRole('button', { name: /^新建项目/ }).click()
  await dialog.getByLabel('项目名称', { exact: true }).fill('新建 工作区')
  await chooser(temporary); await dialog.getByRole('button', { name: '选择位置并创建' }).click()
  await expect(dialog).toHaveCount(0); await settle()
  const created = path.join(temporary, '新建 工作区')
  expect(await stat(created).then(s => s.isDirectory())).toBe(true)
  expect(await stat(path.join(created, '.git')).then(() => true, () => false)).toBe(false)
  await open(created); expect((await settings()).projects.filter(p => p.root === created)).toHaveLength(1)
  dialog = await addDialog(); await dialog.getByRole('button', { name: /^新建项目/ }).click()
  await dialog.getByLabel('项目名称', { exact: true }).fill('新建 工作区'); await chooser(temporary)
  await dialog.getByRole('button', { name: '选择位置并创建' }).click()
  await expect(dialog.getByRole('alert')).toContainText(/已存在/)
  await dialog.getByRole('button', { name: '关闭项目窗口' }).click()
  pass('three entries create an exclusive plain folder and reuse an existing registration')

  await open(github)
  dialog = await addDialog(); await dialog.getByRole('button', { name: /^从链接获取/ }).click()
  await dialog.getByLabel('项目链接').fill('git@github.com:example/fixture.git'); await dialog.getByRole('button', { name: '识别链接' }).click()
  await expect(dialog.locator('.project-match')).toHaveCount(1)
  await expect(dialog.locator('.project-match')).toContainText(github)
  await expect(dialog.locator('.project-match')).toContainText('main')
  await chooser(null); await dialog.getByRole('button', { name: '获取新副本…' }).click()
  await expect(dialog.getByRole('button', { name: '打开此副本' })).toBeEnabled()
  expect((await settings()).projects.filter(p => p.root === github)).toHaveLength(1)
  await dialog.getByRole('button', { name: '打开此副本' }).click(); await expect(dialog).toHaveCount(0)
  dialog = await addDialog(); await dialog.getByRole('button', { name: /^从链接获取/ }).click()
  await dialog.getByLabel('项目链接').fill('https://www.jianguoyun.com/p/example')
  await expect(dialog).toContainText('分享链接不能直接作为 Git 仓库')
  await expect(dialog.getByRole('button', { name: '选择已同步的本地文件夹' })).toBeVisible()
  await dialog.getByRole('button', { name: '关闭项目窗口' }).click()
  pass('GitHub URL identity reuses a real registered origin and cloud sharing is not advertised as writable sync')

  await open(local); await file('alpha.md'); await edit('MOVE_DRAFT')
  await expect.poll(() => page.evaluate(async () => (await window.oops.read('alpha.md')).draft?.content ?? '')).toContain('MOVE_DRAFT')
  await page.evaluate(() => window.oops.archive('beta.md'))
  await rename(local, moved)
  await chooser(moved); await (await menu(local)).getByRole('menuitem', { name: '重新定位项目…', exact: true }).click()
  await settle(); await expect(page.locator('.title-path')).toHaveAttribute('title', moved)
  await expect(editor()).toContainText('MOVE_DRAFT')
  expect((await settings()).projects.some(p => p.root === local)).toBe(false)
  expect((await page.evaluate(() => window.oops.read('alpha.md'))).draft.content).toContain('MOVE_DRAFT')
  expect(await page.evaluate(() => window.oops.listArchive())).toEqual([expect.objectContaining({ path: 'beta.md' })])
  pass('relocation preserves an active unsaved document, recovery data, archive index and registration')

  await (await menu(moved)).getByRole('menuitem', { name: '由外部云盘管理', exact: true }).click(); await settle()
  expect((await settings()).projects.find(p => p.root === moved).syncMode).toBe('external')
  expect(await page.evaluate(async () => { try { await window.oops.checkRemote(); return 'unexpected' } catch (error) { return String(error) } })).toContain('云盘客户端')
  const original = await readFile(path.join(moved, 'alpha.md'), 'utf8')
  await (await menu(moved)).getByRole('menuitem', { name: '移除项目登记…', exact: true }).click()
  await page.getByRole('dialog', { name: '移除项目登记', exact: true }).getByRole('button', { name: '移除登记', exact: true }).click(); await settle()
  expect((await settings()).projects.some(p => p.root === moved)).toBe(false)
  expect(await readFile(path.join(moved, 'alpha.md'), 'utf8')).toBe(original)
  expect((await page.evaluate(() => window.oops.listUntitled())).some(d => d.content.includes('MOVE_DRAFT'))).toBe(true)
  pass('external sync is enforced at IPC and removal preserves files plus dirty content as a scratch')

  await open(consumer); await file('alpha.md'); await edit('INACTIVE_DIRTY')
  await file('beta.md')
  await writeFile(path.join(producer, 'beta.md'), '# Beta\n\nREMOTE_NEW_VERSION\n')
  git(producer, 'add', 'beta.md'); git(producer, 'commit', '-m', 'remote change'); git(producer, 'push', 'origin', 'main')
  await showGit(); await page.getByRole('button', { name: '检查更新', exact: true }).click()
  await expect(page.getByRole('button', { name: '更新到本地', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '更新到本地', exact: true }).click()
  await expect(page.locator('.notice')).toContainText('alpha.md')
  expect(await readFile(path.join(consumer, 'beta.md'), 'utf8')).not.toContain('REMOTE_NEW_VERSION')
  pass('updating refuses an unsaved inactive tab, not just the selected document')
  await file('alpha.md'); await editor().click(); await page.keyboard.press('ControlOrMeta+s')
  await expect(page.locator('.unsaved-dot')).toHaveCount(0); await file('beta.md'); await showGit()
  await page.getByRole('button', { name: '检查更新', exact: true }).click()
  await expect(page.getByRole('button', { name: '更新到本地', exact: true })).toBeEnabled()
  const remoteBeforeUpdate = git(remote, 'rev-parse', 'refs/heads/main')
  await app.evaluate(({ ipcMain }) => {
    const update = ipcMain._invokeHandlers.get('git:update')
    globalThis.__updateWaiting = false
    ipcMain._invokeHandlers.set('git:update', async (...args) => {
      globalThis.__updateWaiting = true
      await new Promise(resolve => { globalThis.__releaseUpdate = resolve })
      ipcMain._invokeHandlers.set('git:update', update)
      return update(...args)
    })
  })
  await page.getByRole('button', { name: '更新到本地', exact: true }).click()
  await expect.poll(() => app.evaluate(() => globalThis.__updateWaiting)).toBe(true)
  await expect(editor()).toHaveAttribute('contenteditable', 'false')
  await page.keyboard.insertText('MUST_NOT_ENTER')
  await app.evaluate(() => globalThis.__releaseUpdate())
  await settle(); await expect(editor()).toContainText('REMOTE_NEW_VERSION'); await expect(editor()).not.toContainText('MUST_NOT_ENTER')
  expect(git(remote, 'rev-parse', 'refs/heads/main')).toBe(remoteBeforeUpdate)
  await file('alpha.md'); await expect(editor()).toContainText('INACTIVE_DIRTY')
  await showGit(); await expect(page.getByRole('button', { name: '上传更改', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '上传更改', exact: true }).click(); await settle()
  expect(git(remote, 'rev-parse', 'refs/heads/main')).toBe(git(consumer, 'rev-parse', 'HEAD'))
  pass('update freezes editing, merges without uploading, reloads cached tabs, and explicit upload publishes recorded commits')

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 620))
  dialog = await addDialog()
  await expect(dialog).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: path.join(temporary, 'project-dialog-920.png'), animations: 'disabled' })
  await dialog.getByRole('button', { name: '关闭项目窗口' }).click()
  await page.screenshot({ path: path.join(temporary, 'git-panel-920.png'), animations: 'disabled' })
  expect(errors).toEqual([])
  console.log(JSON.stringify({ ok: true, checks, temporary, errors }, null, 2))
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(temporary, 'failure.png') }).catch(() => {})
  console.error(JSON.stringify({ ok: false, checks, temporary, errors, error: String(error) }, null, 2))
  throw error
} finally {
  if (app) { const closed = app.waitForEvent('close', { timeout: 10000 }); await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await closed.catch(() => {}) }
}
