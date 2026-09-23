import { describe, expect, it } from 'vitest'
import type { LoadProfile } from 'shared'

import { buildLoadMetrics, loadFactorPercent, totalGridImportKwh } from './load'
import type { PdfReportAnalysis } from './types'

/**
 * Der Kennzahlenblock unter dem Lastgang-Diagramm.
 *
 * ⚠ Die Erwartungen sind VON HAND gerechnet und nicht aus einem Lauf übernommen — sonst prüfte der
 * Test, dass die Funktion tut, was sie tut.
 */

/**
 * Ein Tag, 96 Viertelstunden: 95 × 10 kW und EIN Ausschlag auf 40 kW.
 *
 * Von Hand: 95 × 10 × 0,25 = 237,5 kWh, dazu 40 × 0,25 = 10 kWh ⇒ 247,5 kWh.
 * Ø Leistung = 247,5 / (1 × 24) = 10,3125 kW.
 * Lastfaktor = 10,3125 / 40 = 0,2578125 ⇒ 25,78125 %.
 */
function tagesprofil(): LoadProfile {
  const readings = Array.from({ length: 96 }, (_, i) => ({
    ts: new Date(Date.UTC(2025, 2, 17, 0, i * 15)).toISOString(),
    gridPowerKw: i === 40 ? 40 : 10,
  }))
  return { readings, intervalMinutes: 15, timezoneMeta: 'Europe/Vienna', source: 'net_signed' }
}

function analysisFor(coveredDays: number, peakKw: number): PdfReportAnalysis {
  return {
    current: {
      annualPeakKw: peakKw,
      monthlyPeaksKw: Array.from({ length: 12 }, () => peakKw),
      billedKw: peakKw,
      leistungspreisCostPerYear: 0,
    },
    perBattery: [],
    recommendation: { batteryId: 'keiner', rationale: 'leerer Katalog' },
    assumptions: {
      roundTripEfficiency: 0.9,
      horizonYears: 10,
      energyPriceCtPerKwh: 24.5,
      einspeiseverguetungCtPerKwh: 7.2,
      billingModel: 'monthly_max_sum',
    },
    dataQuality: {
      coveredDays,
      coveredMonths: 1,
      gapsInterpolated: 0,
      largestGapSlots: 0,
      warnings: [],
    },
  }
}

describe('Lastgang-Kennzahlen', () => {
  it('rechnet Gesamtverbrauch, Tagesschnitt und Lastfaktor auf die Handrechnung', () => {
    expect(totalGridImportKwh(tagesprofil())).toBeCloseTo(247.5, 6)
    expect(loadFactorPercent(247.5, 1, 40)).toBeCloseTo(25.78125, 6)

    const block = buildLoadMetrics(tagesprofil(), analysisFor(1, 40))
    expect(block?.rows.map((r) => r.value)).toEqual(['248 kWh', '248 kWh / Tag', '25,8 %'])
    /* Die Spitze stammt aus `current.annualPeakKw` — dieselbe Zahl wie auf der Voraussetzungs-Seite. */
    expect(block?.rows[2]!.hint).toContain('40 kW')
    /* Nur die Definition, keine Einordnung dieses Kunden. */
    expect(block?.body).toContain('Ein niedriger Wert steht für einen spitzigen Verlauf')
  })

  it('zählt nur den Bezug und lässt den Lastfaktor ohne Spitze weg', () => {
    const mitEinspeisung: LoadProfile = {
      ...tagesprofil(),
      readings: [
        { ts: '2025-03-17T00:00:00.000Z', gridPowerKw: 8 },
        { ts: '2025-03-17T00:15:00.000Z', gridPowerKw: -12 },
      ],
    }
    /* 8 × 0,25 = 2 kWh — die Einspeisung wird NICHT gegengerechnet. */
    expect(totalGridImportKwh(mitEinspeisung)).toBeCloseTo(2, 6)

    expect(loadFactorPercent(247.5, 1, 0)).toBeNull()
    expect(buildLoadMetrics(tagesprofil(), analysisFor(1, 0))?.rows).toHaveLength(2)
    expect(buildLoadMetrics(tagesprofil(), analysisFor(0, 40))).toBeNull()
  })
})
