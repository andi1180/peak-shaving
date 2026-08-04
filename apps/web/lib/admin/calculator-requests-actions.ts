'use server'

/**
 * Die Server Action des Prüf-Eingangs der Kalkulator-Anfragen (B18-4, Oberfläche).
 *
 * ── EINE ACTION FÜR BEIDE ENTSCHEIDUNGEN, NICHT ZWEI ────────────────────────────────────────────
 * Freigeben und Ablehnen laufen durch denselben Wrapper (`public.admin_decide_calculator_request`)
 * und unterscheiden sich in genau einem Wert. Zwei Actions wären zwei Fundorte für dieselbe
 * Fehlerbehandlung — und die Abweichung fiele erst an der Meldung auf, die eine der beiden nicht
 * kennt. Die Entscheidung kommt als Formularwert und wird hier gegen die Union geprüft; ein
 * unbekannter Wert erreicht die Datenbank gar nicht.
 *
 * ── KEIN service_role ───────────────────────────────────────────────────────────────────────────
 * Der Wrapper ist `authenticated`-only und prüft `platform.is_admin()` intern; über `service_role`
 * wäre `reviewed_by` strukturell leer. Die `no-restricted-imports`-Erlaubnisliste wurde NICHT
 * angefasst (dieselbe Begründung wie in `calculator-requests-server.ts`).
 *
 * ── ⚠ EIN MAILPROBLEM IST KEIN FEHLSCHLAG DER FREIGABE ──────────────────────────────────────────
 * Status und `calculator_pro`-Entitlement entstehen in EINER Transaktion. Ist sie durch, ist sie
 * durch — der Betrieb hat den Kalkulator, ein zweiter Versuch gäbe `already_reviewed`. Was danach
 * mit der Mail passiert, wird deshalb ausschliesslich als ZUSATZ zur Erfolgsmeldung beschrieben und
 * nie als `formError` (`calculatorApprovalNotificationNote`).
 */
import { revalidatePath } from 'next/cache'
import { calculatorApprovalNotificationNote } from '@/lib/partner-portal/notify-messages'
import {
  CALCULATOR_REQUESTS_HREF,
  CALCULATOR_REQUEST_DETAIL_HREF,
  CALCULATOR_REQUEST_DECISIONS,
  CALCULATOR_REQUEST_STATUS_LABEL,
  type CalculatorRequestDecision,
} from './calculator-requests'
import { decideCalculatorRequest } from './calculator-requests-server'
import type { AdminState } from './schema'

const GENERIC = 'Das hat nicht geklappt. Bitte versuchen Sie es erneut.'
const GONE = 'Diese Anfrage gibt es nicht (mehr).'

function isDecision(value: unknown): value is CalculatorRequestDecision {
  return (
    typeof value === 'string' &&
    (CALCULATOR_REQUEST_DECISIONS as readonly string[]).includes(value)
  )
}

export async function decideCalculatorRequestAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { formError: GONE }

  const rawDecision = formData.get('entscheidung')
  if (!isDecision(rawDecision)) {
    // Kann nur aus einem manipulierten Formular kommen — die Datenbank wird gar nicht erst gefragt.
    console.error('[admin/calculator-requests] unbekannte Entscheidung:', rawDecision)
    return { formError: GENERIC }
  }

  const { decision, notification } = await decideCalculatorRequest(id, rawDecision)

  switch (decision.status) {
    case 'ok': {
      revalidatePath(CALCULATOR_REQUESTS_HREF)
      revalidatePath(CALCULATOR_REQUEST_DETAIL_HREF(id))

      if (decision.decision === 'rejected') {
        return {
          success:
            'Anfrage abgelehnt. Sie bleibt zur Nachvollziehbarkeit stehen; es geht bewusst keine ' +
            'Absagemail raus.',
        }
      }

      /*
       * `already_active` ist ein ERFOLG und kein Sonderfall: Der Betrieb hatte den Zugang bereits
       * (Gutscheincode oder Stripe), und ein bestehendes aktives Entitlement wird bewusst NICHT
       * überschrieben. Für ihn ist die Auskunft dieselbe — der Admin soll trotzdem wissen, dass
       * durch diesen Klick kein neuer Zugang entstanden ist.
       */
      const base =
        decision.entitlement === 'already_active'
          ? 'Anfrage freigegeben. Der Zugang zum Kalkulator bestand bereits und wurde nicht ' +
            'überschrieben. '
          : 'Anfrage freigegeben. Der Zugang zum Kalkulator ist vergeben. '

      /*
       * ⚠ KEIN Vorgabewert `'sent'`, wenn die Benachrichtigung gar nicht angelaufen ist. Der Fall
       * tritt ein, wenn die Antwort der Datenbank keinen Kurz-Key mitführt — dann wurde nichts
       * versendet, und „informiert" wäre eine Behauptung über eine Mail, die es nicht gibt.
       * `unknown_partner` sagt genau das, was zutrifft: der Zugang steht, der Betrieb weiss nichts.
       */
      return {
        success: base + calculatorApprovalNotificationNote(notification?.status ?? 'unknown_partner'),
      }
    }
    case 'already_reviewed':
      return {
        formError:
          'Über diese Anfrage wurde bereits entschieden' +
          (decision.current
            ? ` (${CALCULATOR_REQUEST_STATUS_LABEL[decision.current]})`
            : '') +
          '. Der Zeitpunkt der ersten Entscheidung bleibt stehen — bitte die Seite neu laden.',
      }
    case 'no_account':
      return {
        /*
         * Real erreichbar: `partners.user_id` trägt `on delete set null`, ein zwischen Absendung
         * und Entscheidung gelöschtes Konto nullt die Spalte. Ein Entitlement hängt an einem Konto
         * — ohne Konto gibt es nichts freizuschalten. Ablehnen bleibt trotzdem möglich und ist der
         * einzige Weg, eine gegenstandslose Anfrage zu schliessen.
         */
        formError:
          'Freigeben ist nicht möglich: An diesem Fachbetrieb hängt kein Konto (mehr), und ein ' +
          'Zugang hängt immer an einem Konto. Bitte unter „Partner" ein Konto verknüpfen — oder ' +
          'die Anfrage ablehnen, wenn sie gegenstandslos ist.',
      }
    case 'not_found':
      return { formError: GONE }
    case 'invalid_decision':
    case 'missing_fields':
    case 'error':
      return { formError: GENERIC }
  }
}
