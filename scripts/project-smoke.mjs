import { newDocument } from './ui-test-utils.mjs'
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { markdownBody, readRegistry, replaceMarkdownBody } from './mark-test-utils.mjs'

// Run after npm run build. OOPSMD_SMOKE_EXE also supports the packaged Windows app.
// Every file, Git repository and Electron profile belongs to this unique fixture.
const root = process.cwd()
await mkdir(path.join(root, '.test-data'), { recursive: true })
const temporary = await mkdtemp(path.join(root, '.test-data', 'projects-'))
const plainProject = path.join(temporary, '中文 普通项目')
const gitProject = path.join(temporary, '版本 项目')
const profile = path.join(temporary, 'profile')
await Promise.all([mkdir(plainProject), mkdir(gitProject)])
const occupied = path.join(plainProject, 'occupied.md')
await writeFile(occupied, 'EXISTING_FILE_MUST_SURVIVE')
await mkdir(path.join(plainProject, 'closed-folder'))
await writeFile(path.join(plainProject, 'closed-folder', 'closed.md'), '# CLOSED_BASELINE\n')
await writeFile(path.join(plainProject, 'rename-source.md'), '# ORIGINAL_B\n')
await writeFile(path.join(gitProject, 'doc.md'), '# Versioned document\n')
await writeFile(path.join(gitProject, 'other.md'), 'OTHER_BASELINE\n')
const gitBin = process.env.OOPSMD_SMOKE_EXE
  ? path.join(path.dirname(process.env.OOPSMD_SMOKE_EXE), 'resources', 'git', 'cmd', 'git.exe') : 'git'
const git = (...args) => execFileSync(gitBin, args, { cwd: gitProject, encoding: 'utf8', windowsHide: true }).trim()
git('init', '-b', 'main')
git('config', 'user.name', 'MarkFlow Project Test')
git('config', 'user.email', 'test@example.invalid')
git('add', '.')
git('commit', '-m', 'baseline')
const commits = () => Number(git('rev-list', '--count', 'HEAD'))
const env = { ...process.env, MARKFLOW_USER_DATA: profile }
delete env.ELECTRON_RUN_AS_NODE
const checks = []
const failures = []
const passed = (name) => { checks.push(name); console.log(`PASS ${name}`) }
let app
let page
const source = () => page.locator('.cm-content')
const saveButton = () => page.getByRole('button', { name: /^保存(?: (?:Ctrl|⌘) S)?$/ })
const projectButton = (folder) => page.locator('.sidebar').getByRole('button', { name: `打开项目 ${path.basename(folder)}`, exact: true })
const savedSettings = () => page.evaluate(() => window.oops.settings())
const scratch = () => page.evaluate(() => window.oops.listUntitled())

async function launch() {
  app = await electron.launch({
    ...(process.env.OOPSMD_SMOKE_EXE ? { executablePath: process.env.OOPSMD_SMOKE_EXE, args: [] } : { args: [root] }), env,
  })
  page = await app.firstWindow()
  page.on('pageerror', error => failures.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  expect(page.url()).toMatch(/^file:/)
  await app.evaluate(({ ipcMain }) => {
    for (const channel of ['untitled:save', 'files:save']) {
      const original = ipcMain._invokeHandlers.get(channel)
      ipcMain._invokeHandlers.set(channel, async (...args) => { globalThis.__projectSavedSnapshot = args.at(-1).content; return original(...args) })
    }
  })
}
async function exit() {
  if (!app) return
  const exiting = app
  app = undefined
  const closed = exiting.waitForEvent('close', { timeout: 10000 })
  await exiting.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await closed
}
async function restart(withoutTabs = false) {
  if (withoutTabs) {
    // Exercise the migrated-project startup choice when no tab session was stored.
    await page.waitForTimeout(200)
    await page.evaluate(() => localStorage.removeItem('oopsmd.tabs.v1'))
  }
  await exit(); await launch()
}
async function sourceMode() {
  await page.getByRole('button', { name: '源码', exact: true }).click()
  await expect(page.locator('.editor-area')).toHaveClass(/layout-source/)
}
async function append(value) {
  await sourceMode()
  await expect(source()).toHaveAttribute('contenteditable', 'true')
  await source().click()
  await page.keyboard.press('ControlOrMeta+End')
  // A leading line break is a keyboard Enter, not Chromium insertText's paste boundary.
  if (value.startsWith('\n')) { await page.keyboard.press('Enter'); await page.keyboard.insertText(value.slice(1)) }
  else await page.keyboard.insertText(value)
}
async function save() {
  await expect(saveButton()).toBeEnabled()
  await source().click()
  await page.keyboard.press('ControlOrMeta+s')
}
async function settleSave() {
  await expect(page.locator('.unsaved-dot')).toHaveCount(0)
  await expect(page.locator('.statusbar')).toContainText(/已保存|已记录/)
  await expect(saveButton()).toBeEnabled()
}
async function saveDialog(filePath) {
  await app.evaluate(({ dialog }, destination) => {
    globalThis.__projectSaveCalls = 0
    dialog.showSaveDialog = async () => {
      globalThis.__projectSaveCalls++
      return destination ? { canceled: false, filePath: destination } : { canceled: true }
    }
  }, filePath)
}
async function chooseProject(folder) {
  await app.evaluate(({ dialog }, destination) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [destination] })
  }, folder)
  await page.locator('.sidebar').getByRole('button', { name: '打开项目', exact: true }).click()
  await expect(page.locator('.title-path')).toHaveAttribute('title', folder)
}
async function dismissNotice() {
  const close = page.getByRole('button', { name: '关闭提示', exact: true })
  if (await close.isVisible()) await close.click()
}

try {
  await launch()
  await expect(page.locator('.rich-editor .ProseMirror')).toBeVisible()
  await expect(page.locator('.rich-editor .ProseMirror')).toHaveAttribute('contenteditable', 'true')
  await expect(page.locator('.document-name')).toHaveText('未命名.md')
  await expect(page.locator('.document-state')).toHaveText('草稿')
  await expect(page.locator('.editor-area')).toHaveClass(/layout-preview/)
  await sourceMode()
  expect((await savedSettings()).projects).toEqual([])
  passed('fresh profile starts directly in an editable unfiled Markdown document')

  // Exceed the normal 500-character threshold: unfiled typing must never open a dialog.
  await saveDialog(null)
  const originalScratch = '# SCRATCH_SURVIVES\n\n' + '草'.repeat(501)
  await append(originalScratch)
  await expect.poll(async () => markdownBody((await scratch())[0]?.content)).toBe(originalScratch)
  const scratchId = (await scratch())[0].id
  const persisted = JSON.parse(await readFile(path.join(profile, 'untitled', `${scratchId}.json`), 'utf8'))
  expect(markdownBody(persisted.content)).toBe(originalScratch)
  expect(readRegistry(persisted.content)?.complete).toBe(true)
  const scratchSnapshot = persisted.content
  await page.waitForTimeout(1000)
  expect(await app.evaluate(() => globalThis.__projectSaveCalls)).toBe(0)
  expect((await savedSettings()).projects).toEqual([])
  passed('unfiled drafts persist on this device and the auto-save threshold does not invoke Save As')

  await save()
  await expect(page.locator('.statusbar')).toContainText('已取消保存')
  await expect(saveButton()).toBeEnabled()
  expect(await app.evaluate(() => globalThis.__projectSaveCalls)).toBe(1)
  await expect(page.locator('.document-name')).toHaveText('未命名.md')
  await expect(page.locator('.document-state')).toHaveText('草稿')
  expect((await scratch()).find(item => item.id === scratchId)?.content).toBe(scratchSnapshot)
  expect((await savedSettings()).projects).toEqual([])
  expect((await savedSettings()).lastProject).toBeNull()
  passed('canceling the first save retains content, scratch identity and the unbound workspace')

  await saveDialog(occupied)
  await save()
  await expect(page.getByRole('alert')).toContainText('目标文件已存在')
  await expect(saveButton()).toBeEnabled()
  expect(await readFile(occupied, 'utf8')).toBe('EXISTING_FILE_MUST_SURVIVE')
  await expect(page.locator('.document-state')).toHaveText('草稿')
  expect((await savedSettings()).projects).toEqual([])
  expect((await scratch()).find(item => item.id === scratchId)?.content).toBe(scratchSnapshot)
  passed('first save refuses an existing filename without overwrite or partial project registration')

  await restart()
  await sourceMode()
  await expect(source()).toContainText('SCRATCH_SURVIVES')
  await expect(page.locator('.document-state')).toHaveText('草稿')
  expect((await scratch()).find(item => item.id === scratchId)?.content).toBe(scratchSnapshot)
  passed('forced exit and restart recover the unfiled document without requiring a project')

  const target = path.join(plainProject, 'first.md')
  const captured = originalScratch + '\nSNAPSHOT_A'
  const latest = captured + '\nLATER_B'
  await append('\nSNAPSHOT_A')
  await saveDialog(target)
  // The real handler writes first; only its response is delayed to exercise late typing.
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('untitled:save')
    if (!original) throw new Error('untitled:save handler is missing')
    globalThis.__projectSaveReady = false
    ipcMain._invokeHandlers.set('untitled:save', async (...args) => {
      const result = await original(...args)
      globalThis.__projectSaveReady = true
      await new Promise(resolve => { globalThis.__projectReleaseSave = resolve })
      ipcMain._invokeHandlers.set('untitled:save', original)
      return result
    })
  })
  await save()
  await expect.poll(() => app.evaluate(() => globalThis.__projectSaveReady)).toBe(true)
  await append('\nLATER_B')
  const capturedSnapshot = await app.evaluate(() => globalThis.__projectSavedSnapshot)
  expect(markdownBody(capturedSnapshot)).toBe(captured)
  expect(readRegistry(capturedSnapshot)?.documentId).toBe(readRegistry(scratchSnapshot).documentId)
  expect(await readFile(target, 'utf8')).toBe(capturedSnapshot)
  await app.evaluate(() => globalThis.__projectReleaseSave())
  await expect(page.locator('.document-name')).toHaveText('first.md')
  await expect(page.locator('.document-state')).toHaveCount(0)
  await expect(source()).toContainText('LATER_B')
  await expect(page.locator('.unsaved-dot')).toBeVisible()
  await expect.poll(async () => markdownBody((await page.evaluate(() => window.oops.read('first.md'))).draft?.content)).toBe(latest)
  const laterDraft = (await page.evaluate(() => window.oops.read('first.md'))).draft.content
  expect(readRegistry(laterDraft)?.documentId).toBe(readRegistry(capturedSnapshot).documentId)
  await expect.poll(async () => (await scratch()).some(item => item.id === scratchId)).toBe(false)
  expect((await savedSettings()).projects.map(item => item.root)).toEqual([plainProject])
  expect((await savedSettings()).lastProject).toBe(plainProject)
  await expect(saveButton()).toBeEnabled()
  await source().click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(source()).not.toContainText('LATER_B')
  // Shift+Z must produce an uppercase key, as a physical Windows keyboard does.
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await expect(source()).toContainText('LATER_B')
  await save()
  await settleSave()
  const latestSnapshot = await app.evaluate(() => globalThis.__projectSavedSnapshot)
  expect(markdownBody(latestSnapshot)).toBe(latest)
  expect(latestSnapshot).toBe(laterDraft)
  expect(await readFile(target, 'utf8')).toBe(latestSnapshot)
  expect(await stat(path.join(plainProject, '.git')).then(() => true, () => false)).toBe(false)
  passed('first save preserves late typing and undo/redo, migrates the draft, and registers a plain project')

  await chooseProject(gitProject)
  await page.locator('.tree-scroll').getByRole('button', { name: 'doc.md', exact: true }).click()
  await sourceMode()
  await expect(source()).toContainText('Versioned document')
  await writeFile(path.join(gitProject, 'other.md'), 'OTHER_STAGED\n')
  git('add', '--', 'other.md')
  await writeFile(path.join(gitProject, 'other.md'), 'OTHER_WORKING\n')
  await append('\nVERSIONED_SAVE')
  await save()
  await settleSave()
  expect(commits()).toBe(2)
  expect(git('show', 'HEAD:doc.md')).toContain('VERSIONED_SAVE')
  expect(git('show', 'HEAD:other.md')).toBe('OTHER_BASELINE')
  expect(git('show', ':other.md')).toBe('OTHER_STAGED')
  expect(await readFile(path.join(gitProject, 'other.md'), 'utf8')).toBe('OTHER_WORKING\n')
  passed('saving inside a selected Git project preserves unrelated staged and working content')

  const beforeFailure = await readFile(path.join(gitProject, 'doc.md'), 'utf8')
  await writeFile(path.join(gitProject, 'doc.md'), replaceMarkdownBody(beforeFailure, markdownBody(beforeFailure) + '\nCURRENT_STAGED'))
  git('add', '--', 'doc.md')
  const staged = git('show', ':doc.md')
  await expect(source()).toContainText('CURRENT_STAGED')
  await append('\nSAVED_DESPITE_COMMIT_FAILURE')
  await save()
  await settleSave()
  await expect(page.locator('.statusbar')).toContainText('版本记录失败')
  expect(commits()).toBe(2)
  expect(git('show', ':doc.md')).toBe(staged)
  expect(await readFile(path.join(gitProject, 'doc.md'), 'utf8')).toContain('SAVED_DESPITE_COMMIT_FAILURE')
  git('reset', 'HEAD', '--', 'doc.md')
  await dismissNotice()
  await save()
  await settleSave()
  expect(commits()).toBe(3)
  passed('a selected-file staging conflict still saves disk, preserves the index, and supports manual retry')

  // Project changes must keep each document's content and recovery state separate.
  await projectButton(plainProject).click()
  await expect(page.locator('.document-name')).toHaveText('first.md')
  await sourceMode()
  await expect(source()).toContainText('LATER_B')
  await append('\nPLAIN_PROJECT_DRAFT')
  await projectButton(gitProject).click()
  await expect(page.locator('.document-name')).toHaveText('doc.md')
  await expect(page.locator('.modal')).toHaveCount(0)
  await sourceMode()
  await expect(source()).toContainText('SAVED_DESPITE_COMMIT_FAILURE')
  await expect(source()).not.toContainText('PLAIN_PROJECT_DRAFT')
  await projectButton(plainProject).click()
  await expect(page.locator('.modal')).toHaveCount(0)
  await sourceMode()
  await expect(source()).toContainText('PLAIN_PROJECT_DRAFT')
  expect((await page.evaluate(() => window.oops.read('first.md'))).draft?.content).toContain('PLAIN_PROJECT_DRAFT')
  await save()
  await settleSave()
  await projectButton(gitProject).click()
  await expect(page.locator('.document-name')).toHaveText('doc.md')
  expect((await savedSettings()).projects).toHaveLength(2)
  expect((await savedSettings()).lastProject).toBe(gitProject)
  passed('project-list switching restores the correct recent file and keeps recovery drafts scoped to their project')

  await projectButton(plainProject).click()
  await page.locator('.tree-scroll').getByRole('button', { name: 'closed-folder', exact: true }).click()
  await page.locator('.tree-scroll').getByRole('button', { name: 'closed.md', exact: true }).click()
  await append('\nCLOSED_DIRTY_RECOVERY')
  await page.getByRole('button', { name: '关闭标签 closed.md', exact: true }).click()
  await expect(page.locator('.modal h2')).toHaveText('当前文档尚未保存')
  await page.locator('.modal').getByRole('button', { name: '保留草稿', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'closed.md', exact: true })).toHaveCount(0)
  await expect(source()).toHaveAttribute('contenteditable', 'true')
  await projectButton(plainProject).click()
  await expect(page.locator('.document-name')).toHaveText('first.md')
  await page.locator('.tree-scroll').getByRole('button', { name: 'closed-folder', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
  await page.getByRole('textbox', { name: '重命名', exact: true }).fill('moved-folder')
  await page.getByRole('button', { name: '确定', exact: true }).click()
  await expect(page.locator('.tree-scroll').getByRole('button', { name: 'moved-folder', exact: true })).toBeVisible()
  await sourceMode()
  await expect(source()).toHaveAttribute('contenteditable', 'true')
  await page.keyboard.press('ControlOrMeta+Shift+T')
  await expect(page.getByRole('tab', { name: 'closed.md', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: 'closed.md', exact: true })).toHaveAttribute('title', plainProject + '/moved-folder/closed.md')
  await sourceMode()
  await expect(source()).toContainText('CLOSED_DIRTY_RECOVERY')
  expect((await page.evaluate(() => window.oops.read('moved-folder/closed.md'))).draft?.content).toContain('CLOSED_DIRTY_RECOVERY')
  expect(await readFile(path.join(plainProject, 'moved-folder/closed.md'), 'utf8')).toBe('# CLOSED_BASELINE\n')
  await save(); await settleSave()
  expect(await readFile(path.join(plainProject, 'moved-folder/closed.md'), 'utf8')).toContain('CLOSED_DIRTY_RECOVERY')
  await projectButton(gitProject).click()
  await expect(page.locator('.document-name')).toHaveText('doc.md')
  passed('close dirty tab, move its folder and reopen restores the new path with its unsaved recovery')

  await projectButton(plainProject).click()
  await page.locator('.tree-scroll').getByRole('button', { name: 'rename-source.md', exact: true }).click()
  await append('\nB_ONLY_EDIT')
  await page.locator('.tree-scroll').getByRole('button', { name: 'rename-source.md', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
  await page.getByRole('textbox', { name: '重命名', exact: true }).fill('renamed-B.md')
  await page.getByRole('button', { name: '确定', exact: true }).click()
  await expect(page.locator('.document-name')).toHaveText('renamed-B.md')
  await expect(source()).toHaveAttribute('contenteditable', 'true')
  await writeFile(path.join(plainProject, 'rename-source.md'), '# NEW_A\n')
  await page.locator('.tree-scroll').getByRole('button', { name: 'rename-source.md', exact: true }).click()
  await sourceMode()
  await expect(page.getByRole('tab', { name: 'renamed-B.md', exact: true })).toHaveCount(1)
  await expect(page.getByRole('tab', { name: 'rename-source.md', exact: true })).toHaveCount(1)
  await expect(source()).toContainText('NEW_A')
  await expect(source()).not.toContainText('ORIGINAL_B')
  await append('\nA_ONLY_EDIT')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(source()).not.toContainText('A_ONLY_EDIT')
  await expect(source()).toContainText('NEW_A')
  await expect(source()).not.toContainText('B_ONLY_EDIT')
  await page.getByRole('tab', { name: 'renamed-B.md', exact: true }).click()
  await sourceMode()
  await expect(source()).toContainText('B_ONLY_EDIT')
  await expect(source()).not.toContainText('NEW_A')
  await source().click(); await page.keyboard.press('ControlOrMeta+z')
  await expect(source()).not.toContainText('B_ONLY_EDIT')
  await expect(source()).toContainText('ORIGINAL_B')
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await expect(source()).toContainText('B_ONLY_EDIT')
  await save(); await settleSave()
  await page.getByRole('tab', { name: 'rename-source.md', exact: true }).click()
  await sourceMode()
  await expect(source()).toContainText('NEW_A')
  await expect(source()).not.toContainText('B_ONLY_EDIT')
  expect(await readFile(path.join(plainProject, 'rename-source.md'), 'utf8')).toBe('# NEW_A\n')
  const renamed = await readFile(path.join(plainProject, 'renamed-B.md'), 'utf8')
  expect(markdownBody(renamed)).toBe('# ORIGINAL_B\n\nB_ONLY_EDIT')
  expect(readRegistry(renamed)?.complete).toBe(true)
  await projectButton(gitProject).click()
  await expect(page.locator('.document-name')).toHaveText('doc.md')
  passed('rename then recreate the original filename keeps both tabs, content and undo histories independent')

  await restart(true)
  await expect(page.locator('.startup h1')).toHaveText('继续你的工作')
  await expect(page.locator('.startup').getByRole('button', { name: '继续上次项目', exact: true })).toContainText(path.basename(gitProject))
  await page.locator('.startup').getByRole('button', { name: '继续上次项目', exact: true }).click()
  await expect(page.locator('.title-path')).toHaveAttribute('title', gitProject)
  await expect(page.locator('.document-name')).toHaveText('doc.md')
  await sourceMode()
  await expect(source()).toContainText('SAVED_DESPITE_COMMIT_FAILURE')
  passed('a profile with projects starts with a choice and continues the last project and document')

  await restart(true)
  await expect(page.locator('.startup h1')).toHaveText('继续你的工作')
  await page.locator('.startup').getByRole('button', { name: '新建文档', exact: true }).click()
  await expect(page.locator('.document-name')).toHaveText('未命名.md')
  await expect(page.locator('.document-type')).toHaveText('Markdown')
  await newDocument(page, 'Formula')
  await sourceMode()
  await expect(source()).toHaveAttribute('contenteditable', 'true')
  await append('SECOND_SCRATCH\n\\frac{a}{b}')
  await expect.poll(async () => (await scratch()).find(item => item.content.startsWith('SECOND_SCRATCH'))?.mode).toBe('latex-math')
  expect((await scratch()).find(item => item.content.startsWith('SECOND_SCRATCH')).content).toBe('SECOND_SCRATCH\n\\frac{a}{b}')
  await saveDialog(null)
  await save()
  await expect(page.locator('.statusbar')).toContainText('已取消保存')
  await expect(page.locator('.document-type')).toHaveText('Formula')
  await expect(page.locator('.editor-area')).toHaveClass(/layout-source/)
  expect((await savedSettings()).projects).toHaveLength(2)
  expect((await savedSettings()).lastProject).toBe(gitProject)
  passed('startup creates Markdown, the plus menu creates an independent Formula draft, and cancel preserves its plain source and layout')

  await newDocument(page)
  await expect(page.locator('.modal')).toHaveCount(0)
  await sourceMode()
  await append('THIRD_SCRATCH')
  await expect.poll(async () => (await scratch()).length).toBe(2)
  await restart()
  await expect(page.getByRole('tab', { name: 'THIRD_SCRATCH', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'SECOND_SCRATCH', exact: true }).click()
  await sourceMode()
  await expect(source()).toContainText('SECOND_SCRATCH')
  await expect(source()).not.toContainText('THIRD_SCRATCH')
  await expect(page.locator('.document-type')).toHaveText('Formula')
  const thirdScratch = (await scratch()).find(item => markdownBody(item.content) === 'THIRD_SCRATCH')
  expect(thirdScratch).toBeTruthy()
  expect(readRegistry(thirdScratch.content)?.complete).toBe(true)
  passed('multiple unfiled documents survive restart independently and the chosen draft restores its mode')

  expect(failures).toEqual([])
  const screenshot = path.join(temporary, 'project-flow.png')
  await page.screenshot({ path: screenshot, fullPage: true })
  console.log(JSON.stringify({ ok: true, checks, temporary, profile, plainProject, gitProject, screenshot }, null, 2))
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(temporary, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(JSON.stringify({ ok: false, checks, failures, temporary, error: String(error) }, null, 2))
  throw error
} finally {
  await exit()
}
