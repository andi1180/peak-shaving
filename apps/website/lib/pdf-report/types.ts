import type { AnalysisResult } from 'shared'

/**
 * B23a/B23c-1 — Eingangsgrössen des react-pdf-Reports.
 *
 * Deckblatt, Untertitel und Zeitraum kommen als fertige Zeichenketten herein; ihre Ableitung
 * steht in `derive.ts` und ist damit für sich lesbar, statt im Rendern zu verschwinden.
 *
 * ── ⚠ B23c-1: DAS ERGEBNIS KOMMT ALS SCHMALE TEILMENGE, NICHT ALS GANZER CONTRACT ──────────────
 * `PdfReportAnalysis` ist ein `Pick<AnalysisResult, …>` über GENAU die sechs Felder, die die
 * Executive Summary tatsächlich liest — dasselbe Muster wie die `Pick<…>`-Parameter in
 * `derive.ts`, und aus demselben Grund. Der ganze Contract als Typ sagte „dieses Dokument könnte
 * alles daraus lesen"; die engere Signatur sagt, was es liest. Praktisch messbar wird der
 * Unterschied dort, wo ein Prüfstand oder ein künftiger Aufrufer die Seite fahren will: mit dem
 * ganzen Contract müsste er Felder erfinden, die niemand anfasst.
 *
 * ⚠ Der Typ wächst mit jedem Schritt, der eine weitere Karte übernimmt (B23c-2/3/4) — er wächst
 * dabei um die Felder, die die neue Darstellung LIEST, nicht auf den vollen Contract.
 * `dispatchTrace` etwa hängt bereits an `perBattery`/`existingBatteryAnalysis` und braucht keine
 * eigene Zeile.
 */
export type PdfReportAnalysis = Pick<
  AnalysisResult,
  | 'current'
  | 'perBattery'
  | 'recommendation'
  | 'assumptions'
  | 'tariffOptimization'
  | 'existingBatteryAnalysis'
>

/**
 * Der Kunde auf dem Deckblatt.
 *
 * Jedes Feld ist optional und wird NUR gerendert, wenn es einen Wert hat — dasselbe Muster wie
 * `print-cover.tsx`: ein sichtbar leeres Feld oder ein Platzhalterstrich auf einem Deckblatt sieht
 * aus wie ein Fehler beim Ausdrucken, nicht wie eine nicht gestellte Frage.
 */
export type PdfReportCustomer = {
  name?: string
  company?: string
  /**
   * Freitext, mehrzeilig. Rein für den Druck — die Adresse wird NICHT erfasst und NICHT
   * gespeichert; sie hat weder eine Spalte in `platform.leads` noch einen Parameter in
   * `capture_lead`. S. `report-gate-dialog.tsx`.
   */
  address?: string
}

export type PdfReportInput = {
  /** Vom Nutzer editierbar, vorbelegt aus `defaultReportTitle` (`derive.ts`). */
  title: string
  /** Abgeleitet, NICHT editierbar — `reportSubtitle` (`derive.ts`). */
  subtitle: string
  customer?: PdfReportCustomer
  /** Der ausgewertete Zeitraum, in Ortszeit formatiert. `null`, wenn der Lastgang leer ist. */
  period: string | null
  /** Erstellungsdatum, formatiert. Wird HEREINGEREICHT und nicht hier gelesen: eine Funktion, die
   *  selbst auf die Uhr sieht, lässt sich gegen keinen Stichtag prüfen. */
  printedAt: string
  /**
   * B23c-1 — das gerechnete Ergebnis, aus dem die Kernergebnis-Seite entsteht (`summary.ts`).
   *
   * PFLICHT und nicht optional: einen Report ohne Ergebnis gibt es nicht. Optional gemacht wäre
   * die Kernergebnis-Seite ein Zustand, den irgendein Aufrufer versehentlich herstellen kann —
   * und das Dokument trüge dann wieder die Platzhalter-Seite, die dieser Schritt gerade ersetzt.
   */
  analysis: PdfReportAnalysis
}
