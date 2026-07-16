import * as React from 'react'
import Image from 'next/image'

/**
 * FIGURE / CHART-FIGURE — Bild bzw. Diagramm mit Bildunterschrift im Fließtext
 * (§7.5 Bildlayouts, §10.1 Rich-MDX-Bausteine).
 *
 * Beide bauen auf demselben `<figure>`/`<figcaption>`-Paar auf, weil beide
 * dasselbe SIND: ein Element, das aus dem Textfluss heraussteht und eine
 * Erklärung darunter trägt. Getrennt sind sie nur, weil ihr Inhalt anders
 * eingehängt wird (`next/image` mit Pixelmaßen vs. eine gerenderte Chart-Komponente).
 *
 * WARUM `<figcaption>` UND NICHT EIN `<p>`: Die Bildunterschrift ist bei den
 * Charts dieses Bereichs die Stelle, an der „illustratives Beispiel, keine
 * Messdaten" steht (§9.5). Diese Zuordnung muss maschinell und für
 * Screenreader eindeutig sein — ein loser Absatz darunter wäre Text, der
 * zufällig in der Nähe steht.
 *
 * BREITER ALS DER TEXT, MIT ABSICHT: Der Fließtext läuft auf `max-w-prose`
 * (68ch). Eine Grafik darf breiter stehen (`breakout`) — sonst ist ein Lastgang
 * über 24 Stunden auf Desktop unlesbar schmal. Das ist der „Rich-Layout"-Teil
 * aus §6.5, und er ist der Grund, warum die Prose-Breite an den Textelementen
 * hängt und nicht am Container.
 */

function Caption({ children }: { children: React.ReactNode }) {
  return (
    // `max-w-prose` auch an der Caption: Sie ist Text und soll nicht über die
    // volle Breite einer breiten Grafik laufen (Lesbarkeit, DESIGN.md ~65–75 Zeichen).
    <figcaption className="mt-4 max-w-prose text-caption text-text-muted">{children}</figcaption>
  )
}

/**
 * Ein Diagramm im Fließtext.
 *
 * Der weiße Kartengrund ist keine Kosmetik: Die in DESIGN.md gemessenen
 * Kontraste (Achsenbeschriftung `--color-text-muted`) sind gegen WEISS
 * vermessen. Auf `surface-alt` stünde die Beschriftung auf einem zweiten,
 * ungemessenen Ton. Gleiche Lösung wie die Chart-Sektionen auf /peak-shaving und
 * den Branchenseiten — ein Diagramm sitzt in diesem Projekt immer auf `surface`.
 */
export function ChartFigure({
  caption,
  children,
  className,
}: {
  caption: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <figure className={className}>
      <div className="rounded-lg border border-line bg-surface p-4 sm:p-6">{children}</div>
      <Caption>{caption}</Caption>
    </figure>
  )
}

/**
 * Ein Bild im Fließtext.
 *
 * `next/image` mit ECHTEN Pixelmaßen (nicht `fill`): Ohne sie kann der Browser
 * den Platz nicht reservieren und die Seite springt beim Nachladen — Core Web
 * Vitals sind laut §6.4 eine harte Anforderung, und CLS ist der Teil davon, den
 * ein Artikel mit Bildern am leichtesten verliert. Gleiche Begründung wie in
 * `components/peak-shaving/report-gallery.tsx`.
 *
 * Steht bereit für den ersten Artikel MIT Bild — der 2027-Artikel trägt bewusst
 * nur generierte Charts (§9.5: kein Stockfoto, das Sachlichkeit vortäuscht).
 * Deshalb ist die Komponente Teil der Bibliothek, aber im Flaggschiff-Artikel
 * nicht exerziert.
 */
export function Figure({
  src,
  alt,
  width,
  height,
  caption,
  className,
}: {
  src: string
  alt: string
  width: number
  height: number
  caption: React.ReactNode
  className?: string
}) {
  return (
    <figure className={className}>
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        sizes="(min-width: 1024px) 720px, 100vw"
        className="h-auto w-full rounded-lg border border-line"
      />
      <Caption>{caption}</Caption>
    </figure>
  )
}
