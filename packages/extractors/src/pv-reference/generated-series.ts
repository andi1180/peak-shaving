import { expandReferenceToTimestamps } from 'engine'

/**
 * DIE GESCHÄTZTE PV-ERZEUGUNGSREIHE, WIE SIE ABGELEGT WIRD — Summe über die Flächen, aufgelegt auf
 * die ECHTEN Zeitstempel des Lastgangs, serialisiert.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DAS IST EINE UMKEHRUNG: DIE KURVE WIRD JETZT GESPEICHERT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `fetch.ts` nebenan hat bis hierher ausdrücklich KEINE Reihe herausgelassen — „was der Wizard
 * speichert, sind Eingaben; die Kurve entsteht zur Rechenzeit neu". Diese Begründung trägt nicht
 * mehr, seit die Reihe GERECHNET werden soll: eine zur Rechenzeit neu geholte Kurve wäre ein
 * zweiter PVGIS-Abruf mit möglicherweise anderen Wetterjahren, und die Analyse eines Kunden hinge
 * damit an der Tagesform eines fremden Dienstes (B14-1 Regel a: eine einmal abgegebene Auslegung
 * wird nicht nachgerechnet). Gespeichert ist sie einmal, und jede spätere Rechnung liest dasselbe.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE ZEITSTEMPEL WERDEN VERBATIM ÜBERNOMMEN — die tragende Zusage dieses Moduls
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Sie werden weder neu formatiert noch aus `coveredFrom` + Intervall rekonstruiert, sondern als
 * dieselben Zeichenketten weitergereicht, die der Lastgang trägt. Der Grund steht im Kopf von
 * `pv-generation/couple.ts`: die Zuordnung Erzeugung ↔ Verbrauch läuft über einen exakten
 * ISO-String-Vergleich (`alignPvGrossToLoad`), und eine neu gebildete, auch nur anders
 * geschriebene Zeichenkette liesse sie still ins Leere laufen. Eine Rekonstruktion aus dem
 * Intervall wäre zusätzlich an jedem Sommerzeit-Tag falsch.
 *
 * ── ⚠ WARUM JSON UND NICHT CSV ────────────────────────────────────────────────────────────────
 * Die Datei ist keine Kundendatei, sondern unsere eigene. Sie durch die Spalten- und
 * Vorzeichenerkennung des CSV-Lesers zu schicken hiesse, eine Reihe zu RATEN, die wir selbst
 * geschrieben haben — und die zwei Metadaten darunter hätten dort gar keinen Platz: sie müssten
 * als Kommentarzeilen mitreisen, die kein Leser dieses Repos auswertet.
 *
 * ⚠ DIE ZWEI METADATEN REISEN MIT DER REIHE UND NICHT NUR IM ENTWURF. Der Entwurf eines Zählpunkts
 * wird überschrieben, ersetzt und (beim Wechsel der PV-Antwort) geleert; die Datei bleibt. Wer sie
 * 2028 öffnet, soll ihr ansehen, auf welchem Jahrzehnt sie beruht und dass sie systematisch leicht
 * optimistisch ist — dieselbe Regel wie bei den eingefrorenen Wetterjahren im Entwurf
 * (`pv-profile-draft.ts`).
 *
 * REIN: kein `server-only` (nichts wird geholt, nichts übertragen — dieselbe Ausnahme wie beim
 * Standardprofil-Erzeuger), keine Uhr, kein Zufall. Gleiche Eingabe → bit-identische Ausgabe.
 */

/**
 * Die Kennung des Austauschformats. Sie steht IN der Datei, damit ein Leser nicht am Dateinamen
 * raten muss, was er vor sich hat — und damit eine spätere Fassung erkennbar ist, statt still
 * anders gelesen zu werden.
 */
export const GENERATED_PV_SERIES_FORMAT = 'coolin.pv-generated-series.v1'

/** Der Name, unter dem die Reihe in `platform.project_documents` liegt. */
export const GENERATED_PV_SERIES_FILENAME = 'pv-erzeugung-geschaetzt.json'

export const GENERATED_PV_SERIES_MEDIA_TYPE = 'application/json'

/** Der Inhalt der abgelegten Datei. */
export type GeneratedPvSeriesDocument = {
  format: typeof GENERATED_PV_SERIES_FORMAT
  /** Die gemittelten Wetterjahre, wie PVGIS sie geliefert hat — eingefroren, nicht nachgeschlagen. */
  weatherYears: { from: number; to: number }
  /** Der systematische Aufschlag der Glättung in Prozent (s. `PvArrayReferenceSummary`). */
  smoothingOptimismPercent: number
  /**
   * Ein Wert je Slot des Lastgangs, in derselben Reihenfolge. `ts` ist die ZEICHENKETTE des
   * Lastgangs, nicht eine daraus gebildete — s. Kopf. Die Form ist die von `PvReading`
   * (`packages/shared`), damit ein Leser sie ohne Umbau an die Engine weitergeben kann.
   */
  readings: { ts: string; pvGenerationKw: number }[]
}

/** Die fertige Datei, so wie sie der Ablage übergeben wird. */
export type GeneratedPvSeriesFile = {
  filename: string
  contentType: string
  /** Der serialisierte Inhalt. */
  text: string
  /** Anzahl der Werte — gleich der Länge des Lastgangs. */
  readingCount: number
}

/**
 * Summiert die Stundenreihen mehrerer Modulflächen Zelle für Zelle.
 *
 * ⚠ ERST SUMMIEREN, DANN AUFLEGEN — und nicht umgekehrt. Beide Reihenfolgen ergäben hier dieselbe
 * Zahl (die Expansion ist eine Treppenfunktion, also linear), aber nur diese Richtung macht die
 * Summe zu dem, was sie ist: EINE Anlagenkurve mit 8.760 Zellen. Je Fläche expandiert und danach
 * addiert liefen N Reihen von je 35.040 Werten durch den Speicher, und die Zwischengrösse, die man
 * prüfen kann, entstünde gar nicht.
 *
 * ⚠ SIE IST DIE ENTSPRECHUNG ZU `combinePvArrayYields` (`apps/web/lib/admin/pv-estimate.ts`) auf
 * der ZEIT-Achse: dort werden die Jahreserträge je Wetterjahr summiert, hier die Leistung je
 * Kalenderstunde. Beide beantworten dieselbe Frage — „was leistet das ganze Dach?" — und beide
 * beantworten sie durch Summieren, nicht durch Mitteln.
 *
 * @throws wenn keine Reihe übergeben wird oder die Längen auseinandergehen. Das ist ein
 *   Programmfehler des Aufrufers und kein Datenzustand: jede Reihe kommt aus
 *   `buildPvReferenceProfile` und hat deshalb genau 8.760 Zellen. Auf die kürzere Länge zu kürzen
 *   hiesse, einen Teil des Jahres ohne einen Teil der Anlage zu rechnen — im Ergebnis sähe das wie
 *   ein trüber Herbst aus (dieselbe Überlegung wie in `applyEstimatedPv`).
 */
export function sumReferenceHourlySeries(series: readonly (readonly number[])[]): number[] {
  const first = series[0]
  if (first === undefined) {
    throw new Error('sumReferenceHourlySeries: keine Modulfläche übergeben.')
  }

  const total = [...first]
  for (let s = 1; s < series.length; s += 1) {
    const next = series[s] ?? []
    if (next.length !== total.length) {
      throw new Error(
        `sumReferenceHourlySeries: Fläche ${s + 1} hat ${next.length} Stundenwerte, ` +
          `Fläche 1 hat ${total.length}.`,
      )
    }
    for (let i = 0; i < total.length; i += 1) {
      total[i] = (total[i] ?? 0) + (next[i] ?? 0)
    }
  }
  return total
}

/**
 * Baut die abzulegende Datei: Flächen summieren, auf die Zeitstempel des Lastgangs legen,
 * serialisieren.
 */
export function buildGeneratedPvSeriesFile(input: {
  /** Die 8.760er-Reihen der einzelnen Modulflächen, in der Reihenfolge des Entwurfs. */
  hourlySeries: readonly (readonly number[])[]
  /** Die Zeitstempel des Lastgangs, in seiner Reihenfolge — VERBATIM, s. Kopf. */
  timestamps: readonly string[]
  weatherYears: { from: number; to: number }
  smoothingOptimismPercent: number
}): GeneratedPvSeriesFile {
  const hourlyKw = sumReferenceHourlySeries(input.hourlySeries)
  // Treppenfunktion, keine Interpolation — die Regel steckt in `expandReferenceToTimestamps`.
  const values = expandReferenceToTimestamps({ hourlyKw }, input.timestamps)

  const document: GeneratedPvSeriesDocument = {
    format: GENERATED_PV_SERIES_FORMAT,
    weatherYears: input.weatherYears,
    smoothingOptimismPercent: input.smoothingOptimismPercent,
    // ⚠ `ts` ist die übergebene Zeichenkette selbst. Hier wird nichts geparst und nichts formatiert.
    readings: input.timestamps.map((ts, i) => ({ ts, pvGenerationKw: values[i] ?? 0 })),
  }

  return {
    filename: GENERATED_PV_SERIES_FILENAME,
    contentType: GENERATED_PV_SERIES_MEDIA_TYPE,
    text: JSON.stringify(document),
    readingCount: document.readings.length,
  }
}
