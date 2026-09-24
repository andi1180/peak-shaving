import { describe, expect, it } from 'vitest'
import { analysisForDisplay, type AnalysisResult, type BatteryRoiEntry } from 'shared'

import {
  batteryNoteTexts,
  needsDynamicTariffHint,
  recommendationRationaleText,
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

  it('Hinweis nur bei Heimspeicher ohne Ersparnis UND ohne angeforderten Börsenpreis-Vergleich', () => {
    const base = { perBattery: [entry()], recommendation: { batteryId: 'x' }, existingBatteryAnalysis: undefined, tariffOptimization: undefined } as unknown as AnalysisResult
    expect(needsDynamicTariffHint(base)).toBe(true)
    expect(needsDynamicTariffHint({ ...base, tariffOptimization: { computable: false } } as unknown as AnalysisResult)).toBe(false)
    expect(needsDynamicTariffHint({ ...base, perBattery: [entry({ totalSavingPerYear: 12 })] })).toBe(false)
    expect(needsDynamicTariffHint({ ...base, perBattery: [entry({ battery: { class: 'commercial' } } as never)] })).toBe(false)
  })
})
