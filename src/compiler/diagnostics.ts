import type { Diagnostic } from './types.js'

export type DiagnosticLocation = Omit<Diagnostic, 'code' | 'severity' | 'message'> & { severity?: Diagnostic['severity'] }

export function diagnostic(code: string, message: string, location: DiagnosticLocation = {}): Diagnostic {
  return { severity: 'error', ...location, code, message }
}

export class CompilationError extends Error {
  readonly diagnostics: Diagnostic[]
  constructor(diagnostics: Diagnostic[]) {
    super(diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'))
    this.name = 'CompilationError'
    this.diagnostics = diagnostics.map(item => ({ ...item, ...(item.source ? { source: { ...item.source } } : {}) }))
  }
}

export function failCompilation(code: string, message: string, location: DiagnosticLocation = {}): never {
  throw new CompilationError([diagnostic(code, message, location)])
}

export function throwIfErrors(diagnostics: Diagnostic[]): void {
  if (diagnostics.some(item => item.severity === 'error')) throw new CompilationError(diagnostics)
}
