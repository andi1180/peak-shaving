/**
 * DER LESER DER PARTNER-LEAD-SICHT (B18-6) — `readMyPartnerLeads`.
 *
 * ── WAS HIER GEPRÜFT WIRD UND WAS BEWUSST NICHT ──────────────────────────────────────────────────
 * WELCHE Anfragen der Wrapper überhaupt herausgibt (nur eigene, nur freigegebene, keine
 * anonymisierten) steht in der Datenbank und wird dort gemessen —
 * `packages/db-tests/src/partner-lead-disclosure.test.ts`. Hier steht die Auslegung der ANTWORT:
 * die Stelle, an der aus zwei richtigen Zahlen eine falsche Aussage werden kann.
 *
 * Die beiden Aussagen, um die es geht:
 *   (1) Die namenlose Restmenge ist `total − leads.length` — sie ist der einzige Hinweis darauf,
 *       dass es Anfragen gibt, die dieser Betrieb gebracht hat und nicht sehen darf.
 *   (2) „Leer" und „geht gerade nicht" sind verschiedene Zustände. Beides gleich zu behandeln sagte
 *       einem Fachbetrieb, seine Aussendung sei wirkungslos geblieben, obwohl niemand nachgesehen
 *       hat.
 */
import { describe, expect, it } from 'vitest'
import { readMyPartnerLeads } from './leads'

/** Eine Antwort, wie `public.get_my_partner_leads` sie liefert (jsonb → beliebiges `unknown`). */
function response(leads: unknown[], total: number): unknown {
  return { status: 'ok', total, leads }
}

const FREIGEGEBEN = {
  id: '4184d821-d484-40ff-8cbd-4d8e9acd9dad',
  company: 'Bäckerei Gruber',
  first_name: 'Anna',
  last_name: 'Gruber',
  email: 'anna@example.test',
  phone: '+43 660 1234567',
  created_at: '2026-08-04T05:57:16.711678+00:00',
}

describe('readMyPartnerLeads — die freigegebenen Anfragen', () => {
  it('liest eine vollständige Zeile in die Anwendungsform', () => {
    const state = readMyPartnerLeads(response([FREIGEGEBEN], 1))

    expect(state).toEqual({
      state: 'ok',
      total: 1,
      withoutConsent: 0,
      leads: [
        {
          id: FREIGEGEBEN.id,
          company: 'Bäckerei Gruber',
          firstName: 'Anna',
          lastName: 'Gruber',
          email: 'anna@example.test',
          phone: '+43 660 1234567',
          createdAt: FREIGEGEBEN.created_at,
        },
      ],
    })
  })

  it('⚠ die namenlose Restmenge ist die Differenz — sie ist der ganze Punkt dieses Reiters', () => {
    /*
     * `total` zählt ALLE zugeordneten Anfragen, `leads` nur die freigegebenen. Ohne diese Zahl sähe
     * ein Fachbetrieb eine unvollständige Liste als vollständige an.
     */
    const state = readMyPartnerLeads(response([FREIGEGEBEN], 5))

    expect(state).toMatchObject({ state: 'ok', total: 5, withoutConsent: 4 })
  })

  it('nur namenlose Anfragen: leere Liste, aber eine Gesamtzahl > 0', () => {
    // Der Fall, in dem die Oberfläche NICHT „noch nichts gekommen" schreiben darf.
    expect(readMyPartnerLeads(response([], 3))).toMatchObject({
      state: 'ok',
      total: 3,
      withoutConsent: 3,
      leads: [],
    })
  })

  it('gar nichts gekommen: total 0, leere Liste, keine Restmenge', () => {
    expect(readMyPartnerLeads(response([], 0))).toEqual({
      state: 'ok',
      total: 0,
      withoutConsent: 0,
      leads: [],
    })
  })

  it('fehlende Angaben bleiben null und werden nicht zu Leerstrings geglättet', () => {
    /*
     * `company`/`first_name`/`last_name`/`phone` sind in `platform.leads` optional — erhoben wird,
     * was der jeweilige Einstiegspunkt fragt. Eine Oberfläche, die eine Zeile weglassen will, muss
     * den Fall erkennen können; `''` sähe aus wie eine hinterlegte, aber unsichtbare Angabe.
     */
    const state = readMyPartnerLeads(
      response([{ ...FREIGEGEBEN, company: null, phone: '   ', last_name: '' }], 1),
    )

    expect(state).toMatchObject({
      state: 'ok',
      leads: [{ company: null, phone: null, lastName: null, firstName: 'Anna' }],
    })
  })
})

describe('readMyPartnerLeads — was NICHT als leere Liste durchgeht', () => {
  it('ein Fehler des Aufrufs ist NICHT „0 Anfragen"', () => {
    /*
     * Die wichtigste Unterscheidung dieser Datei. Eine leere Liste ist eine Aussage, ein Fehler ist
     * das Fehlen einer Aussage. Deckt zugleich den Fall ab, dass die Migration auf der
     * Zieldatenbank noch nicht liegt: PostgREST antwortet mit einem Fehler zur unbekannten
     * Funktion, und der Reiter sagt „gerade nicht abrufbar" statt „Ihr Link hat nichts gebracht".
     */
    expect(readMyPartnerLeads(null, { message: 'function does not exist' })).toEqual({
      state: 'error',
    })
  })

  it('{status: none} bleibt ein eigener Zustand — stillgelegt ist nicht dasselbe wie leer', () => {
    // Auf diesem Reiter ein Grenzfall: Er entsteht nur, wenn der Betrieb ZWISCHEN `readPortal` und
    // diesem Aufruf stillgelegt wurde. Er bleibt unterscheidbar, damit das Log die Ursache benennt.
    expect(readMyPartnerLeads({ status: 'none' })).toEqual({ state: 'none' })
  })

  it('eine unlesbare Antwort ist ein Fehler, kein leeres Ergebnis', () => {
    for (const antwort of [null, undefined, 'ok', 42, [], { status: 'ok' }]) {
      expect(readMyPartnerLeads(antwort), JSON.stringify(antwort)).toEqual({ state: 'error' })
    }
  })

  it('ein unbrauchbares `total` ist ein Fehler — ohne es gäbe es keine Restmenge', () => {
    for (const total of [null, '3', -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(readMyPartnerLeads({ status: 'ok', total, leads: [] }), String(total)).toEqual({
        state: 'error',
      })
    }
  })

  it('`leads` muss ein Array sein — ein fehlendes Feld ist kein leeres Ergebnis', () => {
    expect(readMyPartnerLeads({ status: 'ok', total: 0 })).toEqual({ state: 'error' })
  })
})

describe('readMyPartnerLeads — eine kaputte Zeile kostet nicht die ganze Sicht', () => {
  it('⚠ eine Zeile ohne `id` wird verworfen, die übrigen bleiben — und `total` bleibt unangetastet', () => {
    /*
     * Die Alternative wäre, wegen einer unlesbaren Zeile die ganze Sicht auf `error` zu setzen —
     * dann verschwänden echte, freigegebene Anfragen aus dem Blick, weil eine ANDERE Zeile kaputt
     * ist. Weil `total` die Zahl der Datenbank bleibt, wandert die verworfene Zeile automatisch in
     * die namenlose Restmenge: lieber „eine Anfrage, die ich nicht sehe" als „eine, die es nie gab".
     */
    const state = readMyPartnerLeads(
      response([FREIGEGEBEN, { ...FREIGEGEBEN, id: null }, 'kein Objekt'], 3),
    )

    expect(state).toMatchObject({ state: 'ok', total: 3, withoutConsent: 2 })
    expect((state as { leads: unknown[] }).leads).toHaveLength(1)
  })

  it('die Restmenge wird nie negativ', () => {
    // Fachlich unmöglich (`total` schliesst die Liste ein), aber „ausserdem −1 Anfragen" wäre die
    // schlechteste denkbare Art, von einem Fehler zu erfahren.
    expect(readMyPartnerLeads(response([FREIGEGEBEN, { ...FREIGEGEBEN, id: 'x' }], 1))).toMatchObject(
      { withoutConsent: 0 },
    )
  })
})
