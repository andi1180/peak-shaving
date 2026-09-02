import { AlertCircle } from 'lucide-react'
import { PV_TEN_YEAR_SMOOTHING_OPTIMISM_PERCENT, type EstimatedPvSummary } from 'shared'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { formatKwh, formatKwp, formatPercent } from '@/lib/format'
import { Num } from './num'

/**
 * B22b — der Report-Hinweis zur GESCHÄTZTEN PV-Erzeugung (Pflichtenheft §2.2 Punkt 1).
 *
 * ── ⚠ WARUM ER OBEN STEHT UND NICHT IN EINER AUFKLAPPLISTE ────────────────────────────────────
 * Dieselbe Stelle und derselbe Grund wie der Standardprofil-Hinweis (Delta 9b-1) und die
 * Teiljahres-Warnung: er QUALIFIZIERT die Zahlen, die unmittelbar darüber und darunter stehen.
 * Ein Vorbehalt, den niemand sieht, schützt niemanden — und dieser hier betrifft die
 * Eigenverbrauchs-Ersparnis, also genau die Zahl, wegen der der Kunde diesen Weg gegangen ist.
 *
 * Sichtbar am Bildschirm UND im Druck: auf einem weitergereichten Blatt ist die Herkunft der
 * Zahlen die wichtigste Angabe überhaupt.
 *
 * ── ⚠ ER NENNT ZWEI UNSICHERHEITEN, NICHT EINE ────────────────────────────────────────────────
 * 1. **Die Jahresstreuung** (± x %): die zehn Wetterjahre unterscheiden sich, und die Spanne wird
 *    aus der ECHTEN PVGIS-Antwort DIESER Anlage gerechnet — nicht aus einer Konstanten. Die in der
 *    Bestandsaufnahme dokumentierten ± 5,8 % gehören zu EINER Konfiguration; eine andere Auslegung
 *    an einem anderen Standort streut anders.
 * 2. **Die Glättung des Mittels** (rund +5 %): ein Zehn-Jahres-Mittel ist glatter als jedes
 *    einzelne Jahr, und eine geglättete Erzeugung sättigt Speicher und Verbrauch seltener. Gemessen
 *    liegt die Eigenverbrauchs-Ersparnis dadurch über der jedes einzelnen Wetterjahres — die
 *    Schätzung ist also systematisch leicht OPTIMISTISCH, ÜBER die Streuung hinaus. Das Pflichtenheft
 *    nennt diesen Befund ausdrücklich als in B22b zu ergänzen (§4.2); ohne ihn läse sich das „±"
 *    wie eine symmetrische Unsicherheit, und das ist es nicht.
 *
 * ── WAS ER NICHT TUT ──────────────────────────────────────────────────────────────────────────
 * Er erklärt NICHT, warum die Spitzenkappung entfällt — das sagt der Engine-Warnsatz zum Blocker
 * `estimated_pv` an der Ersparnis-Aufschlüsselung selbst (`savings/attribute.ts`), also dort, wo
 * die € 0 steht. Beide Sätze nebeneinander wären zwei Orte für dieselbe Aussage, und beim nächsten
 * Umbau liefen sie auseinander.
 */
export function EstimatedPvNote({ summary }: { summary: EstimatedPvSummary }) {
  const spread = summary.spread
  return (
    <Alert className="print:break-inside-avoid" data-testid="estimated-pv-note">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>PV-Erzeugung geschätzt — nicht gemessen</AlertTitle>
      <AlertDescription>
        <p className="text-text">
          Die Eigenverbrauchs-Ersparnis in diesem Report beruht auf einer{' '}
          <strong>geschätzten Erzeugungskurve</strong>. Sie stammt nicht aus Ihrer Anlage, sondern
          aus dem <strong>Mittel der Wetterjahre</strong>{' '}
          <Num>
            {summary.weatherYears.from}–{summary.weatherYears.to}
          </Num>{' '}
          des EU-Dienstes <strong>PVGIS</strong> für{' '}
          <Num>{formatKwp(summary.totalPeakPowerKwp)}</Num> am Standort{' '}
          <Num>{summary.postalCode}</Num> {summary.locationName}
          {summary.arrayCount > 1 ? `, aufgeteilt auf ${summary.arrayCount} Modulflächen` : ''} — und
          wurde von Ihrem Verbrauch abgezogen.
        </p>
        <p className="mt-3 text-text">
          <strong>Wie genau das ist:</strong>{' '}
          {spread ? (
            <>
              Die zehn Wetterjahre liegen zwischen <Num>{formatKwh(spread.minKwh)}</Num> und{' '}
              <Num>{formatKwh(spread.maxKwh)}</Num> im Jahr, im Mittel{' '}
              <Num>{formatKwh(spread.meanKwh)}</Num> — also{' '}
              <strong>
                ± <Num>{formatPercent(spread.spreadPercent)}</Num>
              </strong>{' '}
              allein durch das Wetter.
            </>
          ) : (
            <>Die Streuung zwischen den Wetterjahren liegt in der Grössenordnung einiger Prozent.</>
          )}{' '}
          Dazu kommt ein <strong>systematischer Aufschlag</strong>: ein Mehrjahres-Mittel ist
          glatter als jedes einzelne Jahr, und eine glattere Erzeugung wird seltener eingespeist.
          Gemessen fällt die Eigenverbrauchs-Ersparnis dadurch rund{' '}
          <Num>{formatPercent(PV_TEN_YEAR_SMOOTHING_OPTIMISM_PERCENT)}</Num> höher aus
          als beim Mittel der einzeln gerechneten Jahre —{' '}
          <strong>die Schätzung ist also eher etwas zu optimistisch als zu vorsichtig.</strong>
        </p>
        <p className="mt-3 text-text">
          Weil damit auch jede Lastspitze zur Hälfte geschätzt ist, weist der Report{' '}
          <strong>keine Leistungspreis-Ersparnis</strong> aus.{' '}
          <strong>
            Für eine gemessene Aussage: Lastgang mit Einspeisung beim Netzbetreiber anfordern
            (Viertelstundenwerte, Bezug und Einspeisung).
          </strong>
        </p>
      </AlertDescription>
    </Alert>
  )
}
