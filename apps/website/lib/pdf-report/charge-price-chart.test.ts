import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MonthlyChargePrice } from 'shared'

import { ChargePriceChart } from '@/components/report/charge-price-chart'

const months = (...values: number[]) => [...values, ...Array<null>(12 - values.length).fill(null)]

const PRICE: MonthlyChargePrice = {
  chargeCtPerKwh: months(8, 9),
  dischargeCtPerKwh: months(14, 15),
  averageCtPerKwh: months(11, 12),
  chargedKwh: months(120, 110),
  dischargedKwh: months(100, 95),
}

describe('ChargePriceChart — Fussnote zur Ladesteuerung', () => {
  it('trägt den Wortlaut aus der PDF-Notiz, nicht mehr die Schwellenregel', () => {
    const text = renderToStaticMarkup(createElement(ChargePriceChart, { price: PRICE })).replace(/<[^>]+>/g, '')

    expect(text).toContain('eine feinere Steuerung kann mehr herausholen')
    expect(text).not.toContain('Schwellenregel')
    expect(text).not.toContain('rechnerisches Optimum')
  })
})
