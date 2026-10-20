/*
 * Anfrage zum Profi-Report (Leadgen 4b) über die echte Server Action: Datenbank-Rand und Resend
 * ersetzt, Ablauf, Mailtexte und Verdrahtung echt.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const LEAD_ID = '55555555-5555-4555-8555-555555555555'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  captureLead: vi.fn(),
  recordProfiReportRequest: vi.fn(),
  resolvePartnerAttribution: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7', 'user-agent': 'vitest' }),
}))
vi.mock('@/lib/env.server', () => ({ serverEnv: { RESEND_API_KEY: 'test-key' } }))
vi.mock('@/lib/kontakt/turnstile', () => ({ verifyTurnstile: async () => ({ ok: true }) }))
vi.mock('@/lib/leads/store', () => ({
  captureLead: mocks.captureLead,
  recordProfiReportRequest: mocks.recordProfiReportRequest,
}))
vi.mock('@/lib/leads/capture', () => ({
  resolvePartnerAttribution: mocks.resolvePartnerAttribution,
}))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.send }
  },
}))

const { submitProfiReportAction } = await import('./actions')

const SUBMISSION = {
  firma: 'Muster Gastro GmbH',
  vorname: 'Anna',
  nachname: 'Beispiel',
  email: 'anna@test.local',
  telefon: '',
  lastgang: 'ja',
  nachricht: 'Wir haben zwei Kühlräume.',
}

type Sent = { to: string; subject: string; text: string; replyTo?: string }
const sent = () => mocks.send.mock.calls.map((call) => call[0] as Sent)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.send.mockResolvedValue({ data: { id: 'mail-1' }, error: null })
  mocks.captureLead.mockResolvedValue({ outcome: 'lead_only', leadId: LEAD_ID, consentId: null })
  mocks.recordProfiReportRequest.mockResolvedValue({ status: 'created' })
  mocks.resolvePartnerAttribution.mockResolvedValue({
    partnerSlug: 'raymann',
    partnerDisplayName: 'Raymann Elektrotechnik GmbH',
  })
})

describe('Profi-Report-Anfrage', () => {
  it('legt den Lead unter profi-report-anfrage an, bestätigt dem Kunden und benachrichtigt energy@coolin.at', async () => {
    expect(await submitProfiReportAction(SUBMISSION)).toEqual({ ok: true })

    const call = mocks.captureLead.mock.calls[0]![0]
    expect(call).toMatchObject({
      sourceKey: 'profi-report-anfrage',
      thema: 'profiReport',
      email: 'anna@test.local',
      company: 'Muster Gastro GmbH',
      firstName: 'Anna',
      lastName: 'Beispiel',
      partnerSlug: null,
    })
    // Erbetene Kontaktaufnahme: keine Einwilligung, keine Werbe-Einwilligung.
    expect(call.purpose).toBeUndefined()
    expect(mocks.recordProfiReportRequest).toHaveBeenCalledWith({
      leadId: LEAD_ID,
      hasLoadProfile: 'ja',
      windowSeconds: 900,
    })

    const [confirmation, notice] = sent()
    expect(confirmation!.to).toBe('anna@test.local')
    expect(confirmation!.text).toContain('Guten Tag Anna Beispiel,')
    expect(confirmation!.text).toContain(
      'Danke für Ihre Anfrage, wir melden uns innerhalb eines Werktags per E-Mail.',
    )
    expect(confirmation!.text).toContain('Martin Neubauer')

    expect(notice!.to).toBe('energy@coolin.at')
    expect(notice!.replyTo).toBe('anna@test.local')
    expect(notice!.text).toContain('Lastgang vorhanden: ja')
    expect(notice!.text).toContain('Wir haben zwei Kühlräume.')
    expect(notice!.text).toContain(`/admin/leads/${LEAD_ID}`)
  })

  it('übernimmt den Partner aus ?partner=', async () => {
    await submitProfiReportAction({ ...SUBMISSION, partnerSlug: 'raymann' })

    expect(mocks.resolvePartnerAttribution).toHaveBeenCalledWith({ querySlug: 'raymann' })
    expect(mocks.captureLead.mock.calls[0]![0].partnerSlug).toBe('raymann')
    expect(sent()[1]!.text).toContain('Partner: Raymann Elektrotechnik GmbH (raymann)')
  })

  it('fängt die Doppelabsendung ab und verschickt nichts', async () => {
    mocks.recordProfiReportRequest.mockResolvedValue({ status: 'duplicate' })

    expect(await submitProfiReportAction(SUBMISSION)).toEqual({ ok: false, error: 'duplicate' })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('schreibt einer gesperrten Adresse nicht, meldet die Anfrage aber intern', async () => {
    mocks.captureLead.mockResolvedValue({ outcome: 'suppressed', leadId: LEAD_ID, consentId: null })

    expect(await submitProfiReportAction(SUBMISSION)).toEqual({ ok: true })
    expect(sent().map((mail) => mail.to)).toEqual(['energy@coolin.at'])
    expect(sent()[0]!.text).toContain('nicht versendet (Adresse gesperrt)')
  })
})
