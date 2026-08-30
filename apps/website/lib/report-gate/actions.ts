'use server'

import { headers } from 'next/headers'
import { parseReportGate, reportGateDisplayName, type ReportGateSubmission } from 'shared'

import { captureReportGateLead, getReportGateConsentText } from './store'

/**
 * Delta 16b — DER ERSTE SERVER-KONTEXT VON `apps/website` ÜBERHAUPT.
 *
 * Bis hierher hatte diese App 0 `route.ts` und 0 `'use server'`; gerechnet wurde ausschliesslich im
 * Browser (Prinzip 4). Diese Datei ändert daran nichts für die VERBRAUCHSDATEN — sie nimmt Name,
 * Firma, Adresse und die Einwilligung entgegen und sonst NICHTS. Lastgang, PV-Profil und die
 * hochgeladene Datei bleiben, wo sie sind; sie kommen an dieser Stelle nicht einmal vor.
 *
 * ── WARUM EINE SERVER ACTION UND KEIN ROUTE HANDLER ────────────────────────────────────────────
 * Dieselbe Abwägung wie in `apps/web/lib/leads/capture-action.ts`: Ein Route Handler wäre ein
 * zweiter ÖFFENTLICHER Endpunkt mit einer stabilen Adresse, den jeder unabhängig vom Formular
 * ansprechen kann. Hier gibt es nichts, was ein solcher Endpunkt zusätzlich leisten müsste — es
 * wird keine Zustellung getragen und kein Fremdsystem eingebunden. Die Action bindet das Formular
 * an die Seite, auf der es steht.
 *
 * ⚠ Der Schutz liegt trotzdem NICHT in der Action-Form: eine Server Action ist über ihre ID
 * ebenfalls aufrufbar. Er liegt darin, dass Herkunft und Zweck hier fest stehen und der Contract
 * für beide gar kein Feld hat (`shared/report-gate.ts`).
 *
 * ── DIESE DATEI IST VERDRAHTUNG ────────────────────────────────────────────────────────────────
 * Die Prüfregel steht in `packages/shared` (rein, getestet, vom Formular geteilt), der
 * Datenbank-Rand in `./store.ts` (zwei Aufrufe, sonst nichts).
 */

/**
 * Die Antwort des Gates.
 *
 * `customer` ist der einzige Rückgabewert mit Inhalt — genau die zwei Zeichenketten, die auf dem
 * Deckblatt landen (`PrintCover.customer`). Es fährt insbesondere KEINE `leadId` und kein
 * `outcome` zurück: was der Client nicht erfährt, kann er nicht weitergeben, und die Frage „gibt es
 * diese Adresse schon?" darf ein öffentliches Formular nicht beantworten.
 */
export type ReportGateResponse =
  | { ok: true; customer: { name: string; company: string } }
  | { ok: false; error: 'validation'; fieldErrors: Record<string, string> }
  | { ok: false; error: 'consent_missing' | 'spam' | 'unavailable' }

/**
 * Der Wortlaut der Einwilligung für die Anzeige — serverseitig aufgelöst.
 *
 * `null` heisst: es gibt keine Fassung, die Ankreuzmöglichkeit wird NICHT gezeigt und das Absenden
 * bleibt gesperrt. Ein Infrastrukturfehler führt zum selben Ergebnis (gefangen, nicht geworfen):
 * ein Formular, das mit einem Stacktrace abbricht, ist schlechter als eines, das ehrlich sagt, dass
 * es gerade nicht geht. Der Download ist davon unberührt — er ist nur gesperrt, nicht kaputt.
 */
export async function loadReportGateConsentText(): Promise<string | null> {
  try {
    return await getReportGateConsentText()
  } catch (cause) {
    console.error('[report-gate] Einwilligungstext nicht lesbar:', cause)
    return null
  }
}

export async function submitReportGate(
  submission: ReportGateSubmission,
): Promise<ReportGateResponse> {
  /*
   * DIE PRÜFUNG LÄUFT VOR JEDEM DATENBANK-KONTAKT. Scheitert sie, entsteht KEIN Client und KEIN
   * RPC — nicht „die Datenbank lehnt ab", sondern sie wird gar nicht erst befragt. Dieselbe Haltung
   * wie in `apps/web/lib/admin/analysis-upload.ts` (B14-2).
   */
  const parsed = parseReportGate(submission)

  if (!parsed.ok) {
    if (parsed.reason === 'spam') {
      /*
       * Honeypot — ABGELEHNT und nicht still als Erfolg quittiert, wortgleich zur Begründung in
       * `apps/web/lib/leads/capture-flow.ts`: ein falscher Erfolg gäbe den Download frei, ohne dass
       * je eine Einwilligung entstanden wäre. Träfe die Falle einen echten Menschen (Autofill),
       * sähe er eine Absage und könnte sich melden — statt zu glauben, alles sei in Ordnung.
       */
      console.warn('[report-gate] Honeypot gefüllt — Erfassung abgelehnt.')
      return { ok: false, error: 'spam' }
    }
    if (parsed.reason === 'consent_missing') return { ok: false, error: 'consent_missing' }
    return { ok: false, error: 'validation', fieldErrors: parsed.fieldErrors }
  }

  const headerList = await headers()
  /*
   * `x-forwarded-for` kann eine Kette sein („client, proxy1, proxy2"); der erste Eintrag ist der
   * Client. Dieselbe Auswertung wie in `apps/web` — der Wert dient dem Einwilligungsnachweis
   * (B1-1), nie als Zugangskontrolle.
   */
  const sourceIp = headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = headerList.get('user-agent')

  try {
    await captureReportGateLead({ values: parsed.values, sourceIp, userAgent })
  } catch (cause) {
    /*
     * ⚠ HIER WIRD BEWUSST NICHT FREIGEGEBEN. Im Erfassungspfad von `apps/web` wird ein Fehlschlag
     * verschluckt und der Nutzer sieht trotzdem „danke" — dort wiegt die Kundenanfrage schwerer als
     * der Lead, und die Anfrage ist bereits auf dem Weg. Hier ist es umgekehrt: die Einwilligung
     * IST die Gegenleistung für den Download. Gäbe ihn ein gescheiterter Schreibversuch trotzdem
     * frei, stünde am Ende ein personalisierter Report ohne jede Einwilligung im Bestand — und
     * niemand wüsste davon.
     *
     * Die Adresse steht in keinem Log-Text: ein Fehlerlog ist kein zulässiger zweiter Speicherort
     * für Personenbezug.
     */
    console.error('[report-gate] Erfassung fehlgeschlagen:', cause)
    return { ok: false, error: 'unavailable' }
  }

  /*
   * KEINE Verzweigung am `outcome`. Alle Ausgänge von `capture_lead` bedeuten hier dasselbe: Lead
   * und Einwilligung stehen (bei 'suppressed' steht der Lead, und die Sperre betrifft den
   * MAILVERSAND — aus diesem Gate geht keine Mail hinaus, sie hat auf den Download keine Wirkung).
   * Eine Unterscheidung wäre zudem genau die Auskunft über den Bestand, die ein öffentliches
   * Formular nicht geben darf.
   */
  return {
    ok: true,
    customer: { name: reportGateDisplayName(parsed.values), company: parsed.values.company },
  }
}
