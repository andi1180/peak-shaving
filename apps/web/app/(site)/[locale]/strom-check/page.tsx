import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { fetchCurrentTariffRows } from '@/lib/monitor/supabase'
import { mapTariffRows } from '@/lib/monitor/mapping'
import { GratisCheckClient } from '@/components/monitor/gratis-check-client'
import { Container } from '@/components/ui/layout'
import { MONITOR_GRATIS_CHECK_HREF, robotsFor } from '@/lib/routes'

/**
 * §7: die Tarif-Tabelle (T2) ändert sich nur 1×/Tag (zentraler täglicher
 * Scraper) — Route-Segment-Cache-Default für jeden `fetch` in diesem Segment,
 * inkl. des über `lib/monitor/supabase.ts` injizierten `next.revalidate`.
 */
export const revalidate = 86400

export function generateMetadata(): Metadata {
  return {
    title: 'Strom-Check (WIP) — COOLiN ENERGY',
    description:
      'Interner Datenpipe-Beweis für den Haushalts-Energiemonitor (T3) — noch keine Produktseite.',
    /*
     * NOINDEX (WIP, s. `lib/routes.ts`): diese Route ist der reine
     * Server→Client→Ergebnis-Beweis (T3-Prompt-Vorgabe), keine kuratierte
     * Produktseite. KEIN `alternates` — dieselbe Begründung wie bei
     * `CALCULATOR_RUN_HREF` (peak-shaving/kalkulator/rechner/page.tsx):
     * Canonical/hreflang auf einer `noindex`-Seite sind ein widersprüchliches
     * Signal an Google.
     */
    robots: robotsFor(MONITOR_GRATIS_CHECK_HREF),
  }
}

/**
 * T3, Teil 3 von ~4 (Pflichtenheft_Monitor_MVP.md §5.1/§5.3/§6/§7/§10):
 * Server-Fetch (`monitor.current_tariffs`, T2) → Mapping am Leserand →
 * Client-Engine (`tariff-monitor`, T1) → Ergebnis. ECHTES Eingabeformular
 * (4 Stufe-1-Pflichtfelder), Plausi-Wiring (`checkPlausibility`) und
 * localStorage-Merken (T3-2) — s. `components/monitor/gratis-check-client.tsx`.
 * Das Ergebnis ist seit T3-3 im apps/web-Design gestaltet (Headline/Bonus
 * strikt getrennt, Plausi-Warnungen prominent, Abo-Teaser) — s.
 * `components/monitor/gratis-check-result.tsx`. Weiterhin KEINE
 * Nav-Verlinkung/Produktseite (Website-Session, §4.2) — letzter T3-Baustein.
 *
 * ARCHITEKTUR-GRENZE: Diese Server-Component ist der EINZIGE Ort, der
 * Supabase kennt. Sie liest, mappt, und übergibt fertige `TariffCostObject[]`
 * als Props an die Client-Komponente — kein Supabase-Import wandert je ins
 * Client-Bundle (s. `lib/monitor/supabase.ts` für die `server-only`-Garantie).
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'Monitor.GratisCheck' })

  const rows = await fetchCurrentTariffRows()
  const tariffs = mapTariffRows(rows)

  return (
    <Container className="py-16 sm:py-24">
      <h1 className="text-h1 text-ink">{t('title')}</h1>
      <p className="mt-4 max-w-prose text-lead text-text-muted">{t('intro')}</p>
      <GratisCheckClient tariffs={tariffs} />
    </Container>
  )
}
