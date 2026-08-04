/**
 * DIE ZUSAGEN DES BENACHRICHTIGUNGS-ABLAUFS (B18-4) — messbar, weil der Ablauf REIN ist.
 *
 * Was hier geprüft wird, lässt sich NUR hier prüfen: Die Datenbank kann nicht wissen, ob eine Mail
 * ankam, und ein Test gegen die laufende Anwendung könnte einen Mailausfall nur nachstellen, indem
 * er den Versand kaputt macht. `notifyCalculatorRequest` nimmt seine Effekte entgegen — der
 * Mailausfall ist damit eine EINGABE und kein Unfall.
 *
 * Die vier Regeln aus dem Kopf von `calculator-request-notify.ts`, je als Testfall:
 *   1. Die Wurffreiheit liegt in den EFFEKTEN, nicht in einem pauschalen `catch` — ein Wurf wird
 *      durchgereicht, statt in ein stilles „nicht versendet" verwandelt zu werden (wörtlich das
 *      Muster aus `notify.test.ts`, B16-4b).
 *   2. Ohne Konto geht keine Mail raus.
 *   3. Erst senden, dann vermerken — nie umgekehrt.
 *   4. „Mail raus, Vermerk fehlt" ist ein EIGENER Zustand.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  notifyCalculatorRequest,
  type CalculatorRequestNotificationEffects,
  type CalculatorRequestTarget,
} from './calculator-request-notify'

const REQUEST = { requestId: 'req-1', partnerSlug: 'elektro-muster' }

const TARGET: CalculatorRequestTarget = {
  displayName: 'Elektro Muster GmbH',
  contactFirstName: 'Anna',
  accountEmail: 'anna@elektro-muster.at',
}

/** Reihenfolge-treue Attrappen: jeder Aufruf wird protokolliert, damit sie prüfbar ist. */
function effects(
  overrides: Partial<CalculatorRequestNotificationEffects> = {},
  order: string[] = [],
): CalculatorRequestNotificationEffects {
  return {
    loadTarget: vi.fn(async () => {
      order.push('loadTarget')
      return TARGET
    }),
    sendMail: vi.fn(async () => {
      order.push('sendMail')
      return { ok: true }
    }),
    markNotified: vi.fn(async () => {
      order.push('markNotified')
      return true
    }),
    ...overrides,
  }
}

describe('B18-4 — notifyCalculatorRequest', () => {
  it('sendet an die nachgeschlagene Konto-Adresse und vermerkt danach', async () => {
    const order: string[] = []
    const e = effects({}, order)

    expect(await notifyCalculatorRequest(REQUEST, e)).toEqual({ status: 'sent' })

    expect(e.loadTarget).toHaveBeenCalledWith('elektro-muster')
    expect(e.sendMail).toHaveBeenCalledWith({
      to: 'anna@elektro-muster.at',
      firstName: 'Anna',
      displayName: 'Elektro Muster GmbH',
    })
    expect(e.markNotified).toHaveBeenCalledWith('req-1')
    // Regel 3, als REIHENFOLGE gemessen und nicht nur als „beides passiert".
    expect(order).toEqual(['loadTarget', 'sendMail', 'markNotified'])
  })

  it('⚠ Regel 3: bei einem MAILAUSFALL wird NICHT vermerkt', async () => {
    const order: string[] = []
    const e = effects(
      {
        sendMail: vi.fn(async () => {
          order.push('sendMail')
          return { ok: false }
        }),
      },
      order,
    )

    expect(await notifyCalculatorRequest(REQUEST, e)).toEqual({ status: 'send_failed' })
    expect(e.markNotified).not.toHaveBeenCalled()
    expect(order).toEqual(['loadTarget', 'sendMail'])
  })

  it('⚠ Regel 4: „Mail raus, Vermerk fehlt" bekommt einen EIGENEN Zustand', async () => {
    const e = effects({ markNotified: vi.fn(async () => false) })

    // NICHT `send_failed` — die Oberfläche riete sonst zum erneuten Senden, und der Betrieb bekäme
    // dieselbe Mail ein zweites Mal.
    expect(await notifyCalculatorRequest(REQUEST, e)).toEqual({ status: 'not_recorded' })
    expect(e.sendMail).toHaveBeenCalledTimes(1)
  })

  it('⚠ Regel 2: ohne verknüpftes Konto geht NICHTS raus', async () => {
    const e = effects({ loadTarget: vi.fn(async () => ({ ...TARGET, accountEmail: null })) })

    expect(await notifyCalculatorRequest(REQUEST, e)).toEqual({ status: 'no_account' })
    expect(e.sendMail).not.toHaveBeenCalled()
    expect(e.markNotified).not.toHaveBeenCalled()
  })

  it('behandelt eine leere Adresse wie eine fehlende', async () => {
    const e = effects({ loadTarget: vi.fn(async () => ({ ...TARGET, accountEmail: '   ' })) })

    expect(await notifyCalculatorRequest(REQUEST, e)).toEqual({ status: 'no_account' })
    expect(e.sendMail).not.toHaveBeenCalled()
  })

  it('meldet einen unbekannten Fachbetrieb, ohne zu senden', async () => {
    const e = effects({ loadTarget: vi.fn(async () => null) })

    expect(await notifyCalculatorRequest(REQUEST, e)).toEqual({ status: 'unknown_partner' })
    expect(e.sendMail).not.toHaveBeenCalled()
    expect(e.markNotified).not.toHaveBeenCalled()
  })

  it('kommt ohne Ansprechperson aus — die Mail bekommt dann keinen Namen', async () => {
    const e = effects({ loadTarget: vi.fn(async () => ({ ...TARGET, contactFirstName: '  ' })) })

    expect(await notifyCalculatorRequest(REQUEST, e)).toEqual({ status: 'sent' })
    expect(e.sendMail).toHaveBeenCalledWith(expect.objectContaining({ firstName: null }))
  })

  it('⚠ Regel 1: WIRFT NIE — auch dann nicht, wenn die Zustellung selbst wirft', async () => {
    /*
     * Die Effekte sind so gebaut, dass sie nicht werfen (`calculator-request-notify-server.ts`).
     * Wirft dennoch einer, darf der Wurf NICHT zu einem Fehlschlag der FREIGABE werden — die ist
     * eine vollzogene, unumkehrbare Transaktion. Dieser Test hält fest, dass der Ablauf selbst
     * keinen pauschalen `catch` hat, der einen Ausfall in ein stilles „nicht versendet" verwandelt:
     * er reicht den Wurf durch, und der Aufrufer entscheidet.
     */
    const e = effects({
      sendMail: vi.fn(async () => {
        throw new Error('Resend nicht erreichbar')
      }),
    })

    await expect(notifyCalculatorRequest(REQUEST, e)).rejects.toThrow('Resend nicht erreichbar')
    expect(e.markNotified).not.toHaveBeenCalled()
  })
})
