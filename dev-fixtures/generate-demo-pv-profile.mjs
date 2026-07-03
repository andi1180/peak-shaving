#!/usr/bin/env node
// Generiert ein KONSISTENTES Demo-Paar für den PvProfile-Pfad (Upload → Engine → Trace):
//   1. demo-baeckerei-mit-pv-netzlastgang-2023.csv — SIGNIERTER Netz-Lastgang (+ Bezug, − Einspeisung),
//      d.h. Verbrauch − BruttoPV. Wird von `parseLoadProfile` als `net_signed` erkannt (Negativwerte).
//   2. demo-baeckerei-pv-erzeugung-2023.csv        — BRUTTO-PV-Erzeugung des Wechselrichters (≥ 0).
//      Wird als optionales PvProfile über `parsePvProfile` geladen.
//
// KONSISTENZ PER KONSTRUKTION (§3.1, Prinzip 1): Der Netz-Lastgang wird aus (Verbrauch − BruttoPV)
// abgeleitet. Damit gilt Einspeisung(t) = max(0, −netz(t)) = max(0, BruttoPV − Verbrauch) ≤ BruttoPV
// IMMER (Verbrauch ≥ 0) → die Konsistenz-Warnung aus Teil 1 (`alignPvGrossToLoad`) feuert NIE.
//
// Der bestehende no-PV-Bäcker (generate-demo-load-profile.mjs / demo-baeckerei-lastgang-2023.csv)
// bleibt unberührt und zusätzlich verfügbar.
//
// Deterministisch (fixer Seed): erneutes Ausführen erzeugt byte-identische Dateien.
// Ausführen: node dev-fixtures/generate-demo-pv-profile.mjs

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const YEAR = 2023 // kein Schaltjahr → 365 × 96 = 35.040 Viertelstunden-Slots
const SLOTS_PER_DAY = 96
const DAYS = 365
const STEP_MS = 15 * 60 * 1000
const OUT_DIR = dirname(fileURLToPath(import.meta.url))
const LOAD_FILE = join(OUT_DIR, 'demo-baeckerei-mit-pv-netzlastgang-2023.csv')
const PV_FILE = join(OUT_DIR, 'demo-baeckerei-pv-erzeugung-2023.csv')

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

function pad2(n) {
  return String(n).padStart(2, '0')
}

// Kombinierter Zeitstempel TT.MM.JJJJ HH:MM (de_dot). UTC-Getter als reiner Wanduhr-Rechner (keine
// echte tz-Umrechnung nötig — wir erzeugen nur die naive Beschriftung, maschinenunabhängig).
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

function plateau(x, start, end, edge) {
  const up = 1 / (1 + Math.exp(-(x - start) / edge))
  const down = 1 / (1 + Math.exp((x - end) / edge))
  return up * down
}

function seasonFactor(month) {
  return 1 + 0.05 * Math.cos((2 * Math.PI * (month - 1)) / 12)
}

// ── VERBRAUCH (echte Last, immer > 0) — identische Bäckerei-Form wie der no-PV-Demo-Lastgang. ──────
function verbrauchKw(date, rand) {
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60
  const dow = date.getUTCDay() // 0 = Sonntag
  const month = date.getUTCMonth() + 1
  const season = seasonFactor(month)
  const nightBase = 3.2 * season

  if (dow === 0) return nightBase + rand() * 0.3 // Sonntag: geschlossen, nur Kühlung/Standby

  const ovenRamp = 44 * gauss(hour, 5.0, 0.55)
  const secondBake = 9 * gauss(hour, 10.5, 1.1)
  const closing = dow === 6 ? 13.5 : 18.0
  const dayPlateau = 9.5 * season * plateau(hour, 6, closing, 0.6)
  const kw = (nightBase + ovenRamp + secondBake + dayPlateau) * (1 + (rand() - 0.5) * 0.08)
  return Math.max(0.5, kw)
}

// ── BRUTTO-PV (Dachanlage) — Tagesbogen + saisonale Skalierung, immer ≥ 0. ─────────────────────────
// Amplitude ~30 kWp-Dach: Peak-Skalierung sommers deutlich höher als winters (Sonnenstand/-dauer).
function pvGrossKw(date) {
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60
  const month = date.getUTCMonth() + 1
  // Saisonaler Peak: Sommer ~28 kW, Winter ~9 kW (Cosinus um die Jahresmitte, Juni=Monat 6).
  const seasonalPeak = 18.5 + 9.5 * Math.cos((2 * Math.PI * (month - 6)) / 12)
  // Tagesbogen: Sonnenauf-/untergang saisonal breiter/schmaler (Sommer länger).
  const dayLenSigma = 2.4 + 0.7 * Math.cos((2 * Math.PI * (month - 6)) / 12) // Sommer breiter
  const arc = gauss(hour, 12.5, dayLenSigma)
  const kw = seasonalPeak * arc
  return kw < 0.05 ? 0 : kw // nachts exakt 0 (kein Rauschen ins Negative)
}

// Absichtliche Lücken NUR im Netz-Lastgang (Interpolations-/Datenqualitäts-Demo, §3.3); die PV-Datei
// bleibt lückenlos (Abdeckungslücken zählen ohnehin NICHT als Konsistenz-Widerspruch, s. pv.ts).
// BEWUSST in Nachtstunden gelegt (BruttoPV = 0, netz > 0): so kann die lineare Lücken-Interpolation
// keine scheinbare Einspeisung erzeugen, die die Brutto-PV überschreitet → das Paar bleibt garantiert
// konsistent (`inconsistentSlots = 0`), auch an den interpolierten Slots.
const GAPS = [
  { start: Date.UTC(YEAR, 2, 10, 2, 0), slots: 2 }, // 10. März, 30 min (still interpoliert)
  { start: Date.UTC(YEAR, 8, 18, 2, 0), slots: 8 }, // 18. September, 2 h (Warnung > 4 Slots)
]
function isGap(ms) {
  return GAPS.some((g) => ms >= g.start && ms < g.start + g.slots * STEP_MS)
}

function generate() {
  const rand = mulberry32(20230701) // eigener Seed, unabhängig vom no-PV-Generator
  const start = Date.UTC(YEAR, 0, 1, 0, 0)
  const totalSlots = DAYS * SLOTS_PER_DAY

  const loadLines = ['Zeitstempel;Netzleistung (kW)']
  const pvLines = ['Zeitstempel;PV-Erzeugung (kW)']
  let omitted = 0
  let feedInSlots = 0

  for (let i = 0; i < totalSlots; i++) {
    const ms = start + i * STEP_MS
    const date = new Date(ms)
    const stamp = formatTimestamp(date)

    // PV-Datei ist lückenlos.
    const pv = pvGrossKw(date)
    pvLines.push(`${stamp};${formatKw(pv)}`)

    if (isGap(ms)) {
      omitted++
      continue // Lücke NUR im Netz-Lastgang
    }
    // Signierter Netz-Lastgang = Verbrauch − BruttoPV (Einspeisung ⇒ negativ). Konsistent per Konstruktion.
    const netz = verbrauchKw(date, rand) - pv
    if (netz < 0) feedInSlots++
    loadLines.push(`${stamp};${formatKw(netz)}`)
  }

  writeFileSync(LOAD_FILE, loadLines.join('\n') + '\n', 'utf8')
  writeFileSync(PV_FILE, pvLines.join('\n') + '\n', 'utf8')
  console.log(`Geschrieben: ${LOAD_FILE}`)
  console.log(`Geschrieben: ${PV_FILE}`)
  console.log(
    `${totalSlots} Slots · ${omitted} im Netz-Lastgang ausgelassen (Lücken-Test) · ` +
      `${feedInSlots} Slots mit Einspeisung (netz < 0). Konsistenz per Konstruktion: BruttoPV ≥ Einspeisung.`,
  )
}

generate()
