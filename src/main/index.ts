import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, shell } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { FileService, getSettings, putSettings } from './files'
import { GitService } from './git'
import { getFonts } from './fonts'
import { authorizedProject, preserveProjectAuthorization, projectForFile, rememberProject, sameRoot } from './projects'
import { UntitledService, validateUntitled } from './untitled'
import type { Draft, FileEntry, Library, SaveRequest, SaveUntitledRequest, SaveUntitledResult, Settings } from '../shared/types'

const here = path.dirname(fileURLToPath(import.meta.url))
if (process.env.OOPSMD_USER_DATA) app.setPath('userData', path.resolve(process.env.OOPSMD_USER_DATA))
protocol.registerSchemesAsPrivileged([{ scheme: 'oops-asset', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
let window: BrowserWindow
let files: FileService | null = null
let git: GitService | null = null
let watcher: FSWatcher | undefined
let allowClose = false
let tail: Promise<unknown> = Promise.resolve()
const serialize = <T>(task: () => Promise<T>): Promise<T> => {
  const next = tail.then(task, task)
  tail = next.catch(() => {})
  return next
}
const text = (value: unknown): string => {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('无效的文本参数')
  return value
}
const service = () => { if (!files) throw new Error('请先打开文档库'); return files }
const repository = () => { if (!git) throw new Error('请先打开文档库'); return git }
const untitled = () => new UntitledService(app.getPath('userData'))
const trusted = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => {
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('拒绝非应用窗口请求')
}
function handle(name: string, fn: (...args: any[]) => Promise<unknown>, queued = true) {
  const scoped = (name.startsWith('files:') && name !== 'files:export') || name.startsWith('git:') || name === 'open:attachment'
  ipcMain.handle(name, (event, ...args) => {
    trusted(event)
    const root = scoped ? text(args.shift()) : undefined
    const invoke = () => {
      // Bind queued requests to their original library, even if a chooser finishes first.
      if (scoped && root !== service().root) throw new Error('文档库已切换，已取消旧文档库的请求。')
      return fn(...args)
    }
    return queued ? serialize(invoke) : invoke()
  })
}
async function prepareLibrary(root: string) {
  const resolved = path.resolve(root)
  if (!(await stat(resolved)).isDirectory()) throw new Error('请选择目录')
  const nextFiles = new FileService(resolved, app.getPath('userData'), (file) => shell.trashItem(file))
  const nextGit = new GitService(resolved, app.isPackaged ? path.join(process.resourcesPath, 'git', 'cmd', 'git.exe') : undefined)
  const entries = await nextFiles.tree()
  let timer: NodeJS.Timeout
  const nextWatcher = watch(resolved, { recursive: true }, (_type, filename) => {
    if (files !== nextFiles) return
    if (filename?.split(/[\\/]/).some((part) => ['.git', 'node_modules'].includes(part))) return
    clearTimeout(timer)
    timer = setTimeout(() => { if (files === nextFiles && !window.isDestroyed()) window.webContents.send('app:files-changed') }, 300)
  })
  nextWatcher.on('error', () => { if (files === nextFiles && !window.isDestroyed()) window.webContents.send('app:files-changed') })
  return { files: nextFiles, git: nextGit, watcher: nextWatcher, library: { root: resolved, entries } as Library }
}
function activateLibrary(prepared: Awaited<ReturnType<typeof prepareLibrary>>) {
  watcher?.close(); watcher = prepared.watcher; files = prepared.files; git = prepared.git
  return prepared.library
}
async function openLibrary(root: string) {
  const prepared = await prepareLibrary(root)
  try {
    const settings = await getSettings(app.getPath('userData'))
    await putSettings(app.getPath('userData'), rememberProject(settings, prepared.library.root))
    return activateLibrary(prepared)
  } catch (error) { prepared.watcher.close(); throw error }
}
async function openPath(absolute: string) {
  const info = await stat(absolute)
  if (info.isDirectory()) return { library: await openLibrary(absolute) }
  if (!/\.(md|markdown|mdown|txt|tex)$/i.test(absolute)) throw new Error('请选择 Markdown、文本或 .tex 数学片段文件')
  const settings = await getSettings(app.getPath('userData'))
  const root = projectForFile(settings, absolute, undefined, files?.root)
  return { library: await openLibrary(root), path: path.relative(root, absolute).replaceAll('\\', '/') }
}

function insertCreatedFile(entries: FileEntry[], relative: string) {
  const parts = relative.split('/')
  let children = entries
  for (let i = 0; i < parts.length; i++) {
    const itemPath = parts.slice(0, i + 1).join('/')
    let entry = children.find(item => item.path === itemPath)
    if (!entry) {
      entry = { path: itemPath, name: parts[i], directory: i < parts.length - 1, ...(i < parts.length - 1 ? { children: [] } : {}) }
      children.push(entry)
    }
    children = entry.children ?? []
  }
}

async function saveUntitled(request: SaveUntitledRequest): Promise<SaveUntitledResult | null> {
  const snapshot = validateUntitled({ ...request, updatedAt: new Date().toISOString() })
  const settings = await getSettings(app.getPath('userData'))
  const preferred = request.projectRoot === undefined ? undefined : authorizedProject(settings, text(request.projectRoot))
  const filename = snapshot.mode === 'latex-math' ? '未命名.tex' : '未命名.md'
  const result = await dialog.showSaveDialog(window, {
    title: '保存新文档', defaultPath: path.join(preferred ?? files?.root ?? app.getPath('documents'), filename),
    filters: snapshot.mode === 'latex-math' ? [{ name: 'LaTeX 数学片段', extensions: ['tex'] }] : [{ name: 'Markdown / 文本', extensions: ['md', 'markdown', 'mdown', 'txt'] }],
  })
  if (result.canceled || !result.filePath) return null
  const absolute = path.resolve(result.filePath)
  const root = projectForFile(settings, absolute, preferred, files?.root)
  const relative = path.relative(root, absolute).replaceAll('\\', '/')
  const prepared = await prepareLibrary(root)
  let file
  try { file = await prepared.files.createDocument(relative, snapshot.content) }
  catch (error) { prepared.watcher.close(); throw error }
  const warnings: string[] = []
  try { prepared.library.entries = await prepared.files.tree() }
  catch { insertCreatedFile(prepared.library.entries, relative); warnings.push('正文已保存，目录刷新失败，可重新打开项目刷新。') }
  const library = activateLibrary(prepared)
  try {
    const remembered = rememberProject(settings, root)
    remembered.recent = [{ root, path: relative }, ...remembered.recent.filter(item => !(sameRoot(item.root, root) && item.path === relative))].slice(0, 20)
    await putSettings(app.getPath('userData'), remembered)
  } catch { warnings.push('正文已保存，但最近项目和文件记录更新失败；请记下当前文件位置。') }
  const version = await (async () => {
    try {
      return await prepared.git.hasRepository() ? await prepared.git.commit([relative], `保存 ${relative}`, { [relative]: Buffer.from(file.content, 'utf8') }) : { committed: false }
    } catch (error) { return { committed: false, error: String(error) } }
  })()
  return { library, file, version, ...(warnings.length ? { warning: warnings.join('\n') } : {}) }
}
async function readDocument(relative: string) {
  const fs = service()
  const file = await fs.read(relative)
  const settings = await getSettings(app.getPath('userData'))
  settings.recent = [{ root: fs.root, path: relative }, ...settings.recent.filter((r) => !(r.root === fs.root && r.path === relative))].slice(0, 20)
  await putSettings(app.getPath('userData'), settings)
  return { file, draft: await fs.getDraft(relative), baseline: await repository().baseline(relative) }
}
function wireIPC() {
  handle('fonts:list', async () => getFonts(), false)
  handle('project:open', async (root: string) => openLibrary(authorizedProject(await getSettings(app.getPath('userData')), text(root))))
  handle('untitled:list', async () => untitled().list())
  handle('untitled:put', async (draft) => untitled().put(draft))
  handle('untitled:delete', async (id) => untitled().delete(text(id)))
  handle('untitled:save', async (request) => saveUntitled(request))
  handle('library:choose', async () => {
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
    return result.canceled ? null : openLibrary(result.filePaths[0])
  })
  handle('file:choose', async () => {
    const result = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'Markdown / LaTeX 数学片段', extensions: ['md', 'markdown', 'mdown', 'txt', 'tex'] }] })
    return result.canceled ? null : openPath(result.filePaths[0])
  })
  handle('library:recent', async (root: string, relative: string) => {
    const settings = await getSettings(app.getPath('userData'))
    if (!settings.recent.some((r) => r.root === root && r.path === relative)) throw new Error('该路径不在最近文档中')
    const library = await openLibrary(root)
    await service().resolve(relative)
    return { library, path: relative }
  })
  handle('library:drop', async (absolute: string) => openPath(text(absolute)))
  handle('files:tree', async () => service().tree())
  handle('files:archive-list', async () => service().listArchive())
  handle('files:archive', async (relative: string) => service().archive(text(relative)))
  handle('files:unarchive', async (relative: string) => service().unarchive(text(relative)))
  handle('files:read', async (relative: string) => readDocument(text(relative)))
  handle('files:save', async (request: SaveRequest) => {
    if (!request || !Array.isArray(request.attachments ?? [])) throw new Error('无效的保存请求')
    const fs = service()
    const relative = text(request.path)
    const attachments = (request.attachments ?? []).map(text)
    for (const item of attachments) await fs.resolve(item)
    const file = await fs.write(relative, text(request.content), text(request.revision))
    const bytes = Buffer.from((file.bom ? '\uFEFF' : '') + file.content.replace(/\r\n|\r|\n/g, file.eol), 'utf8')
    const version = await (async () => {
      try {
        return await repository().hasRepository() ? await repository().commit([relative, ...attachments], `保存 ${relative}`, { [relative]: bytes }) : { committed: false }
      } catch (error) { return { committed: false, error: String(error) } }
    })()
    return { file, version }
  })
  handle('files:draft', async (draft: Draft) => service().draft(draft))
  handle('files:clear-draft', async (relative: string) => service().clearDraft(text(relative)))
  handle('files:create', async (relative: string, directory: boolean) => {
    if (typeof directory !== 'boolean') throw new Error('无效的类型')
    await service().create(text(relative), directory); return service().tree()
  })
  handle('files:move', async (from: string, to: string) => service().move(text(from), text(to)))
  handle('files:remove', async (relative: string) => service().remove(text(relative)))
  handle('files:export', async (content: string) => {
    const result = await dialog.showSaveDialog(window, { defaultPath: 'OopsMD-recovery.md' })
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, text(content), 'utf8'); return true
  })
  handle('settings:get', async () => getSettings(app.getPath('userData')))
  handle('settings:put', async (settings: Settings) => {
    // Project and recent-file roots are authorization records owned by the main process.
    const existing = await getSettings(app.getPath('userData'))
    const saved = await putSettings(app.getPath('userData'), preserveProjectAuthorization(settings, existing))
    if (saved.theme !== existing.theme && !window.isDestroyed()) window.setTitleBarOverlay(captionOverlay(saved.theme))
    return saved
  })
  handle('git:status', async () => repository().status())
  handle('git:init', async (identity) => repository().init(identity))
  handle('git:configure', async (remote, branch, identity) => repository().configure(text(remote), text(branch), identity))
  handle('git:record', async (paths, message) => {
    if (!Array.isArray(paths) || !paths.length) throw new Error('请选择本次记录的文件')
    for (const relative of paths) {
      // Deletions cannot be realpathed; parent must still be inside the library.
      try { await service().resolve(text(relative)) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    return repository().commit(paths.map(text), text(message))
  })
  handle('git:history', async (relative) => repository().history(text(relative)))
  handle('git:version', async (relative, oid) => repository().version(text(relative), text(oid)))
  handle('git:sync', async () => repository().sync())
  handle('git:abort', async () => repository().abortMerge())
  handle('git:resolve', async (relative, choice) => {
    if (choice !== 'ours' && choice !== 'theirs') throw new Error('无效的冲突选择')
    return repository().resolveConflict(text(relative), choice)
  })
  handle('git:finish', async () => repository().finishMerge())
  handle('open:external', async (url: string) => {
    const parsed = new URL(text(url))
    if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('不允许此链接协议')
    const result = await dialog.showMessageBox(window, { type: 'question', message: '在系统应用中打开此链接？', detail: parsed.href, buttons: ['取消', '打开'], defaultId: 0, cancelId: 0 })
    if (result.response === 1) await shell.openExternal(parsed.href)
  }, false)
  handle('open:attachment', async (relative: string) => {
    if (!/\.(pdf|png|jpe?g|gif|webp|bmp|mp3|mp4|wav|docx|xlsx|pptx)$/i.test(text(relative))) throw new Error('此附件类型暂不允许从应用打开')
    const absolute = await service().resolve(relative)
    const error = await shell.openPath(absolute)
    if (error) throw new Error(error)
  })
  handle('clipboard:write-text', async (value) => { await clipboard.writeText(text(value)) }, false)
  handle('view:find', async (query) => { if (text(query)) window.webContents.findInPage(query) }, false)
  handle('view:stop-find', async () => window.webContents.stopFindInPage('clearSelection'), false)
  ipcMain.on('app:close-ready', (event) => { trusted(event); allowClose = true; window.close() })
}
const captionOverlay = (theme: Settings['theme']) => ({ color: theme === 'dark' ? '#1b1e1c' : '#f6f7f5', symbolColor: theme === 'dark' ? '#e8ebe8' : '#242825', height: 40 })
async function createWindow() {
  const settings = await getSettings(app.getPath('userData'))
  window = new BrowserWindow({ width: 1440, height: 940, minWidth: 920, minHeight: 620, title: 'OopsMD', backgroundColor: settings.theme === 'dark' ? '#202123' : '#f6f6f3', titleBarStyle: 'hidden', titleBarOverlay: captionOverlay(settings.theme), autoHideMenuBar: true,
    webPreferences: { preload: path.join(here, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  window.on('close', (event) => { if (!allowClose) { event.preventDefault(); window.webContents.send('app:close-request') } })
  window.on('closed', () => watcher?.close())
  const action = (name: string) => () => window.webContents.send('app:action', name)
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [
      { label: '打开项目', accelerator: 'CmdOrCtrl+Shift+O', click: action('open-library') },
      { label: '打开文件', accelerator: 'CmdOrCtrl+O', click: action('open-file') },
      { label: '新建文档', click: action('new-file') },
      { label: '新建标签', click: action('new-file') },
      { label: '关闭标签', click: action('close-tab') },
      { label: '重新打开标签', click: action('reopen-tab') },
      { type: 'separator' }, { label: '保存并记录版本', accelerator: 'CmdOrCtrl+S', click: action('save') },
      { label: '手动同步', click: action('sync') }, { type: 'separator' }, { role: 'quit', label: '退出' },
    ] },
    { label: '编辑', submenu: [{ label: '撤销', accelerator: 'CmdOrCtrl+Z', click: action('undo') }, { label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', click: action('redo') }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }, { label: '查找', click: action('find') }] },
    { label: '视图', submenu: [{ label: '实时预览', accelerator: 'Alt+1', click: action('preview') }, { label: '源码', accelerator: 'Alt+2', click: action('source') }, { label: '对照', accelerator: 'Alt+3', click: action('split') }, { label: '下一个标签', click: action('next-tab') }, { label: '上一个标签', click: action('previous-tab') }, { role: 'toggleDevTools', label: '开发者工具', accelerator: 'F12' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
  ]))
  window.setMenuBarVisibility(false)
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await window.loadFile(path.join(here, '../renderer/index.html'))
}
app.whenReady().then(async () => {
  await mkdir(app.getPath('userData'), { recursive: true })
  protocol.handle('oops-asset', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.host !== 'library' || request.method !== 'GET') return new Response('Forbidden', { status: 403 })
      const relative = decodeURIComponent(url.pathname.slice(1))
      if (!/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(relative)) return new Response('Unsupported media', { status: 415 })
      const absolute = await service().resolve(relative)
      const response = await net.fetch(pathToFileURL(absolute).href)
      response.headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      response.headers.set('X-Content-Type-Options', 'nosniff')
      return response
    } catch { return new Response('Not found', { status: 404 }) }
  })
  wireIPC()
  await createWindow()
}).catch((error) => { dialog.showErrorBox('OopsMD 启动失败', String(error)); app.quit() })
app.on('window-all-closed', () => app.quit())
