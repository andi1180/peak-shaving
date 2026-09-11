import { describe, expect, it } from 'vitest'

import { setDraftField } from '@/lib/project-chat/draft'
import { formatKwh } from './format'
import {
  ANNUAL_CONSUMPTION_KWH_KEY,
  HOUSEHOLD_BASE_KWH,
  HOUSEHOLD_PER_ADDITIONAL_PERSON_KWH,
  MAX_HOUSEHOLD_PERSONS,
  MAX_STANDARD_PROFILE_ANNUAL_KWH,
  customerClassForSegment,
  estimateHouseholdConsumptionKwh,
  hasStandardProfileCurve,
  householdEstimateNote,
  parseAnnualConsumptionKwh,
  readStandardProfileConsumption,
} from './standard-profile'

/**
 * B24, Teil 1 — die reine Logik des Standardprofil-Zweigs.
 *
 * Was hier geprüft wird, ist ausschliesslich das, was OHNE Datenbank und ohne Browser entscheidbar
 * ist: die Schätzformel, ihre Grenzen, die Auslegung einer Formulareingabe und die Zuordnung
 * Segment → Kurve. Das Erzeugen selbst prüft `packages/engine`, das Zusammenspiel mit der Datenbank
 * das DB-Gate.
 */

describe('estimateHouseholdConsumptionKwh — die Formel, nicht „irgendeine Zahl"', () => {
  it('rechnet Grundbedarf + je weiterer Person', () => {
    // Ausgeschrieben statt aus den Konstanten gerechnet: ein Test, der dieselbe Formel benutzt wie
    // der Code, prüft nur, dass sie sich selbst gleicht.
    expect(estimateHouseholdConsumptionKwh(1)).toBe(2_000)
    expect(estimateHouseholdConsumptionKwh(2)).toBe(3_000)
    expect(estimateHouseholdConsumptionKwh(4)).toBe(5_000)
  })

  it('die Konstanten sind die, die im Text stehen', () => {
    // Sie erscheinen in der Begründung der Schätzung (`householdEstimateNote`) — laufen Zahl und
    // Text auseinander, behauptet der Vermerk eine andere Rechnung als die ausgewiesene.
    expect(HOUSEHOLD_BASE_KWH).toBe(2_000)
    expect(HOUSEHOLD_PER_ADDITIONAL_PERSON_KWH).toBe(1_000)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_HOUSEHOLD_PERSONS + 1])(
    '%p ist keine brauchbare Personenzahl → null, KEINE Ersatzzahl',
    (persons) => {
      expect(estimateHouseholdConsumptionKwh(persons)).toBeNull()
    },
  )

  it('die Obergrenze selbst ist noch gültig — eine Grenze, die ihren eigenen Wert ausschliesst, ist eine andere', () => {
    expect(estimateHouseholdConsumptionKwh(MAX_HOUSEHOLD_PERSONS)).toBe(16_000)
  })
})

describe('householdEstimateNote — die Begründung nennt Formel UND Eingabe', () => {
  it('bei einer Person steht kein Summand da, den es nicht gibt', () => {
    const note = householdEstimateNote(1)
    expect(note).toContain('1 Person')
    expect(note).not.toContain('Personen')
    expect(note).toContain(formatKwh(HOUSEHOLD_BASE_KWH))
    expect(note).not.toContain('×')
  })

  it('ab zwei Personen steht die Rechnung ausgeschrieben da', () => {
    const note = householdEstimateNote(4)
    expect(note).toContain('4 Personen')
    expect(note).toContain(
      `${formatKwh(HOUSEHOLD_BASE_KWH)} + 3 × ${formatKwh(HOUSEHOLD_PER_ADDITIONAL_PERSON_KWH)}`,
    )
  })

  it('kennzeichnet sich als Richtwert, nicht als Ablesung', () => {
    // ⚠ Der Satz landet unverändert im Herkunftsvermerk des Entwurfs und von dort in jede spätere
    // Anzeige. Fiele er weg, sähe die Schätzung dort aus wie eine abgelesene Zahl.
    expect(householdEstimateNote(3)).toContain('keine Ablesung von einer Rechnung')
  })
})

describe('parseAnnualConsumptionKwh — drei Ablehnungsgründe, drei Auskünfte', () => {
  it.each(['', '   ', '\n'])('leer (%p) → missing', (raw) => {
    expect(parseAnnualConsumptionKwh(raw)).toEqual({ ok: false, reason: 'missing' })
  })

  it.each(['0', '-5', 'viertausend', '1.2.3'])('unbrauchbar (%p) → invalid', (raw) => {
    expect(parseAnnualConsumptionKwh(raw)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('über der Obergrenze → too_large, mit eigener Auskunft statt „ungültig"', () => {
    expect(parseAnnualConsumptionKwh(String(MAX_STANDARD_PROFILE_ANNUAL_KWH + 1))).toEqual({
      ok: false,
      reason: 'too_large',
    })
  })

  it('die Obergrenze selbst läuft durch', () => {
    expect(parseAnnualConsumptionKwh(String(MAX_STANDARD_PROFILE_ANNUAL_KWH))).toEqual({
      ok: true,
      value: MAX_STANDARD_PROFILE_ANNUAL_KWH,
    })
  })

  it('⚠ das deutsche Dezimalkomma ist der Regelfall, nicht die Ausnahme', () => {
    // Auf einem österreichischen Formular abgelehnt hiesse, eine korrekte Eingabe als Fehler
    // auszuweisen.
    expect(parseAnnualConsumptionKwh('4237,5')).toEqual({ ok: true, value: 4_237.5 })
    expect(parseAnnualConsumptionKwh('4237.5')).toEqual({ ok: true, value: 4_237.5 })
  })

  it('Leerzeichen ringsum stören nicht', () => {
    expect(parseAnnualConsumptionKwh('  3650  ')).toEqual({ ok: true, value: 3_650 })
  })
})

describe('customerClassForSegment — null heisst NICHT „privat"', () => {
  it('bildet die zwei bekannten Segmente ab', () => {
    expect(customerClassForSegment('privat')).toBe('privat')
    expect(customerClassForSegment('betrieb')).toBe('kleingewerbe')
  })

  it('⚠ ohne Segment gibt es KEINE Kurve — ein Rückfall auf „privat" entschiede über ein ganzes Jahr', () => {
    expect(customerClassForSegment(null)).toBeNull()
    expect(hasStandardProfileCurve(null)).toBe(false)
  })

  it('für Betriebe ist (noch) keine Kurve hinterlegt — das ist eine fachliche Fehlanzeige', () => {
    // Delta 8 lässt offen, welches G-Profil in Österreich üblich ist; eine aus dem Haushaltsprofil
    // abgeleitete Gewerbekurve wäre eine erfundene Zahlenreihe mit seriösem Etikett.
    expect(customerClassForSegment('betrieb')).toBe('kleingewerbe')
    expect(hasStandardProfileCurve('betrieb')).toBe(false)
    expect(hasStandardProfileCurve('privat')).toBe(true)
  })
})

describe('readStandardProfileConsumption — Herkunft ist Teil der Angabe', () => {
  const now = new Date('2026-09-11T10:00:00.000Z')

  it('liest eine eingetragene Zahl samt `measured`', () => {
    const draft = setDraftField({}, ANNUAL_CONSUMPTION_KWH_KEY, 4_200, 'measured', undefined, now)
    expect(readStandardProfileConsumption(draft)).toEqual({
      annualConsumptionKwh: 4_200,
      source: 'measured',
    })
  })

  it('liest eine Schätzung samt Begründung', () => {
    const note = householdEstimateNote(3)
    const draft = setDraftField({}, ANNUAL_CONSUMPTION_KWH_KEY, 4_000, 'assumed', note, now)
    expect(readStandardProfileConsumption(draft)).toEqual({
      annualConsumptionKwh: 4_000,
      source: 'assumed',
      note,
    })
  })

  it('⚠ ohne Vermerk gilt `measured` — die Schätzung schreibt IMMER einen', () => {
    // Die andere Richtung wäre die unehrlichere: einen eingetragenen Wert als Schätzung auszuweisen
    // entwertet eine Angabe, die der Kunde von seiner Rechnung abgelesen hat.
    expect(
      readStandardProfileConsumption({ [ANNUAL_CONSUMPTION_KWH_KEY]: 3_650 }),
    ).toEqual({ annualConsumptionKwh: 3_650, source: 'measured' })
  })

  it.each([
    ['leerer Entwurf', {}],
    ['Zahl als Zeichenkette', { [ANNUAL_CONSUMPTION_KWH_KEY]: '3650' }],
    ['null', { [ANNUAL_CONSUMPTION_KWH_KEY]: null }],
    ['0', { [ANNUAL_CONSUMPTION_KWH_KEY]: 0 }],
    ['negativ', { [ANNUAL_CONSUMPTION_KWH_KEY]: -1 }],
    ['NaN', { [ANNUAL_CONSUMPTION_KWH_KEY]: Number.NaN }],
  ])('%s → null statt einer erfundenen Zahl', (_name, draft) => {
    expect(readStandardProfileConsumption(draft as Record<string, unknown>)).toBeNull()
  })
})

describe('⚠ die Zahlen im Begründungstext kommen aus DEM Formatierer des Admin-Bereichs', () => {
  it('nutzt `formatKwh` aus `./format` — nicht eine zweite, gleichnamige Fassung', () => {
    /*
     * `lib/admin/format.ts` exportiert bereits ein `formatKwh` (de-AT, mit Einheit). Eine zweite
     * Funktion desselben Namens im selben Verzeichnis gab es hier kurzzeitig — sie lieferte die
     * Zahl OHNE Einheit, und welche galt, entschied allein der Importpfad.
     *
     * Geprüft wird deshalb die AUSGABE gegen den geteilten Formatierer, nicht ein Literal: die
     * Tausendertrennung von `de-AT` ist ein schmales Leerzeichen und kein Punkt, und ein hier
     * ausgeschriebener Erwartungswert wäre eine dritte Behauptung darüber.
     */
    expect(householdEstimateNote(1)).toContain(formatKwh(HOUSEHOLD_BASE_KWH))
    expect(householdEstimateNote(4)).toContain(
      `${formatKwh(HOUSEHOLD_BASE_KWH)} + 3 × ${formatKwh(HOUSEHOLD_PER_ADDITIONAL_PERSON_KWH)}`,
    )
  })
})
