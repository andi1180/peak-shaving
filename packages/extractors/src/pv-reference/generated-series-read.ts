import { applyEstimatedPv, buildEstimatedPvProfile } from 'engine'
import { pvReadingSchema, type LoadProfile, type PvProfile } from 'shared'

import { GENERATED_PV_SERIES_FORMAT, type GeneratedPvSeriesDocument } from './generated-series'

/**
 * DIE GEGENRICHTUNG ZU `generated-series.ts`: die abgelegte Schätzreihe wieder einlesen und an den
 * Lastgang koppeln. Verdrahtet seit D3 (Abschluss): `run-from-draft.ts` geht diesen Weg, sobald der
 * Entwurf eine abgelegte Schätzreihe benennt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WAS AN DER GESCHÄTZTEN PV TATSÄCHLICH RECHENWIRKSAM IST — gemessen, nicht angenommen
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `computeAnalysis` liest `payload.estimatedPv` an KEINER Stelle (der Name kommt dort nur in der
 * Typdefinition vor, `compute-analysis.ts:136`). Das Feld ist Report-Beiwerk: gelesen wird es
 * ausschliesslich in `apps/website/components/flow/step-result.tsx` (Zeilen 213/484), und zwar nur
 * `.summary`. Wirksam wird die Schätzung eine Ebene früher, im Aufrufer: `calculator.tsx:62-63`
 * ERSETZT `load.profile` durch `result.estimatedPv.profile`, bevor der Payload entsteht.
 *
 * Die Rechnung sieht davon also genau zwei Dinge:
 *   1. `payload.load.profile` — der gekoppelte Lastgang (Verbrauch − Erzeugung, signiert). Seine
 *      Zahlen tragen jede Ersparnis; sein `pvSource: 'estimated'` wird in
 *      `simulation/peak-shaving.ts:75` gelesen und setzt den Blocker `estimated_pv`.
 *   2. `payload.pv` — das Brutto-PV-Profil, Anzeige-Beiwerk (Abdeckungs-/Konsistenzhinweis und
 *      `dispatchTrace.pvGenerationKw`), ohne Wirkung auf eine Ersparnis-Zahl (s. Kopf `couple.ts`).
 *
 * Deshalb baut die Kopplung unten GENAU diese zwei Dinge und kein `EstimatedPvResult`: dessen
 * `summary` (Standort, Nennleistung, Streuung, zurückgespiegelte Winkel) steht in der abgelegten
 * Datei gar nicht, und keine davon geht in eine Rechnung ein.
 */

/** Jeder Abbruch dieses Wegs — benannt, damit ein späterer Aufrufer verzweigen kann. */
export class GeneratedPvSeriesError extends Error {
  constructor(
    readonly reason: 'unreadable' | 'unknown_format' | 'invalid_document' | 'timestamp_mismatch',
    message: string,
  ) {
    super(message)
    this.name = 'GeneratedPvSeriesError'
  }
}

/**
 * Liest die abgelegte Datei zurück in ihr getyptes Dokument.
 *
 * ⚠ DAS FORMAT-FELD WIRD GEPRÜFT, BEVOR IRGENDETWAS ANDERES GELESEN WIRD. Ein `JSON.parse` mit
 * anschliessendem Zugriff auf `readings` nähme jede beliebige JSON-Datei entgegen und läse aus
 * einer künftigen Fassung still die Felder, die zufällig gleich heissen.
 */
export function readGeneratedPvSeries(text: string): GeneratedPvSeriesDocument {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new GeneratedPvSeriesError(
      'unreadable',
      `Die abgelegte PV-Erzeugungsreihe ist kein lesbares JSON: ${(error as Error).message}`,
    )
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new GeneratedPvSeriesError('unknown_format', 'Die abgelegte PV-Erzeugungsreihe ist kein Objekt.')
  }

  const document = raw as Record<string, unknown>
  if (document.format !== GENERATED_PV_SERIES_FORMAT) {
    throw new GeneratedPvSeriesError(
      'unknown_format',
      `Unbekanntes Format der PV-Erzeugungsreihe: ${JSON.stringify(document.format)} ` +
        `(erwartet: ${GENERATED_PV_SERIES_FORMAT}).`,
    )
  }

  const weatherYears = document.weatherYears
  const from = (weatherYears as { from?: unknown } | null)?.from
  const to = (weatherYears as { to?: unknown } | null)?.to
  if (typeof from !== 'number' || typeof to !== 'number') {
    throw new GeneratedPvSeriesError(
      'invalid_document',
      'Die PV-Erzeugungsreihe trägt keine gültigen Wetterjahre — ohne sie wäre nicht mehr ' +
        'erkennbar, auf welchem Jahrzehnt sie beruht.',
    )
  }

  const smoothingOptimismPercent = document.smoothingOptimismPercent
  if (typeof smoothingOptimismPercent !== 'number' || !Number.isFinite(smoothingOptimismPercent)) {
    throw new GeneratedPvSeriesError(
      'invalid_document',
      'Die PV-Erzeugungsreihe trägt keinen gültigen Glättungs-Aufschlag.',
    )
  }

  if (!Array.isArray(document.readings) || document.readings.length === 0) {
    throw new GeneratedPvSeriesError('invalid_document', 'Die PV-Erzeugungsreihe trägt keine Werte.')
  }

  // Jeder Wert gegen `pvReadingSchema` — dieselbe Form, die die Engine entgegennimmt.
  const readings = document.readings.map((reading, i) => {
    const parsed = pvReadingSchema.safeParse(reading)
    if (!parsed.success) {
      throw new GeneratedPvSeriesError(
        'invalid_document',
        `Wert ${i + 1} der PV-Erzeugungsreihe ist unbrauchbar: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')} ${issue.message}`)
          .join(' · ')}`,
      )
    }
    return parsed.data
  })

  return {
    format: GENERATED_PV_SERIES_FORMAT,
    weatherYears: { from, to },
    smoothingOptimismPercent,
    readings,
  }
}

/**
 * Der gekoppelte Zustand, so wie ihn ein Analyse-Lauf braucht.
 *
 * ⚠ `smoothingOptimismPercent` und `weatherYears` reisen als GESCHWISTER neben dem Ergebnis und
 * nicht darin: sie sind Aussagen über die Herkunft der Reihe, keine gerechneten Grössen — dieselbe
 * Trennung wie beim Lastgang neben dem `AnalysisResult` in `MeteringPointAnalysisRun`. Die beiden
 * gehen immer gemeinsam heraus: ein Aufschlag ohne das Jahrzehnt, auf das er sich bezieht, ist als
 * Angabe im Report nicht einzuordnen.
 */
export type CoupledGeneratedPvSeries = {
  /** Verbrauch − geschätzte Erzeugung, signiert, mit `pvSource: 'estimated'` — DER Rechen-Lastgang. */
  profile: LoadProfile
  /** Die Brutto-Erzeugung für Trace und Anzeige (`payload.pv`) — ohne Wirkung auf eine Ersparnis. */
  pv: PvProfile
  smoothingOptimismPercent: number
  /** Die gemittelten Wetterjahre der Reihe — zusammen mit dem Aufschlag, nie ohne ihn (s. o.). */
  weatherYears: { from: number; to: number }
}

/**
 * Koppelt die eingelesene Reihe an den bereits geparsten Lastgang — über die UNVERÄNDERTEN
 * Funktionen aus `packages/engine` (`applyEstimatedPv`/`buildEstimatedPvProfile`). Hier wird keine
 * Zahl gerechnet, nur zugeordnet.
 *
 * ⚠ DIE ZEITSTEMPEL WERDEN VERGLICHEN, NICHT NUR DIE LÄNGE. Die Datei wurde gegen einen BESTIMMTEN
 * Lastgang erzeugt (`buildGeneratedPvSeriesFile` übernimmt dessen Zeichenketten verbatim); wird
 * die Lastgang-Datei danach ersetzt, zeigt die Entwurfs-Kennung weiterhin auf die alte Reihe. Rein
 * positionsweise aufaddiert ergäbe das eine um Stunden verschobene Erzeugung, die nirgends
 * auffiele — die Engine-Funktionen lesen die `ts` der Reihe nicht, sie nehmen die des Lastgangs.
 */
export function coupleGeneratedPvSeries(
  consumption: LoadProfile,
  document: GeneratedPvSeriesDocument,
): CoupledGeneratedPvSeries {
  if (document.readings.length !== consumption.readings.length) {
    throw new GeneratedPvSeriesError(
      'timestamp_mismatch',
      `Die abgelegte PV-Erzeugungsreihe hat ${document.readings.length} Werte, der Lastgang ` +
        `${consumption.readings.length} — sie gehört nicht zu diesem Lastgang.`,
    )
  }

  const mismatch = consumption.readings.findIndex((r, i) => document.readings[i]?.ts !== r.ts)
  if (mismatch >= 0) {
    throw new GeneratedPvSeriesError(
      'timestamp_mismatch',
      `Die abgelegte PV-Erzeugungsreihe passt ab Wert ${mismatch + 1} nicht zum Lastgang ` +
        `(Reihe: ${document.readings[mismatch]?.ts}, Lastgang: ${consumption.readings[mismatch]?.ts}).`,
    )
  }

  const pvGenerationKw = document.readings.map((r) => r.pvGenerationKw)
  return {
    profile: applyEstimatedPv(consumption, pvGenerationKw),
    pv: buildEstimatedPvProfile(consumption, pvGenerationKw),
    smoothingOptimismPercent: document.smoothingOptimismPercent,
    weatherYears: document.weatherYears,
  }
}
