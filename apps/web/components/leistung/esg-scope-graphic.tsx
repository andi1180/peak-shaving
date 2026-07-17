import { useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { FanTopologyGraphic, type FanNode } from './fan-topology-graphic'

/*
 * GRAFIK „Scope 1/2/3 → CO₂-Bilanz" (Prompt 22, Ausgangslage-Sektion von
 * /leistungen/esg) — sechste und letzte Befüllung des `firstSectionGraphic`-
 * Slots, gleiche Einbettung wie die fünf bestehenden Grafiken (Card mit
 * weißem Grund + Caption darunter). Mit dieser Grafik hat jede der 6
 * Leistungsseiten genau eine Grafik im Slot.
 *
 * DIE AUSSAGE: DREI optisch gleichrangige Quellblöcke — die GHG-Protocol-
 * Kategorien Scope 1 (direkte Emissionen), Scope 2 (Energiebezug), Scope 3
 * (Wertschöpfungskette) — münden in EINEN Zielknoten „CO₂-Bilanz". Reine
 * Kategorisierung, keine Tonnen-/Prozentangabe — dasselbe generische
 * Fan-Primitiv wie auf /leistungen/finanzierung-foerderung, hier im
 * `fan-in`-Modus (drei neutrale Quellen links, Akzent-Ziel rechts) — die
 * exakt gespiegelte Topologie derselben Komponente.
 *
 * Eigenständige Caption (gleiche Logik wie die Finanzierungs-Grafik).
 */
const SOURCE_KEYS = ['scope1', 'scope2', 'scope3'] as const

export function EsgScopeGraphic() {
  const t = useTranslations('Leistungen.Pages.esg.chart')

  const items: FanNode[] = SOURCE_KEYS.map((key) => ({
    key,
    lines: t.raw(`sources.${key}`) as string[],
  }))
  const single: FanNode = { key: 'co2-bilanz', lines: t.raw('targetLabel') as string[] }

  return (
    <div>
      <Card>
        <CardContent className="pt-5">
          <FanTopologyGraphic
            direction="fan-in"
            single={single}
            items={items}
            singleBoxWidth={150}
            itemBoxWidth={216}
          />
        </CardContent>
      </Card>
      <p className="mt-3 text-caption text-text-muted">{t('caption')}</p>
    </div>
  )
}
