/**
 * DIE FREIGABE AN DEN FACHBETRIEB IM SCHREIBWEG (B18-6) — `captureKontaktLead`.
 *
 * ── WAS HIER GEPRÜFT WIRD UND WAS BEWUSST NICHT ──────────────────────────────────────────────────
 * Was die Datenbank aus dem zweiten Aufruf macht (Einwilligung sofort `confirmed`, kein Token, kein
 * zweiter Lead) und wer sie danach sehen darf, steht in `packages/db-tests/src/partner-lead-disclosure.test.ts`.
 * OB die Freigabe überhaupt angenommen werden darf (nur von der Landingpage, nur mit aufgelöstem
 * Betrieb), steht in `app/api/partner/[slug]/kontakt/route.test.ts`.
 *
 * Was NUR hier prüfbar ist: dass aus einer angekreuzten Freigabe ein ZWEITER `capture_lead`-Aufruf
 * wird statt eines zweiten Zwecks am ersten — und dass dieser zweite Aufruf nichts umwerfen kann,
 * was vor ihm bereits gelungen ist. Das ist die Fehlerrichtung, auf die es ankommt: Ohne
 * Einwilligung zählt die Anfrage im Portal mit, trägt aber keinen Namen; das ist derselbe Zustand
 * wie bei einem nicht angekreuzten Kästchen. Zu viel anzuzeigen wäre der einzige unumkehrbare
 * Fehler.
 *
 * ── WARUM DIE MODULE ERSETZT WERDEN ──────────────────────────────────────────────────────────────
 * `lib/leads/store.ts` trägt `import 'server-only'` und erzeugt einen service_role-Client — ein
 * Import davon würde ausserhalb der React-Server-Umgebung hart werfen. Die Ersetzung ist die
 * Voraussetzung dafür, die ECHTE Funktion aufzurufen statt einer nachgebauten Kopie ihrer Logik.
 * Was sie an `captureLead` weiterreicht, IST der Beweis.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  captureLead: vi.fn(),
  getActiveConsentText: vi.fn(),
  createConfirmationToken: vi.fn(),
  sendConsentConfirmationMail: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('./store', () => ({
  captureLead: mocks.captureLead,
  getActiveConsentText: mocks.getActiveConsentText,
  getActivePartner: vi.fn(),
}))

vi.mock('./mail', () => ({ sendConsentConfirmationMail: mocks.sendConsentConfirmationMail }))
vi.mock('./tokens', () => ({ createConfirmationToken: mocks.createConfirmationToken }))
vi.mock('next-intl/server', () => ({ getLocale: async () => 'de' }))
vi.mock('@/lib/site', () => ({ absoluteUrl: (path: string) => `https://coolin.at${path}` }))

const { captureKontaktLead } = await import('./capture')

/** Eine Absendung von der Partner-Landingpage. Einzelne Felder überschreiben die Tests gezielt. */
function input(extra: Record<string, unknown> = {}) {
  return {
    email: 'anna@example.test',
    firstName: 'Anna',
    lastName: 'Gruber',
    company: 'Tischlerei Gruber',
    phone: '+43 660 1234567',
    wantsMarketingEmail: false,
    sourceKey: 'partner-empfehlung',
    partnerSlug: 'raymann',
    sourceIp: '203.0.113.9',
    userAgent: 'probe/1.0',
    ...extra,
  }
}

beforeEach(() => {
  mocks.captureLead.mockReset()
  mocks.getActiveConsentText.mockReset()
  mocks.createConfirmationToken.mockReset()
  mocks.sendConsentConfirmationMail.mockReset()

  mocks.captureLead.mockResolvedValue({
    outcome: 'lead_only',
    leadId: 'lead-1',
    consentId: null,
  })
  mocks.createConfirmationToken.mockReturnValue({
    token: 'klartext',
    tokenHash: 'hash',
    expiresAt: new Date('2026-08-11T00:00:00Z'),
  })
  mocks.getActiveConsentText.mockResolvedValue({
    purpose: 'marketing_email',
    version: 1,
    locale: 'de',
    body: 'Wortlaut',
  })
})

describe('captureKontaktLead — die Freigabe an den Fachbetrieb', () => {
  it('angekreuzt: ZWEI Aufrufe — der zweite trägt den Zweck, nicht der erste', async () => {
    /*
     * Der Kern des Musters (B3-2): `capture_lead` schreibt je Aufruf GENAU EINE Einwilligung. Ein
     * erster Aufruf mit zwei Zwecken existiert nicht — und soll auch nicht erfunden werden, weil
     * jede Einwilligung ihre eigene Textfassung und ihren eigenen Zeitpunkt trägt.
     */
    await captureKontaktLead(input({ wantsPartnerDisclosure: true }))

    expect(mocks.captureLead).toHaveBeenCalledTimes(2)

    // Der erste Aufruf ist unverändert der Lead selbst — Rechtsgrundlage Vertragsanbahnung.
    expect(mocks.captureLead.mock.calls[0]![0]).toMatchObject({
      email: 'anna@example.test',
      sourceKey: 'partner-empfehlung',
      partnerSlug: 'raymann',
      purpose: null,
    })

    const second = mocks.captureLead.mock.calls[1]![0]
    expect(second).toMatchObject({
      email: 'anna@example.test',
      sourceKey: 'partner-empfehlung',
      purpose: 'partner_lead_disclosure',
    })
    // Die Nachweisfelder DIESER Einwilligung fahren mit (B1-1: ausschliesslich Nachweis).
    expect(second.sourceIp).toBe('203.0.113.9')
    expect(second.userAgent).toBe('probe/1.0')
  })

  it('kein Token für den zweiten Aufruf — der Zweck ist nicht bestätigungspflichtig', async () => {
    /*
     * `platform.purpose_requires_double_opt_in` schliesst 'partner_lead_disclosure' nicht ein: An
     * den Interessenten geht aus dieser Einwilligung überhaupt keine Mail. Die Datenbank verwürfe
     * einen übergebenen Token seit B3-2 ohnehin — einen zu erzeugen wäre ein Klartext-Geheimnis
     * ohne Zweck.
     */
    await captureKontaktLead(input({ wantsPartnerDisclosure: true }))

    expect(mocks.createConfirmationToken).not.toHaveBeenCalled()
    // Die Felder werden gar nicht erst gesetzt — `store.captureLead` übersetzt fehlend und `null`
    // ohnehin beide zu „nicht übergeben"; ein ausgeschriebenes `null` behauptete eine Entscheidung,
    // die es hier nicht zu treffen gibt.
    const second = mocks.captureLead.mock.calls[1]![0]
    expect(second.tokenHash).toBeUndefined()
    expect(second.tokenExpiresAt).toBeUndefined()
    // Und ganz sicher keine Mail an den Interessenten.
    expect(mocks.sendConsentConfirmationMail).not.toHaveBeenCalled()
  })

  it('NICHT angekreuzt: EIN Aufruf — der Lead entsteht trotzdem', async () => {
    /*
     * Die Einwilligung entscheidet NICHT, ob die Anfrage erfasst wird, sondern nur, ob sie später
     * mit Namen sichtbar ist. Ein nicht angekreuztes Kästchen ist die erwartete Normalantwort.
     */
    await captureKontaktLead(input())

    expect(mocks.captureLead).toHaveBeenCalledTimes(1)
    expect(mocks.captureLead.mock.calls[0]![0]).toMatchObject({ purpose: null })
  })

  it('Freigabe UND Marketing: drei Wirkungen, zwei Aufrufe, eine Bestätigungsmail', async () => {
    mocks.captureLead
      .mockResolvedValueOnce({ outcome: 'consent_created', leadId: 'lead-1', consentId: 'c-1' })
      .mockResolvedValueOnce({ outcome: 'consent_confirmed', leadId: 'lead-1', consentId: 'c-2' })

    await captureKontaktLead(input({ wantsMarketingEmail: true, wantsPartnerDisclosure: true }))

    expect(mocks.captureLead).toHaveBeenCalledTimes(2)
    expect(mocks.captureLead.mock.calls[0]![0]).toMatchObject({ purpose: 'marketing_email' })
    expect(mocks.captureLead.mock.calls[1]![0]).toMatchObject({
      purpose: 'partner_lead_disclosure',
    })
    // Die Bestätigungsmail gehört zum MARKETING-Zweck und geht genau einmal raus.
    expect(mocks.sendConsentConfirmationMail).toHaveBeenCalledTimes(1)
  })

  it('scheitert die Freigabe, bleibt die Bestätigungsmail des Marketings unberührt', async () => {
    /*
     * DIE FEHLERRICHTUNG. Der zweite Aufruf hat sein EIGENES try/catch — nach unten, damit ein
     * Fehlschlag nicht die Mail eines anderen Zwecks verhindert, und nach oben, damit er die längst
     * zugestellte Anfrage nicht umwirft. Ohne eigenes try/catch bräche der gemeinsame Fang die
     * Reihenfolge: Die Mail käme nie, obwohl mit ihr alles in Ordnung war.
     */
    mocks.captureLead
      .mockResolvedValueOnce({ outcome: 'consent_created', leadId: 'lead-1', consentId: 'c-1' })
      .mockRejectedValueOnce(new Error('capture_lead: Datenbank weg'))

    await expect(
      captureKontaktLead(input({ wantsMarketingEmail: true, wantsPartnerDisclosure: true })),
    ).resolves.toBeUndefined()

    expect(mocks.sendConsentConfirmationMail).toHaveBeenCalledTimes(1)
  })
})
