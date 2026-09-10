import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { localePlugin } from './build/localePlugin'
import { publicStatusAliases } from './build/publicStatusAliases'

export default defineConfig(() => {
  const apiTarget = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }).process?.env?.VITE_API_TARGET || 'http://127.0.0.1:8080'

  return {
    plugins: [localePlugin(), react(), publicStatusAliases()],
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
      // Dashboard HTML and the complete module graph use hashed entries.
      // Public status HTML keeps stable aliases emitted after HTML generation.
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          entryFileNames: 'assets/app-[hash].js',
          chunkFileNames: 'assets/chunk-[name]-[hash].js',
          assetFileNames: (assetInfo) => assetInfo.name === 'index.css'
            ? 'assets/app-[hash].css'
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
