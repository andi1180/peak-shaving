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
 * Und sie nimmt eine einzelne hochgeladene Rechnung nicht wieder zurück: ein Rückweg wie beim
 * Lastgang (PR #194) ist ein eigener Auftrag.
 */
import * as React from 'react'
import { useActionState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

import { mergeInvoiceExtractions } from 'shared'

import { Button } from '@/components/ui/button'
import { FieldHint, Label } from '@/components/ui/input'
import { uploadMeteringPointInvoicesAction } from '@/lib/admin/data-entry-actions'
import {
  MAX_INVOICES_PER_UPLOAD,
  invoiceConflictLabels,
  invoiceMergeDisplayRows,
  readStoredInvoiceExtractions,
} from '@/lib/admin/invoice-extractions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import type { MeteringPointSummary } from '@/lib/admin/metering-points'
import { AdminError, AdminSuccess } from './ui'

const FIELD_ID = 'dateneingabe-rechnungen'

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
  const error = state.fieldErrors?.files

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

      {stored.length > 0 && (
        <InvoiceSummary
          number={meteringPointNumber}
          filenames={stored.map((entry) => entry.filename)}
          rows={rows}
          conflictLabels={conflictLabels}
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

        ⚠ ER ERSCHEINT AUCH OHNE RECHNUNG, nur zurückhaltender. Anders als beim Lastgang gibt es
        hier KEINEN zweiten Zweig, der die Station beantwortet (ein Pfad „keine Rechnung vorhanden"
        samt manueller Eingabe ist ein eigener Auftrag) — der Weiter-Knopf nur nach einem
        erfolgreichen Upload wäre damit eine Sackgasse für jeden Zählpunkt, zu dem gerade keine
        Rechnung vorliegt. Die PROMINENZ folgt trotzdem dem Zustand: primär, sobald etwas gelesen
        wurde, sonst sekundär.
      */}
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
  filenames,
  rows,
  conflictLabels,
}: {
  number: number
  filenames: readonly string[]
  rows: readonly { key: string; label: string; text: string }[]
  conflictLabels: readonly string[]
}) {
  return (
    <div>
      <p className="text-small font-medium text-ink">
        {filenames.length === 1
          ? `Eine Rechnung für Zählpunkt ${number} gelesen.`
          : `${filenames.length} Rechnungen für Zählpunkt ${number} gelesen.`}
      </p>

      <ul className="mt-3 flex flex-col gap-1">
        {filenames.map((name, index) => (
          // Der Dateiname allein ist nicht eindeutig — jemand kann zweimal „rechnung.pdf" ablegen.
          <li key={`${index}-${name}`} className="text-small text-text-muted">
            {name}
          </li>
        ))}
      </ul>

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
