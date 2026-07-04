'use client'

import { RotateCcw } from 'lucide-react'
import type { AnalysisResult } from 'shared'

import { Report } from '@/components/report/report'
import { Button } from '@/components/ui/button'
import type { ParsedLoad } from './types'

export function StepResult({
  result,
  load,
  onRestart,
}: {
  result: AnalysisResult
  load: ParsedLoad
  onRestart: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <h1 className="text-2xl font-semibold text-ink">Ihr Ergebnis</h1>
        <Button variant="outline" size="sm" onClick={onRestart}>
          <RotateCcw className="h-4 w-4" />
          Neue Analyse
        </Button>
      </div>
      <Report result={result} loadProfile={load.profile} />
    </div>
  )
}
