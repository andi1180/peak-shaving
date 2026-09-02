/**
 * Die Eingaben des kombinierten Intervallpreises (Delta 4) — Netzentgelt-Seite und Energiepreis-Seite.
 *
 * ── WARUM DIESE TYPEN IN `shared` STEHEN UND NICHT IN `engine` ──────────────────────────────────
 * Die Werte kommen aus der Datenbank (`public.grid_tariffs`, `public.spot_prices`), gelesen von
 * `apps/website/lib/tariff-data` (B21-3a). Der Rechenkern darf diese Datenschicht NICHT kennen —
 * „Konfiguration an den Rändern, Determinismus im Kern": eine Engine, die ihre eigenen Preise holt,
 * ist nicht mehr allein aus ihren Eingaben nachvollziehbar, und eine 2026 eingefrorene Baseline
 * (B14-1) belegte 2028 nichts mehr. Dieselbe Aufteilung wie beim `DEMO_BATTERY_CATALOG` und bei der
 * B11-Tarifschicht: die App reicht den Katalog als PARAMETER hinein.
 *
 * Abgesichert durch `packages/engine/src/tariff/no-data-layer-dependency.test.ts` — dem Zwilling
 * des B11-Wächters, nur für `@supabase/*` und `lib/tariff-data`.
 *
 * ── WARUM EIGENE TYPEN UND NICHT DIE DER DATENSCHICHT ──────────────────────────────────────────
 * Sie sind bewusst eine TEILMENGE der Felder, die `fetchGridTariffs`/`fetchSpotPrices` liefern: die
 * Engine braucht Gültigkeit, Zeitfenster, Preise und Preisbasis — nicht `operatorName`, nicht die
 * Datensatz-Kennungen, nicht `grundpreisUnit`. Weil TypeScript strukturell typisiert, ist das
 * Ergebnis der Datenschicht diesen Typen ohne jede Umwandlung zuweisbar; es entsteht keine zweite
 * Abbildung, die auseinanderlaufen könnte, und die Engine bekommt trotzdem nur das, was sie liest.
 */

import type { PriceBasis } from './tariff'

/**
 * Ein Zeitfenster einer Netzbetreiber-Tarifzeile (Delta 5) — SNAP heute, Winter sobald veröffentlicht.
 * Für die Engine sind beide keine Sonderfälle, sondern Fenster derselben Struktur wie die
 * `timeOfUseWindows` der Energiepreis-Seite.
 */
export type GridTariffWindowInput = {
  /** Bezeichnung aus dem Preisblatt (`normal`, `snap`, …) — reist in die Begründungstexte mit. */
  label: string
  /** 'MM-DD', jahreslos. `null` = ganzjährig. Über den Jahreswechsel laufende Saisons sind erlaubt. */
  monthDayFrom: string | null
  monthDayTo: string | null
  /** 'HH:MM' oder 'HH:MM:SS' (PostgreSQL `time`). `24:00:00` ist zulässig und meint Tagesende. */
  timeFrom: string
  timeTo: string
  ctPerKwh: number
}

/**
 * Eine effektiv datierte Tarifzeile samt ihren Zeitfenstern.
 *
 * ⚠ `validUntil` ist INKLUSIV — der letzte Gültigkeitstag steht in der Spalte
 * (`public.create_grid_tariff` schliesst die Vorgängerin mit `valid_from - 1`, B21-2b). Halboffen
 * gelesen fiele genau der letzte Tag jedes Stands heraus.
 */
export type GridTariffRowInput = {
  /** ISO-Datum, inklusiv. */
  validFrom: string
  /** ISO-Datum, INKLUSIV letzter Gültigkeitstag. `null` = weiterhin gültig. */
  validUntil: string | null
  /** Zeitunabhängiger Anteil des Netz-Arbeitspreises; kommt zu jedem Fensterpreis hinzu. */
  netzverlustCtPerKwh: number
  /**
   * Der Grundpreis der Tarifzeile — Delta 19, und er ist NUR in EINER seiner beiden Bedeutungen
   * eine hier verwertbare Zahl (s. `grundpreisUnit`).
   *
   * Optional, weil dieser Typ die Teilmenge beschreibt, die der Rechenkern liest, und ein Aufrufer
   * ohne Netz-Grundpreis (jeder bestehende Test, jede ältere Datenzeile) unverändert gültig bleiben
   * muss. Fehlt er, wird kein Netz-Fixkostenanteil eingerechnet — nicht ein geschätzter.
   */
  grundpreisAmount?: number
  /**
   * `'eur_per_year'`     = eine JAHRESPAUSCHALE des Netzbetreibers. Sie hat im Rechner sonst keinen
   *                        Ort (Delta 3: der Leistungspreis ist dann 0) und wird deshalb im
   *                        Monatsvergleich anteilig eingerechnet.
   * `'eur_per_kw_year'`  = der LEISTUNGSPREIS. Er ist bereits die Jahreszahl weiter oben im Report
   *                        und darf im Monatsvergleich ausdrücklich NICHT auftauchen — dort wäre er
   *                        zum einen doppelt gezählt, zum anderen bräuchte seine Verteilung auf
   *                        Monate eine Aufteilungsregel, die weder Preisblatt noch Pflichtenheft
   *                        hergeben (und die je Abrechnungsmodell anders ausfiele).
   *
   * Ein unbekannter Wert wird wie ein fehlender behandelt: es wird nichts eingerechnet.
   */
  grundpreisUnit?: string
  /** Delta 6: Pflichtangabe an der Quelle. Gerechnet wird durchgängig netto. */
  priceBasis: PriceBasis | string
  windows: GridTariffWindowInput[]
}

/** Ein Marktpreis-Eintrag. `tsEnd` ist exklusiv — die Dauer wird gemessen, nicht angenommen. */
export type SpotPricePointInput = {
  tsStart: string
  tsEnd: string
  ctPerKwh: number
  priceBasis: PriceBasis | string
}

/**
 * Die Marktpreis-Reihe für den Analysezeitraum, samt Lückenbefund (Delta 15, Regel C).
 *
 * `complete` steht bewusst NEBEN den Preisen und nicht in einem Fehlerfall: „gelesen, aber
 * unvollständig" ist ein Betriebszustand (ein Cron ist stehengeblieben, morgen behoben) und etwas
 * anderes als „nicht lesbar".
 */
export type SpotPriceSeriesInput = {
  prices: SpotPricePointInput[]
  complete: boolean
  missingRanges: TariffPriceRange[]
}

/** Ein zusammenhängender Zeitbereich. `fromIso` inklusiv, `toIso` exklusiv. */
export type TariffPriceRange = { fromIso: string; toIso: string }

/**
 * Alles, was der kombinierte Intervallpreis zusätzlich zum `TariffParams` braucht.
 *
 * ── DAS VORHANDENSEIN DIESES OBJEKTS IST DIE ANFORDERUNG ───────────────────────────────────────
 * Es gibt bewusst KEIN zusätzliches `requested`-Flag. Fehlt das Objekt, hat der Nutzer den
 * Tarifoptimierungs-Hebel nicht aktiviert — dann rechnet die Engine unverändert mit dem statischen
 * Fenster-Schema wie vor B21, und das ist kein Fehlerfall. Ist es da, wurde der Hebel angefordert:
 * dann ist ein `null` in einem der beiden Felder die Aussage „angefordert, aber nicht lesbar" und
 * führt zur ausdrücklichen Kennzeichnung „nicht berechenbar" — nicht zu einem stillen Rückfall auf
 * den statischen Preis. Zwei verschiedene Zustände, zwei verschiedene Antworten; ein Flag daneben
 * könnte ihnen widersprechen.
 */
export type TariffPricingInputs = {
  /** Alle Tarifzeilen, deren Gültigkeit den Analysezeitraum überschneidet. `null` = nicht lesbar. */
  gridTariffRows: GridTariffRowInput[] | null
  /** Die Marktpreis-Reihe des Analysezeitraums. `null` = nicht lesbar. */
  spotPrices: SpotPriceSeriesInput | null
}

/**
 * Warum der Tarifoptimierungs-Hebel für diese Analyse nicht berechenbar ist (Delta 15 Regel C, in
 * diesem Bauabschnitt symmetrisch auf die Netzentgelt-Seite erweitert).
 *
 * `side` sagt WELCHE Seite fehlt, `kind` WARUM, `ranges` WELCHER Zeitraum betroffen ist. Getrennt
 * statt als ein Textbaustein, damit die Oberfläche (Delta 9) daran verzweigen kann, ohne eine
 * Meldung parsen zu müssen.
 */
export type TariffOptimizationBlocker = {
  /** Netzentgelt- oder Spotpreis-Seite. */
  side: 'grid_tariff' | 'spot_price'
  /**
   * `gap`         — Daten vorhanden, decken den Zeitraum aber nicht vollständig ab.
   * `unavailable` — gar nicht lesbar (fehlende Auswahl, fehlende Umgebung, Abfrage gescheitert).
   * `price_basis` — vorhanden, aber nicht netto (Delta 6). Wird NICHT umgerechnet: dafür bräuchte
   *                 es einen Steuersatz, und einen zu erfinden ist derselbe Fehler wie eine
   *                 erfundene Tarifzahl (B11).
   */
  kind: 'gap' | 'unavailable' | 'price_basis'
  /** Konkret betroffene Zeitbereiche. Leer bei `unavailable` — dort fehlt alles, nicht ein Teil. */
  ranges: TariffPriceRange[]
  /** Fertig formulierte Begründung für `dataQuality.warnings` (§3.10) — eine Formulierung, ein Ort. */
  message: string
}

/**
 * Der Monatsvergleich „Ist-Tarif vs. aWATTar ohne Steuerung vs. aWATTar mit dem Speicher des
 * Kunden" (01.09.2026) — drei Kostenreihen über die zwölf Kalendermonate.
 *
 * ── ⚠ WARUM DIE DREI REIHEN GEMEINSAM ENTSTEHEN ODER GAR NICHT ─────────────────────────────────
 * Sie sitzen deshalb IM `computable: true`-Zweig und nicht als eigenes Feld daneben: alle drei
 * beruhen auf demselben kombinierten Intervallpreis (Marktpreis bzw. Ist-Arbeitspreis, je plus
 * Netzentgelt und Netzverlust). Ist der Hebel nicht berechenbar, gibt es KEINE davon — auch nicht
 * die Ist-Reihe, obwohl deren Energiepreis aus Schritt 2 stammt und für sich genommen bekannt
 * wäre: `intervalTariffRates` füllt die Preisreihe im nicht berechenbaren Fall bewusst
 * durchgehend mit dem Standard-Arbeitspreis, und eine daraus gebildete Aggregation zeigte dann
 * „aWATTar = Ist" statt „nicht berechenbar". Ein Balkenpaar, das Gleichstand behauptet, ist
 * schlimmer als eine fehlende Sektion.
 *
 * ── ⚠ MONATE OHNE MESSWERT SIND `null`, NICHT `0` ──────────────────────────────────────────────
 * Ein 0-Wert sähe aus wie „gemessen, kostet nichts". Die Anzeige spart solche Monate aus.
 *
 * ── ⚠ HIER WIRD NICHT AUF EIN JAHR HOCHGERECHNET ───────────────────────────────────────────────
 * `annualizationFactor` (§3.7.1) gilt ausdrücklich NICHT für diese Reihen: sie zeigen, was in den
 * tatsächlich gemessenen Monaten angefallen wäre. Ein hochgerechneter Monatsbalken wäre eine
 * Angabe über einen Monat, für den es keine Messung gibt.
 */
export type MonthlyTariffComparison = {
  /** Index 0 = Jänner. `null` = kein Messwert in diesem Kalendermonat. Länge immer 12. */
  currentTariffEur: (number | null)[]
  /** aWATTar-Preise auf den ROHEN, unveränderten Lastgang — ohne jeden Dispatch. */
  spotWithoutControlEur: (number | null)[]
  /** aWATTar-Preise auf den Netzbezug NACH dem Dispatch der bestehenden Anlage. */
  spotWithBatteryEur: (number | null)[]
  /** Zahl der belegten Kalendermonate — die Bezugsgrösse des Hinweistexts im Report. */
  coveredMonths: number
  /**
   * Die anteilig eingerechneten FIXKOSTEN (Delta 19) — Summen über die abgedeckten Tage, in Euro.
   *
   * ── ⚠ SIE STECKEN BEREITS IN DEN DREI REIHEN OBEN ──────────────────────────────────────────
   * Dieses Feld ist die Aufschlüsselung, nicht ein zusätzlicher Posten: wer die Zahlen hier zu
   * einem Balken addiert, zählt sie doppelt. Es steht da, damit der Report SAGEN kann, was in den
   * Balken steckt — ohne die Aufschlüsselung wäre die Sektion eine Zahl ohne Herkunft (Prinzip 5).
   */
  fixedCosts: MonthlyFixedCosts
}

/**
 * Was an verbrauchsUNABHÄNGIGEN Kosten in den Monatsreihen steckt (Delta 19).
 *
 * ── ⚠ ANTEILIG NACH TATSÄCHLICH ABGEDECKTEN KALENDERTAGEN ──────────────────────────────────────
 * Ein Lastgang, der am 20. eines Monats beginnt, trägt für diesen Monat elf Dreissigstel der
 * Monatsgebühr, nicht die ganze. Der volle Betrag stünde sonst neben Arbeitskosten, die nur elf
 * Tage abdecken — ein Monatsbalken, der zwei verschiedene Zeiträume mischt. Dieselbe Haltung wie
 * bei den `null`-Monaten: gezeigt wird, was gemessen ist.
 */
export type MonthlyFixedCosts = {
  /**
   * Netz-Grundpreis als Jahrespauschale (`grundpreisUnit === 'eur_per_year'`), anteilig.
   *
   * ⚠ Er steckt in ALLEN DREI Reihen und in jeder in derselben Höhe: derselbe Netzanschluss
   * bleibt derselbe Netzanschluss, egal von wem der Kunde seine Energie kauft. Er kürzt sich aus
   * jeder Differenz heraus — und genau deshalb darf er drin sein: er macht die absoluten
   * Monatszahlen richtig, ohne den Vergleich zu verschieben. `0`, wenn die Tarifzeile keine
   * Jahrespauschale trägt (dann ist ihr Grundpreis der Leistungspreis, s. `grundpreisUnit`).
   */
  networkBaseFeeEur: number
  /** Grundgebühr des HEUTIGEN Lieferanten — ausschliesslich in „Ihr Tarif heute". */
  supplierBaseFeeEur: number
  /** Grundgebühr von aWATTar — ausschliesslich in den beiden aWATTar-Reihen. */
  awattarBaseFeeEur: number
  /** Der zugrunde liegende Monatssatz des heutigen Lieferanten (0 = keine Angabe). */
  supplierFeeEurPerMonth: number
  /** Der zugrunde liegende Monatssatz von aWATTar. */
  awattarFeeEurPerMonth: number
  /**
   * Abgedeckte Kalendertage — die Bezugsgrösse der Anteiligkeit.
   *
   * ⚠ NICHT dasselbe wie `BatterySavings.coveredDays` (§3.7.1). Dort ist es
   * `round(Intervalle / 96)`, hier die Zahl der TATSÄCHLICH BERÜHRTEN Kalendertage in Ortszeit —
   * ein am Vormittag endender Lastgang berührt einen Tag mehr, als er volle Tage enthält, und
   * eine Monatsgebühr fällt für diesen angebrochenen Tag anteilig sehr wohl an. Gemessen an einem
   * 209-Tage-Lastgang: 209 dort, 210 hier. Die beiden Zahlen dürfen nicht gegeneinander
   * ausgetauscht werden.
   */
  coveredDays: number
}

/**
 * Ergebnis der Prüfung „lässt sich der Tarifoptimierungs-Hebel für diese Analyse rechnen?".
 * `undefined` an einer Stelle, die diesen Typ optional führt, heisst: gar nicht angefordert.
 */
export type TariffOptimizationStatus =
  | {
      computable: true
      /**
       * Additiv und optional (01.09.2026): der Monatsvergleich entsteht nur, wenn der Kunde eine
       * bestehende Anlage angegeben hat — die dritte Reihe braucht deren Dispatch. Fehlt das Feld,
       * ist der Hebel dennoch berechenbar; Präzedenz `tariffOptimization`/`existingBatteryAnalysis`
       * im `AnalysisResult`, und wie dort erzwingt das keinen `bundleVersion`-Sprung (B14-2).
       */
      monthlyComparison?: MonthlyTariffComparison
    }
  | ({ computable: false } & TariffOptimizationBlocker)

/**
 * ── Die Leistungsmessungs-Variante (Delta 5 / Delta 9) ──────────────────────────────────────────
 *
 * Spiegel des CHECK `metering_variant in (…)` aus B21-1. Sie steht hier und nicht in
 * `tariff-catalog.ts`: sie gehört zur DATENBANK-Seite der Netzentgelte (B21), nicht zur B11-
 * Vorgabewert-Tabelle im Code — und `tariff-pricing.ts` ist das Modul, das die Abfrage-Dimensionen
 * dieser Seite beschreibt.
 *
 * ⚠ `apps/web/lib/admin/grid-tariffs.ts` führt dieselbe Liste ein zweites Mal, für das
 * Admin-Pflegeformular (B21-2b). Das ist bewusst kein geteilter Import: der Admin-Bereich spiegelt
 * dort das gesamte Vokabular der Tabelle (Grundpreis-Einheiten, Preisbasis, Fenster-Vorschläge),
 * von dem der Rechner nichts braucht — und `NETZEBENEN` steht aus demselben Grund schon heute an
 * beiden Orten. Die harte Grenze ist in beiden Fällen der CHECK in der Datenbank; weicht eine der
 * Listen ab, wird der Wert dort abgewiesen. Eine Liste hier zu erweitern, ohne dass die Datenbank
 * ihn kennt, hiesse dagegen: die Abfrage findet nie eine Zeile.
 */
export const METERING_VARIANTS = [
  'mit_leistungsmessung',
  'ohne_leistungsmessung',
  'unterbrechbar',
] as const
export type MeteringVariant = (typeof METERING_VARIANTS)[number]

export const METERING_VARIANT_LABELS: Record<MeteringVariant, string> = {
  mit_leistungsmessung: 'mit Leistungsmessung',
  ohne_leistungsmessung: 'ohne Leistungsmessung',
  unterbrechbar: 'unterbrechbare Nutzung',
}

/**
 * Netzebenen, die überhaupt eine Variante anbieten (Delta 5: nach dem Wiener-Netze-Beispiel NE 7).
 *
 * Das ist keine Anzeigefrage. Bei NE 3–6 gehört `null` in die Spalte, und genau darauf ist der
 * `unique nulls not distinct`-Constraint aus B21-1 ausgelegt: `null` und `'mit_leistungsmessung'`
 * sind für die Effektiv-Datierung zwei verschiedene Kombinationen. Würde die Oberfläche für NE 3–6
 * eine Variante mitschicken, fände die Abfrage die gepflegte Zeile nicht — und der Hebel fiele mit
 * „keine Netzentgelt-Daten" aus, obwohl die Daten da sind.
 */
export const NETZEBENEN_MIT_MESSVARIANTE: readonly number[] = [7]

export function hasMeteringVariant(netzebene: number): boolean {
  return NETZEBENEN_MIT_MESSVARIANTE.includes(netzebene)
}
