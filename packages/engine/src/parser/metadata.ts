import { countCoveredMonths, toIsoUtc, type DateFormat } from './datetime'
import { detectStructure, isInverterExport } from './detect'
import { byteSize, resolveLimits } from './limits'
import { detectIntervalMinutes } from './prepare'
import { matchAdapter } from './adapters'
import { normalizeLoad, normalizeSingleValue } from './normalize'
import { extractTable } from './table'
import type {
  ColumnMapping,
  ParseError,
  ParseOptions,
  Unit,
  ValueColumnInfo,
} from './types'

/**
 * B24, Teil 1 — DER METADATEN-LESER EINES LASTGANGS. Zeitraum, Intervall, Lücken. Sonst nichts.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WARUM DAS HIER STEHT UND NICHT IN `packages/extractors`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der Bau-Auftrag nannte als Ort `packages/extractors/src/load-profile/`. Die LESE-Logik liegt
 * trotzdem hier, und der Grund ist derselbe, aus dem es `packages/extractors` überhaupt gibt:
 *
 *   Die gesamte Format-Kenntnis eines österreichischen Lastgang-Exports steht bereits in diesem
 *   Verzeichnis — Split-Timestamp (Datum + „Zeit von"), deutsche Monatsnamen, Mehrspalten-Mapping
 *   mit Summierung, die Rettung sparsam belegter Stichproben, die EEG-Spalten-Klassifikation, die
 *   Ablehnung von Wechselrichter-Logs. Jede dieser Regeln ist in OP#4 an ECHTEN Exporten gemessen
 *   worden. Sie in einem zweiten Paket noch einmal auszuschreiben wäre exakt die Doppelung, gegen
 *   die `packages/extractors` gebaut wurde: „zwei Fassungen derselben Ableseregel laufen beim
 *   nächsten Umbau auseinander, und dann liest derselbe Kunde je nach Einstieg eine andere Zahl
 *   von derselben Datei."
 *
 * Dazu kommt eine Eigenschaft, die den Umzug ausschliesst: `packages/extractors` ist `server-only`.
 * Ein Lastgang-Leser MUSS browser-fähig bleiben — im öffentlichen Rechner verlässt der Lastgang das
 * Gerät nicht (Prinzip 4), und `apps/website` liest ihn client-seitig mit genau diesen Modulen.
 * Hinter `import 'server-only'` wäre er für jenen Weg strukturell unerreichbar, und die Doppelung
 * käme zurück.
 *
 * In `packages/extractors/src/load-profile/` steht deshalb der DÜNNE, server-only Adapter, den der
 * Chat importiert (Grössengrenze, Buffer → `RawFileInput`, Ausgangs-Form). Er ruft diese Funktion
 * auf und rechnet selbst nichts.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WARUM ES NICHT `parseLoadProfile` TUT — gemessen, nicht angenommen
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Zwei Gründe, und beide sind hart:
 *
 *   (1) `parseLoadProfile` LEHNT 60-MIN-DATEN AB (`parse.ts`: `wrong_interval`, wenn das erkannte
 *       Intervall nicht 15 ist). Ein Zählpunkt darf aber laut Auftrag 15 ODER 60 Minuten tragen —
 *       Stundenwerte sind ein realer Netzbetreiber-Export. Diese Funktion nimmt beide an.
 *   (2) `parseLoadProfile` baut ein lückenloses 15-min-Gitter und INTERPOLIERT kleine Lücken weg.
 *       Genau das ist für die Rechnung richtig und für die Metadaten falsch: was hier gebraucht
 *       wird, ist die Aussage „von wann bis wann liegen tatsächlich Messwerte vor und wo fehlen
 *       welche" — eine interpolierte Lücke ist dort keine Abdeckung, sondern eine geglättete
 *       Fehlanzeige. `dataQuality` liefert dafür nur ZAHLEN (`gapsInterpolated`, `largestGapSlots`),
 *       nie die BEREICHE.
 *
 * Geteilt wird deshalb, was Format-Kenntnis ist (Tabelle, Struktur-Erkennung, Normalisierung,
 * Intervall-Bestimmung); eigen ist ausschliesslich die Metadaten-Ableitung darüber.
 *
 * ── ⚠ EIN BENANNTER ARTEFAKT: DER TAG DER ZEITUMSTELLUNG IM HERBST ───────────────────────────
 * Am Rückfall-Tag (in Europe/Vienna der letzte Sonntag im Oktober) kommt die Wanduhr-Stunde 02:00
 * ZWEIMAL vor. Ein Netzbetreiber-Export in Ortszeit schreibt sie auch zweimal; `zonedWallToUtcMs`
 * löst eine mehrdeutige Wanduhrzeit aber auf GENAU EINEN UTC-Zeitpunkt auf (die erste Belegung,
 * CEST). Die vier Intervalle der zweiten Belegung fallen damit auf dieselben Zeitstempel und werden
 * dedupliziert — der Bereich 01:00–02:00 UTC bleibt unbelegt und erscheint hier als LÜCKE.
 *
 * Das ist eine EIGENSCHAFT der Zeitstempel-Auflösung dieses Parsers und nicht dieses Lesers:
 * `prepareSeries` verhält sich identisch und meldet dazu „doppelte Zeitstempel entfernt (z. B.
 * Zeitumstellung)". Der Unterschied ist nur, dass es hier sichtbar wird, weil dieser Leser Lücken
 * als BEREICHE ausweist statt sie wegzuinterpolieren.
 *
 * Es wird bewusst NICHT weggefiltert: eine Lücke zu unterdrücken, weil sie „vermutlich die
 * Zeitumstellung ist", hiesse, eine echte einstündige Messlücke an genau diesem Tag ebenfalls zu
 * verschweigen. Ein Jahreslastgang trägt dadurch einen zusätzlichen Eintrag von einer Stunde und
 * vier Intervalle weniger in `rowCount`. Als Test gepinnt (`metadata.test.ts`), damit die Zahl
 * niemanden überrascht, der sie in `platform.metering_points.gaps` wiederfindet.
 *
 * ── ⚠ ES KOMMT KEIN EINZIGER MESSWERT HERAUS ──────────────────────────────────────────────────
 * Diese Funktion gibt Zeitpunkte und Zahlen ÜBER die Reihe zurück, nie die Reihe selbst. Das ist
 * kein Zufall, sondern die Bedingung, unter der ihr Ergebnis in `platform.metering_points`
 * gespeichert werden darf: die Rohdatei bleibt in `project_documents`/Storage und wird bei Bedarf
 * erneut gelesen. Ein zweiter Speicherort für dieselben Verbrauchsdaten entsteht hier NICHT.
 */

/** Ein Bereich, in dem keine Messwerte vorliegen. Halboffen: `[from, to)`. */
export type LoadProfileGap = {
  /** Erster Zeitpunkt OHNE Messwert (= Ende des letzten vorhandenen Intervalls), ISO/UTC. */
  from: string
  /** Erster Zeitpunkt, zu dem wieder ein Messwert vorliegt, ISO/UTC. */
  to: string
}

/**
 * Was ein Lastgang-Dokument über sich verrät.
 *
 * ── ⚠ DISKRIMINIERTE UNION STATT EINES FLACHEN OBJEKTS — begründete Abweichung ────────────────
 * Der Auftrag zählt die Felder in EINEM Objekt auf (`{ intervalMinutes, coveredFrom, …,
 * needsMapping, ambiguousColumns? }`). Flach gebaut wären bei `needsMapping: true` alle
 * Metadaten-Felder `undefined` — und der erste Aufrufer, der das übersieht, schriebe
 * `covered_from = undefined` in eine Zeile, die damit behauptet, geprüft worden zu sein. Genau
 * diese Kombination kann hier gar nicht erst entstehen: `needsMapping` IST der Diskriminator, die
 * Feldnamen sind unverändert die des Auftrags.
 */
export type LoadProfileMetadata = {
  /** 15 oder 60. Aus den Zeitstempeln erkannt, nicht angenommen. */
  intervalMinutes: number
  /** Beginn des ERSTEN Intervalls mit Messwert, ISO/UTC. */
  coveredFrom: string
  /**
   * ENDE des LETZTEN Intervalls mit Messwert, ISO/UTC — also letzter Zeitstempel + `intervalMinutes`.
   *
   * ⚠ ANDERE KONVENTION ALS `AnalysisWindow.endIso` (`packages/shared/src/analysis-window.ts`), und
   * das ist Absicht: dort ist `endIso` der letzte ZEITSTEMPEL (beide Grenzen inklusiv), hier ist
   * `coveredTo` die obere Kante eines halboffenen Bereichs. Nur so ist `[coveredFrom, coveredTo)`
   * exakt die abgedeckte Zeit, und nur so passen die `gaps` (ebenfalls halboffen) lückenlos hinein.
   * Wer die beiden verwechselt, verliert bzw. erfindet ein Intervall — bei einem Jahreslastgang
   * fehlten sonst die letzten 15 Minuten des 31.12.
   */
  coveredTo: string
  /**
   * Die Lücken über der Toleranzschwelle (s. `GAP_TOLERANCE_INTERVALS`), in zeitlicher Reihenfolge.
   *
   * ⚠ EINZELNE fehlende Intervalle stehen hier NICHT — sie sind der Normalfall eines Exports und
   * würden die Liste unlesbar machen. Verloren geht die Information trotzdem nicht: die Zahl ALLER
   * fehlenden Intervalle ist aus den zurückgegebenen Feldern ableitbar, nämlich als
   * `(coveredTo − coveredFrom) / intervalMinutes − rowCount`. Wer sie braucht, rechnet sie aus;
   * eine zweite Zahl dafür wäre eine zweite Wahrheit über dieselbe Reihe.
   */
  gaps: LoadProfileGap[]
  /** Zahl der Intervalle MIT Messwert (nach Deduplizierung), nicht die Zahl der Dateizeilen. */
  rowCount: number
  /** Belegte Kalendermonate (lokal) — dieselbe Ableitung wie `DataQuality.coveredMonths`. */
  coveredMonths: number
}

export type LoadProfileScan =
  | ({ ok: true; needsMapping: false } & LoadProfileMetadata)
  /**
   * Die Wert-Spalten sind nicht eindeutig — typischerweise ein Netzbetreiber-Export, der MEHRERE
   * Zählpunkte in einer Datei führt (OP#4, Format A). Hier wird bewusst NICHTS geraten und keine
   * Metadaten-Aussage getroffen: welche Spalte zu welchem Zählpunkt gehört, entscheidet ein Mensch.
   */
  | { ok: true; needsMapping: true; ambiguousColumns: ValueColumnInfo[] }
  | { ok: false; needsMapping: false; error: ParseError }

/**
 * Ab wie vielen zusammenhängend fehlenden Intervallen eine Lücke gemeldet wird.
 *
 * 2 = „mehr als ein fehlendes Intervall" (Auftrag). Ein einzelner Ausfall ist in einem realen
 * Netzbetreiber-Export Alltag und sagt über die Brauchbarkeit des Lastgangs nichts; zwei am Stück
 * sind bereits eine halbe Stunde ohne Messung. Die Zahl steht an genau dieser Stelle, damit sie
 * sich ändern lässt, ohne die Ableitung anzufassen.
 */
export const GAP_TOLERANCE_INTERVALS = 2

/** Die Intervalle, die ein Zählpunkt tragen darf — Spiegel des CHECK auf `metering_points`. */
export const SUPPORTED_INTERVAL_MINUTES = [15, 60] as const

const DEFAULT_TZ = 'Europe/Vienna'

function err(code: ParseError['code'], message: string): LoadProfileScan {
  return { ok: false, needsMapping: false, error: { code, message } }
}

/**
 * Kann die Wert-Spalten-Zuordnung ohne Bestätigung abgeleitet werden?
 *
 * Wortgleiche Regel wie `autoResolvableValueColumns` in `parse.ts` — und bewusst NICHT von dort
 * importiert: sie ist dort eine private Entscheidung des Lastgang-Parsers, und ein Export machte
 * sie zu einer öffentlichen Zusage. Läuft sie je auseinander, ist die Folge harmlos und sichtbar
 * (der eine Weg fragt nach, der andere nicht) — anders als bei der Formaterkennung, deren
 * Auseinanderlaufen stille Zahlenunterschiede erzeugte.
 */
function valueColumnsAreAmbiguous(infos: ValueColumnInfo[]): boolean {
  if (infos.length <= 1) return false
  const consumption = infos.filter((i) => i.suggestedRole === 'consumption').length
  const feedIn = infos.filter((i) => i.suggestedRole === 'feed_in').length
  const other = infos.length - consumption - feedIn
  return !(consumption === 1 && feedIn <= 1 && other === 0)
}

function deriveColumns(
  timestampCol: number,
  timeColumn: number | null,
  valueCols: number[],
  importCol: number | null,
  exportCol: number | null,
  source: string,
): ColumnMapping | null {
  const base: ColumnMapping = { timestamp: timestampCol }
  if (timeColumn != null) base.timeColumn = timeColumn
  if (source === 'import_export_split') {
    if (importCol == null || exportCol == null) return null
    return { ...base, import: importCol, export: exportCol }
  }
  const first = valueCols[0]
  if (first == null) return null
  return { ...base, value: first }
}

/**
 * Liest Zeitraum, Intervall und Lücken eines Lastgang-Dokuments. Kein Datei-I/O, kein Netz, kein
 * Modellaufruf — deterministisch und damit ohne abrechenbare Kosten.
 *
 * @param input Roher Datei-Inhalt (CSV als String, XLSX als ArrayBuffer/Uint8Array).
 * @param options Wie bei `parseLoadProfile`; `columns` bestätigt eine zuvor uneindeutige Zuordnung.
 */
export function readLoadProfileMetadata(
  input: { content: string | ArrayBuffer | Uint8Array; fileName?: string; format?: 'csv' | 'xlsx' },
  options: ParseOptions = {},
): LoadProfileScan {
  const limits = resolveLimits(options.limits)

  const size = byteSize(input.content)
  if (size === 0) return err('empty', 'Die Datei ist leer.')
  if (size > limits.maxBytes)
    return err('too_large', `Datei zu gross (${size} > ${limits.maxBytes} Bytes).`)

  const table = extractTable(input, options.delimiter)
  if (table.matrix.length === 0) return err('empty', 'Keine Datenzeilen gefunden.')
  if (table.matrix.length > limits.maxRows)
    return err('too_many_rows', `Zu viele Zeilen (${table.matrix.length} > ${limits.maxRows}).`)

  const fallbackDecimal = table.delimiter === ';' ? ',' : '.'
  const draft = detectStructure(table.matrix, options.decimal ?? fallbackDecimal)

  // OP#4, Format B: ein Wechselrichter-/ESS-Log ist kein Netz-Lastgang. Dieselbe fachliche
  // Ablehnung wie in `parseLoadProfile` — und derselbe Grund: daraus einen Lastgang zu
  // konstruieren erzeugte einen Zeitraum, den niemand gemessen hat.
  if (isInverterExport(draft.headers))
    return err(
      'not_a_load_profile',
      'Kein Netz-Lastgang: Die Datei enthaelt nur Wechselrichter-/Batteriedaten ' +
        '(z. B. Ein-/Ausgangsleistung, Batterielade-/-entladeleistung), aber keinen Netzbezug.',
    )

  const adapter = matchAdapter({
    matrix: table.matrix,
    headerRow: draft.headerRow,
    headers: draft.headers,
    fileName: input.fileName,
  })
  const hints = adapter?.hints ?? {}

  const dateFormat =
    (options.dateFormat as DateFormat | undefined) ?? hints.dateFormat ?? draft.dateFormat
  const decimal = options.decimal ?? hints.decimal ?? draft.decimal
  const timezone = hints.timezone ?? options.timezone ?? DEFAULT_TZ

  if (draft.timestampCol == null || dateFormat == null)
    return err('no_timestamp_column', 'Keine Zeitstempel-Spalte erkannt.')

  const explicitColumns = options.columns ?? hints.columns

  /*
   * ⚠ MEHRERE ZÄHLPUNKTE IN EINER DATEI SIND DER ANLASS DIESER PRÜFUNG, NICHT EIN RANDFALL.
   * Ein EDA-Export führt regelmässig zwei Verbrauchs-, zwei Einspeise- und vier EEG-Spalten
   * nebeneinander (OP#4). Ihn EINEM Zählpunkt zuzuordnen wäre falsch, egal welche Spalte man nähme
   * — und der Fehler fiele niemandem auf, weil der Zeitraum stimmte. Hier wird deshalb gar keine
   * Metadaten-Aussage getroffen; die Rollen bestätigt ein Mensch (Auftrag 3/4).
   */
  if (explicitColumns == null && valueColumnsAreAmbiguous(draft.valueColumnInfos)) {
    return { ok: true, needsMapping: true, ambiguousColumns: draft.valueColumnInfos }
  }

  const columns =
    explicitColumns ??
    deriveColumns(
      draft.timestampCol,
      draft.timeColumn,
      draft.valueCols,
      draft.importCol,
      draft.exportCol,
      options.source ?? hints.source ?? draft.source,
    )
  if (columns == null) return err('no_value_column', 'Keine Wert-Spalte(n) erkannt.')

  /*
   * ⚠ DIE EINHEIT IST HIER OHNE WIRKUNG — und deshalb löst ein `unknown` KEINE Rückfrage aus.
   * `parseLoadProfile` fragt an dieser Stelle nach (kW oder kWh entscheidet dort über den Faktor 4
   * und damit über jede Leistungszahl). Diese Funktion gibt keinen einzigen Messwert zurück; die
   * Einheit entscheidet nur über einen Faktor, den niemand liest. Eine Rückfrage dafür wäre eine
   * Hürde ohne Ertrag: der Zeitraum eines Dokuments hängt nicht daran, in welcher Einheit es misst.
   */
  const unit: Unit = options.unit ?? hints.unit ?? (draft.unit === 'unknown' ? 'kW' : draft.unit)

  const source =
    columns.consumptionCols != null || columns.feedInCols != null
      ? (columns.feedInCols?.length ?? 0) > 0
        ? 'import_export_split'
        : 'import_only'
      : (options.source ?? hints.source ?? draft.source)

  const norm = normalizeLoad(draft.dataRows, {
    columns,
    dateFormat,
    decimal,
    unit,
    timezone,
    source,
    signConvention: options.signConvention ?? 'import_positive',
  })
  if (norm.parsedRows === 0)
    return err('unparsable_timestamps', 'Keine Zeile mit gueltigem Zeitstempel und Wert.')
  if (norm.parsedRows < 2) return err('insufficient_rows', 'Zu wenige gueltige Datenzeilen.')

  /*
   * Sortieren und deduplizieren wie `prepareSeries`: `normalizeLoad` behält die Zeilenreihenfolge
   * der Datei, und die Stunde der Zeitumstellung im Herbst liefert denselben UTC-Zeitpunkt zweimal.
   * Ohne Deduplizierung zählte `rowCount` sie doppelt und der Abstand 0 verfälschte die
   * Intervall-Bestimmung.
   */
  const sorted = [...norm.readings].sort((a, b) => a.ms - b.ms)
  const stamps: number[] = []
  for (const reading of sorted) {
    if (stamps[stamps.length - 1] === reading.ms) continue
    stamps.push(reading.ms)
  }
  if (stamps.length < 2) return err('insufficient_rows', 'Zu wenige unterschiedliche Zeitstempel.')

  const intervalMinutes = detectIntervalMinutes(stamps)
  if (!(SUPPORTED_INTERVAL_MINUTES as readonly number[]).includes(intervalMinutes))
    return err(
      'wrong_interval',
      `Nur ${SUPPORTED_INTERVAL_MINUTES.join('- oder ')}-min-Intervall unterstuetzt ` +
        `(erkannt: ${intervalMinutes} min).`,
    )

  const stepMs = intervalMinutes * 60_000
  const gaps: LoadProfileGap[] = []
  for (let i = 1; i < stamps.length; i++) {
    const previous = stamps[i - 1]!
    const current = stamps[i]!
    // Wie viele Intervalle liegen dazwischen, ohne dass ein Messwert vorliegt?
    const missing = Math.round((current - previous) / stepMs) - 1
    if (missing < GAP_TOLERANCE_INTERVALS) continue
    gaps.push({ from: toIsoUtc(previous + stepMs), to: toIsoUtc(current) })
  }

  const first = stamps[0]!
  const last = stamps[stamps.length - 1]!

  return {
    ok: true,
    needsMapping: false,
    intervalMinutes,
    coveredFrom: toIsoUtc(first),
    coveredTo: toIsoUtc(last + stepMs),
    gaps,
    rowCount: stamps.length,
    coveredMonths: countCoveredMonths(stamps, timezone),
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// B24, Teil 1 — DER METADATEN-LESER EINER PV-ERZEUGUNGSREIHE
// ═════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Das PV-Gegenstück zu `readLoadProfileMetadata` — und es steht aus denselben zwei Gründen hier und
 * nicht in `packages/extractors`: die Format-Kenntnis liegt in diesem Verzeichnis, und ein
 * PV-Leser muss browser-fähig bleiben (der öffentliche Rechner liest ein PV-Profil client-seitig,
 * Prinzip 4). Der Kopf dieser Datei führt beides aus.
 *
 * ── ⚠ WARUM ES NICHT `parsePvProfile` TUT — dieselbe Aufteilung wie beim Lastgang ─────────────
 * `parsePvProfile` (`parse.ts`) gibt die VOLLE Zeitreihe zurück (`PvProfile.readings`), baut dafür
 * ein lückenloses 15-min-Gitter und INTERPOLIERT kleine Lücken weg. Für die Rechnung ist das
 * richtig; für eine Metadaten-Aussage ist es das Gegenteil dessen, was gebraucht wird — eine
 * interpolierte Lücke ist keine Abdeckung, sondern eine geglättete Fehlanzeige, und die BEREICHE
 * kennt `dataQuality` ohnehin nicht (nur `gapsInterpolated`/`largestGapSlots` als Zahlen).
 *
 * ── ⚠ EIN WECHSELRICHTER-EXPORT WIRD HIER AUSDRÜCKLICH NICHT ABGELEHNT ────────────────────────
 * `readLoadProfileMetadata` weist ihn über `isInverterExport` ab, weil ein ESS-Log kein NETZ-Lastgang
 * ist. Für die Erzeugungsseite gilt das Gegenteil, und es ist gemessen (OP#4, Format B): die
 * Eingangsleistung eines Wechselrichters IST die Brutto-PV-Kurve. `parsePvProfile` prüft aus genau
 * diesem Grund nicht darauf, und dieser Leser folgt ihm. Wer die Prüfung hier ergänzt, sperrt den
 * häufigsten realen PV-Export aus.
 *
 * ── ⚠ ES GIBT KEINEN `needs_mapping`-AUSGANG, anders als beim Lastgang ────────────────────────
 * Dort ist die Rückfrage nötig, weil ein Netzbetreiber-Export MEHRERE Zählpunkte in einer Datei
 * führt und die Zuordnung Spalte→Zählpunkt ein Mensch trifft. Eine Erzeugungsreihe hat diesen Fall
 * nicht: ein PV-Export beschreibt EINE Anlage. Wo doch mehrere Wert-Spalten dastehen (der
 * ESS-Export oben), gilt `valueCols[0]` — dieselbe Wahl, die `parsePvProfile` trifft, und das ist
 * der eigentliche Grund für sie: die Metadaten sollen die Spalte beschreiben, die der Rechenkern
 * später auch liest. Auf die ZAHLEN wirkt die Wahl ohnehin fast nicht — alle Spalten teilen sich
 * die Zeitstempel, unterscheiden können sie sich nur dort, wo eine Zelle leer ist und die andere
 * nicht.
 *
 * ── ⚠ KEIN ADAPTER-ABGLEICH, ebenfalls anders als beim Lastgang ──────────────────────────────
 * `matchAdapter` beschreibt NETZBETREIBER-Layouts; seine Hinweise (`source`, `columns`,
 * `signConvention`) sind für eine Erzeugungsreihe entweder bedeutungslos oder falsch. `parsePvProfile`
 * setzt deshalb `adapterId: 'generic'`, und dieser Leser fragt die Registry gar nicht erst.
 *
 * ── ⚠ ES KOMMT KEIN EINZIGER MESSWERT HERAUS ──────────────────────────────────────────────────
 * Wortgleich zum Lastgang-Leser: zurück kommen Zeitpunkte und Zahlen ÜBER die Reihe, nie die Reihe
 * selbst. Das ist die Bedingung dafür, dass das Ergebnis im Entwurf eines Zählpunkts gespeichert
 * werden darf, ohne einen zweiten Speicherort für dieselben Erzeugungsdaten zu schaffen — die
 * Rohdatei bleibt in `project_documents`/Storage.
 */

/**
 * Ein Bereich ohne Erzeugungswerte. Halboffen `[from, to)`.
 *
 * ⚠ EIN ALIAS UND KEINE KOPIE. Es ist derselbe Begriff („ein Zeitbereich, für den kein Messwert
 * vorliegt"), und beide Seiten werden im Entwurf eines Zählpunkts gleich gelesen und gleich
 * geschrieben. Ein strukturgleicher Zwilling daneben wäre die Einladung, die zwei beim nächsten
 * Umbau auseinanderlaufen zu lassen; der Aliasname steht trotzdem da, damit an der Aufrufstelle
 * nicht „LoadProfile" für eine PV-Reihe steht.
 */
export type PvProfileGap = LoadProfileGap

/** Was eine PV-Erzeugungsreihe über sich verrät. Feldweise dieselbe Aussage wie beim Lastgang. */
export type PvProfileMetadata = {
  /** Aus den Zeitstempeln erkannt, nicht angenommen — s. `SUPPORTED_INTERVAL_MINUTES`. */
  intervalMinutes: number
  /** Beginn des ERSTEN Intervalls mit Messwert, ISO/UTC. */
  coveredFrom: string
  /**
   * ENDE des LETZTEN Intervalls mit Messwert, ISO/UTC — letzter Zeitstempel + `intervalMinutes`.
   *
   * ⚠ OBERE KANTE EINES HALBOFFENEN BEREICHS, dieselbe Konvention (und dieselbe Falle) wie bei
   * `LoadProfileMetadata.coveredTo`: ein Jahresprofil endet damit am 1. Jänner des FOLGEjahres um
   * 00:00, nicht am 31.12. um 23:45. Wer es für den letzten Messwert hält, verliert ein Intervall.
   */
  coveredTo: string
  /** Die Lücken über der Toleranzschwelle (`GAP_TOLERANCE_INTERVALS`), in zeitlicher Reihenfolge. */
  gaps: PvProfileGap[]
  /** Zahl der Intervalle MIT Messwert (nach Deduplizierung), nicht die Zahl der Dateizeilen. */
  rowCount: number
  /** Belegte Kalendermonate (lokal) — dieselbe Ableitung wie `DataQuality.coveredMonths`. */
  coveredMonths: number
}

/**
 * ⚠ NUR ZWEI ZWEIGE, und der fehlende dritte ist Absicht: es gibt keinen `needsMapping`-Ausgang
 * (s. o.). Ein Feld `needsMapping: false` mitzuführen, nur damit die Form der des Lastgangs
 * gleicht, wäre eine Requisite — ein Wert, an dem nie etwas hängt.
 */
export type PvProfileScan = ({ ok: true } & PvProfileMetadata) | { ok: false; error: ParseError }

function pvErr(code: ParseError['code'], message: string): PvProfileScan {
  return { ok: false, error: { code, message } }
}

/**
 * Aus einer aufsteigend sortierten, DEDUPLIZIERTEN Zeitstempel-Liste die Metadaten ableiten.
 *
 * ⚠ `readLoadProfileMetadata` trägt dieselbe Ableitung heute noch INLINE, und dieser Schritt fasst
 * sie ausdrücklich nicht an: jene Funktion ist live geprüft (PR #192, gegen echte Exporte und den
 * Tag der Zeitumstellung), und eine mechanische Umstellung dort hiesse, die Lastgang-Station danach
 * neu zu messen. Die Doppelung ist damit benannt statt übersehen — wer sie zusammenlegt, tut es als
 * eigenen, messbaren Schritt.
 */
function pvMetadataFromStamps(stamps: number[], timezone: string): PvProfileScan {
  const intervalMinutes = detectIntervalMinutes(stamps)
  if (!(SUPPORTED_INTERVAL_MINUTES as readonly number[]).includes(intervalMinutes))
    return pvErr(
      'wrong_interval',
      `Nur ${SUPPORTED_INTERVAL_MINUTES.join('- oder ')}-min-Intervall unterstuetzt ` +
        `(erkannt: ${intervalMinutes} min).`,
    )

  const stepMs = intervalMinutes * 60_000
  const gaps: PvProfileGap[] = []
  for (let i = 1; i < stamps.length; i++) {
    const previous = stamps[i - 1]!
    const current = stamps[i]!
    const missing = Math.round((current - previous) / stepMs) - 1
    if (missing < GAP_TOLERANCE_INTERVALS) continue
    gaps.push({ from: toIsoUtc(previous + stepMs), to: toIsoUtc(current) })
  }

  const first = stamps[0]!
  const last = stamps[stamps.length - 1]!

  return {
    ok: true,
    intervalMinutes,
    coveredFrom: toIsoUtc(first),
    coveredTo: toIsoUtc(last + stepMs),
    gaps,
    rowCount: stamps.length,
    coveredMonths: countCoveredMonths(stamps, timezone),
  }
}

/**
 * Liest Zeitraum, Intervall und Lücken einer PV-Erzeugungsreihe. Kein Datei-I/O, kein Netz, kein
 * Modellaufruf — deterministisch und damit ohne abrechenbare Kosten.
 *
 * @param input Roher Datei-Inhalt (CSV als String, XLSX als ArrayBuffer/Uint8Array).
 * @param options Wie bei `parsePvProfile`; `columns` setzt die Spaltenwahl ausdrücklich fest.
 */
export function readPvProfileMetadata(
  input: { content: string | ArrayBuffer | Uint8Array; fileName?: string; format?: 'csv' | 'xlsx' },
  options: ParseOptions = {},
): PvProfileScan {
  const limits = resolveLimits(options.limits)

  const size = byteSize(input.content)
  if (size === 0) return pvErr('empty', 'Die Datei ist leer.')
  if (size > limits.maxBytes)
    return pvErr('too_large', `Datei zu gross (${size} > ${limits.maxBytes} Bytes).`)

  const table = extractTable(input, options.delimiter)
  if (table.matrix.length === 0) return pvErr('empty', 'Keine Datenzeilen gefunden.')
  if (table.matrix.length > limits.maxRows)
    return pvErr('too_many_rows', `Zu viele Zeilen (${table.matrix.length} > ${limits.maxRows}).`)

  const fallbackDecimal = table.delimiter === ';' ? ',' : '.'
  const draft = detectStructure(table.matrix, options.decimal ?? fallbackDecimal)

  const dateFormat = (options.dateFormat as DateFormat | undefined) ?? draft.dateFormat
  const decimal = options.decimal ?? draft.decimal
  const timezone = options.timezone ?? DEFAULT_TZ

  if (draft.timestampCol == null || dateFormat == null)
    return pvErr('no_timestamp_column', 'Keine Zeitstempel-Spalte erkannt.')

  const valueCol = options.columns?.value ?? draft.valueCols[0]
  if (valueCol == null) return pvErr('no_value_column', 'Keine Wert-Spalte erkannt.')

  const timeColumn = options.columns?.timeColumn ?? draft.timeColumn
  const columns: ColumnMapping = {
    timestamp: options.columns?.timestamp ?? draft.timestampCol,
    ...(timeColumn != null ? { timeColumn } : {}),
    value: valueCol,
  }

  /*
   * ⚠ DIE EINHEIT IST HIER OHNE WIRKUNG, wortgleich zum Lastgang-Leser: `parsePvProfile` fragt bei
   * `unknown` zurück (dort entscheidet kW gegen kWh über den Faktor 4 und damit über jeden
   * Erzeugungswert). Diese Funktion gibt keinen einzigen Wert zurück — die Einheit steuert nur eine
   * Multiplikation, die niemand liest. Eine Rückfrage dafür wäre eine Hürde ohne Ertrag.
   */
  const unit: Unit = options.unit ?? (draft.unit === 'unknown' ? 'kW' : draft.unit)

  const norm = normalizeSingleValue(draft.dataRows, {
    columns,
    dateFormat,
    decimal,
    unit,
    timezone,
  })
  if (norm.parsedRows === 0)
    return pvErr('unparsable_timestamps', 'Keine Zeile mit gueltigem Zeitstempel und Wert.')
  if (norm.parsedRows < 2) return pvErr('insufficient_rows', 'Zu wenige gueltige Datenzeilen.')

  /*
   * Sortieren und deduplizieren wie beim Lastgang-Leser: die Stunde der Zeitumstellung im Herbst
   * liefert denselben UTC-Zeitpunkt zweimal, und ein Abstand von 0 verfälschte die
   * Intervall-Bestimmung. Der dort beschriebene Artefakt (eine gemeldete Lücke von einer Stunde am
   * Rückfall-Tag) gilt hier unverändert — bei einer PV-Reihe fällt er auf eine Nachtstunde und
   * damit auf Erzeugungswerte von 0.
   */
  const sorted = [...norm.readings].sort((a, b) => a.ms - b.ms)
  const stamps: number[] = []
  for (const reading of sorted) {
    if (stamps[stamps.length - 1] === reading.ms) continue
    stamps.push(reading.ms)
  }
  if (stamps.length < 2) return pvErr('insufficient_rows', 'Zu wenige unterschiedliche Zeitstempel.')

  return pvMetadataFromStamps(stamps, timezone)
}
