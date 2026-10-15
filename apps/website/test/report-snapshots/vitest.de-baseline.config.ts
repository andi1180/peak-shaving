import path from 'node:path'
import { defineConfig } from 'vitest/config'

/** Nur der Generator der DE-Render-Anfragen (`fixtures/de-gewerbe-benutzungsdauer/generate.test.ts`). */
const ROOT = path.resolve(import.meta.dirname, '../..')

export default defineConfig({
  root: ROOT,
  resolve: { alias: { '@': ROOT } },
  test: {
    include: ['test/report-snapshots/fixtures/de-gewerbe-benutzungsdauer/generate.test.ts'],
    testTimeout: 600_000,
  },
})
