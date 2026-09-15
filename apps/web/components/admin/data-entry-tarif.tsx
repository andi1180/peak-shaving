'use client'

import { useActionState, useId, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  deleteMeteringPointTariffComparisonAction,
  saveMeteringPointTariffComparisonAction,
} from '@/lib/admin/data-entry-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import {
  TARIFF_COMPARISON_BASE_FEE_KEY,
  TARIFF_COMPARISON_ENERGY_PRICE_KEY,
  TARIFF_COMPARISON_PRICE_BASES,
  TARIFF_COMPARISON_PRICE_BASIS_KEY,
  TARIFF_COMPARISON_PROVIDER_NAME_KEY,
  type TariffComparisonPriceBasis,
} from '@/lib/admin/tariff-draft'
import type { MeteringPointSummary } from '@/lib/admin/metering-points'
import type { ProjectSegment } from '@/lib/admin/projects'
import { AdminError, AdminField, AdminPanel, AdminSelect, AdminSuccess } from './ui'

/**
 * B24, Teil 1 — die TARIF-Station: die fünfte und letzte je Zählpunkt.
 *
 * Was hier entsteht, ist eine einzige ANGABE des Kunden — ein selbst gefundener Vergleichstarif —
 * und sonst nichts. Kein Katalog, kein Vorschlag, keine Wahl.
 *
 * ── ⚠ ES GIBT KEINE TARIF-WAHL MEHR (Fachentscheidung 15.09.2026) ─────────────────────────────
 * Bis hierher stand hier ein WUNSCH („aktuellen Tarif behalten" gegen „optimalen Tarif vorschlagen
 * lassen"), festgehalten als Entwurfsfeld. Er ist ERSATZLOS entfernt: der Vergleich mit aWATTar ist
 * ab jetzt AUTOMATISCH und keine Kundenentscheidung, die die Dateneingabe abfragen müsste.
 *
 * Zwei Gründe tragen das: der Vergleich KOSTET NICHTS — er ist reine Anzeige, keine Berechnung, die
 * ein Mensch anfordern müsste; und OB der Kunde tatsächlich wechselt, ist seine eigene, spätere
 * Entscheidung — nichts, das die Dateneingabe schon wissen muss. Ein gespeicherter Wunsch wäre eine
 * Anweisung an eine Analyse, die ohnehin immer gegen die stündlichen Spotpreise rechnet.
 *
 * ── ⚠ DIE ANGABE WIRD GESPEICHERT UND AUS DER DATENBANK GELESEN ───────────────────────────────
 * Die Zusammenfassung des Vergleichstarifs entsteht aus `meteringPoint.draft`, nicht aus
 * `comparisonState.success`. Aus der Antwort gezeigt stünde die Station nach einem Neuladen ohne
 * Zusammenfassung da, obwohl gespeichert ist — dieselbe Regel wie bei der Lastgang-Station. Der
 * Schreibweg ruft `revalidatePath`, die Seite rendert also nach dem Klick mit dem frischen Stand neu.
 *
 * ── ⚠ ES GIBT KEINEN KATALOG MEHR AN DIESER STATION ───────────────────────────────────────────
 * Bis zum 15.09.2026 stand hier eine Liste der offenen `retail_tariffs` des Segments. Sie ist
 * ERSATZLOS entfernt (Fachentscheidung): der Nutzer sucht selbst auf einem Vergleichsportal und
 * trägt GENAU EINEN gefundenen Tarif ein. Der Katalog selbst (`public.retail_tariffs`, sein
 * Formular und seine Admin-Seite) bleibt unangetastet — er wird von HIER nur nicht mehr gelesen.
 */

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
   * Hand eingetragen?
   *
   * ⚠ Die Prop BLEIBT, ihre Verwendung hat gewechselt: Sie blendet seit dem 15.09.2026 KEINEN Knopf
   * mehr aus (den gibt es nicht mehr), sondern entscheidet allein die FORMULIERUNG des
   * aWATTar-Absatzes — „wird verglichen" gegen „wird verglichen, sobald einer bekannt ist".
   *
   * Die Frage gilt für BEIDE Wege der Rechnung-Station gleich (Upload und Handeingabe schreiben
   * denselben Feldvorrat), und sie wird SERVERSEITIG beantwortet — welche Felder dafür zählen und
   * warum `annualConsumptionKwh` ausgenommen ist, steht in `lib/admin/known-tariff.ts`.
   */
  hasKnownTariff: boolean
  /** Der aWATTar-Durchschnitt der letzten 30 Tage in ct/kWh, oder `null` ohne Preisdaten. */
  awattarAverageCtPerKwh: number | null
}) {
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
  const comparison = currentComparison(meteringPoint)

  /*
   * ⚠ REIN LOKALER AUFKLAPP-ZUSTAND, bewusst NICHT im Entwurf gespeichert (Muster `manualOpen` in
   * `data-entry-invoice.tsx`): „ich will gerade etwas eintragen" ist eine Aussage über DIESEN
   * Bearbeitungsmoment, keine Angabe über den Zählpunkt. Gespeichert stünde sie später neben einem
   * eingetragenen Vergleichstarif und behauptete etwas über einen Vorgang, der längst abgeschlossen
   * ist. Liegt bereits ein Vergleich vor, ist der Zustand ohnehin bedeutungslos — die
   * Zusammenfassung steht dann unabhängig davon da.
   */
  const [comparisonOpen, setComparisonOpen] = useState(false)

  return (
    <div className="flex flex-col gap-6">
      {/*
        ⚠ IMMER SICHTBAR, AUCH OHNE PREISDATEN — und bewusst KEIN eigenes Panel.

        Der Absatz sagt, WOMIT gerechnet wird (aWATTar, weil nur stündliche Preise eine
        Batteriesteuerung tragen); nur die ZAHL daneben ist Einordnung und entfällt ohne Preisdaten.
        An `awattarAverageCtPerKwh !== null` als Gesamtbedingung gehängt verschwände mit der Zahl
        auch die Erklärung. Er beantwortet eine einzige Frage und braucht dafür keine Fläche mit
        eigener Überschrift.

        ⚠ `hasKnownTariff` ENTSCHEIDET NUR DIE FORMULIERUNG, nicht ob der Absatz erscheint: ohne
        bekannten Tarif gibt es nichts zu vergleichen, ABER die Analyse rechnet trotzdem — und genau
        das muss dastehen, sonst liest sich das Fehlen wie eine Lücke in der Berechnung.
      */}
      {hasKnownTariff ? (
        <p className="text-small text-text-muted">
          Der aus Rechnung oder Handeingabe bekannte Tarif wird automatisch mit aWATTar verglichen —
          den stündlichen Spotpreisen, der Grundlage jeder Berechnung, weil nur sie eine
          Batteriesteuerung ermöglichen.
          {awattarAverageCtPerKwh !== null && (
            <>
              {' '}
              Ø letzte 30 Tage:{' '}
              <span className="tabular-nums text-text">
                {AMOUNT.format(awattarAverageCtPerKwh)}
              </span>{' '}
              ct/kWh.
            </>
          )}
        </p>
      ) : (
        <p className="text-small text-text-muted">
          Sobald für diesen Zählpunkt ein Tarif aus Rechnung oder Handeingabe bekannt ist, wird er
          automatisch mit aWATTar verglichen. Bis dahin rechnet die Analyse nur mit den stündlichen
          Spotpreisen von aWATTar.
          {awattarAverageCtPerKwh !== null && (
            <>
              {' '}
              Ø letzte 30 Tage:{' '}
              <span className="tabular-nums text-text">
                {AMOUNT.format(awattarAverageCtPerKwh)}
              </span>{' '}
              ct/kWh.
            </>
          )}
        </p>
      )}

      {/*
        ⚠ DER VERGLEICHSTARIF IST FREIWILLIG — und deshalb steht er hinter einem Knopf.

        Ein dauerhaft offenes Formular wäre eine Aufforderung zu einer Recherche, die niemand
        angefordert hat; „Weiter" hängt seit dem 14.09.2026 ausdrücklich nicht an der
        Vollständigkeit dieser Station (s. der Absatz beim Weiter-Knopf unten). Bis zum 15.09.2026
        hing das Formular am Zweig „optimieren" einer Tarif-WAHL — die es nicht mehr gibt.
      */}
      {comparison === null && !comparisonOpen && (
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setComparisonOpen(true)}
          >
            Zweiten Vergleichstarif hinzufügen
          </Button>
        </div>
      )}

      {(comparison !== null || comparisonOpen) && (
        <AdminPanel>
          <h3 className="text-h4 text-ink">Vergleichstarif</h3>
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

        ⚠ ER HÄNGT AN KEINER ANGABE — „Weiter" ist Navigation, keine Vollständigkeitsprüfung.
        Bis zum 14.09.2026 stand hier zusätzlich eine Bedingung auf die damalige Tarif-Wahl; das
        machte ausgerechnet die LETZTE Station je Zählpunkt zur Sackgasse, solange niemand
        geantwortet hatte — bei mehreren Zählpunkten hing daran auch der nächste. Was hier fehlt,
        gehört dort abgefangen, wo über die Vollständigkeit entschieden wird (KI-Check,
        Abbruchprüfung), nicht an einem Link. Der Vergleichstarif ist ohnehin ausdrücklich optional.
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
