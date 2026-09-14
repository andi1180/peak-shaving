'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { saveMeteringPointTariffPreferenceAction } from '@/lib/admin/data-entry-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { TARIFF_PREFERENCE_KEY, type TariffPreference } from '@/lib/admin/tariff-draft'
import type { MeteringPointSummary } from '@/lib/admin/metering-points'
import { AdminError, AdminPanel, AdminSuccess } from './ui'

/**
 * B24, Teil 1 — die TARIF-Station: die fünfte und letzte je Zählpunkt.
 *
 * Zwei Knöpfe, ein Feld. Was hier entsteht, ist ein WUNSCH („behalten" oder „optimieren"), kein
 * Messwert — die Begründung dazu steht in `data-entry-actions-tarif.ts`.
 *
 * ── ⚠ DIE ANTWORT WIRD GESPEICHERT UND AUS DER DATENBANK GELESEN ──────────────────────────────
 * `saved` kommt aus `meteringPoint.draft`, nicht aus dem Rückgabewert der Action. Aus der Antwort
 * gezeigt stünde die Station nach einem Neuladen ohne Zusammenfassung da, obwohl gespeichert ist —
 * dieselbe Regel wie bei der Lastgang-Station. Der Schreibweg ruft `revalidatePath`, die Seite
 * rendert also nach dem Klick mit dem frischen Stand neu.
 */

const PREFERENCE_LABEL: Record<TariffPreference, string> = {
  behalten: 'Aktuellen Stromtarif behalten',
  optimieren: 'Optimalen Tarif vorschlagen lassen',
}

/**
 * Der gespeicherte Wunsch, oder `null`.
 *
 * ⚠ Geprüft wird gegen die zwei bekannten Werte und nicht auf „irgendeine Zeichenkette": `draft`
 * ist ein `Record<string, unknown>` aus jsonb, und ein von Hand verunstalteter Eintrag würde sonst
 * als Wunsch angezeigt, den `PREFERENCE_LABEL` gar nicht beschriften kann.
 */
function currentPreference(point: MeteringPointSummary): TariffPreference | null {
  const value = point.draft[TARIFF_PREFERENCE_KEY]
  return value === 'behalten' || value === 'optimieren' ? value : null
}

export function DataEntryTarif({
  projectId,
  meteringPoint,
  nextHref,
}: {
  projectId: string
  meteringPoint: MeteringPointSummary
  /**
   * 1-basiert, wie in der Station — die Nummer ist eine Position, keine Kennung.
   *
   * ⚠ Bewusst NICHT destrukturiert: die Seite reicht sie wie bei den vier Stationen davor herein,
   * diese Station braucht sie aber nicht (sie zeigt keine Zusammenfassung, die den Zählpunkt
   * benennt). Als Prop bleibt sie stehen, damit der Aufruf in `page.tsx` die Form der übrigen hat.
   */
  meteringPointNumber: number
  /** Die nächste Station, oder `null` am Ende der Liste. */
  nextHref: string | null
}) {
  const [state, formAction, isPending] = useActionState(
    saveMeteringPointTariffPreferenceAction,
    ADMIN_INITIAL_STATE,
  )
  const saved = currentPreference(meteringPoint)

  return (
    <div className="flex flex-col gap-6">
      <AdminPanel>
        {saved && (
          <p className="mb-4 text-small text-text">
            Aktuell vermerkt: <span className="font-medium text-ink">{PREFERENCE_LABEL[saved]}</span>
          </p>
        )}
        {state.formError && <AdminError>{state.formError}</AdminError>}
        {state.success && <AdminSuccess>{state.success}</AdminSuccess>}

        {/*
          ⚠ ZWEI SUBMIT-KNÖPFE AUF EINEM FORMULAR, beide mit `name="preference"`: der Browser sendet
          ausschliesslich den Wert des GEKLICKTEN mit. Ein Auswahlfeld plus Speichern-Knopf wären
          zwei Handlungen für eine Entscheidung; hier ist der Klick die Antwort.
        */}
        <form action={formAction} className="flex flex-wrap gap-3">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="meteringPointId" value={meteringPoint.id} />
          <Button
            type="submit"
            name="preference"
            value="behalten"
            variant="secondary"
            size="sm"
            disabled={isPending}
          >
            {isPending && (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
            )}
            Tarif behalten
          </Button>
          <Button
            type="submit"
            name="preference"
            value="optimieren"
            variant="primary"
            size="sm"
            disabled={isPending}
          >
            {isPending && (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
            )}
            Optimalen Tarif vorschlagen lassen
          </Button>
        </form>
      </AdminPanel>

      {/*
        ⚠ DER WEG NACH VORN GEHÖRT DIESER KOMPONENTE, NICHT DER SEITE — dieselbe Regel wie bei den
        vier Stationen davor: wer den Zustand kennt, rendert ihn. Die Seite unterdrückt ihren
        generischen „Weiter"-Link für diese Station; stünde er daneben, gäbe es zwei Wege nach vorn.

        ⚠ ER ERSCHEINT HIER ERST NACH EINER ANTWORT — und das ist die EINE bewusste Abweichung von
        den vier Stationen davor, die ihn immer zeigen und nur seine PROMINENZ an den Zustand
        hängen („die Station ist keine Sackgasse", s. `data-entry-battery.tsx`). Der Preis ist
        benannt: solange niemand geantwortet hat, führt von dieser Station kein Weg weiter, und sie
        ist die LETZTE je Zählpunkt — bei mehreren Zählpunkten hängt damit auch der nächste daran.
        Tragbar, weil die Frage anders als bei Batterie oder PV keine Recherche verlangt: beide
        Antworten stehen als Knopf da und sind ohne Rückfrage beim Kunden nicht zu verfehlen.
      */}
      {nextHref !== null && saved !== null && (
        <div>
          <Button asChild variant="primary" size="md">
            <Link href={nextHref}>Weiter</Link>
          </Button>
        </div>
      )}
    </div>
  )
}
