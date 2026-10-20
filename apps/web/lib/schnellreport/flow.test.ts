import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptureOutcome } from '@/lib/leads/config'

// Resend gemockt — keine echte Mail; Datenbank als Attrappe, PDF echt gerendert.
const mocks = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/env.server', () => ({ serverEnv: { RESEND_API_KEY: 'test-key' } }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.send }
  },
}))

const { runSchnellreportSubmit, runSchnellreportCallback } = await import('./flow')
type Effects = import('./flow').SchnellreportEffects
type Call = import('./flow').SchnellreportCaptureCall
const mail = await import('./mail')
const { renderSchnellreportPdf } = await import('./render')
const { createCallbackTicket, verifyCallbackTicket } = await import('./callback-ticket')
const { SCHNELLREPORT_SUBMISSION } = await import('@/lib/test-support/schnellreport')

type SentMail = {
  from: string
  to: string
  subject: string
  text: string
  replyTo?: string
  attachments?: { filename: string; content: Buffer }[]
}
const sent = (): SentMail[] => mocks.send.mock.calls.map((call) => call[0] as SentMail)

const dir = mkdtempSync(path.join(tmpdir(), 'schnellreport-flow-'))
function pdfText(pdf: Buffer): { text: string; pages: number } {
  const file = path.join(dir, `${Math.random().toString(36).slice(2)}.pdf`)
  writeFileSync(file, pdf)
  const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' })
  const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' })
  return { text: text.replace(/\s+/g, ' '), pages: Number(/Pages:\s+(\d+)/.exec(info)?.[1]) }
}

function fakeEffects(opts: { outcomes?: CaptureOutcome[]; duplicate?: boolean } = {}) {
  const calls: Call[] = []
  const confirmations: string[] = []
  const outcomes = opts.outcomes ?? ['consent_confirmed', 'consent_created']
  const effects: Effects = {
    // Ein aktiver Fachbetrieb; jeder andere Slug ist unbekannt oder inaktiv.
    resolvePartner: async (slug) =>
      slug === 'raymann' ? { slug, displayName: 'Raymann Elektrotechnik GmbH' } : null,
    captureLead: async (call) => {
      const outcome = outcomes[Math.min(calls.length, outcomes.length - 1)]!
      calls.push(call)
      return { outcome, leadId: 'lead-1', consentId: 'consent-1' }
    },
    recordRequest: async () => ({ status: opts.duplicate ? 'duplicate' : 'created' }),
    getConsentText: async () => 'Ja, schicken Sie mir … Tipps.',
    createToken: () => ({
      token: 'klartext',
      tokenHash: 'hash',
      expiresAt: new Date('2027-01-01'),
    }),
    sendConfirmationMail: async ({ consentText }) => {
      confirmations.push(consentText)
    },
    renderPdf: renderSchnellreportPdf,
    sendReportMail: mail.sendSchnellreportMail,
    sendTeamNotice: mail.sendSchnellreportTeamNotice,
    signCallbackTicket: (email) => createCallbackTicket('geheim', email),
    now: () => new Date('2026-10-20T10:00:00Z'),
  }
  return { effects, calls, confirmations }
}

beforeEach(() => {
  mocks.send.mockReset()
  mocks.send.mockResolvedValue({ error: null })
})

describe('Absenden', () => {
  it('ohne Tipp-Häkchen: Lead + result_delivery, Report mit 7-seitigem PDF, Benachrichtigung, KEIN marketing_email', async () => {
    const { effects, calls, confirmations } = fakeEffects()
    const response = await runSchnellreportSubmit(SCHNELLREPORT_SUBMISSION, effects)

    expect(response).toMatchObject({ ok: true, email: 'anna.beispiel@example.test' })
    expect(calls.map((c) => c.purpose)).toEqual(['result_delivery'])
    expect(calls[0]).toMatchObject({
      company: 'Muster Metallbau GmbH',
      firstName: 'Anna',
      lastName: 'Beispiel',
      annualConsumptionKwh: 250_000,
      industry: null,
    })
    expect(confirmations).toEqual([])

    const [report, notice] = sent()
    expect(report!.to).toBe('anna.beispiel@example.test')
    expect(report!.replyTo).toBe('energy@coolin.at')
    expect(report!.text).toContain('Guten Tag Anna Beispiel,')
    expect(report!.attachments?.[0]?.filename).toBe('Schnellreport_Muster Metallbau GmbH.pdf')
    expect(pdfText(report!.attachments![0]!.content).pages).toBe(7)

    expect(notice!.to).toBe('energy@coolin.at')
    expect(notice!.text).toContain('Tipp-Mails: nein')
    expect(notice!.text).toContain('/admin/leads/lead-1')
    expect(sent()).toHaveLength(2)
  })

  it('mit Tipp-Häkchen: zusätzlich marketing_email mit Token und Bestätigungsmail', async () => {
    const { effects, calls, confirmations } = fakeEffects()
    await runSchnellreportSubmit({ ...SCHNELLREPORT_SUBMISSION, tips: true }, effects)

    expect(calls.map((c) => c.purpose)).toEqual(['result_delivery', 'marketing_email'])
    expect(calls[1]!.tokenHash).toBe('hash')
    expect(confirmations).toHaveLength(1)
    // Der Report kommt trotzdem — keine Kopplung.
    expect(sent()[0]!.attachments).toHaveLength(1)
  })

  it('Doppelabsendung: kein zweiter Report, keine Benachrichtigung', async () => {
    const { effects } = fakeEffects({ duplicate: true })
    const response = await runSchnellreportSubmit(SCHNELLREPORT_SUBMISSION, effects)

    expect(response).toEqual({ ok: false, error: 'duplicate' })
    expect(sent()).toHaveLength(0)
  })

  it('manipulierte Client-Werte ändern die Zahl im PDF nicht', async () => {
    const { effects } = fakeEffects()
    const manipulated = {
      ...SCHNELLREPORT_SUBMISSION,
      check: { ...SCHNELLREPORT_SUBMISSION.check, peakCostEur: 1, demandPrice: 1 },
      result: { peakCostEur: 1 },
    } as typeof SCHNELLREPORT_SUBMISSION
    await runSchnellreportSubmit(manipulated, effects)

    // 180 kW × 67 €/kW·a = 12.060 € → auf 100 € gerundet 12.100 €.
    const { text } = pdfText(sent()[0]!.attachments![0]!.content)
    expect(text).toContain('12.100')
    expect(sent()[0]!.text).toContain('rund 12.100 €')
  })

  it('gesperrte Adresse: kein Report, aber Benachrichtigung', async () => {
    const { effects } = fakeEffects({ outcomes: ['suppressed'] })
    await runSchnellreportSubmit(SCHNELLREPORT_SUBMISSION, effects)

    expect(sent().map((m) => m.to)).toEqual(['energy@coolin.at'])
    expect(sent()[0]!.text).toContain('Adresse gesperrt')
  })
})

describe('Partnerzuordnung', () => {
  it('gültiger Partner: partner_slug am Lead und Partner in der Benachrichtigung', async () => {
    const { effects, calls } = fakeEffects()
    await runSchnellreportSubmit({ ...SCHNELLREPORT_SUBMISSION, partnerSlug: 'raymann' }, effects)

    expect(calls[0]!.partnerSlug).toBe('raymann')
    expect(sent()[1]!.text).toContain('Partner: Raymann Elektrotechnik GmbH (raymann)')
  })

  it('unbekannter Slug: der Lead entsteht trotzdem, ohne Partner', async () => {
    const { effects, calls } = fakeEffects()
    const response = await runSchnellreportSubmit(
      { ...SCHNELLREPORT_SUBMISSION, partnerSlug: 'gibt-es-nicht' },
      effects,
    )

    expect(response.ok).toBe(true)
    expect(calls[0]!.partnerSlug).toBeNull()
    expect(sent()[1]!.text).toContain('Partner: —')
  })

  it('ohne Partner: unverändert wie 3b-2', async () => {
    const { effects, calls } = fakeEffects()
    await runSchnellreportSubmit(SCHNELLREPORT_SUBMISSION, effects)

    expect(calls[0]!.partnerSlug).toBeNull()
    expect(sent()).toHaveLength(2)
  })
})

describe('Telefonfrage', () => {
  const ticket = createCallbackTicket('geheim', 'anna.beispiel@example.test')

  function callbackEffects() {
    const calls: Call[] = []
    return {
      calls,
      effects: {
        verifyTicket: (email: string, value: string) =>
          verifyCallbackTicket('geheim', email, value),
        captureLead: async (call: Call) => {
          calls.push(call)
          return { outcome: 'consent_confirmed' as const, leadId: 'lead-1', consentId: 'c-2' }
        },
        sendCallbackNotice: mail.sendSchnellreportCallbackNotice,
      },
    }
  }

  it('Ja: offer_contact mit Telefonnummer und Benachrichtigung „Rückruf gewünscht"', async () => {
    const { effects, calls } = callbackEffects()
    const response = await runSchnellreportCallback(
      { email: 'anna.beispiel@example.test', ticket, phone: '+43 676 1234567' },
      effects,
    )

    expect(response).toEqual({ ok: true })
    expect(calls).toEqual([
      { email: 'anna.beispiel@example.test', purpose: 'offer_contact', phone: '+43 676 1234567' },
    ])
    expect(sent()[0]!.subject).toBe('Rückruf gewünscht (Schnellreport)')
    expect(sent()[0]!.to).toBe('energy@coolin.at')
  })

  it('ohne passendes Ticket entsteht keine Einwilligung', async () => {
    const { effects, calls } = callbackEffects()
    const response = await runSchnellreportCallback(
      { email: 'fremd@example.test', ticket, phone: '+43 676 1234567' },
      effects,
    )

    expect(response).toEqual({ ok: false, error: 'unavailable' })
    expect(calls).toHaveLength(0)
    expect(sent()).toHaveLength(0)
  })
})
