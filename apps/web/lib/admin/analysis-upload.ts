/**
 * B14-2 — Die Prüfkette des Analyse-Uploads: Bündel + Ursprungsdatei → Argumente für
 * `public.admin_create_analysis`.
 *
 * ── REIN, UND ZWAR MIT ABSICHT ───────────────────────────────────────────────────────────────────
 * Kein `server-only`, kein `next/*`, kein Supabase-Client. Die Entscheidungen dieses Moduls sind
 * die eigentliche Aufgabe des Uploads — sie sind ohne Request, ohne Sitzung und ohne Datenbank
 * richtig oder falsch, und genau so werden sie geprüft. Die Server Action daneben
 * (`analyses-actions.ts`) ist nur noch Verdrahtung: Sitzung holen, dieses Modul rufen, RPC
 * absetzen.
 *
 * Das ist zugleich die technische Form der wichtigsten Zusage dieser Seite: ein Bündel, das die
 * Prüfung nicht besteht, ERREICHT DIE DATENBANK NICHT. Nicht „wird dort abgelehnt" — es entsteht
 * gar kein Aufruf.
 *
 * ── DIE PRÜFSUMME IST DER WICHTIGSTE FEHLERFALL DER GANZEN SEITE ────────────────────────────────
 * Bündel und Ursprungsdatei werden getrennt hochgeladen. Passen ihre Prüfsummen nicht zusammen,
 * wird die Analyse mit einer FREMDEN Datei archiviert — die Zeile sähe vollständig aus, und der
 * Fehler fiele frühestens 2027 auf, wenn niemand mehr rekonstruieren kann, welche Datei die
 * richtige gewesen wäre. Deshalb ist die Meldung dafür ausdrücklich und nennt beide Werte.
 *
 * Die Datenbank prüft dieselbe Sache ein zweites Mal (`admin_create_analysis` RECHNET die Prüfsumme
 * über die übergebene Datei). Das ist keine Verdopplung: sie ist die harte Grenze und sieht auch
 * Aufrufe an diesem Formular vorbei; hier entsteht die Meldung, die ein Mensch versteht, bevor
 * 20 MB durch eine Server Action gehen.
 */
import { MAX_SOURCE_FILE_BYTES, type AnalysisKind, type AnalysisBaselineColumns } from './analyses'
import {
  deriveBaselineExtracts,
  gzipCompress,
  parseAnalysisBundle,
  sha256Hex,
  type AnalysisBundle,
} from 'shared'

/** Die Angaben, die der Mensch beisteuert — alles Übrige stammt aus dem Bündel. */
export type AnalysisUploadForm = {
  customerLabel: string
  siteLabel: string
  analysisKind: AnalysisKind
  /** Leerstring = keine Zuordnung. */
  leadId: string
  /** Leerstring = ersetzt nichts. */
  supersedesId: string
}

/**
 * Die Argumente für `public.admin_create_analysis`, benannt wie die Wrapper-Parameter.
 *
 * `p_source_file` ist die UNKOMPRIMIERTE Datei und wird NICHT gespeichert — sie geht mit, weil die
 * Datenbank die Prüfsumme sonst nicht RECHNEN könnte (PostgreSQL kann kein gzip auspacken). Ohne
 * diese Rechnung wäre die Prüfsumme Dekoration: ein Wert, den der Aufrufer frei erfindet.
 * Ausführlich im Kopf des Wrappers (B14-1).
 */
export type CreateAnalysisArgs = {
  p_customer_label: string
  p_analysis_kind: string
  p_engine_version: string
  p_engine_commit_sha: string
  p_computed_at: string
  p_inputs: unknown
  p_result: unknown
  p_baseline_billed_kw_before: number
  p_baseline_billed_kw_after: number
  p_baseline_annual_saving_eur: number
  p_source_file_name: string
  p_source_file_sha256: string
  p_source_file: string
  p_source_file_gzip: string
  /*
   * Die fünf Optionalfelder werden bei „keine Angabe" WEGGELASSEN (`undefined`), nicht auf `null`
   * gesetzt: PostgREST lässt einen fehlenden Parameter auf den SQL-Default fallen — und der ist
   * `null`. Ein explizites `null` wäre gleichbedeutend, aber die erzeugten Typen führen sie als
   * optional, und ein Umweg über `null` hiesse, den Typ an genau der Stelle aufzuweichen, an der er
   * die Wrapper-Signatur abbildet. Dieselbe Handhabung wie im Lead-Pfad (B4-2).
   */
  p_site_label?: string
  p_lead_id?: string
  p_supersedes_id?: string
  p_recommended_battery_label?: string
  p_recommended_capacity_kwh?: number
}

export type PreparedUpload = {
  args: CreateAnalysisArgs
  bundle: AnalysisBundle
  /** Die abgeleiteten Auszüge — die Oberfläche zeigt sie in der Erfolgsmeldung. */
  extracts: ReturnType<typeof deriveBaselineExtracts>
}

export type PrepareResult =
  { ok: true; prepared: PreparedUpload } | { ok: false; message: string; field?: string }

/**
 * `bytea` wird als Hex-Zeichenkette übergeben (`\x…`, PostgreSQLs Eingabeformat).
 *
 * base64 wäre kürzer, ist aber KEIN Eingabeformat für `bytea` — es müsste in der Datenbank per
 * `decode(…, 'base64')` umgewandelt werden, also innerhalb des Wrappers, und der ist B14-1 und
 * bleibt unangetastet. Hex ist das Format, das PostgreSQL beim Casten selbst versteht.
 */
function toPostgresBytea(data: Uint8Array): string {
  let hex = '\\x'
  for (const byte of data) hex += byte.toString(16).padStart(2, '0')
  return hex
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

/**
 * Führt die vollständige Prüfkette durch und liefert entweder die RPC-Argumente oder GENAU EINEN
 * Grund, warum nichts angelegt wird.
 *
 * Reihenfolge ist Bedeutung: erst Form und Grösse (billig, ohne die Datei zu berühren), dann das
 * Bündel (ohne die Ursprungsdatei zu komprimieren), dann die Bindung der beiden. Ein Bündel mit
 * unbekannter Fassung soll nicht erst 20 MB komprimieren lassen, bevor es abgelehnt wird.
 */
export async function prepareAnalysisUpload(args: {
  bundleText: string
  sourceFileName: string
  sourceFile: Uint8Array
  form: AnalysisUploadForm
}): Promise<PrepareResult> {
  const { form } = args

  const customerLabel = form.customerLabel.trim()
  if (customerLabel === '') {
    return {
      ok: false,
      field: 'customerLabel',
      message:
        'Bitte einen Kunden angeben. Ohne ihn ist die Analyse 2027 niemandem mehr zuzuordnen — der ' +
        'zugeordnete Lead wird bis dahin längst anonymisiert sein.',
    }
  }

  if (args.sourceFile.byteLength === 0) {
    return { ok: false, field: 'sourceFile', message: 'Die Ursprungsdatei ist leer.' }
  }
  if (args.sourceFile.byteLength > MAX_SOURCE_FILE_BYTES) {
    return {
      ok: false,
      field: 'sourceFile',
      message:
        `Die Ursprungsdatei ist ${(args.sourceFile.byteLength / (1024 * 1024)).toFixed(1)} MB gross ` +
        `und überschreitet die Obergrenze von ${MAX_SOURCE_FILE_BYTES / (1024 * 1024)} MB. Ein ` +
        'Jahres-Lastgang liegt bei unter einem Megabyte — bitte prüfen, ob es die richtige Datei ist.',
    }
  }

  // ── Das Bündel ────────────────────────────────────────────────────────────────────────────────
  let raw: unknown
  try {
    raw = JSON.parse(args.bundleText)
  } catch {
    return {
      ok: false,
      field: 'bundle',
      message: 'Die Bündel-Datei ist kein lesbares JSON. Es wird nichts angelegt.',
    }
  }

  const parsed = parseAnalysisBundle(raw)
  if (!parsed.ok) return { ok: false, field: 'bundle', message: parsed.message }
  const bundle = parsed.bundle

  // ── Die Bindung: gehören Bündel und Datei zusammen? ───────────────────────────────────────────
  const actualSha = await sha256Hex(args.sourceFile)
  if (actualSha !== bundle.sourceFileSha256) {
    return {
      ok: false,
      field: 'sourceFile',
      message:
        'Bündel und Ursprungsdatei gehören NICHT zusammen. Das Bündel wurde aus einer Datei mit der ' +
        `Prüfsumme ${bundle.sourceFileSha256} gerechnet; die hochgeladene Datei ` +
        `(„${args.sourceFileName}") hat ${actualSha}. ` +
        'Es wird nichts angelegt — eine Analyse mit einer fremden Datei zu archivieren wäre 2027 ' +
        'nicht mehr zu bemerken und nicht mehr zu heilen.',
    }
  }

  const extracts = deriveBaselineExtracts(bundle.result)
  const gzip = await gzipCompress(args.sourceFile)

  return {
    ok: true,
    prepared: {
      bundle,
      extracts,
      args: {
        p_customer_label: customerLabel,
        p_analysis_kind: form.analysisKind,
        p_engine_version: bundle.engineVersion,
        p_engine_commit_sha: bundle.engineCommitSha,
        p_computed_at: bundle.computedAt,
        // WORTGLEICH aus dem Bündel — nicht neu zusammengesetzt, nicht bereinigt. Die Zeile ist der
        // Beleg dafür, was gerechnet wurde (B14-1).
        p_inputs: bundle.inputs,
        p_result: bundle.result,
        // AUS `result` abgeleitet, nicht vom Formular erfragt: ein Feld daneben wäre eine zweite,
        // abtippbare Wahrheit, und die Abweichung fiele erst 2027 auf.
        p_baseline_billed_kw_before: extracts.billedKwBefore,
        p_baseline_billed_kw_after: extracts.billedKwAfter,
        p_baseline_annual_saving_eur: extracts.annualSavingEur,
        ...(extracts.recommendedBatteryLabel !== null
          ? { p_recommended_battery_label: extracts.recommendedBatteryLabel }
          : {}),
        ...(extracts.recommendedCapacityKwh !== null
          ? { p_recommended_capacity_kwh: extracts.recommendedCapacityKwh }
          : {}),
        // Der Name der TATSÄCHLICH hochgeladenen Datei, nicht der im Bündel vermerkte: gespeichert
        // wird, was archiviert wurde. Die Prüfsumme hat oben bereits bewiesen, dass es dieselbe
        // Datei ist — ein abweichender Name ist eine Umbenennung, keine andere Datei.
        p_source_file_name: args.sourceFileName,
        p_source_file_sha256: bundle.sourceFileSha256,
        p_source_file: toPostgresBytea(args.sourceFile),
        p_source_file_gzip: toPostgresBytea(gzip),
        ...(form.siteLabel.trim() === '' ? {} : { p_site_label: form.siteLabel.trim() }),
        ...(isUuid(form.leadId) ? { p_lead_id: form.leadId } : {}),
        ...(isUuid(form.supersedesId) ? { p_supersedes_id: form.supersedesId } : {}),
      },
    },
  }
}

/** Nur zum Zusammenstellen der Anzeige — die Auszüge stehen fachlich in `shared`. */
export type { AnalysisBaselineColumns }
