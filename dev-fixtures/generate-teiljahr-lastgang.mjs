#!/usr/bin/env node
// Generiert einen synthetischen TEILJAHRES-Viertelstunden-Lastgang: 7 Tage (16.–22.06.2026),
// ein einzelner Kalendermonat. Anonymisierte Rekonstruktion eines echten Wiener-Netze-Teildatensatzes
// (KEINE echten Kundendaten — Struktur nachgebildet, Werte erfunden; s. README.md). Reproduziert den
// §3.5-Teiljahres-Fehler: unter `monthly_max_average` verdünnten die 11 leeren Monate den realen
// Peak (2,848 kW) früher auf ~1/12 → billedKw 0,2 kW statt 2,8 kW.
//
// Ausführen: node dev-fixtures/generate-teiljahr-lastgang.mjs

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const YEAR = 2026
const MONTH = 6 // Juni
const FIRST_DAY = 16
const LAST_DAY = 22 // 7 Tage: 16.–22.06.
const SLOTS_PER_DAY = 96
const STEP_MS = 15 * 60 * 1000
const PEAK_KW = 2.848 // realer Abendpeak am 17.06. um 21:00 — bleibt der eindeutige Jahres-/Monatshöchstwert
const OUT_FILE = join(dirname(fileURLToPath(import.meta.url)), 'teiljahr-lastgang-juni-2026.csv')

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
const rand = mulberry32(20260616)

function pad2(n) {
  return String(n).padStart(2, '0')
}

// Kombinierter Zeitstempel TT.MM.JJJJ HH:MM (de_dot). UTC-Getter als reiner Wanduhr-Rechner genutzt.
function formatTimestamp(date) {
  const d = `${pad2(date.getUTCDate())}.${pad2(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`
  const t = `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`
  return `${d} ${t}`
}

function formatKw(value) {
  return value.toFixed(3).replace('.', ',')
}

// Kleiner Gewerbe-/Haushalts-Tagesverlauf (Größenordnung ~1 kW): niedrige Nacht, Tagbetrieb,
// leicht erhöhter Abend. Immer > 0 (kein PV → source „import_only"). Peak wird separat gesetzt.
function baseLoadKw(hour) {
  if (hour < 5) return 0.35 // Nacht
  if (hour < 7) return 0.7 // früher Morgen
  if (hour < 18) return 1.25 // Tag
  if (hour < 22) return 1.6 // Abend (erhöht)
  return 0.5 // spät
}

function generate() {
  const lines = ['Zeitstempel;Leistung (kW)']
  for (let day = FIRST_DAY; day <= LAST_DAY; day++) {
    const dayStart = Date.UTC(YEAR, MONTH - 1, day, 0, 0)
    for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
      const ms = dayStart + slot * STEP_MS
      const date = new Date(ms)
      const hour = date.getUTCHours()
      const isPeakSlot = day === 17 && hour === 21 && date.getUTCMinutes() === 0
      const value = isPeakSlot ? PEAK_KW : baseLoadKw(hour) * (1 + (rand() - 0.5) * 0.12)
      lines.push(`${formatTimestamp(date)};${formatKw(Math.max(0.2, value))}`)
    }
  }
  writeFileSync(OUT_FILE, lines.join('\n') + '\n', 'utf8')
  const rows = lines.length - 1
  console.log(`Geschrieben: ${OUT_FILE}`)
  console.log(
    `${rows} Datenzeilen (${LAST_DAY - FIRST_DAY + 1} Tage × ${SLOTS_PER_DAY}), ` +
      `Peak ${PEAK_KW} kW am 17.06. 21:00 — ein einziger Kalendermonat (Juni).`,
  )
}

generate()
