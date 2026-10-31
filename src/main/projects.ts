import path from 'node:path'
import fs from 'node:fs/promises'
import type { Settings } from '../shared/types'

export const sameRoot = (a: string, b: string): boolean => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b)
function projectRoot(input: string): string {
  if (typeof input !== 'string' || !path.isAbsolute(input) || input.includes('\0') || input.split(/[\\/]/).some(part => part.toLowerCase() === '.git')) throw new Error('项目路径无效。')
  return path.resolve(input)
}
export function authorizedProject(settings: Settings, input: string): string {
  projectRoot(input)
  const project = settings.projects.find(item => sameRoot(item.root, input))
  if (!project) throw new Error('该文件夹尚未授权为项目，请通过“打开项目”选择文件夹。')
  return project.root
}

export function rememberProject(settings: Settings, root: string, now = new Date().toISOString()): Settings {
  const resolved = projectRoot(root)
  const existing = settings.projects.find(project => sameRoot(project.root, resolved))
  return { ...settings, projects: [{ ...existing, root: resolved, lastOpened: now }, ...settings.projects.filter(project => !sameRoot(project.root, resolved))], lastProject: resolved }
}

/** Only removes the application's registration; recovery data and documents remain untouched. */
export function forgetProject(settings: Settings, root: string): Settings {
  const resolved = projectRoot(root)
  return { ...settings,
    projects: settings.projects.filter(project => !sameRoot(project.root, resolved)),
    recent: settings.recent.filter(entry => !sameRoot(entry.root, resolved)),
    lastProject: settings.lastProject && sameRoot(settings.lastProject, resolved) ? null : settings.lastProject,
  }
}

export function setProjectSyncMode(settings: Settings, root: string, mode: 'local' | 'git' | 'external'): Settings {
  const resolved = authorizedProject(settings, root)
  if (!['local', 'git', 'external'].includes(mode)) throw new Error('项目同步方式无效。')
  return { ...settings, projects: settings.projects.map(project => {
    if (!sameRoot(project.root, resolved)) return project
    const next = { ...project }
    if (mode === 'local') delete next.syncMode
    else next.syncMode = mode
    return next
  }) }
}

export function relocateProjectSettings(settings: Settings, from: string, to: string): Settings {
  const source = authorizedProject(settings, from), target = projectRoot(to)
  if (settings.projects.some(project => !sameRoot(project.root, source) && sameRoot(project.root, target))) throw new Error('目标文件夹已登记为另一个项目，未合并项目记录。')
  const prefix = source.replaceAll('\\', '/').replace(/\/$/, '') + '/'
  const positions: Settings['positions'] = Object.create(null)
  const moved: Array<[string, Settings['positions'][string]]> = []
  for (const [key, position] of Object.entries(settings.positions)) {
    const normalized = key.replaceAll('\\', '/')
    const matches = process.platform === 'win32' ? normalized.toLowerCase().startsWith(prefix.toLowerCase()) : normalized.startsWith(prefix)
    if (matches) moved.push([`${target}/${normalized.slice(prefix.length)}`, position])
    else positions[key] = { ...position }
  }
  for (const [key, position] of moved) {
    const conflict = Object.keys(positions).find(existing => sameRoot(existing, key))
    if (conflict && JSON.stringify(positions[conflict]) !== JSON.stringify(position)) throw new Error('目标位置已有不同阅读位置记录，未覆盖原记录。')
    if (conflict) delete positions[conflict]
    positions[key] = { ...position }
  }
  return { ...settings,
    projects: settings.projects.map(project => sameRoot(project.root, source) ? { ...project, root: target } : project),
    recent: settings.recent.map(entry => sameRoot(entry.root, source) ? { ...entry, root: target } : entry),
    lastProject: settings.lastProject && sameRoot(settings.lastProject, source) ? target : settings.lastProject,
    positions,
  }
}

export function projectDirectoryPath(parent: string, name: string): string {
  const root = projectRoot(parent)
  if (typeof name !== 'string' || !name || name !== name.trim() || name === '.' || name === '..' || /[\\/<>:"|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)
    || /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name) || name.toLowerCase() === '.git') throw new Error('项目名称必须是有效的单个文件夹名称。')
  return path.join(root, name)
}

export async function createProjectDirectory(parent: string, name: string): Promise<string> {
  const target = projectDirectoryPath(parent, name)
  try { await fs.mkdir(target, { recursive: false }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('目标文件夹或文件已存在，未覆盖任何内容。')
    throw error
  }
  return target
}

export function projectForFile(settings: Settings, filename: string, preferred?: string, current?: string): string {
  const absolute = path.resolve(filename)
  const contains = (root: string) => {
    const relative = path.relative(root, absolute)
    return !!relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
  }
  if (preferred) {
    const root = authorizedProject(settings, preferred)
    if (contains(root)) return root
  }
  if (current && settings.projects.some(project => sameRoot(project.root, current)) && contains(current)) return current
  return settings.projects.filter(project => contains(project.root)).sort((a, b) => b.root.length - a.root.length)[0]?.root ?? path.dirname(absolute)
}

export function preserveProjectAuthorization(input: Settings, existing: Settings): Settings {
  return { ...input, recent: existing.recent, projects: existing.projects, lastProject: existing.lastProject }
}
