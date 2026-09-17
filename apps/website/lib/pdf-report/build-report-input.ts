import type { PvOutageMonth } from 'engine'
import {
  NETZBETREIBER_IDS,
  readReportSectionSelection,
  type AnalysisResult,
  type LoadProfile,
  type NetzbetreiberId,
  type ReportSectionSelection,
} from 'shared'

import {
  defaultReportTitle,
  formatAnalysisPeriod,
  formatPrintedAt,
  reportSubtitle,
  tariffVintageNote,
} from './derive'
import { TARIFF_SOURCE_UNTRACKED } from './types'
import type {
  PdfReportAnalysis,
  PdfReportInput,
  PdfReportInvoicePeriod,
  PdfReportTariffProvenance,
} from './types'

/**
 * D12 Abschluss — aus einer Report-Übergabe (`platform.report_render_requests`) die Eingangsgrössen
 * des PDF-Reports bauen.
 *
 * ── ⚠ DIESE DATEI DARF `@react-pdf/renderer` NICHT ANFASSEN ────────────────────────────────────
 * Dieselbe Auflage wie bei `derive.ts` und `basis.ts`: sie wird aus einer Route heraus statisch
 * importiert, und ein Wert-Import aus `./render`/`./document` zöge den Lazy-Chunk (≈ 307 kB gzip)
 * in deren First Load. Der Weg dorthin bleibt der dynamische Import in `download.ts`.
 *
 * ── WAS HIER NICHT ENTSTEHT ───────────────────────────────────────────────────────────────────
 * Keine Rechnung. Ergebnis und Lastgang kommen fertig gerechnet aus der Übergabe (gerechnet hat
 * `apps/web`, D12 Teil 2); was hier passiert, ist ausschliesslich das Zusammensetzen der Felder,
 * die `PdfReportInput` ausser diesen beiden noch verlangt.
 */

/**
 * Die Felder aus `report_input_meta`, die dieser Weg LIEST.
 *
 * ⚠ Der schreibende Schritt legt zehn ab (`apps/web/lib/admin/report-render-actions.ts`). Hier
 * stehen acht — und die zwei übrigen fehlen nicht versehentlich: `meteringPointId`/`projectId`
 * sind Rückverfolgung für den Admin-Bereich und haben auf einem Kundendokument nichts zu suchen.
 *
 * ⚠ `netzbetreiber` STAND BIS ZUM D9-VORGRIFF NICHT HIER, mit der Begründung, er würde eine
 * Tarifherkunft BEHAUPTEN, die es nicht gibt. Die Sorge war richtig, der Schluss zu weit: er reist
 * als blosse ANGABE mit und benennt weder einen Tarifstand noch die Frage, die
 * `TARIFF_SOURCE_UNTRACKED` offen lässt (s. `basis.ts`).
 */
export type ReportRenderMeta = {
  /** Die Kundenbezeichnung fürs Deckblatt. `null` = keine hinterlegt. */
  customerLabel: string | null
  /**
   * Der Netzbetreiber des Zählpunkts. `null` = keiner hinterlegt ODER eine Kennung, die dieses Repo
   * nicht kennt — beides führt zu demselben Report ohne Namen (s. `readMeta`).
   */
  netzbetreiber: NetzbetreiberId | null
  /**
   * Die Grundgebühr des Lieferanten. `null` heisst „keine Angabe" und ist NICHT 0 — gelesen wird
   * sie für GENAU einen Satz (`tariffVintageNote`), s. unten.
   */
  supplierBaseFeeEurPerMonth: number | null
  /**
   * D5 — ob es an diesem Zählpunkt eine PV-Anlage gibt. `null` = die Frage wurde nie beantwortet,
   * und das ist NICHT `false` (s. `readPvDraft` auf der Schreibseite).
   */
  hasPv: boolean | null
  /**
   * D5 — Monate ohne erkennbaren Mittagseinbruch, gerechnet im Analyse-Lauf. Leer heisst „nichts
   * gefunden" UND „eine Übergabe aus einer Fassung, die den Befund noch nicht führte" — beide
   * führen zu keinem Hinweis, und keiner der beiden behauptet, die Anlage sei in Ordnung.
   */
  pvOutageMonths: PvOutageMonth[]
  /**
   * D9 — die rohen Herkunftsangaben der Tarifseite (s. `PdfReportTariffProvenance`).
   *
   * ⚠ Leere Listen heissen „es gibt nichts zu belegen" UND „eine Übergabe aus einer Fassung vor D9
   * führt die Angaben nicht" — beide führen in der Tabelle zur ausgeschriebenen Leerstelle, und
   * keine von beiden behauptet einen Preisblatt-Stand.
   */
  tariffProvenance: PdfReportTariffProvenance
  /**
   * Report-Baukasten C — welche der vier abwählbaren Bausteine der Admin stehen lassen wollte.
   *
   * ⚠ `undefined` heisst ALLE VIER und ist hier nicht bloss Vorsicht: eine Übergabe lebt 24
   * Stunden, es liegen zum Zeitpunkt jedes Deployments also Zeilen ohne das Feld in der Tabelle.
   * Fiele die Abwesenheit auf „nichts zeigen", verlöre ein bereits verschickter Report beim Öffnen
   * vier Bausteine — und niemand sähe, warum. Die leere Liste ist davon unterschieden: sie ist die
   * ausgeübte Wahl.
   */
  optionalSections: ReportSectionSelection
}

/** Eine gelesene, nicht abgelaufene Übergabe. */
export type ReportRenderRequest = {
  analysisResult: AnalysisResult
  loadProfile: LoadProfile
  meta: ReportRenderMeta
}

/**
 * Die EINE Meldung für jeden Fall, in dem es nichts zu zeigen gibt.
 *
 * ── ⚠ SIE UNTERSCHEIDET BEWUSST NICHT, WARUM ──────────────────────────────────────────────────
 * Unbekannte Kennung, abgelaufene Kennung und ein Lesefehler führen zu derselben Anzeige. Der
 * Wrapper trennt die ersten beiden schon in der Datenbank nicht (`get_report_render_request`
 * antwortet in beiden Fällen leer, Begründung dort) — eine Oberfläche, die sie doch trennte, nähme
 * genau den Schutz zurück, der den unangemeldeten Leseweg trägt: sie machte das Raten von
 * Kennungen zu einer Suche mit Rückmeldung.
 *
 * Sie steht als Konstante NEBEN `readRenderRequest`, damit „eine Meldung" nachprüfbar ist und nicht
 * bloss behauptet: es gibt genau einen Zustand `unavailable` und genau einen Text dazu.
 */
export const REPORT_UNAVAILABLE =
  'Dieser Report ist nicht verfügbar. Die Übergabe läuft nach 24 Stunden ab — bitte im ' +
  'Admin-Bereich eine neue erzeugen lassen.'

/** Was aus der Antwort des Wrappers herauskommt — mehr als diese zwei Zustände gibt es nicht. */
export type RenderRequestReadout =
  | { status: 'ok'; request: ReportRenderRequest }
  | { status: 'unavailable' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Die Antwort von `public.get_report_render_request` lesen.
 *
 * ⚠ Nimmt `data` UND `error` entgegen und nicht nur die Zeilen: eine fehlgeschlagene Abfrage (auch
 * eine mit unpassend geformter Kennung, 22P02) darf nicht als „leer" durchrutschen und auch nicht
 * als eigener Zustand nach aussen — s. `REPORT_UNAVAILABLE`.
 *
 * Die Prüfung der zwei jsonb-Spalten ist bewusst FLACH (Objekt, und der Lastgang hat Messwerte):
 * geschrieben hat sie ein Admin-Wrapper aus einem echten Engine-Lauf, nicht ein Browser. Was hier
 * abzufangen ist, ist die leere/abgelaufene Antwort — nicht ein von Hand verändertes `jsonb`.
 */
export function readRenderRequest(result: { data: unknown; error: unknown }): RenderRequestReadout {
  if (result.error != null) return { status: 'unavailable' }

  const row = Array.isArray(result.data) ? result.data[0] : result.data
  if (!isRecord(row)) return { status: 'unavailable' }

  const analysisResult = row.analysis_result
  const loadProfile = row.load_profile
  if (!isRecord(analysisResult)) return { status: 'unavailable' }
  if (!isRecord(loadProfile) || !Array.isArray(loadProfile.readings)) {
    return { status: 'unavailable' }
  }

  return {
    status: 'ok',
    request: {
      analysisResult: analysisResult as unknown as AnalysisResult,
      loadProfile: loadProfile as unknown as LoadProfile,
      meta: readMeta(row.report_input_meta),
    },
  }
}

/**
 * ⚠ Ein fehlender oder fremd getypter Wert fällt auf `null` — dieselbe Regel wie auf der
 * Schreibseite. `report_input_meta` ist in der Migration ausdrücklich ohne Struktur; eine Übergabe
 * aus einer älteren Fassung trägt die Felder womöglich gar nicht, und ein Deckblatt mit
 * `[object Object]` statt einer Firma wäre schlimmer als eines ohne Firma.
 */
function readMeta(value: unknown): ReportRenderMeta {
  const meta = isRecord(value) ? value : {}
  const label = meta.customerLabel
  const baseFee = meta.supplierBaseFeeEurPerMonth
  const hasPv = meta.hasPv
  return {
    customerLabel: typeof label === 'string' && label !== '' ? label : null,
    netzbetreiber: readNetzbetreiber(meta.netzbetreiber),
    supplierBaseFeeEurPerMonth: typeof baseFee === 'number' ? baseFee : null,
    /* Strikt `true`/`false` — `'true'` oder `1` sähen wie eine Antwort aus und sind keine. */
    hasPv: hasPv === true ? true : hasPv === false ? false : null,
    pvOutageMonths: readPvOutageMonths(meta.pvOutageMonths),
    tariffProvenance: {
      gridTariffValidFrom: readIsoDates(meta.gridTariffValidFrom),
      invoicePeriods: readInvoicePeriods(meta.invoicePeriods),
    },
    optionalSections: readReportSectionSelection(meta.optionalSections),
  }
}

/**
 * ⚠ JEDER EINTRAG EINZELN GEPRÜFT, und ein unbrauchbarer lässt die ganze Liste fallen — dieselbe
 * Strenge und derselbe Grund wie bei `readPvOutageMonths`: was hier durchrutscht, steht als
 * Gültigkeitsdatum auf einem Kundendokument, und ein `Invalid Date` in der Datenquellen-Tabelle
 * wäre schlimmer als die ausgeschriebene Leerstelle.
 */
function readIsoDates(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const dates: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry)) return []
    dates.push(entry)
  }
  return dates
}

/**
 * ⚠ EIN EINTRAG OHNE JEDE ZEITANGABE WIRD ÜBERSPRUNGEN, nicht mit Platzhaltern gefüllt — er
 * belegte nichts und stünde trotzdem als Quelle da. `assumed` wird strikt auf `true`/`false`
 * geprüft; alles andere fällt auf `null` („es gibt keinen Zeitraum-Vermerk") statt auf `true`.
 */
function readInvoicePeriods(value: unknown): PdfReportInvoicePeriod[] {
  if (!Array.isArray(value)) return []
  const periods: PdfReportInvoicePeriod[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return []
    const from = typeof entry.from === 'string' && entry.from !== '' ? entry.from : null
    const to = typeof entry.to === 'string' && entry.to !== '' ? entry.to : null
    if (from === null && to === null) continue
    const assumed = entry.assumed
    periods.push({ from, to, assumed: assumed === true ? true : assumed === false ? false : null })
  }
  return periods
}

/**
 * ⚠ JEDER EINTRAG WIRD EINZELN GEPRÜFT, und ein unbrauchbarer lässt die ganze Liste fallen.
 *
 * Anders als bei den zwei jsonb-Spalten der Übergabe (s. `readRenderRequest`) ist das hier keine
 * Übervorsicht: `report_input_meta` ist in der Migration ohne Struktur, und eine Übergabe aus einer
 * Fassung vor D5 trägt das Feld gar nicht. Was daraus wird, sind Monatsnamen auf einem
 * Kundendokument — ein `undefined 2025` in der Aufzählung wäre schlimmer als ein fehlender Hinweis.
 */
function readPvOutageMonths(value: unknown): PvOutageMonth[] {
  if (!Array.isArray(value)) return []

  const months: PvOutageMonth[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return []
    const { year, month, daysWithDayWindowData, minDayWindowKw } = entry
    if (typeof year !== 'number' || !Number.isFinite(year)) return []
    if (typeof month !== 'number' || month < 1 || month > 12) return []
    if (typeof daysWithDayWindowData !== 'number') return []
    if (typeof minDayWindowKw !== 'number') return []
    months.push({ year, month, daysWithDayWindowData, minDayWindowKw })
  }
  return months
}

/**
 * ⚠ GEGEN DIE BEKANNTEN KENNUNGEN GEPRÜFT, und eine unbekannte fällt auf `null`. Die Schreibseite
 * prüft bewusst NICHT gegen eine feste Liste (`grid_tariffs.operator_id` wächst mit dem Bestand) —
 * für die Anzeige ist das die falsche Freiheit: ohne Eintrag in `NETZBETREIBER_LABELS` gäbe es
 * keinen Namen, sondern nur die rohe Kennung, und `wiener_netze` auf einem Kundendokument sähe wie
 * ein Fehler aus. Ein fehlender Name ist die bessere Auskunft als ein technischer.
 */
function readNetzbetreiber(value: unknown): NetzbetreiberId | null {
  return (NETZBETREIBER_IDS as readonly string[]).includes(value as string)
    ? (value as NetzbetreiberId)
    : null
}

/**
 * Die Eingangsgrössen des Dokuments aus einer Übergabe.
 *
 * ⚠ `now` ist ein PARAMETER — dieselbe Regel wie bei `formatPrintedAt`/`tariffVintageNote`: eine
 * Funktion, die selbst auf die Uhr sieht, lässt sich gegen keinen Stichtag prüfen.
 */
export function buildReportInputFromRenderRequest(
  request: ReportRenderRequest,
  now: Date,
): PdfReportInput {
  const { analysisResult, loadProfile, meta } = request

  return {
    title: defaultReportTitle(analysisResult),
    subtitle: reportSubtitle(loadProfile),
    /*
     * ⚠ NUR die Firma. Weder Name noch Adresse werden auf diesem Weg erhoben — die Übergabe führt
     * sie nicht, und `platform.leads` hat für die Adresse ohnehin keine Spalte. Ein aus einer
     * anderen Angabe gebildeter Name stünde auf dem Deckblatt wie eine erfasste Angabe da.
     */
    customer: meta.customerLabel ? { company: meta.customerLabel } : undefined,
    period: formatAnalysisPeriod(loadProfile),
    printedAt: formatPrintedAt(now),
    analysis: reduceAnalysis(analysisResult),
    loadProfile,
    /*
     * ⚠ IMMER der dritte Zustand. Dieser Weg entsteht aus einem Zählpunkt-Entwurf, und der hält
     * nicht fest, ob die Tarifwerte aus einer eingelesenen Netzrechnung, aus einer Handeingabe oder
     * aus dem Preisblatt-Vorschlag stammen. `null` behauptete die erste Herkunft, ein gebauter
     * `TariffSourceRef` eine geprüfte Katalog-Herkunft — beides wäre unbelegt (s. `types.ts`).
     */
    tariffSource: TARIFF_SOURCE_UNTRACKED,
    /* Ohne bekannten Netzbetreiber gar keine Angabe — der Satz steht dann wortgleich wie zuvor. */
    netzbetreiber: meta.netzbetreiber ?? undefined,
    tariffVintage: tariffVintageNote(
      loadProfile,
      /* Ohne Angabe nennt der Satz die Grundgebühr nicht — die konservative Fassung. */
      { supplierBaseFeeEurPerMonth: meta.supplierBaseFeeEurPerMonth ?? undefined },
      now,
    ),
    /*
     * ⚠ IMMER `undefined`. Ein Entwurf mit GESCHÄTZTER PV bricht den Lauf bereits auf der
     * Schreibseite ab (`runAnalysisFromMeteringPointDraft`); es kann hier also gar keine
     * Schätzung geben, über die zu berichten wäre. Ein Platzhalter stünde als Angabe da, die
     * nichts bezeichnet.
     */
    estimatedPv: undefined,
    /* D5 — beide Hälften bleiben getrennt; verknüpft werden sie im Kapitel (`basis.ts`). */
    hasPv: meta.hasPv ?? undefined,
    pvOutageMonths: meta.pvOutageMonths,
    /* D9 — die rohen Herkunftsangaben der Tarifseite; ausgewertet wird im Kapitel (`basis.ts`). */
    tariffProvenance: meta.tariffProvenance,
    /* Report-Baukasten C — die Admin-Auswahl; `undefined` heisst alle vier (s. `ReportRenderMeta`). */
    optionalSections: meta.optionalSections,
  }
}

/**
 * Das Ergebnis auf die sieben Felder verengen, die das Dokument LIEST.
 *
 * ⚠ Ein `AnalysisResult` wäre strukturell zuweisbar — dann reiste `peaks` (samt Spitzenliste und
 * Verteilung) als achtes Feld mit, ohne dass es je gelesen wird. `PdfReportAnalysis` ist genau
 * dafür ein `Pick<…>`: der Typ sagt, was das Dokument braucht, und das Verengen hier hält den
 * übergebenen Wert daran (s. Kopf von `types.ts`).
 */
function reduceAnalysis(result: AnalysisResult): PdfReportAnalysis {
  return {
    current: result.current,
    perBattery: result.perBattery,
    recommendation: result.recommendation,
    assumptions: result.assumptions,
    tariffOptimization: result.tariffOptimization,
    existingBatteryAnalysis: result.existingBatteryAnalysis,
    dataQuality: result.dataQuality,
  }
}
