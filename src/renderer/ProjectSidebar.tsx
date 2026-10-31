import type { DragEvent, ReactNode } from 'react'
import type { FileEntry, Library, ProjectRecord } from '../shared/types'
import { Icon } from './Icons'
import { WorkspaceSidebar } from './WorkspaceFrame'

export interface ProjectSidebarProps {
  projects: ProjectRecord[]
  library: Library | null
  treeMode: 'files' | 'folders'
  onTreeModeChange(mode: 'files' | 'folders'): void
  entries: FileEntry[]
  archivedEntries: FileEntry[]
  allFiles: FileEntry[]
  selected: string
  folder: string
  expanded: ReadonlySet<string>
  dropTarget: string | null
  showArchive: boolean
  onShowArchiveChange(show: boolean): void
  busy: boolean
  initializing?: boolean
  readOnly?: boolean
  settingsOpen: boolean
  gitOpen: boolean
  onSettings(): void
  onGit(): void
  onAddProject(): void
  onOpenProject(root: string): void
  onProjectMenu(element: HTMLElement, root: string, x?: number, y?: number): void
  onOpenFile(path: string): void
  onFolderClick(path: string): void
  onNewFolder(): void
  onNewFile?(): void
  onContextMenu(element: HTMLElement, node: FileEntry, x: number, y: number): void
  onDragOver(event: DragEvent<HTMLElement>, path: string): void
  onDrop(event: DragEvent<HTMLElement>, path: string): void
  onDragEnd(): void
  onDragStart?(): void
  engineOutline?: ReactNode
}

const basename = (value: string) => value.replaceAll('\\', '/').split('/').at(-1) ?? value
const dirname = (value: string) => value.includes('/') ? value.slice(0, value.lastIndexOf('/')) : ''

/** One project navigation view. The app owns project state, persistence and every file operation. */
export default function ProjectSidebar(props: ProjectSidebarProps) {
  const { projects, library, treeMode, entries, archivedEntries, allFiles, selected, folder, expanded, dropTarget, showArchive, busy, initializing, readOnly, settingsOpen, gitOpen, engineOutline } = props
  const canMutate = !busy && !readOnly
  const folderFiles = treeMode === 'folders' ? allFiles.filter(file => !file.directory && dirname(file.path) === folder) : []
  function fileTree(nodes: FileEntry[], depth = 0, includeFiles = false): ReactNode {
    return nodes.filter(node => includeFiles || treeMode === 'files' || node.directory).map(node => <div className="tree-node" key={node.path}>
      <div className="tree-node-row"><button disabled={busy} className={`tree-item ${selected === node.path ? 'selected ' : ''}${dropTarget === node.path ? 'drop-target' : ''}`} style={{ paddingLeft: 12 + depth * 16 }}
        draggable={canMutate} onDragStart={event => {
          event.stopPropagation()
          if (!library || !canMutate) { event.preventDefault(); return }
          event.dataTransfer.setData('application/x-oopsmd-path', JSON.stringify({ root: library.root, path: node.path }))
          event.dataTransfer.effectAllowed = 'move'; props.onDragStart?.()
        }} onDragEnd={props.onDragEnd}
        onDragOver={event => { if (node.directory && canMutate) props.onDragOver(event, node.path) }} onDragLeave={props.onDragEnd}
        onDrop={event => { if (node.directory && canMutate) props.onDrop(event, node.path) }}
        onContextMenu={event => { event.preventDefault(); event.stopPropagation(); props.onContextMenu(event.currentTarget, node, event.clientX || event.currentTarget.getBoundingClientRect().left, event.clientY || event.currentTarget.getBoundingClientRect().bottom) }}
        title={node.path} aria-label={node.name}
        onKeyDown={event => {
          if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
            event.preventDefault(); event.stopPropagation()
            const bounds = event.currentTarget.getBoundingClientRect()
            props.onContextMenu(event.currentTarget, node, bounds.left + 24, bounds.bottom)
          }
        }}
        onClick={() => node.directory ? props.onFolderClick(node.path) : props.onOpenFile(node.path)}>
        <Icon name={node.directory ? expanded.has(node.path) ? 'chevronDown' : 'chevronRight' : /\.tex$/i.test(node.name) ? 'math' : 'file'} />
        {node.directory && <Icon name={expanded.has(node.path) ? 'folderOpen' : 'folder'} />}<span>{node.name}</span>
      </button></div>
      {node.directory && expanded.has(node.path) && fileTree(node.children ?? [], depth + 1, includeFiles)}
    </div>)
  }
  return <WorkspaceSidebar aria-label="项目导航">
    <div className="sidebar-heading"><span>项目</span><button className="icon-button" title="添加项目" aria-label="添加项目" disabled={initializing || busy} onClick={props.onAddProject}><Icon name="plus" /></button></div>
    <div className="project-list">{projects.map(project => {
      const name = basename(project.root), active = library?.root === project.root
      return <div className="project-row" key={project.root}
        onContextMenu={event => { event.preventDefault(); props.onProjectMenu(event.currentTarget, project.root, event.clientX || undefined, event.clientY || undefined) }}
        onKeyDown={event => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); event.stopPropagation(); props.onProjectMenu(event.currentTarget, project.root) } }}>
        <button className={`project-item ${active ? 'active' : ''}`} title={project.root} aria-label={`打开项目 ${name}`} disabled={busy} onClick={() => props.onOpenProject(project.root)}>
          <Icon name={active ? 'folderOpen' : 'folder'} /><span className="project-name">{name}</span>{project.syncMode === 'external' ? <span className="project-sync-label">云盘</span> : active && <span className="project-current" />}
        </button>
        <button className="icon-button project-options" aria-label={`项目选项 ${name}`} aria-haspopup="menu" disabled={busy} onClick={event => props.onProjectMenu(event.currentTarget, project.root)}><Icon name="more" /></button>
      </div>
    })}{!projects.length && <button className="project-item muted" disabled={initializing || busy} onClick={props.onAddProject}><Icon name="folderPlus" /><span>添加项目…</span></button>}</div>
    {library ? <div className="project-files">
      <div className="sidebar-heading"><span>项目文件</span><div className="row">
        {props.onNewFile && <button className="icon-button" title="新建文件" aria-label="新建文件" disabled={!canMutate} onClick={props.onNewFile}><Icon name="filePlus" /></button>}
        <button className="icon-button" title="新建文件夹" aria-label="新建文件夹" disabled={!canMutate} onClick={props.onNewFolder}><Icon name="folderPlus" /></button>
      </div></div>
      <div className="segmented tree-switch" aria-label="目录显示方式"><button aria-pressed={treeMode === 'files'} className={treeMode === 'files' ? 'active' : ''} onClick={() => props.onTreeModeChange('files')}>文件树</button><button aria-pressed={treeMode === 'folders'} className={treeMode === 'folders' ? 'active' : ''} onClick={() => props.onTreeModeChange('folders')}>文件夹树</button></div>
      <button aria-label="项目根目录" title={library.root} disabled={busy}
        onDragOver={event => { if (canMutate) props.onDragOver(event, '') }} onDragLeave={props.onDragEnd} onDrop={event => { if (canMutate) props.onDrop(event, '') }}
        className={`tree-item root-folder ${selected === '' ? 'selected' : ''} ${dropTarget === '' ? 'drop-target' : ''}`} onClick={() => props.onFolderClick('')}><Icon name="folderOpen" /><span>根目录</span></button>
      <div className={`tree-scroll ${treeMode === 'folders' ? 'folder-hierarchy' : ''}`}>{fileTree(entries)}{!entries.length && <p className="muted inset">此目录还没有文件</p>}</div>
      {treeMode === 'folders' && <div className="folder-list"><div className="section-label">{folder || '根目录'} · {folderFiles.length} 个文件</div>{fileTree(folderFiles, 0, true)}</div>}
      <div className="archive-section"><button className="archive-toggle" aria-expanded={showArchive} onClick={() => props.onShowArchiveChange(!showArchive)}><Icon name="archive" /><span>归档</span><Icon name={showArchive ? 'chevronDown' : 'chevronRight'} /></button>{showArchive && <div className="archive-tree" aria-label="归档树">{fileTree(archivedEntries, 0, true)}{!archivedEntries.length && <p className="muted inset">归档的资料会保留在这里</p>}</div>}</div>
    </div> : <div className="project-files empty-project-hint"><p>保存文档时选择项目文件夹。</p></div>}
    {engineOutline}
    <div className="sidebar-footer"><button aria-pressed={settingsOpen} onClick={props.onSettings}><Icon name="settings" />设置</button><button disabled={!library || busy} aria-pressed={gitOpen} onClick={props.onGit}><Icon name="gitBranch" />Git 与同步</button></div>
  </WorkspaceSidebar>
}
