'use client'

/**
 * Das Upload-Formular des Analysen-Archivs (B14-2).
 *
 * ── ES GIBT KEINEN „ANALYSE SPEICHERN"-KNOPF IM RECHNER UND KEINEN ZWEITEN RECHNER HIER ─────────
 * Der Kalkulator (`apps/website`) und dieser Admin-Bereich sind getrennte Anwendungen mit
 * getrennten Sitzungen. Ein Speichern aus dem Rechner heraus verlangte eine Anmeldung in der
 * zweiten Anwendung (das ist B10) oder eine zweite Rechner-Oberfläche hier. Zudem ist die
 * Archivierung einer betreuten Analyse eine BEWUSSTE Handlung und soll kein Nebeneffekt jedes
 * Rechenlaufs sein — der öffentliche Rechner läuft täglich mit Probedaten. Der Rechner exportiert
 * ein Bündel, ein Mensch lädt es hier hoch; die Verbrauchsdaten verlassen den Browser des Kunden
 * dabei nicht (Prinzip 4), das Bündel entsteht lokal.
 *
 * ── ZWEI DATEIEN, EINE PRÜFSUMME ────────────────────────────────────────────────────────────────
 * Das Bündel enthält die Ursprungsdatei nicht. Was beide aneinanderbindet, ist allein die
 * Prüfsumme — der wichtigste Fehlerfall dieser Seite. Die Meldung dafür steht im Klartext, nicht
 * als Statuscode.
 */
import * as React from 'react'
import { useActionState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { FieldHint, Label } from '@/components/ui/input'
import { AdminError, AdminField, AdminSelect, AdminSuccess } from '@/components/admin/ui'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { createAnalysisAction } from '@/lib/admin/analyses-actions'
import {
  ANALYSIS_KINDS,
  ANALYSIS_KIND_LABELS,
  DEFAULT_ANALYSIS_KIND,
  MAX_SOURCE_FILE_BYTES,
} from '@/lib/admin/analyses'
import { LEADS_HREF } from '@/lib/admin/leads'

export type LeadOption = { id: string; email: string; company: string | null }
export type SupersedableAnalysis = {
  id: string
  customerLabel: string
  siteLabel: string | null
  createdAt: string
}

/** Dateifeld — es gibt im Projekt kein Primitiv dafür; dies ist der erste Datei-Upload überhaupt. */
function FileField({
  id,
  name,
  label,
  accept,
  error,
  hint,
  onFile,
}: {
  id: string
  name: string
  label: string
  accept: string
  error?: string
  hint?: React.ReactNode
  onFile?: (file: File | null) => void
}) {
  const hintId = `${id}-hint`
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1.5">
        <input
          id={id}
          name={name}
          type="file"
          accept={accept}
          required
          onChange={(e) => onFile?.(e.target.files?.[0] ?? null)}
          aria-invalid={error ? true : undefined}
          aria-describedby={hintId}
          className="block w-full rounded-md border border-line bg-surface text-small text-ink outline-none file:mr-3 file:cursor-pointer file:border-0 file:border-r file:border-line file:bg-surface-sunken file:px-3 file:py-2 file:text-small file:text-ink focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <FieldHint id={hintId} tone={error ? 'error' : 'muted'}>
        {error ?? hint}
      </FieldHint>
    </div>
  )
}

export function AnalysisUploadForm({
  leadOptions,
  leadSearch,
  supersedable,
  prefilledSupersedesId,
}: {
  /** Treffer der Freitextsuche über `admin_list_leads` — leer, solange nicht gesucht wurde. */
  leadOptions: LeadOption[]
  leadSearch: string
  supersedable: SupersedableAnalysis[]
  prefilledSupersedesId: string
}) {
  const [state, formAction, isPending] = useActionState(createAnalysisAction, ADMIN_INITIAL_STATE)

  /*
   * Die Grössenprüfung steht ZUSÄTZLICH im Browser, damit die Meldung erscheint, BEVOR 20 MB durch
   * eine Server Action gehen. Die verbindliche Grenze bleibt die serverseitige
   * (`prepareAnalysisUpload`) — sie sieht auch Aufrufe an diesem Formular vorbei.
   */
  const [sizeWarning, setSizeWarning] = React.useState<string | null>(null)

  function checkSize(file: File | null) {
    if (file && file.size > MAX_SOURCE_FILE_BYTES) {
      setSizeWarning(
        `Diese Datei ist ${(file.size / (1024 * 1024)).toFixed(1)} MB gross und überschreitet die ` +
          `Obergrenze von ${MAX_SOURCE_FILE_BYTES / (1024 * 1024)} MB. Ein Jahres-Lastgang liegt ` +
          'bei unter einem Megabyte — bitte prüfen, ob es die richtige Datei ist.',
      )
    } else {
      setSizeWarning(null)
    }
  }

  const fieldError = (name: string): string | undefined => state.fieldErrors?.[name]
  const values = state.values ?? {}

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {/* ── Die zwei Dateien ─────────────────────────────────────────────────────────────────── */}
      <fieldset className="flex flex-col gap-4">
        <legend className="text-caption font-semibold uppercase tracking-wide text-text-muted">
          Dateien
        </legend>

        <FileField
          id="analysis-bundle"
          name="bundle"
          label="Analyse-Bündel (.json) *"
          accept="application/json,.json"
          error={fieldError('bundle')}
          hint={'Im Rechner über „Analyse-Bündel (JSON)“ im Ergebnisbereich erzeugt.'}
        />

        <FileField
          id="analysis-source"
          name="sourceFile"
          label="Ursprungsdatei (Lastgang, CSV/XLSX) *"
          accept=".csv,.xlsx,.xls,text/csv"
          error={fieldError('sourceFile') ?? sizeWarning ?? undefined}
          hint={
            <>
              Genau die Datei, die im Rechner hochgeladen wurde. Das Bündel enthält sie nicht — die
              Prüfsumme im Bündel bindet beide aneinander. Passt sie nicht, wird nichts angelegt.
            </>
          }
          onFile={checkSize}
        />
      </fieldset>

      {/* ── Zuordnung ────────────────────────────────────────────────────────────────────────── */}
      <fieldset className="flex flex-col gap-4 border-t border-line pt-6">
        <legend className="text-caption font-semibold uppercase tracking-wide text-text-muted">
          Zuordnung
        </legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <AdminField
            id="analysis-customer"
            name="customerLabel"
            label="Kunde *"
            required
            defaultValue={values.customerLabel ?? ''}
            error={fieldError('customerLabel')}
            hint="Wie im Bericht. Steht DENORMALISIERT auf der Analyse, weil der Lead nach 24 Monaten anonymisiert wird."
          />
          <AdminField
            id="analysis-site"
            name="siteLabel"
            label="Standort"
            defaultValue={values.siteLabel ?? ''}
            error={fieldError('siteLabel')}
            hint="Ein Lastgang gehört zu einem Zählpunkt. Ohne Standort sind zwei Analysen desselben Kunden nicht auseinanderzuhalten."
          />
        </div>

        <AdminSelect
          id="analysis-kind"
          name="analysisKind"
          label="Art"
          defaultValue={values.analysisKind ?? DEFAULT_ANALYSIS_KIND}
          hint="Entscheidet später, welche Baselines für einen Wirkungsnachweis in Frage kommen — ein Probelauf sieht im Ergebnis genauso aus wie eine echte Auslegung."
        >
          {ANALYSIS_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {ANALYSIS_KIND_LABELS[kind]}
            </option>
          ))}
        </AdminSelect>

        {/* ── Lead-Zuordnung: der Hinweis steht VOR der Auswahl, nicht darunter ────────────── */}
        <div
          role="note"
          className="max-w-prose rounded-md border border-warning-border bg-warning-subtle p-3"
        >
          <p className="text-caption text-ink">
            <strong className="font-semibold">
              Die Lead-Zuordnung lässt sich später nicht mehr ändern.
            </strong>{' '}
            <code>platform.analyses</code> ist append-only — die Zeile ist nach dem Anlegen
            unveränderlich, und es gibt keinen Wrapper, der sie nachträglich einem Lead zuweist. Wer
            zugeordnet werden soll, muss also <em>vorher</em> als Lead existieren. Das ist eine
            Folge des Einfrierens und kein Mangel; es soll nur nicht überraschen.{' '}
            <Link
              href={LEADS_HREF}
              className="rounded-sm font-medium text-accent underline decoration-accent underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Zur Lead-Liste
            </Link>{' '}
            — dort lässt sich ein passender Lead nachsehen oder über einen Einstiegspunkt anlegen.
          </p>
        </div>

        <div>
          <Label htmlFor="analysis-lead">Lead (optional)</Label>
          <div className="mt-1.5">
            <select
              id="analysis-lead"
              name="leadId"
              defaultValue={values.leadId ?? ''}
              className="block h-10 w-full rounded-md border border-line bg-surface px-3 text-small text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">keine Zuordnung</option>
              {leadOptions.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.company ? `${lead.company} — ${lead.email}` : lead.email}
                </option>
              ))}
            </select>
          </div>
          <FieldHint id="analysis-lead-hint" tone="muted">
            {leadSearch === ''
              ? 'Noch nicht gesucht — die Auswahl bleibt leer, bis oben ein Suchbegriff eingegeben wurde.'
              : leadOptions.length === 0
                ? `Kein Lead passt zu „${leadSearch}".`
                : `${leadOptions.length} Treffer zu „${leadSearch}".`}
          </FieldHint>
        </div>

        <div>
          <Label htmlFor="analysis-supersedes">Ersetzt eine bestehende Analyse (optional)</Label>
          <div className="mt-1.5">
            <select
              id="analysis-supersedes"
              name="supersedesId"
              defaultValue={values.supersedesId ?? prefilledSupersedesId}
              className="block h-10 w-full rounded-md border border-line bg-surface px-3 text-small text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">ersetzt nichts</option>
              {supersedable.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.customerLabel}
                  {a.siteLabel ? ` · ${a.siteLabel}` : ''} — {a.createdAt}
                </option>
              ))}
            </select>
          </div>
          <FieldHint id="analysis-supersedes-hint" tone="muted">
            Eine Korrektur ist immer eine NEUE Analyse. Die ersetzte bleibt vollständig lesbar, samt
            dem Fehler, den sie enthielt — genau das ist der Zweck des Einfrierens.
          </FieldHint>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" size="md" disabled={isPending}>
          {isPending ? 'Wird archiviert …' : 'Analyse archivieren'}
        </Button>
      </div>

      {state.formError && <AdminError>{state.formError}</AdminError>}
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}
    </form>
  )
}
