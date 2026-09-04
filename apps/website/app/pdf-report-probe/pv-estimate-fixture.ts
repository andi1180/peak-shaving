import {
  applyEstimatedPv,
  buildEstimatedPvProfile,
  expandReferenceToTimestamps,
  type PvReferenceProfile,
  type PvgisArrayDesign,
} from 'engine'
import {
  lookupPostalCodeCentroid,
  pvArrayAzimuthDeg,
  summarizeAnnualYields,
  type EstimatedPvSummary,
  type LoadProfile,
  type PvArrayInput,
} from 'shared'

import type { CalculatorPayload } from '@/components/flow/types'
import { fetchPvReferenceProfileAction } from '@/lib/pvgis/actions'

/**
 * B23c-5 — die ECHTE PV-Schätzung für den Prüffall `pv_schaetzung`.
 *
 * ── ⚠ WARUM HIER EIN LIVE-AUFRUF STEHT UND KEINE NOTIERTE ZUSAMMENFASSUNG ─────────────────────
 * `EstimatedPvSummary` besteht fast vollständig aus ANTWORTEN von PVGIS: die Wetterjahre, die
 * zehn Jahreserträge und die daraus gebildete Streuung, dazu die zurückgespiegelten Azimut- und
 * Neigungswerte. Eine hier von Hand notierte Zusammenfassung wäre genau der zweite Zahlensatz, den
 * `summary-fixtures.ts` in seinem Kopf ausschliesst: der Hinweis im PDF sähe dann richtig aus, weil
 * seine Zahlen danebengeschrieben sind, und nicht, weil sie herauskommen — und die eine Grösse, um
 * die es dem Hinweis geht (die für DIESE Anlage gemessene Streuung), wäre ausgerechnet erfunden.
 *
 * ⚠ EINGABE ist deshalb ausschliesslich die AUSLEGUNG (PLZ, kWp, Neigung, Ausrichtung) — dasselbe,
 * was ein Kunde in das Formular tippt (B22b). Alles, was daraus folgt, wird geholt.
 *
 * ── ES LÄUFT DER PRODUKTIONSWEG, NICHT EINE NACHGEBAUTE KETTE ─────────────────────────────────
 * `lookupPostalCodeCentroid` → `pvArrayAzimuthDeg` → `fetchPvReferenceProfileAction` →
 * `expandReferenceToTimestamps` → `summarizeAnnualYields` → `applyEstimatedPv` /
 * `buildEstimatedPvProfile`. Jeder Schritt ist DIE Funktion, die auch `pv-design-panel.tsx`
 * aufruft, in derselben Reihenfolge — dieselbe Haltung wie in `analysis-run.ts`, wo der echte
 * Analyse-Worker läuft statt einer zweiten Orchestrierung.
 *
 * ⚠ Die Zusammenfassung selbst wird hier trotzdem GEBAUT und nicht aus dem Panel importiert: sie
 * entsteht dort mitten in einem React-Ereignisbehandler zwischen Formularzustand und Fehleranzeige.
 * Sie herauszulösen hiesse, eine Bildschirm-Komponente für den PDF-Weg anzufassen (dieselbe Regel
 * wie bei den Charts, Contract-Entscheidung 1) — und die Felder sind Zuweisungen aus den Antworten,
 * keine Rechnung, die auseinanderlaufen könnte.
 *
 * ── ⚠ EIN AUFRUF JE MODULFLÄCHE, NACHEINANDER ─────────────────────────────────────────────────
 * Wortgleich zur Begründung im Panel: zwei verschieden ausgerichtete Flächen ergeben eine andere
 * Tagesform als eine gemittelte, und parallel wäre der Abruf für einen fremden, kostenlosen Dienst
 * Stossbetrieb. Gemessen kostet ein Aufruf rund 8 MB und acht Sekunden; dieser Prüflauf braucht
 * also rund 17 s, bevor überhaupt gerechnet wird. Das ist der Preis dafür, dass die Zahlen echt
 * sind.
 */

/**
 * Die Auslegung des Prüffalls — die EINZIGE Eingabe dieses Moduls.
 *
 * ⚠ Sie ist nicht erfunden: es ist die Anlage aus dem echten PV*SOL-Exposé, an dem B22c den
 * Scan-Weg gemessen hat (4,25 kWp / 90° / Südosten 133° und 5,95 kWp / 35° / Südwesten, PLZ 1100).
 * Zwei Flächen sind dabei Absicht und kein Beiwerk: nur so entsteht der Halbsatz „aufgeteilt auf
 * N Modulflächen", der bei einer einzelnen Fläche wegfällt und sonst gebaut, aber ungemessen wäre.
 */
const PROBE_POSTAL_CODE = '1100'

const PROBE_ARRAYS: PvArrayInput[] = [
  { peakPowerKwp: 4.25, slopeDeg: 90, direction: 'SO', compassDeg: 133 },
  { peakPowerKwp: 5.95, slopeDeg: 35, direction: 'SW' },
]

export type EstimatedPvProbe = {
  /** Der GEKOPPELTE Lastgang: Verbrauch − geschätzte Erzeugung, mit `pvSource: 'estimated'`. */
  profile: LoadProfile
  /**
   * Das Brutto-PV-Profil — BEIWERK DER ANZEIGE (Energiefluss-Chart), keine Ersparnis-Zahl hängt
   * daran (B22a). Es reist mit, weil der Rechner es an derselben Stelle mitgibt und ein Prüflauf
   * ohne es einen anderen Trace erzeugte als der echte Weg.
   */
  pv: NonNullable<CalculatorPayload['pv']>
  /** Was der Report über die Herkunft der Erzeugungskurve sagen können muss. */
  summary: EstimatedPvSummary
}

export async function buildEstimatedPvProbe(
  base: LoadProfile,
  baseQuality: { coveredDays: number; coveredMonths: number },
): Promise<EstimatedPvProbe> {
  const centroid = lookupPostalCodeCentroid(PROBE_POSTAL_CODE)
  /*
   * Die Tabelle ist ein statisches Codemodul (B22b) — eine fehlende PLZ wäre ein Programmfehler
   * und kein Datenzustand. Fail closed statt einer geratenen Koordinate.
   */
  if (!centroid) throw new Error(`Prüf-PLZ ${PROBE_POSTAL_CODE} steht nicht in der PLZ-Tabelle.`)

  const profiles: PvReferenceProfile[] = []
  for (const array of PROBE_ARRAYS) {
    const design: PvgisArrayDesign = {
      latitudeDeg: centroid.lat,
      longitudeDeg: centroid.lon,
      peakPowerKwp: array.peakPowerKwp,
      slopeDeg: array.slopeDeg,
      /* Die EINE Umrechnung Kompass → PVGIS. Ein roher Kompasswert drehte die Anlage um 180°. */
      azimuthDeg: pvArrayAzimuthDeg(array),
    }
    const outcome = await fetchPvReferenceProfileAction(design)
    if (!outcome.ok) {
      throw new Error(
        `PVGIS-Abruf für ${array.peakPowerKwp} kWp fehlgeschlagen: ${outcome.error}. ` +
          'Dieser Prüffall braucht Netz — er misst echte Antwortwerte und keine notierten.',
      )
    }
    profiles.push(outcome.profile)
  }

  const timestamps = base.readings.map((r) => r.ts)
  const generationKw = new Array<number>(timestamps.length).fill(0)
  for (const profile of profiles) {
    const expanded = expandReferenceToTimestamps(profile, timestamps)
    for (let i = 0; i < generationKw.length; i++) {
      generationKw[i] = (generationKw[i] ?? 0) + (expanded[i] ?? 0)
    }
  }

  /* Über die SUMME der Flächen je Wetterjahr, nicht je Fläche — der Report nennt eine Angabe. */
  const yearTotals = new Map<number, number>()
  for (const profile of profiles) {
    for (const y of profile.annualYields) {
      yearTotals.set(y.year, (yearTotals.get(y.year) ?? 0) + y.kwh)
    }
  }

  const summary: EstimatedPvSummary = {
    postalCode: centroid.postalCode,
    locationName: centroid.name,
    latitudeDeg: centroid.lat,
    longitudeDeg: centroid.lon,
    totalPeakPowerKwp: PROBE_ARRAYS.reduce((s, a) => s + a.peakPowerKwp, 0),
    arrayCount: PROBE_ARRAYS.length,
    weatherYears: profiles[0]!.weatherYears,
    spread: summarizeAnnualYields([...yearTotals.values()]),
    echoedAzimuthDeg: profiles.map((p) => p.inputs.azimuthDeg),
    echoedSlopeDeg: profiles.map((p) => p.inputs.slopeDeg),
  }

  return {
    profile: applyEstimatedPv(base, generationKw),
    pv: {
      fileName: `Geschätzt · PVGIS ${summary.weatherYears.from}–${summary.weatherYears.to}`,
      profile: buildEstimatedPvProfile(base, generationKw),
      /*
       * Das erzeugte Profil trägt DIESELBEN Zeitstempel wie der Lastgang — es deckt genau dessen
       * Zeitraum ab, hat keine Lücke und braucht keine eigene Warnung. Wortgleich zum Rechner.
       */
      dataQuality: {
        coveredDays: baseQuality.coveredDays,
        coveredMonths: baseQuality.coveredMonths,
        gapsInterpolated: 0,
        largestGapSlots: 0,
        warnings: [],
      },
    },
    summary,
  }
}
