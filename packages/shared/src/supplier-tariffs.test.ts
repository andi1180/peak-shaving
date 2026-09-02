import { describe, expect, it } from 'vitest'

import { AWATTAR_BASE_FEE } from './supplier-tariffs'
import { SPOT_PRICE_ANCHOR_DATE } from './analysis-window'
import { tariffParamsSchema } from './tariff'

/**
 * Delta 19 — die Grundgebühren-Konstante und das neue Tarif-Feld.
 *
 * Was hier geprüft wird, sind keine Rechenwege, sondern ZUSAGEN über eine Zahl, die im Report
 * ungeprüft neben den Kosten des Kunden steht: dass sie netto ist, dass sie für jeden auswertbaren
 * Zeitraum gilt, und dass eine fehlende Angabe des Kunden nicht heimlich zu einer Schätzung wird.
 */
describe('Delta 19 — aWATTar-Grundgebühr', () => {
  it('ist netto, und die Umrechnung trifft die brutto ausgewiesenen 5,75 €', () => {
    /*
     * Der eigentliche Wert der Prüfung: Netz- und Börsenpreise sind netto (Delta 6), und eine
     * versehentlich brutto eingetragene Gebühr wäre um 20 % zu hoch — plausibel genug, um
     * niemandem aufzufallen. Die Gegenprobe ist die öffentlich genannte Bruttozahl.
     */
    expect(AWATTAR_BASE_FEE.priceBasis).toBe('net')
    expect(AWATTAR_BASE_FEE.eurPerMonth * 1.2).toBeCloseTo(5.75, 2)
  })

  it('gilt ab spätestens dem frühesten auswertbaren Tag (Delta 15 Regel B)', () => {
    /*
     * Läge `validFrom` nach dem Anker, gäbe es Analysezeiträume, für die gar kein Satz gilt — und
     * der Rechner müsste dort entweder schweigen oder etwas erfinden. Die Konstante trägt die
     * Annahme sichtbar (s. Kopf der Datei); dieser Test hält sie an den Anker gebunden.
     */
    expect(AWATTAR_BASE_FEE.validFrom <= SPOT_PRICE_ANCHOR_DATE).toBe(true)
  })

  it('nennt ihre Quelle — eine Zahl ohne Fundstelle ist im Zweifel geraten', () => {
    expect(AWATTAR_BASE_FEE.sourceNote.length).toBeGreaterThan(40)
    expect(AWATTAR_BASE_FEE.supplier).toBe('aWATTar')
  })
})

describe('Delta 19 — supplierBaseFeeEurPerMonth im TariffParams', () => {
  const base = {
    leistungspreisEurPerKwYear: 0,
    billingModel: 'annual_max' as const,
    minBillableKw: 0,
    energyPriceCtPerKwh: 25,
    einspeiseverguetungCtPerKwh: 8,
  }

  it('ist optional — ein Tarif ohne Angabe bleibt gültig (rückwärtskompatibel)', () => {
    const parsed = tariffParamsSchema.safeParse(base)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.supplierBaseFeeEurPerMonth).toBeUndefined()
  })

  it('nimmt 0 als echte Angabe an und weist negative Beträge ab', () => {
    // 0 ist eine gültige Aussage („keine Grundgebühr"), nicht ein fehlender Wert.
    expect(tariffParamsSchema.safeParse({ ...base, supplierBaseFeeEurPerMonth: 0 }).success).toBe(
      true,
    )
    expect(tariffParamsSchema.safeParse({ ...base, supplierBaseFeeEurPerMonth: 3.5 }).success).toBe(
      true,
    )
    expect(tariffParamsSchema.safeParse({ ...base, supplierBaseFeeEurPerMonth: -1 }).success).toBe(
      false,
    )
  })
})
