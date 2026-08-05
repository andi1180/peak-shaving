/**
 * DAS THEMA AUF DEM WEG IN DEN BESTAND — der Endpunkt-Teil.
 *
 * ── WAS HIER GEPRÜFT WIRD UND WAS BEWUSST NICHT ──────────────────────────────────────────────────
 * Was die Datenbank aus dem Wert macht (Speicherung, Zusammenführung, Anonymisierung, die zwei
 * Lesewege), steht in `packages/db-tests/src/lead-thema.test.ts` und wird dort gegen eine echte
 * Datenbank gemessen.
 *
 * Was NUR hier prüfbar ist: dass der SCHLÜSSEL weitergereicht wird und nicht das übersetzte Label.
 * Beide Werte existieren an genau dieser Stelle nebeneinander (`findThema` liefert den Eintrag,
 * `getTranslations` das Label für die interne Mail) — die Verwechslung wäre in keinem Test der
 * Datenbank sichtbar: die Spalte trägt bewusst keinen CHECK, ein Label liefe also glatt durch und
 * stünde ab dann als zweite, veraltende Kopie von `messages/*.json` im Bestand.
 *
 * Zweitens: dass die Angabe AUSSCHLIESSLICH aus dem Formular stammt und nicht aus einer
 * Vorbelegung — ein Rückfallwert machte aus „kein Thema angegeben" still ein „Thema X".
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

/*
 * Das Label ist hier bewusst UNVERWECHSELBAR anders als der Schlüssel. Mit einer Attrappe, die den
 * Schlüssel zurückgibt, wäre der Test wertlos — er könnte Schlüssel und Label nicht unterscheiden,
 * also genau das nicht, worum es geht.
 */
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => `LABEL(${key})`,
}))

const { POST: kontaktPost } = await import('@/app/api/kontakt/route')
const { POST: partnerPost } = await import('@/app/api/partner/[slug]/kontakt/route')

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

const KONTAKT_URL = 'https://coolin.at/api/kontakt'
const PARTNER_URL = 'https://coolin.at/api/partner/raymann/kontakt'

beforeEach(() => {
  mocks.deliverKontakt.mockReset()
  mocks.captureKontaktLead.mockReset()
  mocks.resolvePartnerAttribution.mockReset()
  mocks.verifyTurnstile.mockReset()

  mocks.verifyTurnstile.mockResolvedValue({ ok: true })
  mocks.deliverKontakt.mockResolvedValue({ ok: true, id: 'mail_1' })
  mocks.captureKontaktLead.mockResolvedValue(undefined)
  mocks.resolvePartnerAttribution.mockResolvedValue({
    sourceKey: 'kontaktformular',
    partnerSlug: null,
    partnerDisplayName: null,
  })
})

describe('das gewählte Thema wandert in die Erfassung', () => {
  it('reicht den SCHLÜSSEL weiter, nicht das übersetzte Label', async () => {
    const res = await kontaktPost(request(KONTAKT_URL, payload({ thema: 'esg' })))

    expect(res.status).toBe(200)
    expect(mocks.captureKontaktLead).toHaveBeenCalledTimes(1)

    const call = mocks.captureKontaktLead.mock.calls[0]![0]
    expect(call.thema).toBe('esg')

    /*
     * Die Gegenprobe: dieselbe Absendung erzeugt für die interne Mail ein Label. Stünde es in der
     * Erfassung, wäre der Bestand ab dann sprachabhängig — und eine Auswertung über zwei Sprachen
     * zerfiele in zwei Gruppen für dieselbe Sache.
     */
    expect(mocks.deliverKontakt.mock.calls[0]![1]).toBe('LABEL(esg)')
    expect(call.thema).not.toContain('LABEL')
  })

  it('gilt für jedes Thema der Liste — auch für die zwei, die keine Leistung sind', async () => {
    for (const key of ['peakShaving', 'sonstiges', 'pvSpeicher']) {
      mocks.captureKontaktLead.mockClear()
      await kontaktPost(request(KONTAKT_URL, payload({ thema: key })))
      expect(mocks.captureKontaktLead.mock.calls[0]![0].thema).toBe(key)
    }
  })

  it('die Partner-Landingpage schreibt es ebenfalls — beide Endpunkte teilen sich den Ablauf', async () => {
    mocks.resolvePartnerAttribution.mockResolvedValue({
      sourceKey: 'partner-empfehlung',
      partnerSlug: 'raymann',
      partnerDisplayName: 'Raymann Elektrotechnik GmbH',
    })

    await partnerPost(request(PARTNER_URL, payload({ thema: 'smartHeating' })), {
      params: Promise.resolve({ slug: 'raymann' }),
    })

    expect(mocks.captureKontaktLead.mock.calls[0]![0]).toMatchObject({
      sourceKey: 'partner-empfehlung',
      partnerSlug: 'raymann',
      thema: 'smartHeating',
    })
  })

  it('ein unbekanntes Thema wird abgewiesen — es entsteht kein Lead und keine Mail', async () => {
    /*
     * Die Spalte trägt bewusst keinen CHECK; geprüft wird dort, wo die Werteliste ENTSTEHT
     * (`kontaktSchema` mit `z.enum(THEMA_KEYS)`). Dieser Test hält fest, dass diese eine Prüfung
     * tatsächlich davor liegt — sonst stünde ein frei erfundener Wert im Bestand.
     */
    const res = await kontaktPost(request(KONTAKT_URL, payload({ thema: 'erfunden' })))

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ ok: false, error: 'validation' })
    expect(mocks.captureKontaktLead).not.toHaveBeenCalled()
    expect(mocks.deliverKontakt).not.toHaveBeenCalled()
  })

  it('ohne Thema kommt die Anfrage gar nicht durch — es gibt keinen Rückfallwert', async () => {
    const { thema: _weggelassen, ...ohneThema } = payload()
    const res = await kontaktPost(request(KONTAKT_URL, ohneThema))

    expect(res.status).toBe(400)
    expect(mocks.captureKontaktLead).not.toHaveBeenCalled()
  })
})
