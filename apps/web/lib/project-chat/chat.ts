'use server'

import 'server-only'

import {
  classifyDocument,
  extractBatteryText,
  extractInvoiceData,
  extractPvDesign,
} from 'extractors'

/*
 * ⚠ `PROJECT_ID_PATTERN` stand bis zum achten Bauschritt als eigene Konstante `UUID` in dieser
 * Datei. Es liegt jetzt in `lib/kalkulator/projects.ts` (rein, ohne Abhängigkeiten) und wird von
 * dort geholt: dieselbe Prüfung braucht seither auch das dynamische Routensegment und der
 * Upload-Rand, und drei ausgeschriebene Fassungen desselben Musters laufen beim nächsten Umbau
 * auseinander. Der Grund für die Prüfung ist unverändert — ein Nicht-UUID-Wert liefe als Parameter
 * in einen rohen Postgres-Fehler (22P02) statt in ein sauberes „gibt es nicht".
 */
import {
  MAX_ATTACHED_DOCUMENTS_PER_TURN,
  PROJECT_ID_PATTERN,
} from '@/lib/kalkulator/projects'

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
 * ⚠ Die Kennungen der in diesem Turn hochgeladenen Dokumente sind eine ANGABE des Clients, kein
 * Beweis. Sie werden hier auf ihre FORM geprüft und in `agent.ts` gegen den tatsächlichen
 * Dokumentbestand des Projekts gehalten — was dort nicht vorkommt, verschwindet still. Es gibt
 * damit keinen Weg, über diesen Parameter eine fremde Datei in ein Gespräch zu heben: die Liste,
 * gegen die geprüft wird, kommt aus der Datenbank und ist bereits auf das Projekt eingeschränkt.
 *
 * Eine unbrauchbare Liste (kein Array, zu viele Einträge, ein Nicht-UUID-Eintrag) wird NICHT
 * stillschweigend geleert: der Turn wird abgewiesen. Der Kunde hat gerade etwas hochgeladen und
 * würde sonst eine Antwort bekommen, die seine Datei nachweislich nicht kennt — und das sähe aus
 * wie ein Fehler des Modells statt wie einer der Übergabe.
 */
function attachedIdsAreValid(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) return false
  if (value.length > MAX_ATTACHED_DOCUMENTS_PER_TURN) return false
  return value.every((id) => typeof id === 'string' && PROJECT_ID_PATTERN.test(id))
}

/**
 * Was dieser Endpunkt antworten kann: alles, was die Schleife antworten kann — PLUS einen Zustand,
 * den nur der Rand kennt.
 *
 * ⚠ `invalid_attachments` steht bewusst NICHT in `ProjectChatTurnResult`: jene Union beschreibt,
 * was die Schleife hervorbringen kann, und sie kann diesen Fall nicht hervorbringen (bis dorthin
 * ist die Liste geprüft). Ein Status in einer Union, den ihr Erzeuger nie liefert, ist eine
 * Requisite — der nächste Leser sucht die Stelle, die ihn erzeugt, und findet keine.
 */
export type SendProjectChatMessageResult =
  | ProjectChatTurnResult
  | { status: 'invalid_attachments' }

export async function sendProjectChatMessage(
  projectId: string,
  userMessage: string,
  documentIds?: readonly string[],
): Promise<SendProjectChatMessageResult> {
  /*
   * ⚠ Die zwei Prüfungen antworten mit den BESTEHENDEN Turn-Zuständen, nicht mit neuen. Eine
   * unbrauchbare Projektkennung ist für den Aufrufer dasselbe wie ein fremdes Projekt („gibt es
   * nicht ODER gehört jemand anderem" — die durchgängige Nicht-Unterscheidbarkeit dieses Schemas),
   * und ein Nicht-String ist so leer wie ein leerer String.
   */
  if (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)) {
    return { status: 'not_found' }
  }
  if (typeof userMessage !== 'string') return { status: 'empty_message' }

  const attached = documentIds === undefined ? [] : documentIds
  if (!attachedIdsAreValid(attached)) return { status: 'invalid_attachments' }

  return runProjectChatTurn(
    projectId,
    userMessage,
    {
      ports: createProjectChatPorts(DEFAULT_EXTRACTORS),
      callModel: callProjectChatModel,
    },
    attached,
  )
}

export type { ProjectChatTurnResult }
