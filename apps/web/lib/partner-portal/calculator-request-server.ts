import 'server-only'
import { createClient } from '@/lib/supabase/server'
import {
  readCalculatorRequestSubmission,
  type CalculatorRequestSubmission,
} from './calculator-request'
import { sendCalculatorRequestNotification } from './calculator-request-mail'
import {
  readMyCalculatorRequest,
  type MyCalculatorRequestState,
} from './my-calculator-request'

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

/**
 * DER LESEWEG DES FACHBETRIEBS (B18-4, Portal-Oberfläche): die eigene, letzte Anfrage.
 *
 * ── WARUM ER NICHT IN `readPortal` STECKT ───────────────────────────────────────────────────────
 * Dieselbe Begründung wie bei `readPartnerLeads` (B18-6): `readPortal` beantwortet die Frage, die
 * JEDE Seite des Bereichs stellt, und läuft auf vier Routen. Diese Anfrage braucht genau EINE Seite
 * — sie dort einzuhängen hiesse, bei jedem Aufruf von „Allgemein", „Marketing" und „Anfragen" eine
 * Abfrage zu fahren, deren Ergebnis niemand ansieht.
 *
 * ── DIE REIHENFOLGE AUF DER SEITE IST BINDEND, ABER NICHT AUS SICHERHEITSGRÜNDEN ────────────────
 * Der Wrapper ist an `auth.uid()` gebunden und antwortet ohne Sitzung `{status: none}` — er wäre
 * also nicht unsicher, sondern nutzlos. Der Grund ist ein anderer: Die Seite muss zuerst wissen, ob
 * sie überhaupt den Portal-Rahmen zeigt, und ob der Zugang womöglich schon besteht.
 *
 * WIRFT NICHT. Jeder Fehlschlag wird geloggt und zu `{state: 'error'}` — und `error` führt auf der
 * Seite ausdrücklich NICHT zu einem Formular (Begründung in `my-calculator-request.ts`).
 */
export async function readMyCalculatorRequestState(): Promise<MyCalculatorRequestState> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('get_my_calculator_request')
  if (error) console.error('[calculator-request] get_my_calculator_request:', error)

  return readMyCalculatorRequest(data, error)
}
