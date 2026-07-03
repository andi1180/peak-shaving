'use client'

import { useState } from 'react'
import { AlertTriangle, ArrowRight, ShieldCheck, XCircle } from 'lucide-react'
import { parseLoadProfile } from 'engine'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FileDrop } from './file-drop'
import type { ParsedLoad } from './types'

type Issue = { kind: 'needs_mapping' | 'error'; message: string }

async function readForParsing(
  file: File,
): Promise<{ content: string | ArrayBuffer; fileName: string; format: 'csv' | 'xlsx' }> {
  const isXlsx = /\.(xlsx|xls)$/i.test(file.name)
  const content = isXlsx ? await file.arrayBuffer() : await file.text()
  return { content, fileName: file.name, format: isXlsx ? 'xlsx' : 'csv' }
}

export function StepUpload({
  initialLoad,
  onComplete,
}: {
  initialLoad: ParsedLoad | null
  onComplete: (load: ParsedLoad) => void
}) {
  const [fileName, setFileName] = useState<string | null>(initialLoad?.fileName ?? null)
  const [load, setLoad] = useState<ParsedLoad | null>(initialLoad)
  const [issue, setIssue] = useState<Issue | null>(null)

  async function handleFile(file: File) {
    setFileName(file.name)
    setLoad(null)
    setIssue(null)

    const input = await readForParsing(file)
    const outcome = parseLoadProfile(input)

    if (outcome.ok) {
      setLoad({ fileName: file.name, profile: outcome.profile, dataQuality: outcome.dataQuality })
      return
    }
    if (outcome.kind === 'needs_mapping') {
      // Voller Mapping-Bestätigungsdialog (§3.2) ist NICHT Teil dieses Prompts — siehe
      // CLAUDE.md-Status. Hier vorerst nur die erkannten Probleme als einfache Meldung.
      setIssue({
        kind: 'needs_mapping',
        message: outcome.issues.map((i) => i.message).join(' '),
      })
      return
    }
    setIssue({ kind: 'error', message: outcome.error.message })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lastgang hochladen</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FileDrop
          accept=".csv,.xlsx,.xls"
          fileName={fileName}
          onFile={(f) => {
            void handleFile(f)
          }}
          title="CSV/XLSX hierher ziehen oder klicken"
          hint="Netzbetreiber-Export (Wiener Netze, Netz NÖ, Salzburg …) — max. 12 Monate"
        />
        {issue && (
          <Alert variant={issue.kind === 'error' ? 'destructive' : 'warning'}>
            {issue.kind === 'error' ? (
              <XCircle className="h-4 w-4" />
            ) : (
              <AlertTriangle className="h-4 w-4" />
            )}
            <AlertTitle>
              {issue.kind === 'error' ? 'Datei konnte nicht gelesen werden' : 'Format unklar'}
            </AlertTitle>
            <AlertDescription>{issue.message}</AlertDescription>
          </Alert>
        )}
        <p className="flex items-center gap-1.5 text-xs text-text-muted">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent" />
          Die Datei wird ausschließlich in Ihrem Browser verarbeitet und nicht hochgeladen.
        </p>
        <div className="flex justify-end">
          <Button disabled={!load} onClick={() => load && onComplete(load)}>
            Weiter
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
