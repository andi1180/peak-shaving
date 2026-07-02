'use client'

import { useState } from 'react'
import { ArrowRight, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FileDrop } from './file-drop'

export function StepUpload({
  initialFile,
  onComplete,
}: {
  initialFile: File | null
  onComplete: (file: File) => void
}) {
  const [file, setFile] = useState<File | null>(initialFile)
  const fileName = file?.name ?? null

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
            // ┌─ PARSE-SLOT (Prompt 2 dockt HIER an) ─────────────────────────────┐
            // │ Aktuell wird die Datei NUR entgegengenommen (Name gemerkt), NICHT  │
            // │ geparst. Prompt 2 baut hier CSV/XLSX-Parsing + Format-Erkennung    │
            // │ (§3.2) ein und erzeugt das getypte LoadProfile fürs Payload.       │
            // └────────────────────────────────────────────────────────────────────┘
            setFile(f)
          }}
          title="CSV/XLSX hierher ziehen oder klicken"
          hint="Netzbetreiber-Export (Wiener Netze, Netz NÖ, Salzburg …) — max. 12 Monate"
        />
        <p className="flex items-center gap-1.5 text-xs text-text-muted">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent" />
          Die Datei wird ausschließlich in Ihrem Browser verarbeitet und nicht hochgeladen.
        </p>
        <div className="flex justify-end">
          <Button disabled={!file} onClick={() => file && onComplete(file)}>
            Weiter
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
