import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve(__dirname),
  server: { port: 5174, open: false },
  resolve: {
    alias: {
      '@': resolve(__dirname, '../src'),
    },
  },
})
