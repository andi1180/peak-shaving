import { describe, expect, it, vi } from 'vitest'

import {
  applyMarkedChoice,
  liftChoice,
  optionText,
  orderedOptions,
} from './invoice-field-choices-model'
import { OPEN_WEIGHTED } from './invoice-field-choices.fixtures'

function call() {
  const choose = vi.fn().mockResolvedValue({ ok: true })
  const clear = vi.fn().mockResolvedValue({ ok: true })
  const reload = vi.fn()
  return {
    choose,
    clear,
    reload,
    args: {
      actions: { choose, clear },
      projectId: 'p1',
      meteringPointId: 'm1',
      field: 'energyPriceCtPerKwh' as const,
      reload,
    },
  }
}

describe('Rechnungswahl — Aktionen', () => {
  it('„Übernehmen" schreibt genau die markierte Option und lädt danach neu', async () => {
    const c = call()
    expect(await applyMarkedChoice(c.args, 'document:doc-b')).toBeNull()
    expect(c.choose).toHaveBeenCalledWith('p1', 'm1', 'energyPriceCtPerKwh', {
      kind: 'document',
      documentId: 'doc-b',
    })
    expect(c.reload).toHaveBeenCalledOnce()

    await applyMarkedChoice(c.args, 'weighted')
    expect(c.choose).toHaveBeenLastCalledWith('p1', 'm1', 'energyPriceCtPerKwh', {
      kind: 'weighted',
    })
  })

  it('„Wahl aufheben" ruft clear; ein Fehler kommt als Meldung zurück, ohne neu zu laden', async () => {
    const c = call()
    expect(await liftChoice(c.args)).toBeNull()
    expect(c.clear).toHaveBeenCalledWith('p1', 'm1', 'energyPriceCtPerKwh')

    c.reload.mockClear()
    c.choose.mockResolvedValueOnce({ ok: false, error: 'nicht mehr widersprüchlich' })
    expect(await applyMarkedChoice(c.args, 'weighted')).toBe('nicht mehr widersprüchlich')
    vi.spyOn(console, 'error').mockImplementationOnce(() => {})
    c.choose.mockRejectedValueOnce(new Error('netz'))
    expect(await applyMarkedChoice(c.args, 'weighted')).toMatch(/nicht gespeichert/)
    expect(c.reload).not.toHaveBeenCalled()
  })
})

describe('Rechnungswahl — Beschriftung', () => {
  it('Mittelwert zuerst, ct/kWh mit zwei Stellen, Datum TT.MM.JJJJ, geschätzter Zeitraum markiert', () => {
    const texts = orderedOptions(OPEN_WEIGHTED).map((o) => optionText('energyPriceCtPerKwh', o))
    expect(texts).toEqual([
      'Gewichteter Mittelwert: 13,20 ct/kWh (Gewichtung: Lastgang-kWh)',
      '12,35 ct/kWh – 01.01.2025–30.06.2025 – rechnung-2025.pdf',
      '14,10 ct/kWh – 01.07.2025–31.12.2025 – rechnung-2026.pdf (Zeitraum geschätzt)',
    ])
  })
})
