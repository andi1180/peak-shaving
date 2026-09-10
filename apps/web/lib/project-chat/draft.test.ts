import { describe, expect, it } from 'vitest'
import { tariffParamsSchema } from 'shared'

import {
  DRAFT_PROVENANCE_KEY,
  checkDraftCompleteness,
  provenanceKeyCollidesWithContract,
  readDraftProvenance,
  setDraftField,
} from './draft'
import { DRAFT_CONTRACT_FIELDS, DRAFT_REQUIRED_FIELDS } from './tools'

/**
 * B24 — DER ENTWURF UND SEINE HERKUNFTS-VERMERKE.
 *
 * Die eine Eigenschaft, die dieses Modul trägt und die man nur MESSEN und nicht behaupten kann:
 * der Seiteneintrag `_provenance` darf die Contract-Prüfung nicht kaputt machen. Er hängt an einer
 * zod-Eigenschaft (`z.object` ohne `.strict()` entfernt unbekannte Schlüssel, statt zu meckern) —
 * eine Annahme über eine fremde Bibliothek, und deshalb steht sie hier als Test und nicht als
 * Kommentar.
 */

const NOW = new Date('2026-09-10T08:00:00.000Z')

/** Ein Entwurf, der den Contract vollständig erfüllt — als Ausgangspunkt für die Randfälle. */
function completeDraft(): Record<string, unknown> {
  return {
    leistungspreisEurPerKwYear: 38.52,
    billingModel: 'monthly_max_average',
    minBillableKw: 0,
    energyPriceCtPerKwh: 24.4,
    einspeiseverguetungCtPerKwh: 8,
  }
}

describe('Herkunfts-Seiteneintrag', () => {
  it('⚠ macht die Contract-Prüfung NICHT kaputt — gegen zod gemessen, nicht angenommen', () => {
    let draft: Record<string, unknown> = completeDraft()
    for (const field of Object.keys(completeDraft())) {
      draft = setDraftField(draft, field, draft[field] as number, 'measured', undefined, NOW)
    }

    expect(draft[DRAFT_PROVENANCE_KEY]).toBeDefined()

    const parsed = tariffParamsSchema.safeParse(draft)
    expect(parsed.success).toBe(true)
    // Und zod trägt den Seiteneintrag NICHT in das Ergebnis — er bleibt reine Ablage.
    if (parsed.success) expect(DRAFT_PROVENANCE_KEY in parsed.data).toBe(false)
  })

  it('⚠ kollidiert mit keinem Contract-Feld', () => {
    expect(provenanceKeyCollidesWithContract()).toBe(false)
  })

  it('trägt Quelle und Begründung je Feld und überschreibt bei einer Korrektur', () => {
    let draft = setDraftField({}, 'energyPriceCtPerKwh', 24.4, 'assumed', ' geschätzt ', NOW)
    expect(readDraftProvenance(draft).energyPriceCtPerKwh).toEqual({
      source: 'assumed',
      note: 'geschätzt',
      at: NOW.toISOString(),
    })

    const later = new Date('2026-09-10T09:00:00.000Z')
    draft = setDraftField(draft, 'energyPriceCtPerKwh', 25.1, 'measured', undefined, later)
    expect(draft.energyPriceCtPerKwh).toBe(25.1)
    // Die Korrektur ersetzt den Vermerk vollständig — eine Annahme bleibt nicht als Rest hängen.
    expect(readDraftProvenance(draft).energyPriceCtPerKwh).toEqual({
      source: 'measured',
      at: later.toISOString(),
    })
  })

  it('verwirft einen kaputten Seiteneintrag, statt daran zu scheitern', () => {
    expect(readDraftProvenance({ [DRAFT_PROVENANCE_KEY]: 'kaputt' })).toEqual({})
    expect(readDraftProvenance({ [DRAFT_PROVENANCE_KEY]: { a: { source: 'erfunden' } } })).toEqual({})
  })
})

describe('Feldlisten kommen aus tariffParamsSchema', () => {
  it('⚠ sind nicht abgeschrieben — sie enthalten genau die Schlüssel des Schemas', () => {
    expect(DRAFT_CONTRACT_FIELDS).toEqual(Object.keys(tariffParamsSchema.shape).sort())
    // Positivkontrolle: es gibt beides, Pflicht- und optionale Felder.
    expect(DRAFT_REQUIRED_FIELDS.length).toBeGreaterThan(0)
    expect(DRAFT_REQUIRED_FIELDS.length).toBeLessThan(DRAFT_CONTRACT_FIELDS.length)
    // Und die Leistungsmessungs-Variante ist seit B24 im Contract, aber optional.
    expect(DRAFT_CONTRACT_FIELDS).toContain('meteringVariant')
    expect(DRAFT_REQUIRED_FIELDS).not.toContain('meteringVariant')
  })
})

describe('checkDraftCompleteness', () => {
  it('nennt fehlende Pflichtfelder und trennt sie von Typfehlern', () => {
    const state = checkDraftCompleteness({ leistungspreisEurPerKwYear: 'zu viel' })
    expect(state.complete).toBe(false)
    expect(state.missing).toEqual(
      DRAFT_REQUIRED_FIELDS.filter((f) => f !== 'leistungspreisEurPerKwYear'),
    )
    // Der vorhandene, aber falsch getypte Wert steht NICHT unter „fehlt".
    expect(state.missing).not.toContain('leistungspreisEurPerKwYear')
    expect(state.invalid.map((i) => i.field)).toContain('leistungspreisEurPerKwYear')
  })

  it('⚠ ein Entwurf ohne Herkunftsvermerke ist NICHT vollständig (§3.2)', () => {
    const state = checkDraftCompleteness(completeDraft())
    expect(state.missing).toEqual([])
    expect(state.invalid).toEqual([])
    expect(state.withoutSource.sort()).toEqual(Object.keys(completeDraft()).sort())
    expect(state.complete).toBe(false)
  })

  it('⚠ eine ANNAHME hindert die Vollständigkeit dagegen nicht — das ist Weg (b)', () => {
    let draft: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(completeDraft())) {
      draft = setDraftField(draft, field, value as number, 'assumed', 'geschätzt', NOW)
    }
    const state = checkDraftCompleteness(draft)
    expect(state.complete).toBe(true)
    expect(state.assumed.sort()).toEqual(Object.keys(completeDraft()).sort())
  })

  it('meldet ein erfundenes Feld als ungeprüft, statt es abzuweisen', () => {
    const draft = setDraftField(completeDraft(), 'stromkosten', 1200, 'measured', undefined, NOW)
    expect(checkDraftCompleteness(draft).unknown).toEqual(['stromkosten'])
  })
})
