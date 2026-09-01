'use client'

import { useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Plus, X } from 'lucide-react'
import { parseLoadProfile } from 'engine'
import {
  INVOICE_MERGE_FIELD_LABELS,
  UPLOAD_DOCUMENT_TYPES,
  UPLOAD_DOCUMENT_TYPE_LABELS,
  isUploadDocumentType,
  mergeInvoiceExtractions,
  type InvoiceExtraction,
  type UploadDocumentType,
} from 'shared'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { rejectIfBeforeAnchor } from '@/lib/anchor-rule'
import { readForParsing } from '@/lib/file-input'
import { scanInvoice } from '@/lib/invoice-scan/actions'
import {
  classifyUpload,
  type UploadClassificationResponse,
} from '@/lib/upload-classification/actions'
import { FileDrop } from './file-drop'
import { StandardProfilePanel } from './standard-profile-panel'
import type { ParsedLoad, TariffPrefill } from './types'

/**
 * Delta 17 — DER VIERTE EINSTIEG: beliebig viele Dateien, jede mit einer EIGENEN Bezeichnung.
 *
 * ── WOZU ER DA IST ────────────────────────────────────────────────────────────────────────────
 * Die drei bestehenden Einstiege verlangen vom Nutzer, dass er die ART seiner Unterlage vorher
 * kennt und den passenden Reiter wählt. Wer einen Stapel vom Steuerberater oder vom Elektriker
 * bekommt, weiss genau das nicht — und bricht an der Vorentscheidung ab, die in keiner Zahl
 * auftaucht. Hier legt er alles ab, benennt es in seinen eigenen Worten, und die Zuordnung schlägt
 * je Zeile eine Art vor.
 *
 * ── ⚠ ES GIBT KEINEN AUTOMATISCHEN DURCHLAUF ──────────────────────────────────────────────────
 * Zwischen Vorschlag und Verarbeitung steht IMMER eine Bestätigung. Der Vorschlag ist eine
 * Vermutung — die einzige Stelle des Projekts, an der überhaupt eine getroffen wird —, und er darf
 * nie zur Tatsache werden, ohne dass ein Mensch ihn gesehen hat. Dieselbe Haltung wie beim
 * Tarifblatt-Scan, wo genau diese Stufe die Bedingung war, unter der er gebaut werden durfte.
 *
 * ── ⚠ PRINZIP 4: EIN LASTGANG VERLÄSST DEN BROWSER AUCH HIER NICHT ────────────────────────────
 * Die Zuordnung ist deshalb ZWEIGETEILT, und die Teilung ist die eigentliche Architektur dieses
 * Einstiegs:
 *
 *   CSV/XLSX → `classifyLocally` unten. Vollständig im Browser, ohne Netzaufruf: es läuft der
 *              ECHTE Parser (§3.2). Was dabei herauskommt, ist keine Vermutung, sondern eine
 *              Messung — „diese Datei liest sich als Lastgang" ist bewiesen, wenn sie sich liest.
 *              Das gelesene Profil wird gleich behalten, damit dieselbe Datei nicht zweimal
 *              geparst wird.
 *   PDF      → die Server Action `classifyUpload`. Nur hier geht etwas hinaus, und nur, weil ein
 *              PDF im Browser nicht zuverlässig zu lesen ist (dieselbe Abwägung wie in Delta 9b-2a).
 *
 * Es gibt also keinen Weg, auf dem ein Jahres-Lastgang zum Einordnen hochgeladen wird. Die Sperre
 * steht nicht nur hier, sondern auch in der Server Action selbst (`wrong_type`) — eine Zusage, die
 * nur eine Oberfläche gibt, hält der nächste Umbau nicht.
 *
 * ── WAS NACH DER BESTÄTIGUNG GESCHIEHT: NICHTS NEUES ──────────────────────────────────────────
 * Jede Zeile läuft in das jeweils BESTEHENDE Modul — Lastgang in `parseLoadProfile`, Rechnung in
 * `scanInvoice` (Delta 9b-2a), und der Jahresverbrauch weiter in den Standardprofil-Generator
 * (9b-1). Es entsteht kein zweiter Rechenweg; dieser Einstieg ist ausschliesslich eine ZUORDNUNG
 * zu den drei vorhandenen.
 */

/** Eine Zeile im Formular: stabiler Schlüssel, freie Bezeichnung, eine Datei. */
type UploadRow = { key: number; label: string; file: File | null }

/** Wie der Vorschlag für eine Zeile entstanden ist — steht in der Bestätigungsliste. */
type VerdictOrigin = 'lokal' | 'modell' | 'keine'

type RowVerdict = {
  key: number
  label: string
  file: File
  suggested: UploadDocumentType
  /** Die Wahl des Menschen. Startet auf dem Vorschlag und ist frei änderbar. */
  chosen: UploadDocumentType
  origin: VerdictOrigin
  /** Was beim Einordnen aufgefallen ist — neutral, z. B. „35.040 Viertelstundenwerte gelesen". */
  note: string | null
  /** Ein bereits im Browser gelesener Lastgang. Verhindert das zweite Parsen derselben Datei. */
  parsed: ParsedLoad | null
  /** Als Lastgang erkannt, aber hier nicht verwendbar (Spaltenzuordnung, Zeitraum). */
  parseIssue: string | null
}

type RunResult = {
  load: ParsedLoad | null
  /** `undefined`, wenn gar keine Rechnung dabei war — dann sagt dieser Einstieg über den Tarif nichts. */
  prefill: TariffPrefill | undefined
  annualFromInvoice: number | null
  invoiceCount: number
  /** Felder, in denen sich mehrere Rechnungen widersprochen haben (Anzeigenamen). */
  conflicts: string[]
  /** Was mit den übrigen Zeilen geschehen ist — je Zeile ein Satz, nichts verschwindet still. */
  notes: string[]
}

type Phase = 'edit' | 'classifying' | 'confirm' | 'running' | 'done'

const MAX_ROWS = 10

/** Sichtbarer Name einer Zeile. Ohne Bezeichnung tritt der Dateiname an ihre Stelle. */
function rowTitle(row: { label: string; file: File | null }): string {
  const label = row.label.trim()
  if (label !== '') return label
  return row.file?.name ?? 'Ohne Bezeichnung'
}

/**
 * Ordnet eine NICHT-PDF-Datei vollständig im Browser ein — und liest sie dabei gleich richtig.
 *
 * ⚠ Das ist bewusst keine Heuristik über die Dateiendung. Es läuft der echte Parser; die Aussage
 * „das ist ein Lastgang" ist damit gemessen und nicht geraten (`not_a_load_profile` etwa lehnt ein
 * Wechselrichter-Log positiv ab, statt es mangels Treffern durchzuwinken). Kein Netzaufruf, keine
 * Datei verlässt das Gerät.
 */
async function classifyLocally(file: File): Promise<Omit<RowVerdict, 'key' | 'label' | 'file' | 'chosen'>> {
  const input = await readForParsing(file)
  const outcome = parseLoadProfile(input)

  if (outcome.ok) {
    // Delta 15, Regel B — dieselbe Prüfung wie in den drei anderen Einstiegen, VOR jeder Übernahme.
    const tooOld = rejectIfBeforeAnchor(outcome.profile, outcome.detection.timezone)
    if (tooOld) {
      return {
        suggested: 'lastgang',
        origin: 'lokal',
        note: null,
        parsed: null,
        parseIssue: tooOld,
      }
    }
    const readings = new Intl.NumberFormat('de-AT').format(outcome.profile.readings.length)
    return {
      suggested: 'lastgang',
      origin: 'lokal',
      note: `Im Browser gelesen: ${readings} Messwerte über ${outcome.dataQuality.coveredDays} Tage.`,
      parsed: {
        fileName: file.name,
        profile: outcome.profile,
        dataQuality: outcome.dataQuality,
        sourceBytes: input.bytes,
      },
      parseIssue: null,
    }
  }

  if (outcome.kind === 'needs_mapping') {
    /*
     * Mehrspaltige Netzbetreiber-Exporte brauchen die Rollen-Bestätigung aus §3.2. Sie hier ein
     * zweites Mal zu bauen hiesse, zwei Oberflächen für dieselbe fachliche Frage zu pflegen — und
     * die eine, die seltener benutzt wird, liefe still veraltet mit. Der Verweis auf den Einstieg,
     * der sie hat, ist ehrlicher als eine halbe Nachbildung.
     */
    return {
      suggested: 'lastgang',
      origin: 'lokal',
      note: null,
      parsed: null,
      parseIssue:
        'Diese Datei hat mehrere Messreihen, deren Zuordnung wir bestätigen lassen müssen. Bitte ' +
        'laden Sie sie über den Einstieg „Lastgang-Datei" hoch — dort führt Sie ein Schritt durch ' +
        'die Spalten.',
    }
  }

  return {
    suggested: 'unbekannt',
    origin: 'lokal',
    note: outcome.error.message,
    parsed: null,
    parseIssue: null,
  }
}

/**
 * Was der Nutzer zu einem Fehlschlag der Zuordnung zu sehen bekommt — je Zustand ein Satz.
 *
 * Der Schlüssel ist die Fehler-Union der Server Action und NICHT `string`: so wird ein neuer
 * Zustand im Backend hier zum Typfehler, statt still in einer Auffang-Meldung zu landen, die dem
 * Nutzer etwas Falsches erzählt (dieselbe Vorkehrung wie in `invoice-scan-panel.tsx`).
 */
type ClassifyError = Extract<UploadClassificationResponse, { ok: false }>['error']

const CLASSIFY_ERROR_NOTE: Record<ClassifyError, string> = {
  no_file: 'Die Datei scheint leer zu sein.',
  wrong_type: 'Diese Dateiart können wir nicht einordnen — bitte wählen Sie die Art selbst.',
  too_large: 'Die Datei ist grösser als 6 MB — bitte wählen Sie die Art selbst.',
  not_configured: 'Das automatische Einordnen ist auf diesem Server nicht eingerichtet.',
  unavailable: 'Das automatische Einordnen hat gerade nicht funktioniert.',
}

export function MixedUploadPanel({
  onComplete,
}: {
  onComplete: (load: ParsedLoad, tariffPrefill?: TariffPrefill) => void
}) {
  /*
   * Stabile Schlüssel statt des Array-Index — dasselbe Muster wie die Fensterzeilen des
   * Tarifformulars (`grid-tariff-form.tsx`): Beim Entfernen einer Zeile würde React sonst die
   * FOLGENDEN wiederverwenden, und die Eingaben wanderten sichtbar eine Zeile nach oben. Der Zähler
   * startet bei 1 und ist damit auch beim Vorrendern gleich (kein `Math.random`).
   */
  const nextKey = useRef(1)
  const [rows, setRows] = useState<UploadRow[]>([{ key: 0, label: '', file: null }])
  const [phase, setPhase] = useState<Phase>('edit')
  const [verdicts, setVerdicts] = useState<RowVerdict[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)

  const filled = rows.filter((row) => row.file !== null)

  function updateRow(key: number, patch: Partial<UploadRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  async function handleClassify() {
    setFormError(null)
    if (filled.length === 0) {
      setFormError('Bitte legen Sie mindestens eine Datei ab.')
      return
    }

    setPhase('classifying')
    const next: RowVerdict[] = []
    for (const row of rows) {
      if (!row.file) continue
      const file = row.file
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)

      if (!isPdf) {
        // Prinzip 4: kein Netzaufruf. Der Parser selbst ist hier die Zuordnung.
        const local = await classifyLocally(file)
        next.push({ key: row.key, label: row.label, file, chosen: local.suggested, ...local })
        continue
      }

      try {
        const response = await classifyUpload(file, row.label)
        if (response.ok) {
          next.push({
            key: row.key,
            label: row.label,
            file,
            suggested: response.type,
            chosen: response.type,
            origin: 'modell',
            note: null,
            parsed: null,
            parseIssue: null,
          })
        } else {
          /*
           * Ein Fehlschlag der Zuordnung beendet diesen Einstieg NICHT — anders als bei den beiden
           * Scans, wo der Fehlschlag das Ergebnis ist. Hier bleibt die Zeile bedienbar: der Nutzer
           * wählt die Art selbst, und alles Weitere läuft unverändert.
           */
          next.push({
            key: row.key,
            label: row.label,
            file,
            suggested: 'unbekannt',
            chosen: 'unbekannt',
            origin: 'keine',
            note: CLASSIFY_ERROR_NOTE[response.error],
            parsed: null,
            parseIssue: null,
          })
        }
      } catch {
        next.push({
          key: row.key,
          label: row.label,
          file,
          suggested: 'unbekannt',
          chosen: 'unbekannt',
          origin: 'keine',
          note: CLASSIFY_ERROR_NOTE.unavailable,
          parsed: null,
          parseIssue: null,
        })
      }
    }

    setVerdicts(next)
    setPhase('confirm')
  }

  async function handleRun() {
    setFormError(null)

    const lastgangRows = verdicts.filter((v) => v.chosen === 'lastgang')
    if (lastgangRows.length > 1) {
      setFormError(
        'Bitte genau einen Lastgang bestätigen. Der Rechner wertet einen zusammenhängenden ' +
          'Zeitraum aus; mehrere Lastgänge nebeneinander wären zwei Analysen, nicht eine.',
      )
      return
    }

    const lastgang = lastgangRows[0] ?? null
    if (lastgang && !lastgang.parsed) {
      setFormError(
        lastgang.parseIssue ??
          'Lastgänge liest der Rechner als CSV- oder XLSX-Datei. Eine PDF können wir dafür nicht ' +
            'verwenden — bitte laden Sie den Export Ihres Netzbetreibers hoch.',
      )
      return
    }

    setPhase('running')
    const notes: string[] = []
    const extractions: InvoiceExtraction[] = []

    for (const verdict of verdicts) {
      const title = rowTitle(verdict)
      if (verdict.chosen === 'lastgang') continue

      if (verdict.chosen === 'rechnung') {
        if (verdict.file.type !== 'application/pdf') {
          notes.push(`„${title}“: Rechnungen können wir nur als PDF auslesen — übersprungen.`)
          continue
        }
        try {
          const response = await scanInvoice(verdict.file)
          if (response.ok) extractions.push(response.extraction)
          else if (response.error === 'unreadable') {
            notes.push(`„${title}“: Auf diesem Dokument war keine der gesuchten Angaben zu finden.`)
          } else if (response.error === 'not_configured') {
            notes.push(`„${title}“: Das Auslesen von Rechnungen ist hier nicht eingerichtet.`)
          } else {
            notes.push(`„${title}“: Das Auslesen hat nicht funktioniert.`)
          }
        } catch {
          notes.push(`„${title}“: Das Auslesen hat nicht funktioniert.`)
        }
        continue
      }

      if (verdict.chosen === 'tarifblatt') {
        /*
         * ⚠ EHRLICHE LÜCKE, KEIN VERSEHEN. Ein Tarifblatt wird ERKANNT, aber im öffentlichen
         * Rechner nicht ausgewertet: der Tarifblatt-Scan gehört zum Admin-Bereich (`apps/web`), wo
         * ein Mensch jeden gelesenen Wert bestätigt, bevor er als Tarifstand für ALLE künftigen
         * Analysen dieser Netzebene gilt. Diesen Weg hier zu öffnen hiesse, einen Kunden-Upload
         * über die Preisgrundlage anderer Kunden entscheiden zu lassen.
         *
         * Der Nutzer erfährt das ausdrücklich, statt dass die Zeile still verschwindet.
         */
        notes.push(
          `„${title}“: als Tarif-/Preisblatt erkannt. Der Rechner wertet Preisblätter nicht ` +
            `selbst aus — die Netzentgelte pflegen wir zentral. Ihre Analyse braucht es nicht.`,
        )
        continue
      }

      notes.push(`„${title}“: nicht zugeordnet und deshalb nicht verwendet.`)
    }

    const { merged, conflicts } = mergeInvoiceExtractions(extractions)
    const hasInvoice = extractions.length > 0

    if (!lastgang && !hasInvoice) {
      setPhase('confirm')
      setFormError(
        'Aus diesen Dateien konnten wir nichts verwenden. Bestätigen Sie mindestens einen ' +
          'Lastgang oder eine Rechnung — oder nutzen Sie einen der anderen Einstiege.',
      )
      return
    }

    setResult({
      load: lastgang?.parsed ?? null,
      /*
       * Ohne Rechnung reist KEIN Vorbelegungs-Objekt mit. Ein leeres wäre eine Aussage über den
       * Tarif, die dieser Einstieg dann nicht getroffen hat — und Schritt 2 verhielte sich anders
       * als beim reinen Lastgang-Upload, obwohl dasselbe vorliegt.
       */
      prefill: hasInvoice
        ? {
            netzbetreiber: merged.netzbetreiber,
            netzebene: merged.netzebene,
            meteringVariant: merged.meteringVariant,
            rates: merged.rates,
          }
        : undefined,
      annualFromInvoice: merged.annualConsumptionKwh,
      invoiceCount: extractions.length,
      conflicts: conflicts.map((key) => INVOICE_MERGE_FIELD_LABELS[key]),
      notes,
    })
    setPhase('done')
  }

  function backToEdit() {
    setPhase('edit')
    setVerdicts([])
    setResult(null)
    setFormError(null)
  }

  /* ── Bestätigungsliste ─────────────────────────────────────────────────────────────────────── */
  if (phase === 'confirm' || phase === 'running') {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-surface-alt p-4 text-sm">
          <p className="font-medium text-ink">Bitte prüfen Sie die Zuordnung</p>
          <p className="mt-1 text-text-muted">
            Wir haben für jede Datei einen Vorschlag gemacht. Er ist eine Vermutung — Sie
            entscheiden. Nichts wird ausgewertet, bevor Sie unten bestätigen.
          </p>
        </div>

        <ul className="flex flex-col gap-3">
          {verdicts.map((verdict, index) => (
            <li
              key={verdict.key}
              className="rounded-lg border border-border p-4"
              data-testid="zuordnung-zeile"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    Zeile {index + 1}: {rowTitle(verdict)}
                  </p>
                  <p className="truncate text-xs text-text-muted">{verdict.file.name}</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`zuordnung-${verdict.key}`} className="text-xs">
                    {verdict.suggested === 'unbekannt'
                      ? 'Konnten wir nicht einordnen — welche Art ist das?'
                      : `Sieht aus wie ${UPLOAD_DOCUMENT_TYPE_LABELS[verdict.suggested]} — korrekt?`}
                  </Label>
                  <Select
                    value={verdict.chosen}
                    onValueChange={(value) => {
                      if (!isUploadDocumentType(value)) return
                      setVerdicts((current) =>
                        current.map((v) => (v.key === verdict.key ? { ...v, chosen: value } : v)),
                      )
                    }}
                  >
                    <SelectTrigger id={`zuordnung-${verdict.key}`} className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UPLOAD_DOCUMENT_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {UPLOAD_DOCUMENT_TYPE_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {verdict.note && <p className="mt-2 text-xs text-text-muted">{verdict.note}</p>}
              {verdict.parseIssue && (
                <p className="mt-2 text-xs text-warning">{verdict.parseIssue}</p>
              )}
              {verdict.chosen !== verdict.suggested && (
                <p className="mt-2 text-xs text-text-muted">
                  Von Ihnen geändert — wir verwenden{' '}
                  <strong>{UPLOAD_DOCUMENT_TYPE_LABELS[verdict.chosen]}</strong>.
                </p>
              )}
            </li>
          ))}
        </ul>

        {formError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Zuordnung noch nicht eindeutig</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="ghost" onClick={backToEdit} disabled={phase === 'running'}>
            Zurück zu den Dateien
          </Button>
          <Button onClick={() => void handleRun()} disabled={phase === 'running'}>
            {phase === 'running' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                Wird ausgewertet …
              </>
            ) : (
              <>
                Zuordnung bestätigen
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    )
  }

  /* ── Ergebnis ──────────────────────────────────────────────────────────────────────────────── */
  if (phase === 'done' && result) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="default">
          <CheckCircle2 className="h-4 w-4 text-positive" />
          <AlertTitle>Unterlagen übernommen</AlertTitle>
          <AlertDescription>
            {result.load
              ? `Lastgang übernommen (${result.load.dataQuality.coveredDays} Tage).`
              : 'Kein Lastgang dabei — wir bilden gleich ein Standardprofil aus Ihrem Jahresverbrauch.'}
            {result.invoiceCount > 0 &&
              ` ${result.invoiceCount === 1 ? 'Eine Rechnung' : `${result.invoiceCount} Rechnungen`} ausgelesen; die Werte belegen den nächsten Schritt vor und bleiben dort änderbar.`}
          </AlertDescription>
        </Alert>

        {result.conflicts.length > 0 && (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Ihre Rechnungen nennen verschiedene Werte</AlertTitle>
            <AlertDescription>
              Bei {result.conflicts.join(', ')} stehen auf den Rechnungen unterschiedliche Zahlen.
              Wir tragen dann bewusst nichts ein — ein Mittelwert stünde auf keiner Ihrer
              Rechnungen. Bitte ergänzen Sie diese Felder im nächsten Schritt selbst; massgeblich
              ist Ihre aktuellste Rechnung.
            </AlertDescription>
          </Alert>
        )}

        {result.notes.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-lg border border-border bg-surface-alt p-4 text-xs text-text-muted">
            {result.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}

        {result.load ? (
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={backToEdit}>
              Dateien ändern
            </Button>
            <Button
              onClick={() => {
                const load = result.load
                if (load) onComplete(load, result.prefill)
              }}
            >
              Weiter
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <>
            {/*
              Kein Lastgang dabei: derselbe Generator wie beim zweiten und dritten Einstieg, mit dem
              aus den Rechnungen gelesenen Jahresverbrauch vorbelegt. Kein dritter Rechenweg —
              wortgleich die Begründung aus `invoice-scan-panel.tsx`.
            */}
            <StandardProfilePanel
              initialAnnualKwh={result.annualFromInvoice}
              onComplete={(load) => onComplete(load, result.prefill)}
            />
            <Button variant="ghost" onClick={backToEdit} className="self-start">
              Dateien ändern
            </Button>
          </>
        )}
      </div>
    )
  }

  /* ── Zeilen bearbeiten ─────────────────────────────────────────────────────────────────────── */
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-surface-alt p-4 text-sm text-text">
        <p className="mb-2 font-medium text-ink">Was mit Ihren Dateien geschieht</p>
        <p className="text-text-muted">
          Legen Sie ab, was Sie haben, und benennen Sie es in Ihren eigenen Worten — wir schlagen
          Ihnen vor, was es ist, und Sie bestätigen. <strong>Lastgang-Dateien</strong> (CSV/XLSX)
          werden dabei ausschliesslich in Ihrem Browser gelesen und nicht übertragen.{' '}
          <strong>PDF-Dateien</strong> werden zum Einordnen und Auslesen an{' '}
          <strong>Anthropic</strong> übertragen, den Anbieter des Sprachmodells, und dabei nirgends
          gespeichert. Wenn Sie das nicht möchten, nutzen Sie die beiden ersten Einstiege.
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <li key={row.key} className="rounded-lg border border-border p-4" data-testid="upload-zeile">
            <div className="flex items-start justify-between gap-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Datei {index + 1}
              </p>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                  className="inline-flex items-center gap-1 rounded-sm text-xs text-text-muted underline underline-offset-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Entfernen
                </button>
              )}
            </div>

            <div className="mt-3 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`bezeichnung-${row.key}`}>Ihre Bezeichnung (optional)</Label>
                <Input
                  id={`bezeichnung-${row.key}`}
                  value={row.label}
                  maxLength={120}
                  placeholder="z. B. Rechnung 01/25, Lastgang Vorjahr …"
                  onChange={(event) => updateRow(row.key, { label: event.target.value })}
                />
              </div>
              <FileDrop
                compact
                /*
                 * `accept` bleibt eine BEDIENHILFE wie bisher — es schränkt die Auswahl im
                 * Dateidialog ein, entscheidet aber nichts. Welche Art ein Dokument ist, bestätigt
                 * der nächste Schritt; hier stehen deshalb alle drei Endungen nebeneinander.
                 */
                accept=".pdf,application/pdf,.csv,.xlsx,.xls"
                fileName={row.file?.name ?? null}
                onFile={(file) => updateRow(row.key, { file })}
                title="Datei hierher ziehen oder klicken"
                hint="Stromrechnung (PDF) · Lastgang-Export (CSV/XLSX) · Preisblatt (PDF)"
              />
            </div>
          </li>
        ))}
      </ul>

      {rows.length < MAX_ROWS && (
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              setRows((current) => [...current, { key: nextKey.current++, label: '', file: null }])
            }
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Weitere Datei
          </Button>
        </div>
      )}

      {formError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Noch nichts zu tun</AlertTitle>
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button
          onClick={() => void handleClassify()}
          disabled={filled.length === 0 || phase === 'classifying'}
        >
          {phase === 'classifying' ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              Dateien werden eingeordnet …
            </>
          ) : (
            <>
              Dateien einordnen
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
