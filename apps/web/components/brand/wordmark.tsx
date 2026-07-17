import * as React from 'react'
import { cn } from '@/lib/utils'
import { Emblem } from './emblem'

/*
 * WORTMARKE „COOLiN ENERGY" — drei Varianten zur Auswahl (Pflichtenheft §7.4).
 *
 * Gemeinsame Regeln aller Varianten:
 *  - „COOLiN" kräftig, „ENERGY" leichter und gesperrt.
 *  - Das stilisierte Klein-„i" ist der Anker zum Emblem: sein Punkt IST ein
 *    Teal-Knoten aus dem Netz-Motiv. Deshalb wird das „i" nicht als Buchstabe
 *    gesetzt, sondern als Geometrie gezeichnet (Stamm + Knoten) — nur so sitzt
 *    der Knoten exakt und skaliert mit der Marke.
 *  - Flach, kein Gradient, kein Schatten (§7.2).
 *  - Die Schrift nutzt `currentColor` -> dieselbe Komponente läuft in Navy auf
 *    Off-White und in Weiß auf Navy, ohne zweite Datei. Nur der Knoten bleibt
 *    Teal; `monochrome` zwingt ihn auf currentColor (1-Farb-Druck, Gravur, Fax).
 *
 * METRIK-ABHÄNGIGKEIT (bewusst, dokumentiert):
 * Die Koordinaten sind an Inters echten Glyphenbreiten vermessen — im Browser
 * mit getComputedTextLength bei font-size 100, nicht geschätzt (siehe DESIGN.md
 * „Wortmarke"). Für die Website ist das korrekt: Inter ist über next/font
 * garantiert geladen, und die Marke bleibt als <text> kopier-/durchsuchbar.
 * Für finale Export-Assets (Print, Partner, Fremdsysteme ohne Inter) werden die
 * Texte in Pfade konvertiert — dann ist die Marke metrik-unabhängig.
 */

// — Inter-Vertikalmetriken bei font-size 100 (unitsPerEm 2048) —
const BASE = 100 // Grundlinie
const SIZE = 100 // font-size der Versalien
const CAP_TOP = 27.3 // Versalhöhe 1490/2048 = 0,727em
const X_TOP = 45.4 // x-Höhe 1118/2048 = 0,546em -> Oberkante des i-Stamms
// Der Knoten überragt die Versalhöhe bewusst leicht: er ist das Signal der Marke
// und darf sich aus der Zeile lösen — aber nur so weit, dass die Zeile ruhig bleibt.
const NODE_CY = CAP_TOP + 4.7

// — Gemessene Advance-Breiten (getComputedTextLength, font-size 100) —
const M = {
  cool700: 276.61, // "COOL", weight 700, letter-spacing -2
  n700: 74.22, // "N",    weight 700, letter-spacing -2
  cool600: 279.92, // "COOL", weight 600, letter-spacing -1
  n600: 74.92, // "N",    weight 600, letter-spacing -1
  energyA: 230.08, // "ENERGY", 44px, weight 400, letter-spacing 9
  energyB: 233.2, // "ENERGY", 40px, weight 500, letter-spacing 12
}

const FONT = 'var(--font-sans), system-ui, sans-serif'

type WordmarkProps = {
  className?: string
  /** Knoten in currentColor statt Teal — für 1-Farb-Kontexte. */
  monochrome?: boolean
  title?: string
}

/** Der gezeichnete Klein-„i"-Stamm: von der x-Höhe bis zur Grundlinie. */
function IStem({ x, width }: { x: number; width: number }) {
  return (
    <rect x={x} y={X_TOP} width={width} height={BASE - X_TOP} rx={width / 2} fill="currentColor" />
  )
}

/* ------------------------------------------------------------------ *
 * Variante A — „Gestapelt" (Prompt 23: vorher nebeneinander, jetzt zweizeilig)
 *
 * „COOLiN" bleibt textlich UND breitenmäßig unverändert (exakt dieselben
 * Koordinaten/Metriken wie zuvor, inkl. i-Punkt-Knoten) und rückt an den
 * oberen Rand. „ENERGY" steht darunter und wird per `textLength` +
 * `lengthAdjust="spacingAndGlyphs"` auf EXAKT dieselbe Breite gestreckt wie
 * „COOLiN" darüber (coolNWidth) — der zuverlässige Weg, Breitengleichheit zu
 * erzwingen, ohne Kerning von Hand zu raten (SVG-Spec macht das deterministisch,
 * unabhängig von Zeichenzahl/Font-Metrik). `energySize` ist bewusst groß genug
 * gewählt, dass die natürliche (ungestreckte) Breite von „ENERGY" schon nahe an
 * coolNWidth liegt — der Stretch bleibt dadurch minimal, keine sichtbare
 * Verzerrung der Glyphen.
 * ------------------------------------------------------------------ */
export function WordmarkA({ className, monochrome, title = 'COOLiN ENERGY' }: WordmarkProps) {
  const node = monochrome ? 'currentColor' : 'var(--color-node)'
  const iW = 11
  const iX = M.cool700 + 8
  const nX = iX + iW + 9
  const coolNWidth = nX + M.n700 // Breite von "COOLiN" bei Basis-Schriftgröße 100

  /*
   * Prompt 24: Größenhierarchie — COOLiN dominant, ENERGY kleiner + gestreckt.
   * Die komplette COOLiN-Zeile (COOL-Text, i-Stamm, Knoten, N) wird als EINE
   * Gruppe um COOL_SCALE vergrößert, statt eine zweite Metrik zu vermessen —
   * die an fontSize=100 gemessenen Koordinaten (M, iX, nX, NODE_CY, IStem)
   * bleiben dadurch zueinander exakt proportional, nur der Maßstab ändert sich.
   * COOL_SCALE=1,2 + energySize=76 ergeben ein Cap-Height-Verhältnis
   * COOLiN:ENERGY von rund 1,58x (Zielkorridor 1,4–1,6x), optisch gegengeprüft.
   */
  const COOL_SCALE = 1.2
  const coolNWidthScaled = coolNWidth * COOL_SCALE // Zielbreite für ENERGY (textLength)

  const lineGap = 14 // Abstand: Grundlinie COOLiN (skaliert) -> Versalhöhe ENERGY
  const energySize = 76
  const coolBaselineY = BASE * COOL_SCALE
  const energyCapTop = coolBaselineY + lineGap
  const energyBase = energyCapTop + energySize * 0.727 // Versalhöhe-Anteil, s. CAP_TOP
  const nodeTopScaled = COOL_SCALE * (NODE_CY - 9) // Knoten-Oberkante, skaliert
  const topMargin = Math.max(nodeTopScaled - 12, 0) // etwas über dem Knoten
  const bottomMargin = 8
  const h = energyBase + bottomMargin - topMargin

  return (
    <svg
      viewBox={`0 ${topMargin} ${coolNWidthScaled} ${h}`}
      role="img"
      aria-label={title}
      className={cn('h-11 w-auto', className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform={`scale(${COOL_SCALE})`}>
        <text
          x="0"
          y={BASE}
          fontFamily={FONT}
          fontSize={SIZE}
          fontWeight="700"
          letterSpacing="-2"
          fill="currentColor"
        >
          COOL
        </text>
        <IStem x={iX} width={iW} />
        <circle cx={iX + iW / 2} cy={NODE_CY} r={9} fill={node} />
        <text
          x={nX}
          y={BASE}
          fontFamily={FONT}
          fontSize={SIZE}
          fontWeight="700"
          letterSpacing="-2"
          fill="currentColor"
        >
          N
        </text>
      </g>
      {/* ENERGY, zweite Zeile: textLength erzwingt exakt coolNWidthScaled, egal
          wie die natürliche Zeichenbreite bei der kleineren energySize ausfällt. */}
      <text
        x="0"
        y={energyBase}
        textLength={coolNWidthScaled}
        lengthAdjust="spacingAndGlyphs"
        fontFamily={FONT}
        fontSize={energySize}
        fontWeight="400"
        fill="currentColor"
        opacity="0.75"
      >
        ENERGY
      </text>
    </svg>
  )
}

/* ------------------------------------------------------------------ *
 * Variante B — „Knoten"
 * Der i-Punkt hängt sichtbar an einer Leitung und trägt einen Mess-Ring:
 * stärkster Bezug zum Emblem, erzählender. COOLiN etwas leichter (600),
 * ENERGY dafür schwerer (500) und weiter gesperrt -> ausgewogeneres Grau.
 * ------------------------------------------------------------------ */
export function WordmarkB({ className, monochrome, title = 'COOLiN ENERGY' }: WordmarkProps) {
  const node = monochrome ? 'currentColor' : 'var(--color-node)'
  const iW = 10
  const iX = M.cool600 + 8
  const nX = iX + iW + 9
  const energyX = nX + M.n600 + 30
  const w = energyX + M.energyB
  const cx = iX + iW / 2
  const cy = NODE_CY - 1

  return (
    <svg
      viewBox={`0 14 ${w} 90`}
      role="img"
      aria-label={title}
      className={cn('h-8 w-auto', className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <text
        x="0"
        y={BASE}
        fontFamily={FONT}
        fontSize={SIZE}
        fontWeight="600"
        letterSpacing="-1"
        fill="currentColor"
      >
        COOL
      </text>
      {/* Leitung zwischen Stamm und Knoten — greift die Route des Emblems auf */}
      <path
        d={`M${cx} ${X_TOP} L${cx} ${cy + 8}`}
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.4"
      />
      <IStem x={iX} width={iW} />
      <circle cx={cx} cy={cy} r={7.5} fill={node} />
      <circle cx={cx} cy={cy} r={12} fill="none" stroke={node} strokeWidth="2" opacity="0.4" />
      <text
        x={nX}
        y={BASE}
        fontFamily={FONT}
        fontSize={SIZE}
        fontWeight="600"
        letterSpacing="-1"
        fill="currentColor"
      >
        N
      </text>
      <text
        x={energyX}
        y={BASE}
        fontFamily={FONT}
        fontSize={SIZE * 0.4}
        fontWeight="500"
        letterSpacing="12"
        fill="currentColor"
        opacity="0.7"
      >
        ENERGY
      </text>
    </svg>
  )
}

/* ------------------------------------------------------------------ *
 * Variante C — „Gestapelt"
 * COOLiN groß, ENERGY exakt auf dieselbe Breite gesperrt darunter.
 * Kompakteste Grundfläche (schmale Header, Favicon-Nähe).
 * i-Punkt als offener Ring = Knoten in Kontur, leiser als A/B.
 * ------------------------------------------------------------------ */
export function WordmarkC({ className, monochrome, title = 'COOLiN ENERGY' }: WordmarkProps) {
  const node = monochrome ? 'currentColor' : 'var(--color-node)'
  const iW = 11
  const iX = M.cool700 + 8
  const nX = iX + iW + 9
  const totalW = nX + M.n700

  return (
    <svg
      viewBox={`0 18 ${totalW} 130`}
      role="img"
      aria-label={title}
      className={cn('h-12 w-auto', className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <text
        x="0"
        y={BASE}
        fontFamily={FONT}
        fontSize={SIZE}
        fontWeight="700"
        letterSpacing="-2"
        fill="currentColor"
      >
        COOL
      </text>
      <IStem x={iX} width={iW} />
      <circle cx={iX + iW / 2} cy={NODE_CY} r={8} fill="none" stroke={node} strokeWidth="5" />
      <text
        x={nX}
        y={BASE}
        fontFamily={FONT}
        fontSize={SIZE}
        fontWeight="700"
        letterSpacing="-2"
        fill="currentColor"
      >
        N
      </text>
      {/* textLength zwingt ENERGY exakt auf die Breite von COOLiN — unabhängig
          von der Schriftmetrik sitzt die Sperrung dadurch immer bündig. */}
      <text
        x="0"
        y={140}
        textLength={totalW}
        lengthAdjust="spacing"
        fontFamily={FONT}
        fontSize={29}
        fontWeight="500"
        fill="currentColor"
        opacity="0.7"
      >
        ENERGY
      </text>
    </svg>
  )
}

/* ------------------------------------------------------------------ *
 * LOCKUP — Emblem links + Wortmarke rechts.
 * Clear-Space = 0,5 x Emblemhöhe auf allen Seiten. Die Regel steht hier im
 * Code (padding), nicht nur in einer PDF, damit sie beim Bauen gilt.
 * ------------------------------------------------------------------ */
export function Lockup({
  className,
  variant = 'A',
  showClearSpace = false,
  inverse = false,
}: {
  className?: string
  variant?: 'A' | 'B' | 'C'
  showClearSpace?: boolean
  /** Für dunkle Gründe: Emblem-Inversfassung + Wortmarke in Weiß. */
  inverse?: boolean
}) {
  const Word = variant === 'A' ? WordmarkA : variant === 'B' ? WordmarkB : WordmarkC
  // A ist seit Prompt 23 ebenfalls zweizeilig (COOLiN/ENERGY gestapelt) — braucht
  // dieselbe großzügigere Höhe wie C, nur B bleibt die einzeilige Kompaktform.
  const stacked = variant === 'A' || variant === 'C'
  return (
    <div
      className={cn(
        // p-5 = 20px = 0,5 x 40px Emblemhöhe (h-10)
        // Die Wortmarke erbt die Farbe von hier (currentColor) — deshalb steht
        // die Markenfarbe am Lockup, nicht in der Wortmarke.
        'inline-flex items-center gap-3 p-5',
        inverse ? 'text-white' : 'text-navy',
        showClearSpace && 'rounded-md outline-dashed outline-1 outline-line-strong',
        className,
      )}
    >
      <Emblem inverse={inverse} className={stacked ? 'h-12 w-12' : 'h-10 w-10'} />
      <Word className={stacked ? 'h-12 w-auto' : 'h-7 w-auto'} />
    </div>
  )
}
