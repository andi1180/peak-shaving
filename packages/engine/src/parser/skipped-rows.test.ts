import { describe, expect, it } from 'vitest'

import { parseLoadProfile } from './parse'

/**
 * Die Meldung über übersprungene Zeilen — getrennt nach Ausfallart. (22.09.2026)
 *
 * Bis hierher zählte EIN Zähler zwei verschiedene Befunde zusammen: eine Zeile mit unlesbarem
 * Zeitstempel (Verdacht auf falsch erkanntes Format) und eine Zeile, die korrekt an ihrer Stelle
 * steht und bloss keinen Messwert trägt. Am Referenzfall waren es 14.980 Zeilen der zweiten Art,
 * und die Meldung las sich wie ein Parser-Fehler.
 *
 * Alle Fälle parsen mit `timezone: 'UTC'` — geprüft wird der Meldungstext, und mit Europe/Vienna
 * wären die genannten Kalendertage nicht mehr von Hand nachrechenbar.
 */

const pad = (x: number) => String(x).padStart(2, '0')
const STEP_MS = 15 * 60 * 1000
const START_MS = Date.UTC(2025, 5, 1, 0, 0) // 01.06.2025 00:00
const DAY_ROWS = 96

function isoNaiveAt(i: number): string {
  const d = new Date(START_MS + i * STEP_MS)
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  )
}

/** `cell(i)` liefert den Zeitstempel (`null` = kaputt) und den Wert (`null` = leere Zelle). */
function buildCsv(rows: number, cell: (i: number) => { ts?: string | null; v: number | null }) {
  const out = ['Zeit,Bezug (kW)']
  for (let i = 0; i < rows; i++) {
    const { ts, v } = cell(i)
    out.push(`${ts === null ? 'kaputt' : (ts ?? isoNaiveAt(i))},${v == null ? '' : v}`)
  }
  return out.join('\n')
}

function warningsOf(csv: string): string[] {
  const out = parseLoadProfile({ content: csv, format: 'csv' }, { timezone: 'UTC' })
  expect(out.ok).toBe(true)
  if (!out.ok) throw new Error('nicht parsebar')
  return out.dataQuality.warnings
}

describe('übersprungene Zeilen — Meldung je Ausfallart', () => {
  it('Wert-Block am Anfang nennt seinen Zeitraum und den Beginn der Auslesung', () => {
    // Die Gestalt des Referenzfalls: zwei Tage ohne Messwert, danach lückenlos.
    const idle = 2 * DAY_ROWS
    const warnings = warningsOf(
      buildCsv(idle + 2 * DAY_ROWS, (i) => ({ v: i < idle ? null : 10 + (i % 5) })),
    )

    expect(warnings).toContain(
      '192 Zeile(n) ohne Messwert (01.06.2025 bis 02.06.2025) — ' +
        'die Zählerauslesung beginnt erst ab 03.06.2025.',
    )
  })

  it('Wert-Block am Ende nennt das Ende der Auslesung, ein einzelner Tag ohne „bis"', () => {
    const valued = 2 * DAY_ROWS
    const warnings = warningsOf(
      buildCsv(valued + DAY_ROWS, (i) => ({ v: i < valued ? 10 + (i % 5) : null })),
    )

    expect(warnings).toContain(
      '96 Zeile(n) ohne Messwert (am 03.06.2025) — die Zählerauslesung endet mit 02.06.2025.',
    )
  })

  it('verstreute Wert-Lücken behaupten KEINEN Zeitraum', () => {
    const warnings = warningsOf(
      buildCsv(3 * DAY_ROWS, (i) => ({ v: i % 50 === 7 ? null : 10 + (i % 5) })),
    )

    const own = warnings.filter((w) => w.includes('ohne Messwert'))
    expect(own).toEqual(['6 Zeile(n) ohne Messwert, verteilt über den Zeitraum.'])
    // Weder eine Datumsangabe noch eine Aussage über Beginn oder Ende der Auslesung.
    expect(own[0]).not.toMatch(/\d{2}\.\d{2}\.\d{4}/)
  })

  it('reine Zeitstempel-Fehler behalten die bisherige Formulierung', () => {
    const warnings = warningsOf(
      buildCsv(2 * DAY_ROWS, (i) => ({ ts: i % 50 === 7 ? null : undefined, v: 10 + (i % 5) })),
    )

    expect(warnings).toContain('4 Zeile(n) ohne gültigen Zeitstempel/Wert übersprungen.')
    expect(warnings.some((w) => w.includes('ohne Messwert'))).toBe(false)
  })

  it('beide Ausfallarten stehen getrennt da und werden nicht addiert', () => {
    const idle = DAY_ROWS
    const warnings = warningsOf(
      buildCsv(idle + 2 * DAY_ROWS, (i) => ({
        // Kaputte Zeitstempel ausschliesslich im bewerteten Teil — sonst wäre nicht
        // unterscheidbar, welcher Zähler eine Zeile aufgenommen hat.
        ts: i >= idle && i % 50 === 7 ? null : undefined,
        v: i < idle ? null : 10 + (i % 5),
      })),
    )

    expect(warnings).toContain('4 Zeile(n) ohne gültigen Zeitstempel/Wert übersprungen.')
    expect(warnings).toContain(
      '96 Zeile(n) ohne Messwert (am 01.06.2025) — die Zählerauslesung beginnt erst ab 02.06.2025.',
    )
    // 100 wäre die addierte Zahl — sie darf nirgends auftauchen.
    expect(warnings.some((w) => w.startsWith('100 Zeile(n)'))).toBe(false)
  })
})
