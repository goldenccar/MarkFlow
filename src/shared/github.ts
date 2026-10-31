export type GithubRemote = { url: string; key: string; name: string }

/** A repository root only: browser subpages and credentials are never Git remotes. */
export function normalizeGithubRemote(input: string): GithubRemote {
  const invalid = '请输入 GitHub 仓库根地址（HTTPS 或 SSH），不要使用文件、分支或分享页面链接。'
  if (typeof input !== 'string' || !input || /[\s\u0000-\u001f\u007f%?#\\]/.test(input)) throw new Error(invalid)
  if (/^https:\/\/[^/]*@/i.test(input)) throw new Error('GitHub 地址中不能包含账号、密码或令牌。')
  const match = /^(https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/?$/i.exec(input)
  if (!match) throw new Error(invalid)
  const owner = match[2]
  const name = match[3].replace(/\.git$/i, '')
  if (owner.startsWith('-') || owner.endsWith('-') || !name || /^\.+$/.test(name)) throw new Error(invalid)
  const prefix = match[1].toLowerCase()
  return { url: `${prefix}${owner}/${name}.git`, key: `github.com/${owner}/${name}`.toLowerCase(), name }
}
