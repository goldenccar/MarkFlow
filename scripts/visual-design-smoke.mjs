import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Visual-only production verification. Never opens a daily profile or starts a dev server.
const root = process.cwd()
const label = (process.env.OOPSMD_VISUAL_LABEL || 'baseline').replace(/[^\w-]/g, '-')
const details = process.env.OOPSMD_VISUAL_DETAILS === '1'
await mkdir(path.join(root, '.test-data'), { recursive: true })
const temporary = await mkdtemp(path.join(root, '.test-data', `visual-${label}-`))
const library = path.join(temporary, '研究与产品设计'), profile = path.join(temporary, 'profile')
await mkdir(path.join(library, '参考资料'), { recursive: true })
const longName = '研究笔记与产品决策_Research-notes-and-design-decisions_2026.md'
const mathName = '公式推导与模型说明.tex'
const markdown = [
  '# 清晰记录，持续思考',
  '',
  '一份好的研究笔记，让观察、证据和判断各有位置。写作从清楚地描述问题开始，再逐步形成可以验证的结论。',
  '',
  'Good tools make room for clear thinking. Keep the source, test the assumption, and explain the result.',
  '',
  '## 01 从观察到判断',
  '',
  '- **保留原始记录**：写下时间、条件和观察结果。',
  '- **明确证据范围**：区分事实、推断与尚待确认的问题。',
  '- **选择下一步**：用最小实验回答最重要的疑问。',
  '',
  '> 简洁不是信息更少，而是信息之间的关系更清楚。',
  '',
  '## 02 结构化结果',
  '',
  '| 样本 / Sample | 条件 / Condition | 结果 / Result |',
  '| --- | --- | ---: |',
  '| 基线 A | 20 °C · 50% RH | 12.4 |',
  '| 试验 B | 20 °C · 50% RH | 15.8 |',
  '| 复核 C | 20 °C · 50% RH | 15.5 |',
  '',
  '这些数字仅用于展示文档排版。实际结论需要绑定样本、测量方法与适用范围。',
  '',
  '## 03 可复现的小实验',
  '',
  '```typescript',
  'const baseline = 12.4',
  'const observed = [15.8, 15.5]',
  'const mean = observed.reduce((sum, value) => sum + value, 0) / observed.length',
  'console.log({ change: mean - baseline })',
  '```',
  '',
  '行内公式 $E = mc^2$ 与正文保持一致；独立公式用于呈现更完整的关系。',
  '',
  '$$',
  '\\bar{x} = \\frac{1}{n} \\sum_{i=1}^{n} x_i',
  '$$',
  '',
  '## 04 下一步 / Next steps',
  '',
  '1. 补齐原始资料与方法说明。',
  '2. 检查异常值，并记录排除依据。',
  '3. 整理能够支持决策的证据。',
  '',
  '- [x] 完成第一轮记录',
  '- [ ] 复核条件与数据',
  '',
  '结论应当能够追溯，也应当允许被新的证据修正。',
  '',
].join('\n')
const math = [
  '\\begin{aligned}',
  '\\bar{x} &= \\frac{1}{n} \\sum_{i=1}^{n} x_i \\\\',
  '\\sigma^2 &= \\frac{1}{n} \\sum_{i=1}^{n}(x_i-\\bar{x})^2 \\\\',
  'f(x) &= \\frac{1}{\\sigma\\sqrt{2\\pi}}',
  '  \\exp\\left(-\\frac{(x-\\mu)^2}{2\\sigma^2}\\right)',
  '\\end{aligned}',
].join('\n')
const files = { [longName]: markdown, [mathName]: math, '项目索引.md': '# 项目索引\n\n研究、记录与复核。\n', '设计记录.md': '# 设计记录\n\n界面与内容结构。\n', '参考资料/来源清单.md': '# 来源清单\n\n保留原始资料位置。\n' }
await Promise.all(Object.entries(files).map(([name, content]) => writeFile(path.join(library, name), content)))
const env = { ...process.env, OOPSMD_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
const screenshots = [], issues = [], checks = [], metrics = [], errors = []
let app, page
const tree = name => page.locator('.tree-scroll').getByRole('button', { name, exact: true })
const rich = () => page.locator('.live-pane .tiptap:visible')
const outline = () => page.getByLabel('文档 Mark', { exact: true }).first()
const passed = name => { checks.push(name); console.log('PASS ' + name) }
const record = (name, findings) => { for (const finding of findings) issues.push({ state: name, ...finding }) }
async function ready() {
  await expect(page.locator('.navigation-shield')).toHaveCount(0)
  await expect(page.locator('.document-bar').getByRole('button', { name: /^保存(?: Ctrl S)?$/ })).toBeEnabled()
}
async function resize(width, height) {
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height])
  await expect.poll(() => page.evaluate(size => Math.max(Math.abs(innerWidth - size[0]), Math.abs(innerHeight - size[1])), [width, height])).toBeLessThanOrEqual(2)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
async function theme(value) {
  if (await page.locator('html').getAttribute('data-theme') !== value) await page.getByRole('button', { name: '切换主题', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', value)
}
async function capture(name) {
  const filename = path.join(temporary, `${name}.png`)
  await page.screenshot({ path: filename, animations: 'disabled' })
  screenshots.push({ name, path: filename })
}
async function geometry(name) {
  const result = await page.evaluate(() => {
    const findings = [], regionMetrics = {}
    const visible = node => { const rect = node.getBoundingClientRect(), css = getComputedStyle(node); return rect.width > 0 && rect.height > 0 && css.display !== 'none' && css.visibility !== 'hidden' && css.opacity !== '0' }
    const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } }
    if (document.documentElement.scrollWidth > innerWidth + 1) findings.push({ kind: 'page-overflow', width: document.documentElement.scrollWidth, viewport: innerWidth })
    for (const selector of ['.document-bar', '.editor-toolbar', '.statusbar', '.sidebar-footer']) {
      const region = document.querySelector(selector)
      if (!region) continue
      const bounds = region.getBoundingClientRect(); regionMetrics[selector] = rect(region)
      for (const control of region.querySelectorAll('button,input,select')) {
        if (!visible(control) || control.closest('.format-menu') || control.matches('.search-open input') && getComputedStyle(control).position === 'absolute') continue
        const r = control.getBoundingClientRect()
        if (r.left < bounds.left - 1 || r.right > bounds.right + 1 || r.top < bounds.top - 1 || r.bottom > bounds.bottom + 1) findings.push({ kind: 'control-overflow', region: selector, control: control.getAttribute('aria-label') || control.textContent.trim(), rect: rect(control) })
      }
    }
    for (const selector of ['.tree-scroll', '.rich-editor', '.preview-pane']) {
      const node = document.querySelector(selector)
      if (node && visible(node) && node.scrollWidth > node.clientWidth + 1) findings.push({ kind: 'surface-horizontal-overflow', region: selector, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth })
    }
    const sidebarControls = [...document.querySelectorAll('.project-files > .sidebar-heading button,.tree-switch button')].filter(visible)
    for (let index = 0; index < sidebarControls.length; index++) {
      const control = sidebarControls[index], bounds = control.getBoundingClientRect(), hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      if (hit !== control && !control.contains(hit)) findings.push({ kind: 'sidebar-control-covered', control: control.getAttribute('aria-label') || control.textContent.trim() })
      for (const other of sidebarControls.slice(index + 1)) {
        const second = other.getBoundingClientRect()
        if (Math.min(bounds.right, second.right) - Math.max(bounds.left, second.left) > 1 && Math.min(bounds.bottom, second.bottom) - Math.max(bounds.top, second.top) > 1) findings.push({ kind: 'sidebar-controls-overlap', controls: [control.getAttribute('aria-label') || control.textContent.trim(), other.getAttribute('aria-label') || other.textContent.trim()] })
      }
    }
    const strip = document.querySelector('.tab-strip').getBoundingClientRect(), active = document.querySelector('.document-tab.active')?.getBoundingClientRect()
    if (active && (active.left < strip.left - 1 || active.right > strip.right + 1)) findings.push({ kind: 'active-tab-clipped', active: { left: active.left, right: active.right }, strip: { left: strip.left, right: strip.right } })
    const add = document.querySelector('.tab-new').getBoundingClientRect()
    if (add.right > innerWidth - 140 + 1) findings.push({ kind: 'native-caption-overlap', right: add.right, boundary: innerWidth - 140 })
    return { findings, regionMetrics, viewport: [innerWidth, innerHeight], outlineCount: document.querySelectorAll('.block-tree button:not(:disabled)').length, toolbar: getComputedStyle(document.querySelector('.editor-toolbar')).backgroundColor, bodyFont: document.querySelector('.tiptap') ? getComputedStyle(document.querySelector('.tiptap')).fontFamily : null }
  })
  record(name, result.findings); metrics.push({ name, ...result })
}
async function popup(name, selector) {
  await expect(page.locator(selector)).toBeVisible()
  record(name, await page.locator(selector).evaluate(element => {
    const rect = element.getBoundingClientRect(), findings = []
    if (rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight) findings.push({ kind: 'popup-outside-viewport', rect: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom } })
    for (const [x, y] of [[rect.left + 8, rect.top + 8], [rect.right - 8, rect.top + 8], [rect.left + 8, rect.bottom - 8], [rect.right - 8, rect.bottom - 8], [rect.x + rect.width / 2, rect.y + rect.height / 2]]) {
      const hit = document.elementFromPoint(x, y)
      if (hit !== element && !element.contains(hit)) { findings.push({ kind: 'popup-clipped-or-covered', x, y, hit: hit?.className || hit?.tagName || 'none' }); break }
    }
    return findings
  }))
  await capture(name)
}
async function sourceTop() { await page.locator('.cm-scroller:visible').evaluate(element => { element.scrollTop = 0; element.scrollLeft = 0 }) }
async function markdownTop() {
  await expect(outline().locator('button').first()).toBeEnabled()
  await outline().getByRole('button', { name: /^跳转 Mark \d+ 清晰记录，持续思考$/ }).click()
  await expect(page.locator('.font-control')).toHaveAttribute('title', '当前 Mark：清晰记录，持续思考')
  await page.locator('.rich-editor:visible').evaluate(element => { element.scrollTop = 0; element.scrollLeft = 0 })
  await page.locator('.tree-scroll').evaluate(element => { element.scrollTop = 0 })
}
async function open(name) { await tree(name).click(); await expect(page.locator('.document-name')).toHaveText(name); await ready() }
async function close() {
  if (!app) return
  const current = app; app = undefined
  const closed = current.waitForEvent('close', { timeout: 10000 })
  await current.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await closed
}

try {
  app = await electron.launch({ ...(process.env.OOPSMD_SMOKE_EXE ? { executablePath: process.env.OOPSMD_SMOKE_EXE, args: [] } : { args: [root] }), env })
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message))
  await page.waitForLoadState('domcontentloaded'); expect(page.url()).toMatch(/^file:/)
  await expect(rich()).toBeVisible()
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, library)
  await page.getByRole('button', { name: '打开项目', exact: true }).click()
  for (const name of ['项目索引.md', '设计记录.md', mathName, longName]) await open(name)
  await expect(outline().locator('button').first()).toBeEnabled()
  expect(await outline().locator('button').count()).toBeGreaterThan(12)
  await expect(page.locator('.live-pane table')).toHaveCount(1)
  await expect(page.locator('.live-pane .rich-code')).toHaveCount(1)
  await expect(page.locator('.live-pane .katex')).toHaveCount(2)
  expect(await page.locator('.document-tab.active .tab-title').evaluate(element => getComputedStyle(element).textOverflow)).toBe('ellipsis')
  passed('real production window opens multilingual headings, paragraphs, lists, table, code, math and a working Mark outline with long file tabs')

  for (const [width, height] of [[1440, 1000], [1100, 760], [920, 620]]) {
    await resize(width, height)
    for (const color of ['light', 'dark']) {
      const name = `markdown-${color}-${width}x${height}`
      await open(longName); await theme(color)
      await page.getByRole('button', { name: '实时预览', exact: true }).click(); await expect(rich()).toBeVisible()
      await markdownTop(); await geometry(name); await capture(name)
      if (details) {
      await outline().getByRole('button', { name: /^跳转 Mark \d+ 02 结构化结果$/ }).click()
      await expect(page.locator('.font-control')).toHaveAttribute('title', '当前 Mark：02 结构化结果')
      await capture(name + '-structured-content')
      await markdownTop()

      await page.keyboard.press('Control+f')
      const search = page.getByRole('textbox', { name: '页内查找', exact: true })
      await expect(search).toBeFocused(); await search.fill('观察')
      await expect(page.locator('.find-bar')).toContainText(/\d+\s*\/\s*\d+/)
      await geometry(name + '-search')
      if (await search.evaluate(element => getComputedStyle(element).position === 'absolute')) await popup(name + '-search-focus', '.toolbar-search input')
      else await capture(name + '-search-focus')
      await search.press('Escape'); await expect(page.locator('.find-bar')).toHaveCount(0)

      if (await page.getByRole('button', { name: '更多排版', exact: true }).isVisible()) {
        await page.getByRole('button', { name: '更多排版', exact: true }).click()
        await expect(page.locator('.format-menu button')).toHaveCount(7)
        for (const format of ['加粗', '下划线', '删除线', '斜体', '上标', '下标', '荧光笔']) await expect(page.locator('.format-menu').getByRole('button', { name: format, exact: true })).toBeVisible()
        await popup(name + '-format-menu', '.format-menu')
        await page.keyboard.press('Escape')
      } else for (const format of ['加粗', '下划线', '删除线', '斜体', '上标', '下标', '荧光笔']) await expect(page.locator('.format-tools').getByRole('button', { name: format, exact: true })).toBeVisible()
      const firstMark = outline().locator('button').first()
      await firstMark.focus(); await page.keyboard.press('Shift+F10')
      await expect(page.getByRole('menuitem', { name: '上移 Mark', exact: true })).toBeDisabled()
      await popup(name + '-mark-menu', '.mark-context-menu')
      await page.keyboard.press('Escape'); await expect(firstMark).toBeFocused()

      if (color === 'light') {
        await tree(longName).click({ button: 'right' }); await popup(name + '-file-menu', '[role=menu][aria-label="文件操作"]'); await page.keyboard.press('Escape')
        await page.getByRole('tab', { name: longName, exact: true }).click({ button: 'right' }); await popup(name + '-tab-menu', '.tab-context-menu'); await page.keyboard.press('Escape')
      }
      }
      passed(`${name}: working outline and geometry checked${details ? ', search and menus captured' : ''}`)

      const geekName = `geek-${color}-${width}x${height}`
      await open(mathName); await theme(color)
      await page.getByRole('button', { name: '对照', exact: true }).click()
      await expect(page.locator('.app')).toHaveAttribute('data-mode', 'latex-math')
      await expect(page.locator('.format-tools')).not.toBeVisible()
      await expect(page.getByRole('button', { name: '更多排版', exact: true })).not.toBeVisible()
      await expect(page.locator('.preview-pane .katex')).toHaveCount(1)
      await expect(page.locator('.cm-content:visible')).toContainText('sigma')
      await sourceTop(); await geometry(geekName); await capture(geekName)
      passed(`${geekName}: editable math source and rendered output captured`)
    }
  }

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  const motion = await page.evaluate(() => [...document.querySelectorAll('button,input,select,.context-menu,.format-menu')].filter(element => element.getBoundingClientRect().width > 0).flatMap(element => {
    const css = getComputedStyle(element), durations = [...css.transitionDuration.split(','), ...css.animationDuration.split(',')].map(value => parseFloat(value))
    return durations.some(value => value > 0) || css.scrollBehavior === 'smooth' ? [{ kind: 'reduced-motion-not-respected', control: element.getAttribute('aria-label') || element.tagName, transition: css.transitionDuration, animation: css.animationDuration, scrollBehavior: css.scrollBehavior }] : []
  }))
  record('reduced-motion', motion)
  await open(longName); await markdownTop(); await page.getByRole('combobox', { name: 'Mark 字体', exact: true }).focus(); await page.keyboard.press('Tab')
  record('keyboard-focus', await page.evaluate(() => {
    const element = document.activeElement, css = getComputedStyle(element)
    return css.outlineStyle === 'none' || parseFloat(css.outlineWidth) < 1 ? [{ kind: 'missing-keyboard-focus-indicator', control: element.getAttribute('aria-label') || element.tagName, outline: css.outline }] : []
  }))
  if (details) await capture('keyboard-focus-reduced-motion-920x620')
  passed('reduced-motion preference and visible keyboard focus inspected')
  for (const [name, original] of Object.entries(files)) expect(await readFile(path.join(library, name), 'utf8')).toBe(original)
  expect(await page.evaluate(() => window.oops.listUntitled())).toEqual([])
  await expect(page.locator('.unsaved-dot')).toHaveCount(0)
  expect(errors).toEqual([])
  passed('visual navigation leaves every source file unchanged and creates no scratch drafts')
} catch (error) {
  issues.push({ state: 'fatal', kind: 'test-failure', message: String(error) })
  if (page && !page.isClosed()) { await capture('failure').catch(() => {}); console.error((await page.locator('body').innerText()).slice(0, 4000)) }
} finally {
  await close()
  const report = { ok: issues.length === 0 && errors.length === 0, label, details, temporary, library, profile, checks, screenshots, metrics, issues, errors }
  await writeFile(path.join(temporary, 'report.json'), JSON.stringify(report, null, 2))
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
  await writeFile(path.join(temporary, 'index.html'), `<!doctype html><meta charset="utf-8"><title>OopsMD visual ${escape(label)}</title><style>body{font:14px system-ui;margin:32px;background:#edf0f4;color:#202832}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:24px}figure{margin:0}img{width:100%;border-radius:8px;border:1px solid #c9d0da}figcaption{padding:8px 0}h1{font-size:24px}</style><h1>OopsMD · ${escape(label)}</h1><p>${screenshots.length} screenshots · ${issues.length} findings</p><main>${screenshots.map(item => `<figure><a href="${escape(path.basename(item.path))}"><img src="${escape(path.basename(item.path))}" loading="lazy"></a><figcaption>${escape(item.name)}</figcaption></figure>`).join('')}</main>`)
  console.log(JSON.stringify({ ok: report.ok, label, temporary, checks: checks.length, screenshots: screenshots.length, issues, errors, report: path.join(temporary, 'report.json'), gallery: path.join(temporary, 'index.html') }, null, 2))
  if (!report.ok) process.exitCode = 1
}
