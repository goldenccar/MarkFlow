import { expect } from '@playwright/test'

// User-facing entry points shared by the smoke scripts. These helpers assert the
// resulting document/module instead of bypassing the UI with internal APIs.
export async function newDocument(page, label = 'Markdown') {
  const mode = { Markdown: 'markdown', Formula: 'latex-math' }[label]
  if (!mode) throw new Error(`Unsupported document module: ${label}`)
  await page.getByRole('button', { name: '新建标签', exact: true }).click()
  const menu = page.getByRole('menu', { name: '新建文档类型', exact: true })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: new RegExp(`^${label}\\b`) }).click()
  await expect(menu).toHaveCount(0)
  await expect(page.locator('.navigation-shield')).toHaveCount(0)
  await expect(page.locator('.app')).toHaveAttribute('data-mode', mode)
  await expect(page.locator('.document-type')).toHaveText(label)
  await expect(page.locator('.document-name')).toHaveText(label === 'Formula' ? '未命名.tex' : '未命名.md')
  await expect(page.locator('.editor-area')).toHaveClass(label === 'Formula' ? /layout-split/ : /layout-preview/)
}

export async function showBlockInspector(page) {
  const panel = page.locator('.document-navigator-panel')
  if (await panel.getAttribute('aria-hidden') !== 'false') await page.getByRole('button', { name: '打开文档导航', exact: true }).click()
  await expect(panel).toHaveAttribute('aria-hidden', 'false')
  const inspector = page.locator('.document-navigator-inspector')
  if (!await inspector.count()) await panel.getByRole('button', { name: '查看内容块', exact: true }).click()
  await expect(inspector).toBeVisible()
  return inspector.getByLabel('文档 Mark', { exact: true })
}

export async function setTheme(page, preference) {
  const label = { system: '跟随本机', light: '浅色', dark: '深色' }[preference]
  if (!label) throw new Error(`Unsupported theme preference: ${preference}`)
  await page.locator('.theme-control').getByRole('button', { name: /^主题：/ }).click()
  const menu = page.getByRole('menu', { name: '主题', exact: true })
  await menu.getByRole('menuitemradio', { name: label, exact: true }).click()
  await expect(menu).toHaveCount(0)
  await expect.poll(() => page.evaluate(async () => (await window.oops.settings()).theme)).toBe(preference)
  if (preference !== 'system') await expect(page.locator('html')).toHaveAttribute('data-theme', preference)
}

export async function applyToolbarFormat(page, label) {
  const inline = page.locator('.format-tools').getByRole('button', { name: label, exact: true })
  if (await inline.isVisible()) await inline.click()
  else {
    await page.getByRole('button', { name: '更多排版', exact: true }).click()
    await page.locator('.format-menu').getByRole('menuitem', { name: label, exact: true }).click()
  }
}
