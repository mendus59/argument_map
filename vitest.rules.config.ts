import { defineConfig } from 'vitest/config'

// Security rules tests need the Firestore emulator; run them with `npm run test:rules`.
export default defineConfig({
  test: { include: ['tests/rules.test.ts'], testTimeout: 20000, hookTimeout: 30000, fileParallelism: false },
})
