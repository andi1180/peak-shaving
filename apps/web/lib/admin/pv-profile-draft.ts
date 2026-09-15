import { tariffParamsSchema } from 'shared'

import type { DraftValue } from '@/lib/project-chat/draft'

/**
 * Die PV-ERZEUGUNGSREIHE im Entwurf eines Zählpunkts (B24, Teil 1) — GELESEN oder GESCHÄTZT.
 *
 * ⚠ DIESER KOPF HAT BIS ZUM PVGIS-GENERATOR NUR EINEN WEG GEKANNT. Er beschrieb ausschliesslich
 * die aus einer Datei GELESENE Reihe; seit Phase B gibt es einen zweiten, der dieselben vier
 * Zeitraum-Felder füllt und dabei ausdrücklich KEINE Datei hat. Was die zwei trennt, ist
 * `PV_PROFILE_SOURCE_KEY` — und es ist ein eigener Wert geworden statt einer Erschliessung aus der
 * Dokument-Kennung, weil genau diese Erschliessung beim Lastgang schon einmal gebrochen ist.
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
 * WOHER die Erzeugungsreihe stammt: aus einer hochgeladenen Datei oder aus dem PVGIS-Verfahren.
 *
 * ⚠ DAS IST DIE ANGABE, AN DER JEDER SPÄTERE LESER DIE ZWEI FÄLLE TRENNT — und sie steht
 * ausdrücklich als eigener Wert da, statt aus der Abwesenheit der Dokument-Kennung erschlossen zu
 * werden. Genau diese Erschliessung ist beim LASTGANG schon einmal gebrochen: dort war
 * `hasLoadProfile` an `source_document_id` festgemacht, und der Standardprofil-Zweig setzt sie
 * bewusst auf `null` — das Flag meldete danach „kein Lastgang", während der Zählpunkt einen
 * vollständigen Zeitraum trug (s. `MeteringPointSummary.profileSource`). Dieselbe Lage entsteht
 * hier: ein geschätztes Profil hat keine Datei und soll auch keine vortäuschen.
 *
 * ⚠ EIN ENTWURF AUS DER ZEIT VOR DIESEM SCHRITT TRÄGT DEN SCHLÜSSEL NICHT. `readPvProfileDraft`
 * erschliesst ihn dann aus der Dokument-Kennung — das ist zulässig, weil es damals nur EINEN Weg
 * gab und der immer eine Kennung geschrieben hat. Für NEUE Einträge schreiben beide Wege den Wert.
 */
export const PV_PROFILE_SOURCE_KEY = 'pvProfileSource'

/**
 * Der geschätzte Jahresertrag der GESAMTEN Anlage in kWh — das Mittel über die Wetterjahre.
 *
 * ⚠ NUR BEI `'generated'`. Für eine hochgeladene Reihe gibt es keinen geschätzten Ertrag; was dort
 * stünde, wäre eine Zahl über eine Messung, die niemand gerechnet hat.
 */
export const PV_ESTIMATED_ANNUAL_KWH_KEY = 'pvEstimatedAnnualKwh'

/**
 * Die halbe Spannweite der Jahreserträge über die Wetterjahre, in Prozent („± x %").
 *
 * ⚠ SIE GEHÖRT NEBEN DIE ZAHL UND NICHT IN EINE FUSSNOTE. Ein geschätzter Jahresertrag ohne seine
 * Streuung liest sich wie eine Messung; die Streuung ist das Einzige, was ihn als Schätzung
 * kenntlich macht (Pflichtenheft §2.1).
 */
export const PV_ESTIMATED_SPREAD_PERCENT_KEY = 'pvEstimatedSpreadPercent'

/**
 * Das ERSTE und das LETZTE der gemittelten Wetterjahre, wie PVGIS sie zurückgemeldet hat.
 *
 * ⚠ EINGEFROREN UND NICHT AUS EINER KONSTANTEN GELESEN. `PVGIS_WEATHER_YEARS` ist heute 2014–2023
 * und wird sich bewegen, sobald der Dienst neuere Jahre führt. Eine 2026 erzeugte Schätzung muss
 * 2028 noch sagen können, auf welchem Jahrzehnt sie beruhte — dieselbe Regel wie bei den
 * Tarifwerten einer archivierten Analyse (B14-1 Regel b: WERTE, keine Verweise auf veränderliche
 * Konfiguration).
 */
export const PV_ESTIMATED_WEATHER_YEAR_FROM_KEY = 'pvEstimatedWeatherYearFrom'
export const PV_ESTIMATED_WEATHER_YEAR_TO_KEY = 'pvEstimatedWeatherYearTo'

/**
 * ALLE Entwurfs-Schlüssel dieses Moduls — die vier Zeitraum-/Quell-Angaben, die Herkunft, der
 * Lücken-Seiteneintrag und die vier PVGIS-Kennzahlen.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ SIE STAND BIS ZUM PV-LÖSCHWEG NUR IM RUMPF VON `pvProfileKeysCollideWithContract()`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Dort war sie eine LOKALE Aufzählung für genau eine Prüfung. Mit dem Löschweg bekommt sie einen
 * zweiten Konsumenten, und der ist der gefährlichere: er ENTFERNT, was hier steht. Zweimal
 * ausgeschrieben liefen die beiden beim nächsten zusätzlichen Feld auseinander — und zwar still:
 * die Kollisionsprüfung deckte das neue Feld ab, der Löschweg liesse es stehen, und der Zählpunkt
 * trüge danach etwa einen geschätzten Jahresertrag ohne den Zeitraum, zu dem er gehört. Eine Zahl,
 * der niemand ansieht, dass ihre Grundlage verworfen wurde.
 *
 * ⚠ WER HIER EINEN SCHLÜSSEL ERGÄNZT, TRÄGT IHN IN DIESE LISTE NACH — ein Test hält beides
 * zusammen (er liest die exportierten Zeichenketten dieses Moduls und verlangt sie hier).
 */
export const PV_PROFILE_DRAFT_KEYS: readonly string[] = [
  PV_INTERVAL_MINUTES_KEY,
  PV_COVERED_FROM_KEY,
  PV_COVERED_TO_KEY,
  PV_SOURCE_DOCUMENT_ID_KEY,
  PV_PROFILE_GAPS_KEY,
  PV_PROFILE_SOURCE_KEY,
  PV_ESTIMATED_ANNUAL_KWH_KEY,
  PV_ESTIMATED_SPREAD_PERCENT_KEY,
  PV_ESTIMATED_WEATHER_YEAR_FROM_KEY,
  PV_ESTIMATED_WEATHER_YEAR_TO_KEY,
]

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

/** Woher die Erzeugungsreihe stammt. */
export type PvProfileSource = 'upload' | 'generated'

/**
 * Was aus dem PVGIS-Verfahren als KENNZAHL im Entwurf steht — bei einer hochgeladenen Reihe
 * durchgehend `null`.
 *
 * ⚠ ALS EIGENER BLOCK UND NICHT VIER FLACHE FELDER: die vier gehören zusammen oder gar nicht. Als
 * einzelne `| null`-Felder daneben entstünde der Zustand „Ertrag da, Streuung fehlt", und der wäre
 * genau die Auskunft, gegen die dieser Block gebaut ist — eine geschätzte Zahl ohne ihre Streuung
 * liest sich wie eine gemessene.
 */
export type PvProfileEstimate = {
  /** Mittel der Jahreserträge über die Wetterjahre, in kWh. */
  annualKwh: number
  /** Halbe Spannweite in Prozent des Mittels — die „± x %"-Angabe. */
  spreadPercent: number
  /** Die gemittelten Wetterjahre, eingefroren wie geliefert. */
  weatherYears: { from: number; to: number }
}

/** Was im Entwurf eines Zählpunkts an PV-Erzeugungs-Angaben steht. */
export type PvProfileDraftSummary = {
  /** 15 oder 60, sobald eine Reihe vorliegt — sonst `null`. */
  intervalMinutes: number | null
  coveredFrom: string | null
  coveredTo: string | null
  /**
   * WOHER die Reihe stammt — `null`, solange es keine gibt.
   *
   * ⚠ Ein Entwurf aus der Zeit vor der Unterscheidung trägt den Schlüssel nicht; dort wird sie aus
   * der Dokument-Kennung erschlossen (s. `PV_PROFILE_SOURCE_KEY`).
   */
  source: PvProfileSource | null
  /** Die Kennung der hochgeladenen Datei — bei `'generated'` immer `null`, s. Kopf von `readPvProfileDraft`. */
  sourceDocumentId: string | null
  /** Die PVGIS-Kennzahlen — bei `'upload'` immer `null`, s. Kopf von `readPvProfileDraft`. */
  estimate: PvProfileEstimate | null
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

/**
 * Die Herkunft der Reihe.
 *
 * ⚠ DIE REIHENFOLGE DER ZWEI PRÜFUNGEN IST DIE AUSSAGE, wortgleich zu `readProfileSource` beim
 * Lastgang: ein AUSDRÜCKLICH gesetzter Wert entscheidet zuerst — nur so kann ein geschätztes Profil
 * überhaupt als solches erkannt werden. Erst danach greift die Erschliessung aus der
 * Dokument-Kennung, und die gilt ausschliesslich Entwürfen aus der Zeit vor dieser Unterscheidung
 * (damals gab es genau einen Weg, und der hat immer eine Kennung geschrieben).
 */
function readSource(
  draft: Record<string, unknown>,
  documentId: string | null,
): PvProfileSource | null {
  const raw = draft[PV_PROFILE_SOURCE_KEY]
  if (raw === 'generated' || raw === 'upload') return raw
  return documentId === null ? null : 'upload'
}

/** Die vier PVGIS-Kennzahlen — nur vollständig oder gar nicht (s. `PvProfileEstimate`). */
function readEstimate(draft: Record<string, unknown>): PvProfileEstimate | null {
  const annualKwh = readNumber(draft, PV_ESTIMATED_ANNUAL_KWH_KEY)
  const spreadPercent = readNumber(draft, PV_ESTIMATED_SPREAD_PERCENT_KEY)
  const from = readNumber(draft, PV_ESTIMATED_WEATHER_YEAR_FROM_KEY)
  const to = readNumber(draft, PV_ESTIMATED_WEATHER_YEAR_TO_KEY)
  if (annualKwh === null || spreadPercent === null || from === null || to === null) return null
  return { annualKwh, spreadPercent, weatherYears: { from, to } }
}

/**
 * Liest die PV-Erzeugungs-Angaben aus dem Entwurf.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ JE HERKUNFT GENAU DIE FELDER, DIE ZU IHR GEHÖREN — und das ist eine Sicherung, keine Kosmetik
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bei `'generated'` kommt KEINE Dokument-Kennung heraus, bei `'upload'` KEINE Schätzwerte — auch
 * dann nicht, wenn die Schlüssel im `jsonb` stehen. Der Fall ist real: es gibt in diesem Schritt
 * keinen Entfernen-Weg, aber es gibt zwei Wege, die dieselben vier Zeitraum-Felder ERSETZEN. Wer
 * nach einer Schätzung doch noch eine Datei einliest (über die Station nicht erreichbar, über die
 * Action als Endpunkt sehr wohl), hinterlässt die Schätzwerte im Entwurf.
 *
 * Sie werden deshalb hier GEFILTERT statt dort GELÖSCHT: ein Löschweg wäre ein zweiter Mechanismus
 * für dieselbe Zusage, und der erste Aufrufer, der ihn vergisst, brächte einen geschätzten
 * Jahresertrag an einer gemessenen Reihe zum Vorschein — eine Zahl, der niemand ansieht, dass sie
 * zu einer verworfenen Grundlage gehört. Gefiltert kann KEIN Leser sie sehen, auch der nächste
 * nicht.
 */
export function readPvProfileDraft(draft: Record<string, unknown>): PvProfileDraftSummary {
  const documentId = readText(draft, PV_SOURCE_DOCUMENT_ID_KEY)
  const source = readSource(draft, documentId)
  return {
    intervalMinutes: readNumber(draft, PV_INTERVAL_MINUTES_KEY),
    coveredFrom: readText(draft, PV_COVERED_FROM_KEY),
    coveredTo: readText(draft, PV_COVERED_TO_KEY),
    source,
    sourceDocumentId: source === 'generated' ? null : documentId,
    estimate: source === 'generated' ? readEstimate(draft) : null,
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
    /*
     * ⚠ AUCH DER UPLOAD-WEG SCHREIBT DIE HERKUNFT AUSDRÜCKLICH, obwohl `readPvProfileDraft` sie
     * für ihn aus der Dokument-Kennung erschliessen könnte. Die Erschliessung ist ein Zugeständnis
     * an ALTE Entwürfe und kein Entwurf für neue: solange beide Wege den Wert setzen, gibt es
     * genau eine Stelle, an der die Herkunft steht, und die Erschliessung bleibt das, was sie ist —
     * ein Rückfall für einen Bestand, der nicht mehr wächst.
     */
    { field: PV_PROFILE_SOURCE_KEY, value: 'upload' },
  ]
}

/** Was der PVGIS-Generator über eine geschätzte Reihe zu sagen hat. */
export type PvGeneratedProfile = {
  intervalMinutes: number
  /** Der Zeitraum des LASTGANGS dieses Zählpunkts — nicht die Wetterjahre, s. `pvGeneratedProfileDraftValues`. */
  coveredFrom: string
  coveredTo: string
  estimate: PvProfileEstimate
}

/**
 * Die skalaren Felder einer GESCHÄTZTEN Reihe, fertig für `setDraftField`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ES IST KEINE DOKUMENT-KENNUNG DABEI, UND DAS IST DER GANZE UNTERSCHIED ZUM UPLOAD-WEG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Eine geschätzte Reihe hat keine Datei. `setDraftField` nimmt ausdrücklich nur
 * `number | string | boolean` — ein `null` ist dort gar nicht schreibbar, und ein leerer String
 * wäre schlimmer als die Abwesenheit: er sähe aus wie eine Kennung, die verloren gegangen ist. Der
 * Schlüssel bleibt deshalb schlicht aus; `readPvProfileDraft` liefert für `'generated'` ohnehin
 * `null` (s. dortiger Kopf).
 *
 * ⚠ `coveredFrom`/`coveredTo` SIND DER ZEITRAUM DES LASTGANGS, NICHT DIE WETTERJAHRE. Das
 * erzeugte Profil deckt genau den Zeitraum ab, für den es einen Verbrauch gibt — nur seine
 * BERECHNUNG stützt sich auf das Zehnjahresmittel. Die Wetterjahre daneben zu setzen wäre die
 * naheliegende Verwechslung und eine teure: die Erzeugung stünde dann in Jahren, in denen der
 * Kunde gar nicht gemessen wurde, und jede spätere Überlagerung mit dem Lastgang liefe ins Leere.
 * Wo die Jahre hingehören, steht in `pvEstimatedWeatherYearFrom`/`…To`.
 */
export function pvGeneratedProfileDraftValues(
  profile: PvGeneratedProfile,
): { field: string; value: DraftValue }[] {
  return [
    { field: PV_INTERVAL_MINUTES_KEY, value: profile.intervalMinutes },
    { field: PV_COVERED_FROM_KEY, value: profile.coveredFrom },
    { field: PV_COVERED_TO_KEY, value: profile.coveredTo },
    { field: PV_PROFILE_SOURCE_KEY, value: 'generated' },
    { field: PV_ESTIMATED_ANNUAL_KWH_KEY, value: profile.estimate.annualKwh },
    { field: PV_ESTIMATED_SPREAD_PERCENT_KEY, value: profile.estimate.spreadPercent },
    { field: PV_ESTIMATED_WEATHER_YEAR_FROM_KEY, value: profile.estimate.weatherYears.from },
    { field: PV_ESTIMATED_WEATHER_YEAR_TO_KEY, value: profile.estimate.weatherYears.to },
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
  // Aus `PV_PROFILE_DRAFT_KEYS` — die frühere zweite Aufzählung an dieser Stelle ist entfallen.
  return PV_PROFILE_DRAFT_KEYS.filter((key) => key in tariffParamsSchema.shape)
}
