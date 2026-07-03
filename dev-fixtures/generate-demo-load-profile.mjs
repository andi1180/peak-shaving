#!/usr/bin/env node
// Generiert einen synthetischen 12-Monats-Viertelstunden-Lastgang (Bäckerei, kein PV) als
// Demo-/Testdatei für den öffentlichen Rechner (`apps/website`). KEINE echten Kundendaten —
// siehe README.md in diesem Ordner. Deterministisch (fixer Seed): erneutes Ausführen
// erzeugt exakt dieselbe Datei.
//
// Ausführen: node dev-fixtures/generate-demo-load-profile.mjs

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const YEAR = 2023 // kein Schaltjahr → exakt 365 × 96 = 35.040 Viertelstunden-Slots
const SLOTS_PER_DAY = 96
const DAYS = 365
const STEP_MS = 15 * 60 * 1000
const OUT_FILE = join(dirname(fileURLToPath(import.meta.url)), 'demo-baeckerei-lastgang-2023.csv')

// Deterministischer PRNG (mulberry32) — reproduzierbare Ausgabe bei jedem Lauf.
function mulberry32(seed) {
  let a = seed
  return function next() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(20230101)

function pad2(n) {
  return String(n).padStart(2, '0')
}

// Kombinierter Zeitstempel TT.MM.JJJJ HH:MM (de_dot, siehe packages/engine/src/parser/datetime.ts).
// UTC-Getter bewusst als reiner Kalender-/Uhrzeit-Rechner genutzt (keine echte tz-Umrechnung nötig,
// wir erzeugen nur die naive Wanduhr-Beschriftung — unabhängig von der Zeitzone der Ausführungsmaschine).
function formatTimestamp(date) {
  const d = `${pad2(date.getUTCDate())}.${pad2(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`
  const t = `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`
  return `${d} ${t}`
}

function formatKw(value) {
  return value.toFixed(2).replace('.', ',')
}

function gauss(x, mu, sigma) {
  return Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma))
}

// Sanfte Kanten (logistisch) statt harter Sprünge — realistischeres Auf-/Abfahren am Ladenschluss.
function plateau(x, start, end, edge) {
  const up = 1 / (1 + Math.exp(-(x - start) / edge))
  const down = 1 / (1 + Math.exp((x - end) / edge))
  return up * down
}

function seasonFactor(month) {
  // Winter (Heizung/Licht) etwas höher als Sommer — Amplitude klein, nur „plausibel", nicht kalibriert.
  return 1 + 0.05 * Math.cos((2 * Math.PI * (month - 1)) / 12)
}

/**
 * Plausibler Bäckerei-Tagesverlauf: niedrige Nachtlast, Ofen-Anlauf 4–6 Uhr (Peak ~5 Uhr),
 * Tagesbetrieb bis Ladenschluss, danach Abklingen. Sonntag geschlossen (nur Grundlast),
 * Samstag verkürzter Tag. Immer > 0 (kein PV/Einspeisung → source wird „import_only").
 */
function loadKw(date) {
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60
  const dow = date.getUTCDay() // 0 = Sonntag
  const month = date.getUTCMonth() + 1
  const season = seasonFactor(month)
  const nightBase = 3.2 * season

  if (dow === 0) {
    return nightBase + rand() * 0.3 // Sonntag: geschlossen, nur Kühlung/Standby
  }

  const ovenRamp = 44 * gauss(hour, 5.0, 0.55) // Ofen-Anlauf, Peak ~5 Uhr
  const secondBake = 9 * gauss(hour, 10.5, 1.1) // zweiter Ofengang / Gebäck
  const closing = dow === 6 ? 13.5 : 18.0 // Samstag früher zu
  const dayPlateau = 9.5 * season * plateau(hour, 6, closing, 0.6)

  const kw = (nightBase + ovenRamp + secondBake + dayPlateau) * (1 + (rand() - 0.5) * 0.08)
  return Math.max(0.5, kw)
}

// Absichtliche Lücken (fehlende Viertelstunden-Werte), damit Interpolation + die
// Datenqualitäts-Warnungen (§3.3) beim Testen sichtbar werden: zwei kleine (≤ 4 Slots →
// still interpoliert) und eine große (> 4 Slots → löst die "größere Datenlücke"-Warnung aus).
const GAPS = [
  { start: Date.UTC(YEAR, 2, 10, 13, 0), slots: 2 }, // 10. März, 30 min
  { start: Date.UTC(YEAR, 5, 15, 9, 30), slots: 1 }, // 15. Juni, 15 min
  { start: Date.UTC(YEAR, 8, 18, 14, 0), slots: 8 }, // 18. September, 2 h
]

function isGap(ms) {
  return GAPS.some((g) => ms >= g.start && ms < g.start + g.slots * STEP_MS)
}

function generate() {
  const start = Date.UTC(YEAR, 0, 1, 0, 0)
  const totalSlots = DAYS * SLOTS_PER_DAY
  const lines = ['Zeitstempel;Leistung (kW)']
  let omitted = 0

  for (let i = 0; i < totalSlots; i++) {
    const ms = start + i * STEP_MS
    if (isGap(ms)) {
      omitted++
      continue
    }
    const date = new Date(ms)
    lines.push(`${formatTimestamp(date)};${formatKw(loadKw(date))}`)
  }

  writeFileSync(OUT_FILE, lines.join('\n') + '\n', 'utf8')
  console.log(`Geschrieben: ${OUT_FILE}`)
  console.log(
    `${totalSlots} Viertelstunden-Slots im Jahr, ${omitted} davon absichtlich ausgelassen ` +
      `(Lücken-Test), ${lines.length - 1} Datenzeilen geschrieben.`,
  )
}

generate()
