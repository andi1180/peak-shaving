/**
 * Die Erinnerungsmail selbst (B4-2, TEIL 3 / Test 16).
 *
 * ── WARUM DIESER TEST DEN ECHTEN VERSANDWEG BAUT UND NICHT NUR EINEN TEXT VERGLEICHT ─────────────
 * Geprüft wird genau das, was einen Massenversand ruiniert, wenn es fehlt: die beiden
 * RFC-8058-Kopfzeilen (bei Gmail und Yahoo für Massenversender PFLICHT) und ein Abmeldelink im
 * Rumpf. Beide entstehen NICHT im Text der Mail, sondern aus `lib/leads/tokens.ts` — dem Helfer, den
 * B1-2 gebaut und bis B4-2 nie verbraucht hat. Ein Test gegen eine nachgebaute Nutzlast würde genau
 * diese Verdrahtung nicht prüfen. Deshalb wird `resend` ersetzt und die ECHTE Nutzlast abgegriffen,
 * die `sendContractReminderMail` diesem SDK übergibt.
 *
 * Ersetzt werden nur die Aussenkanten: `server-only` (wirft ausserhalb der React-Server-Umgebung),
 * `lib/env.server` (Geheimnisse) und `next-intl/server` (kein Request-Kontext im Test). Die
 * Übersetzungsattrappe gibt den Key zurück — geprüft werden Kopfzeilen und Links, nicht die
 * Wortwahl; die steht in `messages/de.json`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const LEAD_ID = '33333333-3333-4333-8333-333333333333'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}))

// `server-only` wirft beim Import ausserhalb einer React-Server-Umgebung. Die Attrappe ist die
// Voraussetzung dafür, das ECHTE Modul zu laden (dasselbe Problem wie in den Cron-Route-Tests).
vi.mock('server-only', () => ({}))

vi.mock('@/lib/env.server', () => ({
  serverEnv: { RESEND_API_KEY: 'test-key', RESEND_FROM: 'COOLiN ENERGY <energy@coolin.at>' },
  requireLeadTokenSecret: () => 'test-token-geheimnis',
}))

/*
 * Die Attrappe gibt den Key zurück UND hängt die eingesetzten Werte an. Der Anhang ist nicht
 * Kosmetik: der Betreff trägt das Vertragsende als Platzhalter (`{date}`), und ohne die Werte wäre
 * nicht prüfbar, ob es dort überhaupt ankommt.
 */
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.send }
  },
}))

const { sendContractReminderMail } = await import('./mail')

type SentMail = {
  to: string
  subject: string
  text: string
  html: string
  headers?: Record<string, string>
}

async function send(): Promise<SentMail> {
  mocks.send.mockResolvedValue({ data: { id: 'mail-1' }, error: null })
  const outcome = await sendContractReminderMail({
    to: 'kunde@test.local',
    locale: 'de',
    leadId: LEAD_ID,
    supplier: 'Testversorger GmbH',
    contractEndDate: '2026-09-30',
  })
  expect(outcome).toEqual({ ok: true })
  return mocks.send.mock.calls[0]![0] as SentMail
}

describe('Vertragsablauf-Erinnerung — Abmeldung (16)', () => {
  beforeEach(() => {
    mocks.send.mockReset()
  })

  it('trägt beide List-Unsubscribe-Kopfzeilen', async () => {
    const mail = await send()

    // `List-Unsubscribe-Post` ist die ZUSAGE, dass die https-URL einen POST ohne Zwischenseite
    // verarbeitet — genau das tut `app/api/abmelden/route.ts` (B1-2).
    expect(mail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')

    const header = mail.headers?.['List-Unsubscribe'] ?? ''
    expect(header).toContain('/api/abmelden')
    // Die mailto-Alternative fährt bewusst mit: ältere Clients kennen One-Click nicht, und eine
    // Abmeldung, die am Client scheitert, ist eine Beschwerde in Wartestellung.
    expect(header).toContain('mailto:')
    // Der Link ist auf DIESEN Lead und DIESEN Zweck signiert — ein Abmeldelink darf nicht
    // versehentlich alles abbestellen.
    expect(header).toContain(`l=${LEAD_ID}`)
    expect(header).toContain('p=contract_expiry_reminder')
    expect(header).toMatch(/s=[A-Za-z0-9_-]+/)
  })

  it('trägt einen Abmeldelink im Fuss — in Text- UND HTML-Fassung', async () => {
    const mail = await send()

    for (const body of [mail.text, mail.html]) {
      expect(body).toContain('/abmelden?')
      expect(body).toContain(`l=${LEAD_ID}`)
      expect(body).toContain('p=contract_expiry_reminder')
    }
  })

  it('enthält KEIN Angebot und keinen Link auf eigene Leistungen — nur den E-Control-Vergleich', async () => {
    const mail = await send()

    // Die Einwilligung lautet auf eine Erinnerung, nicht auf Werbung. Der einzige inhaltliche Link
    // zeigt auf den kostenlosen, unabhängigen Tarifkalkulator.
    expect(mail.text).toContain('https://www.e-control.at/tarifkalkulator')
    for (const body of [mail.text, mail.html]) {
      expect(body).not.toContain('/leistungen')
      expect(body).not.toContain('/peak-shaving')
    }
  })

  it('nennt Versorger und Vertragsende — letzteres als deutsches Datum', async () => {
    const mail = await send()

    expect(mail.text).toContain('Testversorger GmbH')
    // 30.09.2026 statt 2026-09-30: die Mail spricht mit einem Menschen, nicht mit einer API.
    expect(mail.text).toContain('30.09.2026')
    expect(mail.subject).toContain('30.09.2026')
  })

  it('ohne Versorger fehlt die Zeile, statt leer dazustehen', async () => {
    mocks.send.mockResolvedValue({ data: { id: 'mail-2' }, error: null })
    await sendContractReminderMail({
      to: 'kunde@test.local',
      locale: 'de',
      leadId: LEAD_ID,
      supplier: null,
      contractEndDate: '2026-09-30',
    })

    const mail = mocks.send.mock.calls[0]![0] as SentMail
    // Eine Zeile „Ihr Versorger: —" sähe aus, als hätten wir etwas verloren.
    expect(mail.text).not.toContain('supplierLabel')
    expect(mail.text).toContain('30.09.2026')
  })
})
