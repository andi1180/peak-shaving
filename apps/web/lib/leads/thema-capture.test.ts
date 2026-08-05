/**
 * DAS THEMA AUF DEM WEG IN DEN BESTAND — der Erfassungsteil (`captureKontaktLead`).
 *
 * ── WAS HIER GEPRÜFT WIRD UND WAS BEWUSST NICHT ──────────────────────────────────────────────────
 * Dass der Endpunkt den SCHLÜSSEL und nicht das Label übergibt, misst `lib/kontakt/thema.test.ts`.
 * Was die Datenbank daraus macht, misst `packages/db-tests/src/lead-thema.test.ts`.
 *
 * Was NUR hier prüfbar ist: dass der Wert die letzte Station vor der Datenbank tatsächlich erreicht
 * — und dass sein FEHLEN als `null` ankommt und nicht als Leerstring. Ein `''` ist kein `null`, es
 * überlebt jedes COALESCE; über einen zweiten Kontakt derselben Person würde damit ein zuvor
 * genanntes Thema still verdrängt. Die Datenbank fängt das ab (`nullif(btrim(...), '')`), aber das
 * ist die zweite Verteidigungslinie, nicht die Aussage dieses Moduls.
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

function input(extra: Record<string, unknown> = {}) {
  return {
    email: 'anna@example.test',
    firstName: 'Anna',
    lastName: 'Gruber',
    company: 'Tischlerei Gruber',
    phone: '+43 660 1234567',
    wantsMarketingEmail: false,
    ...extra,
  }
}

beforeEach(() => {
  mocks.captureLead.mockReset()
  mocks.getActiveConsentText.mockReset()
  mocks.createConfirmationToken.mockReset()
  mocks.sendConsentConfirmationMail.mockReset()

  mocks.captureLead.mockResolvedValue({ outcome: 'lead_only', leadId: 'lead-1', consentId: null })
})

describe('captureKontaktLead — das Thema', () => {
  it('reicht es unverändert an den Datenbank-Rand weiter', async () => {
    await captureKontaktLead(input({ thema: 'peakShaving' }))

    expect(mocks.captureLead).toHaveBeenCalledTimes(1)
    expect(mocks.captureLead.mock.calls[0]![0]).toMatchObject({
      email: 'anna@example.test',
      sourceKey: 'kontaktformular',
      thema: 'peakShaving',
    })
  })

  it('ohne Thema kommt `null` an — kein Leerstring, keine Vorbelegung', async () => {
    await captureKontaktLead(input())

    const call = mocks.captureLead.mock.calls[0]![0]
    expect(call.thema).toBeNull()
    expect(call.thema).not.toBe('')
  })

  it('der zweite Aufruf für die Partner-Freigabe trägt es NICHT noch einmal', async () => {
    /*
     * Dieselbe Überlegung wie bei den Identitätsfeldern (B18-6): Der zweite Aufruf schreibt eine
     * EINWILLIGUNG, nicht die Angaben. Das Thema erneut mitzuschicken änderte nichts (es ist
     * derselbe Wert) und liesse den Aufruf so aussehen, als könnte er es — beim nächsten Umbau
     * wäre nicht mehr erkennbar, welcher der beiden Aufrufe die Angabe führt.
     */
    mocks.captureLead.mockResolvedValue({ outcome: 'lead_only', leadId: 'lead-1', consentId: null })

    await captureKontaktLead(
      input({
        thema: 'esg',
        wantsPartnerDisclosure: true,
        sourceKey: 'partner-empfehlung',
        partnerSlug: 'raymann',
      }),
    )

    expect(mocks.captureLead).toHaveBeenCalledTimes(2)
    expect(mocks.captureLead.mock.calls[0]![0].thema).toBe('esg')

    const second = mocks.captureLead.mock.calls[1]![0]
    expect(second.purpose).toBe('partner_lead_disclosure')
    expect(second.thema).toBeUndefined()
  })
})
