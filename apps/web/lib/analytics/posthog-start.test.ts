import { describe, expect, it, vi } from 'vitest'
import { robotsFor, SITE_ROUTES } from '@/lib/routes'
import { INTERNAL_DEVICE_KEY, INTERN_HREF, type DeviceStorage } from './internal-device'
import {
  fetchLand,
  LAND_TIMEOUT_MS,
  posthogInitOptions,
  startPostHog,
  type PostHogLike,
} from './posthog-start'

function memoryStorage(entries: Record<string, string> = {}): DeviceStorage {
  const map = new Map(Object.entries(entries))
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

const brokenStorage: DeviceStorage = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('SecurityError')
  },
  removeItem: () => {
    throw new Error('SecurityError')
  },
}

/** Wie posthog-js: `init` schickt den ersten `$pageview` per setTimeout, mit den registrierten Eigenschaften. */
function fakePostHog() {
  const registered: Record<string, string> = {}
  const captured: { event: string; properties: object }[] = []
  const posthog = {
    init: vi.fn(() => {
      setTimeout(() => captured.push({ event: '$pageview', properties: { ...registered } }), 1)
    }),
    register: vi.fn((props: Record<string, string>) => Object.assign(registered, props)),
    capture: vi.fn(),
  } satisfies PostHogLike
  return { posthog, captured }
}

function harness(
  pathname: string,
  store: DeviceStorage | null,
  getLand: () => Promise<string | null> = async () => null,
) {
  const { posthog, captured } = fakePostHog()
  const load = vi.fn(async () => posthog)
  const land = vi.fn(getLand)
  const onReady = vi.fn()
  const started = startPostHog({
    key: 'phc_test',
    apiHost: 'https://eu.i.posthog.com',
    pathname,
    store,
    load,
    getLand: land,
    isCancelled: () => false,
    onReady,
  })
  return { started, posthog, captured, load, getLand: land, onReady }
}

describe('posthogInitOptions', () => {
  it('sendet $pageleave ausdrücklich, cookielos und ohne Replay', () => {
    const options = posthogInitOptions('https://eu.i.posthog.com')
    expect(options.capture_pageleave).toBe(true)
    expect(options.capture_pageview).toBe('history_change')
    expect(options.cookieless_mode).toBe('always')
    expect(options.autocapture).toBe(false)
    expect(options.disable_session_recording).toBe(true)
  })
})

describe('startPostHog', () => {
  it('initialisiert ohne Markierung genau einmal', async () => {
    const h = harness('/', memoryStorage())
    expect(await h.started).toBe(true)
    expect(h.posthog.init).toHaveBeenCalledOnce()
    expect(h.posthog.init).toHaveBeenCalledWith(
      'phc_test',
      posthogInitOptions('https://eu.i.posthog.com'),
    )
    expect(h.onReady).toHaveBeenCalledWith(h.posthog)
  })

  it('trägt das Land schon im ersten $pageview', async () => {
    const h = harness('/', memoryStorage(), async () => 'AT')
    expect(await h.started).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(h.posthog.register).toHaveBeenCalledWith({ land: 'AT' })
    expect(h.captured).toEqual([{ event: '$pageview', properties: { land: 'AT' } }])
  })

  it('startet bei Fehler oder Timeout der Land-Abfrage genau einmal ohne Land', async () => {
    const fetchStub = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchStub)
    const failed = harness('/', memoryStorage(), () => fetchLand())
    expect(await failed.started).toBe(true)
    expect(fetchStub).toHaveBeenCalledOnce()
    expect(failed.posthog.init).toHaveBeenCalledOnce()
    expect(failed.posthog.register).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('bricht eine hängende Land-Abfrage nach dem Timeout ab', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
          ),
      ),
    )
    const started = Date.now()
    expect(await fetchLand()).toBeNull()
    expect(Date.now() - started).toBeGreaterThanOrEqual(LAND_TIMEOUT_MS - 50)
    vi.unstubAllGlobals()
  })

  it('lädt, fragt und initialisiert auf einem markierten Gerät nichts', async () => {
    const h = harness('/', memoryStorage({ [INTERNAL_DEVICE_KEY]: '1' }), async () => 'AT')
    expect(await h.started).toBe(false)
    expect(h.getLand).not.toHaveBeenCalled()
    expect(h.load).not.toHaveBeenCalled()
    expect(h.posthog.init).not.toHaveBeenCalled()
    expect(h.onReady).not.toHaveBeenCalled()
  })

  it('misst normal, wenn der Speicher fehlt oder wirft, und nie auf /intern', async () => {
    expect(await harness('/', brokenStorage).started).toBe(true)
    expect(await harness('/', null).started).toBe(true)
    const intern = harness(INTERN_HREF, memoryStorage())
    expect(await intern.started).toBe(false)
    expect(intern.load).not.toHaveBeenCalled()
  })
})

describe('/intern', () => {
  it('ist noindex und damit nicht in der sitemap', () => {
    expect(SITE_ROUTES.find((r) => r.href === INTERN_HREF)?.indexable).toBe(false)
    expect(robotsFor(INTERN_HREF)).toEqual({ index: false, follow: true })
  })
})
