import { useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { FanTopologyGraphic, type FanNode } from './fan-topology-graphic'

/*
 * GRAFIK „Eine Investition, mehrere Fördertöpfe" (Prompt 22, Ausgangslage-
 * Sektion von /leistungen/finanzierung-foerderung) — fünfte Befüllung des
 * `firstSectionGraphic`-Slots, gleiche Einbettung wie die vier bestehenden
 * Grafiken (Card mit weißem Grund + Caption darunter).
 *
 * DIE AUSSAGE: EIN Quellknoten „Ihre Investition" verzweigt zu DREI optisch
 * gleichrangigen Wegen (Investitionsfreibetrag, Ökologische Investitions-
 * förderung, Contracting — aus dem Pflichtenheft §5.1/§13, nicht erfunden).
 * Reine Topologie: „es gibt diese drei Wege", keine Aussage darüber, was
 * welcher Weg tatsächlich bringt (dafür ist die Beratung da, nicht ein
 * Diagramm) — deshalb `fan-topology-graphic.tsx`s generisches Primitiv im
 * `fan-out`-Modus (Akzent-Quelle links, drei neutrale Ziele rechts).
 *
 * Eigenständige Caption (kein „keine Messdaten"-Wortlaut wie bei den
 * Recharts-Charts — hier werden keine Messdaten suggeriert).
 */
const TARGET_KEYS = ['investitionsfreibetrag', 'oekologischeFoerderung', 'contracting'] as const

export function FinanzierungFoerdertoepfeGraphic() {
  const t = useTranslations('Leistungen.Pages.finanzierung.chart')

  const single: FanNode = { key: 'investition', lines: t.raw('sourceLabel') as string[] }
  const items: FanNode[] = TARGET_KEYS.map((key) => ({
    key,
    lines: t.raw(`targets.${key}`) as string[],
  }))

  return (
    <div>
      <Card>
        <CardContent className="pt-5">
          <FanTopologyGraphic
            direction="fan-out"
            single={single}
            items={items}
            singleBoxWidth={168}
            itemBoxWidth={216}
          />
        </CardContent>
      </Card>
      <p className="mt-3 text-caption text-text-muted">{t('caption')}</p>
    </div>
  )
}
