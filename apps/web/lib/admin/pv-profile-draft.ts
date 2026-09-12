import { tariffParamsSchema } from 'shared'

import type { DraftValue } from '@/lib/project-chat/draft'

/**
 * Die gelesene PV-ERZEUGUNGSREIHE im Entwurf eines Zählpunkts (B24, Teil 1).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ SIE LIEGT IM ENTWURF UND NICHT IN EIGENEN SPALTEN — der Unterschied zum Lastgang
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der Lastgang schreibt Intervall, Zeitraum, Lücken und Quelle in vier eigene Spalten von
 * `platform.metering_points` (`set_metering_point_load_profile`, Migration 20260911120000). Für die
 * PV-Erzeugung gibt es diese Spalten NICHT, und dieser Schritt legt auch keine an: eine Migration
 * für vier Felder, deren Verwendung (PVGIS-Abgleich, Engine-Anbindung) erst der nächste Schritt
 * entscheidet, legte das Schema auf einen Zuschnitt fest, den niemand gemessen hat.
 *
 * Der Entwurf trägt sie stattdessen — genau wie `annualConsumptionKwh` (Standardprofil-Zweig), die
 * vier Batterie-Kenndaten und die gelesenen Rechnungen. Das trägt, weil `tariffParamsSchema` ein
 * gewöhnliches `z.object` OHNE `.strict()` ist: zod entfernt unbekannte Schlüssel beim Auswerten und
 * meldet keinen Fehler (in `draft.test.ts` gemessen, nicht angenommen).
 *
 * ⚠ FOLGE, die man kennen muss: `check_draft_completeness` führt diese Felder als `unknown_fields`
 * — sie zählen nicht zur Vollständigkeit des Tarif-Contracts. Wer sie später in die Rechnung
 * hineinreicht, tut das über einen eigenen Weg (die PV-Seite läuft ausserhalb von `TariffParams`,
 * s. `PvProfile` in `packages/shared`), nicht über den Contract.
 *
 * ── ⚠ WARUM DIE LÜCKEN EINEN EIGENEN SEITENEINTRAG BRAUCHEN ──────────────────────────────────
 * `setDraftField` (`lib/project-chat/draft.ts`) nimmt ausdrücklich nur `number | string | boolean`
 * — „Objekte und Arrays gehören hier nicht hinein". Die Lücken sind eine LISTE und gehen deshalb
 * per direkter Zuweisung in einen eigenen Schlüssel, nach dem Vorbild von `_invoiceExtractions`
 * und `_provenance`. Sie als JSON-Zeichenkette in ein Skalarfeld zu pressen wäre die Alternative
 * gewesen und die schlechtere: ein Leser müsste sie wieder auseinandernehmen, und ein von Hand
 * verändertes `jsonb` ergäbe dort einen Wert, den niemand mehr als kaputt erkennt.
 *
 * ⚠ AUFLAGE, wortgleich zu jener bei `_provenance` und `_invoiceExtractions`: keiner dieser
 * Schlüssel darf je ein Contract-Feldname werden. `pvProfileKeysCollideWithContract()` macht daraus
 * eine Prüfung statt einer Hoffnung.
 *
 * ── ⚠ WARUM DAS EIN EIGENES MODUL IST ─────────────────────────────────────────────────────────
 * Dieselben zwei Konsumenten mit entgegengesetzter Richtung wie bei `battery-draft.ts` und
 * `pv-draft.ts`: die Server Action SCHREIBT die Felder, die Station LIEST sie für ihre
 * Zusammenfassung. Zweimal ausgeschrieben liefe eine Umbenennung an einer der beiden vorbei — und
 * zwar still: gespeichert würde unter dem neuen Namen, angezeigt der alte, und die Station
 * behauptete, es sei nichts eingelesen.
 *
 * REIN: kein `server-only`, kein `next/*`, kein Supabase-Client, KEIN Import aus
 * `packages/extractors` (das ist `server-only` und bräche den Build der Client-Komponente). Die
 * gelesenen Metadaten kommen deshalb als STRUKTURELLER Parameter herein, nicht als importierter
 * Typ — geprüft wird die Zuordnung dort, wo die Action sie übergibt.
 *
 * ── ⚠ WAS DIESES MODUL NICHT KANN ────────────────────────────────────────────────────────────
 * Es gibt keinen Entfernen-Weg. Wer eine falsche Datei hochgeladen hat, kann sie in diesem
 * Bauschritt nicht zurücknehmen (beim Lastgang gibt es das seit PR #194, hier ist es ein eigener
 * Auftrag). Ebenfalls offen und hier benannt statt übersehen: wechselt jemand die Antwort auf
 * „Haben Sie eine PV-Anlage?" nachträglich auf NEIN, bleiben diese Felder im Entwurf stehen — die
 * Station zeigt sie dann nicht mehr, entfernt sie aber auch nicht.
 */

/** Erkanntes Intervall der Erzeugungsreihe in Minuten (15 oder 60). */
export const PV_INTERVAL_MINUTES_KEY = 'pvIntervalMinutes'

/** Beginn des ersten Intervalls mit Messwert, ISO/UTC. */
export const PV_COVERED_FROM_KEY = 'pvCoveredFrom'

/**
 * ENDE des letzten Intervalls mit Messwert, ISO/UTC.
 *
 * ⚠ OBERE KANTE EINES HALBOFFENEN BEREICHS, dieselbe Konvention wie bei `metering_points.covered_to`
 * — ein Jahresprofil endet damit am 1. Jänner des FOLGEjahres um 00:00. Die Anzeige muss das
 * benennen, statt den Wert um ein Intervall zu verkleinern (das wäre eine zweite Zahl über dieselbe
 * Reihe, und sie stünde nirgends im Entwurf).
 */
export const PV_COVERED_TO_KEY = 'pvCoveredTo'

/**
 * Die Kennung des abgelegten Dokuments in `platform.project_documents`.
 *
 * ⚠ Der Bezug zur Datei ist die einzige Spur zurück: gespeichert sind nur Angaben ÜBER die Reihe,
 * die Messwerte bleiben in der hochgeladenen Datei. Ohne diese Kennung wüsste später niemand mehr,
 * welche das war.
 */
export const PV_SOURCE_DOCUMENT_ID_KEY = 'pvSourceDocumentId'

/** Der Seiteneintrag mit den Lücken — eine Liste, und deshalb nicht über `setDraftField`. */
export const PV_PROFILE_GAPS_KEY = '_pvProfileGaps'

/**
 * Ein Bereich ohne Erzeugungswerte, wie er im Entwurf steht. Halboffen: `[from, to)`.
 *
 * ⚠ EIGENER TYP UND KEIN IMPORT VON `MeteringPointGapRange`: jener beschreibt eine SPALTE
 * (`metering_points.gaps`), dieser einen Seiteneintrag im Entwurf, und sein Leser ist dort privat.
 * Ihn dafür zu öffnen machte aus zwei unabhängigen Modulen eines, das am anderen hängt — dieselbe
 * Überlegung, mit der `pv-draft.ts` seinen `readBoolean` nicht aus `battery-draft.ts` zieht.
 */
export type PvProfileGapRange = {
  /** Erster Zeitpunkt OHNE Messwert, ISO/UTC. */
  from: string
  /** Erster Zeitpunkt, zu dem wieder ein Messwert vorliegt, ISO/UTC. */
  to: string
}

/**
 * Was ein Leser dieser Datei von einem gelesenen PV-Profil braucht.
 *
 * STRUKTURELL statt importiert (s. Kopf): `PvProfileMetadata` der Engine erfüllt diese Form, und
 * TypeScript prüft das an der Stelle, an der die Action sie übergibt. `rowCount` und
 * `coveredMonths` stehen bewusst nicht darin — sie werden nicht gespeichert, und ein Feld ohne
 * Leser wäre eine Requisite.
 */
export type PvProfileReadResult = {
  intervalMinutes: number
  coveredFrom: string
  coveredTo: string
  gaps: readonly PvProfileGapRange[]
}

/** Was im Entwurf eines Zählpunkts an PV-Erzeugungs-Angaben steht. */
export type PvProfileDraftSummary = {
  /** 15 oder 60, sobald eine Reihe eingelesen wurde — sonst `null`. */
  intervalMinutes: number | null
  coveredFrom: string | null
  coveredTo: string | null
  sourceDocumentId: string | null
  /** Leer = keine Lücke über der Toleranzschwelle — nicht „keine Angabe" (das sagt `coveredFrom`). */
  gaps: PvProfileGapRange[]
}

function readNumber(draft: Record<string, unknown>, key: string): number | null {
  const value = draft[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readText(draft: Record<string, unknown>, key: string): string | null {
  const value = draft[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * Die Lücken aus dem Seiteneintrag.
 *
 * Defensiv wie jeder `jsonb`-Leser dieses Repos: der Typ ist eine Behauptung über das, was die
 * Action einmal geschrieben hat — die Spalte nimmt alles an. Ein Eintrag ohne beide Grenzen wird
 * ÜBERSPRUNGEN statt mit einem Platzhalter gefüllt: eine Lücke „von — bis —" sähe aus wie eine
 * gemessene und wäre keine.
 */
function readGaps(value: unknown): PvProfileGapRange[] {
  if (!Array.isArray(value)) return []
  const out: PvProfileGapRange[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
    const gap = raw as Record<string, unknown>
    if (typeof gap.from !== 'string' || typeof gap.to !== 'string') continue
    out.push({ from: gap.from, to: gap.to })
  }
  return out
}

export function readPvProfileDraft(draft: Record<string, unknown>): PvProfileDraftSummary {
  return {
    intervalMinutes: readNumber(draft, PV_INTERVAL_MINUTES_KEY),
    coveredFrom: readText(draft, PV_COVERED_FROM_KEY),
    coveredTo: readText(draft, PV_COVERED_TO_KEY),
    sourceDocumentId: readText(draft, PV_SOURCE_DOCUMENT_ID_KEY),
    gaps: readGaps(draft[PV_PROFILE_GAPS_KEY]),
  }
}

/**
 * Liegt eine eingelesene Erzeugungsreihe vor?
 *
 * ⚠ AN DEN DREI ANGABEN GEMESSEN, DIE DEN ZEITRAUM AUSMACHEN — nicht an `sourceDocumentId` und
 * nicht an den Lücken. Die Kennung ist der Bezug zur Datei und kann durch ein späteres Löschen des
 * Dokuments verschwinden; eine leere Lückenliste ist der Normalfall einer sauberen Datei. Wäre eines
 * von beiden das Kriterium, zeigte die Station ihre Frage erneut, obwohl der Zeitraum gespeichert
 * ist — genau der Fehler, den der Lastgang-Schritt mit `profileSource` schon einmal hatte.
 */
export function hasPvProfile(summary: PvProfileDraftSummary): boolean {
  return (
    summary.intervalMinutes !== null && summary.coveredFrom !== null && summary.coveredTo !== null
  )
}

/**
 * Die SKALAREN Felder, fertig für `setDraftField`.
 *
 * ⚠ Die Lücken sind NICHT dabei — sie gehen über `withPvProfileGaps` (s. Kopf). Beides gehört in
 * EINEN Schreibvorgang: Zeitraum und Lücken sind die Auswertung derselben Datei, und getrennt
 * geschrieben gäbe es einen Zustand, in dem der eine zu einer anderen Datei gehört als die anderen
 * (`update_metering_point_draft` ERSETZT ohnehin).
 */
export function pvProfileDraftValues(
  metadata: PvProfileReadResult,
  documentId: string,
): { field: string; value: DraftValue }[] {
  return [
    { field: PV_INTERVAL_MINUTES_KEY, value: metadata.intervalMinutes },
    { field: PV_COVERED_FROM_KEY, value: metadata.coveredFrom },
    { field: PV_COVERED_TO_KEY, value: metadata.coveredTo },
    { field: PV_SOURCE_DOCUMENT_ID_KEY, value: documentId },
  ]
}

/**
 * Setzt den Seiteneintrag. Reine Funktion — sie gibt einen neuen Entwurf zurück.
 *
 * ⚠ Der Wrapper `update_metering_point_draft` ERSETZT den Entwurf, er verschmilzt ihn nicht. Der
 * Aufrufer muss also den vollständigen, FRISCH gelesenen Entwurf hineingeben; dieselbe Auflage wie
 * bei `setDraftField` und `withStoredInvoiceExtractions`.
 */
export function withPvProfileGaps(
  draft: Record<string, unknown>,
  gaps: readonly PvProfileGapRange[],
): Record<string, unknown> {
  return { ...draft, [PV_PROFILE_GAPS_KEY]: gaps }
}

/**
 * ⚠ Keiner dieser Schlüssel darf einen Contract-Feldnamen verdecken — als Funktion statt als
 * Kommentar, damit der Test sie gegen die echten Schlüssel von `tariffParamsSchema` laufen lassen
 * kann.
 *
 * Sie deckt AUCH die vier Skalare ab und nicht nur den Seiteneintrag: ein Skalar, der zufällig so
 * heisst wie ein Contract-Feld, wäre der teurere Fall — er liefe durch die Schema-Prüfung und
 * behauptete dort eine Tarifangabe, die niemand gemacht hat.
 *
 * @returns Die kollidierenden Schlüssel. Leer heisst: alles frei.
 */
export function pvProfileKeysCollideWithContract(): string[] {
  const keys = [
    PV_INTERVAL_MINUTES_KEY,
    PV_COVERED_FROM_KEY,
    PV_COVERED_TO_KEY,
    PV_SOURCE_DOCUMENT_ID_KEY,
    PV_PROFILE_GAPS_KEY,
  ]
  return keys.filter((key) => key in tariffParamsSchema.shape)
}
