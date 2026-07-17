/*
 * Geteiltes SVG-Primitiv „Fan-Topologie" (Prompt 22): ein einzelner,
 * akzentuierter Knoten verzweigt (Bezier-Linien) zu mehreren gleichrangigen,
 * neutralen Knoten — oder umgekehrt laufen mehrere neutrale Knoten in einen
 * einzelnen Akzent-Knoten zusammen. Beide Fälle sind dieselbe Geometrie, nur
 * gespiegelt:
 *
 *   fan-out: Akzent-Knoten LINKS → N neutrale Knoten RECHTS.
 *            /leistungen/finanzierung-foerderung: „Ihre Investition" →
 *            Investitionsfreibetrag / Ökologische Investitionsförderung /
 *            Contracting.
 *   fan-in:  N neutrale Knoten LINKS → Akzent-Knoten RECHTS.
 *            /leistungen/esg: Scope 1/2/3 → „CO₂-Bilanz".
 *
 * Extrahiert aus dem Bezier-Primitiv in `energiemanagement-aggregation-
 * graphic.tsx` (Prompt 18, dort eine 5→1→1-Kette). Diese Komponente deckt
 * genau EINE Stufe einer solchen Kette ab (1↔N) — beide neuen Grafiken
 * brauchen keine zweite nachgeschaltete Stufe wie dort die Rechnung.
 * `energiemanagement-aggregation-graphic.tsx` bleibt bewusst UNVERÄNDERT
 * (eigene, bereits verifizierte Geometriewerte) statt auf dieses Primitiv
 * umgestellt zu werden — ein Umbau ohne fachlichen Anlass wäre reines Risiko
 * ohne Nutzen.
 *
 * REINE TOPOLOGIE, keine Daten — dieselbe Regel wie beim Vorbild: keine
 * Zahlen, keine Prozentangaben. Alle Knoten EINER Rolle (Akzent oder neutral)
 * sind exakt gleich groß, keine Gewichtung/kein Anteil wird suggeriert. Der
 * Akzent (Teal) erscheint genau einmal — am einzelnen Knoten, unabhängig
 * davon, ob er Quelle (fan-out) oder Ziel (fan-in) ist; die N-Knoten bleiben
 * immer neutral.
 *
 * Mehrzeilige Labels (`lines: string[]`) statt automatischem Textumbruch: SVG
 * bricht Text nicht selbst um. Die Zeilen kommen fertig getrennt aus den
 * Messages (`t.raw(...)` je Knoten — gleiches Muster wie `problem.text` in
 * `leistung-page.tsx`).
 *
 * Kein zweites Signature-Motiv-Vorkommen: dieses SVG ist ein eigenständiges
 * Diagramm, kein `SignatureRule`/`SignatureField`.
 */

export type FanNode = {
  key: string
  lines: string[]
}

const PAD = 8
const GAP_Y = 16
const CURVE_GAP = 96
const LINE_HEIGHT = 15

export function FanTopologyGraphic({
  direction,
  single,
  items,
  itemBoxWidth = 200,
  itemBoxHeight = 56,
  singleBoxWidth = 160,
  singleBoxHeight = 56,
}: {
  /** 'fan-out': Akzent-Knoten links, N neutrale Knoten rechts. 'fan-in': umgekehrt. */
  direction: 'fan-out' | 'fan-in'
  single: FanNode
  items: FanNode[]
  itemBoxWidth?: number
  itemBoxHeight?: number
  singleBoxWidth?: number
  singleBoxHeight?: number
}) {
  const isFanOut = direction === 'fan-out'

  // Ein kombiniertes Array statt paralleler Index-Zugriffe — `noUncheckedIndexedAccess`
  // würde jedes `itemCenterY[i]` sonst als `number | undefined` typisieren.
  const positionedItems = items.map((item, i) => {
    const y = PAD + i * (itemBoxHeight + GAP_Y)
    return { item, y, centerY: y + itemBoxHeight / 2 }
  })
  const lastItem = positionedItems[positionedItems.length - 1]
  const firstCenterY = positionedItems[0]?.centerY ?? 0
  const lastCenterY = lastItem?.centerY ?? 0
  const singleCenterY = (firstCenterY + lastCenterY) / 2
  const singleY = singleCenterY - singleBoxHeight / 2

  const itemsX = isFanOut ? PAD + singleBoxWidth + CURVE_GAP : PAD
  const singleX = isFanOut ? PAD : PAD + itemBoxWidth + CURVE_GAP

  const viewW = Math.max(singleX + singleBoxWidth, itemsX + itemBoxWidth) + PAD
  const viewH = (lastItem?.y ?? 0) + itemBoxHeight + PAD

  // Die Bezier-Kurve verbindet den einander zugewandten Rand beider Knoten —
  // dieselbe Kontrollpunkt-Logik wie im Vorbild (Kontrollpunkte auf der
  // horizontalen Mitte zwischen beiden Rändern).
  const singleEdgeX = isFanOut ? singleX + singleBoxWidth : singleX
  const itemEdgeX = isFanOut ? itemsX : itemsX + itemBoxWidth
  const midX = (singleEdgeX + itemEdgeX) / 2

  return (
    <svg
      viewBox={`0 0 ${viewW} ${viewH}`}
      className="h-auto w-full"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Verbindungslinien zuerst, damit die Boxen darüber liegen. */}
      <g className="stroke-line-strong" fill="none" strokeWidth="1.5" opacity="0.55">
        {positionedItems.map(({ item, centerY }) => (
          <path
            key={item.key}
            d={`M${singleEdgeX},${singleCenterY} C ${midX},${singleCenterY} ${midX},${centerY} ${itemEdgeX},${centerY}`}
            strokeLinecap="round"
          />
        ))}
      </g>

      {/* N neutrale Knoten — bewusst identisch groß, keine Rangfolge. */}
      {positionedItems.map(({ item, y, centerY }) => (
        <g key={item.key}>
          <rect
            x={itemsX}
            y={y}
            width={itemBoxWidth}
            height={itemBoxHeight}
            rx={7}
            className="fill-surface-sunken stroke-line"
            strokeWidth="1"
          />
          <MultilineText
            x={itemsX + itemBoxWidth / 2}
            y={centerY}
            lines={item.lines}
            className="fill-text-muted text-small"
          />
        </g>
      ))}

      {/* Der eine Akzent-Knoten. */}
      <rect
        x={singleX}
        y={singleY}
        width={singleBoxWidth}
        height={singleBoxHeight}
        rx={8}
        className="fill-accent-subtle stroke-accent-border"
        strokeWidth="1.5"
      />
      <MultilineText
        x={singleX + singleBoxWidth / 2}
        y={singleCenterY}
        lines={single.lines}
        className="fill-accent text-small font-semibold"
      />
    </svg>
  )
}

/** Zentriert 1–2 Textzeilen vertikal um (x, y) — SVG bricht Text nicht selbst um. */
function MultilineText({
  x,
  y,
  lines,
  className,
}: {
  x: number
  y: number
  lines: string[]
  className: string
}) {
  const offset = -((lines.length - 1) * LINE_HEIGHT) / 2
  return (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" className={className}>
      {lines.map((line, i) => (
        <tspan key={line} x={x} dy={i === 0 ? offset : LINE_HEIGHT}>
          {line}
        </tspan>
      ))}
    </text>
  )
}
