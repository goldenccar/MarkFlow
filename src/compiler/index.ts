import JSZip from 'jszip'
import { CompilationError, diagnostic, throwIfErrors } from './diagnostics.js'
import { prepareCompilation } from './layout.js'
import { writeDocx } from './docx.js'
import { writePptx } from './pptx.js'
import type { CompileOptions, CompileResult, Diagnostic } from './types.js'

export * from './types.js'
export * from './diagnostics.js'
export { normalizeDocument, semanticEngineOptions, applySemanticCommands } from './model.js'
export { markdownToDocument } from './markdown.js'
export { prepareCompilation } from './layout.js'
export { writeCompilation } from './output.js'

/** The SDK takes data and explicit local resources, never an app session or API credential. */
export async function compile(input: unknown, presentation: unknown, options: CompileOptions, sourceDiagnostics: Diagnostic[] = []): Promise<CompileResult> {
  throwIfErrors(sourceDiagnostics)
  try {
    const plan = await prepareCompilation(input, presentation, options, sourceDiagnostics)
    const bytes = plan.target === 'docx' ? await writeDocx(plan) : await writePptx(plan)
    // Keep provenance inside the same atomic artifact. A second sidecar cannot be atomically replaced with it.
    const zip = await JSZip.loadAsync(bytes)
    zip.file('markflow/manifest.json', JSON.stringify(plan.manifest, null, 2), { date: new Date('2000-01-01T00:00:00Z') })
    return { bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), manifest: plan.manifest }
  } catch (error) {
    if (error instanceof CompilationError) throw error
    throw new CompilationError([diagnostic('COMPILATION_FAILED', error instanceof Error ? error.message : String(error))])
  }
}
