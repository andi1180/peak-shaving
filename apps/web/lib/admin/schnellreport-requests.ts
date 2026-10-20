/*
 * Schnellreport-Anforderungen eines Leads für die Admin-Detailseite (Leadgen 3b-3). Rein: liest die
 * Rückgabe von `public.admin_list_schnellreport_requests` und verwirft alles, was nicht passt.
 */

export type SchnellreportRequestRow = {
  id: string
  createdAt: string
  country: 'AT' | 'DE'
  branche: string
  annualKwh: number
  peakKw: number
  peakKwEntered: boolean
  billEur: number | null
  demandPriceEurPerKw: number
  peakCostEur: number
  tipsRequested: boolean
  tipsConfirmed: boolean
  callbackRequested: boolean
}

function num(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

export function readSchnellreportRequests(data: unknown): SchnellreportRequestRow[] {
  if (!Array.isArray(data)) return []
  const rows: SchnellreportRequestRow[] = []
  for (const raw of data) {
    if (raw === null || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const annualKwh = num(r.annual_kwh)
    const peakKw = num(r.peak_kw)
    const demandPrice = num(r.demand_price_eur_per_kw)
    const peakCost = num(r.peak_cost_eur)
    if (
      typeof r.id !== 'string' ||
      typeof r.created_at !== 'string' ||
      (r.country !== 'AT' && r.country !== 'DE') ||
      typeof r.branche !== 'string' ||
      annualKwh === null ||
      peakKw === null ||
      demandPrice === null ||
      peakCost === null
    ) {
      continue
    }
    rows.push({
      id: r.id,
      createdAt: r.created_at,
      country: r.country,
      branche: r.branche,
      annualKwh,
      peakKw,
      peakKwEntered: r.peak_kw_entered === true,
      billEur: num(r.bill_eur),
      demandPriceEurPerKw: demandPrice,
      peakCostEur: peakCost,
      tipsRequested: r.tips_requested === true,
      tipsConfirmed: r.tips_confirmed === true,
      callbackRequested: r.callback_requested === true,
    })
  }
  return rows
}
