import { describe, expect, it } from 'vitest'
import { analysisForDisplay, type AnalysisResult, type BatteryRoiEntry } from 'shared'

import {
  batteryNoteTexts,
  dynamicTariffHintKind,
  levyNamesOf,
  levySideLabel,
  recommendationRationaleText,
  displayedInvestmentOf,
} from './report-copy'

// `Intl` setzt geschützte Leerzeichen.
const plain = (s: string) => s.replace(/\u00a0|\u202f/g, ' ')

const entry = (over: Partial<BatteryRoiEntry> = {}) =>
  ({
    battery: { class: 'residential' },
    totalSavingPerYear: 0,
    warnings: ['statisch gesteuert'],
    notices: [{ code: 'separate_inverter', extraInverterCost: 1172 }],
    ...over,
  }) as unknown as BatteryRoiEntry

describe('Engine-Gründe als Satz in der Anzeigebasis', () => {
  it('heim brutto, gewerbe netto — dieselbe Umrechnung wie die Zahlen daneben', () => {
    const result = {
      perBattery: [entry()],
      recommendation: {
        batteryId: 'x',
        rationale: { code: 'best_net_saving', totalSavingPerYear: 0, amortizationYears: Infinity, netSavingOverHorizon: -3253, horizonYears: 10 },
      },
    } as unknown as AnalysisResult
    const gross = analysisForDisplay(result, 'gross')
    expect(batteryNoteTexts(result.perBattery[0]!).map(plain)).toEqual(['statisch gesteuert', 'Separater Wechselrichter nötig (+€ 1.172).'])
    expect(plain(batteryNoteTexts(gross.perBattery[0]!)[1]!)).toBe('Separater Wechselrichter nötig (+€ 1.406).')
    expect(plain(recommendationRationaleText('BYD', gross.recommendation!.rationale))).toBe(
      'BYD spart voraussichtlich € 0 pro Jahr und amortisiert sich innerhalb des Betrachtungszeitraums nicht — Netto-Ersparnis über 10 Jahre: -€ 3.904.',
    )
  })

  it('Hinweis bei Heimspeicher ohne Ersparnis, wenn der Börsenpreis-Vergleich fehlt oder nicht berechenbar ist', () => {
    const base = { perBattery: [entry()], recommendation: { batteryId: 'x' }, existingBatteryAnalysis: undefined, tariffOptimization: undefined } as unknown as AnalysisResult
    expect(dynamicTariffHintKind(base)).toBe('not_requested')
    expect(dynamicTariffHintKind({ ...base, tariffOptimization: { computable: false } } as unknown as AnalysisResult)).toBe('not_computable')
    expect(dynamicTariffHintKind({ ...base, tariffOptimization: { computable: true } } as unknown as AnalysisResult)).toBeNull()
    expect(dynamicTariffHintKind({ ...base, perBattery: [entry({ totalSavingPerYear: 12 })] })).toBeNull()
    expect(dynamicTariffHintKind({ ...base, perBattery: [entry({ battery: { class: 'commercial' } } as never)] })).toBeNull()
  })
})

describe('displayedInvestmentOf — angezeigte Investition − Förderung = Nettoinvestition, auf den Euro', () => {
  it('rundet die Nettoinvestition als Differenz, nicht für sich (7.691 − 3.846 = 3.845)', () => {
    const shown = displayedInvestmentOf({ totalInvestment: 7691.4, subsidyAmount: 3845.7 })
    expect(shown).toMatchObject({ investmentEur: 7691, subsidyEur: 3846, netEur: 3845, capEur: 0 })
    expect(shown.lines).toEqual([{ label: 'Förderung (von Ihnen eingetragen)', amountEur: 3846 }])
  })

  it('je Programm eine Zeile mit Parametern; über der Investition eine Kürzungszeile, Netto 0', () => {
    const shown = displayedInvestmentOf(
      { totalInvestment: 1000, subsidyAmount: 1000, subsidyProgramAmounts: [1200, 1200] },
      [
        { label: 'Wiener Landesförderung', eurPerKwh: 150, maxKwh: 10, maxPercent: 30 },
        { label: null, eurPerKwh: 150, maxKwh: null, maxPercent: null },
      ],
    )
    expect(shown.lines.map((l) => l.label)).toEqual([
      'Wiener Landesförderung (150 €/kWh, max. 10 kWh, max. 30 %)',
      'Förderprogramm 2 (150 €/kWh)',
    ])
    expect(shown).toMatchObject({ capEur: 1400, subsidyEur: 1000, netEur: 0 })
  })
})

describe('levyNamesOf — Abgaben-Namen aus dem Ergebnis', () => {
  const DE_COMPONENTS = [
    { key: 'de_stromsteuer', label: 'Stromsteuer' },
    { key: 'de_kwkg', label: 'KWKG-Aufschlag' },
    { key: 'de_par19', label: 'Aufschlag für besondere Netznutzung (§ 19 StromNEV)' },
    { key: 'de_offshore', label: 'Offshore-Netzumlage' },
    { key: 'de_konzession', label: 'Konzessionsabgabe (Sondervertrag)' },
  ]

  it('Feld fehlt oder ist leer → kein Name, die Seite behält den bisherigen Wortlaut', () => {
    expect(levyNamesOf({})).toBeNull()
    expect(levyNamesOf({ levyComponents: [] })).toBeNull()
    expect(levyNamesOf(undefined)).toBeNull()
    expect(levySideLabel(levyNamesOf({}))).toBe(
      'gesetzliche Abgaben (Elektrizitätsabgabe, EAG, Gebrauchsabgabe)',
    )
  })

  it('DE-Posten → Aufzählung mit Stromsteuer, ohne österreichische Namen', () => {
    const names = levyNamesOf({ levyComponents: DE_COMPONENTS })!
    expect(names.plural).toBe(true)
    expect(names.text).toBe(
      'Stromsteuer, KWKG-Aufschlag, Aufschlag für besondere Netznutzung (§ 19 StromNEV), ' +
        'Offshore-Netzumlage und Konzessionsabgabe (Sondervertrag)',
    )
    expect(levySideLabel(names)).not.toMatch(/Elektrizitätsabgabe|EAG|Gebrauchsabgabe/)
    expect(levyNamesOf({ levyComponents: DE_COMPONENTS.slice(0, 1) })).toEqual({
      text: 'Stromsteuer',
      plural: false,
    })
  })

  it('nennt keine Beträge oder Sätze', () => {
    // Gesetzesverweise („§ 19") sind Teil des Namens, keine Zahl zum Posten.
    const text = levyNamesOf({ levyComponents: DE_COMPONENTS })!.text.replace(/§ \d+/g, '')
    expect(text).not.toMatch(/\d|€|\bct\b/)
  })
})
