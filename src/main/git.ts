import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { GitCommitResult, GitStatus, HistoryEntry } from '../shared/types'
import { normalizeGithubRemote } from '../shared/github'

type Identity = { name: string; email: string }
const queues = new Map<string, Promise<unknown>>()
const remoteQueues = new Map<string, Promise<unknown>>()
const remoteCheckMaxAge = 5 * 60_000
type RemoteBinding = { remote: string; branch: string; trackingBranch: string }
type RemoteCheck = RemoteBinding & { checkedAt: string | null; error: string | null }
const remoteFingerprint = (binding: RemoteBinding) => ({ ...binding, remote: createHash('sha256').update(binding.remote).digest('hex') })
const cleanError = (error: unknown) => String(error instanceof Error ? error.message : error)
  .replace(/(https?:\/\/)[^/\s@]+@/gi, '$1[redacted]@').slice(0, 4000)
const samePath = (a: string, b: string) => process.platform === 'win32'
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b)
const exists = async (file: string) => { try { await stat(file); return true } catch { return false } }

/** Native Git stays in the main process; credentials remain with Git/GCM/SSH. */
export class GitService {
  readonly root: string
  private versionChecked = false
  constructor(root: string, private readonly binary = 'git') { this.root = path.resolve(root) }

  static async clone(remote: string, destination: string, binary = 'git'): Promise<void> {
    const source = path.isAbsolute(remote) ? remote : normalizeGithubRemote(remote).url
    if (!path.isAbsolute(destination)) throw new Error('请选择新副本的完整本地路径。')
    const target = path.resolve(destination)
    const parent = await realpath(path.dirname(target))
    if (target === path.parse(target).root) throw new Error('不能将磁盘根目录用作新副本。')
    // Exclusive creation owns only this new directory; failed downloads are retained, never recursively removed.
    try { await mkdir(target) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('目标路径已存在，请选择尚不存在的新文件夹；原有内容未改动。')
      throw error
    }
    try {
      await new GitService(parent, binary).git(['-c', `protocol.file.allow=${path.isAbsolute(source) ? 'always' : 'never'}`, 'clone', '--no-checkout', '--no-recurse-submodules', '--template=', '--', source, target], { network: true })
      const service = new GitService(target, binary)
      if (await service.optional(['rev-parse', '--verify', 'HEAD'])) {
        await service.worktreeGit(['read-tree', '-m', '-u', 'HEAD'])
      }
      await service.recordRemoteCheck(await service.binding(), null)
    } catch (error) { throw new Error(`获取项目失败。未完成的副本保留在 ${target}；已有文件夹未被覆盖。\n${cleanError(error)}`) }
  }

  private async serial<T>(task: () => Promise<T>, pending = queues): Promise<T> {
    const canonical = await realpath(this.root).catch(() => this.root)
    const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical
    const result = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(task)
    pending.set(key, result)
    void result.finally(() => { if (pending.get(key) === result) pending.delete(key) }).catch(() => {})
    return result
  }

  private run(args: string[], options: { index?: string; input?: Buffer | string; network?: boolean; literalPathspecs?: boolean } = {}): Promise<Buffer> {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
    for (const key of Object.keys(env)) {
      if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|NAMESPACE|PREFIX|CONFIG.*|CEILING_DIRECTORIES|DISCOVERY_ACROSS_FILESYSTEM|EXEC_PATH|(?:LITERAL|GLOB|NOGLOB|ICASE)_PATHSPECS)$/i.test(key)) delete env[key as keyof typeof env]
    }
    if (options.index) Object.assign(env, { GIT_INDEX_FILE: options.index })
    return new Promise((resolve, reject) => {
      const child = execFile(this.binary, [...(options.literalPathspecs === false ? [] : ['--literal-pathspecs']), '-c', 'core.quotepath=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgSign=false',
        ...(options.network ? ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always', '-c', 'protocol.file.allow=always', '-c', 'remote.origin.uploadpack=git-upload-pack', '-c', 'remote.origin.receivepack=git-receive-pack'] : []),
        ...(options.index ? ['-c', 'core.ignorecase=false'] : []), ...args], {
        cwd: this.root, env, windowsHide: true, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024,
        timeout: options.network ? 120_000 : 30_000,
      }, (error, stdout, stderr) => {
        if (error) reject(new Error(cleanError(stderr.toString().trim() || error.message)))
        else resolve(stdout)
      })
      child.stdin?.on('error', () => {})
      child.stdin?.end(options.input)
    })
  }
  private async git(args: string[], options?: Parameters<GitService['run']>[1]) { return (await this.run(args, options)).toString('utf8').trimEnd() }
  private async optional(args: string[]) { try { return await this.git(args) } catch { return '' } }
  private async worktreeRun(args: string[], options?: Parameters<GitService['run']>[1]) {
    const keys = (await this.optional(['config', '--name-only', '--get-regexp', String.raw`^(filter\..*\.(clean|smudge|process|required)|merge\..*\.driver)$`])).split('\n').filter(Boolean)
    const overrides = keys.flatMap(key => ['-c', `${key}=${key.endsWith('.required') ? 'false' : key.startsWith('merge.') ? 'false' : ''}`])
    return this.run([...overrides, ...args], options)
  }
  private async worktreeGit(args: string[], options?: Parameters<GitService['run']>[1]) { return (await this.worktreeRun(args, options)).toString('utf8').trimEnd() }
  private async gitDir() { return path.resolve(this.root, await this.git(['rev-parse', '--absolute-git-dir'])) }
  private async requireRepository(knownTop?: string) {
    const top = knownTop ?? await this.git(['rev-parse', '--show-toplevel'])
    if (!samePath(await realpath(top), await realpath(this.root))) throw new Error('文档库必须是 Git 仓库根目录；请打开仓库根目录，不能操作父级仓库。')
  }
  private async safePath(value: string) {
    if (!value || path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || /[\0\r\n]/.test(value)) throw new Error('无效的文档路径。')
    const normalized = value.replaceAll('\\', '/')
    const parts = normalized.split('/')
    if (parts.some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git' || /[ .]$/.test(part) || part.includes(':'))) throw new Error('路径必须位于文档库内，且不能访问 Git 元数据。')
    let current = this.root
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i])
      try {
        const info = await lstat(current)
        if (info.isSymbolicLink()) throw new Error('不操作符号链接或链接目录。')
        if (info.isDirectory() && await exists(path.join(current, '.git'))) throw new Error('不能记录文档库内嵌套的 Git 仓库。')
        if (i === parts.length - 1 && info.isDirectory()) throw new Error('请选择要记录的具体文件。')
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    return normalized
  }
  private async specialState(): Promise<string | null> {
    const dir = await this.gitDir()
    for (const [entry, message] of [
      ['MERGE_HEAD', '仓库正在合并；请先解决冲突并完成合并，或中止合并。'],
      ['rebase-merge', '仓库正在 rebase；请先在 Git 工具中完成或中止。'],
      ['rebase-apply', '仓库正在 rebase/am；请先在 Git 工具中完成或中止。'],
      ['CHERRY_PICK_HEAD', '仓库正在 cherry-pick；请先在 Git 工具中完成或中止。'],
      ['REVERT_HEAD', '仓库正在 revert；请先在 Git 工具中完成或中止。'],
      ['BISECT_LOG', '仓库正在 bisect；请先在 Git 工具中结束。'],
      ['index.lock', 'Git 暂存区被锁定；请等待其他 Git 操作结束。'],
    ]) if (await exists(path.join(dir, entry))) return message
    return null
  }
  private async identity(identity: Identity) {
    if (!identity.name.trim() || !identity.email.trim() || /[\0\r\n]/.test(identity.name + identity.email)) throw new Error('请填写 Git 作者姓名和邮箱。')
    await this.git(['config', '--local', 'user.name', identity.name.trim()])
    await this.git(['config', '--local', 'user.email', identity.email.trim()])
  }
  private async binding(known?: Pick<RemoteBinding, 'branch' | 'remote'>): Promise<RemoteBinding> {
    const branch = known?.branch ?? await this.optional(['symbolic-ref', '--quiet', '--short', 'HEAD'])
    const [remote, trackingRemote, merge] = await Promise.all([
      known?.remote ?? this.optional(['remote', 'get-url', 'origin']),
      branch ? this.optional(['config', `branch.${branch}.remote`]) : '',
      branch ? this.optional(['config', `branch.${branch}.merge`]) : '',
    ])
    return { remote, branch, trackingBranch: (!trackingRemote || trackingRemote === 'origin') ? (merge.startsWith('refs/heads/') ? merge.slice(11) : branch) : '' }
  }
  private sameBinding(a: RemoteBinding, b: RemoteBinding) { return a.remote === b.remote && a.branch === b.branch && a.trackingBranch === b.trackingBranch }
  private async remoteCheck(binding: RemoteBinding): Promise<RemoteCheck | null> {
    try {
      const value = JSON.parse(await this.optional(['config', '--local', 'markflow.remoteCheck'])) as RemoteCheck
      return this.sameBinding(value, remoteFingerprint(binding)) && (value.checkedAt === null || typeof value.checkedAt === 'string') && (value.error === null || typeof value.error === 'string') ? value : null
    } catch { return null }
  }
  private async recordRemoteCheck(binding: RemoteBinding, error: string | null) {
    const previous = error ? await this.remoteCheck(binding) : null
    const value: RemoteCheck = { ...remoteFingerprint(binding), checkedAt: error ? previous?.checkedAt ?? null : new Date().toISOString(), error }
    await this.git(['config', '--local', 'markflow.remoteCheck', JSON.stringify(value)])
  }
  private async validateRemote(binding: RemoteBinding, push = false) {
    if (!binding.remote) throw new Error('请先连接 GitHub 仓库。')
    if (!binding.branch || !binding.trackingBranch) throw new Error('请先选择本地分支，并绑定 origin 的远端分支。')
    if (!path.isAbsolute(binding.remote)) normalizeGithubRemote(binding.remote)
    await this.git(['check-ref-format', `refs/heads/${binding.trackingBranch}`])
    if (push) {
      const remotes = (await this.git(['remote', 'get-url', '--push', '--all', 'origin'])).split('\n')
      if (remotes.length !== 1 || remotes[0] !== binding.remote) throw new Error('推送地址与显示的仓库地址不同。请重新保存仓库配置后再上传。')
    }
  }
  private async fetchNow(): Promise<GitStatus> {
    await this.requireRepository()
    const binding = await this.binding()
    try {
      await this.validateRemote(binding)
      await this.git(['fetch', '--prune', '--no-prune-tags', '--no-tags', '--no-recurse-submodules', '--refmap=', binding.remote, '+refs/heads/*:refs/remotes/origin/*'], { network: true })
      if (!this.sameBinding(binding, await this.binding())) throw new Error('下载期间仓库分支或远端配置发生变化，已停止后续操作。')
      await this.recordRemoteCheck(binding, null)
    } catch (error) {
      if (this.sameBinding(binding, await this.binding())) await this.recordRemoteCheck(binding, cleanError(error))
      throw error
    }
    return this.statusNow()
  }
  private async statusNow(): Promise<GitStatus> {
    const result: GitStatus = { available: false, repository: false, branch: '', remote: '', ahead: 0, behind: 0, changes: [], conflicts: [], identity: { name: '', email: '' }, blocked: null, lastSync: null, checkedAt: null, remoteState: 'unconfigured', remoteError: null, trackingBranch: '' }
    try { if (!this.versionChecked) { await this.git(['--version']); this.versionChecked = true }; result.available = true } catch { result.blocked = '找不到可用的 Git。请安装本机 Git 并重新启动 MarkFlow。'; return result }
    const top = await this.optional(['rev-parse', '--show-toplevel'])
    if (!top) return result
    try { await this.requireRepository(top) } catch (error) { result.blocked = cleanError(error); return result }
    result.repository = true
    const [branch, remote, config, localSync, porcelain, special] = await Promise.all([
      this.optional(['symbolic-ref', '--quiet', '--short', 'HEAD']),
      this.optional(['remote', 'get-url', 'origin']),
      this.optional(['config', '--null', '--get-regexp', '^user\\.(name|email)$']),
      this.optional(['config', '--local', 'oopsmd.lastSync']),
      this.worktreeRun(['-c', 'core.ignorecase=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all']),
      this.specialState(),
    ])
    result.branch = branch
    result.remote = cleanError(remote)
    for (const entry of config.split('\0')) {
      const separator = entry.indexOf('\n')
      if (separator >= 0 && entry.slice(0, separator) === 'user.name') result.identity.name = entry.slice(separator + 1)
      if (separator >= 0 && entry.slice(0, separator) === 'user.email') result.identity.email = entry.slice(separator + 1)
    }
    result.lastSync = localSync || null
    const raw = porcelain.toString('utf8').split('\0')
    const untracked: string[] = []
    for (let i = 0; i < raw.length; i++) {
      if (!raw[i]) continue
      result.changes.push(raw[i].slice(3))
      if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(raw[i].slice(0, 2))) result.conflicts.push(raw[i].slice(3))
      if (raw[i].startsWith('?? ')) untracked.push(raw[i].slice(3))
      if (/[RC]/.test(raw[i].slice(0, 2))) { if (raw[i + 1]) result.changes.push(raw[++i]) }
    }
    if (process.platform === 'win32' && untracked.length) {
      // Directory case changes may surface only the new path; inspect matching index entries, not the filesystem tree.
      const aliases = (await this.git(['ls-files', '--cached', '-z', '--', ...untracked.map(file => `:(icase,literal)${file}`)], { literalPathspecs: false })).split('\0').filter(Boolean)
      result.changes.push(...aliases)
    }
    result.changes = [...new Set(result.changes)]
    result.blocked = special
    if (!result.blocked && result.conflicts.length) result.blocked = '仓库存在未解决的冲突，请先处理冲突。'
    if (!result.blocked && !result.branch) result.blocked = '仓库处于 detached HEAD；请先切换到分支。'
    if (!result.blocked && (!result.identity.name || !result.identity.email)) result.blocked = '尚未配置 Git 作者姓名和邮箱。'
    const binding = await this.binding({ branch, remote })
    result.trackingBranch = binding.trackingBranch
    if (!binding.remote) return result
    const check = await this.remoteCheck(binding)
    result.checkedAt = check?.checkedAt ?? null
    result.remoteError = check?.error ?? null
    const age = check?.checkedAt ? Date.now() - Date.parse(check.checkedAt) : NaN
    result.remoteState = check?.error ? 'unavailable' : age >= 0 && age < remoteCheckMaxAge ? 'current' : 'unchecked'
    if (result.remoteState === 'unchecked' || result.remoteState === 'unavailable') return result
    const upstream = `refs/remotes/origin/${binding.trackingBranch}`
    const target = await this.optional(['rev-parse', '--verify', upstream])
    if (!target) { result.remoteState = 'missing-branch'; return result }
    const head = await this.optional(['rev-parse', '--verify', 'HEAD'])
    if (!head) { result.behind = Number(await this.git(['rev-list', '--count', upstream])); result.remoteState = 'behind'; return result }
    const counts = await this.optional(['rev-list', '--left-right', '--count', `HEAD...${upstream}`])
    if (counts) [result.ahead, result.behind] = counts.split(/\s+/).map(Number)
    result.remoteState = result.ahead && result.behind ? await this.optional(['merge-base', 'HEAD', upstream]) ? 'diverged' : 'unrelated' : result.ahead ? 'ahead' : result.behind ? 'behind' : 'current'
    return result
  }

  status() { return this.statusNow() }

  async hasRepository(): Promise<boolean> { try { await this.requireRepository(); return true } catch { return false } }

  init(identity: Identity): Promise<GitStatus> {
    return this.serial(async () => {
      const top = await this.optional(['rev-parse', '--show-toplevel'])
      if (top) await this.requireRepository()
      else await this.git(['init', '--initial-branch=main'])
      const special = await this.specialState()
      if (special) throw new Error(special)
      await this.identity(identity)
      if (!await this.optional(['rev-parse', '--verify', 'HEAD'])) {
        if (await this.git(['ls-files', '--cached', '-z'])) throw new Error('仓库已有暂存内容，请先使用原 Git 工具处理；MarkFlow 未更改暂存区。')
        const files = (await this.git(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean)
        if (files.length) {
          const result = await this.commitNow(files, 'Initialize MarkFlow library')
          if (result.error) throw new Error(result.error)
        }
      }
      return this.statusNow()
    })
  }

  configure(remote: string, branch: string, identity: Identity): Promise<GitStatus> {
    return this.serial(async () => {
      await this.requireRepository()
      const special = await this.specialState()
      if (special) throw new Error(special)
      const remoteValue = normalizeGithubRemote(remote).url
      if (!branch || branch.startsWith('-') || /[\0\r\n]/.test(branch)) throw new Error('无效的 Git 分支名称。')
      await this.git(['check-ref-format', '--branch', branch])
      const current = await this.optional(['symbolic-ref', '--quiet', '--short', 'HEAD'])
      if (!current) throw new Error('请先在 Git 工具中切换到本地分支，再配置远端。')
      const before = await this.binding()
      await this.identity(identity)
      if (await this.optional(['remote', 'get-url', 'origin'])) await this.git(['remote', 'set-url', 'origin', remoteValue])
      else await this.git(['remote', 'add', 'origin', remoteValue])
      // An old pushurl must not silently send a newly configured library to a different repository.
      await this.git(['config', '--local', '--replace-all', 'remote.origin.url', remoteValue])
      await this.git(['config', '--local', '--replace-all', 'remote.origin.pushurl', remoteValue])
      await this.git(['config', '--local', `branch.${current}.remote`, 'origin'])
      await this.git(['config', '--local', `branch.${current}.merge`, `refs/heads/${branch}`])
      if (!this.sameBinding(before, await this.binding())) await this.optional(['config', '--local', '--unset-all', 'markflow.remoteCheck'])
      return this.statusNow()
    })
  }

  baseline(file: string): Promise<string | null> {
    return this.serial(async () => {
      const filename = await this.safePath(file)
      try {
        await this.requireRepository()
        return (await this.run(['show', `HEAD:${filename}`])).toString('utf8')
      } catch { return null }
    })
  }

  commit(files: string[], message: string, expected?: Record<string, string | Buffer>): Promise<GitCommitResult> {
    return this.serial(() => this.commitNow(files, message, expected))
  }

  private async commitNow(files: string[], message: string, expected?: Record<string, string | Buffer>): Promise<GitCommitResult> {
    let lock: Awaited<ReturnType<typeof open>> | undefined
    let lockPath = ''
    let indexPath = ''
    let snapshotIndex = ''
    let newIndex = ''
    let oid: string | undefined
    let ownsLock = false
    try {
      await this.requireRepository()
      const state = await this.statusNow()
      if (state.blocked) throw new Error(state.blocked)
      if (!files.length) return { committed: false }
      if (!message.trim() || /\0/.test(message)) throw new Error('版本说明不能为空。')
      const requested = await Promise.all(files.map(file => this.safePath(file)))
      const selectedSet = new Set(requested)
      const actualRoot = await realpath(this.root)
      const actualSpelling = async (file: string) => {
        try { return path.relative(actualRoot, await realpath(path.join(this.root, file))).replaceAll('\\', '/') }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
      }
      if (process.platform === 'win32') {
        for (const file of requested) {
          const actual = await actualSpelling(file)
          if (actual && actual.toLowerCase() === file.toLowerCase()) {
            selectedSet.add(actual)
            for (const changed of state.changes) if (changed.toLowerCase() === actual.toLowerCase()) selectedSet.add(changed)
          }
        }
      }
      const selected = [...selectedSet]
      const dir = await this.gitDir()
      indexPath = path.join(dir, 'index')
      lockPath = `${indexPath}.lock`
      // Holding the native lock also prevents another Git tool from staging during this transaction.
      lock = await open(lockPath, 'wx')
      ownsLock = true
      const staged = (await this.git(['diff', '--cached', '--name-only', '-z', '--', ...selected])).split('\0').filter(Boolean)
      if (staged.length) throw new Error(`所选文件已有暂存或部分暂存内容，已暂停记录：${staged.join('、')}`)
      const head = await this.optional(['rev-parse', '--verify', 'HEAD'])
      snapshotIndex = path.join(dir, `oopsmd-snapshot-${randomUUID()}`)
      newIndex = path.join(dir, `oopsmd-index-${randomUUID()}`)
      await this.git(head ? ['read-tree', head] : ['read-tree', '--empty'], { index: snapshotIndex })
      if (await exists(indexPath)) await copyFile(indexPath, newIndex)
      else await this.git(['read-tree', '--empty'], { index: newIndex })
      for (const file of selected) {
        let content: Buffer | null = null
        // Windows opens the old spelling after a case-only rename; Git must record it as deleted.
        const renamedCase = process.platform === 'win32' && await actualSpelling(file) !== file
        if (!renamedCase) {
          try { content = await readFile(path.join(this.root, file)) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        }
        const wanted = expected?.[file]
        if (wanted !== undefined && (content === null || !content.equals(Buffer.isBuffer(wanted) ? wanted : Buffer.from(wanted)))) throw new Error(`文件在保存后被外部修改，未记录版本：${file}`)
        if (content === null) await this.git(['update-index', '--force-remove', '--', file], { index: snapshotIndex })
        else {
          const blob = await this.worktreeGit(['hash-object', '-w', `--path=${file}`, '--stdin'], { input: content })
          const entry = await this.git(['ls-files', '--stage', '--', file], { index: snapshotIndex })
          const mode = entry.startsWith('100755 ') ? '100755' : '100644'
          await this.git(['update-index', '--add', '--cacheinfo', mode, blob, file], { index: snapshotIndex })
        }
      }
      const tree = await this.git(['write-tree'], { index: snapshotIndex })
      if (head && tree === await this.git(['rev-parse', `${head}^{tree}`])) return { committed: false }
      // commit-tree records the captured bytes, never a second read of a changing working file.
      const candidate = await this.git(['commit-tree', tree, ...(head ? ['-p', head] : []), '-m', message])
      await this.git(['reset', '--quiet', candidate, '--', ...selected], { index: newIndex })
      await lock.close(); lock = undefined
      await copyFile(newIndex, lockPath)
      await this.git(['update-ref', '-m', `MarkFlow: ${message.split('\n')[0]}`, 'HEAD', candidate, head || '0'.repeat(candidate.length)])
      oid = candidate
      await rename(lockPath, indexPath)
      lockPath = ''
      return { committed: true, oid }
    } catch (error) {
      return { committed: Boolean(oid), ...(oid ? { oid } : {}), error: cleanError(error) }
    } finally {
      await lock?.close()
      for (const file of [snapshotIndex, newIndex]) if (file) await rm(file, { force: true }).catch(() => {})
      if (lockPath && ownsLock) await rm(lockPath, { force: true }).catch(() => {})
    }
  }

  history(file: string): Promise<HistoryEntry[]> {
    return this.serial(async () => {
      const filename = await this.safePath(file)
      try { await this.requireRepository() } catch { return [] }
      if (!await this.optional(['rev-parse', '--verify', 'HEAD'])) return []
      const parts = (await this.git(['log', '--follow', '-100', '--format=%H%x00%aI%x00%s', '-z', '--', filename])).split('\0')
      const entries: HistoryEntry[] = []
      for (let i = 0; i + 2 < parts.length; i += 3) entries.push({ oid: parts[i], date: parts[i + 1], subject: parts[i + 2] })
      return entries
    })
  }

  version(file: string, oid: string): Promise<string> {
    return this.serial(async () => {
      await this.requireRepository()
      let filename = await this.safePath(file)
      if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(oid)) throw new Error('无效的版本标识。')
      try { return (await this.run(['show', `${oid}:${filename}`])).toString('utf8') } catch {
        const lines = (await this.git(['log', '--follow', '--format=%H', '--name-only', '--', filename])).split('\n')
        const offset = lines.indexOf(oid)
        if (offset >= 0) filename = lines.slice(offset + 1).find(line => line.trim()) ?? filename
        return (await this.run(['show', `${oid}:${filename}`])).toString('utf8')
      }
    })
  }

  checkRemote(): Promise<GitStatus> {
    return this.serial(async () => {
      try { return await this.fetchNow() } catch (error) {
        const state = await this.statusNow()
        return { ...state, remoteState: 'unavailable', remoteError: cleanError(error) }
      }
    }, remoteQueues)
  }

  private async requireCleanUpdate(state: GitStatus) {
    const special = await this.specialState()
    if (special) throw new Error(special)
    if (!state.branch) throw new Error('请先切换到本地分支。')
    if (state.changes.length) throw new Error('更新前请先记录或处理全部工作区和暂存区变更；未跟踪文件也需要处理。')
  }
  private async updateNow(): Promise<GitStatus> {
    await this.requireRepository()
    const before = await this.statusNow()
    await this.requireCleanUpdate(before)
    const head = await this.optional(['rev-parse', '--verify', 'HEAD'])
    const state = await this.fetchNow()
    if (state.branch !== before.branch || await this.specialState() || head !== await this.optional(['rev-parse', '--verify', 'HEAD'])) throw new Error('下载期间本地分支或版本发生变化，已停止更新。')
    if (state.changes.length) throw new Error('下载期间出现新的本地修改，已停止更新。请先保护并记录这些修改。')
    if (state.remoteState === 'missing-branch') throw new Error('远端分支不存在；未更新本地，也未重新发布分支。')
    if (state.remoteState === 'unrelated') throw new Error('本地与远端没有共同历史。请获取独立副本后手动迁移内容；不会拼接或覆盖两边历史。')
    if (!state.behind) return state
    if (state.ahead && (!state.identity.name || !state.identity.email)) throw new Error('合并两个分支前，请配置 Git 作者姓名和邮箱。')
    const target = await this.git(['rev-parse', '--verify', `refs/remotes/origin/${state.trackingBranch}`])
    try { await this.worktreeGit(['-c', `branch.${state.branch}.mergeOptions=`, 'merge', '--no-autostash', '--ff', '--no-edit', target]) } catch (error) {
      if ((await this.statusNow()).conflicts.length) return this.statusNow()
      throw error
    }
    return this.statusNow()
  }
  updateFromRemote(): Promise<GitStatus> { return this.serial(() => this.serial(() => this.updateNow()), remoteQueues) }

  private async pushNow(publish: boolean): Promise<GitStatus> {
    await this.requireRepository()
    const special = await this.specialState()
    if (special) throw new Error(special)
    const binding = await this.binding()
    await this.validateRemote(binding, true)
    const state = await this.fetchNow()
    if (!this.sameBinding(binding, await this.binding()) || await this.specialState()) throw new Error('检查期间分支或仓库状态发生变化，已停止上传。')
    const head = await this.optional(['rev-parse', '--verify', 'HEAD'])
    if (!head) throw new Error('本地尚无版本；请先保存并记录一个文档。')
    const ref = `refs/heads/${binding.trackingBranch}`
    const target = await this.optional(['rev-parse', '--verify', `refs/remotes/origin/${binding.trackingBranch}`])
    if (publish && target) throw new Error('远端分支已存在，请检查更新后使用上传；不会覆盖现有分支。')
    if (!publish && !target) throw new Error('远端分支不存在；上传已停止。如需创建，请明确选择发布新分支。')
    if (target && await this.optional(['merge-base', head, target]) !== target) throw new Error(state.remoteState === 'unrelated' ? '本地与远端没有共同历史，不能上传覆盖。' : '远端有本地尚未包含的版本，请先更新本地并处理合并。')
    try {
      // The ancestry check forbids history replacement; the explicit lease also rejects a deleted or raced branch.
      await this.git(['-c', 'remote.origin.mirror=false', 'push', '--no-force', '--no-mirror', '--no-follow-tags', '--recurse-submodules=no', `--force-with-lease=${ref}:${target}`, binding.remote, `${head}:${ref}`], { network: true })
      if (!this.sameBinding(binding, await this.binding())) throw new Error('版本已上传到检查时的远端，但上传期间项目配置发生变化，请重新检查当前来源。')
      await this.git(['update-ref', `refs/remotes/origin/${binding.trackingBranch}`, head])
      await this.git(['config', '--local', `branch.${binding.branch}.remote`, 'origin'])
      await this.git(['config', '--local', `branch.${binding.branch}.merge`, ref])
      await this.recordRemoteCheck(binding, null)
      await this.git(['config', '--local', 'oopsmd.lastSync', new Date().toISOString()])
    } catch (error) {
      if (this.sameBinding(binding, await this.binding())) await this.recordRemoteCheck(binding, cleanError(error))
      throw error
    }
    return this.statusNow()
  }
  pushChanges(): Promise<GitStatus> { return this.serial(() => this.serial(() => this.pushNow(false)), remoteQueues) }
  publishBranch(): Promise<GitStatus> { return this.serial(() => this.serial(() => this.pushNow(true)), remoteQueues) }

  sync(): Promise<GitStatus> {
    return this.serial(() => this.serial(async () => {
      const state = await this.updateNow()
      return state.conflicts.length ? state : this.pushNow(false)
    }), remoteQueues)
  }

  abortMerge(): Promise<GitStatus> {
    return this.serial(async () => {
      await this.requireRepository()
      if (!await exists(path.join(await this.gitDir(), 'MERGE_HEAD'))) throw new Error('当前没有可以中止的合并。')
      await this.worktreeGit(['merge', '--abort'])
      return this.statusNow()
    })
  }

  resolveConflict(file: string, choice: 'ours' | 'theirs'): Promise<GitStatus> {
    return this.serial(async () => {
      await this.requireRepository()
      const filename = await this.safePath(file)
      if (choice !== 'ours' && choice !== 'theirs') throw new Error('无效的冲突处理方式。')
      if (!(await this.statusNow()).conflicts.includes(filename)) throw new Error('该文件没有未解决的冲突。')
      const stage = choice === 'ours' ? '2' : '3'
      const entries = (await this.git(['ls-files', '--unmerged', '--', filename])).split('\n')
      if (entries.some(entry => entry.split('\t')[0].endsWith(` ${stage}`))) {
        await this.worktreeGit(['checkout', `--${choice}`, '--', filename])
        await this.worktreeGit(['add', '--', filename])
      } else await this.git(['rm', '--force', '--', filename])
      return this.statusNow()
    })
  }

  finishMerge(): Promise<GitStatus> {
    return this.serial(async () => {
      await this.requireRepository()
      if (!await exists(path.join(await this.gitDir(), 'MERGE_HEAD'))) throw new Error('当前没有等待完成的合并。')
      if ((await this.statusNow()).conflicts.length) throw new Error('请先解决全部冲突。')
      if (await this.git(['diff', '--name-only'])) throw new Error('冲突处理后存在未暂存修改；请先保护并处理这些内容。')
      const base = await this.git(['merge-base', 'HEAD', 'MERGE_HEAD'])
      const allowed = new Set((await this.git(['diff', '--name-only', '-z', base, 'HEAD'])).split('\0').concat((await this.git(['diff', '--name-only', '-z', base, 'MERGE_HEAD'])).split('\0')))
      const staged = (await this.git(['diff', '--cached', '--name-only', '-z'])).split('\0').filter(Boolean)
      if (staged.some(file => !allowed.has(file))) throw new Error('暂存区出现合并范围外的文件，请使用 Git 工具单独处理后重试。')
      await this.git(['commit', '--no-edit'])
      return this.statusNow()
    })
  }
}
