import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const catalog = JSON.parse(await readFile('src/main/paperEnvironmentCatalog.json', 'utf8'))
const entries = catalog.filter(entry => entry.platform === process.platform && entry.arch === process.arch)
if (!entries.length) throw new Error('No frozen paper environment for this platform/architecture. Run prepare:tex and package:tex on the target platform first.')
for (const entry of entries) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]+$/.test(entry.filename)) throw new Error('Invalid environment filename.')
  const file = path.resolve('vendor/tex/cache', entry.filename)
  if ((await stat(file)).size !== entry.bytes) throw new Error(`Environment size mismatch: ${entry.id}`)
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  if (digest.digest('hex') !== entry.sha256) throw new Error(`Environment checksum mismatch: ${entry.id}`)
  console.log(`Verified ${entry.id}: ${entry.bytes} bytes`)
}
