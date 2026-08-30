import { describe, expect, it } from 'vitest'

import {
  REPORT_GATE_CONSENT_PURPOSE,
  REPORT_GATE_MAX_LENGTH,
  REPORT_GATE_SOURCE_KEY,
  parseReportGate,
  reportGateDisplayName,
  type ReportGateSubmission,
} from './report-gate'

/**
 * Delta 16b — die Prüfregel des Report-Gates.
 *
 * Sie steht in `packages/shared`, weil Formular UND Server Action dieselbe benutzen; getestet wird
 * sie deshalb auch hier und nicht in einer der beiden Apps (`apps/website` hat ohnehin keinen
 * Testlauf).
 */

function submission(over: Partial<ReportGateSubmission> = {}): ReportGateSubmission {
  return {
    firstName: 'Anna',
    lastName: 'Gruber',
    company: 'Bäckerei Gruber GmbH',
    email: 'anna@baeckerei-gruber.example',
    consent: true,
    ...over,
  }
}

describe('parseReportGate', () => {
  it('nimmt eine vollständige Absendung an und gibt getrimmte Werte zurück', () => {
    const parsed = parseReportGate(submission({ firstName: '  Anna  ', company: 'Gruber GmbH ' }))

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.values).toEqual({
      firstName: 'Anna',
      lastName: 'Gruber',
      company: 'Gruber GmbH',
      email: 'anna@baeckerei-gruber.example',
    })
  })

  /*
   * DER KERNFALL DER GANZEN DATEI. Ohne Haken darf nichts entstehen — und zwar nicht als
   * Feldmeldung, sondern als eigener Ablaufgrund: die Server Action verzweigt daran und ruft
   * `capture_lead` GAR NICHT auf.
   */
  it('ohne Einwilligung wird abgelehnt — mit eigenem Grund, nicht als Feldfehler', () => {
    const parsed = parseReportGate(submission({ consent: false }))

    expect(parsed).toEqual({ ok: false, reason: 'consent_missing' })
  })

  it('ein nicht-boolesches consent zählt NICHT als Einwilligung', () => {
    // Der Aufruf muss nicht durch das Formular gekommen sein: 'true', 1 oder {} dürfen den Haken
    // nicht ersetzen. `consent !== true` ist deshalb die Prüfung, nicht `!consent`.
    for (const value of ['true', 1, {}, [], 'on']) {
      const parsed = parseReportGate(submission({ consent: value as unknown as boolean }))
      expect(parsed, JSON.stringify(value)).toEqual({ ok: false, reason: 'consent_missing' })
    }
  })

  it('ein gefüllter Honeypot wird abgelehnt — VOR jeder anderen Prüfung', () => {
    /*
     * Auch mit sonst tadelloser Absendung. Und die Prüfung steht vor der Einwilligung: sonst
     * verriete die Antwort einem Bot, welche der beiden Hürden er genommen hat.
     */
    expect(parseReportGate(submission({ website: 'https://spam.example' }))).toEqual({
      ok: false,
      reason: 'spam',
    })
    expect(parseReportGate(submission({ consent: false, website: 'x' }))).toEqual({
      ok: false,
      reason: 'spam',
    })
  })

  it('ein leerer oder nur aus Leerzeichen bestehender Honeypot ist unauffällig', () => {
    // Sonst scheiterte jeder Browser, der das versteckte Feld mit einem Leerzeichen autofüllt.
    expect(parseReportGate(submission({ website: '' })).ok).toBe(true)
    expect(parseReportGate(submission({ website: '   ' })).ok).toBe(true)
  })

  it('meldet fehlende Pflichtfelder einzeln', () => {
    const parsed = parseReportGate(
      submission({ firstName: '', lastName: '  ', company: '', email: '' }),
    )

    expect(parsed.ok).toBe(false)
    if (parsed.ok || parsed.reason !== 'validation') throw new Error('validation erwartet')
    expect(parsed.fieldErrors).toEqual({
      firstName: 'fieldRequired',
      lastName: 'fieldRequired',
      company: 'fieldRequired',
      email: 'fieldRequired',
    })
  })

  it('weist unbrauchbare Adressen ab', () => {
    for (const email of ['anna', 'anna@', '@example.at', 'anna@example', 'an na@example.at']) {
      const parsed = parseReportGate(submission({ email }))
      expect(parsed.ok, email).toBe(false)
      if (parsed.ok || parsed.reason !== 'validation') throw new Error('validation erwartet')
      expect(parsed.fieldErrors.email, email).toBe('emailInvalid')
    }
  })

  it('die Längengrenzen sind die der Datenbank — ein Zeichen darüber wird abgewiesen', () => {
    // Ohne diese Prüfung liefe der Wert bis in `capture_lead` und würde dort hart abgewiesen; der
    // Nutzer sähe einen abgebrochenen Vorgang statt einer Feldmeldung.
    const parsed = parseReportGate(
      submission({ company: 'x'.repeat(REPORT_GATE_MAX_LENGTH.company + 1) }),
    )
    expect(parsed.ok).toBe(false)
    if (parsed.ok || parsed.reason !== 'validation') throw new Error('validation erwartet')
    expect(parsed.fieldErrors.company).toBe('tooLong')

    // Genau an der Grenze läuft es durch.
    expect(
      parseReportGate(submission({ company: 'x'.repeat(REPORT_GATE_MAX_LENGTH.company) })).ok,
    ).toBe(true)
  })
})

describe('Konstanten', () => {
  it('der Herkunftsschlüssel erfüllt den CHECK von platform.lead_sources.key', () => {
    // `^[a-z0-9-]+$` seit B1-1 — ein Unterstrich ist in B10-5 real mit 23514 abgewiesen worden.
    expect(REPORT_GATE_SOURCE_KEY).toMatch(/^[a-z0-9-]+$/)
  })

  it('Zweck und Schlüssel sind NICHT dieselben wie beim Schnellrechner-Versand', () => {
    // Delta 16 Entscheidung 1: es wird nichts zugesendet. Fiele der Zweck versehentlich auf
    // 'result_delivery' zurück, versprächen wir eine Mail, die dieses System gar nicht senden kann.
    expect(REPORT_GATE_CONSENT_PURPOSE).not.toBe('result_delivery')
    expect(REPORT_GATE_SOURCE_KEY).not.toBe('rechnerergebnis')
  })
})

describe('reportGateDisplayName', () => {
  it('setzt Vor- und Nachname für das Deckblatt zusammen', () => {
    expect(reportGateDisplayName({ firstName: 'Anna', lastName: 'Gruber' })).toBe('Anna Gruber')
  })
})
