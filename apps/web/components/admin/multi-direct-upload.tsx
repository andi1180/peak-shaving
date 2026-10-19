'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FieldHint, Label } from '@/components/ui/input'
import type { DirectUploadGrant } from '@/lib/project-documents/direct-upload-client'
import {
  checkSelection,
  runMultiDirectUpload,
  type MultiUploadItem,
  type MultiUploadLimits,
  type MultiUploadRegistration,
} from '@/lib/project-documents/multi-direct-upload'

export type UploadedDocument = { documentId: string; name: string }

const STATUS_TEXT: Record<MultiUploadItem['status'], string> = {
  waiting: 'wartet',
  uploading: 'wird hochgeladen …',
  stored: 'abgelegt',
  failed: 'fehlgeschlagen',
}

/**
 * Mehrere Dateien direkt in den Storage hochladen, mit Status je Datei (Ablauf:
 * `lib/project-documents/multi-direct-upload.ts`). Fachlich neutral: was angefordert, eingetragen
 * und danach mit den abgelegten Dokumenten geschieht, bestimmt der Aufrufer.
 */
export function MultiDirectUpload({
  id,
  label,
  hint,
  error,
  accept,
  maxFiles,
  maxBytesPerFile,
  request,
  register,
  discard,
  onUploaded,
  submitLabel,
  busy = false,
  busyLabel,
}: {
  id: string
  label: string
  hint: string
  /** Eine Meldung des Aufrufers (z. B. aus dem Schritt danach); ersetzt den Hinweis. */
  error?: string
  accept: readonly string[]
  maxFiles: number
  maxBytesPerFile: number
  request: (file: File) => Promise<DirectUploadGrant<string>>
  register: (documentId: string, file: File) => Promise<MultiUploadRegistration>
  discard?: (documentId: string) => Promise<void>
  /** Mit allen in diesem Vorgang abgelegten Dokumenten; nicht aufgerufen, wenn keines ankam. */
  onUploaded: (documents: UploadedDocument[]) => void
  submitLabel: string
  /** Der Aufrufer arbeitet noch mit den abgelegten Dokumenten. */
  busy?: boolean
  busyLabel?: string
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [items, setItems] = React.useState<MultiUploadItem[]>([])
  const [uploading, setUploading] = React.useState(false)
  const [selectionError, setSelectionError] = React.useState<string | null>(null)

  const limits: MultiUploadLimits = { accept, maxFiles, maxBytesPerFile }
  const shownError = selectionError ?? error
  const working = uploading || busy

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const files = Array.from(inputRef.current?.files ?? [])
    const rejected = checkSelection(files, limits)
    setSelectionError(rejected)
    if (rejected !== null) {
      setItems([])
      inputRef.current?.focus()
      return
    }

    setUploading(true)
    try {
      const done = await runMultiDirectUpload(
        files,
        limits,
        { request, register, discard },
        setItems,
      )
      const stored = done.flatMap((item) =>
        item.status === 'stored' && item.documentId
          ? [{ documentId: item.documentId, name: item.name }]
          : [],
      )
      if (inputRef.current) inputRef.current.value = ''
      if (stored.length > 0) onUploaded(stored)
    } finally {
      setUploading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="max-w-xl">
        <Label htmlFor={id}>{label}</Label>
        <div className="mt-1.5">
          <input
            ref={inputRef}
            id={id}
            type="file"
            multiple
            accept={accept.join(',')}
            required
            disabled={working}
            aria-invalid={shownError ? true : undefined}
            aria-describedby={`${id}-hint`}
            className="block w-full text-small text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-sunken file:px-3 file:py-1.5 file:text-small file:text-ink hover:file:bg-surface-alt"
          />
        </div>
        <FieldHint id={`${id}-hint`} tone={shownError ? 'error' : 'muted'}>
          {shownError ?? hint}
        </FieldHint>
      </div>

      {items.length > 0 && (
        <ul className="flex max-w-xl flex-col gap-1 text-small" aria-label="Status der Dateien">
          {items.map((item) => (
            <li key={item.key} className="flex flex-wrap gap-x-2">
              <span className="text-ink">{item.name}</span>
              <span className={item.status === 'failed' ? 'text-negative' : 'text-text-muted'}>
                {STATUS_TEXT[item.status]}
                {item.error ? `: ${item.error}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" size="md" disabled={working}>
          {working && (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          )}
          {uploading ? 'Wird hochgeladen …' : busy ? (busyLabel ?? submitLabel) : submitLabel}
        </Button>
        <span role="status" aria-live="polite" className="sr-only">
          {uploading ? 'Wird hochgeladen …' : busy ? (busyLabel ?? '') : ''}
        </span>
      </div>
    </form>
  )
}
