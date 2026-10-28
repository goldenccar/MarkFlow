import { useCallback, useSyncExternalStore } from 'react'
import { resolveTheme } from '../shared/theme'
import type { ResolvedTheme, ThemePreference } from '../shared/types'

const colorSchemeQuery = '(prefers-color-scheme: dark)'
const systemDark = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(colorSchemeQuery).matches : false
const subscribe = (notify: () => void) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(colorSchemeQuery)
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}

/** Renderers receive light/dark; selecting system never writes a resolved value to settings. */
export function useResolvedTheme(preference: ThemePreference): ResolvedTheme {
  const snapshot = useCallback(() => resolveTheme(preference, systemDark()), [preference])
  const serverSnapshot = useCallback(() => resolveTheme(preference, false), [preference])
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
}
export default useResolvedTheme
