/**
 * DER LESER DER EINREICHUNG (B18-4).
 *
 * Die eine Eigenschaft, die sich nur hier prüfen lässt: Eine Antwort, die kein bekannter Zustand
 * ist, wird zu `error` — und `error` ist etwas ANDERES als „ging nicht durch". Als Ablehnung
 * gelesen sagte sie einem Fachbetrieb, seine Anfrage sei nicht angekommen, obwohl niemand das
 * weiss; als Erfolg gelesen wäre sie die umgekehrte Lüge. ⚠ Das deckt ausdrücklich den Fall ab,
 * dass die Migration auf der Zieldatenbank noch nicht liegt.
 */
import { describe, expect, it } from 'vitest'

import {
  MAX_CALCULATOR_REQUEST_MESSAGE_LENGTH,
  readCalculatorRequestSubmission,
} from './calculator-request'

describe('B18-4 — readCalculatorRequestSubmission', () => {
  it('liest die erfolgreiche Einreichung samt Kennung', () => {
    expect(readCalculatorRequestSubmission({ status: 'ok', request_id: 'req-1' })).toEqual({
      status: 'ok',
      requestId: 'req-1',
    })
  })

  it('⚠ ein „ok" OHNE Kennung ist kein Erfolg', () => {
    // Ohne Kennung liesse sich die interne Benachrichtigung nicht zuordnen — und ein Erfolg, den
    // niemand wiederfindet, ist keiner.
    expect(readCalculatorRequestSubmission({ status: 'ok' })).toEqual({ status: 'error' })
  })

  it('unterscheidet „kein aktiver Partnerzugang" von „ging schief"', () => {
    expect(readCalculatorRequestSubmission({ status: 'none' })).toEqual({ status: 'none' })
    expect(readCalculatorRequestSubmission({ status: 'none' }, new Error('weg'))).toEqual({
      status: 'error',
    })
    expect(readCalculatorRequestSubmission(null)).toEqual({ status: 'error' })
    expect(readCalculatorRequestSubmission({ status: 'was_neues' })).toEqual({ status: 'error' })
  })

  it('⚠ „bereits eine offene Anfrage" trägt Kennung und Zeitpunkt mit', () => {
    // Ohne sie könnte die Oberfläche nur „geht nicht" sagen; mit ihnen sagt sie, seit wann.
    expect(
      readCalculatorRequestSubmission({
        status: 'already_pending',
        request_id: 'req-1',
        created_at: '2026-08-04T10:00:00+00:00',
      }),
    ).toEqual({
      status: 'already_pending',
      requestId: 'req-1',
      createdAt: '2026-08-04T10:00:00+00:00',
    })

    expect(readCalculatorRequestSubmission({ status: 'already_pending' })).toEqual({
      status: 'error',
    })
  })

  it('nimmt die geltende Obergrenze aus der ANTWORT, nicht aus der Konstante', () => {
    // Die Datenbank entscheidet; die Konstante ist nur der Hinweis vor dem Absenden.
    expect(
      readCalculatorRequestSubmission({ status: 'message_too_long', max_length: 1234 }),
    ).toEqual({ status: 'message_too_long', maxLength: 1234 })

    // Fehlt die Zahl, steht in der Meldung eine, die stimmt, statt gar keiner.
    expect(readCalculatorRequestSubmission({ status: 'message_too_long' })).toEqual({
      status: 'message_too_long',
      maxLength: MAX_CALCULATOR_REQUEST_MESSAGE_LENGTH,
    })
  })

  it('reicht den fehlenden Begründungstext durch', () => {
    expect(readCalculatorRequestSubmission({ status: 'missing_fields' })).toEqual({
      status: 'missing_fields',
    })
  })
})
