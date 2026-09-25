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
  it('beschreibt den Tagesplan, keine einfache Regel und keine Untergrenze', () => {
    const text = renderToStaticMarkup(createElement(ChargePriceChart, { price: PRICE })).replace(/<[^>]+>/g, '')

    expect(text).toContain('plant jeden Tag im Voraus')
    expect(text).not.toContain('einfachen Regel')
    expect(text).not.toContain('Untergrenze')
  })
})
