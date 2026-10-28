import { newDocument, showBlockInspector, applyToolbarFormat } from './ui-test-utils.mjs'
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
await mkdir(path.join(root, '.test-data'), { recursive: true })
const temporary = await mkdtemp(path.join(root, '.test-data', 'rich-')), library = path.join(temporary, 'library')
await mkdir(library)
const complex = '# Rich heading\r\n\r\nParagraph with **bold** and [reference][target].\r\n\r\n- one\r\n- two\r\n\r\n- [x] checked\r\n- [ ] pending\r\n\r\n| A | B |\r\n| --- | --- |\r\n| cell | value |\r\n\r\n```js meta=value\r\nconst original = 1\r\n```\r\n\r\n$$\r\nx^2\r\n$$\r\n\r\nInline $a+b$ plus ![blocked](https://example.invalid/pixel.png).\r\n\r\n<!-- keep exact -->\r\n\r\n<div data-special="yes">untouched HTML</div>\r\n\r\n[target]: other.md#destination\r\n\r\n[^note]: original footnote\r\n\r\nFootnote[^note].\r\n\r\n'
await writeFile(path.join(library, 'complex.md'), complex)
await writeFile(path.join(library, 'other.md'), '# Destination\n\nLocal link opened.\n')
await writeFile(path.join(library, 'empty.md'), '')
await writeFile(path.join(library, 'formula.tex'), 'x^2')
await writeFile(path.join(library, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lNcAAAAASUVORK5CYII=', 'base64'))
const firstPath = path.join(library, 'first.md')
const env = { ...process.env, MARKFLOW_USER_DATA: path.join(temporary, 'profile') }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ ...(process.env.OOPSMD_SMOKE_EXE ? { executablePath: process.env.OOPSMD_SMOKE_EXE, args: [] } : { args: [root] }), env })
const errors = [], consoleErrors = [], checks = []
const passed = name => { checks.push(name); console.log('PASS ' + name) }
const body = source => {
  const index = source.lastIndexOf('<!-- oops:marks ')
  if (index < 0) return source
  const separator = /(?:\r?\n){2}$/.exec(source.slice(0, index))
  if (!separator) return source
  const footer = source.slice(index).trimEnd()
  const metadata = JSON.parse(footer.slice('<!-- oops:marks '.length, -4))
  expect(metadata.v).toBe(1); expect(metadata.complete).toBe(true)
  expect(new Set(metadata.marks.map(mark => mark.id)).size).toBe(metadata.marks.length)
  return source.slice(0, index - separator[0].length)
}
try {
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(({ clipboard, dialog, BrowserWindow }, filename) => {
    globalThis.__copied = []; clipboard.writeText = async value => { globalThis.__copied.push(value) }
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename })
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 940)
  }, firstPath)
  const rich = page.locator('.rich-editor .tiptap'), source = page.locator('.cm-content:visible')
  const saveButton = page.getByRole('button', { name: /^保存(?: (?:Ctrl|⌘) S)?$/ })
  const ready = async () => { await expect(page.locator('.navigation-shield')).toHaveCount(0); await expect(saveButton).toBeEnabled() }
  const save = async (filename, expected) => {
    await ready(); await saveButton.click()
    if (expected !== undefined) await expect.poll(() => readFile(filename, 'utf8').then(body).catch(() => null)).toBe(expected)
    await expect(page.locator('.unsaved-dot')).toHaveCount(0); await ready()
    return readFile(filename, 'utf8').then(body)
  }
  const open = async name => { await page.locator('.tree-scroll').getByRole('button', { name, exact: true }).click(); await ready(); await expect(page.locator('.document-name')).toHaveText(name) }
  const selectText = async text => {
    await rich.focus()
    await rich.evaluate((element, text) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode())) {
        const index = node.textContent.indexOf(text)
        if (index < 0 || node.parentElement.closest('[contenteditable="false"]')) continue
        const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + text.length)
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); return
      }
      throw new Error('Text not selectable: ' + text)
    }, text)
    await page.waitForTimeout(60)
  }

  await ready(); await expect(rich).toBeVisible(); await expect(source).toHaveCount(0)
  await showBlockInspector(page)
  await rich.focus(); await page.keyboard.insertText('Alpha'); await page.keyboard.press('Enter')
  await expect(page.getByLabel('文档 Mark').getByRole('button', { name: /空白 Mark/ })).toBeVisible()
  await page.keyboard.insertText('Beta'); await page.keyboard.press('Shift+Enter'); await page.keyboard.insertText('Gamma')
  const initial = 'Alpha\n\nBeta\\\nGamma'
  await save(firstPath, initial)
  await expect(rich.locator('p')).toHaveCount(2); await expect(rich.locator('br')).toHaveCount(1)
  passed('default surface is true contenteditable paragraphs; Enter and Shift+Enter save exact Markdown')

  await page.getByRole('button', { name: '源码', exact: true }).click(); await expect(source).toBeVisible()
  await page.getByLabel('文档 Mark').getByRole('button', { name: /^跳转 Mark \d+ Alpha$/ }).click()
  await page.getByRole('button', { name: '实时预览', exact: true }).click(); await expect(rich).toBeVisible()
  await page.getByLabel('文档 Mark').getByRole('button', { name: /^跳转 Mark \d+ Beta Gamma$/ }).click()
  await expect(page.locator('.font-control')).toHaveAttribute('title', '当前 Mark：BetaGamma')
  await page.getByRole('button', { name: '源码', exact: true }).click(); await expect(source).toBeVisible()
  await expect(page.locator('.font-control')).toHaveAttribute('title', '当前 Mark：Beta Gamma')
  await source.focus(); await page.keyboard.press('Home')
  for (let index = 0; index < 4; index++) await page.keyboard.press('ArrowRight')
  await page.keyboard.insertText('!')
  await save(firstPath, initial.replace('Beta', 'Beta!'))
  await source.focus(); await page.keyboard.press('ControlOrMeta+z'); await save(firstPath, initial)
  await page.getByLabel('文档 Mark').getByRole('button', { name: /^跳转 Mark \d+ Alpha$/ }).click()
  await page.getByRole('button', { name: '实时预览', exact: true }).click(); await expect(rich).toBeVisible()
  await expect(page.locator('.font-control')).toHaveAttribute('title', '当前 Mark：Alpha')
  passed('switching surfaces without edits follows the current Mark and never edits a stale source selection')

  await selectText('Alpha'); await applyToolbarFormat(page, '加粗')
  await expect(rich.locator('strong')).toHaveText('Alpha')
  const bold = '**Alpha**\n\nBeta\\\nGamma'
  await save(firstPath, bold)
  await expect(rich).not.toContainText('**')
  await rich.focus(); await page.keyboard.press('ControlOrMeta+z'); await save(firstPath, initial)
  await rich.focus(); await page.keyboard.press('ControlOrMeta+Shift+Z'); await save(firstPath, bold)
  for (const [label, tag] of [['下划线', 'u'], ['删除线', 's'], ['斜体', 'em'], ['上标', 'sup'], ['下标', 'sub'], ['荧光笔', 'mark']]) {
    await selectText('Alpha'); await applyToolbarFormat(page, label); await expect(rich.locator(tag)).toContainText('Alpha')
  }
  const formatted = await save(firstPath)
  await page.getByRole('button', { name: '源码', exact: true }).click(); await expect(source).toBeVisible()
  await page.getByRole('button', { name: '实时预览', exact: true }).click(); await expect(rich).toBeVisible()
  for (const tag of ['strong', 'u', 's', 'em', 'sup', 'sub', 'mark']) await expect(rich.locator(tag)).toContainText('Alpha')
  await save(firstPath, formatted)
  passed('all seven toolbar formats remain rendered while focused and survive source/live roundtrip')

  await page.waitForTimeout(650); await rich.focus(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('MODE_MARKER')
  for (const name of ['源码', '对照', '实时预览']) await page.getByRole('button', { name, exact: true }).click()
  await open('formula.tex')
  await expect(page.locator('.document-type')).toHaveText('Formula')
  await expect(rich).toHaveCount(0)
  await source.focus(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText(' + 1')
  await source.press('ControlOrMeta+z'); await expect(source).toHaveText('x^2')
  await source.press('ControlOrMeta+Shift+Z'); await expect(source).toHaveText('x^2 + 1')
  await saveButton.click(); await expect.poll(() => readFile(path.join(library, 'formula.tex'), 'utf8')).toBe('x^2 + 1')
  await open('first.md')
  await expect(page.locator('.document-type')).toHaveText('Markdown')
  await expect(rich).toContainText('MODE_MARKER')
  await page.getByRole('button', { name: '源码', exact: true }).click()
  await source.focus(); await page.keyboard.press('ControlOrMeta+z'); await save(firstPath, formatted)
  await source.focus(); await page.keyboard.press('ControlOrMeta+Shift+Z'); await save(firstPath, formatted + 'MODE_MARKER')
  await source.focus(); await page.keyboard.press('ControlOrMeta+z'); await save(firstPath, formatted)
  await page.getByRole('button', { name: '实时预览', exact: true }).click()
  passed('Markdown undo survives first save, all layouts and a separate Formula tab; Formula saves plain source with its own undo history')

  await open('complex.md'); await expect(rich.locator('.katex')).toHaveCount(2)
  await expect(rich.locator('h1')).toHaveText('Rich heading'); await expect(rich.locator('table')).toHaveCount(1)
  await expect(rich.locator('input[type="checkbox"]')).toHaveCount(2)
  for (const task of await rich.locator('li[data-type="taskItem"]').all()) expect((await task.boundingBox()).height).toBeLessThan(40)
  await expect(rich.locator('img[src^="https:"]')).toHaveCount(0)
  await expect(rich.locator('.rich-opaque')).toContainText(['HTML / 注释', 'HTML / 注释', '链接定义', '脚注'])
  await expect(rich).not.toContainText('<div data-special')
  for (const name of ['源码', '对照', '实时预览']) await page.getByRole('button', { name, exact: true }).click()
  await save(path.join(library, 'complex.md'), complex)
  await page.getByRole('button', { name: '复制代码', exact: true }).click()
  expect(await app.evaluate(() => globalThis.__copied)).toEqual(['const original = 1'])
  passed('CommonMark/GFM/math render as rich nodes; remote images blocked; untouched source stays byte-identical')

  await selectText('Paragraph'); await page.keyboard.press('ArrowLeft'); await page.keyboard.insertText('NEW ')
  const adjacent = complex.replace('Paragraph with', 'NEW Paragraph with')
  await save(path.join(library, 'complex.md'), adjacent)
  await rich.focus(); await page.keyboard.press('ControlOrMeta+z'); await save(path.join(library, 'complex.md'), complex)
  await showBlockInspector(page)
  await page.getByLabel('文档 Mark').getByRole('button', { name: /^跳转 Mark \d+ one$/ }).click()
  await page.keyboard.press('End')
  await expect.poll(() => rich.evaluate(element => { const { $head } = element.editor.state.selection; return [$head.parent.textContent, $head.parentOffset] })).toEqual(['one', 3])
  await page.keyboard.press('Enter'); await page.keyboard.insertText('next')
  const listEdit = complex.replace('- one\r\n- two\r\n\r\n- [x] checked\r\n- [ ] pending', '- one\r\n- next\r\n- two\r\n- [x] checked\r\n- [ ] pending')
  await save(path.join(library, 'complex.md'), listEdit)
  await expect(page.getByLabel('文档 Mark').getByRole('button', { name: /^跳转 Mark \d+ next$/ })).toBeVisible()
  passed('localized edits and list Enter preserve all unrelated Markdown and opaque payloads')

  const beforeSearch = body(await readFile(path.join(library, 'complex.md'), 'utf8'))
  await page.getByRole('button', { name: '查找', exact: true }).click()
  const search = page.getByRole('textbox', { name: '页内查找', exact: true })
  await search.pressSequentially('Paragraph')
  await expect(search).toBeFocused(); await expect(search).toHaveValue('Paragraph')
  await expect(page.locator('.find-bar')).toContainText('1 / 1')
  await search.press('Escape'); await save(path.join(library, 'complex.md'), beforeSearch)
  passed('incremental search retains input focus and never writes query characters into the document')

  await page.locator('.rich-math.is-block').hover(); await page.locator('.rich-math.is-block').getByRole('button', { name: '编辑公式' }).click()
  const formula = page.getByRole('textbox', { name: 'LaTeX 公式' }); await formula.fill('x^3'); await formula.press('ControlOrMeta+s')
  const mathEdit = beforeSearch.replace('$$\r\nx^2\r\n$$', () => '$$\r\nx^3\r\n$$')
  await save(path.join(library, 'complex.md'), mathEdit)
  await rich.locator('a[data-link]').click({ modifiers: ['ControlOrMeta'] }); await ready(); await expect(page.locator('.document-name')).toHaveText('other.md')
  await open('complex.md'); await save(path.join(library, 'complex.md'), mathEdit)
  passed('math edits retain rendered formulas and deliberate local-link navigation stays scoped')

  await open('empty.md'); await expect(rich).toBeVisible(); await rich.focus()
  await rich.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' })))
  await page.keyboard.insertText('中文输入')
  await rich.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文输入' })))
  await page.keyboard.press('Enter'); await page.keyboard.insertText('second')
  await save(path.join(library, 'empty.md'), '中文输入\n\nsecond')
  passed('empty files and simulated IME composition remain editable without lost text')

  await newDocument(page); await ready()
  await page.getByRole('button', { name: '源码', exact: true }).click(); await source.focus(); await page.keyboard.insertText('![pixel](pixel.png)')
  await page.getByRole('button', { name: '实时预览', exact: true }).click(); await expect(rich.locator('.rich-image img')).toHaveCount(0)
  const imagePath = path.join(library, 'image.md')
  await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, imagePath)
  await save(imagePath, '![pixel](pixel.png)')
  await expect(rich.locator('.rich-image img')).toHaveAttribute('src', 'oops-asset://library/pixel.png')
  await rich.focus(); await page.keyboard.press('ControlOrMeta+z'); await expect(rich.locator('.rich-image img')).toHaveCount(0)
  await rich.focus(); await page.keyboard.press('ControlOrMeta+Shift+Z'); await expect(rich.locator('.rich-image img')).toHaveCount(1)
  await save(imagePath, '![pixel](pixel.png)')
  passed('first save refreshes relative image scope without clearing undo history')

  await open('complex.md'); await page.screenshot({ path: path.join(temporary, 'rich-editor.png'), scale: 'css' })
  expect(errors).toEqual([]); expect(consoleErrors).toEqual([])
  await writeFile(path.join(temporary, 'result.json'), JSON.stringify({ checks, errors, consoleErrors }, null, 2))
  console.log(JSON.stringify({ ok: true, checks: checks.length, artifacts: temporary }, null, 2))
} catch (error) {
  const page = app.windows()[0]
  if (page) { await page.screenshot({ path: path.join(temporary, 'failure.png'), scale: 'css' }).catch(() => {}); await writeFile(path.join(temporary, 'body.txt'), await page.locator('body').innerText()).catch(() => {}) }
  await writeFile(path.join(temporary, 'result.json'), JSON.stringify({ checks, errors, consoleErrors, failure: String(error) }, null, 2))
  console.error('Rich smoke failed:', temporary, { errors, consoleErrors }); throw error
} finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
