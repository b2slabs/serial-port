import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves this app from https://b2slabs.github.io/serial-port/,
  // so built asset URLs must be rooted at that subpath rather than `/`.
  base: '/serial-port/',
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
  },
})
