import { describe, expect, it } from 'vitest'

import { readMyCalculatorRequest } from './my-calculator-request'

/**
 * B18-4 (Portal) — der Leser der eigenen, letzten Kalkulator-Anfrage.
 *
 * ── DIE EIGENSCHAFT, DIE SICH NUR HIER PRÜFEN LÄSST ─────────────────────────────────────────────
 * Dass eine unklare Antwort NICHT zum freundlichsten benachbarten Zustand wird. Die Datenbank kann
 * das nicht beweisen — sie antwortet ja richtig; gefährlich ist der Fall, in dem sie gar nicht
 * antwortet oder etwas Unbekanntes liefert (fehlende Migration auf der Zieldatenbank, ein
 * PostgREST-Fehler, ein künftiger vierter Status).
 *
 * ⚠ Der teuerste Fehlgriff wäre `error → never`: Die Seite stellte einem Betrieb, dessen Anfrage
 * seit gestern offen ist, ein leeres Formular hin; er reichte ein zweites Mal ein, bekäme
 * `already_pending` und hielte das für einen Fehler.
 */

const REQUEST = {
  id: 'req-1',
  status: 'pending',
  message: 'Wir möchten zehn Bestandskunden durchrechnen.',
  created_at: '2026-08-04T10:00:00+00:00',
  reviewed_at: null,
}

describe('B18-4 Portal — readMyCalculatorRequest', () => {
  it('übersetzt eine offene Anfrage vollständig', () => {
    expect(readMyCalculatorRequest({ status: 'ok', request: REQUEST })).toEqual({
      state: 'request',
      request: {
        id: 'req-1',
        status: 'pending',
        message: 'Wir möchten zehn Bestandskunden durchrechnen.',
        createdAt: '2026-08-04T10:00:00+00:00',
        reviewedAt: null,
      },
    })
  })

  it('liest die beiden entschiedenen Zustände samt Entscheidungszeitpunkt', () => {
    for (const status of ['approved', 'rejected'] as const) {
      const res = readMyCalculatorRequest({
        status: 'ok',
        request: { ...REQUEST, status, reviewed_at: '2026-08-05T09:00:00+00:00' },
      })
      expect(res).toMatchObject({
        state: 'request',
        request: { status, reviewedAt: '2026-08-05T09:00:00+00:00' },
      })
    }
  })

  it('⚠ trennt „noch nie angefragt" von „kein Partnerzugang"', () => {
    // Aus dem einen folgt ein Formular, aus dem anderen die Erklärseite.
    expect(readMyCalculatorRequest({ status: 'ok', request: null })).toEqual({ state: 'never' })
    expect(readMyCalculatorRequest({ status: 'none' })).toEqual({ state: 'none' })
  })

  it('⚠ macht aus einer unklaren Antwort NIE „noch nie angefragt"', () => {
    for (const data of [
      null,
      undefined,
      'ok',
      [],
      {},
      { status: 'ok' }, // `request` FEHLT — das ist keine Aussage, anders als `request: null`
      { status: 'vielleicht' },
      { status: 'ok', request: { ...REQUEST, id: '' } },
      { status: 'ok', request: { ...REQUEST, status: 'in_pruefung' } },
      { status: 'ok', request: 'nope' },
    ]) {
      expect(readMyCalculatorRequest(data), JSON.stringify(data ?? null)).toEqual({
        state: 'error',
      })
    }
  })

  it('⚠ ein Aufruffehler ist error, nicht none — auch bei ansonsten gültigen Daten', () => {
    // `none` hiesse „kein Partnerzugang" und schickte einen echten Partner auf die Erklärseite.
    expect(readMyCalculatorRequest({ status: 'ok', request: REQUEST }, new Error('weg'))).toEqual({
      state: 'error',
    })
  })

  it('verwirft eine Anfrage nicht wegen eines leeren Texts', () => {
    // Die Anfrage BESTEHT; nur ihr Text ist nicht darstellbar. Sie zu verwerfen hiesse hier, ein
    // Formular anzubieten, obwohl bereits eine offene Anfrage vorliegt.
    const res = readMyCalculatorRequest({ status: 'ok', request: { ...REQUEST, message: null } })
    expect(res).toMatchObject({ state: 'request', request: { message: '' } })
  })
})
