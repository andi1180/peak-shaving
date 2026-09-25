'use server'

import { MeteringPointAnalysisError, runAnalysisFromMeteringPointDraft } from 'extractors'
import {
  NETZBETREIBER_DRAFT_KEY,
  REPORT_OPTIONAL_SECTIONS,
  REPORT_OPTIONAL_SECTIONS_FIELD,
  REPORT_OPTIONAL_SECTIONS_MARKER,
  displayPriceBasisFor,
  parseNetzebeneDraftValue,
  type GridTariffRowInput,
  type ReportOptionalSection,
} from 'shared'

import { externalReportUrl } from '@/lib/config'
import { createClient } from '@/lib/supabase/server'
import { readProjectDocument } from '@/lib/project-documents/documents'
import { readTariffPricingForAnalysis } from './analysis-tariff-inputs'
import { batteryCategoryForSegment, fetchBatteryCatalogForAnalysis } from './battery-catalog-source'
import { readStoredInvoiceExtractions } from './invoice-extractions'
import { readMeteringPointList } from './metering-points'
import { readPvArraysDraft } from './pv-array-draft'
import { readPvDraft } from './pv-draft'
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

  // K3c: die Katalog-Kategorie folgt DIREKT dem Segment; ohne Segment wird nicht geraten.
  const category = batteryCategoryForSegment(project.segment)
  if (category === null) {
    return {
      formError:
        'Für dieses Projekt ist noch kein Segment (Privat/Betrieb) gewählt — ohne Segment ist ' +
        'nicht entscheidbar, welcher Speicherkatalog gilt. Bitte zuerst in der Dateneingabe wählen.',
    }
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
   * D9 — DIE GELESENEN PREISBLATT-ZEILEN WERDEN IM VORBEIGEHEN FESTGEHALTEN.
   *
   * Der Analyse-Lauf gibt sie nicht zurück (`MeteringPointAnalysisRun` führt Ergebnis, Lastgang,
   * PV-Befund — keine Preisseiten), und `AnalysisResult` trägt nur die gerechneten WERTE, nie deren
   * Gültigkeit. Ein zweiter Lesevorgang derselben Tabelle wäre die Alternative gewesen und die
   * schlechtere: er liefe gegen einen womöglich inzwischen geänderten Pflegestand, und der Report
   * nennte dann einen Stand, mit dem nicht gerechnet wurde. Was hier durchgereicht wird, ist
   * dieselbe Antwort, die in die Rechnung ging.
   */
  let gridTariffRows: GridTariffRowInput[] | null = null

  // K3c: EINMAL geladen, für Erstlauf und Jahres-Hochrechnung derselbe Stand; kein Rückfall.
  const catalog = await fetchBatteryCatalogForAnalysis(supabase, category)
  if (catalog.kind === 'failed') {
    console.error('[admin/report] Speicherkatalog:', catalog.reason, catalog.message)
    return {
      formError:
        catalog.reason === 'not_configured'
          ? 'Die Verbindung zum Speicherkatalog ist nicht eingerichtet.'
          : 'Der Speicherkatalog liess sich gerade nicht abrufen. Bitte erneut versuchen.',
    }
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
      batteryCatalog: catalog.kind === 'available' ? catalog.batteries : [],
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
      /*
       * ⚠ DER DRITTE PORT IST GESETZT, UND DAMIT WIRD DER DREI-WEGE-VERGLEICH IMMER VERSUCHT. Es
       * gibt dafür keinen Haken in der Oberfläche: ob der Hebel berechenbar ist, entscheidet der
       * Datenbestand (Netzentgelt-Zeile gepflegt? Spotpreise lückenlos?), und die Antwort darauf
       * steht als Begründung im Ergebnis. Ein Schalter daneben könnte ihr nur widersprechen.
       *
       * ⚠ DER PORT WIRFT NICHT: `readTariffPricingForAnalysis` setzt für eine gescheiterte
       * Preisseite `null` ein. Geworfen käme der Fehler oben als Abbruch der GANZEN Analyse an —
       * Peak Shaving und Eigenverbrauch hingen dann an einer Vergleichsseite, von der sie nicht
       * abhängen.
       */
      fetchTariffPricing: async (request) => {
        const pricing = await readTariffPricingForAnalysis(supabase, request, {
          category,
          postalCode: project.postal_code,
        })
        gridTariffRows = pricing.gridTariffRows
        return pricing
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
   * ⚠ DIESE FELDER, UND KEINES MEHR. `report_input_meta` ist in der Migration bewusst ohne Struktur
   * — die legt der SCHREIBENDE Schritt fest, und was hier hineinwandert, ist ab dann die Form, an
   * die sich der Renderer bindet. Deshalb nur, was ein Report ausser Ergebnis und Lastgang
   * nachweislich braucht: die Bezeichnung fürs Deckblatt, der Netzbetreiber als ANGABE (er geht in
   * keine Rechnung ein, s. `NETZBETREIBER_DRAFT_KEY`), die Grundgebühr (s. unten), die zwei
   * D5-Felder (s. unten) und die zwei Kennungen, über die sich der Lauf zurückverfolgen lässt.
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
    // Für „Ihr Netzanschluss" (Voraussetzungen) — `tariffSource` bleibt hier der dritte Zustand.
    netzebene: parseNetzebeneDraftValue(point.draft.netzebene),
    /*
     * `null` heisst „keine Angabe" und ist NICHT dasselbe wie 0 — im Contract ist das Feld optional
     * (Delta 19), und `tariffVintageNote` behandelt beide ohnehin gleich. Ein aus einem von Hand
     * veränderten `jsonb` stammender Nicht-Zahlenwert fällt hier ebenfalls auf `null`, statt als
     * fremder Typ in die Übergabe zu wandern.
     */
    supplierBaseFeeEurPerMonth: typeof supplierBaseFee === 'number' ? supplierBaseFee : null,
    /*
     * D5 — die zwei Hälften des PV-Ausfall-Hinweises, und sie sind bewusst GETRENNT.
     *
     * `pvOutageMonths` ist die BEOBACHTUNG am Lastgang (gerechnet im Lauf, `detectPvOutageMonths`),
     * `hasPv` die ANGABE des Kunden aus dem Entwurf. Erst beide zusammen ergeben eine Aussage: ohne
     * Anlage ist ein fehlender Mittagseinbruch kein Befund, sondern der Normalzustand. Die
     * Verknüpfung fällt im Report (`basis.ts`) und nicht hier — dieselbe Trennlinie wie in B16-1
     * zwischen Beobachtung und Urteil.
     *
     * ⚠ `null` heisst „die Frage wurde nie beantwortet" und ist NICHT `false` (s. `readPvDraft`).
     * Auf `false` gerundet stünde im Report, der Kunde habe keine Anlage — eine Aussage, die der
     * Entwurf nicht trägt. Der Hinweis unterbleibt in beiden Fällen, aber aus verschiedenen Gründen.
     *
     * ⚠ ALS WERTE, NICHT ALS VERWEISE — dieselbe Regel wie bei den übrigen Feldern: ein später
     * geänderter Entwurf darf eine bereits übergebene Rechnung nicht still umschreiben.
     */
    hasPv: readPvDraft(point.draft).hasPv,
    /*
     * ⚠ OHNE DIE STUFE IST `hasPv` IM REPORT NICHT LESBAR. Der Report schreibt daraus „bestehend"
     * oder „geplant", und bei einer geplanten Anlage ist die PV-Wirkung eine SCHÄTZUNG, die vom
     * Lastgang abgezogen wurde — eine als bestehend ausgewiesene Schätzung wäre die teuerste
     * Verwechslung des PV-Kapitels. `null` heisst „keine Anlage" oder „nie erfasst"; der Report
     * liest beides als `existing`, den Zustand jedes vor dem 22.09.2026 erfassten Zählpunkts.
     */
    pvStage: readPvDraft(point.draft).pvStage,
    /*
     * Die Nennleistung der Anlage, Summe über die erfassten Modulflächen — eine ANGABE für den
     * Fliesstext der Zusammenfassung („eine PV-Anlage (10,2 kWp)") und keine Rechengrösse: die
     * Engine bekommt einen Lastgang, in dem die Erzeugung bereits steckt.
     *
     * ⚠ `null`, solange nicht JEDE erfasste Fläche eine Nennleistung trägt. Die Summe über die
     * Hälfte der Flächen wäre eine zu kleine Anlage — und sie sähe auf dem Blatt aus wie eine
     * gemessene Angabe (dieselbe Haltung wie beim Abbruch des PVGIS-Laufs bei unvollständigen
     * Flächen).
     */
    pvPeakPowerKwp: readPvPeakPowerKwp(point.draft),
    pvOutageMonths: run.pvOutageMonths,
    /*
     * D9 — DIE ZWEI ROHEN HERKUNFTSANGABEN DER TARIFSEITE.
     *
     * Beide sind BELEGT und reisten bis D9 nicht mit: der Gültigkeitsbeginn der Preisblatt-Zeile
     * stammt aus derselben Abfrage, die in die Rechnung ging, der Abrechnungszeitraum aus den
     * gelesenen Kundenrechnungen des Entwurfs. Der Report braucht sie für die Datenquellen-Tabelle
     * und für nichts sonst.
     *
     * ⚠ SIE SIND KEINE TARIFHERKUNFT. Welcher Leistungspreis am Ende gerechnet wurde — Vorschlag
     * aus dem Preisblatt, abgelesene Netzrechnung oder Handeingabe —, hält der Wizard-Entwurf
     * weiterhin nicht fest; `tariffSource` bleibt deshalb unten der dritte Zustand.
     *
     * ⚠ ALS WERTE, NICHT ALS VERWEISE — dieselbe Regel wie bei den übrigen Feldern.
     */
    gridTariffValidFrom: readGridTariffValidFrom(gridTariffRows),
    invoicePeriods: readInvoicePeriods(point.draft),
    /*
     * Report-Baukasten C — die Bausteine, die der Admin an der Kachel stehen lassen wollte.
     *
     * ⚠ DAS FELD WIRD WEGGELASSEN, WENN DAS FORMULAR DIE AUSWAHL GAR NICHT FÜHRT, und das ist
     * nicht dasselbe wie eine leere Auswahl: „Feld nicht vorhanden" heisst auf der Leseseite ALLE,
     * `[]` heisst KEINEN. Ein unangekreuztes Kontrollkästchen sendet nichts, beide Fälle
     * sähen im `FormData` also gleich aus — der Marker unterscheidet sie (s.
     * `readOptionalSections`).
     *
     * ⚠ ALS WERTE, NICHT ALS VERWEISE — dieselbe Regel wie bei den übrigen Feldern: es gibt
     * bewusst keine gespeicherte Vorlage, auf die hier gezeigt würde. Sie könnte eine bereits
     * übergebene Rechnung still umschreiben.
     */
    ...readOptionalSections(formData),
    // K3c: Preisstand und Wirkungsgrad-Herkunft als Wertkopie — sonst nennte der Report für ein
    // echtes Katalog-Gerät „keine Preisquelle hinterlegt".
    ...(catalog.kind === 'available' ? { batteryCatalogMeta: catalog.meta } : {}),
    // H3: Privatkunden sehen Beträge inkl. USt — als Wert, damit die Übergabe es selbst trägt.
    priceDisplay: displayPriceBasisFor(category),
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
    success:
      'Report-Übergabe angelegt — sie läuft in 24 Stunden ab.' +
      (catalog.kind === 'empty'
        ? category === 'heim'
          ? ' Speicherkatalog für Privathaushalte im Aufbau — der Report enthält keinen Speichervorschlag.'
          : ' Im Speicherkatalog ist für Betriebe kein Gerät freigegeben — der Report enthält keinen Speichervorschlag.'
        : ''),
    successHref: externalReportUrl(created.data),
  }
}

/**
 * Die Nennleistung der PV-Anlage — Summe über die erfassten Modulflächen.
 *
 * ⚠ ALLES ODER NICHTS: fehlt auch nur einer Fläche die Nennleistung, gibt es keine Summe. Eine
 * über die vollständigen Flächen gebildete Zahl wäre kleiner als die Anlage und stünde trotzdem
 * als Angabe auf einem Kundendokument.
 */
function readPvPeakPowerKwp(draft: Record<string, unknown>): number | null {
  const arrays = readPvArraysDraft(draft)
  if (arrays.length === 0) return null
  let total = 0
  for (const array of arrays) {
    if (array.peakPowerKwp === null || !(array.peakPowerKwp > 0)) return null
    total += array.peakPowerKwp
  }
  return total
}

/**
 * D9 — die Gültigkeitsbeginne der Preisblatt-Zeilen, aufsteigend und ohne Dubletten.
 *
 * ⚠ `null` (die Netzentgelt-Seite war nicht lesbar ODER wurde gar nicht gefragt) und eine leere
 * Liste („für diese Kombination ist nichts gepflegt") führen beide zu `[]`. Die Unterscheidung
 * bliebe ohne Anzeige: der Report sagt in beiden Fällen „nicht nachverfolgt", und ein zweiter,
 * nirgends sichtbarer Zustand wäre eine Unterscheidung ohne Unterschied.
 */
function readGridTariffValidFrom(rows: GridTariffRowInput[] | null): string[] {
  if (rows === null) return []
  const seen = new Set<string>()
  for (const row of rows) {
    if (typeof row.validFrom === 'string' && row.validFrom !== '') seen.add(row.validFrom)
  }
  return [...seen].sort()
}

/**
 * D9 — die Abrechnungszeiträume der gelesenen Kundenrechnungen.
 *
 * ⚠ Eine Rechnung OHNE Zeitraum fällt heraus, statt als leerer Eintrag mitzufahren: in der Tabelle
 * wäre sie eine Zeile, die eine Quelle nennt und nichts belegt. `billingPeriodAssumed` reist mit,
 * weil ein abgeleiteter Zeitraum eine Annahme ist und nicht wie eine abgelesene Angabe dastehen darf
 * (s. `InvoiceExtraction.billingPeriodAssumed`).
 */
function readInvoicePeriods(
  draft: Record<string, unknown>,
): { from: string | null; to: string | null; assumed: boolean | null }[] {
  return readStoredInvoiceExtractions(draft)
    .map(({ extraction }) => ({
      from: extraction.billingPeriodFrom,
      to: extraction.billingPeriodTo,
      assumed: extraction.billingPeriodAssumed,
    }))
    .filter((period) => period.from !== null || period.to !== null)
}


/**
 * Report-Baukasten C — die Auswahl aus dem Formular, oder gar kein Feld.
 *
 * ⚠ DER MARKER IST DER GANZE PUNKT. `formData.getAll('optionalSections')` ist leer, wenn der Admin
 * alle abgewählt hat UND wenn das Formular die Kontrollkästchen überhaupt nicht führt (eine
 * Fassung vor diesem Schritt). Die beiden Fälle sind gegensätzlich — „keinen zeigen" gegen „alle
 * zeigen" —, und eine Auswahl, die über das verborgene Feld abgeschickt wurde, ist die einzige
 * Auskunft darüber, welcher davon gilt.
 *
 * ⚠ GEFILTERT ÜBER DIE KONSTANTE und nicht bloss durchgereicht: was aus einem Formular kommt, kommt
 * aus einem Browser. Ein fremder Wert liefe sonst als Kennung in `report_input_meta`, wo ihn die
 * Leseseite ohnehin verwürfe — nur dass er dort bereits in der eingefrorenen Übergabe stünde.
 */
function readOptionalSections(
  formData: FormData,
): { optionalSections: ReportOptionalSection[] } | Record<string, never> {
  if (formData.get(REPORT_OPTIONAL_SECTIONS_MARKER) !== '1') return {}
  const chosen = formData.getAll(REPORT_OPTIONAL_SECTIONS_FIELD)
  return { optionalSections: REPORT_OPTIONAL_SECTIONS.filter((id) => chosen.includes(id)) }
}
