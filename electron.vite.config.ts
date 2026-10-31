import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { randomBytes } from 'node:crypto'
import { cpSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export default defineConfig(({ command }) => {
  // PDF fonts and CMaps must be local for Chinese papers and offline preview.
  const pdfAssets = new URL('./src/renderer/public/pdfjs/', import.meta.url)
  mkdirSync(pdfAssets, { recursive: true })
  for (const kind of ['cmaps', 'standard_fonts', 'wasm']) cpSync(new URL(`./node_modules/pdfjs-dist/${kind}/`, import.meta.url), new URL(`${kind}/`, pdfAssets), { recursive: true })
  const nonce = randomBytes(18).toString('base64')
  return {
  main: { build: { sourcemap: true, rollupOptions: { input: { index: 'src/main/index.ts', 'compiler-worker': 'src/main/compiler-worker.ts' } } } },
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
