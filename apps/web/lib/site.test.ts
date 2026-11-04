import { afterEach, describe, expect, it, vi } from 'vitest'

async function siteWith(url: string | undefined) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', url)
  return import('./site')
}

afterEach(() => vi.unstubAllEnvs())

describe('SITE_URL', () => {
  it.each(['https://coolin.at', 'https://www.coolin.at'])('%s ergibt die www-Basis', async (url) => {
    const site = await siteWith(url)
    expect(site.SITE_URL).toBe('https://www.coolin.at')
    expect(site.IS_PRODUCTION_SITE).toBe(true)
    expect(site.absoluteUrl('/sitemap.xml')).toBe('https://www.coolin.at/sitemap.xml')
  })

  it('eine fremde Adresse bleibt, was sie ist, und gilt nicht als Produktion', async () => {
    const site = await siteWith('https://peak-shaving-web.vercel.app')
    expect(site.SITE_URL).toBe('https://peak-shaving-web.vercel.app')
    expect(site.IS_PRODUCTION_SITE).toBe(false)
  })
})
