import { describe, expect, it } from 'vitest'
import { isTextEntry, quickAccessVariant } from './quick-access'

describe('Schnellzugriff (Leadgen 6)', () => {
  it('Marketing-Seiten: Profi-Report, auf /profi-report: Jetzt anfragen, Ausnahmen: keiner', () => {
    for (const path of ['/', '/peak-shaving', '/wissen/leistungspreis', '/partner/muster', '/de']) {
      expect(quickAccessVariant(path)).toBe('profi_report')
    }
    expect(quickAccessVariant('/profi-report')).toBe('jetzt_anfragen')
    expect(quickAccessVariant('/de/profi-report/')).toBe('jetzt_anfragen')
    for (const path of [
      '/abmelden',
      '/einwilligung-bestaetigen',
      '/konto',
      '/anmelden',
      '/partner-portal',
      '/kalkulator/projekte/1',
      '/peak-shaving/kalkulator/rechner',
    ]) {
      expect(quickAccessVariant(path)).toBeNull()
    }
    expect(quickAccessVariant('/peak-shaving/kalkulator')).toBe('profi_report')
  })

  it('Eingabe-, Auswahl- und Textfelder zählen, Knöpfe und Häkchen nicht', () => {
    expect(isTextEntry({ tagName: 'INPUT', type: 'text' })).toBe(true)
    expect(isTextEntry({ tagName: 'INPUT', type: 'number' })).toBe(true)
    expect(isTextEntry({ tagName: 'SELECT' })).toBe(true)
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTextEntry({ tagName: 'INPUT', type: 'checkbox' })).toBe(false)
    expect(isTextEntry({ tagName: 'A' })).toBe(false)
    expect(isTextEntry(null)).toBe(false)
  })
})
