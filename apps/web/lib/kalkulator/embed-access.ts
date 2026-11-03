import 'server-only'
import { CALCULATOR_ACCESS_PARAM, createCalculatorAccessToken } from 'shared/calculator-access'

/**
 * Hängt das Zugangstoken an eine URL der Rechner-App (`apps/website`). Nur NACH der Admin-Prüfung
 * aufrufen — wer die URL hat, hat den Rechner für die Gültigkeitsdauer des Tokens.
 *
 * Fehlt `CALCULATOR_ACCESS_SECRET`, bleibt die URL ohne Token; die Rechner-App weist sie dann ab
 * (fail-closed auf beiden Seiten).
 */
export async function withCalculatorAccess(url: string): Promise<string> {
  const token = await createCalculatorAccessToken(process.env.CALCULATOR_ACCESS_SECRET)
  if (!token) {
    console.error('[kalkulator] CALCULATOR_ACCESS_SECRET fehlt oder ist zu kurz — Rechner gesperrt')
    return url
  }
  const target = new URL(url)
  target.searchParams.set(CALCULATOR_ACCESS_PARAM, token)
  return target.toString()
}
