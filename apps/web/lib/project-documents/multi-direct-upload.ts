import {
  uploadFileDirect,
  type DirectUploadGrant,
  type DirectUploadStep,
} from './direct-upload-client'

/**
 * Mehrere Dateien direkt vom Browser in den Storage, mit Status je Datei.
 *
 * Reine Ablauflogik ohne React: die Komponente (`components/admin/multi-direct-upload.tsx`) zeigt
 * nur an. Was eine Datei fachlich bedeutet und wie sie registriert wird, kommt von aussen über
 * `request`/`register` — hier steht nichts über Rechnungen oder einen bestimmten Bucket.
 */

export type MultiUploadStatus = 'waiting' | 'uploading' | 'stored' | 'failed'

export type MultiUploadItem = {
  key: string
  name: string
  status: MultiUploadStatus
  error?: string
  documentId?: string
}

export type MultiUploadLimits = {
  /** Erlaubte MIME-Typen; leer heisst „jeder Typ". */
  accept: readonly string[]
  maxFiles: number
  maxBytesPerFile: number
  /** Gleichzeitige Uploads, Vorgabe 3. */
  concurrency?: number
}

export type MultiUploadRegistration = { ok: true } | { ok: false; error: string }

export type MultiUploadPorts = {
  /** Fordert für EINE Datei Kennung und signierte URL an; die Ablehnung trägt ihren Text. */
  request: (file: File) => Promise<DirectUploadGrant<string>>
  /** Trägt die hochgeladene Datei ein (nach dem PUT). */
  register: (documentId: string, file: File) => Promise<MultiUploadRegistration>
  /** Räumt ein angefangenes, nicht eingetragenes Objekt ab. */
  discard?: (documentId: string) => Promise<void>
  fetch?: typeof fetch
}

const DEFAULT_CONCURRENCY = 3

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toLocaleString('de-AT', { maximumFractionDigits: 1 })
}

const STEP_TEXT: Record<DirectUploadStep, string> = {
  request: 'Das Hochladen konnte nicht gestartet werden.',
  transfer: 'Die Übertragung an die Ablage ist fehlgeschlagen.',
  complete: 'Die Datei kam an, liess sich aber nicht eintragen.',
}

/** Meldung, wenn die Auswahl als Ganzes nicht passt — sonst `null`. Es wird dann nichts hochgeladen. */
export function checkSelection(files: readonly File[], limits: MultiUploadLimits): string | null {
  if (files.length === 0) return 'Bitte mindestens eine Datei auswählen.'
  if (files.length > limits.maxFiles) {
    return (
      `Höchstens ${limits.maxFiles} Dateien pro Vorgang — ausgewählt waren ${files.length}. ` +
      'Es wurde nichts hochgeladen.'
    )
  }
  return null
}

/** Meldung, wenn eine einzelne Datei vorab abgelehnt wird — sonst `null`. Kein Netzweg. */
export function precheckFile(file: File, limits: MultiUploadLimits): string | null {
  if (file.size === 0) return 'Die Datei ist leer.'
  if (limits.accept.length > 0 && !limits.accept.includes(file.type)) {
    return 'Dieser Dateityp wird hier nicht angenommen.'
  }
  if (file.size > limits.maxBytesPerFile) {
    return `Zu gross (${megabytes(file.size)} MB, höchstens ${megabytes(limits.maxBytesPerFile)} MB).`
  }
  return null
}

export function initialItems(files: readonly File[]): MultiUploadItem[] {
  return files.map((file, index) => ({
    key: `${index}:${file.name}`,
    name: file.name,
    status: 'waiting',
  }))
}

type Outcome = { ok: true; documentId: string } | { ok: false; error: string }

/**
 * Lädt alle Dateien hoch und meldet jede Statusänderung über `onUpdate`. Wirft nie: jede Datei
 * endet als `stored` oder `failed` mit Text. Die Auswahl muss `checkSelection` bestanden haben.
 */
export async function runMultiDirectUpload(
  files: readonly File[],
  limits: MultiUploadLimits,
  ports: MultiUploadPorts,
  onUpdate: (items: MultiUploadItem[]) => void,
): Promise<MultiUploadItem[]> {
  let items = initialItems(files)
  const set = (index: number, patch: Partial<MultiUploadItem>) => {
    items = items.map((item, i) => (i === index ? { ...item, ...patch } : item))
    onUpdate(items)
  }
  onUpdate(items)

  const queue: number[] = []
  files.forEach((file, index) => {
    const rejected = precheckFile(file, limits)
    if (rejected === null) queue.push(index)
    else set(index, { status: 'failed', error: rejected })
  })

  let next = 0
  const worker = async () => {
    while (next < queue.length) {
      const index = queue[next++]!
      const file = files[index]!
      set(index, { status: 'uploading' })

      let grantedId: string | null = null
      const outcome = await uploadFileDirect<Outcome>(
        file,
        {
          request: async () => {
            const grant = await ports.request(file)
            if (!grant.ok) return { ok: false, state: { ok: false, error: grant.state } }
            grantedId = grant.documentId
            return grant
          },
          complete: async (documentId) => {
            const registered = await ports.register(documentId, file)
            return registered.ok ? { ok: true, documentId } : { ok: false, error: registered.error }
          },
          failed: (step) => ({ ok: false, error: STEP_TEXT[step] }),
        },
        { fetch: ports.fetch },
      )

      if (outcome.ok) {
        set(index, { status: 'stored', documentId: outcome.documentId })
        continue
      }
      // Angefangen, aber nicht eingetragen: das Objekt soll nicht unsichtbar im Bucket liegen bleiben.
      if (grantedId !== null && ports.discard) {
        await ports.discard(grantedId).catch(() => undefined)
      }
      set(index, { status: 'failed', error: outcome.error })
    }
  }

  const concurrency = Math.max(1, limits.concurrency ?? DEFAULT_CONCURRENCY)
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
  return items
}
