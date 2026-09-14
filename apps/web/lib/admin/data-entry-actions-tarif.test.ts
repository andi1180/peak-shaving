import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TARIFF_PREFERENCE_KEY } from './tariff-draft'

/**
 * B24, Teil 1 — die TARIF-Station.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WAS SICH NUR HIER PRÜFEN LÄSST: DASS EIN UNBEKANNTER WUNSCH DIE DATENBANK NICHT ERREICHT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der Wrapper `update_metering_point_draft` nimmt ein beliebiges jsonb entgegen und kennt kein
 * Vokabular für Tarifwünsche — er könnte einen erfundenen Wert gar nicht abweisen. Die einzige
 * Stelle, an der `'quatsch'` scheitert, ist diese Action, und ohne sie stünde der Wert als Wunsch
 * im Entwurf, den später niemand deuten kann. Gemessen wird deshalb nicht nur die Fehlermeldung,
 * sondern dass KEIN Wrapper-Aufruf entsteht.
 */

const rpc = vi.fn()
const createClient = vi.fn(async () => ({ rpc }))
const revalidatePath = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClient() }))
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }))

const { saveMeteringPointTariffPreferenceAction } = await import('./data-entry-actions-tarif')

const PROJECT_ID = '11111111-2222-4333-8444-555555555555'
const POINT_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa'

/** Ein bereits gelesener Stand, wie ihn die Rechnungs-Station hinterlässt. */
const EXISTING = { energyPriceCtPerKwh: 24.5 }

let draft: Record<string, unknown> = {}

function form(preference: string): FormData {
  const fd = new FormData()
  fd.set('projectId', PROJECT_ID)
  fd.set('meteringPointId', POINT_ID)
  fd.set('preference', preference)
  return fd
}

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

describe('Tarif-Station', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    draft = { ...EXISTING }
    withDraftWrappers()
  })

  it('schreibt beide Wünsche als je EIN Feld und benennt sie verschieden', async () => {
    const behalten = await saveMeteringPointTariffPreferenceAction({}, form('behalten'))

    expect(behalten.formError).toBeUndefined()
    expect(behalten.success).toContain('beibehalten')
    expect(draft[TARIFF_PREFERENCE_KEY]).toBe('behalten')

    // Gezählt statt aufgezählt: GENAU EIN neuer Schlüssel neben `_provenance`.
    const added = Object.keys(draft).filter((key) => !Object.keys(EXISTING).includes(key))
    expect(added.filter((key) => key !== '_provenance')).toEqual([TARIFF_PREFERENCE_KEY])
    // Der Bestand der Rechnungs-Station bleibt unberührt.
    expect(draft.energyPriceCtPerKwh).toBe(EXISTING.energyPriceCtPerKwh)

    // Ein zweiter Klick ÄNDERT die Wahl, er legt keine zweite an.
    const optimieren = await saveMeteringPointTariffPreferenceAction({}, form('optimieren'))

    expect(optimieren.formError).toBeUndefined()
    expect(optimieren.success).toContain('optimalen Tarif')
    expect(draft[TARIFF_PREFERENCE_KEY]).toBe('optimieren')

    // ⚠ Die zwei Meldungen müssen sich unterscheiden — sonst sagt die Oberfläche nach beiden
    // Klicks dasselbe, und niemand sieht, was gerade gespeichert wurde.
    expect(optimieren.success).not.toBe(behalten.success)

    expect(rpc.mock.calls.filter(([fn]) => fn === 'update_metering_point_draft')).toHaveLength(2)
    expect(revalidatePath).toHaveBeenCalledTimes(2)
  })

  it('⚠ weist einen unbekannten Wunsch ab, OHNE die Datenbank zu fragen', async () => {
    const state = await saveMeteringPointTariffPreferenceAction({}, form('quatsch'))

    expect(state.formError).toBeDefined()
    expect(state.success).toBeUndefined()
    // Ohne Aufruf kein Schreibvorgang — der Wrapper könnte den Wert nicht abweisen.
    expect(rpc).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(draft).not.toHaveProperty(TARIFF_PREFERENCE_KEY)
  })

  it('gibt eine entzogene Rolle als solche zurück, ohne den Entwurf anzufassen', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } })

    const state = await saveMeteringPointTariffPreferenceAction({}, form('behalten'))

    expect(state.formError).toBe('Keine Berechtigung. Bitte laden Sie die Seite neu.')
    expect(state.success).toBeUndefined()
    expect(draft).not.toHaveProperty(TARIFF_PREFERENCE_KEY)
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
