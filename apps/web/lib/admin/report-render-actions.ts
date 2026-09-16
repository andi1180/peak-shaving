'use server'

import { MeteringPointAnalysisError, runAnalysisFromMeteringPointDraft } from 'extractors'
import { NETZBETREIBER_DRAFT_KEY } from 'shared'

import { externalReportUrl } from '@/lib/config'
import { createClient } from '@/lib/supabase/server'
import { readProjectDocument } from '@/lib/project-documents/documents'
import { readMeteringPointList } from './metering-points'
import { readAdminProject } from './projects'
import {
  FORBIDDEN,
  GENERIC,
  UNKNOWN_PROJECT,
  UUID,
  isForbidden,
  readProjectId,
} from './data-entry-actions-shared'
import type { AdminState } from './schema'
import type { Json } from '@/db-types'

/**
 * D12 Teil 2 — DER ADMIN LÖST EINEN REPORT-RENDERLAUF AUS.
 *
 * Sie verbindet zwei Dinge, die es beide schon gibt und die einander bisher nicht kannten: den
 * Engine-Lauf aus dem Wizard-Entwurf (D3, `runAnalysisFromMeteringPointDraft`) und den Behälter mit
 * Ablaufdatum, über den `apps/website` ein fremd gerechnetes Ergebnis lesen kann (D12 Teil 1,
 * `platform.report_render_requests`).
 *
 * ── ⚠ GENAU EIN ZÄHLPUNKT JE AUFRUF ───────────────────────────────────────────────────────────
 * Kein Rollup über die Zählpunkte eines Projekts (D13). Was hier entsteht, ist die Übergabe EINER
 * Rechnung; eine zusammengefasste Sicht über mehrere Zählpunkte ist eine eigene Rechnung mit
 * eigenen Fragen (Welche Spitze ist die des Betriebs? Welcher Tarif gilt?) und kein Sonderfall.
 *
 * ── DIE ID FÜHRT SEIT DEM D12-ABSCHLUSS AUF EINE ECHTE SEITE ──────────────────────────────────
 * `apps/website` liest die Übergabe unter `/report/<id>` und erzeugt das PDF im Browser. Die Aktion
 * gibt die Adresse deshalb als Ziel neben der Meldung zurück (`successHref`) und nicht als Text:
 * eine von Hand übertragene Kennung mit Tippfehler sähe aus wie eine abgelaufene Übergabe.
 *
 * ── ⚠ WARUM `(prev, formData)` UND NICHT `(meteringPointId)` ──────────────────────────────────
 * Der Auftrag nannte den engeren Zuschnitt. Die Kachel braucht aber eine Rückmeldung — die Kennung
 * bei Erfolg, den Abbruchgrund sonst —, und das ist in diesem Bereich durchgehend `useActionState`
 * über eine `AdminState`-Action (Formvorbild: `saveMeteringPointTariffComparisonAction`). Ein
 * blankes `<form action={…}>` mit einem einwertigen Argument könnte keinen Rückgabewert anzeigen:
 * ein abgebrochener Lauf sähe aus wie ein erfolgreicher.
 */

/**
 * Rechnet den Zählpunkt durch und legt daraus eine Übergabe für den Report-Renderer an.
 *
 * ── ⚠ DIE SPERREN DES LAUFS WERDEN DURCHGEREICHT, NICHT NEU BEURTEILT ─────────────────────────
 * Ein Entwurf mit GESCHÄTZTER PV bricht ab, ein unvollständiger Tarif-Entwurf bricht ab, eine
 * bejahte Batterie ohne Kerndaten läuft mit einer Warnung im Ergebnis weiter — alles das entscheidet
 * `runAnalysisFromMeteringPointDraft` und sonst niemand. Hier wird die MELDUNG angezeigt und keine
 * zweite Beurteilung darübergelegt: eine eigene Vorprüfung liefe beim nächsten Umbau der Sperren
 * auseinander, und der gefährliche Fall wäre der stille — die Aktion liesse etwas durch, das der
 * Lauf ablehnt, oder lehnte etwas ab, das er rechnen kann.
 */
export async function createReportRenderRequestAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  const supabase = await createClient()

  /*
   * Die Kundenbezeichnung kommt aus der DATENBANK und nicht aus einem verborgenen Formularfeld:
   * sie steht als Wert in der Übergabe und damit auf dem Deckblatt des Reports. Aus dem Formular
   * genommen wäre sie eine Angabe des Browsers an einer Stelle, an der niemand sie mehr prüft.
   */
  const projectRes = await supabase.rpc('admin_get_project', { p_id: projectId })
  if (projectRes.error) {
    if (isForbidden(projectRes.error)) return { formError: FORBIDDEN }
    console.error('[admin/report] admin_get_project:', projectRes.error)
    return { formError: GENERIC }
  }
  const project = readAdminProject(projectRes.data)
  if (project === 'not_found') return { formError: UNKNOWN_PROJECT }
  if (project === null) {
    console.error('[admin/report] unerwartete Antwort admin_get_project:', projectRes.data)
    return { formError: GENERIC }
  }

  const listRes = await supabase.rpc('list_metering_points', { p_project_id: projectId })
  if (listRes.error) {
    if (isForbidden(listRes.error)) return { formError: FORBIDDEN }
    console.error('[admin/report] list_metering_points:', listRes.error)
    return { formError: GENERIC }
  }
  const point = readMeteringPointList(listRes.data)?.find(
    (candidate) => candidate.id === meteringPointId,
  )
  if (!point) {
    return { formError: 'Diesen Zählpunkt gibt es nicht (mehr). Bitte laden Sie die Seite neu.' }
  }

  /*
   * ⚠ DER ZÄHLPUNKT IST SCHON GELESEN, BEVOR DIE PORTS ENTSTEHEN. Der Lauf verlangt für beide
   * Ports „`null` heisst gibt es nicht, ein LESEFEHLER gehört geworfen" — und ein aus dem Port
   * geworfener Wrapper-Fehler käme unten als Text beim Admin an, statt als `FORBIDDEN`/`GENERIC`
   * behandelt zu werden. Die Zählpunkt-Hälfte ist damit erledigt; der Entwurf steht ausserdem für
   * `report_input_meta` bereit, ohne ihn aus einer Closure herausreichen zu müssen.
   */
  let run
  try {
    run = await runAnalysisFromMeteringPointDraft(meteringPointId, {
      readMeteringPoint: async () => ({
        draft: point.draft,
        sourceDocumentId: point.sourceDocumentId,
      }),
      readDocument: async (documentId) => {
        const document = await readProjectDocument(documentId)
        if (document.ok) return { bytes: document.bytes, filename: document.filename }
        // `not_found` ist die Fehlanzeige, ein Storage-Ausfall ist keine — s. Port-Zusage oben.
        if (document.reason === 'not_found') return null
        throw new Error(`readProjectDocument (${documentId}): ${document.reason}`)
      },
    })
  } catch (error) {
    if (error instanceof MeteringPointAnalysisError || error instanceof Error) {
      console.error('[admin/report] Analyse-Lauf abgebrochen:', error)
      return { formError: error.message }
    }
    console.error('[admin/report] Analyse-Lauf abgebrochen (unbekannt):', error)
    return { formError: GENERIC }
  }

  /*
   * ⚠ FÜNF FELDER, UND KEINES MEHR. `report_input_meta` ist in der Migration bewusst ohne Struktur
   * — die legt der SCHREIBENDE Schritt fest, und was hier hineinwandert, ist ab dann die Form, an
   * die sich der Renderer bindet. Deshalb nur, was ein Report ausser Ergebnis und Lastgang
   * nachweislich braucht: die Bezeichnung fürs Deckblatt, der Netzbetreiber als ANGABE (er geht in
   * keine Rechnung ein, s. `NETZBETREIBER_DRAFT_KEY`), die Grundgebühr (s. unten) und die zwei
   * Kennungen, über die sich der Lauf zurückverfolgen lässt.
   *
   * ⚠ DIE GRUNDGEBÜHR IST DER EINZIGE TARIFWERT HIER, UND SIE STEHT NICHT ALS RECHENGRÖSSE DA.
   * Sie kommt im `AnalysisResult` an keiner Stelle vor — `assumptions` führt Arbeitspreis und
   * Einspeisevergütung, aber keine Grundgebühr. Der Report braucht sie trotzdem, für GENAU einen
   * Satz: `tariffVintageNote` (`apps/website/lib/pdf-report/derive.ts`) entscheidet an ihr, ob der
   * Preisstand-Hinweis „Arbeitspreis und Grundgebühr basieren…" oder „Der Arbeitspreis basiert…"
   * lautet. Ohne sie müsste die Leseseite raten — und ein Report, der eine Grundgebühr nennt, die
   * der Kunde nie eingetragen hat, behauptet eine Grundlage, die in seiner Rechnung nicht vorkommt.
   *
   * ⚠ ALS WERTE, NICHT ALS VERWEISE — dieselbe Regel wie bei `platform.analyses` (B14-1 Regel b):
   * ein später geänderter Entwurf darf eine bereits übergebene Rechnung nicht still umschreiben.
   */
  const netzbetreiber = point.draft[NETZBETREIBER_DRAFT_KEY]
  const supplierBaseFee = point.draft.supplierBaseFeeEurPerMonth
  const reportInputMeta = {
    customerLabel: project.customer_label,
    netzbetreiber: typeof netzbetreiber === 'string' ? netzbetreiber : null,
    /*
     * `null` heisst „keine Angabe" und ist NICHT dasselbe wie 0 — im Contract ist das Feld optional
     * (Delta 19), und `tariffVintageNote` behandelt beide ohnehin gleich. Ein aus einem von Hand
     * veränderten `jsonb` stammender Nicht-Zahlenwert fällt hier ebenfalls auf `null`, statt als
     * fremder Typ in die Übergabe zu wandern.
     */
    supplierBaseFeeEurPerMonth: typeof supplierBaseFee === 'number' ? supplierBaseFee : null,
    meteringPointId,
    projectId,
  }

  /*
   * 24 Stunden — die Obergrenze, die der Wrapper zulässt. Der Renderlauf wird von einem Menschen
   * ausgelöst, der die Kennung danach weiterreicht; eine kürzere Frist liefe ab, während der Report
   * noch gelesen wird. Der Wrapper weist alles ausserhalb 1..24 mit 22023 ab.
   */
  const created = await supabase.rpc('create_report_render_request', {
    p_analysis_result: run.result as unknown as Json,
    p_load_profile: run.loadProfile as unknown as Json,
    p_report_input_meta: reportInputMeta as unknown as Json,
    p_ttl_hours: 24,
  })

  if (created.error) {
    if (isForbidden(created.error)) return { formError: FORBIDDEN }
    console.error('[admin/report] create_report_render_request:', created.error)
    return { formError: GENERIC }
  }
  if (typeof created.data !== 'string' || created.data === '') {
    console.error('[admin/report] unerwartete Antwort create_report_render_request:', created.data)
    return { formError: GENERIC }
  }

  return {
    success: `Report-Übergabe angelegt — sie läuft in 24 Stunden ab.`,
    successHref: externalReportUrl(created.data),
  }
}
