/**
 * GET /api/schnellreport/vorschau — der PDF-Schnellreport mit festen Beispielwerten (3b-1).
 *
 * Versteckt: nirgends verlinkt, nicht in der sitemap (Route Handler stehen nicht in `SITE_ROUTES`)
 * und per `X-Robots-Tag` aus dem Index gehalten. Umschaltbar über `?land=AT|DE` und
 * `?branche=<Schlüssel aus BRANCHE_KEYS>`; ein unbekannter Wert ist ein 400, kein stiller Rückfall.
 */
import { BRANCHE_KEYS, isBrancheKey } from '@/lib/schnellreport/content'
import { renderSchnellreportPdf } from '@/lib/schnellreport/render'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EXAMPLE = {
  kwh: 250_000,
  kw: 180,
  sliderKw: 180,
  bill: 65_000,
  firma: 'Muster Metallbau GmbH',
} as const

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  const land = params.get('land') ?? 'AT'
  const branche = params.get('branche') ?? 'produktion'

  if (land !== 'AT' && land !== 'DE') {
    return Response.json({ error: 'land muss AT oder DE sein' }, { status: 400 })
  }
  if (!isBrancheKey(branche)) {
    return Response.json(
      { error: `branche muss einer von ${BRANCHE_KEYS.join(', ')} sein` },
      { status: 400 },
    )
  }

  const pdf = await renderSchnellreportPdf({
    ...EXAMPLE,
    country: land,
    branche,
    createdAt: new Date(),
  })

  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="Schnellreport_Muster_Metallbau_GmbH.pdf"',
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'no-store',
    },
  })
}
