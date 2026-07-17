import { useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { SmartHeatingChart } from './smart-heating-chart'

/**
 * Grafik von /leistungen/smart-heating (Prompt 19) — steht neben dem ERSTEN
 * Inhaltsblock nach der Hero-Sektion (`AusgangslageSection`, eigene
 * Zwischenüberschrift + Fließtext), gleiche Einbettung wie bei
 * `pv-verbrauch-graphic.tsx`/`energiemanagement-aggregation-graphic.tsx`: Card
 * mit weißem Grund + Caption darunter. Diese Wrapper-Komponente ist die dritte
 * Befüllung des optionalen `firstSectionGraphic`-Slots von `LeistungPage`
 * (`components/leistung/leistung-page.tsx`) — nur `smart-heating/page.tsx`
 * befüllt ihn zusätzlich, die anderen 3 Leistungsseiten bleiben unverändert
 * einspaltig.
 *
 * Kein zweites Signature-Motiv-Vorkommen: diese Grafik ist ein
 * Recharts-Diagramm, kein `SignatureRule`/`SignatureField`.
 */
export function SmartHeatingGraphic() {
  const t = useTranslations('Leistungen.Pages.smartHeating.chart')

  return (
    <div>
      <Card>
        <CardContent className="pt-5">
          <SmartHeatingChart />
        </CardContent>
      </Card>
      <p className="mt-3 text-caption text-text-muted">{t('caption')}</p>
    </div>
  )
}
