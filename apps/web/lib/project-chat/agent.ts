import type Anthropic from '@anthropic-ai/sdk'

import { MAX_TOOL_CALLS_PER_TURN } from './ai-client'
import { executeChatTool } from './executor'
import { assistantText, splitAssistantTurn, toApiMessages } from './history'
import type { ProjectChatPorts, StoredChatMessage } from './ports'
import { PROJECT_CHAT_SYSTEM_PROMPT, buildProjectStateBlock } from './system-prompt'
import { buildChatTools } from './tools'

/**
 * B24 — DIE SCHLEIFE EINES CHAT-TURNS.
 *
 * ── DIE EINE INVARIANTE, DIE ALLES ANDERE BESTIMMT ────────────────────────────────────────────
 * ⚠ ZU JEDER `tool_call`-ZEILE ENTSTEHT IM SELBEN TURN EINE `tool_result`-ZEILE.
 *
 * Die Messages-API verlangt, dass auf eine Assistenten-Nachricht mit `tool_use`-Blöcken eine
 * Nutzer-Nachricht mit den passenden `tool_result`-Blöcken folgt. Bliebe ein Aufruf unbeantwortet
 * im Verlauf stehen, wäre das Projekt DAUERHAFT kaputt: jeder spätere Turn spielte denselben
 * ungültigen Verlauf wieder ein, und die API lehnte ihn jedes Mal ab. Es gibt in dieser Ablage
 * kein `delete` und kein `update` (bewusst, s. Migration) — es liesse sich also auch nicht
 * reparieren.
 *
 * Daraus folgt die Reihenfolge unten, und sie ist nicht die naheliegende:
 *
 *   1. Text des Modells speichern (`assistant`)
 *   2. Werkzeuge AUSFÜHREN
 *   3. erst jetzt `tool_call` speichern
 *   4. unmittelbar danach `tool_result` speichern
 *
 * Erst zu speichern und dann auszuführen wäre einfacher zu lesen und liesse zwischen Schritt und
 * Ergebnis die gesamte Ausführungszeit — jeder Abbruch dort hinterliesse den kaputten Zustand. So
 * ist das Fenster genau ein Datenbankaufruf breit, und beide Aufrufe sind derselbe Wrapper.
 *
 * ── DIE WERKZEUGE LAUFEN NACHEINANDER, NICHT PARALLEL ─────────────────────────────────────────
 * Die API erlaubt mehrere `tool_use`-Blöcke je Antwort, und die Empfehlung lautet, sie nebenläufig
 * auszuführen. Hier nicht: `set_draft_field` liest den Entwurf, ändert ein Feld und schreibt das
 * GANZE Objekt zurück (der Wrapper ersetzt, er verschmilzt nicht). Zwei nebenläufige Aufrufe lesen
 * denselben Stand, und der zweite Schreibvorgang verwürfe das Feld des ersten — ein Verlust, den
 * niemand bemerkte, weil beide Werkzeuge Erfolg meldeten. Die Ergebnisse gehen trotzdem in EINER
 * Nachricht zurück; genau das verlangt die API.
 */

export interface ModelCallInput {
  system: Anthropic.TextBlockParam[]
  tools: Anthropic.Tool[]
  messages: Anthropic.MessageParam[]
}

export type ModelCallResult =
  | { ok: true; content: Anthropic.ContentBlock[] }
  | { ok: false; reason: 'not_configured' | 'api_error' }

/** Der Modellaufruf als Port — damit die Schleife ohne Schlüssel und ohne Netz prüfbar bleibt. */
export type ChatModelCall = (input: ModelCallInput) => Promise<ModelCallResult>

export type ProjectChatTurnResult =
  /** Das Modell hat geantwortet. `reply` ist der sichtbare Text (kann leer sein). */
  | { status: 'ok'; reply: string; toolCalls: number }
  /** Die Obergrenze war erreicht. Der Verlauf ist gültig, der Turn hat nur kein Schlusswort. */
  | { status: 'tool_limit'; toolCalls: number }
  /** Das Projekt gibt es nicht ODER es gehört jemand anderem — bewusst nicht unterscheidbar. */
  | { status: 'not_found' }
  /** Kein KI-Zugang eingerichtet. Kein Aufruf, keine Kosten. */
  | { status: 'not_configured' }
  /** Der Modellaufruf ist gescheitert (Netz, Kontingent, Ablehnung). Wiederholbar. */
  | { status: 'model_error' }
  /** Eine Zeile liess sich nicht speichern. Abbruch, bevor der Verlauf inkonsistent wird. */
  | { status: 'storage_error'; step: string }
  /** Die Nachricht des Nutzers war leer. */
  | { status: 'empty_message' }

export interface RunProjectChatTurnDeps {
  ports: ProjectChatPorts
  callModel: ChatModelCall
  now?: () => Date
}

export async function runProjectChatTurn(
  projectId: string,
  userMessage: string,
  deps: RunProjectChatTurnDeps,
): Promise<ProjectChatTurnResult> {
  const { ports, callModel } = deps
  const now = deps.now ?? (() => new Date())

  const text = userMessage.trim()
  if (text === '') return { status: 'empty_message' }

  /*
   * ⚠ DIE EIGENTUMSFRAGE WIRD HIER ERNEUT GESTELLT, obwohl jeder einzelne Wrapper sie ohnehin
   * stellt. Sie steht am Anfang, damit ein fremdes Projekt gar keinen Modellaufruf auslöst: jeder
   * Aufruf ist abrechenbar, und eine Ablehnung erst am ersten Werkzeug wäre bereits bezahlt.
   * Die Antwort kommt trotzdem aus der DATENBANK (`platform.project_accessible` gegen `auth.uid()`)
   * und nie aus einem übergebenen Wert.
   */
  const project = await ports.loadProject(projectId)
  if (project === null) return { status: 'not_found' }

  const tools = buildChatTools(ports.extractors)

  const [documents, openQuestions] = await Promise.all([
    ports.listDocuments(projectId),
    ports.listOpenQuestions(projectId),
  ])

  /*
   * ── DIE ZWEI SYSTEM-BLÖCKE ──────────────────────────────────────────────────────────────────
   * Der stabile Teil trägt `cache_control` und steht zuerst; der Zustandsblock wechselt und steht
   * dahinter. Das Anfrage-Präfix (Werkzeuge, dann Block 1) bleibt damit über die Sitzung
   * zwischenspeicherbar — stünde der Zustand voran, wäre bei jedem Turn alles danach ungültig.
   *
   * Der Zustandsblock entsteht EINMAL je Nutzer-Turn. Was das Modell innerhalb des Turns selbst
   * ändert, erfährt es aus seinen eigenen Werkzeug-Ergebnissen; ihn je Durchlauf neu zu bauen
   * kostete je eine zusätzliche Fahrt zur Datenbank für dieselbe Auskunft.
   */
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: PROJECT_CHAT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    {
      type: 'text',
      text: buildProjectStateBlock({ project, documents, openQuestions, extractors: ports.extractors }),
    },
  ]

  const history: StoredChatMessage[] = [...(await ports.loadMessages(projectId))]

  const userRow: StoredChatMessage = { role: 'user', content: [{ type: 'text', text }] }
  const appendedUser = await ports.appendMessage(projectId, 'user', userRow.content)
  if (appendedUser.status !== 'ok') {
    return { status: 'storage_error', step: `user:${appendedUser.status}` }
  }
  history.push(userRow)

  let toolCalls = 0

  for (;;) {
    const result = await callModel({ system, tools, messages: toApiMessages(history) })
    if (!result.ok) {
      return result.reason === 'not_configured'
        ? { status: 'not_configured' }
        : { status: 'model_error' }
    }

    const rows = splitAssistantTurn(result.content)
    const textRows = rows.filter((row) => row.role === 'assistant')
    const callRows = rows.filter((row) => row.role === 'tool_call')

    // Schritt 1 — der Text des Modells. Er steht chronologisch vor den Aufrufen.
    for (const row of textRows) {
      const appended = await ports.appendMessage(projectId, row.role, row.content)
      if (appended.status !== 'ok') {
        return { status: 'storage_error', step: `assistant:${appended.status}` }
      }
      history.push(row)
    }

    const toolUses = result.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    )

    /*
     * Keine Werkzeuge — der Turn ist zu Ende. Das gilt auch bei `stop_reason: 'max_tokens'`: die
     * Antwort ist dann abgeschnitten, aber sie ist vollständig gespeichert und der Verlauf gültig.
     * Ein eigener Fehlerzustand dafür hülfe niemandem; der Kunde sieht einen abgebrochenen Satz und
     * schreibt zurück.
     */
    if (toolUses.length === 0) {
      return { status: 'ok', reply: assistantText(result.content), toolCalls }
    }

    // Schritt 2 — ausführen, NACHEINANDER (s. Kopf).
    const resultBlocks: Anthropic.ToolResultBlockParam[] = []
    for (const use of toolUses) {
      /*
       * ⚠ Der Ausführer selbst antwortet auf jeden Fall mit einem Ergebnis; was hier aufgefangen
       * wird, ist eine abgelehnte Zusage aus einem PORT (Netz weg, Datenbank weg). Ohne dieses
       * try/catch bräche die Schleife nach dem Ausführen und vor dem Speichern — und genau dann
       * stünde ein Aufruf ohne Ergebnis im Verlauf.
       */
      let execution
      try {
        execution = await executeChatTool(ports, projectId, use.name, use.input, now())
      } catch (cause) {
        console.error('[project-chat] Werkzeug fehlgeschlagen:', use.name, cause)
        execution = {
          content: JSON.stringify({ error: 'Das Werkzeug ist unerwartet fehlgeschlagen.' }),
          isError: true,
        }
      }
      resultBlocks.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: execution.content,
        ...(execution.isError ? { is_error: true } : {}),
      })
    }

    // Schritt 3 + 4 — Aufruf und Ergebnis, unmittelbar nacheinander.
    for (const row of callRows) {
      const appended = await ports.appendMessage(projectId, row.role, row.content)
      if (appended.status !== 'ok') {
        return { status: 'storage_error', step: `tool_call:${appended.status}` }
      }
      history.push(row)
    }

    const appendedResults = await ports.appendMessage(projectId, 'tool_result', resultBlocks)
    if (appendedResults.status !== 'ok') {
      return { status: 'storage_error', step: `tool_result:${appendedResults.status}` }
    }
    history.push({ role: 'tool_result', content: resultBlocks })

    toolCalls += toolUses.length

    /*
     * ── DER SAUBERE ABBRUCH ─────────────────────────────────────────────────────────────────────
     * Er kommt NACH dem Speichern der Ergebnisse, nie davor: der Verlauf ist damit auch im
     * Abbruchfall gültig, und der nächste Turn läuft normal weiter. Es wird bewusst KEINE
     * Abschluss-Nachricht erfunden — dem Modell Worte in den Mund zu legen wäre schlimmer als ein
     * Turn ohne Schlusswort, und der Aufrufer erfährt den Zustand am Rückgabewert.
     */
    if (toolCalls >= MAX_TOOL_CALLS_PER_TURN) {
      return { status: 'tool_limit', toolCalls }
    }
  }
}
