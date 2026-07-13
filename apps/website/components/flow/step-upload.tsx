'use client'

import { useState } from 'react'
import { AlertTriangle, ArrowRight, ShieldCheck, XCircle } from 'lucide-react'
import { parseLoadProfile } from 'engine'
import type { ColumnMapping, Detection, Unit, ValueColumnInfo } from 'engine'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FileDrop } from './file-drop'
import { MappingPanel } from './mapping-panel'
import type { ParsedLoad } from './types'

type ParseInput = { content: string | ArrayBuffer; fileName: string; format: 'csv' | 'xlsx' }
type Notice = { kind: 'warning' | 'error'; message: string }
// Aktiver Mehrspalten-Mapping-Fall (§3.2): der Nutzer bestätigt die Rollen, dann wird `input` mit den
// gewählten Spalten erneut geparst. `input` bleibt erhalten, um genau diese Datei neu parsen zu können.
type MappingState = {
  input: ParseInput
  fileName: string
  detection: Detection
  valueColumns: ValueColumnInfo[]
}

async function readForParsing(file: File): Promise<ParseInput> {
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
  const [notice, setNotice] = useState<Notice | null>(null)
  const [mapping, setMapping] = useState<MappingState | null>(null)
  const [mappingError, setMappingError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setFileName(file.name)
    setLoad(null)
    setNotice(null)
    setMapping(null)
    setMappingError(null)

    const input = await readForParsing(file)
    const outcome = parseLoadProfile(input)

    if (outcome.ok) {
      setLoad({ fileName: file.name, profile: outcome.profile, dataQuality: outcome.dataQuality })
      return
    }
    if (outcome.kind === 'needs_mapping') {
      // Mehrere Wert-Spalten → Bestätigungs-Panel (§3.2). Ohne Spaltenliste (z. B. nur Einheit
      // uneindeutig) fällt es auf die einfache Meldung zurück — dafür gibt es noch keine Korrektur-UI.
      if (outcome.valueColumns && outcome.valueColumns.length > 0) {
        setMapping({
          input,
          fileName: file.name,
          detection: outcome.detection,
          valueColumns: outcome.valueColumns,
        })
        return
      }
      setNotice({ kind: 'warning', message: outcome.issues.map((i) => i.message).join(' ') })
      return
    }
    setNotice({ kind: 'error', message: outcome.error.message })
  }

  // Bestätigte Rollen → erneuter Parser-Aufruf mit den gewählten Spalten. 'ok' → normaler Pfad.
  function handleMappingConfirm(columns: ColumnMapping, unit: Unit | undefined) {
    if (!mapping) return
    setMappingError(null)
    const outcome = parseLoadProfile(mapping.input, { columns, unit })
    if (outcome.ok) {
      onComplete({
        fileName: mapping.fileName,
        profile: outcome.profile,
        dataQuality: outcome.dataQuality,
      })
      return
    }
    // Edge Case: Bestätigung führt selbst zu einem Problem → sauber im Panel anzeigen, kein Crash.
    if (outcome.kind === 'needs_mapping') {
      setMappingError(
        `Die Zuordnung ist noch nicht eindeutig: ${outcome.issues.map((i) => i.message).join(' ')}`,
      )
      return
    }
    setMappingError(outcome.error.message)
  }

  function handleCancelMapping() {
    setMapping(null)
    setMappingError(null)
    setFileName(null)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lastgang hochladen</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {mapping ? (
          <MappingPanel
            detection={mapping.detection}
            valueColumns={mapping.valueColumns}
            error={mappingError}
            onConfirm={handleMappingConfirm}
            onCancel={handleCancelMapping}
          />
        ) : (
          <>
            <FileDrop
              accept=".csv,.xlsx,.xls"
              fileName={fileName}
              onFile={(f) => {
                void handleFile(f)
              }}
              title="CSV/XLSX hierher ziehen oder klicken"
              hint="Netzbetreiber-Export (Wiener Netze, Netz NÖ, Salzburg …) — max. 12 Monate"
            />
            {notice && (
              <Alert variant={notice.kind === 'error' ? 'destructive' : 'warning'}>
                {notice.kind === 'error' ? (
                  <XCircle className="h-4 w-4" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
                <AlertTitle>
                  {notice.kind === 'error' ? 'Datei konnte nicht gelesen werden' : 'Format unklar'}
                </AlertTitle>
                <AlertDescription>{notice.message}</AlertDescription>
              </Alert>
            )}
            <div className="flex justify-end">
              <Button disabled={!load} onClick={() => load && onComplete(load)}>
                Weiter
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
        <p className="flex items-center gap-1.5 text-xs text-text-muted">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent" />
          Die Datei wird ausschließlich in Ihrem Browser verarbeitet und nicht hochgeladen.
        </p>
      </CardContent>
    </Card>
  )
}
