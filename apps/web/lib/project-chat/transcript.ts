import type Anthropic from '@anthropic-ai/sdk'

import type { StoredChatMessage } from './ports'

/**
 * B24 — DER VERLAUF, WIE IHN DER KUNDE SIEHT.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ZWEI DER VIER ROLLEN SIND KEIN KUNDENINHALT, UND DAS IST DER GANZE ZWECK DIESER DATEI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `platform.project_messages` führt vier Rollen (`user`, `assistant`, `tool_call`,
 * `tool_result`). Die feinere Ablage ist Absicht — die Zeilen-Granularität ist die
 * PRÜF-Granularität (Kopf von `history.ts`) —, aber sie bedeutet auch: **die Hälfte der Zeilen
 * eines Gesprächs ist interne Verdrahtung.**
 *
 * Was in `tool_call`/`tool_result` steht, ist nicht bloss unschön:
 *   – interne Feldnamen des Entwurfs (`energyPriceCtPerKwh`, `_provenance`),
 *   – Fehlercodes und Ablehnungsgründe der Extraktoren (`unreadable`, `not_configured`),
 *   – Rohwerte aus Kundendokumenten, unbestätigt und ohne die Einordnung, die das Modell in
 *     seiner Antwort daraus macht.
 *
 * Ein Kunde, der das liest, zieht daraus Schlüsse, die niemand geprüft hat — im schlimmsten Fall
 * eine Zahl aus einem `tool_result`, die das Modell im Text daneben ausdrücklich NICHT übernommen
 * hat, weil zwei Rechnungen sich widersprechen. Genau das ist die Doppelzählung in Textform.
 *
 * ── DIE UMKEHRUNG IST AUSDRÜCKLICH NICHT GEMEINT ──────────────────────────────────────────────
 * Es wird nichts VERSTECKT, was der Kunde gesagt hat, und nichts, was das Modell IHM geantwortet
 * hat. Gezeigt wird genau das Gespräch; weggelassen wird, womit die Anwendung dabei gearbeitet hat.
 *
 * ── WARUM EINE ERLAUBNISLISTE UND KEINE SPERRLISTE ────────────────────────────────────────────
 * Gezeigt wird, was AUSDRÜCKLICH `user` oder `assistant` ist. Eine fünfte Rolle — die es heute
 * nicht gibt — erschiene damit NICHT von selbst im Verlauf des Kunden; mit einer Sperrliste
 * (`role !== 'tool_call' && role !== 'tool_result'`) täte sie das, und niemand merkte es beim
 * Hinzufügen. Dieselbe Richtung wie bei der Blockauswahl darunter.
 *
 * ⚠ ZWEITE ERLAUBNISLISTE, EINE EBENE TIEFER: aus den Blöcken wird ausschliesslich `text`
 * genommen. `thinking`-Blöcke werden als `assistant` gespeichert (verbatim, samt Signatur — die
 * API verlangt sie unverändert zurück, s. `splitAssistantTurn`), sind aber ausdrücklich KEINE
 * Antwort an den Kunden; die Gedankenführung eines Modells vor jemandem auszubreiten, der eine
 * Auskunft erwartet, ist etwas anderes als Transparenz. Dieselbe Auswahl wie in `assistantText`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ EINE NUTZER-ZEILE TRÄGT DIE WORTE DES MENSCHEN IM ERSTEN BLOCK — ALLES DAHINTER IST KONTEXT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Seit dem achten Bauschritt hängt `agent.ts` an die Nutzer-Zeile eines Turns, in dem Dokumente
 * neu hochgeladen wurden, einen zweiten Textblock: den Anhang-Vermerk (Kennung + Dateiname). Der
 * MUSS gespeichert werden — der Verlauf ist das, was beim nächsten Turn wieder eingespielt wird,
 * und ein Modell, das dort eine Rechnung auslesen sieht, ohne dass jemand sie erwähnt hat, liest
 * einen Verlauf, den es so nie gegeben hat.
 *
 * Gezeigt wird er trotzdem nicht, und zwar aus zwei Gründen:
 *   (1) Er trägt eine ROHE UUID. Für das Modell ist sie das eindeutige Argument der
 *       Extraktions-Werkzeuge; für den Kunden ist sie Rauschen mitten in seinem eigenen Satz.
 *   (2) Die Oberfläche zeigt die angehängten Dateien ohnehin — als Chip an der Nachricht, mit
 *       ihrem Namen. Der Vermerk daneben wäre dieselbe Auskunft ein zweites Mal, nur unlesbar.
 *
 * ⚠ DIE REGEL IST STRUKTURELL, NICHT TEXTLICH. Es wird ausdrücklich NICHT nach einer
 * Markierung im Text gesucht: ein Kunde, der diese Zeichenfolge selbst tippt, sähe sonst seine
 * eigene Nachricht verschwinden. Stattdessen gilt der Vertrag, den `agent.ts` an genau EINER
 * Stelle herstellt — Nutzer-Zeilen entstehen nirgendwo sonst: **Block 0 sind die Worte des
 * Menschen, jeder weitere Block ist maschinell angehängter Kontext dieses Turns.** Wer dort je
 * einen zweiten menschlichen Block ergänzt, muss diese Datei mit ändern; der Test daneben hält
 * den Vertrag fest.
 *
 * Für `assistant` gilt die Regel NICHT — dort ist jeder Textblock Antwort an den Kunden, und ein
 * Modell darf seine Antwort auf mehrere Blöcke verteilen.
 */

export interface TranscriptEntry {
  /** Nur die zwei Seiten, die ein Mensch geschrieben bzw. gelesen hat. */
  role: 'user' | 'assistant'
  text: string
}

const VISIBLE_ROLES = ['user', 'assistant'] as const

function isText(block: Anthropic.ContentBlockParam): block is Anthropic.TextBlockParam {
  return block.type === 'text'
}

/** Alle Textblöcke — die Form für `assistant`. */
function allText(content: readonly Anthropic.ContentBlockParam[]): string {
  return content.filter(isText).map((block) => block.text).join('').trim()
}

/**
 * NUR der erste Block, und nur wenn er Text ist — die Form für `user`.
 *
 * Der zweite Teil der Bedingung ist kein Zierrat: wäre Block 0 je etwas anderes als Text, wäre der
 * Vertrag aus dem Kopf dieser Datei gebrochen, und dann ist „gar nichts zeigen" die richtige
 * Antwort — nicht „den nächsten Block nehmen, vielleicht passt der".
 */
function humanText(content: readonly Anthropic.ContentBlockParam[]): string {
  const first = content[0]
  if (first === undefined || !isText(first)) return ''
  return first.text.trim()
}

/**
 * Die sichtbaren Zeilen eines Verlaufs, in gespeicherter Reihenfolge (älteste zuerst).
 *
 * Zeilen ohne sichtbaren Text fallen weg statt als leere Sprechblase zu erscheinen: eine
 * Assistenten-Zeile kann ausschliesslich aus `thinking` bestehen (das Modell denkt und ruft dann
 * ein Werkzeug, ohne dazwischen etwas zu sagen), und eine leere Blase im Gespräch sähe aus wie ein
 * Fehler der Anwendung.
 *
 * ⚠ Aufeinanderfolgende Zeilen werden hier NICHT verschmolzen — anders als in `toApiMessages`,
 * und aus dem umgekehrten Grund: dort verlangt die API eine Nachricht je Seite, hier ist jede
 * gespeicherte Zeile ein eigener Redebeitrag. Der Fall tritt real auf, wenn das Modell vor und
 * nach einem Werkzeugaufruf etwas sagt; zwei Blasen bilden das richtig ab, eine verschmolzene
 * behauptete einen Satz, den so niemand geschrieben hat.
 */
export function visibleTranscript(rows: readonly StoredChatMessage[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []

  for (const row of rows) {
    if (!(VISIBLE_ROLES as readonly string[]).includes(row.role)) continue
    if (!Array.isArray(row.content)) continue

    const text = row.role === 'user' ? humanText(row.content) : allText(row.content)
    if (text === '') continue

    entries.push({ role: row.role as TranscriptEntry['role'], text })
  }

  return entries
}
