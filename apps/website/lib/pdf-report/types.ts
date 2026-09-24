import type { PvOutageMonth } from 'engine'
import type {
  AnalysisResult,
  BatteryCatalogMeta,
  DisplayPriceBasis,
  EstimatedPvSummary,
  LoadProfile,
  NetzbetreiberId,
  PvStage,
  ReportSectionSelection,
  TariffSourceRef,
} from 'shared'

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
 *
 * ── D9: DER TYP WÄCHST UM GENAU EIN FELD — `annualProjection`, AUSGEZÄHLT ────────────────────
 * Der Einschränkungs-Hinweis des Schlusskapitels (`basis.ts`, `buildLimitations`) trägt einen
 * bedingten Punkt über die Jahres-Hochrechnung, und die Bedingung IST dieses Feld. Alles Übrige,
 * was die beiden neuen D9-Abschnitte lesen, stand bereits hier: `tariffOptimization` (ob der
 * Tarifvergleich berechenbar war), `perBattery`/`recommendation`/`existingBatteryAnalysis` (ob ein
 * Speicher durchgerechnet wurde). Der PV-Befund hängt an `hasPv`/`pvOutageMonths` und damit nicht
 * am Ergebnis.
 *
 * ⚠ HEUTE SETZT ES KEIN AUFRUFER. Die Hochrechnung ist gerechnet (D6 Teil 2b), aber von keinem Weg
 * in eine Übergabe an dieses Dokument verdrahtet — das ist D4/D10. Das Feld steht trotzdem hier und
 * nicht als Kommentar „später ergänzen": es ist die Bedingung, unter der der Satz von selbst
 * entsteht, sobald die Verdrahtung kommt.
 *
 * ── D6 TEIL 3: DER TYP WÄCHST UM GENAU EIN FELD — `annualScenario`, AUSGEZÄHLT ───────────────
 * Das Kapitel „Was wäre, wenn wir ein ganzes Jahr hätten?" (`annual-scenario.ts`) liest zusammen:
 *   • `annualScenario` → die Jahresbeträge je Weg, die Referenzwoche und das Jahresfenster;
 *   • `tariffOptimization` → über `buildWaysChapter`, WELCHE Wege dieser Kunde hat (die Zeilen der
 *     Tabelle werden davon übernommen und nicht zweitausgewertet);
 *   • `perBattery`/`recommendation`/`existingBatteryAnalysis` → über `peakShavingSavingOf`, ob
 *     Weg 5 zutrifft.
 *
 * Nur `annualScenario` fehlte; die übrigen standen bereits hier. ⚠ ANDERS ALS `annualProjection`
 * darüber IST es verdrahtet: `runAnalysisFromMeteringPointDraft` setzt es, sobald der Preis-Port
 * gesetzt ist und die Hochrechnung gebildet werden konnte.
 *
 * ── „IHRE PV-ANLAGE": DER TYP WÄCHST UM GENAU EIN FELD — `pvValue`, AUSGEZÄHLT ────────────────
 * Das Kapitel (`pv-value.ts`) liest AUSSCHLIESSLICH `pvValue`: die beiden Kostenseiten, die
 * Jahres-Hochrechnung und die Monatsmengen stehen alle darin, und ob es das Kapitel gibt, steht
 * ebenfalls darin (`hasPvValueChapter`). Weder `hasPv` noch `pvStage` noch `pvOutageMonths` kommen
 * dafür in Frage — die Bedingung ist auf der Schreibseite bereits gefallen, und eine zweite
 * Fassung davon hier liefe von ihr weg.
 *
 * ⚠ DAS FELD MUSS IN `reduceAnalysis` MIT — es ist auf `AnalysisResult` OPTIONAL, ein `Pick<…>`
 * wäre also auch ohne es erfüllt, und es fiele in der Verengung still weg. Genau das ist mit
 * `annualScenario` bereits passiert (#320); `Complete<…>` dort macht das Weglassen seither zu
 * einem Compile-Fehler.
 */
export type PdfReportAnalysis = Pick<
  AnalysisResult,
  | 'current'
  | 'perBattery'
  | 'recommendation'
  /* K3b-2 — der Grund, warum keine Empfehlung dasteht. Optional auf `AnalysisResult` und deshalb
     ein Fall für `Complete<…>` in `reduceAnalysis` (s. dort, die #320-Lehre). */
  | 'noRecommendationReason'
  | 'assumptions'
  | 'tariffOptimization'
  | 'existingBatteryAnalysis'
  | 'annualProjection'
  | 'annualScenario'
  | 'pvValue'
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

/**
 * D12 — DER DRITTE ZUSTAND DER TARIFHERKUNFT: „nicht im Einzelnen nachverfolgt".
 *
 * Bis hierher kannte das Dokument genau zwei Antworten auf die Frage, woher Leistungspreis,
 * Abrechnungsmodell und Mindestleistung stammen: ein `TariffSourceRef` (aus einem geprüften Stand
 * der Tarifschicht, mit Netzbetreiber, Netzebene und der Liste der überschriebenen Felder) oder
 * `null`. Und `null` ist KEINE Leerstelle, sondern eine Aussage — der Kunde hat die Werte aus
 * seiner eigenen Netzrechnung eingetragen, und das ist die BESSERE Grundlage (Prinzip 1). Genau so
 * steht es auch im Report (`basis.ts`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DER WIZARD-WEG PASST IN KEINE DER BEIDEN ANTWORTEN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ein Zählpunkt-Entwurf trägt die Tarifwerte als blanke Zahlen. Sie können aus einer eingelesenen
 * Netzrechnung stammen, aus einer Handeingabe, oder aus dem Preisblatt-Vorschlag des
 * Netzbetreibers — der Entwurf hält nicht fest, welches davon. `null` dafür zu setzen behauptete
 * die erste Herkunft („stammen unverändert aus Ihrer Eingabe") und wäre in zwei von drei Fällen
 * schlicht falsch; ein erfundener `TariffSourceRef` behauptete die zweite und wäre in allen drei
 * falsch. Die ehrliche Antwort ist die dritte, und sie muss es als eigener Wert geben.
 *
 * ⚠ EIN STRING-LITERAL UND KEIN `undefined`/LEEROBJEKT: er ist von `null` und von jedem
 * `TariffSourceRef` STRUKTURELL unterscheidbar (`typeof === 'string'`), und eine bestehende
 * `null`-Prüfung kann ihn nicht versehentlich mit einer der beiden anderen Antworten verwechseln.
 * Ein `undefined` dagegen liesse „nicht nachverfolgt" und „Feld vergessen" wieder zusammenfallen —
 * genau die Verwechslung, wegen der `tariffSource` oben schon Pflicht und nicht optional ist.
 *
 * ⚠ ER IST AUSDRÜCKLICH NICHT „AUS GEPRÜFTEM TARIFKATALOG". Sobald der Wizard-Weg eine echte
 * Katalog-Verknüpfung trägt (offener Schritt, `grid-tariff-lookup.ts`), gehört dort ein
 * vollständiger `TariffSourceRef` hin — dieser Wert ist die Antwort für die Zeit davor und für
 * jeden Entwurf, der die Verknüpfung auch danach nicht hat.
 */
export const TARIFF_SOURCE_UNTRACKED = 'untracked' as const

/** Die drei Antworten auf „woher stammen die Tarifsätze?" — s. `TARIFF_SOURCE_UNTRACKED`. */
export type PdfReportTariffSource = TariffSourceRef | typeof TARIFF_SOURCE_UNTRACKED | null

/**
 * Woher dieser Erzeugungslauf stammt — das Signal, an dem zwei Kundentexte hängen (`content.ts`):
 * die Demo-Fusszeile (nur `demo`) und der Datenschutz-Absatz „Ihre Verbrauchsdaten haben Ihren
 * Rechner nicht verlassen" (nur `client`, da im Admin-/Übergabe-Pfad die Daten den Browser des
 * Kunden nie sehen). `undefined` gilt als keins von beiden — der sichere Standard für Prüfstände
 * und Tests, die diese Frage nicht stellen.
 */
export type PdfReportOrigin = 'client' | 'transfer' | 'demo'

/** Der Abrechnungszeitraum EINER gelesenen Kundenrechnung (`InvoiceExtraction`, Teilmenge). */
export type PdfReportInvoicePeriod = {
  /** ISO-Datum `YYYY-MM-DD`. `null` = die Rechnung nennt keinen Beginn. */
  from: string | null
  /** ISO-Datum `YYYY-MM-DD`. `null` = die Rechnung nennt kein Ende. */
  to: string | null
  /**
   * `true` = aus einer Jahresrechnung ABGELEITET, `false` = auf dem Papier ausgeschrieben,
   * `null` = es gibt keinen Zeitraum. ⚠ Die Unterscheidung fährt mit, weil sie den Wert der Angabe
   * bestimmt: ein abgeleiteter Zeitraum ist eine Annahme und darf in der Datenquellen-Tabelle nicht
   * wie eine abgelesene Angabe dastehen (s. `InvoiceExtraction.billingPeriodAssumed`).
   */
  assumed: boolean | null
}

/**
 * D9 — die ROHEN Herkunftsangaben der Tarifseite, für die Datenquellen-Tabelle.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ SIE SIND KEINE ANTWORT AUF `tariffSource` UND MACHEN AUS `TARIFF_SOURCE_UNTRACKED` KEINE
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `tariffSource` beantwortet, WOHER Leistungspreis, Abrechnungsmodell und Mindestleistung stammen —
 * aus der Netzrechnung des Kunden, aus einem geprüften Stand der B11-Tarifschicht, oder unbekannt.
 * Das hier sind zwei andere Fragen: WELCHE Preisblatt-Zeile der Datenbank für diesen Zählpunkt
 * gepflegt war, und WELCHEN Zeitraum die gelesenen Rechnungen abdecken. Beide sind belegt, beide
 * gehören in eine Datenquellen-Tabelle — und keine von beiden sagt, welcher Wert am Ende gerechnet
 * wurde. Sie in `tariffSource` hineinzurechnen hiesse, eine Vorbelegung zur Messung zu erklären
 * (dieselbe Grenze, die `grid-tariff-lookup.ts` zieht: „die Funktion schlägt nur vor").
 *
 * ⚠ ALLES DARIN SIND WERTE UND KEINE VERWEISE — dieselbe Regel wie bei `platform.analyses`
 * (B14-1 Regel b): ein später gepflegtes Preisblatt darf eine bereits erzeugte Rechnung nicht still
 * umschreiben.
 */
export type PdfReportTariffProvenance = {
  /**
   * Die Gültigkeitsbeginne (ISO `YYYY-MM-DD`) ALLER Preisblatt-Zeilen aus `public.grid_tariffs`,
   * die in diese Rechnung eingingen — aufsteigend.
   *
   * ⚠ EINE LISTE UND KEIN EINZELWERT: ein Zwölf-Monats-Lastgang kann einen Tarifwechsel überqueren,
   * und dann gingen ZWEI Stände ein (s. `readGridTariffRowsForAnalysis`: „alle und nicht eine").
   * Nur den ersten zu nennen wäre eine Angabe, die für den halben Zeitraum nicht stimmt.
   *
   * ⚠ LEER heisst „für diese Kombination ist nichts gepflegt ODER es wurde nicht nachgesehen" —
   * beides führt in der Tabelle zu „nicht nachverfolgt", und keines davon behauptet einen Stand.
   */
  gridTariffValidFrom: string[]
  /** Die Abrechnungszeiträume der gelesenen Kundenrechnungen. Leer = keine Rechnung gelesen. */
  invoicePeriods: PdfReportInvoicePeriod[]
}

export type PdfReportInput = {
  /** `undefined` = weder Demo noch client-seitig erzeugt — s. `PdfReportOrigin`. */
  origin?: PdfReportOrigin
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
   * K3b: die Beiwerte des Katalogstands, gegen den gerechnet wurde — je Geräte-Kennung Preisstand
   * und Herkunft des Wirkungsgrads.
   *
   * OPTIONAL, und das ist eine Aussage: der Rechner (`apps/website`) liefert sie seit K3b mit, der
   * Wizard-Weg (`apps/web`, D12) noch nicht (K3c). Fehlen sie, benennt die Quellen-Tabelle die
   * Lücke weiterhin wörtlich, statt einen Preisstand zu behaupten, den niemand nachgeschlagen hat.
   */
  batteryCatalogMeta?: Record<string, BatteryCatalogMeta>
  /**
   * B23c-4 — welcher Tarifsatz-Stand dieser Rechnung zugrunde lag (B11). `null` = kein
   * hinterlegter Stand gewählt, `TARIFF_SOURCE_UNTRACKED` = Herkunft nicht nachverfolgt (s. dort).
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
  tariffSource: PdfReportTariffSource
  /**
   * D9-Vorgriff — der Netzbetreiber als ANGABE, wenn der Weg ihn kennt. `undefined` = keine Angabe;
   * dann steht der Tarifquellen-Satz wortgleich wie zuvor, ohne Platzhalter.
   *
   * ⚠ ER IST KEINE TARIFHERKUNFT und macht aus `TARIFF_SOURCE_UNTRACKED` keine: welcher Stand
   * gerechnet wurde, bleibt unbekannt (s. dort). Der Name beantwortet nur die Frage, WESSEN Netz
   * der Zählpunkt hängt — die auf einem weitergereichten Blatt sonst niemand beantworten kann.
   *
   * ⚠ GETYPT ALS `NetzbetreiberId` UND NICHT ALS FREITEXT: die Beschriftung entsteht daraus über
   * `NETZBETREIBER_LABELS` (`basis.ts`). Ein freier String liesse eine rohe Kennung wie
   * `wiener_netze` auf ein Kundendokument durchschlagen, wo sie wie ein Fehler aussähe.
   */
  netzbetreiber?: NetzbetreiberId
  /**
   * D9 — die rohen Herkunftsangaben der Tarifseite (s. `PdfReportTariffProvenance`).
   *
   * ⚠ OPTIONAL und nicht `null`-fähig: „dieser Weg führt die Angaben nicht" (der Chart-Prüfstand,
   * eine Übergabe aus einer Fassung vor D9) ist dasselbe wie „es gibt nichts zu sagen" — in beiden
   * Fällen steht in der Tabelle die ehrliche Leerstelle. Ein zweiter, davon unterscheidbarer
   * Zustand hätte keine eigene Anzeige und wäre damit eine Unterscheidung ohne Unterschied.
   */
  tariffProvenance?: PdfReportTariffProvenance
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
  /**
   * D5 — die ANGABE, ob es an diesem Zählpunkt eine PV-Anlage gibt.
   *
   * `undefined` heisst „die Frage wurde nie beantwortet" und ausdrücklich NICHT `false`: der
   * Wizard-Entwurf kennt beide Zustände getrennt (`readPvDraft`), und auf `false` gerundet stünde
   * im Report eine Aussage über den Kunden, die niemand gemacht hat. Beide führen dazu, dass der
   * PV-Befund unten unterbleibt — aber aus verschiedenen Gründen.
   */
  hasPv?: boolean
  /**
   * BESTEHT die Anlage schon, oder ist sie GEPLANT (`PV_STAGES`, `shared`)?
   *
   * ⚠ SIE ÄNDERT DIE LESART JEDER ZAHL IM REPORT, nicht nur ein Wort. Bei `'existing'` ist die
   * Erzeugung im gemessenen Netzbezug bereits enthalten; bei `'planned'` ist sie aus Standort und
   * Anlagendaten GESCHÄTZT und vom Lastgang abgezogen worden (`run-from-draft.ts`). „bestehend"
   * über einer geschätzten Wirkung zu schreiben wäre die teuerste Verwechslung dieses Kapitels.
   *
   * `undefined` heisst „kein `hasPv`" oder „eine Übergabe aus einer Fassung, die die Stufe noch
   * nicht führte" — dann gilt `'existing'` (der Zustand, den jeder vor dem 22.09.2026 erfasste
   * Zählpunkt trägt, s. `DEFAULT_PV_STAGE`).
   */
  pvStage?: PvStage
  /**
   * Die erfasste Nennleistung der PV-Anlage in kWp — die SUMME über alle Modulflächen des
   * Zählpunkt-Entwurfs.
   *
   * ⚠ SIE IST EINE ANGABE UND KEINE RECHENGRÖSSE. Die Engine bekommt einen Lastgang, in dem die
   * Erzeugung bereits steckt; wie gross die Anlage ist, erfährt sie nie und braucht es nicht. Der
   * Report braucht die Zahl für GENAU einen Halbsatz — „eine PV-Anlage (10,2 kWp)" in der
   * Zusammenfassung.
   *
   * ⚠ OPTIONAL und nicht `null`-fähig: „dieser Weg führt die Angabe nicht" (der Chart-Prüfstand,
   * eine ältere Übergabe) und „es wurde keine Nennleistung erfasst" führen beide dazu, dass der
   * Halbsatz ohne Klammerwert steht. Ein zweiter, davon unterscheidbarer Zustand hätte keine
   * eigene Anzeige.
   *
   * ⚠ SIE IST NICHT `estimatedPv.totalPeakPowerKwp`: jene Zahl gehört zu einer GESCHÄTZTEN
   * Erzeugungskurve und steht mit ihrer Herkunft im PV-Hinweis; diese hier ist die Anlage, die der
   * Kunde tatsächlich hat.
   */
  pvPeakPowerKwp?: number
  /**
   * D5 — Monate, in denen im Lastgang KEIN Mittagseinbruch messbar war (`detectPvOutageMonths`).
   *
   * ── ⚠ WARUM DER BEFUND HEREINGEREICHT WIRD, STATT HIER GERECHNET ZU WERDEN ────────────────────
   * Die Engine-Funktion ist rein und bekäme in `loadProfile` alles, was sie braucht — der Aufruf
   * stünde technisch eine Zeile weit weg. Er zöge aber `engine` in den Lazy-Chunk dieses Dokuments,
   * und über den Paket-Index damit den ganzen PARSER samt `papaparse` und `xlsx`. Der Report-Weg
   * liest nie eine Datei; er bekäme eine Tabellenkalkulations-Bibliothek in den Browser für eine
   * Funktion, die 40 Zeilen umfasst. Dieselbe Auflage, unter der diese Dateien schon `react-pdf`
   * und Recharts nicht anfassen dürfen (s. Kopf von `basis.ts`).
   *
   * Gerechnet wird deshalb dort, wo der Rechenkern ohnehin läuft: im Analyse-Lauf
   * (`packages/extractors`), und der Befund reist als WERT mit der Übergabe — wie das Ergebnis und
   * der Lastgang selbst. `import type` ist dabei zur Laufzeit nichts: der Typ wird beim Bauen
   * gelöscht, das Paket also nicht angefasst.
   *
   * ⚠ Leere Liste = „nichts gefunden"; `undefined` = „dieser Weg führt den Befund nicht" (etwa eine
   * Übergabe aus einer älteren Fassung). Beide führen zu keinem Hinweis, und keiner der beiden
   * behauptet, die Anlage sei in Ordnung.
   */
  pvOutageMonths?: PvOutageMonth[]
  /**
   * Report-Baukasten C — welche der abwählbaren Bausteine dieser Report zeigt
   * (`REPORT_OPTIONAL_SECTIONS`). `undefined` heisst ALLE.
   *
   * ⚠ OPTIONAL UND NICHT `null`-FÄHIG, und die Abwesenheit hat hier eine schärfere Bedeutung als
   * bei den Feldern darüber: eine Übergabe lebt 24 Stunden, es liegen zum Zeitpunkt jedes
   * Deployments also Zeilen ohne dieses Feld in `platform.report_render_requests`. Fiele die
   * Abwesenheit auf „nichts zeigen", verlöre ein bereits verschickter Report beim Öffnen jeden
   * davon. Die leere Liste ist davon unterschieden: sie ist die AUSGEÜBTE Wahl, alle abzuwählen.
   *
   * ⚠ SIE STEUERT NUR DIESE. Die übrigen Bausteine sind von ihr unerreichbar. `addon` gehört seit
   * B3-2b dazu: der Satz im Empfehlungs-Kapitel, der darauf verweist, trägt eine leere
   * Ersatzfassung und verschwindet mit ihm (`Report_Baukasten_B3-2_Plan.md` §4.2).
   */
  optionalSections?: ReportSectionSelection
  /**
   * H3 — in welcher Basis der Report Geldbeträge ZEIGT (`heim` inkl. USt, `gewerbe` netto).
   * Gerechnet ist immer netto; umgerechnet wird genau einmal am Eingang von `renderReportPdf`.
   * Fehlt die Angabe (ältere Übergabe), gilt netto — so stand es in jedem bisherigen Report.
   */
  priceDisplay?: DisplayPriceBasis
}
