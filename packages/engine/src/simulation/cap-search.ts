import type { BillingModel, LoadProfile } from 'shared'

import {
  drawSeries,
  intervalHours,
  intervalIndicesByPeriod,
  maxPositiveDraw,
  orderedPeriodIds,
  periodIndexByInterval,
  periodSlotCount,
  startSoc,
  type BatteryPhysics,
} from './helpers'
import { runPeakProtection } from './peak-protection'

// Kapp-Schwellen-Suche (§3.6.1) — „das eigentlich schwierige Teilproblem".
// Binärsuche über `cap` je Abrechnungsperiode; die Perioden werden SEQUENZIELL mit echtem
// SoC-Übertrag gerechnet (EIN chronologischer Lauf übers Jahr), NICHT als unabhängige
// Simulationen mit zurückgesetztem SoC (§3.6.1, Prinzip 3).

/** Iterationen/Toleranz der Binärsuche. 60 Iterationen ≈ 2^-60 relative Auflösung — praktisch exakt. */
const MAX_ITERATIONS = 60
const TOLERANCE_KW = 1e-4

/**
 * Niedrigste machbare `cap` für EINE Periode, gegeben deren Start-SoC. Binärsuche zwischen 0 und
 * dem Perioden-Höchstbezug (bei `cap = maxDraw` ist trivial machbar: keine Spitze über `cap`).
 * Monotonie: höhere `cap` → machbar, niedrigere → irgendwann nicht — Voraussetzung der Binärsuche.
 * Liefert zusätzlich den ECHTEN End-SoC bei der gewählten `cap` für die Übergabe an die Folgeperiode.
 */
export function searchCapForPeriod(
  periodDraws: number[],
  startSocKwh: number,
  physics: BatteryPhysics,
  deltaH: number,
): { capKw: number; endSocKwh: number } {
  const maxDraw = maxPositiveDraw(periodDraws)
  if (maxDraw <= 0) {
    // Reine Einspeisung / kein Bezug: keine Spitze zu kappen. cap = 0; SoC läuft dennoch (Nachladung) fort.
    return { capKw: 0, endSocKwh: runPeakProtection(periodDraws, 0, physics, startSocKwh, deltaH).endSocKwh }
  }

  let lo = 0 // untere Grenze: typischerweise (noch) NICHT machbar
  let hi = maxDraw // obere Grenze: machbar (keine Spitze über `cap`)
  for (let iter = 0; iter < MAX_ITERATIONS && hi - lo > TOLERANCE_KW; iter++) {
    const mid = (lo + hi) / 2
    if (runPeakProtection(periodDraws, mid, physics, startSocKwh, deltaH).feasible) hi = mid
    else lo = mid
  }

  // `hi` ist die machbare Seite (konservativ). Echten End-SoC bei genau dieser cap bestimmen.
  const capKw = hi
  const endSocKwh = runPeakProtection(periodDraws, capKw, physics, startSocKwh, deltaH).endSocKwh
  return { capKw, endSocKwh }
}

export type CapSearchResult = {
  /** Kapp-Schwelle je Contract-Slot (§3.10/`DispatchTrace.capKwByPeriod`): Länge 1 (`annual_max`) bzw. 12 (`monthly_*`). 0 für nicht abgedeckte Monate. */
  capKwByPeriod: number[]
  /** Debug/Transparenz: End-SoC nach jeder Periode in chronologischer Reihenfolge (der sequenzielle Übertrag). */
  periodEndSocKwh: number[]
}

/**
 * Kapp-Suche über das GANZE Jahr, sequenziell (§3.6.1). Start-SoC der ersten Periode = 50 %
 * der Kapazität; danach übernimmt jede Periode den echten End-SoC der Vorperiode. `monthly_*`
 * mittelt/summiert später über die 12 Monats-Caps (das übernimmt die TariffStrategy, §3.5, auf
 * dem gekappten Profil — hier nur die Caps selbst).
 */
export function searchCaps(
  loadProfile: LoadProfile,
  physics: BatteryPhysics,
  billingModel: BillingModel,
): CapSearchResult {
  const draws = drawSeries(loadProfile)
  const deltaH = intervalHours(loadProfile)
  const periodOfInterval = periodIndexByInterval(loadProfile, billingModel)
  const indicesByPeriod = intervalIndicesByPeriod(periodOfInterval)
  const order = orderedPeriodIds(periodOfInterval)

  const capKwByPeriod = new Array<number>(periodSlotCount(billingModel)).fill(0)
  const periodEndSocKwh: number[] = []

  let carrySoc = startSoc(physics) // §3.6.1 [ANNAHME]: 50 % am 1.1.
  for (const periodId of order) {
    const indices = indicesByPeriod.get(periodId) ?? []
    const periodDraws = indices.map((i) => draws[i] ?? 0)
    const { capKw, endSocKwh } = searchCapForPeriod(periodDraws, carrySoc, physics, deltaH)
    // periodId ist bei annual_max 0, bei monthly_* der Monatsindex 0..11 → passt genau auf den Contract-Slot.
    capKwByPeriod[periodId] = capKw
    periodEndSocKwh.push(endSocKwh)
    carrySoc = endSocKwh // ECHTER SoC-Übertrag (kein Reset) — das ist der Kern von §3.6.1.
  }

  return { capKwByPeriod, periodEndSocKwh }
}
