import type {
  LoadProfile,
  MonthlyTariffComparison,
  TariffParams,
  TariffPricingInputs,
} from 'shared'

import { utcMsToLocalFields } from '../parser/datetime'
import { intervalHours } from './helpers'
import { combinedIntervalPrices } from './tou'

/*
 * Monatsvergleich „Ist-Tarif vs. aWATTar ohne Steuerung vs. aWATTar mit dem Speicher des Kunden"
 * (01.09.2026). Rein & deterministisch, kein I/O — beide Preisseiten kommen als PARAMETER herein
 * (`TariffPricingInputs`), genau wie beim kombinierten Intervallpreis selbst.
 *
 * ── ⚠ ES ENTSTEHT KEINE ZWEITE SIMULATION UND KEIN ZWEITER PREISWEG ────────────────────────────
 * Der Dispatch der bestehenden Anlage ist bereits gelaufen (`simulateBattery` im Worker); hier
 * kommt allein seine `gridAfterKw`-Reihe herein. Und BEIDE Preisreihen entstehen aus DERSELBEN
 * Funktion (`combinedIntervalPrices`) mit unterschiedlicher Energiepreis-Eingabe — die
 * Netzentgelt-Seite (Fensterzuordnung + Netzverlust-Sockel) ist damit bit-genau dieselbe. Eine
 * zweite Implementierung derselben Fensterlogik liefe beim nächsten Preisblatt-Ausbau auseinander,
 * und die ausgewiesene Differenz enthielte dann einen Anteil, der gar nicht am Strompreis liegt.
 *
 * ── ⚠ DER LEISTUNGSPREIS IST HIER NICHT DRIN ──────────────────────────────────────────────────
 * Die Balken zeigen ausschliesslich ARBEITS- und NETZ-ARBEITSpreis (ct/kWh). Der Leistungspreis
 * (€/kW·Jahr) ist eine Jahresgrösse und bleibt die bestehende Jahreszahl im Report; ihn auf Monate
 * zu verteilen verlangte eine Aufteilungsregel, die weder das Preisblatt noch das Pflichtenheft
 * hergibt — und sie würde je nach Abrechnungsmodell (§3.5) anders ausfallen.
 *
 * ── ⚠ NICHT AUF EIN JAHR HOCHGERECHNET ─────────────────────────────────────────────────────────
 * `annualizationFactor` (§3.7.1) wird hier bewusst NICHT angewandt: ein Monatsbalken ist eine
 * Aussage über EINEN gemessenen Monat. Monate ohne jeden Messwert bleiben `null` und werden von
 * der Anzeige ausgespart — eine 0 sähe aus wie „gemessen, kostet nichts".
 */

/**
 * ⚠ DIE EINSPEISUNG WIRD IN ALLEN DREI REIHEN GLEICH BEHANDELT — und das ist eine bewusste
 * Abweichung von der ursprünglich skizzierten Formel, die sie nur in der Speicher-Reihe nettete.
 *
 * Nur dort genettet, verglichen die Balken zwei verschiedene Grössen: „Bezugskosten" gegen
 * „Bezugskosten abzüglich Einspeiseerlös". Die Speicher-Reihe sähe damit besser aus als sie ist,
 * und zwar genau in dem Fall, in dem der Kunde viel einspeist — der Fehler wüchse mit der
 * PV-Anlage. Fachlich ist die Frage der Reihen „was kostet mich dieser Monat am Netz", und darauf
 * gehört der Einspeiseerlös in jede Antwort oder in keine.
 *
 * Bewertet wird mit der Einspeisevergütung des Kunden (`einspeiseverguetungCtPerKwh`, Schritt 2),
 * in allen drei Reihen mit demselben Satz: sein Einspeisevertrag ist ein anderer Vertrag als sein
 * Bezugstarif und ändert sich durch einen aWATTar-Wechsel nicht. Bei einem Lastgang ohne
 * Einspeisung (der reale Bestandsfall, an dem dies gemessen wurde) ist die Regel folgenlos.
 */
function intervalCostEur(
  gridKw: number,
  deltaHours: number,
  drawPriceCtPerKwh: number,
  feedInCtPerKwh: number,
): number {
  const ct = gridKw >= 0 ? gridKw * drawPriceCtPerKwh : gridKw * feedInCtPerKwh
  return (ct * deltaHours) / 100
}

/**
 * Die drei Monatsreihen — oder `undefined`, wenn der kombinierte Preis nicht gebildet werden kann.
 *
 * `undefined` ist im regulären Ablauf unerreichbar: der Aufrufer ruft erst auf, wenn
 * `tariffOptimization.computable === true` ist, und das ist genau die Aussage, dass beide
 * Preisseiten den ganzen Zeitraum abdecken. Der Zweig steht trotzdem — er ist die Zusage, dass
 * hier NIE eine halbe Reihe entsteht, falls ein künftiger Aufrufer die Reihenfolge ändert.
 *
 * @param gridAfterKw Netzbezug nach dem Dispatch der bestehenden Anlage (signiert, + = Bezug).
 */
export function buildMonthlyTariffComparison(
  loadProfile: LoadProfile,
  tariffParams: TariffParams,
  pricing: TariffPricingInputs,
  gridAfterKw: number[],
): MonthlyTariffComparison | undefined {
  const spotSide = combinedIntervalPrices(loadProfile, pricing)
  if ('blocker' in spotSide) return undefined
  const currentSide = combinedIntervalPrices(
    loadProfile,
    pricing,
    tariffParams.energyPriceCtPerKwh,
  )
  if ('blocker' in currentSide) return undefined

  const deltaHours = intervalHours(loadProfile)
  const feedInCt = tariffParams.einspeiseverguetungCtPerKwh
  const current = new Array<number>(12).fill(0)
  const withoutControl = new Array<number>(12).fill(0)
  const withBattery = new Array<number>(12).fill(0)
  const covered = new Array<boolean>(12).fill(false)

  for (let i = 0; i < loadProfile.readings.length; i++) {
    const reading = loadProfile.readings[i]!
    // Monatsgrenzen nach LOKALER Wanduhr — dieselbe Ableitung wie `coveredMonthlyPeaksKw` (§3.4/§3.5).
    // Ausdrücklich NICHT `periodIndexByInterval`: das folgt dem Abrechnungsmodell und lieferte bei
    // `annual_max` einen einzigen Balken für das ganze Jahr.
    const { month } = utcMsToLocalFields(Date.parse(reading.ts), loadProfile.timezoneMeta)
    const idx = month - 1
    covered[idx] = true

    const spotPrice = spotSide.prices[i]!
    const currentPrice = currentSide.prices[i]!
    const rawKw = reading.gridPowerKw
    // Fehlt der Dispatch-Wert (kann nur bei abweichender Reihenlänge passieren), gilt der rohe
    // Bezug — dann steht die Reihe „mit Speicher" auf der Reihe „ohne Steuerung", statt eine
    // Ersparnis zu behaupten, die nicht gerechnet wurde.
    const afterKw = gridAfterKw[i] ?? rawKw

    current[idx]! += intervalCostEur(rawKw, deltaHours, currentPrice, feedInCt)
    withoutControl[idx]! += intervalCostEur(rawKw, deltaHours, spotPrice, feedInCt)
    withBattery[idx]! += intervalCostEur(afterKw, deltaHours, spotPrice, feedInCt)
  }

  const mask = (values: number[]): (number | null)[] =>
    values.map((v, i) => (covered[i] ? v : null))

  return {
    currentTariffEur: mask(current),
    spotWithoutControlEur: mask(withoutControl),
    spotWithBatteryEur: mask(withBattery),
    coveredMonths: covered.filter(Boolean).length,
  }
}
