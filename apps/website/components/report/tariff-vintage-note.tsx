import type { LoadProfile, TariffParams } from 'shared'

import { localYear } from '@/lib/local-time'

/**
 * Woher Arbeitspreis und Grundgebühr stammen KÖNNEN — und warum sie für den ausgewerteten Zeitraum
 * womöglich veraltet sind.
 *
 * ── ⚠ WARUM DIE BEDINGUNG AM ZEITRAUM HÄNGT UND NICHT AN EINEM RECHNUNGSDATUM ──────────────────
 * Die naheliegende Bedingung wäre „die Rechnung, aus der die Werte stammen, ist von 2025". Die gibt
 * es nicht: `InvoiceExtraction` (Delta 9b-2) trägt bewusst KEIN Datum und keinen Zeitraum — welche
 * Rechnung der Kunde vor sich hatte, weiss der Rechner nicht. Eine erfundene Herkunftsangabe wäre
 * derselbe Fehler wie ein erfundener Tarifsatz (Prinzip 1).
 *
 * Was der Rechner sehr wohl weiss, ist der ausgewertete Zeitraum. Reicht er in ein Kalenderjahr, das
 * noch läuft, dann kann es für dieses Jahr noch gar keine Jahresrechnung geben — die eingetragenen
 * Preise stammen also zwangsläufig aus einer älteren Abrechnung (oder aus einer Teilbetrags-
 * Vorschreibung). Genau dieser Fall ist gemeint, und nur er löst den Hinweis aus.
 *
 * ── NICHT BEI JEDEM KUNDEN ─────────────────────────────────────────────────────────────────────
 * Wer ein ABGESCHLOSSENES Kalenderjahr auswerten lässt (Lastgang endet im Vorjahr oder früher),
 * bekommt den Hinweis NICHT: für diesen Zeitraum existiert eine Jahresrechnung, und dass er sie
 * benutzt hat, ist der Regelfall. Ein Standardlastprofil (Delta 8) fällt damit ebenfalls heraus —
 * es wird immer für das zuletzt abgeschlossene Kalenderjahr erzeugt.
 *
 * ── DIE GRUNDGEBÜHR WIRD NUR GENANNT, WENN ES SIE GIBT ─────────────────────────────────────────
 * Sie ist optional und steht ohne Angabe auf 0 (Delta 19). Sie mitzunennen, wo gar keine eingetragen
 * wurde, behauptete eine Grundlage, die in der Rechnung überhaupt nicht vorkommt.
 *
 * Dauerhaft sichtbar und OHNE `print:hidden` — auf einem weitergereichten Blatt ist „auf welchem
 * Preisstand beruhen diese Beträge" genau die Frage, die zuerst gestellt wird.
 */
export function TariffVintageNote({
  loadProfile,
  tariff,
  now = new Date(),
}: {
  loadProfile: LoadProfile
  tariff: TariffParams
  /** Stichtag; als Parameter, damit die Aussage gegen ein festes Datum prüfbar bleibt. */
  now?: Date
}) {
  const last = loadProfile.readings[loadProfile.readings.length - 1]
  if (!last) return null

  const periodEndYear = localYear(Date.parse(last.ts), loadProfile.timezoneMeta)
  const currentYear = localYear(now.getTime(), loadProfile.timezoneMeta)
  if (periodEndYear < currentYear) return null

  const hasBaseFee =
    tariff.supplierBaseFeeEurPerMonth != null && tariff.supplierBaseFeeEurPerMonth > 0
  const posten = hasBaseFee ? 'Arbeitspreis und Grundgebühr basieren' : 'Der Arbeitspreis basiert'

  return (
    <p className="text-xs text-text-muted" data-testid="tarif-vintage">
      {posten} auf einer {periodEndYear - 1}er-Vorjahresrechnung — für {periodEndYear} gibt es noch
      keine Jahresabrechnung. Für eine aktuelle Zahl wird die {periodEndYear}er-Jahresrechnung des
      Kunden benötigt.
    </p>
  )
}
