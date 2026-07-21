/**
 * Anwendungsseitige Pflichttests des Erfassungsablaufs (B3-2).
 *
 * Sie laufen OHNE Datenbank, weil `runLeadCapture` seine Effekte als Parameter bekommt (s. Kopf von
 * `capture-flow.ts`). Was hier geprüft wird, ist nicht das Schema — das prüft das DB-Gate —, sondern
 * die drei Eigenschaften, die der Anwendungscode und NUR er garantieren kann:
 *
 *   (7) ein Aufruf mit unbekanntem source_key erzeugt keinen Lead,
 *   (8) ein Aufruf, der einen Zweck mitzuschicken versucht, ändert den aus der Registry
 *       abgeleiteten Zweck nicht,
 *   (9) die Rückmeldung ist bei gesperrter und bei unbekannter Adresse identisch.
 */

import { describe, expect, it } from 'vitest'

import { runLeadCapture, type LeadCaptureEffects, type LeadCaptureResponse } from './capture-flow'
import type { CaptureLeadCall } from './capture-flow'
import type { CaptureOutcome, CaptureResult } from './config'

type Recorded = {
  calls: CaptureLeadCall[]
  confirmationMails: number
  resultMails: number
}

/**
 * Attrappen für Datenbank und Versand. `outcomes` legt fest, was `capture_lead` der Reihe nach
 * zurückgibt — so lassen sich die Ausgänge der echten Funktion (suppressed, consent_confirmed …)
 * exakt nachstellen, ohne sie herzustellen.
 */
function fakeEffects(outcomes: CaptureOutcome[] = ['consent_confirmed']): {
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
    getConsentText: async () => 'Ich möchte … erhalten.',
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

describe('(7) unbekannter Einstiegspunkt', () => {
  it('erzeugt KEINEN Lead und liefert eine neutrale Meldung — keinen Ersatzwert', async () => {
    const { effects, recorded } = fakeEffects()

    const response = await runLeadCapture(
      { sourceKey: 'gibt-es-nicht', values: { email: 'jemand@example.test' } },
      effects,
      CONTEXT,
    )

    expect(response).toEqual({ ok: false, error: 'unavailable' })
    // Der eigentliche Beweis: die Datenbank wurde nicht einmal angefasst.
    expect(recorded.calls).toHaveLength(0)
  })

  it('gilt auch für einen Schlüssel, den es in der Datenbank gibt, aber nicht in der Registry', async () => {
    const { effects, recorded } = fakeEffects()

    // Frei erfundener, plausibel klingender Schlüssel — genau der Fall, der unter falscher Herkunft
    // in den Bestand schriebe, wenn es einen Fallback gäbe.
    const response = await runLeadCapture(
      { sourceKey: 'newsletter', values: { email: 'jemand@example.test' } },
      effects,
      CONTEXT,
    )

    expect(response).toEqual({ ok: false, error: 'unavailable' })
    expect(recorded.calls).toHaveLength(0)
  })
})

describe('(8) der Zweck kommt ausschliesslich aus der Registry', () => {
  it('ein mitgeschickter Zweck ändert nichts — der Eintrag bestimmt ihn', async () => {
    const { effects, recorded } = fakeEffects(['consent_created'])

    /*
     * 'artikel-inline' trägt laut Registry 'marketing_email'. Der Aufruf versucht, stattdessen
     * 'result_delivery' unterzuschieben — das wäre die Umgehung, um eine sofort wirksame
     * Einwilligung ohne Bestätigungsschritt zu erzeugen. Der Contract hat für so ein Feld gar
     * keinen Platz; zusätzlich wird hier bewiesen, dass ein trotzdem angehängtes Feld folgenlos
     * bleibt.
     */
    const response = await runLeadCapture(
      {
        sourceKey: 'artikel-inline',
        values: { email: 'jemand@example.test' },
        ...({ purpose: 'result_delivery' } as object),
      },
      effects,
      CONTEXT,
    )

    expect(response).toEqual({ ok: true })
    expect(recorded.calls).toHaveLength(1)
    expect(recorded.calls[0]!.purpose).toBe('marketing_email')
  })

  it('ein angekreuztes Marketing-Häkchen wirkt nicht, wo der Eintrag es nicht anbietet', async () => {
    const { effects, recorded } = fakeEffects(['consent_created'])

    // 'branchenseite' bietet keine zusätzliche Marketing-Einwilligung an (ihr Zweck IST bereits
    // marketing_email). Ein `marketing: true` darf deshalb keine ZWEITE Einwilligung erzeugen.
    await runLeadCapture(
      { sourceKey: 'branchenseite', values: { email: 'jemand@example.test' }, marketing: true },
      effects,
      CONTEXT,
    )

    expect(recorded.calls).toHaveLength(1)
    expect(recorded.calls[0]!.purpose).toBe('marketing_email')
  })

  it('ein Eintrag mit zusätzlicher Einwilligung schreibt ZWEI Zwecke — aber nur wenn angekreuzt', async () => {
    // Ohne Häkchen: nur der Zweck des Eintrags.
    const ohne = fakeEffects(['consent_confirmed'])
    await runLeadCapture(
      { sourceKey: 'rechnerergebnis', values: { email: 'jemand@example.test' } },
      ohne.effects,
      CONTEXT,
    )
    expect(ohne.recorded.calls.map((call) => call.purpose)).toEqual(['result_delivery'])

    // Mit Häkchen: zusätzlich die Marketing-Einwilligung, als EIGENER Aufruf mit eigenem Token.
    const mit = fakeEffects(['consent_confirmed', 'consent_created'])
    await runLeadCapture(
      { sourceKey: 'rechnerergebnis', values: { email: 'jemand@example.test' }, marketing: true },
      mit.effects,
      CONTEXT,
    )
    expect(mit.recorded.calls.map((call) => call.purpose)).toEqual([
      'result_delivery',
      'marketing_email',
    ])
    // Der bestätigungspflichtige Zweck bekommt einen Token, der andere nicht — die Entscheidung
    // trifft die Datenbank, der Ablauf reicht ihn nur an.
    expect(mit.recorded.calls[1]!.tokenHash).toBe('hash')
    expect(mit.recorded.confirmationMails).toBe(1)
  })
})

describe('(9) die Rückmeldung verrät nichts über den Bestand', () => {
  const submission = {
    sourceKey: 'rechnerergebnis',
    values: { email: 'jemand@example.test' },
  }

  async function respondFor(outcome: CaptureOutcome): Promise<LeadCaptureResponse> {
    const { effects } = fakeEffects([outcome])
    return runLeadCapture(submission, effects, CONTEXT)
  }

  it('ist bei gesperrter, bekannter und unbekannter Adresse dieselbe', async () => {
    const gesperrt = await respondFor('suppressed')
    const laufendeBestaetigung = await respondFor('consent_already_pending')
    const neu = await respondFor('consent_confirmed')

    expect(gesperrt).toEqual({ ok: true })
    expect(gesperrt).toEqual(neu)
    expect(laufendeBestaetigung).toEqual(neu)
  })

  it('bleibt dieselbe, wenn die Datenbank ganz ausfällt', async () => {
    const { effects, recorded } = fakeEffects()
    effects.captureLead = async () => {
      throw new Error('Datenbank nicht erreichbar')
    }

    // „Unbekannter Zustand" darf sich nicht als „diese Adresse kennen wir nicht" lesen — und schon
    // gar nicht als Fehlermeldung, die zum erneuten Absenden einlädt.
    expect(await runLeadCapture(submission, effects, CONTEXT)).toEqual({ ok: true })
    expect(recorded.resultMails).toBe(0)
  })

  it('löst bei gesperrter Adresse KEINEN Versand aus', async () => {
    const { effects, recorded } = fakeEffects(['suppressed'])

    await runLeadCapture(
      {
        ...submission,
        calculator: { peakKw: 500, reductionKw: 100, pricePerKwYear: 120 },
      },
      effects,
      CONTEXT,
    )

    expect(recorded.resultMails).toBe(0)
    expect(recorded.confirmationMails).toBe(0)
  })
})

describe('Versand hängt am outcome, nicht am Zweck', () => {
  it("'consent_confirmed' liefert das Ergebnis sofort aus", async () => {
    const { effects, recorded } = fakeEffects(['consent_confirmed'])

    await runLeadCapture(
      {
        sourceKey: 'rechnerergebnis',
        values: { email: 'jemand@example.test' },
        calculator: { peakKw: 500, reductionKw: 100, pricePerKwYear: 120 },
      },
      effects,
      CONTEXT,
    )

    expect(recorded.resultMails).toBe(1)
    expect(recorded.confirmationMails).toBe(0)
  })

  it("'consent_created' schickt NUR die Bestätigungsmail, nie die Leistung", async () => {
    const { effects, recorded } = fakeEffects(['consent_created'])

    await runLeadCapture(
      {
        sourceKey: 'rechnerergebnis',
        values: { email: 'jemand@example.test' },
        calculator: { peakKw: 500, reductionKw: 100, pricePerKwYear: 120 },
      },
      effects,
      CONTEXT,
    )

    expect(recorded.confirmationMails).toBe(1)
    expect(recorded.resultMails).toBe(0)
  })

  it('ein Fehlversand des Ergebnisses bricht den Vorgang nicht ab', async () => {
    const { effects, recorded } = fakeEffects(['consent_confirmed'])
    effects.sendResultMail = async () => {
      throw new Error('Resend nicht erreichbar')
    }

    const response = await runLeadCapture(
      {
        sourceKey: 'rechnerergebnis',
        values: { email: 'jemand@example.test' },
        calculator: { peakKw: 500, reductionKw: 100, pricePerKwYear: 120 },
      },
      effects,
      CONTEXT,
    )

    // Der Lead steht; ein verlorenes Ergebnis wiegt leichter als ein verlorener Lead.
    expect(response).toEqual({ ok: true })
    expect(recorded.calls).toHaveLength(1)
  })
})

describe('Missbrauchsschutz und Feldprüfung', () => {
  it('ein gefüllter Honeypot wird abgelehnt, ohne die Datenbank anzufassen', async () => {
    const { effects, recorded } = fakeEffects()

    const response = await runLeadCapture(
      {
        sourceKey: 'artikel-inline',
        values: { email: 'jemand@example.test' },
        website: 'https://spam.example',
      },
      effects,
      CONTEXT,
    )

    expect(response).toEqual({ ok: false, error: 'spam' })
    expect(recorded.calls).toHaveLength(0)
  })

  it('eine ungültige Adresse wird feldgenau gemeldet — das kann der Absender selbst beheben', async () => {
    const { effects, recorded } = fakeEffects()

    const response = await runLeadCapture(
      { sourceKey: 'artikel-inline', values: { email: 'kein-mail' } },
      effects,
      CONTEXT,
    )

    expect(response).toEqual({
      ok: false,
      error: 'validation',
      fieldErrors: { email: 'emailInvalid' },
    })
    expect(recorded.calls).toHaveLength(0)
  })

  it('die Segmentierungsfelder erreichen capture_lead in der Form, die es erwartet', async () => {
    const { effects, recorded } = fakeEffects(['consent_confirmed'])

    await runLeadCapture(
      {
        sourceKey: 'betroffenheits-check',
        values: {
          email: 'jemand@example.test',
          postalCode: '1100',
          // Mit Tausenderpunkt getippt — die Prüfung normalisiert, sonst wäre es ungültig.
          annualConsumptionKwh: '184.500',
          industry: 'kuehlhaus',
        },
      },
      effects,
      CONTEXT,
    )

    expect(recorded.calls).toHaveLength(1)
    expect(recorded.calls[0]).toMatchObject({
      postalCode: '1100',
      annualConsumptionKwh: 184500,
      industry: 'kuehlhaus',
    })
  })
})
