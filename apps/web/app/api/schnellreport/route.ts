/**
 * POST /api/schnellreport — Absendung des Schnellreport-Formulars (Leadgen 3b-2). Eigene Route statt
 * Server Action: die PDF-Erzeugung braucht Schrift, Emblem und pdfkit-Standardschriften im
 * Function-Bündel (`next.config.mjs` → `outputFileTracingIncludes`), und das gilt je Route.
 */
import { handleSchnellreportSubmit } from '@/lib/schnellreport/submit'
import type { SchnellreportSubmission } from '@/lib/schnellreport/request'
import { requestMeta } from '@/lib/schnellreport/wiring'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ ok: false, error: 'unavailable' }, { status: 400 })
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ ok: false, error: 'unavailable' }, { status: 400 })
  }

  const response = await handleSchnellreportSubmit(
    body as SchnellreportSubmission,
    requestMeta(request.headers),
  )
  return Response.json(response, { headers: { 'Cache-Control': 'no-store' } })
}
