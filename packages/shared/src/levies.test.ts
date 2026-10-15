import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  buildLevySchedule,
  findLevyPeriod,
  levyCoverageEnd,
  levyCoverageStatus,
  levyGapYearBeyondCoverage,
  perKwhComponentsCtPerKwh,
} from './levies'

const HEIM = { category: 'heim', postalCode: null } as const
const GEWERBE = { category: 'gewerbe', postalCode: null } as const

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
    // Salzburg Netz: Gebrauchsabgabe noch nicht erfasst (Phase 2b).
    expect(buildLevySchedule('salzburg_netz', 7, '2026-01-01', '2026-12-31', 'ohne_leistungsmessung', HEIM).periods).toEqual([])
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

  it('Wiener Gebrauchsabgabe nach Standort: Wiener PLZ ja, NÖ-PLZ nein, ohne PLZ angenommen', () => {
    const plan = (postalCode: string | null) =>
      buildLevySchedule('wiener_netze', 7, '2026-06-01', '2026-06-01', 'ohne_leistungsmessung', {
        category: 'gewerbe',
        postalCode,
      })

    const wien = plan('1100')
    expect(findLevyPeriod(wien.periods, '2026-06-01')?.gebrauchsabgabeRate).toBe(0.07)
    expect(wien.locationAssumed).toBeUndefined()

    const ohne = plan(null)
    expect(findLevyPeriod(ohne.periods, '2026-06-01')?.gebrauchsabgabeRate).toBe(0.07)
    expect(ohne.locationAssumed).toBe('vienna')

    // Klosterneuburg: Wiener Netze, aber Niederösterreich — keine Gebrauchsabgabe.
    const noe = plan('3400')
    expect(findLevyPeriod(noe.periods, '2026-06-01')?.gebrauchsabgabeRate).toBe(0)
    expect(noe.locationAssumed).toBeUndefined()
    // Weder Wien noch NÖ: nicht belegt, also kein Zeitraum statt eines geratenen Satzes.
    expect(plan('5020').periods).toEqual([])
  })

  it('Land: AT mit Wiener PLZ bleibt unverändert, DE leitet keine österreichische PLZ-Regel ab', () => {
    const plan = (postalCode: string | null, country?: 'AT' | 'DE') =>
      buildLevySchedule('wiener_netze', 7, '2026-06-01', '2026-06-01', 'ohne_leistungsmessung', {
        category: 'gewerbe',
        postalCode,
        ...(country ? { country } : {}),
      })

    // Positivkontrolle: ausdrückliches AT == bisheriges Verhalten (ohne Land).
    expect(plan('1100', 'AT')).toEqual(plan('1100'))
    expect(findLevyPeriod(plan('1100', 'AT').periods, '2026-06-01')?.gebrauchsabgabeRate).toBe(0.07)
    expect(plan(null, 'AT').locationAssumed).toBe('vienna')

    // Negativfall: DE mit 5-stelliger PLZ — weder Wien noch NÖ, und ohne PLZ wird auch nicht „Wien angenommen".
    for (const dePlan of [plan('10115', 'DE'), plan(null, 'DE')]) {
      expect(findLevyPeriod(dePlan.periods, '2026-06-01')?.gebrauchsabgabeRate).toBe(0)
      expect(dePlan.locationAssumed).toBeUndefined()
    }
  })

  it('Netz NÖ: Gebrauchsabgabe 0 — belegt für 2025 und 2026, der Vergleich wird rechenbar', () => {
    const periods = buildLevySchedule('netz_noe', 7, '2025-01-01', '2026-12-31', 'ohne_leistungsmessung', HEIM).periods
    expect(findLevyPeriod(periods, '2025-06-01')).toMatchObject({ gebrauchsabgabeRate: 0, elektrizitaetsabgabeCtPerKwh: 1.5 })
    expect(findLevyPeriod(periods, '2026-06-01')).toMatchObject({ gebrauchsabgabeRate: 0, elektrizitaetsabgabeCtPerKwh: 0.1 })
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

describe('buildLevySchedule — Abgabenposten je kWh nach Land', () => {
  const DE = { category: 'gewerbe', postalCode: '10115', country: 'DE' } as const
  const AT_FIELDS_ZERO = {
    elektrizitaetsabgabeCtPerKwh: 0,
    eagFoerderbeitragCtPerKwh: 0,
    eagFoerderbeitragGrundpreisAmount: 0,
    eagPauschaleEurPerYear: 0,
    gebrauchsabgabeRate: 0,
  }

  it('DE über den Jahreswechsel: zwei Zeiträume mit 4,811 bzw. 5,106 ct/kWh, alle AT-Felder 0', () => {
    // Netzbetreiber/Netzebene/Variante mit österreichischen Sätzen: der DE-Plan darf sie nicht lesen.
    const plan = buildLevySchedule('wiener_netze', 7, '2025-12-15', '2026-01-15', 'ohne_leistungsmessung', DE)

    expect(plan.locationAssumed).toBeUndefined()
    expect(plan.periods.map((p) => [p.validFrom, p.validUntil])).toEqual([
      ['2025-01-01', '2025-12-31'],
      ['2026-01-01', '2026-12-31'],
    ])
    expect(perKwhComponentsCtPerKwh(findLevyPeriod(plan.periods, '2025-12-31')!.perKwhComponents!)).toBeCloseTo(4.811, 10)
    expect(perKwhComponentsCtPerKwh(findLevyPeriod(plan.periods, '2026-01-01')!.perKwhComponents!)).toBeCloseTo(5.106, 10)
    for (const period of plan.periods) {
      expect(period).toMatchObject(AT_FIELDS_ZERO)
      expect(period.perKwhComponents!.map((c) => c.key)).toEqual([
        'de_stromsteuer',
        'de_kwkg',
        'de_par19',
        'de_offshore',
        'de_konzession',
      ])
    }
  })

  it('Leck-Schutz: AT trägt nie perKwhComponents, ein unbekanntes Land bekommt keinen Plan', () => {
    for (const country of [undefined, 'AT'] as const) {
      const plan = buildLevySchedule('wiener_netze', 7, '2025-01-01', '2026-12-31', 'mit_leistungsmessung', {
        ...GEWERBE,
        country,
      })
      expect(plan.periods.length).toBeGreaterThan(0)
      for (const period of plan.periods) expect('perKwhComponents' in period).toBe(false)
    }
    const unknown = buildLevySchedule('wiener_netze', 7, '2026-01-01', '2026-12-31', 'mit_leistungsmessung', {
      ...GEWERBE,
      country: 'CH' as unknown as 'AT',
    })
    expect(unknown.periods).toEqual([])
  })

  it('nach dem letzten belegten Satz entsteht wie bei AT kein Zeitraum (Verweigerung)', () => {
    const at = buildLevySchedule('wiener_netze', 7, '2027-01-01', '2027-06-30', 'ohne_leistungsmessung', HEIM)
    const de = buildLevySchedule('wiener_netze', 7, '2027-01-01', '2027-06-30', 'ohne_leistungsmessung', DE)
    expect(at.periods).toEqual([])
    expect(de.periods).toEqual([])
    const spanning = buildLevySchedule('x', 7, '2026-06-01', '2027-03-31', null, DE)
    expect(findLevyPeriod(spanning.periods, '2026-12-31')).not.toBeNull()
    expect(findLevyPeriod(spanning.periods, '2027-01-01')).toBeNull()
  })
})

describe('levyCoverageEnd / levyCoverageStatus — Abdeckung der Abgabensätze je Land', () => {
  it('AT und DE reichen heute bis 2026-12-31, ein unbekanntes Land hat keine Abdeckung', () => {
    expect(levyCoverageEnd('AT')).toBe('2026-12-31')
    expect(levyCoverageEnd('DE')).toBe('2026-12-31')
    expect(levyCoverageEnd('CH')).toBeNull()
  })

  it('Positivkontrolle: eine im Test verkürzte DE-Tabelle (nur 2025) endet am 2025-12-31', () => {
    const only2025 = [
      { validFrom: '2025-01-01', validUntil: '2025-12-31', components: [{ key: 'x', label: 'x', ctPerKwh: 1 }] },
    ]
    expect(levyCoverageEnd('DE', { germanTable: only2025 })).toBe('2025-12-31')
    expect(levyCoverageStatus(['DE'], '2025-12-01', { germanTable: only2025 })[0]!.status).toBe('warn')
  })

  it('Status: ok bis 30.11., warn ab 01.12., expired ab 01.01.; Land ohne Tabelle sofort expired', () => {
    const at = (today: string) => levyCoverageStatus(['AT', 'DE'], today).map((s) => s.status)
    expect(at('2026-11-30')).toEqual(['ok', 'ok'])
    expect(at('2026-12-01')).toEqual(['warn', 'warn'])
    expect(at('2027-01-01')).toEqual(['expired', 'expired'])
    expect(levyCoverageStatus(['CH'], '2026-06-01')).toEqual([
      { country: 'CH', coverageEnd: null, status: 'expired' },
    ])
  })

  it('erkennt eine Lücke hinter der Abdeckung am Ortsdatum, nicht an UTC', () => {
    // 31.12.2026 23:00 UTC ist in Wien bereits der 01.01.2027.
    expect(levyGapYearBeyondCoverage([{ fromIso: '2026-12-31T23:00:00Z' }], 'AT')).toBe(2027)
    expect(levyGapYearBeyondCoverage([{ fromIso: '2026-12-31T22:45:00Z' }], 'AT')).toBeNull()
  })
})
