import {
  INVOICE_MERGE_FIELD_KEYS,
  INVOICE_MERGE_FIELD_LABELS,
  METERING_VARIANT_LABELS,
  NETZBETREIBER_LABELS,
  parseInvoiceExtraction,
  tariffParamsSchema,
  type InvoiceExtraction,
  type InvoiceMergeFieldKey,
} from 'shared'

import type { DraftValue } from '@/lib/project-chat/draft'
import { formatKwh } from './format'
import { ANNUAL_CONSUMPTION_KWH_KEY } from './standard-profile'

/**
 * B24, Teil 1 — DIE GELESENEN RECHNUNGEN EINES ZÄHLPUNKTS, reine Hälfte.
 *
 * REIN: kein `server-only`, kein `next/*`, kein Supabase-Client. Wie bei `standard-profile.ts` ist
 * das keine Stilfrage — die Server Action SCHREIBT die Einträge, die Station ZEIGT sie, und beide
 * müssen dieselbe Auslegung benutzen. Zwei Fassungen liefen beim nächsten Umbau auseinander, und
 * der Fehlschlag wäre still: die Station zeigte „noch keine Rechnung gelesen", während die
 * zusammengeführten Werte längst im Entwurf stehen. Dazu prüft `apps/web` `lib/**` — was hier
 * steht, ist der Teil dieser Station, der sich ohne Browser messen lässt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ EIN ZWEITER SEITENEINTRAG IM ENTWURF, NACH DEM VORBILD VON `_provenance`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der Entwurf (`platform.metering_points.draft`) wird gegen `tariffParamsSchema` geprüft, sobald er
 * die Engine erreicht. Ein Array gelesener Rechnungen ist dort KEIN Feld — es steht deshalb unter
 * einem eigenen Schlüssel daneben, genau wie die Herkunftsvermerke (`DRAFT_PROVENANCE_KEY` in
 * `lib/project-chat/draft.ts`). Das trägt aus demselben Grund: `tariffParamsSchema` ist ein
 * gewöhnliches `z.object` OHNE `.strict()` — zod entfernt unbekannte Schlüssel beim Auswerten und
 * meldet keinen Fehler (in `draft.test.ts` gemessen, nicht angenommen).
 *
 * ⚠ AUFLAGE, wortgleich zur dortigen: der Schlüssel darf nie zu einem Contract-Feldnamen werden.
 * `invoiceExtractionsKeyCollidesWithContract()` macht daraus eine Prüfung statt einer Hoffnung.
 *
 * ── ⚠ WARUM DIE EINZELNEN EXTRAKTIONEN ÜBERHAUPT AUFBEWAHRT WERDEN ────────────────────────────
 * Der Aufruf ist WIEDERHOLBAR: eine zweite Rechnung kommt zu den bestehenden dazu. Die Regel aus
 * `mergeInvoiceExtractions` („Einigkeit übernimmt, Widerspruch bleibt leer") braucht dafür ALLE
 * bisher gelesenen Rechnungen — aus dem zusammengeführten Stand allein liesse sie sich nicht
 * fortschreiben. Nur den Merge zu speichern hiesse: die zweite Rechnung bestätigt oder widerlegt
 * einen Wert, und niemand könnte mehr sagen, auf welchen Dokumenten er beruhte.
 *
 * ── WAS HIER NICHT STEHT ──────────────────────────────────────────────────────────────────────
 * Der ABRECHNUNGSZEITRAUM der einzelnen Rechnungen reist in den Einträgen mit (er ist Teil von
 * `InvoiceExtraction`), wird aber von dieser Station weder verglichen noch angezeigt. Der Abgleich
 * gegen den Lastgang-Zeitraum ist `check_data_consistency` bzw. der KI-Check — eine zweite,
 * daneben laufende Prüfung wäre eine zweite Wahrheit über dieselbe Frage.
 */
export const DRAFT_INVOICE_EXTRACTIONS_KEY = '_invoiceExtractions'

/**
 * Wie viele Rechnungen ein Vorgang entgegennimmt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ EINE KOSTENBREMSE, KEINE BEDIENHILFE — jede Datei ist genau EIN abrechenbarer Modellaufruf
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Dieselbe Zahl wie `MAX_ATTACHED_DOCUMENTS_PER_TURN` im Chat (`lib/project-chat/chat.ts`) und aus
 * demselben Grund: sie entspricht der Grössenordnung eines realen Anlasses — zwölf Monatsrechnungen
 * statt einer Jahresrechnung (Delta §3.2). Mehr ist kein Fehler des Admins; der Vorgang ist
 * wiederholbar, die übrigen Dateien kommen im nächsten dazu.
 *
 * ⚠ SIE STEHT HIER UND NICHT IN DER ACTION, weil sie drei Leser hat: die Action prüft sie, die
 * Station nennt sie am Feld, und der Test misst beide gegen dieselbe Zahl. In einer
 * `'use server'`-Datei kann sie gar nicht stehen — dort sind nur async Funktionen exportierbar
 * (`lib/use-server-exports.test.ts`).
 *
 * ⚠ ZWEITE, DAVON UNABHÄNGIGE GRENZE, die keine Prüfung im Anwendungscode erreichen kann:
 * `bodySizeLimit` (24 MB, `next.config.mjs`) begrenzt den GESAMTEN Rumpf einer Server Action, und
 * die Plattform schneidet ihn ab, BEVOR eine Zeile davon läuft. Zwölf Rechnungen üblicher Grösse
 * liegen weit darunter, zwölf hochauflösende Scans zu je 6 MB nicht.
 */
export const MAX_INVOICES_PER_UPLOAD = 12

/** Eine gelesene Rechnung: das abgelegte Dokument, sein Name und das, was daraus gelesen wurde. */
export type StoredInvoiceExtraction = {
  /** Die Kennung in `platform.project_documents` — der Bezug zur abgelegten Datei. */
  documentId: string
  /**
   * Der Dateiname, wie der Admin ihn hochgeladen hat.
   *
   * Denormalisiert und ausdrücklich nicht über `documentId` nachgeschlagen: die Station zeigt die
   * Liste bei JEDEM Rendern, und ein zweiter Wrapper-Aufruf dafür wäre ein Roundtrip für eine
   * Zeichenkette, die sich nie ändert. Dieselbe Überlegung wie bei `analyses.customer_label`.
   */
  filename: string
  extraction: InvoiceExtraction
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/**
 * Liest die gelesenen Rechnungen aus einem Entwurf. Ein fehlender oder kaputter Seiteneintrag
 * ergibt `[]`.
 *
 * ⚠ DEFENSIV WIE JEDER `jsonb`-LESER DIESES REPOS. Der Typ ist eine Behauptung über das, was die
 * Action einmal geschrieben hat; die Spalte nimmt alles an. Ein Eintrag ohne Kennung oder Namen
 * wird ÜBERSPRUNGEN statt mit einem Platzhalter gefüllt — „Rechnung —" in der Liste sähe aus wie
 * ein gelesenes Dokument und wäre keines.
 *
 * Die Extraktion selbst läuft durch `parseInvoiceExtraction`: dieselbe fail-closed-Auswertung, die
 * auch die Modellantwort nimmt. Sie wirft nie und rettet nie — was nicht als sauberer Wert
 * ankommt, ist `null`. Damit kann ein von Hand verändertes `jsonb` hier keinen Wert erfinden.
 */
export function readStoredInvoiceExtractions(
  draft: Record<string, unknown>,
): StoredInvoiceExtraction[] {
  const raw = draft[DRAFT_INVOICE_EXTRACTIONS_KEY]
  if (!Array.isArray(raw)) return []

  const rows: StoredInvoiceExtraction[] = []
  for (const entry of raw) {
    const row = asObject(entry)
    const documentId = row?.documentId
    const filename = row?.filename
    if (typeof documentId !== 'string' || documentId === '') continue
    if (typeof filename !== 'string' || filename.trim() === '') continue
    rows.push({
      documentId,
      filename: filename.trim(),
      extraction: parseInvoiceExtraction(row?.extraction),
    })
  }
  return rows
}

/**
 * Setzt den Seiteneintrag. Reine Funktion — sie gibt einen neuen Entwurf zurück.
 *
 * ⚠ Der Wrapper `update_metering_point_draft` ERSETZT den Entwurf, er verschmilzt ihn nicht. Der
 * Aufrufer muss also den vollständigen, FRISCH gelesenen Entwurf hineingeben; dieselbe Auflage wie
 * bei `setDraftField`, und aus demselben Grund (eine flache Verschmelzung könnte einen Schlüssel
 * nie wieder entfernen).
 */
export function withStoredInvoiceExtractions(
  draft: Record<string, unknown>,
  entries: readonly StoredInvoiceExtraction[],
): Record<string, unknown> {
  return { ...draft, [DRAFT_INVOICE_EXTRACTIONS_KEY]: entries }
}

/**
 * Die Merge-Felder, die in den Entwurf geschrieben werden — alle ausser `netzbetreiber`.
 *
 * ⚠ `netzbetreiber` IST KEIN `tariffParamsSchema`-FELD und wird deshalb NICHT eingetragen. Es
 * bleibt in den einzelnen Einträgen sichtbar (und in der Zusammenfassung der Station), geht aber
 * nicht in den Entwurf: dort stünde es unter `unknown_fields` und behauptete eine Angabe, die der
 * Contract gar nicht kennt. Welcher Netzbetreiber zuständig ist, entscheidet der Tarif-Schritt.
 */
export const INVOICE_DRAFT_FIELD_KEYS: readonly InvoiceMergeFieldKey[] =
  INVOICE_MERGE_FIELD_KEYS.filter((key) => key !== 'netzbetreiber')

/** Ein Wert, fertig für `setDraftField` — Feldname im Entwurf und der Wert in Contract-Form. */
export type InvoiceDraftValue = { field: string; value: DraftValue }

/**
 * Der Feldname im Entwurf.
 *
 * ⚠ NEUN DER ZEHN HEISSEN IM CONTRACT GENAUSO; der Jahresverbrauch hat im Repo bereits eine
 * benannte Konstante, weil ihn der Standardprofil-Zweig unter demselben Schlüssel schreibt
 * (`ANNUAL_CONSUMPTION_KWH_KEY`). Sie wird hier BENUTZT statt ein zweites Mal ausgeschrieben: die
 * beiden Wege füllen dasselbe Feld, und ein Auseinanderlaufen wäre still — die Station zeigte
 * dauerhaft „kein Jahresverbrauch hinterlegt", während der Wert daneben im Entwurf steht.
 */
export function draftFieldFor(key: InvoiceMergeFieldKey): string {
  return key === 'annualConsumptionKwh' ? ANNUAL_CONSUMPTION_KWH_KEY : key
}

/**
 * Die Netzebene, wie sie im Contract steht.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DAS EINZIGE FELD, DAS UMGEFORMT WIRD — und ohne die Umformung wäre der Entwurf UNGÜLTIG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der Rechnungs-Scan liefert die Netzebene als ZAHL (`InvoiceScanNetzebene = 3|4|5|6|7`);
 * `tariffParamsSchema.netzebene` ist dagegen `z.string().optional()` (dort als „Metadatum"
 * kommentiert). Eine Zahl dort eingetragen ist kein Tippfehler, sondern ein SCHEMA-VERSTOSS: die
 * Vollständigkeitsprüfung (`checkDraftCompleteness`) meldete sie dauerhaft unter `invalid`, und
 * `complete` wäre für jeden Zählpunkt, dessen Rechnung gelesen wurde, unerreichbar — bei einem
 * Feld, das an keiner Rechnung beteiligt ist. Der Fehlschlag wäre still: gespeichert würde die
 * Zahl trotzdem.
 *
 * Geschrieben wird deshalb `NE 5` und nicht `5`. Das ist das Format, in dem der EINZIGE bisherige
 * Erzeuger dieses Feldes es schreibt (`apps/website/components/flow/step-tariff.tsx`,
 * `tariffInput.netzebene = ` + „NE ${netzebene}"). Eine zweite Schreibweise daneben wäre genau
 * die Doppelung, die dieses Repo sonst vermeidet — und das Feld wird nirgends zurückgelesen
 * (gemessen: `packages/engine` kennt es gar nicht, der Rechner zeigt es nur an).
 */
export function netzebeneDraftValue(value: string | number): string {
  return `NE ${value}`
}

/**
 * Die Werte des zusammengeführten Standes, fertig zum Eintragen.
 *
 * Ein Feld ohne Wert erscheint gar nicht — weder als `null` noch als Platzhalter. Der Entwurf ist
 * eine Sammlung von Angaben, und „dazu sagt keine der Rechnungen etwas" ist keine.
 *
 * ⚠ EIN WIDERSPRUCH ERSCHEINT DAMIT EBENFALLS NICHT: `mergeInvoiceExtractions` setzt das Feld in
 * diesem Fall auf `null`. Ein zuvor übernommener Wert bleibt dadurch im Entwurf STEHEN — er wird
 * nicht entfernt. Das ist Absicht und die schonendere Richtung (der Wert kann inzwischen von Hand
 * korrigiert worden sein); damit es niemandem entgeht, nennt die Station den Widerspruch
 * ausdrücklich und weist auf den stehengebliebenen Wert hin.
 */
export function invoiceDraftValues(merged: InvoiceExtraction): InvoiceDraftValue[] {
  const values: InvoiceDraftValue[] = []
  for (const key of INVOICE_DRAFT_FIELD_KEYS) {
    const raw = mergeFieldValue(merged, key)
    if (raw === null) continue
    values.push({
      field: draftFieldFor(key),
      value: key === 'netzebene' ? netzebeneDraftValue(raw) : raw,
    })
  }
  return values
}

/** Liest ein Merge-Feld aus einer Extraktion, egal ob es im Kopf oder unter `rates` steht. */
function mergeFieldValue(
  extraction: InvoiceExtraction,
  key: InvoiceMergeFieldKey,
): string | number | null {
  if (key === 'netzbetreiber') return extraction.netzbetreiber
  if (key === 'netzebene') return extraction.netzebene
  if (key === 'meteringVariant') return extraction.meteringVariant
  if (key === 'annualConsumptionKwh') return extraction.annualConsumptionKwh
  return extraction.rates[key]
}

/**
 * Die Einheit hinter einem Betrag.
 *
 * Sie steht hier und nicht in der Komponente, weil ein Betrag ohne Einheit keine Angabe ist:
 * „Leistungspreis 82,92" und „Arbeitspreis 82,92" wären dieselbe Zeile, meinten aber €/kW·Jahr
 * gegen ct/kWh. Die vier Kopffelder tragen keine — sie sind keine Beträge.
 */
const FIELD_UNITS: Partial<Record<InvoiceMergeFieldKey, string>> = {
  leistungspreisEurPerKwYear: '€ / kW und Jahr',
  minBillableKw: 'kW',
  arbeitspreisNetzCtPerKwh: 'ct/kWh',
  energyPriceCtPerKwh: 'ct/kWh',
  energyPriceNightCtPerKwh: 'ct/kWh',
  einspeiseverguetungCtPerKwh: 'ct/kWh',
  supplierBaseFeeEurPerMonth: '€ / Monat',
}

const AMOUNT = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 3 })

/** Ein Feld des zusammengeführten Standes, fertig für die Anzeige. */
export type InvoiceMergeDisplayRow = { key: InvoiceMergeFieldKey; label: string; text: string }

/**
 * Was aus allen gelesenen Rechnungen übereinstimmend hervorgeht — fertig formatiert.
 *
 * Felder ohne Wert erscheinen NICHT. Eine Liste mit zehn „—" sähe aus, als wäre der Scan
 * gescheitert; tatsächlich sagt eine Rechnung typischerweise zu drei oder vier Feldern etwas.
 *
 * ⚠ `netzbetreiber` IST dabei — anders als beim Schreiben. Er wurde gelesen, und ihn zu verschweigen
 * nur weil der Contract ihn nicht kennt, machte die Anzeige zu einer Aussage über unseren
 * Datentyp statt über die Rechnung.
 */
export function invoiceMergeDisplayRows(merged: InvoiceExtraction): InvoiceMergeDisplayRow[] {
  const rows: InvoiceMergeDisplayRow[] = []
  for (const key of INVOICE_MERGE_FIELD_KEYS) {
    const raw = mergeFieldValue(merged, key)
    if (raw === null) continue
    rows.push({ key, label: INVOICE_MERGE_FIELD_LABELS[key], text: displayValue(key, raw) })
  }
  return rows
}

function displayValue(key: InvoiceMergeFieldKey, raw: string | number): string {
  if (key === 'netzbetreiber') {
    return NETZBETREIBER_LABELS[raw as keyof typeof NETZBETREIBER_LABELS] ?? String(raw)
  }
  if (key === 'netzebene') return `Netzebene ${raw}`
  if (key === 'meteringVariant') {
    return METERING_VARIANT_LABELS[raw as keyof typeof METERING_VARIANT_LABELS] ?? String(raw)
  }
  if (key === 'annualConsumptionKwh') return formatKwh(typeof raw === 'number' ? raw : null)

  const unit = FIELD_UNITS[key]
  const amount = typeof raw === 'number' ? AMOUNT.format(raw) : String(raw)
  return unit ? `${amount} ${unit}` : amount
}

/** Die Anzeigenamen widersprüchlicher Felder — dieselbe Liste, dieselben Bezeichnungen. */
export function invoiceConflictLabels(conflicts: readonly InvoiceMergeFieldKey[]): string[] {
  return conflicts.map((key) => INVOICE_MERGE_FIELD_LABELS[key])
}

/**
 * ⚠ Der Seiteneintrag darf keinen Contract-Feldnamen verdecken. Als Funktion statt als Kommentar,
 * damit der Test sie gegen die echten Schlüssel laufen lassen kann — wortgleich zur Vorkehrung bei
 * `_provenance`.
 */
export function invoiceExtractionsKeyCollidesWithContract(): boolean {
  return DRAFT_INVOICE_EXTRACTIONS_KEY in tariffParamsSchema.shape
}
