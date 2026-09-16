import 'server-only'

import {
  computeAnalysis,
  mapDraftToExistingBatteryInput,
  mapDraftToTariffParams,
  parseLoadProfile,
  parsePvProfile,
  type CalculatorPayload,
  type DataQuality,
  type DraftTariffMappingOptions,
  type ParsedPv,
} from 'engine'
import {
  DEMO_BATTERY_CATALOG,
  DRAFT_ANALYSIS_HORIZON_YEARS,
  findUnsupportedAnalysisDraftKeys,
  PV_GENERATED_DRAFT_KEYS,
  PV_GENERATED_PROFILE_SOURCE,
  PV_UPLOAD_DRAFT_KEYS,
  type AnalysisResult,
  type LoadProfile,
} from 'shared'

import { MAX_LOAD_PROFILE_FILE_BYTES } from '../load-profile/limits'
import {
  coupleGeneratedPvSeries,
  readGeneratedPvSeries,
} from '../pv-reference/generated-series-read'

/**
 * D3, Baustein 1 — DER ERSTE ENGINE-LAUF AUS DEM WIZARD-ENTWURF.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DER HÄRTESTE BEFUND DES DELTAS: ES GAB KEINE STELLE IM REPO, DIE DAS TUT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der Wizard erhebt seit B24 Lastgang, Rechnung, Batterie, PV und Tarif — und nichts davon hat je
 * gerechnet. Zwei Hindernisse standen dazwischen, und diese Datei räumt beide aus:
 *
 *   1. DIE VIERTELSTUNDENWERTE STEHEN IN KEINER DATENBANKSPALTE. Gespeichert sind nur Metadaten
 *      (Intervall, Zeitraum, Lücken); die Rohdatei liegt unverarbeitet in
 *      `platform.project_documents`. Ein Lauf muss sie zur LAUFZEIT erneut lesen und parsen.
 *   2. `billingModel` schreibt keine Station — der Vorgabewert dafür steht in `mapDraftToTariffParams`.
 *
 * ── ⚠ ES ENTSTEHT KEINE ZWEITE RECHNUNG ───────────────────────────────────────────────────────
 * Gerechnet wird mit dem UNVERÄNDERTEN `computeAnalysis` (Prinzip 2: ein Dispatch, eine ehrliche
 * Zahl). Diese Datei beschafft die Eingaben und setzt den Payload zusammen — sie rechnet keine
 * einzige Zahl selbst. Was der Rechner in `apps/website` bekommt und was hier herauskommt, ist
 * dieselbe Kette in derselben Reihenfolge.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WARUM DIE AUSSENWELT ALS PARAMETER HEREINKOMMT (und die Aufgabenstellung hier abweicht)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der Auftrag nannte `runAnalysisFromMeteringPointDraft(meteringPointId)` und „lädt Entwurf, lädt
 * Rohdatei aus Storage". Beides geschieht — aber über PORTS, nicht über einen harten Import. Der
 * Grund ist derselbe, der schon bei `checkPvGeneratorEligibility` gemessen wurde und dort
 * ausführlich steht: die Leser (`list_metering_points`, `readProjectDocument`) liegen in
 * `apps/web` und ziehen `@supabase/ssr` und `next/headers`; `packages/extractors` hängt an
 * `@anthropic-ai/sdk`, `engine`, `server-only` und `shared` — ein Paket importiert keine App, und
 * `apps/website` zöge diese Abhängigkeit sonst mit hinein. Das Delta verlangt die Injektion
 * ausserdem ausdrücklich („Die Storage-Lesefunktion wird injiziert").
 *
 * ⚠ DIE ZUSAGE, AUF DIE ES ANKOMMT, BLEIBT DAVON UNBERÜHRT: die bis zu 35.040 Messwerte entstehen
 * HIER und enden HIER. Heraus kommt ein `AnalysisResult` — dieselbe Grenze wie beim Lastgang-Leser
 * und beim Standardprofil-Erzeuger nebenan.
 */

/** Was dieser Lauf von einem Zählpunkt braucht — der Ausschnitt aus `list_metering_points`. */
export type MeteringPointAnalysisSource = {
  /** Der rohe Entwurf (`platform.metering_points.draft`). */
  draft: Record<string, unknown>
  /**
   * Die Kennung der hochgeladenen LASTGANG-Datei — `null` bei einem erzeugten Standardprofil und
   * ohne Lastgang. Sie steht im Zählpunkt, nicht im Entwurf (Spalte `source_document_id`).
   */
  sourceDocumentId: string | null
}

/** Eine Datei aus der Projekt-Ablage — der Ausschnitt aus `readProjectDocument`. */
export type ProjectDocumentFile = {
  bytes: ArrayBuffer
  /**
   * Der Name, unter dem die Datei abgelegt wurde. Er entscheidet über CSV gegen XLSX und wandert
   * als `load.fileName` in den Payload (Report/Bündel lesen ihn, die Rechnung nie).
   */
  filename: string
}

/**
 * Die Aussenwelt dieses Laufs. Beide Ports antworten mit `null` für „gibt es nicht (mehr)" — ein
 * LESEFEHLER gehört dagegen geworfen: als `null` durchgereicht behauptete ein Ausfall eine
 * Fehlanzeige, und der Lauf bräche mit der falschen Begründung ab.
 */
export type MeteringPointAnalysisPorts = {
  readMeteringPoint: (meteringPointId: string) => Promise<MeteringPointAnalysisSource | null>
  readDocument: (documentId: string) => Promise<ProjectDocumentFile | null>
}

/**
 * Was ein Lauf hinterlässt.
 *
 * ⚠ DER LASTGANG STEHT NEBEN DEM ERGEBNIS, WEIL ER NICHT DARIN VORKOMMT. `AnalysisResult` führt
 * keine Rohreihe (`DispatchTrace` zeigt nur repräsentative Tage) — wer die Report-Charts zeichnen
 * will, bräuchte die Datei sonst ein zweites Mal aus der Ablage und ein zweites Mal geparst, und
 * genau dann könnte das Gezeichnete von dem abweichen, was gerechnet wurde. Es ist DIESELBE
 * Referenz, die in den Payload ging — keine zweite Auswertung.
 */
export type MeteringPointAnalysisRun = {
  result: AnalysisResult
  loadProfile: LoadProfile
  /**
   * Die Herkunft der GESCHÄTZTEN Erzeugungsreihe — gesetzt genau dann, wenn mit einer gerechnet
   * wurde. Beides sind Angaben ÜBER die Reihe und keine gerechneten Grössen; im `AnalysisResult`
   * gibt es dafür kein Feld (`payload.estimatedPv` liest `computeAnalysis` nirgends), und ohne sie
   * stünde im Report eine Schätzung, der niemand mehr ansieht, auf welchem Jahrzehnt sie beruht
   * und dass sie systematisch leicht optimistisch ist.
   */
  estimatedPvMetadata?: EstimatedPvSeriesMetadata
}

/** Was die abgelegte Schätzreihe über sich selbst aussagt (s. `GeneratedPvSeriesDocument`). */
export type EstimatedPvSeriesMetadata = {
  smoothingOptimismPercent: number
  weatherYears: { from: number; to: number }
}

export type RunAnalysisFromDraftOptions = DraftTariffMappingOptions & {
  /** Betrachtungszeitraum in Jahren. Vorgabe: `DRAFT_ANALYSIS_HORIZON_YEARS` (`shared`). */
  horizonYears?: number
}

/** Jeder Abbruch dieses Laufs — benannt, damit ein Aufrufer verzweigen kann statt Text zu lesen. */
export class MeteringPointAnalysisError extends Error {
  constructor(
    readonly reason:
      | 'metering_point_not_found'
      | 'no_uploaded_load_profile'
      | 'document_not_found'
      | 'file_too_large'
      | 'load_profile_needs_mapping'
      | 'load_profile_unreadable'
      | 'pv_document_not_found'
      | 'pv_file_too_large'
      | 'pv_profile_needs_mapping'
      | 'pv_profile_unreadable'
      | 'generated_pv_document_not_found'
      | 'generated_pv_file_too_large'
      | 'unsupported_draft',
    message: string,
  ) {
    super(message)
    this.name = 'MeteringPointAnalysisError'
  }
}

/**
 * Rechnet einen Zählpunkt durch: Entwurf holen, Lastgang- und (falls vorhanden) PV-Datei holen und
 * parsen, Tarif- und Bestandsbatterie-Angaben abbilden, `computeAnalysis` aufrufen.
 *
 * ── ⚠ DIE GESCHÄTZTE PV: SEIT D3 (ABSCHLUSS) ZWEI VERSCHIEDENE ZUSTÄNDE ───────────────────────
 * Eine GESCHÄTZTE PV-Erzeugung (PVGIS, `pvProfileSource: 'generated'`) hat seit PR #256 eine
 * ABGELEGTE Reihe, und die wird gerechnet: der Entwurf benennt sie über
 * `PV_GENERATED_DRAFT_KEYS.documentId`, der Lauf liest sie und koppelt sie an den Lastgang.
 *
 * ⚠ OHNE diese Kennung bleibt die Sperre unverändert bestehen — und das ist kein Rest, sondern der
 * Fall „Entwurf von vor PR #256": die Reihe wurde damals nicht abgelegt und existiert nirgends.
 * Sie zur Rechenzeit neu zu holen wäre ein zweiter PVGIS-Abruf mit möglicherweise anderen
 * Wetterjahren; sie wegzulassen ergäbe ein Ergebnis, das vollständig aussieht und die Erzeugung
 * des Kunden nicht kennt, obwohl sie jeden einzelnen Netzbezugswert verschiebt. Es wird deshalb
 * weiterhin nicht geraten, sondern abgebrochen (`findUnsupportedAnalysisDraftKeys`).
 *
 * ⚠ AUCH DAS ERZEUGTE STANDARDPROFIL IST NOCH KEIN EINGANG: es hat ebenfalls keine Datei, und die
 * Kurve entstünde aus dem Jahresverbrauch im Entwurf neu. Das ist ein eigener Weg mit eigener
 * Kennzeichnung im Report, kein Sonderfall dieses hier.
 */
export async function runAnalysisFromMeteringPointDraft(
  meteringPointId: string,
  ports: MeteringPointAnalysisPorts,
  options: RunAnalysisFromDraftOptions = {},
): Promise<MeteringPointAnalysisRun> {
  const point = await ports.readMeteringPoint(meteringPointId)
  if (point === null) {
    throw new MeteringPointAnalysisError(
      'metering_point_not_found',
      'Diesen Zählpunkt gibt es nicht (mehr).',
    )
  }

  /*
   * ⚠ ZUERST DIE SPERRE, VOR JEDEM LESEVORGANG. Ein Entwurf, der hier ohnehin zum Abbruch führt,
   * soll nicht vorher eine Datei holen und bis zu 35.040 Werte parsen.
   *
   * ⚠ SIE WIRD ÜBERSPRUNGEN, SOBALD DIE ABGELEGTE SCHÄTZREIHE BENANNT IST — und nur dann. Die
   * Sperre schlägt an `pvProfileSource: 'generated'` und an den vier Kennzahlen daneben an; mit
   * Kennung ist beides kein Hindernis mehr, sondern die Beschreibung dessen, was gleich gelesen
   * wird. Ohne Kennung bleibt sie Wort für Wort die bisherige.
   */
  const generatedSeriesDocumentId = readGeneratedSeriesDocumentId(point.draft)
  if (generatedSeriesDocumentId === null) {
    const unsupported = findUnsupportedAnalysisDraftKeys(point.draft)
    if (unsupported.length > 0) {
      throw new MeteringPointAnalysisError(
        'unsupported_draft',
        'Geschätzte PV-Erzeugung im Entwurf vorhanden, aber ohne abgelegte Erzeugungsreihe ' +
          `(${PV_GENERATED_DRAFT_KEYS.documentId} fehlt): ${unsupported.join(', ')}. Die Analyse ` +
          'wird deshalb NICHT gerechnet — ohne diese Angaben wäre sie unvollständig und sähe ' +
          'vollständig aus.',
      )
    }
  }

  if (point.sourceDocumentId === null) {
    throw new MeteringPointAnalysisError(
      'no_uploaded_load_profile',
      'Für diesen Zählpunkt liegt keine hochgeladene Lastgang-Datei vor. Ein erzeugtes ' +
        'Standardprofil unterstützt dieser Baustein noch nicht.',
    )
  }

  const document = await readParsableDocument(ports, point.sourceDocumentId, {
    label: 'Lastgang-Datei',
    notFound: 'document_not_found',
    tooLarge: 'file_too_large',
  })

  const parsed = parseLoadProfile(document)

  if (!parsed.ok) {
    /*
     * ⚠ ZWEI VERSCHIEDENE AUSSAGEN, ZWEI VERSCHIEDENE ABBRÜCHE. `needs_mapping` heisst: die Datei
     * ist lesbar, aber nicht eindeutig (mehrere Zählpunkt-Spalten, uneindeutige Einheit) — hier
     * wird NICHT geraten, denn unter den nicht zugeordneten Spalten kann eine Einspeise-Spalte
     * sein. `error` heisst: sie ist strukturell nicht verarbeitbar. Als ein Zustand gemeldet
     * schickte die eine Hälfte der Fälle jemanden die Datei prüfen, die in Ordnung ist.
     */
    if (parsed.kind === 'needs_mapping') {
      const issues = parsed.issues.map((issue) => issue.message).join(' · ')
      throw new MeteringPointAnalysisError(
        'load_profile_needs_mapping',
        `Die Lastgang-Datei ist nicht eindeutig lesbar und braucht eine bestätigte Zuordnung: ${issues}`,
      )
    }
    throw new MeteringPointAnalysisError(
      'load_profile_unreadable',
      `Die Lastgang-Datei konnte nicht gelesen werden (${parsed.error.code}): ${parsed.error.message}`,
    )
  }

  /*
   * ⚠ DIE NICHT GESETZTEN FELDER SIND DIE AUSSAGE DIESES WEGS. `financial`, `tariffPricing` und
   * `estimatedPv` bleiben `undefined` und damit bei dem Verhalten, das `computeAnalysis` für „nicht
   * angefordert" vorsieht (keine Förderrechnung, kein Tarifoptimierungs-Hebel, keine geschätzte
   * Erzeugung). Ein Platzhalter an einer dieser Stellen wäre eine Behauptung über etwas, das nie
   * erhoben wurde. `pv: null` heisst dasselbe für die Brutto-PV: keine Datei, keine Reihe.
   *
   * ⚠ `sourceBytes` reist bewusst NICHT mit: es dient allein der Prüfsumme des Analyse-Bündels
   * (B14-2), und dieser Weg exportiert keines. Mitgeführt hielte es die volle Datei zusätzlich zum
   * geparsten Profil im Speicher.
   */
  /*
   * ⚠ „Batterie vorhanden" OHNE Kapazität/Leistung ergibt keinen Bestandsblock (§3.6) — und das
   * darf nicht still geschehen: der Report zeigte sonst eine Empfehlung für einen Betrieb ohne
   * Speicher, obwohl einer dasteht. Der Hinweis reist über denselben Kanal wie der PV-Lese-Fehler
   * in `computeAnalysis`: angehängt an `dataQuality.warnings`, ohne neues Ergebnisfeld.
   */
  const existingBattery = mapDraftToExistingBatteryInput(point.draft)

  /*
   * ⚠ DIE KOPPLUNG STEHT VOR DEM PAYLOAD-BAU, nicht darin — wortgleiche Reihenfolge wie im
   * öffentlichen Rechner (`apps/website/components/flow/calculator.tsx:62-63`): der gekoppelte
   * Lastgang ERSETZT `load.profile`, bevor der Payload entsteht. Als nachträgliche Änderung am
   * fertigen Payload gäbe es einen Moment, in dem beide Fassungen nebeneinander existieren, und
   * die Frage „welche ist gerechnet worden?" hinge an der Zeilenreihenfolge.
   */
  const estimatedPv =
    generatedSeriesDocumentId === null
      ? null
      : await readCoupledGeneratedPvSeries(ports, generatedSeriesDocumentId, parsed)

  const payload: CalculatorPayload = {
    tariff: mapDraftToTariffParams(point.draft, options),
    load: {
      fileName: document.fileName,
      // ⚠ Die `dataQuality` bleibt die des URSPRUNGSLASTGANGS: die Kopplung legt Werte auf
      // dieselben Zeitstempel, sie verändert weder Abdeckung noch Lücken.
      profile: estimatedPv?.profile ?? parsed.profile,
      dataQuality: existingBattery.warning
        ? {
            ...parsed.dataQuality,
            warnings: [...parsed.dataQuality.warnings, existingBattery.warning],
          }
        : parsed.dataQuality,
    },
    pv: estimatedPv?.pv ?? (await readPvProfileFromDraft(point.draft, ports)),
    existingBattery: existingBattery.input,
  }

  return {
    result: computeAnalysis(
      payload,
      options.horizonYears ?? DRAFT_ANALYSIS_HORIZON_YEARS,
      DEMO_BATTERY_CATALOG,
    ),
    loadProfile: payload.load.profile,
    ...(estimatedPv === null ? {} : { estimatedPvMetadata: estimatedPv.metadata }),
  }
}

/**
 * Die Kennung der ABGELEGTEN Schätzreihe — `null` heisst „dieser Entwurf geht den Weg nicht".
 *
 * Zwei Bedingungen, und beide sind nötig: die Herkunft muss `'generated'` lauten (bei `'upload'`
 * gehört eine liegengebliebene Kennung nicht in die Rechnung), und die Kennung muss dastehen. Ein
 * Entwurf von vor PR #256 erfüllt die zweite nicht — für ihn bleibt die Sperre.
 */
function readGeneratedSeriesDocumentId(draft: Record<string, unknown>): string | null {
  if (draft[PV_UPLOAD_DRAFT_KEYS.profileSource] !== PV_GENERATED_PROFILE_SOURCE) return null
  const documentId = draft[PV_GENERATED_DRAFT_KEYS.documentId]
  if (typeof documentId !== 'string' || documentId.trim() === '') return null
  return documentId
}

/**
 * Holt die abgelegte Schätzreihe und koppelt sie an den geparsten Lastgang.
 *
 * ⚠ EIN ZEITSTEMPEL-KONFLIKT GEHT UNVERÄNDERT NACH OBEN DURCH (`GeneratedPvSeriesError`, Grund
 * `timestamp_mismatch`) und wird hier weder abgefangen noch in eine Warnung umgeformt: er heisst,
 * dass die Reihe zu einem ANDEREN Lastgang gehört — typisch nach einer ersetzten Lastgang-Datei.
 * Als Warnung neben einem Ergebnis stünde eine um Stunden verschobene Erzeugung in jeder Zahl.
 */
async function readCoupledGeneratedPvSeries(
  ports: MeteringPointAnalysisPorts,
  documentId: string,
  consumption: { profile: LoadProfile; dataQuality: DataQuality },
): Promise<{ profile: LoadProfile; pv: ParsedPv; metadata: EstimatedPvSeriesMetadata }> {
  const file = await readParsableDocument(ports, documentId, {
    label: 'geschätzte PV-Erzeugungsreihe',
    notFound: 'generated_pv_document_not_found',
    tooLarge: 'generated_pv_file_too_large',
  })

  // Unsere eigene JSON-Datei — der Umweg über `readParsableDocument` bringt Grenze und Abbrüche mit.
  const text =
    typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content)
  const coupled = coupleGeneratedPvSeries(consumption.profile, readGeneratedPvSeries(text))

  return {
    profile: coupled.profile,
    pv: {
      fileName: `Geschätzt · PVGIS ${coupled.weatherYears.from}–${coupled.weatherYears.to}`,
      profile: coupled.pv,
      /*
       * Die erzeugte Reihe trägt DIESELBEN Zeitstempel wie der Lastgang — sie deckt genau dessen
       * Zeitraum ab, hat keine Lücke und braucht keine eigene Warnung. Wortgleich zum Rechner
       * (`pv-design-panel.tsx`).
       */
      dataQuality: {
        coveredDays: consumption.dataQuality.coveredDays,
        coveredMonths: consumption.dataQuality.coveredMonths,
        gapsInterpolated: 0,
        largestGapSlots: 0,
        warnings: [],
      },
    },
    metadata: {
      smoothingOptimismPercent: coupled.smoothingOptimismPercent,
      weatherYears: coupled.weatherYears,
    },
  }
}

/**
 * Eine Datei aus der Ablage, fertig für einen Parser der Engine.
 *
 * ⚠ CSV MUSS ALS TEXT HEREINKOMMEN, XLSX ALS BYTES — dieselbe Regel wie im Lastgang-Leser und in
 * der Anbietbarkeits-Prüfung nebenan, dort ausführlich begründet: `extractTable` entscheidet daran,
 * welchen Weg es nimmt, und die Unterscheidung fällt am DATEINAMEN, weil der `content_type` eines
 * Dokuments eine Angabe des Browsers ist.
 *
 * ⚠ EINE FUNKTION FÜR BEIDE DATEIEN, und die Abbrüche kommen als Parameter herein: Lastgang und
 * PV-Reihe werden identisch geholt und identisch vorbereitet, aber ein Aufrufer muss auseinander
 * halten können, WELCHE der beiden fehlt. Zweimal ausgeschrieben liefe die Format-Entscheidung
 * auseinander — und eine PV-XLSX-Datei käme als Text an, wo sie als Bytes gehört.
 */
async function readParsableDocument(
  ports: MeteringPointAnalysisPorts,
  documentId: string,
  labels: {
    label: string
    notFound: MeteringPointAnalysisError['reason']
    tooLarge: MeteringPointAnalysisError['reason']
  },
): Promise<{ content: string | ArrayBuffer; fileName: string; format: 'csv' | 'xlsx' }> {
  const document = await ports.readDocument(documentId)
  if (document === null) {
    throw new MeteringPointAnalysisError(
      labels.notFound,
      `Die ${labels.label} (${documentId}) ist nicht (mehr) lesbar.`,
    )
  }

  if (document.bytes.byteLength > MAX_LOAD_PROFILE_FILE_BYTES) {
    throw new MeteringPointAnalysisError(
      labels.tooLarge,
      `Die ${labels.label} ist grösser als ${MAX_LOAD_PROFILE_FILE_BYTES} Bytes.`,
    )
  }

  const isXlsx = /\.xlsx?$/i.test(document.filename.trim())
  return {
    content: isXlsx ? document.bytes : new TextDecoder().decode(document.bytes),
    fileName: document.filename,
    format: isXlsx ? 'xlsx' : 'csv',
  }
}

/**
 * Die HOCHGELADENE Brutto-PV-Erzeugung eines Zählpunkts — `null` heisst „keine Reihe in dieser
 * Rechnung".
 *
 * ── ⚠ DREI BEDINGUNGEN, UND JEDE EINZELNE IST EIN ECHTER ZUSTAND DER STATION ──────────────────
 * `hasPv` muss beantwortet und bejaht sein; die Herkunft darf nicht `'generated'` lauten (die
 * sperrt den Lauf schon weiter oben, hier steht sie als zweites Netz); und es muss eine
 * Dokument-Kennung geben. Fehlt allein die Kennung, ist die Frage mit „ja" beantwortet und die
 * Datei noch nicht eingelesen — dann wird OHNE Brutto-PV gerechnet, wie im öffentlichen Rechner
 * ohne PV-Upload. Die Modulflächen (`_pvArrays`) allein ergeben keine Erzeugungsreihe.
 *
 * ⚠ EIN LESE- ODER PARSE-FEHLER BRICHT AB, statt wie im Rechner als `pvError` weitergereicht zu
 * werden. Dort steht ein Mensch davor, der die Meldung sieht und weiterklicken darf; hier läuft die
 * Rechnung ohne Aufsicht, und eine still übergangene Erzeugungsreihe ergäbe genau das Ergebnis, das
 * vollständig aussieht und die halbe Anlage nicht kennt.
 */
async function readPvProfileFromDraft(
  draft: Record<string, unknown>,
  ports: MeteringPointAnalysisPorts,
): Promise<ParsedPv | null> {
  if (draft[PV_UPLOAD_DRAFT_KEYS.present] !== true) return null
  if (draft[PV_UPLOAD_DRAFT_KEYS.profileSource] === PV_GENERATED_PROFILE_SOURCE) return null

  const documentId = draft[PV_UPLOAD_DRAFT_KEYS.sourceDocumentId]
  if (typeof documentId !== 'string' || documentId.trim() === '') return null

  const document = await readParsableDocument(ports, documentId, {
    label: 'PV-Erzeugungsdatei',
    notFound: 'pv_document_not_found',
    tooLarge: 'pv_file_too_large',
  })

  const parsed = parsePvProfile(document)
  if (!parsed.ok) {
    // Dieselbe Zweiteilung wie beim Lastgang: „nicht eindeutig" ist etwas anderes als „nicht lesbar".
    if (parsed.kind === 'needs_mapping') {
      const issues = parsed.issues.map((issue) => issue.message).join(' · ')
      throw new MeteringPointAnalysisError(
        'pv_profile_needs_mapping',
        `Die PV-Erzeugungsdatei ist nicht eindeutig lesbar und braucht eine bestätigte Zuordnung: ${issues}`,
      )
    }
    throw new MeteringPointAnalysisError(
      'pv_profile_unreadable',
      `Die PV-Erzeugungsdatei konnte nicht gelesen werden (${parsed.error.code}): ${parsed.error.message}`,
    )
  }

  return { fileName: document.fileName, profile: parsed.profile, dataQuality: parsed.dataQuality }
}
