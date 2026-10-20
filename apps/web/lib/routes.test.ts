import { describe, expect, it } from 'vitest'
import { CALCULATOR_RUN_HREF } from './nav'
import { KALKULATOR_PRODUCT_HREF, robotsFor, SITE_ROUTES } from './routes'

const indexable = (href: string) => SITE_ROUTES.find((r) => r.href === href)?.indexable

describe('Kalkulator-Produktseite (Leadgen 7b)', () => {
  it('steht nicht in der sitemap und trägt noindex, nofollow', () => {
    expect(KALKULATOR_PRODUCT_HREF).toBe('/peak-shaving/kalkulator')
    expect(indexable(KALKULATOR_PRODUCT_HREF)).toBe(false)
    expect(robotsFor(KALKULATOR_PRODUCT_HREF)).toEqual({ index: false, follow: false })
  })

  it('lässt andere Seiten unverändert', () => {
    expect(indexable('/profi-report')).toBe(true)
    expect(robotsFor('/profi-report')).toBeUndefined()
    expect(robotsFor(CALCULATOR_RUN_HREF)).toEqual({ index: false, follow: true })
  })
})
