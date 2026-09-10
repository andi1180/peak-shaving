import type Anthropic from '@anthropic-ai/sdk'

import type { ChatMessageRole, StoredChatMessage } from './ports'

/**
 * B24 — DIE ZEILEN DES VERLAUFS ZURÜCK IN API-NACHRICHTEN.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DAS IST DIE AUFLAGE, DIE DIE MIGRATION AUSDRÜCKLICH AN DIESEN SCHRITT GESTELLT HAT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Wörtlich, im Kopf von `platform.project_messages`: „beim Wiedereinspielen in die API müssen
 * aufeinanderfolgende Zeilen wieder zu API-Nachrichten ZUSAMMENGEFASST werden (`assistant` +
 * `tool_call` → EINE Assistenten-Nachricht mit mehreren Blöcken; `tool_result` → eine
 * Nutzer-Nachricht)."
 *
 * Der Grund für die feinere Ablage steht dort ebenfalls: die Zeilen-Granularität ist die
 * PRÜF-Granularität. Wer wissen will, welche Werkzeuge ein Gespräch angefasst hat, filtert eine
 * Spalte, statt jeden Block jeder Nachricht zu zerlegen. Der Preis dafür ist genau diese Datei.
 *
 * ── DIE REGEL IST EINE SEITEN-REGEL, KEINE VIER-ROLLEN-REGEL ──────────────────────────────────
 * Die Messages-API kennt zwei Seiten. Die vier Zeilen-Rollen fallen sauber darauf:
 *
 *     assistant, tool_call    →  role 'assistant'
 *     user, tool_result       →  role 'user'
 *
 * Aufeinanderfolgende Zeilen DERSELBEN Seite werden zu EINER Nachricht verschmolzen, ihre Blöcke in
 * Zeilenreihenfolge aneinandergehängt. Das ist nicht bloss hübscher: die API verlangt, dass auf
 * eine Assistenten-Nachricht mit `tool_use`-Blöcken eine Nutzer-Nachricht mit den passenden
 * `tool_result`-Blöcken folgt. Zerlegte man die Ergebnisse auf mehrere Nachrichten, wäre das nicht
 * nur formal falsch — es bringt dem Modell bei, keine parallelen Werkzeugaufrufe mehr zu machen.
 *
 * ⚠ Die Reihenfolge INNERHALB einer Nutzer-Nachricht ergibt sich von selbst richtig: `tool_result`
 * entsteht zeitlich vor der nächsten Nutzer-Eingabe, steht also in `list_project_messages`
 * (älteste zuerst) davor. Wer diese Sortierung je umdreht, dreht damit auch die Blöcke um.
 */

const ASSISTANT_SIDE: readonly ChatMessageRole[] = ['assistant', 'tool_call']

function sideOf(role: ChatMessageRole): 'assistant' | 'user' {
  return ASSISTANT_SIDE.includes(role) ? 'assistant' : 'user'
}

/**
 * Fasst die gespeicherten Zeilen zu API-Nachrichten zusammen.
 *
 * Leere Blocklisten werden übersprungen: `append_project_message` weist sie zwar ab, aber ein
 * Bestand aus einer früheren Fassung oder ein Eingriff von Hand soll hier keine Nachricht ohne
 * Inhalt erzeugen — die API lehnte sie ab, und der Fehler zeigte auf den falschen Turn.
 */
export function toApiMessages(rows: readonly StoredChatMessage[]): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = []

  for (const row of rows) {
    if (row.content.length === 0) continue

    const side = sideOf(row.role)
    const last = messages[messages.length - 1]

    if (last !== undefined && last.role === side && Array.isArray(last.content)) {
      last.content.push(...row.content)
      continue
    }

    messages.push({ role: side, content: [...row.content] })
  }

  return messages
}

/**
 * Zerlegt die Antwort des Modells in die Zeilen, die gespeichert werden.
 *
 * ── ⚠ ALLES AUSSER `tool_use` GEHT ALS `assistant` ZURÜCK, VERBATIM ──────────────────────────
 * Auch `thinking`-Blöcke. Das Modell läuft mit adaptivem Denken (Sonnet 5, Vorgabewert), und die
 * Regel der API lautet: Denk-Blöcke unverändert zurückgeben, solange dasselbe Modell weiterläuft.
 * Sie tragen eine Signatur; sie neu zu bauen oder wegzulassen ist beides falsch. `content jsonb`
 * der Migration nimmt sie ohne Weiteres auf — es gibt keinen Grund, hier auszusortieren, und der
 * einzige Weg, es richtig zu machen, ist, gar nicht erst auszuwählen.
 *
 * Die Reihenfolge der zwei Zeilen ist fest: erst `assistant`, dann `tool_call`. Beim
 * Wiedereinspielen verschmelzen sie zu einer Nachricht, und dort gehört der Text vor den Aufruf —
 * so, wie das Modell ihn erzeugt hat.
 */
export function splitAssistantTurn(content: readonly Anthropic.ContentBlock[]): StoredChatMessage[] {
  const toolUse = content.filter((block) => block.type === 'tool_use')
  const rest = content.filter((block) => block.type !== 'tool_use')

  const rows: StoredChatMessage[] = []
  if (rest.length > 0) {
    rows.push({ role: 'assistant', content: rest as unknown as Anthropic.ContentBlockParam[] })
  }
  if (toolUse.length > 0) {
    rows.push({ role: 'tool_call', content: toolUse as unknown as Anthropic.ContentBlockParam[] })
  }
  return rows
}

/**
 * Der sichtbare Text einer Modellantwort — das, was der Kunde liest.
 *
 * Denk-Blöcke kommen hier ausdrücklich NICHT vor: sie sind unter dem Vorgabewert `display: omitted`
 * ohnehin leer, und selbst wenn nicht, ist die Gedankenführung keine Antwort an den Kunden.
 */
export function assistantText(content: readonly Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
}
