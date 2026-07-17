import Image from 'next/image'
import { cn } from '@/lib/utils'

/*
 * DAS ECHTE EMBLEM (Prompt 23 — Andreas' PNG-Vorlage ist eingetroffen, s.
 * `reference/logo-coolin-emblem-master.png`, 128×128, transparenter Grund).
 *
 * Für Stellen, an denen ein <img>/next/image möglich ist (Header, Footer,
 * Mobile-Drawer), ist das die pixelgenaue Original-Datei — kein
 * Nachzeichnungsrisiko mehr. `components/brand/emblem.tsx` (SVG) bleibt
 * daneben bestehen, aber NUR für Stellen, die zwingend Vektor/Satori brauchen
 * (opengraph-image.tsx) oder eine `inverse`-Fassung zeigen müssen (Styleguide-
 * Dokumentation) — die PNG-Vorlage kennt nur genau eine Fassung (Navy-Grund).
 *
 * `/brand/coolin-emblem.png` liegt in `public/` (Kopie der Referenzdatei) —
 * derselbe String-Pfad-Ansatz wie `components/peak-shaving/report-gallery.tsx`.
 */
export function EmblemImage({
  className,
  size = 40,
  priority,
}: {
  className?: string
  /** Native Breite/Höhe für next/image (Datei ist quadratisch, 128×128). */
  size?: number
  priority?: boolean
}) {
  return (
    <Image
      src="/brand/coolin-emblem.png"
      alt="COOLiN ENERGY"
      width={size}
      height={size}
      priority={priority}
      className={cn('h-10 w-10', className)}
    />
  )
}
