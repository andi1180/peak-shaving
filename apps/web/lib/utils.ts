import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/*
 * tailwind-merge muss unsere EIGENEN Schriftgrößen kennen (DESIGN.md-Skala:
 * text-caption/label/small/body/lead/h1..h4).
 *
 * Warum das nötig ist — ein real aufgetretener, STILLER Bug: tailwind-merge
 * kennt ab Werk nur die Standard-Skala (text-xs/sm/base/…). Ein unbekanntes
 * `text-body` ordnet es deshalb der Gruppe „Textfarbe" zu — und wirft dann
 * innerhalb von cn() die echte Farbe als vermeintliches Duplikat weg.
 * Konkret verlor `<Button size="lg" variant="primary">` sein
 * `text-accent-foreground` und rendrte dunklen Text auf Teal, während dieselbe
 * Variante in `size="sm"` (ohne text-Klasse) korrekt weiß blieb.
 *
 * Mit der Gruppe unten liegen Größe und Farbe in getrennten Gruppen und
 * überschreiben sich nicht mehr gegenseitig.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['caption', 'label', 'small', 'body', 'lead', 'h1', 'h2', 'h3', 'h4'] },
      ],
    },
  },
})

/** shadcn/ui-Standardhelfer: bedingte Klassen + Tailwind-Merge (letzte Klasse gewinnt). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
