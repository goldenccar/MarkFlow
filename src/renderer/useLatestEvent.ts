import { useCallback, useRef } from 'react'

/** Keep editor subscriptions stable while their actions use current session state. */
export function useLatestEvent<T extends (...args: any[]) => any>(callback: T): T {
  const latest = useRef(callback)
  latest.current = callback
  return useCallback(((...args: Parameters<T>) => latest.current(...args)) as T, [])
}
