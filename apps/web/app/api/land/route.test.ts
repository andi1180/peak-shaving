import { describe, expect, it } from 'vitest'
import { GET } from './route'

function call(country?: string) {
  const headers = new Headers({ 'x-forwarded-for': '203.0.113.7' })
  if (country !== undefined) headers.set('x-vercel-ip-country', country)
  return GET(new Request('https://www.coolin.at/api/land', { headers }))
}

describe('GET /api/land', () => {
  it('liefert das Kürzel aus dem Vercel-Header, nicht cachebar, ohne Cookie', async () => {
    const response = call('DE')
    expect(await response.json()).toEqual({ land: 'DE' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('liefert null ohne Header und bei ungültigem Kürzel, nie die IP', async () => {
    for (const value of [undefined, 'X1', 'de', 'DEU', '']) {
      const text = await call(value).text()
      expect(JSON.parse(text)).toEqual({ land: null })
      expect(text).not.toContain('203.0.113.7')
    }
  })
})
