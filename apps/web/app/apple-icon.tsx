import { ImageResponse } from 'next/og'

/*
 * APPLE-TOUCH-ICON (180×180) — dieselbe vereinfachte Marke wie app/icon.svg,
 * aber als echtes PNG-Raster: iOS/Safari erwartet für das Touch-Icon eine
 * PNG-Datei (SVG wird dort ignoriert). Erzeugt über `next/og` (Satori) — derselbe
 * Weg wie opengraph-image.tsx, ohne Font-Bytes, weil hier kein Text vorkommt (nur
 * Rechteck/Pfad/Kreis, die Satori nativ rastert).
 *
 * Voll ausgefüllter Navy-Grund OHNE eigene Rundung: Apple legt seine eigene
 * abgerundete Maske darüber, ein transparenter Eckbereich (wie beim Squircle in
 * icon.svg) würde dort als graue Ecke durchscheinen. Deshalb bleibt der
 * Squircle-Radius hier weg — Apple rundet selbst.
 *
 * Geometrie/Farben 1:1 aus app/icon.svg skaliert (viewBox 0 0 64 64 → 180×180).
 * Hex-Literale wie dort begründet (Satori löst keine CSS-Variablen auf).
 */

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
        <svg width="180" height="180" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="0" width="64" height="64" fill="#18336f" />
          <path
            d="M24 20 L45 16 L41 40"
            fill="none"
            stroke="#ffffff"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="24" cy="20" r="5" fill="#ffffff" />
          <circle cx="45" cy="16" r="7" fill="#14b8a6" />
          <circle cx="41" cy="40" r="6.5" fill="#14b8a6" />
        </svg>
      </div>
    ),
    { ...size },
  )
}
