import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export default defineConfig(({ command }) => {
  const nonce = randomBytes(18).toString('base64')
  return {
  main: { build: { sourcemap: true, rollupOptions: { input: 'src/main/index.ts' } } },
  preload: { build: { sourcemap: true, rollupOptions: { input: 'src/preload/index.ts', output: { format: 'cjs', entryFileNames: 'index.cjs' } } } },
  renderer: {
    root: 'src/renderer', html: command === 'serve' ? { cspNonce: nonce } : undefined,
    // The browser export uses document.createElement; Markdown also parses in a Worker.
    resolve: { alias: { 'decode-named-character-reference': fileURLToPath(new URL('./node_modules/decode-named-character-reference/index.js', import.meta.url)) } },
    optimizeDeps: { include: ['@tiptap/pm/model', '@tiptap/pm/transform'] },
    plugins: [react(), { name: 'dev-csp-nonce', apply: 'serve', transformIndexHtml: { order: 'pre', handler: (html) => html.replace("script-src 'self';", `script-src 'self' 'nonce-${nonce}';`) } }],
    build: { rollupOptions: { input: fileURLToPath(new URL('./src/renderer/index.html', import.meta.url)) } },
  },
  }
})
