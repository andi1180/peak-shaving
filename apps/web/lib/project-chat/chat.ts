import 'server-only'

import {
  classifyDocument,
  extractBatteryText,
  extractInvoiceData,
  extractPvDesign,
} from 'extractors'

import { runProjectChatTurn, type ProjectChatTurnResult } from './agent'
import { callProjectChatModel } from './model'
import type { ChatExtractors } from './ports'
import { createProjectChatPorts } from './supabase-ports'

/**
 * B24 — EIN CHAT-TURN, VON AUSSEN GESEHEN. Der Einstieg, den eine Oberfläche in einer Zeile ruft.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ HIER STEHT (NOCH) KEIN `'use server'`, UND DAS IST EINE ENTSCHEIDUNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Dies ist der Server-Action-PFAD: die Funktion, aus der die Oberfläche des nächsten Schritts mit
 * einer Zeile eine Server Action macht. Die Direktive fehlt bewusst, aus zwei Gründen, die
 * zusammenwirken:
 *
 *   (1) Ein Endpunkt ohne Aufrufer ist Angriffsfläche ohne Nutzen. Eine Server Action ist über ihre
 *       Kennung aufrufbar, auch wenn keine Oberfläche sie benutzt — wortgleiche Begründung wie im
 *       Kopf von `lib/project-documents/documents.ts` aus dem vorigen Schritt, dieselbe Regel, die
 *       TEIL 9 der Migration auf die Datenbank-Wrapper anwendet.
 *   (2) ⚠ Und hier wiegt sie SCHWERER als dort. Jeder Turn löst bis zu neun abrechenbare
 *       Modellaufrufe aus. Die Obergrenze in `ai-client.ts` begrenzt EINEN Turn, nicht die Zahl der
 *       Turns: die Kostenbremse (Delta §6.3) ist ausdrücklich noch nicht gebaut. Einen offenen,
 *       abrechenbaren Endpunkt zu veröffentlichen, bevor es sie gibt, wäre die Reihenfolge genau
 *       falsch herum.
 *
 * Wer die Oberfläche baut, setzt `'use server'` an den Anfang dieser Datei — und bringt die
 * Kostenbremse mit.
 *
 * ── DIE VIER EXTRAKTOREN SIND VERDRAHTET, BLEIBEN ABER EIN PARAMETER ──────────────────────────
 * Sie kamen aus `apps/website` und waren von dieser App aus nicht erreichbar; die drei gemessenen
 * Gründe stehen im Kopf von `packages/extractors/src/index.ts`. Seit der Konsolidierung in jenes
 * server-only-Paket hängen BEIDE Apps daran, und der Vorgabewert ist ab hier der echte Satz: der
 * Chat kann Rechnungen, PV-Auslegungen, Batterie-Freitext und Dokumentarten tatsächlich auslesen,
 * statt die vier Werkzeuge dem Modell gar nicht erst anzubieten.
 *
 * ⚠ Es bleibt ein PARAMETER und wird kein fester Import im Rumpf: `ProjectChatPorts.extractors`
 * ist der Vertrag, gegen den die Schleife geprüft wird, und ein Test muss einen Extraktor durch
 * einen Prüfstand ersetzen können, ohne einen abrechenbaren Modellaufruf auszulösen. Ein
 * übergebenes `Partial` überschreibt einzeln — was es nicht nennt, bleibt die echte Funktion.
 */
const DEFAULT_EXTRACTORS: ChatExtractors = {
  classifyDocument,
  extractInvoiceData,
  extractPvDesign,
  extractBatteryText,
}

export async function sendProjectChatMessage(
  projectId: string,
  userMessage: string,
  extractors: Partial<ChatExtractors> = {},
): Promise<ProjectChatTurnResult> {
  return runProjectChatTurn(projectId, userMessage, {
    ports: createProjectChatPorts({ ...DEFAULT_EXTRACTORS, ...extractors }),
    callModel: callProjectChatModel,
  })
}

export type { ProjectChatTurnResult }
