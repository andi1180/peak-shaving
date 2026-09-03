/**
 * B23a — Eingangsgrössen des react-pdf-Reports.
 *
 * Bewusst KEIN `AnalysisResult` und KEIN `LoadProfile`: dieses Dokument rendert in B23a das
 * Gerüst (Deckblatt, Agenda, Methodik) und noch keine Kennzahl. Was es braucht, sind fertige
 * Zeichenketten — die Ableitung aus dem Contract steht in `derive.ts` und ist damit für sich
 * prüfbar, statt im Rendern zu verschwinden.
 *
 * B23c erweitert diesen Typ um das Ergebnis; die Trennung bleibt dieselbe.
 */

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
}
