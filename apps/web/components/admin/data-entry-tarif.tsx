'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { saveMeteringPointTariffPreferenceAction } from '@/lib/admin/data-entry-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { TARIFF_PREFERENCE_KEY, type TariffPreference } from '@/lib/admin/tariff-draft'
import type { MeteringPointSummary } from '@/lib/admin/metering-points'
import { retailPriceBasisLabel, type RetailTariffRow } from '@/lib/admin/retail-tariffs'
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
  retailTariffs,
  awattarAverageCtPerKwh,
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
  /**
   * Die offenen Lieferanten-Tarife des Projekt-Segments, aufsteigend nach Arbeitspreis, höchstens
   * fünf — gelesen in der Seite. Leer heisst „keiner hinterlegt" ODER „Lesezugriff gescheitert";
   * die Anzeige unterscheidet das bewusst nicht (s. u.).
   */
  retailTariffs: readonly RetailTariffRow[]
  /** Der aWATTar-Durchschnitt der letzten 30 Tage in ct/kWh, oder `null` ohne Preisdaten. */
  awattarAverageCtPerKwh: number | null
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
        ⚠ REINE ANZEIGE — keine Berechnung, keine Empfehlung, kein Ranking.

        Die Liste steht UNGERANKT da und hebt kein Angebot hervor: was für diesen Betrieb der
        günstigere Tarif ist, hängt an seinem Lastgang und seinem Verbrauch, nicht am blossen
        Arbeitspreis — eine Hervorhebung behauptete eine Rechnung, die hier niemand angestellt hat.
        Sie ist damit dieselbe Sorte Referenzliste wie der Preisblatt-Vorschlag der Rechnung-Station:
        etwas zum Danebenhalten, nicht zum Übernehmen. Die Sortierung nach Arbeitspreis ist eine
        Lesehilfe und sagt nichts über die Eignung.

        ⚠ LEER IST KEIN FEHLER, und deshalb steht hier auch keine Fehlermeldung. `retail_tariffs`
        ist heute dünn befüllt (es gibt kein Admin-UI, der Katalog wächst erst) — „noch keiner
        hinterlegt" ist der NORMALZUSTAND, kein Defekt. Aus demselben Grund unterscheidet die
        Anzeige das nicht von einem gescheiterten Lesezugriff: beide Male gibt es nichts zu
        vergleichen, die Wahl oben funktioniert unverändert, und ein roter Kasten über einer
        Zusatzinfo lenkte von der einen Handlung ab, um die es auf dieser Station geht.
      */}
      <AdminPanel>
        <h3 className="text-h4 text-ink">Zum Vergleich</h3>
        <p className="mt-1 text-caption text-text-muted">
          Reine Einordnungshilfe für die Wahl oben — keine Berechnung, keine Empfehlung.
        </p>

        {retailTariffs.length === 0 ? (
          <p className="mt-4 text-small text-text-muted">
            Für dieses Segment ist noch kein Lieferanten-Tarif hinterlegt.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {retailTariffs.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 text-small"
              >
                <span className="text-text">{row.provider_name}</span>
                <span className="tabular-nums text-text-muted">
                  {row.energy_price_ct_per_kwh} ct/kWh · {row.base_fee_eur_per_month} EUR/Monat ·{' '}
                  {retailPriceBasisLabel(row.price_basis)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {awattarAverageCtPerKwh !== null && (
          <p className="mt-4 border-t border-line pt-3 text-small text-text-muted">
            aWATTar, Ø letzte 30 Tage:{' '}
            <span className="tabular-nums text-text">{awattarAverageCtPerKwh.toFixed(2)}</span>{' '}
            ct/kWh
          </p>
        )}
      </AdminPanel>

      {/*
        ⚠ DER WEG NACH VORN GEHÖRT DIESER KOMPONENTE, NICHT DER SEITE — dieselbe Regel wie bei den
        vier Stationen davor: wer den Zustand kennt, rendert ihn. Die Seite unterdrückt ihren
        generischen „Weiter"-Link für diese Station; stünde er daneben, gäbe es zwei Wege nach vorn.

        ⚠ ER HÄNGT NICHT AN DER ANTWORT — „Weiter" ist Navigation, keine Vollständigkeitsprüfung.
        Bis zum 14.09.2026 stand hier zusätzlich `saved !== null`; das machte ausgerechnet die
        LETZTE Station je Zählpunkt zur Sackgasse, solange niemand geantwortet hatte — bei mehreren
        Zählpunkten hing daran auch der nächste. Eine fehlende Tarif-Wahl gehört dort abgefangen,
        wo über die Vollständigkeit entschieden wird (KI-Check, Abbruchprüfung), nicht an einem
        Link. Damit verhält sich die Station wie die vier davor.
      */}
      {nextHref !== null && (
        <div>
          <Button asChild variant="primary" size="md">
            <Link href={nextHref}>Weiter</Link>
          </Button>
        </div>
      )}
    </div>
  )
}
