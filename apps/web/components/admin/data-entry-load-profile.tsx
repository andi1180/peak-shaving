'use client'

/**
 * Die Lastgang-Station des Dateneingabe-Wizards (B24, Teil 1).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ EINE FRAGE, ZWEI ZWEIGE — UND DER ZUSTAND DER ANTWORT WIRD NIRGENDS GESPEICHERT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * „Haben Sie Lastgangsdaten?" ist eine WEICHE innerhalb einer Station, keine Angabe über das
 * Projekt: Es gibt dafür keine Spalte, und dieser Schritt legt auch keine an. Sie lebt deshalb in
 * `useState` — und das ist kein Widerspruch zum Grundsatz des Wizards („die Position steht in der
 * URL, es gibt keinen Client-Zustand über die Stationen", s. `lib/admin/data-entry-stations.ts`):
 * Dieser Zustand behauptet keinen Fortschritt, er entscheidet nur, welches von zwei Feldern
 * dasteht. Ein Neuladen setzt ihn zurück, und das ist richtig — dann steht die Frage wieder da.
 *
 * ── ⚠ DIE FRAGE ERSCHEINT GAR NICHT, WENN SIE SCHON BEANTWORTET IST ───────────────────────────
 * Trägt der Zählpunkt bereits einen eingelesenen Lastgang, zeigt die Station die Zusammenfassung.
 * Das ist der ECHTE Zustand aus der Datenbank (`readMeteringPointList` → Prop), nicht der
 * Rückgabewert der Action: Nach einem Neuladen stünde die Station sonst leer da, obwohl gespeichert
 * ist. Genau deshalb ruft die Action `revalidatePath` — s. dort.
 *
 * ── ⚠ DER WEITER-KNOPF GEHÖRT DIESER KOMPONENTE, NICHT DER SEITE ──────────────────────────────
 * Die Seite rendert ihren allgemeinen „Weiter"-Link für jede Platzhalter-Station; für den Lastgang
 * ist er ausgeschaltet, weil er hier vom ZUSTAND abhängt: nach „Nein" sofort, nach „Ja" erst, wenn
 * wirklich etwas gespeichert ist. Wer den Zustand kennt, rendert den Weg nach vorn — sonst gäbe es
 * einen zweiten Weg, der die Angabe überspringt (dieselbe Regel wie bei den beiden echten Schritten
 * davor, nur mit einer Ausnahme für den „Nein"-Zweig, der nichts zu speichern hat).
 *
 * ── ⚠ DIESER KOPF HAT BIS ZUM LASTGANG-RÜCKWEG DAS GEGENTEIL BEHAUPTET ────────────────────────
 * Er lautete: „Es gibt keinen Weg, eine hochgeladene Datei zu ersetzen oder zu entfernen — weder
 * hier noch in der Datenbank." Das stimmt seit der Migration `20260911180000` nicht mehr: Sie legt
 * mit `admin_reset_metering_point_load_profile` und `admin_delete_metering_point_document` genau
 * die zwei Wrapper an, die damals fehlten. Der Satz ist ERSETZT statt stehen gelassen — ein
 * Kommentar, der eine Regel behauptet, die es nicht mehr gibt, ist teurer als keiner.
 *
 * Die Zusammenfassung trägt deshalb einen „Lastgang entfernen"-Knopf. Ein AUSTAUSCHEN-Knopf gibt es
 * bewusst trotzdem nicht: Er wäre entfernen und hochladen in einem Klick, und scheitert dabei der
 * zweite Teil, stünde der Zählpunkt leer da, ohne dass jemand das wollte. Entfernen und neu
 * hochladen sind zwei Handlungen, und die Station zeigt sie als zwei.
 *
 * ── ⚠ DIE RÜCKMELDUNG DES ENTFERNENS LEBT AUF KOMPONENTENEBENE, NICHT IM FORMULAR ─────────────
 * Ein erfolgreiches Entfernen wechselt die Station in den Frage-Zweig — und nähme ein Formular mit
 * eigenem `useActionState` samt seiner Meldung mit (dieselbe Beobachtung wie bei der
 * Partner-Genehmigung, B16-4b). Genau die Meldung, die dann zählt, wäre weg: Scheitert das Löschen
 * der Datei, IST der Zählpunkt bereits zurückgesetzt, und der Admin muss erfahren, dass ein Rest
 * stehen geblieben ist. Der Zustand hängt deshalb an der Komponente, und der Fehlertext wird in
 * BEIDEN Zweigen gerendert.
 */
import * as React from 'react'
import { useActionState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FieldHint, Label } from '@/components/ui/input'
import {
  removeMeteringPointLoadProfileAction,
  uploadMeteringPointLoadProfileAction,
} from '@/lib/admin/data-entry-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import type { MeteringPointSummary } from '@/lib/admin/metering-points'
import { formatDateTime } from '@/lib/admin/format'
import { AdminError, AdminSuccess } from './ui'

const FIELD_ID = 'dateneingabe-lastgang-datei'

/**
 * Die Rückfrage nennt alle drei Folgen — was am Zählpunkt verschwindet, was aus der Ablage
 * verschwindet, und dass es keinen Rückweg gibt. „Wirklich entfernen?" sagte nichts davon.
 */
const REMOVE_CONFIRM =
  'Lastgang wirklich entfernen?\n\n' +
  'Zeitraum, Intervall und Lücken werden vom Zählpunkt gelöscht, die hochgeladene Datei aus der ' +
  'Ablage des Projekts entfernt. Das lässt sich nicht rückgängig machen — Sie können danach eine ' +
  'neue Datei hochladen.'

/** Die drei Zustände der Frage. `null` = noch nicht beantwortet. */
type Answer = 'ja' | 'nein' | null

export function DataEntryLoadProfile({
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
  /** Die wirksame Grössengrenze, aus der Server-Komponente hereingereicht (eine Konstante, ein Ort). */
  maxBytes: number
  /** Die nächste Station, oder `null` am Ende der Liste. */
  nextHref: string | null
}) {
  const [answer, setAnswer] = React.useState<Answer>(null)
  const [state, formAction, isPending] = useActionState(
    uploadMeteringPointLoadProfileAction,
    ADMIN_INITIAL_STATE,
  )
  /*
   * ⚠ ZWEITER Zustand, absichtlich HIER und nicht im Entfernen-Formular — s. Kopf: das Formular
   * verschwindet mit seinem eigenen Erfolg, und mit ihm die Meldung, die im Fehlerfall die
   * wichtigste der Station ist.
   */
  const [removeState, removeAction, isRemoving] = useActionState(
    removeMeteringPointLoadProfileAction,
    ADMIN_INITIAL_STATE,
  )
  const error = state.fieldErrors?.file

  React.useEffect(() => {
    if (error) document.getElementById(FIELD_ID)?.focus()
  }, [error])

  // ── Schon eingelesen: die Zusammenfassung IST die Station ────────────────────────────────────
  if (meteringPoint.hasLoadProfile) {
    return (
      <div className="flex flex-col gap-6">
        {state.success && <AdminSuccess>{state.success}</AdminSuccess>}
        {removeState.formError && <AdminError>{removeState.formError}</AdminError>}
        <LoadProfileSummary point={meteringPoint} number={meteringPointNumber} />

        {/*
          Weiter ist der Weg nach vorn und bleibt primär; das Entfernen steht daneben und textnah
          (`ghost`). Es ist der Ausweg für den Fall, dass die falsche Datei hochgeladen wurde — kein
          Schritt, den der Wizard nahelegt.
        */}
        <div className="flex flex-wrap items-center gap-3">
          <ContinueLink nextHref={nextHref} />
          <form
            action={removeAction}
            onSubmit={(e) => {
              /*
               * Eine Rückfrage, keine Prüfung — die Autorisierung liegt in der Datenbank. Sie steht
               * hier, weil der Vorgang die DATEI unwiderruflich aus der Ablage nimmt: der Admin hat
               * sie zwar noch auf seinem Rechner, aber im System ist sie danach weg (dieselbe
               * Zurückhaltung wie beim Rollen-Entzug, T4-4 — nicht bei An/Aus-Schaltern).
               */
              if (!window.confirm(REMOVE_CONFIRM)) e.preventDefault()
            }}
          >
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="meteringPointId" value={meteringPoint.id} />
            <Button type="submit" variant="ghost" size="md" disabled={isRemoving}>
              {isRemoving && (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
              )}
              {isRemoving ? 'Wird entfernt …' : 'Lastgang entfernen'}
            </Button>
            <span role="status" aria-live="polite" className="sr-only">
              {isRemoving ? 'Wird entfernt …' : ''}
            </span>
          </form>
        </div>
      </div>
    )
  }

  // ── Die Frage ────────────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      {/*
        Beide Meldungen des Entfernens stehen AUCH hier, und das ist keine Doppelung: Nach einem
        erfolgreichen Entfernen — und nach einem gescheiterten Schritt 2 oder 3 — ist der Zählpunkt
        bereits zurückgesetzt, die Station steht also in diesem Zweig. Ohne sie wäre die Frage
        wortlos wieder da, und niemand wüsste, ob der Klick gewirkt hat.
      */}
      {removeState.success && <AdminSuccess>{removeState.success}</AdminSuccess>}
      {removeState.formError && <AdminError>{removeState.formError}</AdminError>}
      <div>
        <p className="max-w-prose text-body text-ink">
          Haben Sie Lastgangsdaten (Viertelstunden- oder Stundenwerte) für Zählpunkt{' '}
          {meteringPointNumber}?
        </p>
        <p className="mt-2 max-w-prose text-small text-text-muted">
          Der Netzbetreiber stellt sie auf Anfrage kostenlos als CSV- oder XLSX-Datei bereit.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            type="button"
            variant={answer === 'ja' ? 'primary' : 'secondary'}
            size="md"
            onClick={() => setAnswer('ja')}
            aria-pressed={answer === 'ja'}
          >
            Ja
          </Button>
          <Button
            type="button"
            variant={answer === 'nein' ? 'primary' : 'secondary'}
            size="md"
            onClick={() => setAnswer('nein')}
            aria-pressed={answer === 'nein'}
          >
            Nein
          </Button>
        </div>
      </div>

      {answer === 'nein' && (
        <div className="border-t border-line pt-6">
          {/*
            Derselbe Platzhalter-Stil wie die vier übrigen Stationen je Zählpunkt: Er sagt im
            Klartext, dass hier noch nichts ist. Ein Standardprofil aus dem Jahresverbrauch zu
            erzeugen ist ein eigener Schritt — und ein Formular, das danach fragt und nichts damit
            täte, wäre eine Requisite.
          */}
          <p className="max-w-prose text-small text-text-muted">
            Standardprofil — folgt als eigener Schritt.{' '}
            <span className="text-text-muted">
              Ohne gemessenen Lastgang wird der Verbrauch später aus dem Jahresverbrauch geschätzt.
            </span>
          </p>
          <div className="mt-6">
            <Continue nextHref={nextHref} />
          </div>
        </div>
      )}

      {answer === 'ja' && (
        <form action={formAction} noValidate className="flex flex-col gap-4 border-t border-line pt-6">
          {state.formError && <AdminError>{state.formError}</AdminError>}
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="meteringPointId" value={meteringPoint.id} />

          <div className="max-w-xl">
            <Label htmlFor={FIELD_ID}>Lastgang-Datei</Label>
            <div className="mt-1.5">
              {/*
                ⚠ KEIN `accept`-Filter — gleiches Prinzip wie beim Chat-Upload: Der Dateidialog
                versteckte damit Dateien, die die Anwendung sehr wohl lesen kann (ein Netzbetreiber
                liefert CSV, XLSX, gelegentlich mit abweichender Endung). Was lesbar ist, entscheidet
                der Leser, nicht der Dateidialog; er lehnt eine unbrauchbare Datei mit einem Satz ab.
              */}
              <input
                id={FIELD_ID}
                name="file"
                type="file"
                required
                aria-invalid={error ? true : undefined}
                aria-describedby={`${FIELD_ID}-hint`}
                className="block w-full text-small text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-sunken file:px-3 file:py-1.5 file:text-small file:text-ink hover:file:bg-surface-alt"
              />
            </div>
            <FieldHint id={`${FIELD_ID}-hint`} tone={error ? 'error' : 'muted'}>
              {error ??
                `CSV oder XLSX, bis ${Math.floor(maxBytes / (1024 * 1024))} MB. Die Datei wird eingelesen; gespeichert werden Zeitraum, Intervall und Lücken — keine Messwerte.`}
            </FieldHint>
          </div>

          <div>
            <Button type="submit" variant="primary" size="md" disabled={isPending}>
              {isPending && (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
              )}
              {isPending ? 'Wird eingelesen …' : 'Datei einlesen'}
            </Button>
            <span role="status" aria-live="polite" className="sr-only">
              {isPending ? 'Wird eingelesen …' : ''}
            </span>
          </div>
        </form>
      )}
    </div>
  )
}

/**
 * Was aus der Datei gelesen wurde — Zeitraum, Intervall, Lücken. KEINE Messwerte.
 *
 * ⚠ `coveredTo` IST DIE OBERE KANTE EINES HALBOFFENEN BEREICHS, nicht der letzte Messwert (s.
 * `MeteringPointSummary`). Ein Jahreslastgang endet damit am 1. Jänner des FOLGEjahres um 00:00 —
 * für einen Menschen sieht das aus, als reiche er ins nächste Jahr hinein. Die Beschriftung sagt
 * deshalb ausdrücklich „Ende des letzten Intervalls", statt den Wert um ein Intervall zu
 * verkleinern: Das wäre eine zweite Zahl über dieselbe Reihe, und sie stünde in keiner Zeile der
 * Datenbank.
 */
function LoadProfileSummary({
  point,
  number,
}: {
  point: MeteringPointSummary
  number: number
}) {
  return (
    <div>
      <p className="text-small font-medium text-ink">
        Lastgang für Zählpunkt {number} ist eingelesen.
      </p>

      <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-[auto_1fr]">
        <dt className="text-caption text-text-muted">Zeitraum (Beginn)</dt>
        <dd className="text-small tabular-nums text-ink">{formatDateTime(point.coveredFrom)}</dd>

        <dt className="text-caption text-text-muted">Zeitraum (Ende des letzten Intervalls)</dt>
        <dd className="text-small tabular-nums text-ink">{formatDateTime(point.coveredTo)}</dd>

        <dt className="text-caption text-text-muted">Intervall</dt>
        <dd className="text-small tabular-nums text-ink">
          {point.intervalMinutes === null ? '—' : `${point.intervalMinutes} Minuten`}
        </dd>

        <dt className="text-caption text-text-muted">Lücken</dt>
        <dd className="text-small tabular-nums text-ink">
          {point.gaps.length === 0 ? 'keine' : `${point.gaps.length}`}
        </dd>
      </dl>

      {point.gaps.length > 0 && (
        <div className="mt-4">
          <p className="text-caption text-text-muted">Zeitbereiche ohne Messwerte</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {point.gaps.map((gap) => (
              <li key={`${gap.from}-${gap.to}`} className="text-small tabular-nums text-ink">
                {formatDateTime(gap.from)} – {formatDateTime(gap.to)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 max-w-prose text-caption text-text-muted">
        Gespeichert sind nur diese Angaben über die Reihe — die Messwerte bleiben in der
        hochgeladenen Datei. Um eine andere Datei zu verwenden, entfernen Sie den Lastgang und laden
        die neue hoch.
      </p>
    </div>
  )
}

/**
 * Der Weg nach vorn. Am Ende der Liste gibt es keinen — dann steht hier nichts.
 *
 * `next/link`, nicht der locale-bewusste Link aus `components/ui/link.tsx`: `/admin` liegt
 * ausserhalb der Sprach-Struktur, und der locale-bewusste erzeugte bei einer zweiten Sprache
 * `/en/admin/…` — eine Route, die es nicht gibt (dieselbe Entscheidung wie in `components/admin/nav.tsx`).
 */
function Continue({ nextHref }: { nextHref: string | null }) {
  if (nextHref === null) return null
  return (
    <div>
      <ContinueLink nextHref={nextHref} />
    </div>
  )
}

/**
 * Derselbe Knopf ohne eigenen Kasten — die Zusammenfassung stellt ihn in eine Reihe mit dem
 * Entfernen. Getrennt, damit die Reihe auch dann steht, wenn es keine nächste Station gibt
 * (`Continue` liefert dann nichts, und das Entfernen muss trotzdem erreichbar bleiben).
 */
function ContinueLink({ nextHref }: { nextHref: string | null }) {
  if (nextHref === null) return null
  return (
    <Button asChild variant="primary" size="md">
      <Link href={nextHref}>Weiter</Link>
    </Button>
  )
}
