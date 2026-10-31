import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const evidence = path.resolve(process.argv[2] ?? os.tmpdir())
await mkdir(evidence, { recursive: true })
const temporary = await mkdtemp(path.join(evidence, 'window-theme-'))
const env = { ...process.env, MARKFLOW_USER_DATA: path.join(temporary, 'profile') }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: [process.cwd()], env })
const checks = [], errors = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0], apply = win.setTitleBarOverlay.bind(win)
    win.setTitleBarOverlay = options => { globalThis.__testedCaption = options; return apply(options) }
  })
  async function verify(label, mode) {
    await expect(page.locator('.app')).toHaveAttribute('data-mode', mode)
    const expected = await page.locator('.app').evaluate(element => {
      const style = getComputedStyle(element)
      return { color: style.getPropertyValue('--window-bg').trim(), symbolColor: style.getPropertyValue('--text').trim(), height: 40 }
    })
    await expect.poll(() => app.evaluate(() => globalThis.__testedCaption), { timeout: 10000, message: label }).toEqual(expected)
    checks.push(label)
  }
  for (const [theme, systemDark] of [['浅色', false], ['深色', false], ['跟随本机', false], ['跟随本机', true]]) {
    await app.evaluate(({ nativeTheme }, dark) => { nativeTheme.themeSource = dark ? 'dark' : 'light' }, systemDark)
    await page.emulateMedia({ colorScheme: systemDark ? 'dark' : 'light' })
    await page.getByRole('button', { name: /^主题：/ }).click()
    await page.getByRole('menuitemradio', { name: theme, exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme === '深色' || theme === '跟随本机' && systemDark ? 'dark' : 'light')
    const label = `${theme}${theme === '跟随本机' ? systemDark ? '深色' : '浅色' : ''}`
    await verify(`${label} Markdown caption`, 'markdown')
    if (await page.getByRole('tab', { name: 'Fomula', exact: true }).count()) await page.getByRole('tab', { name: 'Fomula', exact: true }).click()
    else {
      await page.getByRole('button', { name: '新建标签', exact: true }).click()
      await page.getByRole('menuitem', { name: /^Fomula/ }).click()
    }
    await verify(`${label} LaTeX caption without changing the underlying document`, 'latex-math')
    await page.getByRole('tab', { name: '未命名', exact: true }).click()
    await verify(`${label} returning to Markdown`, 'markdown')
  }
  expect(errors).toEqual([])
  console.log(JSON.stringify({ temporary, checks, errors }, null, 2))
} finally {
  await writeFile(path.join(temporary, 'results.json'), JSON.stringify({ checks, errors }, null, 2))
  const closed = app.waitForEvent('close').catch(() => {})
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await closed
}
