import type { PvgisHourlySample } from '../pvgis'

/**
 * TEST-FIXTURE (kein Produktionscode) — eine VOLLSTÄNDIGE, deterministische Zehn-Jahres-Reihe in der
 * Form, die `parsePvgisSeries` liefert.
 *
 * Sie ergänzt die gekürzte ECHTE PVGIS-Antwort in `__fixtures__/`: jene trägt reale Werte, aber nur
 * vier Kalendertage je Jahr (eine vollständige Zehn-Jahres-Antwort sind 8,2 MB und gehört nicht ins
 * Repo). Was nur an einer vollständigen Reihe prüfbar ist — Kalenderabdeckung, Jahressatz,
 * Schaltjahr-Ausschluss über das ganze Profil —, wird deshalb hier geprüft.
 *
 * Der Jahresfaktor macht das Mittel unterscheidbar: ohne ihn wären alle zehn Jahre identisch, und
 * ein Test über den Mittelwert bliebe auch dann grün, wenn nur ein einziges Jahr eingelesen würde.
 *
 * Ablage nach dem Vorbild von `recommendation/dummy-catalog.ts`: ein Fixture-Modul, das bewusst
 * NICHT über den Paket-Barrel exportiert wird.
 */

const ONE_HOUR_MS = 60 * 60 * 1000

/** Tagesbogen in W je kWp-loser Einheit — 0 in der Nacht, Maximum um 12:00 UTC. */
function hourShapeW(hour: number): number {
  const x = hour - 12
  const v = 1000 * Math.exp(-(x * x) / 12)
  return v < 1 ? 0 : v
}

/** Jahresgang, Maximum im Sommer. `dayOfYear` ab 1. */
function seasonFactor(dayOfYear: number): number {
  return 0.6 + 0.4 * Math.cos((2 * Math.PI * (dayOfYear - 172)) / 365)
}

/** Der Faktor, der die zehn Jahre unterscheidbar macht: 0,90 · 0,92 · … · 1,08, Mittel exakt 0,99. */
export function syntheticYearFactor(year: number): number {
  return 0.9 + 0.02 * (year - 2014)
}

/**
 * Ein je Jahr ANDERES Bewölkungsmuster (deterministisch, kein Zufall).
 *
 * Ohne es wäre jedes Wetterjahr eine skalierte Kopie des nächsten, und die Mittelung hätte keine
 * beobachtbare Wirkung auf die FORM der Kurve — genau die Wirkung, die der Glättungs-Test unten
 * misst. Die Zahlen sind willkürlich, aber fest: ein Fixture darf keinen Zufall tragen.
 */
function cloudFactor(year: number, dayOfYear: number): number {
  return (dayOfYear * 7 + (year - 2014) * 13) % 5 === 0 ? 0.35 : 1
}

/** Die Erzeugung eines einzelnen UTC-Stundenbeginns in kW — die Wahrheit, gegen die Tests messen. */
export function syntheticKwAt(year: number, utcMs: number): number {
  const d = new Date(utcMs)
  const startOfYear = Date.UTC(year, 0, 1)
  const dayOfYear = Math.floor((utcMs - startOfYear) / (24 * ONE_HOUR_MS)) + 1
  return (
    (hourShapeW(d.getUTCHours()) *
      seasonFactor(dayOfYear) *
      syntheticYearFactor(year) *
      cloudFactor(year, dayOfYear)) /
    1000
  )
}

/** Eine vollständige, lückenlose Reihe über `[from, to]` — inklusive der 29. Februar der Schaltjahre. */
export function syntheticSeries(from = 2014, to = 2023): PvgisHourlySample[] {
  const out: PvgisHourlySample[] = []
  for (let year = from; year <= to; year++) {
    const start = Date.UTC(year, 0, 1)
    const end = Date.UTC(year + 1, 0, 1)
    for (let ms = start; ms < end; ms += ONE_HOUR_MS) {
      out.push({ utcMs: ms, pvGenerationKw: syntheticKwAt(year, ms) })
    }
  }
  return out
}
