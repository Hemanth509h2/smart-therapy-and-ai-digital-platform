import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Vitest does not read tsconfig's `paths` on its own, so `@/*` (used across
// src/) needs an explicit alias here. Without it, any test touching a module
// that imports `@/lib/...` fails to resolve.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
  },
})
