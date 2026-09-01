import { AlertTriangle, Info } from 'lucide-react'
import type { AnalysisResult } from 'shared'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { formatEur, formatKw, formatYears } from '@/lib/format'
import { HINDSIGHT_NOTE } from '@/lib/report-copy'
import { Num } from './num'

type Entry = AnalysisResult['perBattery'][number]

const classLabel: Record<Entry['battery']['class'], string> = {
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
 * ── ⚠ ZWEI VARIANTEN, EINE KOMPONENTE — und warum kein zweiter Komponentenname ────────────────
 * `catalog` (Vorgabe) beantwortet eine KAUFENTSCHEIDUNG: was kostet das Gerät, und ab wann hat es
 * sich bezahlt gemacht. `existing` beschreibt eine Anlage, die der Kunde BEREITS BESITZT — dort
 * sind Investition und Amortisation keine Auskunft, sondern eine Irreführung: die Anschaffung ist
 * bezahlt (Sunk Cost), und eine Amortisationszeit beantwortet eine Frage, die für dieses Gerät
 * niemand mehr stellt.
 *
 * Beide zeigen ansonsten DASSELBE — Ersparnis, Aufschlüsselung, Hindsight-Vorbehalt, Warnungen —
 * und zwar aus derselben `perBattery`-Zeile derselben EINEN Rechnung (Prinzip 2). Eine zweite
 * Komponente wäre eine zweite Stelle, an der dieselbe Aufschlüsselung gepflegt werden müsste;
 * abweichen dürfen genau zwei Blöcke, und das sagt eine Prop deutlicher als ein Dateiname.
 */
export function RecommendationCard({
  entry,
  primary = false,
  variant = 'catalog',
}: {
  entry: Entry
  primary?: boolean
  /** `existing` = die bestehende Anlage des Kunden: ohne Investition, ohne Amortisation. */
  variant?: 'catalog' | 'existing'
}) {
  const b = entry.battery
  const isExisting = variant === 'existing'
  const baseCost = b.usableCapacityKwh * b.pricePerKwh
  const foundation = b.requiresFoundation ? (b.foundationCost ?? 0) : 0
  const inverter = b.inverterIncluded ? 0 : (b.extraInverterCost ?? 0)

  return (
    <Card
      className={primary ? 'border-accent' : undefined}
      data-testid={isExisting ? 'bestandsbatterie' : undefined}
    >
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          {/*
            Kein „Empfehlung"-Abzeichen für ein Gerät, das der Kunde schon hat — empfohlen wird,
            was man noch kaufen kann. Das Abzeichen benennt stattdessen, WESSEN Anlage hier steht:
            unter der Karte folgt der Neuanschaffungs-Vergleich, und die beiden dürfen sich nicht
            vermischen.
          */}
          {isExisting ? (
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
              Ihre bestehende Anlage
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
            <p className="text-xs uppercase tracking-wide text-text-muted">Ersparnis / Jahr</p>
            <Num className="text-2xl font-semibold text-positive">
              {formatEur(entry.totalSavingPerYear)}
            </Num>
          </div>
          {/*
            Amortisation NUR im Katalog-Fall. Für ein bereits installiertes Gerät stünde hier eine
            Zahl, die die Anschaffung erneut in die Zukunft rechnet — sie ist längst bezahlt.
          */}
          {!isExisting && (
            <div>
              <p className="text-xs uppercase tracking-wide text-text-muted">Amortisation</p>
              <Num className="text-2xl font-semibold text-ink">
                {formatYears(entry.amortizationYears)}
              </Num>
            </div>
          )}
        </div>

        <div>
          <p className="mb-1 text-sm font-medium text-ink">Ersparnis aufgeschlüsselt</p>
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
        </div>

        {isExisting ? (
          <div className="rounded-md bg-surface-alt p-3">
            <p className="text-sm text-text-muted">
              <strong className="text-ink">Keine Investition, keine Amortisation.</strong> Dieser
              Speicher steht bereits bei Ihnen — die Anschaffung ist bezahlt, und eine
              Amortisationszeit beantwortet eine Kaufentscheidung, die längst gefallen ist. Was oben
              steht, ist allein das, was die Anlage in diesem Zeitraum eingespart hätte. Ob sich
              zusätzlich ein neues Gerät lohnt, steht im Vergleich darunter.
            </p>
          </div>
        ) : (
          <div>
            <p className="mb-1 text-sm font-medium text-ink">Investition</p>
            <CostRow
              label={`Speicher (${formatKw(b.maxPowerKw)} / ${b.usableCapacityKwh} kWh)`}
              value={baseCost}
            />
            {foundation > 0 && <CostRow label="Betonsockel" value={foundation} />}
            {inverter > 0 && <CostRow label="Separater Wechselrichter" value={inverter} />}
            <div className="flex items-center justify-between border-t border-border py-2 text-sm font-semibold">
              <span className="text-ink">Gesamtinvestition</span>
              <Num className="text-ink">{formatEur(entry.totalInvestment)}</Num>
            </div>
            {!entry.taxEffectsIncluded && (
              <p className="mt-1 text-xs text-text-muted">
                Förderung &amp; Steuervorteil: keine Angabe (nicht in die Rechnung einbezogen).
              </p>
            )}
          </div>
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
