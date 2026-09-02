import { AlertTriangle, Info } from 'lucide-react'
import type {
  AddonBatteryScenario,
  BatteryCandidate,
  BatteryResultEntry,
  BatteryRoiEntry,
} from 'shared'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { formatEur, formatKw, formatKwh1, formatPercent, formatYears } from '@/lib/format'
import { HINDSIGHT_NOTE } from '@/lib/report-copy'
import { Num } from './num'

const classLabel: Record<BatteryCandidate['class'], string> = {
  residential: 'Heimspeicher',
  commercial: 'Gewerbespeicher',
}

function SavingRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between border-t border-border py-2 text-sm">
      <span className="text-text-muted">{label}</span>
      <Num className="font-medium text-positive">{formatEur(value)}</Num>
    </div>
  )
}

function CostRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-text-muted">{label}</span>
      <Num className="text-text">{formatEur(value)}</Num>
    </div>
  )
}

/**
 * Die Ergebniskarte eines Kandidaten.
 *
 * ── ⚠ DREI VARIANTEN, EINE KOMPONENTE — und warum die Props eine Union sind ────────────────────
 * `catalog` (Vorgabe) beantwortet eine KAUFENTSCHEIDUNG: was kostet das Gerät, und ab wann hat es
 * sich bezahlt gemacht. `existing` beschreibt eine Anlage, die der Kunde BEREITS BESITZT — dort
 * sind Investition und Amortisation keine Auskunft, sondern eine Irreführung: die Anschaffung ist
 * bezahlt (Sunk Cost), und eine Amortisationszeit beantwortet eine Frage, die für dieses Gerät
 * niemand mehr stellt. `addon` (01.09.2026) beantwortet die dritte Frage: was brächte ein
 * ZUSÄTZLICHES Gerät neben der bestehenden Anlage — dort sind alle Ersparnis-Zahlen DIFFERENZEN,
 * und das muss auf der Karte stehen, sonst liest sie sich wie eine Bruttozahl.
 *
 * Alle drei zeigen ansonsten DASSELBE — Ersparnis, Aufschlüsselung, Hindsight-Vorbehalt,
 * Warnungen. Eine zweite Komponente wäre eine zweite Stelle, an der dieselbe Aufschlüsselung
 * gepflegt werden müsste.
 *
 * ⚠ Die Props sind eine DISKRIMINIERTE UNION und nicht ein gemeinsamer Typ mit optionalen
 * ROI-Feldern: `BatteryResultEntry` (die bestehende Anlage) trägt gar keine Investition, und das
 * soll das Typsystem durchsetzen statt die Oberfläche. Ein `entry.totalInvestment` im
 * `existing`-Zweig ist damit kein Anzeigefehler, sondern ein Compile-Fehler.
 */
type RecommendationCardProps =
  | {
      entry: BatteryResultEntry
      variant: 'existing'
      primary?: boolean
      /**
       * `true` = der Wirkungsgrad ist die dokumentierte Annahme, weil der Kunde keinen genannt hat
       * (`ASSUMED_EXISTING_ROUND_TRIP_EFFICIENCY`). Die einzige Zahl dieses Blocks, die nicht von
       * ihm stammt — sie als seine Angabe zu zeigen wäre die stille Sorte Unwahrheit, die dieser
       * Bauabschnitt gerade beseitigt.
       */
      efficiencyAssumed?: boolean
    }
  | { entry: AddonBatteryScenario; variant: 'addon'; primary?: boolean }
  | { entry: BatteryRoiEntry; variant?: 'catalog'; primary?: boolean }

export function RecommendationCard(props: RecommendationCardProps) {
  const { entry, primary = false } = props
  const isExisting = props.variant === 'existing'
  // Narrowing über die Union: beide Nicht-`existing`-Zweige tragen die ROI-Felder.
  const roi = props.variant === 'existing' ? null : props.entry
  const addon = props.variant === 'addon' ? props.entry : null
  const efficiencyAssumed = props.variant === 'existing' && props.efficiencyAssumed === true

  const b = entry.battery
  const baseCost = b.usableCapacityKwh * b.pricePerKwh
  const foundation = b.requiresFoundation ? (b.foundationCost ?? 0) : 0
  const inverter = b.inverterIncluded ? 0 : (b.extraInverterCost ?? 0)

  return (
    <Card
      className={primary ? 'border-accent' : undefined}
      data-testid={isExisting ? 'bestandsbatterie' : addon ? 'zusatzspeicher' : undefined}
    >
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          {/*
            Das Abzeichen benennt, WELCHE Frage diese Karte beantwortet — die drei dürfen sich
            nicht vermischen. Kein „Empfehlung" für ein Gerät, das der Kunde schon hat (empfohlen
            wird, was man noch kaufen kann), und keines für ein Zusatzgerät, dessen Zahlen
            Differenzen zur bestehenden Anlage sind.
          */}
          {isExisting ? (
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
              Ihre bestehende Anlage
            </span>
          ) : addon ? (
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
              Zusätzlich zu Ihrem Bestand
            </span>
          ) : (
            primary && (
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                Empfehlung
              </span>
            )
          )}
          <span className="rounded-full bg-surface-alt px-2 py-0.5 text-xs font-medium text-text-muted">
            {classLabel[b.class]}
          </span>
        </div>
        <h3 className="mt-1 text-xl font-semibold text-ink">{b.name}</h3>
        <p className="text-sm text-text-muted">{b.manufacturer}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            {/*
              ⚠ Die Beschriftung sagt im Zusatzfall AUSDRÜCKLICH, dass es eine Differenz ist. Ohne
              sie stünde dieselbe Zahlengrösse wie auf einer Katalog-Karte, meinte aber etwas
              anderes — und der Leser addierte sie zur Ersparnis seiner bestehenden Anlage.
            */}
            <p className="text-xs uppercase tracking-wide text-text-muted">
              {addon ? 'Zusätzliche Ersparnis / Jahr' : 'Ersparnis / Jahr'}
            </p>
            <Num className="text-2xl font-semibold text-positive">
              {formatEur(entry.totalSavingPerYear)}
            </Num>
            {/*
              Gerechnet wird durchgängig netto (Delta 6). Der Hinweis steht an der grossen Zahl und
              nicht nur im Methodik-Abschnitt: sie ist der Betrag, den ein Kunde mit seiner Rechnung
              vergleicht — und die trägt Umsatzsteuer.
            */}
            <p className="text-xs text-text-muted">exkl. MwSt.</p>
          </div>
          {/*
            Amortisation, wo es eine Anschaffung gibt. Für ein bereits installiertes Gerät stünde
            hier eine Zahl, die die Anschaffung erneut in die Zukunft rechnet — sie ist längst
            bezahlt. Im Zusatzfall bezieht sie sich auf den Preis des NEUEN Geräts und die
            zusätzliche Ersparnis (`calculateRoi(addon, …)`, s. Worker).
          */}
          {roi && (
            <div>
              <p className="text-xs uppercase tracking-wide text-text-muted">Amortisation</p>
              <Num className="text-2xl font-semibold text-ink">
                {formatYears(roi.amortizationYears)}
              </Num>
            </div>
          )}
        </div>

        <div>
          <p className="mb-1 text-sm font-medium text-ink">
            {addon ? 'Zusätzliche Ersparnis aufgeschlüsselt' : 'Ersparnis aufgeschlüsselt'}
          </p>
          {/*
            ⚠ Der Satz, ohne den die drei Zeilen darunter falsch gelesen werden. Simuliert wurde
            der KOMBINIERTE Speicher (Bestand + dieses Gerät); ausgewiesen ist die Differenz zur
            bestehenden Anlage allein. Er nennt zugleich die resultierende Gesamtgrösse — sonst
            bleibt offen, worauf sich „zusätzlich" bezieht.
          */}
          {addon && (
            <p className="mb-2 text-xs text-text-muted">
              Gerechnet als ein gemeinsamer Speicher aus Ihrer Anlage und diesem Gerät (
              <Num>{formatKwh1(addon.combined.usableCapacityKwh)}</Num> /{' '}
              <Num>{formatKw(addon.combined.maxPowerKw)}</Num>). Alle Zahlen hier sind das, was{' '}
              <strong>über Ihre bestehende Anlage hinaus</strong> herauskommt — nicht die Ersparnis
              des gemeinsamen Speichers.
            </p>
          )}
          <SavingRow
            label="Spitzenkappung (Leistungspreis)"
            value={entry.leistungspreisSavingPerYear}
          />
          <SavingRow label="Eigenverbrauch" value={entry.selfConsumptionSavingPerYear} />
          <SavingRow label="Tarifbewusstes Laden" value={entry.loadShiftSavingPerYear} />
          <div className="flex items-center justify-between border-t-2 border-border py-2 text-sm font-semibold">
            <span className="text-ink">Gesamt</span>
            <Num className="text-positive">{formatEur(entry.totalSavingPerYear)}</Num>
          </div>
          {/* Hindsight-Hinweis Pflicht (§6.2): Eigenverbrauch/Lastverschiebung mit vollem Rückblick.
              Wortlaut seit Delta 16a aus `lib/report-copy.ts` — der Methodik-Abschnitt des
              Druck-Reports trägt DIESELBE Aussage und darf nicht davon abweichen. Gerendert
              unverändert; am Bildschirm ist der Satz bit-gleich zu vorher. */}
          <p className="mt-2 flex items-start gap-1.5 text-xs text-text-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {HINDSIGHT_NOTE}
          </p>
          {/*
            ── Jahres-Hochrechnung der beiden ENERGIE-Zeilen (§3.7) ─────────────────────────────
            Steht bewusst HIER, unmittelbar unter den beiden betroffenen Zeilen, und nicht als
            Fussnote am Seitenende: die Zahlen darüber tragen das Etikett „pro Jahr", obwohl der
            Lastgang weniger als ein Jahr abdeckt — wer sie liest, muss im selben Blick sehen, was
            gemessen und was angenommen ist. Der gemessene Rohwert steht deshalb im Klartext daneben
            und nicht bloss in der CSV.

            Die Spitzenkappungs-Zeile darüber ist ausdrücklich NICHT betroffen (ratenbasiert,
            €/kW·Jahr) — das zu sagen ist Teil der Auskunft, sonst überträgt der Leser den Vorbehalt
            auf die ganze Aufschlüsselung.

            Sichtbar am Bildschirm UND im Druck: auf einem weitergereichten Blatt ist die Frage
            „worauf beruht die Jahreszahl?" die erste, die jemand stellt.
          */}
          {entry.annualizationFactor > 1 && (
            <div
              className="mt-2 rounded-md bg-surface-alt p-3 text-xs text-text-muted print:break-inside-avoid"
              data-testid="hochrechnung-hinweis"
            >
              <strong className="text-ink">
                Eigenverbrauch und tarifbewusstes Laden sind auf ein Jahr hochgerechnet.
              </strong>{' '}
              Ihr Lastgang deckt <Num>{entry.coveredDays}</Num> von 365 Tagen ab. Gemessen wurden in
              diesem Zeitraum{' '}
              <Num className="font-medium text-text">
                {formatEur(entry.selfConsumptionSavingOverCoveredPeriod)}
              </Num>{' '}
              Eigenverbrauch und{' '}
              <Num className="font-medium text-text">
                {formatEur(entry.loadShiftSavingOverCoveredPeriod)}
              </Num>{' '}
              tarifbewusstes Laden. Für die Jahreszahlen oben nehmen wir an, dass sich die übrigen{' '}
              <Num>{365 - entry.coveredDays}</Num> Tage im Mittel wie die gemessenen verhalten — bei
              einem reinen Sommer- oder Winterzeitraum ist das eher zu optimistisch bzw. zu
              vorsichtig. <strong className="text-ink">Die Spitzenkappung ist nicht betroffen</strong>
              : sie hängt am Leistungspreis (€ je kW und Jahr) und ist bereits eine Jahresgrösse.
            </div>
          )}
        </div>

        {isExisting ? (
          <div className="flex flex-col gap-3">
            {/*
              ⚠ DIE WERTE DES KUNDEN, SICHTBAR. Sie stehen sonst nirgends auf dieser Karte: der
              Investitionsblock, der Kapazität und Leistung sonst nennt, entfällt hier gerade. Ohne
              diese Zeile wüsste der Kunde nicht, womit gerechnet wurde — und das ist genau die
              Frage, die der frühere Katalog-Ersatz aufgeworfen hat.
            */}
            <div data-testid="bestandsbatterie-werte">
              <p className="mb-1 text-sm font-medium text-ink">Gerechnet mit Ihren Werten</p>
              <div className="flex items-center justify-between border-t border-border py-1 text-sm">
                <span className="text-text-muted">Nutzbare Kapazität</span>
                <Num className="text-text">{formatKwh1(b.usableCapacityKwh)}</Num>
              </div>
              <div className="flex items-center justify-between border-t border-border py-1 text-sm">
                <span className="text-text-muted">Lade-/Entladeleistung</span>
                <Num className="text-text">{formatKw(b.maxPowerKw)}</Num>
              </div>
              <div className="flex items-center justify-between border-t border-border py-1 text-sm">
                <span className="text-text-muted">
                  Wirkungsgrad{efficiencyAssumed && ' (angenommen)'}
                </span>
                <Num className="text-text">{formatPercent(b.roundTripEfficiency * 100)}</Num>
              </div>
              {efficiencyAssumed && (
                <p className="mt-1 text-xs text-text-muted">
                  Ihre Angabe nennt keinen Wirkungsgrad — wir rechnen mit einem branchenüblichen
                  Wert. Kapazität und Leistung sind Ihre eigenen Angaben.
                </p>
              )}
            </div>
            <div className="rounded-md bg-surface-alt p-3">
              <p className="text-sm text-text-muted">
                <strong className="text-ink">Keine Investition, keine Amortisation.</strong> Dieser
                Speicher steht bereits bei Ihnen — die Anschaffung ist bezahlt, und eine
                Amortisationszeit beantwortet eine Kaufentscheidung, die längst gefallen ist. Was
                oben steht, ist allein das, was die Anlage in diesem Zeitraum eingespart hätte. Ob
                sich zusätzlich ein neues Gerät lohnt, steht im Vergleich darunter.
              </p>
            </div>
          </div>
        ) : (
          roi && (
          <div>
            <p className="mb-1 text-sm font-medium text-ink">
              {addon ? 'Investition (nur das Zusatzgerät)' : 'Investition'}
            </p>
            <CostRow
              label={`Speicher (${formatKw(b.maxPowerKw)} / ${formatKwh1(b.usableCapacityKwh)})`}
              value={baseCost}
            />
            {foundation > 0 && <CostRow label="Betonsockel" value={foundation} />}
            {inverter > 0 && <CostRow label="Separater Wechselrichter" value={inverter} />}
            <div className="flex items-center justify-between border-t border-border py-2 text-sm font-semibold">
              <span className="text-ink">Gesamtinvestition</span>
              <Num className="text-ink">{formatEur(roi.totalInvestment)}</Num>
            </div>
            {!roi.taxEffectsIncluded && (
              <p className="mt-1 text-xs text-text-muted">
                Förderung &amp; Steuervorteil: keine Angabe (nicht in die Rechnung einbezogen).
              </p>
            )}
            {/*
              Bei einem Zusatzgerät ist die Abgrenzung die halbe Aussage: bezahlt wird ausschliesslich
              das neue Gerät, die bestehende Anlage steckt in keiner dieser Zahlen.
            */}
            {addon && (
              <p className="mt-1 text-xs text-text-muted">
                Nur dieses Gerät — Ihre bestehende Anlage ist bezahlt und geht in keine dieser
                Zahlen ein.
              </p>
            )}
          </div>
          )
        )}

        {entry.warnings.length > 0 && (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-4">
                {entry.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
