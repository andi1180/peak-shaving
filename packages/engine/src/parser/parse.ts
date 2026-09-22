import type { LoadProfile, PvProfile } from 'shared'

import { matchAdapter } from './adapters'
import { countCoveredMonths, toIsoUtc, utcMsToLocalFields, type DateFormat } from './datetime'
import { detectStructure, isInverterExport, type DetectionDraft } from './detect'
import { byteSize, resolveLimits } from './limits'
import { normalizeLoad, normalizeSingleValue, type NormalizeResult } from './normalize'
import { prepareSeries } from './prepare'
import { extractTable } from './table'
import type {
  ColumnMapping,
  Detection,
  ParseError,
  ParseOptions,
  ParseOutcome,
  PvParseOutcome,
  TablePreview,
  Unit,
} from './types'

const DEFAULT_TZ = 'Europe/Vienna'
const DEFAULT_MAX_GAP = 4 // 1 h

function err(
  code: ParseError['code'],
  message: string,
): { ok: false; kind: 'error'; error: ParseError } {
  return { ok: false, kind: 'error', error: { code, message } }
}

/** `TT.MM.JJJJ` in der Profil-Zeitzone — für Meldungen, nicht für Rechnungen. */
function localDate(ms: number, timeZone: string): string {
  const { year, month, day } = utcMsToLocalFields(ms, timeZone)
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`
}

/**
 * Meldungen zu übersprungenen Zeilen — je Ausfallart eine, NIE zu einer Zahl addiert. (22.09.2026)
 *
 * Eine Zeile ohne lesbaren Zeitstempel und eine Zeile ohne Messwert sind zwei verschiedene
 * Befunde: die erste ist ein Verdacht auf falsch erkanntes Format, die zweite eine Aussage über
 * den Zähler. Am Referenzfall trug die Datei 14.980 wertlose Zeilen am Anfang, weil die Auslesung
 * erst später begann — die gemeinsame Meldung las sich dort wie ein Parser-Fehler.
 *
 * ── ⚠ DER ZEITRAUM WIRD NUR BEHAUPTET, WENN ER EINER IST ─────────────────────────────────────
 * Ein Anfangs- oder Endblock liegt vor, wenn ALLE Wert-Ausfälle vor dem ersten bzw. nach dem
 * letzten gemessenen Wert liegen. Sonst nennt der Satz bewusst keine Grenzen: „von … bis …" über
 * verstreute Lücken gelesen hiesse, dazwischen fehle auch alles.
 *
 * Gemessen wird gegen die ROHEN Lesungen, nicht gegen `prepareSeries` — dort sind interpolierte
 * Slots von gemessenen nicht mehr zu unterscheiden.
 *
 * Die Meldung zum Zeitstempel-Fall ist absichtlich wortgleich die bisherige.
 */
function skippedRowWarnings(norm: NormalizeResult, timeZone: string): string[] {
  const out: string[] = []
  if (norm.skippedTimestampRows > 0)
    out.push(`${norm.skippedTimestampRows} Zeile(n) ohne gültigen Zeitstempel/Wert übersprungen.`)

  const range = norm.valueGapRange
  if (range == null) return out

  const count = `${norm.skippedValueRows} Zeile(n) ohne Messwert`
  if (norm.readings.length === 0) {
    out.push(`${count}, verteilt über den Zeitraum.`)
    return out
  }

  let firstMs = Number.POSITIVE_INFINITY
  let lastMs = Number.NEGATIVE_INFINITY
  for (const r of norm.readings) {
    if (r.ms < firstMs) firstMs = r.ms
    if (r.ms > lastMs) lastMs = r.ms
  }

  const from = localDate(range.fromMs, timeZone)
  const to = localDate(range.toMs, timeZone)
  const span = from === to ? `am ${from}` : `${from} bis ${to}`

  if (range.toMs < firstMs)
    out.push(`${count} (${span}) — die Zählerauslesung beginnt erst ab ${localDate(firstMs, timeZone)}.`)
  else if (range.fromMs > lastMs)
    out.push(`${count} (${span}) — die Zählerauslesung endet mit ${localDate(lastMs, timeZone)}.`)
  else out.push(`${count}, verteilt über den Zeitraum.`)

  return out
}

function decimalFallback(delimiter?: string): ',' | '.' {
  return delimiter === ';' ? ',' : '.'
}

function deriveColumns(draft: DetectionDraft, source: string): ColumnMapping | null {
  if (draft.timestampCol == null) return null
  const base: ColumnMapping = { timestamp: draft.timestampCol }
  if (draft.timeColumn != null) base.timeColumn = draft.timeColumn
  if (source === 'import_export_split') {
    if (draft.importCol == null || draft.exportCol == null) return null
    return { ...base, import: draft.importCol, export: draft.exportCol }
  }
  const v = draft.valueCols[0]
  if (v == null) return null
  return { ...base, value: v }
}

/**
 * Kann die Wert-Spalten-Zuordnung OHNE Nutzer-Bestätigung sicher abgeleitet werden?
 * - 0/1 Wert-Spalte → ja (einzelne signierte Spalte, unzweideutig).
 * - genau 1 Verbrauch + höchstens 1 Einspeisung, sonst nichts → ja (klassisches Import/Export).
 * Alles andere (mehrere gleichrollige Spalten, EEG-Artefakte, unklassifizierbare Extraspalten) →
 * NEIN → Mehrspalten-needs_mapping. „Wähle genau eine Spalte" wäre an echten Mehrzähler-Daten falsch
 * und würde stillschweigend die Hälfte des Verbrauchs verlieren (§3.2/OP#4).
 */
function autoResolvableValueColumns(draft: DetectionDraft): boolean {
  const infos = draft.valueColumnInfos
  if (infos.length <= 1) return true
  const consumption = infos.filter((i) => i.suggestedRole === 'consumption').length
  const feedIn = infos.filter((i) => i.suggestedRole === 'feed_in').length
  const other = infos.length - consumption - feedIn
  return consumption === 1 && feedIn <= 1 && other === 0
}

function hasValueMapping(c: ColumnMapping): boolean {
  return (
    c.value != null ||
    c.import != null ||
    (c.consumptionCols?.length ?? 0) > 0 ||
    (c.feedInCols?.length ?? 0) > 0
  )
}

function buildDetection(
  table: { format: Detection['format']; delimiter?: string },
  draft: DetectionDraft,
  fields: {
    decimal: Detection['decimal']
    dateFormat: DateFormat
    tz: string
    unit: Detection['unit']
    source: Detection['source']
    columns: ColumnMapping
    adapterId: string
  },
): Detection {
  return {
    format: table.format,
    delimiter: table.delimiter,
    decimal: fields.decimal,
    dateFormat: fields.dateFormat,
    timezone: fields.tz,
    unit: fields.unit,
    source: fields.source,
    columns: fields.columns,
    headerRow: draft.headerRow,
    adapterId: fields.adapterId,
  }
}

function buildPreview(draft: DetectionDraft): TablePreview {
  const headers = draft.headers.length
    ? draft.headers
    : (draft.dataRows[0] ?? []).map((_, i) => `Spalte ${i + 1}`)
  const rows = draft.dataRows.slice(0, 5).map((r) => r.map((c) => (c == null ? '' : String(c))))
  return { headers, rows }
}

/**
 * Parst rohen Datei-Inhalt zu einem validierten LoadProfile (§3.1–§3.3). Kein Datei-I/O.
 *
 * ── ⚠ HIER FEHLT ABSICHTLICH EINE PRÜFUNG: die Datums-UNTERGRENZE (Delta 15, Regel B) ──────────
 * Der Kalkulator nimmt Lastgänge erst **ab dem 1.1.2025** an — davor gibt es in `public.spot_prices`
 * keine Marktpreise, und der Tarifvergleich wäre nicht rechenbar. Diese Grenze wird **NICHT hier**
 * geprüft, und das ist eine getroffene Entscheidung (B21-3a, Delta 14 Punkt 8), keine vergessene
 * Zeile:
 *
 *   • Der Parser ist die generische LESE-Fähigkeit der Engine. Er beantwortet „lässt sich diese
 *     Datei korrekt lesen?" — nicht „wollen wir mit diesem Zeitraum rechnen?". Das Zweite ist eine
 *     Produktentscheidung, die sich mit dem Datenbestand verschiebt (wächst der Backfill nach
 *     hinten, wandert die Grenze mit) und deshalb nicht in den Rechenkern gehört.
 *   • Vier bestehende Engine-Testdateien lesen bewusst 2023er-Fixtures über genau diese Funktion
 *     (`simulation/simulate.test.ts`, `recommendation/rank.test.ts`, `simulation/pv-chain.test.ts`).
 *     Ihre Zahlen sind Regressionsgrundlage, kein Kundenfall — eine Grenze im Parser machte sie rot
 *     und nähme der Engine ihre Vergleichsbasis.
 *
 * Geprüft wird im **Upload-Schritt** (`apps/website/components/flow/step-upload.tsx`,
 * `rejectIfBeforeAnchor`), unmittelbar nach dem Parsen und vor jeder Übernahme in den Flow. Die
 * Konstante steht in `packages/shared/src/analysis-window.ts` (`SPOT_PRICE_ANCHOR_ISO`).
 */
export function parseLoadProfile(
  input: { content: string | ArrayBuffer | Uint8Array; fileName?: string; format?: 'csv' | 'xlsx' },
  options: ParseOptions = {},
): ParseOutcome {
  const limits = resolveLimits(options.limits)
  const timezone = options.timezone ?? DEFAULT_TZ
  const maxGap = options.maxInterpolationGap ?? DEFAULT_MAX_GAP
  const signConvention = options.signConvention ?? 'import_positive'

  const size = byteSize(input.content)
  if (size === 0) return err('empty', 'Die Datei ist leer.')
  if (size > limits.maxBytes)
    return err('too_large', `Datei zu groß (${size} > ${limits.maxBytes} Bytes).`)

  const table = extractTable(input, options.delimiter)
  if (table.matrix.length === 0) return err('empty', 'Keine Datenzeilen gefunden.')
  if (table.matrix.length > limits.maxRows)
    return err('too_many_rows', `Zu viele Zeilen (${table.matrix.length} > ${limits.maxRows}).`)

  const draft = detectStructure(table.matrix, options.decimal ?? decimalFallback(table.delimiter))

  // Wechselrichter-/ESS-Log (OP#4, Format B): kein Netz-Lastgang → fachlich korrekt ablehnen,
  // NICHT versuchen, daraus einen Lastgang zu konstruieren.
  if (isInverterExport(draft.headers))
    return err(
      'not_a_load_profile',
      'Kein Netz-Lastgang: Die Datei enthält nur Wechselrichter-/Batteriedaten ' +
        '(z. B. Ein-/Ausgangsleistung, Batterielade-/-entladeleistung), aber keinen Netzbezug. ' +
        'Bitte den Netz-Lastgang des Netzbetreibers hochladen.',
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
  const unit = options.unit ?? hints.unit ?? draft.unit
  const detectedSource = options.source ?? hints.source ?? draft.source
  const tz = hints.timezone ?? timezone

  // Zeitstempel strukturell.
  if (draft.timestampCol == null || dateFormat == null)
    return err('no_timestamp_column', 'Keine Zeitstempel-Spalte erkannt.')

  const explicitColumns = options.columns ?? hints.columns

  // Mehrere plausible Wert-Spalten & keine Bestätigung → Mehrspalten-Mapping-Rückmeldung (§3.2/OP#4).
  // KEINE stille Heuristik: das UI ordnet Rollen zu und summiert gleichrollige Spalten.
  if (explicitColumns == null && !autoResolvableValueColumns(draft)) {
    const tsColumns: ColumnMapping = { timestamp: draft.timestampCol }
    if (draft.timeColumn != null) tsColumns.timeColumn = draft.timeColumn
    return {
      ok: false,
      kind: 'needs_mapping',
      detection: buildDetection(table, draft, {
        decimal,
        dateFormat,
        tz,
        unit,
        source: detectedSource,
        columns: tsColumns,
        adapterId: adapter?.id ?? 'generic',
      }),
      issues: [
        {
          field: 'valueColumns',
          message:
            'Mehrere Wert-Spalten erkannt (z. B. mehrere Zählpunkte / Einspeisung / EEG-Verrechnung). ' +
            'Bitte je Spalte die Rolle bestätigen (Verbrauch / Einspeisung / Ignorieren). ' +
            'Mehrere Verbrauchszählpunkte desselben Standorts werden summiert.',
        },
      ],
      preview: buildPreview(draft),
      valueColumns: draft.valueColumnInfos,
    }
  }

  const columns = explicitColumns ?? deriveColumns(draft, detectedSource)
  if (columns == null || !hasValueMapping(columns))
    return err('no_value_column', 'Keine Wert-Spalte(n) erkannt.')

  // Effektive source: bei Summierung aus den gemappten Rollen abgeleitet (mit Einspeisung ⇒ split).
  const source =
    columns.consumptionCols != null || columns.feedInCols != null
      ? (columns.feedInCols?.length ?? 0) > 0
        ? 'import_export_split'
        : 'import_only'
      : detectedSource

  const detection = buildDetection(table, draft, {
    decimal,
    dateFormat,
    tz,
    unit,
    source,
    columns,
    adapterId: adapter?.id ?? 'generic',
  })

  // Einheit uneindeutig → KEINE stille Annahme, Mapping-Rückmeldung (§3.2).
  if (unit === 'unknown') {
    return {
      ok: false,
      kind: 'needs_mapping',
      detection,
      issues: [
        {
          field: 'unit',
          message:
            'Einheit nicht eindeutig erkennbar (kW oder kWh). Bitte bestätigen — bei kWh-Viertelstundenwerten wird ×4 gerechnet.',
          options: ['kW', 'kWh'],
        },
      ],
      preview: buildPreview(draft),
    }
  }

  const norm = normalizeLoad(draft.dataRows, {
    columns,
    dateFormat,
    decimal,
    unit: unit as Unit,
    timezone: tz,
    source,
    signConvention,
  })
  if (norm.parsedRows === 0)
    return err('unparsable_timestamps', 'Keine Zeile mit gültigem Zeitstempel und Wert.')
  if (norm.parsedRows < 2) return err('insufficient_rows', 'Zu wenige gültige Datenzeilen.')

  const prepared = prepareSeries(norm.readings, maxGap)
  if (prepared.intervalMinutes !== 15)
    return err(
      'wrong_interval',
      `Nur 15-min-Intervall unterstützt (erkannt: ${prepared.intervalMinutes} min).`,
    )

  // Datenqualität + Warnungen.
  const warnings = [...prepared.warnings, ...skippedRowWarnings(norm, tz)]

  // Pflichtwarnung (§3.1): import_only ohne PV-Profil.
  if (source === 'import_only' && !options.hasPvProfile) {
    warnings.push(
      'source ist „import_only" ohne PV-Profil: Die Eigenverbrauchs- und Lastverschiebungs-Ersparnis ist nicht beurteilbar und kann unterschätzt sein (keine Einspeise-/PV-Daten).',
    )
  }
  // Plausibilität: unerwartete Negativwerte bei import_only.
  if (source === 'import_only' && prepared.slots.some((s) => s.value < 0)) {
    warnings.push(
      'Negative Bezugswerte trotz source „import_only" — bitte Spaltenzuordnung prüfen.',
    )
  }

  const profile: LoadProfile = {
    readings: prepared.slots.map((s) => ({ ts: toIsoUtc(s.ms), gridPowerKw: s.value })),
    intervalMinutes: 15,
    timezoneMeta: tz,
    source,
  }

  return {
    ok: true,
    profile,
    dataQuality: {
      coveredDays: prepared.coveredDays,
      coveredMonths: countCoveredMonths(
        prepared.slots.map((s) => s.ms),
        tz,
      ),
      gapsInterpolated: prepared.gapsInterpolated,
      largestGapSlots: prepared.largestGapSlots,
      warnings,
    },
    detection,
  }
}

/** Parst rohen Datei-Inhalt zu einem PvProfile (§3.1). Einzelne Wertspalte, keine source. */
export function parsePvProfile(
  input: { content: string | ArrayBuffer | Uint8Array; fileName?: string; format?: 'csv' | 'xlsx' },
  options: ParseOptions = {},
): PvParseOutcome {
  const limits = resolveLimits(options.limits)
  const timezone = options.timezone ?? DEFAULT_TZ
  const maxGap = options.maxInterpolationGap ?? DEFAULT_MAX_GAP

  const size = byteSize(input.content)
  if (size === 0) return err('empty', 'Die Datei ist leer.')
  if (size > limits.maxBytes) return err('too_large', `Datei zu groß.`)

  const table = extractTable(input, options.delimiter)
  if (table.matrix.length === 0) return err('empty', 'Keine Datenzeilen gefunden.')
  if (table.matrix.length > limits.maxRows) return err('too_many_rows', 'Zu viele Zeilen.')

  const draft = detectStructure(table.matrix, options.decimal ?? decimalFallback(table.delimiter))
  const dateFormat = (options.dateFormat as DateFormat | undefined) ?? draft.dateFormat
  const decimal = options.decimal ?? draft.decimal
  const unit = options.unit ?? draft.unit
  const columns =
    options.columns ??
    (draft.timestampCol != null && draft.valueCols[0] != null
      ? { timestamp: draft.timestampCol, value: draft.valueCols[0] }
      : null)

  if (draft.timestampCol == null || dateFormat == null)
    return err('no_timestamp_column', 'Keine Zeitstempel-Spalte erkannt.')
  if (columns == null || columns.value == null)
    return err('no_value_column', 'Keine Wert-Spalte erkannt.')

  const detection: Detection = {
    format: table.format,
    delimiter: table.delimiter,
    decimal,
    dateFormat,
    timezone,
    unit,
    source: 'import_only', // PV kennt keine source; Feld für Detection-Form belegt, ungenutzt.
    columns,
    headerRow: draft.headerRow,
    adapterId: 'generic',
  }

  if (unit === 'unknown') {
    return {
      ok: false,
      kind: 'needs_mapping',
      detection,
      issues: [
        {
          field: 'unit',
          message: 'Einheit des PV-Profils nicht eindeutig (kW oder kWh). Bitte bestätigen.',
          options: ['kW', 'kWh'],
        },
      ],
      preview: buildPreview(draft),
    }
  }

  const norm = normalizeSingleValue(draft.dataRows, {
    columns,
    dateFormat,
    decimal,
    unit: unit as Unit,
    timezone,
  })
  if (norm.parsedRows < 2) return err('insufficient_rows', 'Zu wenige gültige Datenzeilen.')

  const prepared = prepareSeries(norm.readings, maxGap)
  if (prepared.intervalMinutes !== 15)
    return err(
      'wrong_interval',
      `Nur 15-min-Intervall unterstützt (erkannt: ${prepared.intervalMinutes} min).`,
    )

  const warnings = [...prepared.warnings, ...skippedRowWarnings(norm, timezone)]

  const profile: PvProfile = {
    readings: prepared.slots.map((s) => ({ ts: toIsoUtc(s.ms), pvGenerationKw: s.value })),
  }

  return {
    ok: true,
    profile,
    dataQuality: {
      coveredDays: prepared.coveredDays,
      coveredMonths: countCoveredMonths(
        prepared.slots.map((s) => s.ms),
        timezone,
      ),
      gapsInterpolated: prepared.gapsInterpolated,
      largestGapSlots: prepared.largestGapSlots,
      warnings,
    },
    detection,
  }
}
