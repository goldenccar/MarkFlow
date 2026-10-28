export function mathOptions() {
  return { trust: false, maxExpand: 1000, maxSize: 20, macros: {}, strict: (code: string) => code === 'unicodeTextInMathMode' ? 'ignore' as const : 'warn' as const, errorColor: '#bf3434' }
}
