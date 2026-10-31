import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, readdir, realpath, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
export type TeXEngine = 'pdflatex' | 'xelatex' | 'lualatex'
export interface PaperRuntime {
  available: boolean
  root: string
  binDir: string
  latexmk: string
  engines: Partial<Record<TeXEngine, string>>
  bibtex?: string
  biber?: string
  biberCacheKey?: string
  synctex?: string
  version?: string
  message?: string
}
const exists = async (file: string) => access(file).then(() => true, () => false)

/** Only inspect explicitly managed locations; never execute an arbitrary system PATH match. */
export async function inspectPaperRuntime(options: { root?: string; resourcesPath?: string } = {}): Promise<PaperRuntime> {
  const roots = options.root ? [path.resolve(options.root)] : [
    ...(options.resourcesPath ? [path.join(options.resourcesPath, 'tex', 'TinyTeX'), path.join(options.resourcesPath, 'tex')] : []),
    path.resolve('vendor/tex/TinyTeX'),
  ]
  for (const candidate of roots) {
    const root = await realpath(candidate).catch(() => null)
    if (!root) continue
    const platforms = process.platform === 'win32' ? ['windows'] : await readdir(path.join(root, 'bin')).catch(() => [])
    for (const platform of platforms) {
      const binDir = path.join(root, 'bin', platform)
      const executable = (name: string) => path.join(binDir, name + (process.platform === 'win32' ? '.exe' : ''))
      const latexmk = executable('latexmk')
      if (!await exists(latexmk)) continue
      const engines: PaperRuntime['engines'] = {}
      for (const engine of ['pdflatex', 'xelatex', 'lualatex'] as const) if (await exists(executable(engine))) engines[engine] = executable(engine)
      if (!engines.xelatex || !engines.pdflatex) continue
      const runtime: PaperRuntime = { available: true, root, binDir, latexmk, engines }
      for (const name of ['bibtex', 'biber', 'synctex'] as const) if (await exists(executable(name))) runtime[name] = executable(name)
      if (runtime.biber) {
        const info = await stat(runtime.biber)
        runtime.biberCacheKey = createHash('sha256').update(`${runtime.biber}:${info.size}:${info.mtimeMs}`).digest('hex').slice(0, 16)
      }
      try {
        const { stdout } = await execFileAsync(engines.xelatex, ['--version'], { windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024 })
        runtime.version = stdout.split(/\r?\n/)[0].trim()
      } catch { runtime.available = false; runtime.message = '论文编译环境无法启动，请重新准备环境。' }
      return runtime
    }
  }
  return { available: false, root: roots[0], binDir: '', latexmk: '', engines: {}, message: '尚未安装论文编译环境。请在论文工作区安装随应用提供的环境，或导入离线环境包。' }
}

/** Defense in depth for a trusted project. This is NOT an operating-system sandbox. */
export function controlledTeXEnvironment(runtime: PaperRuntime, buildDirectory: string): NodeJS.ProcessEnv {
  const build = path.resolve(buildDirectory)
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
  const temporary = path.join(build, '.runtime')
  const env: NodeJS.ProcessEnv = {
    PATH: [runtime.binDir, path.join(runtime.root, 'tlpkg', 'tlperl', 'bin'), ...(process.platform === 'win32' ? [path.join(systemRoot, 'System32')] : ['/usr/bin', '/bin'])].join(path.delimiter),
    HOME: temporary, USERPROFILE: temporary, APPDATA: temporary, LOCALAPPDATA: temporary,
    TMP: temporary, TEMP: temporary, TMPDIR: temporary,
    TEXMFHOME: path.join(temporary, 'texmf'), TEXMFVAR: path.join(temporary, 'texmf-var'), TEXMFCONFIG: path.join(temporary, 'texmf-config'),
    TEXMFCACHE: path.join(temporary, 'texmf-cache'), TEXMFCNF: path.join(runtime.root, 'texmf-dist', 'web2c'),
    TEXMFOUTPUT: build, TEXMF_OUTPUT_DIRECTORY: build,
    shell_escape: 'f', shell_escape_commands: '', openout_any: 'p',
    // TeX Live 2026 no longer enforces openin_any. Trust must be handled before launching.
    openin_any: 'p',
    max_print_line: '1000', error_line: '254', half_error_line: '238',
  }
  if (process.platform === 'win32') {
    env.SystemRoot = systemRoot
    env.WINDIR = systemRoot
    env.COMSPEC = path.join(systemRoot, 'System32', 'cmd.exe')
    env.PATHEXT = '.COM;.EXE;.BAT;.CMD'
    env.OSFONTDIR = path.join(systemRoot, 'Fonts')
    // PAR expands deeply nested libraries. A snapshot path can exceed Windows MAX_PATH.
    if (runtime.biberCacheKey) env.PAR_GLOBAL_TEMP = path.join(os.tmpdir(), `mf-biber-${runtime.biberCacheKey}`)
  } else {
    env.LANG = 'en_US.UTF-8'
    env.LC_ALL = 'en_US.UTF-8'
  }
  return env
}
