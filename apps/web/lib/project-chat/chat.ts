'use server'

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
 * ⚠ AB HIER IST DER CHAT EIN ÖFFENTLICHER ENDPUNKT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Das `'use server'` oben macht aus dieser Datei eine Server Action: Next erzeugt daraus einen über
 * eine Kennung aufrufbaren HTTP-Endpunkt, und zwar UNABHÄNGIG davon, ob irgendeine Oberfläche ihn
 * benutzt. Genau deshalb hat die Direktive bis hierher gefehlt — der Kopf dieser Datei nannte seit
 * dem dritten Bauschritt zwei Gründe, und der schwerere lautete: jeder Turn löst bis zu neun
 * ABRECHENBARE Modellaufrufe aus, die Obergrenze in `ai-client.ts` begrenzt EINEN Turn und nicht
 * die Zahl der Turns, und einen offenen abrechenbaren Endpunkt zu veröffentlichen, bevor es eine
 * Kostenbremse gibt, wäre die Reihenfolge genau falsch herum.
 *
 * Die Bremse gibt es jetzt (Delta §6.3, Migration `…_create_chat_rate_limit.sql`): `agent.ts` fragt
 * `public.check_chat_rate_limit` VOR dem ersten Modellaufruf und bricht fail closed ab. Damit ist
 * die Bedingung erfüllt, unter der diese Datei veröffentlicht werden durfte.
 *
 * ── ⚠ DREI DINGE, DIE AN EINEM SERVER-ACTION-RAND ANDERS SIND ─────────────────────────────────
 *   (1) DIE TYPEN GELTEN NICHT. Die Argumente kommen deserialisiert vom Client; TypeScript prüft
 *       den AUFRUF, nicht die Nutzlast. Ein Aufruf mit einer Zahl, einem Objekt oder `null` ist
 *       möglich, und `userMessage.trim()` in `agent.ts` würfe darauf einen TypeError. Beide
 *       Argumente werden deshalb HIER geprüft, bevor irgendetwas geschieht.
 *   (2) DIE ZUGRIFFSFRAGE STELLT DIE DATENBANK, NICHT DIESE FUNKTION. Es gibt bewusst keinen
 *       Sitzungs-Parameter und keine Konto-Kennung: der gesamte Zugriffsschutz hängt an
 *       `auth.uid()` (`platform.project_accessible`), und ein übergebener Wert, dem geglaubt würde,
 *       wäre die eine Stelle, an der ein Fehler zu einem Leck über Kundengrenzen würde (wortgleiche
 *       Auflage wie in `lib/project-documents/storage.ts`).
 *   (3) DIE EXTRAKTOREN SIND KEIN PARAMETER MEHR. Bis hierher nahm diese Funktion ein
 *       `Partial<ChatExtractors>` entgegen — ein reiner PRÜF-Zugang. An einem öffentlichen Endpunkt
 *       wäre er eine Einladung: ein Client könnte `{classifyDocument: {}}` schicken, `buildChatTools`
 *       böte das Werkzeug an, und der Ausführer riefe ein Objekt als Funktion auf. Ein Prüfstand
 *       gehört nicht in die Signatur eines Endpunkts — die Schleife ist ohnehin über
 *       `runProjectChatTurn` samt `ProjectChatPorts` prüfbar, und genau so tun es die Tests.
 *
 * ── DIE VIER EXTRAKTOREN BLEIBEN EIN PORT, NUR NICHT MEHR VON AUSSEN SETZBAR ──────────────────
 * Sie kamen aus `apps/website` und waren von dieser App aus nicht erreichbar; die drei gemessenen
 * Gründe stehen im Kopf von `packages/extractors/src/index.ts`. Seit der Konsolidierung in jenes
 * server-only-Paket hängen BEIDE Apps daran, und hier steht der echte Satz: der Chat kann
 * Rechnungen, PV-Auslegungen, Batterie-Freitext und Dokumentarten tatsächlich auslesen.
 * `ProjectChatPorts.extractors` bleibt der Vertrag, gegen den die Schleife geprüft wird — er wird
 * nur nicht mehr über diesen Endpunkt gefüllt.
 *
 * ── ⚠ EINE BENANNTE, NICHT GESCHLOSSENE GRENZE ────────────────────────────────────────────────
 * `apps/web/next.config.mjs` hebt `serverActions.bodySizeLimit` auf 24 MB (wegen des
 * Analyse-Uploads, B14-2). Eine sehr lange Nachricht läuft damit bis in den Modellaufruf und wird
 * erst dort abgewiesen — die API lehnt zu viele Eingabe-Tokens mit HTTP 400 ab, also VOR der
 * Inferenz und damit ohne Abrechnung; für den Nutzer erscheint sie als `model_error`. Eine
 * Längengrenze wäre eine Zahl, die niemand entschieden hat (dieselbe Zurückhaltung wie bei
 * `extension_text`), und sie gehört zusammen mit der Oberfläche entschieden, die die Eingabe zeigt.
 */
const DEFAULT_EXTRACTORS: ChatExtractors = {
  classifyDocument,
  extractInvoiceData,
  extractPvDesign,
  extractBatteryText,
}

/**
 * Ein Projekt wird ausschliesslich über eine UUID angesprochen. Die Prüfung ist kein
 * Schönheitswettbewerb: ein Nicht-UUID-Wert liefe als Parameter in einen rohen Postgres-Fehler
 * (22P02), und der käme als `rpc_error` und damit als `not_found` zurück — dasselbe Ergebnis, nur
 * mit einer Datenbankfahrt und einem Eintrag im Fehlerlog für etwas, das hier in einer Zeile
 * feststeht.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function sendProjectChatMessage(
  projectId: string,
  userMessage: string,
): Promise<ProjectChatTurnResult> {
  /*
   * ⚠ Die zwei Prüfungen antworten mit den BESTEHENDEN Turn-Zuständen, nicht mit neuen. Eine
   * unbrauchbare Projektkennung ist für den Aufrufer dasselbe wie ein fremdes Projekt („gibt es
   * nicht ODER gehört jemand anderem" — die durchgängige Nicht-Unterscheidbarkeit dieses Schemas),
   * und ein Nicht-String ist so leer wie ein leerer String.
   */
  if (typeof projectId !== 'string' || !UUID.test(projectId)) return { status: 'not_found' }
  if (typeof userMessage !== 'string') return { status: 'empty_message' }

  return runProjectChatTurn(projectId, userMessage, {
    ports: createProjectChatPorts(DEFAULT_EXTRACTORS),
    callModel: callProjectChatModel,
  })
}

export type { ProjectChatTurnResult }
