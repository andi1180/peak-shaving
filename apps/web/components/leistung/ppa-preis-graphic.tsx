import { useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { PpaPreisChart } from './ppa-preis-chart'

/**
 * Grafik von /leistungen/ppa (Prompt 20) — steht neben dem ERSTEN Inhaltsblock
 * nach der Hero-Sektion (`AusgangslageSection`), gleiche Einbettung wie die
 * Grafiken auf pv-speicher/smart-heating (Card mit weißem Grund + Caption
 * darunter, Kontraste in DESIGN.md sind gegen Weiß vermessen). Diese
 * Wrapper-Komponente ist der optionale `firstSectionGraphic`-Slot von
 * `LeistungPage` (`components/leistung/leistung-page.tsx`) — die vierte
 * Leistungsseite, die ihn befüllt.
 *
 * Kein zweites Signature-Motiv-Vorkommen: diese Grafik ist ein
 * Recharts-Diagramm, kein `SignatureRule`/`SignatureField` (gleiche
 * Feststellung wie in den übrigen Chart-Grafiken).
 */
export function PpaPreisGraphic() {
  const t = useTranslations('Leistungen.Pages.ppa.chart')

  return (
    <div>
      <Card>
        <CardContent className="pt-5">
          <PpaPreisChart />
        </CardContent>
      </Card>
      <p className="mt-3 text-caption text-text-muted">{t('caption')}</p>
    </div>
  )
}
