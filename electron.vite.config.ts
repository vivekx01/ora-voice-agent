import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const shared = resolve('src/shared')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } }
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts') } } }
  },
  renderer: {
    root: resolve('src/renderer'),
    base: './',
    resolve: { alias: { '@shared': shared, '@': resolve('src/renderer/src') } },
    plugins: [react()],
    worker: { format: 'es' },
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } }
  }
})
