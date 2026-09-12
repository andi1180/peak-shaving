'use client'

/**
 * Die PV-Station des Dateneingabe-Wizards (B24, Teil 1).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ EINE FRAGE, UND SIE WIRD GESPEICHERT — anders als bei der Batterie-Station
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * „Haben Sie bereits eine PV-Anlage?" ist hier KEINE Weiche in `useState`, sondern die Angabe
 * selbst. Der Unterschied zur Batterie-Station ist kein Versehen: dort steht hinter jedem Zweig
 * etwas, das erhoben wird (die Kenndaten bzw. der Speichervorschlag), und die Frage darüber ist
 * bloss der Weg dorthin. Hier gibt es hinter dem Nein-Zweig nichts zu erheben — bliebe die Antwort
 * im lokalen Zustand, wäre sie nach jedem Neuladen weg, und die Station stellte dieselbe Frage
 * erneut, obwohl sie längst beantwortet ist.
 *
 * ── ⚠ DER ZUSTAND KOMMT AUSSCHLIESSLICH AUS DEM ENTWURF, NICHT AUS LOKALEM `useState` ─────────
 * `readPvDraft(meteringPoint.draft).hasPv` ist die EINZIGE Quelle. Ein lokaler Zustand daneben
 * (etwa als optimistische Vorwegnahme) könnte von dem abweichen, was wirklich gespeichert ist —
 * genau dann, wenn der Schreibvorgang scheitert: die Oberfläche zeigte einen beantworteten Zweig,
 * und im Entwurf stünde nichts. Was hier zu sehen ist, IST der gespeicherte Stand; das kostet den
 * Roundtrip bis zum `revalidatePath` der Action, und dafür gibt es den Ladezustand am Knopf.
 *
 * ── ⚠ DIE FRAGE BLEIBT STEHEN, AUCH WENN SIE BEANTWORTET IST ─────────────────────────────────
 * Dieselbe Entscheidung und derselbe Grund wie bei der Batterie-Station: es gibt für diese Angabe
 * KEINEN Entfernen-Weg. Wer versehentlich „Ja" trifft, muss „Nein" nachlegen können — eine Frage,
 * die nach der ersten Antwort verschwindet, wäre eine Sackgasse. Welche Antwort gilt, steht an den
 * zwei Knöpfen (`aria-pressed`), nicht in ihrem Verschwinden.
 *
 * ── ⚠ DIESER KOPF HAT BIS ZUM ERZEUGUNGSPROFIL DAS GEGENTEIL BEHAUPTET ───────────────────────
 * Er lautete: „Kein Upload eines Erzeugungsprofils, kein PVGIS-Abruf (B22), kein Extraktor und kein
 * Modellaufruf." Die erste Hälfte stimmt nicht mehr — der Ja-Zweig nimmt seit diesem Schritt eine
 * Erzeugungsdatei entgegen und liest Zeitraum, Intervall und Lücken daraus. Der Satz ist ERSETZT
 * statt stehen gelassen: ein Kommentar, der eine Regel behauptet, die es nicht mehr gibt, ist
 * teurer als keiner.
 *
 * ── ⚠ WAS DIESE STATION WEITERHIN NICHT TUT ──────────────────────────────────────────────────
 * Kein PVGIS-Abruf und kein Generator (B22 — der Weg für eine Anlage OHNE gemessene Erzeugung ist
 * ein eigener Bauabschnitt), kein Modellaufruf (das Lesen ist deterministisch und findet im selben
 * Prozess statt) und KEIN Entfernen: eine hochgeladene Erzeugungsdatei lässt sich in diesem Schritt
 * nicht zurücknehmen. Beim Lastgang gibt es das seit PR #194; hier ist es ein eigener Auftrag, und
 * bis dahin ist der Ausweg eine zweite Datei — die überschreibt die Angaben.
 *
 * ⚠ OFFENGELEGTE FOLGE: Wer nachträglich von „Ja" auf „Nein" wechselt, sieht die eingelesenen
 * Angaben nicht mehr — im Entwurf stehen sie trotzdem weiter. Das ist kein stiller Datenverlust
 * (nichts wird gelöscht), aber ein Zustand, den der Entfernen-Weg mit auflösen muss.
 */
import * as React from 'react'
import { useActionState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FieldHint, Label } from '@/components/ui/input'
import {
  saveMeteringPointPvChoiceAction,
  uploadMeteringPointPvProfileAction,
} from '@/lib/admin/data-entry-actions'
import { formatDateTime } from '@/lib/admin/format'
import type { MeteringPointSummary } from '@/lib/admin/metering-points'
import { PV_PRESENT_KEY, readPvDraft } from '@/lib/admin/pv-draft'
import {
  hasPvProfile,
  readPvProfileDraft,
  type PvProfileDraftSummary,
} from '@/lib/admin/pv-profile-draft'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { COMPANY } from '@/lib/nav'
import { AdminError, AdminSuccess } from './ui'

const FIELD_ID = 'dateneingabe-pv-erzeugung-datei'

export function DataEntryPv({
  projectId,
  meteringPoint,
  meteringPointNumber,
  maxBytes,
  customerLabel,
  nextHref,
}: {
  projectId: string
  meteringPoint: MeteringPointSummary
  /** 1-basiert, wie in der Station — die Nummer ist eine Position, keine Kennung. */
  meteringPointNumber: number
  /** Die wirksame Grössengrenze, aus der Server-Komponente hereingereicht (eine Konstante, ein Ort). */
  maxBytes: number
  /**
   * Der Projektname für den Betreff der PV-Anfrage.
   *
   * ⚠ Als Prop und nicht hier nachgeschlagen: die Station bekommt den Zählpunkt, nicht das Projekt
   * — und ein zweiter Leser für denselben Namen wäre eine zweite Stelle, an der er abweichen kann.
   */
  customerLabel: string
  /** Die nächste Station, oder `null` am Ende der Liste. */
  nextHref: string | null
}) {
  const [state, action, isSaving] = useActionState(
    saveMeteringPointPvChoiceAction,
    ADMIN_INITIAL_STATE,
  )
  /*
   * ⚠ ZWEITER Zustand, absichtlich HIER und nicht im Upload-Formular — dieselbe Lehre wie bei der
   * Lastgang-Station (und ursprünglich aus B16-4b): ein erfolgreicher Upload wechselt den Ja-Zweig
   * in die Zusammenfassung, und ein `useActionState` IM Formular verschwände mitsamt seiner
   * Meldung. Die Erfolgsmeldung erschiene dann nie.
   */
  const [uploadState, uploadAction, isUploading] = useActionState(
    uploadMeteringPointPvProfileAction,
    ADMIN_INITIAL_STATE,
  )

  const { hasPv } = readPvDraft(meteringPoint.draft)
  const pvProfile = readPvProfileDraft(meteringPoint.draft)
  const uploadError = uploadState.fieldErrors?.file

  React.useEffect(() => {
    if (uploadError) document.getElementById(FIELD_ID)?.focus()
  }, [uploadError])

  return (
    <div className="flex flex-col gap-6">
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}
      {state.formError && <AdminError>{state.formError}</AdminError>}

      {/*
        ⚠ ZWEI KNÖPFE IN EINEM FORMULAR, unterschieden über `name`/`value` des Absendeknopfes —
        kein `<select>` und keine Ankreuzmöglichkeit. Die Frage hat genau zwei Antworten, und beide
        sind eine ANGABE: „nein, keine PV-Anlage" muss von „dazu wurde nichts gefragt"
        unterscheidbar bleiben. Eine Ankreuzmöglichkeit könnte das nicht — nicht angehakt hiesse
        beides zugleich.
      */}
      <form action={action} noValidate>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="meteringPointId" value={meteringPoint.id} />

        <p className="max-w-prose text-body text-ink">
          Haben Sie bereits eine PV-Anlage für Zählpunkt {meteringPointNumber}?
        </p>
        <p className="mt-2 max-w-prose text-small text-text-muted">
          Gemeint ist eine bereits errichtete oder fest bestellte Anlage — unabhängig davon, ob ihre
          Erzeugung gemessen vorliegt.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            name={PV_PRESENT_KEY}
            value="ja"
            variant={hasPv === true ? 'primary' : 'secondary'}
            size="md"
            aria-pressed={hasPv === true}
            disabled={isSaving}
          >
            {isSaving && (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
            )}
            Ja
          </Button>
          <Button
            type="submit"
            name={PV_PRESENT_KEY}
            value="nein"
            variant={hasPv === false ? 'primary' : 'secondary'}
            size="md"
            aria-pressed={hasPv === false}
            disabled={isSaving}
          >
            Nein
          </Button>
          <span role="status" aria-live="polite" className="sr-only">
            {isSaving ? 'Wird gespeichert …' : ''}
          </span>
        </div>
      </form>

      {hasPv === true && (
        <div className="flex flex-col gap-4 border-t border-line pt-6">
          {uploadState.success && <AdminSuccess>{uploadState.success}</AdminSuccess>}
          {uploadState.formError && <AdminError>{uploadState.formError}</AdminError>}

          {hasPvProfile(pvProfile) ? (
            <PvProfileSummary profile={pvProfile} number={meteringPointNumber} />
          ) : (
            <PvProfileUploadForm
              projectId={projectId}
              meteringPointId={meteringPoint.id}
              meteringPointNumber={meteringPointNumber}
              maxBytes={maxBytes}
              action={uploadAction}
              isPending={isUploading}
              error={uploadError}
            />
          )}
        </div>
      )}

      {hasPv === false && (
        <div className="border-t border-line pt-6">
          <p className="max-w-prose text-body text-ink">COOLiN plant und errichtet PV-Anlagen.</p>
          <p className="mt-2 max-w-prose text-small text-text-muted">
            Ohne eigene Erzeugung rechnet die Analyse ausschliesslich mit dem Netzbezug. Ist eine
            PV-Anlage für dieses Projekt ein Thema, lässt sich die Anfrage von hier aus anstossen:{' '}
            {/*
              Die Adresse kommt aus `COMPANY` (`lib/nav.ts`) — dem EINEN Fundort der Kontaktdaten.
              Eine hier getippte Zweitfassung zeigte nach einem Postfachwechsel still ins alte
              Postfach.
            */}
            <a
              href={`mailto:${COMPANY.email}?subject=${encodeURIComponent(
                `PV-Planung — Projekt ${customerLabel}`,
              )}`}
              className="text-accent underline decoration-accent-border underline-offset-2 hover:decoration-accent"
            >
              {COMPANY.email}
            </a>{' '}
            — der Link öffnet Ihr E-Mail-Programm mit vorbereitetem Betreff. Er speichert nichts und
            ändert nichts an der Analyse.
          </p>
        </div>
      )}

      {/*
        ⚠ DER WEG NACH VORN GEHÖRT DIESER KOMPONENTE, NICHT DER SEITE — dieselbe Regel wie bei den
        drei Stationen davor: wer den Zustand kennt, rendert ihn. Die Seite unterdrückt ihren
        generischen „Weiter"-Link für diese Station; stünde er daneben, gäbe es zwei Wege nach vorn.

        Er erscheint auch ohne Antwort, nur zurückhaltender: die Station ist keine Sackgasse, und
        ein Zählpunkt, zu dem gerade niemand etwas über eine PV-Anlage sagen kann, muss passierbar
        bleiben. Die PROMINENZ folgt dem Zustand.
      */}
      {nextHref !== null && (
        <div>
          <Button asChild variant={hasPv === null ? 'secondary' : 'primary'} size="md">
            <Link href={nextHref}>Weiter</Link>
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Das Dateifeld für die Erzeugungsreihe.
 *
 * ⚠ KEIN `accept`-FILTER — dasselbe Prinzip und derselbe Grund wie beim Lastgang: der Dateidialog
 * versteckte damit Dateien, die der Leser sehr wohl lesen kann (ein Wechselrichter-Portal liefert
 * CSV, XLSX, gelegentlich mit abweichender Endung). Was lesbar ist, entscheidet der Leser und lehnt
 * eine unbrauchbare Datei mit einem Satz ab; ein Dialog, der sie gar nicht erst anbietet, erzeugt
 * eine Fehlersuche ohne Fehlermeldung.
 *
 * ⚠ Die MB-Zahl kommt aus `maxBytes` und wird NICHT abgetippt: der Wizard nimmt die kleinere von
 * zwei Grenzen (die der Ablage, 20 MB), und eine Meldung, die 25 MB verspricht, schickte den Nutzer
 * in einen Fehlschlag, den sie selbst angekündigt hat.
 */
function PvProfileUploadForm({
  projectId,
  meteringPointId,
  meteringPointNumber,
  maxBytes,
  action,
  isPending,
  error,
}: {
  projectId: string
  meteringPointId: string
  meteringPointNumber: number
  maxBytes: number
  action: (formData: FormData) => void
  isPending: boolean
  error?: string
}) {
  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="meteringPointId" value={meteringPointId} />

      <div>
        <p className="max-w-prose text-body text-ink">
          Liegt die Erzeugung dieser Anlage als Datei vor (Viertelstunden- oder Stundenwerte)?
        </p>
        <p className="mt-2 max-w-prose text-small text-text-muted">
          Wechselrichter-Portale stellen sie als CSV- oder XLSX-Datei bereit. Ohne Datei geht es
          ebenfalls weiter — dieser Schritt ist nicht Voraussetzung für die übrigen Angaben.
        </p>
      </div>

      <div className="max-w-xl">
        <Label htmlFor={FIELD_ID}>Erzeugungsprofil für Zählpunkt {meteringPointNumber}</Label>
        <div className="mt-1.5">
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
  )
}

/**
 * Was aus der Erzeugungsdatei gelesen wurde — Zeitraum, Intervall, Lücken. KEINE Messwerte.
 *
 * ⚠ `coveredTo` IST DIE OBERE KANTE EINES HALBOFFENEN BEREICHS, nicht der letzte Messwert —
 * wortgleiche Konvention wie beim Lastgang (letzter Zeitstempel + Intervall). Ein Jahresprofil endet
 * damit am 1. Jänner des FOLGEjahres um 00:00; für einen Menschen sieht das aus, als reiche es ins
 * nächste Jahr hinein. Die Beschriftung sagt deshalb ausdrücklich „Ende des letzten Intervalls",
 * statt den Wert um ein Intervall zu verkleinern: das wäre eine zweite Zahl über dieselbe Reihe, und
 * sie stünde in keinem Feld des Entwurfs.
 *
 * ⚠ Die Angaben kommen aus dem ENTWURF, nicht aus dem Rückgabewert der Action — dieselbe Regel wie
 * bei der Lastgang-Station: aus der Action-Antwort gezeigt stünde die Station nach einem Neuladen
 * ohne Zusammenfassung da, obwohl gespeichert ist.
 */
function PvProfileSummary({
  profile,
  number,
}: {
  profile: PvProfileDraftSummary
  number: number
}) {
  return (
    <div>
      <p className="text-small font-medium text-ink">
        Erzeugungsprofil für Zählpunkt {number} ist eingelesen.
      </p>

      <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-[auto_1fr]">
        <dt className="text-caption text-text-muted">Zeitraum (Beginn)</dt>
        <dd className="text-small tabular-nums text-ink">{formatDateTime(profile.coveredFrom)}</dd>

        <dt className="text-caption text-text-muted">Zeitraum (Ende des letzten Intervalls)</dt>
        <dd className="text-small tabular-nums text-ink">{formatDateTime(profile.coveredTo)}</dd>

        <dt className="text-caption text-text-muted">Intervall</dt>
        <dd className="text-small tabular-nums text-ink">
          {profile.intervalMinutes === null ? '—' : `${profile.intervalMinutes} Minuten`}
        </dd>

        <dt className="text-caption text-text-muted">Lücken</dt>
        <dd className="text-small tabular-nums text-ink">
          {profile.gaps.length === 0 ? 'keine' : `${profile.gaps.length}`}
        </dd>
      </dl>

      {profile.gaps.length > 0 && (
        <div className="mt-4">
          <p className="text-caption text-text-muted">Zeitbereiche ohne Messwerte</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {profile.gaps.map((gap) => (
              <li key={`${gap.from}-${gap.to}`} className="text-small tabular-nums text-ink">
                {formatDateTime(gap.from)} – {formatDateTime(gap.to)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 max-w-prose text-small text-text-muted">
        Gespeichert sind ausschliesslich diese Angaben über die Reihe — keine Messwerte. Die Datei
        selbst liegt in der Dokumentenliste des Projekts.
      </p>
      <p className="mt-2 max-w-prose text-small text-text-muted">
        Ein Entfernen gibt es in diesem Schritt noch nicht. Wurde die falsche Datei eingelesen, hilft
        ein erneuter Upload — er ersetzt die Angaben.
      </p>
    </div>
  )
}
