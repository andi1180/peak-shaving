import type { LoadProfile } from 'shared'

import { formatKw, formatKwh, formatPercent } from '@/lib/format'
import type { ReportRow, ReportStatement } from './statement'
import type { PdfReportAnalysis } from './types'

/**
 * Der Kennzahlenblock unter dem Lastgang-Diagramm (22.09.2026).
 *
 * ── ⚠ ES GAB BIS HIERHER KEINE ABLEITUNG ZU DIESEM KAPITEL, UND DAS WAR RICHTIG ────────────────
 * Auf der Seite stand nur das Bild und eine Bildunterschrift; nichts hing an der Datenlage
 * (s. den Kopf von `LoadChapter` in `document.tsx`). Mit den drei Kennzahlen hängt jetzt etwas
 * daran — sie entstehen deshalb hier und nicht im JSX, wie bei den übrigen Kapiteln auch.
 *
 * ── ⚠ KEINE NEUE DATENQUELLE, UND DAS IST DER GANZE ZUSCHNITT ─────────────────────────────────
 * Alle drei Werte stammen aus Zahlen, die dieses Dokument ohnehin schon trägt: die
 * Viertelstundenwerte des Lastgangs (`loadProfile.readings`), die gemessenen Tage
 * (`dataQuality.coveredDays`) und die Spitze, die das Kapitel „Voraussetzungen" als „Höchste
 * gemessene Verbrauchsspitze" ausweist (`current.annualPeakKw`, `prerequisites.ts`). Die Spitze
 * wird ausdrücklich WIEDERVERWENDET und nicht neu über die Reihe gebildet: zwei Maxima derselben
 * Kurve, getrennt gerechnet, wären zwei Zahlen, die im selben Dokument auseinanderlaufen können —
 * und die eine trägt den Leistungspreis.
 *
 * ── ⚠ GEZÄHLT WIRD NUR DER BEZUG ──────────────────────────────────────────────────────────────
 * `gridPowerKw` ist signiert (+ Bezug, − Einspeisung). Die negative Hälfte mitzusummieren ergäbe
 * einen NETTO-Wert, der neben einer Bezugs-Spitze stünde und den Lastfaktor kleinrechnete. Dieselbe
 * Lesart wie `positiveAnnualPeakKw` in der Engine, aus der die Spitze daneben kommt.
 */
export type LoadMetrics = ReportStatement

/** Der Lastfaktor in Worten — die DEFINITION, nicht ihre Anwendung auf diesen Kunden. */
const LOAD_FACTOR_BODY =
  'Der Lastfaktor setzt Ihre durchschnittliche Leistung ins Verhältnis zu Ihrer höchsten. Ein ' +
  'niedriger Wert steht für einen spitzigen Verlauf — kurze, hohe Ausschläge über einem ruhigen ' +
  'Grundverbrauch. Ein hoher Wert steht für einen gleichmässigen Verlauf, bei dem die Spitze nicht ' +
  'weit über dem Durchschnitt liegt.'

function neutralRow(label: string, value: string): ReportRow {
  return { label, value, tone: 'neutral' }
}

/** Die bezogene Energiemenge über den ganzen Lastgang, in kWh. */
export function totalGridImportKwh(loadProfile: LoadProfile): number {
  const hours = loadProfile.intervalMinutes / 60
  let kwh = 0
  for (const reading of loadProfile.readings) {
    if (reading.gridPowerKw > 0) kwh += reading.gridPowerKw * hours
  }
  return kwh
}

/**
 * Ø Leistung ÷ Spitzenleistung, in Prozent — oder `null`, wo eine der beiden Grössen fehlt.
 *
 * ⚠ `null` statt einer 0: ohne gemessene Tage oder ohne Spitze gibt es keinen Lastfaktor, und eine
 * 0 % behauptete einen maximal spitzigen Verlauf, wo gar nichts gemessen wurde.
 */
export function loadFactorPercent(
  totalKwh: number,
  coveredDays: number,
  peakKw: number,
): number | null {
  if (coveredDays <= 0 || peakKw <= 0) return null
  return ((totalKwh / (coveredDays * 24)) / peakKw) * 100
}

/**
 * Der Block unter dem Bild — oder `null` ohne gemessene Tage.
 *
 * ⚠ `null` und kein Block mit Strichen: ein leerer Lastgang liefert keinen Durchschnitt, und drei
 * Platzhalter unter einem Diagramm sähen aus wie ein Fehler beim Erzeugen.
 */
export function buildLoadMetrics(
  loadProfile: LoadProfile,
  analysis: Pick<PdfReportAnalysis, 'current' | 'dataQuality'>,
): LoadMetrics | null {
  const coveredDays = analysis.dataQuality.coveredDays
  if (coveredDays <= 0) return null

  const totalKwh = totalGridImportKwh(loadProfile)
  const factor = loadFactorPercent(totalKwh, coveredDays, analysis.current.annualPeakKw)

  const rows = [
    neutralRow('Gesamtverbrauch über den Zeitraum', formatKwh(totalKwh)),
    neutralRow('Ø Tagesverbrauch', `${formatKwh(totalKwh / coveredDays)} / Tag`),
    ...(factor === null
      ? []
      : [
          {
            ...neutralRow('Lastfaktor', formatPercent(factor)),
            hint: `Ø Leistung im Verhältnis zur Spitze von ${formatKw(analysis.current.annualPeakKw)}`,
          },
        ]),
  ]

  return {
    id: 'load_metrics',
    title: 'Ihr Verbrauch in Zahlen',
    amount: null,
    rows,
    /* ⚠ Ohne Lastfaktor auch ohne seine Erklärung — sonst erklärte der Absatz eine Zeile, die
       nicht dasteht. */
    body: factor === null ? '' : LOAD_FACTOR_BODY,
  }
}
