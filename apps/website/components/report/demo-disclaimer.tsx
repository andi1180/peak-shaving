import type { PdfReportOrigin } from '@/lib/pdf-report/types'

/**
 * Der Demo-Vorbehalt für Bildschirm-Report und Druck-Deckblatt. Es gilt dieselbe Bedingung wie
 * beim PDF (`reportDisclaimer` in `lib/pdf-report/content.ts`): der Satz steht nur bei `demo`,
 * ein Lauf über echte Kundendaten trägt ihn nicht.
 */
export function DemoDisclaimer({ origin, className }: { origin: PdfReportOrigin; className?: string }) {
  if (origin !== 'demo') return null
  return (
    <p className={className}>
      Demo-Berechnung mit Beispieldaten. Die Zahlen sind noch nicht gegen einen echten Lastgang und
      eine echte Netzrechnung validiert.
    </p>
  )
}
