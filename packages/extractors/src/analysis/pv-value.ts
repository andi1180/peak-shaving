import {
  addPvToGridDraw,
  buildMonthlyTariffComparison,
  buildSyntheticYearProfile,
  monthlyPvGeneration,
  zeroPvWhereNoDemand,
  type CalculatorPayload,
  type PvMonthRef,
} from 'engine'
import {
  analysisWindow,
  sumCovered,
  type AnalysisWindow,
  type LoadProfile,
  type PvProfile,
  type PvValueCosts,
  type PvValueScenario,
  type TariffPricingInputs,
} from 'shared'

/**
 * „IHRE PV-ANLAGE" — WAS DIE BESTEHENDE ANLAGE ÜBER DEN AUSGEWERTETEN ZEITRAUM WERT WAR.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ES ENTSTEHT KEINE ZWEITE KOSTENRECHNUNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Beide Seiten — mit und ohne Anlage — werden mit DERSELBEN Funktion bewertet, aus der auch „Ihr
 * Tarif heute" im Wege-Kapitel entsteht (`buildMonthlyTariffComparison`, Reihe `currentTariffEur`).
 * Getauscht ist genau eine Sache: der Lastgang. Eine eigene Formel hier — und sei es nur
 * „Erzeugung × Arbeitspreis" — liefe beim nächsten Abgaben- oder Netzentgelt-Ausbau von ihr weg,
 * und die ausgewiesene Differenz enthielte dann einen Anteil, der gar nichts mit der PV-Anlage zu
 * tun hat (dieselbe Klasse Fehler wie in #295).
 *
 * ⚠ DIE „MIT PV"-ZAHL DES GEMESSENEN ZEITRAUMS WIRD NICHT NACHGERECHNET, sondern kommt als
 * Parameter aus dem bereits gelaufenen `computeAnalysis` herein. Sie ist die Kopfzahl, die im
 * Report ohnehin dasteht; ein zweiter Lauf derselben Rechnung daneben könnte sich um Rundungen
 * unterscheiden, und der Leser sähe zwei verschiedene „Ihr Tarif heute".
 *
 * ── ⚠ DAS JAHRESFENSTER WIRD ÜBERNOMMEN UND NICHT ZWEITAUSGERECHNET ───────────────────────────
 * Es kommt als `annualWindow` aus dem bereits gebildeten Jahres-Szenario (D6 Teil 3) herein. Die
 * Grenzen des Fensters hängen an Dingen, die der Rechenkern nicht wissen darf (Preisanker, Uhr) —
 * sie hier ein zweites Mal abzuleiten hiesse, dass dieses Kapitel und das Kapitel davor
 * verschiedene Jahre zeigen könnten, ohne dass es irgendwo stünde. Ohne Jahres-Szenario gibt es
 * hier keine Jahreszahl; es wird ausdrücklich NICHTS genähert.
 *
 * ⚠ Ohne `import 'server-only'`: alles kommt durch den Port herein — dieselbe Lage wie bei
 * `annual-scenario.ts`.
 */

/** Der Port: dieselben zwei Preisseiten, nur für ein anderes Fenster (wie im Jahres-Szenario). */
export type PvValuePricingReader = (request: {
  window: AnalysisWindow
  intervalMinutes: number
}) => Promise<TariffPricingInputs>

export type PvValueOptions = {
  /** Der Payload des GEMESSENEN Laufs — er wird gelesen, nie verändert. */
  payload: CalculatorPayload
  /** Die Kosten „Ihr Tarif heute" aus dem gemessenen Lauf, unverändert übernommen (s. Modulkopf). */
  measuredWithPvEur: number
  /** Die GESCHÄTZTE Brutto-Erzeugung (PVGIS), auf den Zeitstempeln des gemessenen Lastgangs. */
  pvGross: PvProfile
  /** Die Monate ohne erkennbaren Mittagseinbruch (`detectPvOutageMonths`). */
  outageMonths: readonly PvMonthRef[]
  /**
   * Das Fenster des Jahres-Szenarios (D6 Teil 3), beide Kanten lokale Kalendertage. `null` = es
   * gibt kein Jahres-Szenario — dann entfällt die Hochrechnung dieses Kapitels ebenfalls.
   */
  annualWindow: { fromDate: string; toDate: string } | null
  fetchTariffPricing: PvValuePricingReader
}

/**
 * Das PV-Kapitel bauen — oder `null`, wenn es nichts zu zeigen gibt.
 *
 * ── DER ABLAUF ────────────────────────────────────────────────────────────────────────────────
 *  1. Ausfallmonate UND Tage ohne Mittagsbedarf in der Erzeugungsreihe auf 0 setzen (EINMAL, s.
 *     `zeroPvWhereNoDemand`).
 *  2. Rekonstruierter Lastgang = gemessener Netzbezug + bereinigte Erzeugung.
 *  3. Kosten beider Seiten über den gemessenen Zeitraum.
 *  4. Dasselbe Paar über das Jahresfenster — beide Seiten aus DEMSELBEN synthetischen Jahreslauf.
 *  5. Die Monatssummen der angesetzten Erzeugung.
 */
export async function buildPvValueScenario(
  options: PvValueOptions,
): Promise<PvValueScenario | null> {
  const { payload, pvGross, outageMonths } = options
  const measuredLoad = payload.load.profile
  const pricing = payload.tariffPricing
  if (pricing === undefined) return null
  if (measuredLoad.readings.length === 0) return null

  const generation = zeroPvWhereNoDemand(measuredLoad, pvGross, outageMonths)
  const reconstructed = addPvToGridDraw(measuredLoad, generation)

  const withoutPvEur = currentTariffCostEur(reconstructed, payload, pricing)
  if (withoutPvEur === null) return null

  const measured = costsOf(options.measuredWithPvEur, withoutPvEur)
  const months = monthlyPvGeneration(measuredLoad, generation, outageMonths)

  return {
    coveredDays: payload.load.dataQuality.coveredDays,
    measured,
    annual: await annualCosts(options, generation),
    months,
    estimatedGenerationKwh: months.reduce((sum, m) => sum + (m.selfConsumptionKwh ?? 0), 0),
  }
}

/** `withoutPvEur − withPvEur` an EINER Stelle — die Richtung ist sonst leicht verdreht. */
function costsOf(withPvEur: number, withoutPvEur: number): PvValueCosts {
  return { withPvEur, withoutPvEur, valueEur: withoutPvEur - withPvEur }
}

/**
 * Die Kosten „Ihr Tarif heute" für EINEN Lastgang — dieselbe Reihe, dieselbe Funktion, dieselbe
 * Summierung wie im Wege-Kapitel (`tariffWayCosts`).
 *
 * ⚠ ALS VIERTES ARGUMENT GEHT DER ROHE NETZBEZUG HINEIN und nicht ein Dispatch-Ergebnis. Die Reihe
 * `currentTariffEur` liest ihn ohnehin nicht (sie bewertet den ROHEN Bezug, s.
 * `monthly-tariff-comparison.ts`); ihn mitzugeben ist die ehrlichere Eingabe als eine erfundene
 * Speicherreihe, und die beiden aWATTar-Reihen, die daran hängen, werden hier nirgends gelesen.
 *
 * `null` heisst: der kombinierte Intervallpreis liess sich nicht bilden — dann gibt es auch keine
 * Vergleichszahl, und das Kapitel entfällt, statt eine halbe zu zeigen.
 */
function currentTariffCostEur(
  load: LoadProfile,
  payload: CalculatorPayload,
  pricing: TariffPricingInputs,
): number | null {
  const comparison = buildMonthlyTariffComparison(
    load,
    payload.tariff,
    pricing,
    load.readings.map((reading) => reading.gridPowerKw),
  )
  return comparison?.currentTariffEur ? sumCovered(comparison.currentTariffEur) : null
}

/**
 * Beide Seiten über ein volles Jahr — durch DENSELBEN Baustein wie das Jahres-Kapitel davor
 * (`buildSyntheticYearProfile`, D6 Teil 3).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ EIN AUFRUF UND NICHT ZWEI — UND DAS IST DIE TRAGENDE ENTSCHEIDUNG DIESER FUNKTION
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Naheliegend wäre, den Baustein je Szenario einmal laufen zu lassen (einmal auf dem echten,
 * einmal auf dem rekonstruierten Lastgang). Er wählt seine Referenzwoche aber nach dem HÖCHSTEN
 * Verbrauch — und der rekonstruierte Lastgang ist im Sommer stärker angehoben als im Winter. Zwei
 * Läufe könnten also verschiedene Wochen und damit verschiedene Füllpläne wählen; die ausgewiesene
 * Differenz enthielte dann einen Anteil, der aus der Auswahl stammt und nicht aus der PV-Anlage.
 *
 * Der Baustein verlängert eine mitgegebene Erzeugungsreihe nach DEMSELBEN Plan wie den Lastgang
 * (`extendPv`, und die Begründung dort ist wortgleich diese). Gebraucht wird deshalb genau ein
 * Lauf: er liefert den Jahres-Lastgang MIT Anlage und die dazu passende Jahres-Erzeugung, und die
 * „ohne PV"-Seite entsteht daraus durch dieselbe Addition wie im gemessenen Zeitraum.
 *
 * `null` heisst „keine Jahreszahl" und ist kein Fehler: ohne Jahres-Szenario, ohne verlängerte
 * Erzeugungsreihe oder ohne Preisdeckung für das Fenster wird NICHTS genähert.
 */
async function annualCosts(
  options: PvValueOptions,
  generation: PvProfile,
): Promise<PvValueScenario['annual']> {
  const { annualWindow, payload } = options
  if (annualWindow === null) return null

  const synthetic = buildSyntheticYearProfile(
    payload.load.profile,
    { earliestDate: annualWindow.fromDate, latestDate: annualWindow.toDate },
    generation,
  )
  if (!synthetic.ok) return null
  const year = synthetic.value
  const yearPv = year.pvProfile
  /* Kann nicht eintreten (eine Reihe ging hinein), aber ein `!` wäre eine Behauptung. */
  if (yearPv === undefined) return null

  const window = analysisWindow(year.profile)
  if (window === null) return null

  const pricing = await options.fetchTariffPricing({
    window,
    intervalMinutes: year.profile.intervalMinutes,
  })

  const withPvEur = currentTariffCostEur(year.profile, payload, pricing)
  const withoutPvEur = currentTariffCostEur(
    addPvToGridDraw(year.profile, yearPv),
    payload,
    pricing,
  )
  if (withPvEur === null || withoutPvEur === null) return null

  return {
    ...costsOf(withPvEur, withoutPvEur),
    windowFromDate: year.windowFromDate,
    windowToDate: year.windowToDate,
    projectedDays: year.projectedDays,
  }
}
