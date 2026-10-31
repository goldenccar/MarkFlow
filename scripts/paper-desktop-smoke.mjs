import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import JSZip from 'jszip'

const root = process.cwd()
const { values } = parseArgs({ options: { app: { type: 'string' }, 'evidence-dir': { type: 'string' } } })
const evidence = path.resolve(values['evidence-dir'] ?? '.test-data')
await mkdir(evidence, { recursive: true })
const temporary = await mkdtemp(path.join(evidence, 'paper-desktop-'))
const parent = path.join(temporary, 'projects'), project = path.join(parent, 'paper-smoke')
await mkdir(parent)
const env = { ...process.env, MARKFLOW_USER_DATA: path.join(temporary, 'profile') }
delete env.ELECTRON_RUN_AS_NODE
const checks = [], errors = []
let app, page, application
const pass = name => { checks.push(name); console.log(`PASS ${name}`) }
const pane = () => page.getByRole('region', { name: 'Fomula 文档工作区', exact: true })
const header = () => page.locator('.workspace-header')
const content = () => pane().locator('.cm-content')
const source = () => content().evaluate(element => element.cmTile.root.view.state.doc.toString())
async function openTreeFile(file) {
  const sidebar = page.getByRole('complementary', { name: '项目导航', exact: true })
  await sidebar.getByRole('button', { name: '文件树', exact: true }).click()
  const parts = file.split('/')
  for (let index = 1; index < parts.length; index++) {
    const child = parts.slice(0, index + 1).join('/')
    if (!await sidebar.getByTitle(child, { exact: true }).isVisible()) await sidebar.getByTitle(parts.slice(0, index).join('/'), { exact: true }).click()
  }
  await sidebar.getByTitle(file, { exact: true }).click()
  await expect(header().locator('.document-name')).toHaveText(file)
}
async function replace(value) {
  await content().click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText(value)
  await expect.poll(source).toBe(value)
}
async function compile(success = true) {
  await pane().getByRole('button', { name: '编译', exact: true }).click()
  await expect(pane().getByRole('button', { name: '取消编译', exact: true })).toBeVisible()
  await expect(pane().getByRole('button', { name: '编译', exact: true })).toBeVisible({ timeout: 120000 })
  if (success) await expect(pane().locator('.paper-notice')).toContainText('编译完成')
  else await expect(pane().locator('.paper-diagnostic.error').first()).toBeVisible({ timeout: 120000 })
}
async function exportTo(target, file) {
  await app.evaluate((_electron, destination) => { globalThis.__paperOutput = destination }, file)
  const menu = pane().locator('.paper-export')
  if (!(await menu.getAttribute('open'))) await menu.locator('summary').click()
  await menu.getByRole('button', { name: target === 'pdf' ? '导出 PDF' : '导出可复现源包', exact: true }).click()
  await expect(pane().locator('.paper-notice')).toContainText('已导出', { timeout: 30000 })
  await menu.locator('summary').click()
}
try {
  app = await electron.launch({ ...(values.app ? { executablePath: path.resolve(values.app), args: [] } : { args: [root] }), env })
  application = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), platform: process.platform, architecture: process.arch, resources: process.resourcesPath }))
  if (values.app) expect(application.packaged).toBe(true)
  page = await app.firstWindow()
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => errors.push(error.message))
  await expect(page.locator('.document-name')).toHaveText('未命名.md')
  await app.evaluate(({ dialog }, parent) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [parent] })
    dialog.showSaveDialog = async () => ({ canceled: !globalThis.__paperOutput, filePath: globalThis.__paperOutput })
  }, parent)
  await page.getByRole('button', { name: '新建标签', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Fomula/ }).click()
  await expect(pane().getByRole('heading', { name: '新建 LaTeX 文档' })).toBeVisible()
  if (values.app) {
    await pane().getByRole('button', { name: '安装论文环境', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.oops.paperRuntime().then(runtime => runtime.available)), { timeout: 300000 }).toBe(true)
    const environments = path.join(temporary, 'profile', 'paper', 'environments')
    const active = JSON.parse(await readFile(path.join(environments, 'active.json'), 'utf8'))
    expect(active.current).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9._-]+$/)
    application.environment = { id: active.bundleId, root: path.join(environments, active.current) }
    pass('packaged app installs its frozen environment in an empty application profile')
  }
  await pane().getByLabel('论文项目名称', { exact: true }).fill('paper-smoke')
  await pane().getByLabel('论文标题', { exact: true }).fill('MarkFlow 本地论文验收')
  await pane().getByLabel('论文作者', { exact: true }).fill('测试作者')
  await pane().getByRole('button', { name: '选择位置并创建' }).click()
  await expect(content()).toBeVisible()
  await expect(header()).toHaveCount(1)
  await expect(header().locator('.document-project')).toHaveAttribute('title', project)
  await pane().locator('.paper-options summary').click()
  await expect(pane().getByLabel('论文主文件')).toHaveValue('main.tex')
  await pane().locator('.paper-options summary').click()
  pass('the Fomula menu creates a Chinese multi-file document without replacing existing notes')
  await compile()
  await expect(pane().locator('.paper-pdf-page canvas').first()).toBeVisible({ timeout: 30000 })
  await expect(pane().locator('.paper-pdf-page')).toHaveCount(2)
  await expect.poll(() => pane().locator('.paper-pdf-page canvas').first().evaluate(canvas => canvas.width)).toBeGreaterThan(100)
  await page.screenshot({ path: path.join(temporary, 'paper-two-pages.png') })
  pass('real XeLaTeX and BibTeX produce two pages rendered by bundled PDF.js')

  const originalIntro = await readFile(path.join(project, 'sections/introduction.tex'), 'utf8')
  await openTreeFile('sections/introduction.tex')
  await expect.poll(source).toBe(originalIntro.replace(/\r\n?/g, '\n'))
  const revisedIntro = (await source()) + '\n未保存章节也必须进入编译快照。\n'
  await replace(revisedIntro)
  const reader = pane().locator('.paper-pdf-scroll')
  await reader.evaluate(element => { element.scrollTop = 500 })
  const scrollBefore = await reader.evaluate(element => element.scrollTop)
  expect(scrollBefore).toBeGreaterThan(100)
  await compile()
  expect(await readFile(path.join(project, 'sections/introduction.tex'), 'utf8')).toBe(originalIntro)
  await expect.poll(() => reader.evaluate(element => element.scrollTop)).toBeGreaterThan(100)
  const zipPath = path.join(temporary, 'paper-source.zip')
  await exportTo('source', zipPath)
  const zip = await JSZip.loadAsync(await readFile(zipPath))
  expect(await zip.file('sections/introduction.tex').async('string')).toBe(revisedIntro)
  expect(Object.keys(zip.files).some(file => file.startsWith('build/') || file.startsWith('.runtime/'))).toBe(false)
  pass('unsaved chapter snapshot exported without source writes; preview scroll remains independent')

  await replace(revisedIntro + '\n\\DefinitelyInvalidCommand\n')
  await compile(false)
  await expect(pane().locator('.paper-pdf-page')).toHaveCount(2)
  const pdfPath = path.join(temporary, 'last-valid.pdf')
  await exportTo('pdf', pdfPath)
  expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe('%PDF-')
  expect(await readFile(path.join(project, 'sections/introduction.tex'), 'utf8')).toBe(originalIntro)
  pass('failed build preserves source and exportable last valid PDF')

  await replace(revisedIntro)
  await header().getByRole('button', { name: /^保存/ }).click()
  await expect.poll(() => readFile(path.join(project, 'sections/introduction.tex'), 'utf8')).toBe(revisedIntro)
  await page.getByRole('tab', { name: '未命名', exact: true }).click()
  await expect(pane()).toBeHidden()
  await page.getByRole('tab', { name: 'Fomula', exact: true }).click()
  await expect.poll(source).toBe(revisedIntro)
  pass('save and switching between normal document and paper preserve the session')

  await replace(revisedIntro + '\n恢复草稿测试。\n')
  await page.getByRole('button', { name: '关闭 Fomula 文档', exact: true }).click()
  await page.locator('.project-list').getByTitle(project, { exact: true }).click()
  await openTreeFile('sections/introduction.tex')
  await expect.poll(source).toContain('恢复草稿测试')
  pass('closing and reopening a project recovers unsaved chapter drafts')
  await writeFile(path.join(project, 'sections/introduction.tex'), originalIntro + '\nExternal edit.\n')
  await header().getByRole('button', { name: /^保存/ }).click()
  await expect(pane().getByRole('alert')).toContainText('其他程序修改')
  expect(await readFile(path.join(project, 'sections/introduction.tex'), 'utf8')).toContain('External edit.')
  await expect.poll(source).toContain('恢复草稿测试')
  pass('external edit conflict retains both disk content and unsaved buffer')
  await page.setViewportSize({ width: 920, height: 700 })
  await page.screenshot({ path: path.join(temporary, 'paper-narrow.png') })
  expect(errors).toEqual([])
  pass('narrow layout and renderer error check')
} catch (error) {
  console.error(error)
  if (page) {
    await page.screenshot({ path: path.join(temporary, 'failure.png') }).catch(() => {})
    await writeFile(path.join(temporary, 'failure.txt'), (await page.locator('body').innerText().catch(() => '')) + '\n' + String(error))
  }
  process.exitCode = 1
} finally {
  await writeFile(path.join(temporary, 'results.json'), JSON.stringify({ application, checks, errors }, null, 2))
  console.log(JSON.stringify({ temporary, checks, errors }, null, 2))
  if (app) await app.close()
}
