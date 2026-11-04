import { NextRequest, NextResponse } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import { middleware } from '../middleware'

vi.mock('next-intl/middleware', () => ({ default: () => () => NextResponse.next() }))
vi.mock('./supabase/middleware', () => ({
  updateSession: async (_request: NextRequest, response: NextResponse) => response,
}))

function robotsTagFor(host: string, path = '/'): Promise<string | null> {
  const request = new NextRequest(`https://${host}${path}`, { headers: { host } })
  return middleware(request).then((response) => response.headers.get('x-robots-tag'))
}

describe('X-Robots-Tag je Host', () => {
  it.each([
    'partner.coolin.at',
    'access.coolin.at',
    'peak-shaving-web.vercel.app',
    'peak-shaving-web-abc123-coolin.vercel.app',
  ])('%s bekommt noindex', async (host) => {
    expect(await robotsTagFor(host)).toBe('noindex')
  })

  it('auch eine 308-Weiche auf dem Portal-Host trägt noindex', async () => {
    expect(await robotsTagFor('partner.coolin.at', '/peak-shaving')).toBe('noindex')
  })

  it.each(['www.coolin.at', 'localhost:3000'])('%s bleibt ohne Header', async (host) => {
    expect(await robotsTagFor(host)).toBeNull()
  })
})
