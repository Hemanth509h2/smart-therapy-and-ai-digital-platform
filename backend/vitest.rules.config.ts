import { defineConfig } from 'vitest/config'
import path from 'path'

// Separate from vitest.config.ts on purpose: these tests need the Firestore
// emulator running, so they must never be swept into the default `vitest run`.
// Driven by `npm run test:rules`, which starts the emulator around them.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    // Rules evaluation against the emulator is slower than pure unit tests.
    testTimeout: 15000,
    hookTimeout: 30000,
    // The suite shares one emulator and clears Firestore between tests, so it
    // must not run files in parallel.
    fileParallelism: false,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
