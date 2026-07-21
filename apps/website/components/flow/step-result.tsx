'use client'

import { useState } from 'react'
import { Download, FileJson, Printer, RotateCcw } from 'lucide-react'
import { buildTariffSourceRef, type AnalysisResult, type TariffSourceRef } from 'shared'

import { Report } from '@/components/report/report'
import { Button } from '@/components/ui/button'
import { buildBundle, bundleFileName, serializeBundle } from '@/lib/bundle-export'
import { buildPerBatteryCsv, downloadTextFile } from '@/lib/csv-export'
import type { AnalysisRunInputs } from '@/lib/use-analysis'
import type { CalculatorPayload, ParsedLoad, RecomputeInput } from './types'

export function StepResult({
  result,
  inputs,
  load,
  payload,
  recomputing,
  recomputeError,
  isLive,
  onRecompute,
  onResetAssumptions,
  onRestart,
}: {
  result: AnalysisResult
  /**
   * B14-2: die Eingangsgrössen GENAU dieses Ergebnisses (§6.2-Neuberechnung eingeschlossen).
   * `null`, solange sie noch nicht feststehen — dann ist kein Bündel möglich.
   */
  inputs: AnalysisRunInputs | null
  load: ParsedLoad
  payload: CalculatorPayload
  recomputing: boolean
  recomputeError: string | null
  isLive: boolean
  onRecompute: (input: RecomputeInput) => void
  onResetAssumptions: () => void
  onRestart: () => void
}) {
  const [bundleError, setBundleError] = useState<string | null>(null)

  /*
   * B11 — die Herkunft der Tarifsätze zum ANGEZEIGTEN Lauf. EINE Ableitung, zwei Abnehmer: der
   * Report zeigt sie, das Bündel speichert sie. Zwei getrennte Ableitungen liefen auseinander,
   * sobald das Annahmen-Panel (§6.2) das Abrechnungsmodell ändert — dann stünde im Report „unverändert
   * übernommen" und im Archiv etwas anderes.
   *
   * Massgeblich sind die Werte des angezeigten Laufs (`inputs.tariff`), nicht die aus Schritt 2: eine
   * Live-Neuberechnung kann `billingModel` nachträglich vom Vorgabewert wegbewegen. `inputs` ist nur
   * theoretisch `null` (der Hook füllt es im selben Schritt, in dem das Ergebnis entsteht) — dann
   * bleibt der Formularstand von Schritt 2 die beste verfügbare Aussage.
   */
  const activeTariff = inputs?.tariff ?? payload.tariff
  const tariffSource: TariffSourceRef | null = payload.tariffSelection
    ? buildTariffSourceRef(payload.tariffSelection, {
        leistungspreisEurPerKwYear: activeTariff.leistungspreisEurPerKwYear,
        billingModel: activeTariff.billingModel,
        minBillableKw: activeTariff.minBillableKw,
      })
    : null

  function handleExportCsv() {
    const csv = buildPerBatteryCsv(result.perBattery, result.assumptions.horizonYears)
    downloadTextFile('peak-shaving-ergebnis.csv', csv, 'text/csv;charset=utf-8')
  }

  /*
   * B14-2 — das Analyse-Bündel (§6.2). Rein im Browser erzeugt, kein Netzwerkaufruf; die
   * Verbrauchsdaten verlassen den Browser weiterhin nicht (Prinzip 4).
   *
   * Die Prüfsumme entsteht über die TATSÄCHLICH verarbeitete Ursprungsdatei. Liegt sie nicht mehr
   * vor, wird KEIN Bündel erzeugt und die Oberfläche sagt das: ein Bündel mit einer Prüfsumme, die
   * nichts bindet, liesse sich archivieren und hinge dann an irgendeiner Datei.
   */
  async function handleExportBundle() {
    setBundleError(null)
    if (!inputs) {
      setBundleError(
        'Die Eingangsgrössen dieses Ergebnisses stehen noch nicht fest. Bitte warten Sie, bis die ' +
          'Neuberechnung abgeschlossen ist.',
      )
      return
    }
    try {
      const bundle = await buildBundle({ result, inputs, load, pv: payload.pv, tariffSource })
      downloadTextFile(
        bundleFileName(bundle),
        serializeBundle(bundle),
        'application/json;charset=utf-8',
      )
    } catch (err) {
      setBundleError(err instanceof Error ? err.message : 'Das Bündel konnte nicht erzeugt werden.')
    }
  }

  const bundleBlocked = !load.sourceBytes

  return (
    <div className="flex flex-col gap-4">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <h1 className="text-2xl font-semibold text-ink">Ihr Ergebnis</h1>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={handleExportCsv}>
            <Download className="h-4 w-4" />
            Als CSV exportieren
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Als PDF speichern
          </Button>
          {/*
           * Bewusst unauffällig (ghost) und als letzter der drei Ausgabewege: PDF und CSV sind für
           * den Kunden, das Bündel ist für das Archiv. Es steht trotzdem hier und nicht hinter einer
           * Zugangshürde — es entsteht eine lokale Datei, kein Datenabfluss.
           */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleExportBundle()}
            disabled={bundleBlocked || recomputing}
            title={
              bundleBlocked
                ? 'Die Ursprungsdatei liegt nicht mehr vor — ohne sie bindet die Prüfsumme nichts.'
                : undefined
            }
          >
            <FileJson className="h-4 w-4" />
            Analyse-Bündel (JSON)
          </Button>
          <Button variant="outline" size="sm" onClick={onRestart}>
            <RotateCcw className="h-4 w-4" />
            Neue Analyse
          </Button>
        </div>
      </div>

      {(bundleError || bundleBlocked) && (
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 print:hidden">
          <p role="alert" className="text-sm text-negative">
            {bundleError ??
              'Ein Analyse-Bündel ist für diesen Lauf nicht möglich: die Ursprungsdatei liegt nicht ' +
                'mehr vor. Ohne sie liesse sich keine Prüfsumme rechnen — und ein Bündel ohne ' +
                'Prüfsumme bindet die Analyse an keine Datei. Bitte laden Sie den Lastgang erneut hoch.'}
          </p>
        </div>
      )}

      <Report
        result={result}
        loadProfile={load.profile}
        tariffSource={tariffSource}
        originalTariff={payload.tariff}
        originalFinancial={payload.financial}
        recomputing={recomputing}
        recomputeError={recomputeError}
        isLive={isLive}
        onRecompute={onRecompute}
        onResetAssumptions={onResetAssumptions}
      />
    </div>
  )
}
