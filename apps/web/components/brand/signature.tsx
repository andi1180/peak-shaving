import * as React from 'react'
import { cn } from '@/lib/utils'

/*
 * SIGNATURE-MOTIV — abgeleitet aus dem Emblem (dünne Netzlinien + Knoten),
 * reduziert auf ein Element, das sparsam wiederkehren darf: als Trenner zwischen
 * Sektionen, als ruhige Fläche hinter einer Navy-Sektion, als Marker an einer
 * Überschrift.
 *
 * Bewusst zurückhaltend: Linien in `currentColor` mit niedriger Deckkraft, damit
 * das Motiv auf Navy WIE auf Off-White funktioniert und nie mit dem Inhalt
 * konkurriert. Nur die Knoten tragen den Akzent. Kein Gradient, keine Animation.
 *
 * Ob es überhaupt eingesetzt wird, entscheidet Andreas (DESIGN.md „Offene
 * Auswahlpunkte") — deshalb hier isoliert, nirgends fest verdrahtet.
 */

/** Waagrechter Netz-Trenner. Dekorativ → aria-hidden, kein Screenreader-Rauschen. */
export function SignatureRule({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 240 24"
      aria-hidden="true"
      focusable="false"
      className={cn('h-6 w-60 text-line-strong', className)}
      fill="none"
      preserveAspectRatio="xMinYMid meet"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Eine Leitung, die abzweigt und wieder zurückführt — dieselbe Figur wie
          die Route im Emblem, nur flach gezogen. Keine losen Segmente. */}
      <g stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
        <path d="M0 12 H240" opacity="0.5" />
        <path d="M72 12 L96 4 H144 L168 12" />
      </g>
      <circle cx="72" cy="12" r="2.25" fill="currentColor" opacity="0.7" />
      <circle cx="96" cy="4" r="3" fill="var(--color-accent)" />
      <circle cx="144" cy="4" r="3" fill="var(--color-accent)" />
    </svg>
  )
}

/**
 * Flächiges Netz für großzügige Hintergründe (z. B. eine Navy-Sektion).
 * `currentColor` erbt die Textfarbe des Elternteils; Deckkraft bleibt sehr niedrig.
 */
export function SignatureField({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 180"
      aria-hidden="true"
      focusable="false"
      className={cn('h-full w-full text-current opacity-[0.18]', className)}
      fill="none"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g stroke="currentColor" strokeWidth="1">
        <path d="M40 -10 L58 190" />
        <path d="M150 -10 L162 190" opacity="0.6" />
        <path d="M250 -10 L262 190" opacity="0.4" />
        <path d="M-10 48 L330 32" />
        <path d="M-10 118 L330 102" opacity="0.6" />
      </g>
      <path
        d="M48 40 L156 28 L152 112 L256 102"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="48" cy="40" r="4" fill="var(--color-node)" />
      <circle cx="156" cy="28" r="3" fill="currentColor" />
      <circle cx="152" cy="112" r="4" fill="var(--color-node)" />
    </svg>
  )
}
