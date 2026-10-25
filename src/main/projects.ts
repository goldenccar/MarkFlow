import path from 'node:path'
import type { Settings } from '../shared/types'

export const sameRoot = (a: string, b: string): boolean => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b)
export function authorizedProject(settings: Settings, input: string): string {
  if (typeof input !== 'string' || !path.isAbsolute(input) || input.includes('\0')) throw new Error('项目路径无效。')
  const project = settings.projects.find(item => sameRoot(item.root, input))
  if (!project) throw new Error('该文件夹尚未授权为项目，请通过“打开项目”选择文件夹。')
  return project.root
}

export function rememberProject(settings: Settings, root: string, now = new Date().toISOString()): Settings {
  const resolved = path.resolve(root)
  return { ...settings, projects: [{ root: resolved, lastOpened: now }, ...settings.projects.filter(project => !sameRoot(project.root, resolved))], lastProject: resolved }
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
