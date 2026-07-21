/**
 * Die ausgeführte Datei (B2-1).
 *
 * REIN: kein `server-only`, kein `next/*` — die Export-Route streamt daraus, und die Unit-Tests
 * lesen dieselben Zeilen zurück, ohne dass ein Request nötig wäre.
 *
 * ── TRENNZEICHEN SEMIKOLON UND BOM: kein Geschmack, sondern die Datei überhaupt lesbar halten ────
 * Excel unter deutscher Ländereinstellung erwartet das Semikolon als Trennzeichen — mit Komma
 * landet die gesamte Zeile in EINER Spalte, und wer die Datei öffnet, sieht Buchstabensalat statt
 * einer Tabelle. Das UTF-8-BOM ist der zweite Teil derselben Sache: ohne ihn liest Excel die Datei
 * als Windows-1252, und aus „Bäckerei" wird „BÃ¤ckerei". Beides ist keine Kosmetik: eine Datei, die
 * beim ersten Öffnen zerfällt, wird von Hand repariert — und dabei entstehen die Fehler.
 *
 * ── QUOTING NACH RFC 4180, WEIL DIE FELDER ES BRAUCHEN ──────────────────────────────────────────
 * Firmennamen enthalten Kommas und Semikolons, Anschriften Zeilenumbrüche, Namen Anführungszeichen.
 * Ein Feld mit einem dieser Zeichen wird in `"` gefasst, enthaltene `"` werden verdoppelt. Ohne das
 * verschiebt EINE Firma mit Semikolon im Namen alle folgenden Spalten ihrer Zeile — und in einer
 * Adressdatei heisst „eine Spalte verschoben" irgendwann „falscher Empfänger".
 */

import { industryLabel, meteringTypeLabel, statusLabel, type Industry } from './leads'
import { formatDate, formatDateTime, formatKwh } from './format'

/** UTF-8-BOM. Muss als ERSTES Zeichen der Datei stehen, sonst wirkt es nicht. */
export const CSV_BOM = '﻿'

export const CSV_DELIMITER = ';'

/** RFC 4180 verlangt CRLF; Excel und LibreOffice lesen beides, Tabellen-Importe nicht immer. */
export const CSV_EOL = '\r\n'

/**
 * Eine Zeile aus `public.admin_export_leads`. Die Typen sind eine BEHAUPTUNG über die Migration
 * (der Wrapper liefert `jsonb`, der Typgenerator kennt davon nur `Json`) — deshalb liest
 * `readExportRows` unten defensiv.
 */
export type LeadExportRow = {
  id: string
  email: string
  company: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  status: string
  first_source_key: string
  first_source_label: string | null
  industry: Industry | null
  postal_code: string | null
  annual_consumption_kwh: number | null
  metering_type: string | null
  supplier: string | null
  /** Reines Datum („YYYY-MM-DD"). */
  contract_end_date: string | null
  created_at: string
  last_interaction_at: string
  /** bestätigt · offen · widerrufen · keine — kommt fertig aus der Datenbank. */
  marketing_consent: string
}

export type LeadExportResult = {
  rows: LeadExportRow[]
  rowCount: number
  filterSummary: string
  exportedAt: string | null
}

/** `null` = der Wrapper hat NICHT `ok` gemeldet (nicht: „es gibt keine Zeilen"). */
export function readExportResult(data: unknown): LeadExportResult | null {
  if (typeof data !== 'object' || data === null) return null
  const obj = data as Record<string, unknown>
  if (obj.status !== 'ok') return null
  return {
    rows: Array.isArray(obj.rows) ? (obj.rows as LeadExportRow[]) : [],
    rowCount: typeof obj.row_count === 'number' ? obj.row_count : 0,
    filterSummary: typeof obj.filter_summary === 'string' ? obj.filter_summary : '',
    exportedAt: typeof obj.exported_at === 'string' ? obj.exported_at : null,
  }
}

/**
 * Die Spalten der Datei.
 *
 * Der Einwilligungsstand steht bewusst als LETZTE Spalte und trägt eine sprechende Überschrift: er
 * ist die einzige Angabe, die darüber entscheidet, ob eine Zeile überhaupt angeschrieben werden
 * darf. Die Spalte „Herkunft (Schlüssel)" fährt zusätzlich zur Bezeichnung mit, weil die
 * Bezeichnung frei änderbar ist und der Schlüssel nicht — eine Auswertung, die auf den Klartext
 * zeigt, bricht beim ersten Umbenennen still.
 *
 * ── VORNAME UND NACHNAME BLEIBEN ZWEI SPALTEN ───────────────────────────────────────────────────
 * Aus der früheren Spalte „Ansprechperson" sind zwei geworden, und sie werden hier ausdrücklich
 * NICHT wieder zu einer zusammengefügt. Der Grund für die Auftrennung — eine korrekte Anrede und
 * die Wiederverwendbarkeit in einem Serienbrief — gilt für die ausgeführte Datei genauso wie für
 * die Anzeige; sie beim Ausführen zu verkleben, gäbe den Zweck genau dort auf, wo er am ehesten
 * gebraucht wird.
 */
export const CSV_HEADERS = [
  'Lead-ID',
  'E-Mail',
  'Firma',
  'Vorname',
  'Nachname',
  'Telefon',
  'Status',
  'Herkunft',
  'Herkunft (Schlüssel)',
  'Branche',
  'PLZ',
  'Jahresverbrauch',
  'Messart',
  'Versorger',
  'Vertragsende',
  'Erfasst am',
  'Letzte Interaktion',
  'Marketing-Einwilligung',
] as const

/** Leere Angaben als LEERES Feld, nicht als „—": ein Gedankenstrich ist in einer Datei ein Wert. */
function orEmpty(value: string | null | undefined): string {
  return value ?? ''
}

export function csvFields(row: LeadExportRow): string[] {
  return [
    row.id,
    row.email,
    orEmpty(row.company),
    orEmpty(row.first_name),
    orEmpty(row.last_name),
    orEmpty(row.phone),
    statusLabel(row.status),
    orEmpty(row.first_source_label ?? row.first_source_key),
    row.first_source_key,
    row.industry ? industryLabel(row.industry) : '',
    orEmpty(row.postal_code),
    row.annual_consumption_kwh === null ? '' : formatKwh(row.annual_consumption_kwh),
    row.metering_type ? meteringTypeLabel(row.metering_type) : '',
    orEmpty(row.supplier),
    row.contract_end_date ? formatDate(row.contract_end_date) : '',
    formatDateTime(row.created_at),
    formatDateTime(row.last_interaction_at),
    row.marketing_consent,
  ]
}

/** RFC 4180: quoten, sobald Trennzeichen, Anführungszeichen oder ein Zeilenumbruch vorkommt. */
export function csvEscape(value: string): string {
  const needsQuotes = /[";\r\n]/.test(value)
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value
}

export function csvLine(fields: readonly string[]): string {
  return fields.map(csvEscape).join(CSV_DELIMITER) + CSV_EOL
}

/**
 * Die Datei stückweise — BOM + Kopfzeile zuerst, dann je Zeile ein Stück.
 *
 * Ein Generator und kein zusammengesetzter String: die Route streamt daraus, statt den gesamten
 * Bestand als eine Zeichenkette im Speicher aufzubauen. Die Kopfzeile kommt IMMER, auch bei null
 * Treffern — eine leere Datei ohne Kopfzeile sieht aus wie ein fehlgeschlagener Download.
 */
export function* csvChunks(rows: readonly LeadExportRow[]): Generator<string> {
  yield CSV_BOM + csvLine(CSV_HEADERS)
  for (const row of rows) {
    yield csvLine(csvFields(row))
  }
}

/**
 * Dateiname mit Zeitpunkt der Ausfuhr — der aus der DATENBANK, nicht aus der Serveruhr: er ist
 * derselbe, der im Protokoll steht, und macht Datei und Protokolleintrag zuordenbar.
 */
export function exportFileName(exportedAt: string | null): string {
  const d = exportedAt ? new Date(exportedAt) : new Date(Number.NaN)
  const stamp = Number.isNaN(d.getTime())
    ? 'unbekannt'
    : d.toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `coolin-leads-${stamp}.csv`
}
