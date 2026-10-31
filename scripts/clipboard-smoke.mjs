import { openLocalProject } from './ui-test-utils.mjs'
import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
await mkdir(path.join(root, '.test-data'), { recursive: true })
const temporary = await mkdtemp(path.join(root, '.test-data', 'clipboard-'))
const library = path.join(temporary, 'library')
await mkdir(library)
const code = 'const sample = "复制测试"\nconsole.log(sample)\n'
await writeFile(path.join(library, 'copy.md'), '# Copy\n\n```js\n' + code + '```\n')
const env = { ...process.env, MARKFLOW_USER_DATA: path.join(temporary, 'profile') }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  ...(process.env.OOPSMD_SMOKE_EXE ? { executablePath: process.env.OOPSMD_SMOKE_EXE, args: [] } : { args: [root] }),
  env,
})
try {
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(({ clipboard, dialog }, folder) => {
    // Capture the native API call in memory; never read or alter the user's clipboard.
    globalThis.__copiedTexts = []
    clipboard.writeText = async value => { globalThis.__copiedTexts.push(value) }
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, library)
  await openLocalProject(page)
  await page.locator('.tree-scroll').getByRole('button', { name: 'copy.md', exact: true }).click()
  await page.getByRole('button', { name: '对照', exact: true }).click()
  await expect(page.locator('.editor-area')).toHaveClass(/layout-split/)
  const copy = page.locator('.preview-pane').getByRole('button', { name: '复制代码' })
  await copy.click()
  await expect(copy).toHaveText('已复制')
  expect(await app.evaluate(() => globalThis.__copiedTexts)).toEqual([code])
  console.log('PASS code copy: real button -> preload -> main -> exact text, native write mocked')

  await app.evaluate(({ clipboard }) => { clipboard.writeText = async () => { throw new Error('simulated clipboard failure') } })
  await copy.click()
  await expect(copy).toHaveText('复制失败')
  expect(errors).toEqual([])
  console.log('PASS async native clipboard rejection reaches copy failure UI; no user clipboard access')
} finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}) }
