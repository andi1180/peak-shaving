'use client'

import { Download, Printer, RotateCcw } from 'lucide-react'
import type { AnalysisResult } from 'shared'

import { Report } from '@/components/report/report'
import { Button } from '@/components/ui/button'
import { buildPerBatteryCsv, downloadTextFile } from '@/lib/csv-export'
import type { CalculatorPayload, ParsedLoad, RecomputeInput } from './types'

export function StepResult({
  result,
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
  load: ParsedLoad
  payload: CalculatorPayload
  recomputing: boolean
  recomputeError: string | null
  isLive: boolean
  onRecompute: (input: RecomputeInput) => void
  onResetAssumptions: () => void
  onRestart: () => void
}) {
  function handleExportCsv() {
    const csv = buildPerBatteryCsv(result.perBattery, result.assumptions.horizonYears)
    downloadTextFile('peak-shaving-ergebnis.csv', csv, 'text/csv;charset=utf-8')
  }

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
          <Button variant="outline" size="sm" onClick={onRestart}>
            <RotateCcw className="h-4 w-4" />
            Neue Analyse
          </Button>
        </div>
      </div>
      <Report
        result={result}
        loadProfile={load.profile}
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
