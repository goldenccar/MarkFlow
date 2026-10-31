import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import JSZip from 'jszip'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const root = process.cwd()
const { values } = parseArgs({ options: { app: { type: 'string' }, 'evidence-dir': { type: 'string' } } })
const evidence = path.resolve(values['evidence-dir'] ?? '.test-data')
await mkdir(evidence, { recursive: true })
const temporary = await mkdtemp(path.join(evidence, 'paper-mark-'))
const projects = path.join(temporary, 'projects')
await mkdir(projects)
const fixture = path.join(root, 'examples/compiler/content.json')
const fixtureBefore = await readFile(fixture, 'utf8')
const projectName = 'Mark 本地资料验收', title = 'Mark 桌面生成验收', author = '测试作者', abstract = '这段摘要来自可视化配置，必须进入实际 PDF。'
const generated = path.join(projects, projectName)
const env = { ...process.env, MARKFLOW_USER_DATA: path.join(temporary, 'profile') }
delete env.ELECTRON_RUN_AS_NODE
const checks = [], errors = []
let app, page, application
const pass = name => { checks.push(name); console.log(`PASS ${name}`) }
const pane = () => page.getByRole('region', { name: 'Fomula 文档工作区', exact: true })
const header = () => page.locator('.workspace-header')
const content = () => pane().locator('.cm-content')
const editorText = locator => locator.evaluate(element => element.cmTile.root.view.state.doc.toString())
async function replace(locator, text) {
  await locator.click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText(text)
  await expect.poll(() => editorText(locator)).toBe(text)
}
async function exportTo(kind, file) {
  await app.evaluate((_electron, destination) => { globalThis.__paperMarkOutput = destination }, file)
  const menu = pane().locator('.paper-export')
  if (!(await menu.getAttribute('open'))) await menu.locator('summary').click()
  await menu.getByRole('button', { name: kind === 'pdf' ? '导出 PDF' : '导出可复现源包', exact: true }).click()
  await expect(pane().locator('.paper-notice').filter({ hasText: '已导出' }).first()).toBeVisible({ timeout: 30000 })
  await menu.locator('summary').click()
}
async function narrow(name) {
  await page.setViewportSize({ width: 920, height: 700 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await expect.poll(() => pane().evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: path.join(temporary, name) })
  await page.setViewportSize({ width: 1440, height: 940 })
}
try {
  app = await electron.launch({ ...(values.app ? { executablePath: path.resolve(values.app), args: [] } : { args: [root] }), env })
  application = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), platform: process.platform, architecture: process.arch, resources: process.resourcesPath }))
  if (values.app) expect(application.packaged).toBe(true)
  page = await app.firstWindow()
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 940 })
  await expect(page.locator('.document-name')).toHaveText('未命名.md')
  await page.getByRole('button', { name: '源码', exact: true }).click()
  const markdown = '# 原文保留\n\nUNSAVED_MARK_SNAPSHOT 这份草稿不应被论文生成覆盖。引用 [@ref1]。\n'
  await replace(page.locator('.cm-content:visible'), markdown)
  const originalMarkdown = await editorText(page.locator('.cm-content:visible'))
  await app.evaluate(({ dialog }, inputs) => {
    globalThis.__paperMarkPickers = []
    dialog.showOpenDialog = async (...args) => {
      const options = args.at(-1), directory = options.properties?.includes('openDirectory')
      globalThis.__paperMarkPickers.push({ title: options.title, directory })
      return { canceled: false, filePaths: [directory ? inputs.projects : inputs.fixture] }
    }
    dialog.showSaveDialog = async () => ({ canceled: !globalThis.__paperMarkOutput, filePath: globalThis.__paperMarkOutput })
  }, { projects, fixture })
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
    pass('packaged application installs its bundled environment in an empty test profile')
  }
  for (const label of ['空白模板', '当前 Markdown', '本地 Mark / Markdown']) await expect(pane().getByRole('radio', { name: label, exact: true })).toBeVisible()
  await expect(pane().getByRole('radio', { name: '空白模板', exact: true })).toBeChecked()
  await pane().getByRole('radio', { name: '当前 Markdown', exact: true }).check()
  await expect(pane().getByLabel('论文摘要')).toBeVisible()
  await pane().getByRole('radio', { name: '本地 Mark / Markdown', exact: true }).check()
  await pane().getByLabel('论文项目名称', { exact: true }).fill(projectName)
  await pane().getByLabel('论文标题', { exact: true }).fill(title)
  await pane().getByLabel('论文作者', { exact: true }).fill(author)
  await pane().getByLabel('论文摘要', { exact: true }).fill(abstract)
  await pane().locator('.paper-references summary').click()
  await pane().getByRole('button', { name: '添加文献', exact: true }).click()
  for (const [label, text] of [['标识', 'ref1'], ['文献标题', 'Desktop reference'], ['作者', 'Test Author'], ['年份', '2026']]) await pane().getByLabel(`文献 1 ${label}`, { exact: true }).fill(text)
  await narrow('mark-form-narrow.png')
  pass('blank/current/local sources and metadata, abstract, references form are available without horizontal overflow')
  await pane().getByRole('button', { name: '选择位置并创建', exact: true }).click()
  await expect(content()).toBeVisible()
  await expect(header()).toHaveCount(1)
  await expect(header().locator('.document-project')).toHaveAttribute('title', generated)
  await expect(content()).toHaveAttribute('contenteditable', 'false')
  await expect(pane().getByText(/生成源码只读/)).toBeVisible()
  const generatedSource = await editorText(content())
  expect(generatedSource).toContain(title)
  expect(generatedSource).toContain(author)
  expect(generatedSource).toContain(abstract)
  await content().click(); await page.keyboard.press('End'); await page.keyboard.type('READONLY_PROBE')
  expect(await editorText(content())).toBe(generatedSource)
  const sourceMap = JSON.parse(await readFile(path.join(generated, 'markflow-source-map.json'), 'utf8'))
  expect(sourceMap.documentId).toBe(JSON.parse(fixtureBefore).documentId)
  expect(sourceMap.marks.length).toBeGreaterThan(0)
  expect(sourceMap.marks.some(mark => mark.markId === 'report-title')).toBe(true)
  expect(await readFile(path.join(generated, 'references.bib'), 'utf8')).toContain('Desktop reference')
  const generatedBefore = await readFile(path.join(generated, 'main.tex'), 'utf8')
  expect(await readFile(fixture, 'utf8')).toBe(fixtureBefore)
  pass('local Mark uses native picker, produces stable source mapping and read-only source without changing the original')

  await pane().getByRole('button', { name: '编译', exact: true }).click()
  await expect(pane().getByRole('button', { name: '取消编译', exact: true })).toBeVisible()
  await expect(pane().getByRole('button', { name: '编译', exact: true })).toBeVisible({ timeout: 120000 })
  await expect(pane().locator('.paper-notice').filter({ hasText: '编译完成' }).first()).toBeVisible()
  await expect(pane().locator('.paper-pdf-page canvas').first()).toBeVisible({ timeout: 30000 })
  expect(await pane().locator('.paper-pdf-page').count()).toBeGreaterThan(0)
  await expect.poll(() => pane().locator('.paper-pdf-page canvas').first().evaluate(canvas => canvas.width)).toBeGreaterThan(100)
  const pdfPath = path.join(temporary, 'mark-generated.pdf'), zipPath = path.join(temporary, 'mark-generated.zip')
  await exportTo('pdf', pdfPath)
  await exportTo('source', zipPath)
  const loading = getDocument({ data: new Uint8Array(await readFile(pdfPath)), useSystemFonts: false, cMapUrl: path.join(root, 'node_modules/pdfjs-dist/cmaps').replaceAll('\\', '/') + '/', cMapPacked: true, standardFontDataUrl: path.join(root, 'node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/' })
  try {
    const pdf = await loading.promise
    let text = ''
    for (let index = 1; index <= pdf.numPages; index++) text += (await (await pdf.getPage(index)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ')
    expect(text.replace(/\s/g, '')).toContain(title.replace(/\s/g, ''))
    expect(text.replace(/\s/g, '')).toContain(abstract.replace(/\s/g, ''))
  } finally { await loading.destroy() }
  const zip = await JSZip.loadAsync(await readFile(zipPath))
  for (const file of ['markflow-origin.json', 'markflow-source.json', 'markflow-source-map.json', 'markflow-presentation.json']) expect(zip.file(file)).not.toBeNull()
  expect(JSON.parse(await zip.file('markflow-source.json').async('string')).content).toBe(fixtureBefore)
  expect(JSON.parse(await zip.file('markflow-source-map.json').async('string'))).toEqual(sourceMap)
  expect(JSON.parse(await zip.file('markflow-origin.json').async('string')).hashes['main.tex']).toMatch(/^[a-f0-9]{64}$/)
  await page.screenshot({ path: path.join(temporary, 'mark-generated-pdf.png') })
  await narrow('mark-project-narrow.png')
  pass('real XeLaTeX PDF contains metadata and abstract; source ZIP retains Mark provenance and mapping')

  await pane().getByRole('button', { name: '另存为独立 LaTeX', exact: true }).click()
  await expect(content()).toHaveAttribute('contenteditable', 'true')
  await expect(pane().getByRole('button', { name: '另存为独立 LaTeX', exact: true })).toHaveCount(0)
  const detached = (await readdir(projects)).find(name => name.startsWith(`${projectName}-LaTeX-`))
  expect(detached).toBeTruthy()
  expect(await readdir(path.join(projects, detached))).not.toContain('markflow-origin.json')
  const independentSource = (await editorText(content())) + '\n% Independently edited LaTeX\n'
  await replace(content(), independentSource)
  await expect(header().locator('.document-project')).toHaveAttribute('title', path.join(projects, detached))
  await header().getByRole('button', { name: /^保存/ }).click()
  await expect.poll(() => readFile(path.join(projects, detached, 'main.tex'), 'utf8')).toBe(independentSource)
  expect(await readFile(path.join(generated, 'main.tex'), 'utf8')).toBe(generatedBefore)
  expect(await readFile(fixture, 'utf8')).toBe(fixtureBefore)
  pass('detached LaTeX can be edited and saved while both original Mark and generated source stay unchanged')

  await pane().getByRole('button', { name: '新建文档', exact: true }).click()
  await pane().getByRole('radio', { name: '当前 Markdown', exact: true }).check()
  await pane().getByLabel('论文项目名称', { exact: true }).fill('current-markdown-snapshot')
  await pane().getByRole('button', { name: '选择位置并创建', exact: true }).click()
  await expect(content()).toHaveAttribute('contenteditable', 'false')
  expect((await readFile(path.join(projects, 'current-markdown-snapshot', 'markflow-source.json'), 'utf8'))).toContain('UNSAVED_MARK_SNAPSHOT')
  await page.getByRole('tab', { name: '原文保留', exact: true }).click()
  await expect(pane()).toBeHidden()
  await expect.poll(() => editorText(page.locator('.cm-content:visible'))).toBe(originalMarkdown)
  const pickers = await app.evaluate(() => globalThis.__paperMarkPickers)
  expect(pickers.filter(picker => !picker.directory)).toHaveLength(1)
  expect(errors).toEqual([])
  pass('current Markdown generation includes unsaved content; returning to its tab preserves the original with no renderer errors')
} catch (error) {
  console.error(error)
  if (page) {
    await page.screenshot({ path: path.join(temporary, 'failure.png') }).catch(() => {})
    await writeFile(path.join(temporary, 'failure.txt'), (await page.locator('body').innerText().catch(() => '')) + '\n' + String(error))
  }
  process.exitCode = 1
} finally {
  await writeFile(path.join(temporary, 'results.json'), JSON.stringify({ temporary, application, checks, errors }, null, 2))
  console.log(JSON.stringify({ temporary, checks, errors }, null, 2))
  if (app) {
    const closed = app.waitForEvent('close', { timeout: 10000 })
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await closed
  }
}
