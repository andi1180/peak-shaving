import type { AnalysisResult, EstimatedPvSummary, LoadProfile, TariffSourceRef } from 'shared'

/**
 * B23a/B23c-1 — Eingangsgrössen des react-pdf-Reports.
 *
 * Deckblatt, Untertitel und Zeitraum kommen als fertige Zeichenketten herein; ihre Ableitung
 * steht in `derive.ts` und ist damit für sich lesbar, statt im Rendern zu verschwinden.
 *
 * ── ⚠ B23c-1: DAS ERGEBNIS KOMMT ALS SCHMALE TEILMENGE, NICHT ALS GANZER CONTRACT ──────────────
 * `PdfReportAnalysis` ist ein `Pick<AnalysisResult, …>` über GENAU die sechs Felder, die die
 * Executive Summary tatsächlich liest — dasselbe Muster wie die `Pick<…>`-Parameter in
 * `derive.ts`, und aus demselben Grund. Der ganze Contract als Typ sagte „dieses Dokument könnte
 * alles daraus lesen"; die engere Signatur sagt, was es liest. Praktisch messbar wird der
 * Unterschied dort, wo ein Prüfstand oder ein künftiger Aufrufer die Seite fahren will: mit dem
 * ganzen Contract müsste er Felder erfinden, die niemand anfasst.
 *
 * ⚠ Der Typ wächst mit jedem Schritt, der eine weitere Karte übernimmt (B23c-2/3/4) — er wächst
 * dabei um die Felder, die die neue Darstellung LIEST, nicht auf den vollen Contract.
 * `dispatchTrace` etwa hängt bereits an `perBattery`/`existingBatteryAnalysis` und braucht keine
 * eigene Zeile.
 *
 * ── B23c-2: DIE TEILMENGE IST UNVERÄNDERT GEBLIEBEN, UND DAS IST EIN BEFUND ────────────────────
 * Empfehlungs-Aussage, Ladesteuerungs-Aussage und der Lastgang-Chart lesen zusammen: `perBattery`
 * (Batterie, Investition, ROI, Warnungen UND `dispatchTrace` mit der Kapp-Schwelle),
 * `recommendation` (welcher Kandidat), `existingBatteryAnalysis` (der primäre Block),
 * `tariffOptimization` (ob die Ladesteuerung bewertbar ist), `assumptions` (Horizont,
 * Abrechnungsmodell) und `current` (abgerechneter Leistungswert, Ist-Kosten). Alle sechs stehen
 * bereits hier — ausgezählt und nicht angenommen. Ein Feld ohne nachweisbare Verwendung kommt
 * nicht dazu, nur weil ein Schritt „gross" ist.
 *
 * Was der Chart darüber hinaus braucht, ist der ROHE Lastgang — und der steht bewusst NICHT im
 * `AnalysisResult` (`DispatchTrace` führt ausdrücklich keine Rohreihe, s. dort). Er kommt deshalb
 * als eigenes Feld des Eingangs, nicht als Teil des Ergebnisses.
 *
 * ── B23c-3a: ERNEUT UNVERÄNDERT — AUSGEZÄHLT, NICHT ANGENOMMEN ─────────────────────────────────
 * Die drei hinzugekommenen Bilder lesen zusammen:
 *   • Monatsvergleich → `tariffOptimization.monthlyComparison` (in `tariffOptimization`);
 *   • Kostenvergleich → der empfohlene Eintrag aus `perBattery` (über `recommendation`),
 *     `current.leistungspreisCostPerYear` und `assumptions.horizonYears`;
 *   • Tages-Energiefluss → `existingBatteryAnalysis.entry` bzw. `perBattery` (je `dispatchTrace`
 *     mit `representativeDays`) und die Zeitzone aus `loadProfile.timezoneMeta`.
 *
 * Alle sechs Contract-Felder stehen bereits oben, die Zeitzone im Lastgang daneben. Der `Pick<…>`
 * wächst also NICHT — ein Feld ohne nachweisbare Verwendung kommt nicht dazu, nur weil ein Schritt
 * drei Bilder bringt. `representativeDays` insbesondere hängt an `dispatchTrace` und braucht keine
 * eigene Zeile, genau wie `capKwByPeriod` in B23c-2.
 *
 * ── B23c-3b-1: ZUM DRITTEN MAL UNVERÄNDERT — UND DAS IST AUSGEZÄHLT, NICHT ANGENOMMEN ──────────
 * Der naheliegende Schluss wäre gewesen, den `Pick<…>` um `batteryFlowByHourMonth` und
 * `monthlyChargePrice` zu erweitern. Beide sind aber KEINE Felder von `AnalysisResult`, sondern
 * von `DispatchTrace` — und der hängt an `perBattery` bzw. `existingBatteryAnalysis.entry`, die
 * beide bereits oben stehen. Nachgezählt liest das Kapitel „Das Ladeverhalten Ihres Speichers"
 * genau drei Wege:
 *   • `existingBatteryAnalysis` → im Bestandsfall der primäre Eintrag (`primaryEntryOf`);
 *   • `perBattery` + `recommendation` → sonst derselbe Eintrag über die Empfehlung;
 *   • dessen `dispatchTrace.batteryFlowByHourMonth` bzw. `.monthlyChargePrice` → die zwei Bilder.
 *
 * Ein Feld hier zu ergänzen, das gar nicht auf dieser Ebene liegt, wäre eine Zeile, die eine
 * Abhängigkeit BEHAUPTET, die es nicht gibt — und die nächste Lesung des Typs zöge daraus den
 * falschen Schluss, welche Teile des Contracts das Dokument tatsächlich braucht.
 *
 * ── B23c-3b-2: ZUM VIERTEN MAL UNVERÄNDERT — WIEDER AUSGEZÄHLT ────────────────────────────────
 * Der naheliegende Schluss wäre gewesen, den `Pick<…>` um `addonScenarios` zu erweitern. Das Feld
 * ist aber KEINES von `AnalysisResult`, sondern von `ExistingBatteryAnalysis` — und die hängt an
 * `existingBatteryAnalysis`, das bereits oben steht (dieselbe Lage wie `batteryFlowByHourMonth`
 * unter `dispatchTrace` in B23c-3b-1). Nachgezählt liest das Kapitel „Speichergrösse und
 * Gerätewahl" genau vier Wege:
 *   • `existingBatteryAnalysis.addonScenarios` → im Bestandsfall die Punkte der Kurve und die
 *     Zeilen der Tabelle;
 *   • `perBattery` → sonst dieselben, aus dem Katalog-Lauf;
 *   • `recommendation` → welcher Kandidat aus der Alternativentabelle herausfällt;
 *   • `assumptions.horizonYears` → die Achse der Kurve, die Spaltenüberschrift und der Klarsatz.
 *
 * Alle vier stehen bereits hier. Ein Feld zu ergänzen, das gar nicht auf dieser Ebene liegt, wäre
 * eine Zeile, die eine Abhängigkeit BEHAUPTET, die es nicht gibt — und die nächste Lesung des Typs
 * zöge daraus den falschen Schluss, welche Teile des Contracts das Dokument tatsächlich braucht.
 *
 * ── B23c-4: DER TYP WÄCHST UM GENAU EIN FELD — `dataQuality`, AUSGEZÄHLT ──────────────────────
 * Zum ersten Mal seit B23c-1 kommt eine Zeile dazu, und sie ist erarbeitet und nicht angenommen.
 * Das Schlusskapitel und die drei Hinweise bei der Kern-Kennzahl lesen zusammen:
 *   • `dataQuality.coveredMonths` → der Teiljahres-Hinweis (mit `assumptions.billingModel`),
 *   • `dataQuality.largestGapSlots` → der Datenlücken-Hinweis,
 *   • `dataQuality.coveredDays`/`gapsInterpolated`/`warnings` → der Datenqualitäts-Kasten,
 *   • `assumptions` (Abrechnungsmodell, Horizont, Arbeitspreis, Einspeisevergütung, Wirkungsgrad)
 *     → die Annahmen-Tabelle,
 *   • `perBattery` + `recommendation` → das Gerät dieser Tabelle (Preis, Investition,
 *     Nettoinvestition, `taxEffectsIncluded`),
 *   • `tariffOptimization` → der strukturierte Blocker-Befund (`side`/`kind`/`ranges`).
 *
 * Nur `dataQuality` fehlte; die übrigen fünf standen bereits hier. Der vierte Hinweis dieser Seite
 * — das Standardprofil — hängt an `loadProfile.source` und damit nicht am Ergebnis, s. unten.
 */
export type PdfReportAnalysis = Pick<
  AnalysisResult,
  | 'current'
  | 'perBattery'
  | 'recommendation'
  | 'assumptions'
  | 'tariffOptimization'
  | 'existingBatteryAnalysis'
  | 'dataQuality'
>

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
  /**
   * B23c-1 — das gerechnete Ergebnis, aus dem die Kernergebnis-Seite entsteht (`summary.ts`).
   *
   * PFLICHT und nicht optional: einen Report ohne Ergebnis gibt es nicht. Optional gemacht wäre
   * die Kernergebnis-Seite ein Zustand, den irgendein Aufrufer versehentlich herstellen kann —
   * und das Dokument trüge dann wieder die Platzhalter-Seite, die dieser Schritt gerade ersetzt.
   */
  analysis: PdfReportAnalysis
  /**
   * B23c-2 — der Lastgang, aus dem das Diagramm entsteht (`charts.tsx`).
   *
   * ── ⚠ WARUM ER NICHT AUS `analysis` KOMMT ────────────────────────────────────────────────────
   * `DispatchTrace` trägt bewusst KEINE Rohreihe: die Oberfläche besitzt den geparsten Lastgang
   * ohnehin client-seitig, und bis zu 35.040 Punkte ein zweites Mal durch den Contract zu schicken
   * wäre eine Kopie, die mit dem Original auseinanderlaufen kann. Genau derselbe Weg wie am
   * Bildschirm: `report.tsx` bekommt `loadProfile` als eigene Prop neben dem Ergebnis.
   *
   * ── ⚠ UND WARUM HIER KEIN `Pick<…>` STEHT ────────────────────────────────────────────────────
   * Gelesen werden `readings` und `timezoneMeta`. Die engere Signatur ginge trotzdem nicht: das
   * Bild entsteht aus der UNVERÄNDERTEN Produktionskomponente `LoadChart`, und deren Prop ist der
   * volle `LoadProfile` — sie dafür aufzuweichen hiesse, eine Bildschirm-Komponente für den
   * PDF-Weg anzufassen (Contract-Entscheidung 1, D2: es gibt genau eine Zeichenimplementierung).
   *
   * PFLICHT: einen Report über einen Lastgang, den es nicht gibt, gibt es nicht. Optional gemacht
   * wäre „Report ohne Diagramm" ein Zustand, den ein Aufrufer versehentlich herstellen kann.
   */
  loadProfile: LoadProfile
  /**
   * B23c-4 — welcher Tarifsatz-Stand dieser Rechnung zugrunde lag (B11). `null` = kein
   * hinterlegter Stand gewählt.
   *
   * ── ⚠ WARUM ER NICHT AUS `analysis` KOMMT ────────────────────────────────────────────────────
   * Er steht nicht im `AnalysisResult`: die Engine rechnet mit TARIFWERTEN und nicht mit ihrer
   * Herkunft. Am Bildschirm ist es genauso — `report.tsx` bekommt `tariffSource` als eigene Prop
   * neben dem Ergebnis, abgeleitet aus der Auswahl des Nutzers und den tatsächlich gerechneten
   * Werten (`buildTariffSourceRef`).
   *
   * ⚠ PFLICHT und `null`-fähig, nicht optional: „kein Stand gewählt" ist eine AUSSAGE (der Kunde
   * hat die Werte aus seiner Netzrechnung eingetragen — die bessere Grundlage, Prinzip 1) und
   * etwas anderes als „diese Angabe wurde vergessen". Optional gemacht liessen sich die beiden
   * nicht mehr unterscheiden.
   */
  tariffSource: TariffSourceRef | null
  /**
   * B23c-4 — auf welchem Preisstand Arbeitspreis und Grundgebühr beruhen. `null` = kein Hinweis.
   *
   * Fertig abgeleitet, genau wie `period`, `subtitle` und `printedAt`: die Aussage hängt an einem
   * STICHTAG, und `derive.ts` ist die Stelle, an der solche Grössen entstehen
   * (`tariffVintageNote(loadProfile, tariff, now)`). Der Alternativweg — den Zeitpunkt hier ein
   * zweites Mal zu führen, neben dem bereits formatierten `printedAt` — wären zwei Felder für
   * denselben Augenblick, die auseinanderlaufen können.
   *
   * ⚠ Deshalb steht hier auch KEIN `tariff`-Feld: die Grundgebühr wird ausschliesslich für diesen
   * einen Satz gelesen, und sie wird in `derive.ts` gelesen. Ein Feld, das nur weitergereicht
   * würde, behauptete eine Abhängigkeit des Dokuments, die es nicht gibt.
   */
  tariffVintage: string | null
  /**
   * B23c-5 — die Zusammenfassung der GESCHÄTZTEN PV-Erzeugung (B22b), falls eine übernommen wurde.
   *
   * `undefined` heisst „nicht geschätzt" — dann erscheint der Hinweis gar nicht, und das Dokument
   * verhält sich Zeile für Zeile wie vor diesem Schritt. Ausdrücklich KEIN Platzhaltertext: „keine
   * PV geschätzt" wäre eine Aussage über eine Frage, die nie gestellt wurde.
   *
   * ── ⚠ WARUM DAS EIN EIGENSTÄNDIGES FELD IST UND NICHT IN `PdfReportAnalysis` GEHÖRT ───────────
   * Es steht nicht im `AnalysisResult`, und zwar an keiner Stelle: die Engine bekommt einen
   * fertigen Lastgang, dem die geschätzte Erzeugung bereits abgezogen ist (`applyEstimatedPv`,
   * B22a) — WOMIT geschätzt wurde, erfährt sie nie. `loadProfile.pvSource` sagt allein, DASS
   * geschätzt wurde; Standort, Nennleistung, Wetterjahre und die gemessene Streuung stehen
   * ausschliesslich hier. Am Bildschirm ist es genauso eine eigene Prop neben dem Ergebnis
   * (`report.tsx`), und aus demselben Grund.
   *
   * ⚠ Eine aus `pvSource` gebaute Kurzfassung wäre deshalb keine Abkürzung, sondern eine ZWEITE
   * Formulierung desselben Befunds ohne seine Zahlen (D16) — genau die Doppelung, die D17 als
   * offenen Punkt benannt und ausdrücklich nicht gebaut hat.
   *
   * ⚠ OPTIONAL und nicht `null`-fähig: anders als `tariffSource` gibt es hier keine zweite,
   * eigenständige Aussage („kein Stand gewählt" ist eine Angabe, „nicht geschätzt" ist die
   * Abwesenheit einer Frage). Ein Aufrufer, der nichts geschätzt hat, lässt das Feld weg.
   */
  estimatedPv?: EstimatedPvSummary
}
