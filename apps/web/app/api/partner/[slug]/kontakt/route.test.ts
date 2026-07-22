/**
 * Die beiden Kontakt-Endpunkte (B16-2) — `/api/kontakt` und `/api/partner/<slug>/kontakt`.
 *
 * ── WAS HIER GEPRÜFT WIRD UND WAS BEWUSST NICHT ──────────────────────────────────────────────────
 * Ob es einen Fachbetrieb gibt und was `public.capture_lead` mit einem Slug macht, steht in der
 * Datenbank und wird dort geprüft (`packages/db-tests/src/partner-*.test.ts`). Welcher der beiden
 * möglichen Slugs GILT, prüft `lib/leads/attribution.test.ts`.
 *
 * Was NUR hier prüfbar ist: dass die AUFTEILUNG der beiden Endpunkte stimmt — dass der eine seinen
 * Slug aus dem PFAD nimmt und ein `partner` im Rumpf dabei gar nicht erst ansieht, dass der andere
 * genau umgekehrt verfährt, und dass der Freitext „Empfohlen durch" in `referredByText` landet und
 * NIEMALS in `partnerSlug`. Das ist die Manipulationsprobe: Ein Formularfeld darf die Zuordnung
 * nicht bestimmen, an der später die Vergabe eines Montageprojekts hängt.
 *
 * ── WARUM DIE MODULE ERSETZT WERDEN ──────────────────────────────────────────────────────────────
 * `lib/kontakt/deliver`, `lib/leads/capture` und `lib/kontakt/turnstile` tragen `server-only` bzw.
 * lesen Secrets — ein Import davon würde ausserhalb der React-Server-Umgebung hart werfen. Die
 * Ersetzung ist die Voraussetzung dafür, die ECHTEN Handler aufzurufen statt einer nachgebauten
 * Kopie ihrer Logik. Was sie mitschreiben, IST der Beweis.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deliverKontakt: vi.fn(),
  captureKontaktLead: vi.fn(),
  resolvePartnerAttribution: vi.fn(),
  verifyTurnstile: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('@/lib/kontakt/deliver', () => ({ deliverKontakt: mocks.deliverKontakt }))

vi.mock('@/lib/leads/capture', () => ({
  captureKontaktLead: mocks.captureKontaktLead,
  resolvePartnerAttribution: mocks.resolvePartnerAttribution,
}))

vi.mock('@/lib/kontakt/turnstile', () => ({ verifyTurnstile: mocks.verifyTurnstile }))

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => `label:${key}`,
}))

const { POST: partnerPost } = await import('./route')
const { POST: kontaktPost } = await import('@/app/api/kontakt/route')

/** Eine vollständige, gültige Absendung. Einzelne Felder überschreiben die Tests gezielt. */
function payload(extra: Record<string, unknown> = {}) {
  return {
    vorname: 'Anna',
    nachname: 'Gruber',
    email: 'anna@example.test',
    thema: 'peakShaving',
    nachricht: 'Wir haben eine Tischlerei mit drei Kompressoren und hohe Netzkosten.',
    datenschutz: true,
    locale: 'de',
    ...extra,
  }
}

function request(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const PARTNER_URL = 'https://coolin.at/api/partner/raymann/kontakt'
const KONTAKT_URL = 'https://coolin.at/api/kontakt'

function partnerParams(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

beforeEach(() => {
  mocks.deliverKontakt.mockReset()
  mocks.captureKontaktLead.mockReset()
  mocks.resolvePartnerAttribution.mockReset()
  mocks.verifyTurnstile.mockReset()

  mocks.verifyTurnstile.mockResolvedValue({ ok: true })
  mocks.deliverKontakt.mockResolvedValue({ ok: true, id: 'mail_1' })
  mocks.captureKontaktLead.mockResolvedValue(undefined)
  mocks.resolvePartnerAttribution.mockResolvedValue({
    sourceKey: 'partner-empfehlung',
    partnerSlug: 'raymann',
    partnerDisplayName: 'Raymann Elektrotechnik GmbH',
  })
})

describe('POST /api/partner/<slug>/kontakt', () => {
  it('der Slug kommt aus dem PFAD — ein Rumpf-Slug wird nicht einmal weitergereicht', async () => {
    /*
     * DIE MANIPULATIONSPROBE. Der Client behauptet einen anderen Fachbetrieb; der Handler reicht
     * ausschliesslich den Pfad weiter und setzt `querySlug` ausdrücklich auf null — die Auflösung
     * bekommt den vom Browser gestellten Wert gar nicht zu sehen.
     */
    const res = await partnerPost(
      request(PARTNER_URL, payload({ partner: 'fremder-betrieb' })),
      partnerParams('raymann'),
    )

    expect(res.status).toBe(200)
    expect(mocks.resolvePartnerAttribution).toHaveBeenCalledWith({
      pathSlug: 'raymann',
      querySlug: null,
    })
    expect(mocks.captureKontaktLead).toHaveBeenCalledTimes(1)
    expect(mocks.captureKontaktLead.mock.calls[0]![0]).toMatchObject({
      sourceKey: 'partner-empfehlung',
      partnerSlug: 'raymann',
    })
  })

  it('die Zuordnung fährt auch in die interne Mail — wer antwortet, sieht den Fachbetrieb sofort', async () => {
    await partnerPost(request(PARTNER_URL, payload()), partnerParams('raymann'))

    expect(mocks.deliverKontakt).toHaveBeenCalledTimes(1)
    expect(mocks.deliverKontakt.mock.calls[0]![2]).toEqual({
      partnerDisplayName: 'Raymann Elektrotechnik GmbH',
      partnerSlug: 'raymann',
      referredByText: null,
    })
  })

  it('ein stillgelegter Fachbetrieb kostet KEINE Anfrage — der Lead entsteht ohne Zuordnung', async () => {
    /*
     * Anders als die SEITE (die mit 404 antwortet): Hier steht ein ausgefülltes Formular auf dem
     * Spiel. Wird ein Betrieb stillgelegt, während seine Mail noch in Postfächern liegt, muss die
     * Anfrage ankommen — nur eben ohne Zuordnung und unter der Herkunft des Kontaktformulars.
     */
    mocks.resolvePartnerAttribution.mockResolvedValue({
      sourceKey: 'kontaktformular',
      partnerSlug: null,
      partnerDisplayName: null,
    })

    const res = await partnerPost(request(PARTNER_URL, payload()), partnerParams('stillgelegt'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mocks.captureKontaktLead).toHaveBeenCalledTimes(1)
    expect(mocks.captureKontaktLead.mock.calls[0]![0]).toMatchObject({
      sourceKey: 'kontaktformular',
      partnerSlug: null,
    })
  })

  it('Honeypot: keine Zustellung, keine Erfassung, keine Zuordnung', async () => {
    const res = await partnerPost(
      request(PARTNER_URL, payload({ website: 'https://spam.test' })),
      partnerParams('raymann'),
    )

    expect(res.status).toBe(400)
    expect(mocks.deliverKontakt).not.toHaveBeenCalled()
    expect(mocks.captureKontaktLead).not.toHaveBeenCalled()
    expect(mocks.resolvePartnerAttribution).not.toHaveBeenCalled()
  })

  it('gescheiterte Zustellung: KEIN Lead — der Absender sieht einen Fehler, kein stiller Erfolg', async () => {
    mocks.deliverKontakt.mockResolvedValue({ ok: false, reason: 'send_failed' })

    const res = await partnerPost(request(PARTNER_URL, payload()), partnerParams('raymann'))

    expect(res.status).toBe(502)
    expect(mocks.captureKontaktLead).not.toHaveBeenCalled()
  })
})

describe('POST /api/kontakt — der ?partner=-Weg und das Freitextfeld', () => {
  beforeEach(() => {
    mocks.resolvePartnerAttribution.mockResolvedValue({
      sourceKey: 'kontaktformular',
      partnerSlug: 'raymann',
      partnerDisplayName: 'Raymann Elektrotechnik GmbH',
    })
  })

  it('ohne Pfad gilt der Rumpf — `partner` wird als Vorschlag weitergereicht', async () => {
    const res = await kontaktPost(request(KONTAKT_URL, payload({ partner: 'raymann' })))

    expect(res.status).toBe(200)
    expect(mocks.resolvePartnerAttribution).toHaveBeenCalledWith({
      pathSlug: null,
      querySlug: 'raymann',
    })
  })

  it('ohne alles: unveränderte Kontaktanfrage, keine Zuordnung angefragt', async () => {
    mocks.resolvePartnerAttribution.mockResolvedValue({
      sourceKey: 'kontaktformular',
      partnerSlug: null,
      partnerDisplayName: null,
    })

    const res = await kontaktPost(request(KONTAKT_URL, payload()))

    expect(res.status).toBe(200)
    expect(mocks.resolvePartnerAttribution).toHaveBeenCalledWith({
      pathSlug: null,
      querySlug: null,
    })
    expect(mocks.captureKontaktLead.mock.calls[0]![0]).toMatchObject({
      sourceKey: 'kontaktformular',
      partnerSlug: null,
      referredByText: null,
    })
  })

  it('der Freitext landet in `referredByText` — NIEMALS in `partnerSlug`', async () => {
    /*
     * Die fachliche Achse von B16-1: Die Kundenangabe ist eine BEOBACHTUNG, die Zuordnung ein
     * URTEIL. Ein Freitext, der zufällig wie ein Slug aussieht, darf trotzdem keine Zuordnung
     * erzeugen — sonst entschiede eine Schreibweise darüber, wer ein Projekt bekommt.
     */
    mocks.resolvePartnerAttribution.mockResolvedValue({
      sourceKey: 'kontaktformular',
      partnerSlug: null,
      partnerDisplayName: null,
    })

    await kontaktPost(request(KONTAKT_URL, payload({ empfehlung: 'raymann' })))

    const captured = mocks.captureKontaktLead.mock.calls[0]![0]
    expect(captured.referredByText).toBe('raymann')
    expect(captured.partnerSlug).toBeNull()
  })

  it('ein leer abgeschicktes Freitextfeld wird zu null, nicht zu einem Leerstring', async () => {
    /*
     * Ein '' erfüllt kein COALESCE und überschriebe in `capture_lead` eine früher erhobene, echte
     * Angabe (die Falle ist seit B3-1 dokumentiert). Deshalb wird hier normalisiert, nicht dort
     * gehofft.
     */
    mocks.resolvePartnerAttribution.mockResolvedValue({
      sourceKey: 'kontaktformular',
      partnerSlug: null,
      partnerDisplayName: null,
    })

    await kontaktPost(request(KONTAKT_URL, payload({ empfehlung: '   ' })))

    expect(mocks.captureKontaktLead.mock.calls[0]![0].referredByText).toBeNull()
  })

  it('ein zu langer Freitext ist ein FELD-Fehler und kostet keine stille Anfrage', async () => {
    const res = await kontaktPost(
      request(KONTAKT_URL, payload({ empfehlung: 'x'.repeat(201) })),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      ok: false,
      error: 'validation',
      fieldErrors: { empfehlung: 'empfehlungTooLong' },
    })
    expect(mocks.deliverKontakt).not.toHaveBeenCalled()
  })
})
