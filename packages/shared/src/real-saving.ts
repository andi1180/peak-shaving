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
 * Monatsvergleich und keine Attributions-Grösse aus der §3.7-Buchhaltung. Massgeblich für „was
 * zahle ich" ist der Monatsvergleich.
 *
 * ⚠ ZUM ABSTAND DER BEIDEN RECHENWEGE — hier stand „wenige Prozent", und das war schon damals nur
 * für den PV-losen Fall richtig. Dort sind es tatsächlich drei benannte Posten (Clamp, Start-SoC,
 * Restenergie; am echten Kundenfall −5,22 € auf 204 €). MIT Einspeisung klaffte der Abstand bis
 * zum 02.09.2026 auf **47 %** auf: die §3.7-Attribution bewertete den Eigenverbrauch am Fixtarif
 * des Kunden, während diese Kassen-Grösse an den aWATTar-Preisen rechnete. Das ist mit §3.7.2
 * (eine Preisbasis für beide Energie-Töpfe) behoben — geblieben sind die drei Posten oben und der
 * Start-SoC, der als einziger noch am Fixtarif hängt (rund 1 € über den gemessenen Zeitraum).
 * Eine Prozentzusage steht hier bewusst nicht mehr: sie hing an der Konstellation, nicht an der
 * Rechnung, und wäre beim nächsten Fall wieder falsch.
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
 * ⚠ Die Summierung selbst geschieht ABSICHTLICH nicht hier, sondern in `sumCovered` (unten in
 * dieser Datei, bis B23c-1 in `monthly-tariff-chart.tsx`): sie hat genau EINE Definition, und ein
 * zweiter Reducer könnte von der Legende des Charts abweichen — dann stünden Kopfkarte und Chart
 * im selben Report mit anders gebildeten Zahlen nebeneinander.
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

/**
 * Die Summe der belegten Monate einer Monatsreihe — `null` heisst „kein Messwert" und trägt nichts
 * bei, ausdrücklich nicht 0.
 *
 * ── ⚠ WARUM DIESE VIER ZEILEN IN `shared` STEHEN (B23c-1) ──────────────────────────────────────
 * Sie standen bis hierher in `apps/website/components/report/monthly-tariff-chart.tsx` und hatten
 * dort drei Konsumenten (Legende des Charts, Kopfkarte der Empfehlung, Warnung der
 * Ladesteuerungs-Karte). Mit dem PDF-Report kommt ein VIERTER dazu, und der darf die Chart-Datei
 * nicht anfassen: sie zieht Recharts, und der PDF-Weg liegt in einem eigenen Lazy-Chunk (D6/D9) —
 * eine Chart-Bibliothek darin wäre Fracht für einen Weg, der gar nicht zeichnet.
 *
 * Die Alternative wäre ein zweiter Reducer im PDF-Pfad gewesen. Genau davor warnt der Kopf von
 * `buildRealSavingBreakdown` einen Absatz weiter oben: läuft er von diesem hier ab, stünden im
 * selben Report anders gebildete Summen derselben drei Reihen nebeneinander — im Bildschirm-Chart
 * die einen, im PDF die anderen. Der Umzug ist deshalb keine Aufräumarbeit, sondern die Bedingung
 * dafür, dass es weiterhin EINE Definition gibt.
 *
 * `monthly-tariff-chart.tsx` exportiert den Namen unverändert weiter; seine drei bestehenden
 * Konsumenten bleiben dadurch Zeile für Zeile gleich.
 */
export function sumCovered(values: (number | null)[]): number {
  return values.reduce<number>((sum, v) => (v == null ? sum : sum + v), 0)
}
