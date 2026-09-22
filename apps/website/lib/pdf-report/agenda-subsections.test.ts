import { describe, expect, it } from 'vitest'
import type { LoadProfile } from 'shared'

import { basisSubsections, buildBasisChapter } from './basis'
import {
  ADVICE_SECTION,
  BASIS_SECTION,
  buildReportAgenda,
  DETAIL_SECTION,
  METHODOLOGY_ITEMS,
  METHODOLOGY_SECTION,
  SECTION_ID,
  type ReportSection,
} from './content'
import type { PdfReportAnalysis, PdfReportInput } from './types'

/**
 * Die eingerückten Agenda-Einträge — und die Zusage, dass sie aus DERSELBEN Liste kommen, aus der
 * das jeweilige Kapitel rendert.
 */

const ANALYSIS: PdfReportAnalysis = {
  current: {
    annualPeakKw: 48,
    monthlyPeaksKw: [48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48],
    billedKw: 48,
    leistungspreisCostPerYear: 3980.16,
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
    coveredDays: 365,
    coveredMonths: 12,
    gapsInterpolated: 0,
    largestGapSlots: 0,
    warnings: [],
  },
}

const LOAD_PROFILE: LoadProfile = {
  readings: [{ ts: '2025-03-17T00:00:00.000Z', gridPowerKw: 9 }],
  intervalMinutes: 15,
  timezoneMeta: 'Europe/Vienna',
  source: 'net_signed',
}

function basisFor(extra: Partial<PdfReportInput> = {}) {
  const input: PdfReportInput = {
    title: 'Wirtschaftlichkeitsanalyse Batteriespeicher',
    subtitle: 'Auf Basis Ihres Viertelstunden-Lastgangs',
    period: '17.03.2025 – 17.03.2025',
    printedAt: '22.09.2026',
    analysis: ANALYSIS,
    loadProfile: LOAD_PROFILE,
    tariffSource: null,
    tariffVintage: null,
    ...extra,
  }
  return buildBasisChapter(input)
}

const PRESENCE = {
  ways: false,
  waysCount: 0,
  annualScenario: false,
  pvValue: false,
  recommendation: true,
  monthly: false,
  insight: false,
  comparison: false,
  advice: true,
}

describe('Agenda — Reihenfolge und Unterpunkte', () => {
  it('„Unser Vorschlag" steht vor „Methodik & Vorbehalte"', () => {
    const titles = buildReportAgenda(PRESENCE).map((s) => s.title)

    expect(titles.indexOf(ADVICE_SECTION.title)).toBeLessThan(
      titles.indexOf(METHODOLOGY_SECTION.title),
    )
    /* Das Schlusskapitel bleibt das Schlusskapitel. */
    expect(titles.indexOf(BASIS_SECTION.title)).toBe(titles.length - 1)
  })

  it('beide Kapitel mit Unterabschnitten tragen sie eingerückt — der PV-Befund nur, wenn es ihn gibt', () => {
    const ohnePv = basisSubsections(basisFor())
    const mitPv = basisSubsections(
      basisFor({ hasPv: true, pvOutageMonths: [{ year: 2025, month: 7 }] }),
    )

    /* Der eine bedingte Unterpunkt — und sonst dieselbe Liste. */
    const pvTitel = 'Ein Monat ohne erkennbaren PV-Beitrag'
    expect(mitPv.map((s) => s.title)).toContain(pvTitel)
    expect(ohnePv.map((s) => s.title)).not.toContain(pvTitel)
    expect(ohnePv.map((s) => s.title)).toEqual([
      'Annahmen & Rechenweise — Stand dieser Berechnung',
      'Tarifsätze',
      'Tarifkomponenten',
      'Datenquellen',
      /* ⚠ „Berechnungsmethodik je Kennzahl" fehlt hier zu Recht: dieser Minimalfall erreicht
         keinen einzigen Methodik-Absatz, und dann steht im Kapitel auch keine Überschrift. Genau
         die Kopplung, um die es geht — der Unterpunkt hängt an der Liste, nicht an einer zweiten
         Bedingung daneben. */
      'Bekannte Einschränkungen',
    ])

    const sections = buildReportAgenda(PRESENCE, {
      [SECTION_ID.methodology]: METHODOLOGY_ITEMS,
      [SECTION_ID.basis]: ohnePv,
    })
    const titles = sections.map((s) => s.title)

    /* Die Unterpunkte stehen unmittelbar hinter IHREM Kapitel und tragen Stufe 2 (= keine
       Seitenzahl, s. `sectionHasPageNumber`). */
    expect(titles.indexOf(METHODOLOGY_ITEMS[0].title)).toBe(
      titles.indexOf(METHODOLOGY_SECTION.title) + 1,
    )
    expect(titles.indexOf(ohnePv[0].title)).toBe(titles.indexOf(BASIS_SECTION.title) + 1)
    expect(sections.filter((s) => s.level === 2)).toHaveLength(
      METHODOLOGY_ITEMS.length + ohnePv.length,
    )
  })

  /*
   * Der eigentliche Prüfgegenstand von Teil 3: dass ein DRITTES Kapitel mit Unterabschnitten keine
   * Zeile in `buildReportAgenda` kostet. Nachgestellt an einem Kapitel, das heute keine hat.
   */
  it('ein weiteres Kapitel mit Unterabschnitten greift ohne Änderung am Agenda-Code', () => {
    const erfunden: readonly ReportSection[] = [
      { id: 'erfunden-a', title: 'Erster Unterabschnitt', level: 2 },
      { id: 'erfunden-b', title: 'Zweiter Unterabschnitt', level: 2 },
    ]

    const titles = buildReportAgenda(PRESENCE, { [SECTION_ID.detail]: erfunden }).map(
      (s) => s.title,
    )

    expect(titles.indexOf('Erster Unterabschnitt')).toBe(titles.indexOf(DETAIL_SECTION.title) + 1)
    expect(titles.indexOf('Zweiter Unterabschnitt')).toBe(titles.indexOf(DETAIL_SECTION.title) + 2)
  })
})
