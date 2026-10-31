import { openLocalProject, newDocument } from './ui-test-utils.mjs'
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { markdownBody, replaceMarkdownBody } from './mark-test-utils.mjs'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
await mkdir(path.join(root, '.test-data'), { recursive: true })
const temporary = await mkdtemp(path.join(root, '.test-data', 'smoke-'))
const library = path.join(temporary, '文档 空间')
await mkdir(path.join(library, '附件'), { recursive: true })
const initial = '# MarkFlow 本地验证\n\n这里是初始正文。\n\n## 公式\n\n$E=mc^2$\n\n```js\nconst x = 1\n```\n\n![测试图片](附件/测试%20图片.png)\n\n[第二篇](第二篇.md)\n'
await writeFile(path.join(library, '开始.md'), initial)
await writeFile(path.join(library, '第二篇.md'), '# 第二篇\n\n第二份文档。\n')
await writeFile(path.join(library, '公式.tex'), '\\frac{a}{b}')
await writeFile(path.join(library, '附件', '测试 图片.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmO8AAAAASUVORK5CYII=', 'base64'))
const gitBin = process.env.OOPSMD_SMOKE_EXE ? path.join(path.dirname(process.env.OOPSMD_SMOKE_EXE), 'resources', 'git', 'cmd', 'git.exe') : 'git'
const git = (...args) => execFileSync(gitBin, args, { cwd: library, encoding: 'utf8', windowsHide: true }).trim()
git('init', '-b', 'main'); git('config', 'user.name', 'MarkFlow Test'); git('config', 'user.email', 'test@example.invalid'); git('add', '.'); git('commit', '-m', 'baseline')
const settingsDir = path.join(temporary, 'profile')
const launchEnv = { ...process.env, MARKFLOW_USER_DATA: settingsDir }
delete launchEnv.ELECTRON_RUN_AS_NODE
const launch = async () => electron.launch({
  ...(process.env.OOPSMD_SMOKE_EXE ? { executablePath: process.env.OOPSMD_SMOKE_EXE, args: [] } : { args: [root] }),
  env: launchEnv,
})
let app = await launch()
const failures = []
const checks = []
try {
  let page = await app.firstWindow()
  page.on('pageerror', (error) => failures.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('.document-name')).toHaveText('未命名.md')
  await expect(page.locator('.editor-area')).toHaveClass(/layout-preview/)
  await expect(page.locator('.rich-editor .ProseMirror')).toHaveAttribute('contenteditable', 'true')
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, library)
  await openLocalProject(page)
  await page.locator('.tree-scroll').getByRole('button', { name: '开始.md', exact: true }).click()
  await page.getByRole('button', { name: '对照', exact: true }).click()
  await expect(page.locator('.editor-area')).toHaveClass(/layout-split/)
  const source = page.locator('.cm-content')
  await expect(source).toContainText('初始正文')
  await expect(page.locator('.preview-pane .katex')).toHaveCount(1)
  await expect.poll(() => page.locator('.preview-pane img').evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true)
  checks.push('production Electron window, Markdown/math and local image with Chinese/space path')

  await source.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\n未保存的测试内容')
  await page.getByRole('button', { name: '实时预览', exact: true }).click()
  await expect(page.locator('.editor-area')).toHaveClass(/layout-preview/)
  await page.getByRole('button', { name: '源码', exact: true }).click()
  await expect(page.locator('.editor-area')).toHaveClass(/layout-source/)
  await source.click(); await page.keyboard.press('ControlOrMeta+z')
  await expect(source).not.toContainText('未保存的测试内容')
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await expect(source).toContainText('未保存的测试内容')
  checks.push('layout switch preserves undo/redo')
  await page.keyboard.press('ControlOrMeta+s')
  await expect(page.locator('.statusbar')).toContainText('已记录本地版本')
  const saved = await readFile(path.join(library, '开始.md'), 'utf8')
  expect(saved).toContain('未保存的测试内容')
  expect(git('rev-list', '--count', 'HEAD')).toBe('2')
  await page.keyboard.press('ControlOrMeta+s')
  await expect(page.locator('.statusbar')).toContainText('无新版本')
  expect(git('rev-list', '--count', 'HEAD')).toBe('2')
  checks.push('Ctrl+S writes and commits only changes, no empty commit')

  await page.getByRole('button', { name: '对照', exact: true }).click()
  await expect(page.locator('.editor-area')).toHaveClass(/layout-split/)
  await source.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\n' + '汉'.repeat(499))
  await expect.poll(() => git('rev-list', '--count', 'HEAD'), { timeout: 20000 }).toBe('3')
  checks.push('500 graphemes trigger one automatic snapshot')
  await expect(page.locator('.statusbar')).toContainText('净修改 0')
  await expect(page.getByRole('button', { name: /^保存(?: (?:Ctrl|⌘) S)?$/ })).toBeEnabled()

  await page.getByRole('button', { name: '文件夹树', exact: true }).click()
  await expect(page.locator('.folder-list')).toContainText('开始.md')
  await page.getByRole('button', { name: '文件树', exact: true }).click()
  await expect(page.locator('.tree-scroll .selected')).toContainText('开始.md')
  await page.locator('.tree-scroll').getByRole('button', { name: '公式.tex', exact: true }).click()
  await expect(page.locator('.document-name')).toHaveText('公式.tex')
  await expect(page.locator('.math-preview .katex')).toHaveCount(1)
  await source.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\\oopsunknown')
  await expect(page.getByText('公式尚不能渲染', { exact: true })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('.math-preview .katex')).toHaveCount(1)
  await page.locator('.tree-scroll').getByRole('button', { name: '开始.md', exact: true }).click()
  await page.getByRole('button', { name: '源码', exact: true }).click()
  await expect(source).toContainText('初始正文')
  checks.push('both tree views retain selection; .tex math errors preserve source and undo')

  await newDocument(page)
  await expect(page.locator('.document-name')).toHaveText('未命名.md')
  await expect(page.locator('.document-state')).toHaveText('草稿')
  await page.getByRole('button', { name: '源码', exact: true }).click()
  await expect(page.locator('.editor-area')).toHaveClass(/layout-source/)
  await source.click(); await page.keyboard.insertText('# 临时文档')
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, path.join(library, '临时.md'))
  await page.keyboard.press('ControlOrMeta+s')
  await expect(page.locator('.document-name')).toHaveText('临时.md')
  await expect(page.getByRole('button', { name: /^保存(?: (?:Ctrl|⌘) S)?$/ })).toBeEnabled()
  expect(markdownBody(await readFile(path.join(library, '临时.md'), 'utf8'))).toBe('# 临时文档')
  await page.locator('.tree-scroll').getByRole('button', { name: '临时.md', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
  await page.getByRole('textbox', { name: '重命名', exact: true }).fill('临时 改名.md')
  await page.getByRole('button', { name: '确定', exact: true }).click()
  await expect(page.locator('.document-name')).toHaveText('临时 改名.md')
  await page.locator('.tree-scroll').getByRole('button', { name: '临时 改名.md', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '移到回收站', exact: true }).click()
  await page.getByRole('button', { name: '移到回收站', exact: true }).click()
  await expect(page.locator('.tree-scroll')).not.toContainText('临时 改名.md')
  await page.locator('.tree-scroll').getByRole('button', { name: '开始.md', exact: true }).click()
  await page.getByRole('button', { name: '源码', exact: true }).click()
  await expect(source).toContainText('初始正文')
  checks.push('real window create, rename and OS recycle-bin deletion')

  await source.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('\n本地尚未保存')
  const outsideSource = await readFile(path.join(library, '开始.md'), 'utf8')
  await writeFile(path.join(library, '开始.md'), replaceMarkdownBody(outsideSource, markdownBody(outsideSource) + '\n外部文件更新'))
  await expect(page.getByText('检测到外部修改', { exact: true })).toBeVisible({ timeout: 15000 })
  await expect(source).toContainText('本地尚未保存')
  expect(await readFile(path.join(library, '开始.md'), 'utf8')).toContain('外部文件更新')
  checks.push('external conflict retains disk and editor versions')

  // Simulate abrupt process death after the independent draft has reached disk.
  await expect.poll(async () => {
    const { readdir } = await import('node:fs/promises')
    const findDraft = async (dir) => { for (const entry of await readdir(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) { const match = await findDraft(file); if (match) return match } else if (entry.name.endsWith('.json') && (await readFile(file, 'utf8')).includes('本地尚未保存')) return true } return false }
    return findDraft(settingsDir)
  }).toBe(true)
  await app.evaluate(({ app }) => app.exit(0))
  app = await launch(); page = await app.firstWindow()
  page.on('pageerror', (error) => failures.push(error.message))
  await page.getByRole('button', { name: '恢复草稿', exact: true }).click()
  await page.getByRole('button', { name: '源码', exact: true }).click()
  await expect(page.locator('.cm-content')).toContainText('本地尚未保存')
  await expect(page.getByText('检测到外部修改', { exact: true })).toBeVisible()
  checks.push('crash recovery below threshold, including independent external change')
  await page.screenshot({ path: path.join(root, '.test-data', 'oopsmd-smoke.png') })
  expect(failures).toEqual([])
  console.log(JSON.stringify({ ok: true, checks, library, screenshot: '.test-data/oopsmd-smoke.png', executable: process.env.OOPSMD_SMOKE_EXE || 'development Electron, production build' }, null, 2))
} catch (error) {
  const pages = app.windows(); if (pages[0]) { await pages[0].screenshot({ path: path.join(root, '.test-data', 'smoke-failure.png') }).catch(() => {}); console.error((await pages[0].locator('body').innerText()).slice(0, 6000)) }
  console.error('Page errors:', failures)
  throw error
} finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
