'use client'

import { Loader2 } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Num } from '@/components/report/num'
import type { AnalysisStatus } from '@/lib/use-analysis'

export function StepAnalyzing({ progress, status }: { progress: number; status: AnalysisStatus }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-6 py-16 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent motion-reduce:animate-none" />
        <div className="w-full max-w-md">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-ink">Analyse läuft …</span>
            <Num className="text-text-muted">{progress} %</Num>
          </div>
          <Progress value={progress} />
        </div>
        <p className="max-w-md text-sm text-text-muted">
          Die Batterie wird chronologisch über das ganze Jahr simuliert. Das läuft im Hintergrund
          (Web Worker) — der Tab bleibt bedienbar.
        </p>
        {status === 'error' && (
          <p className="text-sm text-negative">
            Es ist ein Fehler aufgetreten. Bitte erneut versuchen.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
