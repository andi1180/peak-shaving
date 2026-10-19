/**
 * `POST /api/admin/invoice-extract` — liest EINE abgelegte Rechnung aus (Rechnung-Station).
 *
 * Eine Route statt der Server Action, weil Next die Server Actions eines Clients nacheinander
 * ausführt (Action-Queue im App-Router); die Station soll aber bis zu drei Rechnungen gleichzeitig
 * lesen. Die Route ist nur die Adresse: Sitzung prüfen, dann dieselbe Funktion wie die Action —
 * Zugehörigkeit und Rechte entscheidet weiterhin die Datenbank (`platform.project_accessible`).
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { extractStoredInvoiceAction } from '@/lib/admin/data-entry-actions-rechnung-extract'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Ein Scan samt Wiederholung braucht bis zu `INVOICE_UPLOAD_BUDGET_MS` (250 s).
export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  // JSON verlangt einen CORS-Preflight — ein fremdes Formular kann diese Route so nicht auslösen.
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ status: 'request_failed' }, { status: 415 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ status: 'request_failed' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ status: 'not_found' }, { status: 400 })
  }

  const result = await extractStoredInvoiceAction(
    String(body?.projectId ?? ''),
    String(body?.meteringPointId ?? ''),
    String(body?.documentId ?? ''),
  )
  return NextResponse.json(result)
}
