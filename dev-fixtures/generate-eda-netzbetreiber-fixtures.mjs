#!/usr/bin/env node
// Erzeugt ANONYMISIERTE Netzbetreiber-/EDA-Lastgang-Fixtures (Format A, OP#4) als Test-Grundlage
// für den Mehrspalten-Mapping-Pfad des Parsers (packages/engine). KEINE echten Kundendaten:
// Zählpunkt-IDs, Energiegemeinschafts-Namen und Werte sind frei erfunden; die STRUKTUR (BOM,
// Semikolon, Dezimalkomma, Split-Timestamp Datum + "Zeit von"/"Zeit bis", 4 Zählpunkte × 4 Größen,
// leere Trennspalten) bildet reale EDA-Exporte nach. Deterministisch (fixer Seed).
//
// Ausführen: node dev-fixtures/generate-eda-netzbetreiber-fixtures.mjs

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SLOTS_PER_DAY = 96
const DAYS = 7 // 7 × 96 = 672 Viertelstunden
const STEP_MS = 15 * 60 * 1000

// Deterministischer PRNG (mulberry32).
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

const pad2 = (n) => String(n).padStart(2, '0')
const gauss = (x, mu, sigma) => Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma))
const round3 = (n) => Math.round(n * 1000) / 1000
const deNum = (n) => (n === 0 ? '0' : n.toFixed(3).replace('.', ','))

// Frei erfundene (anonyme) österr. Zählpunktbezeichnungen: "AT" + 31 Ziffern = 33 Zeichen.
const fakeZp = (serial) => `AT0010${'0'.repeat(22)}${String(serial).padStart(5, '0')}`
const ZP = {
  verbrauch1: fakeZp(10111),
  verbrauch2: fakeZp(10222),
  einspeis1: fakeZp(30333),
  einspeis2: fakeZp(30444),
}

// Header exakt in der realen Reihenfolge: 2× Verbrauch, 2× Einspeiser, 2× Überschuss,
// 2× Restüberschuss — jeweils gefolgt von einer leeren Trennspalte.
function buildHeaderFields() {
  const cols = [
    `${ZP.verbrauch1} (Anonymisiert) - Verbrauch [kWh]`,
    `${ZP.verbrauch2} (Anonymisiert) - Verbrauch [kWh]`,
    `${ZP.einspeis1} (Anonymisiert) - Einspeiser [kWh]`,
    `${ZP.einspeis2} (Anonymisiert) - Einspeiser [kWh]`,
    `${ZP.einspeis1} (Anonymisiert) - Überschuss [kWh]`,
    `${ZP.einspeis2} (Anonymisiert) - Überschuss [kWh]`,
    `${ZP.einspeis1} (Anonymisiert) - Restüberschuss 'EEG Musterhausen' [kWh]`,
    `${ZP.einspeis2} (Anonymisiert) - Restüberschuss 'EEG Beispieldorf' [kWh]`,
  ]
  const fields = ['Datum', 'Zeit von', 'Zeit bis']
  for (const c of cols) fields.push(c, '') // Datenspalte + leere Trennspalte
  fields.push('') // zusätzliche Rand-Leerspalte wie im realen Export
  return fields
}

// Plausibler Kleinverbraucher-Tagesverlauf (Energiegemeinschafts-Teilnehmer): niedrige Nachtlast,
// Morgen-/Abendspitze. Nur die RELATIVE Form zählt — der Gesamtbezug wird anschließend exakt skaliert.
function rawShape(rand) {
  const out = []
  for (let t = 0; t < DAYS * SLOTS_PER_DAY; t++) {
    const hour = (t % SLOTS_PER_DAY) / 4
    const base = 0.02
    const morning = 0.06 * gauss(hour, 7.0, 1.3)
    const midday = 0.035 * gauss(hour, 12.5, 1.6)
    const evening = 0.1 * gauss(hour, 19.0, 1.9)
    const noise = 1 + (rand() - 0.5) * 0.12
    out.push(Math.max(0.005, (base + morning + midday + evening) * noise))
  }
  return out
}

/**
 * Erzeugt eine Format-A-Periode. `targetTotalKwh` = Σ Verbrauch (beide Zähler) über die Woche,
 * `targetPeakKw` = Spitzenleistung (= max Slot-kWh × 4). Beide werden EXAKT getroffen: ein Spitzen-
 * Slot wird gesetzt, die übrigen so skaliert, dass die Summe stimmt. Einspeiser/Überschuss/
 * Restüberschuss = 0 (wie in der Beispielzeile) → Netz = reiner Bezug, Plausibilitätszahl klar.
 */
function generatePeriod({ year, month, day, targetTotalKwh, targetPeakKw, peakDay, peakSlot, outFile }) {
  const rand = mulberry32(20260616)
  const raw = rawShape(rand)
  const n = raw.length
  const peakIdx = peakDay * SLOTS_PER_DAY + peakSlot
  const peakKwh = targetPeakKw / 4

  let sumOthers = 0
  for (let t = 0; t < n; t++) if (t !== peakIdx) sumOthers += raw[t]
  const k = (targetTotalKwh - peakKwh) / sumOthers

  const total = raw.map((r, t) => (t === peakIdx ? peakKwh : r * k))
  // Sicherstellen, dass der gesetzte Spitzen-Slot wirklich das Maximum bleibt.
  let maxOther = 0
  for (let t = 0; t < n; t++) if (t !== peakIdx) maxOther = Math.max(maxOther, round3(total[t]))
  if (maxOther >= peakKwh) throw new Error(`Spitzen-Slot nicht dominant (${maxOther} ≥ ${peakKwh})`)

  const start = Date.UTC(year, month - 1, day, 0, 0)
  const lines = ['﻿' + buildHeaderFields().join(';')]
  let sum = 0
  let peakSeen = 0

  for (let t = 0; t < n; t++) {
    const tot = round3(total[t])
    const v1 = round3(tot * 0.56)
    const v2 = round3(tot - v1) // v1 + v2 === tot exakt (Summierungs-Testgrundlage)
    sum += v1 + v2
    peakSeen = Math.max(peakSeen, (v1 + v2) * 4)

    const dFrom = new Date(start + t * STEP_MS)
    const dTo = new Date(start + (t + 1) * STEP_MS)
    const datum = `${pad2(dFrom.getUTCDate())}.${pad2(dFrom.getUTCMonth() + 1)}.${dFrom.getUTCFullYear()}`
    const zeitVon = `${pad2(dFrom.getUTCHours())}:${pad2(dFrom.getUTCMinutes())}:00`
    const zeitBis = `${pad2(dTo.getUTCHours())}:${pad2(dTo.getUTCMinutes())}:00`

    // Reihenfolge: V1, V2, E1, E2, Ü1, Ü2, R1, R2 — jeweils + leere Trennspalte, dann Rand-Leerspalte.
    const data = [deNum(v1), deNum(v2), '0', '0', '0', '0', '0', '0']
    const fields = [datum, zeitVon, zeitBis]
    for (const val of data) fields.push(val, '')
    fields.push('')
    lines.push(fields.join(';'))
  }

  writeFileSync(join(HERE, outFile), lines.join('\n') + '\n', 'utf8')
  console.log(
    `${outFile}: ${n} Zeilen · Σ Verbrauch=${round3(sum)} kWh · Spitze=${round3(peakSeen)} kW`,
  )
}

// Juni-Periode (Pflicht-Fixture) — Zielzahlen ~46,1 kWh / 2,36 kW aus dem realen Export.
generatePeriod({
  year: 2026, month: 6, day: 16,
  targetTotalKwh: 46.1, targetPeakKw: 2.36,
  peakDay: 3, peakSlot: 28, // Do., 07:00
  outFile: 'netzbetreiber-eda-juni-2026.csv',
})

// März-Periode (zusätzliches Fixture) — ~69,2 kWh / 3,28 kW.
generatePeriod({
  year: 2026, month: 3, day: 16,
  targetTotalKwh: 69.2, targetPeakKw: 3.28,
  peakDay: 2, peakSlot: 30, // Mi., 07:30
  outFile: 'netzbetreiber-eda-maerz-2026.csv',
})
