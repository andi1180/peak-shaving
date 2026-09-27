import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Report-Snapshots der Referenzfälle (Wizard-Pfad → PDF-Text + Bildschirm-Markup).
 * Eigene Konfiguration und NICHT Teil von `pnpm test`: die PDF-Textextraktion braucht `pdftotext`
 * (poppler), und CI hat es nicht. Aufruf: `pnpm --filter website report:snapshots`
 * (`REPORT_SNAPSHOT_UPDATE=1` schreibt die Dateien neu — nur bei einer gewollten Report-Änderung).
 */
const ROOT = path.resolve(import.meta.dirname, '../..')

export default defineConfig({
  root: ROOT,
  resolve: { alias: { '@': ROOT } },
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['test/report-snapshots/report-snapshots.test.tsx'],
    testTimeout: 600_000,
  },
})
