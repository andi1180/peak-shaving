import { defineConfig } from 'vitest/config'

// Der Rechenkern läuft in mehreren Tests über volle 12-Monats-Lastgänge (35.040 Viertelstunden) —
// inkl. Parser gegen die echten dev-fixtures-CSVs und der vollen Kette (§3.6→§3.9). Unter paralleler
// Last überschreiten diese Läufe das Vitest-Default von 5 s; 30 s gibt ihnen ehrlich Raum, ohne
// echte Hänger zu verstecken.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
