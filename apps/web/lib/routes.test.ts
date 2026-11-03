import { describe, expect, it } from 'vitest'
import { CALCULATOR_RUN_HREF } from './nav'
import { KALKULATOR_PRODUCT_HREF, robotsFor, SITE_ROUTES } from './routes'

const indexable = (href: string) => SITE_ROUTES.find((r) => r.href === href)?.indexable

describe('Kalkulator-Seite', () => {
  it('ist indexierbar und steht damit in der sitemap', () => {
    expect(KALKULATOR_PRODUCT_HREF).toBe('/peak-shaving/kalkulator')
    expect(indexable(KALKULATOR_PRODUCT_HREF)).toBe(true)
    expect(robotsFor(KALKULATOR_PRODUCT_HREF)).toBeUndefined()
  })

  it('lässt andere Seiten unverändert', () => {
    expect(indexable('/profi-report')).toBe(true)
    expect(robotsFor('/profi-report')).toBeUndefined()
    expect(robotsFor(CALCULATOR_RUN_HREF)).toEqual({ index: false, follow: true })
  })
})
