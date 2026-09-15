import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  TARIFF_COMPARISON_BASE_FEE_KEY,
  TARIFF_COMPARISON_ENERGY_PRICE_KEY,
  TARIFF_COMPARISON_PRICE_BASIS_KEY,
  TARIFF_COMPARISON_PROVIDER_NAME_KEY,
} from './tariff-draft'

/**
 * B24, Teil 1 — die TARIF-Station.
 *
 * ⚠ Bis zum 15.09.2026 prüfte diese Datei zusätzlich `saveMeteringPointTariffPreferenceAction`
 * („behalten" gegen „optimieren"). Die Action ist ERSATZLOS entfernt — der Tarifvergleich mit
 * aWATTar ist keine Kundenentscheidung mehr, sondern automatisch; die Begründung steht im Kopf von
 * `data-entry-actions-tarif.ts`. Übrig bleibt die eine ANGABE, die diese Station noch erhebt.
 */

const rpc = vi.fn()
const createClient = vi.fn(async () => ({ rpc }))
const revalidatePath = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClient() }))
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }))

const { saveMeteringPointTariffComparisonAction } = await import('./data-entry-actions-tarif')

const PROJECT_ID = '11111111-2222-4333-8444-555555555555'
const POINT_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa'

/** Ein bereits gelesener Stand, wie ihn die Rechnungs-Station hinterlässt. */
const EXISTING = { energyPriceCtPerKwh: 24.5 }

let draft: Record<string, unknown> = {}

/** Der Entwurf-Fake ist zustandsbehaftet und ERSETZT — genau die Semantik des Wrappers. */
function withDraftWrappers() {
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'list_metering_points') {
      return { data: { status: 'ok', metering_points: [{ id: POINT_ID, draft }] }, error: null }
    }
    if (fn === 'update_metering_point_draft') {
      draft = args.p_draft as Record<string, unknown>
      return { data: { status: 'ok' }, error: null }
    }
    throw new Error(`unerwarteter Wrapper: ${fn}`)
  })
}

/**
 * Der selbst gefundene Vergleichstarif (15.09.2026).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WAS SICH NUR HIER PRÜFEN LÄSST — ZWEI DINGE, UND BEIDE WÄREN IN DER DATENBANK UNSICHTBAR
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * (1) DAS DEZIMALKOMMA. Die Karte formatiert de-AT, und der Nutzer tippt genau das ab, was auf dem
 * Vergleichsportal steht („14,94"). `Number('14,94')` ist `NaN` — ohne `.replace(',', '.')` würde
 * der Regelfall als „keine Zahl" abgewiesen. Gemessen werden deshalb BEIDE Schreibweisen, und dass
 * sie denselben Wert ergeben.
 *
 * (2) DASS ALLE VIER FELDER GEMEINSAM GELTEN. `update_metering_point_draft` nimmt ein beliebiges
 * jsonb entgegen und kennt kein Vokabular für Vergleichstarife — ein halb gefüllter Eintrag
 * (Preis ohne Preisbasis) liefe dort widerspruchslos durch und stünde danach als vollständiger
 * Vergleich in der Zusammenfassung. Geprüft wird deshalb je Feld, dass GAR KEIN Wrapper-Aufruf
 * entsteht.
 */

/** Ein vollständiger, gültiger Vergleich — Grundlage aller Feld-Proben. */
const VALID_COMPARISON = {
  providerName: 'Beispiel Energie',
  energyPriceCtPerKwh: '14,94',
  baseFeeEurPerMonth: '3,90',
  priceBasis: 'net',
}

function comparisonForm(overrides: Partial<typeof VALID_COMPARISON> = {}): FormData {
  const fd = new FormData()
  fd.set('projectId', PROJECT_ID)
  fd.set('meteringPointId', POINT_ID)
  for (const [key, value] of Object.entries({ ...VALID_COMPARISON, ...overrides })) {
    fd.set(key, value)
  }
  return fd
}

const COMPARISON_KEYS = [
  TARIFF_COMPARISON_PROVIDER_NAME_KEY,
  TARIFF_COMPARISON_ENERGY_PRICE_KEY,
  TARIFF_COMPARISON_BASE_FEE_KEY,
  TARIFF_COMPARISON_PRICE_BASIS_KEY,
]

describe('Tarif-Station — Vergleichstarif', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    draft = { ...EXISTING }
    withDraftWrappers()
  })

  it('schreibt alle vier Felder in EINEM Aufruf — Komma als Dezimaltrennzeichen', async () => {
    const state = await saveMeteringPointTariffComparisonAction({}, comparisonForm())

    expect(state.fieldErrors).toBeUndefined()
    expect(state.formError).toBeUndefined()
    expect(state.success).toContain('Beispiel Energie')

    expect(draft[TARIFF_COMPARISON_PROVIDER_NAME_KEY]).toBe('Beispiel Energie')
    // ⚠ ZAHL, nicht Zeichenkette: jeder spätere Leser müsste sonst die Komma-Frage erneut stellen.
    expect(draft[TARIFF_COMPARISON_ENERGY_PRICE_KEY]).toBe(14.94)
    expect(draft[TARIFF_COMPARISON_BASE_FEE_KEY]).toBe(3.9)
    expect(draft[TARIFF_COMPARISON_PRICE_BASIS_KEY]).toBe('net')

    // Der Bestand der übrigen Stationen bleibt unberührt.
    expect(draft.energyPriceCtPerKwh).toBe(EXISTING.energyPriceCtPerKwh)

    // GENAU EIN Schreibvorgang für vier Felder — `update_metering_point_draft` ERSETZT den
    // Entwurf, vier Aufrufe nähmen einander die Felder wieder weg.
    expect(rpc.mock.calls.filter(([fn]) => fn === 'update_metering_point_draft')).toHaveLength(1)
    expect(revalidatePath).toHaveBeenCalledTimes(1)
  })

  it('nimmt denselben Betrag auch mit Punkt als Dezimaltrennzeichen an', async () => {
    const state = await saveMeteringPointTariffComparisonAction(
      {},
      comparisonForm({ energyPriceCtPerKwh: '14.94', baseFeeEurPerMonth: '3.90' }),
    )

    expect(state.fieldErrors).toBeUndefined()
    expect(state.success).toBeDefined()
    // Bit-gleich zum Komma-Lauf: die zwei Schreibweisen sind derselbe Preis.
    expect(draft[TARIFF_COMPARISON_ENERGY_PRICE_KEY]).toBe(14.94)
    expect(draft[TARIFF_COMPARISON_BASE_FEE_KEY]).toBe(3.9)
  })

  it.each([
    ['providerName', { providerName: '   ' }, 'providerName'],
    ['priceBasis', { priceBasis: 'quatsch' }, 'priceBasis'],
    ['energyPriceCtPerKwh (leer)', { energyPriceCtPerKwh: '' }, 'energyPriceCtPerKwh'],
    ['energyPriceCtPerKwh (keine Zahl)', { energyPriceCtPerKwh: 'abc' }, 'energyPriceCtPerKwh'],
    ['energyPriceCtPerKwh (negativ)', { energyPriceCtPerKwh: '-1' }, 'energyPriceCtPerKwh'],
    ['baseFeeEurPerMonth (leer)', { baseFeeEurPerMonth: '' }, 'baseFeeEurPerMonth'],
    ['baseFeeEurPerMonth (keine Zahl)', { baseFeeEurPerMonth: 'abc' }, 'baseFeeEurPerMonth'],
    ['baseFeeEurPerMonth (negativ)', { baseFeeEurPerMonth: '-0,5' }, 'baseFeeEurPerMonth'],
  ])(
    '⚠ weist %s ab, OHNE die Datenbank zu fragen',
    async (_name, overrides: Partial<typeof VALID_COMPARISON>, field: string) => {
      const state = await saveMeteringPointTariffComparisonAction({}, comparisonForm(overrides))

      expect(state.fieldErrors?.[field]).toBeDefined()
      expect(state.success).toBeUndefined()
      // Ohne Aufruf kein Schreibvorgang — der Wrapper könnte den halben Vergleich nicht abweisen.
      expect(rpc).not.toHaveBeenCalled()
      expect(revalidatePath).not.toHaveBeenCalled()
      for (const key of COMPARISON_KEYS) expect(draft).not.toHaveProperty(key)
    },
  )

  it('⚠ ein leeres Betragsfeld gilt NICHT als 0 — `Number("")` ist 0 und wäre endlich', async () => {
    const state = await saveMeteringPointTariffComparisonAction(
      {},
      comparisonForm({ energyPriceCtPerKwh: '' }),
    )

    expect(state.fieldErrors?.energyPriceCtPerKwh).toBeDefined()
    expect(draft).not.toHaveProperty(TARIFF_COMPARISON_ENERGY_PRICE_KEY)
  })

  it('gibt eine entzogene Rolle als solche zurück, ohne den Entwurf anzufassen', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } })

    const state = await saveMeteringPointTariffComparisonAction({}, comparisonForm())

    expect(state.formError).toBe('Keine Berechtigung. Bitte laden Sie die Seite neu.')
    expect(state.success).toBeUndefined()
    for (const key of COMPARISON_KEYS) expect(draft).not.toHaveProperty(key)
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
