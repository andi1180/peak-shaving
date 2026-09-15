import { describe, expect, it } from 'vitest'

import { energyAdvisorTriggerLabel } from './energy-advisor'

describe('energyAdvisorTriggerLabel', () => {
  it('zeigt „starten" bei leerem Transkript-Stand', () => {
    expect(energyAdvisorTriggerLabel([])).toBe('KI-Prüfung starten')
  })

  it('zeigt „öffnen", sobald bereits ein Verlauf besteht', () => {
    expect(energyAdvisorTriggerLabel([{ role: 'user', text: 'Hallo' }])).toBe('KI-Prüfung öffnen')
  })
})
