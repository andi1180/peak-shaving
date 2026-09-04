/**
 * B23c-1 — welchen Fall ein Prüflauf der Executive Summary fährt.
 *
 * ── ⚠ EIGENE DATEI OHNE EINEN EINZIGEN IMPORT, UND DAS IST DER GANZE ZWECK ────────────────────
 * Die Oberfläche braucht die Beschriftungen beim ERSTEN Rendern, die Eingaben dazu erst nach einem
 * Klick. Stünden beide in `summary-fixtures.ts`, zöge der statische Import dieser drei Zeilen den
 * Jahres-Lastgang (35.040 Werte), die Spotpreis-Reihe und den `shared`-Barrel in den First Load
 * der Prüfroute — für zwei Zeichenketten je Fall.
 */

export type SummaryProbeKind =
  | 'bestand'
  | 'blocker'
  | 'katalog'
  | 'teiljahr'
  | 'zusatz'
  | 'teiljahr_monat'
  | 'luecke'
  | 'standardprofil'
  | 'blocker_luecke'
  | 'foerderung'

export const SUMMARY_PROBE_KINDS: readonly SummaryProbeKind[] = [
  'bestand',
  'blocker',
  'katalog',
  'teiljahr',
  'zusatz',
  'teiljahr_monat',
  'luecke',
  'standardprofil',
  'blocker_luecke',
  'foerderung',
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
  /*
   * B23c-4 — die drei Fälle, die JE EINEN der drei Hinweise bei der Kern-Kennzahl auslösen und
   * ausdrücklich keinen zweiten.
   *
   * ── ⚠ WARUM DREI EIGENE FÄLLE UND NICHT EINER MIT ALLEN DREIEN ────────────────────────────
   * Die drei Bedingungen sind voneinander unabhängig (`summary.ts`, `buildNotices`), und ein
   * gemeinsamer Lauf mit allen dreien beweist das NICHT: er bliebe auch dann grün, wenn zwei der
   * Bedingungen in Wahrheit an derselben Grösse hingen. Gemessen wird die Unabhängigkeit erst,
   * wenn jeder Hinweis einmal ALLEIN dasteht — und die beiden anderen nachweislich fehlen.
   *
   * Was die drei Läufe SONST noch zeigen, ist Beiwerk und ausdrücklich kein zweiter Hinweis am
   * selben Ort: `teiljahr_monat` erreicht zusätzlich den Preisstand-Absatz im Schlusskapitel
   * (sein Zeitraum reicht ins laufende Jahr), `luecke` und `standardprofil` erreichen den
   * Datenqualitäts-Kasten. Beides steht ein Kapitel weiter hinten.
   */
  teiljahr_monat:
    'Teiljahr unter „Mittel der Monatshöchstwerte" (NUR der Teiljahres-Hinweis, laufendes Jahr)',
  luecke: 'Volljahr mit 30 Tagen interpolierter Lücke (NUR der Datenlücken-Hinweis)',
  standardprofil: 'Standardlastprofil H0 statt Messung (NUR der Standardprofil-Hinweis)',
  /*
   * B23c-4 — der Blocker mit ZEITBEREICHEN.
   *
   * ── ⚠ WARUM DER BESTEHENDE `blocker`-FALL DAFÜR NICHT REICHT ──────────────────────────────
   * Er fährt `spotPrices: null` und erzeugt damit `kind: 'unavailable'` — „wir konnten die Preise
   * nicht abrufen", und dazu gibt es KEINE Bereiche (gemessen: `ranges` ist leer). Der andere
   * Grund, `kind: 'gap'`, ist der einzige, der Zeitbereiche trägt, und genau deren Darstellung im
   * Schlusskapitel wäre sonst gebaut und nie gemessen. Die zwei Gründe sind auch fachlich
   * verschieden: dort liegt es an uns (ein Abruf misslang), hier an einer Lücke im Bestand, die
   * sich mit dem nächsten Cron-Lauf von selbst schliesst.
   */
  blocker_luecke: 'Bestandsanlage, Lücke in den Börsenpreisen (Blocker MIT Zeitbereich)',
  /*
   * B23c-4 — der EINZIGE Fall mit Förderung und Steuervorteil.
   *
   * ── ⚠ OHNE IHN SIND ZWEI ZEILEN DER ANNAHMEN-TABELLE NICHT UNTERSCHEIDBAR ─────────────────
   * Ohne Finanzparameter ist `netInvestment` Zahl für Zahl gleich `totalInvestment`, und eine
   * Wächter-Probe, die das eine gegen das andere tauscht, bliebe grün (gemessen). Er erreicht
   * ausserdem den zweiten Zweig der Zeile „Nettoinvestition": die übrigen Läufe zeigen dort
   * „keine Angabe (nicht einbezogen)", dieser einen echten Betrag.
   */
  foerderung: 'Ohne Bestandsanlage, MIT Förderung und Steuervorteil (Nettoinvestition ≠ brutto)',
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
