/**
 * DER WERT EINER BESTEHENDEN PV-ANLAGE ALS CONTRACT — das Report-Kapitel „Ihre PV-Anlage".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ES IST EINE REKONSTRUKTION UND KEINE ZWEITE MESSUNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ein Netzbetreiber-Export ohne Einspeisespalte (`source: 'import_only'`) misst am Anschlusspunkt:
 * der selbst verbrauchte PV-Strom kommt dort nie vorbei, er steht ausschliesslich als GESENKTER
 * Bezug darin. Der Lastgang beantwortet deshalb die Frage „was wäre ohne die Anlage gewesen?"
 * strukturell nicht — er zeigt nur, was MIT ihr passiert ist.
 *
 * Gerechnet wird darum ein zweiter, rekonstruierter Lastgang: `Netzbezug(t) + geschätzte
 * Erzeugung(t)`, Viertelstunde für Viertelstunde. Beide Seiten gehen anschliessend durch DIESELBE
 * Tarifkosten-Funktion, aus der auch „Ihr Tarif heute" entsteht; die Differenz ist der Wert der
 * Anlage.
 *
 * ── ⚠ DIE VEREINFACHUNG IST BEWUSST UND WIRD OFFENGELEGT ──────────────────────────────────────
 * Die GESAMTE geschätzte Erzeugung gilt als Eigenverbrauch; eine Netzeinspeisung wird nicht
 * gegengerechnet. Ohne Exportdaten liesse sich die Aufteilung nur modellieren, und ein
 * `min(Erzeugung, Last)` wäre eine zweite Schätzung über der ersten. Der Report sagt den Satz
 * wörtlich; die Richtung des Fehlers ist bekannt (tatsächliche Einspeisung korrigierte die
 * Differenz leicht nach unten).
 *
 * ── ⚠ AUSFALLMONATE BEKOMMEN KEINE ERZEUGUNG, NICHT EINE GESCHÄTZTE ───────────────────────────
 * Für Monate, in denen `detectPvOutageMonths` keinen Mittagseinbruch gefunden hat, wird 0
 * angesetzt — dort gab es messbar keine Erzeugung, und eine PVGIS-Schätzung behauptete an genau
 * den Stellen einen Ertrag, an denen der Lastgang das Gegenteil zeigt. Eine 0 in den Monatsbalken
 * hiesse dagegen „geschätzt, und es kam nichts heraus"; die beiden sind unterschieden (s.
 * `PvValueMonth.selfConsumptionKwh`).
 *
 * ── ⚠ DIE ZAHL GEHÖRT IN KEINE SPANNE DER ZUSAMMENFASSUNG (D8) ────────────────────────────────
 * Der Wert der PV-Anlage ist keine ERSPARNIS, die der Kunde noch heben kann — er ist bereits
 * gehoben und steckt in den Ist-Kosten. In der Ersparnis-Spanne stünde er als etwas, das man noch
 * bekommt. Das Kapitel führt ihn deshalb als eigene, benannte Zahl; `summary.ts` liest dieses Feld
 * nicht.
 *
 * ── OFFEN, ausdrücklich NICHT hier gebaut ─────────────────────────────────────────────────────
 * Ein Lastgang MIT gemessenen Einspeisedaten (`net_signed`/`import_export_split`) erlaubte einen
 * direkten, gemessenen Wert statt einer Rekonstruktion. Der Fall ist ein eigener Sonderweg und
 * lässt dieses Kapitel heute entfallen — eine Rekonstruktion neben einer vorhandenen Messung wäre
 * ein Rückschritt gegenüber ihr (Prinzip 1).
 */

/** Die angesetzte PV-Erzeugung EINES Kalendermonats. */
export type PvValueMonth = {
  /** Kalenderjahr in Ortszeit des Lastgangs. */
  year: number
  /** 1–12, Ortszeit. */
  month: number
  /**
   * Die angesetzte Erzeugung dieses Monats in kWh — unter der Vereinfachung „alles Eigenverbrauch"
   * zugleich der geschätzte Eigenverbrauch.
   *
   * ⚠ `null` heisst AUSFALLMONAT: hier wurde bewusst nichts angesetzt, weil der Lastgang keinen
   * Mittagseinbruch zeigt. Das ist etwas anderes als eine 0 (geschätzt, Ergebnis nahe null) —
   * dieselbe Unterscheidung wie zwischen einer leeren und einer auf 0 stehenden Zelle im
   * Monatsvergleich. Als Nullbalken gezeichnet sähe der Ausfall aus wie ein gemessener Kleinstwert.
   */
  selfConsumptionKwh: number | null
  /** `true` = Ausfallmonat (s. `selfConsumptionKwh`). Der Wert ist dann immer `null`. */
  outage: boolean
}

/**
 * Die beiden Kostenseiten eines Zeitraums und ihre Differenz — BEIDE aus derselben Rechnung
 * („Ihr Tarif heute"), einmal auf dem echten und einmal auf dem rekonstruierten Lastgang.
 */
export type PvValueCosts = {
  /** Kosten MIT der Anlage — die Bezugsgrösse, der echte gemessene Netzbezug. */
  withPvEur: number
  /** Dieselbe Rechnung auf dem rekonstruierten „ohne PV"-Lastgang. */
  withoutPvEur: number
  /** `withoutPvEur − withPvEur` — der Wert der Anlage über diesen Zeitraum. */
  valueEur: number
}

/** Die Jahres-Hochrechnung beider Seiten — derselbe Mechanismus wie in `annualScenario` (D6 Teil 3). */
export type PvValueAnnual = PvValueCosts & {
  /** Erster Kalendertag des Jahresfensters (lokal, `YYYY-MM-DD`, inklusiv). */
  windowFromDate: string
  /** Letzter Kalendertag des Jahresfensters (lokal, inklusiv). */
  windowToDate: string
  /** Kalendertage des Fensters, die aus der Referenzwoche gefüllt wurden. */
  projectedDays: number
}

export type PvValueScenario = {
  /** Gemessene Kalendertage, auf die sich `measured` bezieht. */
  coveredDays: number
  /** Der gemessene Zeitraum. */
  measured: PvValueCosts
  /**
   * Auf 365 Tage hochgerechnet. `null` heisst „nicht bildbar" — kein Jahresfenster im
   * Preisbestand, keine Referenzwoche, oder der Lastgang deckt bereits ein volles Jahr ab. Es wird
   * dann NICHTS genähert; das Kapitel zeigt allein den gemessenen Zeitraum.
   */
  annual: PvValueAnnual | null
  /** Die angesetzte Erzeugung je Kalendermonat des GEMESSENEN Zeitraums, chronologisch. */
  months: PvValueMonth[]
  /** Die angesetzte Erzeugung über den gemessenen Zeitraum in kWh, Ausfallmonate mit 0. */
  estimatedGenerationKwh: number
}
