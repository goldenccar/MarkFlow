import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, symlink } from 'node:fs/promises'
import path from 'node:path'
import { createGunzip } from 'node:zlib'

export interface PaperBundleEntry {
  path: string
  size: number
  sha256: string
  mode: number
  link?: string
}
export interface PaperBundleManifest {
  format: 1
  id: string
  version: string
  platform: string
  arch: string
  packages: Record<string, { revision: string; license?: string }>
  licenses: string[]
  provenance: unknown
  files: PaperBundleEntry[]
}
export interface PaperEnvironmentCatalogEntry {
  id: string
  version: string
  platform: string
  arch: string
  filename: string
  sha256: string
  manifestSha256: string
  bytes: number
  expandedBytes: number
}
export type PaperEnvironmentCatalog = readonly PaperEnvironmentCatalogEntry[]

export async function sha256File(file: string, signal?: AbortSignal, progress?: (bytes: number) => void) {
  const digest = createHash('sha256')
  let count = 0
  for await (const chunk of createReadStream(file, { signal })) {
    digest.update(chunk)
    count += chunk.length
    progress?.(count)
  }
  return digest.digest('hex')
}

const safePath = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length < 1024 &&
  !/[\\\x00-\x1f:*?"<>|]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))

/** Validate paths before writing any entry, including ancestors of files and links. */
export function validatePaperBundle(manifest: PaperBundleManifest, catalog: PaperEnvironmentCatalogEntry) {
  if (manifest.format !== 1 || ['id', 'version', 'platform', 'arch'].some(key => manifest[key as 'id'] !== catalog[key as 'id']) || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 100_000) throw new Error('环境包清单不匹配。')
  const entries = new Map<string, PaperBundleEntry>()
  let total = 0
  for (const entry of manifest.files) {
    if (!entry || !safePath(entry.path) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777) throw new Error('环境包包含不安全的文件路径或属性。')
    const key = entry.path.toLowerCase()
    if (entries.has(key)) throw new Error('环境包包含重复文件。')
    entries.set(key, entry)
    total += entry.size
    if (entry.link !== undefined && (typeof entry.link !== 'string' || entry.size !== 0 || !entry.link || /[\\\x00-\x1f:]/.test(entry.link) || path.posix.isAbsolute(entry.link) || !safePath(path.posix.normalize(path.posix.join(path.posix.dirname(entry.path), entry.link))))) throw new Error('环境包包含越界的符号链接。')
  }
  if (!Number.isSafeInteger(total) || total !== catalog.expandedBytes) throw new Error('环境包展开大小不匹配。')
  for (const entry of manifest.files) {
    const parts = entry.path.toLowerCase().split('/')
    while (parts.pop() && parts.length) if (entries.has(parts.join('/'))) throw new Error('环境包文件与目录冲突。')
    if (entry.link !== undefined) {
      const target = entries.get(path.posix.normalize(path.posix.join(path.posix.dirname(entry.path), entry.link)).toLowerCase())
      if (!target || target.link !== undefined) throw new Error('环境包符号链接必须指向包内普通文件。')
    }
  }
  if (!Array.isArray(manifest.licenses) || !manifest.licenses.length || manifest.licenses.some(file => !safePath(file) || !entries.has(file.toLowerCase()))) throw new Error('环境包缺少许可文件。')
}

/** The trusted catalog authenticates this stream; no external archive program is run. */
export async function extractPaperBundle(bundle: string, destination: string, catalog: PaperEnvironmentCatalogEntry, signal: AbortSignal, progress: (bytes: number) => void) {
  signal.throwIfAborted()
  const input = createReadStream(bundle, { signal })
  const unzip = createGunzip()
  input.on('error', error => unzip.destroy(error))
  input.pipe(unzip)
  const iterator = unzip[Symbol.asyncIterator]()
  let pending = Buffer.alloc(0)
  const take = async (size: number, consume: (chunk: Buffer) => Promise<void> | void) => {
    while (size > 0) {
      signal.throwIfAborted()
      if (!pending.length) {
        const next = await iterator.next()
        if (next.done) throw new Error('环境包文件被截断。')
        pending = Buffer.from(next.value)
      }
      const length = Math.min(size, pending.length)
      await consume(pending.subarray(0, length))
      pending = pending.subarray(length)
      size -= length
    }
  }
  try {
    const header: Buffer[] = []
    await take(12, chunk => { header.push(chunk) })
    const prefix = Buffer.concat(header)
    if (prefix.subarray(0, 8).toString() !== 'MFTEX01\n') throw new Error('不是受支持的环境包。')
    const length = prefix.readUInt32BE(8)
    if (!length || length > 32 * 1024 * 1024) throw new Error('环境包清单大小异常。')
    const chunks: Buffer[] = []
    await take(length, chunk => { chunks.push(chunk) })
    const json = Buffer.concat(chunks)
    if (createHash('sha256').update(json).digest('hex') !== catalog.manifestSha256) throw new Error('环境包清单校验失败。')
    const manifest = JSON.parse(json.toString()) as PaperBundleManifest
    validatePaperBundle(manifest, catalog)
    let extracted = 0
    for (const entry of manifest.files) {
      signal.throwIfAborted()
      if (entry.link !== undefined) continue
      const file = path.join(destination, ...entry.path.split('/'))
      await mkdir(path.dirname(file), { recursive: true })
      const handle = await open(file, 'wx', entry.mode)
      const digest = createHash('sha256')
      try {
        await take(entry.size, async chunk => {
          digest.update(chunk)
          let offset = 0
          while (offset < chunk.length) offset += (await handle.write(chunk, offset)).bytesWritten
          extracted += chunk.length
          progress(extracted)
        })
      } finally { await handle.close() }
      if (digest.digest('hex') !== entry.sha256) throw new Error(`环境包文件校验失败：${entry.path}`)
    }
    if (pending.length || !(await iterator.next()).done) throw new Error('环境包包含未声明的数据。')
    for (const entry of manifest.files.filter(file => file.link !== undefined)) {
      signal.throwIfAborted()
      const file = path.join(destination, ...entry.path.split('/'))
      await mkdir(path.dirname(file), { recursive: true })
      await symlink(entry.link!, file, 'file')
    }
    return manifest
  } finally { input.destroy(); unzip.destroy() }
}
