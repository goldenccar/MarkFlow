import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, net, protocol, shell } from 'electron'
import { mkdirSync, watch, type FSWatcher } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { atomicWrite, FileService, getSettings, putSettings } from './files'
import { GitService } from './git'
import { CompilerService } from './compilerService'
import { PaperService } from './paperService'
import { controlledTeXEnvironment, inspectPaperRuntime } from './paperRuntime'
import { PaperEnvironmentManager, type PaperEnvironmentCatalog } from './paperEnvironment'
import environmentCatalog from './paperEnvironmentCatalog.json'
import type { CompilerSource } from '../shared/compilerUi'
import { isPaperTextPath, paperTextExtensions } from '../shared/paper'
import { getFonts } from './fonts'
import { authorizedProject, createProjectDirectory, forgetProject, preserveProjectAuthorization, projectDirectoryPath, projectForFile, relocateProjectSettings, rememberProject, sameRoot, setProjectSyncMode } from './projects'
import { UntitledService, validateUntitled } from './untitled'
import { windowPalette as resolveWindowPalette } from './windowTheme'
import { isThemePreference } from '../shared/theme'
import { normalizeGithubRemote } from '../shared/github'
import type { Draft, FileEntry, Library, ProjectLinkInfo, SaveRequest, SaveUntitledRequest, SaveUntitledResult, Settings, WindowAppearance } from '../shared/types'

const here = path.dirname(fileURLToPath(import.meta.url))
const appName = 'MarkFlow'
// Retain the existing profile, including Chromium storage, when the display name changes.
const userDataDirectory = path.resolve(process.env.MARKFLOW_USER_DATA || process.env.OOPSMD_USER_DATA || path.join(app.getPath('appData'), 'oopsmd'))
mkdirSync(userDataDirectory, { recursive: true })
app.setPath('userData', userDataDirectory)
app.setPath('sessionData', userDataDirectory)
app.setName(appName)
protocol.registerSchemesAsPrivileged([{ scheme: 'oops-asset', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
let window: BrowserWindow
let files: FileService | null = null
let git: GitService | null = null
let watcher: FSWatcher | undefined
let allowClose = false
let windowAppearance: WindowAppearance = { theme: 'system', mode: 'markdown' }
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
const authorizeCurrent = async (source: Extract<CompilerSource, { kind: 'current' }>) => {
  if (source.root === undefined && source.path === undefined) return {}
  const current = service()
  if (text(source.root) !== current.root) throw new Error('项目已切换，请重新打开生成窗口。')
  const relative = text(source.path)
  if (!/\.(md|markdown|mdown|txt)$/i.test(relative)) throw new Error('当前文档不是 Markdown 文档。')
  return { sourcePath: await current.resolve(relative), assetRoot: current.root }
}
const paperEnvironment = new PaperEnvironmentManager({
  directory: path.join(userDataDirectory, 'paper', 'environments'),
  catalog: environmentCatalog as PaperEnvironmentCatalog,
  bundledDirectory: app.isPackaged ? path.join(process.resourcesPath, 'tex-bundles') : path.join(app.getAppPath(), 'vendor/tex/cache'),
})
const paper = new PaperService({
  userData: userDataDirectory,
  rememberProject: root => serialize(async () => { await putSettings(userDataDirectory, rememberProject(await getSettings(userDataDirectory), root)) }),
  authorizeCurrent,
  chooseDirectory: (kind) => chooseProjectParent(kind === 'create' ? '选择论文项目的存放位置' : '打开 LaTeX 论文文件夹'),
  async chooseFile(kind) {
    const result = await dialog.showOpenDialog(window, {
      title: kind === 'mark' ? '选择 Markdown 或 Mark 资料' : kind === 'zip' ? '导入 LaTeX 项目 ZIP' : '添加论文图片或资料', properties: ['openFile'],
      filters: [{ name: kind === 'mark' ? 'Markdown 或 Mark 资料' : kind === 'zip' ? 'LaTeX 项目压缩包' : '图片与论文资料', extensions: kind === 'mark' ? ['md', 'markdown', 'mdown', 'json'] : kind === 'zip' ? ['zip'] : ['png', 'jpg', 'jpeg', 'pdf', 'svg', 'eps', 'bib', 'csv'] }],
    })
    return result.canceled ? null : result.filePaths[0]
  },
  async chooseOutput({ target, defaultName }) {
    const result = await dialog.showSaveDialog(window, { title: target === 'pdf' ? '导出论文 PDF' : '导出可复现源文件包', defaultPath: path.join(app.getPath('documents'), defaultName), filters: [{ name: target === 'pdf' ? 'PDF 文档' : 'LaTeX 源文件包', extensions: [target === 'pdf' ? 'pdf' : 'zip'] }] })
    return result.canceled ? null : result.filePath ?? null
  },
  runtime: async () => {
    const managed = await paperEnvironment.runtime()
    return managed.available || app.isPackaged ? managed : inspectPaperRuntime({ root: path.join(app.getAppPath(), 'vendor/tex/TinyTeX') })
  },
  environment: controlledTeXEnvironment,
})
const compiler = new CompilerService({
  async chooseFile({ kind, extensions }) {
    const labels = { source: '选择 Markdown 或 MarkFlow 资料', presentation: '选择呈现 JSON', font: '选择字体文件' }
    const result = await dialog.showOpenDialog(window, { title: labels[kind], properties: ['openFile'], filters: [{ name: labels[kind], extensions }] })
    return result.canceled ? null : result.filePaths[0]
  },
  chooseDirectory: () => chooseProjectParent('选择图片素材文件夹'),
  async chooseOutput({ target, defaultName }) {
    const result = await dialog.showSaveDialog(window, { title: target === 'docx' ? '生成 Word 报告' : '生成 PPT 演示', defaultPath: path.join(app.getPath('documents'), defaultName), filters: [{ name: target === 'docx' ? 'Word 文档' : 'PowerPoint 演示', extensions: [target] }] })
    return result.canceled ? null : result.filePath ?? null
  },
  authorizeCurrent,
  async openPath(file, reveal) {
    if (reveal) shell.showItemInFolder(file)
    else { const error = await shell.openPath(file); if (error) throw new Error(error) }
  },
})
const repository = () => { if (!git) throw new Error('请先打开文档库'); return git }
const untitled = () => new UntitledService(app.getPath('userData'))
const gitExecutable = () => app.isPackaged && process.platform === 'win32' ? path.join(process.resourcesPath, 'git', 'cmd', 'git.exe') : undefined
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
  const resolved = await realpath(path.resolve(root))
  if (!(await stat(resolved)).isDirectory()) throw new Error('请选择目录')
  const nextFiles = new FileService(resolved, app.getPath('userData'), (file) => shell.trashItem(file))
  const nextGit = new GitService(resolved, gitExecutable())
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
    const remembered = rememberProject(settings, prepared.library.root)
    await cacheProjectRemote(remembered, prepared.git, prepared.library.root)
    await putSettings(app.getPath('userData'), remembered)
    return activateLibrary(prepared)
  } catch (error) { prepared.watcher.close(); throw error }
}
async function cacheProjectRemote(settings: Settings, repo: GitService, root: string) {
  const project = settings.projects.find(item => sameRoot(item.root, root))
  if (!project) return
  try {
    const status = await repo.status()
    if (status.remote) project.remote = normalizeGithubRemote(status.remote).url
    else if (status.available) delete project.remote
  } catch { /* Local projects remain usable when Git is unavailable. */ }
}
async function assertAppSync(root = service().root) {
  const settings = await getSettings(app.getPath('userData'))
  authorizedProject(settings, root)
  if (settings.projects.find(item => sameRoot(item.root, root))?.syncMode === 'external') {
    throw new Error('此项目由云盘客户端同步。MarkFlow 只保存到本地文件夹，不执行 Git 远端操作。')
  }
}
async function inspectProjectLink(input: string): Promise<ProjectLinkInfo> {
  const source = normalizeGithubRemote(input)
  const settings = await getSettings(app.getPath('userData'))
  const matches: ProjectLinkInfo['matches'] = []
  for (const project of settings.projects) {
    let available = false
    try { available = (await stat(project.root)).isDirectory() } catch { /* Retain missing copies for relocation. */ }
    let remote = project.remote ?? '', branch = ''
    if (available) {
      // Existing copies are matched against their actual origin, not stale settings or names.
      const status = await new GitService(project.root, gitExecutable()).status()
      remote = status.remote; branch = status.branch
    }
    try {
      if (normalizeGithubRemote(remote).key === source.key) matches.push({ root: project.root, branch, available })
    } catch { /* A local-only or non-GitHub project is not a repository match. */ }
  }
  return { remote: source.url, name: source.name, matches }
}
async function chooseProjectParent(title: string): Promise<string | null> {
  const result = await dialog.showOpenDialog(window, { title, properties: ['openDirectory', 'createDirectory'] })
  return result.canceled ? null : realpath(result.filePaths[0])
}
async function openPath(absolute: string) {
  const info = await stat(absolute)
  if (info.isDirectory()) return { library: await openLibrary(absolute) }
  if (!/\.(md|markdown|mdown|txt)$/i.test(absolute) && !isPaperTextPath(absolute)) throw new Error('请选择 Markdown、文本或 LaTeX 源文件')
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
  // Paper jobs have independent queues so compilation never blocks drafts or cancellation.
  handle('paper:runtime', () => paper.runtime(), false)
  handle('paper:environment', () => paperEnvironment.status(), false)
  handle('paper:install-environment', async (importFile) => {
    if (importFile !== undefined && typeof importFile !== 'boolean') throw new Error('环境安装参数无效。')
    if (!importFile) return paperEnvironment.install()
    const result = await dialog.showOpenDialog(window, { title: '导入离线论文环境包', properties: ['openFile'], filters: [{ name: 'MarkFlow 离线论文环境', extensions: ['gz'] }] })
    return result.canceled ? null : paperEnvironment.install(result.filePaths[0])
  }, false)
  handle('paper:cancel-environment', async () => paperEnvironment.cancel(), false)
  handle('paper:rollback-environment', () => paperEnvironment.rollback(), false)
  handle('paper:open', kind => paper.open(kind), false)
  handle('paper:activate', async id => openLibrary(await paper.projectRoot(text(id))))
  handle('paper:open-document', async (root, relative) => {
    const current = service()
    if (!sameRoot(text(root), current.root)) throw new Error('项目已切换，请重新打开文档。')
    await current.resolve(text(relative))
    return paper.openDocument(current.root, text(relative))
  }, false)
  handle('paper:create', request => paper.create(request), false)
  handle('paper:from-mark', request => paper.fromMark(request), false)
  handle('paper:detach', id => paper.detach(text(id)), false)
  handle('paper:refresh', id => paper.refresh(text(id)), false)
  handle('paper:configure', (id, main, engine) => paper.configure(text(id), text(main), engine), false)
  handle('paper:trust', id => paper.trust(text(id)), false)
  handle('paper:read', (id, file) => paper.read(text(id), text(file)), false)
  handle('paper:save', (id, buffer) => paper.save(text(id), buffer))
  handle('paper:draft', (id, buffer) => paper.draft(text(id), buffer))
  handle('paper:discard-draft', (id, file) => paper.discardDraft(text(id), text(file)))
  handle('paper:move-draft', (id, from, to) => paper.moveDraft(text(id), text(from), text(to)))
  handle('paper:add-file', (id, file) => paper.addFile(text(id), text(file)), false)
  handle('paper:import-asset', id => paper.importAsset(text(id)), false)
  handle('paper:build', request => paper.build(request), false)
  handle('paper:cancel', id => paper.cancel(text(id)), false)
  handle('paper:pdf', (id, artifact) => paper.pdf(text(id), text(artifact)), false)
  handle('paper:locate', (id, artifact, query) => paper.locate(text(id), text(artifact), query), false)
  handle('paper:export', (id, artifact, target) => paper.export(text(id), text(artifact), target), false)
  handle('paper:release', id => paper.release(text(id)), false)
  // Compilation has its own concurrency guard; never block draft saves on a worker.
  handle('compiler:create', async source => compiler.create(source), false)
  handle('compiler:choose', async (id, selection, family) => compiler.choose(text(id), selection, family), false)
  handle('compiler:automatic', async id => compiler.useAutomatic(text(id)), false)
  handle('compiler:export', async request => compiler.export(request), false)
  handle('compiler:open', async (id, reveal) => {
    if (reveal !== undefined && typeof reveal !== 'boolean') throw new Error('无效的打开方式')
    await compiler.open(text(id), reveal)
  }, false)
  handle('compiler:release', async id => compiler.release(text(id)), false)
  handle('fonts:list', async () => getFonts(), false)
  handle('project:open', async (root: string) => openLibrary(authorizedProject(await getSettings(app.getPath('userData')), text(root))))
  handle('project:create', async (name: string) => {
    projectDirectoryPath(app.getPath('documents'), text(name))
    const parent = await chooseProjectParent('选择新项目的存放位置')
    return parent ? openLibrary(await createProjectDirectory(parent, name)) : null
  })
  handle('project:inspect-link', async (url: string) => inspectProjectLink(text(url)))
  handle('project:clone', async (url: string, name: string) => {
    const source = normalizeGithubRemote(text(url))
    projectDirectoryPath(app.getPath('documents'), text(name))
    const parent = await chooseProjectParent('选择 GitHub 项目副本的存放位置')
    if (!parent) return null
    const root = projectDirectoryPath(parent, name)
    await GitService.clone(source.url, root, gitExecutable())
    return openLibrary(root)
  })
  handle('project:forget', async (input: string) => {
    const settings = await getSettings(app.getPath('userData'))
    const root = authorizedProject(settings, text(input))
    const saved = await putSettings(app.getPath('userData'), forgetProject(settings, root))
    if (files && sameRoot(files.root, root)) { watcher?.close(); watcher = undefined; files = null; git = null }
    return saved
  })
  handle('project:sync-mode', async (input: string, mode: 'local' | 'git' | 'external') => {
    const settings = await getSettings(app.getPath('userData'))
    if (!['local', 'git', 'external'].includes(mode)) throw new Error('无效的项目同步方式')
    return putSettings(app.getPath('userData'), setProjectSyncMode(settings, authorizedProject(settings, text(input)), mode))
  })
  handle('project:relocate', async (input: string) => {
    const settings = await getSettings(app.getPath('userData'))
    const previousRoot = authorizedProject(settings, text(input))
    const result = await dialog.showOpenDialog(window, { title: '选择这个项目移动后的文件夹', properties: ['openDirectory'] })
    if (result.canceled) return null
    const target = await realpath(result.filePaths[0])
    const updated = relocateProjectSettings(settings, previousRoot, target)
    const prepared = await prepareLibrary(target)
    try {
      const previousFiles = files && sameRoot(files.root, previousRoot) ? files : new FileService(previousRoot, app.getPath('userData'), file => shell.trashItem(file))
      await previousFiles.migrateProjectData(target)
      await paper.migrateProjectData(previousRoot, target)
      const remembered = rememberProject(updated, target)
      await cacheProjectRemote(remembered, prepared.git, target)
      await putSettings(app.getPath('userData'), remembered)
      await paper.releaseRoot(previousRoot)
      return { library: activateLibrary(prepared), previousRoot }
    } catch (error) { prepared.watcher.close(); throw error }
  })
  handle('untitled:list', async () => untitled().list())
  handle('untitled:put', async (draft) => untitled().put(draft))
  handle('untitled:delete', async (id) => untitled().delete(text(id)))
  handle('untitled:save', async (request) => saveUntitled(request))
  handle('library:choose', async () => {
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
    return result.canceled ? null : openLibrary(result.filePaths[0])
  })
  handle('file:choose', async () => {
    const result = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'Markdown / LaTeX 文本', extensions: ['md', 'markdown', 'mdown', ...paperTextExtensions.map(extension => extension.slice(1))] }] })
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
  handle('files:move', async (from: string, to: string) => {
    const recovery = await paper.prepareDraftMove(service().root, text(from), text(to))
    const result = await service().move(from, to)
    try { await recovery.finish() }
    catch { result.warning = [result.warning, '文件已移动；LaTeX 恢复草稿迁移未完成，旧记录完整保留。请重新打开 Fomula 核对恢复草稿。'].filter(Boolean).join('\n') }
    return result
  })
  handle('files:remove', async (relative: string) => {
    const recovery = await paper.assertRemovalSafe(service().root, text(relative))
    const result = await service().remove(relative)
    try { await recovery.finish() }
    catch { result.warning = [result.warning, '文件已移到回收站；部分 LaTeX 旧草稿清理未完成，恢复记录仍保留。'].filter(Boolean).join('\n') }
    return result
  })
  handle('files:export', async (content: string) => {
    const result = await dialog.showSaveDialog(window, { defaultPath: 'MarkFlow-recovery.md' })
    if (result.canceled || !result.filePath) return false
    await atomicWrite(result.filePath, text(content)); return true
  })
  handle('settings:get', async () => getSettings(app.getPath('userData')))
  handle('settings:put', async (settings: Settings) => {
    // Project and recent-file roots are authorization records owned by the main process.
    const existing = await getSettings(app.getPath('userData'))
    const saved = await putSettings(app.getPath('userData'), preserveProjectAuthorization(settings, existing))
    if (saved.theme !== existing.theme) applyWindowAppearance({ ...windowAppearance, theme: saved.theme })
    return saved
  })
  handle('git:status', async () => repository().status())
  handle('git:init', async (identity) => repository().init(identity))
  handle('git:configure', async (remote, branch, identity) => {
    await assertAppSync()
    const status = await repository().configure(text(remote), text(branch), identity)
    const settings = await getSettings(app.getPath('userData'))
    await cacheProjectRemote(settings, repository(), service().root)
    await putSettings(app.getPath('userData'), settings)
    return status
  })
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
  handle('git:sync', async () => { await assertAppSync(); return repository().sync() })
  handle('git:check', async () => {
    const repo = repository(), root = service().root
    await assertAppSync(root)
    return repo.checkRemote()
  }, false)
  handle('git:update', async () => { await assertAppSync(); return repository().updateFromRemote() })
  handle('git:push', async () => { await assertAppSync(); return repository().pushChanges() })
  handle('git:publish', async () => { await assertAppSync(); return repository().publishBranch() })
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
  handle('view:appearance', async (appearance: WindowAppearance) => {
    if (!appearance || !isThemePreference(appearance.theme) || !['markdown', 'latex-math'].includes(appearance.mode)) throw new Error('无效的窗口外观')
    applyWindowAppearance({ theme: appearance.theme, mode: appearance.mode })
  }, false)
  ipcMain.on('app:close-ready', (event) => { trusted(event); allowClose = true; window.close() })
}
// Keep the native caption buttons in the same palette as the renderer title bar.
const windowPalette = (appearance: WindowAppearance) => resolveWindowPalette(appearance, nativeTheme.shouldUseDarkColors)
const captionOverlay = (appearance: WindowAppearance) => {
  const palette = windowPalette(appearance)
  return { color: palette.caption, symbolColor: palette.text, height: 40 }
}
function applyWindowAppearance(appearance: WindowAppearance) {
  windowAppearance = appearance
  if (!window || window.isDestroyed()) return
  window.setBackgroundColor(windowPalette(appearance).background)
  if (process.platform !== 'darwin') window.setTitleBarOverlay(captionOverlay(appearance))
}
async function createWindow() {
  const settings = await getSettings(app.getPath('userData'))
  windowAppearance = { theme: settings.theme, mode: 'markdown' }
  window = new BrowserWindow({ width: 1440, height: 940, minWidth: 920, minHeight: 620, title: appName, backgroundColor: windowPalette(windowAppearance).background, titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 14 } } : { titleBarOverlay: captionOverlay(windowAppearance) }), autoHideMenuBar: true,
    webPreferences: { preload: path.join(here, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  window.on('close', (event) => { if (!allowClose) { event.preventDefault(); window.webContents.send('app:close-request') } })
  window.on('closed', () => watcher?.close())
  const action = (name: string) => () => window.webContents.send('app:action', name)
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [
      { label: '打开本地项目', accelerator: 'CmdOrCtrl+Shift+O', click: action('open-library') },
      { label: '打开文件', accelerator: 'CmdOrCtrl+O', click: action('open-file') },
      { label: '新建文档', click: action('new-file') },
      { label: '新建标签', click: action('new-file') },
      { label: '关闭标签', click: action('close-tab') },
      { label: '重新打开标签', click: action('reopen-tab') },
      { label: '生成 Word / PPT…', click: action('compile') },
      { label: 'Fomula · 公式与 LaTeX…', click: action('paper') },
      { type: 'separator' }, { label: '保存并记录版本', accelerator: 'CmdOrCtrl+S', click: action('save') },
      { label: '项目同步状态', click: action('sync') }, { type: 'separator' }, { role: 'quit', label: '退出' },
    ] },
    { label: '编辑', submenu: [{ label: '撤销', accelerator: 'CmdOrCtrl+Z', click: action('undo') }, { label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', click: action('redo') }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }, { label: '查找', click: action('find') }] },
    { label: '视图', submenu: [{ label: '实时预览', accelerator: 'Alt+1', click: action('preview') }, { label: '源码', accelerator: 'Alt+2', click: action('source') }, { label: '对照', accelerator: 'Alt+3', click: action('split') }, { label: '下一个标签', click: action('next-tab') }, { label: '上一个标签', click: action('previous-tab') }, { role: 'toggleDevTools', label: '开发者工具', accelerator: 'F12' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
  ]))
  window.setMenuBarVisibility(false)
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await window.loadFile(path.join(here, '../renderer/index.html'))
}
app.whenReady().then(async () => {
  // Read the OS preference without overriding Chromium or changing the system appearance.
  const followNativeTheme = () => { if (windowAppearance.theme === 'system') applyWindowAppearance(windowAppearance) }
  nativeTheme.on('updated', followNativeTheme)
  app.once('will-quit', () => nativeTheme.removeListener('updated', followNativeTheme))
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
}).catch((error) => { dialog.showErrorBox(`${appName} 启动失败`, String(error)); app.quit() })
app.on('window-all-closed', () => app.quit())
app.once('will-quit', () => compiler.dispose())
app.once('will-quit', () => { paperEnvironment.cancel(); paper.dispose() })
