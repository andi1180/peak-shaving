/**
 * DIE LESER DES PRÜF-EINGANGS (B18-4).
 *
 * Geprüft wird die Eigenschaft, die sich nur hier prüfen lässt und nicht im DB-Gate: dass eine
 * Antwort, die NICHT eindeutig ist, zu „nicht abrufbar" wird und nicht zu einer Aussage. Die
 * Datenbank kann das nicht beweisen — sie antwortet ja richtig; gefährlich wird der Fall, in dem sie
 * gar nicht antwortet oder etwas Unbekanntes liefert (eine fehlende Migration auf der
 * Zieldatenbank, ein PostgREST-Fehler, ein künftiger zusätzlicher Status).
 */
import { describe, expect, it } from 'vitest'

import {
  isCalculatorRequestStatus,
  readCalculatorRequestDecision,
  readCalculatorRequestList,
} from './calculator-requests'

const ROW = {
  id: 'req-1',
  partner_slug: 'elektro-muster',
  partner_display_name: 'Elektro Muster GmbH',
  partner_is_active: true,
  account_email: 'anna@elektro-muster.at',
  message: 'Wir wollen zehn Bestandskunden durchrechnen.',
  status: 'pending',
  created_at: '2026-08-04T10:00:00+00:00',
  reviewed_at: null,
  reviewed_by_email: null,
  notified_at: null,
}

const LIST = { status: 'ok', total: 1, limit: 50, offset: 0, requests: [ROW] }

describe('B18-4 — readCalculatorRequestList', () => {
  it('übersetzt eine vollständige Antwort', () => {
    expect(readCalculatorRequestList(LIST)).toEqual({
      total: 1,
      limit: 50,
      offset: 0,
      requests: [
        {
          id: 'req-1',
          partnerSlug: 'elektro-muster',
          partnerDisplayName: 'Elektro Muster GmbH',
          partnerIsActive: true,
          accountEmail: 'anna@elektro-muster.at',
          message: 'Wir wollen zehn Bestandskunden durchrechnen.',
          status: 'pending',
          createdAt: '2026-08-04T10:00:00+00:00',
          reviewedAt: null,
          reviewedByEmail: null,
          notifiedAt: null,
        },
      ],
    })
  })

  it('⚠ liefert bei einem Fehler NULL und nicht eine leere Liste', () => {
    // Eine leere Liste ist eine AUSSAGE („nichts liegt an"), ein Fehler ist das Fehlen einer
    // Aussage. Wer beides gleich anzeigt, sagt einem Admin, es gebe nichts zu tun.
    expect(readCalculatorRequestList(LIST, new Error('PGRST202'))).toBeNull()
    expect(readCalculatorRequestList(null)).toBeNull()
    expect(readCalculatorRequestList({ status: 'ok' })).toBeNull()
    expect(readCalculatorRequestList('kaputt')).toBeNull()
  })

  it('⚠ behandelt einen abgewiesenen Filter als „nicht abrufbar", nicht als leeren Bestand', () => {
    // Sonst zeigte die Oberfläche den GESAMTEN Eingang und hielte ihn für die gefilterte Teilmenge.
    expect(readCalculatorRequestList({ status: 'invalid_filter', field: 'status' })).toBeNull()
  })

  it('verwirft eine Zeile ohne Schlüssel oder mit unbekanntem Status, behält die übrigen', () => {
    const res = readCalculatorRequestList({
      ...LIST,
      total: 4,
      requests: [ROW, { ...ROW, id: null }, { ...ROW, id: 'req-2', status: 'wat' }, 'unsinn'],
    })

    expect(res?.requests.map((r) => r.id)).toEqual(['req-1'])
    // ⚠ `total` bleibt die Zahl der DATENBANK: lieber „eine Anfrage, die ich nicht sehe" als „eine,
    // die es nie gab".
    expect(res?.total).toBe(4)
  })

  it('hält einen Betrieb nur dann für stillgelegt, wenn es dasteht', () => {
    // Ein fehlendes Feld darf keinen Betrieb fälschlich als stillgelegt kennzeichnen — das wäre eine
    // Behauptung über ihn.
    const missing = readCalculatorRequestList({
      ...LIST,
      requests: [{ ...ROW, partner_is_active: undefined }],
    })
    expect(missing?.requests[0]?.partnerIsActive).toBe(true)

    const inactive = readCalculatorRequestList({
      ...LIST,
      requests: [{ ...ROW, partner_is_active: false }],
    })
    expect(inactive?.requests[0]?.partnerIsActive).toBe(false)
  })
})

describe('B18-4 — readCalculatorRequestDecision', () => {
  it('unterscheidet „gerade erteilt" von „bestand schon"', () => {
    expect(
      readCalculatorRequestDecision({
        status: 'ok',
        decision: 'approved',
        entitlement: 'granted',
        partner_slug: 'elektro-muster',
      }),
    ).toEqual({
      status: 'ok',
      decision: 'approved',
      entitlement: 'granted',
      partnerSlug: 'elektro-muster',
    })

    expect(
      readCalculatorRequestDecision({
        status: 'ok',
        decision: 'approved',
        entitlement: 'already_active',
        partner_slug: 'elektro-muster',
      }),
    ).toMatchObject({ entitlement: 'already_active' })
  })

  it('liest eine Ablehnung ohne Entitlement-Angabe', () => {
    expect(readCalculatorRequestDecision({ status: 'ok', decision: 'rejected' })).toEqual({
      status: 'ok',
      decision: 'rejected',
      entitlement: null,
      partnerSlug: null,
    })
  })

  it('reicht die vier fachlichen Abweisungen durch', () => {
    expect(readCalculatorRequestDecision({ status: 'not_found' })).toEqual({ status: 'not_found' })
    expect(readCalculatorRequestDecision({ status: 'no_account' })).toEqual({ status: 'no_account' })
    expect(readCalculatorRequestDecision({ status: 'invalid_decision' })).toEqual({
      status: 'invalid_decision',
    })
    expect(
      readCalculatorRequestDecision({ status: 'already_reviewed', current: 'approved' }),
    ).toEqual({ status: 'already_reviewed', current: 'approved' })
  })

  it('⚠ macht aus einer unbekannten Antwort KEINEN Erfolg', () => {
    // Ein `ok` ohne verwertbare Entscheidung dürfte nie den Mailversand auslösen — die Freigabe
    // stünde dann in einem Postfach, ohne dass jemand weiss, ob sie stattgefunden hat.
    expect(readCalculatorRequestDecision({ status: 'ok' })).toEqual({ status: 'error' })
    expect(readCalculatorRequestDecision({ status: 'ok', decision: 'vielleicht' })).toEqual({
      status: 'error',
    })
    expect(readCalculatorRequestDecision(null)).toEqual({ status: 'error' })
    expect(readCalculatorRequestDecision({ status: 'ok' }, new Error('weg'))).toEqual({
      status: 'error',
    })
  })
})

describe('B18-4 — isCalculatorRequestStatus', () => {
  it('kennt genau die drei Zustände des Enums', () => {
    expect(['pending', 'approved', 'rejected'].every(isCalculatorRequestStatus)).toBe(true)
    expect(isCalculatorRequestStatus('anonymized')).toBe(false)
    expect(isCalculatorRequestStatus(null)).toBe(false)
  })
})
