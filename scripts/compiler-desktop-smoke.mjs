import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import JSZip from 'jszip'
import { openLocalProject } from './ui-test-utils.mjs'
import { markdownBody, readRegistry } from './mark-test-utils.mjs'

// Real renderer -> IPC -> Worker -> compiler. Only native pickers and opening Office are replaced.
const root = process.cwd()
await mkdir(path.join(root, '.test-data'), { recursive: true })
const temporary = await mkdtemp(path.join(root, '.test-data', 'compiler-desktop-'))
const profile = path.join(temporary, 'profile'), project = path.join(temporary, 'project')
await mkdir(project)
const original = '# Desktop compiler\n\nOriginal text.\n\n| Name | Count |\n| --- | --- |\n| Alpha | 12 |\n'
const documentPath = path.join(project, 'draft.md')
await writeFile(documentPath, original)
const outputs = Object.fromEntries(['sample.docx', 'sample.pptx', 'current.docx'].map(name => [name, path.join(temporary, name)]))
const env = { ...process.env, MARKFLOW_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
const checks = [], errors = []
const pass = name => { checks.push(name); console.log(`PASS ${name}`) }
const hash = value => createHash('sha256').update(value).digest('hex')
let app, page
const dialog = () => page.getByRole('dialog', { name: '生成 Word / PPT', exact: true })
const editor = () => page.locator('.cm-content')
const draft = () => page.evaluate(async () => (await window.oops.read('draft.md')).draft?.content)
const editorText = () => editor().evaluate(element => element.cmTile.root.view.state.doc.toString())
async function savePicker(destination) {
  await app.evaluate((_electron, destination) => { globalThis.__compilerSaveDestination = destination }, destination)
}
async function openCompiler(source = '当前 Markdown', target = 'docx') {
  await page.getByRole('button', { name: '生成 Word / PPT', exact: true }).click()
  await expect(dialog()).toBeVisible()
  await dialog().getByRole('radio', { name: source, exact: true }).check()
  await dialog().getByRole('radio', { name: target === 'docx' ? /^Word 报告 \(\.docx\)/ : /^PPT 演示 \(\.pptx\)/ }).check()
  await expect(dialog().getByRole('button', { name: '选择输出位置并生成', exact: true })).toBeEnabled()
}
async function generate(destination, success = true) {
  await savePicker(destination)
  await dialog().getByRole('button', { name: '选择输出位置并生成', exact: true }).click()
  if (destination !== null) await expect(dialog().getByRole('heading', { name: success ? '生成完成' : '生成未完成', exact: true })).toBeVisible({ timeout: 60000 })
  await expect(dialog().getByRole('button', { name: '选择输出位置并生成', exact: true })).toBeEnabled({ timeout: 60000 })
}
async function closeCompiler() {
  await dialog().getByRole('button', { name: '关闭生成窗口', exact: true }).click()
  await expect(dialog()).toHaveCount(0)
}
async function replaceSource(body) {
  await editor().click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText(body)
  await expect.poll(editorText).toBe(body)
  await expect.poll(async () => markdownBody(await draft())).toBe(body)
  await expect(page.locator('.unsaved-dot')).toBeVisible()
  return draft()
}
async function preserved(snapshot) {
  expect(await draft()).toBe(snapshot)
  expect(await editorText()).toBe(markdownBody(snapshot))
  expect(await readFile(documentPath, 'utf8')).toBe(original)
  await expect(page.locator('.unsaved-dot')).toBeVisible()
}
async function inspectOutput(filename, target, text) {
  const bytes = await readFile(filename), zip = await JSZip.loadAsync(bytes)
  const manifest = JSON.parse(await zip.file('markflow/manifest.json').async('string'))
  expect(manifest.target).toBe(target)
  expect(manifest.writer.name.toLowerCase()).toContain(target === 'docx' ? 'docx' : 'pptxgenjs')
  expect(manifest.fonts.length).toBeGreaterThan(0)
  expect(manifest.inputSha256).toMatch(/^[a-f0-9]{64}$/)
  const entries = target === 'docx' ? ['word/document.xml'] : Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
  const xml = (await Promise.all(entries.map(name => zip.file(name).async('string')))).join('\n')
  expect(xml).toContain(text)
  expect(xml).not.toContain('oops:marks')
  return { bytes, zip, manifest, xml, pages: entries.length }
}

try {
  app = await electron.launch({ ...(process.env.OOPSMD_SMOKE_EXE ? { executablePath: process.env.OOPSMD_SMOKE_EXE, args: [] } : { args: [root] }), env })
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message))
  await expect(page.locator('.document-name')).toHaveText('未命名.md')
  await app.evaluate(({ dialog, shell }, project) => {
    globalThis.__compilerSaveDestination = null
    globalThis.__compilerSaveCalls = []
    globalThis.__compilerShellCalls = []
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] })
    dialog.showSaveDialog = async (...args) => {
      globalThis.__compilerSaveCalls.push(args.at(-1))
      const filePath = globalThis.__compilerSaveDestination
      return filePath ? { canceled: false, filePath } : { canceled: true }
    }
    shell.openPath = async filePath => { globalThis.__compilerShellCalls.push({ action: 'open', path: filePath }); return '' }
    shell.showItemInFolder = filePath => { globalThis.__compilerShellCalls.push({ action: 'reveal', path: filePath }) }
  }, project)
  await openLocalProject(page)
  await page.locator('.tree-scroll').getByRole('button', { name: 'draft.md', exact: true }).click()
  await page.getByRole('button', { name: '源码', exact: true }).click()
  await expect(editor()).toHaveAttribute('contenteditable', 'true')
  const snapshot = await replaceSource(original + '\nELECTRON_UNSAVED_SNAPSHOT')

  await openCompiler()
  const beforeCancel = await app.evaluate(() => globalThis.__compilerSaveCalls.length)
  await generate(null)
  await expect.poll(() => app.evaluate(() => globalThis.__compilerSaveCalls.length)).toBe(beforeCancel + 1)
  await expect(dialog()).toBeVisible()
  await closeCompiler(); await preserved(snapshot)
  pass('cancelled native output picker preserves the dirty editor, recovery snapshot and original file')

  await openCompiler()
  await dialog().locator('.compiler-advanced > summary').click()
  const fontName = dialog().getByRole('textbox', { name: '字体名称', exact: true })
  await fontName.focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText('Microsoft YaHei QA')
  await expect(fontName).toHaveValue('Microsoft YaHei QA')
  for (const [label, expected] of [['撤销', 'Microsoft YaHei'], ['重做', 'Microsoft YaHei QA']]) {
    await app.evaluate(({ Menu }, label) => {
      const action = Menu.getApplicationMenu().items.find(item => item.label === '编辑').submenu.items.find(item => item.label === label)
      action.click()
    }, label)
    await expect(fontName).toHaveValue(expected)
    await preserved(snapshot)
  }
  await closeCompiler()
  pass('native menu undo and redo edit only the focused compiler input, preserving the underlying document and recovery snapshot')

  await openCompiler('内置示例')
  await generate(outputs['sample.docx'])
  const word = await inspectOutput(outputs['sample.docx'], 'docx', '12 个城市')
  expect(word.xml).toContain('<w:tbl>'); expect(Object.keys(word.zip.files).some(name => name.startsWith('word/media/'))).toBe(true)
  await dialog().getByRole('button', { name: '打开生成文件', exact: true }).click()
  await dialog().getByRole('button', { name: '打开所在文件夹', exact: true }).click()
  expect(await app.evaluate(() => globalThis.__compilerShellCalls)).toEqual([{ action: 'open', path: outputs['sample.docx'] }, { action: 'reveal', path: outputs['sample.docx'] }])
  await closeCompiler(); await preserved(snapshot)
  pass('built-in Word sample compiles through the real worker with native objects; open/reveal use only the successful artifact')

  await openCompiler('内置示例', 'pptx')
  await generate(outputs['sample.pptx'])
  const slides = await inspectOutput(outputs['sample.pptx'], 'pptx', '12 个城市')
  expect(slides.pages).toBe(4); expect(slides.xml).toContain('<a:tbl>'); expect(slides.xml).toContain('<p:pic>')
  await page.screenshot({ path: path.join(temporary, 'compiler-success.png'), animations: 'disabled' })
  await closeCompiler(); await preserved(snapshot)
  pass('built-in presentation compiles into four editable slides without altering the active draft')

  await openCompiler()
  await generate(outputs['current.docx'])
  const current = await inspectOutput(outputs['current.docx'], 'docx', 'ELECTRON_UNSAVED_SNAPSHOT')
  expect(current.xml).toContain('Original text.')
  expect(current.manifest.documentId).toBe(readRegistry(snapshot).documentId)
  expect(current.manifest.revision).toBe(readRegistry(snapshot).revision)
  await closeCompiler(); await preserved(snapshot)
  pass('current Markdown exports the unsaved snapshot and leaves dirty state, source bytes and recovery identity intact')

  const mathSnapshot = await replaceSource('# Unsupported math\n\nInline $x^2$ remains in the source.')
  await openCompiler()
  await generate(outputs['current.docx'], false)
  await expect(dialog()).toContainText('MARKDOWN_UNSUPPORTED_INLINE')
  expect(hash(await readFile(outputs['current.docx']))).toBe(hash(current.bytes))
  await dialog().getByRole('button', { name: '定位当前文档 Mark', exact: true }).click()
  await expect(dialog()).toHaveCount(0)
  await expect(editor()).toBeFocused()
  await preserved(mathSnapshot)
  pass('unsupported math returns a visible diagnostic and preserves the previous complete Word artifact plus its embedded manifest')

  const overflowSnapshot = await replaceSource('# Overflow\n\n' + 'This paragraph must not be silently truncated. '.repeat(100))
  await openCompiler('当前 Markdown', 'pptx')
  await generate(outputs['sample.pptx'], false)
  await expect(dialog()).toContainText('LAYOUT_OVERFLOW')
  expect(hash(await readFile(outputs['sample.pptx']))).toBe(hash(slides.bytes))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 620))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: path.join(temporary, 'compiler-diagnostics-920.png'), animations: 'disabled' })
  await closeCompiler(); await preserved(overflowSnapshot)
  pass('presentation overflow is actionable at compact size and leaves the existing presentation and dirty source unchanged')

  expect(errors).toEqual([])
  console.log(JSON.stringify({ ok: true, checks, temporary, outputs, errors }, null, 2))
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(temporary, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(JSON.stringify({ ok: false, checks, temporary, errors, error: String(error) }, null, 2))
  throw error
} finally {
  if (app) { const closed = app.waitForEvent('close', { timeout: 10000 }); await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await closed.catch(() => {}) }
}
