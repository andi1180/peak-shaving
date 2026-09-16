import 'server-only'

import {
  computeAnalysis,
  mapDraftToTariffParams,
  parseLoadProfile,
  type CalculatorPayload,
  type DraftTariffMappingOptions,
} from 'engine'
import {
  DEMO_BATTERY_CATALOG,
  DRAFT_ANALYSIS_HORIZON_YEARS,
  findUnsupportedAnalysisDraftKeys,
  type AnalysisResult,
} from 'shared'

import { MAX_LOAD_PROFILE_FILE_BYTES } from '../load-profile/limits'

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
      | 'unsupported_draft',
    message: string,
  ) {
    super(message)
    this.name = 'MeteringPointAnalysisError'
  }
}

/**
 * Rechnet einen Zählpunkt durch: Entwurf holen, Lastgang-Datei holen und parsen, Tarifparameter
 * abbilden, `computeAnalysis` aufrufen.
 *
 * ── ⚠ WAS DIESER BAUSTEIN NOCH NICHT KANN, UND WARUM ER DARAN ABBRICHT ────────────────────────
 * PV und Bestandsbatterie werden NICHT verarbeitet. Sie einfach wegzulassen wäre die gefährlichere
 * Variante: das Ergebnis sähe vollständig aus und kennte die halbe Anlage des Kunden nicht — eine
 * bestehende Batterie hat ihre Ersparnis bereits im Lastgang, eine geschätzte PV-Erzeugung
 * verschiebt jeden einzelnen Netzbezugswert. Stehen solche Angaben im Entwurf, bricht der Lauf mit
 * den betroffenen Feldern ab (`findUnsupportedAnalysisDraftKeys`, `shared`).
 *
 * ⚠ AUCH DAS ERZEUGTE STANDARDPROFIL IST NOCH KEIN EINGANG: es hat keine Datei, und die Kurve
 * entstünde aus dem Jahresverbrauch im Entwurf neu. Das ist ein eigener Weg mit eigener
 * Kennzeichnung im Report, kein Sonderfall dieses hier.
 */
export async function runAnalysisFromMeteringPointDraft(
  meteringPointId: string,
  ports: MeteringPointAnalysisPorts,
  options: RunAnalysisFromDraftOptions = {},
): Promise<AnalysisResult> {
  const point = await ports.readMeteringPoint(meteringPointId)
  if (point === null) {
    throw new MeteringPointAnalysisError(
      'metering_point_not_found',
      'Diesen Zählpunkt gibt es nicht (mehr).',
    )
  }

  /*
   * ⚠ ZUERST DIE SPERRE, VOR JEDEM LESEVORGANG. Ein Entwurf mit PV führt hier ohnehin zum Abbruch;
   * die Datei erst zu holen und zu parsen (bis zu 35.040 Werte) wäre Arbeit für ein Ergebnis, das
   * schon feststeht.
   */
  const unsupported = findUnsupportedAnalysisDraftKeys(point.draft)
  if (unsupported.length > 0) {
    throw new MeteringPointAnalysisError(
      'unsupported_draft',
      'PV-/Bestandsbatterie-Angaben im Entwurf vorhanden, von diesem Baustein noch nicht ' +
        `unterstützt: ${unsupported.join(', ')}. Die Analyse wird deshalb NICHT gerechnet — ` +
        'ohne diese Angaben wäre sie unvollständig und sähe vollständig aus.',
    )
  }

  if (point.sourceDocumentId === null) {
    throw new MeteringPointAnalysisError(
      'no_uploaded_load_profile',
      'Für diesen Zählpunkt liegt keine hochgeladene Lastgang-Datei vor. Ein erzeugtes ' +
        'Standardprofil unterstützt dieser Baustein noch nicht.',
    )
  }

  const document = await ports.readDocument(point.sourceDocumentId)
  if (document === null) {
    throw new MeteringPointAnalysisError(
      'document_not_found',
      `Die Lastgang-Datei (${point.sourceDocumentId}) ist nicht (mehr) lesbar.`,
    )
  }

  if (document.bytes.byteLength > MAX_LOAD_PROFILE_FILE_BYTES) {
    throw new MeteringPointAnalysisError(
      'file_too_large',
      `Die Lastgang-Datei ist grösser als ${MAX_LOAD_PROFILE_FILE_BYTES} Bytes.`,
    )
  }

  /*
   * ⚠ CSV MUSS ALS TEXT HEREINKOMMEN, XLSX ALS BYTES — dieselbe Regel wie im Lastgang-Leser und in
   * der Anbietbarkeits-Prüfung nebenan, dort ausführlich begründet: `extractTable` entscheidet
   * daran, welchen Weg es nimmt, und die Unterscheidung fällt am DATEINAMEN, weil der
   * `content_type` eines Dokuments eine Angabe des Browsers ist.
   */
  const isXlsx = /\.xlsx?$/i.test(document.filename.trim())
  const parsed = parseLoadProfile({
    content: isXlsx ? document.bytes : new TextDecoder().decode(document.bytes),
    fileName: document.filename,
    format: isXlsx ? 'xlsx' : 'csv',
  })

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
   * ⚠ DIE NICHT GESETZTEN FELDER SIND DIE AUSSAGE DIESES BAUSTEINS. `pv: null` heisst „keine
   * Brutto-PV in der Rechnung"; `existingBattery`, `financial`, `tariffPricing` und `estimatedPv`
   * bleiben `undefined` und damit bei dem Verhalten, das `computeAnalysis` für „nicht angefordert"
   * vorsieht (keine Förderrechnung, kein Tarifoptimierungs-Hebel, kein Bestandsblock). Ein
   * Platzhalter an einer dieser Stellen wäre eine Behauptung über etwas, das nie erhoben wurde.
   *
   * ⚠ `sourceBytes` reist bewusst NICHT mit: es dient allein der Prüfsumme des Analyse-Bündels
   * (B14-2), und dieser Weg exportiert keines. Mitgeführt hielte es die volle Datei zusätzlich zum
   * geparsten Profil im Speicher.
   */
  const payload: CalculatorPayload = {
    tariff: mapDraftToTariffParams(point.draft, options),
    load: {
      fileName: document.filename,
      profile: parsed.profile,
      dataQuality: parsed.dataQuality,
    },
    pv: null,
  }

  return computeAnalysis(
    payload,
    options.horizonYears ?? DRAFT_ANALYSIS_HORIZON_YEARS,
    DEMO_BATTERY_CATALOG,
  )
}
