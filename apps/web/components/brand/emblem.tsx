import * as React from 'react'
import { cn } from '@/lib/utils'

/*
 * PLATZHALTER-Emblem — nachgezeichnet aus reference/favicon.png.
 *
 * WICHTIG: Das ist KEIN offizielles Asset, sondern eine Rekonstruktion des
 * Motivs (Navy-Squircle, dünne weiße Netzlinien, Knoten) in sauberem Vektor,
 * damit Wortmarke und Lockup jetzt beurteilbar sind. Das hochauflösende
 * Original liefert Andreas — Pflichtenheft §7.4 / OP#7. Sobald es da ist, wird
 * NUR diese Datei ersetzt; Lockup und Wortmarke bleiben unberührt.
 *
 * Motiv-Lesart: ein Netz aus Leitungen mit zwei aktiven Knoten — vernetzt,
 * gemessen, überwacht. Genau die Erzählung von Peak Shaving.
 */
export function Emblem({
  className,
  title = 'COOLiN Energy Emblem',
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
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
      className={cn('h-10 w-10', className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Grund als Squircle (Bestandston, DESIGN.md --color-navy) */}
      <rect x="0" y="0" width="64" height="64" rx="17" fill={ground} />

      {/* Netzlinien: dünn, leicht gekippt — Leitungen, kein Dekor-Raster.
          clipPath hält sie exakt in der Squircle-Form. */}
      <defs>
        <clipPath id="coolin-emblem-clip">
          <rect x="0" y="0" width="64" height="64" rx="17" />
        </clipPath>
      </defs>
      <g clipPath="url(#coolin-emblem-clip)" stroke={line} strokeWidth="2.4" opacity="0.95">
        <path d="M23 -4 L27 68" />
        <path d="M-4 22 L68 14" />
        <path d="M-4 44 L68 36" />
        <path d="M46 -4 L52 68" opacity="0.55" />
      </g>

      {/* Aktive Route über die Knoten — der eine Weg, der Strom trägt. */}
      <g clipPath="url(#coolin-emblem-clip)">
        <path
          d="M25 20 L45 16 L41 39"
          stroke={line}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* Knoten: heller Messpunkt + zwei aktive Teal-Knoten (Akzent) */}
      <circle cx="25" cy="20" r="4.6" fill={line} />
      <circle cx="45" cy="16" r="6" fill="var(--color-node)" />
      <circle cx="41" cy="39" r="5.4" fill="var(--color-node)" />
    </svg>
  )
}
