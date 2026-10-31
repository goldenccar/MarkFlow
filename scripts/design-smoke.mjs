import { openLocalProject, showBlockInspector, setTheme } from './ui-test-utils.mjs'
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { markdownBody } from './mark-test-utils.mjs'

const root = process.cwd()
await mkdir(path.join(root, '.test-data'), { recursive: true })
const temporary = await mkdtemp(path.join(root, '.test-data', 'design-'))
const library = path.join(temporary, '研究与写作')
const profile = path.join(temporary, 'profile')
await mkdir(path.join(library, '资料'), { recursive: true })
const markdown = '# 把思考留在纸面上\n\n写作是一种整理：先留下想法，再把问题逐一说清楚。\n\n## 本周的研究\n\n- 整理观察，保留原始记录\n- 区分事实、推断和下一步\n- 用一段清晰的文字结束今天\n\n> 好的工具让注意力回到内容本身。\n\n## 一个小实验\n\n| 条件 | 结果 |\n| --- | --- |\n| 基线 | 12.4 |\n| 试验 | 15.8 |\n\n```js\nconst change = observed - baseline\nconsole.log(change)\n```\n\n行内公式 $E = mc^2$ 也可以和正文一起阅读。\n'
await writeFile(path.join(library, '写作.md'), markdown)
await writeFile(path.join(library, '备用.md'), '# 备用资料\n\n正文应在归档后保持原样。\n')
await writeFile(path.join(library, '公式.tex'), '\\int_0^1 x^2\\,dx = \\frac{1}{3}')
const gitBin = process.env.OOPSMD_SMOKE_EXE ? path.join(path.dirname(process.env.OOPSMD_SMOKE_EXE), 'resources', 'git', 'cmd', 'git.exe') : 'git'
const git = (...args) => execFileSync(gitBin, args, { cwd: library, encoding: 'utf8', windowsHide: true }).trim()
git('init', '-b', 'main')
git('config', 'user.name', 'MarkFlow Design Test')
git('config', 'user.email', 'test@example.invalid')
git('add', '.')
git('commit', '-m', 'baseline')
const env = { ...process.env, MARKFLOW_USER_DATA: profile }
delete env.ELECTRON_RUN_AS_NODE
const checks = []
const screenshots = []
const errors = []
let app
let page
const passed = name => { checks.push(name); console.log(`PASS ${name}`) }
const tree = name => page.locator('.tree-scroll').getByRole('button', { name, exact: true })
const editor = () => page.locator('.cm-content:visible')
const saveButton = () => page.getByRole('button', { name: /^保存(?: (?:Ctrl|⌘) S)?$/ })
async function launch() {
  app = await electron.launch({ ...(process.env.OOPSMD_SMOKE_EXE ? { executablePath: process.env.OOPSMD_SMOKE_EXE, args: [] } : { args: [root] }), env })
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 940))
}
async function exit() {
  if (!app) return
  const exiting = app
  app = undefined
  const closed = exiting.waitForEvent('close', { timeout: 10000 })
  await exiting.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await closed
}
async function capture(name) {
  const filename = path.join(temporary, `${name}.png`)
  await page.screenshot({ path: filename, fullPage: true, animations: 'disabled' })
  screenshots.push(filename)
}
async function resize(width, height) {
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height])
  await expect.poll(() => page.evaluate(size => Math.max(Math.abs(innerWidth - size[0]), Math.abs(innerHeight - size[1])), [width, height])).toBeLessThanOrEqual(2)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
async function captureTheme(name) {
  await capture(name)
  await resize(920, 620)
  await noClipping()
  await capture(name + '-compact')
  await resize(1440, 940)
}
async function noClipping() {
  const issues = await page.evaluate(() => {
    const regions = ['.document-bar', '.editor-toolbar', '.statusbar']
    return regions.flatMap(selector => {
      const element = document.querySelector(selector)
      if (!element) return []
      const bounds = element.getBoundingClientRect()
      const children = Array.from(element.querySelectorAll('button')).filter(button => button.offsetWidth)
      return children.filter(button => { const rect = button.getBoundingClientRect(); return rect.left < bounds.left - 1 || rect.right > bounds.right + 1 }).map(button => `${selector}: ${button.getAttribute('aria-label') || button.textContent}`)
    })
  })
  expect(issues).toEqual([])
}
async function context(item) {
  await item.click({ button: 'right' })
  await expect(page.getByRole('menu', { name: '文件操作' })).toBeVisible()
}

try {
  await launch()
  await setTheme(page, 'light')
  await expect(page.locator('.live-pane [contenteditable="true"]:visible')).toBeVisible()
  await expect(page.locator('.brand, .titlebar, .sidebar-top, .file-actions')).toHaveCount(0)
  await expect(page.locator('.window-drag').getByRole('button', { name: '新建标签', exact: true })).toBeVisible()
  await expect(page.locator('.layout-switch button')).toHaveText(['实时预览', '源码', '对照'])
  await expect(page.getByRole('combobox', { name: 'Mark 字体', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Mark 字号', exact: true })).toBeVisible()
  await noClipping()
  passed('single document bar, contextual file actions and default editable live view')

  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, library)
  await openLocalProject(page)
  await tree('写作.md').click()
  await expect(page.locator('.live-pane [contenteditable="true"]:visible')).toBeVisible()
  await expect(page.locator('.live-pane h1')).toHaveText('把思考留在纸面上')
  await showBlockInspector(page)
  await expect.poll(() => page.locator('.block-tree button').count()).toBeGreaterThan(3)
  await page.locator('.block-tree button').nth(1).click()
  await expect(page.locator('.live-pane h1')).toHaveText('把思考留在纸面上')
  await captureTheme('markdown-light')
  const markdownSurface = await page.locator('.app').evaluate(element => getComputedStyle(element).getPropertyValue('--sidebar').trim())
  await setTheme(page, 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await captureTheme('markdown-dark')
  await setTheme(page, 'light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  passed('Markdown light/dark surfaces, rendered blocks and document-block navigation')

  await page.getByRole('button', { name: '源码', exact: true }).click()
  await expect(page.locator('.editor-area')).toHaveClass(/layout-source/)
  await expect(editor()).toContainText('# 把思考留在纸面上')
  await editor().click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('DESIGN_EDIT')
  await expect.poll(async () => markdownBody((await page.evaluate(() => window.oops.read('写作.md'))).draft?.content ?? '')).toBe(markdown + '\nDESIGN_EDIT')
  await page.getByRole('button', { name: '实时预览', exact: true }).click()
  await expect(page.locator('.live-pane')).toBeVisible()
  await page.getByRole('button', { name: '对照', exact: true }).click()
  await expect(page.locator('.source-pane')).toBeVisible()
  await expect(page.locator('.preview-pane')).toBeVisible()
  await editor().click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(editor()).not.toContainText('DESIGN_EDIT')
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await expect(editor()).toContainText('DESIGN_EDIT')
  await saveButton().click()
  await expect(page.locator('.unsaved-dot')).toHaveCount(0)
  await expect(saveButton()).toBeEnabled()
  expect(markdownBody(await readFile(path.join(library, '写作.md'), 'utf8'))).toBe(markdown + '\nDESIGN_EDIT')
  expect(git('rev-list', '--count', 'HEAD')).toBe('2')
  await capture('markdown-compare')
  passed('live/source/compare share undo and save one complete document snapshot')

  await tree('公式.tex').click()
  await page.getByRole('button', { name: '对照', exact: true }).click()
  await expect(page.locator('.app')).toHaveAttribute('data-mode', 'latex-math')
  await expect(page.getByRole('button', { name: '实时预览', exact: true })).toHaveCount(0)
  await expect(page.locator('.source-pane')).toBeVisible()
  await expect(page.locator('.preview-pane .katex')).toHaveCount(1)
  expect(await page.locator('.app').evaluate(element => getComputedStyle(element).getPropertyValue('--sidebar').trim())).not.toBe(markdownSurface)
  await captureTheme('geek-light')
  await setTheme(page, 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await captureTheme('geek-dark')
  await noClipping()
  await setTheme(page, 'light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await tree('写作.md').click()
  await resize(920, 620)
  await noClipping()
  await capture('markdown-compact')
  await resize(1440, 940)
  passed('Formula has editable source and formula output in both themes; controls fit a compact desktop window')

  const spare = await readFile(path.join(library, '备用.md'), 'utf8')
  const beforeArchive = git('status', '--porcelain=v1')
  await expect(tree('备用.md')).toBeEnabled()
  await tree('备用.md').focus()
  await expect(tree('备用.md')).toBeFocused()
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menu')).toBeVisible()
  await expect(page.getByRole('menuitem')).toHaveText(['重命名', '归档', '移到回收站'])
  await capture('context-menu')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(tree('备用.md')).toBeFocused()
  await context(tree('备用.md'))
  await page.getByRole('menuitem', { name: '归档', exact: true }).click()
  await expect(tree('备用.md')).toHaveCount(0)
  await expect(page.locator('.archive-toggle')).toHaveAttribute('aria-expanded', 'false')
  await page.locator('.archive-toggle').click()
  await expect(page.locator('.archive-tree').getByRole('button', { name: '备用.md', exact: true })).toBeVisible()
  await capture('archive-tree')
  expect(await readFile(path.join(library, '备用.md'), 'utf8')).toBe(spare)
  expect(git('status', '--porcelain=v1')).toBe(beforeArchive)
  passed('keyboard/context menu actions are discoverable; archive changes neither disk content nor Git')

  await exit()
  await launch()
  const continueProject = page.getByRole('button', { name: '继续上次项目', exact: true })
  if (await continueProject.isVisible()) await continueProject.click()
  await expect(page.locator('.document-project')).toHaveText('研究与写作')
  await expect(tree('备用.md')).toHaveCount(0)
  await page.locator('.archive-toggle').click()
  const archived = page.locator('.archive-tree').getByRole('button', { name: '备用.md', exact: true })
  await expect(archived).toBeVisible()
  await context(archived)
  await page.getByRole('menuitem', { name: '恢复到工作树', exact: true }).click()
  await expect(tree('备用.md')).toBeVisible()
  expect(git('status', '--porcelain=v1')).toBe(beforeArchive)
  await context(tree('备用.md'))
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
  await page.getByRole('textbox', { name: '重命名', exact: true }).fill('重命名.md')
  await page.getByRole('dialog', { name: '重命名', exact: true }).getByRole('button', { name: '确定', exact: true }).click()
  await expect(tree('重命名.md')).toBeVisible()
  await tree('重命名.md').dragTo(tree('资料'))
  await expect.poll(() => stat(path.join(library, '资料', '重命名.md')).then(() => true, () => false)).toBe(true)
  expect(await readFile(path.join(library, '资料', '重命名.md'), 'utf8')).toBe(spare)
  await expect(tree('重命名.md')).toBeVisible()
  await capture('dragged-file')
  passed('archive survives restart, restores through its menu, and files rename and drag into folders')

  await context(tree('资料'))
  await page.getByRole('menuitem', { name: '归档', exact: true }).click()
  await expect(tree('资料')).toHaveCount(0)
  const archivedFolder = page.locator('.archive-tree').getByRole('button', { name: '资料', exact: true })
  await expect(archivedFolder).toBeVisible()
  const archivedChild = page.locator('.archive-tree').getByRole('button', { name: '重命名.md', exact: true })
  if (!(await archivedChild.isVisible())) await archivedFolder.click()
  await context(archivedChild)
  await page.getByRole('menuitem', { name: '恢复所在归档', exact: true }).click()
  await expect(tree('资料')).toBeVisible()
  await expect(tree('重命名.md')).toBeVisible()
  await context(tree('重命名.md'))
  await page.getByRole('menuitem', { name: '移到回收站', exact: true }).click()
  await page.getByRole('dialog', { name: '移到回收站', exact: true }).getByRole('button', { name: '移到回收站', exact: true }).click()
  await expect(tree('重命名.md')).toHaveCount(0)
  expect(await stat(path.join(library, '资料', '重命名.md')).then(() => true, () => false)).toBe(false)
  expect(git('rev-list', '--count', 'HEAD')).toBe('2')
  passed('folder archive covers descendants; contextual restore and recycle-bin delete preserve deliberate Git recording')

  expect(errors).toEqual([])
  console.log(JSON.stringify({ ok: true, checks, temporary, library, screenshots }, null, 2))
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(temporary, 'failure.png'), fullPage: true }).catch(() => {})
    console.error((await page.locator('body').innerText()).slice(0, 5000))
  }
  console.error(JSON.stringify({ ok: false, checks, errors, temporary, error: String(error) }, null, 2))
  throw error
} finally { await exit() }
