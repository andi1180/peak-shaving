import 'server-only'
import { createClient } from '@/lib/supabase/server'
import {
  readCalculatorRequestSubmission,
  type CalculatorRequestSubmission,
} from './calculator-request'
import { sendCalculatorRequestNotification } from './calculator-request-mail'

/**
 * DER SCHREIBWEG DES FACHBETRIEBS (B18-4) — Anfrage anlegen und COOLiN benachrichtigen.
 *
 * ── DIE REIHENFOLGE IST BINDEND: ERST DIE ANFRAGE, DANN DIE MAIL ────────────────────────────────
 * Die Anfrage ist der Vorgang; die Mail ist die Benachrichtigung darüber. Umgekehrt stünde in einem
 * Postfach die Ankündigung einer Anfrage, die es nicht gibt — und der Admin suchte sie im
 * Prüf-Eingang vergeblich.
 *
 * ── ⚠ EIN MAILAUSFALL WIRFT DIE ANFRAGE NICHT UM ────────────────────────────────────────────────
 * Der Versand läuft NACH dem erfolgreichen Wrapper-Aufruf und sein Ergebnis wird bewusst NICHT
 * ausgewertet. Meldete man ihn dem Fachbetrieb als Fehlschlag, wäre die naheliegende Reaktion ein
 * zweites Absenden — und das liefe in `already_pending`, also in eine Meldung, die wie ein zweiter
 * Fehler aussieht. Die Anfrage steht in der Datenbank und wird im Admin-Bereich gesehen; die Mail
 * ist die Beschleunigung, nicht der Weg. Dieselbe Fehlerrichtung wie beim Lead aus dem
 * Kontaktformular (B1-2): eine verlorene Benachrichtigung wiegt leichter als ein verlorener Vorgang.
 *
 * ── DIE PARTNER-ANGABEN KOMMEN VOM AUFRUFER, UND ZWAR AUS DERSELBEN SITZUNG ─────────────────────
 * `public.submit_calculator_request` gibt bewusst nur die Kennung zurück — Kurz-Key und Anzeigename
 * kennt die Portalseite bereits aus `readPortal()` (also aus `get_my_partner`, gebunden an dieselbe
 * `auth.uid()`, die auch die Zeile schreibt). Ein zweiter Lesevorgang brächte dieselben Werte über
 * einen zweiten Pfad; der Wrapper sie herausgeben zu lassen brächte sie in eine Antwort, in der sie
 * niemand braucht. ⚠ Der Datensatz bleibt die Wahrheit: Die Mail ist eine interne Benachrichtigung,
 * die Zuordnung der Anfrage entsteht in der Datenbank aus der Sitzung.
 */
export type SubmitCalculatorRequestInput = {
  message: string
  /** Aus `readPortal()` derselben Anfrage — s. o. */
  partnerSlug: string
  partnerDisplayName: string
  /** Die Adresse des angemeldeten Kontos; `null` ist zulässig (dann fährt kein `replyTo` mit). */
  accountEmail: string | null
}

export async function submitCalculatorRequest(
  input: SubmitCalculatorRequestInput,
): Promise<CalculatorRequestSubmission> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('submit_calculator_request', {
    p_message: input.message,
  })
  if (error) console.error('[calculator-request] submit_calculator_request:', error)

  const outcome = readCalculatorRequestSubmission(data, error)
  if (outcome.status !== 'ok') return outcome

  try {
    await sendCalculatorRequestNotification({
      requestId: outcome.requestId,
      partnerSlug: input.partnerSlug,
      partnerDisplayName: input.partnerDisplayName,
      accountEmail: input.accountEmail,
      message: input.message,
    })
  } catch (cause) {
    // Zweite Sicherung: `sendMail` fängt selbst ab, aber ein unerwarteter Wurf darf die bereits
    // angelegte Anfrage nicht in einen Fehlschlag verwandeln (s. o.).
    console.error('[calculator-request] interne Benachrichtigung fehlgeschlagen:', cause)
  }

  return outcome
}
