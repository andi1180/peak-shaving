#!/usr/bin/env node
// Generiert zwei synthetische Lastgänge im deutschen Messstellenbetreiber-Format mit `sep=,`-Vorzeile
// (KEINE Kundendaten — Format nachgebildet, Werte erfunden):
//   Zeile 1 `sep=,` · Zeile 2 `DatumUhrzeit,kW` · ab Zeile 3 `2025-09-01 00:00,"9,700"`
// Werte = kW-Mittelwerte je Viertelstunde, Zeitstempel = Intervallbeginn in Ortszeit (Europe/Berlin).
//   Herbst:  25.–27.10.2025, Winterzeit-Doppelstunde (26.10. 02:00–02:45) nur EINMAL enthalten → 288 Zeilen
//   Frühling: 28.–30.03.2026, 29.03. 02:00–02:45 fehlen → 284 Zeilen
// Je Datei genau eine Spitze von 42,5 kW (08:30 am zweiten Tag).
//
// Ausführen: node dev-fixtures/generate-de-lastgang-sep-fixtures.mjs

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))
const pad = (n) => String(n).padStart(2, '0')

function valueCell(i) {
  if (i % 29 === 10) return '0' // unquotierte Null
  if (i % 17 === 7) return '"10,375"'
  if (i % 13 === 5) return '"9,248"'
  if (i % 11 === 3) return '"9,80"'
  return '"10,0"'
}

function build(days, skip, peakDay) {
  const lines = ['sep=,', 'DatumUhrzeit,kW']
  let i = 0
  for (const [y, m, d] of days) {
    for (let h = 0; h < 24; h++) {
      for (let q = 0; q < 4; q++) {
        const stamp = `${y}-${pad(m)}-${pad(d)} ${pad(h)}:${pad(q * 15)}`
        if (skip.has(stamp)) continue
        const isPeak = y === peakDay[0] && m === peakDay[1] && d === peakDay[2] && h === 8 && q === 2
        lines.push(`${stamp},${isPeak ? '"42,5"' : valueCell(i)}`)
        i++
      }
    }
  }
  return lines.join('\n') + '\n'
}

const herbstDays = [[2025, 10, 25], [2025, 10, 26], [2025, 10, 27]]
writeFileSync(join(DIR, 'de-lastgang-sep-herbst.csv'), build(herbstDays, new Set(), [2025, 10, 26]))

const fruehlingDays = [[2026, 3, 28], [2026, 3, 29], [2026, 3, 30]]
const skipSpring = new Set(['00', '15', '30', '45'].map((mm) => `2026-03-29 02:${mm}`))
writeFileSync(
  join(DIR, 'de-lastgang-sep-fruehling.csv'),
  build(fruehlingDays, skipSpring, [2026, 3, 29]),
)
