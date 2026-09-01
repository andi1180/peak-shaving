/**
 * Delta 17 — MEHRERE RECHNUNGEN, EIN SATZ VORBELEGUNGEN.
 *
 * Der vierte Einstieg lässt beliebig viele Zeilen zu, und der Regelfall dabei ist genau der, den
 * die drei bestehenden Einstiege nicht kennen: jemand legt zwei oder drei Rechnungen ab („Rechnung
 * 01/25", „Rechnung 02/25"). Schritt 2 nimmt aber EINEN Satz Tarifangaben entgegen. Diese Datei
 * ist die Regel, nach der aus mehreren gelesenen Rechnungen einer wird.
 *
 * ── ⚠ DIE REGEL: EINIGKEIT ÜBERNIMMT, WIDERSPRUCH BLEIBT LEER — UND WIRD BENANNT ──────────────
 * Je Feld werden die Werte aller Rechnungen verglichen, die dazu überhaupt etwas sagen.
 *   – Sagt keine etwas → `null` (wie bei einer einzelnen Rechnung, die es nicht hergibt).
 *   – Sagen alle dasselbe → dieser Wert.
 *   – Widersprechen sie einander → `null`, UND das Feld wird als Widerspruch zurückgemeldet.
 *
 * Der letzte Fall ist der eigentliche Grund für dieses Modul. Drei naheliegende Alternativen sind
 * ausdrücklich verworfen:
 *
 *   „Die neueste gewinnt."   NICHT MÖGLICH, und das ist gemessen und nicht abgeleitet:
 *                            `InvoiceExtraction` trägt KEIN Datum und keinen Zeitraum. Der
 *                            Rechnungs-Scan liest bewusst nur Beträge; welche von zwei Rechnungen
 *                            die jüngere ist, steht nirgends im Ergebnis. Die Regel liesse sich
 *                            also nur über den Dateinamen oder die Bezeichnung raten — über Text
 *                            also, den ein Mensch getippt hat.
 *   „Die erste gewinnt."     Das wäre die Reihenfolge im Formular, also ein Zufall der Bedienung.
 *   „Mittelwert."            Eine gerechnete Zahl, die auf keiner der Rechnungen steht — genau das,
 *                            was schon der System-Prompt des Rechnungs-Scans für mehrere Zeiträume
 *                            innerhalb EINER Rechnung verbietet.
 *
 * Leer lassen kostet den Nutzer eine Eingabe in Schritt 2, wo das Feld ohnehin editierbar ist.
 * Falsch übernehmen kostet ihn eine Wirtschaftlichkeitsrechnung, der er ansieht, dass sie stimmt.
 * Damit er die Eingabe überhaupt als nötig erkennt, wird der Widerspruch NICHT verschluckt, sondern
 * mit dem Namen des Feldes zurückgegeben — die Oberfläche nennt ihn.
 *
 * Rein und ohne Seiteneffekte. Der Import ist ausschliesslich ein TYP-Import; `invoice-scan.ts`
 * selbst bleibt in diesem Bauabschnitt mit 0 Zeilen Diff unangetastet.
 */
import {
  INVOICE_SCAN_RATE_KEYS,
  emptyInvoiceExtraction,
  type InvoiceExtraction,
} from './invoice-scan'

/** Die Felder, über die ein Widerspruch überhaupt entstehen kann — Kopffelder plus Beträge. */
export const INVOICE_MERGE_FIELD_KEYS = [
  'netzbetreiber',
  'netzebene',
  'meteringVariant',
  'annualConsumptionKwh',
  ...INVOICE_SCAN_RATE_KEYS,
] as const
export type InvoiceMergeFieldKey = (typeof INVOICE_MERGE_FIELD_KEYS)[number]

/**
 * Anzeigenamen der Felder — für den Satz, mit dem die Oberfläche einen Widerspruch benennt.
 * Eine Formulierung, ein Ort: dieselben Bezeichnungen, die auch der Rechnungs-Scan verwendet.
 */
export const INVOICE_MERGE_FIELD_LABELS: Record<InvoiceMergeFieldKey, string> = {
  netzbetreiber: 'Netzbetreiber',
  netzebene: 'Netzebene',
  meteringVariant: 'Leistungsmessung',
  annualConsumptionKwh: 'Jahresverbrauch',
  leistungspreisEurPerKwYear: 'Leistungspreis',
  minBillableKw: 'vereinbarte Leistung',
  arbeitspreisNetzCtPerKwh: 'Netz-Arbeitspreis',
  energyPriceCtPerKwh: 'Arbeitspreis',
  energyPriceNightCtPerKwh: 'Nachttarif',
  einspeiseverguetungCtPerKwh: 'Einspeisevergütung',
}

export type InvoiceMergeResult = {
  /** Der zusammengeführte Stand. Ein Feld mit Widerspruch ist hier `null`. */
  merged: InvoiceExtraction
  /**
   * Die Felder, in denen sich die Rechnungen widersprochen haben — in der Reihenfolge von
   * `INVOICE_MERGE_FIELD_KEYS`, also stabil und nicht von der Reihenfolge der Dateien abhängig.
   */
  conflicts: InvoiceMergeFieldKey[]
}

/** Liest ein Feld aus einer Extraktion, egal ob es im Kopf oder unter `rates` steht. */
function fieldValue(
  extraction: InvoiceExtraction,
  key: InvoiceMergeFieldKey,
): string | number | null {
  if (key === 'netzbetreiber') return extraction.netzbetreiber
  if (key === 'netzebene') return extraction.netzebene
  if (key === 'meteringVariant') return extraction.meteringVariant
  if (key === 'annualConsumptionKwh') return extraction.annualConsumptionKwh
  return extraction.rates[key]
}

/** Schreibt ein Feld an dieselbe Stelle zurück. */
function setFieldValue(
  target: InvoiceExtraction,
  key: InvoiceMergeFieldKey,
  value: string | number | null,
): void {
  if (key === 'netzbetreiber') {
    target.netzbetreiber = value as InvoiceExtraction['netzbetreiber']
  } else if (key === 'netzebene') {
    target.netzebene = value as InvoiceExtraction['netzebene']
  } else if (key === 'meteringVariant') {
    target.meteringVariant = value as InvoiceExtraction['meteringVariant']
  } else if (key === 'annualConsumptionKwh') {
    target.annualConsumptionKwh = value as number | null
  } else {
    target.rates[key] = value as number | null
  }
}

/**
 * Führt mehrere gelesene Rechnungen zu einem Satz Vorbelegungen zusammen.
 *
 * Eine einzelne Rechnung kommt unverändert wieder heraus (der Regelfall bleibt kostenlos); eine
 * leere Liste ergibt ein Ergebnis, in dem nichts erkannt wurde — kein Wurf, kein Sonderfall beim
 * Aufrufer.
 */
export function mergeInvoiceExtractions(extractions: readonly InvoiceExtraction[]): InvoiceMergeResult {
  const merged = emptyInvoiceExtraction()
  const conflicts: InvoiceMergeFieldKey[] = []

  for (const key of INVOICE_MERGE_FIELD_KEYS) {
    const stated = extractions
      .map((extraction) => fieldValue(extraction, key))
      .filter((value): value is string | number => value !== null)

    const first = stated[0]
    if (first === undefined) continue

    /*
     * Strenger Vergleich, ausdrücklich ohne Toleranz: 25,4 und 25,41 sind zwei verschiedene
     * Tarifsätze und keine Messungenauigkeit. Eine Toleranz wäre eine erfundene Grenze, ab der ein
     * Widerspruch als Einigkeit durchginge — und sie fiele niemandem auf.
     */
    if (stated.every((value) => value === first)) setFieldValue(merged, key, first)
    else conflicts.push(key)
  }

  return { merged, conflicts }
}
