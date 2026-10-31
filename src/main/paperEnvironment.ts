import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { extractPaperBundle, sha256File, type PaperEnvironmentCatalog } from './paperBundle'
import { inspectPaperRuntime, type PaperRuntime } from './paperRuntime'

export type { PaperEnvironmentCatalog } from './paperBundle'
export interface PaperEnvironmentStatus {
  phase: 'idle' | 'verifying' | 'extracting' | 'validating' | 'ready' | 'cancelled' | 'error'
  progress: number
  message: string
  activeVersion?: string
  availableBundle?: string
  bundleBytes?: number
  canRollback: boolean
  error?: string
}
interface ActiveEnvironment { current: string; previous?: string; bundleId: string }
const safeName = (name: unknown): name is string => typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/.test(name) && name !== '.' && name !== '..'

export class PaperEnvironmentManager {
  private state: PaperEnvironmentStatus = { phase: 'idle', progress: 0, message: '可安装随应用提供的离线论文环境。', canRollback: false }
  private controller?: AbortController
  private readonly directory: string
  constructor(private readonly options: {
    directory: string
    catalog: PaperEnvironmentCatalog
    bundledDirectory?: string
    onProgress?: (status: PaperEnvironmentStatus) => void
    inspect?: typeof inspectPaperRuntime
  }) { this.directory = path.resolve(options.directory) }

  private update(change: Partial<PaperEnvironmentStatus>) {
    if (Object.entries(change).every(([key, value]) => this.state[key as keyof PaperEnvironmentStatus] === value)) return
    this.state = { ...this.state, ...change }
    this.options.onProgress?.({ ...this.state })
  }
  private async active(): Promise<ActiveEnvironment | undefined> {
    try {
      const value = JSON.parse(await readFile(path.join(this.directory, 'active.json'), 'utf8')) as ActiveEnvironment
      if (!safeName(value.current) || (value.previous !== undefined && !safeName(value.previous))) return undefined
      const receipt = JSON.parse(await readFile(path.join(this.directory, value.current, '.markflow-environment.json'), 'utf8')) as { id: string; sha256: string }
      if (receipt.id !== value.bundleId || !this.options.catalog.some(entry => entry.id === receipt.id && entry.sha256 === receipt.sha256 && entry.platform === process.platform && entry.arch === process.arch)) return undefined
      return value
    } catch { return undefined }
  }
  private async activate(value: ActiveEnvironment) {
    const temporary = path.join(this.directory, `.active-${randomUUID()}.json`)
    try {
      await writeFile(temporary, JSON.stringify(value), { flag: 'wx' })
      await rename(temporary, path.join(this.directory, 'active.json'))
    } finally { await rm(temporary, { force: true }).catch(() => {}) }
  }
  async status(): Promise<PaperEnvironmentStatus> {
    const active = await this.active()
    const available = this.options.catalog.find(entry => entry.platform === process.platform && entry.arch === process.arch)
    const state = active && this.state.phase === 'idle' ? { ...this.state, phase: 'ready' as const, progress: 100, message: '论文环境已就绪，可离线编译。' }
      : !active && this.state.phase === 'ready' ? { ...this.state, phase: 'idle' as const, progress: 0, message: '已安装环境的记录不可用，请重新安装。' } : this.state
    return { ...state, activeVersion: active?.bundleId, canRollback: !!active?.previous, availableBundle: available?.id, bundleBytes: available?.bytes }
  }
  async runtime(): Promise<PaperRuntime> {
    const active = await this.active()
    if (!active) return { available: false, root: this.directory, binDir: '', latexmk: '', engines: {}, message: '尚未安装有效的论文环境，请安装或导入离线环境包。' }
    return (this.options.inspect ?? inspectPaperRuntime)({ root: path.join(this.directory, active.current) })
  }
  cancel() { this.controller?.abort() }

  async install(bundlePath?: string): Promise<PaperEnvironmentStatus> {
    if (this.controller) throw new Error('论文环境正在安装，请等待或取消当前安装。')
    const controller = this.controller = new AbortController()
    const signal = controller.signal
    let staging: string | undefined
    let installed: string | undefined
    try {
      const candidates = this.options.catalog.filter(entry => entry.platform === process.platform && entry.arch === process.arch)
      const fallback = candidates[0]
      if (!fallback) throw new Error('当前系统尚无经过验证的离线环境包。')
      if (!safeName(fallback.id) || !safeName(fallback.filename)) throw new Error('离线环境目录配置不正确。')
      const bundle = bundlePath ?? (this.options.bundledDirectory ? path.join(this.options.bundledDirectory, fallback.filename) : undefined)
      if (!bundle) throw new Error('请选择与当前版本匹配的离线环境包。')
      this.update({ phase: 'verifying', progress: 0, message: '正在校验离线环境包…', error: undefined })
      const size = (await stat(bundle)).size
      const matchingSize = candidates.filter(entry => entry.bytes === size)
      if (!matchingSize.length) throw new Error('环境包大小不匹配；请使用本版本提供的离线包。')
      const digest = await sha256File(bundle, signal, bytes => this.update({ progress: Math.round(bytes / size * 20) }))
      const entry = matchingSize.find(item => item.sha256 === digest)
      if (!entry || !safeName(entry.id) || !safeName(entry.filename)) throw new Error('环境包校验失败，未安装任何文件。')
      signal.throwIfAborted()
      await mkdir(this.directory, { recursive: true })
      const disk = await statfs(this.directory)
      if (disk.bavail * disk.bsize < entry.expandedBytes * 1.25 + 16 * 1024 * 1024) throw new Error('安装位置空间不足，请至少预留 1 GB 可用空间后重试。')
      staging = path.join(this.directory, `.staging-${randomUUID()}`)
      await mkdir(staging)
      this.update({ phase: 'extracting', progress: 20, message: '正在安装编译器、字体和参考文献工具…' })
      await extractPaperBundle(bundle, staging, entry, signal, bytes => this.update({ progress: 20 + Math.floor(bytes / Math.max(1, entry.expandedBytes) * 70) }))
      signal.throwIfAborted()
      this.update({ phase: 'validating', progress: 90, message: '正在验证论文编译环境…' })
      const runtime = await (this.options.inspect ?? inspectPaperRuntime)({ root: staging })
      if (!runtime.available || !runtime.engines.lualatex || !runtime.bibtex || !runtime.biber || !runtime.synctex) throw new Error(runtime.message ?? '环境缺少所需的编译器、字体或参考文献工具。')
      signal.throwIfAborted()
      await writeFile(path.join(staging, '.markflow-environment.json'), JSON.stringify(entry, null, 2))
      const current = `${entry.id}-${randomUUID().slice(0, 8)}`
      installed = path.join(this.directory, current)
      await rename(staging, installed)
      staging = undefined
      const previous = await this.active()
      signal.throwIfAborted()
      await this.activate({ current, previous: previous?.current, bundleId: entry.id })
      installed = undefined
      this.update({ phase: 'ready', progress: 100, message: '论文环境已就绪，可离线编译。' })
    } catch (error) {
      const cancelled = signal.aborted
      const message = cancelled ? '已取消安装，原有论文环境保持可用。' : error instanceof Error ? error.message : String(error)
      this.update({ phase: cancelled ? 'cancelled' : 'error', message, error: cancelled ? undefined : message })
    } finally {
      // These paths are generated directly below our private environment directory.
      for (const directory of [staging, installed]) if (directory && path.dirname(directory) === this.directory) await rm(directory, { recursive: true, force: true }).catch(() => {})
      this.controller = undefined
    }
    return this.status()
  }

  async rollback(): Promise<PaperEnvironmentStatus> {
    if (this.controller) throw new Error('请先等待或取消当前安装。')
    const active = await this.active()
    if (!active?.previous) throw new Error('没有可恢复的旧环境。')
    const root = path.join(this.directory, active.previous)
    await access(root)
    const receipt = JSON.parse(await readFile(path.join(root, '.markflow-environment.json'), 'utf8')) as { id: string; sha256: string }
    if (!this.options.catalog.some(entry => entry.id === receipt.id && entry.sha256 === receipt.sha256 && entry.platform === process.platform && entry.arch === process.arch) || !(await (this.options.inspect ?? inspectPaperRuntime)({ root })).available) throw new Error('旧环境验证失败，当前环境保持不变。')
    await this.activate({ current: active.previous, previous: active.current, bundleId: receipt.id })
    this.update({ phase: 'ready', progress: 100, message: '已恢复旧版本论文环境。', error: undefined })
    return this.status()
  }
}
