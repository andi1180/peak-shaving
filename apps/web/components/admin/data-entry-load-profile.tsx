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
  saveMeteringPointStandardProfileAction,
  uploadMeteringPointLoadProfileAction,
} from '@/lib/admin/data-entry-actions'
import { ADMIN_INITIAL_STATE, type AdminState } from '@/lib/admin/schema'
import type { MeteringPointSummary } from '@/lib/admin/metering-points'
import { formatDateTime, formatKwh } from '@/lib/admin/format'
import {
  MAX_HOUSEHOLD_PERSONS,
  hasStandardProfileCurve,
  readStandardProfileConsumption,
} from '@/lib/admin/standard-profile'
import type { ProjectSegment } from '@/lib/admin/projects'
import { AdminError, AdminField, AdminSuccess } from './ui'

const FIELD_ID = 'dateneingabe-lastgang-datei'
const ANNUAL_FIELD_ID = 'dateneingabe-jahresverbrauch'
const PERSONS_FIELD_ID = 'dateneingabe-personen'

/**
 * Die Rückfrage nennt alle drei Folgen — was am Zählpunkt verschwindet, was aus der Ablage
 * verschwindet, und dass es keinen Rückweg gibt. „Wirklich entfernen?" sagte nichts davon.
 */
const REMOVE_CONFIRM =
  'Lastgang wirklich entfernen?\n\n' +
  'Zeitraum, Intervall und Lücken werden vom Zählpunkt gelöscht, die hochgeladene Datei aus der ' +
  'Ablage des Projekts entfernt. Das lässt sich nicht rückgängig machen — Sie können danach eine ' +
  'neue Datei hochladen.'

/**
 * ⚠ EIN EIGENER TEXT FÜR DAS ERZEUGTE PROFIL, und er ist nicht bloss höflicher formuliert: die
 * mittlere der drei Folgen gibt es hier gar nicht. Ein Standardprofil hat keine Datei in der
 * Ablage (`set_metering_point_standard_profile` setzt die Quelle ausdrücklich auf `null`), und der
 * Datei-Text behauptete eine Löschung, die nicht stattfindet — beim ersten Mal beunruhigend, beim
 * zweiten Mal ein Grund, der Rückfrage nicht mehr zu glauben.
 *
 * Er nennt dafür die Folge, die es NUR hier gibt: der Jahresverbrauch bleibt im Entwurf stehen.
 * `admin_reset_metering_point_load_profile` fasst ihn nicht an (die Begründung steht in TEIL 3 der
 * Migration 20260911200000), und wer ihn für gelöscht hielte, trüge ihn ein zweites Mal ein.
 */
const REMOVE_STANDARD_CONFIRM =
  'Standardprofil wirklich entfernen?\n\n' +
  'Zeitraum und Intervall werden vom Zählpunkt gelöscht. Der eingetragene Jahresverbrauch bleibt ' +
  'erhalten — Sie können das Profil daraus neu erzeugen oder stattdessen einen gemessenen ' +
  'Lastgang hochladen.'

/** Die drei Zustände der Frage. `null` = noch nicht beantwortet. */
type Answer = 'ja' | 'nein' | null

export function DataEntryLoadProfile({
  projectId,
  meteringPoint,
  meteringPointNumber,
  maxBytes,
  nextHref,
  segment,
}: {
  projectId: string
  meteringPoint: MeteringPointSummary
  /** 1-basiert, wie in der Station — die Nummer ist eine Position, keine Kennung. */
  meteringPointNumber: number
  /** Die wirksame Grössengrenze, aus der Server-Komponente hereingereicht (eine Konstante, ein Ort). */
  maxBytes: number
  /** Die nächste Station, oder `null` am Ende der Liste. */
  nextHref: string | null
  /**
   * Das Segment des PROJEKTS — es entscheidet, welche Verbrauchskurve für ein erzeugtes
   * Standardprofil gilt.
   *
   * ⚠ Hereingereicht statt hier gelesen: es gehört dem Projekt, nicht dem Zählpunkt, und die
   * Server-Komponente hat es ohnehin schon (sie rendert damit die Segment-Station). Es als
   * verstecktes Formularfeld mitzuschicken wäre die schlechtere Wahl — die ACTION liest es
   * deshalb ein zweites Mal aus der Datenbank; hier steuert es nur, ob überhaupt gefragt wird.
   */
  segment: ProjectSegment | null
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
  /*
   * ⚠ DRITTER Zustand, und er hängt aus demselben Grund an der KOMPONENTE wie der zweite: ein
   * erfolgreiches Erzeugen wechselt die Station in den Zusammenfassungs-Zweig, und ein
   * `useActionState` IM Formular verschwände mitsamt seiner Meldung.
   */
  const [standardState, standardAction, isGenerating] = useActionState(
    saveMeteringPointStandardProfileAction,
    ADMIN_INITIAL_STATE,
  )
  const error = state.fieldErrors?.file

  React.useEffect(() => {
    if (error) document.getElementById(FIELD_ID)?.focus()
  }, [error])

  /*
   * ── Schon vorhanden: die Zusammenfassung IST die Station ────────────────────────────────────
   *
   * ⚠ `profileSource !== null`, NICHT mehr ein Flag an der Quelle. Beide Wege — hochgeladen und
   * erzeugt — füllen dieselben Spalten; an der Quelle allein gemessen stellte die Station nach
   * einem erzeugten Profil ihre Ja/Nein-Frage erneut, obwohl der Zeitraum gespeichert ist.
   */
  if (meteringPoint.profileSource !== null) {
    const isStandard = meteringPoint.profileSource === 'standard'
    return (
      <div className="flex flex-col gap-6">
        {state.success && <AdminSuccess>{state.success}</AdminSuccess>}
        {standardState.success && <AdminSuccess>{standardState.success}</AdminSuccess>}
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
              const prompt = isStandard ? REMOVE_STANDARD_CONFIRM : REMOVE_CONFIRM
              if (!window.confirm(prompt)) e.preventDefault()
            }}
          >
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="meteringPointId" value={meteringPoint.id} />
            {/*
              ⚠ DIESELBE ACTION FÜR BEIDE HERKÜNFTE, nur mit anderer Beschriftung:
              `admin_reset_metering_point_load_profile` setzt auch dann zurück, wenn keine Quelle
              dasteht, und deckt den erzeugten Fall damit ausdrücklich mit ab (TEIL 3 der Migration
              20260911200000). Eine zweite Entfernen-Action wäre eine zweite Stelle für dieselbe
              Entscheidung — und die erste, die beim nächsten Umbau auseinanderliefe.
            */}
            <Button type="submit" variant="ghost" size="md" disabled={isRemoving}>
              {isRemoving && (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
              )}
              {isRemoving
                ? 'Wird entfernt …'
                : isStandard
                  ? 'Standardprofil entfernen'
                  : 'Lastgang entfernen'}
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
        <StandardProfileForm
          projectId={projectId}
          meteringPoint={meteringPoint}
          state={standardState}
          action={standardAction}
          isPending={isGenerating}
          segment={segment}
          nextHref={nextHref}
        />
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
/**
 * Die Zusammenfassung, GEMEINSAM für beide Herkünfte.
 *
 * ── ⚠ DIE HERKUNFT IST DIE ERSTE ZEILE, NICHT EINE FUSSNOTE ───────────────────────────────────
 * Beide Wege füllen dieselben vier Spalten, und ein Zeitraum sieht in beiden Fällen gleich aus.
 * Was sich unterscheidet, ist, was die Zahlen dahinter WERT sind: ein gemessener Lastgang trägt die
 * echten Lastspitzen des Betriebs, ein erzeugtes Profil eine Durchschnittskurve, die sie per
 * Konstruktion nicht kennen kann. Wer das verwechselt, hält die Spitzenkappungs-Ersparnis einer
 * Schätzung für eine Messung — und genau dagegen sperrt die Engine die Spitzenkappung bei
 * `source: 'standard_profile'` ab (§3.6, `peakShavingBlockers`). Die Oberfläche muss denselben
 * Unterschied sichtbar machen, sonst erklärt niemand die € 0 im Report.
 */
function LoadProfileSummary({
  point,
  number,
}: {
  point: MeteringPointSummary
  number: number
}) {
  const isStandard = point.profileSource === 'standard'
  const consumption = readStandardProfileConsumption(point.draft)
  return (
    <div>
      <p className="text-small font-medium text-ink">
        {isStandard
          ? `Standardprofil für Zählpunkt ${number} ist erzeugt.`
          : `Lastgang für Zählpunkt ${number} ist eingelesen.`}
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

        {/*
          ⚠ „Lücken" NUR beim gelesenen Lastgang. Bei einem erzeugten Profil ist die Liste per
          Konstruktion leer (der Wrapper nimmt `gaps` nicht einmal als Parameter) — „Lücken: keine"
          läse sich dort wie ein Befund über die Datenqualität, wo gar nichts gemessen wurde.
        */}
        {!isStandard && (
          <>
            <dt className="text-caption text-text-muted">Lücken</dt>
            <dd className="text-small tabular-nums text-ink">
              {point.gaps.length === 0 ? 'keine' : `${point.gaps.length}`}
            </dd>
          </>
        )}

        {isStandard && consumption && (
          <>
            <dt className="text-caption text-text-muted">Jahresverbrauch</dt>
            <dd className="text-small tabular-nums text-ink">
              {formatKwh(consumption.annualConsumptionKwh)}
              {consumption.source === 'assumed' && (
                <span className="ml-2 text-caption tabular-nums text-text-muted">geschätzt</span>
              )}
            </dd>
          </>
        )}
      </dl>

      {/*
        Die Begründung einer Schätzung im Klartext („2.000 kWh Grundbedarf + 3 × 1.000 kWh"). Sie
        steht im Entwurf, weil die Action sie dort hinterlegt — sie hier zu wiederholen hiesse, die
        Formel ein zweites Mal auszuschreiben, und die zwei liefen beim nächsten Wert auseinander.
      */}
      {isStandard && consumption?.note && (
        <p className="mt-3 max-w-prose text-caption text-text-muted">{consumption.note}</p>
      )}

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
        {isStandard
          ? 'Gespeichert sind nur diese Angaben — die Verbrauchskurve wird bei jeder Rechnung neu ' +
            'aus dem Jahresverbrauch erzeugt. Sie bildet einen typischen Verlauf ab und kennt die ' +
            'tatsächlichen Lastspitzen dieses Anschlusses nicht; eine Spitzenkappungs-Ersparnis ' +
            'wird daraus deshalb nicht gerechnet. Ein gemessener Lastgang vom Netzbetreiber ' +
            'ergibt ein deutlich belastbareres Ergebnis.'
          : 'Gespeichert sind nur diese Angaben über die Reihe — die Messwerte bleiben in der ' +
            'hochgeladenen Datei. Um eine andere Datei zu verwenden, entfernen Sie den Lastgang ' +
            'und laden die neue hoch.'}
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

/**
 * Der „Nein"-Zweig: ein Standardlastprofil aus dem Jahresverbrauch erzeugen.
 *
 * ── ⚠ ZWEI WEGE ZU EINER ZAHL, UND DER ZWEITE IST AUSDRÜCKLICH EINE SCHÄTZUNG ─────────────────
 * Der Jahresverbrauch steht auf jeder Stromrechnung — das ist der Regelfall und das erste Feld.
 * Wer ihn gerade nicht zur Hand hat, kommt über die Zahl der Personen im Haushalt zu einer
 * Grössenordnung. Beide führen in dieselbe Action; was sie unterscheidet, ist der
 * HERKUNFTSVERMERK, den sie im Entwurf hinterlassen (`measured` gegen `assumed` samt Begründung).
 *
 * Ihn wegzulassen wäre der teuerste Fehler dieser Station: eine geschätzte Zahl sieht in jeder
 * späteren Rechnung genauso aus wie eine abgelesene, und der Unterschied fiele erst auf, wenn
 * jemand fragt, woher die Ersparnis kommt. Delta §3.2 verlangt die Unterscheidung durchgehend bis
 * in den Report — sie beginnt hier.
 *
 * ── ⚠ DER UMSCHALTER IST EIN `useState`, KEINE ZWEITE STATION ─────────────────────────────────
 * Dieselbe Begründung wie bei der Ja/Nein-Frage darüber: „ich habe die Rechnung gerade nicht da"
 * ist eine Aussage über diesen Bearbeitungsmoment, keine über den Betrieb. Als Spalte gespeichert
 * stünde sie später neben einem eingetragenen Jahresverbrauch und widerspräche ihm.
 *
 * ── ⚠ ES WIRD NUR EIN FELD ABGESCHICKT, UND `mode` SAGT WELCHES ───────────────────────────────
 * Beide Felder stehen im selben `<form>`; welches gilt, entscheidet das versteckte `mode`-Feld.
 * Das inaktive ist bewusst gar nicht gerendert statt `disabled` — ein deaktiviertes Feld gäbe es
 * weiterhin, und der nächste Umbau schickte seinen Wert mit. Die Action verzweigt ohnehin an
 * `mode`; dass daneben keine zweite Zahl liegt, ist die Zusage dieser Seite.
 */
function StandardProfileForm({
  projectId,
  meteringPoint,
  segment,
  state,
  action,
  isPending,
  nextHref,
}: {
  projectId: string
  meteringPoint: MeteringPointSummary
  segment: ProjectSegment | null
  state: AdminState
  action: (formData: FormData) => void
  isPending: boolean
  nextHref: string | null
}) {
  const [mode, setMode] = React.useState<'direct' | 'persons'>('direct')

  /*
   * ⚠ EIN BEREITS EINGETRAGENER JAHRESVERBRAUCH IST DIE VORBELEGUNG, nicht ein leeres Feld.
   * Erreichbar, sobald jemand ein erzeugtes Profil entfernt: der Reset nullt den Zeitraum, den
   * Entwurf aber ausdrücklich nicht (TEIL 3 der Migration 20260911200000). Ihn nicht zu zeigen
   * hiesse, eine gespeicherte Angabe des Kunden zu verstecken und ein zweites Eintippen zu
   * verlangen — und der Admin könnte nicht sehen, dass sie überhaupt noch dasteht.
   */
  const stored = readStandardProfileConsumption(meteringPoint.draft)

  // ── Für Betriebe gibt es (noch) keine Kurve — dann wird gar nicht erst gefragt ───────────────
  if (!hasStandardProfileCurve(segment)) {
    return (
      <div className="border-t border-line pt-6">
        {/*
          ⚠ EINE FACHLICHE FEHLANZEIGE, KEINE TECHNISCHE LÜCKE, und sie steht deshalb im Klartext
          da statt als ausgegrautes Formular: Delta 8 lässt offen, welches G-Profil in Österreich
          üblich ist, und eine aus dem Haushaltsprofil abgeleitete Gewerbekurve wäre eine erfundene
          Zahlenreihe mit seriösem Etikett. Ein Formular, das garantiert in eine Ablehnung läuft,
          wäre die unehrlichere Form derselben Auskunft.
        */}
        <p className="max-w-prose text-small text-text-muted">
          {segment === null
            ? 'Für dieses Projekt ist noch nicht festgelegt, ob es ein Privathaushalt oder ein ' +
              'Betrieb ist. Ohne diese Angabe steht nicht fest, welche Verbrauchskurve gilt.'
            : 'Für Betriebe ist noch keine Standard-Verbrauchskurve hinterlegt — der Verbrauch ' +
              'eines Gewerbebetriebs hängt zu stark von der Branche ab, als dass ein einzelnes ' +
              'Profil ihn abbilden könnte. Bitte fordern Sie den Lastgang beim Netzbetreiber an; ' +
              'er stellt ihn kostenlos bereit.'}
        </p>
        <div className="mt-6">
          <Continue nextHref={nextHref} />
        </div>
      </div>
    )
  }

  return (
    <form action={action} noValidate className="flex flex-col gap-4 border-t border-line pt-6">
      {state.formError && <AdminError>{state.formError}</AdminError>}
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="meteringPointId" value={meteringPoint.id} />
      <input type="hidden" name="mode" value={mode} />

      <div>
        <p className="max-w-prose text-body text-ink">
          Dann rechnen wir mit einem Standard-Verbrauchsprofil für Privathaushalte.
        </p>
        <p className="mt-2 max-w-prose text-small text-text-muted">
          Es bildet den typischen Tages- und Jahresverlauf ab und wird auf Ihren Jahresverbrauch
          skaliert. Einzelne Lastspitzen kann es nicht zeigen — dafür braucht es gemessene Werte.
        </p>
      </div>

      {mode === 'direct' ? (
        <div className="max-w-xs">
          <AdminField
            id={ANNUAL_FIELD_ID}
            name="annualKwh"
            label="Jahresverbrauch (kWh)"
            inputMode="numeric"
            defaultValue={
              state.values?.annualKwh ??
              (stored ? String(Math.round(stored.annualConsumptionKwh)) : '')
            }
            error={state.fieldErrors?.annualKwh}
            hint={'Steht auf Ihrer Jahresabrechnung, meist als „Verbrauch" oder „Energiemenge".'}
          />
          {stored && (
            /*
             * Was schon dasteht, und woher es stammt. Ohne den Vermerk sähe eine Schätzung aus
             * wie eine abgelesene Zahl — genau die Verwechslung, die dieser Schritt vermeidet.
             */
            <p className="mt-2 text-caption text-text-muted">
              {stored.source === 'assumed'
                ? `Bereits gespeichert: ${formatKwh(stored.annualConsumptionKwh)} (geschätzt).`
                : `Bereits gespeichert: ${formatKwh(stored.annualConsumptionKwh)}.`}
            </p>
          )}
          <button
            type="button"
            onClick={() => setMode('persons')}
            className="mt-3 text-small text-accent underline decoration-accent underline-offset-[3px]"
          >
            Weiss ich nicht
          </button>
        </div>
      ) : (
        <div className="max-w-xs">
          <AdminField
            id={PERSONS_FIELD_ID}
            name="persons"
            label="Personen im Haushalt"
            inputMode="numeric"
            defaultValue={state.values?.persons ?? ''}
            error={state.fieldErrors?.persons}
            hint={`Eine ganze Zahl zwischen 1 und ${MAX_HOUSEHOLD_PERSONS}.`}
          />
          {/*
            ⚠ DIE KENNZEICHNUNG STEHT VOR DEM ABSENDEN, nicht erst in der Erfolgsmeldung. Wer
            schätzt, soll vorher wissen, dass die Zahl als Schätzung gespeichert wird und die
            Rechnung entsprechend ungenau ausfällt — hinterher ist es eine Mitteilung, vorher eine
            Entscheidung.
          */}
          <p className="mt-2 max-w-prose text-caption text-text-muted">
            Daraus schätzen wir den Jahresverbrauch. Die Zahl wird als Schätzung gekennzeichnet und
            bleibt im Report als solche erkennbar — ein Blick auf die Stromrechnung ergibt ein
            deutlich belastbareres Ergebnis.
          </p>
          <button
            type="button"
            onClick={() => setMode('direct')}
            className="mt-3 text-small text-accent underline decoration-accent underline-offset-[3px]"
          >
            Jahresverbrauch doch eintragen
          </button>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" size="md" disabled={isPending}>
          {isPending && (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          )}
          {isPending ? 'Wird erzeugt …' : 'Standardprofil erzeugen'}
        </Button>
        <span role="status" aria-live="polite" className="sr-only">
          {isPending ? 'Standardprofil wird erzeugt …' : ''}
        </span>
      </div>
    </form>
  )
}
