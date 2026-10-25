import { execFile } from 'node:child_process'
import type { FontOption } from '../shared/types'

import { fontCatalog } from '../shared/fonts'

export function fontOptions(installed: string[]): FontOption[] {
  const families = new Set(installed.flatMap(name => name.replace(/\s*\((?:TrueType|OpenType)\)\s*$/i, '').split(/\s+&\s+/)).map(name => name.trim().toLowerCase()))
  return fontCatalog.map(({ aliases, ...option }) => {
    const available = option.id === 'system' || aliases.some(alias => families.has(alias.toLowerCase()))
    return { ...option, available, source: available ? 'system' : 'fallback' }
  })
}

const registryScript = String.raw`
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$fontKeys = @('HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts','HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts')
$fontNames = @(foreach ($fontKey in $fontKeys) {
  if (Test-Path -LiteralPath $fontKey) {
    $fontDirectory = if ($fontKey.StartsWith('HKCU:')) { Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts' } else { Join-Path $env:WINDIR 'Fonts' }
    foreach ($entry in (Get-ItemProperty -LiteralPath $fontKey).PSObject.Properties) {
      if ($entry.Name.StartsWith('PS') -or $entry.Value -isnot [string]) { continue }
      $fontFile = if ([IO.Path]::IsPathRooted($entry.Value)) { $entry.Value } else { Join-Path $fontDirectory $entry.Value }
      if (Test-Path -LiteralPath $fontFile -PathType Leaf) { $entry.Name }
    }
  }
})
ConvertTo-Json -InputObject $fontNames -Compress
`
let pending: Promise<FontOption[]> | undefined
export function getFonts(): Promise<FontOption[]> {
  if (!pending) pending = process.platform !== 'win32' ? Promise.resolve(fontOptions([])) : new Promise(resolve => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(registryScript, 'utf16le').toString('base64')],
      { windowsHide: true, encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
        try { const value = JSON.parse(stdout.replace(/^\uFEFF/, '')); resolve(fontOptions(!error && Array.isArray(value) ? value.filter(item => typeof item === 'string') : [])) }
        catch { resolve(fontOptions([])) }
      })
  })
  return pending
}
