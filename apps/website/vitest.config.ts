import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Unit-Tests für `apps/website` (seit D12).
 *
 * BEWUSST NUR FÜR REINE MODULE — dieselbe Regel und dieselbe Begründung wie in `apps/web`: Ein
 * Renderer-Setup (jsdom, Testing Library) ist hier NICHT eingerichtet und soll es auch nicht
 * beiläufig werden. Was hier läuft, ist Logik, die ohne React, ohne Request und ohne Datenbank
 * richtig oder falsch ist — konkret die Ableitungsschicht des PDF-Reports
 * (`lib/pdf-report/{basis,derive,summary,…}.ts`), die genau dafür frei von `@react-pdf/renderer`
 * gehalten wird (s. Kopf von `basis.ts`).
 *
 * `include` ist deshalb eng gefasst: ein versehentlich hier abgelegter Komponententest soll nicht
 * still mitlaufen und dann an fehlendem jsdom scheitern.
 */
export default defineConfig({
  // Der `@/`-Alias aus `tsconfig.json` — `basis.ts` zieht darüber `@/lib/format`.
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, '.') },
  },
  test: {
    include: ['lib/pdf-report/*.test.ts'],
  },
})
