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
 * ── ⚠ WAS DIESE STATION NICHT TUT ────────────────────────────────────────────────────────────
 * Kein Upload eines Erzeugungsprofils, kein PVGIS-Abruf (B22), kein Extraktor und kein
 * Modellaufruf. Der Ja-Zweig sagt genau das im Klartext, statt so auszusehen wie ein fertiger
 * Schritt — ein Platzhalter, der sich nicht als solcher zu erkennen gibt, sieht aus wie etwas
 * Kaputtes.
 */
import { useActionState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { saveMeteringPointPvChoiceAction } from '@/lib/admin/data-entry-actions'
import type { MeteringPointSummary } from '@/lib/admin/metering-points'
import { PV_PRESENT_KEY, readPvDraft } from '@/lib/admin/pv-draft'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { COMPANY } from '@/lib/nav'
import { AdminError, AdminSuccess } from './ui'

export function DataEntryPv({
  projectId,
  meteringPoint,
  meteringPointNumber,
  customerLabel,
  nextHref,
}: {
  projectId: string
  meteringPoint: MeteringPointSummary
  /** 1-basiert, wie in der Station — die Nummer ist eine Position, keine Kennung. */
  meteringPointNumber: number
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

  const { hasPv } = readPvDraft(meteringPoint.draft)

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
        <div className="border-t border-line pt-6">
          <p className="max-w-prose text-small text-text-muted">
            Hier wird als Nächstes erfasst, welches Erzeugungsprofil vorliegt — eigener
            Bauabschnitt.
          </p>
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
