import {
  pvArrayAzimuthDeg,
  summarizeAnnualYields,
  type AnnualYieldSpread,
  type CompassDirection,
} from 'shared'

/**
 * B24, Teil 1 — die ZUSAMMENFÜHRUNG mehrerer Modulflächen zu EINER Ertragsschätzung (Phase B).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE REGEL, DIE DIESES MODUL TRÄGT: ERST ÜBER DIE FLÄCHEN SUMMIEREN, DANN ZUSAMMENFASSEN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ein Zählpunkt trägt regelmässig mehrere Flächen (Pflichtenheft §3(b)), und PVGIS wird für jede
 * EINZELN gefragt — zwei verschieden ausgerichtete Flächen haben eine andere Tagesform als eine
 * gemittelte, und eine zusammengefasste Anfrage („10,2 kWp bei mittlerer Ausrichtung") wäre eine
 * gerechnete Zahl, die nirgends dasteht (`fetchPvArrayReferenceProfile`, Phase A).
 *
 * Damit stellt sich die Frage, wie aus N Antworten EINE Streuung wird. Die naheliegende Antwort ist
 * falsch, und zwar nicht ein bisschen:
 *
 *   FALSCH: die `spread`-Werte der Einzelflächen mitteln (oder sonst kombinieren).
 *   RICHTIG: die Jahreserträge JE WETTERJAHR über die Flächen SUMMIEREN — Jahr 2014 aller Flächen
 *            zusammen, Jahr 2015 aller Flächen zusammen — und erst aus diesen zehn Summen Mittel
 *            und Streuung bilden.
 *
 * ⚠ DER UNTERSCHIED IST PHYSIKALISCH UND NICHT NUMERISCH. Eine Ost- und eine Westfläche erleben
 * DASSELBE Wetterjahr; ein Jahr, das der einen schadet, kann der anderen nützen. Genau diese
 * Kompensation ist der Grund, warum ein Dach aus mehreren Ausrichtungen gleichmässiger liefert als
 * jede seiner Flächen — und sie verschwindet restlos, sobald man die Einzel-Streuungen mittelt. Die
 * ausgewiesene „± x %"-Angabe wäre dann zu GROSS, und zwar plausibel zu gross: niemand sähe der
 * Zahl an, dass sie eine Eigenschaft beschreibt, die die Anlage gar nicht hat.
 *
 * Der Test dazu ist bewusst so gewählt, dass die beiden Wege nicht bloss um ein paar Prozent
 * auseinanderliegen, sondern qualitativ: zwei Flächen, deren Jahressummen sich exakt aufheben,
 * ergeben richtig **0 %** und falsch rund 11 %.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WARUM DAS EIN EIGENES MODUL IST UND NICHT IN DER SERVER ACTION STEHT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Nicht aus Ordnungsliebe, sondern weil es dort nicht prüfbar wäre: `data-entry-actions-pv.ts`
 * trägt `'use server'`, und aus einer solchen Datei darf AUSSCHLIESSLICH Asynchrones exportiert
 * werden. Eine reine Funktion kann dort nicht herauskommen — sie wäre nur mittelbar über die Action
 * messbar, also nur zusammen mit Formular, Supabase-Attrappe und PVGIS-Attrappe. Genau die Regel,
 * auf die es hier ankommt, verdient eine Prüfung ohne diesen Apparat.
 *
 * Der zweite Grund ist die Doppelnutzung: `splitPvArrayDesigns` beantwortet „welche Fläche ist
 * vollständig?", und diese Frage stellen ZWEI Konsumenten mit entgegengesetzter Richtung — die
 * Station, um den Knopf gar nicht erst anzubieten, und die Action, um abzubrechen. Zweimal
 * ausgeschrieben liefen sie auseinander, und die Oberfläche böte einen Weg an, der nur scheitern
 * kann.
 *
 * REIN: kein `server-only`, kein `next/*`, kein Supabase-Client, KEIN Import aus
 * `packages/extractors` (das ist `server-only` und bräche den Build der Client-Komponente) und
 * KEINER aus `packages/engine` (`apps/web` hängt nicht daran — CLAUDE.md). Die PVGIS-Antwort kommt
 * deshalb als STRUKTURELLER Typ herein, nicht als importierter; TypeScript prüft die Zuordnung an
 * der Stelle, an der die Action sie übergibt.
 */

/**
 * Der Jahresertrag EINES Wetterjahres, wie ihn PVGIS geliefert hat.
 *
 * Strukturell und nicht importiert (s. Kopf): `AnnualYield` der Engine erfüllt genau diese Form.
 */
export type PvAnnualYield = { year: number; kwh: number }

/** Eine erfasste Modulfläche, wie sie im Entwurf steht — strukturell wie `PvArrayEntry`. */
export type PvArrayLike = {
  peakPowerKwp: number | null
  direction: CompassDirection | null
  slopeDeg: number | null
}

/**
 * Eine vollständige Fläche, fertig für PVGIS — OHNE Koordinate.
 *
 * ⚠ Die Koordinate fehlt bewusst: sie gehört dem PROJEKT (eine PLZ für alle Zählpunkte) und nicht
 * der Fläche. Sie hier mitzuführen hiesse, sie N-mal danebenzustellen und die Möglichkeit zu
 * schaffen, dass zwei Flächen desselben Daches an zwei Orten stehen. Die Action legt sie EINMAL
 * darüber.
 */
export type PvArrayDesignParts = {
  peakPowerKwp: number
  slopeDeg: number
  /** PVGIS-Konvention (0 = Süd), aus `pvArrayAzimuthDeg` — **nie** ein Kompassgrad. */
  azimuthDeg: number
}

export type PvArrayDesignSplit = {
  /** Die vollständigen Flächen, in der Reihenfolge des Entwurfs. */
  designs: PvArrayDesignParts[]
  /**
   * Die 1-basierten Nummern der Flächen, denen eine der drei Kenndaten fehlt.
   *
   * ⚠ NUMMERN UND NICHT DIE EINTRÄGE SELBST: die Nummer ist das Einzige, woran ein Mensch die
   * Zeile in der Zusammenfassung wiedererkennt — dort steht „Fläche 1", „Fläche 2". Ein Eintrag
   * mit lauter `null` gäbe in einer Meldung nichts her.
   */
  incompleteNumbers: number[]
}

/**
 * Trennt die erfassten Flächen in „vollständig" und „übersprungen".
 *
 * ⚠ VOLLSTÄNDIG HEISST: ALLE DREI KENNDATEN. Keine davon lässt sich aus den anderen erschliessen,
 * und für keine gibt es einen vertretbaren Vorgabewert — eine fehlende Neigung als 30° anzunehmen
 * wäre eine erfundene Zahl mit seriösem Etikett (dieselbe Regel wie bei einem nicht hinterlegten
 * Tarifsatz, B11). `0` ist dabei ausdrücklich eine ANGABE und kein fehlender Wert: ein flach
 * aufliegendes Modul hat 0° Neigung (`PV_ARRAY_NUMBER_FIELDS`, `min: 0`).
 *
 * ⚠ DIE UMRECHNUNG KOMPASS → PVGIS LÄUFT ÜBER `pvArrayAzimuthDeg` UND NIRGENDS SONST. Eine hier
 * abgetippte Formel wäre die teuerste Zeile dieses Moduls: eine verwechselte Konvention (PV*SOL
 * zählt vom Norden, PVGIS vom Süden) kostet gemessen 56 % der ausgewiesenen Ersparnis, und die
 * falsche Zahl sieht völlig plausibel aus — sie ist nur am Rücklauf von PVGIS zu erkennen (B22c).
 */
export function splitPvArrayDesigns(arrays: readonly PvArrayLike[]): PvArrayDesignSplit {
  const designs: PvArrayDesignParts[] = []
  const incompleteNumbers: number[] = []

  arrays.forEach((array, index) => {
    const { peakPowerKwp, slopeDeg, direction } = array
    if (peakPowerKwp === null || slopeDeg === null || direction === null) {
      incompleteNumbers.push(index + 1)
      return
    }
    designs.push({
      peakPowerKwp,
      slopeDeg,
      azimuthDeg: pvArrayAzimuthDeg({ peakPowerKwp, slopeDeg, direction }),
    })
  })

  return { designs, incompleteNumbers }
}

/** Was aus den Antworten ALLER Flächen zusammen herauskommt. */
export type CombinedPvYield = {
  /** Die aufsummierten Jahreserträge, aufsteigend nach Wetterjahr. */
  annualYields: PvAnnualYield[]
  /** Mittel, Spanne und die „± x %"-Angabe der SUMME — s. Kopf. */
  spread: AnnualYieldSpread
}

/**
 * Führt die Jahreserträge mehrerer Flächen zusammen: erst je Wetterjahr summieren, dann
 * zusammenfassen.
 *
 * ⚠ DIE WETTERJAHRE MÜSSEN IN ALLEN FLÄCHEN DIESELBEN SEIN, und das wird geprüft statt
 * vorausgesetzt. Über den Produktionsweg ist die Prüfung unerreichbar — `buildPvReferenceProfile`
 * weist eine Antwort ab, die nicht GENAU die angeforderten zehn Jahre trägt, und angefordert wird
 * für jede Fläche derselbe Satz. Sie steht trotzdem hier, weil der Fehlschlag sonst STILL wäre:
 * über den Index summiert (statt über das Jahr) stünde der Ertrag des Jahres 2015 der einen Fläche
 * neben dem des Jahres 2014 der anderen, die Summe wäre eine Zahl in plausibler Grössenordnung, und
 * niemand könnte ihr ansehen, dass sie zwei verschiedene Jahre addiert.
 *
 * @returns `null`, wenn gar keine Fläche übergeben wurde oder die Jahressätze auseinandergehen —
 *          beides heisst „keine Aussage", nicht „Ertrag 0".
 */
export function combinePvArrayYields(
  perArray: readonly (readonly PvAnnualYield[])[],
): CombinedPvYield | null {
  if (perArray.length === 0) return null

  const totals = new Map<number, number>()
  for (const [index, yields] of perArray.entries()) {
    if (yields.length === 0) return null
    // Ein Jahr, das innerhalb EINER Fläche doppelt käme, würde beim Summieren unbemerkt doppelt
    // zählen — die Mengenprüfung darunter fiele darauf nicht herein, die Summe schon.
    const seen = new Set<number>()
    for (const { year, kwh } of yields) {
      if (!Number.isFinite(kwh) || seen.has(year)) return null
      seen.add(year)
      if (index === 0) {
        totals.set(year, kwh)
        continue
      }
      const running = totals.get(year)
      // Ein Jahr, das die erste Fläche nicht kennt: die Sätze gehen auseinander — s. Kopf.
      if (running === undefined) return null
      totals.set(year, running + kwh)
    }
    // Und die Gegenrichtung: ein Jahr, das die erste Fläche kennt und diese nicht.
    if (seen.size !== totals.size) return null
  }

  const annualYields = [...totals.entries()]
    .map(([year, kwh]) => ({ year, kwh }))
    .sort((a, b) => a.year - b.year)

  /*
   * ⚠ ERST HIER, UND AUSDRÜCKLICH ÜBER DIE SUMMEN. `summarizeAnnualYields` ist dieselbe Funktion,
   * die Phase A je EINZELNER Fläche ruft — der Unterschied zwischen richtig und falsch liegt
   * nicht in ihr, sondern darin, WORÜBER sie läuft.
   */
  const spread = summarizeAnnualYields(annualYields.map((entry) => entry.kwh))
  if (spread === null) return null

  return { annualYields, spread }
}
