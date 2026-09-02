/**
 * Der REALE Vorteil eines aWATTar-Wechsels, aufgeschlüsselt in seine zwei Ursachen (02.09.2026).
 *
 * ── ⚠ WELCHE FRAGE DIESE ZAHL BEANTWORTET — UND WELCHE NICHT ───────────────────────────────────
 * Die Kopfkarte des Reports zeigte bis hierher `totalSavingPerYear` der bestehenden Anlage. Bei
 * einem Kunden ohne Leistungspreis und ohne PV besteht diese Summe fast ausschliesslich aus der
 * Lastverschiebung — also aus GENAU DER Zahl, die die Karte „Wert der Ladesteuerung unter aWATTar"
 * daneben ebenfalls ausweist. Zwei Karten, dieselbe Zahl, und keine davon beantwortete die Frage,
 * die ein Kunde als erste stellt: „was zahle ich real weniger?"
 *
 * Diese Grösse beantwortet sie: die Differenz zwischen dem, was der Kunde HEUTE zahlt, und dem,
 * was er mit aWATTar UND seinem Speicher gezahlt hätte. Sie ist damit eine KASSEN-Grösse aus dem
 * Monatsvergleich und keine Attributions-Grösse aus der §3.7-Buchhaltung — die beiden Rechenwege
 * unterscheiden sich um wenige Prozent, und der Unterschied ist im Handover vom 02.09.2026 in
 * drei Posten aufgelöst (Clamp, Start-SoC, Restenergie). Massgeblich für „was zahle ich" ist der
 * Monatsvergleich.
 *
 * ── ⚠ ZWEI URSACHEN, UND DIE ERSTE KANN NEGATIV SEIN ───────────────────────────────────────────
 * `tariffSwitchEur` ist der reine Wechsel OHNE jede Steuerung (Ist-Tarif gegen aWATTar auf den
 * rohen Lastgang). Er ist im gemessenen Realfall NEGATIV: der Wechsel allein kostet mehr, und erst
 * die Ladesteuerung dreht das Vorzeichen. Genau das darf die Karte nicht verschweigen — eine
 * einzelne positive Gesamtzahl liesse den Wechsel als solchen vorteilhaft erscheinen.
 *
 * ── ⚠ `totalEur` IST DIE SUMME DER TEILE, NICHT DIE UNABHÄNGIG GERECHNETE DIFFERENZ ────────────
 * Rechnerisch ist `(a − b) + (b − c)` dasselbe wie `a − c`; in IEEE-754 ist es das NICHT immer
 * (ein Testfall pinnt einen Eingang, an dem beide Wege auseinanderlaufen). Die Anzeige stellt aber
 * beide Teilbeträge und die Summe nebeneinander — läuft die Summe um einen Cent daneben, ist das
 * für einen Leser ein Rechenfehler, und er hat recht. Die Kopfzahl entsteht deshalb DURCH
 * Addition. Der Unterschied liegt weit unter jeder angezeigten Nachkommastelle; was zählt, ist,
 * dass die drei Zahlen zueinander stimmen.
 *
 * ── ⚠ NICHT HOCHGERECHNET ──────────────────────────────────────────────────────────────────────
 * Die Eingänge stammen aus `MonthlyTariffComparison` und sind ausdrücklich Summen über die
 * GEMESSENEN Monate (§3.7.1 gilt dort nicht). Wer das Ergebnis auf ein Jahr skaliert, muss das
 * eigens begründen: fehlende Monate liegen typischerweise nicht gleichverteilt über das Jahr, und
 * eine aus Sommer- und Frühjahrsmonaten hochgerechnete Wintererwartung ist systematisch zu
 * niedrig. Die Karte weist deshalb den gemessenen Zeitraum aus, nicht ein Jahr.
 */
export type RealSavingBreakdown = {
  /** Ihr Tarif heute − aWATTar OHNE Steuerung. Negativ, wenn der Wechsel allein teurer wäre. */
  tariffSwitchEur: number
  /** aWATTar ohne Steuerung − aWATTar MIT dem Speicher. Der Beitrag der Ladesteuerung. */
  controlValueEur: number
  /** Die Summe der beiden — die Zahl, die die Kopfkarte gross zeigt. */
  totalEur: number
}

/**
 * Die drei Summen des Monatsvergleichs (jeweils über die belegten Monate) in die Aufschlüsselung
 * übersetzen. Rein arithmetisch, ohne jede Rundung — gerundet wird erst beim Formatieren.
 *
 * ⚠ Die Summierung selbst geschieht ABSICHTLICH nicht hier: sie hat mit `sumCovered`
 * (`apps/website/components/report/monthly-tariff-chart.tsx`) genau eine Definition, und ein
 * zweiter Reducer an dieser Stelle könnte von der Legende des Charts abweichen — dann stünden
 * Kopfkarte und Chart im selben Report mit anders gebildeten Zahlen nebeneinander.
 */
export function buildRealSavingBreakdown(totals: {
  currentTariffEur: number
  spotWithoutControlEur: number
  spotWithBatteryEur: number
}): RealSavingBreakdown {
  const tariffSwitchEur = totals.currentTariffEur - totals.spotWithoutControlEur
  const controlValueEur = totals.spotWithoutControlEur - totals.spotWithBatteryEur
  return {
    tariffSwitchEur,
    controlValueEur,
    // ⚠ Summe der Teile, nicht `currentTariffEur - spotWithBatteryEur` — s. Modulkopf.
    totalEur: tariffSwitchEur + controlValueEur,
  }
}
