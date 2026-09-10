import 'server-only'

// KEIN `eslint-disable` — die Erlaubnis kommt aus der Allowlist in der root-`eslint.config.mjs`,
// und zwar für GENAU diese Datei. Ein Disable-Kommentar hier wäre nicht bloss überflüssig: er würde
// die Regel auch dann stumm stellen, wenn jemand die Datei später aus der Allowlist nimmt.
import {
  PROJECT_CHAT_MAX_TOKENS,
  PROJECT_CHAT_MODEL,
  createProjectChatClient,
} from '@/lib/project-chat/ai-client'
import type { ModelCallInput, ModelCallResult } from './agent'

/**
 * B24 — DER EINZIGE EXTERNE KI-AUFRUF DIESER SCHLEIFE.
 *
 * ── DIE GANZE FLÄCHE IN EINER DATEI, UND SIE IST EIN AUFRUF GROSS ─────────────────────────────
 * Dieses Modul ist die einzige Stelle, die den KI-Client des Projekt-Chats benutzen darf
 * (ESLint-Allowlist im root `eslint.config.mjs` nennt genau diese Datei — nicht das Verzeichnis:
 * daneben liegen die Schleife und der Werkzeug-Ausführer, und die sollen sich ihren Zugang nicht
 * selbst bauen können). Wie bei den sechs bestehenden Anbindungen gibt es hier bewusst KEINE
 * allgemeine, wiederverwendbare API-Hilfsfunktion — eine solche wäre der Anfang einer zweiten,
 * unkontrollierten Fläche.
 *
 * ── ⚠ WAS HIER NICHT STEHT UND WARUM ──────────────────────────────────────────────────────────
 * KEIN `thinking`-Parameter: Sonnet 5 läuft ohne Angabe adaptiv, und das ist die gewollte
 * Einstellung. KEIN `output_config.effort`: der Vorgabewert (`high`) ist für die erste Fassung
 * richtig; ihn zu senken ist eine Abstimmungs-Entscheidung mit einer Messung davor, keine
 * Bauentscheidung. KEIN Streaming: eine Chat-Antwort mit 8192 Token liegt weit unter jeder
 * HTTP-Zeitgrenze, und ein Stream brächte hier nichts, solange es keine Oberfläche gibt, die ihn
 * anzeigen könnte.
 *
 * ⚠ Die Denk-Blöcke der Antwort werden vom Aufrufer UNVERÄNDERT gespeichert und wieder
 * eingespielt (`history.ts`); hier wird nichts aussortiert. Sie tragen eine Signatur, und die Regel
 * der API lautet, sie auf demselben Modell unverändert zurückzugeben.
 */
export async function callProjectChatModel(input: ModelCallInput): Promise<ModelCallResult> {
  let client
  try {
    client = createProjectChatClient()
  } catch {
    /*
     * Der Wurf kommt aus `requireEnv` und trägt nur den Variablennamen — er wird trotzdem nicht
     * weitergereicht: der Aufrufer bekommt einen Zustand, keinen Stacktrace.
     */
    return { ok: false, reason: 'not_configured' }
  }

  try {
    const response = await client.messages.create({
      model: PROJECT_CHAT_MODEL,
      max_tokens: PROJECT_CHAT_MAX_TOKENS,
      system: input.system,
      tools: input.tools,
      messages: input.messages,
    })
    return { ok: true, content: response.content }
  } catch (cause) {
    /*
     * ⚠ HIER STEHT KEIN GESPRÄCHSINHALT IM LOG. Ein Fehlerlog ist kein zulässiger zweiter
     * Speicherort für Kundentext (dieselbe Regel wie in `invoice-scan/extract.ts` und im
     * Lead-Pfad). Protokolliert wird die Ursache — sie trägt bei einem SDK-Fehler Statuscode und
     * Meldung, nicht die gesendete Nutzlast.
     */
    console.error('[project-chat] Modellaufruf fehlgeschlagen:', cause)
    return { ok: false, reason: 'api_error' }
  }
}
