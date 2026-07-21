/**
 * Vokabular und Antwort-Leser des Admin-Abschnitts „Analysen" (B14-2).
 *
 * REIN: kein `server-only`, kein `next/*` — Server Components lesen die Typen, die Client-Formulare
 * die Beschriftungen. Gleiche Aufteilung wie `lib/admin/leads.ts` (B1-3).
 *
 * Die Zeilen-Typen sind eine BEHAUPTUNG über die Migration, kein Beweis (die Wrapper geben `jsonb`
 * zurück). Deshalb lesen die Funktionen unten defensiv: fehlt der erwartete Schlüssel oder ist der
 * Status nicht `ok`, kommt `null` zurück statt eines Laufzeitfehlers mitten im Rendern — und der
 * Aufrufer kann „konnte nicht geladen werden" von „nichts gefunden" unterscheiden.
 */

/** Basispfad des Analysen-Abschnitts — ohne Locale-Präfix, wie der ganze Admin-Bereich. */
export const ANALYSES_HREF = '/admin/analysen'
/** Das Upload-Formular. */
export const ANALYSIS_NEW_HREF = '/admin/analysen/neu'

/** Pfad der Detailseite einer Analyse. */
export function analysisHref(id: string): string {
  return `${ANALYSES_HREF}/${id}`
}

/**
 * Pfad des Ursprungsdatei-Downloads — ein Route Handler, keine Seite.
 *
 * Der Blob hat in der Datenbank einen EIGENEN Wrapper (B14-1: ein Seitenaufruf soll nicht nebenbei
 * und unbemerkt mehrere hundert Kilobyte mitziehen), und hier hat er entsprechend eine eigene
 * Adresse: die Datei fliesst nur, wenn jemand sie ausdrücklich anfordert.
 */
export function analysisSourceHref(id: string): string {
  return `${ANALYSES_HREF}/${id}/datei`
}

/**
 * Spiegel des CHECK auf `platform.analyses.analysis_kind`. Als Konstante zulässig aus demselben
 * Grund wie `LEAD_STATUSES`: kurze feste Liste, und der Wert hat im Anwendungscode eigene Bedeutung
 * — er entscheidet später, welche Baselines für einen Wirkungsnachweis überhaupt in Frage kommen.
 * Weicht die Liste ab, lehnt die Datenbank den Wert ohnehin ab.
 */
export const ANALYSIS_KINDS = ['betreut', 'intern'] as const
export type AnalysisKind = (typeof ANALYSIS_KINDS)[number]

export const ANALYSIS_KIND_LABELS: Record<AnalysisKind, string> = {
  betreut: 'betreut (echter Kunde)',
  intern: 'intern (Probelauf)',
}

/** Vorgabe des Upload-Formulars: der Regelfall ist die betreute Analyse. */
export const DEFAULT_ANALYSIS_KIND: AnalysisKind = 'betreut'

export function analysisKindLabel(kind: string): string {
  return ANALYSIS_KIND_LABELS[kind as AnalysisKind] ?? kind
}

/**
 * Obergrenze für die UNKOMPRIMIERTE Ursprungsdatei.
 *
 * Ein Jahres-Lastgang sind rund 35.040 Zeilen, also grob 600 kB Text; 20 MB lassen damit reichlich
 * Luft für Mehrspalten-Exporte und XLSX. Die Grenze ist keine Speicherfrage, sondern eine
 * Plausibilitätsprüfung: was um Grössenordnungen darüber liegt, ist kein Lastgang, und es soll
 * nicht erst die Datenbank sein, die das feststellt — dorthin ginge es base64-kodiert und um ein
 * Drittel grösser durch eine Server Action.
 */
export const MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024

// ── Zeilen-Typen ─────────────────────────────────────────────────────────────────────────────────

/** Die fünf typisierten Auszüge, wie sie aus der Datenbank zurückkommen (B14-1). */
export type AnalysisBaselineColumns = {
  baseline_billed_kw_before: number
  baseline_billed_kw_after: number
  baseline_annual_saving_eur: number
  recommended_battery_label: string | null
  recommended_capacity_kwh: number | null
}

/** Eine Zeile aus `public.admin_list_analyses` — Kopfdaten, KEIN `inputs`/`result`/Blob. */
export type AnalysisListRow = AnalysisBaselineColumns & {
  id: string
  lead_id: string | null
  customer_label: string
  site_label: string | null
  analysis_kind: string
  /** Die Analyse, die DIESE hier ersetzt (also die Vorgängerin). */
  supersedes_id: string | null
  engine_version: string
  engine_commit_sha: string
  computed_at: string
  created_at: string
  created_by: string | null
  created_by_email: string | null
  source_file_name: string
  source_file_sha256: string
}

export type AnalysisListResult = {
  analyses: AnalysisListRow[]
  total: number
}

/** Eine Zeile aus `public.admin_get_analysis` — zusätzlich `inputs`, `result` und die Blob-GRÖSSE. */
export type AnalysisDetailRow = AnalysisListRow & {
  source_file_gzip_bytes: number
  inputs: unknown
  result: unknown
}

// ── Leser ────────────────────────────────────────────────────────────────────────────────────────

function asObject(data: unknown): Record<string, unknown> | null {
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null
}

/** Der rohe `status` einer Wrapper-Antwort (z. B. 'ok' | 'not_found' | 'invalid_filter'). */
export function readStatus(data: unknown): string | null {
  const obj = asObject(data)
  return typeof obj?.status === 'string' ? obj.status : null
}

/** `null` = der Wrapper hat NICHT `ok` gemeldet (nicht: „es gibt keine Analysen"). */
export function readAnalysisList(data: unknown): AnalysisListResult | null {
  const obj = asObject(data)
  if (!obj || obj.status !== 'ok') return null
  return {
    analyses: Array.isArray(obj.analyses) ? (obj.analyses as AnalysisListRow[]) : [],
    total: typeof obj.total === 'number' ? obj.total : 0,
  }
}

/** `null` = nicht `ok` (also auch nicht `not_found` — den unterscheidet der Aufrufer über `readStatus`). */
export function readAnalysisDetail(data: unknown): AnalysisDetailRow | null {
  const obj = asObject(data)
  if (!obj || obj.status !== 'ok') return null
  const analysis = asObject(obj.analysis)
  return analysis ? (analysis as unknown as AnalysisDetailRow) : null
}

/** Die Antwort von `public.admin_get_analysis_source` — Dateiname, Prüfsumme, gzip als base64. */
export type AnalysisSource = {
  source_file_name: string
  source_file_sha256: string
  source_file_gzip_base64: string
  source_file_gzip_bytes: number
}

export function readAnalysisSource(data: unknown): AnalysisSource | null {
  const obj = asObject(data)
  if (!obj || obj.status !== 'ok') return null
  const source = asObject(obj.source)
  if (!source) return null
  if (
    typeof source.source_file_name !== 'string' ||
    typeof source.source_file_sha256 !== 'string' ||
    typeof source.source_file_gzip_base64 !== 'string'
  ) {
    return null
  }
  return source as unknown as AnalysisSource
}

// ── Nachfolger-Index ─────────────────────────────────────────────────────────────────────────────

/**
 * Wie viele Zeilen für den Nachfolger-Index gelesen werden.
 *
 * `admin_list_analyses` liefert je Zeile nur `supersedes_id` — also die VORGÄNGERIN. Die Frage „ist
 * diese Analyse inzwischen ersetzt worden?" ist die umgekehrte Richtung, und die Datenbank hat
 * dafür bewusst keinen eigenen Zugriffsweg (B14-1 legt genau vier Wrapper an). Sie wird deshalb
 * hier aus dem Bestand gebildet: eine Nachfolgerin entsteht IMMER später als ihre Vorgängerin, ein
 * Blick auf die neuesten Zeilen findet sie also.
 *
 * 200 ist die Obergrenze, die der Wrapper selbst zulässt. Liegt der Bestand darüber, wird die
 * Kennzeichnung „ersetzt" für ältere Zeilen unvollständig — die Oberfläche SAGT das dann, statt es
 * zu verschweigen (eine stille Obergrenze liest sich wie Vollständigkeit).
 */
export const SUCCESSOR_SCAN_LIMIT = 200

export type SuccessorRef = { id: string; customerLabel: string; createdAt: string }

/**
 * Bildet „Vorgängerin → Nachfolgerin" aus einer Zeilenmenge.
 *
 * Bei mehreren Nachfolgerinnen derselben Zeile gewinnt die ÄLTESTE: sie ist diejenige, die die
 * Ersetzung tatsächlich vorgenommen hat; spätere sind Ersetzungen der Ersetzung und hängen an
 * ihrer eigenen Vorgängerin.
 */
export function buildSuccessorIndex(rows: AnalysisListRow[]): Map<string, SuccessorRef> {
  const index = new Map<string, SuccessorRef>()
  for (const row of rows) {
    if (!row.supersedes_id) continue
    const existing = index.get(row.supersedes_id)
    if (existing && existing.createdAt <= row.created_at) continue
    index.set(row.supersedes_id, {
      id: row.id,
      customerLabel: row.customer_label,
      createdAt: row.created_at,
    })
  }
  return index
}

/** Kurzform einer Prüfsumme für die Anzeige — Anfang UND Ende, damit sie vergleichbar bleibt. */
export function shortSha(sha: string): string {
  return sha.length <= 20 ? sha : `${sha.slice(0, 10)}…${sha.slice(-6)}`
}

/** Dateigrösse in einer für Menschen lesbaren Form. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
