'use client'

/**
 * Die Rechnungs-Station des Dateneingabe-Wizards (B24, Teil 1).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ EIN FORMULAR, DAS MAN MEHRMALS ABSCHICKEN SOLL — und deshalb keine Ja/Nein-Frage davor
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Die Lastgang-Station nebenan stellt eine Weiche („Haben Sie Lastgangsdaten?"), weil ein Zählpunkt
 * genau EINEN Lastgang trägt und die Antwort über zwei ganz verschiedene Zweige entscheidet. Hier
 * gibt es nichts zu verzweigen: eine Rechnung ist ein Beleg unter mehreren, und der Regelfall
 * dieses Schritts sind ZWEI oder DREI (oder zwölf Monatsrechnungen, Delta §3.2). Das Feld steht
 * deshalb immer da, und bereits gelesene Rechnungen stehen darüber.
 *
 * ── ⚠ DIE ZUSAMMENFASSUNG KOMMT AUS DER DATENBANK, NICHT AUS DEM RÜCKGABEWERT DER ACTION ──────
 * Wortgleich zur Lastgang-Station und aus demselben Grund: nach einem Neuladen stünde sie sonst
 * leer da, obwohl gespeichert ist. Was hier gezeigt wird, ist die Auswertung des ENTWURFS
 * (`meteringPoint.draft`), den die Seite über `readMeteringPointList` liest — genau deshalb ruft
 * die Action `revalidatePath`.
 *
 * ── ⚠ WIDERSPRÜCHE STEHEN GETRENNT UND AUFFÄLLIG ──────────────────────────────────────────────
 * `mergeInvoiceExtractions` übernimmt einen Wert nur, wenn alle Rechnungen, die etwas dazu sagen,
 * dasselbe sagen; sonst bleibt das Feld leer und wird als Widerspruch gemeldet. Genau dieser Fall
 * ist der Grund, warum die Station überhaupt etwas anzeigt: „zwei Rechnungen gelesen" allein sähe
 * nach Erfolg aus, während der Arbeitspreis in Wahrheit ungeklärt ist. Er steht deshalb NICHT in
 * derselben Liste wie die übernommenen Werte, sondern als eigener, farblich abgesetzter Block.
 *
 * ⚠ UND ER NENNT DIE FOLGE, DIE MAN SONST ÜBERSIEHT: ein Wert, der VOR dem Widerspruch übernommen
 * wurde, bleibt im Entwurf stehen — er wird nicht zurückgenommen (die schonendere Richtung, s.
 * `invoiceDraftValues`). Ohne diesen Satz hielte man das Feld für leer.
 *
 * ── WAS DIESE STATION NICHT TUT ───────────────────────────────────────────────────────────────
 * Sie ordnet die Dokumentart NICHT zu (`classifyUpload` kommt hier nicht vor): die Station steht
 * unter der Überschrift „Rechnung", der Admin lädt Rechnungen hoch, und eine Rückfrage nach dem
 * Dokumenttyp wäre eine Reibung ohne Ertrag. Sie verlangt auch KEINE Bezeichnung je Datei (anders
 * als `apps/website/components/flow/mixed-upload-panel.tsx`, wo der Nutzer einen gemischten Stapel
 * ablegt) und fragt NICHT „Jahresrechnung oder Monatsrechnungen" — das steht auf der Rechnung, und
 * der Abrechnungszeitraum reist in jedem Eintrag mit.
 *
 * Sie vergleicht den Abrechnungszeitraum AUCH NICHT gegen den Lastgang — das ist
 * `check_data_consistency` bzw. der KI-Check (Station 6). Eine zweite Prüfung daneben wäre eine
 * zweite Wahrheit über dieselbe Frage.
 *
 * ── ⚠ DER RÜCKWEG NIMMT DIE AUSWERTUNG ZURÜCK, NICHT DIE DATEI ───────────────────────────────
 * Der Kopf dieser Datei lautete bis hierher: „Und sie nimmt eine einzelne hochgeladene Rechnung
 * nicht wieder zurück: ein Rückweg wie beim Lastgang (PR #194) ist ein eigener Auftrag." Das stimmt
 * nicht mehr — jeder Dateiname trägt einen „Entfernen"-Link. Der Satz ist ERSETZT statt stehen
 * gelassen; ein Kommentar, der eine Regel behauptet, die es nicht mehr gibt, ist teurer als keiner.
 *
 * Anders als beim Lastgang verschwindet dabei KEINE Datei: sie bleibt in der Dokumentenliste des
 * Projekts, und zurückgenommen wird allein die Aussage „aus diesem Beleg wurde für diesen Zählpunkt
 * gelesen" (Begründung in `removeMeteringPointInvoiceAction`). Der Link ist deshalb klein und
 * textnah und nicht der Gegenspieler des primären Knopfes.
 *
 * ── ⚠ DER ZUSTAND DES ENTFERNENS HÄNGT AN DIESER KOMPONENTE, NICHT AM EINZELNEN FORMULAR ──────
 * Zwei Gründe, und beide sind bereits einmal bezahlt worden (B16-4b, dann die Lastgang-Station):
 *
 *   1. Wird die LETZTE Rechnung entfernt, verschwindet `InvoiceSummary` samt allem darin — ein
 *      `useActionState` dort nähme seine Meldung mit, und zwar genau im Moment ihres Entstehens.
 *   2. Es gibt N Formulare (eines je Datei) und nur EINEN laufenden Vorgang. Ein gemeinsamer
 *      Zustand sperrt deshalb während des Entfernens ALLE Links — und das ist keine Einschränkung,
 *      sondern der Schutz: zwei gleichzeitige Vorgänge läsen denselben Entwurf, und der zweite
 *      schriebe den Eintrag zurück, den der erste gerade gestrichen hat.
 *
 * ⚠ UND ES IST EIN EIGENER Zustand neben dem des Uploads, nicht derselbe: ein Fehler beim Entfernen
 * überschriebe sonst die Meldung eines gerade gelaufenen Uploads und umgekehrt — beide sind wahr
 * und sagen Verschiedenes.
 *
 * ── ⚠ DER DRITTE WEG: „OHNE RECHNUNG FORTFAHREN" ──────────────────────────────────────────────
 * Seit diesem Schritt hat die Station drei gleichrangige Wege statt zwei: hochladen, von Hand
 * eintragen — oder ausdrücklich vermerken, dass es für diesen Zählpunkt bewusst keine Tarifdaten
 * gibt. Der dritte ist KEINE Weiche (der Weiter-Link war schon vorher rechnungsunabhängig, s. u.),
 * sondern ein SIGNAL: ohne ihn ist „bewusst ohne" von „noch nicht besucht" nicht zu unterscheiden.
 *
 * ⚠ Er bekommt aus demselben Grund wie das Entfernen einen EIGENEN `useActionState` — drei Wege,
 * drei Meldungen, und keine darf die andere überschreiben.
 */
import * as React from 'react'
import { useActionState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

import {
  COUNTRY_DISPLAY,
  hasSupplierPrices,
  priceBasisLabel,
  type Country,
  type GridOperatorOption,
  type PriceBasis,
} from 'shared'

import { Button } from '@/components/ui/button'
import {
  removeMeteringPointInvoiceAction,
  discardInvoiceUploadAction,
  registerInvoiceUploadAction,
  requestInvoiceUploadAction,
  skipMeteringPointInvoiceAction,
} from '@/lib/admin/data-entry-actions'
import { setInvoicePriceBasisAction } from '@/lib/admin/data-entry-actions-rechnung-basis'
import {
  finalizeInvoiceExtractionsAction,
  listInvoiceExtractionsAction,
  type InvoiceExtractionRow,
} from '@/lib/admin/data-entry-actions-rechnung-extract'
import {
  INVOICE_EXTRACT_POLL_MS,
  canRetryInvoiceRow,
  createInvoiceExtractionQueue,
  invoiceRowView,
  invoiceRowsInProgress,
  type InvoiceRowView,
} from '@/lib/admin/invoice-extract-queue'
import {
  INVOICE_SKIPPED_KEY,
  MAX_INVOICES_PER_SELECTION,
  effectiveInvoiceExtraction,
  foldStoredInvoices,
  invoiceMergeDisplayRows,
  manualTariffDraftIsEmpty,
  readManualTariffDraft,
  readStoredInvoiceExtractions,
  supplierPriceBasisOf,
} from '@/lib/admin/invoice-extractions'
import { ADMIN_INITIAL_STATE, type AdminState } from '@/lib/admin/schema'
import { meteringPointStationId, stationHref } from '@/lib/admin/data-entry-stations'
import { MultiDirectUpload, type UploadedDocument } from './multi-direct-upload'
import { InvoiceFieldChoices } from './invoice-field-choices'
import { InvoicePeriod, type InvoicePeriodRowData } from './invoice-period-row'
import { invoicePeriodFlags, localDateIso } from '@/lib/admin/invoice-period-flags'
import { DataEntryInvoiceManual } from './data-entry-invoice-manual'
import { DataEntryInvoiceSkip } from './data-entry-invoice-skip'
import type { MeteringPointSummary } from '@/lib/admin/metering-points'

const PDF_TYPES = ['application/pdf'] as const
import { AdminError, AdminSuccess } from './ui'

const FIELD_ID = 'dateneingabe-rechnungen'
const EXTRACT_ROUTE = '/api/admin/invoice-extract'

const ROW_VIEW_TEXT: Record<InvoiceRowView, string> = {
  waiting: 'wartet',
  reading: 'wird gelesen …',
  done: 'gelesen',
  failed: 'fehlgeschlagen',
  stale: 'hängt seit über 10 Minuten',
}

const FINALIZE_CRASH_TEXT =
  'Die gelesenen Rechnungen konnten gerade nicht zusammengeführt werden. Bitte die Seite neu laden.'

/** Eine Rechnung über die Route lesen; jeder Netz- oder Plattformfehler wird zu `request_failed`. */
async function extractViaRoute(
  projectId: string,
  meteringPointId: string,
  documentId: string,
): Promise<{ status: string }> {
  try {
    const res = await fetch(EXTRACT_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, meteringPointId, documentId }),
    })
    const body = (await res.json().catch(() => null)) as { status?: unknown } | null
    return typeof body?.status === 'string' ? { status: body.status } : { status: 'request_failed' }
  } catch {
    return { status: 'request_failed' }
  }
}
const MANUAL_ID = 'dateneingabe-rechnung-manuell'

export function DataEntryInvoice({
  projectId,
  meteringPoint,
  meteringPointNumber,
  maxBytes,
  nextHref,
  defaultPriceBasis,
  country,
  operators,
}: {
  projectId: string
  meteringPoint: MeteringPointSummary
  /** Projektland und dessen Netzbetreiber — für die Netzanschluss-Felder. */
  country: Country
  operators: readonly GridOperatorOption[]
  /** H3: Vorgabe der Preisbasis nach Segment (privat → inkl. USt, betrieb → netto). */
  defaultPriceBasis: PriceBasis
  /** 1-basiert, wie in der Station — die Nummer ist eine Position, keine Kennung. */
  meteringPointNumber: number
  /**
   * Die Grössengrenze je Datei, aus der Server-Komponente hereingereicht.
   *
   * ⚠ SIE MUSS EIN PROP SEIN, anders als `MAX_INVOICES_PER_SELECTION`:
   * `MAX_INVOICE_FILE_BYTES` liegt in `packages/extractors`, und dessen Barrel ist `server-only`.
   * Hier importiert bräche er den Client-Build. Die Zahl selbst ist harmlos — nur ihr Fundort
   * nicht.
   */
  maxBytes: number
  /** Die nächste Station, oder `null` am Ende der Liste. */
  nextHref: string | null
}) {
  /*
   * Die Dateien gehen direkt in den Storage (`MultiDirectUpload`), danach wird jede in einem
   * eigenen Request gelesen (`createInvoiceExtractionQueue`, höchstens drei gleichzeitig) und am
   * Ende einmal zusammengeführt. Der Lesestand je Rechnung kommt aus `document_extractions` und
   * übersteht damit ein Neuladen.
   */
  const meteringPointId = meteringPoint.id
  const [state, setState] = React.useState<AdminState>(ADMIN_INITIAL_STATE)
  const [extractionRows, setExtractionRows] = React.useState<InvoiceExtractionRow[] | null>(null)
  const [listError, setListError] = React.useState<string | null>(null)
  const [active, setActive] = React.useState<string[]>([])
  const [now, setNow] = React.useState(() => Date.now())
  // Dateinamen der hochgeladenen, aber noch nicht gestarteten Rechnungen (noch ohne Tabellenzeile).
  const queuedNames = React.useRef(new Map<string, string>())
  // Lädt den Auswahlblock für Widersprüche neu: nach Abschluss, Entfernen und Preisbasis-Wechsel.
  const [conflictsVersion, reloadConflicts] = React.useReducer((n: number) => n + 1, 0)

  const refreshRows = React.useCallback(async () => {
    try {
      const result = await listInvoiceExtractionsAction(projectId, meteringPointId)
      if (result.ok) {
        setExtractionRows(result.rows)
        setListError(null)
      } else setListError(result.error)
    } catch {
      setListError('Der Lesestand konnte gerade nicht geladen werden.')
    }
    setNow(Date.now())
  }, [projectId, meteringPointId])

  const queue = React.useMemo(() => {
    const created = createInvoiceExtractionQueue({
      extract: (documentId) => extractViaRoute(projectId, meteringPointId, documentId),
      finalize: async () => {
        try {
          setState(await finalizeInvoiceExtractionsAction(projectId, meteringPointId))
        } catch (cause) {
          console.error('[admin/dateneingabe] Rechnungen abschliessen:', cause)
          setState({ formError: FINALIZE_CRASH_TEXT })
        }
        reloadConflicts()
      },
      onChange: () => {
        setActive(created.active())
        void refreshRows()
      },
    })
    return created
  }, [projectId, meteringPointId, refreshRows])

  const handleUploaded = (documents: UploadedDocument[]) => {
    for (const document of documents) queuedNames.current.set(document.documentId, document.name)
    setState(ADMIN_INITIAL_STATE)
    queue.enqueue(documents.map((document) => document.documentId))
  }

  React.useEffect(() => {
    void refreshRows()
  }, [refreshRows])

  // Neu laden, solange etwas wartet oder gelesen wird; eine hängende Zeile hält die Abfrage nicht an.
  const inProgress =
    active.length > 0 ||
    (extractionRows !== null && invoiceRowsInProgress(extractionRows, now))
  React.useEffect(() => {
    if (!inProgress) return
    const timer = window.setInterval(() => void refreshRows(), INVOICE_EXTRACT_POLL_MS)
    return () => window.clearInterval(timer)
  }, [inProgress, refreshRows])

  // Noch nicht gestartete Rechnungen gingen beim Neuladen verloren (sie haben keine Zeile).
  React.useEffect(() => {
    if (active.length === 0) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [active.length])

  const statusList = invoiceStatusList(extractionRows ?? [], active, queuedNames.current, now)
  /*
   * ⚠ ZWEITER Zustand, absichtlich HIER und nicht im einzelnen Entfernen-Formular — s. Kopf: mit
   * der letzten Rechnung verschwindet die Zusammenfassung, und mit ihr nähme ein Zustand darin
   * seine eigene Erfolgsmeldung mit.
   */
  const [removeState, removeAction, isRemoving] = useActionState(
    removeMeteringPointInvoiceAction,
    ADMIN_INITIAL_STATE,
  )
  /*
   * ⚠ DRITTER Zustand. Er gehört nicht zum Upload (dessen Meldung nennt gelesene Rechnungen) und
   * nicht zum Entfernen (dessen Meldung nennt eine zurückgenommene Auswertung) — hier wird eine
   * ENTSCHEIDUNG quittiert, und alle drei können nebeneinander wahr sein.
   */
  const [skipState, skipAction, isSkipping] = useActionState(
    skipMeteringPointInvoiceAction,
    ADMIN_INITIAL_STATE,
  )
  const [basisState, basisAction, isSettingBasis] = useActionState(
    setInvoicePriceBasisAction,
    ADMIN_INITIAL_STATE,
  )
  React.useEffect(() => {
    if (removeState !== ADMIN_INITIAL_STATE || basisState !== ADMIN_INITIAL_STATE) reloadConflicts()
  }, [removeState, basisState])
  const error = state.fieldErrors?.files
  /*
   * ⚠ Der erfasste Tarifstand dieses Zählpunkts — aus dem ENTWURF, wie alles andere auf dieser
   * Station auch (s. Kopf). Er befüllt das Formular der Handeingabe wieder; ohne ihn stand es nach
   * jedem Stationswechsel leer da, obwohl gespeichert war.
   */
  const manualValues = readManualTariffDraft(
    meteringPoint.draft,
    defaultPriceBasis,
    operators.map((operator) => operator.id),
  )
  const hasManualValues = !manualTariffDraftIsEmpty(manualValues)
  /*
   * ⚠ AUFGEKLAPPT, SOBALD ETWAS ERFASST IST — und nur dann.
   *
   * Zugeklappt ist der zweite Weg eine bewusste Zurückhaltung: ausgeklappt danebenstehend lüde er
   * dazu ein, das Auslesen zu überspringen und Zahlen abzutippen, die eine Datei genauer liefert.
   * Diese Überlegung trägt aber nur, SOLANGE noch nichts erfasst ist. Steht bereits ein Wert im
   * Entwurf, ist die Einladung längst angenommen — und zugeklappt zu bleiben hiesse dann, den
   * einzigen Ort zu verstecken, an dem dieser Stand überhaupt sichtbar ist. Genau das sah aus wie
   * „nichts gespeichert".
   */
  const [mode, setMode] = React.useState<'closed' | 'manual' | 'skip'>(
    hasManualValues ? 'manual' : 'closed',
  )
  const router = useRouter()

  // Der Vermerk ist gesetzt — erst jetzt geht es zur nächsten Station.
  React.useEffect(() => {
    if (!skipState.success) return
    if (nextHref !== null) router.push(nextHref)
    else setMode('closed')
  }, [skipState, nextHref, router])

  React.useEffect(() => {
    if (error) document.getElementById(FIELD_ID)?.focus()
  }, [error])

  const stored = readStoredInvoiceExtractions(meteringPoint.draft)
  /*
   * ⚠ STRIKT `=== true`, nicht truthy: `'true'` und `1` sähen wie eine Aussage aus und sind keine
   * (dieselbe Lesart wie `readBatteryDraft`/`readPvDraft`). Und der Wert kommt aus der DATENBANK,
   * nicht aus dem Rückgabewert der Action — s. Kopf: nach einem Neuladen stünde der Vermerk sonst
   * nicht mehr da, obwohl er gespeichert ist.
   */
  const skipped = meteringPoint.draft[INVOICE_SKIPPED_KEY] === true
  // H3: gefaltet auf netto — genau das, was auch im Entwurf steht.
  const { merged } = foldStoredInvoices(stored)
  const rows = invoiceMergeDisplayRows(merged)
  const periodFlags = invoicePeriodFlags(
    stored,
    localDateIso(new Date(), COUNTRY_DISPLAY[country].timeZone),
  )

  return (
    <div className="flex flex-col gap-6">
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}
      {state.formError && <AdminError>{state.formError}</AdminError>}
      {/*
        Beide Meldungen des Entfernens stehen HIER und nicht in der Zusammenfassung: die gibt es
        nach dem Entfernen der letzten Rechnung nicht mehr, und dann wäre ausgerechnet die Meldung
        weg, die sagt, was gerade geschehen ist.
      */}
      {removeState.success && <AdminSuccess>{removeState.success}</AdminSuccess>}
      {removeState.formError && <AdminError>{removeState.formError}</AdminError>}
      {/*
        ⚠ Die Erfolgsmeldung des dritten Wegs ist FLÜCHTIG (der nächste Seitenaufruf hat sie nicht
        mehr) — die dauerhafte Aussage ist die Vermerk-Zeile darunter, die aus dem Entwurf kommt.
        Beides ist nötig: die Meldung quittiert den Klick, die Zeile überdauert ihn.
      */}
      {skipState.success && <AdminSuccess>{skipState.success}</AdminSuccess>}
      {skipState.formError && <AdminError>{skipState.formError}</AdminError>}
      {basisState.success && <AdminSuccess>{basisState.success}</AdminSuccess>}
      {basisState.formError && <AdminError>{basisState.formError}</AdminError>}

      {stored.length > 0 && (
        <InvoiceSummary
          number={meteringPointNumber}
          projectId={projectId}
          meteringPointId={meteringPoint.id}
          entries={stored.map((entry) => ({
            documentId: entry.documentId,
            filename: entry.filename,
            hasPrices: hasSupplierPrices(entry.extraction),
            basis: supplierPriceBasisOf(entry),
            period: periodRowData(entry, periodFlags.get(entry.documentId) ?? []),
          }))}
          onPeriodChanged={reloadConflicts}
          basisAction={basisAction}
          isSettingBasis={isSettingBasis}
          rows={rows}
          conflictChoices={
            <InvoiceFieldChoices
              projectId={projectId}
              meteringPointId={meteringPoint.id}
              tariffHref={stationHref(projectId, meteringPointStationId(meteringPointNumber, 'tarif'))}
              reloadKey={conflictsVersion}
            />
          }
          removeAction={removeAction}
          isRemoving={isRemoving}
        />
      )}

      {/*
        ⚠ NUR OHNE GELESENE RECHNUNG. Liegt eine vor, hat der Upload das Signal ohnehin auf `false`
        zurückgesetzt (s. `buildInvoiceDraft`) — die Bedingung `stored.length === 0`
        ist damit die zweite Schicht derselben Aussage, nicht ihre einzige: sie hält auch dann,
        wenn ein Entwurf aus einem älteren Stand beides zugleich trägt.

        Eigener Block statt einer Zeile in `InvoiceSummary`: die gibt es in genau diesem Fall nicht
        (sie hängt an `stored.length > 0`). Gestaltung wie deren Kopfzeile — es ist dieselbe Sorte
        Aussage: „das ist der erfasste Stand dieses Zählpunkts".
      */}
      {skipped && stored.length === 0 && (
        <div>
          <p className="text-small font-medium text-ink">
            Vermerkt: ohne Rechnungsdaten fortgefahren.
          </p>
          <p className="mt-2 max-w-prose text-small text-text-muted">
            Die Analyse rechnet für diesen Zählpunkt auf Basis des Lastgangs und ohne
            Kostenvergleich. Eine später hochgeladene oder von Hand eingetragene Rechnung hebt den
            Vermerk wieder auf.
          </p>
        </div>
      )}

      <div
        className={
          /* Der Strich trennt vom Stand darüber — und der ist entweder die Zusammenfassung ODER der Vermerk. */
          stored.length > 0 || skipped ? 'border-t border-line pt-6' : undefined
        }
      >
        {/*
          `accept` nur PDF: es ist die EINZIGE Form, die das Auslesen annimmt (die API erwartet
          einen `document`-Block mit genau diesem Medientyp). Die Actions prüfen trotzdem selbst.
        */}
        <MultiDirectUpload
          id={FIELD_ID}
          label={stored.length > 0 ? 'Weitere Rechnungen' : `Rechnungen für Zählpunkt ${meteringPointNumber}`}
          hint={
            `PDF, je Datei bis ${Math.floor(maxBytes / (1024 * 1024))} MB, bis zu ${MAX_INVOICES_PER_SELECTION} Rechnungen auf einmal; jede Rechnung wird einzeln gelesen. ` +
            'Jede Rechnung wird im Projekt abgelegt; bereits gelesene bleiben erhalten. ' +
            'Zum Auslesen wird sie an Anthropic übertragen und dort nicht gespeichert.'
          }
          error={error}
          accept={PDF_TYPES}
          maxFiles={MAX_INVOICES_PER_SELECTION}
          maxBytesPerFile={maxBytes}
          request={(file) =>
            requestInvoiceUploadAction({
              projectId,
              meteringPointId: meteringPoint.id,
              fileName: file.name,
              fileSize: file.size,
              contentType: file.type,
            })
          }
          register={(documentId, file) =>
            registerInvoiceUploadAction({ projectId, documentId, fileName: file.name })
          }
          discard={(documentId) => discardInvoiceUploadAction({ projectId, documentId })}
          onUploaded={handleUploaded}
          submitLabel="Rechnungen hochladen"
        />
        {listError && <p className="mt-3 text-small text-warning">{listError}</p>}
        {statusList.length > 0 && (
          <div className="mt-4">
            <p className="text-small font-medium text-ink">Lesestand je Rechnung</p>
            <ul className="mt-2 flex flex-col gap-1">
              {statusList.map((item) => (
                <li
                  key={item.documentId}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-small text-text-muted"
                >
                  <span>{item.filename}</span>
                  <span className={item.view === 'failed' || item.view === 'stale' ? 'text-warning' : undefined}>
                    {ROW_VIEW_TEXT[item.view]}
                    {item.view === 'failed' && item.error ? ` — ${item.error}` : ''}
                  </span>
                  {canRetryInvoiceRow(item.view) && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => queue.enqueue([item.documentId])}
                    >
                      Neu lesen
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/*
        ⚠ DER WEG NACH VORN GEHÖRT DIESER KOMPONENTE, NICHT DER SEITE — dieselbe Regel wie bei der
        Lastgang-Station: wer den Zustand kennt, rendert ihn. Die Seite unterdrückt ihren
        generischen „Weiter"-Link deshalb für diese Station; stünde er daneben, gäbe es zwei Wege
        nach vorn.

        ⚠ ER ERSCHEINT AUCH OHNE RECHNUNG, nur zurückhaltender. Den zweiten Zweig gibt es
        inzwischen („Keine Rechnung vorhanden — Werte selbst eintragen", darüber) — anders als beim
        Lastgang ist er aber KEINE Weiche: die Station bleibt dieselbe, und beide Wege füllen
        denselben Entwurf. Der Weiter-Knopf nur nach einem erfolgreichen Upload wäre damit
        weiterhin eine Sackgasse für jeden Zählpunkt, zu dem gerade keine Rechnung vorliegt. Die
        PROMINENZ folgt dem Zustand: primär, sobald etwas gelesen wurde, sonst sekundär.
      */}
      {/*
        ⚠ DER ZWEITE WEG STEHT NEBEN DEM UPLOAD, NICHT STATT SEINER — und er ist zugeklappt.

        Er ist der Ausweg für den Zählpunkt ohne Rechnung (Kunde liest am Telefon vor, Rechnung
        liegt beim Steuerberater, Anschluss ist neu). Ausgeklappt danebenstehend wäre er eine
        Einladung, das Auslesen zu überspringen und Zahlen abzutippen, die eine Datei genauer und
        nachvollziehbarer liefert — die Rechnung ist die Wahrheit, und der Weg dorthin soll der
        erste bleiben.

        ⚠ AUSSERHALB DES UPLOAD-FORMULARS: der zweite Weg trägt selbst ein `<form>` mit drei
        eigenen Actions, und verschachtelte Formulare gibt es in HTML nicht.
      */}
      <div className="border-t border-line pt-6">
        <button
          type="button"
          onClick={() => setMode((current) => (current === 'manual' ? 'closed' : 'manual'))}
          aria-expanded={mode === 'manual'}
          aria-controls={MANUAL_ID}
          className="text-small font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
        >
          {mode === 'manual'
            ? 'Manuelle Eingabe schliessen'
            : 'Keine Rechnung vorhanden — Werte selbst eintragen'}
        </button>

        {/*
          ⚠ DER DRITTE WEG — und er verschwindet, sobald eine Rechnung vorliegt.

          Nicht ausgegraut, sondern GAR NICHT gerendert: ein gesperrter Knopf ohne Erklärung lässt
          jemanden raten, was ihn löst; und „ohne Rechnungsdaten fortfahren" ist neben einer
          gelesenen Rechnung keine Handlung, die auch nur als Möglichkeit danebenstehen sollte.

          UNTER dem Umschalter und nicht daneben, weil er die Reihenfolge der Wege spiegelt:
          hochladen (primär, oben) → selbst eintragen → bewusst ohne. Bewusst KEIN primärer Knopf
          (`ghost`, klein): er ist der Ausweg, nicht der Weg — dieselbe Zurückhaltung wie beim
          „Lastgang entfernen" der Nachbarstation.

          Der Knopf schreibt nichts: er öffnet den Netzanschluss-Block (`DataEntryInvoiceSkip`),
          der Vermerk entsteht erst nach der Rückfrage dort. Handeingabe und dieser Block sind nie
          gleichzeitig offen — der Anschluss stünde sonst zweimal auf der Seite.

          ⚠ Die Bedingung ist `stored.length === 0` — der Knopf bleibt also stehen,
          wenn der Vermerk bereits gesetzt ist, und seine Beschriftung ändert sich dabei nicht. Ein
          zweiter Klick schreibt denselben Wert und ist folgenlos; ihn nach dem ersten Mal
          auszublenden hiesse, den Weg an einen Zustand zu koppeln, den der Admin in diesem Moment
          gerade selbst hergestellt hat — und der einzige Ausweg daraus wäre ein Upload.
        */}
        {stored.length === 0 && mode !== 'skip' && (
          <div className="mt-3">
            <Button type="button" variant="ghost" size="sm" onClick={() => setMode('skip')}>
              Ohne Rechnung fortfahren
            </Button>
          </div>
        )}

        {/* Statt `window.confirm`: erst der (freiwillige) Netzanschluss, dann die Rückfrage auf der Seite. */}
        {stored.length === 0 && mode === 'skip' && (
          <div className="mt-6">
            <DataEntryInvoiceSkip
              projectId={projectId}
              meteringPointId={meteringPoint.id}
              country={country}
              operators={operators}
              initial={{
                operatorId: manualValues.operatorId,
                netzebene: manualValues.netzebene,
                meteringVariant: manualValues.meteringVariant,
              }}
              skipAction={skipAction}
              skipState={skipState}
              isSkipping={isSkipping}
              onCancel={() => setMode('closed')}
            />
          </div>
        )}

        {/*
          Erst nach dem Aufklappen gerendert, nicht bloss verborgen: ein verborgenes Formular
          schickte seine leeren Felder beim nächsten Umbau mit, und leere Felder sind hier eine
          Aussage („unverändert lassen"), die niemand getroffen hat.
        */}
        {mode === 'manual' && (
          <div id={MANUAL_ID} className="mt-6">
            <DataEntryInvoiceManual
              projectId={projectId}
              meteringPointId={meteringPoint.id}
              country={country}
              operators={operators}
              initial={manualValues}
              nextHref={nextHref}
            />
          </div>
        )}
      </div>

      {nextHref !== null && (
        <div>
          <Button asChild variant={stored.length > 0 ? 'primary' : 'secondary'} size="md">
            <Link href={nextHref}>Weiter</Link>
          </Button>
        </div>
      )}
    </div>
  )
}

type InvoiceStatusItem = {
  documentId: string
  filename: string
  view: InvoiceRowView
  error: string | null
}

/**
 * Die Statusliste: die Zeilen aus `document_extractions`, dazu hochgeladene Rechnungen, deren Lesen
 * in diesem Browser noch nicht gestartet ist (sie haben noch keine Zeile). Eine Rechnung, die hier
 * gerade erneut wartet, zeigt keinen „Neu lesen"-Knopf.
 */
function invoiceStatusList(
  rows: readonly InvoiceExtractionRow[],
  active: readonly string[],
  queuedNames: ReadonlyMap<string, string>,
  now: number,
): InvoiceStatusItem[] {
  const queued = new Set(active)
  const items: InvoiceStatusItem[] = rows.map((row) => {
    const view = invoiceRowView(row, now)
    return {
      documentId: row.documentId,
      filename: row.filename,
      view: queued.has(row.documentId) && canRetryInvoiceRow(view) ? 'waiting' : view,
      error: row.error,
    }
  })
  const listed = new Set(rows.map((row) => row.documentId))
  for (const documentId of active) {
    if (listed.has(documentId)) continue
    items.push({
      documentId,
      filename: queuedNames.get(documentId) ?? 'Rechnung',
      view: 'waiting',
      error: null,
    })
  }
  return items
}

function periodRowData(
  entry: ReturnType<typeof readStoredInvoiceExtractions>[number],
  flags: InvoicePeriodRowData['flags'],
): InvoicePeriodRowData {
  const effective = effectiveInvoiceExtraction(entry)
  return {
    documentId: entry.documentId,
    filename: entry.filename,
    read: { from: entry.extraction.billingPeriodFrom, to: entry.extraction.billingPeriodTo },
    effective: { from: effective.billingPeriodFrom, to: effective.billingPeriodTo },
    overridden: entry.billingPeriodOverride !== undefined,
    flags,
  }
}

/**
 * Was aus den gelesenen Rechnungen hervorgeht.
 *
 * Drei Blöcke in dieser Reihenfolge: WELCHE Dokumente gelesen wurden (daran erkennt ein Mensch, ob
 * die richtigen dabei sind), WAS übereinstimmend daraus hervorgeht, und WORIN sie sich
 * widersprechen. Der dritte steht zuletzt und abgesetzt — er ist der einzige, der eine Handlung
 * verlangt.
 */
function InvoiceSummary({
  number,
  projectId,
  meteringPointId,
  entries,
  rows,
  conflictChoices,
  removeAction,
  isRemoving,
  basisAction,
  isSettingBasis,
  onPeriodChanged,
}: {
  number: number
  projectId: string
  meteringPointId: string
  entries: readonly {
    documentId: string
    filename: string
    hasPrices: boolean
    basis: PriceBasis | null
    period: InvoicePeriodRowData
  }[]
  /** Nach einer Zeitraum-Korrektur: Konfliktliste neu laden. */
  onPeriodChanged: () => void
  basisAction: (formData: FormData) => void
  isSettingBasis: boolean
  rows: readonly { key: string; label: string; text: string }[]
  /** Der Auswahlblock für widersprüchliche Felder — er lädt seine Daten selbst. */
  conflictChoices: React.ReactNode
  /*
   * ⚠ Action und Wartezustand kommen VON AUSSEN — s. Kopf. Der Zustand gehört der Komponente
   * darüber, weil diese hier mit der letzten Rechnung verschwindet.
   */
  removeAction: (formData: FormData) => void
  isRemoving: boolean
}) {
  return (
    <div>
      <p className="text-small font-medium text-ink">
        {entries.length === 1
          ? `Eine Rechnung für Zählpunkt ${number} gelesen.`
          : `${entries.length} Rechnungen für Zählpunkt ${number} gelesen.`}
      </p>

      <ul className="mt-3 flex flex-col gap-1">
        {entries.map((entry) => (
          /*
           * ⚠ SCHLÜSSEL IST DIE DOKUMENT-KENNUNG, nicht mehr Index+Name: der Dateiname ist nicht
           * eindeutig (zweimal „rechnung.pdf" ist der Regelfall), und der Index wandert, sobald
           * ein Eintrag aus der Mitte entfernt wird — React setzte den Listeneintrag dann auf
           * einer FREMDEN Zeile wieder zusammen.
           */
          <li
            key={entry.documentId}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-small text-text-muted"
          >
            <span>{entry.filename}</span>
            {entry.hasPrices && entry.basis !== null && (
              <span>Lieferantenpreise {priceBasisLabel(entry.basis)} gelesen, netto übernommen</span>
            )}
            {entry.hasPrices && entry.basis === null && (
              /* H3: Basis unklar — die Preise dieser Rechnung gehen erst nach der Wahl ein. */
              <form action={basisAction} className="flex flex-wrap items-baseline gap-2">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="meteringPointId" value={meteringPointId} />
                <input type="hidden" name="documentId" value={entry.documentId} />
                <span className="text-warning">
                  Preisbasis unklar — Lieferantenpreise noch nicht übernommen:
                </span>
                <Button type="submit" name="basis" value="net" variant="secondary" size="sm" disabled={isSettingBasis}>
                  netto
                </Button>
                <Button type="submit" name="basis" value="gross" variant="secondary" size="sm" disabled={isSettingBasis}>
                  inkl. USt
                </Button>
              </form>
            )}
            {/*
              ⚠ EIN EIGENES `<form>` JE ZEILE, und ausdrücklich NICHT das Upload-Formular darüber:
              verschachtelte Formulare gibt es in HTML nicht, und selbst wenn — ein Fehler beim
              Entfernen überschriebe sonst die Meldung eines gerade gelaufenen Uploads und
              umgekehrt. Beide sind wahr und sagen Verschiedenes.
            */}
            <form
              action={removeAction}
              onSubmit={(e) => {
                /*
                 * Eine Rückfrage an einen Menschen, KEINE Prüfung — die Autorisierung liegt in der
                 * Datenbank. Sie steht hier, weil der Link klein und textnah neben einem
                 * Dateinamen sitzt und ein Fehlgriff plausibel ist; sie ist bewusst LEICHTER als
                 * die der Lastgang-Station (dort verschwindet die DATEI unwiderruflich aus der
                 * Ablage — hier bleibt sie im Projekt liegen).
                 */
                const prompt =
                  `„${entry.filename}" wird für diesen Zählpunkt nicht mehr ausgewertet.\n\n` +
                  'Die übrigen Rechnungen werden neu zusammengeführt. Bereits übernommene Angaben ' +
                  'bleiben stehen, und die Datei bleibt in der Dokumentenliste des Projekts. ' +
                  'Erneut auswerten lässt sie sich nur durch einen neuen Upload.'
                if (!window.confirm(prompt)) e.preventDefault()
              }}
            >
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="meteringPointId" value={meteringPointId} />
              <input type="hidden" name="documentId" value={entry.documentId} />
              {/*
                ⚠ ALLE Entfernen-Links teilen sich EINEN Wartezustand und sind währenddessen
                gesperrt. Das ist keine Einschränkung, sondern der Schutz: zwei gleichzeitige
                Vorgänge läsen denselben Entwurf, und der zweite schriebe den Eintrag zurück, den
                der erste gerade gestrichen hat.
              */}
              <Button type="submit" variant="ghost" size="sm" disabled={isRemoving}>
                {isRemoving && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} aria-hidden="true" />
                )}
                Entfernen
                <span className="sr-only"> — {entry.filename}</span>
              </Button>
            </form>
            <InvoicePeriod
              projectId={projectId}
              meteringPointId={meteringPointId}
              data={entry.period}
              onChanged={onPeriodChanged}
            />
          </li>
        ))}
      </ul>
      <span role="status" aria-live="polite" className="sr-only">
        {isRemoving ? 'Rechnung wird entfernt …' : ''}
      </span>

      {rows.length === 0 ? (
        <p className="mt-4 max-w-prose text-small text-text-muted">
          Aus den gelesenen Rechnungen geht übereinstimmend keine der gesuchten Angaben hervor.
        </p>
      ) : (
        <>
          <p className="mt-5 text-caption text-text-muted">
            Übernommen in die Angaben dieses Zählpunkts
          </p>
          <dl className="mt-2 grid gap-x-8 gap-y-3 sm:grid-cols-[auto_1fr]">
            {rows.map((row) => (
              <React.Fragment key={row.key}>
                <dt className="text-caption text-text-muted">{row.label}</dt>
                <dd className="text-small tabular-nums text-ink">{row.text}</dd>
              </React.Fragment>
            ))}
          </dl>
        </>
      )}

      {conflictChoices}
    </div>
  )
}
