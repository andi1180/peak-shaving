import { NextResponse, type NextRequest } from 'next/server'
import { CALCULATOR_ACCESS_PARAM, verifyCalculatorAccessToken } from 'shared/calculator-access'

/**
 * Der Rechner ist nur für Admins (03.11.2026). Jede Anfrage — Seiten, RSC-Abrufe, Server Actions —
 * braucht ein gültiges Zugangstoken, das coolin.at erst nach der Admin-Prüfung ausstellt
 * (`shared/calculator-access`). Fehlt `CALCULATOR_ACCESS_SECRET`, wird alles abgewiesen.
 */
export async function middleware(request: NextRequest) {
  const token = request.nextUrl.searchParams.get(CALCULATOR_ACCESS_PARAM)
  if (await verifyCalculatorAccessToken(process.env.CALCULATOR_ACCESS_SECRET, token)) {
    return NextResponse.next()
  }
  return new NextResponse('Kein Zugriff.', {
    status: 401,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}

export const config = {
  // Ausgenommen nur Build-Assets und die beiden öffentlichen Ordner (Logo, Report-Schriften).
  matcher: ['/((?!_next/static/|_next/image|brand/|report-fonts/|favicon\\.ico$).*)'],
}
