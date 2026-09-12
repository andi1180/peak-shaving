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
 */
import * as React from 'react'
import { useActionState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

import { mergeInvoiceExtractions } from 'shared'

import { Button } from '@/components/ui/button'
import { FieldHint, Label } from '@/components/ui/input'
import {
  removeMeteringPointInvoiceAction,
  uploadMeteringPointInvoicesAction,
} from '@/lib/admin/data-entry-actions'
import {
  MAX_INVOICES_PER_UPLOAD,
  invoiceConflictLabels,
  invoiceMergeDisplayRows,
  readStoredInvoiceExtractions,
} from '@/lib/admin/invoice-extractions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { DataEntryInvoiceManual } from './data-entry-invoice-manual'
import type { MeteringPointSummary } from '@/lib/admin/metering-points'
import { AdminError, AdminSuccess } from './ui'

const FIELD_ID = 'dateneingabe-rechnungen'
const MANUAL_ID = 'dateneingabe-rechnung-manuell'

export function DataEntryInvoice({
  projectId,
  meteringPoint,
  meteringPointNumber,
  maxBytes,
  nextHref,
}: {
  projectId: string
  meteringPoint: MeteringPointSummary
  /** 1-basiert, wie in der Station — die Nummer ist eine Position, keine Kennung. */
  meteringPointNumber: number
  /**
   * Die Grössengrenze je Datei, aus der Server-Komponente hereingereicht.
   *
   * ⚠ SIE MUSS EIN PROP SEIN, anders als `MAX_INVOICES_PER_UPLOAD` direkt darüber:
   * `MAX_INVOICE_FILE_BYTES` liegt in `packages/extractors`, und dessen Barrel ist `server-only`.
   * Hier importiert bräche er den Client-Build. Die Zahl selbst ist harmlos — nur ihr Fundort
   * nicht.
   */
  maxBytes: number
  /** Die nächste Station, oder `null` am Ende der Liste. */
  nextHref: string | null
}) {
  const [state, formAction, isPending] = useActionState(
    uploadMeteringPointInvoicesAction,
    ADMIN_INITIAL_STATE,
  )
  /*
   * ⚠ ZWEITER Zustand, absichtlich HIER und nicht im einzelnen Entfernen-Formular — s. Kopf: mit
   * der letzten Rechnung verschwindet die Zusammenfassung, und mit ihr nähme ein Zustand darin
   * seine eigene Erfolgsmeldung mit.
   */
  const [removeState, removeAction, isRemoving] = useActionState(
    removeMeteringPointInvoiceAction,
    ADMIN_INITIAL_STATE,
  )
  const error = state.fieldErrors?.files
  const [manualOpen, setManualOpen] = React.useState(false)

  React.useEffect(() => {
    if (error) document.getElementById(FIELD_ID)?.focus()
  }, [error])

  const stored = readStoredInvoiceExtractions(meteringPoint.draft)
  const { merged, conflicts } = mergeInvoiceExtractions(stored.map((entry) => entry.extraction))
  const rows = invoiceMergeDisplayRows(merged)
  const conflictLabels = invoiceConflictLabels(conflicts)

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

      {stored.length > 0 && (
        <InvoiceSummary
          number={meteringPointNumber}
          projectId={projectId}
          meteringPointId={meteringPoint.id}
          entries={stored.map((entry) => ({
            documentId: entry.documentId,
            filename: entry.filename,
          }))}
          rows={rows}
          conflictLabels={conflictLabels}
          removeAction={removeAction}
          isRemoving={isRemoving}
        />
      )}

      <form
        action={formAction}
        noValidate
        className={stored.length > 0 ? 'flex flex-col gap-4 border-t border-line pt-6' : 'flex flex-col gap-4'}
      >
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="meteringPointId" value={meteringPoint.id} />

        <div className="max-w-xl">
          <Label htmlFor={FIELD_ID}>
            {stored.length > 0 ? 'Weitere Rechnungen' : `Rechnungen für Zählpunkt ${meteringPointNumber}`}
          </Label>
          <div className="mt-1.5">
            {/*
              ⚠ HIER SEHR WOHL EIN `accept`-FILTER — anders als beim Lastgang, und das ist kein
              Versehen. Dort versteckte er Dateien, die der Leser durchaus lesen kann (ein
              Netzbetreiber liefert CSV, XLSX, gelegentlich mit abweichender Endung). Hier ist PDF
              die EINZIGE Form, die das Auslesen überhaupt annimmt (die API erwartet einen
              `document`-Block mit genau diesem Medientyp) — ein Dateidialog, der ein Foto anbietet,
              führt zuverlässig in eine Ablehnung, die er selbst verursacht hat. Die Prüfung in der
              Action bleibt trotzdem: `accept` ist eine Bedienhilfe des Browsers, keine Sperre.
            */}
            <input
              id={FIELD_ID}
              name="files"
              type="file"
              multiple
              accept="application/pdf"
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={`${FIELD_ID}-hint`}
              className="block w-full text-small text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-sunken file:px-3 file:py-1.5 file:text-small file:text-ink hover:file:bg-surface-alt"
            />
          </div>
          <FieldHint id={`${FIELD_ID}-hint`} tone={error ? 'error' : 'muted'}>
            {error ??
              `PDF, je bis ${Math.floor(maxBytes / (1024 * 1024))} MB, höchstens ${MAX_INVOICES_PER_UPLOAD} pro Vorgang. ` +
                'Jede Rechnung wird im Projekt abgelegt und ausgelesen; bereits gelesene bleiben erhalten. ' +
                'Zum Auslesen wird sie an Anthropic übertragen und dort nicht gespeichert.'}
          </FieldHint>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" size="md" disabled={isPending}>
            {isPending && (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
            )}
            {isPending ? 'Wird ausgelesen …' : 'Rechnungen hochladen'}
          </Button>
          <span role="status" aria-live="polite" className="sr-only">
            {isPending ? 'Wird ausgelesen …' : ''}
          </span>
        </div>
      </form>

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

        ⚠ AUSSERHALB DES UPLOAD-FORMULARS: der zweite Weg trägt selbst ein `<form>` mit zwei
        eigenen Actions, und verschachtelte Formulare gibt es in HTML nicht.
      */}
      <div className="border-t border-line pt-6">
        <button
          type="button"
          onClick={() => setManualOpen((open) => !open)}
          aria-expanded={manualOpen}
          aria-controls={MANUAL_ID}
          className="text-small font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
        >
          {manualOpen
            ? 'Manuelle Eingabe schliessen'
            : 'Keine Rechnung vorhanden — Werte selbst eintragen'}
        </button>

        {/*
          Erst nach dem Aufklappen gerendert, nicht bloss verborgen: ein verborgenes Formular
          schickte seine leeren Felder beim nächsten Umbau mit, und leere Felder sind hier eine
          Aussage („unverändert lassen"), die niemand getroffen hat.
        */}
        {manualOpen && (
          <div id={MANUAL_ID} className="mt-6">
            <DataEntryInvoiceManual projectId={projectId} meteringPointId={meteringPoint.id} />
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
  conflictLabels,
  removeAction,
  isRemoving,
}: {
  number: number
  projectId: string
  meteringPointId: string
  entries: readonly { documentId: string; filename: string }[]
  rows: readonly { key: string; label: string; text: string }[]
  conflictLabels: readonly string[]
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

      {conflictLabels.length > 0 && (
        /*
          Bernstein, nicht rot: es ist kein Fehler, sondern ein Befund, der eine Entscheidung
          verlangt — dieselbe Farbwahl wie bei der Teiljahres-Warnung im Report („Farbe ist
          Information, kein Dekor", DESIGN.md).
        */
        <div className="mt-5 max-w-prose rounded-md border border-warning-border bg-warning-subtle p-3">
          <p className="text-small font-medium text-ink">
            {conflictLabels.length === 1
              ? 'Eine Angabe widerspricht sich zwischen den Rechnungen'
              : `${conflictLabels.length} Angaben widersprechen sich zwischen den Rechnungen`}
          </p>
          <p className="mt-2 max-w-prose text-small text-text-muted">
            {conflictLabels.join(', ')} — die Rechnungen nennen dazu verschiedene Werte. Es wurde
            deshalb <strong className="font-medium text-ink">nichts übernommen</strong>; bitte im
            Tarif-Schritt von Hand eintragen, welcher Wert gilt.
          </p>
          <p className="mt-2 max-w-prose text-caption text-text-muted">
            Wurde vor dem Widerspruch bereits ein Wert übernommen, steht er weiterhin in den Angaben
            dieses Zählpunkts — er wird nicht zurückgenommen.
          </p>
        </div>
      )}
    </div>
  )
}
