import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { buildLevySchedule, findLevyPeriod } from './levies'

const HEIM = { category: 'heim' } as const
const GEWERBE = { category: 'gewerbe' } as const

describe('buildLevySchedule — was belegt ist, wird geschnitten; was fehlt, bleibt Lücke', () => {
  it('schneidet den Gebrauchsabgabe-Sprung am 01.03.2026 zu ZWEI Zeiträumen', () => {
    const { periods } = buildLevySchedule(
      'wiener_netze',
      7,
      '2026-01-30',
      '2026-08-26',
      'ohne_leistungsmessung',
      HEIM,
    )

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
    const { periods } = buildLevySchedule(
      'wiener_netze',
      7,
      '2026-05-01',
      '2026-05-02',
      'ohne_leistungsmessung',
      HEIM,
    )

    expect(findLevyPeriod(periods, '2026-01-01')).not.toBeNull()
    expect(findLevyPeriod(periods, '2026-12-31')).not.toBeNull()
    // 2027 ist nicht belegt (die Absenkung der Elektrizitätsabgabe ist auf 2026 befristet).
    expect(findLevyPeriod(periods, '2027-01-01')).toBeNull()
  })

  it('liefert GAR NICHTS, wo eine der vier Quellen fehlt — statt den Posten still auf 0 zu setzen', () => {
    // Netz NÖ: keine belegte Gebrauchsabgabe.
    expect(buildLevySchedule('netz_noe', 7, '2026-01-01', '2026-12-31', null, HEIM).periods).toEqual([])
    // 2027: die Absenkung der Elektrizitätsabgabe ist auf 2026 befristet, danach ist nichts
    // belegt — die EAG-Sätze und die offene Gebrauchsabgabe allein genügen nicht.
    expect(
      buildLevySchedule('wiener_netze', 7, '2027-01-01', '2027-12-31', 'ohne_leistungsmessung', HEIM)
        .periods,
    ).toEqual([])
    /*
     * ⚠ Netzebene 7 OHNE Messvariante: EX104 führt für NE 7 drei Zeilen und keine variantenlose.
     * Wer die Variante nicht mitgibt, bekommt deshalb nichts — nicht ersatzweise eine der drei.
     */
    expect(buildLevySchedule('wiener_netze', 7, '2026-01-01', '2026-12-31', null, HEIM).periods).toEqual([])
  })

  it('trägt 2025 — Satz und Rechnungsposten gegen die echte Demo-Hotel-Rechnung nachgerechnet', () => {
    const periods = buildLevySchedule('wiener_netze', 6, '2025-01-01', '2025-12-31', null, GEWERBE).periods
    const p = findLevyPeriod(periods, '2025-06-01')
    expect(p).toMatchObject({ elektrizitaetsabgabeCtPerKwh: 1.5, gebrauchsabgabeRate: 0.06 })

    /*
     * Die Gegenprobe am echten Beleg: 2.202.991 kWh Jahresbezug (Entwurf des Demo-Hotel-
     * Zählpunkts, auf ganze kWh gerundet) ergeben mit diesem Satz den Rechnungsposten
     * € 33.044,86 der Wien-Energie-Rechnung. Mit dem 2026er-Satz wären es € 2.202,99 —
     * die Zeile unterscheidet die beiden Jahre also eindeutig.
     */
    const eur = (2_202_991 * p!.elektrizitaetsabgabeCtPerKwh) / 100
    expect(eur).toBeCloseTo(33_044.86, 1)
  })

  it('Elektrizitätsabgabe 2026: 0,10 ct nur für Haushalte, 0,82 ct für Betriebe (ElAbgG § 7 Abs. 16)', () => {
    const at = (context: typeof HEIM | typeof GEWERBE, date: string) =>
      findLevyPeriod(
        buildLevySchedule('wiener_netze', 7, date, date, 'ohne_leistungsmessung', context).periods,
        date,
      )?.elektrizitaetsabgabeCtPerKwh

    expect(at(HEIM, '2026-06-01')).toBe(0.1)
    expect(at(GEWERBE, '2026-06-01')).toBe(0.82)
    // 2025 galt der Regelsatz für beide.
    expect(at(HEIM, '2025-06-01')).toBe(1.5)
    expect(at(GEWERBE, '2025-06-01')).toBe(1.5)
  })

  it('trägt die EX104-Sätze je Netzebene und Messvariante', () => {
    const at = (ne: number, variant: string | null) =>
      findLevyPeriod(
        buildLevySchedule('wiener_netze', ne, '2026-06-01', '2026-06-02', variant, HEIM).periods,
        '2026-06-01',
      )

    // NE 6: Grundpreis ist ein LEISTUNGSpreis, Verbrauchspreis 0,198 + Verlust 0,011.
    expect(at(6, null)).toMatchObject({
      eagFoerderbeitragGrundpreisAmount: 5.252,
      eagFoerderbeitragGrundpreisUnit: 'eur_per_kw_year',
      eagPauschaleEurPerYear: 553.36,
    })
    expect(at(6, null)!.eagFoerderbeitragCtPerKwh).toBeCloseTo(0.209, 10)

    // NE 7 ohne Leistungsmessung — der Fall, den Urbanz und der öffentliche Rechner treffen.
    expect(at(7, 'ohne_leistungsmessung')).toMatchObject({
      eagFoerderbeitragGrundpreisAmount: 3.796,
      eagFoerderbeitragGrundpreisUnit: 'eur_per_year',
      eagPauschaleEurPerYear: 19.02,
    })
    expect(at(7, 'ohne_leistungsmessung')!.eagFoerderbeitragCtPerKwh).toBeCloseTo(0.62, 10)

    // Dieselbe Netzebene, andere Variante, anderer Satz — der Grund für den neuen Parameter.
    expect(at(7, 'mit_leistungsmessung')).toMatchObject({
      eagFoerderbeitragGrundpreisAmount: 5.619,
      eagFoerderbeitragGrundpreisUnit: 'eur_per_kw_year',
    })
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
