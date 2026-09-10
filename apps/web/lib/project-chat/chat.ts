import 'server-only'

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
 * ── DIE VIER EXTRAKTOREN SIND EIN PARAMETER ───────────────────────────────────────────────────
 * Sie liegen in `apps/website` und sind von dieser App aus nicht erreichbar; die drei gemessenen
 * Gründe stehen im Kopf von `ports.ts`. Der Aufrufer reicht herein, was er hat — heute nichts, und
 * dann fehlen genau die vier Dokument-Werkzeuge, sichtbar und benannt.
 */
export async function sendProjectChatMessage(
  projectId: string,
  userMessage: string,
  extractors: Partial<ChatExtractors> = {},
): Promise<ProjectChatTurnResult> {
  return runProjectChatTurn(projectId, userMessage, {
    ports: createProjectChatPorts(extractors),
    callModel: callProjectChatModel,
  })
}

export type { ProjectChatTurnResult }
