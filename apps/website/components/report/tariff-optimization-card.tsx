import { AlertCircle, LineChart } from 'lucide-react'
import type { BatteryResultEntry, TariffOptimizationStatus, TariffPriceRange } from 'shared'

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { InfoHint } from '@/components/ui/info-hint'
import { formatEur } from '@/lib/format'
import {
  ANNUALIZED_LABEL,
  CONTROLLED_WAY_LABEL,
  loadControlValueOf,
  monthlyBatteryRef,
  vatNote,
} from '@/lib/report-copy'
import { sumCovered } from './monthly-tariff-chart'
import { Num } from './num'

/**
 * Delta 9a — die Ergebniskarte des Tarifoptimierungs-Hebels (Delta 4).
 *
 * ── ENTWEDER EINE ZAHL ODER EINE BEGRÜNDUNG, NIE BEIDES ─────────────────────────────────────────
 * Die Karte hat genau zwei Zustände, und sie schliessen einander aus. Ist der Hebel berechenbar,
 * steht hier die Zahl, die die Engine gerechnet hat. Ist er es nicht, steht hier, WARUM und für
 * WELCHEN Zeitraum — und ausdrücklich KEINE Zahl, auch keine gedämpfte, keine „vorläufige", keine
 * aus dem statischen Fensterschema. Genau davor warnt Delta 15: eine Vergleichszahl aus einer
 * anderen Grundlage fällt niemandem als Fehler auf, sondern als Ergebnis.
 *
 * Ist der Hebel gar nicht angefordert (`status === undefined`), erscheint die Karte NICHT. „Nicht
 * gefragt" ist kein Befund und braucht keine Fläche.
 *
 * ── WORAN DIE PEAK-SHAVING-KARTE UNBERÜHRT BLEIBT ───────────────────────────────────────────────
 * Diese Karte steht NEBEN der Empfehlung, nicht an ihrer Stelle. Ein nicht berechenbarer Hebel
 * nimmt der Spitzenkappung nichts weg — gemessen in B21-3b: die Peak-Shaving-Zahlen sind auf dem
 * nicht berechenbaren Pfad bit-identisch zu einem Lauf ganz ohne Hebel.
 *
 * ── ⚠ DIE KARTE IST DEM MONATSVERGLEICH UNTERGEORDNET (02.09.2026) ─────────────────────────────
 * Sie beantwortet EINE Frage: was die Ladesteuerung INNERHALB von aWATTar wert ist. Sie beantwortet
 * ausdrücklich NICHT, ob sich der Wechsel zu aWATTar rechnet — das tut allein der Monatsvergleich
 * („Das zahlen Sie jetzt vs. mit aWATTar"), der den heutigen Tarif des Kunden gegenüberstellt.
 *
 * Die Verwechslung ist nicht theoretisch: an einem realen Bestandsfall lag „aWATTar mit Speicher"
 * über dem heutigen Tarif, während diese Karte gleichzeitig eine dreistellige Euro-Zahl in Grün
 * zeigte. Beide Zahlen waren richtig — nebeneinander gelesen ergaben sie eine falsche Auskunft.
 * Deshalb steht bei einem solchen Ergebnis eine WARNUNG VOR der Karte, nicht bloss eine andere
 * Beschriftung: eine Nuance in der Überschrift liest niemand, der auf die grüne Zahl sieht.
 *
 * ── EINE ZAHL MIT DEN WEGEN (§3.7-Revision 25.09.2026) ───────────────────────────────────────────
 * Die Zahl ist die Differenz „aWATTar ohne Steuerung" − „aWATTar mit Ladesteuerung" (`loadControlValueOf`),
 * dieselbe wie im PDF-Empfehlungskapitel. Gerechnet gegen die tatsächlichen Marktpreise des
 * Zeitraums — keine Zusage für die Zukunft (Delta 11).
 */

/** Ein Zeitbereich in Ortszeit — der Befund trägt UTC-ISO, ein Leser denkt in seiner Uhr. */
function formatRange(range: TariffPriceRange, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('de-AT', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${fmt.format(Date.parse(range.fromIso))} – ${fmt.format(Date.parse(range.toIso))}`
}

const SIDE_LABEL: Record<'grid_tariff' | 'spot_price' | 'levy', string> = {
  grid_tariff: 'Netzentgelte Ihres Netzbetreibers',
  spot_price: 'Börsen-Strompreise',
  levy: 'gesetzliche Abgaben (Elektrizitätsabgabe, EAG, Gebrauchsabgabe)',
}

/** Was der Nutzer daraus machen kann — je Grund verschieden, und keiner davon ist sein Fehler. */
const KIND_HINT: Record<'gap' | 'unavailable' | 'price_basis', string> = {
  gap: 'Für einen Teil Ihres Zeitraums fehlen uns Preise. Eine Lücke zu überbrücken hiesse, Preise zu erfinden — das tun wir nicht. Wir tragen fehlende Marktpreise laufend nach; ein Lastgang aus einem anderen Zeitraum rechnet in der Regel sofort.',
  unavailable:
    'Wir konnten die Preise für diesen Vergleich nicht abrufen. Häufigster Grund: Netzbetreiber oder Netzebene sind nicht gewählt — ohne beides gibt es keine Netzentgelt-Seite. Sonst fehlt der Preisstand bei uns noch und wird nachgetragen.',
  price_basis:
    'Die vorliegenden Preise sind nicht netto ausgewiesen. Wir rechnen sie nicht um: dafür bräuchte es einen Steuersatz, und einen anzunehmen wäre dieselbe Erfindung wie eine geratene Tarifzahl.',
}

export function TariffOptimizationCard({
  status,
  recommended,
  timeZone,
  isExisting,
}: {
  /** `undefined` = Hebel nicht angefordert; dann rendert die Karte nichts. */
  status: TariffOptimizationStatus | undefined
  /**
   * Der primäre Block des Reports — die bestehende Anlage des Kunden, sonst die Empfehlung.
   * `BatteryResultEntry` statt des `perBattery`-Elementtyps, weil hier ausschliesslich
   * Energie- und Hochrechnungsfelder gelesen werden und keine Investition; nur so kann
   * die Karte im Bestandsfall die Zahl DESSELBEN Geräts zeigen wie der Block darüber.
   */
  recommended: BatteryResultEntry | undefined
  timeZone: string
  /**
   * Fährt der Kunde eine eigene Anlage? Entscheidet allein den WORTLAUT, nicht die Zahlen.
   *
   * ⚠ Seit D7 kann der Monatsvergleich auch aus dem Dispatch der empfohlenen Katalog-Batterie
   * entstehen. „mit Ihrem Speicher" wäre dann eine Aussage über einen Speicher, den der Kunde nicht
   * hat — dieselbe Unterscheidung, die `report.tsx` schon an der Kapp-Linie trifft.
   */
  isExisting: boolean
}) {
  if (!status) return null

  if (!status.computable) {
    return (
      <Card
        className="border-warning print:break-inside-avoid"
        data-testid="tarifoptimierung-blocker"
      >
        <CardHeader>
          <div className="flex items-center gap-2 text-warning">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <h3 className="text-base font-semibold">
              Vergleich mit Börsen-Strompreisen: nicht berechenbar
            </h3>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-text">
            Für diesen Teil zeigen wir bewusst keine Zahl. Betroffen ist die Seite „
            {SIDE_LABEL[status.side]}“.
          </p>
          {status.ranges.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-text-muted">Betroffener Zeitraum</p>
              <ul className="flex flex-col gap-0.5">
                {status.ranges.map((r) => (
                  <li key={`${r.fromIso}-${r.toIso}`}>
                    <Num className="text-text">{formatRange(r, timeZone)}</Num>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-text-muted">{KIND_HINT[status.kind]}</p>
          <p className="border-t border-border pt-3 text-text-muted">
            Ihre Spitzenkappung ist davon <strong>nicht</strong> betroffen — sie hängt am
            Leistungspreis, nicht an den Börsenpreisen. Die Empfehlung nebenan gilt unverändert.
          </p>
        </CardContent>
      </Card>
    )
  }

  /*
   * ── K3b-2: OHNE SPEICHER GIBT ES DIESE KARTE NICHT ──────────────────────────────────────────
   * Sie beziffert, was eine LADESTEUERUNG wert wäre — das ist eine Aussage über ein Gerät. Ohne
   * Kandidaten und ohne Bestandsanlage stünde hier „€ 0 pro Jahr zusätzlich", und eine 0 liest
   * sich als „bringt nichts" statt als „wurde nicht gerechnet". Der Blocker-Zweig darüber bleibt:
   * er erklärt die FEHLENDEN Preisdaten und braucht keinen Speicher.
   */
  if (!recommended) return null

  const value = loadControlValueOf(recommended, status.monthlyComparison)
  const saving = value.annualizedEur ?? value.overCoveredDaysEur

  /*
   * ⚠ DIE SUMMEN KOMMEN AUS DEMSELBEN HELFER WIE DIE LEGENDE DES MONATSCHARTS (`sumCovered`).
   * Sonst könnte diese Karte an anders gebildeten Zahlen warnen, als der Chart daneben ausweist.
   * Fehlt der Monatsvergleich (kein Bestandsspeicher), gibt es diesen Vergleich nicht — dann wird
   * NICHT gewarnt und auch nichts behauptet: „nicht verglichen" ist nicht „günstiger".
   */
  const monthly = status.monthlyComparison
  /* K3b-2: Ohne Speicherreihe gibt es diesen Vergleich nicht — „nicht verglichen" ist wie bisher
     nicht „günstiger", und die Warnung bleibt deshalb aus. */
  const monthlyWithBattery = monthly?.spotWithBatteryEur
  const monthlyCurrent = monthly?.currentTariffEur
  const totals =
    monthly && monthlyWithBattery && monthlyCurrent
      ? {
          current: sumCovered(monthlyCurrent),
          withBattery: sumCovered(monthlyWithBattery),
          months: monthly.coveredMonths,
        }
      : null
  const surcharge = totals ? totals.withBattery - totals.current : 0
  const awattarCostsMore = totals != null && surcharge > 0

  return (
    <div className="flex flex-col gap-3">
      {awattarCostsMore && (
        <div
          className="rounded-lg border border-warning bg-surface p-4 text-sm print:break-inside-avoid"
          data-testid="tarifoptimierung-awattar-teurer"
        >
          <div className="mb-2 flex items-center gap-2 text-warning">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <p className="font-semibold">aWATTar wäre für Sie derzeit teurer als Ihr Tarif heute</p>
          </div>
          <p className="text-text">
            Über die <Num>{totals!.months}</Num> gemessenen Monate:{' '}
            <Num className="font-medium text-ink">{formatEur(totals!.withBattery)}</Num> mit aWATTar
            und {monthlyBatteryRef(isExisting)} gegenüber{' '}
            <Num className="font-medium text-ink">{formatEur(totals!.current)}</Num> mit Ihrem
            heutigen Tarif — also <Num className="font-medium text-ink">{formatEur(surcharge)}</Num>{' '}
            mehr. Alle Beträge {vatNote(status)}.
          </p>
          <p className="mt-2 text-text-muted">
            Die Zahl unten ist deshalb <strong>kein Grund zum Wechseln</strong>: sie sagt, was Ihre
            Ladesteuerung <em>innerhalb</em> von aWATTar wert wäre — nicht, ob sich aWATTar für Sie
            rechnet. Diese Frage beantwortet allein der Monatsvergleich „Das zahlen Sie jetzt vs.
            mit aWATTar".
          </p>
        </div>
      )}
      <Card
        className="border-accent print:break-inside-avoid"
        data-testid="tarifoptimierung-ergebnis"
      >
        <CardHeader>
          <div className="flex items-center gap-2 text-accent">
            <LineChart className="h-4 w-4 shrink-0" />
            <h3 className="text-base font-semibold text-ink">
              Wert der Ladesteuerung unter aWATTar
            </h3>
          </div>
          {/*
          Die Unterordnung steht dauerhaft da, nicht nur im Warnfall: auch wenn aWATTar günstiger
          ist, beantwortet diese Karte die andere Frage — und ein Leser, der sie einmal als
          Tarifvergleich versteht, versteht sie beim nächsten Report wieder so.
        */}
          <p className="mt-1 text-xs text-text-muted">
            {monthly
              ? 'Ersetzt nicht den Vergleich mit Ihrem aktuellen Tarif — der steht im Monatsvergleich darüber.'
              : 'Wert der Ladesteuerung, nicht ein Vergleich mit Ihrem aktuellen Tarif.'}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div>
            <Num
              className={
                saving > 0
                  ? 'block text-3xl font-semibold text-positive'
                  : 'block text-3xl font-semibold text-warning'
              }
            >
              {formatEur(saving)}
            </Num>
            <p className="text-xs text-text-muted">
              {value.annualizedEur === null ? (
                <>
                  über die <Num>{value.coveredDays}</Num> gemessenen Tage ({vatNote(status)})
                </>
              ) : (
                <>
                  pro Jahr, {ANNUALIZED_LABEL} ({vatNote(status)})
                </>
              )}
              {` — dieselbe Zahl wie der Abstand zwischen „aWATTar ohne Steuerung" und „${CONTROLLED_WAY_LABEL}".`}
            </p>
            {value.annualizedEur !== null && (
              <p className="text-xs text-text-muted" data-testid="ladesteuerung-gemessen">
                Über die <Num>{value.coveredDays}</Num> gemessenen Tage:{' '}
                <Num className="font-medium text-text">{formatEur(value.overCoveredDaysEur)}</Num>.
                Die Jahreszahl nimmt an, dass sich die übrigen Tage im Mittel wie die gemessenen
                verhalten.
              </p>
            )}
          </div>
          {/*
          Delta 16a: DIESE Erklärung druckt mit — sie sagt, dass die Zahl keine Zusage ist und dass
          sie in der Gesamtersparnis bereits enthalten ist (Prinzip 2).
        */}
          <InfoHint
            label="Vergleich mit Börsen-Strompreisen"
            printExplanation
            before={
              <p className="text-text">
                Gerechnet auf die tatsächlichen Marktpreise Ihres Zeitraums.
              </p>
            }
          >
            Für jede Viertelstunde Ihres Lastgangs setzen wir den Börsenpreis jener Stunde, das
            Netzentgelt Ihres Netzbetreibers und die Abgaben an, statt eines festen Arbeitspreises.
            Der Speicher lädt nach einem Tagesplan in günstigen Stunden und entlädt in teuren; die
            Zahl ist, was Ihr Strom damit weniger kostet als ohne Steuerung, Ladeverluste
            eingeschlossen. Sie ist <strong>kein Versprechen für die Zukunft</strong>, denn die
            Marktpreise von morgen kennt niemand. Sie ist der Energie-Anteil der Ersparnis dieses
            Speichers — auch was er aus PV-Überschuss aufnimmt, steckt darin — und kommt nicht
            zusätzlich obendrauf.
          </InfoHint>
          {saving <= 0 && (
            <p className="border-t border-border pt-3 text-text-muted">
              In diesem Zeitraum hätte sich aus den Preisunterschieden nichts holen lassen — der
              Speicher war durch die Spitzenkappung gebunden, oder die Preisspanne war kleiner als
              die Ladeverluste. Das ist ein Ergebnis, kein Fehler.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
