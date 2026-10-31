import type { GitStatus } from '../shared/types'
import type { DocumentTab } from './tabs'
import { isDocDirty, type DocumentContent } from './documentSession'

type ProjectBuffer = DocumentContent & { root?: string; tabId?: string; untitledId?: string; file: { path: string } }

/** Include inactive and not-yet-restored tabs; cached content is authoritative when present. */
export function dirtyProjectPaths(root: string, tabs: DocumentTab[], buffers: ReadonlyMap<string, ProjectBuffer>, current: ProjectBuffer | null): string[] {
  const paths = new Set<string>()
  for (const tab of tabs) {
    if (tab.root !== root || tab.untitledId) continue
    const buffer = buffers.get(tab.id)
    if (buffer ? isDocDirty(buffer) : tab.dirty) paths.add(tab.path)
  }
  for (const buffer of buffers.values()) if (buffer.root === root && !buffer.untitledId && isDocDirty(buffer)) paths.add(buffer.file.path)
  if (current?.root === root && !current.untitledId && isDocDirty(current)) paths.add(current.file.path)
  return [...paths]
}

export function remoteSummary(git: GitStatus | null): string {
  if (!git?.repository) return '未启用 Git'
  const states: Record<GitStatus['remoteState'], string> = {
    unconfigured: '未配置远端', unchecked: '远端状态待检查', current: '最近检查时一致',
    behind: `有 ${git.behind} 个远端版本可更新`, ahead: `有 ${git.ahead} 个本地版本待上传`,
    diverged: '本地和远端都有新版本', 'missing-branch': '远端分支不存在',
    unrelated: '本地和远端没有共同历史', unavailable: '远端检查失败 · 本地可用',
  }
  return states[git.remoteState] ?? '远端尚未检查'
}

export function isExternalShare(value: string): boolean {
  try { const host = new URL(value.trim()).hostname.toLowerCase(); return host === 'jianguoyun.com' || host.endsWith('.jianguoyun.com') || host === 'nutstore.net' || host.endsWith('.nutstore.net') } catch { return false }
}
