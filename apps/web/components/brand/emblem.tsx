import * as React from 'react'
import { cn } from '@/lib/utils'

/*
 * VEKTOR-EMBLEM — pixelgenau nachgezeichnet aus
 * `reference/logo-coolin-emblem-master.png` (Andreas' Original, 128×128,
 * transparenter Grund; Prompt 23). Für Stellen mit `<img>`/next/image
 * (Header/Footer/Mobile-Drawer) wird DIREKT die PNG-Datei verwendet
 * (`components/brand/emblem-image.tsx`) — diese Vektorfassung bleibt nur für
 * Stellen, die zwingend Vektor/Satori brauchen (opengraph-image.tsx, dort
 * separat nachgebaut) oder eine `inverse`-Fassung zeigen (Styleguide).
 *
 * KORREKTUR ggü. der vorigen Fassung: Die vorige Nachzeichnung zog alle
 * Netzlinien voll durchs Bild (Kante zu Kante), im Original enden sie an den
 * Knotenpunkten (bzw. an der Bild-Kante, wenn sie dort "offen" auslaufen) statt
 * unter den Knoten hindurchzulaufen. Koordinaten unten sind aus der PNG per
 * Bild-Analyse vermessen (Node-Zentren via Distanztransformation, Linien per
 * Hough-Transformation + linearer Regression je Segment) und NICHT geschätzt:
 *  - Weißer Knoten:  cx=41.5 cy=47   r=10.6
 *  - Teal-Knoten 1:  cx=94   cy=32.5 r=11.7  (oben rechts)
 *  - Teal-Knoten 2:  cx=81   cy=80   r=11.2  (unten)
 *  - Route (Strom):  weiß → Teal 1 → Teal 2 (Knotenzentren, vom jeweiligen
 *    Kreis verdeckt — wie im Original)
 *  - 5 Netzlinien, jede endet an GENAU einem Knotenzentrum und läuft am
 *    anderen Ende über die Bild-Kante hinaus (Bleed, wie zuvor):
 *      L1 weiß → links offen
 *      L2 vertikal durch den weißen Knoten (oben UND unten offen — im
 *         Original läuft nur diese eine Linie ungebrochen durch einen Knoten,
 *         pixelgenau bestätigt: beide Enden liegen auf derselben Geraden)
 *      L3 Teal 2 → links offen
 *      L4 Teal 2 → rechts offen
 *      L5 Teal 2 → unten offen
 * Der Radius rx=17 (bei 64er-Ansicht; hier ×2=34 bei 128) war in der vorigen
 * Fassung bereits korrekt (gegen die PNG-Eckenkurve geprüft: passt auf <1px).
 */
export function Emblem({
  className,
  title = 'COOLiN ENERGY Emblem',
  inverse = false,
}: {
  className?: string
  title?: string
  /**
   * Inversfassung für dunkle Gründe: heller Grund, Navy-Linien. Ohne sie
   * verschwindet der Navy-Squircle auf einer Navy-Fläche vollständig — ein
   * Logo braucht dafür eine echte zweite Fassung, keinen Opazitäts-Trick.
   * Die Knoten bleiben in beiden Fassungen Teal (sie sind die Konstante).
   */
  inverse?: boolean
}) {
  const ground = inverse ? '#ffffff' : 'var(--color-navy)'
  const line = inverse ? 'var(--color-navy)' : '#ffffff'
  return (
    <svg
      viewBox="0 0 128 128"
      role="img"
      aria-label={title}
      className={cn('h-10 w-10', className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Grund als Squircle (Bestandston, DESIGN.md --color-navy) */}
      <rect x="0" y="0" width="128" height="128" rx="34" fill={ground} />

      <defs>
        <clipPath id="coolin-emblem-clip">
          <rect x="0" y="0" width="128" height="128" rx="34" />
        </clipPath>
      </defs>

      {/* Netzlinien: enden je an einem Knotenzentrum (vom Kreis verdeckt) und
          laufen am anderen Ende über die Kante hinaus. */}
      <g clipPath="url(#coolin-emblem-clip)" stroke={line} strokeWidth="5" strokeLinecap="butt">
        <path d="M41.5 47 L-4 54.8" />
        <path d="M41.4 -4 L41.5 132" />
        <path d="M81 80 L-4 93.2" />
        <path d="M81 80 L132 70" />
        <path d="M81 80 L66.2 132" />
      </g>

      {/* Aktive Route über die Knoten — der eine Weg, der Strom trägt. */}
      <g clipPath="url(#coolin-emblem-clip)">
        <path
          d="M41.5 47 L94 32.5 L81 80"
          stroke={line}
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* Knoten: heller Messpunkt + zwei aktive Teal-Knoten (Akzent) */}
      <circle cx="41.5" cy="47" r="10.6" fill={line} />
      <circle cx="94" cy="32.5" r="11.7" fill="var(--color-node)" />
      <circle cx="81" cy="80" r="11.2" fill="var(--color-node)" />
    </svg>
  )
}
