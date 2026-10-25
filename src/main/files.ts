import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { defaultSettings, fontFamilies, type ArchiveEntry, type DiskFile, type Draft, type FileEntry, type MutationResult, type Settings } from '../shared/types'

const documentExtensions = new Set(['.md', '.markdown', '.mdown', '.txt', '.tex'])
const ignored = new Set(['.git', 'node_modules'])
const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const normalizedText = (text: string) => text.replace(/\r\n?|\n/g, '\n')
const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
const beneath = (value: string, parent: string) => samePath(value, parent) || (process.platform === 'win32' ? value.toLowerCase().startsWith(`${parent.toLowerCase()}/`) : value.startsWith(`${parent}/`))

function relativePath(input: string, allowRoot = false): string {
  if (typeof input !== 'string' || path.isAbsolute(input) || /^[A-Za-z]:/.test(input)) throw new Error('只能访问文档库内的相对路径。')
  const relative = input.replace(/\\/g, '/')
  if (relative === '' && allowRoot) return ''
  const parts = relative.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part)
    || /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part) || part.toLowerCase() === '.git')) {
    throw new Error('路径无效，不能越过文档库、访问 .git 或使用 Windows 保留文件名。')
  }
  return parts.join('/')
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
}

async function exists(target: string): Promise<boolean> {
  try { await fs.lstat(target); return true } catch (error) { if (isMissing(error)) return false; throw error }
}

export async function atomicWrite(target: string, content: string | Buffer, beforeReplace?: () => Promise<void>, mode?: number): Promise<void> {
  const temporary = path.join(path.dirname(target), `.oopsmd-${randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    handle = await fs.open(temporary, 'wx', mode ?? 0o600)
    await handle.writeFile(content)
    await handle.sync()
    await handle.close()
    handle = undefined
    await beforeReplace?.()
    await fs.rename(temporary, target)
  } finally {
    await handle?.close()
    await fs.rm(temporary, { force: true })
  }
}

type StoredDraft = Draft & { eol?: DiskFile['eol']; bom?: boolean }
type DraftRecord = { draft: StoredDraft; filename: string; original: string }
type ArchiveState = { entries: ArchiveEntry[]; pending?: { kind: 'move' | 'remove'; from: string; to?: string; entries: ArchiveEntry[] } }

function compactArchive(entries: ArchiveEntry[]): ArchiveEntry[] {
  const result: ArchiveEntry[] = []
  for (const entry of [...entries].sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path))) {
    if (!result.some(parent => beneath(entry.path, parent.path))) result.push(entry)
  }
  return result.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
}

export class FileService {
  public readonly root: string
  private readonly draftsDirectory: string
  private readonly archiveFilename: string
  private pending: Promise<unknown> = Promise.resolve()
  private readonly formats = new Map<string, Pick<DiskFile, 'eol' | 'bom'>>()

  constructor(root: string, userData: string, private readonly trash?: (absolutePath: string) => Promise<void>) {
    this.root = path.resolve(root)
    if (this.root.split(/[\\/]/).some(component => component.toLowerCase() === '.git')) throw new Error('不能把 Git 内部目录作为文档库。')
    const key = process.platform === 'win32' ? this.root.toLowerCase() : this.root
    this.draftsDirectory = path.join(userData, 'drafts', digest(key))
    this.archiveFilename = path.join(userData, 'archive', `${digest(key)}.json`)
    if (inside(this.root, path.resolve(this.draftsDirectory))) throw new Error('恢复草稿必须保存在文档库之外。')
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation, operation)
    this.pending = next.catch(() => undefined)
    return next
  }

  /** Validate every existing ancestor, including junctions and symlinks. */
  async resolve(input: string): Promise<string> {
    const relative = relativePath(input, true)
    const root = await fs.realpath(this.root)
    let target = root
    for (const component of relative.split('/').filter(Boolean)) {
      target = path.join(target, component)
      try { target = await fs.realpath(target) } catch (error) { if (!isMissing(error)) throw error }
      if (!inside(root, target)) throw new Error('路径指向文档库之外。')
      if (path.relative(root, target).split(path.sep).some(part => part.toLowerCase() === '.git')) throw new Error('不能访问 Git 内部文件。')
    }
    return target
  }

  async tree(): Promise<FileEntry[]> {
    const walk = async (relative: string): Promise<FileEntry[]> => {
      const directory = await this.resolve(relative)
      const entries = await fs.readdir(directory, { withFileTypes: true })
      const result: FileEntry[] = []
      for (const entry of entries) {
        if (ignored.has(entry.name.toLowerCase()) || entry.name.startsWith('.oopsmd-') || entry.isSymbolicLink()) continue
        const itemPath = relative ? `${relative}/${entry.name}` : entry.name
        try { relativePath(itemPath) } catch { continue }
        if (!entry.isFile() && !entry.isDirectory()) continue
        result.push({ path: itemPath, name: entry.name, directory: entry.isDirectory(), ...(entry.isDirectory() ? { children: await walk(itemPath) } : {}) })
      }
      return result.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
    }
    return walk('')
  }

  private async writeArchive(state: ArchiveState): Promise<void> {
    await fs.mkdir(path.dirname(this.archiveFilename), { recursive: true })
    await atomicWrite(this.archiveFilename, JSON.stringify(state, null, 2))
  }

  private async archiveEntries(input: unknown): Promise<ArchiveEntry[]> {
    if (!Array.isArray(input)) throw new Error('归档记录格式无效，原记录已保留。')
    const entries: ArchiveEntry[] = []
    for (const entry of input) {
      if (!entry || typeof entry.archivedAt !== 'string' || !Number.isFinite(Date.parse(entry.archivedAt))) throw new Error('归档记录时间无效，原记录已保留。')
      const relative = relativePath(entry.path)
      await this.resolve(relative)
      entries.push({ path: relative, archivedAt: entry.archivedAt })
    }
    return compactArchive(entries)
  }

  // Checking the actual spelling distinguishes a completed Windows case-only rename.
  private async archivePathExists(relative: string): Promise<boolean> {
    const target = await this.resolve(relative)
    if (!await exists(target)) return false
    const parent = path.posix.dirname(relative)
    return (await fs.readdir(await this.resolve(parent === '.' ? '' : parent))).includes(path.posix.basename(relative))
  }

  private async readArchive(): Promise<ArchiveEntry[]> {
    let state: ArchiveState
    try { state = JSON.parse(await fs.readFile(this.archiveFilename, 'utf8')) }
    catch (error) { if (isMissing(error)) return []; throw new Error(`归档记录无法读取，原文件已保留：${this.archiveFilename}`) }
    if (!state || typeof state !== 'object') throw new Error('归档记录格式无效，原记录已保留。')
    const entries = await this.archiveEntries(state.entries)
    if (!state.pending) return entries
    const pending = state.pending
    if (!['move', 'remove'].includes(pending.kind)) throw new Error('待完成归档操作无效，原记录已保留。')
    const from = relativePath(pending.from)
    const next = await this.archiveEntries(pending.entries)
    const sourceExists = await this.archivePathExists(from)
    let completed = !sourceExists
    if (pending.kind === 'move') {
      const targetExists = await this.archivePathExists(relativePath(pending.to!))
      if (sourceExists === targetExists) throw new Error(`归档记录待恢复，无法确定 ${from} 的移动结果；文件未作修改，原记录位于 ${this.archiveFilename}`)
      completed = targetExists
    }
    const recovered = completed ? next : entries
    await this.writeArchive({ entries: recovered })
    return recovered
  }

  listArchive(): Promise<ArchiveEntry[]> { return this.serialize(() => this.readArchive()) }

  archive(input: string): Promise<ArchiveEntry[]> {
    return this.serialize(async () => {
      const relative = relativePath(input)
      const target = await this.resolve(relative)
      await this.assertNotLink(relative)
      const info = await fs.stat(target)
      if (!info.isFile() && !info.isDirectory()) throw new Error('只能归档普通文件或文件夹。')
      const entries = await this.readArchive()
      if (entries.some(entry => beneath(relative, entry.path))) return entries
      const next = compactArchive([...entries, { path: relative, archivedAt: new Date().toISOString() }])
      await this.writeArchive({ entries: next })
      return next
    })
  }

  unarchive(input: string): Promise<ArchiveEntry[]> {
    return this.serialize(async () => {
      const relative = relativePath(input)
      await this.resolve(relative)
      const entries = await this.readArchive()
      const parent = entries.find(entry => !samePath(entry.path, relative) && beneath(relative, entry.path))
      if (parent) throw new Error(`此项目仍在已归档文件夹 ${parent.path} 内，请先恢复该文件夹。`)
      const next = entries.filter(entry => !beneath(entry.path, relative))
      if (next.length !== entries.length) await this.writeArchive({ entries: next })
      return next
    })
  }

  private async prepareArchiveMutation(kind: 'move' | 'remove', from: string, to?: string) {
    const entries = await this.readArchive()
    const next = entries.flatMap(entry => beneath(entry.path, from) ? (to ? [{ ...entry, path: to + entry.path.slice(from.length) }] : []) : [entry])
    // A file moved out of an archived folder retains its archive designation.
    const inherited = entries.find(entry => !samePath(entry.path, from) && beneath(from, entry.path))
    if (to && inherited) next.push({ path: to, archivedAt: inherited.archivedAt })
    const compacted = compactArchive(next)
    if (JSON.stringify(entries) === JSON.stringify(compacted)) return { finish: async () => undefined }
    // Persist intent before touching disk; listArchive can finish or undo it after a crash.
    await this.writeArchive({ entries, pending: { kind, from, ...(to ? { to } : {}), entries: compacted } })
    return { finish: async () => this.writeArchive({ entries: compacted }) }
  }

  private assertDocument(relative: string): void {
    if (!documentExtensions.has(path.extname(relative).toLowerCase())) throw new Error('仅支持 UTF-8 的 .md、.markdown、.mdown、.txt 和 .tex 文本文件。')
  }

  private async assertNotLink(relative: string): Promise<void> {
    if ((await fs.lstat(path.join(this.root, relative))).isSymbolicLink()) throw new Error('请直接操作原文件；不能通过符号链接移动或删除目标。')
  }

  async read(input: string): Promise<DiskFile> {
    const relative = relativePath(input)
    this.assertDocument(relative)
    const target = await this.resolve(relative)
    if (!(await fs.stat(target)).isFile()) throw new Error('所选路径不是普通文件。')
    const bytes = await fs.readFile(target)
    const bom = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bom ? bytes.subarray(3) : bytes) } catch { throw new Error('文件不是有效的 UTF-8 文本，未进行修改。') }
    if (text.includes('\0')) throw new Error('检测到二进制内容，不能作为文本编辑。')
    const eol = text.match(/\r\n|\r|\n/)?.[0] as DiskFile['eol'] | undefined
    const file: DiskFile = { path: relative, content: normalizedText(text), revision: digest(bytes), eol: eol ?? '\n', bom }
    this.formats.set(file.revision, { eol: file.eol, bom })
    return file
  }

  write(input: string, content: string, revision: string): Promise<DiskFile> {
    return this.serialize(async () => {
      if (typeof content !== 'string' || content.includes('\0')) throw new Error('文档内容必须是有效文本。')
      const current = await this.read(input)
      if (current.revision !== revision) throw new Error('文件已被外部程序修改。请先处理冲突；磁盘文件和恢复草稿均未覆盖。')
      const text = normalizedText(content)
      if (text === current.content) return current
      const target = await this.resolve(input)
      const bytes = Buffer.from(`${current.bom ? '\uFEFF' : ''}${text.replace(/\n/g, current.eol)}`, 'utf8')
      const metadata = await fs.stat(target)
      await atomicWrite(target, bytes, async () => {
        const validated = await this.resolve(input)
        if (!samePath(validated, target) || digest(await fs.readFile(validated)) !== revision) throw new Error('保存期间文件已发生外部修改，已取消写入。')
      }, metadata.mode)
      const saved: DiskFile = { ...current, content: text, revision: digest(bytes) }
      this.formats.set(saved.revision, { eol: saved.eol, bom: saved.bom })
      return saved
    })
  }

  private draftPath(input: string): string {
    const relative = relativePath(input)
    return path.join(this.draftsDirectory, `${digest(process.platform === 'win32' ? relative.toLowerCase() : relative)}.json`)
  }

  async getDraft(input: string): Promise<Draft | null> {
    await this.resolve(input)
    try {
      const draft: StoredDraft = JSON.parse(await fs.readFile(this.draftPath(input), 'utf8'))
      if (!samePath(draft.path, relativePath(input)) || typeof draft.content !== 'string' || typeof draft.revision !== 'string' || !Number.isFinite(Date.parse(draft.updatedAt))) throw new Error('恢复草稿格式无效，原草稿已保留。')
      return { ...draft, path: relativePath(input) }
    } catch (error) { if (isMissing(error)) return null; throw error }
  }

  draft(draft: Draft): Promise<void> {
    return this.serialize(async () => {
      const relative = relativePath(draft.path)
      this.assertDocument(relative)
      await this.resolve(relative)
      if (typeof draft.content !== 'string' || typeof draft.revision !== 'string' || !Number.isFinite(Date.parse(draft.updatedAt))) throw new Error('恢复草稿格式无效。')
      await fs.mkdir(this.draftsDirectory, { recursive: true })
      const stored: StoredDraft = { ...draft, path: relative, ...this.formats.get(draft.revision) }
      await atomicWrite(this.draftPath(relative), JSON.stringify(stored))
    })
  }

  clearDraft(input: string): Promise<void> {
    return this.serialize(async () => { await fs.rm(this.draftPath(input), { force: true }) })
  }

  private async allDrafts(): Promise<DraftRecord[]> {
    let names: string[]
    try { names = await fs.readdir(this.draftsDirectory) } catch (error) { if (isMissing(error)) return []; throw error }
    const records: DraftRecord[] = []
    for (const name of names.filter(value => value.endsWith('.json'))) {
      const filename = path.join(this.draftsDirectory, name)
      const original = await fs.readFile(filename, 'utf8')
      let draft: StoredDraft
      try {
        draft = JSON.parse(original)
        if (!draft || typeof draft.path !== 'string' || typeof draft.content !== 'string' || typeof draft.revision !== 'string'
          || !Number.isFinite(Date.parse(draft.updatedAt)) || !samePath(this.draftPath(draft.path), filename)) throw new Error('Invalid draft')
      } catch { throw new Error(`恢复草稿格式无效，未移动或删除文件；请先检查 ${filename}。`) }
      records.push({ draft, filename, original })
    }
    return records
  }

  private async prepareDraftMove(from: string, to: string) {
    const drafts = await this.allDrafts()
    const plans = drafts.filter(record => beneath(record.draft.path, from)).map(record => {
      const nextPath = to + record.draft.path.slice(from.length)
      return { ...record, nextPath, target: this.draftPath(nextPath), content: JSON.stringify({ ...record.draft, path: nextPath }), created: false, changedCase: false }
    })
    for (const destination of drafts.filter(record => beneath(record.draft.path, to))) {
      const plan = plans.find(item => samePath(item.target, destination.filename))
      if (!plan || (!samePath(plan.filename, destination.filename) && plan.content !== destination.original)) throw new Error(`目标位置已有恢复草稿：${destination.draft.path}。请先恢复或导出该文档，原文件未移动。`)
    }
    const rollback = async () => {
      for (const plan of [...plans].reverse()) {
        if (plan.changedCase) await atomicWrite(plan.filename, plan.original)
        else if (plan.created) await fs.rm(plan.target, { force: true })
      }
    }
    try {
      for (const plan of plans) {
        if (samePath(plan.filename, plan.target)) {
          await atomicWrite(plan.filename, plan.content)
          plan.changedCase = true
        } else if (!await exists(plan.target)) {
          const handle = await fs.open(plan.target, 'wx')
          plan.created = true
          try { await handle.writeFile(plan.content); await handle.sync() } finally { await handle.close() }
        } else if (await fs.readFile(plan.target, 'utf8') !== plan.content) throw new Error(`目标位置已有不同恢复草稿：${plan.nextPath}。`)
      }
    } catch (error) { await rollback(); throw error }
    return {
      rollback,
      finish: async () => {
        for (const plan of plans) if (!samePath(plan.filename, plan.target)) await fs.rm(plan.filename, { force: true })
      },
    }
  }

  create(input: string, directory: boolean): Promise<void> {
    return this.serialize(async () => {
      const relative = relativePath(input)
      const target = await this.resolve(relative)
      if (directory) await fs.mkdir(target)
      else {
        this.assertDocument(relative)
        const handle = await fs.open(target, 'wx')
        await handle.close()
      }
    })
  }

  createDocument(input: string, content: string): Promise<DiskFile> {
    return this.serialize(async () => {
      const relative = relativePath(input)
      this.assertDocument(relative)
      if (typeof content !== 'string' || content.includes('\0')) throw new Error('文档内容必须是有效文本。')
      const target = await this.resolve(relative)
      const temporary = path.join(path.dirname(target), `.oopsmd-${randomUUID()}.tmp`)
      const text = normalizedText(content)
      const bytes = Buffer.from(text, 'utf8')
      let handle: Awaited<ReturnType<typeof fs.open>> | undefined
      let published = false
      try {
        handle = await fs.open(temporary, 'wx', 0o600)
        await handle.writeFile(bytes)
        await handle.sync()
        await handle.close(); handle = undefined
        if (!samePath(await this.resolve(relative), target)) throw new Error('保存期间目标路径发生变化，未保存文档。')
        // Publishing a fully written hard link is atomic and never replaces an existing file.
        await fs.link(temporary, target)
        published = true
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'EEXIST') throw new Error('目标文件已存在，未覆盖任何内容。请重新保存并选择其他文件名。')
        if (['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'ENOSYS', 'EXDEV'].includes(code ?? '')) throw new Error('此位置不支持安全的新文件写入，或没有写入权限。请换到本机 NTFS 文件夹；独立草稿仍已保留。')
        throw error
      } finally {
        await handle?.close()
        // Once published, a leftover temporary hard link must not turn a successful save into failure.
        try { await fs.rm(temporary, { force: true }) } catch (error) { if (!published) throw error }
      }
      const file: DiskFile = { path: relative, content: text, revision: digest(bytes), eol: '\n', bom: false }
      this.formats.set(file.revision, { eol: file.eol, bom: file.bom })
      return file
    })
  }

  private async affectedLinks(target: string, moving: boolean): Promise<string[]> {
    const sources: string[] = []
    const collect = (entries: FileEntry[]) => { for (const entry of entries) { if (entry.directory) collect(entry.children ?? []); else if (/\.(md|markdown|mdown)$/i.test(entry.path)) sources.push(entry.path) } }
    collect(await this.tree())
    const affected: string[] = []
    for (const source of sources) {
      let content: string
      try { content = (await this.read(source)).content } catch { continue }
      const links = [...content.matchAll(/!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\n]*?))\s*\)/g)].map(match => match[1] ?? match[2].replace(/\s+["'][\s\S]*$/, '').trim())
      links.push(...[...content.matchAll(/^\s{0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|(\S+))/gm)].map(match => match[1] ?? match[2]))
      if (links.some(link => {
        if (!link || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(link)) return false
        try { link = decodeURIComponent(link.split(/[?#]/)[0]) } catch { return false }
        const destination = path.posix.normalize(path.posix.join(path.posix.dirname(source), link.replace(/\\/g, '/')))
        return beneath(destination, target) || (moving && beneath(source, target))
      })) affected.push(source)
    }
    return affected
  }

  move(from: string, to: string): Promise<MutationResult> {
    return this.serialize(async () => {
      const sourceRelative = relativePath(from)
      const targetRelative = relativePath(to)
      if (sourceRelative === targetRelative) return { path: targetRelative, affectedLinks: [] }
      const source = await this.resolve(sourceRelative)
      const target = await this.resolve(targetRelative)
      await this.assertNotLink(sourceRelative)
      const sourceStat = await fs.lstat(source)
      if (sourceStat.isDirectory() && inside(source, target) && !samePath(source, target)) throw new Error('不能把文件夹移动到它自身内部。')
      const targetExists = await exists(target)
      const caseRename = process.platform === 'win32' && sourceRelative.toLowerCase() === targetRelative.toLowerCase()
      if (targetExists && !caseRename) throw new Error('目标路径已存在，请使用其他名称。')
      if (targetExists && caseRename) {
        const targetStat = await fs.lstat(target)
        if (sourceStat.ino !== targetStat.ino || sourceStat.dev !== targetStat.dev) throw new Error('目标路径已存在，请使用其他名称。')
      }
      const affectedLinks = await this.affectedLinks(sourceRelative, true)
      if (!samePath(await this.resolve(sourceRelative), source) || !samePath(await this.resolve(targetRelative), target)) throw new Error('操作期间路径已被外部程序修改，已取消移动。')
      const archive = await this.prepareArchiveMutation('move', sourceRelative, targetRelative)
      // Durable copies at the new paths exist before moving disk files; old drafts remain until success.
      const drafts = await this.prepareDraftMove(sourceRelative, targetRelative)
      try {
        // A temporary sibling makes Windows case-only renames reliable and reversible.
        if (caseRename) {
          const temporary = path.join(path.dirname(source), `.oopsmd-${randomUUID()}.tmp`)
          const spelledTarget = path.join(await this.resolve(path.posix.dirname(targetRelative) === '.' ? '' : path.posix.dirname(targetRelative)), path.posix.basename(targetRelative))
          await fs.rename(source, temporary)
          try {
            if (await exists(spelledTarget)) throw new Error('目标路径已存在。')
            await fs.rename(temporary, spelledTarget)
          } catch (error) {
            if (await exists(source)) throw new Error(`改名未完成，原数据保留在 ${temporary}；原位置已被外部程序占用。`)
            await fs.rename(temporary, source)
            throw error
          }
        } else {
          // Recheck after scanning links; never intentionally replace a destination.
          if (await exists(target)) throw new Error('目标路径已存在，请使用其他名称。')
          await fs.rename(source, target)
        }
      } catch (error) { await drafts.rollback(); throw error }
      const warnings: string[] = []
      try { await archive.finish() } catch { warnings.push('文件已移动，归档记录待完成；原记录和恢复信息已保留，重新打开项目后会重试。') }
      try { await drafts.finish() } catch { warnings.push(`全部恢复草稿在 ${targetRelative} 可用；部分旧草稿清理失败，请重新打开新位置。`) }
      return { path: targetRelative, affectedLinks, ...(warnings.length ? { warning: warnings.join('\n') } : {}) }
    })
  }

  remove(input: string): Promise<MutationResult> {
    return this.serialize(async () => {
      const relative = relativePath(input)
      if (!this.trash) throw new Error('系统回收站不可用，未删除文件。')
      const target = await this.resolve(relative)
      await this.assertNotLink(relative)
      await fs.lstat(target)
      const drafts = (await this.allDrafts()).filter(record => beneath(record.draft.path, relative))
      const dirty: string[] = []
      for (const { draft } of drafts) {
        try { if (normalizedText(draft.content) !== (await this.read(draft.path)).content) dirty.push(draft.path) }
        catch { dirty.push(draft.path) }
      }
      if (dirty.length) throw new Error(`以下文档仍有未保存的恢复草稿，未删除任何文件：${dirty.join('、')}。请逐个打开恢复并保存，或导出后明确放弃草稿，再重试删除。`)
      const affectedLinks = await this.affectedLinks(relative, false)
      if (!samePath(await this.resolve(relative), target)) throw new Error('操作期间路径已被外部程序修改，已取消删除。')
      const archive = await this.prepareArchiveMutation('remove', relative)
      await this.trash(target)
      const warnings: string[] = []
      try { await archive.finish() } catch { warnings.push('文件已移至系统回收站，归档记录待完成；原记录和恢复信息已保留，重新打开项目后会重试。') }
      try { for (const record of drafts) await fs.rm(record.filename, { force: true }) }
      catch { warnings.push(`${relative} 的旧恢复草稿清理失败，草稿仍已保留。`) }
      return { path: relative, affectedLinks, ...(warnings.length ? { warning: warnings.join('\n') } : {}) }
    })
  }
}

function validatedSettings(input: unknown): Settings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('设置格式无效。')
  const settings = { ...defaultSettings, ...input } as Settings
  if (typeof settings.autoCommit !== 'boolean' || !Number.isSafeInteger(settings.threshold) || settings.threshold < 1
    || !['light', 'dark'].includes(settings.theme) || !['source', 'preview', 'split'].includes(settings.layout)
    || !Number.isFinite(settings.fontSize) || settings.fontSize < 10 || settings.fontSize > 48 || !fontFamilies.includes(settings.fontFamily)
    || !Number.isFinite(settings.lineHeight) || settings.lineHeight < 1 || settings.lineHeight > 3
    || !Number.isFinite(settings.lineWidth) || settings.lineWidth < 320 || settings.lineWidth > 2400
    || !Array.isArray(settings.recent) || !settings.positions || typeof settings.positions !== 'object' || Array.isArray(settings.positions)) throw new Error('设置值无效：阈值需为正整数，字号 10–48，行距 1–3，行宽 320–2400。')
  const recent = settings.recent.slice(0, 30).map(entry => {
    if (!entry || typeof entry.root !== 'string' || !path.isAbsolute(entry.root) || entry.root.includes('\0')) throw new Error('最近文档路径无效。')
    return { root: path.resolve(entry.root), path: relativePath(entry.path) }
  })
  const raw = input as Partial<Settings>
  const projectEntries = raw.projects === undefined ? recent.map(entry => ({ root: entry.root, lastOpened: '1970-01-01T00:00:00.000Z' })) : raw.projects
  if (!Array.isArray(projectEntries)) throw new Error('项目记录格式无效。')
  const projects: Settings['projects'] = []
  for (const project of projectEntries) {
    if (!project || typeof project.root !== 'string' || !path.isAbsolute(project.root) || project.root.includes('\0') || typeof project.lastOpened !== 'string' || !Number.isFinite(Date.parse(project.lastOpened))) throw new Error('项目路径或上次打开时间无效。')
    const root = path.resolve(project.root)
    if (!projects.some(existing => samePath(existing.root, root))) projects.push({ root, lastOpened: project.lastOpened })
  }
  const lastProject = raw.lastProject === undefined ? projects[0]?.root ?? null : raw.lastProject
  if (lastProject !== null && (typeof lastProject !== 'string' || !projects.some(project => samePath(project.root, lastProject)))) throw new Error('上次项目不在已授权项目中。')
  const positions: Settings['positions'] = Object.create(null)
  for (const [key, position] of Object.entries(settings.positions)) {
    if (!position || !Number.isSafeInteger(position.cursor) || position.cursor < 0 || !Number.isFinite(position.scroll) || position.scroll < 0) throw new Error('阅读位置无效。')
    if (position.previewScroll !== undefined && (!Number.isFinite(position.previewScroll) || position.previewScroll < 0)) throw new Error('预览阅读位置无效。')
    positions[key] = { cursor: position.cursor, scroll: position.scroll, ...(position.previewScroll !== undefined ? { previewScroll: position.previewScroll } : {}) }
  }
  return { autoCommit: settings.autoCommit, threshold: settings.threshold, theme: settings.theme, fontSize: settings.fontSize, fontFamily: settings.fontFamily, lineHeight: settings.lineHeight, lineWidth: settings.lineWidth, layout: settings.layout, recent, projects, lastProject, positions }
}

export async function getSettings(userData: string): Promise<Settings> {
  try { return validatedSettings(JSON.parse(await fs.readFile(path.join(userData, 'settings.json'), 'utf8'))) }
  catch (error) { if (isMissing(error)) return validatedSettings(defaultSettings); throw error }
}

export async function putSettings(userData: string, input: Settings): Promise<Settings> {
  const settings = validatedSettings(input)
  await fs.mkdir(userData, { recursive: true })
  await atomicWrite(path.join(userData, 'settings.json'), JSON.stringify(settings, null, 2))
  return settings
}
