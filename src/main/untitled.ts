import fs from 'node:fs/promises'
import path from 'node:path'
import type { UntitledDraft } from '../shared/types'
import { atomicWrite } from './files'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function validateUntitled(input: unknown): UntitledDraft {
  const draft = input as UntitledDraft
  if (!draft || typeof draft !== 'object' || Array.isArray(draft) || typeof draft.id !== 'string' || !uuid.test(draft.id) || typeof draft.content !== 'string' || draft.content.includes('\0')
    || !['markdown', 'latex-math'].includes(draft.mode) || typeof draft.updatedAt !== 'string' || !Number.isFinite(Date.parse(draft.updatedAt))) throw new Error('独立草稿格式无效。')
  return { id: draft.id.toLowerCase(), content: draft.content, mode: draft.mode, updatedAt: draft.updatedAt }
}

export class UntitledService {
  private readonly directory: string
  constructor(userData: string) { this.directory = path.join(userData, 'untitled') }

  private filename(id: string): string {
    if (typeof id !== 'string' || !uuid.test(id)) throw new Error('独立草稿标识无效。')
    return path.join(this.directory, `${id.toLowerCase()}.json`)
  }

  async list(): Promise<UntitledDraft[]> {
    let names: string[]
    try { names = await fs.readdir(this.directory) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    const drafts: UntitledDraft[] = []
    for (const name of names.filter(value => value.endsWith('.json'))) {
      try {
        const draft = validateUntitled(JSON.parse(await fs.readFile(path.join(this.directory, name), 'utf8')))
        if (path.basename(this.filename(draft.id)) !== name.toLowerCase()) throw new Error('ID mismatch')
        drafts.push(draft)
      } catch { throw new Error(`独立草稿无法读取，原文件仍已保留：${path.join(this.directory, name)}`) }
    }
    return drafts.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }

  async put(input: UntitledDraft): Promise<void> {
    const draft = validateUntitled(input)
    await fs.mkdir(this.directory, { recursive: true })
    await atomicWrite(this.filename(draft.id), JSON.stringify(draft))
  }

  async delete(id: string): Promise<void> { await fs.rm(this.filename(id), { force: true }) }
}
