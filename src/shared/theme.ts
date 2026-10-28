import type { ResolvedTheme, ThemePreference } from './types'

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}
/** Resolve at the display boundary; the saved preference always remains unchanged. */
export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  return preference === 'system' ? systemDark ? 'dark' : 'light' : preference
}
