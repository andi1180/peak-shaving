'use server'

/**
 * Server-Actions des Lead-Pfads (B1-2): bestätigen, einen Zweck abmelden, alles sperren.
 *
 * WARUM ACTIONS UND KEIN GET: Jede dieser drei Wirkungen tritt ausschliesslich per POST ein. Der
 * Grund steht ausführlich in `app/(site)/[locale]/einwilligung-bestaetigen/page.tsx` — kurz:
 * Mailscanner in Unternehmen rufen Links vorab ab; ein bestätigender GET erzeugt Einwilligungen,
 * die niemand erteilt hat, und entwertet den Nachweis.
 *
 * WARUM JEDE ACTION IHRE EINGABE ERNEUT PRÜFT: Formularfelder sind Nutzereingabe, auch wenn die
 * Seite sie gerade selbst gerendert hat. Die Abmelde-Signatur wird deshalb HIER noch einmal geprüft
 * — die Prüfung beim Rendern entscheidet nur, WAS angezeigt wird, nicht was passieren darf.
 *
 * WARUM AM ENDE EIN REDIRECT STEHT: Die Seiten halten keinen zweiten Zustand. Nach getaner Arbeit
 * wird auf dieselbe URL zurückgeleitet, und die Seite liest ihren Zustand wieder frisch aus der
 * Datenbank (Bestätigung) bzw. aus dem `?status=`-Parameter (Abmeldung). Ein Action-Rückgabewert im
 * Client wäre ein zweiter Zustand neben dem Datenbankzustand — genau die Divergenz, die man später
 * nicht mehr auseinanderhält.
 */
import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { getPathname } from '@/i18n/navigation'
import {
  ABMELDEN_HREF,
  CONFIRM_TOKEN_PARAM,
  EINWILLIGUNG_BESTAETIGEN_HREF,
  LEAD_STATUS_PARAM,
  UNSUBSCRIBE_PARAM,
  UNSUBSCRIBE_STATUS,
  isConsentPurpose,
} from './config'
import { confirmConsent, suppressEmailAndWithdrawAll, withdrawConsent } from './store'
import { hashConfirmationToken, verifyUnsubscribeToken } from './tokens'

function field(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Bestätigt die Einwilligung zum übergebenen Klartext-Token.
 *
 * Die Action wertet den `outcome` bewusst NICHT aus: die Seite liest den Zustand danach ohnehin
 * wieder aus der Datenbank, und die vier Ausgänge (bestätigt · schon bestätigt · abgelaufen ·
 * unbekannt) sind dort dieselben wie hier. Ein zweiter, mitgeschleppter Zustand wäre die
 * Fehlerquelle, nicht die Vereinfachung.
 */
export async function confirmConsentAction(formData: FormData): Promise<void> {
  const token = field(formData, CONFIRM_TOKEN_PARAM)
  const locale = await getLocale()
  const path = getPathname({ href: EINWILLIGUNG_BESTAETIGEN_HREF, locale })

  if (token) {
    // Nur der HASH erreicht die Datenbank — der Klartext existiert weiterhin nur in Mail und URL.
    await confirmConsent(hashConfirmationToken(token))
  }

  // `redirect` wirft NEXT_REDIRECT und steht deshalb als letzte Anweisung (Muster wie lib/auth).
  redirect(`${path}?${CONFIRM_TOKEN_PARAM}=${encodeURIComponent(token)}`)
}

/** Gemeinsame Eingabeprüfung beider Abmelde-Actions. */
function readUnsubscribeInput(formData: FormData) {
  const leadId = field(formData, UNSUBSCRIBE_PARAM.lead)
  const purpose = field(formData, UNSUBSCRIBE_PARAM.purpose)
  const signature = field(formData, UNSUBSCRIBE_PARAM.signature)

  if (!leadId || !isConsentPurpose(purpose)) return null
  if (!verifyUnsubscribeToken(leadId, purpose, signature)) return null

  return { leadId, purpose, signature }
}

function unsubscribeRedirect(
  path: string,
  input: { leadId: string; purpose: string; signature: string },
  status: string,
): string {
  const params = new URLSearchParams({
    [UNSUBSCRIBE_PARAM.lead]: input.leadId,
    [UNSUBSCRIBE_PARAM.purpose]: input.purpose,
    [UNSUBSCRIBE_PARAM.signature]: input.signature,
    [LEAD_STATUS_PARAM]: status,
  })
  return `${path}?${params.toString()}`
}

/** „Von diesen E-Mails abmelden" — widerruft NUR den Zweck aus dem Link. */
export async function withdrawPurposeAction(formData: FormData): Promise<void> {
  const locale = await getLocale()
  const path = getPathname({ href: ABMELDEN_HREF, locale })
  const input = readUnsubscribeInput(formData)

  // Ungültige Signatur: dieselbe neutrale Seite wie beim Aufruf, ohne Hinweis darauf, ob die
  // Adresse bekannt ist. Kein Fehlerzustand, keine Auskunft.
  if (!input) redirect(path)

  await withdrawConsent(input.leadId, input.purpose)
  redirect(unsubscribeRedirect(path, input, UNSUBSCRIBE_STATUS.purpose))
}

/** „Keine E-Mails mehr von COOLiN" — widerruft ALLES und sperrt die Adresse dauerhaft. */
export async function suppressAllAction(formData: FormData): Promise<void> {
  const locale = await getLocale()
  const path = getPathname({ href: ABMELDEN_HREF, locale })
  const input = readUnsubscribeInput(formData)

  if (!input) redirect(path)

  await suppressEmailAndWithdrawAll(input.leadId)
  redirect(unsubscribeRedirect(path, input, UNSUBSCRIBE_STATUS.all))
}
