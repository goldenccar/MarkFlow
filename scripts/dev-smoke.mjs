import { chromium, expect } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { markdownBody } from './mark-test-utils.mjs'
import net from 'node:net'
import { spawn, execFileSync } from 'node:child_process'

const root = process.cwd()
await mkdir(path.join(root, '.test-data'), { recursive: true })
const temporary = await mkdtemp(path.join(root, '.test-data', 'dev-smoke-'))
const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const checks = []
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
async function inspectorValue(url, expression) {
  const socket = new WebSocket(url)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Inspector evaluation timed out')) }, 5000)
    socket.onerror = error => { clearTimeout(timer); reject(error) }
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
    socket.onmessage = event => {
      const data = JSON.parse(event.data)
      if (data.id !== 1) return
      clearTimeout(timer); socket.close()
      if (data.error || data.result.exceptionDetails) reject(new Error(JSON.stringify(data)))
      else resolve(data.result.result.value)
    }
  })
}

for (const command of ['dev', 'debug']) {
  if (command === 'debug') {
    try {
      await fetch('http://127.0.0.1:9229/json/list', { signal: AbortSignal.timeout(500) })
      throw new Error('Port 9229 is already in use; refusing to interfere with another inspector')
    } catch (error) { if (error.message.includes('already in use')) throw error }
  }
  const port = await freePort()
  const inspectorPort = command === 'debug' ? 9229 : await freePort()
  const env = { ...process.env, OOPSMD_USER_DATA: path.join(temporary, command), V8_INSPECTOR_PORT: String(inspectorPort) }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(process.execPath, [npmCli, 'run', command, '--', `--remoteDebuggingPort=${port}`], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  child.stdout.on('data', bytes => { logs = (logs + bytes).slice(-18000) })
  child.stderr.on('data', bytes => { logs = (logs + bytes).slice(-18000) })
  let browser
  try {
    let endpoint
    for (let attempt = 0; attempt < 300; attempt++) {
      if (child.exitCode !== null) throw new Error(`npm run ${command} exited ${child.exitCode}\n${logs}`)
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(300) })
        endpoint = (await response.json()).webSocketDebuggerUrl
        if (endpoint) break
      } catch {}
      await sleep(100)
    }
    if (!endpoint) throw new Error(`Renderer debugging endpoint did not start\n${logs}`)
    browser = await chromium.connectOverCDP(endpoint)
    const page = browser.contexts()[0].pages().find(candidate => !candidate.url().startsWith('devtools:'))
    if (!page) throw new Error('Electron renderer page was not found')
    const errors = []
    const sockets = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('websocket', socket => sockets.push(socket.url()))
    await expect(page.locator('.document-name')).toHaveText('未命名.md', { timeout: 15000 })
    await expect(page.locator('.editor-area')).toHaveClass(/layout-preview/)
    await expect(page.locator('.rich-editor .tiptap')).toHaveAttribute('contenteditable', 'true')
    await expect(page.locator('.rich-editor .tiptap')).toBeVisible()
    await page.locator('.rich-editor .tiptap').focus(); await page.keyboard.insertText('Debug session')
    await expect(page.getByRole('button', { name: '跳转 Mark 1 Debug session', exact: true })).toBeEnabled()
    await expect.poll(async () => markdownBody(await page.evaluate(async () => (await window.oops.listUntitled())[0]?.content) ?? '')).toBe('Debug session')
    await page.reload()
    await expect(page.locator('.document-name')).toHaveText('未命名.md', { timeout: 15000 })
    await expect(page.locator('.editor-area')).toHaveClass(/layout-preview/)
    await expect(page.locator('.rich-editor .tiptap')).toHaveAttribute('contenteditable', 'true')
    await expect(page.locator('.rich-editor .tiptap')).toBeVisible()
    await expect(page.locator('.rich-editor .tiptap')).toContainText('Debug session')
    expect(page.url()).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):/)
    const state = await page.evaluate(() => ({
      api: typeof window.oops?.chooseLibrary,
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'),
      nonces: Array.from(document.scripts).map(script => script.nonce).filter(Boolean),
      preamble: window.__vite_plugin_react_preamble_installed__,
    }))
    expect(state.api).toBe('function')
    expect(state.csp).toContain("'nonce-")
    expect(state.nonces.length).toBeGreaterThan(0)
    for (const nonce of state.nonces) expect(state.csp).toContain(`'nonce-${nonce}'`)
    await expect.poll(() => sockets.length).toBeGreaterThan(0)
    expect(errors).toEqual([])
    checks.push(`npm run ${command}: app/preload, nonce CSP and Vite HMR websocket`)
    console.log(`PASS ${checks.at(-1)}`)

    const inspectorTargets = await (await fetch(`http://127.0.0.1:${inspectorPort}/json/list`)).json()
    const inspector = inspectorTargets[0].webSocketDebuggerUrl
    const devToolsOpen = `process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron').BrowserWindow.getAllWindows().some(window => window.webContents.isDevToolsOpened())`
    // CDP does not exercise Windows native menu accelerators; verify binding and capability separately.
    const accelerator = await inspectorValue(inspector, `(() => {
      const electron = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron')
      const find = menu => { for (const item of menu.items) { if (item.accelerator === 'F12') return item; if (item.submenu) { const nested = find(item.submenu); if (nested) return nested } } }
      const item = find(electron.Menu.getApplicationMenu())
      if (!item) throw new Error('F12 menu binding is missing')
      const window = electron.BrowserWindow.getAllWindows()[0]
      window.webContents.openDevTools({ mode: 'detach' })
      return item.accelerator
    })()`)
    expect(accelerator).toBe('F12')
    await expect.poll(() => inspectorValue(inspector, devToolsOpen)).toBe(true)
    checks.push(`npm run ${command}: DevTools opens and native menu binds F12`)
    console.log(`PASS ${checks.at(-1)}`)

    if (command === 'debug') {
      const electronVersion = await inspectorValue(inspector, 'process.versions.electron')
      expect(electronVersion).toMatch(/^\d+\./)
      checks.push(`npm run debug: main-process inspector on 9229 (Electron ${electronVersion})`)
      console.log(`PASS ${checks.at(-1)}`)
    }
  } catch (error) {
    console.error(logs)
    throw error
  } finally {
    await browser?.close().catch(() => {})
    // The recorded npm PID owns only this test's Electron/Vite child processes.
    if (child.exitCode === null) {
      if (process.platform === 'win32') {
        try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch {}
      } else child.kill('SIGTERM')
    }
  }
}
console.log(JSON.stringify({ ok: true, checks, temporary, note: 'HMR transport/startup verified; no production source files modified. Physical Windows F12 injection is not covered.' }, null, 2))
