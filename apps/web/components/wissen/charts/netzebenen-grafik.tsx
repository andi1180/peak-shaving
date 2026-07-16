import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

/*
 * GRAFIK „Netzebenen — wen es trifft" (Pflichtenheft §6.5, §7.5).
 *
 * KEIN RECHARTS, UND KEIN SVG — bewusst. Das hier sind keine Daten, sondern eine
 * ORDNUNG: sieben benannte Ebenen, eine davon hervorgehoben. Als HTML-Liste ist
 * sie
 *   – vorlesbar (ein SVG wäre für Screenreader ein Bild mit langem alt-Text),
 *   – durchsuchbar/indexierbar (die Ebenennamen stehen im DOM — der Artikel soll
 *     auf „Netzebene 7" ranken, §6.2),
 *   – ohne Client-JS (Recharts wäre eine Client-Komponente für eine Tabelle).
 * Deshalb ist diese Datei als EINZIGE der drei „Charts" eine Server-Komponente.
 *
 * §9.5: Die Ebenen und ihre Zuordnung sind KEINE erfundene Struktur — sie folgen
 * der Netzebenen-Systematik des ElWG/der E-Control (NE 1 Übertragungsnetz bis
 * NE 7 Niederspannung). Es steht bewusst KEINE Spannungsangabe in kV daneben:
 * Sie wäre für die Aussage des Artikels irrelevant und eine weitere Zahl, die
 * jemand nachschlagen müsste. Was hier zählt, ist die Reihenfolge und die eine
 * markierte Zeile.
 *
 * DER AKZENT ERSCHEINT GENAU EINMAL: auf NE 7. Das ist die Ebene, um die es im
 * ganzen Artikel geht — „an einer Stelle laut, drumherum ruhig" (DESIGN.md).
 *
 * `compact` (Prompt 14): kleinere Zeilenhöhe/Schrift für den Startseiten-Teaser
 * im Peak-Shaving-Block — WIEDERVERWENDUNG derselben sieben Zeilen, nur
 * verkleinert (kein Neubau, keine reduzierte Ebenen-Auswahl). Die Startseite
 * trägt bewusst KEINEN eigenen Erläuterungstext dazu — der lebt im Artikel
 * (`ChartFigure`-Caption dort); hier steht nur ein Link zurück.
 */

/**
 * Die sieben Ebenen, von oben (Übertragungsnetz) nach unten (Niederspannung) —
 * dieselbe Richtung, in der die Systematik sie zählt. Nur der Schlüssel steht
 * hier; die Namen kommen aus `messages/de.json` (§8.7, keine Strings im JSX).
 *
 * `highlight` markiert die Ebene, um die es geht. Als Feld und nicht als
 * `level === 7` im JSX: Die Aussage „diese Ebene ist gemeint" gehört zu den
 * Daten, nicht in eine Bedingung im Markup.
 */
const LEVELS: { level: number; highlight?: boolean }[] = [
  { level: 1 },
  { level: 2 },
  { level: 3 },
  { level: 4 },
  { level: 5 },
  { level: 6 },
  { level: 7, highlight: true },
]

export function NetzebenenGrafik({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('Wissen.Charts.Netzebenen')

  return (
    <ol className={cn(compact ? 'space-y-1' : 'space-y-1.5')}>
      {LEVELS.map(({ level, highlight }) => (
        <li
          key={level}
          className={cn(
            'flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border',
            compact ? 'px-3 py-2' : 'px-4 py-3',
            highlight ? 'border-accent-border bg-accent-subtle' : 'border-line bg-surface-sunken',
          )}
        >
          {/*
           * `tabular-nums` an der Ebenen-Nummer: sieben Zeilen mit einer Ziffer
           * links — mit proportionalen Ziffern stünden sie nicht auf einer Kante
           * (§7.4/DESIGN.md).
           */}
          <span
            className={cn(
              'shrink-0 font-semibold tabular-nums',
              compact ? 'w-14 text-caption' : 'w-16 text-small',
              highlight ? 'text-accent' : 'text-text-muted',
            )}
          >
            {t('levelShort', { level })}
          </span>
          <span
            className={cn(compact ? 'text-caption' : 'text-small', highlight ? 'text-ink' : 'text-text-muted')}
          >
            {t(`level${level}`)}
          </span>
          {/*
           * Die Markierung trägt einen TEXT, nicht nur die Farbe: Farbe allein
           * darf nicht das einzige Unterscheidungsmerkmal sein (WCAG 1.4.1,
           * §9.4) — wer die Akzentfläche nicht sieht, liest trotzdem, welche
           * Zeile gemeint ist.
           */}
          {highlight ? (
            <span className="ml-auto text-caption font-semibold uppercase tracking-[0.08em] text-accent">
              {t('highlightLabel')}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  )
}
