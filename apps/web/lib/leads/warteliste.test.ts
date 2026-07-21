/**
 * Anwendungsseitige Pflichttests der Warteliste (B3-4).
 *
 * Sie laufen OHNE Datenbank: die Segment-Auflösung ist reine Logik, und `runLeadCapture` bekommt
 * seine Effekte als Parameter (s. Kopf von `capture-flow.ts`). Geprüft wird genau das, was der
 * Anwendungscode und NUR er garantieren kann — dass die richtige HERKUNFT in den Bestand geht:
 *
 *   (4) `/warteliste`      schreibt `source_key = 'warteliste'`,
 *   (5) `/warteliste/wko`  schreibt `source_key = 'wko-postaktion-qr'`,
 *   (6) ein unbekanntes Segment löst sich zu NICHTS auf (die Route macht daraus 404) — kein
 *       Rückfall auf die organische Quelle, kein Lead,
 *   (7) fehlende Branche → Abweisung mit Feldmeldung, kein Lead,
 *   (8) PLZ und Verbrauch leer → der Lead entsteht, die Segmentierungsfelder bleiben `null`
 *       (nicht Leerstring — sonst überschriebe die COALESCE-Zusammenführung aus B3-1 Bestehendes),
 *   (9) die Einwilligung entsteht als 'pending' MIT Token: der Double-Opt-in aus B1-2 greift
 *       unverändert.
 */

import { describe, expect, it } from 'vitest'

import { runLeadCapture, type CaptureLeadCall, type LeadCaptureEffects } from './capture-flow'
import type { CaptureOutcome, CaptureResult } from './config'
import { LEAD_CAPTURE_REGISTRY } from './registry'
import { resolveWartelisteSource, wartelisteSegments } from './warteliste'

type Recorded = { calls: CaptureLeadCall[]; confirmationMails: number; resultMails: number }

/** Attrappen für Datenbank und Versand — dieselbe Form wie in `capture-flow.test.ts`. */
function fakeEffects(outcomes: CaptureOutcome[] = ['consent_created']): {
  effects: LeadCaptureEffects
  recorded: Recorded
} {
  const recorded: Recorded = { calls: [], confirmationMails: 0, resultMails: 0 }
  let index = 0

  const effects: LeadCaptureEffects = {
    captureLead: async (input): Promise<CaptureResult> => {
      recorded.calls.push(input)
      const outcome = outcomes[Math.min(index, outcomes.length - 1)] ?? 'lead_only'
      index += 1
      return { outcome, leadId: 'lead-1', consentId: 'consent-1' }
    },
    getConsentText: async () => 'Ich möchte Informationen von COOLiN ENERGY erhalten.',
    createToken: () => ({
      token: 'klartext',
      tokenHash: 'hash',
      expiresAt: new Date('2027-01-01T00:00:00Z'),
    }),
    sendConfirmationMail: async () => {
      recorded.confirmationMails += 1
    },
    sendResultMail: async () => {
      recorded.resultMails += 1
    },
  }

  return { effects, recorded }
}

const CONTEXT = { locale: 'de', sourceIp: null, userAgent: null }

/** Eine vollständige, gültige Eintragung. Einzelne Felder überschreiben die Tests gezielt. */
const VOLLSTAENDIG = {
  email: 'betrieb@example.test',
  industry: 'tischlerei',
  postalCode: '1100',
  annualConsumptionKwh: '84000',
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('(6) die Auflösung des Segments', () => {
  it("'wko' löst auf den QR-Code-Einstiegspunkt auf", () => {
    expect(resolveWartelisteSource('wko')).toBe('wko-postaktion-qr')
  })

  it('ein unbekanntes Segment liefert null — KEINEN Rückfall auf die organische Quelle', () => {
    /*
     * Der eigentliche Beweis dieses Tests ist das, was NICHT herauskommt: 'warteliste'. Ein
     * Rückfallwert stempelte eine falsche Herkunft auf eine echte Einwilligung — die Route
     * funktionierte, die Leads kämen an, und die Auswertung, ob der Brief Rücklauf erzeugt hat,
     * wäre still falsch. Die Route macht aus `null` einen 404.
     */
    for (const segment of ['erfunden', 'warteliste', 'WKO', 'wko-postaktion-qr', '', 'wko/']) {
      expect(resolveWartelisteSource(segment), `Segment "${segment}"`).toBeNull()
    }
    // Auch alles, was gar kein String ist (ein Segment kommt aus der URL, nicht aus dem Typsystem).
    expect(resolveWartelisteSource(undefined)).toBeNull()
    expect(resolveWartelisteSource(42)).toBeNull()
  })

  it('jedes vorgerenderte Segment zeigt auf einen Eintrag, den die Registry kennt', () => {
    const segments = wartelisteSegments()
    expect(segments).toEqual(['wko'])
    for (const segment of segments) {
      const key = resolveWartelisteSource(segment)!
      expect(LEAD_CAPTURE_REGISTRY[key]).toBeDefined()
    }
  })

  it('ein unbekanntes Segment erzeugt keinen Lead — es gibt gar keinen Schlüssel zum Schreiben', async () => {
    const { effects, recorded } = fakeEffects()

    // Was die Route im 404-Fall NICHT tut, lässt sich nicht direkt prüfen; prüfbar ist, dass ein
    // trotzdem versuchter Aufruf mit dem Segment als Schlüssel ins Leere läuft (die Registry kennt
    // 'erfunden' nicht) und die Datenbank nicht einmal angefasst wird.
    const response = await runLeadCapture(
      { sourceKey: 'erfunden', values: VOLLSTAENDIG },
      effects,
      CONTEXT,
    )

    expect(response).toEqual({ ok: false, error: 'unavailable' })
    expect(recorded.calls).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('(4)/(5) beide Routen schreiben ihre EIGENE Herkunft', () => {
  it("`/warteliste` schreibt source_key 'warteliste'", async () => {
    const { effects, recorded } = fakeEffects(['consent_created'])

    const response = await runLeadCapture(
      { sourceKey: 'warteliste', values: VOLLSTAENDIG },
      effects,
      CONTEXT,
    )

    expect(response).toEqual({ ok: true })
    expect(recorded.calls).toHaveLength(1)
    expect(recorded.calls[0]!.sourceKey).toBe('warteliste')
    expect(recorded.calls[0]!.purpose).toBe('marketing_email')
  })

  it("`/warteliste/wko` schreibt source_key 'wko-postaktion-qr'", async () => {
    const { effects, recorded } = fakeEffects(['consent_created'])
    const sourceKey = resolveWartelisteSource('wko')!

    const response = await runLeadCapture({ sourceKey, values: VOLLSTAENDIG }, effects, CONTEXT)

    expect(response).toEqual({ ok: true })
    expect(recorded.calls[0]!.sourceKey).toBe('wko-postaktion-qr')
    // Fachlich derselbe Zweck wie organisch — unterschieden wird über die Herkunft, nicht über
    // eine eigene Einwilligungsart (s. Kopf der B3-4-Migration).
    expect(recorded.calls[0]!.purpose).toBe('marketing_email')
  })

  it('beide Einstiegspunkte erheben dieselben Felder und denselben Zweck', () => {
    const organisch = LEAD_CAPTURE_REGISTRY['warteliste']
    const perPost = LEAD_CAPTURE_REGISTRY['wko-postaktion-qr']

    // Unterschiedliche Felder je Route ergäben eine Warteliste, deren Segmentierbarkeit davon
    // abhinge, über welchen Weg jemand hereingekommen ist.
    expect(perPost.fields).toEqual(organisch.fields)
    expect(perPost.purpose).toBe(organisch.purpose)
    expect(perPost.offersMarketingConsent).toBe(organisch.offersMarketingConsent)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('(7) die Branche ist Pflicht', () => {
  it('ohne Branche wird abgewiesen — feldgenau und ohne Lead', async () => {
    const { effects, recorded } = fakeEffects()

    const response = await runLeadCapture(
      { sourceKey: 'warteliste', values: { ...VOLLSTAENDIG, industry: '' } },
      effects,
      CONTEXT,
    )

    expect(response).toEqual({
      ok: false,
      error: 'validation',
      fieldErrors: { industry: 'fieldRequired' },
    })
    expect(recorded.calls).toHaveLength(0)
  })

  it('eine erfundene Branche wird abgewiesen, nicht still verworfen', async () => {
    const { effects, recorded } = fakeEffects()

    // Ein stilles Verwerfen erzeugte einen Lead OHNE Branche — also genau die Lücke, gegen die die
    // Pflicht gebaut ist, nur unsichtbar. Das Enum ist DB-seitig ohnehin geschlossen (B3-1).
    const response = await runLeadCapture(
      { sourceKey: 'warteliste', values: { ...VOLLSTAENDIG, industry: 'raumfahrt' } },
      effects,
      CONTEXT,
    )

    expect(response).toMatchObject({ ok: false, error: 'validation' })
    expect(recorded.calls).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('(8) PLZ und Verbrauch sind optional', () => {
  it('leer gelassen entsteht der Lead, und die Felder bleiben null — nicht Leerstring', async () => {
    const { effects, recorded } = fakeEffects(['consent_created'])

    const response = await runLeadCapture(
      {
        sourceKey: 'warteliste',
        values: {
          email: VOLLSTAENDIG.email,
          industry: 'kuehlhaus',
          postalCode: '',
          annualConsumptionKwh: '',
        },
      },
      effects,
      CONTEXT,
    )

    expect(response).toEqual({ ok: true })
    const call = recorded.calls[0]!
    expect(call.industry).toBe('kuehlhaus')
    /*
     * `undefined` wird als SQL-`null` übergeben, und darauf beruht die B3-1-Zusammenführung:
     * `coalesce(NEU, BESTAND)` lässt einen bestehenden Wert unberührt. Ein durchgereichter
     * Leerstring täte das NICHT — er überschriebe still, was ein früherer Einstiegspunkt erbracht
     * hat (und würde am DB-CHECK „genau vier Ziffern" ohnehin scheitern).
     */
    expect(call.postalCode).toBeUndefined()
    expect(call.annualConsumptionKwh).toBeUndefined()
  })

  it('angegeben kommen sie getypt an — der Verbrauch als Zahl, nicht als Text', async () => {
    const { effects, recorded } = fakeEffects(['consent_created'])

    await runLeadCapture(
      // Mit Tausenderpunkt, wie man ihn aus einer Rechnung abschreibt.
      { sourceKey: 'warteliste', values: { ...VOLLSTAENDIG, annualConsumptionKwh: '84.000' } },
      effects,
      CONTEXT,
    )

    const call = recorded.calls[0]!
    expect(call.postalCode).toBe('1100')
    expect(call.annualConsumptionKwh).toBe(84000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('(9) der Double-Opt-in aus B1-2 greift unverändert', () => {
  it('die Einwilligung entsteht mit Token, und es geht NUR die Bestätigungsmail raus', async () => {
    const { effects, recorded } = fakeEffects(['consent_created'])

    await runLeadCapture({ sourceKey: 'warteliste', values: VOLLSTAENDIG }, effects, CONTEXT)

    const call = recorded.calls[0]!
    // Der Token entsteht im Anwendungscode; ob er GESPEICHERT wird, entscheidet die Datenbank
    // (`purpose_requires_double_opt_in`) — bei marketing_email: ja, Zustand 'pending'.
    expect(call.tokenHash).toBe('hash')
    expect(call.tokenExpiresAt).toBeInstanceOf(Date)
    expect(recorded.confirmationMails).toBe(1)
    // Nichts Werbliches und keine Leistung, solange unbestätigt — 'pending' ist rechtlich wertlos.
    expect(recorded.resultMails).toBe(0)
  })

  it('gilt für beide Routen gleichermassen', async () => {
    const { effects, recorded } = fakeEffects(['consent_created'])

    await runLeadCapture({ sourceKey: 'wko-postaktion-qr', values: VOLLSTAENDIG }, effects, CONTEXT)

    expect(recorded.calls[0]!.tokenHash).toBe('hash')
    expect(recorded.confirmationMails).toBe(1)
  })
})
