import { ImageIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

/**
 * Platzhalter für einen noch fehlenden Screenshot (Pflichtenheft §5.2b, §12).
 *
 * OP#7 — Owner: Andreas: Die Screenshots des Pro-Kalkulators und des
 * Ergebnis-Reports (wie auch die hochauflösenden Logo-Assets) liefert Andreas
 * während des Baus. Bis dahin steht hier bewusst KEIN Bild und auch keine
 * Attrappe, die wie eines aussieht.
 *
 * ENTSCHEIDUNG: sichtbar leer statt „schön gefüllt". Ein gerendertes Fake-UI
 * oder ein Stock-Bild wäre eine Behauptung über das Produkt (§9.5) — und würde
 * beim Austausch gegen das echte Bild niemandem auffallen, wenn es nie ersetzt
 * wird. Der gestrichelte Rahmen + „Screenshot folgt" ist deshalb Absicht: er
 * bleibt so lange unübersehbar, bis das Asset da ist.
 *
 * ERSETZEN: Bild via `next/image` (§6.4 Core Web Vitals) an die Stelle des
 * Rahmens, `label`/`caption` bleiben als Bildunterschrift bestehen.
 */
export function ScreenshotPlaceholder({
  label,
  caption,
  /** Seitenverhältnis des erwarteten Bildes — hält den Platz frei, kein Layout-Shift. */
  className = 'aspect-[16/10]',
}: {
  label: string
  caption: string
  className?: string
}) {
  const t = useTranslations('PeakShavingCalculator.Screens')

  return (
    <figure>
      <div
        className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line-strong bg-surface-sunken p-6 text-center ${className}`}
      >
        {/* Schlichtes Line-Icon, einfärbig — kein Emoji (§7.3). */}
        <ImageIcon
          className="h-6 w-6 text-text-muted"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <p className="text-small font-semibold text-text-muted">{t('placeholder')}</p>
        <p className="text-caption text-text-muted">{label}</p>
      </div>
      <figcaption className="mt-3 text-small text-text-muted">{caption}</figcaption>
    </figure>
  )
}
