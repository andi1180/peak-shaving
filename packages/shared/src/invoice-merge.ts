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
 *   „Die neueste gewinnt."   VERWORFEN — und die Begründung dafür hat sich am 11.09.2026 geändert,
 *                            die Entscheidung nicht. Bis dahin stand hier „nicht möglich":
 *                            `InvoiceExtraction` trug kein Datum, welche von zwei Rechnungen die
 *                            jüngere ist, stand nirgends im Ergebnis. Seit dem Abrechnungszeitraum
 *                            (`billingPeriodFrom`/`billingPeriodTo`) stünde es dort sehr wohl —
 *                            die Regel WÄRE also baubar. Sie bleibt trotzdem draussen, aus zwei
 *                            Gründen, die beide schwerer wiegen als die frühere Unmöglichkeit:
 *                              (a) Ein Widerspruch ist eine FACHLICHE Frage, und Delta §3.3 legt
 *                                  sie dem Kunden vor („warten oder begründete Annahme"). Die
 *                                  jüngere Rechnung still gewinnen zu lassen entschiede sie im
 *                                  Verborgenen — und zwar falsch, sobald zwei Rechnungen gar nicht
 *                                  dasselbe meinen (zwei Zählpunkte, Bezug neben Einspeisung).
 *                              (b) Der Zeitraum passt nicht zum Satz. Er ist die ÄUSSERE Spanne
 *                                  der ganzen Rechnung, der Betrag dagegen der des zuletzt
 *                                  endenden Abschnitts (System-Prompt des Scans). Aus „Rechnung B
 *                                  endet später" folgt also nicht, dass ihr Arbeitspreis der
 *                                  jüngere ist. Dazu darf der Zeitraum ERSCHLOSSEN sein
 *                                  (`billingPeriodAssumed`) — eine Reihenfolge daraus wäre eine
 *                                  Entscheidung über echte Beträge auf Basis einer Näherung.
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

/**
 * Die Felder, über die ein Widerspruch überhaupt entstehen kann — Kopffelder plus Beträge.
 *
 * ── ⚠ DER ABRECHNUNGSZEITRAUM STEHT HIER BEWUSST NICHT ───────────────────────────────────────
 * Zwei Rechnungen mit verschiedenen Zeiträumen sind der REGELFALL dieses Einstiegs, nicht sein
 * Fehlerfall: wer zwölf Monatsrechnungen ablegt, legt zwölf verschiedene Zeiträume ab. Hier
 * aufgeführt meldete das Modul also bei jedem einzelnen dieser Uploads einen „Widerspruch",
 * verlangte vom Kunden eine Entscheidung und drängte den Chat zu einer Rückfrage, die es nicht
 * gibt — die Meldung verlöre genau dort ihre Bedeutung, wo sie gebraucht wird.
 *
 * `mergeInvoiceExtractions` baut sein Ergebnis auf `emptyInvoiceExtraction()` auf und setzt
 * ausschliesslich die hier genannten Felder; die drei Zeitraum-Felder bleiben im zusammengeführten
 * Stand deshalb von selbst `null`. Die einzelnen Zeiträume gehen dem Modell nicht verloren: der
 * Ausführer reicht sie neben dem Merge als eigene Liste heraus (`periods`, `executor.ts`).
 */
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
  /*
   * Delta 19 / §3.7.3 — ausdrücklich „des Lieferanten": daneben steht auf jeder Rechnung der
   * gleichnamige Grundpreis des NETZBETREIBERS, und ein blosses „Grundgebühr" liesse den Nutzer
   * beim gemeldeten Widerspruch im Unklaren, welchen der beiden Posten er nachsehen soll.
   */
  supplierBaseFeeEurPerMonth: 'Grundgebühr des Lieferanten',
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
