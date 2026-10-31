import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'

const root = process.cwd()
const { values } = parseArgs({ options: { app: { type: 'string' }, 'evidence-dir': { type: 'string' } } })
const evidence = path.resolve(values['evidence-dir'] ?? 'D:/MarkFlow-Projects-20261031')
await mkdir(evidence, { recursive: true })
const temporary = await mkdtemp(path.join(evidence, 'project-workspace-'))
const firstRoot = path.join(temporary, 'Shared project A'), secondRoot = path.join(temporary, 'Shared project B')
await mkdir(path.join(firstRoot, 'sections'), { recursive: true }); await mkdir(path.join(firstRoot, 'notes'))
await mkdir(secondRoot)
const manuscript = '\\documentclass{article}\n\\begin{document}\nShared project acceptance.\n\\newpage\nSecond page.\n\\end{document}\n'
await Promise.all([
  writeFile(path.join(firstRoot, 'readme.md'), '# Shared project\n\nMarkdown and LaTeX share this folder.\n'),
  writeFile(path.join(firstRoot, 'main.tex'), manuscript),
  writeFile(path.join(firstRoot, 'sections', 'introduction.tex'), 'Original section.\n'),
  writeFile(path.join(firstRoot, 'references.bib'), '@book{example, title={Shared bibliography}, year={2026}}\n'),
  writeFile(path.join(firstRoot, 'disposable.tex'), 'Disposable acceptance fixture.\n'),
  writeFile(path.join(secondRoot, 'note.md'), '# Second project\n'),
])
const env = { ...process.env, MARKFLOW_USER_DATA: path.join(temporary, 'profile') }
delete env.ELECTRON_RUN_AS_NODE
const checks = [], errors = [], headers = [], geometry = []
let app, page
const pass = message => { checks.push(message); console.log(`PASS ${message}`) }
const sidebar = () => page.locator('.workspace-sidebar:visible')
const pane = () => page.getByRole('region', { name: 'Fomula 文档工作区', exact: true })
const source = () => page.locator('.cm-content:visible')
const sourceText = () => source().evaluate(element => element.cmTile.root.view.state.doc.toString())
async function replace(text) { await source().click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText(text); await expect.poll(sourceText).toBe(text) }
async function chooseDirectory(directory) { await app.evaluate((_electron, value) => { globalThis.__workspaceDirectory = value }, directory) }
async function addProject(directory) {
  await chooseDirectory(directory)
  await sidebar().getByRole('button', { name: '添加项目', exact: true }).click()
  await page.getByRole('dialog', { name: '添加项目', exact: true }).getByRole('button', { name: /^打开本地项目/ }).click()
  await expect(page.getByRole('dialog', { name: '添加项目', exact: true })).toHaveCount(0)
}
async function openProject(name) { await sidebar().getByRole('button', { name: `打开项目 ${name}`, exact: true }).click(); await expect(sidebar().locator('.project-item.active')).toContainText(name) }
async function idle() { await expect(page.locator('.navigation-shield')).toHaveCount(0) }
async function openFile(relative) { await sidebar().locator('.tree-scroll').getByRole('button', { name: path.posix.basename(relative), exact: true }).click(); await idle() }
async function header(mode) {
  const host = page.locator('.workspace-header:visible')
  await expect(host).toHaveCount(1)
  const buttons = await host.locator('button').evaluateAll(nodes => nodes.map(node => (node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim()))
  expect(buttons).toHaveLength(4)
  expect(buttons[0]).toBe('打开文件'); expect(buttons[1]).toMatch(/^主题：/); expect(buttons[2]).toBe('版本历史'); expect(buttons[3]).toMatch(/^保存/)
  expect((await host.boundingBox()).height).toBe(44)
  expect(buttons.some(name => /编译|导出/.test(name))).toBe(false)
  headers.push({ mode, buttons }); return buttons
}
async function renameFile(relative, destination) {
  await fileMenu(relative, '重命名')
  const dialog = page.getByRole('dialog', { name: '重命名', exact: true })
  await dialog.getByRole('textbox', { name: '重命名', exact: true }).fill(destination)
  await dialog.getByRole('button', { name: '确定', exact: true }).click()
  await idle()
  await expect.poll(() => stat(path.join(firstRoot, destination)).then(() => true, () => false)).toBe(true)
}
async function screenshot(name) {
  await idle()
  await page.waitForTimeout(200) // The workspace and page-settings transitions finish within 180ms.
  await page.screenshot({ path: path.join(temporary, name) })
}
async function dropDiskFile(filename) {
  await page.evaluate(() => { const input = document.createElement('input'); input.id = '__diskDropFixture'; input.type = 'file'; input.hidden = true; document.body.append(input) })
  const input = page.locator('#__diskDropFixture')
  await input.setInputFiles(filename)
  await input.evaluate(element => {
    const transfer = new DataTransfer()
    transfer.items.add(element.files[0])
    document.querySelector('.app').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    element.remove()
  })
  await idle()
}
async function setTheme(theme) {
  await page.locator('.workspace-header:visible').getByRole('button', { name: /^主题：/ }).click()
  await page.getByRole('menu', { name: '主题', exact: true }).getByRole('menuitemradio', { name: theme === 'light' ? '浅色' : '深色', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  await page.waitForTimeout(200)
}
async function compile() {
  const trust = pane().getByRole('button', { name: '信任并启用本地编译', exact: true })
  await expect(pane().locator('.paper-source-editor .cm-content')).toBeVisible()
  await expect.poll(async () => await trust.isVisible() || await pane().getByRole('button', { name: '编译', exact: true }).isEnabled()).toBe(true)
  if (await trust.isVisible()) await trust.click()
  await pane().getByRole('button', { name: '编译', exact: true }).click()
  await expect(pane().getByRole('button', { name: '取消编译', exact: true })).toBeVisible()
  await expect(pane().getByRole('button', { name: '编译', exact: true })).toBeVisible({ timeout: 120000 })
  await expect(pane().locator('.paper-pdf-page canvas').first()).toBeVisible({ timeout: 30000 })
  await expect(pane().locator('.paper-pdf-page')).toHaveCount(2)
}
async function fileMenu(relative, action, archived = false) {
  const tree = archived ? sidebar().getByLabel('归档树', { exact: true }) : sidebar().locator('.tree-scroll')
  await tree.getByRole('button', { name: path.posix.basename(relative), exact: true }).click({ button: 'right' })
  await page.getByRole('menu', { name: '文件操作', exact: true }).getByRole('menuitem', { name: action, exact: true }).click()
}
async function assertProjectsAndTree() {
  await expect(sidebar()).toHaveCount(1)
  await expect(sidebar().locator('.project-row')).toHaveCount(2)
  for (const name of ['Shared project A', 'Shared project B']) await expect(sidebar().getByRole('button', { name: `打开项目 ${name}`, exact: true })).toBeVisible()
  for (const name of ['readme.md', 'main.tex', 'references.bib', 'sections', 'notes']) await expect(sidebar().locator('.tree-scroll').getByRole('button', { name, exact: true })).toBeVisible()
}
try {
  app = await electron.launch({ ...(values.app ? { executablePath: path.resolve(values.app), args: [] } : { args: [root] }), env })
  page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(page.locator('.app')).toBeVisible()
  await app.evaluate(({ dialog }, destination) => {
    globalThis.__workspaceDirectory = destination
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__workspaceDirectory] })
    dialog.showSaveDialog = async () => ({ canceled: true })
  }, firstRoot)
  await addProject(firstRoot); await addProject(secondRoot); await openProject('Shared project A')
  await openFile('readme.md')
  await expect(page.getByRole('textbox', { name: '文档内容', exact: true })).toContainText('Markdown and LaTeX')
  await assertProjectsAndTree()
  const normalHeader = await header('markdown')
  await openFile('main.tex'); await expect(pane()).toBeVisible(); await expect.poll(sourceText).toBe(manuscript)
  await assertProjectsAndTree(); expect(await header('latex')).toEqual(normalHeader)
  await expect(page.locator('.workspace-editor-toolbar:visible').getByRole('button', { name: '编译', exact: true })).toBeVisible()
  pass('Markdown and full TeX use one system project list, file tree and app header; compilation stays in the second toolbar')

  const draft = manuscript.replace('Shared project acceptance.', 'DRAFT RETAINED ACROSS PROJECTS.')
  await replace(draft)
  await dropDiskFile(path.join(secondRoot, 'note.md'))
  await expect(pane()).toBeHidden()
  await expect(sidebar().locator('.project-item.active')).toContainText('Shared project B')
  const droppedEditor = page.getByRole('textbox', { name: '文档内容', exact: true })
  await expect(droppedEditor).toContainText('Second project')
  await droppedEditor.click(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.press('Enter'); await page.keyboard.insertText('DROP SAVED IN PROJECT B')
  await page.locator('.workspace-header:visible').getByRole('button', { name: /^保存/ }).click()
  await expect.poll(() => readFile(path.join(secondRoot, 'note.md'), 'utf8')).toContain('DROP SAVED IN PROJECT B')
  expect(await readFile(path.join(firstRoot, 'main.tex'), 'utf8')).toBe(manuscript)
  await openProject('Shared project A'); await openFile('main.tex'); await expect.poll(sourceText).toBe(draft)
  pass('Dropping a real file from project B while Paper A is active switches to B Markdown and saves only to B, retaining the A draft')
  await openProject('Shared project B'); await openFile('note.md')
  await expect(page.getByRole('textbox', { name: '文档内容', exact: true })).toContainText('Second project')
  await openProject('Shared project A'); await openFile('main.tex')
  await expect(pane()).toBeVisible(); await expect.poll(sourceText).toBe(draft)
  expect(await readFile(path.join(firstRoot, 'main.tex'), 'utf8')).toBe(manuscript)
  pass('Switching system projects retains the unsaved TeX draft without overwriting the original file')

  await openFile('references.bib'); await expect(pane()).toBeVisible()
  await expect.poll(sourceText).toContain('@book{example')
  await sidebar().locator('.tree-scroll').getByRole('button', { name: 'sections', exact: true }).click()
  await openFile('sections/introduction.tex')
  const sectionDraft = 'Section draft survives moving.\n'
  await replace(sectionDraft)
  await sidebar().locator('.tree-scroll').getByRole('button', { name: 'introduction.tex', exact: true }).dragTo(sidebar().locator('.tree-scroll').getByRole('button', { name: 'notes', exact: true }))
  await expect.poll(() => stat(path.join(firstRoot, 'notes', 'introduction.tex')).then(() => true, () => false)).toBe(true)
  await expect.poll(sourceText).toBe(sectionDraft)
  await renameFile('notes/introduction.tex', 'notes/renamed-intro.tex')
  await expect.poll(sourceText).toBe(sectionDraft)
  await source().click(); await page.keyboard.press('ControlOrMeta+Z')
  await expect.poll(sourceText).toBe('Original section.\n')
  await page.keyboard.press('ControlOrMeta+Shift+Z'); await expect.poll(sourceText).toBe(sectionDraft)
  await page.locator('.workspace-header:visible').getByRole('button', { name: /^保存/ }).click()
  await expect.poll(() => readFile(path.join(firstRoot, 'notes', 'renamed-intro.tex'), 'utf8')).toBe(sectionDraft)
  pass('Shared navigation opens bibliography and sections; moving and renaming an edited TeX file preserves its undo, redo and save target')

  await fileMenu('references.bib', '归档')
  await expect(sidebar().locator('.tree-scroll').getByRole('button', { name: 'references.bib', exact: true })).toHaveCount(0)
  await sidebar().getByRole('button', { name: '归档', exact: true }).click()
  await expect(sidebar().getByLabel('归档树', { exact: true }).getByRole('button', { name: 'references.bib', exact: true })).toBeVisible()
  await fileMenu('references.bib', '恢复到工作树', true)
  await expect(sidebar().locator('.tree-scroll').getByRole('button', { name: 'references.bib', exact: true })).toBeVisible()
  await fileMenu('disposable.tex', '移到回收站')
  await page.getByRole('dialog', { name: '移到回收站', exact: true }).getByRole('button', { name: '移到回收站', exact: true }).click()
  await expect.poll(() => stat(path.join(firstRoot, 'disposable.tex')).then(() => true, () => false)).toBe(false)
  await expect.poll(sourceText).toBe(sectionDraft)
  pass('The shared file menu archives and restores resources and trashes only the selected test file')

  await openFile('main.tex')
  await renameFile('main.tex', 'renamed-main.tex')
  await expect.poll(sourceText).toBe(draft)
  await pane().getByLabel('编译选项', { exact: true }).click()
  await expect(pane().getByLabel('论文主文件', { exact: true })).toHaveValue('renamed-main.tex')
  await pane().getByLabel('编译选项', { exact: true }).click()
  await compile()
  pass('Renaming the main document updates the compiler target and produces a real two-page PDF')
  const longerDraft = draft.replace('DRAFT RETAINED ACROSS PROJECTS.', 'A longer edited paragraph compiled before saving must keep its exact current PDF preview after the file watcher refreshes.')
  await replace(longerDraft); await compile()
  const previewStatus = pane().locator('.paper-preview-state')
  await expect(previewStatus).toContainText('已更新')
  const originalPreviewStatus = await previewStatus.textContent()
  await page.evaluate(() => {
    globalThis.__saveWatchEvents = 0; globalThis.__savedPreviewStale = false
    globalThis.__savedPreviewNode = document.querySelector('.paper-pdf-page canvas')
    globalThis.__stopSaveWatchProbe = window.oops.onFilesChanged(() => globalThis.__saveWatchEvents++)
    globalThis.__savePreviewObserver = new MutationObserver(() => { if (document.querySelector('.paper-preview-state')?.textContent.includes('预览尚未更新')) globalThis.__savedPreviewStale = true })
    globalThis.__savePreviewObserver.observe(document.querySelector('.paper-preview-state'), { subtree: true, childList: true, characterData: true })
  })
  await page.locator('.workspace-header:visible').getByRole('button', { name: /^保存/ }).click()
  await expect.poll(() => readFile(path.join(firstRoot, 'renamed-main.tex'), 'utf8')).toBe(longerDraft)
  await expect.poll(() => page.evaluate(() => globalThis.__saveWatchEvents)).toBeGreaterThan(0)
  await page.waitForTimeout(1000) // Observe the real file watcher and its asynchronous project refresh.
  expect(await previewStatus.textContent()).toBe(originalPreviewStatus)
  const savedPreview = await page.evaluate(() => {
    globalThis.__stopSaveWatchProbe(); globalThis.__savePreviewObserver.disconnect()
    return { stale: globalThis.__savedPreviewStale, sameNode: globalThis.__savedPreviewNode === document.querySelector('.paper-pdf-page canvas') }
  })
  expect(savedPreview).toEqual({ stale: false, sameNode: true })
  pass('Saving a different-length source after compilation keeps the PDF current and preserves its canvas through the real file watcher')
  await replace(draft); await page.locator('.workspace-header:visible').getByRole('button', { name: /^保存/ }).click()
  await expect.poll(() => readFile(path.join(firstRoot, 'renamed-main.tex'), 'utf8')).toBe(draft)
  await source().evaluate(element => { globalThis.__projectEditorNode = element; globalThis.__projectPdfNode = document.querySelector('.paper-pdf-page canvas') })
  const diskUpdate = draft.replace('DRAFT RETAINED ACROSS PROJECTS.', 'EXTERNAL CLEAN CHANGE.')
  await writeFile(path.join(firstRoot, 'renamed-main.tex'), diskUpdate)
  await expect.poll(sourceText, { timeout: 20000 }).toBe(diskUpdate)
  expect(await source().evaluate(element => globalThis.__projectEditorNode === element && globalThis.__projectPdfNode === document.querySelector('.paper-pdf-page canvas'))).toBe(true)
  const localEdit = diskUpdate.replace('EXTERNAL CLEAN CHANGE.', 'LOCAL UNSAVED EDIT.'), conflictingDisk = diskUpdate.replace('EXTERNAL CLEAN CHANGE.', 'EXTERNAL CONFLICTING EDIT.')
  await replace(localEdit); await writeFile(path.join(firstRoot, 'renamed-main.tex'), conflictingDisk)
  await expect(pane().locator('.paper-draft-conflict')).toBeVisible()
  await expect.poll(sourceText).toBe(localEdit)
  await page.locator('.workspace-header:visible').getByRole('button', { name: /^保存/ }).click()
  await expect(pane().locator('.paper-error')).toContainText('核对')
  expect(await readFile(path.join(firstRoot, 'renamed-main.tex'), 'utf8')).toBe(conflictingDisk)
  await screenshot('shared-project-disk-conflict.png')
  await replace(draft)
  await pane().getByRole('button', { name: '已核对合并，允许保存当前内容', exact: true }).click()
  await page.locator('.workspace-header:visible').getByRole('button', { name: /^保存/ }).click()
  await expect.poll(() => readFile(path.join(firstRoot, 'renamed-main.tex'), 'utf8')).toBe(draft)
  pass('External clean edits refresh the same editor and PDF nodes; conflicting disk edits preserve the local buffer and block saving until explicitly reconciled')
  await sidebar().getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('complementary', { name: '设置', exact: true })
  await settings.getByRole('button', { name: '自动补全', exact: true }).click()
  await settings.getByLabel('补全适用页面', { exact: true }).selectOption('latex')
  await settings.getByRole('button', { name: '添加', exact: true }).click()
  await settings.getByLabel('自定义补全触发词', { exact: true }).fill('shared')
  await settings.getByLabel('自定义补全插入内容', { exact: true }).fill('SHARED_COMPLETION')
  await settings.getByRole('button', { name: '保存规则', exact: true }).click()
  await expect(settings.getByRole('form')).toHaveCount(0)
  await settings.getByRole('button', { name: '关闭面板', exact: true }).click()
  await replace('/shared'); await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible(); await page.keyboard.press('Tab')
  await expect.poll(sourceText).toBe('SHARED_COMPLETION'); await replace(draft)
  await pane().getByRole('button', { name: '页面设置', exact: true }).click()
  const config = pane().getByRole('region', { name: '页面设置', exact: true })
  await config.getByLabel('上边距（毫米）', { exact: true }).fill('29'); await page.keyboard.press('Escape')
  await expect(pane().locator('#paper-page-config')).toBeHidden()
  await expect(pane().getByRole('button', { name: '页面设置', exact: true })).toBeFocused()
  await pane().getByRole('button', { name: '页面设置', exact: true }).click()
  await expect(config.getByLabel('上边距（毫米）', { exact: true })).toHaveValue('29')
  await config.getByRole('button', { name: '关闭页面设置', exact: true }).click()
  await expect(pane().locator('#paper-page-config')).toBeHidden()
  await expect.poll(sourceText).toBe(draft)
  pass('Shared settings completion and page-settings Escape, focus return and unapplied values remain functional')
  await screenshot('shared-project-latex.png')
  await openFile('readme.md'); await screenshot('shared-project-markdown.png')

  await page.getByRole('button', { name: '新建标签', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Fomula/ }).click()
  await pane().getByRole('button', { name: '公式片段', exact: true }).click()
  await expect(pane()).toBeHidden(); await replace('x^2 + y^2 = 1')
  expect(await header('formula')).toEqual(normalHeader)
  const formulaTab = await page.getByRole('tab', { selected: true }).getAttribute('aria-label')
  await openFile('renamed-main.tex'); await expect(pane()).toBeVisible(); await compile()
  for (const theme of ['light', 'dark']) for (const width of [1440, 1100, 920]) for (const mode of ['markdown', 'formula', 'latex']) {
    if (mode === 'markdown') await page.getByRole('tab', { name: 'readme.md', exact: true }).click()
    else if (mode === 'formula') await page.getByRole('tab', { name: formulaTab, exact: true }).click()
    else await page.getByRole('tab', { name: 'Fomula', exact: true }).click()
    await idle(); await page.setViewportSize({ width, height: 920 }); await setTheme(theme)
    await header(`${mode}-${width}-${theme}`)
    const dimensions = await page.evaluate(() => {
      const visible = selector => [...document.querySelectorAll(selector)].find(element => element.getBoundingClientRect().width > 0)
      const size = element => ({ height: element.getBoundingClientRect().height, width: element.getBoundingClientRect().width, overflow: element.scrollWidth - element.clientWidth })
      return { header: size(visible('.workspace-header')), toolbar: size(visible('.workspace-editor-toolbar')), sidebar: size(visible('.workspace-sidebar')), pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }
    })
    expect(dimensions.header.height).toBe(44); expect(dimensions.pageOverflow).toBeLessThanOrEqual(1)
    for (const element of [dimensions.header, dimensions.toolbar, dimensions.sidebar]) expect(element.overflow).toBeLessThanOrEqual(1)
    geometry.push({ mode, theme, width, ...dimensions })
    await screenshot(`${mode}-${width}-${theme}.png`)
  }
  pass('All three engines retain four app-bar actions in the same order and a 44px header; 18 theme/viewport combinations have no horizontal overflow')
  await page.setViewportSize({ width: 1440, height: 1000 }); await setTheme('light'); await openFile('readme.md')

  await chooseDirectory(temporary)
  await page.getByRole('button', { name: '新建标签', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Fomula/ }).click()
  await pane().getByRole('radio', { name: '当前 Markdown', exact: true }).check()
  await pane().getByRole('radio', { name: /英文单栏/ }).check()
  await pane().getByLabel('论文项目名称', { exact: true }).fill('Readonly generated fixture')
  await pane().getByRole('button', { name: '选择位置并创建', exact: true }).click()
  await expect(source()).toBeVisible()
  await expect(pane()).toContainText('生成源码只读')
  await expect(sidebar().getByRole('button', { name: '打开项目 Readonly generated fixture', exact: true })).toBeVisible()
  await expect(sidebar().getByRole('button', { name: '新建文件夹', exact: true })).toBeDisabled()
  await sidebar().locator('.tree-scroll').getByRole('button', { name: 'main.tex', exact: true }).click({ button: 'right' })
  const readonlyMenu = page.getByRole('menu', { name: '文件操作', exact: true })
  for (const action of ['重命名', '移到回收站']) await expect(readonlyMenu.getByRole('menuitem', { name: action, exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  const protectedRoot = path.join(temporary, 'Readonly generated fixture'), originalGenerated = await readFile(path.join(protectedRoot, 'main.tex'), 'utf8')
  for (const operation of ['save', 'move', 'remove', 'create']) {
    const result = await page.evaluate(async operation => {
      try {
        if (operation === 'save') { const opened = await window.oops.read('main.tex'); await window.oops.save({ path: 'main.tex', content: 'MUST_NOT_WRITE', revision: opened.file.revision }) }
        if (operation === 'move') await window.oops.move('main.tex', 'renamed.tex')
        if (operation === 'remove') await window.oops.remove('main.tex')
        if (operation === 'create') await window.oops.create('extra.tex', false)
        return { rejected: false, message: '' }
      } catch (error) { return { rejected: true, message: String(error) } }
    }, operation)
    expect(result.rejected, `Generated-source ${operation} must also be blocked at the shared API`).toBe(true)
    expect(result.message).toMatch(/只读|Mark|生成/)
    expect(await readFile(path.join(protectedRoot, 'main.tex'), 'utf8')).toBe(originalGenerated)
  }
  pass('Mark-generated projects join the system list while UI and shared write/move/remove/create APIs retain generated-source protection')
  await screenshot('shared-project-readonly.png')
  await sidebar().locator('.project-outline').getByRole('button').first().click()
  await pane().getByRole('button', { name: '定位原文 Mark', exact: true }).click()
  await expect(pane()).toBeHidden()
  await expect(page.getByRole('textbox', { name: '文档内容', exact: true })).toContainText('Markdown and LaTeX')
  await expect(sidebar().locator('.project-item.active')).toContainText('Shared project A')
  pass('Generated LaTeX can locate its source Mark by restoring the original Markdown tab and system project')
  expect(errors).toEqual([])
  pass('No renderer errors occurred during shared-project navigation and file operations')
} catch (error) {
  console.error(error); process.exitCode = 1
  if (page) { await page.screenshot({ path: path.join(temporary, 'failure.png') }).catch(() => {}); await writeFile(path.join(temporary, 'failure.txt'), (await page.locator('body').innerText().catch(() => '')) + '\n' + String(error)) }
} finally {
  await writeFile(path.join(temporary, 'results.json'), JSON.stringify({ checks, errors, headers, geometry }, null, 2))
  console.log(JSON.stringify({ temporary, checks, errors }, null, 2))
  if (app) { const closed = app.waitForEvent('close').catch(() => {}); await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await closed }
}
