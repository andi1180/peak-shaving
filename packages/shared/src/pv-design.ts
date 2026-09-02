/**
 * B22b — die PV-Auslegung, wie ein Mensch sie eingibt, und ihre Umrechnung in das, was PVGIS
 * versteht.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DER GRUND, WARUM ES DIESE DATEI GIBT: ZWEI AZIMUT-KONVENTIONEN, 56 % ERSPARNIS
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * PV*SOL zählt den Azimut vom **Norden** (Kompass: 0° = N, 180° = S), PVGIS von **Süden**
 * (0° = S, −90° = O, +90° = W). Ein Planungsdokument, das „Ausrichtung Südosten 133 °" schreibt,
 * meint als PVGIS-`aspect` **−47** und nicht 133. Ungeprüft übernommen zeigt die Anlage nach
 * **Nordwesten** — die Gegenrichtung.
 *
 * **In Euro gemessen** (Bestandsaufnahme 3.3; Wien, 10,2 kWp, 90°, H0 4.500 kWh, Speicher
 * 19,2 kWh / 10,6 kW, Arbeitspreis 25 ct, Einspeisevergütung 8 ct):
 *
 * | Auslegung                      | PV-Energie   | Eigenverbrauchs-Ersparnis |
 * |--------------------------------|--------------|---------------------------|
 * | 90° / aspect −47 (korrekt)     | 7.874 kWh/a  | **€ 384,69/Jahr**         |
 * | 90° / 133 ungeprüft übernommen | 3.353 kWh/a  | **€ 171,10/Jahr — −56 %** |
 * | 35° / Süd (naive Annahme)      | 12.051 kWh/a | € 360,26/Jahr — −6 %      |
 *
 * **Die falsche Zahl sieht völlig plausibel aus** (eine schlecht ausgerichtete Fassadenanlage) und
 * fiele niemandem als Fehler auf — dasselbe Muster wie der Faktor-10-Leistungspreis in B21-2a und
 * die Eur/MWh-Prüfung des aWATTar-Abrufs.
 *
 * ── DIE KONSEQUENZ FÜR DIE OBERFLÄCHE: EIN AUSWAHLFELD, KEIN ROHES GRADFELD ────────────────────
 * Der Nutzer wählt eine **Himmelsrichtung** und darf optional eine **Kompass-Gradzahl** danebenlegen.
 * Er sieht nie das Wort „aspect" und nie eine negative Zahl. Die Umrechnung geschieht an GENAU
 * EINER Stelle (`compassToPvgisAzimuth`), und die Gradzahl wird gegen die gewählte Richtung
 * gegengeprüft (`compassDegreeFitsDirection`) — wer „Nordwesten" wählt und 133 einträgt, bekommt
 * eine Rückfrage statt einer Anlage, die in die Gegenrichtung zeigt. Damit ist die Falle
 * **strukturell** abgefangen und nicht auf den Nutzer verlagert.
 *
 * ── ⚠ DER JAHRESERTRAG IST KEIN AUSREICHENDES PRÜFMASS ─────────────────────────────────────────
 * Dieselbe Messung zeigt: die naive Süd-35°-Annahme liefert **53 % mehr PV-Energie** und trotzdem
 * **6 % WENIGER** Ersparnis — bei 4.500 kWh Verbrauch und 19,2 kWh Speicher wird der Zusatzertrag
 * überwiegend eingespeist (Sättigung). Wer eine Eingabe gegen „stimmt der Jahresertrag ungefähr?"
 * prüft, prüft die falsche Grösse; entscheidend ist die **Tagesform relativ zur Last**. Deshalb
 * gibt es hier bewusst KEINE Plausibilitätsprüfung über den Ertrag.
 *
 * ── WARUM IN `shared` UND NICHT IN DER APP ─────────────────────────────────────────────────────
 * `apps/website` hat keinen eigenen Testlauf (dieselbe Lage wie bei `invoice-scan.ts`). Die
 * Umrechnung mit der teuersten bekannten Fehlerwirkung des ganzen Bauabschnitts gehört dorthin,
 * wo sie geprüft werden kann. Rein: kein I/O, keine Uhr, kein Zustand.
 */

/** Die acht Himmelsrichtungen der Auswahl. */
export type CompassDirection = 'N' | 'NO' | 'O' | 'SO' | 'S' | 'SW' | 'W' | 'NW'

export type CompassDirectionInfo = {
  key: CompassDirection
  /** Ausgeschrieben, wie es im Formular steht. */
  label: string
  /** Kompassgrad der Sektormitte (0 = Norden, im Uhrzeigersinn). */
  compassDeg: number
}

/**
 * Die Auswahlliste, in Kompass-Reihenfolge.
 *
 * Sie beginnt bei Süden und nicht bei Norden: die weitaus meisten Anlagen liegen zwischen Ost und
 * West über Süd, und eine Liste, die mit dem seltensten Fall anfängt, lädt zum Danebenklicken ein.
 * Die Reihenfolge ist eine Anzeigeentscheidung; `compassDeg` ist die Wahrheit.
 */
export const COMPASS_DIRECTIONS: readonly CompassDirectionInfo[] = [
  { key: 'S', label: 'Süden', compassDeg: 180 },
  { key: 'SO', label: 'Südosten', compassDeg: 135 },
  { key: 'SW', label: 'Südwesten', compassDeg: 225 },
  { key: 'O', label: 'Osten', compassDeg: 90 },
  { key: 'W', label: 'Westen', compassDeg: 270 },
  { key: 'NO', label: 'Nordosten', compassDeg: 45 },
  { key: 'NW', label: 'Nordwesten', compassDeg: 315 },
  { key: 'N', label: 'Norden', compassDeg: 0 },
]

/** Halbe Breite eines Himmelsrichtungs-Sektors: 360° / 8 / 2. */
export const COMPASS_SECTOR_HALF_WIDTH_DEG = 22.5

export function compassDirectionInfo(key: CompassDirection): CompassDirectionInfo {
  const found = COMPASS_DIRECTIONS.find((d) => d.key === key)
  // Die Union ist geschlossen; ein fehlender Eintrag wäre ein Programmfehler, kein Datenzustand.
  if (!found) throw new Error(`Unbekannte Himmelsrichtung: ${key}`)
  return found
}

/** Bringt einen beliebigen Gradwert in [0, 360). */
export function normalizeCompassDeg(deg: number): number {
  const wrapped = deg % 360
  return wrapped < 0 ? wrapped + 360 : wrapped
}

/** Kürzester Winkelabstand zweier Kompassrichtungen, 0…180. */
export function compassDelta(a: number, b: number): number {
  const raw = Math.abs(normalizeCompassDeg(a) - normalizeCompassDeg(b))
  return raw > 180 ? 360 - raw : raw
}

/**
 * Passt eine eingetragene Kompass-Gradzahl zur gewählten Himmelsrichtung?
 *
 * ⚠ DAS IST DER STRUKTURELLE FANG DER KONVENTIONS-FALLE. Ohne ihn liesse sich die rohe Zahl eines
 * Planungsdokuments (133) neben eine beliebige Richtung stellen, und die Auswahl wäre eine
 * Requisite. Mit ihm ist „Südosten + 133" gültig (Abstand 2°) und „Nordwesten + 133" abgewiesen
 * (Abstand 178°) — genau die Verwechslung, die 56 % der Ersparnis kostet.
 *
 * Die Toleranz ist die halbe Sektorbreite, also die Grenze, ab der eine ANDERE Richtung die
 * nähere wäre. Der Rand zählt mit (`<=`): 157,5° liegt genau zwischen Südost und Süd, und beide
 * Angaben sind dort vertretbar.
 */
export function compassDegreeFitsDirection(direction: CompassDirection, compassDeg: number): boolean {
  if (!Number.isFinite(compassDeg)) return false
  return compassDelta(compassDirectionInfo(direction).compassDeg, compassDeg) <= COMPASS_SECTOR_HALF_WIDTH_DEG
}

/**
 * **Kompass → PVGIS-`aspect`. Die eine Stelle, an der umgerechnet wird.**
 *
 * `aspect = kompass − 180`, auf (−180, 180] gebracht. Gegengeprüft an den drei in der
 * Bestandsaufnahme gemessenen Punkten: Kompass 90 (O) → −90 · 180 (S) → 0 · 270 (W) → +90 — und am
 * teuren Fall: Kompass 133 (Südosten) → **−47**.
 *
 * Norden ergibt −180 und nicht +180; beide bezeichnen dieselbe Richtung, und `checkPvgisRequest`
 * lässt den geschlossenen Bereich [−180, 180] zu. Festgelegt ist es trotzdem, damit dieselbe
 * Eingabe immer dieselbe Anfrage erzeugt.
 */
export function compassToPvgisAzimuth(compassDeg: number): number {
  const aspect = normalizeCompassDeg(compassDeg) - 180
  // −180 bleibt −180 (Norden); der Bereich ist damit [−180, 180).
  return aspect
}

/** Rückrichtung — ausschliesslich für die Anzeige („gerechnet mit …"), nie als Rechenweg. */
export function pvgisAzimuthToCompass(aspect: number): number {
  return normalizeCompassDeg(aspect + 180)
}

/**
 * Eine Modulfläche, wie der Nutzer sie eingibt.
 *
 * ⚠ MEHRERE FLÄCHEN SIND DER NORMALFALL, nicht der Sonderfall (Pflichtenheft §3(b); das
 * vorliegende Planungsdokument führt zwei). Sie werden EINZELN erfasst und EINZELN gerechnet — ein
 * zusammengefasster Wert (etwa „10,2 kWp bei mittlerer Ausrichtung") wäre eine gerechnete Zahl,
 * die nirgends dasteht, und bei zwei verschieden ausgerichteten Flächen ist die Tagesform der
 * Summe eine andere als die der gemittelten Fläche.
 */
export type PvArrayInput = {
  /** Nennleistung dieser Fläche in kWp. */
  peakPowerKwp: number
  /** Neigung gegen die Horizontale, 0–90°. */
  slopeDeg: number
  /** Gewählte Himmelsrichtung. */
  direction: CompassDirection
  /**
   * Kompass-Gradzahl, falls der Nutzer sie kennt (0 = Norden). Fehlt sie, gilt die Sektormitte der
   * gewählten Richtung. **Nie ein PVGIS-`aspect`** — s. Kopf.
   */
  compassDeg?: number
}

/** Der wirksame Kompassgrad einer Fläche: die Feinangabe, sonst die Sektormitte. */
export function effectiveCompassDeg(array: PvArrayInput): number {
  return array.compassDeg != null && Number.isFinite(array.compassDeg)
    ? normalizeCompassDeg(array.compassDeg)
    : compassDirectionInfo(array.direction).compassDeg
}

/** Der PVGIS-Azimut einer Fläche — die einzige Stelle, die beide Regeln zusammenführt. */
export function pvArrayAzimuthDeg(array: PvArrayInput): number {
  return compassToPvgisAzimuth(effectiveCompassDeg(array))
}

export type PvArrayRejection =
  | 'peak_power_invalid'
  | 'slope_invalid'
  | 'compass_direction_mismatch'

export type PvArrayCheck = { ok: true } | { ok: false; reason: PvArrayRejection }

/** Obergrenze einer einzelnen Modulfläche. Die harte Sperre liegt in `checkPvgisRequest` (2.000 kWp). */
export const MAX_ARRAY_PEAK_POWER_KWP = 2000

/**
 * Prüft eine eingegebene Modulfläche, BEVOR daraus eine PVGIS-Anfrage wird.
 *
 * Fail closed und je Grund ein eigener Wert: „Neigung fehlt" und „die Gradzahl passt nicht zur
 * Richtung" sind zwei verschiedene Auskünfte an den Nutzer, und nur die zweite ist die teure.
 */
export function checkPvArray(array: PvArrayInput): PvArrayCheck {
  if (
    !Number.isFinite(array.peakPowerKwp) ||
    array.peakPowerKwp <= 0 ||
    array.peakPowerKwp > MAX_ARRAY_PEAK_POWER_KWP
  ) {
    return { ok: false, reason: 'peak_power_invalid' }
  }
  if (!Number.isFinite(array.slopeDeg) || array.slopeDeg < 0 || array.slopeDeg > 90) {
    return { ok: false, reason: 'slope_invalid' }
  }
  if (array.compassDeg != null) {
    if (!Number.isFinite(array.compassDeg)) return { ok: false, reason: 'compass_direction_mismatch' }
    if (!compassDegreeFitsDirection(array.direction, array.compassDeg)) {
      return { ok: false, reason: 'compass_direction_mismatch' }
    }
  }
  return { ok: true }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Die Streuung — die ehrliche Genauigkeitsgrenze des ganzen Vorhabens
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⚠ DIE GLÄTTUNG DES ZEHN-JAHRES-MITTELS — gemessen in B22a, und im Report zu NENNEN.
 *
 * Das Pflichtenheft begründet das Mittel über die Genauigkeit des JAHRESERTRAGS (0,6 % gegen die
 * Meteonorm-Klimanormale). Über die FORM der Kurve sagt es nichts — und die ist nicht dieselbe:
 * Wolkentage verschiedener Jahre decken sich nicht, ein Zehn-Jahres-Mittel ist deshalb glatter als
 * jedes einzelne Jahr. Gegen die echte PVGIS-Antwort gemessen (02.09.2026, Wien 10,2 kWp / 90° /
 * −47, H0 4.500 kWh, Speicher 19,2 kWh): die gemittelte Kurve erreicht als Spitze 6,18 kW, die
 * zehn Einzeljahre 7,55–8,30 kW; die Eigenverbrauchs-Ersparnis liegt dadurch bei € 428,27 statt
 * € 408,45 (dem Mittel der zehn einzeln gerechneten Jahre) — **4,9 % höher, und höher als in JEDEM
 * einzelnen Jahr**. Eine geglättete Erzeugung sättigt Speicher und Verbrauch seltener.
 *
 * ⇒ Die Schätzung ist systematisch leicht OPTIMISTISCH, ÜBER die Jahresstreuung hinaus. Der Betrag
 * ist klein und die Alternative wäre schlechter (ein einzelnes Wetterjahr behauptete eine
 * Genauigkeit, die die Datenlage nicht hergibt) — aber er gehört neben die Zahl, nicht in eine
 * Fussnote.
 *
 * `[ANNAHME]` — an EINER Konfiguration gemessen. Wächst der Wert bei anderen Auslegungen, ist er
 * hier zu korrigieren; er ist bewusst eine benannte Konstante und keine im Text eingemauerte Zahl.
 */
export const PV_TEN_YEAR_SMOOTHING_OPTIMISM_PERCENT = 4.9

export type AnnualYieldSpread = {
  meanKwh: number
  minKwh: number
  maxKwh: number
  /** Halbe Spannweite in Prozent des Mittels — die „± x %"-Angabe des Reports. */
  spreadPercent: number
}

/**
 * Fasst die Jahreserträge der gemittelten Wetterjahre zusammen.
 *
 * `spreadPercent = (max − min) / 2 / Mittel × 100`, also die **halbe** Spannweite: der Report
 * schreibt „± 5,8 %", und das ist die Hälfte des Abstands zwischen bestem und schlechtestem Jahr.
 * Gegen die dokumentierte Messung geprüft (711,4 … 800,0 bei Mittel 759,0 kWh/kWp ⇒ 5,8 %).
 *
 * ⚠ Die Zahlen kommen aus der ECHTEN PVGIS-Antwort dieses Kunden, nicht aus einer Konstanten. Die
 * ± 5,8 % der Bestandsaufnahme gehören zu EINER Konfiguration; eine andere Auslegung an einem
 * anderen Standort streut anders, und der Report soll die Streuung nennen, die für DIESE Anlage
 * gemessen wurde.
 *
 * Leere Eingabe ⇒ `null`: „keine Angabe" ist eine andere Aussage als „Streuung 0".
 */
export function summarizeAnnualYields(yieldsKwh: readonly number[]): AnnualYieldSpread | null {
  const values = yieldsKwh.filter((v) => Number.isFinite(v))
  if (values.length === 0) return null
  const meanKwh = values.reduce((s, v) => s + v, 0) / values.length
  const minKwh = Math.min(...values)
  const maxKwh = Math.max(...values)
  const spreadPercent = meanKwh > 0 ? ((maxKwh - minKwh) / 2 / meanKwh) * 100 : 0
  return { meanKwh, minKwh, maxKwh, spreadPercent }
}

/**
 * Was der Report über eine geschätzte PV-Erzeugung sagen können muss.
 *
 * Es ist bewusst eine ZUSAMMENFASSUNG und nicht die Erzeugungsreihe: der Report zeigt keine
 * PV-Kurve, er qualifiziert eine Zahl. Die Reihe selbst steckt bereits im Lastgang (sie wurde vom
 * Verbrauch abgezogen) und im `PvProfile` für das Energiefluss-Chart.
 */
export type EstimatedPvSummary = {
  postalCode: string
  locationName: string
  latitudeDeg: number
  longitudeDeg: number
  /** Summe der Nennleistungen aller Modulflächen. */
  totalPeakPowerKwp: number
  arrayCount: number
  /** Die gemittelten Wetterjahre, wie PVGIS sie geliefert hat. */
  weatherYears: { from: number; to: number }
  /** Jahresertrag über alle Flächen: Mittel, Spanne und die „± x %"-Angabe. */
  spread: AnnualYieldSpread | null
  /**
   * Die von PVGIS ZURÜCKGESPIEGELTEN Azimutwerte je Fläche, in PVGIS-Konvention (0 = Süd).
   *
   * ⚠ Sie stammen aus der ANTWORT des Dienstes, nicht aus unserer Eingabe — sie sind damit der
   * Nachweis, womit tatsächlich gerechnet wurde, und die Stelle, an der die Konventions-Umrechnung
   * end-to-end überprüfbar ist (Pflichtenheft §5 Punkt 2).
   */
  echoedAzimuthDeg: number[]
  /** Ebenso zurückgespiegelt: die Neigungen. */
  echoedSlopeDeg: number[]
}
