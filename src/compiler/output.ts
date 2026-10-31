import { randomUUID } from 'node:crypto'
import { lstat, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CompilationError, diagnostic, failCompilation } from './diagnostics.js'
import type { CompileResult } from './types.js'

/** All validation and generation finish before this one-file replacement. Callers declare protected inputs. */
export async function writeCompilation(result: CompileResult, output: string, protectedInputs: string[] = []): Promise<void> {
  const destination = path.resolve(output)
  if (path.extname(destination).toLowerCase() !== `.${result.manifest.target}`) failCompilation('OUTPUT_EXTENSION', `Output must end in .${result.manifest.target}.`)
  const parent = await realpath(path.dirname(destination)).catch(() => failCompilation('OUTPUT_DIRECTORY', 'Create the output directory before compiling.'))
  const final = path.join(parent, path.basename(destination))
  const existing = await lstat(final).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
  if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink > 1)) failCompilation('OUTPUT_LINK', 'Output must be a regular file, not a link or directory.')
  for (const input of protectedInputs) {
    const resolved = await realpath(input).catch(() => path.resolve(input))
    if (path.relative(resolved, final) === '') failCompilation('OUTPUT_INPUT', 'Output must not replace a source, presentation, font or resource.')
  }
  const temporary = path.join(parent, `.markflow-${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, result.bytes, { flag: 'wx' })
    await rename(temporary, final)
  } catch (error) {
    throw new CompilationError([diagnostic('OUTPUT_WRITE', error instanceof Error ? error.message : String(error), { source: { file: output }, suggestion: 'Close the target in Office and check directory permissions; the previous output is retained if replacement fails.' })])
  } finally { await unlink(temporary).catch(() => undefined) }
}
