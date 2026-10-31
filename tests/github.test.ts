import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeGithubRemote } from '../src/shared/github'

test('GitHub repository roots normalize clone URLs while preserving the transport', () => {
  const cases = [
    ['https://github.com/Owner/Repo', 'https://github.com/Owner/Repo.git'],
    ['https://github.com/Owner/Repo.git/', 'https://github.com/Owner/Repo.git'],
    ['HTTPS://GITHUB.COM/Owner/Repo/', 'https://github.com/Owner/Repo.git'],
    ['git@github.com:Owner/Repo', 'git@github.com:Owner/Repo.git'],
    ['git@github.com:Owner/Repo.git/', 'git@github.com:Owner/Repo.git'],
    ['ssh://git@github.com/Owner/Repo', 'ssh://git@github.com/Owner/Repo.git'],
    ['ssh://git@github.com/Owner/Repo.git/', 'ssh://git@github.com/Owner/Repo.git'],
  ]
  for (const [input, url] of cases) {
    assert.deepEqual(normalizeGithubRemote(input), { url, key: 'github.com/owner/repo', name: 'Repo' }, input)
  }
  assert.equal(normalizeGithubRemote('https://github.com/open-ai/my_repo.v2-1').name, 'my_repo.v2-1')
  assert.equal(normalizeGithubRemote('https://github.com/Owner/.github').name, '.github')
})

test('protocol, case and optional .git suffix identify the same repository', () => {
  const keys = [
    'https://github.com/Owner/Repo',
    'git@github.com:owner/repo.git',
    'ssh://git@github.com/OWNER/REPO.git/',
  ].map(input => normalizeGithubRemote(input).key)
  assert.equal(new Set(keys).size, 1)
})

test('GitHub addresses reject credentials and non-repository destinations', () => {
  for (const input of ['https://token@github.com/owner/repo.git', 'https://user:secret@github.com/owner/repo']) {
    assert.throws(() => normalizeGithubRemote(input), /GitHub.*令牌/, input)
  }
  const invalid = [
    '', ' https://github.com/owner/repo', 'https://github.com/owner/repo\n',
    'https://github.com/owner/re po', 'https://github.com/owner/repo\u0000',
    'http://github.com/owner/repo', 'https://github.com.evil.test/owner/repo',
    'https://evil.test/github.com/owner/repo', 'https://github.com:443/owner/repo',
    'ssh://user@github.com/owner/repo', 'ssh://git:secret@github.com/owner/repo',
    'ssh://git@github.com:22/owner/repo', 'git@github.com:/owner/repo',
    'https://github.com/owner/repo/tree/main', 'https://github.com/owner/repo/blob/main/a.md',
    'https://github.com/owner/repo/issues', 'https://github.com/owner/repo?token=secret',
    'https://github.com/owner/repo#readme', 'https://github.com/owner/repo%2fextra',
    'https://github.com/owner/repo\\extra', 'https://github.com/owner//repo',
    'https://github.com/owner/', 'https://github.com/owner/.', 'https://github.com/owner/..',
    'https://github.com/owner/.git', 'https://github.com/../repo',
    'https://github.com/-owner/repo', 'https://github.com/owner-/repo',
    'file:///C:/repo', 'C:\\repo', '/tmp/repo', 'ext::arbitrary-command',
    '--upload-pack=command', 'git@github.com:owner/repo;command',
  ]
  for (const input of invalid) assert.throws(() => normalizeGithubRemote(input), /GitHub/, input)
})
