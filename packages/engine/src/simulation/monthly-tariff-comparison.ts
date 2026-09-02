import { AWATTAR_BASE_FEE } from 'shared'
import type {
  GridTariffRowInput,
  LoadProfile,
  MonthlyFixedCosts,
  MonthlyTariffComparison,
  TariffParams,
  TariffPricingInputs,
} from 'shared'

import { utcMsToLocalFields } from '../parser/datetime'
import { findGridTariffRow } from './grid-tariff-window'
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
 * Die Balken zeigen Arbeits- und Netz-Arbeitspreis (ct/kWh) plus die verbrauchsunabhängigen
 * GRUNDGEBÜHREN (s. unten). Der Leistungspreis (€/kW·Jahr) bleibt aussen vor und ist die bestehende
 * Jahreszahl im Report; ihn auf Monate zu verteilen verlangte eine Aufteilungsregel, die weder das
 * Preisblatt noch das Pflichtenheft hergibt — und sie würde je nach Abrechnungsmodell (§3.5) anders
 * ausfallen.
 *
 * ── ⚠ DIE FIXKOSTEN SIND SEIT DELTA 19 DRIN — und sie sind der eigentliche Grund dafür ─────────
 * Ein Tarifwechsel tauscht nicht nur den Arbeitspreis: der Kunde zahlt statt der Grundgebühr seines
 * heutigen Lieferanten die von aWATTar. Ohne sie verglichen die Balken zwei UNVOLLSTÄNDIGE
 * Rechnungen — und zwar asymmetrisch, weil die beiden Gebühren verschieden hoch sind. Bei einem
 * Kleinverbraucher kann die Differenz der Grundgebühren die Differenz der Arbeitskosten sogar
 * übersteigen; dann zeigte der Chart einen Vorteil, den es in der Jahresrechnung nicht gibt.
 *
 * Drei Posten, drei Zuordnungen:
 *   • Netz-Grundpreis (nur als JAHRESPAUSCHALE, s. `grundpreisUnit`) → in ALLE DREI Reihen, gleich
 *     hoch. Derselbe Netzanschluss bleibt derselbe, egal von wem der Kunde seine Energie kauft; er
 *     kürzt sich aus jeder Differenz heraus und macht nur die absoluten Zahlen richtig.
 *   • Grundgebühr des heutigen Lieferanten → nur „Ihr Tarif heute".
 *   • Grundgebühr von aWATTar (`AWATTAR_BASE_FEE`) → nur in die beiden aWATTar-Reihen.
 *
 * ── ⚠ ANTEILIG NACH ABGEDECKTEN KALENDERTAGEN, NIE ALS VOLLER MONATSBETRAG ────────────────────
 * Ein Lastgang, der am 20. beginnt, trägt für diesen Monat elf Dreissigstel. Der volle Betrag stünde
 * sonst neben Arbeitskosten aus elf Tagen — ein Balken, der zwei Zeiträume mischt. Gerechnet wird
 * TAGWEISE über die tatsächlich belegten Kalendertage (lokale Wanduhr): so trifft die Rechnung
 * Schaltjahre und Monatslängen von selbst, und ein Tarifwechsel mitten im Zeitraum wird je Tag mit
 * der Zeile bewertet, die an diesem Tag galt (`findGridTariffRow` — dieselbe Auswahl wie beim
 * Arbeitspreis, keine zweite Lesart).
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

/** Tage des Kalendermonats — schaltjahres-korrekt, weil `new Date(y, m, 0)` den letzten Tag liefert. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Tage des Kalenderjahres — 366 im Schaltjahr. Bezugsgrösse der Netz-Jahrespauschale. */
function daysInYear(year: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  return leap ? 366 : 365
}

/**
 * Die JAHRESPAUSCHALE einer Tarifzeile — oder `0`, wenn sie keine trägt.
 *
 * ── ⚠ NUR `eur_per_year` ZÄHLT HIER, UND DAS IST DIE TRAGENDE UNTERSCHEIDUNG ───────────────────
 * `eur_per_kw_year` ist der LEISTUNGSPREIS. Er steht bereits als Jahreszahl im Report (aus dem
 * Formular in Schritt 2, §3.4/§3.5) und dürfte hier auf keinen Fall ein zweites Mal auftauchen —
 * das wäre eine Doppelzählung derselben Kosten in derselben Auswertung. Ausserdem hängt er an
 * einem kW-Wert, dessen Verteilung auf Monate genau die Aufteilungsregel bräuchte, die dieser
 * Chart bewusst nicht erfindet.
 *
 * Ein unbekannter Einheiten-Wert wird wie eine fehlende Angabe behandelt: es wird NICHTS
 * eingerechnet. Eine geratene Deutung wäre hier besonders teuer — die beiden Einheiten
 * unterscheiden sich um den Faktor der Anschlussleistung.
 */
function annualFlatNetworkFeeEur(row: GridTariffRowInput | null): number {
  if (row == null) return 0
  if (row.grundpreisUnit !== 'eur_per_year') return 0
  const amount = row.grundpreisAmount
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0 ? amount : 0
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
  /*
   * Die belegten Kalendertage je Monat, als lokale `YYYY-MM-DD`-Zeichenketten. Ein Set, weil ein
   * Tag 96 Intervalle hat und die Gebühr genau EINMAL je Tag anteilig anfällt.
   *
   * ⚠ Der Schlüssel trägt das JAHR mit — anders als der Monatsindex des Charts, der einen
   * einzelnen Jahrgang voraussetzt (dokumentierte Grenze). Über einen mehrjährigen Lastgang würden
   * die Balken sich zwar weiterhin überlagern, die Tageszählung bliebe aber korrekt; ein Schlüssel
   * ohne Jahr zählte den 15. Jänner zweier Jahre als einen Tag und rechnete die Gebühr zu niedrig.
   */
  const coveredDates = new Set<string>()

  for (let i = 0; i < loadProfile.readings.length; i++) {
    const reading = loadProfile.readings[i]!
    // Monatsgrenzen nach LOKALER Wanduhr — dieselbe Ableitung wie `coveredMonthlyPeaksKw` (§3.4/§3.5).
    // Ausdrücklich NICHT `periodIndexByInterval`: das folgt dem Abrechnungsmodell und lieferte bei
    // `annual_max` einen einzigen Balken für das ganze Jahr.
    const { year, month, day } = utcMsToLocalFields(Date.parse(reading.ts), loadProfile.timezoneMeta)
    const idx = month - 1
    covered[idx] = true
    coveredDates.add(
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    )

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

  /*
   * ── DIE FIXKOSTEN, TAGWEISE AUFGETEILT (Delta 19) ────────────────────────────────────────────
   * Je belegtem Kalendertag ein Tagesanteil: die Monatsgebühren durch die Länge IHRES Monats, die
   * Netz-Jahrespauschale durch die Länge IHRES Jahres. Beides schaltjahres-korrekt, weil die
   * Längen aus dem Datum kommen und nicht aus einer angenommenen 30 bzw. 365.
   *
   * ⚠ Die Netzentgelt-Zeile wird JE TAG gesucht (`findGridTariffRow`, dieselbe Auswahl wie beim
   * Arbeitspreis) — ein Preisblattwechsel mitten im Zeitraum wird damit von selbst richtig
   * bewertet, statt den Stand des ersten Tages über den ganzen Lastgang zu ziehen.
   */
  const supplierFeeEurPerMonth = tariffParams.supplierBaseFeeEurPerMonth ?? 0
  const awattarFeeEurPerMonth = AWATTAR_BASE_FEE.eurPerMonth
  const networkFix = new Array<number>(12).fill(0)
  const supplierFix = new Array<number>(12).fill(0)
  const awattarFix = new Array<number>(12).fill(0)

  for (const date of coveredDates) {
    const year = Number(date.slice(0, 4))
    const month = Number(date.slice(5, 7))
    const idx = month - 1
    const monthShare = 1 / daysInMonth(year, month)
    const yearShare = 1 / daysInYear(year)

    networkFix[idx]! +=
      annualFlatNetworkFeeEur(findGridTariffRow(pricing.gridTariffRows ?? [], date)) * yearShare
    supplierFix[idx]! += supplierFeeEurPerMonth * monthShare
    awattarFix[idx]! += awattarFeeEurPerMonth * monthShare
  }

  for (let idx = 0; idx < 12; idx++) {
    // Der Netz-Grundpreis geht in ALLE DREI Reihen (er hängt am Anschluss, nicht am Lieferanten),
    // die beiden Lieferanten-Gebühren jeweils nur dorthin, wo sie tatsächlich anfallen.
    current[idx]! += networkFix[idx]! + supplierFix[idx]!
    withoutControl[idx]! += networkFix[idx]! + awattarFix[idx]!
    withBattery[idx]! += networkFix[idx]! + awattarFix[idx]!
  }

  const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0)
  const fixedCosts: MonthlyFixedCosts = {
    networkBaseFeeEur: sum(networkFix),
    supplierBaseFeeEur: sum(supplierFix),
    awattarBaseFeeEur: sum(awattarFix),
    supplierFeeEurPerMonth,
    awattarFeeEurPerMonth,
    coveredDays: coveredDates.size,
  }

  const mask = (values: number[]): (number | null)[] =>
    values.map((v, i) => (covered[i] ? v : null))

  return {
    currentTariffEur: mask(current),
    spotWithoutControlEur: mask(withoutControl),
    spotWithBatteryEur: mask(withBattery),
    coveredMonths: covered.filter(Boolean).length,
    fixedCosts,
  }
}
