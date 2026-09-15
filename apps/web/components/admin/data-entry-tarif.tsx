'use client'

import { useActionState, useId } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  deleteMeteringPointTariffComparisonAction,
  saveMeteringPointTariffComparisonAction,
  saveMeteringPointTariffPreferenceAction,
} from '@/lib/admin/data-entry-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import {
  TARIFF_COMPARISON_BASE_FEE_KEY,
  TARIFF_COMPARISON_ENERGY_PRICE_KEY,
  TARIFF_COMPARISON_PRICE_BASES,
  TARIFF_COMPARISON_PRICE_BASIS_KEY,
  TARIFF_COMPARISON_PROVIDER_NAME_KEY,
  TARIFF_PREFERENCE_KEY,
  type TariffComparisonPriceBasis,
  type TariffPreference,
} from '@/lib/admin/tariff-draft'
import type { MeteringPointSummary } from '@/lib/admin/metering-points'
import type { ProjectSegment } from '@/lib/admin/projects'
import { AdminError, AdminField, AdminPanel, AdminSelect, AdminSuccess } from './ui'

/**
 * B24, Teil 1 — die TARIF-Station: die fünfte und letzte je Zählpunkt.
 *
 * Zwei Knöpfe, ein Feld — und im Zweig „optimieren" zusätzlich der selbst gefundene
 * Vergleichstarif. Was hier entsteht, ist ein WUNSCH („behalten" oder „optimieren") plus eine
 * ANGABE des Kunden, kein Katalog; die Begründungen dazu stehen in `data-entry-actions-tarif.ts`
 * und im Kopf von `lib/admin/tariff-draft.ts`.
 *
 * ── ⚠ DIE ANTWORT WIRD GESPEICHERT UND AUS DER DATENBANK GELESEN ──────────────────────────────
 * `saved` kommt aus `meteringPoint.draft`, nicht aus dem Rückgabewert der Action. Aus der Antwort
 * gezeigt stünde die Station nach einem Neuladen ohne Zusammenfassung da, obwohl gespeichert ist —
 * dieselbe Regel wie bei der Lastgang-Station. Der Schreibweg ruft `revalidatePath`, die Seite
 * rendert also nach dem Klick mit dem frischen Stand neu. **Dasselbe gilt für den Vergleichstarif:
 * seine Zusammenfassung entsteht aus dem Entwurf, nicht aus `state.success`.**
 *
 * ── ⚠ ES GIBT KEINEN KATALOG MEHR AN DIESER STATION ───────────────────────────────────────────
 * Bis zum 15.09.2026 stand hier eine Liste der offenen `retail_tariffs` des Segments. Sie ist
 * ERSATZLOS entfernt (Fachentscheidung): der Nutzer sucht selbst auf einem Vergleichsportal und
 * trägt GENAU EINEN gefundenen Tarif ein. Der Katalog selbst (`public.retail_tariffs`, sein
 * Formular und seine Admin-Seite) bleibt unangetastet — er wird von HIER nur nicht mehr gelesen.
 */

const PREFERENCE_LABEL: Record<TariffPreference, string> = {
  behalten: 'Aktuellen Stromtarif behalten',
  optimieren: 'Optimalen Tarif vorschlagen lassen',
}

/**
 * Beschriftung der Preisbasis — WORTGLEICH zum Lieferanten-Tarife-Formular, bewusst als eigene
 * Konstante.
 *
 * Ein Import von `RETAIL_PRICE_BASIS_LABELS` (`lib/admin/retail-tariffs.ts`) zöge das ganze Modul
 * samt seiner Zeilen-Typen, Staleness-Rechnung und Rückfragetexte in das Bündel dieser Station —
 * für zwei Zeichenketten. Dieselbe Entscheidung und dieselbe Begründung, mit der
 * `TARIFF_COMPARISON_PRICE_BASES` dort nicht importiert, sondern gespiegelt wird.
 */
const PRICE_BASIS_LABEL: Record<TariffComparisonPriceBasis, string> = {
  net: 'netto (ohne USt.)',
  gross: 'brutto (inkl. USt.)',
}

/**
 * Platzhalter der Betragsfelder — ein FORMAT-Hinweis, kein Beispielwert.
 *
 * Dieselbe Lehre wie beim Tarifblatt-Scan (B21-2b Teil A) und beim Lieferanten-Formular: eine
 * plausible Zahl ist in einem `inputMode="numeric"`-Feld von einem abgetippten Wert nicht zu
 * unterscheiden — und sie wäre zufällig der echte Preis irgendeines Anbieters.
 */
const AMOUNT_PLACEHOLDER = 'Betrag vom Vergleichsportal'

/**
 * Beträge dieser Karte, de-AT — Komma als Dezimaltrennzeichen, IMMER zwei Nachkommastellen.
 *
 * ⚠ Zwei Nachkommastellen auch dort, wo die Zahl keine braucht: „24,50" und „24,5" untereinander
 * lesen sich als zwei verschiedene Genauigkeiten, obwohl beide derselbe Preis sind.
 *
 * ⚠ EIN FUNDORT für beide Zahlen dieser Karte (aWATTar-Durchschnitt und der eingetragene
 * Vergleichstarif): zwei inline ausgeschriebene Formatierungen liefen beim nächsten Umbau
 * auseinander, und dann stünden in DERSELBEN Karte zwei Schreibweisen desselben Preises.
 */
const AMOUNT = new Intl.NumberFormat('de-AT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

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

type TariffComparison = {
  providerName: string
  energyPriceCtPerKwh: number
  baseFeeEurPerMonth: number
  priceBasis: TariffComparisonPriceBasis
}

/**
 * Der gespeicherte Vergleichstarif, oder `null`.
 *
 * ⚠ ALLE VIER ODER KEINES — dieselbe Regel wie im Schreibweg, hier auf der Leseseite. Ein aus
 * jsonb halb gefüllter Eintrag (drei Felder da, eines weg oder vom falschen Typ) würde sonst als
 * vollständiger Vergleich angezeigt; „14,94 ct/kWh" ohne Preisbasis ist um den Steuersatz
 * mehrdeutig, und der Unterschied fiele an einer Zusammenfassung nicht auf.
 *
 * Gelesen wird aus der DATENBANK, nicht aus dem Rückgabewert der Action (s. Kopf).
 */
function currentComparison(point: MeteringPointSummary): TariffComparison | null {
  const providerName = point.draft[TARIFF_COMPARISON_PROVIDER_NAME_KEY]
  const energyPrice = point.draft[TARIFF_COMPARISON_ENERGY_PRICE_KEY]
  const baseFee = point.draft[TARIFF_COMPARISON_BASE_FEE_KEY]
  const priceBasis = point.draft[TARIFF_COMPARISON_PRICE_BASIS_KEY]

  if (typeof providerName !== 'string' || providerName === '') return null
  if (typeof energyPrice !== 'number' || !Number.isFinite(energyPrice)) return null
  if (typeof baseFee !== 'number' || !Number.isFinite(baseFee)) return null
  if (priceBasis !== 'net' && priceBasis !== 'gross') return null

  return {
    providerName,
    energyPriceCtPerKwh: energyPrice,
    baseFeeEurPerMonth: baseFee,
    priceBasis,
  }
}

/**
 * Der Suchauftrag an den Admin, segmentabhängig.
 *
 * ⚠ `null` BEKOMMT EINEN EIGENEN SATZ UND FÄLLT NICHT AUF „PRIVAT" ZURÜCK. Der Spaltenkommentar
 * von `platform.projects.segment` sagt ausdrücklich, dass `null` „noch nicht bestimmt" heisst und
 * nicht „Privat" (s. `projectSegmentLabel`). Ein Vorgabewert schickte den Admin auf die Suche nach
 * der falschen Tarifart — und der eingetragene Preis sähe danach aus wie eine geprüfte Angabe.
 */
function searchHint(segment: ProjectSegment | null): string {
  if (segment === 'privat') {
    return 'Suchen Sie auf einem Tarifvergleichsportal (z. B. tarife.at, durchblicker.at) nach einem Privatkunden-Stromtarif für diese Situation und tragen Sie den besten gefundenen Tarif unten ein.'
  }
  if (segment === 'betrieb') {
    return 'Suchen Sie auf einem Tarifvergleichsportal (z. B. tarife.at, durchblicker.at) nach einem Gewerbe-Stromtarif für diese Situation und tragen Sie den besten gefundenen Tarif unten ein.'
  }
  return 'Suchen Sie auf einem Tarifvergleichsportal (z. B. tarife.at, durchblicker.at) nach einem passenden Stromtarif für diese Situation und tragen Sie den besten gefundenen Tarif unten ein. Das Segment dieses Projekts ist noch nicht bestimmt — achten Sie darauf, ob Sie einen Privatkunden- oder einen Gewerbetarif vor sich haben.'
}

export function DataEntryTarif({
  projectId,
  meteringPoint,
  nextHref,
  segment,
  hasKnownTariff,
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
   * Das Segment des Projekts — entscheidet ausschliesslich den Wortlaut des Suchauftrags.
   *
   * ⚠ NULLBAR, bewusst abweichend von der Auftragsskizze (`segment: ProjectSegment`): die Seite
   * hält den Wert als `ProjectSegment | null` (`currentSegment`), weil `platform.projects.segment`
   * nullable ist. Nicht-nullbar zu fordern liesse nur zwei Auswege, und beide sind schlechter —
   * eine Typzusicherung wäre eine Behauptung ohne Grundlage, und die Station an
   * `currentSegment !== null` zu koppeln liesse sie samt Tarifwahl VERSCHWINDEN, sobald kein
   * Segment gesetzt ist. Präzedenz: `data-entry-load-profile.tsx` führt dieselbe Prop ebenso.
   */
  segment: ProjectSegment | null
  /**
   * Steht für diesen Zählpunkt überhaupt ein Tarif fest — aus einer gelesenen Rechnung ODER von
   * Hand eingetragen? Nur dann gibt es etwas zu „behalten".
   *
   * ⚠ Die Frage gilt für BEIDE Wege der Rechnung-Station gleich (Upload und Handeingabe schreiben
   * denselben Feldvorrat), und sie wird SERVERSEITIG beantwortet — welche Felder dafür zählen und
   * warum `annualConsumptionKwh` ausgenommen ist, steht in `lib/admin/known-tariff.ts`.
   */
  hasKnownTariff: boolean
  /** Der aWATTar-Durchschnitt der letzten 30 Tage in ct/kWh, oder `null` ohne Preisdaten. */
  awattarAverageCtPerKwh: number | null
}) {
  const [state, formAction, isPending] = useActionState(
    saveMeteringPointTariffPreferenceAction,
    ADMIN_INITIAL_STATE,
  )
  const [comparisonState, comparisonAction, isSavingComparison] = useActionState(
    saveMeteringPointTariffComparisonAction,
    ADMIN_INITIAL_STATE,
  )
  /*
   * ⚠ EIGENER Zustand neben dem des Speicherns — gemeinsam benutzt überschriebe ein Fehler beim
   * Löschen die Meldung des Speicherns und umgekehrt. Dieselbe Trennung wie beim Entfernen einer
   * Rechnung (PR #197).
   */
  const [deleteComparisonState, deleteComparisonAction, isDeletingComparison] = useActionState(
    deleteMeteringPointTariffComparisonAction,
    ADMIN_INITIAL_STATE,
  )

  const formId = useId()
  const saved = currentPreference(meteringPoint)
  const comparison = currentComparison(meteringPoint)

  return (
    <div className="flex flex-col gap-6">
      <AdminPanel>
        {saved && (
          <p className="mb-4 text-small text-text">
            Aktuell vermerkt:{' '}
            <span className="font-medium text-ink">{PREFERENCE_LABEL[saved]}</span>
          </p>
        )}
        {state.formError && <AdminError>{state.formError}</AdminError>}
        {state.success && <AdminSuccess>{state.success}</AdminSuccess>}

        {/*
          ⚠ OHNE BEKANNTEN TARIF GIBT ES NICHTS ZU BEHALTEN — der Satz nennt den Grund, statt einen
          Knopf ohne Erklärung verschwinden zu lassen. Er sagt zugleich, dass dadurch nichts fehlt:
          die Rechnung ist für die Tarif-OPTIMIERUNG keine Voraussetzung, weil ohnehin gegen
          aWATTar gerechnet wird.
        */}
        {!hasKnownTariff && (
          <p className="mb-3 text-caption text-text-muted">
            Für diesen Zählpunkt ist kein Tarif aus Rechnung oder Handeingabe bekannt — die Analyse
            rechnet ohnehin auf Basis von aWATTar.
          </p>
        )}

        {/*
          ⚠ BEIDE SUBMIT-KNÖPFE TRAGEN `name="preference"`: der Browser sendet ausschliesslich den
          Wert des GEKLICKTEN mit. Ein Auswahlfeld plus Speichern-Knopf wären zwei Handlungen für
          eine Entscheidung; hier ist der Klick die Antwort.

          ⚠ „Tarif behalten" erscheint nur mit bekanntem Tarif — er wird GAR NICHT gerendert und
          nicht ausgegraut: ein gesperrter Knopf ohne Erklärung lässt jemanden raten, was ihn löst,
          und „behalten" ist ohne bekannten Tarif keine Handlung, die auch nur als Möglichkeit
          danebenstehen sollte (dieselbe Zurückhaltung wie beim Überspringen-Knopf der
          Rechnung-Station).

          ⚠ EINE BEREITS GESPEICHERTE „behalten"-WAHL BLEIBT SICHTBAR — die Zusammenfassungszeile
          oben hängt ausdrücklich NICHT an `hasKnownTariff`. Sie ist eine Aussage darüber, was
          jemand entschieden hat; sie rückwirkend zu verstecken (oder gar zu löschen), weil die
          Rechnung inzwischen entfernt wurde, machte aus einer Entscheidung eine Lücke. Verschwunden
          ist nur der Weg, sie ERNEUT zu wählen.
        */}
        <form action={formAction} className="flex flex-wrap gap-3">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="meteringPointId" value={meteringPoint.id} />
          {hasKnownTariff && (
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
          )}
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
        ⚠ IMMER SICHTBAR, AUCH OHNE PREISDATEN — und bewusst KEIN eigenes Panel.

        Der Absatz sagt zuerst, WOMIT gerechnet wird (aWATTar, weil nur stündliche Preise eine
        Batteriesteuerung tragen); nur die ZAHL daneben ist Einordnung und entfällt ohne Preisdaten.
        An `awattarAverageCtPerKwh !== null` als Gesamtbedingung gehängt verschwände mit der Zahl
        auch die Erklärung — und der Vergleichstarif darunter stünde ohne den Bezug da, gegen den
        er verglichen wird. Er beantwortet eine einzige Frage und braucht dafür keine Fläche mit
        eigener Überschrift.
        Bis zum 15.09.2026 stand er im Fuss des Katalog-Panels; mit dessen Entfernung wäre eine
        eigene Karte für einen Satz übriggeblieben.
      */}
      <p className="text-small text-text-muted">
        aWATTar ist die Grundlage jeder Berechnung — die Analyse rechnet immer mit den stündlichen
        Spotpreisen, weil nur sie eine Batteriesteuerung ermöglichen.
        {awattarAverageCtPerKwh !== null && (
          <>
            {' '}
            Ø letzte 30 Tage:{' '}
            <span className="tabular-nums text-text">
              {AMOUNT.format(awattarAverageCtPerKwh)}
            </span>{' '}
            ct/kWh.
          </>
        )}{' '}
        Zusätzlich lässt sich unten ein einzelner, selbst gefundener Tarif zum Vergleich
        heranziehen.
      </p>

      {/*
        ⚠ NUR IM ZWEIG „OPTIMIEREN" — und dort FREIWILLIG.

        Wer seinen Tarif behalten will, sucht keinen Vergleichstarif; das Formular wäre dort eine
        Aufforderung zu einer Arbeit, die niemand angefordert hat. Und selbst im Zweig „optimieren"
        blockiert ein leeres Formular nichts: „Weiter" hängt seit dem 14.09.2026 ausdrücklich nicht
        an der Vollständigkeit dieser Station (s. der Absatz beim Weiter-Knopf unten).
      */}
      {saved === 'optimieren' && (
        <AdminPanel>
          <h3 className="text-h4 text-ink">Vergleichstarif (optional)</h3>
          <p className="mt-1 text-caption text-text-muted">{searchHint(segment)}</p>

          {comparison && (
            <>
              <p className="mt-4 text-small text-text">
                Aktuell vermerkt:{' '}
                <span className="font-medium text-ink">{comparison.providerName}</span> ·{' '}
                <span className="tabular-nums">
                  {AMOUNT.format(comparison.energyPriceCtPerKwh)} ct/kWh
                </span>{' '}
                ·{' '}
                <span className="tabular-nums">
                  {AMOUNT.format(comparison.baseFeeEurPerMonth)} EUR/Monat
                </span>{' '}
                · {PRICE_BASIS_LABEL[comparison.priceBasis]}
              </p>

              {/*
                ⚠ RÜCKFRAGE AN EINEN MENSCHEN, KEINE PRÜFUNG — die Autorisierung liegt in der
                Datenbank (Muster `ActionButton`/T4-4). Sie steht hier, weil der Klick vier Felder
                gemeinsam entfernt und es dafür keinen Rückweg gibt ausser dem erneuten Eintragen.

                ⚠ `ghost`, klein, UNTER der Zusammenfassung: er ist der Ausweg, nicht der Weg —
                dieselbe Zurückhaltung wie beim „Lastgang entfernen" der ersten Station.
              */}
              <form
                action={deleteComparisonAction}
                onSubmit={(e) => {
                  if (!window.confirm(`Vergleichstarif „${comparison.providerName}" löschen?`))
                    e.preventDefault()
                }}
                className="mt-3"
              >
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="meteringPointId" value={meteringPoint.id} />
                <Button type="submit" variant="ghost" size="sm" disabled={isDeletingComparison}>
                  {isDeletingComparison && (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin"
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  )}
                  Vergleichstarif löschen
                </Button>
              </form>
              {deleteComparisonState.formError && (
                <AdminError>{deleteComparisonState.formError}</AdminError>
              )}
            </>
          )}

          {comparisonState.formError && <AdminError>{comparisonState.formError}</AdminError>}
          {comparisonState.success && <AdminSuccess>{comparisonState.success}</AdminSuccess>}

          {/*
            ⚠ LIEGT EIN VERGLEICH VOR, GIBT ES DAS FORMULAR NICHT — es entsteht GENAU EINER je
            Zählpunkt (`currentComparison` liest genau einen Satz Felder). Danebenstehend lud es
            dazu ein, einen zweiten einzutragen, der den ersten still ersetzt. Korrigiert wird über
            löschen und neu eintragen — derselbe Weg wie bei einer PV-Modulfläche (PR #226).
          */}
          {comparison === null && (
            <form action={comparisonAction} className="mt-4 flex flex-col gap-4">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="meteringPointId" value={meteringPoint.id} />

              <AdminField
                id={`${formId}-providerName`}
                name="providerName"
                label="Anbieter"
                placeholder="Name des gefundenen Anbieters"
                error={comparisonState.fieldErrors?.providerName}
                /*
                ⚠ KEINE VORBELEGUNG AUS DEM GESPEICHERTEN VERGLEICH MEHR — sie wäre ab jetzt toter
                Code: das Formular erscheint ausschliesslich, wenn KEINER gespeichert ist
                (TypeScript engt `comparison` hier auf `null` ein). Vorbelegt wird nur noch, was
                der Absender selbst getippt hat und was die Action wegen eines Feldfehlers
                zurückgegeben hat.
              */
                defaultValue={comparisonState.values?.providerName}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <AdminField
                  id={`${formId}-energyPriceCtPerKwh`}
                  name="energyPriceCtPerKwh"
                  label="Arbeitspreis (ct/kWh)"
                  inputMode="numeric"
                  placeholder={AMOUNT_PLACEHOLDER}
                  error={comparisonState.fieldErrors?.energyPriceCtPerKwh}
                />
                <AdminField
                  id={`${formId}-baseFeeEurPerMonth`}
                  name="baseFeeEurPerMonth"
                  label="Grundgebühr (EUR/Monat)"
                  inputMode="numeric"
                  placeholder={AMOUNT_PLACEHOLDER}
                  error={comparisonState.fieldErrors?.baseFeeEurPerMonth}
                />
              </div>

              {/*
              ⚠ KEINE VORAUSWAHL — dieselbe Begründung wie bei den Lieferanten-Tarifen
              (`RETAIL_SELECT_UNSET`): Anbieter bewerben gegenüber Haushalten üblicherweise brutto,
              gegenüber Betrieben netto. Ein Vorgabewert wäre eine Vermutung, die im Formular
              aussieht wie eine Ablesung — und ein brutto eingetragener, als netto geführter Preis
              macht den Vergleich um den Steuersatz falsch, in einer Richtung, die niemandem als
              Fehler auffiele.
            */}
              <AdminSelect
                id={`${formId}-priceBasis`}
                name="priceBasis"
                label="Preisbasis"
                defaultValue={comparisonState.values?.priceBasis ?? ''}
                error={comparisonState.fieldErrors?.priceBasis}
              >
                <option value="">— bitte wählen —</option>
                {TARIFF_COMPARISON_PRICE_BASES.map((basis) => (
                  <option key={basis} value={basis}>
                    {PRICE_BASIS_LABEL[basis]}
                  </option>
                ))}
              </AdminSelect>

              <div>
                <Button type="submit" variant="secondary" size="sm" disabled={isSavingComparison}>
                  {isSavingComparison && (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
                  )}
                  Vergleich speichern
                </Button>
              </div>
            </form>
          )}
        </AdminPanel>
      )}

      {/*
        ⚠ DER WEG NACH VORN GEHÖRT DIESER KOMPONENTE, NICHT DER SEITE — dieselbe Regel wie bei den
        vier Stationen davor: wer den Zustand kennt, rendert ihn. Die Seite unterdrückt ihren
        generischen „Weiter"-Link für diese Station; stünde er daneben, gäbe es zwei Wege nach vorn.

        ⚠ ER HÄNGT NICHT AN DER ANTWORT — „Weiter" ist Navigation, keine Vollständigkeitsprüfung.
        Bis zum 14.09.2026 stand hier zusätzlich `saved !== null`; das machte ausgerechnet die
        LETZTE Station je Zählpunkt zur Sackgasse, solange niemand geantwortet hatte — bei mehreren
        Zählpunkten hing daran auch der nächste. Eine fehlende Tarif-Wahl gehört dort abgefangen,
        wo über die Vollständigkeit entschieden wird (KI-Check, Abbruchprüfung), nicht an einem
        Link. Dasselbe gilt für den Vergleichstarif: er ist ausdrücklich optional.
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
