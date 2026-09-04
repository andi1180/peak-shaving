/**
 * B23c-1 — welchen Fall ein Prüflauf der Executive Summary fährt.
 *
 * ── ⚠ EIGENE DATEI OHNE EINEN EINZIGEN IMPORT, UND DAS IST DER GANZE ZWECK ────────────────────
 * Die Oberfläche braucht die Beschriftungen beim ERSTEN Rendern, die Eingaben dazu erst nach einem
 * Klick. Stünden beide in `summary-fixtures.ts`, zöge der statische Import dieser drei Zeilen den
 * Jahres-Lastgang (35.040 Werte), die Spotpreis-Reihe und den `shared`-Barrel in den First Load
 * der Prüfroute — für zwei Zeichenketten je Fall.
 */

export type SummaryProbeKind = 'bestand' | 'blocker' | 'katalog' | 'teiljahr' | 'zusatz'

export const SUMMARY_PROBE_KINDS: readonly SummaryProbeKind[] = [
  'bestand',
  'blocker',
  'katalog',
  'teiljahr',
  'zusatz',
]

export const SUMMARY_PROBE_LABEL: Record<SummaryProbeKind, string> = {
  bestand: 'Bestandsanlage, Ladesteuerung berechenbar',
  blocker: 'Bestandsanlage, Ladesteuerung NICHT berechenbar',
  katalog: 'Ohne Bestandsanlage (Katalog-Fall)',
  /*
   * B23c-3b-2 — derselbe Lastgang, auf Jänner bis August gekürzt. Der einzige Fall, in dem die
   * Stunden-Heatmap LEERE Zellen trägt: am Volljahrgang gibt es sie nicht (`emptyCells = 0`), und
   * der Unterschied „leer" gegen „gemessene Null" liesse sich dort gar nicht messen (D15).
   */
  teiljahr: 'Bestandsanlage, Teiljahres-Lastgang (Jän–Aug)',
  /*
   * B23c-3b-2 — eine KLEINE bestehende Anlage (5 kWh / 3 kW). Der einzige Fall, in dem sich ein
   * Zusatzgerät im Betrachtungszeitraum rechnet und das Kapitel „Speichergrösse und Gerätewahl"
   * deshalb die TABELLE trägt statt des Klarsatzes. Neben der dokumentierten 19,2-kWh-Anlage bleibt
   * jeder Katalog-Kandidat unter der Nulllinie — der Klarsatz-Zweig wäre damit der einzige
   * gemessene, und der Tabellen-Zweig gebaut, aber ungeprüft.
   */
  zusatz: 'Kleine Bestandsanlage, 25 Jahre Horizont (Zusatzspeicher rechnet sich)',
}

/**
 * B23c-3b-2 — der Betrachtungszeitraum je Prüffall.
 *
 * ── ⚠ WARUM EIN FALL EINEN ANDEREN HORIZONT BRAUCHT, UND WARUM DAS KEIN GEDREHTER KNOPF IST ───
 * Neben JEDER Bestandsanlage bleibt an diesem Prüf-Lastgang jedes Zusatzgerät unter der Nulllinie,
 * und zwar aus einem strukturellen Grund: die Anlage des Kunden ist `static` (Pessimismus-Prinzip),
 * der kombinierte Speicher damit ebenfalls — ein Zusatzgerät kappt also KEINE Spitzen, und der
 * Lastgang trägt keine Einspeisung, also gibt es auch keinen Eigenverbrauch. Übrig bleibt allein
 * die Lastverschiebung, und die trägt bei diesen Preisen die Anschaffung in zehn Jahren nicht.
 * Gemessen: mit 5 kWh Bestand und zehn Jahren sind alle fünf Szenarien negativ.
 *
 * Der Tabellen-Zweig des Kapitels wäre damit gebaut und nie gemessen. Er wird deshalb über GENAU
 * die Grösse erreicht, die ihn am Bildschirm auch erreicht: den Betrachtungszeitraum. Er ist eine
 * Angabe des NUTZERS (Annahmen-Panel, §6.2), und die Schwelle `netSavingOverHorizon > 0` verschiebt
 * sich mit ihm — genau so ist sie 01.09.2026 begründet worden. Eine hier erfundene Mindest-Ersparnis
 * oder eine gedrehte Preisreihe wären dagegen Zahlen, auf die sich niemand festgelegt hat.
 */
export const SUMMARY_PROBE_HORIZON_YEARS: Partial<Record<SummaryProbeKind, number>> = {
  zusatz: 25,
}
