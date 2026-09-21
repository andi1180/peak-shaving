#!/usr/bin/env node
// Verschiebt den eingefrorenen Bäckerei-Lastgang `demo-baeckerei-lastgang-2023.csv` WOCHENTAG-
// ERHALTEND nach 2025 und schreibt `demo-baeckerei-lastgang-verschoben-2025.csv`.
//
// ── WARUM VERSCHIEBEN UND NICHT NEU ERZEUGEN ───────────────────────────────────────────────────
// `generate-demo-load-profile.mjs --year 2025` gibt es bereits, erzeugt aber eine ANDERE Wertereihe:
// der Generator bildet jeden Tag aus SEINEM Wochentag, und der Wochentag zu einem Slot-Index
// unterscheidet sich zwischen den Jahrgängen (README, „Warum die Summen nicht identisch sind").
// Für eine Messung, deren Bezugszahlen am 2023er-Jahrgang erhoben wurden, muss die Wertereihe
// BIT-GENAU dieselbe bleiben — verschoben wird deshalb der Zeitstempel, nicht das Profil.
//
// ── DIE VERSCHIEBUNG IST EIN VIELFACHES VON 7 TAGEN, UND DAS IST DER GANZE PUNKT ───────────────
// 01.01.2023 ist ein SONNTAG, 01.01.2025 ein MITTWOCH. Eine blosse Umbenennung der Jahreszahl
// verschöbe das Wochenmuster um drei Tage — aus dem geschlossenen Sonntag (~3,35 kW Mittel) würde
// ein Mittwoch mit voller Ofenlast. Bei einer Bäckerei ist genau diese Achse der Unterschied
// zwischen Betrieb und Stillstand; der Lastgang wäre als Gewerbe-Testfall wertlos.
//
// 735 Tage = 105 Wochen ist die KLEINSTE wochentagserhaltende Verschiebung, die am bzw. nach dem
// 01.01.2025 beginnt (die nächstkleinere, 728, landete am 29.12.2024 und fiele unter die
// Upload-Sperre „kein Lastgang vor dem 1.1.2025", Delta 15 Regel B). Ergebnis: 05.01.2025 …
// 04.01.2026, ein Sonntag bis ein Sonntag.
//
// ⚠ BEWUSST IN KAUF GENOMMEN: Kalendertag und Jahreszeit verschieben sich um vier Tage, und die
// Reihe ragt vier Tage in 2026 hinein. Für einen synthetischen Testfall ist beides folgenlos —
// die Eimer-Einteilung von `consumption-pattern.ts` führt den Monat ohnehin OHNE Jahr, der Jänner
// 2026 fällt also mit dem Jänner 2025 in denselben Eimer. Was NICHT in Kauf genommen wird, ist
// eine Verschiebung des Wochentags.
//
// Die Zeitstempel der Quelldatei sind UTC-formatiert (`generate-demo-load-profile.mjs`,
// `formatTimestamp` liest `getUTC*`) — die Datei enthält also keine DST-Dubletten, und eine
// Verschiebung um ganze Tage auf der Wanduhr ist eine reine Textoperation ohne Zeitzonen-Falle.
//
// Ausführen: node dev-fixtures/shift-demo-baeckerei-lastgang.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SHIFT_DAYS = 735
const DAY_MS = 24 * 60 * 60 * 1000
const DIR = dirname(fileURLToPath(import.meta.url))
const SRC = join(DIR, 'demo-baeckerei-lastgang-2023.csv')
const OUT = join(DIR, 'demo-baeckerei-lastgang-verschoben-2025.csv')

const pad2 = (n) => String(n).padStart(2, '0')

function shiftStamp(stamp) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/.exec(stamp)
  if (!m) throw new Error(`Unerwarteter Zeitstempel: ${stamp}`)
  const [, dd, mm, yyyy, hh, mi] = m
  const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi) + SHIFT_DAYS * DAY_MS)
  return (
    `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
  )
}

const lines = readFileSync(SRC, 'utf8').trimEnd().split('\n')
const header = lines[0]
const out = [header]
for (const line of lines.slice(1)) {
  const idx = line.indexOf(';')
  out.push(`${shiftStamp(line.slice(0, idx))};${line.slice(idx + 1)}`)
}

writeFileSync(OUT, out.join('\n') + '\n', 'utf8')
console.log(`Geschrieben: ${OUT}`)
console.log(
  `${out.length - 1} Datenzeilen · Verschiebung ${SHIFT_DAYS} Tage (= ${SHIFT_DAYS / 7} Wochen) · ` +
    `${out[1].slice(0, 10)} … ${out[out.length - 1].slice(0, 10)}`,
)
