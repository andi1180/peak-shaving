'use client'

import { useRef, useState } from 'react'
import { FileCheck2, UploadCloud } from 'lucide-react'

import { cn } from '@/lib/utils'

export function FileDrop({
  accept,
  onFile,
  fileName,
  title,
  hint,
  compact = false,
}: {
  accept: string
  onFile: (file: File) => void
  fileName: string | null
  title: string
  hint: string
  compact?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const f = e.dataTransfer.files?.[0]
        if (f) onFile(f)
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        compact ? 'p-5' : 'p-10',
        dragging
          ? 'border-accent bg-accent-subtle'
          : 'border-border bg-surface-alt hover:border-accent',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
        }}
      />
      {fileName ? (
        <>
          <FileCheck2 className={cn('text-positive', compact ? 'h-5 w-5' : 'h-7 w-7')} />
          <span className="text-sm font-medium text-ink">{fileName}</span>
          <span className="text-xs text-text-muted">Andere Datei wählen</span>
        </>
      ) : (
        <>
          <UploadCloud className={cn('text-text-muted', compact ? 'h-5 w-5' : 'h-7 w-7')} />
          <span className="text-sm font-medium text-ink">{title}</span>
          <span className="text-xs text-text-muted">{hint}</span>
        </>
      )}
    </div>
  )
}
