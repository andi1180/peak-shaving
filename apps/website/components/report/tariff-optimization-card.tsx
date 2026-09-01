import { AlertCircle, LineChart } from 'lucide-react'
import type { AnalysisResult, TariffOptimizationStatus, TariffPriceRange } from 'shared'

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { InfoHint } from '@/components/ui/info-hint'
import { formatEur } from '@/lib/format'
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
 * ── RÜCKBLICKEND FORMULIERT, NICHT ALS ZUSAGE (Delta 11) ────────────────────────────────────────
 * Gerechnet wird gegen die tatsächlichen Marktpreise des hochgeladenen Zeitraums. Das ist ein
 * Rückblick („wäre möglich gewesen"), keine Prognose — und die Sprache dieser Karte hält das
 * durch. Wer sie umformuliert, prüft das bitte Satz für Satz nach.
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

const SIDE_LABEL: Record<'grid_tariff' | 'spot_price', string> = {
  grid_tariff: 'Netzentgelte Ihres Netzbetreibers',
  spot_price: 'Börsen-Strompreise',
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
}: {
  /** `undefined` = Hebel nicht angefordert; dann rendert die Karte nichts. */
  status: TariffOptimizationStatus | undefined
  /** Die angezeigte Empfehlung — sie trägt die gerechnete Zahl (`loadShiftSavingPerYear`). */
  recommended: AnalysisResult['perBattery'][number] | undefined
  timeZone: string
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

  const saving = recommended?.loadShiftSavingPerYear ?? 0

  return (
    <Card
      className="border-accent print:break-inside-avoid"
      data-testid="tarifoptimierung-ergebnis"
    >
      <CardHeader>
        <div className="flex items-center gap-2 text-accent">
          <LineChart className="h-4 w-4 shrink-0" />
          <h3 className="text-base font-semibold text-ink">Vergleich mit Börsen-Strompreisen</h3>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div>
          <Num className="block text-3xl font-semibold text-positive">{formatEur(saving)}</Num>
          <p className="text-xs text-text-muted">
            pro Jahr zusätzlich — durch Laden in günstigen und Entladen in teuren Viertelstunden
          </p>
          {/*
            §3.7-Jahres-Hochrechnung: diese Zahl IST `loadShiftSavingPerYear`, also bei einem
            Teilzeitraum-Lastgang eine hochgerechnete Grösse. Sie steht hier gross und mit dem
            Etikett „pro Jahr" — der Vorbehalt gehört deshalb an dieselbe Stelle und nicht nur in
            die Ersparnis-Aufschlüsselung nebenan, sonst trägt derselbe Wert im selben Report
            einmal einen Vorbehalt und einmal nicht.
          */}
          {recommended != null && recommended.annualizationFactor > 1 && (
            <p className="text-xs text-text-muted">
              Hochgerechnet aus <Num>{recommended.coveredDays}</Num> abgedeckten Tagen — gemessen
              wurden in diesem Zeitraum{' '}
              <Num className="font-medium text-text">
                {formatEur(recommended.loadShiftSavingOverCoveredPeriod)}
              </Num>
              .
            </p>
          )}
        </div>
        {/*
          Delta 16a / CLAUDE.md Punkt (d): DIESE Erklärung druckt mit — als einzige im Report.
          Sie trägt zwei Aussagen, die auf einem weitergereichten Blatt nicht fehlen dürfen: dass
          die Zahl ein RÜCKBLICK ist und keine Zusage (Delta 11), und dass sie in der
          Gesamtersparnis bereits enthalten ist und nicht obendrauf kommt (Prinzip 2). Ohne sie
          stünde im PDF eine grosse Euro-Zahl ohne beides.
        */}
        <InfoHint
          label="Vergleich mit Börsen-Strompreisen"
          printExplanation
          before={
            <p className="text-text">
              Rückblickend gerechnet auf die tatsächlichen Marktpreise Ihres Zeitraums.
            </p>
          }
        >
          Für jede Viertelstunde Ihres Lastgangs setzen wir den echten Börsenpreis jener Stunde plus
          das Netzentgelt Ihres Netzbetreibers an, statt eines festen Arbeitspreises. Die Zahl sagt
          also: <strong>so viel wäre in diesem Zeitraum möglich gewesen</strong> — sie ist kein
          Versprechen für die Zukunft, denn die Marktpreise von morgen kennt niemand. Sie steckt
          bereits in der Gesamtersparnis der Empfehlung (als „Lastverschiebung") und kommt nicht
          zusätzlich obendrauf.
        </InfoHint>
        {saving <= 0 && (
          <p className="border-t border-border pt-3 text-text-muted">
            In diesem Zeitraum hätte sich aus den Preisunterschieden nichts holen lassen — der
            Speicher war durch die Spitzenkappung gebunden, oder die Preisspanne war zu klein. Das
            ist ein Ergebnis, kein Fehler.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
