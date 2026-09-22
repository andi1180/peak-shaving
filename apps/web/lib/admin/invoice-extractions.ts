import {
  INVOICE_MERGE_FIELD_KEYS,
  INVOICE_MERGE_FIELD_LABELS,
  METERING_VARIANTS,
  METERING_VARIANT_LABELS,
  NETZBETREIBER_DRAFT_KEY,
  NETZBETREIBER_IDS,
  NETZBETREIBER_LABELS,
  NETZEBENEN,
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

/**
 * „Für diesen Zählpunkt gibt es bewusst keine Tarifangabe."
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ EIN DRITTES SIGNAL NEBEN UPLOAD UND HANDEINGABE — und es beantwortet eine andere Frage
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bis hierher kannte diese Station genau zwei Zustände, und beide sind AUSSAGEN über Werte: es
 * wurden Rechnungen gelesen (`DRAFT_INVOICE_EXTRACTIONS_KEY` + die übernommenen Felder), oder es
 * wurden welche von Hand eingetippt. Was fehlte, ist die dritte, ebenso legitime Antwort: „wir
 * haben keine und bekommen keine" — der Anschluss ist neu, die Rechnung liegt beim Steuerberater,
 * oder der Kunde will sie schlicht nicht herausgeben.
 *
 * Ohne dieses Feld ist dieser Fall von „die Station wurde noch nicht besucht" NICHT zu
 * unterscheiden: beide sehen im Entwurf identisch aus (kein Eintrag, keine Tarifwerte). Genau
 * diese Unterscheidung ist aber die, auf die es später ankommt — ein fehlender Tarif ist eine
 * LÜCKE, die der KI-Check benennen muss; ein ausdrücklich übersprungener ist eine ENTSCHEIDUNG,
 * die er nicht erneut aufwerfen soll. Dieselbe Trennlinie, die `hasPv`/`hasBattery` für ihre
 * Stationen ziehen (`pv-draft.ts`, `battery-draft.ts`).
 *
 * ⚠ BOOLEAN, und das ist hier ausnahmsweise die unproblematische Wahl: bei den Beträgen ist
 * `Number('')` gleich `0` und damit ein still erfundener Wert (s. `readManualNumber`); `false` ist
 * dagegen eindeutig und entsteht nie versehentlich — es steht im Entwurf ausschliesslich dort, wo
 * es ein Schreibweg ausdrücklich hingeschrieben hat.
 *
 * ── ⚠ ES IST KEIN `tariffParamsSchema`-FELD, UND DAS IST IN ORDNUNG ───────────────────────────
 * Wortgleich zu `hasPv`: der Entwurf ist eine Sammlung von Angaben, nicht das Contract-Objekt
 * selbst; `tariffParamsSchema` ist ein `z.object` OHNE `.strict()`, zod entfernt unbekannte
 * Schlüssel beim Auswerten und meldet keinen Fehler. Folge: `check_draft_completeness` führt das
 * Feld als `unknown_field` — es zählt nicht zur Vollständigkeit des Tarif-Contracts, und das ist
 * richtig: es IST keine Tarifangabe, es ist die Aussage, dass keine kommt.
 *
 * ── ⚠ ES WIRD VON BEIDEN RICHTUNGEN GESCHRIEBEN ──────────────────────────────────────────────
 * `true` vom Überspringen-Weg, `false` von jedem erfolgreichen Upload UND von der Handeingabe (s.
 * dort). Ein späterer echter Beleg WIDERLEGT die frühere Entscheidung; ohne das Zurücksetzen
 * stünden beide Angaben gleichzeitig im Entwurf, und ein späterer Leser müsste raten, welche gilt.
 */
export const INVOICE_SKIPPED_KEY = 'invoiceSkipped'

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
 * Die Merge-Felder, die in den Entwurf geschrieben werden — seit dem 16.09.2026 ALLE.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ `netzbetreiber` STAND HIER BIS DAHIN AUSDRÜCKLICH NICHT DRIN, UND DIE BEGRÜNDUNG WAR DER FEHLER
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Sie lautete: er sei kein `tariffParamsSchema`-Feld und stünde im Entwurf nur als ungeprüfter
 * Schlüssel. Das galt, solange der Entwurf ausschliesslich als GANZES gegen den Contract geprüft
 * wurde. Seit D3 liest ihn eine benannte Abbildung unter einem benannten Schlüssel
 * (`NETZBETREIBER_DRAFT_KEY`, `shared`), die Handeingabe schreibt ihn seither, und
 * `report-render-actions.ts` liest genau diesen Schlüssel.
 *
 * Die Folge der alten Regel war still und genau die teure Sorte: die Station ZEIGTE „Wiener Netze"
 * (die Anzeige führt den Wert seit jeher, s. `invoiceMergeDisplayRows`), der Entwurf trug ihn
 * nicht, und ein Report nach einem reinen Rechnungs-Scan ging mit `netzbetreiber: null` heraus —
 * ohne dass irgendwo etwas fehlschlug.
 */
export const INVOICE_DRAFT_FIELD_KEYS: readonly InvoiceMergeFieldKey[] = INVOICE_MERGE_FIELD_KEYS

/** Ist der gelesene Betreiber eine der Kennungen, die auch die Handeingabe zur Auswahl stellt? */
function isKnownNetzbetreiber(value: string | number): boolean {
  return (NETZBETREIBER_IDS as readonly string[]).includes(String(value))
}

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
  if (key === 'annualConsumptionKwh') return ANNUAL_CONSUMPTION_KWH_KEY
  // Heute dieselbe Zeichenkette — über die Konstante, damit es das auch nach einer Umbenennung in
  // `shared` bleibt. Denselben Schlüssel schreibt die Handeingabe und liest der Report.
  if (key === 'netzbetreiber') return NETZBETREIBER_DRAFT_KEY
  return key
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
    /*
     * ⚠ NUR EINE BEKANNTE KENNUNG WIRD ÜBERNOMMEN, und es wird NICHTS zugeordnet. Der Scan liefert
     * den Betreiber bereits als Aufzählungswert (`parseInvoiceExtraction` → `oneOf`), diese Prüfung
     * ist die zweite, örtliche Absicherung derselben Zusage: was der Handeingabe-Auswahl nicht
     * entspricht, bleibt weg. Einen Freitextnamen auf eine der drei Kennungen zu raten wäre eine
     * eigene Entscheidung — und eine falsch geratene Zuständigkeit sähe im Report aus wie eine
     * abgelesene.
     */
    if (key === 'netzbetreiber' && !isKnownNetzbetreiber(raw)) continue
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
 * ⚠ `netzbetreiber` IST dabei — seit dem 16.09.2026 genau wie beim Schreiben. Bis dahin zeigte
 * diese Liste ihn als einziges Feld, das der Entwurf nicht bekam; das war der Fehler, nicht die
 * Anzeige (s. `INVOICE_DRAFT_FIELD_KEYS`).
 */
export function invoiceMergeDisplayRows(merged: InvoiceExtraction): InvoiceMergeDisplayRow[] {
  const rows: InvoiceMergeDisplayRow[] = []
  for (const key of INVOICE_MERGE_FIELD_KEYS) {
    const raw = mergeFieldValue(merged, key)
    if (raw === null) continue
    const note = key === 'energyPriceCtPerKwh' ? energyPriceNote(merged.energyPriceBasis) : ''
    rows.push({
      key,
      label: INVOICE_MERGE_FIELD_LABELS[key],
      text: `${displayValue(key, raw)}${note}`,
    })
  }
  return rows
}

/**
 * Der Zusatz hinter dem Arbeitspreis eines VARIABLEN Tarifs.
 *
 * ⚠ Er steht da, weil die Zahl bei einem solchen Tarif nicht mehr auf der Rechnung zu finden ist:
 * sie ist der verbrauchsgewichtete Schnitt über deren Monatszeilen (`invoice-scan.ts`). Wer den
 * Wert gegenprüfen will, sucht ihn sonst vergeblich und hält ihn für falsch abgelesen. Beim
 * gewöhnlichen Tarif mit einem Satz (`stated`) bleibt die Zeile unverändert ohne Zusatz.
 */
function energyPriceNote(basis: InvoiceExtraction['energyPriceBasis']): string {
  if (basis === 'weighted') return ' (verbrauchsgewichteter Schnitt der Monatszeilen)'
  if (basis === 'weighted_unverified') {
    return ' (verbrauchsgewichteter Schnitt der Monatszeilen — Gesamtverbrauch nicht gegengeprüft)'
  }
  return ''
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

/**
 * Die Tarifwerte, die die Handeingabe schreibt — in genau dieser Reihenfolge.
 *
 * ⚠ SIE STEHT HIER UND NICHT IN DER SERVER ACTION, obwohl die sie schreibt: `readManualTariffDraft`
 * darunter liest DIESELBEN Felder wieder heraus, und die Station befüllt ihr Formular daraus. Zwei
 * Listen liefen beim nächsten zusätzlichen Feld auseinander, und zwar still — gespeichert würde es,
 * angezeigt nicht, und die Station sähe für dieses eine Feld weiterhin leer aus. Ausserdem ist
 * `data-entry-actions-rechnung.ts` eine `'use server'`-Datei: dort sind nur asynchrone Funktionen
 * exportierbar, eine geteilte Konstante kann darin gar nicht wohnen.
 */
export const MANUAL_TARIFF_NUMBER_FIELDS = [
  'energyPriceCtPerKwh',
  'energyPriceNightCtPerKwh',
  'einspeiseverguetungCtPerKwh',
  'supplierBaseFeeEurPerMonth',
  'leistungspreisEurPerKwYear',
  'minBillableKw',
  'annualConsumptionKwh',
] as const satisfies readonly InvoiceMergeFieldKey[]

/** Der erfasste Stand eines Zählpunkts, fertig als Formularwerte der Handeingabe. */
export type ManualTariffDraft = {
  /** Die Kennung des Netzbetreibers, oder `''` — der leere Wert der Auswahl. */
  operatorId: string
  /** Die Netzebene als blosse Ziffer (`'7'`), wie das Auswahlfeld sie führt. */
  netzebene: string
  meteringVariant: string
  /** Die sieben Zahlenfelder als Eingabetext, Schlüssel wie im Formular. */
  numbers: Record<(typeof MANUAL_TARIFF_NUMBER_FIELDS)[number], string>
}

/**
 * Zahl → Formularwert. Deutsches Dezimalkomma, KEIN Tausendertrennzeichen.
 *
 * ⚠ Bewusst nicht über `Intl.NumberFormat('de-AT')` — dieselbe Regel und derselbe Grund wie bei
 * `formatBatteryNumber`: das setzt ab 1000 ein schmales geschütztes Leerzeichen, und
 * `readManualNumber` in der Server Action weist so etwas als unbrauchbar ab. Der wieder angezeigte
 * Wert wäre dann genau der, den das eigene Formular nicht mehr annimmt (der Jahresverbrauch liegt
 * immer über 1000).
 */
function manualNumberText(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  return String(value).replace('.', ',')
}

/**
 * Was zu diesem Zählpunkt bereits an Tarifwerten im Entwurf steht — damit die Handeingabe es
 * WIEDER ANZEIGT statt leer aufzumachen.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE GEGENRICHTUNG ZU `saveMeteringPointManualTariffAction`, UND SIE HAT GEFEHLT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Die Handeingabe schrieb ihre Werte in den Entwurf, las sie aber nie zurück: alle Felder starteten
 * auf `''`. Wer Werte eintrug, die Station verliess und zurückkam, stand vor einem leeren Formular
 * — und es gab in der ganzen Station keine zweite Stelle, die sie gezeigt hätte (`InvoiceSummary`
 * hängt an den gelesenen RECHNUNGEN, nicht am Entwurf). Gespeichert war alles; sichtbar nichts.
 *
 * ⚠ ES WIRD OHNE RÜCKSICHT AUF DIE HERKUNFT GELESEN. Ein Wert aus einem Rechnungs-Scan steht unter
 * denselben Schlüsseln und erscheint deshalb ebenfalls im Formular. Das ist richtig: das Formular
 * behauptet nicht „das haben Sie getippt", sondern zeigt den erfassten Stand dieses Zählpunkts —
 * und genau den soll korrigieren können, wer ihn korrigieren will (Prinzip 1: die Rechnung des
 * Kunden schlägt jede Tabelle, und dafür muss man den Wert sehen).
 *
 * ⚠ DIE NETZEBENE WIRD ZURÜCKGEFORMT. Im Entwurf steht `NE 7` (`netzebeneDraftValue`), das
 * Auswahlfeld führt `7`. Ohne die Rückformung fände `<select>` seine Option nicht und stünde auf
 * „— bitte wählen —", obwohl die Angabe da ist — und mit ihr verschwände auch die Messvariante,
 * deren Feld an der Netzebene hängt.
 */
export function readManualTariffDraft(draft: Record<string, unknown>): ManualTariffDraft {
  const operatorRaw = draft[NETZBETREIBER_DRAFT_KEY]
  const netzebeneRaw = draft.netzebene
  const variantRaw = draft.meteringVariant

  const numbers = {} as ManualTariffDraft['numbers']
  for (const key of MANUAL_TARIFF_NUMBER_FIELDS) {
    numbers[key] = manualNumberText(draft[draftFieldFor(key)])
  }

  return {
    operatorId:
      typeof operatorRaw === 'string' && isKnownNetzbetreiber(operatorRaw) ? operatorRaw : '',
    netzebene: readNetzebeneDigit(netzebeneRaw),
    /*
     * Nur eine der geführten Varianten — ein fremder Wert im `jsonb` liesse das Auswahlfeld sonst
     * auf „— bitte wählen —" stehen und wäre beim nächsten Speichern trotzdem mitgeschickt.
     */
    meteringVariant:
      typeof variantRaw === 'string' && (METERING_VARIANTS as readonly string[]).includes(variantRaw)
        ? variantRaw
        : '',
    numbers,
  }
}

/**
 * `NE 7` → `'7'`. Alles, was keine geführte Netzebene ergibt, wird zu `''` — geraten wird nicht,
 * und eine erfundene Ziffer fände im Auswahlfeld ohnehin keine Option.
 */
function readNetzebeneDigit(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const digits = raw.trim().replace(/^NE\s*/i, '')
  const value = Number(digits)
  return (NETZEBENEN as readonly number[]).includes(value) ? String(value) : ''
}

/** Steht überhaupt ein Tarifwert im Entwurf? Für die Station: die Handeingabe offen zeigen oder nicht. */
export function manualTariffDraftIsEmpty(values: ManualTariffDraft): boolean {
  return (
    values.operatorId === '' &&
    values.netzebene === '' &&
    values.meteringVariant === '' &&
    Object.values(values.numbers).every((text) => text === '')
  )
}
