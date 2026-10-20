import { describe, expect, it } from 'vitest'
import { formatAttributionLine, parseAttribution, readAttributionFromLocation } from './attribution'

const location = (search: string, pathname = '/profi-report') => ({
  pathname,
  search,
  hostname: 'coolin.at',
})

describe('Herkunft', () => {
  it('liest UTM, Pfad und fremden Referrer-Host aus der Adresse', () => {
    const raw = readAttributionFromLocation(
      location('?utm_source=linkedin&utm_campaign=test&x=1'),
      'https://www.linkedin.com/feed/?trk=abc',
    )
    expect(raw).toEqual({
      landing_path: '/profi-report',
      utm_source: 'linkedin',
      utm_campaign: 'test',
      referrer_host: 'www.linkedin.com',
    })
    const parsed = parseAttribution(raw)
    expect(formatAttributionLine(parsed)).toBe('linkedin/–/test, Einstieg /profi-report')
  })

  it('ohne UTM und ohne fremden Referrer → „direkt"', () => {
    const raw = readAttributionFromLocation(location('', '/'), 'https://coolin.at/wissen')
    expect(raw.referrer_host).toBeUndefined()
    expect(formatAttributionLine(parseAttribution(raw))).toBe('direkt, Einstieg /')
    expect(formatAttributionLine(parseAttribution(undefined))).toBe('direkt')
  })

  it('kürzt Überlanges und verwirft Kaputtes', () => {
    const parsed = parseAttribution({
      utm_source: 'x'.repeat(500),
      utm_medium: 'mail\nBcc: a@b.c',
      utm_campaign: 42,
      landing_path: `/${'p'.repeat(400)}?email=a@b.c`,
      referrer_host: 'evil.com/path',
    })
    expect(parsed.utmSource).toHaveLength(100)
    expect(parsed.utmMedium).toBeNull()
    expect(parsed.utmCampaign).toBeNull()
    expect(parsed.landingPath).toHaveLength(200)
    expect(parsed.landingPath).not.toContain('?')
    expect(parsed.referrerHost).toBeNull()
    expect(parseAttribution({ landing_path: '//evil.com' }).landingPath).toBeNull()
    expect(parseAttribution([1, 2]).utmSource).toBeNull()
  })
})
