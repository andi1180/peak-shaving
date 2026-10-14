import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readDraftDynamicTariff } from 'shared'

/** Vorbelegung des dynamischen Tarifs beim Anlegen von Zählpunkten (nur neue, nur AT). */

const rpc = vi.fn()
const createClient = vi.fn(async () => ({ rpc }))
const redirect = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClient() }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({ redirect: (href: string) => redirect(href) }))

const { setMeteringPointCountAction } = await import('./data-entry-actions-segment')

const PROJECT_ID = '11111111-2222-4333-8444-555555555555'
const EXISTING_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa'
const KEYS = ['dynamicSupplierName', 'dynamicMarkupCtPerKwh', 'dynamicBaseFeeEurPerMonth']

let country: 'AT' | 'DE' = 'AT'
let points: { id: string; draft: Record<string, unknown> }[] = []

beforeEach(() => {
  vi.clearAllMocks()
  points = [{ id: EXISTING_ID, draft: { energyPriceCtPerKwh: 24.5 } }]
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'admin_get_project') {
      return { data: { status: 'ok', project: { id: PROJECT_ID, country } }, error: null }
    }
    if (fn === 'list_metering_points') {
      return { data: { status: 'ok', metering_points: structuredClone(points) }, error: null }
    }
    if (fn === 'admin_set_metering_point_count') {
      const target = args.p_count as number
      while (points.length < target) {
        const n = String(points.length).padStart(12, '0')
        points.push({ id: `00000000-0000-4000-8000-${n}`, draft: {} })
      }
      return { data: { status: 'ok' }, error: null }
    }
    if (fn === 'update_metering_point_draft') {
      const point = points.find((p) => p.id === args.p_metering_point_id)!
      point.draft = args.p_draft as Record<string, unknown>
      return { data: { status: 'ok' }, error: null }
    }
    throw new Error(`unerwarteter Wrapper: ${fn}`)
  })
})

function countForm(count: number): FormData {
  const fd = new FormData()
  fd.set('projectId', PROJECT_ID)
  fd.set('count', String(count))
  return fd
}

describe('Zählpunkte anlegen — Vorbelegung dynamischer Tarif', () => {
  it('AT: neue Zählpunkte tragen aWATTar HOURLY, der bestehende bleibt unberührt', async () => {
    country = 'AT'
    await setMeteringPointCountAction({}, countForm(3))

    expect(redirect).toHaveBeenCalledOnce()
    const [existing, ...created] = points
    expect(existing?.draft).toEqual({ energyPriceCtPerKwh: 24.5 })
    expect(created).toHaveLength(2)
    for (const point of created) {
      expect(point.draft).toMatchObject({
        dynamicSupplierName: 'aWATTar HOURLY',
        dynamicMarkupCtPerKwh: 1.5,
        dynamicBaseFeeEurPerMonth: 4.79,
      })
      expect(readDraftDynamicTariff(point.draft)).toEqual({
        supplier: 'aWATTar HOURLY',
        markupCtPerKwh: 1.5,
        baseFeeEurPerMonth: 4.79,
      })
    }
  })

  it('DE: neue Zählpunkte bekommen keine Schlüssel', async () => {
    country = 'DE'
    await setMeteringPointCountAction({}, countForm(2))

    expect(redirect).toHaveBeenCalledOnce()
    expect(points).toHaveLength(2)
    for (const point of points) for (const key of KEYS) expect(key in point.draft).toBe(false)
    expect(rpc.mock.calls.some(([fn]) => fn === 'update_metering_point_draft')).toBe(false)
  })
})
