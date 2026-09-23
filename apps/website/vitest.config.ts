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
 * still mitlaufen und dann an fehlendem jsdom scheitern. Es zählt `lib/` selbst mit (dort liegt
 * mit `chart-ticks.ts` reine Achsen-Arithmetik, die von Komponenten benutzt wird, aber keine
 * kennt) — `components/` bleibt ausgenommen, denn dort wäre ein Test ohne DOM gar nicht denkbar.
 *
 * ── ⚠ ZWEI AUSNAHMEN, UND SIE BRAUCHEN KEIN DOM ──────────────────────────────────────────────
 * `optional-sections.test.ts` (Katalog-Fall) und `existing-case.test.ts` (Bestandsfall) erzeugen
 * ein echtes PDF (`renderToBuffer` aus `@react-pdf/renderer`). Das ist kein
 * Renderer-Setup im obigen Sinn — react-pdf schreibt in einen Buffer und fasst weder `document`
 * noch `window` an; jsdom und Testing Library bleiben weiterhin uneingerichtet. Gemessen wird
 * dort, was ein Test gegen die Ableitungsschicht nicht sehen kann: ob sich das BLATT ändert.
 *
 * `esbuild.jsx` steht dafür auf `automatic`: `tsconfig.json` hält `jsx: "preserve"` (Next
 * übersetzt selbst), esbuild fiele sonst auf die klassische Form zurück und `document.tsx` bräche
 * zur Laufzeit mit „React is not defined".
 */
export default defineConfig({
  // Der `@/`-Alias aus `tsconfig.json` — `basis.ts` zieht darüber `@/lib/format`.
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, '.') },
  },
  esbuild: { jsx: 'automatic' },
  test: {
    /*
     * K3b nimmt `lib/battery-catalog/*` dazu — aus demselben Grund wie die beiden bestehenden
     * Muster und ohne die Regel aufzuweichen: `batteryCategoryFor` ist eine reine Funktion ohne
     * React, ohne Request und ohne Datenbank. Der Datenbank-Rand daneben (`source.ts`) hat
     * bewusst keinen Test — er ist ein Adapter um den `shared`-Loader, und der IST geprüft.
     */
    include: ['lib/*.test.ts', 'lib/pdf-report/*.test.ts', 'lib/battery-catalog/*.test.ts'],
  },
})
