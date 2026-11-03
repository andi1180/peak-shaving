import { describe, expect, it, vi } from 'vitest'
import { robotsFor, SITE_ROUTES } from '@/lib/routes'
import { INTERNAL_DEVICE_KEY, INTERN_HREF, type DeviceStorage } from './internal-device'
import { posthogInitOptions, startPostHog, type PostHogLike } from './posthog-start'

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

function harness(pathname: string, store: DeviceStorage | null) {
  const posthog: PostHogLike = { init: vi.fn(), capture: vi.fn() }
  const load = vi.fn(async () => posthog)
  const onReady = vi.fn()
  const started = startPostHog({
    key: 'phc_test',
    apiHost: 'https://eu.i.posthog.com',
    pathname,
    store,
    load,
    isCancelled: () => false,
    onReady,
  })
  return { started, posthog, load, onReady }
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

  it('lädt und initialisiert auf einem markierten Gerät nichts', async () => {
    const h = harness('/', memoryStorage({ [INTERNAL_DEVICE_KEY]: '1' }))
    expect(await h.started).toBe(false)
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
