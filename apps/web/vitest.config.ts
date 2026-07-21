import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Unit-Tests für `apps/web` (seit B1-2).
 *
 * BEWUSST NUR FÜR REINE MODULE: Diese App wird ansonsten über Build + Playwright verifiziert; ein
 * Renderer-Setup (jsdom, Testing Library) ist hier NICHT eingerichtet und soll es auch nicht
 * beiläufig werden. Was hier läuft, ist Logik, die ohne React, ohne Request und ohne Datenbank
 * richtig oder falsch ist — konkret die Token-Kryptografie des Lead-Pfads
 * (`lib/leads/token-crypto.ts`). Alles, was einen service_role-Client oder ein Schema braucht,
 * gehört ins DB-Gate (`packages/db-tests`), wo es gegen eine echte Datenbank läuft.
 *
 * Deshalb ist `include` eng gefasst: ein versehentlich hier abgelegter Komponententest soll nicht
 * still mitlaufen und dann an fehlendem jsdom scheitern.
 */
export default defineConfig({
  /*
   * Der `@/`-Alias aus `tsconfig.json` — seit B3-2 nötig, weil der Erfassungsablauf
   * (`lib/leads/capture-flow.ts`) die Schnellrechner-Formel darüber zieht. Bewusst von Hand statt
   * über ein tsconfig-Paths-Plugin: EIN Alias, dieselbe Auflösung wie in `tsconfig.json`, keine
   * zusätzliche Abhängigkeit.
   */
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, '.') },
  },
  test: {
    include: ['lib/**/*.test.ts'],
  },
})
