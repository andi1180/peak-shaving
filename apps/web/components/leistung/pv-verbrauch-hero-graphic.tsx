import { useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { PvVerbrauchChart } from './pv-verbrauch-chart'

/**
 * Hero-Grafik von /leistungen/pv-speicher (Prompt 16) — steht neben der
 * Headline, gleiche Einbettung wie Grafik 1 auf der Startseite
 * (`components/home/hero.tsx`: Card mit weißem Grund + Caption darunter,
 * Kontraste in DESIGN.md sind gegen Weiß vermessen). Diese Wrapper-Komponente
 * ist der optionale `heroGraphic`-Slot von `LeistungPage`
 * (`components/leistung/leistung-page.tsx`) — nur `pv-speicher/page.tsx`
 * befüllt ihn, die anderen 5 Leistungsseiten bleiben unverändert einspaltig.
 *
 * Kein zweites Signature-Motiv-Vorkommen: diese Grafik ist ein
 * Recharts-Diagramm, kein `SignatureRule`/`SignatureField` (gleiche
 * Feststellung wie im Startseiten-Hero).
 */
export function PvVerbrauchHeroGraphic() {
  const t = useTranslations('Leistungen.Pages.pvSpeicher.chart')

  return (
    <div>
      <Card>
        <CardContent className="pt-5">
          <PvVerbrauchChart />
        </CardContent>
      </Card>
      <p className="mt-3 text-caption text-text-muted">{t('caption')}</p>
    </div>
  )
}
