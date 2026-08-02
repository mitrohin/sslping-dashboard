import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig(() => {
  const apiTarget = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }).process?.env?.VITE_API_TARGET || 'http://127.0.0.1:8080'

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: {
        '/v1': apiTarget,
        '/health': apiTarget,
        '/openapi.yaml': apiTarget,
      },
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
    },
    build: {
      // Public status HTML is rendered by the API so crawlers and social
      // unfurlers receive live metadata. Stable entry names let that HTML
      // start the same SPA while lazy chunks remain content-hashed.
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          entryFileNames: 'assets/app.js',
          chunkFileNames: 'assets/chunk-[name]-[hash].js',
          assetFileNames: (assetInfo) => assetInfo.name?.endsWith('.css')
            ? 'assets/app.css'
            : 'assets/[name]-[hash][extname]',
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: true,
    },
  }
})
