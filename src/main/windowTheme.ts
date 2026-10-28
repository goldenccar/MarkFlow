import { resolveTheme } from '../shared/theme'
import type { WindowAppearance } from '../shared/types'

/** The native background/caption uses the same resolved palette as the document shell. */
export function windowPalette(appearance: WindowAppearance, systemDark: boolean) {
  const theme = resolveTheme(appearance.theme, systemDark)
  return appearance.mode === 'latex-math'
    ? theme === 'dark' ? { background: '#171f2a', caption: '#141d29', text: '#dfebf5' } : { background: '#f2f5f8', caption: '#e4ebf2', text: '#263447' }
    : theme === 'dark' ? { background: '#222423', caption: '#1b1e1c', text: '#e8ebe8' } : { background: '#f5f6f3', caption: '#ecefea', text: '#242825' }
}
