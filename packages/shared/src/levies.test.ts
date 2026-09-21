import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { buildLevySchedule, findLevyPeriod } from './levies'

describe('buildLevySchedule — was belegt ist, wird geschnitten; was fehlt, bleibt Lücke', () => {
  it('schneidet den Gebrauchsabgabe-Sprung am 01.03.2026 zu ZWEI Zeiträumen', () => {
    const { periods } = buildLevySchedule('wiener_netze', 7, '2026-01-30', '2026-08-26')

    expect(periods.map((p) => [p.validFrom, p.gebrauchsabgabeRate])).toEqual([
      ['2026-01-01', 0.06],
      ['2026-03-01', 0.07],
    ])
    // Der Tag davor trägt noch den alten Satz — `validUntil` ist INKLUSIV.
    expect(findLevyPeriod(periods, '2026-02-28')?.gebrauchsabgabeRate).toBe(0.06)
    expect(findLevyPeriod(periods, '2026-03-01')?.gebrauchsabgabeRate).toBe(0.07)
  })

  it('deckt das GANZE Kalenderjahr ab, nicht nur den abgefragten Ausschnitt', () => {
    /*
     * Zwei Ränder hängen daran: die lokale Wanduhr (ein UTC-Fenster endet vor dem letzten lokalen
     * Kalendertag) und die Jahres-Hochrechnung, die Tage ausserhalb des Messzeitraums bewertet.
     * Auf den Ausschnitt beschnitten fände beides keinen Satz und der Hebel fiele stumm aus.
     */
    const { periods } = buildLevySchedule('wiener_netze', 7, '2026-05-01', '2026-05-02')

    expect(findLevyPeriod(periods, '2026-01-01')).not.toBeNull()
    expect(findLevyPeriod(periods, '2026-12-31')).not.toBeNull()
    // 2027 ist nicht belegt (die Absenkung der Elektrizitätsabgabe ist auf 2026 befristet).
    expect(findLevyPeriod(periods, '2027-01-01')).toBeNull()
  })

  it('liefert GAR NICHTS, wo eine der drei Quellen fehlt — statt den Posten still auf 0 zu setzen', () => {
    // NE 5: kein belegter EAG-Satz. Netz NÖ: keine belegte Gebrauchsabgabe. 2025: keine Sätze.
    expect(buildLevySchedule('wiener_netze', 5, '2026-01-01', '2026-12-31').periods).toEqual([])
    expect(buildLevySchedule('netz_noe', 7, '2026-01-01', '2026-12-31').periods).toEqual([])
    expect(buildLevySchedule('wiener_netze', 7, '2025-01-01', '2025-12-31').periods).toEqual([])
  })
})

/**
 * ⚠ DER WÄCHTER ÜBER `LEVIES_NONE`.
 *
 * Ein Abgabenplan ohne Abgaben ist für Tests gedacht. In einem Rechenweg benutzt wäre er eine
 * still zu niedrige Rechnung — genau der Fehler, gegen den die Verweigerung oben gebaut ist, und
 * er fiele niemandem als Fehler auf, sondern als Ergebnis. Geprüft werden die Module, in denen
 * tatsächlich gerechnet und aufgelöst wird; Entwurfs- und Probe-Routen (`app/`) sind ausgenommen.
 */
describe('LEVIES_NONE erreicht keinen Rechenweg', () => {
  const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')
  const SCOPES = [
    'packages/shared/src',
    'packages/engine/src',
    'packages/extractors/src',
    'apps/website/lib',
    'apps/web/lib',
  ]

  function sourceFiles(dir: string): string[] {
    const out: string[] = []
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return out
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...sourceFiles(full))
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
    }
    return out
  }

  it('findet überhaupt Quelldateien (sonst prüfte dieser Test nichts)', () => {
    const files = SCOPES.flatMap((s) => sourceFiles(join(ROOT, s)))
    expect(files.length).toBeGreaterThan(100)
  })

  it('kein Rechen- oder Auflösungsmodul nennt den Bezeichner', () => {
    const offenders = SCOPES.flatMap((scope) =>
      sourceFiles(join(ROOT, scope))
        .filter((f) => !f.endsWith(join('shared', 'src', 'levies.ts')))
        .filter((f) => readFileSync(f, 'utf8').includes('LEVIES_NONE'))
        .map((f) => f.slice(ROOT.length + 1)),
    )
    expect(offenders).toEqual([])
  })
})
