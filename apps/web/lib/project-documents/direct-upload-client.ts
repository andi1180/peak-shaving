/**
 * Browser-Seite des direkten Uploads (Gegenstück zu `direct-upload.ts`).
 *
 * Ablauf: `request` (Server Action, nur JSON) → PUT der Datei an die signierte URL → `complete`
 * (Server Action, nur JSON). Die Datei selbst geht ausschliesslich an den Storage, nie an die
 * Anwendung. Bewusst ohne Supabase-Client: die signierte URL trägt ihr Token selbst, und der
 * Browser-Bundle bleibt frei von Supabase-Code.
 *
 * Jeder Fehlschlag — auch eine Server Action, die wirft oder eine unerwartete Antwort liefert —
 * endet in einem Zustand aus `failed`, nie in einer unbehandelten Ausnahme.
 */

export type DirectUploadGrant<S> =
  | { ok: true; documentId: string; uploadUrl: string }
  | { ok: false; state: S }

export type DirectUploadStep = 'request' | 'transfer' | 'complete'

export async function uploadFileDirect<S>(
  file: File,
  steps: {
    request: () => Promise<DirectUploadGrant<S>>
    complete: (documentId: string) => Promise<S>
    failed: (step: DirectUploadStep) => S
  },
  deps: { fetch?: typeof fetch } = {},
): Promise<S> {
  let grant: DirectUploadGrant<S>
  try {
    grant = await steps.request()
  } catch (error) {
    console.error('[direct-upload] request:', error)
    return steps.failed('request')
  }
  if (!grant || typeof grant !== 'object') return steps.failed('request')
  if (!grant.ok) return grant.state

  try {
    const res = await (deps.fetch ?? fetch)(grant.uploadUrl, {
      method: 'PUT',
      body: file,
      headers: {
        'content-type': file.type.trim() === '' ? 'application/octet-stream' : file.type,
        'x-upsert': 'false',
        'cache-control': 'max-age=3600',
      },
    })
    if (!res.ok) {
      console.error('[direct-upload] transfer:', res.status)
      return steps.failed('transfer')
    }
  } catch (error) {
    console.error('[direct-upload] transfer:', error)
    return steps.failed('transfer')
  }

  try {
    const state = await steps.complete(grant.documentId)
    return state ?? steps.failed('complete')
  } catch (error) {
    console.error('[direct-upload] complete:', error)
    return steps.failed('complete')
  }
}
