import { describe, expect, it } from 'vitest'
import type { PvProfile } from 'shared'

import {
  basisWithPvLoadProfile,
  consistentPvProfile,
  inconsistentPvProfile,
  INCONSISTENT_PV_SLOTS,
  PV_EXPORT_KW,
} from '../fixtures/profiles'
import { drawSeries } from './helpers'
import { alignPvGrossToLoad, pvConsistencyWarning, pvCoverageWarning } from './pv'

/**
 * §3.1 — Brutto-PV-Ausrichtung + Konsistenz gegen den Netz-Lastgang (Prinzip 1: Netz gewinnt).
 * `basisWithPvLoadProfile` speist an den Slots 56–63 mit `-PV_EXPORT_KW` (16 kW Einspeisung) ein,
 * feed-in 0 sonst.
 */

const EPS = 1e-9
const feedInOf = (draws: number[]): number[] => draws.map((d) => Math.max(0, -d))

describe('§3.1 alignPvGrossToLoad — Konsistenz (Netz-Lastgang gewinnt)', () => {
  it('konsistentes Profil (20 ≥ 16): kein Slot geklemmt, Brutto-PV unverändert übernommen', () => {
    const lp = basisWithPvLoadProfile()
    const { grossPvKw, inconsistentSlots } = alignPvGrossToLoad(lp, consistentPvProfile())

    expect(inconsistentSlots).toBe(0)
    expect(pvConsistencyWarning(inconsistentSlots)).toBeNull()

    // Brutto ≥ Einspeisung in JEDEM Slot (Grund-Invariante nach dem Ausrichten).
    const feedIn = feedInOf(drawSeries(lp))
    for (let i = 0; i < grossPvKw.length; i++) {
      expect(grossPvKw[i]!).toBeGreaterThanOrEqual(feedIn[i]! - EPS)
    }
    // An den PV-Slots steht die echte Brutto-PV (20), nicht die Einspeisung (16).
    const pvSlot = grossPvKw.filter((g) => g > EPS)
    expect(pvSlot.length).toBeGreaterThan(0)
    expect(pvSlot.every((g) => Math.abs(g - 20) < EPS)).toBe(true)
  })

  it('inkonsistentes Profil (10 < 16): klemmt auf Einspeisung, zählt exakt 144 Slots, Warnung feuert', () => {
    const lp = basisWithPvLoadProfile()
    const { grossPvKw, inconsistentSlots } = alignPvGrossToLoad(lp, inconsistentPvProfile())

    expect(inconsistentSlots).toBe(INCONSISTENT_PV_SLOTS) // 8 PV-Slots/Tag × 18 Tage = 144
    const warning = pvConsistencyWarning(inconsistentSlots)
    expect(warning).toContain('144')

    // Geklemmt auf die Einspeisung (16), NICHT unter feed-in → kein negativer Verbrauch.
    const draws = drawSeries(lp)
    const feedIn = feedInOf(draws)
    for (let i = 0; i < grossPvKw.length; i++) {
      expect(grossPvKw[i]!).toBeGreaterThanOrEqual(feedIn[i]! - EPS)
      const verbrauch = draws[i]! + grossPvKw[i]! // = draw + BruttoPV (abgeleiteter Verbrauch)
      expect(verbrauch).toBeGreaterThanOrEqual(-EPS) // nie negativ
    }
    // An den geklemmten PV-Slots: grossPv == feed-in (16), Verbrauch dort exakt 0.
    const clamped = grossPvKw.filter((_, i) => feedIn[i]! > EPS)
    expect(clamped.length).toBe(INCONSISTENT_PV_SLOTS)
    expect(clamped.every((g) => Math.abs(g - PV_EXPORT_KW) < EPS)).toBe(true)
  })

  it('fehlende PV-Abdeckung ist KEIN Widerspruch: still auf Einspeisung gesetzt, nicht gezählt', () => {
    const lp = basisWithPvLoadProfile()
    // PV-Profil, das die PV-Slots (mit Einspeisung) AUSLÄSST → reine Abdeckungslücke.
    const full = consistentPvProfile()
    const feedIn = feedInOf(drawSeries(lp))
    const sparse: PvProfile = {
      readings: full.readings.filter((_, i) => feedIn[i]! <= EPS), // nur die feed-in-freien Slots
    }
    const { grossPvKw, inconsistentSlots } = alignPvGrossToLoad(lp, sparse)

    expect(inconsistentSlots).toBe(0) // Lücke ≠ Widerspruch
    // Die ausgelassenen (einspeisenden) Slots wurden still auf die Einspeisung gesetzt.
    for (let i = 0; i < grossPvKw.length; i++) {
      if (feedIn[i]! > EPS) expect(grossPvKw[i]!).toBeCloseTo(feedIn[i]!, 9)
    }
  })
})

describe('§3.1 PV-Abdeckung — matchedSlots + pvCoverageWarning (still verpuffender Upload)', () => {
  it('volle Überlappung → matchedSlots == Lastgang-Länge, keine Abdeckungs-Warnung', () => {
    const lp = basisWithPvLoadProfile()
    const { matchedSlots } = alignPvGrossToLoad(lp, consistentPvProfile())

    expect(matchedSlots).toBe(lp.readings.length)
    expect(pvCoverageWarning(matchedSlots, lp.readings.length)).toBeNull()
  })

  it('disjunkte Zeitstempel (anderer Zeitraum) → matchedSlots == 0, „ins Leere gelaufen"-Warnung', () => {
    const lp = basisWithPvLoadProfile()
    // Dasselbe PV-Profil, aber alle Zeitstempel um ~100 Jahre verschoben → kein einziger ts-Treffer.
    const shifted: PvProfile = {
      readings: consistentPvProfile().readings.map((r) => ({
        ts: r.ts.replace(/^\d{4}/, (y) => String(Number(y) + 100)),
        pvGenerationKw: r.pvGenerationKw,
      })),
    }
    const { matchedSlots, inconsistentSlots, grossPvKw } = alignPvGrossToLoad(lp, shifted)

    expect(matchedSlots).toBe(0)
    expect(inconsistentSlots).toBe(0) // fehlende Abdeckung ≠ Widerspruch → Konsistenz-Warnung schwiege still
    // Fallback: jeder Slot auf die Einspeisung gesetzt (= No-PvProfile-Verhalten).
    const feedIn = feedInOf(drawSeries(lp))
    for (let i = 0; i < grossPvKw.length; i++) expect(grossPvKw[i]!).toBeCloseTo(feedIn[i]!, 9)

    const warning = pvCoverageWarning(matchedSlots, lp.readings.length)
    expect(warning).not.toBeNull()
    expect(warning).toContain('NICHT')
  })

  it('sehr geringe Abdeckung (< 20 %) → Abdeckungs-Warnung mit Slot-Verhältnis', () => {
    expect(pvCoverageWarning(10, 100)).toContain('10 von 100')
    expect(pvCoverageWarning(50, 100)).toBeNull() // ausreichend → keine Warnung
    expect(pvCoverageWarning(0, 0)).toBeNull() // leerer Lastgang → nichts zu melden
  })
})
