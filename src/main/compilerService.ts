import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { writeCompilation } from '../compiler/output.js'
import type { CompileResult, Diagnostic } from '../compiler/types'
import type { CompilerExportRequest, CompilerExportResult, CompilerSelection, CompilerSession, CompilerSource, CompilerTarget } from '../shared/compilerUi'

export interface CompilerJob {
  source: { kind: 'sample' } | { kind: 'file'; path: string } | { kind: 'current'; content: string; sourcePath: string }
  target: CompilerTarget
  assetRoot?: string
  presentationPath?: string
  fontFiles: Record<string, string>
}
export type CompilerWorkerReply = { ok: true; result: CompileResult; protectedInputs: string[] } | { ok: false; diagnostics: Diagnostic[] }
export interface CompilerServiceOptions {
  chooseFile(request: { kind: 'source' | 'presentation' | 'font'; extensions: string[] }): Promise<string | null>
  chooseDirectory(): Promise<string | null>
  chooseOutput(request: { target: CompilerTarget; defaultName: string }): Promise<string | null>
  authorizeCurrent(source: Extract<CompilerSource, { kind: 'current' }>): Promise<{ sourcePath?: string; assetRoot?: string }>
  openPath(file: string, reveal: boolean): Promise<void>
  workerFile?: string | URL
  timeoutMs?: number
  defaultFontFile?: string
  runJob?: (job: CompilerJob) => Promise<CompilerWorkerReply>
}
interface Grant { view: CompilerSession; source: CompilerJob['source']; assetRoot?: string; presentationPath?: string; fontFiles: Record<string, string> }
const errorResult = (code: string, message: string): CompilerExportResult => ({ status: 'error', diagnostics: [{ code, severity: 'error', message }] })
const samePath = (a: string, b: string) => path.relative(a, b) === ''
const validFamily = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)

/** Native pickers grant paths once; subsequent renderer calls can only use opaque session IDs. */
export class CompilerService {
  private readonly sessions = new Map<string, Grant>()
  private readonly artifacts = new Map<string, string>()
  private readonly workers = new Set<Worker>()
  private busy: string | null = null
  private disposed = false
  constructor(private readonly options: CompilerServiceOptions) {}

  private grant(id: string): Grant {
    const grant = typeof id === 'string' && this.sessions.get(id)
    if (this.disposed || !grant) throw new Error('导出会话已失效，请重新打开导出窗口。')
    return grant
  }
  private editable(id: string): Grant {
    const grant = this.grant(id)
    if (this.busy) throw new Error('正在生成文件，请完成后再更改导出设置。')
    return grant
  }
  private view(grant: Grant): CompilerSession { return structuredClone(grant.view) }
  private async selected(file: string, directory = false): Promise<string> {
    const resolved = await realpath(file), info = await stat(resolved)
    if (directory ? !info.isDirectory() : !info.isFile()) throw new Error(directory ? '请选择资源文件夹。' : '请选择普通文件。')
    return resolved
  }

  async create(source: CompilerSource): Promise<CompilerSession | null> {
    if (this.disposed || this.busy) throw new Error('正在生成文件或导出服务已关闭。')
    if (!source || !['sample', 'file', 'current'].includes(source.kind)) throw new Error('导出来源无效。')
    let jobSource: CompilerJob['source'], sourceLabel: string, assetRoot: string | undefined
    if (source.kind === 'file') {
      const selected = await this.options.chooseFile({ kind: 'source', extensions: ['json', 'md', 'markdown', 'mdown'] })
      if (!selected) return null
      const file = await this.selected(selected)
      if (!/\.(json|md|markdown|mdown)$/i.test(file)) throw new Error('请选择 JSON 或 Markdown 文件。')
      jobSource = { kind: 'file', path: file }; sourceLabel = file
    } else if (source.kind === 'current') {
      if (typeof source.content !== 'string' || Buffer.byteLength(source.content, 'utf8') > 8 * 1024 * 1024) throw new Error('当前文档必须是最多 8 MiB 的文本。')
      if ((source.root === undefined) !== (source.path === undefined)) throw new Error('当前文档的项目和路径必须同时提供。')
      const authorized = await this.options.authorizeCurrent(source)
      sourceLabel = authorized.sourcePath ?? '未命名.md'
      assetRoot = authorized.assetRoot
      jobSource = { kind: 'current', content: source.content, sourcePath: sourceLabel }
    } else { jobSource = { kind: 'sample' }; sourceLabel = '内置示例' }
    const family = 'Microsoft YaHei', font = this.options.defaultFontFile ?? path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts', 'msyh.ttc')
    const id = randomUUID()
    const grant: Grant = {
      source: jobSource, assetRoot, fontFiles: { [family]: font },
      view: { id, sourceKind: source.kind, sourceLabel, assetRootLabel: assetRoot ?? (source.kind === 'sample' ? '随应用提供的示例图片' : '未选择（无图片时可留空）'), presentationLabel: source.kind === 'sample' ? '内置示例布局' : null, fonts: [{ family, fileLabel: font }] },
    }
    if (this.sessions.size >= 8) this.sessions.delete(this.sessions.keys().next().value!)
    this.sessions.set(id, grant)
    return this.view(grant)
  }

  async choose(id: string, selection: CompilerSelection, family?: string): Promise<CompilerSession | null> {
    const grant = this.editable(id)
    if (selection === 'assets') {
      const selected = await this.options.chooseDirectory()
      if (!selected) return null
      const root = await this.selected(selected, true)
      this.editable(id); grant.assetRoot = root; grant.view.assetRootLabel = root
    } else if (selection === 'presentation' || selection === 'font') {
      if (selection === 'font' && !validFamily(family)) throw new Error('请填写字体文件中实际存在的完整字体家族名称。')
      const selected = await this.options.chooseFile({ kind: selection, extensions: selection === 'font' ? ['ttf', 'otf', 'ttc', 'otc'] : ['json'] })
      if (!selected) return null
      const file = await this.selected(selected)
      this.editable(id)
      if (selection === 'presentation') { grant.presentationPath = file; grant.view.presentationLabel = file }
      else {
        Object.defineProperty(grant.fontFiles, family!, { value: file, configurable: true, enumerable: true, writable: true })
        grant.view.fonts = Object.entries(grant.fontFiles).map(([family, fileLabel]) => ({ family, fileLabel }))
      }
    } else throw new Error('导出选择类型无效。')
    return this.view(grant)
  }
  async useAutomatic(id: string): Promise<CompilerSession> {
    const grant = this.editable(id)
    delete grant.presentationPath; grant.view.presentationLabel = grant.source.kind === 'sample' ? '内置示例布局' : null
    return this.view(grant)
  }
  async release(id: string): Promise<void> { if (this.busy !== id) this.sessions.delete(id) }

  private run(job: CompilerJob): Promise<CompilerWorkerReply> {
    if (this.options.runJob) return this.options.runJob(structuredClone(job))
    return new Promise(resolve => {
      const worker = new Worker(this.options.workerFile ?? new URL('./compiler-worker.js', import.meta.url), { workerData: job })
      this.workers.add(worker)
      let done = false
      const finish = (reply: CompilerWorkerReply) => {
        if (done) return
        done = true; clearTimeout(timer); this.workers.delete(worker); void worker.terminate(); resolve(reply)
      }
      const timer = setTimeout(() => finish({ ok: false, diagnostics: [{ code: 'COMPILER_TIMEOUT', severity: 'error', message: '生成超时，目标文件未写入。请减少内容后重试。' }] }), this.options.timeoutMs ?? 120_000)
      worker.once('message', finish)
      worker.once('error', error => finish({ ok: false, diagnostics: [{ code: 'COMPILER_WORKER', severity: 'error', message: error instanceof Error ? error.message : String(error) }] }))
      worker.once('exit', () => finish({ ok: false, diagnostics: [{ code: 'COMPILER_WORKER', severity: 'error', message: '后台生成进程提前退出，目标文件未写入。' }] }))
    })
  }

  async export(request: CompilerExportRequest): Promise<CompilerExportResult> {
    if (this.busy) return errorResult('COMPILER_BUSY', '正在生成文件，请等待本次完成。')
    try {
      if (!request || !['docx', 'pptx'].includes(request.target)) return errorResult('TARGET_UNKNOWN', '请选择 Word 或 PowerPoint。')
      const grant = this.grant(request.sessionId)
      this.busy = request.sessionId
      const base = grant.source.kind === 'sample' ? 'MarkFlow-示例' : path.parse(grant.view.sourceLabel).name
      const output = await this.options.chooseOutput({ target: request.target, defaultName: `${base}.${request.target}` })
      if (!output) return { status: 'cancelled' }
      const reply = await this.run({ source: grant.source, target: request.target, assetRoot: grant.assetRoot, presentationPath: grant.presentationPath, fontFiles: grant.fontFiles })
      if (!reply.ok) return { status: 'error', diagnostics: reply.diagnostics }
      if (this.disposed) return errorResult('COMPILER_CLOSED', '导出服务已关闭，目标文件未写入。')
      const final = path.join(await realpath(path.dirname(output)), path.basename(output))
      await writeCompilation(reply.result, final, reply.protectedInputs)
      const artifactId = randomUUID()
      if (this.artifacts.size >= 16) this.artifacts.delete(this.artifacts.keys().next().value!)
      this.artifacts.set(artifactId, final)
      return { status: 'success', artifactId, path: final, warnings: reply.result.manifest.diagnostics.filter(item => item.severity === 'warning') }
    } catch (error) {
      if (error && typeof error === 'object' && 'diagnostics' in error && Array.isArray(error.diagnostics)) return { status: 'error', diagnostics: error.diagnostics as Diagnostic[] }
      return errorResult('COMPILER_IO', error instanceof Error ? error.message : String(error))
    } finally { this.busy = null }
  }
  async open(id: string, reveal = false): Promise<void> {
    const file = typeof id === 'string' && this.artifacts.get(id)
    if (!file || this.disposed) throw new Error('导出文件授权已失效，请重新生成。')
    const resolved = await realpath(file)
    if (!samePath(file, resolved) || !(await stat(resolved)).isFile()) throw new Error('导出文件已移动或被替换为链接，请重新生成。')
    await this.options.openPath(resolved, reveal === true)
  }
  dispose(): void { this.disposed = true; this.sessions.clear(); this.artifacts.clear(); for (const worker of this.workers) void worker.terminate(); this.workers.clear() }
}
