import { describe, expect, it } from 'vitest'
import { analysisWindow } from 'shared'

import { generateStandardLoadProfile } from './h0'
import { standardProfileMetadata } from './metadata'

/**
 * B24, Teil 1 — die Metadaten eines ERZEUGTEN Standardlastprofils.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * DER PRÜFPUNKT IST GENAU EINE ZEILE, UND SIE IST DIE HÄUFIGSTE FALLE DIESES REPOS
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `analysisWindow` liefert beide Grenzen INKLUSIV (Delta 15, Regel A), `covered_to` in
 * `platform.metering_points` ist die OBERE KANTE eines halboffenen Bereichs. Ohne den Aufschlag
 * der letzten Intervalldauer endete ein Jahresprofil am 31.12. um 23:45 Ortszeit statt am
 * 1. Jänner um 00:00 — eine Viertelstunde, die in `[coveredFrom, coveredTo)` fehlt, und nichts
 * daran schlägt fehl: der Wrapper nimmt den Wert widerspruchsfrei an, die Station zeigt einen
 * plausiblen Zeitraum, und der Fehler fiele erst einem Menschen auf, der die zwei Enden vergleicht.
 *
 * Die Rechnung selbst (Kurve, Jahressumme, Saisonverhältnis) prüft `h0.test.ts` — hier geht es
 * ausschliesslich um die Übersetzung „erzeugtes Profil → vier Spalten am Zählpunkt".
 */

const TZ = 'Europe/Vienna'

function ok(input: { annualConsumptionKwh?: number; year?: number; timeZone?: string } = {}) {
  const outcome = standardProfileMetadata({
    annualConsumptionKwh: input.annualConsumptionKwh ?? 3_650,
    customerClass: 'privat',
    year: input.year ?? 2025,
    timeZone: input.timeZone ?? TZ,
  })
  if (!outcome.ok) throw new Error(`unerwartet abgelehnt: ${outcome.reason}`)
  return outcome.metadata
}

describe('standardProfileMetadata — coveredTo ist die obere Kante, nicht der letzte Zeitstempel', () => {
  it('schlägt GENAU eine Intervalldauer auf das Ende des Analysefensters auf', () => {
    const metadata = ok()

    // Dasselbe Profil unabhängig noch einmal erzeugen und sein Fenster selbst bilden — verglichen
    // wird gegen `analysisWindow`, nicht gegen eine zweite Kopie derselben Ableitung.
    const generated = generateStandardLoadProfile({
      annualConsumptionKwh: 3_650,
      customerClass: 'privat',
      year: 2025,
      timeZone: TZ,
    })
    if (!generated.ok) throw new Error('Generator hat abgelehnt')
    const window = analysisWindow(generated.profile)
    if (window === null) throw new Error('kein Fenster')

    expect(metadata.coveredFrom).toBe(window.startIso)
    // ⚠ Die eigentliche Zusage: NICHT `window.endIso`.
    expect(metadata.coveredTo).not.toBe(window.endIso)
    expect(new Date(metadata.coveredTo).getTime() - new Date(window.endIso).getTime()).toBe(
      metadata.intervalMinutes * 60_000,
    )
  })

  it('ein Kalenderjahr-Profil endet an der Ortszeit-Mitternacht des FOLGEjahres', () => {
    const metadata = ok({ year: 2025 })

    /*
     * Der konkrete Beleg, an dem ein Mensch die Falle erkennt: `coveredFrom` ist 2024-12-31T23:00Z
     * (Wiener Mitternacht des 1.1.2025), `coveredTo` ein Jahr später — 2025-12-31T23:00Z. Ohne den
     * Aufschlag stünde dort 22:45Z, also der 31.12. um 23:45 Ortszeit.
     */
    expect(metadata.coveredFrom).toBe('2024-12-31T23:00:00.000Z')
    expect(metadata.coveredTo).toBe('2025-12-31T23:00:00.000Z')
  })

  it('ein Schaltjahr trägt einen Tag mehr — die Kante wandert mit', () => {
    const metadata = ok({ year: 2028 })
    const days =
      (new Date(metadata.coveredTo).getTime() - new Date(metadata.coveredFrom).getTime()) / 86_400_000
    expect(days).toBe(366)
  })
})

describe('standardProfileMetadata — was mitreist und was nicht', () => {
  it('liest das Intervall aus dem erzeugten Profil (15), statt es hinzuschreiben', () => {
    expect(ok().intervalMinutes).toBe(15)
  })

  it('gibt den Jahresverbrauch unverändert zurück — gespeichert wird, womit gerechnet wurde', () => {
    expect(ok({ annualConsumptionKwh: 4_237.5 }).annualConsumptionKwh).toBe(4_237.5)
  })

  it('liefert KEINE Messwerte — nur Zeitpunkte und Zahlen über die Reihe', () => {
    /*
     * Die Zusage, auf der die ganze Paketgrenze beruht (B24: „es kommt kein einziger Messwert
     * heraus"). Ein Feld mehr wäre eine zweite Kopie derselben Verbrauchsdaten.
     */
    expect(Object.keys(ok()).sort()).toEqual([
      'annualConsumptionKwh',
      'coveredFrom',
      'coveredTo',
      'intervalMinutes',
    ])
  })
})

describe('standardProfileMetadata — die Ablehnungsgründe sind die der Engine', () => {
  it('kleingewerbe → no_profile_for_class (es gibt keine G-Kurve, und es wird keine erfunden)', () => {
    const outcome = standardProfileMetadata({
      annualConsumptionKwh: 3_650,
      customerClass: 'kleingewerbe',
      year: 2025,
      timeZone: TZ,
    })
    expect(outcome).toEqual({ ok: false, reason: 'no_profile_for_class' })
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'Jahresverbrauch %p → invalid_consumption',
    (annualConsumptionKwh) => {
      const outcome = standardProfileMetadata({
        annualConsumptionKwh,
        customerClass: 'privat',
        year: 2025,
        timeZone: TZ,
      })
      expect(outcome).toEqual({ ok: false, reason: 'invalid_consumption' })
    },
  )

  it('unsinniges Jahr → invalid_year', () => {
    const outcome = standardProfileMetadata({
      annualConsumptionKwh: 3_650,
      customerClass: 'privat',
      year: 1899,
      timeZone: TZ,
    })
    expect(outcome).toEqual({ ok: false, reason: 'invalid_year' })
  })

  it('ein Ablehnungsgrund trägt NIE Metadaten — der Aufrufer kann sie nicht versehentlich lesen', () => {
    const outcome = standardProfileMetadata({
      annualConsumptionKwh: 0,
      customerClass: 'privat',
      year: 2025,
      timeZone: TZ,
    })
    expect('metadata' in outcome).toBe(false)
  })
})
