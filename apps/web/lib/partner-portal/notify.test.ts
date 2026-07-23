/**
 * Der Benachrichtigungs-Ablauf (B16-4b) — die Eigenschaften, die sich NUR hier prüfen lassen.
 *
 * Alles Interessante an diesem Ablauf ist eine Aussage darüber, was NICHT passiert: keine Mail ohne
 * Konto, kein Vermerk ohne Zustellung, kein Wurf in einen Vorgang hinein, der bereits vollzogen ist.
 * Ein DB-Test kann davon nichts messen (die Datenbank sieht nur den Vermerk), ein Playwright-Lauf
 * ebenso wenig (er sieht nur die Meldung). Deshalb ist der Ablauf rein und die Effekte werden hier
 * gezählt.
 */
import { describe, expect, it } from 'vitest'
import { notifyPartner, type PartnerNotificationEffects } from './notify'
import { approvalNotificationNote, resendNotificationMessage } from './notify-messages'

type Calls = { loaded: string[]; sent: unknown[]; marked: string[] }

function effects(
  overrides: Partial<PartnerNotificationEffects> & {
    accountEmail?: string | null
    missing?: boolean
    sendOk?: boolean
    markOk?: boolean
    fromApplication?: boolean
  } = {},
): { effects: PartnerNotificationEffects; calls: Calls } {
  const calls: Calls = { loaded: [], sent: [], marked: [] }
  const {
    accountEmail = 'betrieb@test.local',
    missing = false,
    sendOk = true,
    markOk = true,
    fromApplication = true,
  } = overrides

  return {
    calls,
    effects: {
      async loadTarget(slug) {
        calls.loaded.push(slug)
        if (missing) return null
        return {
          slug,
          displayName: 'Elektro Musterbetrieb GmbH',
          contactFirstName: 'Anna',
          accountEmail,
          fromApplication,
        }
      },
      async sendMail(input) {
        calls.sent.push(input)
        return { ok: sendOk }
      },
      async markNotified(slug) {
        calls.marked.push(slug)
        return markOk
      },
      ...overrides,
    },
  }
}

describe('notifyPartner — der Gutfall', () => {
  it('sendet und vermerkt, in dieser Reihenfolge', async () => {
    const { effects: e, calls } = effects()

    expect(await notifyPartner('musterbetrieb', e)).toEqual({ status: 'sent' })
    expect(calls.sent).toHaveLength(1)
    expect(calls.marked).toEqual(['musterbetrieb'])
  })

  it('der Empfänger ist die Adresse des KONTOS, und der Name fährt für die Anrede mit', async () => {
    const { effects: e, calls } = effects({ accountEmail: 'konto@test.local' })

    await notifyPartner('musterbetrieb', e)
    expect(calls.sent[0]).toEqual({
      to: 'konto@test.local',
      firstName: 'Anna',
      displayName: 'Elektro Musterbetrieb GmbH',
      slug: 'musterbetrieb',
      fromApplication: true,
    })
  })

  it('reicht `fromApplication` durch — der Satz über das Passwort hängt daran', async () => {
    const { effects: e, calls } = effects({ fromApplication: false })

    await notifyPartner('raymann', e)
    expect(calls.sent[0]).toMatchObject({ fromApplication: false })
  })
})

describe('⚠ OHNE KONTO GEHT NICHTS RAUS', () => {
  it('kein Konto → keine Mail, kein Vermerk', async () => {
    const { effects: e, calls } = effects({ accountEmail: null })

    expect(await notifyPartner('raymann', e)).toEqual({ status: 'no_account' })
    expect(calls.sent).toHaveLength(0)
    expect(calls.marked).toHaveLength(0)
  })

  it('eine Adresse aus Leerzeichen zählt als KEINE Adresse', async () => {
    const { effects: e, calls } = effects({ accountEmail: '   ' })

    expect(await notifyPartner('raymann', e)).toEqual({ status: 'no_account' })
    expect(calls.sent).toHaveLength(0)
  })

  it('unbekannter Fachbetrieb → keine Mail, kein Vermerk', async () => {
    const { effects: e, calls } = effects({ missing: true })

    expect(await notifyPartner('gibt-es-nicht', e)).toEqual({ status: 'unknown_partner' })
    expect(calls.sent).toHaveLength(0)
    expect(calls.marked).toHaveLength(0)
  })
})

describe('⚠ ERST SENDEN, DANN VERMERKEN — nie umgekehrt', () => {
  it('gescheiterter Versand setzt den Vermerk NICHT', async () => {
    const { effects: e, calls } = effects({ sendOk: false })

    expect(await notifyPartner('musterbetrieb', e)).toEqual({ status: 'send_failed' })
    expect(calls.sent).toHaveLength(1)
    // Der Kern: notified_at behauptet eine ZUGESTELLTE Nachricht. Hier gab es keine.
    expect(calls.marked).toHaveLength(0)
  })

  it('Mail raus, Vermerk gescheitert → EIGENER Zustand (nicht „send_failed")', async () => {
    const { effects: e, calls } = effects({ markOk: false })

    /*
     * Der Unterschied ist nicht kosmetisch: `send_failed` riete zum erneuten Senden, und der
     * Betrieb bekäme dieselbe Mail ein zweites Mal — die Nachricht liegt bereits in seinem
     * Postfach.
     */
    expect(await notifyPartner('musterbetrieb', e)).toEqual({ status: 'not_recorded' })
    expect(calls.sent).toHaveLength(1)
    expect(calls.marked).toHaveLength(1)
  })
})

describe('⚠ DER ABLAUF WIRFT NIE — sonst risse er eine vollzogene Genehmigung mit', () => {
  it('auch wenn jeder einzelne Effekt wirft', async () => {
    const boom = () => {
      throw new Error('kaputt')
    }

    /*
     * Die Effekte sind laut Vertrag wurffrei (`notify-server.ts` fängt jeden Fehler ab). Diese
     * Prüfung misst, was passiert, wenn sich jemand später NICHT daran hält: Der Ablauf gibt den
     * Fehler weiter, statt ihn zu verschlucken — und genau deshalb muss die Wurffreiheit dort
     * bleiben, wo sie steht. Festgehalten, damit die Zusage nicht versehentlich hierher wandert
     * (ein pauschales try/catch hier machte aus „Datenbank weg" ein stilles „nicht versendet").
     */
    await expect(
      notifyPartner('musterbetrieb', {
        loadTarget: boom as never,
        sendMail: boom as never,
        markNotified: boom as never,
      }),
    ).rejects.toThrow('kaputt')
  })
})

describe('Die Meldungen benennen die nächste Handlung', () => {
  it('jeder Zustand hat einen eigenen, nicht leeren Satz — in beiden Aufrufern', () => {
    const stati = ['sent', 'unknown_partner', 'no_account', 'send_failed', 'not_recorded'] as const

    const approvalTexts = stati.map((s) => approvalNotificationNote(s))
    expect(new Set(approvalTexts).size).toBe(stati.length)
    for (const text of approvalTexts) expect(text.length).toBeGreaterThan(20)

    for (const status of stati) {
      const message = resendNotificationMessage(status)
      expect(message.success ?? message.formError).toBeTruthy()
    }
  })

  it('NUR der Gutfall meldet Erfolg — jeder andere Zustand ist ein Fehlertext', () => {
    expect(resendNotificationMessage('sent').success).toBeTruthy()
    expect(resendNotificationMessage('sent').formError).toBeUndefined()

    for (const status of ['unknown_partner', 'no_account', 'send_failed', 'not_recorded'] as const) {
      expect(resendNotificationMessage(status).success).toBeUndefined()
      expect(resendNotificationMessage(status).formError).toBeTruthy()
    }
  })

  it('⚠ „Mail raus, Vermerk fehlt" rät AUSDRÜCKLICH VOM erneuten Senden ab', () => {
    // Die eine Verwechslung, die real Schaden anrichtet — deshalb an beiden Fundorten gepinnt.
    expect(approvalNotificationNote('not_recorded')).toContain('NICHT erneut senden')
    expect(resendNotificationMessage('not_recorded').formError).toContain('NICHT erneut senden')

    // Gegenprobe: der echte Fehlschlag rät umgekehrt.
    expect(approvalNotificationNote('send_failed')).toContain('nachholen')
  })
})
