import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import messages from '@/messages/de.json'
import { BRANCHE_KEYS, type BrancheKey, type SchnellreportInput } from './content'
import { renderSchnellreportPdf } from './render'
import { SCHNELLREPORT_SETTINGS } from './settings'

// Text über poppler (`pdftotext`); die rohen Textoperanden sind durch das Font-Subsetting unlesbar.
const dir = mkdtempSync(path.join(tmpdir(), 'schnellreport-'))

function pdfText(pdf: Buffer): { text: string; pages: number } {
  const file = path.join(dir, `${Math.random().toString(36).slice(2)}.pdf`)
  writeFileSync(file, pdf)
  const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' })
  const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' })
  return { text, pages: Number(/Pages:\s+(\d+)/.exec(info)?.[1]) }
}

/** Zeilenumbrüche und Mehrfach-Leerzeichen des Layouts entfernen, damit Sätze vergleichbar sind. */
const flat = (text: string) => text.replace(/\s+/g, ' ')

const example = (over: Partial<SchnellreportInput> = {}): SchnellreportInput => ({
  country: 'AT',
  kwh: 250_000,
  kw: 180,
  sliderKw: 150,
  bill: 65_000,
  firma: 'Muster Metallbau GmbH',
  branche: 'produktion',
  createdAt: new Date('2026-10-19T10:00:00Z'),
  ...over,
})

const branchText = (key: BrancheKey) => messages.Schnellreport.branchen[key].text

describe('renderSchnellreportPdf', () => {
  it('rechnet AT mit 67 €/kW: 180 kW → rund 12.100 €, vier Seiten, Rechnungsbalken', async () => {
    const { text, pages } = pdfText(await renderSchnellreportPdf(example()))
    const t = flat(text)
    expect(pages).toBe(4)
    expect(t).toContain('rund 12.100 €')
    expect(t).toContain('67 €/kW')
    expect(t).toContain('−1.200 €')
    expect(t).toContain('Stromrechnung gesamt 65.000 €')
    expect(t).toContain('Seite 4 von 4')
    expect(t).toContain('1. Jänner 2027')
    expect(t).toContain('Erstellt am 19. Oktober 2026')
  })

  it('rechnet DE nach Benutzungsdauer: 1.389 h → 34 €/kW → rund 6.100 €', async () => {
    const { text, pages } = pdfText(await renderSchnellreportPdf(example({ country: 'DE' })))
    const t = flat(text)
    expect(pages).toBe(4)
    expect(t).toContain('rund 6.100 €')
    expect(t).toContain('1.389 Benutzungsstunden')
    expect(t).toContain('2.500 Stunden')
    expect(t).not.toContain('1. Jänner 2027')
  })

  it.each(BRANCHE_KEYS)('Branche %s: vier Seiten mit dem richtigen Branchentext', async (key) => {
    const { text, pages } = pdfText(await renderSchnellreportPdf(example({ branche: key })))
    expect(pages).toBe(4)
    expect(flat(text)).toContain(flat(branchText(key)))
  })

  it('lässt leere Kontaktfelder weg statt Platzhalter zu drucken', async () => {
    const settings = { ...SCHNELLREPORT_SETTINGS, contactName: '', phone: '' }
    const t = flat(pdfText(await renderSchnellreportPdf(example(), settings)).text)
    expect(t).toContain('energy@coolin.at')
    expect(t.match(/\[/g) ?? []).toHaveLength(0)
    expect(t).not.toContain('Ihr Ansprechpartner')
    expect(t).not.toContain('Telefon')
  })

  it('ohne Rechnung entfällt der Rechnungsbalken', async () => {
    const t = flat(pdfText(await renderSchnellreportPdf(example({ bill: null }))).text)
    expect(t).not.toContain('Anteil an Ihrer Stromrechnung')
    expect(t).not.toContain('Stromrechnung gesamt')
    expect(t).toContain('rund 12.100 €')
  })
})
