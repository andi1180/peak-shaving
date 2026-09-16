import type {
  CalculatorPayload as EngineCalculatorPayload,
  TariffResult as EngineTariffResult,
} from 'engine'
import type {
  FinancialParams,
  InvoiceExtraction,
  TariffParams,
  TariffSelection,
} from 'shared'
import type { BatteryOverride } from '@/lib/analysis-protocol'

/*
 * D3 (16.09.2026): die Nutzlast-Typen des Rechners wohnen seit dem Umzug von `computeAnalysis`
 * in `packages/engine` — sie beschreiben, was die Rechenkette entgegennimmt, und gehören deshalb
 * zu ihr. Sie werden hier weiter-exportiert, damit jede bestehende Importstelle in `apps/website`
 * unverändert bleibt; eine zweite Definition daneben liefe beim nächsten Contract-Umbau
 * auseinander.
 */
export type { EstimatedPvResult, ExistingBatteryInput, ParsedLoad, ParsedPv } from 'engine'

/**
 * B11: welcher Tarifsatz-Stand die Werte vorbelegt hat, samt der Vorgabewerte von damals.
 * `undefined`, wenn kein Netzbetreiber gewählt wurde — dann kommen die Werte direkt aus der
 * Netzrechnung, und genau das soll später unterscheidbar bleiben.
 *
 * ⚠ Genau dieses eine Feld bleibt app-lokal und wird an die Engine-Typen ANGEHÄNGT: es reist in den
 * Report und ins Analyse-Bündel, nie in die Rechnung — und sein Typ gehört der Tarifsatz-
 * Datenschicht, die `packages/engine` nicht kennen darf (`tariff/no-catalog-dependency.test.ts`).
 */
type WithTariffSelection = { tariffSelection?: TariffSelection }

export type TariffResult = EngineTariffResult & WithTariffSelection
export type CalculatorPayload = EngineCalculatorPayload & WithTariffSelection

/**
 * Delta 8 / 9b-2b — was ein Rechnungs-Scan aus Schritt 1 in Schritt 2 mitnimmt.
 *
 * ── ⚠ `annualConsumptionKwh` FEHLT HIER, UND ZWAR ABSICHTLICH ──────────────────────────────────
 * Der Jahresverbrauch wird bereits in Schritt 1 verbraucht: er ist der Eingang in
 * `generateStandardLoadProfile` (9b-1) und wird dort zum `LoadProfile`. Reiste er zusätzlich nach
 * Schritt 2 mit, gäbe es ihn zweimal — und der zweite Weg wäre genau der „dritte Rechenweg", den
 * Delta 8 ausschliesst. Der `Pick` sagt das im Typ, statt es einem Kommentar zu überlassen.
 *
 * ── ⚠ EIN GELESENES FELD HAT HEUTE KEIN ZIEL: `rates.arbeitspreisNetzCtPerKwh` ────────────────
 * Der Netznutzungs-Arbeitspreis hat in Schritt 2 kein Eingabefeld — er kommt seit B21-3b aus
 * `public.grid_tariffs`, nicht aus dem Formular. Er wird deshalb gelesen und NICHT gesetzt. Das
 * ist keine Lücke dieses Schritts, sondern die Folge davon, dass die Netzentgelt-Seite eine
 * gepflegte Datenquelle ist und keine Nutzereingabe. Wer dafür je ein Feld baut, findet den Wert
 * hier bereits vor.
 *
 * ── DIE GRUNDGEBÜHR DES LIEFERANTEN REIST OHNE EIGENEN EINTRAG MIT ────────────────────────────
 * `rates.supplierBaseFeeEurPerMonth` (Delta 19 / §3.7.3) ist Teil von `rates` und damit vom `Pick`
 * bereits erfasst — es war hier keine Zeile zu ergänzen. Das ist der Grund, warum das Feld in
 * `InvoiceScanRates` steht und nicht als siebtes Feld neben `rates`: Schema, Auswertung, die
 * Vollständigkeitsprüfung (`invoiceExtractionIsEmpty`) und dieser Weg hierher laufen alle über
 * `INVOICE_SCAN_RATE_KEYS`. Ihr Ziel ist Schicht 3 in `buildInitialTariffState` (step-tariff.tsx).
 */
export type TariffPrefill = Pick<
  InvoiceExtraction,
  'netzbetreiber' | 'netzebene' | 'meteringVariant' | 'rates'
>

// Vom editierbaren Annahmen-Panel (§6.2) nach oben gereichte, vollständige Eingabe für eine
// Live-Neuberechnung — `tariff`/`financial` sind bereits mit den editierten Feldern gemergte
// Kopien der Originalwerte (nur `billingModel` bzw. Förderung/Steuer/Abschreibung editierbar,
// s. CLAUDE.md „NICHT: Entladetiefe"-Vermerk zur bewussten Auslassung).
export type RecomputeInput = {
  tariff: TariffParams
  financial?: FinancialParams
  horizonYears: number
  batteryOverride?: BatteryOverride
}
