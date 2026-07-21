import {
  DEMO_BATTERY_CATALOG,
  ENGINE_COMMIT_SHA_PLACEHOLDER,
  ENGINE_VERSION,
  buildAnalysisBundle,
  serializeAnalysisBundle,
  type AnalysisBundle,
  type AnalysisResult,
} from 'shared'

import { applyBatteryOverride } from './battery-override'
import type { AnalysisRunInputs } from './use-analysis'
import type { ParsedLoad, ParsedPv } from '@/components/flow/types'

/**
 * B14-2 — Der Bündel-Export des Rechners (§6.2, dritter Ausgabeweg neben PDF und CSV).
 *
 * ── ER ERZEUGT EINE LOKALE DATEI, KEINEN NETZWERKAUFRUF ─────────────────────────────────────────
 * Das Bündel entsteht vollständig im Browser und wird heruntergeladen wie die CSV. Deshalb steht
 * der Punkt auch im ÖFFENTLICHEN Rechner: es entsteht kein Datenabfluss, und ihn zu verstecken
 * verlangte eine Zugangsunterscheidung, die es hier noch nicht gibt (B10). Archiviert wird
 * ausschliesslich im Admin-Bereich, durch einen Menschen, der die Datei weitergibt.
 *
 * ── DER COMMIT KOMMT AUS DER BAUUMGEBUNG ────────────────────────────────────────────────────────
 * `NEXT_PUBLIC_ENGINE_COMMIT_SHA` wird in `next.config.mjs` aus `VERCEL_GIT_COMMIT_SHA` gesetzt und
 * beim Bauen fest in das Bündel eingesetzt. Fehlt er (lokaler Lauf), steht ein erkennbarer
 * Platzhalter darin — und der Upload weist ihn ab: eine Baseline ohne belegbare Engine-Fassung ist
 * 2027 nicht verwendbar, und der Fehler fiele beim Speichern niemandem auf.
 */

/**
 * Beim BAUEN eingesetzt (`next.config.mjs` → `env`), nicht zur Laufzeit gelesen: `process.env.X`
 * wird von Next im Client-Bündel durch den Literalwert ersetzt. Ein leerer Wert heisst „diese
 * Fassung wurde ohne Commit-Angabe gebaut" und wird zum Platzhalter, nicht zu einem leeren String.
 */
export const ENGINE_COMMIT_SHA =
  process.env.NEXT_PUBLIC_ENGINE_COMMIT_SHA || ENGINE_COMMIT_SHA_PLACEHOLDER

export type BundleExportArgs = {
  result: AnalysisResult
  inputs: AnalysisRunInputs
  load: ParsedLoad
  pv: ParsedPv | null
}

/**
 * Stellt das Bündel zusammen.
 *
 * WIRFT, wenn die Ursprungsdatei nicht mehr vorliegt (`buildAnalysisBundle`) — lieber kein Bündel
 * als eines mit einer Prüfsumme, die nichts bindet.
 */
export async function buildBundle(args: BundleExportArgs): Promise<AnalysisBundle> {
  return buildAnalysisBundle({
    engineVersion: ENGINE_VERSION,
    engineCommitSha: ENGINE_COMMIT_SHA,
    computedAt: args.inputs.computedAt,
    inputs: {
      tariff: args.inputs.tariff,
      financial: args.inputs.financial,
      horizonYears: args.inputs.horizonYears,
      /*
       * Der Katalog-STAND, gegen den tatsächlich gerechnet wurde — inklusive einer Änderung aus
       * dem Annahmen-Panel. Dieselbe Funktion, die auch der Worker benutzt (`battery-override.ts`);
       * eine zweite Umsetzung liefe irgendwann auseinander, und dann trüge das Archiv einen
       * Katalog, gegen den nie gerechnet wurde.
       */
      batteryCatalog: applyBatteryOverride(DEMO_BATTERY_CATALOG, args.inputs.batteryOverride),
      batteryOverride: args.inputs.batteryOverride,
      pvFileName: args.pv?.fileName ?? null,
    },
    result: args.result,
    sourceFileName: args.load.fileName,
    sourceFile: args.load.sourceBytes ?? null,
  })
}

/**
 * Dateiname aus Datum und Kundenbezug, SOWEIT IM RECHNER BEKANNT.
 *
 * Der Rechner kennt keinen Kundennamen — er erhebt keinen (Prinzip 4). Was er kennt, ist der Name
 * der hochgeladenen Ursprungsdatei, und der trägt in der Praxis genau diesen Bezug (Zählpunkt,
 * Betrieb, Zeitraum). Ihn zu übernehmen ist ehrlicher, als eine Bezeichnung zu erfinden.
 */
export function bundleFileName(bundle: AnalysisBundle): string {
  const day = bundle.computedAt.slice(0, 10)
  const stem = bundle.sourceFileName
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return stem ? `analyse-buendel-${day}-${stem}.json` : `analyse-buendel-${day}.json`
}

export function serializeBundle(bundle: AnalysisBundle): string {
  return serializeAnalysisBundle(bundle)
}
