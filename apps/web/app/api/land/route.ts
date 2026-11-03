/**
 * GET /api/land — das Länderkürzel des Besuchers aus dem Vercel-Header `x-vercel-ip-country`,
 * damit PostHog-Ereignisse das Land tragen (GeoIP greift im cookielosen Modus nicht).
 *
 * Ausgeliefert wird nur das Kürzel: keine IP, kein Cookie, kein Logging, nicht cachebar. Als eigene
 * Route statt `headers()` im Layout, damit die Marketing-Seiten statisch bleiben.
 */
import { parseLand } from '@/lib/analytics/posthog-start'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(request: Request): Response {
  const land = parseLand(request.headers.get('x-vercel-ip-country'))
  return Response.json({ land }, { headers: { 'Cache-Control': 'no-store' } })
}
