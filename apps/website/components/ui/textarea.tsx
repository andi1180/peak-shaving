import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Mehrzeiliges Eingabefeld — dieselben Klassen wie `Input`, nur ohne feste Höhe.
 *
 * Delta 17 Teil 2: bis hierher kam der Rechner ohne aus (die drei Einstiege fragen ausschliesslich
 * Zahlen und Auswahlen ab). Die Batterie-Angabe ist der erste Ort, an dem ein Kunde einen SATZ
 * schreibt — und ein einzeiliges Feld, in dem der Anfang beim Weitertippen verschwindet, lädt dazu
 * ein, weniger zu schreiben, als er weiss.
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, rows = 3, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'

export { Textarea }
