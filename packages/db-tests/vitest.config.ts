import { defineConfig } from 'vitest/config'

// DB-Integrationstests laufen gegen EINEN geteilten lokalen Stack — sequenziell, mit großzügigen
// Timeouts (Admin-API über HTTP + echte Transaktionen), damit sich Tests nicht gegenseitig stören.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
})
