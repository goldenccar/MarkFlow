import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFile, lstat, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { GitCommitResult, GitStatus, HistoryEntry } from '../shared/types'

type Identity = { name: string; email: string }
const queues = new Map<string, Promise<unknown>>()
const githubRemote = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/
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

  private async serial<T>(task: () => Promise<T>): Promise<T> {
    const canonical = await realpath(this.root).catch(() => this.root)
    const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical
    const result = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(task)
    queues.set(key, result)
    void result.finally(() => { if (queues.get(key) === result) queues.delete(key) }).catch(() => {})
    return result
  }

  private run(args: string[], options: { index?: string; input?: Buffer | string; network?: boolean; literalPathspecs?: boolean } = {}): Promise<Buffer> {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
    for (const key of Object.keys(env)) {
      if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|NAMESPACE|PREFIX|CONFIG.*|CEILING_DIRECTORIES|DISCOVERY_ACROSS_FILESYSTEM|EXEC_PATH|(?:LITERAL|GLOB|NOGLOB|ICASE)_PATHSPECS)$/i.test(key)) delete env[key as keyof typeof env]
    }
    if (options.index) Object.assign(env, { GIT_INDEX_FILE: options.index })
    return new Promise((resolve, reject) => {
      const child = execFile(this.binary, [...(options.literalPathspecs === false ? [] : ['--literal-pathspecs']), '-c', 'core.quotepath=false', ...(options.index ? ['-c', 'core.ignorecase=false'] : []), ...args], {
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
  private async statusNow(): Promise<GitStatus> {
    const result: GitStatus = { available: false, repository: false, branch: '', remote: '', ahead: 0, behind: 0, changes: [], conflicts: [], identity: { name: '', email: '' }, blocked: null, lastSync: null }
    try { if (!this.versionChecked) { await this.git(['--version']); this.versionChecked = true }; result.available = true } catch { result.blocked = '找不到可用的 Git。开发版请安装 Git for Windows 并重新启动 OopsMD。'; return result }
    const top = await this.optional(['rev-parse', '--show-toplevel'])
    if (!top) return result
    try { await this.requireRepository(top) } catch (error) { result.blocked = cleanError(error); return result }
    result.repository = true
    const [branch, remote, config, localSync, porcelain, special] = await Promise.all([
      this.optional(['symbolic-ref', '--quiet', '--short', 'HEAD']),
      this.optional(['remote', 'get-url', 'origin']),
      this.optional(['config', '--null', '--get-regexp', '^user\\.(name|email)$']),
      this.optional(['config', '--local', 'oopsmd.lastSync']),
      this.run(['-c', 'core.ignorecase=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all']),
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
    const upstream = `refs/remotes/origin/${result.branch}`
    const counts = await this.optional(['rev-list', '--left-right', '--count', `HEAD...${upstream}`])
    if (counts) [result.ahead, result.behind] = counts.split(/\s+/).map(Number)
    else result.ahead = Number(await this.optional(['rev-list', '--count', 'HEAD'])) || 0
    return result
  }

  status() { return this.serial(() => this.statusNow()) }

  hasRepository(): Promise<boolean> {
    return this.serial(async () => { try { await this.requireRepository(); return true } catch { return false } })
  }

  init(identity: Identity): Promise<GitStatus> {
    return this.serial(async () => {
      const top = await this.optional(['rev-parse', '--show-toplevel'])
      if (top) await this.requireRepository()
      else await this.git(['init', '--initial-branch=main'])
      const special = await this.specialState()
      if (special) throw new Error(special)
      await this.identity(identity)
      if (!await this.optional(['rev-parse', '--verify', 'HEAD'])) {
        if (await this.git(['ls-files', '--cached', '-z'])) throw new Error('仓库已有暂存内容，请先使用原 Git 工具处理；OopsMD 未更改暂存区。')
        const files = (await this.git(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean)
        if (files.length) {
          const result = await this.commitNow(files, 'Initialize OopsMD library')
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
      const remoteValue = remote.trim()
      if (!githubRemote.test(remoteValue)) throw new Error('请输入 GitHub HTTPS 或 SSH 仓库地址；地址中不能包含密码或令牌。')
      if (!branch || branch.startsWith('-') || /[\0\r\n]/.test(branch)) throw new Error('无效的 Git 分支名称。')
      await this.git(['check-ref-format', '--branch', branch])
      const current = await this.optional(['symbolic-ref', '--quiet', '--short', 'HEAD'])
      if (current !== branch) {
        if ((await this.statusNow()).changes.length) throw new Error('切换连接分支前，请先记录或处理全部本地文件变更。')
        if (!await this.optional(['rev-parse', '--verify', 'HEAD'])) await this.git(['symbolic-ref', 'HEAD', `refs/heads/${branch}`])
        else if (await this.optional(['rev-parse', '--verify', `refs/heads/${branch}`])) await this.git(['switch', branch])
        else await this.git(['switch', '-c', branch])
      }
      await this.identity(identity)
      if (await this.optional(['remote', 'get-url', 'origin'])) await this.git(['remote', 'set-url', 'origin', remoteValue])
      else await this.git(['remote', 'add', 'origin', remoteValue])
      // An old pushurl must not silently send a newly configured library to a different repository.
      await this.git(['config', '--local', '--replace-all', 'remote.origin.url', remoteValue])
      await this.git(['config', '--local', '--replace-all', 'remote.origin.pushurl', remoteValue])
      await this.git(['config', '--local', `branch.${branch}.remote`, 'origin'])
      await this.git(['config', '--local', `branch.${branch}.merge`, `refs/heads/${branch}`])
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
          const blob = await this.git(['hash-object', '-w', `--path=${file}`, '--stdin'], { input: content })
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
      await this.git(['update-ref', '-m', `OopsMD: ${message.split('\n')[0]}`, 'HEAD', candidate, head || '0'.repeat(candidate.length)])
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

  sync(): Promise<GitStatus> {
    return this.serial(async () => {
      await this.requireRepository()
      const state = await this.statusNow()
      if (state.blocked) throw new Error(state.blocked)
      if (state.changes.length) throw new Error('同步前请先记录或处理全部工作区和暂存区变更；未跟踪文件也需要处理。')
      if (!state.remote) throw new Error('请先连接 GitHub 仓库。')
      // No remote helpers, command URLs, or embedded credentials; local remotes allow offline round-trip tests.
      const remote = await this.git(['remote', 'get-url', 'origin'])
      if (!githubRemote.test(remote) && !path.isAbsolute(remote)) throw new Error('仅支持 GitHub 地址或已有的本地 Git 远端。')
      const pushRemotes = (await this.git(['remote', 'get-url', '--push', '--all', 'origin'])).split('\n')
      if (pushRemotes.length !== 1 || pushRemotes[0] !== remote) throw new Error('推送地址与显示的仓库地址不同。请重新保存仓库配置后再同步。')
      await this.git(['fetch', '--prune', '--no-prune-tags', '--no-tags', '--no-recurse-submodules', '--refmap=', 'origin', '+refs/heads/*:refs/remotes/origin/*'], { network: true })
      const fetched = await this.statusNow()
      if (fetched.branch !== state.branch || fetched.blocked) throw new Error('下载期间仓库分支或操作状态发生变化，已停止合并和推送。')
      if (fetched.changes.length) throw new Error('下载期间出现新的本地修改，已停止合并和推送。请先保存并记录这些修改。')
      const target = `refs/remotes/origin/${state.branch}`
      if (await this.optional(['rev-parse', '--verify', target])) {
        try { await this.git(['-c', `branch.${state.branch}.mergeOptions=`, 'merge', '--no-autostash', '--ff', '--no-edit', target]) } catch (error) {
          if ((await this.statusNow()).conflicts.length) return this.statusNow()
          throw error
        }
      }
      if (!await this.optional(['rev-parse', '--verify', 'HEAD'])) throw new Error('本地与远端均无版本；请先保存并记录一个文档。')
      await this.git(['-c', 'remote.origin.mirror=false', 'push', '--no-force', '--no-mirror', '--set-upstream', 'origin', `refs/heads/${state.branch}:refs/heads/${state.branch}`], { network: true })
      await this.git(['config', '--local', 'oopsmd.lastSync', new Date().toISOString()])
      return this.statusNow()
    })
  }

  abortMerge(): Promise<GitStatus> {
    return this.serial(async () => {
      await this.requireRepository()
      if (!await exists(path.join(await this.gitDir(), 'MERGE_HEAD'))) throw new Error('当前没有可以中止的合并。')
      await this.git(['merge', '--abort'])
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
        await this.git(['checkout', `--${choice}`, '--', filename])
        await this.git(['add', '--', filename])
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
