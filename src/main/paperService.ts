import { createHash, randomUUID } from 'node:crypto'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { atomicWrite, FileService, getSettings, putSettings } from './files'
import { rememberProject, sameRoot } from './projects'
import { paperTextExtensions } from '../shared/paper'
import { paperTemplate } from './paperTemplates'
import { paperHash, paperOriginFile, prepareMarkPaper, readPaperOrigin, type PaperOriginRecord } from './paperMarkProject'
import type { PaperRuntime } from './paperRuntime'
import type { PaperBuffer, PaperBuildRequest, PaperBuildResult, PaperCreateRequest, PaperDiagnostic, PaperEngine, PaperEntry, PaperFile, PaperProject, PaperRuntimeStatus, PaperLocateQuery, PaperLocation, PaperMarkRequest, PaperMarkResult } from '../shared/paper'
import type { CompilerSource } from '../shared/compilerUi'

export type PaperCompilerRuntime = PaperRuntime
export interface PaperCompileJob { cwd: string; output: string; mainFile: string; engine: PaperEngine; runtime: PaperCompilerRuntime; signal: AbortSignal }
export interface PaperServiceOptions {
  userData: string
  rememberProject?(root: string): Promise<void>
  chooseDirectory(kind: 'open' | 'create'): Promise<string | null>
  chooseFile(kind: 'zip' | 'asset' | 'mark'): Promise<string | null>
  authorizeCurrent?(source: Extract<CompilerSource, { kind: 'current' }>): Promise<{ sourcePath?: string; assetRoot?: string }>
  chooseOutput(request: { target: 'pdf' | 'source'; defaultName: string }): Promise<string | null>
  runtime(): Promise<PaperCompilerRuntime>
  environment(runtime: PaperCompilerRuntime, buildDirectory: string): NodeJS.ProcessEnv
  timeoutMs?: number
  runCompile?(job: PaperCompileJob): Promise<{ code: number; log: string }>
}
interface Artifact { id: string; directory: string; pdf: string; snapshotId: string; inputs: string[]; revision: number; mainFile: string; engine: PaperEngine; environment: string }
interface Grant {
  view: PaperProject; root: string; pending: Promise<unknown>
  active?: AbortController; artifact?: Artifact; artifacts: Map<string, Artifact>; displayedArtifact?: string; released: boolean; origin?: PaperOriginRecord; originHash?: string
}
interface RecoveryRecord { filename: string; original: string; buffer: PaperBuffer & { updatedAt: string } }
interface RecoveryCopy { source: string; target: string; original: string; content: string }
const textExtensions = new Set<string>(paperTextExtensions)
const resourceExtensions = new Set([...textExtensions, '.png', '.jpg', '.jpeg', '.pdf', '.eps', '.svg', '.ttf', '.otf', '.ttc', '.csv', '.dat'])
const provenanceFiles = new Set([paperOriginFile, 'markflow-source.json', 'markflow-source-map.json', 'markflow-presentation.json'])
const ignored = new Set(['.git', '.svn', '.markflow', 'node_modules', 'build', 'out', 'dist', '_minted-main'])
const limits = { files: 3000, total: 128 * 1024 * 1024, file: 32 * 1024 * 1024, text: 4 * 1024 * 1024 }
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const inside = (root: string, file: string) => { const relative = path.relative(root, file); return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) }
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const asText = (value: unknown, max = limits.text): string => { if (typeof value !== 'string' || Buffer.byteLength(value) > max || value.includes('\0')) throw new Error('文本无效或超过允许大小。'); return value }
const relativeFile = (value: unknown) => {
  const file = asText(value, 800).replaceAll('\\', '/')
  if (path.isAbsolute(file) || file.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.') || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part) || ignored.has(part.toLowerCase()))) throw new Error('仅允许论文项目内的普通相对路径。')
  return file
}
const engineValue = (value: unknown): PaperEngine => { if (!['xelatex', 'pdflatex', 'lualatex'].includes(String(value))) throw new Error('请选择支持的论文引擎。'); return value as PaperEngine }
const normalize = (value: string) => value.replace(/\r\n?|\n/g, '\n')
const execFileAsync = promisify(execFile)
function decodeFile(file: string, bytes: Buffer): PaperFile {
  if (bytes.length > limits.text) throw new Error('可编辑文件超过 4 MiB。')
  let content: string
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new Error('当前论文编辑器只支持 UTF-8 文本，原文件未修改。') }
  if (content.includes('\0')) throw new Error('检测到二进制内容，不能作为论文文本编辑。')
  return { path: file, content: normalize(content), revision: hash(bytes) }
}
function validateBuffer(value: PaperBuffer): PaperBuffer {
  if (!value || typeof value !== 'object' || typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/.test(value.revision)) throw new Error('文件版本无效，请重新读取。')
  const file = relativeFile(value.path)
  if (!textExtensions.has(path.extname(file).toLowerCase())) throw new Error('该文件不支持文本编辑。')
  return { path: file, content: asText(value.content), revision: value.revision }
}
export function paperDiagnostics(log: string, mainFile: string): PaperDiagnostic[] {
  const result: PaperDiagnostic[] = []
  for (const line of log.split(/\r?\n/)) {
    const location = line.match(/^(?:\.\/)?([^\r\n]*?\.(?:tex|sty|cls|bib)):(\d+):\s*(.+)$/i)
    if (location) result.push({ severity: 'error', file: location[1].replaceAll('\\', '/'), line: Number(location[2]), message: location[3] })
    else if (/^!\s/.test(line)) result.push({ severity: 'error', file: mainFile, message: line.slice(2) })
    else if (/(?:LaTeX|Package \S+) Warning:/.test(line)) result.push({ severity: 'warning', file: mainFile, message: line.trim() })
    if (result.length >= 60) break
  }
  return result
}

/** Pickers grant projects; IPC can subsequently address only those opaque session IDs. */
export class PaperService {
  private sessions = new Map<string, Grant>()
  private pendingSessions = 0
  private disposed = false
  private registrationPending: Promise<unknown> = Promise.resolve()
  constructor(private options: PaperServiceOptions) {}
  private get storage() { return path.join(this.options.userData, 'paper') }
  private grant(id: string) { const grant = typeof id === 'string' && this.sessions.get(id); if (!grant || grant.released || this.disposed) throw new Error('论文项目会话已关闭，请重新打开。'); return grant }
  private view(grant: Grant) { return structuredClone(grant.view) }
  private serial<T>(grant: Grant, operation: () => Promise<T>): Promise<T> { const task = grant.pending.then(operation, operation); grant.pending = task.catch(() => {}); return task }
  private async resolved(grant: Grant, file: string): Promise<string> {
    const candidate = path.resolve(grant.root, relativeFile(file)), actual = await fs.realpath(candidate)
    if (!inside(grant.root, actual) || actual !== candidate || !(await fs.lstat(candidate)).isFile()) throw new Error('文件已移出项目或被替换为链接。')
    return actual
  }
  private async newPath(grant: Grant, file: string): Promise<string> {
    if (await fs.realpath(grant.root) !== grant.root) throw new Error('项目目录已被替换或移动。')
    const candidate = path.resolve(grant.root, relativeFile(file)), parts = path.relative(grant.root, path.dirname(candidate)).split(path.sep).filter(Boolean)
    let parent = grant.root
    for (const part of parts) {
      parent = path.join(parent, part)
      try { await fs.mkdir(parent) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      if ((await fs.lstat(parent)).isSymbolicLink() || !inside(grant.root, await fs.realpath(parent))) throw new Error('目标文件夹不是项目内的普通目录。')
    }
    return candidate
  }
  private configFile(root: string) { return path.join(this.storage, 'projects', `${hash(process.platform === 'win32' ? root.toLowerCase() : root)}.json`) }
  private draftFile(grant: Pick<Grant, 'root'>, file: string) { return path.join(this.storage, 'drafts', hash(grant.root), `${hash(file)}.json`) }
  private async scan(root: string): Promise<PaperEntry[]> {
    const entries: PaperEntry[] = []; let total = 0
    const visit = async (directory: string, prefix = ''): Promise<void> => {
      for (const item of await fs.readdir(directory, { withFileTypes: true })) {
        if (item.name.startsWith('.') || ignored.has(item.name.toLowerCase())) continue
        if (item.isSymbolicLink()) throw new Error(`项目包含链接 ${prefix + item.name}，请移除链接后再编译。`)
        const file = relativeFile(prefix + item.name)
        if (item.isDirectory()) { entries.push({ path: file, directory: true, editable: false, size: 0 }); await visit(path.join(directory, item.name), `${file}/`) }
        else if (item.isFile() && (resourceExtensions.has(path.extname(file).toLowerCase()) || provenanceFiles.has(file))) {
          const info = await fs.stat(path.join(directory, item.name)); total += info.size
          if (info.size > limits.file || total > limits.total) throw new Error('论文项目资源超过 128 MiB 总量或单文件 32 MiB 限制。')
          entries.push({ path: file, directory: false, editable: textExtensions.has(path.extname(file).toLowerCase()), size: info.size })
        }
        if (entries.length > limits.files) throw new Error('论文项目超过 3,000 个文件/目录限制。')
      }
    }
    await visit(root)
    return entries.sort((a, b) => a.path.localeCompare(b.path))
  }
  private async reserveSession<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposed) throw new Error('论文服务已关闭。')
    if (this.sessions.size + this.pendingSessions >= 6) throw new Error('请先关闭一个论文项目，再打开新项目。')
    this.pendingSessions++
    try { return await operation() } finally { this.pendingSessions-- }
  }
  private register(root: string, trusted = false, engine?: PaperEngine): Promise<PaperProject> {
    return this.reserveSession(() => this.registerProject(root, trusted, engine))
  }
  private async registerProject(root: string, trusted: boolean, engine?: PaperEngine): Promise<PaperProject> {
    if (this.disposed) throw new Error('论文服务已关闭。')
    root = await fs.realpath(root)
    if (!(await fs.stat(root)).isDirectory() || inside(root, path.resolve(this.storage))) throw new Error('不能将应用数据目录的上级目录作为论文项目。')
    const files = await this.scan(root), candidates = await this.mainCandidates(root, files)
    let mainFile = candidates.length === 1 ? candidates[0] : null
    try {
      const manifest = path.join(root, 'markflow-build.json')
      if ((await fs.stat(manifest)).size > 64 * 1024) throw new Error('论文源包描述超过大小限制。')
      const saved = JSON.parse(await fs.readFile(manifest, 'utf8'))
      if (saved.version === 1) {
        if (candidates.includes(saved.mainFile)) mainFile = saved.mainFile
        if (!engine && ['xelatex', 'pdflatex', 'lualatex'].includes(saved.engine)) engine = saved.engine
      }
    } catch (error) { if (!missing(error) && !(error instanceof SyntaxError)) throw error }
    try {
      const saved = JSON.parse(await fs.readFile(this.configFile(root), 'utf8'))
      if (candidates.includes(saved.mainFile)) mainFile = saved.mainFile
      if (!engine && ['xelatex', 'pdflatex', 'lualatex'].includes(saved.engine)) engine = saved.engine
    } catch (error) { if (!missing(error) && !(error instanceof SyntaxError)) throw error }
    const view: PaperProject = { id: randomUUID(), rootLabel: root, name: path.basename(root), files, mainFile, mainCandidates: candidates, engine: engine ?? 'xelatex', trusted }
    const grant: Grant = { view, root, pending: Promise.resolve(), artifacts: new Map(), released: false }
    if (files.some(file => file.path === paperOriginFile)) {
      const metadata = files.find(file => file.path === paperOriginFile)!
      if (metadata.size > limits.text) throw new Error('Mark 来源记录超过大小限制。')
      const bytes = await fs.readFile(await this.resolved(grant, paperOriginFile))
      grant.origin = readPaperOrigin(bytes.toString('utf8')); grant.originHash = paperHash(bytes)
      for (const file of Object.keys(grant.origin.hashes)) relativeFile(file)
      const { label, documentId, revision, marks } = grant.origin
      view.origin = { label, documentId, revision, marks }
    }
    const remember = this.registrationPending.then(async () => {
      if (this.options.rememberProject) await this.options.rememberProject(root)
      else await putSettings(this.options.userData, rememberProject(await getSettings(this.options.userData), root))
    })
    this.registrationPending = remember.catch(() => {})
    await remember
    if (this.disposed) throw new Error('论文服务已关闭。')
    this.sessions.set(view.id, grant)
    return this.view(grant)
  }
  private createProject(parent: string, name: string, files: Record<string, string | Buffer>, engine: PaperEngine): Promise<PaperProject> {
    return this.reserveSession(async () => {
      let total = 0
      for (const [file, bytes] of Object.entries(files)) { relativeFile(file); total += Buffer.byteLength(bytes); if (Buffer.byteLength(bytes) > limits.file || total > limits.total) throw new Error('生成的论文资源超过大小限制。') }
      parent = await fs.realpath(parent)
      let root = ''
      for (let index = 1; index <= 1000; index++) {
        const candidate = path.join(parent, index === 1 ? name : `${name} (${index})`)
        try { await fs.mkdir(candidate); root = candidate; break }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      }
      if (!root) throw new Error('同名项目过多，请更改名称后重试。')
      for (const [file, bytes] of Object.entries(files)) { const target = path.join(root, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes, { flag: 'wx' }) }
      return this.registerProject(root, true, engine)
    })
  }
  /** The caller must first authorize projectRoot; opening a file never grants its ancestors. */
  async openDocument(projectRoot: string, relativePath: string): Promise<PaperProject> {
    const suppliedRoot = asText(projectRoot, 4096), file = relativeFile(relativePath)
    if (!path.isAbsolute(suppliedRoot) || !textExtensions.has(path.extname(file).toLowerCase())) throw new Error('请选择已授权项目内的 LaTeX 文本文件。')
    const authorized = await fs.realpath(suppliedRoot), candidate = path.resolve(authorized, file), actual = await fs.realpath(candidate)
    if (!inside(authorized, actual) || actual !== candidate || !(await fs.lstat(candidate)).isFile()) throw new Error('文件已移出项目或被替换为链接。')
    if ((await fs.stat(actual)).size > limits.text) throw new Error('可编辑文件超过 4 MiB。')
    decodeFile(file, await fs.readFile(actual))
    const project = await this.register(authorized)
    if (project.rootLabel !== authorized || await fs.realpath(authorized) !== authorized) { await this.release(project.id); throw new Error('项目目录在打开期间被替换或移动。') }
    if (project.mainCandidates.includes(file)) this.grant(project.id).view.mainFile = file
    return this.view(this.grant(project.id))
  }
  async projectRoot(id: string): Promise<string> {
    const grant = this.grant(id)
    if (await fs.realpath(grant.root) !== grant.root || !(await fs.stat(grant.root)).isDirectory()) throw new Error('项目目录已被替换或移动。')
    return grant.root
  }
  async runtime(): Promise<PaperRuntimeStatus> {
    const runtime = await this.options.runtime()
    return { available: runtime.available, label: runtime.version ?? '本地 TeX 环境', message: runtime.message ?? (runtime.available ? '论文环境已就绪。' : '尚未准备论文环境。'), engines: (Object.keys(runtime.engines) as PaperEngine[]).filter(engine => !!runtime.engines[engine]) }
  }
  async open(kind: 'folder' | 'zip' | 'recent' = 'folder'): Promise<PaperProject | null> {
    if (kind === 'recent') {
      const settings = await getSettings(this.options.userData)
      return settings.lastProject && settings.projects.some(project => sameRoot(project.root, settings.lastProject!)) ? this.register(settings.lastProject) : null
    }
    if (kind === 'folder') { const root = await this.options.chooseDirectory('open'); return root ? this.register(root) : null }
    if (kind !== 'zip') throw new Error('打开论文方式无效。')
    const archive = await this.options.chooseFile('zip'); if (!archive) return null
    const info = await fs.stat(archive); if (info.size > limits.total) throw new Error('ZIP 文件超过 128 MiB。')
    const zip = await JSZip.loadAsync(await fs.readFile(archive)), files: { name: string; bytes: Buffer }[] = []; let total = 0
    for (const entry of Object.values(zip.files)) {
      const original = (entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name
      if (original.replaceAll('\\', '/').split('/').some(part => part.startsWith('.') && part !== '.' && part !== '..')) continue
      const name = relativeFile(original.replace(/\/$/, ''))
      if (entry.dir) continue
      if (typeof entry.unixPermissions === 'number' && (entry.unixPermissions & 0o170000) === 0o120000) throw new Error('ZIP 中的符号链接不允许导入。')
      if (!resourceExtensions.has(path.extname(name).toLowerCase()) && path.basename(name) !== 'markflow-build.json' && !provenanceFiles.has(path.basename(name))) continue
      const expandedSize = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
      if (expandedSize === undefined || expandedSize > limits.file || total + expandedSize > limits.total) throw new Error('ZIP 解包后的资源超过限制。')
      const bytes = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []; let length = 0
        const stream = entry.nodeStream('nodebuffer').on('data', (chunk: Buffer) => {
          length += chunk.length
          if (length > limits.file || total + length > limits.total) { stream.pause(); reject(new Error('ZIP 解包数据超过限制。')); return }
          chunks.push(chunk)
        }).on('error', reject).on('end', () => resolve(Buffer.concat(chunks)))
        stream.resume()
      }); total += bytes.length
      if (bytes.length > limits.file || total > limits.total || files.length >= limits.files) throw new Error('ZIP 内容超过允许大小。')
      files.push({ name, bytes })
    }
    if (!files.some(file => file.name.endsWith('.tex'))) throw new Error('ZIP 中没有 LaTeX 源文件。')
    const parent = await this.options.chooseDirectory('create'); if (!parent) return null
    const root = path.join(await fs.realpath(parent), `论文导入-${Date.now()}`); await fs.mkdir(root)
    const wrapper = files[0]?.name.split('/')[0]
    const stripWrapper = wrapper && files.every(file => file.name.startsWith(wrapper + '/'))
    const names = new Set<string>()
    for (const file of files) {
      const name = stripWrapper ? file.name.slice(wrapper.length + 1) : file.name, key = process.platform === 'win32' ? name.toLowerCase() : name
      if (names.has(key)) throw new Error('ZIP 包含同名文件，已停止导入。'); names.add(key)
      const target = path.join(root, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, file.bytes, { flag: 'wx' })
    }
    return this.register(root)
  }
  async create(request: PaperCreateRequest): Promise<PaperProject | null> {
    if (!request || !['chinese', 'article', 'twocolumn'].includes(request.template)) throw new Error('请选择内置论文模板。')
    const name = relativeFile(asText(request.name, 150)); if (name.includes('/')) throw new Error('论文名称不能包含路径。')
    const template = paperTemplate({ ...request, name, title: asText(request.title, 1000), author: asText(request.author, 300) })
    const parent = await this.options.chooseDirectory('create'); if (!parent) return null
    return this.createProject(parent, name, template.files, template.engine)
  }
  async fromMark(request: PaperMarkRequest): Promise<PaperMarkResult> {
    if (!request || !['chinese', 'article', 'twocolumn'].includes(request.template) || !['current', 'file'].includes(request.source?.kind)) throw new Error('请选择 Mark 资料和论文模板。')
    const name = relativeFile(asText(request.name, 150)); if (name.includes('/')) throw new Error('论文名称不能包含路径。')
    request = { ...request, title: asText(request.title, 1000), author: asText(request.author, 300), abstract: request.abstract === undefined ? undefined : asText(request.abstract, 16000) }
    let content: string, label: string, assetRoot: string | undefined
    if (request.source.kind === 'current') {
      content = asText(request.source.content)
      if ((request.source.root === undefined) !== (request.source.path === undefined)) throw new Error('当前文档的项目和路径必须同时提供。')
      if (!this.options.authorizeCurrent) throw new Error('当前文档授权不可用。')
      const authorized = await this.options.authorizeCurrent(request.source)
      label = authorized.sourcePath ?? '未命名.md'; assetRoot = authorized.assetRoot
    } else {
      const selected = await this.options.chooseFile('mark'); if (!selected) return null
      label = await fs.realpath(selected)
      if (!/\.(md|markdown|mdown|json)$/i.test(label) || !(await fs.stat(label)).isFile() || (await fs.stat(label)).size > limits.text) throw new Error('请选择 4 MiB 以内的 Markdown 或 Mark JSON 文件。')
      content = new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(label)); assetRoot = path.dirname(label)
    }
    let generated: Awaited<ReturnType<typeof prepareMarkPaper>>
    try { generated = await prepareMarkPaper(content, label, assetRoot, request) }
    catch (error) {
      const { CompilationError } = await import('../compiler/diagnostics')
      if (error instanceof CompilationError) return { diagnostics: error.diagnostics }
      throw error
    }
    const parent = await this.options.chooseDirectory('create'); if (!parent) return null
    return { project: await this.createProject(parent, name, generated.files, 'xelatex'), diagnostics: generated.diagnostics }
  }
  async detach(id: string): Promise<PaperProject | null> {
    const grant = this.grant(id)
    if (!grant.origin || grant.active) throw new Error('请在 Mark 生成的论文编译结束后另存为独立项目。')
    const parent = await this.options.chooseDirectory('create'); if (!parent) return null
    const root = path.join(await fs.realpath(parent), `${grant.view.name}-LaTeX-${Date.now()}`)
    const files = (await this.scan(grant.root)).filter(file => !file.directory && !provenanceFiles.has(file.path))
    await fs.mkdir(root)
    for (const file of files) { const target = path.join(root, file.path); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(await this.resolved(grant, file.path), target, 1) }
    return this.register(root, false, grant.view.engine)
  }
  private editable(grant: Grant) { if (grant.origin) throw new Error('此项目由 Mark 资料生成，请修改原资料后重新生成，或另存为独立 LaTeX 项目。') }
  private async mainCandidates(root: string, files: PaperEntry[]): Promise<string[]> {
    const candidates: string[] = []
    for (const file of files.filter(item => item.editable && item.path.toLowerCase().endsWith('.tex'))) {
      if (file.size <= limits.text && /\\documentclass(?:\s|\[|\{)/.test(await fs.readFile(path.join(root, file.path), 'utf8'))) candidates.push(file.path)
    }
    return candidates
  }
  async refresh(id: string): Promise<PaperProject> {
    const grant = this.grant(id)
    await this.projectRoot(id)
    const files = await this.scan(grant.root), candidates = await this.mainCandidates(grant.root, files)
    grant.view.files = files; grant.view.mainCandidates = candidates
    if (grant.view.mainFile && !files.some(file => file.editable && file.path === grant.view.mainFile)) grant.view.mainFile = null
    return this.view(grant)
  }
  async configure(id: string, mainFile: string, engine: PaperEngine): Promise<PaperProject> {
    const grant = this.grant(id), file = relativeFile(mainFile); engine = engineValue(engine)
    if (!file.toLowerCase().endsWith('.tex')) throw new Error('主文件必须是 .tex 文件。')
    await this.resolved(grant, file)
    grant.view.mainFile = file; grant.view.engine = engine
    await fs.mkdir(path.dirname(this.configFile(grant.root)), { recursive: true }); await atomicWrite(this.configFile(grant.root), JSON.stringify({ mainFile: file, engine }))
    return this.view(grant)
  }
  async trust(id: string): Promise<PaperProject> { const grant = this.grant(id); grant.view.trusted = true; return this.view(grant) }
  async read(id: string, file: string): Promise<PaperFile> {
    const grant = this.grant(id); file = relativeFile(file)
    if (!textExtensions.has(path.extname(file).toLowerCase())) throw new Error('请选择可编辑的论文源文件。')
    const result = decodeFile(file, await fs.readFile(await this.resolved(grant, file)))
    try {
      const draft = JSON.parse(await fs.readFile(this.draftFile(grant, file), 'utf8'))
      validateBuffer(draft)
      if (draft.path === file && draft.content !== result.content) result.draft = { content: draft.content, revision: draft.revision, updatedAt: asText(draft.updatedAt, 100) }
    } catch (error) { if (!missing(error)) throw new Error(`恢复草稿无法读取，原草稿已保留：${errorMessage(error)}`) }
    return result
  }
  async save(id: string, input: PaperBuffer): Promise<PaperFile> {
    const grant = this.grant(id), buffer = validateBuffer(input)
    this.editable(grant)
    return this.serial(grant, async () => {
      await new FileService(grant.root, this.options.userData).assertMutable(buffer.path)
      const target = await this.resolved(grant, buffer.path), old = await fs.readFile(target)
      if (hash(old) !== buffer.revision) throw new Error('文件已被其他程序修改，未覆盖磁盘内容。请保留草稿并重新打开核对。')
      const bom = old.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), raw = old.toString('utf8'), eol = raw.includes('\r\n') ? '\r\n' : raw.includes('\r') ? '\r' : '\n'
      const bytes = Buffer.from((bom ? '\ufeff' : '') + normalize(buffer.content).replaceAll('\n', eol))
      await atomicWrite(target, bytes, async () => { await new FileService(grant.root, this.options.userData).assertMutable(buffer.path); if (await this.resolved(grant, buffer.path) !== target || hash(await fs.readFile(target)) !== buffer.revision) throw new Error('保存期间文件发生变化，未覆盖磁盘内容。') })
      // A later draft can arrive while saving. Remove only the exact snapshot that was saved.
      try { const draft = JSON.parse(await fs.readFile(this.draftFile(grant, buffer.path), 'utf8')); if (draft.content === buffer.content) await fs.rm(this.draftFile(grant, buffer.path), { force: true }) } catch (error) { if (!missing(error)) { /* Keep damaged recovery data. */ } }
      return decodeFile(buffer.path, bytes)
    })
  }
  async draft(id: string, input: PaperBuffer): Promise<void> {
    const grant = this.grant(id), buffer = validateBuffer(input)
    this.editable(grant)
    try { await new FileService(grant.root, this.options.userData).assertMutable(buffer.path); await this.resolved(grant, buffer.path) } catch (error) { if (!missing(error)) throw error }
    await this.serial(grant, async () => { const file = this.draftFile(grant, buffer.path); await fs.mkdir(path.dirname(file), { recursive: true }); await atomicWrite(file, JSON.stringify({ ...buffer, updatedAt: new Date().toISOString() })) })
  }
  private async storagePath(filename: string): Promise<void> {
    const profile = await fs.realpath(this.options.userData)
    let ancestor = filename
    while (true) {
      try { if (!inside(profile, await fs.realpath(ancestor))) throw new Error('论文恢复记录指向设备数据目录之外，原记录已保留。'); return }
      catch (error) { if (!missing(error)) throw error }
      ancestor = path.dirname(ancestor)
    }
  }
  private async readStored(filename: string): Promise<string | null> {
    await this.storagePath(filename)
    try {
      const info = await fs.lstat(filename)
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('论文恢复记录不是普通文件，原记录已保留。')
      return new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(filename))
    } catch (error) { if (missing(error)) return null; throw error }
  }
  private async drafts(root: string): Promise<RecoveryRecord[]> {
    const directory = path.dirname(this.draftFile({ root }, 'main.tex'))
    await this.storagePath(directory)
    let names: string[]
    try { names = await fs.readdir(directory) } catch (error) { if (missing(error)) return []; throw error }
    const records: RecoveryRecord[] = []
    for (const name of names.filter(name => name.endsWith('.json'))) {
      const filename = path.join(directory, name), original = await this.readStored(filename)
      if (original === null) throw new Error('论文草稿在读取期间变化，请重试。')
      const buffer = JSON.parse(original)
      validateBuffer(buffer)
      if (!Number.isFinite(Date.parse(buffer.updatedAt)) || filename !== this.draftFile({ root }, buffer.path)) throw new Error('论文恢复草稿格式无效，原记录已保留。')
      records.push({ filename, original, buffer })
    }
    return records
  }
  private async preflightRecovery(plans: RecoveryCopy[]) {
    const pending = []
    for (const plan of plans) {
      const previous = await this.readStored(plan.target)
      if (previous !== null && previous !== plan.content) throw new Error('目标已有不同论文恢复记录，未覆盖任何草稿。')
      if (previous === null) pending.push(plan)
    }
    for (const plan of plans) if (await this.readStored(plan.source) !== plan.original) throw new Error('论文恢复记录在迁移期间变化，请重试；原记录已保留。')
    return pending
  }
  private async copyRecovery(plans: RecoveryCopy[]): Promise<void> {
    const pending = await this.preflightRecovery(plans)
    for (const plan of pending) {
      await this.storagePath(plan.target)
      await fs.mkdir(path.dirname(plan.target), { recursive: true })
      const temporary = path.join(path.dirname(plan.target), `.oopsmd-${randomUUID()}.tmp`)
      try {
        const file = await fs.open(temporary, 'wx', 0o600)
        try { await file.writeFile(plan.content); await file.sync() } finally { await file.close() }
        try { await fs.link(temporary, plan.target) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || await this.readStored(plan.target) !== plan.content) throw error }
      } finally { await fs.rm(temporary, { force: true }) }
    }
  }
  async discardDraft(id: string, input: string): Promise<void> {
    const grant = this.grant(id), file = relativeFile(input)
    if (!textExtensions.has(path.extname(file).toLowerCase())) throw new Error('请选择论文文本草稿。')
    await this.serial(grant, async () => { const stored = this.draftFile(grant, file); await this.storagePath(stored); await fs.rm(stored, { force: true }) })
  }
  async moveDraft(id: string, from: string, to: string): Promise<void> {
    const grant = this.grant(id)
    await this.serial(grant, async () => {
      await this.projectRoot(id)
      await (await this.prepareDraftMove(grant.root, from, to)).finish()
    })
  }
  /** Only main calls this with its active library root, including when no Paper session is open. */
  async prepareDraftMove(root: string, from: string, to: string): Promise<{ finish(): Promise<void> }> {
    const service = new FileService(root, this.options.userData)
    await service.resolve(from); await service.resolve(to)
    const source = from.replaceAll('\\', '/'), target = to.replaceAll('\\', '/')
    const plans: RecoveryCopy[] = []
    if (source !== target) for (const record of await this.drafts(root)) {
      if (!this.covers(source, record.buffer.path)) continue
      const buffer = { ...record.buffer, path: target + record.buffer.path.slice(source.length) }
      validateBuffer(buffer); await service.resolve(buffer.path)
      plans.push({ source: record.filename, target: this.draftFile({ root }, buffer.path), original: record.original, content: JSON.stringify(buffer) })
    }
    await this.preflightRecovery(plans)
    return { finish: async () => {
      await this.copyRecovery(plans)
      for (const plan of plans) if (plan.source !== plan.target && await this.readStored(plan.source) === plan.original) await fs.rm(plan.source)
    } }
  }
  private covers(parent: string, file: string): boolean {
    if (process.platform === 'win32') { parent = parent.toLowerCase(); file = file.toLowerCase() }
    return file === parent || file.startsWith(parent + '/')
  }
  async assertRemovalSafe(root: string, input: string): Promise<{ finish(): Promise<void> }> {
    const service = new FileService(root, this.options.userData), dirty: string[] = []
    await service.resolve(input)
    const records = (await this.drafts(root)).filter(record => this.covers(input.replaceAll('\\', '/'), record.buffer.path))
    for (const { buffer } of records) {
      try { if (decodeFile(buffer.path, await fs.readFile(await service.resolve(buffer.path))).content !== buffer.content) dirty.push(buffer.path) }
      catch { dirty.push(buffer.path) }
    }
    if (dirty.length) throw new Error(`以下 LaTeX 文件仍有未保存的恢复草稿，未删除文件：${dirty.join('、')}。请打开恢复并保存，或导出后明确放弃草稿。`)
    return { finish: async () => { for (const record of records) if (await this.readStored(record.filename) === record.original) await fs.rm(record.filename) } }
  }
  async migrateProjectData(from: string, to: string): Promise<void> {
    if (sameRoot(from, to)) return
    const service = new FileService(to, this.options.userData)
    if (await fs.realpath(to) !== to || !(await fs.stat(to)).isDirectory()) throw new Error('请选择项目移动后的真实文件夹。')
    const grants = [...this.sessions.values()].filter(grant => sameRoot(grant.root, from))
    if (grants.some(grant => grant.active)) throw new Error('请等待 LaTeX 编译结束后再重新定位项目。')
    await Promise.all(grants.map(grant => grant.pending))
    const plans = []
    for (const record of await this.drafts(from)) {
      await service.resolve(record.buffer.path)
      plans.push({ source: record.filename, target: this.draftFile({ root: to }, record.buffer.path), original: record.original, content: record.original })
    }
    const config = this.configFile(from), original = await this.readStored(config)
    if (original !== null) {
      const value = JSON.parse(original)
      await service.resolve(relativeFile(value.mainFile)); engineValue(value.engine)
      plans.push({ source: config, target: this.configFile(to), original, content: original })
    }
    await this.copyRecovery(plans)
  }
  async releaseRoot(root: string): Promise<void> {
    for (const grant of [...this.sessions.values()]) if (sameRoot(grant.root, root)) await this.release(grant.view.id)
  }
  async addFile(id: string, file: string): Promise<PaperProject> {
    const grant = this.grant(id); file = relativeFile(file)
    this.editable(grant)
    if (!textExtensions.has(path.extname(file).toLowerCase())) throw new Error('请使用 .tex、.bib、.sty 等论文文本扩展名。')
    await new FileService(grant.root, this.options.userData).assertMutable(file)
    await fs.writeFile(await this.newPath(grant, file), '', { flag: 'wx' })
    return this.refresh(id)
  }
  async importAsset(id: string): Promise<{ project: PaperProject; path: string } | null> {
    const grant = this.grant(id); this.editable(grant)
    const source = await this.options.chooseFile('asset'); if (!source) return null
    const name = relativeFile(path.basename(source)), extension = path.extname(name).toLowerCase()
    if (!resourceExtensions.has(extension)) throw new Error('此素材类型尚未支持。')
    const info = await fs.stat(source); if (!info.isFile() || info.size > limits.file) throw new Error('素材必须是 32 MiB 以内的普通文件。')
    const file = `assets/${name}`; await new FileService(grant.root, this.options.userData).assertMutable(file)
    await fs.writeFile(await this.newPath(grant, file), await fs.readFile(source), { flag: 'wx' })
    return { project: await this.refresh(id), path: file }
  }
  private async snapshot(grant: Grant, request: PaperBuildRequest): Promise<{ directory: string; snapshotId: string; inputs: string[] }> {
    const files = await this.scan(grant.root), buffers = new Map<string, PaperBuffer>(); let bufferedSize = 0
    if (!Array.isArray(request.buffers) || request.buffers.length > limits.files) throw new Error('编译缓冲区无效。')
    for (const input of request.buffers) { const buffer = validateBuffer(input); if (buffers.has(buffer.path)) throw new Error('重复的文件缓冲区。'); bufferedSize += Buffer.byteLength(buffer.content); if (bufferedSize > limits.total) throw new Error('编译缓冲超过大小限制。'); buffers.set(buffer.path, buffer) }
    const captured: { path: string; disk: Buffer; bytes: Buffer }[] = []; let snapshotSize = 0
    for (const entry of files.filter(item => !item.directory)) {
      const disk = await fs.readFile(await this.resolved(grant, entry.path)), buffer = buffers.get(entry.path)
      if (buffer && hash(disk) !== buffer.revision) throw new Error(`文件 ${entry.path} 已在磁盘变化，请先处理冲突；未生成新预览。`)
      const bytes = buffer ? Buffer.from(buffer.content) : disk; snapshotSize += bytes.length
      if (grant.origin && (entry.path === paperOriginFile ? grant.originHash : grant.origin.hashes[entry.path]) !== paperHash(bytes)) throw new Error('生成的论文文件已变化，Mark 定位不再有效。请重新生成或另存为独立 LaTeX 项目。')
      if (snapshotSize > limits.total) throw new Error('当前未保存内容与资源合计超过 128 MiB，未创建编译快照。')
      captured.push({ path: entry.path, disk, bytes }); buffers.delete(entry.path)
    }
    if (buffers.size) throw new Error('缓冲区包含项目外或已删除文件。')
    if (grant.origin) {
      const capturedPaths = new Set(captured.map(file => file.path))
      if (!capturedPaths.has(paperOriginFile) || Object.keys(grant.origin.hashes).some(file => !capturedPaths.has(file))) throw new Error('Mark 生成的论文文件已缺失，请重新生成或另存为独立 LaTeX 项目。')
    }
    if (!captured.some(file => file.path === request.mainFile)) throw new Error('编译主文件不在当前项目中。')
    // Recheck every captured source so a file change during capture never creates a mixed snapshot.
    for (const file of captured) if (hash(await fs.readFile(await this.resolved(grant, file.path))) !== hash(file.disk)) throw new Error('创建编译快照时项目发生变化，请重试。')
    const snapshotId = hash(JSON.stringify({ main: request.mainFile, engine: request.engine, files: captured.map(file => [file.path, hash(file.bytes)]) }))
    const cache = path.join(this.storage, 'builds'); await fs.mkdir(cache, { recursive: true }); const directory = await fs.mkdtemp(path.join(cache, 'job-'))
    for (const file of captured) { const target = path.join(directory, file.path); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, file.bytes, { flag: 'wx' }) }
    return { directory, snapshotId, inputs: captured.map(file => file.path) }
  }
  private compile(job: PaperCompileJob): Promise<{ code: number; log: string }> {
    if (this.options.runCompile) return this.options.runCompile(job)
    return new Promise(resolve => {
      const executable = job.runtime.latexmk!, engine = job.runtime.engines[job.engine]!
      const mode = job.engine === 'xelatex' ? '-pdfxe' : job.engine === 'lualatex' ? '-pdflua' : '-pdf'
      const engineKey = job.engine === 'xelatex' ? '-xelatex' : job.engine === 'lualatex' ? '-lualatex' : '-pdflatex'
      const args = ['-norc', '-cd', mode, `${engineKey}="${engine.replaceAll('\\', '/')}" -no-shell-escape -interaction=nonstopmode -halt-on-error -file-line-error -synctex=1 %O %S`, `-outdir=${job.output}`, '-jobname=markflow', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-synctex=1', `./${job.mainFile}`]
      let child: ChildProcess, log = '', done = false
      const finish = (code: number) => { if (done) return; done = true; clearTimeout(timer); job.signal.removeEventListener('abort', cancel); resolve({ code, log }) }
      const kill = () => { if (!child?.pid) return; if (process.platform === 'win32') { const killer = spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); killer.on('error', () => child.kill()); } else { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } } }
      const cancel = () => { log += '\n编译已取消。'; kill() }
      const timer = setTimeout(() => { log += '\n编译超时。'; kill() }, this.options.timeoutMs ?? 120_000)
      try { child = spawn(executable, args, { cwd: job.cwd, env: this.options.environment(job.runtime, job.cwd), windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }) } catch (error) { log = errorMessage(error); finish(1); return }
      job.signal.addEventListener('abort', cancel, { once: true }); if (job.signal.aborted) cancel()
      const append = (data: Buffer) => { log += data.toString('utf8'); if (Buffer.byteLength(log) > 2 * 1024 * 1024) { log = log.slice(-500_000) + '\n编译日志超过限制。'; kill() } }
      child.stdout?.on('data', append); child.stderr?.on('data', append)
      child.once('error', error => { log += error.message; finish(1) }); child.once('close', code => finish(code ?? 1))
    })
  }
  async build(request: PaperBuildRequest): Promise<PaperBuildResult> {
    const started = Date.now(), revision = request?.revision
    let grant: Grant | undefined, controller: AbortController | undefined, directory: string | undefined
    const result = (status: PaperBuildResult['status'], diagnostics: PaperDiagnostic[], log = ''): PaperBuildResult => ({ status, revision, diagnostics, log, durationMs: Date.now() - started })
    try {
      if (!request || !Number.isSafeInteger(revision) || revision < 0) throw new Error('编译修订号无效。')
      grant = this.grant(request.projectId)
      if (!grant.view.trusted) throw new Error('请先确认信任此论文项目。当前没有操作系统级隔离，外来 TeX 不能自动编译。')
      const mainFile = relativeFile(request.mainFile), engine = engineValue(request.engine)
      if (!mainFile.endsWith('.tex')) throw new Error('主文件必须是 .tex。')
      grant.active?.abort(); controller = new AbortController(); grant.active = controller
      const runtime = await this.options.runtime()
      if (!runtime.available || !runtime.latexmk || !runtime.engines[engine]) throw new Error(runtime.message ?? '论文编译环境尚未准备好。')
      const snapshot = await this.snapshot(grant, { ...request, mainFile, engine }); directory = snapshot.directory
      if (controller.signal.aborted) return result('cancelled', [])
      const output = path.join(directory, 'build'); await fs.mkdir(output); await fs.mkdir(path.join(directory, '.runtime'))
      const reply = await this.compile({ cwd: directory, output, mainFile, engine, runtime, signal: controller.signal })
      if (controller.signal.aborted || grant.released || grant.active !== controller) return result('cancelled', [], reply.log)
      // latexmk runs TeX repeatedly. Earlier unresolved citations are not final diagnostics.
      const finalLog = await fs.readFile(path.join(output, 'markflow.log'), 'utf8').catch(() => reply.log)
      const diagnostics = paperDiagnostics(finalLog, mainFile).map(diagnostic => {
        if (!diagnostic.file) return diagnostic
        const source = path.isAbsolute(diagnostic.file) ? path.relative(directory!, diagnostic.file).replaceAll('\\', '/') : diagnostic.file
        const relative = path.posix.normalize(path.posix.join(path.posix.dirname(mainFile), source))
        return { ...diagnostic, file: snapshot.inputs.includes(source) ? source : snapshot.inputs.includes(relative) ? relative : undefined }
      })
      if (reply.code !== 0) return result('error', diagnostics.some(item => item.severity === 'error') ? diagnostics : [{ severity: 'error', message: '论文编译失败，请查看日志中的首个错误或文献工具错误。', file: mainFile }, ...diagnostics], reply.log)
      const pdf = path.join(output, 'markflow.pdf'), info = await fs.stat(pdf)
      if (!info.isFile() || info.size > limits.total || !(await fs.readFile(pdf)).subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('编译未产生有效 PDF。')
      const artifact: Artifact = { id: randomUUID(), directory, pdf, snapshotId: snapshot.snapshotId, inputs: snapshot.inputs, revision, mainFile, engine, environment: runtime.version ?? runtime.root }
      grant.artifact = artifact; grant.artifacts.set(artifact.id, artifact); directory = undefined
      // A successful build can already be obsolete to the editor. Keep the displayed PDF pinned.
      for (const previous of grant.artifacts.values()) {
        if (grant.artifacts.size <= 3) break
        if (previous.id === artifact.id || previous.id === grant.displayedArtifact) continue
        grant.artifacts.delete(previous.id); await fs.rm(previous.directory, { recursive: true, force: true }).catch(() => {})
      }
      return { ...result('success', diagnostics, reply.log), artifactId: artifact.id, snapshotId: artifact.snapshotId }
    } catch (error) { return result(controller?.signal.aborted ? 'cancelled' : 'error', [{ severity: 'error', message: errorMessage(error) }]) }
    finally { if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {}); if (grant && grant.active === controller) grant.active = undefined }
  }
  async cancel(id: string): Promise<void> { this.grant(id).active?.abort() }
  private artifact(id: string, artifactId: string): { grant: Grant; artifact: Artifact } { const grant = this.grant(id), artifact = grant.artifacts.get(artifactId); if (!artifact) throw new Error('预览版本已过期，请使用已显示的编译结果。'); return { grant, artifact } }
  async pdf(id: string, artifactId: string): Promise<Uint8Array> { const { grant, artifact } = this.artifact(id, artifactId); grant.displayedArtifact = artifactId; return new Uint8Array(await fs.readFile(artifact.pdf)) }
  async locate(id: string, artifactId: string, query: PaperLocateQuery): Promise<PaperLocation> {
    const { artifact } = this.artifact(id, artifactId), runtime = await this.options.runtime()
    if (!runtime.available || !runtime.synctex) throw new Error('当前论文环境缺少 SyncTeX 定位工具。')
    await fs.access(path.join(path.dirname(artifact.pdf), 'markflow.synctex.gz')).catch(() => { throw new Error('此 PDF 没有定位索引，请重新编译。') })
    let args: string[]
    if (query?.kind === 'source') {
      const file = relativeFile(query.file), line = query.line, column = query.column ?? 1
      if (!artifact.inputs.includes(file) || !Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) throw new Error('源码定位不属于此编译快照。')
      args = ['view', '-i', `${line}:${column}:${path.join(artifact.directory, file)}`, '-o', artifact.pdf]
    } else if (query?.kind === 'pdf') {
      if (!Number.isSafeInteger(query.page) || query.page < 1 || !Number.isFinite(query.x) || !Number.isFinite(query.y) || query.x < 0 || query.y < 0 || query.x > 100000 || query.y > 100000) throw new Error('PDF 定位坐标无效。')
      args = ['edit', '-o', `${query.page}:${query.x}:${query.y}:${artifact.pdf}`]
    } else throw new Error('定位方式无效。')
    const { stdout } = await execFileAsync(runtime.synctex, args, { cwd: artifact.directory, env: this.options.environment(runtime, artifact.directory), windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 })
    this.artifact(id, artifactId)
    const block = stdout.split('SyncTeX result begin')[1]?.split('SyncTeX result end')[0]
    if (!block) throw new Error('当前位置没有可用的 PDF/源码对应关系。')
    const fields = new Map<string, string>()
    for (const line of block.split(/\r?\n/)) { const index = line.indexOf(':'); if (index > 0 && !fields.has(line.slice(0, index))) fields.set(line.slice(0, index), line.slice(index + 1).trim()) }
    const number = (key: string) => { const value = Number(fields.get(key)); return fields.has(key) && Number.isFinite(value) ? value : undefined }
    if (query.kind === 'source') {
      const page = number('Page'), x = number('x'), y = number('y')
      if (!page || x === undefined || y === undefined) throw new Error('SyncTeX 未返回可用页面位置。')
      return { revision: artifact.revision, page, x, y, width: number('W'), height: number('H') }
    }
    const input = fields.get('Input'), line = number('Line')
    if (!input || !line) throw new Error('SyncTeX 未返回可用源码位置。')
    const absolute = path.resolve(artifact.directory, input), file = path.relative(artifact.directory, absolute).replaceAll('\\', '/')
    if (!inside(artifact.directory, absolute) || !artifact.inputs.includes(file)) throw new Error('SyncTeX 返回了编译快照之外的文件。')
    return { revision: artifact.revision, file, line, column: Math.max(1, number('Column') ?? 1) }
  }
  async export(id: string, artifactId: string, target: 'pdf' | 'source'): Promise<string | null> {
    if (!['pdf', 'source'].includes(target)) throw new Error('导出类型无效。')
    const { grant, artifact } = this.artifact(id, artifactId)
    const extension = target === 'pdf' ? '.pdf' : '.zip', destination = await this.options.chooseOutput({ target, defaultName: grant.view.name + extension })
    if (!destination) return null
    this.artifact(id, artifactId)
    if (path.extname(destination).toLowerCase() !== extension) throw new Error(`请保存为 ${extension} 文件。`)
    const actual = path.join(await fs.realpath(path.dirname(destination)), path.basename(destination))
    if (inside(grant.root, actual) || inside(this.storage, actual)) throw new Error('导出位置必须在论文源项目和应用缓存之外，避免覆盖来源。')
    let previous: Buffer | undefined
    try { if ((await fs.lstat(actual)).isSymbolicLink()) throw new Error('不能覆盖链接。'); previous = await fs.readFile(actual) } catch (error) { if (!missing(error)) throw error }
    let bytes: Buffer
    if (target === 'pdf') bytes = await fs.readFile(artifact.pdf)
    else {
      const zip = new JSZip()
      for (const file of artifact.inputs) zip.file(file, await fs.readFile(path.join(artifact.directory, file)))
      zip.file('markflow-build.json', JSON.stringify({ version: 1, mainFile: artifact.mainFile, engine: artifact.engine, snapshotId: artifact.snapshotId, revision: artifact.revision, environment: artifact.environment }, null, 2))
      bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    }
    await atomicWrite(actual, bytes, async () => { try { const info = await fs.lstat(actual); if (info.isSymbolicLink() || !previous || hash(await fs.readFile(actual)) !== hash(previous)) throw new Error('导出位置在生成期间发生变化，未覆盖。') } catch (error) { if (!missing(error) || previous) throw error } })
    return actual
  }
  async release(id: string): Promise<void> { const grant = this.grant(id); grant.released = true; grant.active?.abort(); this.sessions.delete(id); for (const artifact of grant.artifacts.values()) await fs.rm(artifact.directory, { recursive: true, force: true }).catch(() => {}) }
  dispose(): void { this.disposed = true; for (const grant of this.sessions.values()) { grant.released = true; grant.active?.abort(); for (const artifact of grant.artifacts.values()) void fs.rm(artifact.directory, { recursive: true, force: true }).catch(() => {}) } this.sessions.clear() }
}
