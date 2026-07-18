import { describe, expect, it } from 'vitest'

import type { TariffCostObject } from './types'

// Reiner Smoke-Test (T1-Teil 1): beweist nur, dass der Contract importierbar ist und
// das Paket baut — keine Rechenlogik, die Stubs werfen ja bewusst 'not implemented'.
describe('tariff-monitor package scaffold', () => {
  it('constructs a TariffCostObject literal against the contract type', () => {
    const tariff: TariffCostObject = {
      providerName: 'Testversorger',
      tariffName: 'Test Strom Fix',
      energyPriceCtPerKwh: 22.5,
      baseFeeEurPerYear: 96,
      bonusEur: 0,
      contractCommitmentMonths: 0,
      billingCycle: 'monthly',
      greenEnergy: true,
    }

    expect(tariff.providerName).toBe('Testversorger')
    expect(tariff.bonusEur).toBe(0)
  })
})
