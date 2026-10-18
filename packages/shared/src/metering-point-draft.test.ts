import { describe, expect, it } from 'vitest'

import {
  gridProfileContainsPv,
  minBillableKwFallsBackToZero,
  parseNetzebeneDraftValue,
  readDraftFinancialParams,
} from './metering-point-draft'

describe('gridProfileContainsPv — Wahrheitstabelle', () => {
  const existing = { hasPv: true, pvStage: 'existing' }
  const bestand = {
    uploadedLoadProfile: true,
    pvAlreadyInGridProfile: true,
    measuredFeedIn: false,
    hasEstimatedPvSeries: false,
    hasUploadedPvSeries: false,
  }
  /** Was `pvGeneratorEligibility` ohne Bestands-PV bzw. bei Standardprofil liefert: kein Grund. */
  const offered = { ...bestand, pvAlreadyInGridProfile: false }

  it('Bestand ohne Reihe → true', () => {
    expect(gridProfileContainsPv(existing, bestand)).toBe(true)
  })
  it('Bestand mit geschätzter Reihe → false', () => {
    expect(gridProfileContainsPv(existing, { ...bestand, hasEstimatedPvSeries: true })).toBe(false)
  })
  it('Bestand mit hochgeladener gemessener Reihe → false', () => {
    expect(gridProfileContainsPv(existing, { ...bestand, hasUploadedPvSeries: true })).toBe(false)
  })
  it('gemessene Einspeisung → false', () => {
    expect(
      gridProfileContainsPv(existing, { ...bestand, pvAlreadyInGridProfile: false, measuredFeedIn: true }),
    ).toBe(false)
  })
  it('Standardprofil mit Bestand → false', () => {
    expect(gridProfileContainsPv(existing, { ...offered, uploadedLoadProfile: false })).toBe(false)
  })
  it('ohne PV → false', () => {
    expect(gridProfileContainsPv({}, offered)).toBe(false)
  })
  it('geplante PV → false', () => {
    expect(gridProfileContainsPv({ hasPv: true, pvStage: 'planned' }, offered)).toBe(false)
  })
  it('Altentwurf hasPv ohne Stufe gilt als Bestand (DEFAULT_PV_STAGE) → true', () => {
    expect(gridProfileContainsPv({ hasPv: true }, bestand)).toBe(true)
  })
})

/*
 * Die Rückumformung „NE 5" → 5 ist die Brücke zwischen dem Entwurf (Text, Contract-Feld) und der
 * Netzentgelt-Abfrage (`grid_tariffs.netzebene` ist `integer`). Geprüft wird beides: dass der reale
 * Schreibweg ankommt, und dass ein von Hand veränderter `jsonb` keinen Analyse-Lauf mit einem
 * Ausnahmefehler abbricht.
 */
describe('parseNetzebeneDraftValue', () => {
  it('liest die Schreibweisen, die real im Entwurf stehen', () => {
    expect(parseNetzebeneDraftValue('NE 5')).toBe(5)
    expect(parseNetzebeneDraftValue('NE7')).toBe(7)
    expect(parseNetzebeneDraftValue('ne 3')).toBe(3)
    expect(parseNetzebeneDraftValue('  NE 6  ')).toBe(6)
    // Ohne Präfix: so schreibt das Chat-Werkzeug, und so stehen alte Entwürfe da.
    expect(parseNetzebeneDraftValue('4')).toBe(4)
    expect(parseNetzebeneDraftValue(5)).toBe(5)
  })

  it('liefert für unerwartete oder fehlende Werte null und wirft nie', () => {
    for (const raw of [
      undefined,
      null,
      '',
      'NE',
      'NE 2', // ausserhalb des CHECK 3..7 — in der Datenbank nicht auffindbar
      'NE 8',
      'Netzebene 5',
      '5 NE',
      {},
      [],
      Number.NaN,
    ]) {
      expect(() => parseNetzebeneDraftValue(raw)).not.toThrow()
      expect(parseNetzebeneDraftValue(raw)).toBeNull()
    }
  })
})

describe('readDraftFinancialParams — Steuerangaben nur im Gewerbepfad', () => {
  const draft = {
    subsidyPercent: 50,
    taxRatePercent: 23,
    investitionsfreibetragPercent: 20,
    depreciationYears: 10,
  }

  it('Gewerbe liest Förderung und Steuerangaben', () => {
    expect(readDraftFinancialParams(draft, 'gewerbe')).toEqual({
      subsidyPercent: 50,
      taxRatePercent: 23,
      investitionsfreibetragPercent: 20,
      depreciationYears: 10,
    })
  })

  it('Privat und ohne Kategorie: Steuerwerte im Entwurf bleiben unbeachtet', () => {
    expect(readDraftFinancialParams(draft, 'heim')).toEqual({ subsidyPercent: 50 })
    expect(readDraftFinancialParams(draft)).toEqual({ subsidyPercent: 50 })
    expect(readDraftFinancialParams({ taxRatePercent: 23 }, 'heim')).toBeUndefined()
  })
})

describe('readDraftFinancialParams — Programme „€ pro kWh"', () => {
  it('liest die flachen Programmschlüssel lückenlos; ein Prozentwert hat Vorrang', () => {
    const draft = {
      subsidyProgram1Label: 'Wiener Landesförderung',
      subsidyProgram1EurPerKwh: 125,
      subsidyProgram1MaxKwh: 10,
      subsidyProgram1MaxPercent: 30,
      subsidyProgram3EurPerKwh: 100,
      subsidyProgram2MaxKwh: 5,
    }
    expect(readDraftFinancialParams(draft)).toEqual({
      subsidyPrograms: [
        { label: 'Wiener Landesförderung', eurPerKwh: 125, maxKwh: 10, maxPercent: 30 },
        { eurPerKwh: 100 },
      ],
    })
    expect(readDraftFinancialParams({ ...draft, subsidyPercent: 20 })).toEqual({ subsidyPercent: 20 })
  })
})

describe('minBillableKwFallsBackToZero — dieselbe Bedingung wie mapDraftToTariffParams', () => {
  it('true: Leistungspreis 0, ohne Leistungsmessung ohne Leistungspreis, mit Leistungsmessung', () => {
    expect(minBillableKwFallsBackToZero({ leistungspreisEurPerKwYear: 0 })).toBe(true)
    expect(minBillableKwFallsBackToZero({ meteringVariant: 'ohne_leistungsmessung' })).toBe(true)
    expect(
      minBillableKwFallsBackToZero({
        meteringVariant: 'mit_leistungsmessung',
        leistungspreisEurPerKwYear: 50,
      }),
    ).toBe(true)
  })

  it('false: unterbrechbar oder ohne Messvariante bei Leistungspreis > 0', () => {
    expect(
      minBillableKwFallsBackToZero({
        meteringVariant: 'unterbrechbar',
        leistungspreisEurPerKwYear: 50,
      }),
    ).toBe(false)
    expect(minBillableKwFallsBackToZero({ leistungspreisEurPerKwYear: 50 })).toBe(false)
  })

  it('ein vorhandener Wert ändert die Antwort nicht — gefragt ist der Fall „fehlt"', () => {
    expect(
      minBillableKwFallsBackToZero({
        meteringVariant: 'mit_leistungsmessung',
        leistungspreisEurPerKwYear: 50,
        minBillableKw: 30,
      }),
    ).toBe(true)
  })
})
