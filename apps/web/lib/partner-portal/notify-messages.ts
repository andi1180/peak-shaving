/**
 * Was der Admin-Bereich zu einem Benachrichtigungs-Ergebnis sagt (B16-4b).
 *
 * REIN und an EINER Stelle, weil ZWEI Aufrufer denselben fünf Zuständen begegnen: die Genehmigung
 * eines Antrags und das erneute Senden auf `/admin/partner`. Zwei Formulierungen desselben Zustands
 * liefen auseinander — und bei `not_recorded` wäre das teuer: Der eine Text riete zum erneuten
 * Senden, der andere davon ab, und der Fachbetrieb bekäme dieselbe Mail ein zweites Mal.
 *
 * Die Sätze stehen im CODE und nicht in `messages/de.json` — dieselbe Konvention wie im übrigen
 * Admin-Bereich (T4-4, begründet in `lib/admin/schema.ts`: er liegt ausserhalb der
 * next-intl-Struktur, ein Key-Umweg ohne Wörterbuch wäre eine Indirektion ohne Nutzen).
 *
 * ── JEDER SATZ NENNT DIE NÄCHSTE HANDLUNG ───────────────────────────────────────────────────────
 * Ein Zustand ohne Handlungsanweisung zwänge die Person zu raten, und die Antworten sind
 * gegensätzlich: erneut senden · gerade NICHT erneut senden · erst ein Konto verknüpfen · Seite neu
 * laden · nichts tun.
 */
import type { PartnerNotificationOutcome } from './notify'

/**
 * Die Ergänzung zur Erfolgsmeldung einer GENEHMIGUNG.
 *
 * Sie steht hinter dem Satz „Bewerbung genehmigt …" und beschreibt ausschliesslich den Mailversand.
 * Dass die Genehmigung selbst durch ist, steht davor und wird von hier nie relativiert.
 */
export function approvalNotificationNote(status: PartnerNotificationOutcome['status']): string {
  switch (status) {
    case 'sent':
      return 'Der Betrieb wurde per E-Mail über seinen Portalzugang informiert.'
    case 'send_failed':
      return (
        'ACHTUNG: Die Benachrichtigung konnte NICHT versendet werden — der Betrieb weiss noch ' +
        'nichts von seiner Freischaltung. Die Genehmigung selbst steht. Der Versand lässt sich ' +
        'unter „Partner" nachholen.'
      )
    case 'not_recorded':
      return (
        'Die Benachrichtigung IST versendet, konnte aber nicht vermerkt werden — unter „Partner" ' +
        'steht der Betrieb deshalb als „nicht benachrichtigt". Bitte NICHT erneut senden, sonst ' +
        'bekommt er dieselbe Mail zweimal.'
      )
    case 'no_account':
      return (
        'ACHTUNG: Es geht keine Benachrichtigung raus — an diesem Betrieb hängt kein Konto. ' +
        'Erst unter „Partner" ein Konto verknüpfen, dann von dort die Benachrichtigung senden.'
      )
    case 'unknown_partner':
      return (
        'Die Benachrichtigung konnte nicht versendet werden, weil der Fachbetrieb gerade nicht ' +
        'lesbar war. Bitte den Versand unter „Partner" nachholen.'
      )
  }
}

/** Die Meldung der Aktion „Benachrichtigung senden" auf `/admin/partner`. */
export function resendNotificationMessage(
  status: PartnerNotificationOutcome['status'],
): { success?: string; formError?: string } {
  switch (status) {
    case 'sent':
      return { success: 'Benachrichtigung versendet. Der Zeitpunkt steht ab sofort in der Karte.' }
    case 'send_failed':
      return {
        formError:
          'Die Benachrichtigung konnte nicht versendet werden. Der Betrieb bleibt als „nicht ' +
          'benachrichtigt" geführt — bitte später erneut versuchen. Ist der Versandweg überhaupt ' +
          'eingerichtet (RESEND_*)?',
      }
    case 'not_recorded':
      return {
        formError:
          'Die Mail IST raus, der Zeitpunkt liess sich aber nicht festhalten — die Karte zeigt ' +
          'weiterhin „nicht benachrichtigt". Bitte NICHT erneut senden, sonst bekommt der Betrieb ' +
          'dieselbe Mail zweimal.',
      }
    case 'no_account':
      return {
        formError:
          'An diesem Fachbetrieb hängt kein Konto. Die Mail verweist auf ein Portal mit Anmeldung ' +
          '— ohne Konto gäbe es die nicht. Bitte zuerst ein Konto verknüpfen.',
      }
    case 'unknown_partner':
      return { formError: 'Diesen Fachbetrieb gibt es nicht (mehr). Bitte die Seite neu laden.' }
  }
}
