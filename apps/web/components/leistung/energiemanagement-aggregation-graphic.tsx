import { useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'

/*
 * GRAFIK „Aggregationsschema" (Prompt 18, Ausgangslage-Sektion von
 * /leistungen/energiemanagement) — steht neben dem ersten Inhaltsblock nach
 * der Hero-Sektion, gleiche Einbettung wie `PvVerbrauchGraphic` auf
 * /leistungen/pv-speicher (Card mit weißem Grund + Caption darunter).
 *
 * DIE AUSSAGE: fünf benannte Verbrauchsbereiche (Druckluft, Kälte, Wärme,
 * Lüftung, Produktion) laufen — alle optisch gleichrangig — in EINEN
 * Zählpunkt zusammen, der wiederum in EINEN undifferenzierten Endpunkt
 * „Ihre Rechnung" mündet. Genau das ist das Problem, das die Sektion
 * daneben beschreibt: die Rechnung ist eine Summe, keine Erklärung.
 *
 * REINE TOPOLOGIE, keine Daten: keine Zahlen, keine Prozentangaben, keine
 * unterschiedlichen Flächen-/Boxgrößen, die einen Anteil suggerieren würden —
 * alle fünf Quell-Boxen sind exakt gleich groß. Anders als bei
 * `pv-verbrauch-chart.tsx` (Prompt 16) gibt es hier keine Kurve, die als
 * Messwert missverstanden werden könnte — deshalb bewusst KEINE eigene
 * Ehrlichkeitsregel-Kaskade (kein `hide`n einer Achse o. Ä. nötig, es gibt
 * keine Achse).
 *
 * SVG statt HTML (anders als `netzebenen-grafik.tsx`, dort ausführlich
 * begründet): das dortige Argument („kein Bild mit langem Alt-Text") greift
 * hier nicht — alle Labels stehen als echte SVG-`<text>`-Knoten im DOM, keine
 * `aria-hidden`-Fläche mit ausgelagerter Caption wie bei den Recharts-Charts
 * (die zeigen ILLUSTRATIVE MESSWERTE, hier gibt es keine Werte zu verstecken).
 * SVG ist hier nötig, um die konvergierenden Verbindungslinien zu zeichnen —
 * mit reinem CSS/Grid ließe sich die trichterförmige Zusammenführung auf
 * fünf gleich große, aber content-breite Boxen nicht robust nachbauen.
 *
 * FARBEN (DESIGN.md): Teal erscheint GENAU EINMAL — am Zählpunkt-Knoten, dem
 * Punkt, an dem die fünf Bereiche technisch zusammenlaufen. Der Endpunkt
 * „Ihre Rechnung" bleibt bewusst neutral (Ink/Line-strong): „undifferenziert"
 * heißt hier auch farblich zurückhaltend, nicht ein zweiter Akzent.
 *
 * Kein zweites Signature-Motiv-Vorkommen: dieses SVG ist ein eigenständiges
 * Diagramm, kein `SignatureRule`/`SignatureField`.
 */

const SOURCE_KEYS = ['druckluft', 'kaelte', 'waerme', 'lueftung', 'produktion'] as const

const BOX_W = 148
const BOX_H = 38
const SOURCE_X = 8
const SOURCE_Y = [8, 62, 116, 170, 224]
const SOURCE_CENTER_Y = SOURCE_Y.map((y) => y + BOX_H / 2)

const METER_X = 224
const METER_W = 116
const METER_H = 52
/** Vertikale Mitte des Zählpunkts = Mitte des gesamten Quell-Stapels (erste/letzte Box). */
const FIRST_SOURCE_CENTER_Y = (SOURCE_Y[0] ?? 0) + BOX_H / 2
const LAST_SOURCE_Y = SOURCE_Y[SOURCE_Y.length - 1] ?? 0
const LAST_SOURCE_CENTER_Y = LAST_SOURCE_Y + BOX_H / 2
const METER_CENTER_Y = (FIRST_SOURCE_CENTER_Y + LAST_SOURCE_CENTER_Y) / 2
const METER_Y = METER_CENTER_Y - METER_H / 2

const INVOICE_X = 388
const INVOICE_W = 140
const INVOICE_H = 52
const INVOICE_Y = METER_CENTER_Y - INVOICE_H / 2

const VIEW_W = INVOICE_X + INVOICE_W + 8
const VIEW_H = LAST_SOURCE_Y + BOX_H + 8

export function EnergiemanagementAggregationGraphic() {
  const t = useTranslations('Leistungen.Pages.energiemanagement.chart')

  return (
    <div>
      <Card>
        <CardContent className="pt-5">
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="h-auto w-full"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Verbindungslinien zuerst, damit die Boxen darüber liegen. */}
            <g className="stroke-line-strong" fill="none" strokeWidth="1.5" opacity="0.55">
              {SOURCE_CENTER_Y.map((cy, i) => (
                <path
                  key={SOURCE_KEYS[i]}
                  d={`M${SOURCE_X + BOX_W},${cy} C ${METER_X - 32},${cy} ${METER_X - 32},${METER_CENTER_Y} ${METER_X},${METER_CENTER_Y}`}
                  strokeLinecap="round"
                />
              ))}
              <path
                d={`M${METER_X + METER_W},${METER_CENTER_Y} L${INVOICE_X},${METER_CENTER_Y}`}
                strokeLinecap="round"
              />
            </g>

            {/* Fünf Quellblöcke — bewusst identisch groß, keine Rangfolge. */}
            {SOURCE_KEYS.map((key, i) => (
              <g key={key}>
                <rect
                  x={SOURCE_X}
                  y={SOURCE_Y[i]}
                  width={BOX_W}
                  height={BOX_H}
                  rx={7}
                  className="fill-surface-sunken stroke-line"
                  strokeWidth="1"
                />
                <text
                  x={SOURCE_X + BOX_W / 2}
                  y={SOURCE_CENTER_Y[i]}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-text-muted text-small"
                >
                  {t(`sources.${key}`)}
                </text>
              </g>
            ))}

            {/* Zählpunkt — der eine Punkt, an dem alles zusammenläuft. Einziger
                Teal-Akzent der Grafik. */}
            <rect
              x={METER_X}
              y={METER_Y}
              width={METER_W}
              height={METER_H}
              rx={8}
              className="fill-accent-subtle stroke-accent-border"
              strokeWidth="1.5"
            />
            <text
              x={METER_X + METER_W / 2}
              y={METER_CENTER_Y}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-accent text-small font-semibold"
            >
              {t('meterLabel')}
            </text>

            {/* Endpunkt — undifferenziert: eine Summe, keine Aufschlüsselung.
                Bewusst neutral statt eines zweiten Akzents. */}
            <rect
              x={INVOICE_X}
              y={INVOICE_Y}
              width={INVOICE_W}
              height={INVOICE_H}
              rx={8}
              className="fill-surface-sunken stroke-line-strong"
              strokeWidth="1.5"
            />
            <text
              x={INVOICE_X + INVOICE_W / 2}
              y={METER_CENTER_Y}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-ink text-small font-semibold"
            >
              {t('invoiceLabel')}
            </text>
          </svg>
        </CardContent>
      </Card>
      <p className="mt-3 text-caption text-text-muted">{t('captionAggregation')}</p>
    </div>
  )
}
