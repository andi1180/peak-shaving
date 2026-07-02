import { describe, expect, it } from 'vitest'
import {
  batteryCandidateSchema,
  financialParamsSchema,
  loadProfileSchema,
  simulationConfigSchema,
  tariffParamsSchema,
} from './index'

// Boundary-Schemata: valide Eingabe parst, invalide wird abgelehnt (§3.1).

describe('loadProfileSchema', () => {
  const valid = {
    readings: [
      { ts: '2025-01-01T00:00:00Z', gridPowerKw: 42 },
      { ts: '2025-01-01T00:15:00Z', gridPowerKw: -5 }, // Einspeisung: negativ erlaubt
    ],
    intervalMinutes: 15,
    timezoneMeta: 'Europe/Vienna',
    source: 'net_signed',
  }

  it('akzeptiert einen validen Lastgang inkl. negativer (Einspeise-)Werte', () => {
    expect(loadProfileSchema.parse(valid)).toEqual(valid)
  })

  it('lehnt intervalMinutes ≠ 15 ab', () => {
    expect(loadProfileSchema.safeParse({ ...valid, intervalMinutes: 30 }).success).toBe(false)
  })

  it('lehnt eine unbekannte source ab', () => {
    expect(loadProfileSchema.safeParse({ ...valid, source: 'guessed' }).success).toBe(false)
  })

  it('lehnt einen nicht-ISO-Zeitstempel ab', () => {
    const bad = { ...valid, readings: [{ ts: '01.01.2025 00:00', gridPowerKw: 1 }] }
    expect(loadProfileSchema.safeParse(bad).success).toBe(false)
  })

  it('lehnt ein fehlendes Pflichtfeld (source) ab', () => {
    const { source: _omit, ...withoutSource } = valid
    expect(loadProfileSchema.safeParse(withoutSource).success).toBe(false)
  })
})

describe('batteryCandidateSchema', () => {
  const valid = {
    id: 'b1',
    name: 'Demo 10',
    manufacturer: 'Acme',
    class: 'commercial',
    usableCapacityKwh: 10,
    maxPowerKw: 5,
    roundTripEfficiency: 0.88,
    pricePerKwh: 250,
    inverterIncluded: true,
    requiresFoundation: true,
    controlType: 'dynamic',
  }

  it('akzeptiert einen validen Kandidaten (optionale Kostenfelder weglassbar)', () => {
    expect(batteryCandidateSchema.parse(valid)).toMatchObject({ id: 'b1' })
  })

  it('lehnt negative Kapazität ab', () => {
    expect(batteryCandidateSchema.safeParse({ ...valid, usableCapacityKwh: -1 }).success).toBe(
      false,
    )
  })

  it('lehnt einen Wirkungsgrad > 1 ab', () => {
    expect(batteryCandidateSchema.safeParse({ ...valid, roundTripEfficiency: 1.2 }).success).toBe(
      false,
    )
  })

  it('lehnt eine unbekannte class ab', () => {
    expect(batteryCandidateSchema.safeParse({ ...valid, class: 'industrial' }).success).toBe(false)
  })
})

describe('tariffParamsSchema', () => {
  const valid = {
    leistungspreisEurPerKwYear: 90,
    billingModel: 'monthly_max_average',
    minBillableKw: 30,
    energyPriceCtPerKwh: 25,
    einspeiseverguetungCtPerKwh: 8,
  }

  it('akzeptiert die Pflichtfelder ohne die optionalen', () => {
    expect(tariffParamsSchema.parse(valid)).toMatchObject({ billingModel: 'monthly_max_average' })
  })

  it('lehnt ein unbekanntes billingModel ab', () => {
    expect(tariffParamsSchema.safeParse({ ...valid, billingModel: 'annual_avg' }).success).toBe(
      false,
    )
  })

  it('lehnt ein fehlendes Pflichtfeld (leistungspreisEurPerKwYear) ab', () => {
    const { leistungspreisEurPerKwYear: _omit, ...rest } = valid
    expect(tariffParamsSchema.safeParse(rest).success).toBe(false)
  })
})

describe('financialParamsSchema', () => {
  // Konvention: Prozent 0–100, NICHT Anteil 0–1. Der Upper-Bound fängt den
  // Faktor-100-Fehler (0,3 → 30 statt 300) an der Boundary ab.
  it('akzeptiert einen Prozentwert wie 30', () => {
    expect(financialParamsSchema.parse({ subsidyPercent: 30 })).toEqual({ subsidyPercent: 30 })
  })

  it('akzeptiert die Ränder 0 und 100', () => {
    expect(financialParamsSchema.safeParse({ subsidyPercent: 0 }).success).toBe(true)
    expect(financialParamsSchema.safeParse({ subsidyPercent: 100 }).success).toBe(true)
  })

  it('lehnt einen Faktor-100-Fehler (300) ab', () => {
    expect(financialParamsSchema.safeParse({ subsidyPercent: 300 }).success).toBe(false)
  })

  it('erzwingt die 0–100-Grenze auf allen *Percent-Feldern', () => {
    expect(financialParamsSchema.safeParse({ taxRatePercent: 300 }).success).toBe(false)
    expect(financialParamsSchema.safeParse({ investitionsfreibetragPercent: 300 }).success).toBe(
      false,
    )
    expect(financialParamsSchema.safeParse({ taxRatePercent: 30 }).success).toBe(true)
  })
})

describe('simulationConfigSchema', () => {
  it('akzeptiert dispatchPriority "peak_first"', () => {
    expect(
      simulationConfigSchema.parse({ horizonYears: 10, dispatchPriority: 'peak_first' }),
    ).toMatchObject({ horizonYears: 10 })
  })

  it('lehnt eine andere dispatchPriority ab ([v2] co_optimized noch nicht erlaubt)', () => {
    expect(
      simulationConfigSchema.safeParse({ horizonYears: 10, dispatchPriority: 'co_optimized' })
        .success,
    ).toBe(false)
  })
})
