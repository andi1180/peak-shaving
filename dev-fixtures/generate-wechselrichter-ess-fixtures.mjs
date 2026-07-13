#!/usr/bin/env node
// Erzeugt ANONYMISIERTE Wechselrichter-/ESS-Export-Fixtures (Format B, OP#4) als Test-Grundlage
// für die Ablehnung "kein Netz-Lastgang". KEINE echten Kundendaten. Struktur wie reale Exporte:
// XLSX, Zeitzelle als STRING mit ausgeschriebenem dt. Monatsnamen ("17/März/2026 00:00"),
// Wertzellen als STRING mit Dezimalkomma, Spalten Ein-/Ausgangs- und Batterielade-/-entladeleistung.
// In allen vier Dateien: Batterielade/-entlade = 0, Eingang == Ausgang (reiner PV-Durchlauf,
// keine aktive Speichernutzung). Deterministisch. SheetJS-Write ist byte-stabil.
//
// Ausführen: node dev-fixtures/generate-wechselrichter-ess-fixtures.mjs

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as XLSX from '../packages/engine/node_modules/xlsx/xlsx.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SLOTS_PER_DAY = 96
const DAYS = 7 // 7 × 96 = 672 Zeilen
const pad2 = (n) => String(n).padStart(2, '0')
const gauss = (x, mu, sigma) => Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma))
const deNum1 = (n) => n.toFixed(1).replace('.', ',')

// Tages-PV-Bogen (0 nachts). `peakKw` = Mittagsspitze; Form nur plausibel, nicht kalibriert.
function pvKw(slot, peakKw) {
  const hour = slot / 4
  const v = peakKw * gauss(hour, 13.0, 3.1)
  return v < 0.05 ? 0 : Math.round(v * 10) / 10
}

const MONTH_NAMES = {
  3: 'März',
  6: 'Juni',
}

function generateFile({ system, year, month, day, peakKw, outFile }) {
  const header = [
    'Zeit',
    `Energy Storage System${system}/Eingangsleistung(kW)`,
    `Energy Storage System${system}/Ausgangsleistung(kW)`,
    `Energy Storage System${system}/Batterieladeleistung(kW)`,
    `Energy Storage System${system}/Batterieentladeleistung(kW)`,
  ]
  const aoa = [header]

  for (let t = 0; t < DAYS * SLOTS_PER_DAY; t++) {
    const dayIdx = Math.floor(t / SLOTS_PER_DAY)
    const slot = t % SLOTS_PER_DAY
    const hh = Math.floor(slot / 4)
    const mm = (slot % 4) * 15
    const zeit = `${pad2(day + dayIdx)}/${MONTH_NAMES[month]}/${year} ${pad2(hh)}:${pad2(mm)}`
    const pv = pvKw(slot, peakKw)
    // Eingang == Ausgang (PV-Durchlauf); Batterie lädt/entlädt nie. Alle Werte als STRING mit Komma.
    aoa.push([zeit, deNum1(pv), deNum1(pv), '0,0', '0,0'])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Export')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  writeFileSync(join(HERE, outFile), Buffer.from(buf))
  console.log(`${outFile}: ${aoa.length - 1} Zeilen · PV-Spitze≈${peakKw} kW`)
}

// Zwei Wechselrichter × zwei Jahreszeiten (März/Juni). 7 Tage à 96 Slots je Datei.
generateFile({ system: 1, year: 2026, month: 3, day: 17, peakKw: 6.2, outFile: 'wechselrichter-ess-sys1-maerz-2026.xlsx' })
generateFile({ system: 1, year: 2026, month: 6, day: 16, peakKw: 9.4, outFile: 'wechselrichter-ess-sys1-juni-2026.xlsx' })
generateFile({ system: 2, year: 2026, month: 3, day: 17, peakKw: 5.1, outFile: 'wechselrichter-ess-sys2-maerz-2026.xlsx' })
generateFile({ system: 2, year: 2026, month: 6, day: 16, peakKw: 8.0, outFile: 'wechselrichter-ess-sys2-juni-2026.xlsx' })
