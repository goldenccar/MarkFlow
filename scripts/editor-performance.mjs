import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
await mkdir(path.join(root, '.test-data'), { recursive: true })
const temporary = await mkdtemp(path.join(root, '.test-data', 'editor-performance-'))
const library = path.join(temporary, 'library')
await mkdir(library)
for (const count of [100, 1000]) await writeFile(path.join(library, `${count}.md`), Array.from({ length: count }, (_, i) => `Paragraph ${i + 1}: **structured text** and 中文内容 for editing.`).join('\n\n'))
const env = { ...process.env, OOPSMD_USER_DATA: path.join(temporary, 'profile') }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: [root], env })
const results = []
try {
  const page = await app.firstWindow()
  await expect(page.locator('.rich-editor [contenteditable=true]')).toBeVisible()
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, library)
  await page.getByRole('button', { name: '打开项目', exact: true }).click()
  for (const count of [100, 1000]) {
    const started = performance.now()
    await page.locator('.tree-scroll').getByRole('button', { name: `${count}.md`, exact: true }).click()
    await expect(page.locator('.navigation-shield')).toHaveCount(0)
    const rich = page.locator('.rich-editor [contenteditable=true]')
    await expect(rich).toContainText(`Paragraph ${count}:`)
    await expect(page.locator('.block-tree button')).toHaveCount(count)
    await expect(page.locator('.block-tree button').last()).toBeEnabled()
    await expect(page.getByRole('alert')).toHaveCount(0)
    const markIds = await page.locator('.block-tree button').evaluateAll(elements => elements.map(element => element.dataset.markId))
    expect(new Set(markIds).size).toBe(count)
    expect(markIds.every(id => /^[0-9a-f-]{36}$/i.test(id ?? ''))).toBe(true)
    const openMs = performance.now() - started
    await rich.locator('p').last().click()
    await expect(page.locator('.font-control')).toHaveAttribute('title', new RegExp(`当前 Mark：Paragraph ${count}:`))
    await page.getByRole('combobox', { name: 'Mark 字号', exact: true }).selectOption('24')
    await expect.poll(() => rich.locator('p').last().evaluate(element => getComputedStyle(element).fontSize)).toBe('24px')
    await rich.focus(); await page.keyboard.press('Control+End')
    await expect.poll(() => page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.closest('p')?.textContent)).toContain(`Paragraph ${count}:`)
    await page.waitForTimeout(500)
    await page.evaluate(() => {
      window.__frames = []; window.__longTasks = []
      window.__observer?.disconnect()
      window.__observer = new PerformanceObserver(list => window.__longTasks.push(...list.getEntries().map(entry => entry.duration)))
      window.__observer.observe({ type: 'longtask', buffered: false })
      document.querySelector('.rich-editor [contenteditable=true]').addEventListener('beforeinput', () => {
        const start = performance.now()
        requestAnimationFrame(() => requestAnimationFrame(() => window.__frames.push(performance.now() - start)))
      })
    })
    await page.keyboard.type('abcdefghijklmnop', { delay: 80 })
    await expect(rich).toContainText('abcdefghijklmnop')
    await page.waitForTimeout(700)
    await expect(page.locator('.block-tree button').last()).toBeEnabled()
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(await page.locator('.block-tree button').evaluateAll(elements => elements.map(element => element.dataset.markId))).toEqual(markIds)
    const metrics = await page.evaluate(() => { window.__observer.disconnect(); return { frames: window.__frames, longTasks: window.__longTasks } })
    metrics.frames.sort((a, b) => a - b)
    await expect.poll(() => rich.locator('p').last().evaluate(element => getComputedStyle(element).fontSize)).toBe('24px')
    results.push({ marks: count, styledMarks: 1, openMs: Math.round(openMs), inputToTwoFramesMedianMs: Math.round(metrics.frames[Math.floor(metrics.frames.length / 2)]), inputToTwoFramesMaxMs: Math.round(Math.max(...metrics.frames)), inputEvents: metrics.frames.length, longTasksOver50ms: metrics.longTasks.map(Math.round) })
  }
  console.log(JSON.stringify({ temporary, note: 'Built Electron, isolated local profile, no Git repository; input latency includes two animation frames. This is a local sample, not a cross-machine guarantee.', results }, null, 2))
} finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}) }
