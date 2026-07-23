/**
 * DER ABSENDER — eine Zusicherung über ALLE sieben Mails, die dieses System über Resend verschickt.
 *
 * ── WARUM DIESER TEST DEN ECHTEN VERSANDWEG BAUT ─────────────────────────────────────────────────
 * Geprüft wird eine Eigenschaft, die kein Build und kein Typecheck fängt: Bis hierher kam der
 * Absender aus `RESEND_FROM`, wurde an ZWEI Stellen gelesen (`lib/mail/send.ts` und
 * `lib/kontakt/deliver.ts`) und hat in Produktion schon einmal formal falsch dringestanden (422 von
 * Resend, Handover `apps/web/CLAUDE.md`). Ein Test gegen eine nachgebaute Nutzlast bewiese davon
 * nichts. Deshalb wird `resend` ersetzt und die ECHTE Nutzlast abgegriffen, die jeder der beiden
 * Versandpfade dem SDK übergibt — inklusive `lib/kontakt/deliver.ts`, das seinen Resend-Aufruf
 * bewusst selbst hält (es liefert zusätzlich die Nachrichten-ID zurück).
 *
 * Ersetzt werden nur die Aussenkanten: `server-only` (wirft ausserhalb der React-Server-Umgebung),
 * `lib/env.server` (Geheimnisse) und `next-intl/server` (kein Request-Kontext im Test). Die
 * Übersetzungsattrappe gibt den Key zurück — geprüft werden Absender und Gerüst, nicht die
 * Wortwahl; die steht in `messages/de.json` und ist Arbeitsstand.
 *
 * ⚠ `serverEnv` trägt hier BEWUSST KEIN `RESEND_FROM`. Genau das ist die Zusicherung: Der Absender
 * entsteht ohne diese Variable. Wer sie wieder einführt, macht diese Attrappe zur Lüge und den Test
 * damit wertlos — dann bitte den Absender-Entwurf in `lib/mail/send.ts` mitlesen, nicht den Test
 * anpassen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KontaktInput } from '@/lib/kontakt/schema'

const LEAD_ID = '44444444-4444-4444-8444-444444444444'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('server-only', () => ({}))

vi.mock('@/lib/env.server', () => ({
  serverEnv: { RESEND_API_KEY: 'test-key' },
  requireLeadTokenSecret: () => 'test-token-geheimnis',
}))

vi.mock('next-intl/server', () => ({
  getTranslations:
    async ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      values ? `[${namespace}.${key}:${Object.values(values).join(',')}]` : `[${namespace}.${key}]`,
}))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.send }
  },
}))

const { MAIL_FROM } = await import('./send')
const leadMail = await import('@/lib/leads/mail')
const applicationMail = await import('@/lib/partner-application/mail')
const portalMail = await import('@/lib/partner-portal/mail')
const kontakt = await import('@/lib/kontakt/deliver')

type SentMail = {
  from: string
  to: string
  subject: string
  text: string
  html: string
  headers?: Record<string, string>
  replyTo?: string
}

function lastMail(): SentMail {
  const call = mocks.send.mock.calls.at(-1)
  expect(call, 'es wurde gar keine Mail an das SDK übergeben').toBeDefined()
  return call![0] as SentMail
}

const KONTAKT_INPUT = {
  vorname: 'Max',
  nachname: 'Muster',
  email: 'max@test.local',
  unternehmen: 'Muster GmbH',
  telefon: '+43 1 234 567',
  thema: 'esg',
  nachricht: 'Bitte um Rückmeldung zum Leistungstarif.',
  datenschutz: true,
} as KontaktInput

/**
 * Alle sieben Mails, jede einmal ausgelöst. Die Liste ist absichtlich vollständig und nicht
 * stichprobenartig: Eine neue Mail, die ihren Absender selbst setzt, soll hier auffallen — und sie
 * fällt nur auf, wenn jemand sie hier einträgt. Deshalb steht am Ende zusätzlich eine Zählung
 * gegen die Zahl der Versandfunktionen.
 */
const MAILS: Array<{ name: string; userFacing: boolean; send: () => Promise<unknown> }> = [
  {
    name: 'Kontaktformular (intern)',
    userFacing: false,
    send: () => kontakt.deliverKontakt(KONTAKT_INPUT, 'ESG / CSRD'),
  },
  {
    name: 'Double-Opt-in-Bestätigung',
    userFacing: true,
    send: () =>
      leadMail.sendConsentConfirmationMail({
        to: 'max@test.local',
        consentText: 'Ich willige ein.',
        confirmUrl: 'https://coolin.at/einwilligung-bestaetigen?token=abc',
        locale: 'de',
      }),
  },
  {
    name: 'Zusendung des Rechenergebnisses',
    userFacing: true,
    send: () =>
      leadMail.sendCalculatorResultMail({
        to: 'max@test.local',
        locale: 'de',
        inputs: { peakKw: 100, reductionKw: 20, pricePerKwYear: 38.52 },
        result: { effectiveReductionKw: 20, savingEur: 770.4, capped: false },
      }),
  },
  {
    name: 'Vertragsablauf-Erinnerung',
    userFacing: true,
    send: () =>
      leadMail.sendContractReminderMail({
        to: 'max@test.local',
        locale: 'de',
        leadId: LEAD_ID,
        supplier: 'Testversorger GmbH',
        contractEndDate: '2026-09-30',
      }),
  },
  {
    name: 'Partner-Bewerbung (intern)',
    userFacing: false,
    send: () =>
      applicationMail.sendPartnerApplicationNotification({
        applicationId: '11111111-1111-4111-8111-111111111111',
        company: 'Elektro Muster GmbH',
        firstName: 'Eva',
        lastName: 'Muster',
        email: 'eva@test.local',
        phone: '+43 1 999',
        website: 'https://muster.at',
        message: 'Wir möchten Partner werden.',
        hasSession: false,
      }),
  },
  {
    name: 'Partner-Bewerbung (Eingangsbestätigung)',
    userFacing: true,
    send: () =>
      applicationMail.sendPartnerApplicationAcknowledgement({
        to: 'eva@test.local',
        firstName: 'Eva',
        locale: 'de',
        accountCreated: true,
      }),
  },
  {
    name: 'Partner-Freischaltung',
    userFacing: true,
    send: () =>
      portalMail.sendPartnerApprovalMail({
        to: 'eva@test.local',
        firstName: 'Eva',
        displayName: 'Elektro Muster GmbH',
        slug: 'elektro-muster',
        fromApplication: true,
      }),
  },
]

describe('Absender — eine Definition für alle Mails', () => {
  beforeEach(() => {
    mocks.send.mockReset()
    mocks.send.mockResolvedValue({ data: { id: 'mail-1' }, error: null })
  })

  it('ist COOLiN ENERGY <energy@coolin.at>', () => {
    // Der Wert selbst, nicht nur „alle gleich": eine gemeinsame falsche Adresse wäre ebenfalls
    // konsistent. `noreply@` ist der Fall, den diese Zeile ausschliesst.
    expect(MAIL_FROM).toBe('COOLiN ENERGY <energy@coolin.at>')
  })

  for (const mail of MAILS) {
    it(`${mail.name} sendet von genau diesem Absender`, async () => {
      await mail.send()

      const sent = lastMail()
      expect(sent.from).toBe(MAIL_FROM)
      expect(sent.from).not.toContain('noreply')
    })
  }

  it('deckt jede Versandfunktion ab, die es gibt', async () => {
    /*
     * Der Wächter gegen die wahrscheinlichste Lücke: eine achte Mail entsteht, setzt ihren Absender
     * selbst und läuft an dieser Datei vorbei, weil niemand sie hier einträgt. Gezählt werden die
     * exportierten `send*`-Funktionen der drei Mail-Module plus `deliverKontakt`.
     */
    const exported = [
      ...Object.keys(leadMail),
      ...Object.keys(applicationMail),
      ...Object.keys(portalMail),
    ].filter((name) => name.startsWith('send'))

    expect(exported.length + 1).toBe(MAILS.length)
  })
})

describe('Aufbau — die drei Partner-Mails folgen dem Bestand', () => {
  beforeEach(() => {
    mocks.send.mockReset()
    mocks.send.mockResolvedValue({ data: { id: 'mail-1' }, error: null })
  })

  for (const mail of MAILS.filter((m) => m.userFacing)) {
    it(`${mail.name}: Signatur „COOLiN ENERGY · energy@coolin.at" im Fuss, Text und HTML`, async () => {
      await mail.send()
      const sent = lastMail()

      // Die Fusszeile des Bestands: Trennstrich, Firmenname, Kontaktadresse — mehr nicht. Eine
      // Impressumsangabe führt keine dieser Mails (sie steht auf der Seite, nicht in jeder Mail).
      expect(sent.text).toContain('\n—\nCOOLiN ENERGY\nenergy@coolin.at')
      expect(sent.html).toContain('COOLiN ENERGY · <a href="mailto:energy@coolin.at"')
    })
  }

  it('die drei transaktionalen Partner-Mails tragen KEINEN Abmeldelink', async () => {
    /*
     * ABSICHT, KEINE LÜCKE. Abgemeldet werden kann eine Aussendung — nicht die Antwort auf einen
     * Vorgang, den der Empfänger selbst angestossen hat. Die Vertragsablauf-Erinnerung ist der
     * Gegenfall: sie IST eine bestellte Aussendung und trägt die RFC-8058-Kopfzeilen (dort gepinnt,
     * `lib/leads/contract-reminder-mail.test.ts`). Die Gegenprobe steht unten, damit dieser Test
     * nicht dadurch grün bleibt, dass der Helfer generell nichts mehr setzt.
     */
    for (const name of [
      'Partner-Bewerbung (intern)',
      'Partner-Bewerbung (Eingangsbestätigung)',
      'Partner-Freischaltung',
    ]) {
      await MAILS.find((m) => m.name === name)!.send()
      const sent = lastMail()

      expect(sent.headers?.['List-Unsubscribe']).toBeUndefined()
      expect(sent.headers?.['List-Unsubscribe-Post']).toBeUndefined()
      expect(sent.text).not.toContain('/abmelden')
      expect(sent.html).not.toContain('/abmelden')
    }
  })

  it('die Vertragsablauf-Erinnerung trägt ihn weiterhin — die Gegenprobe', async () => {
    await MAILS.find((m) => m.name === 'Vertragsablauf-Erinnerung')!.send()
    const sent = lastMail()

    expect(sent.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expect(sent.text).toContain('/abmelden?')
  })

  it('die interne Partner-Benachrichtigung setzt Absenderangaben und Systemvermerke ab', async () => {
    /*
     * Wie `lib/kontakt/deliver.ts`: was der BEWERBER angegeben hat, steht hervorgehoben; was UNSER
     * SYSTEM vermerkt hat, steht neutral. Wer die Mail liest, entscheidet über eine
     * Geschäftsbeziehung und muss fremde Behauptung von eigener Feststellung unterscheiden können.
     */
    await MAILS.find((m) => m.name === 'Partner-Bewerbung (intern)')!.send()
    const sent = lastMail()

    expect(sent.html).toContain('<strong>Elektro Muster GmbH</strong>')
    expect(sent.html).toContain('<strong>eva@test.local</strong>')
    expect(sent.html).not.toContain('<strong>ohne Anmeldung</strong>')
    expect(sent.html).toMatch(/Eingegangen<\/td><td style="padding:4px 0;color:#262626">/)
    // Antworten geht direkt an den Bewerber — dieselbe Eigenschaft wie beim Kontaktformular.
    expect(sent.replyTo).toBe('eva@test.local')
  })
})
