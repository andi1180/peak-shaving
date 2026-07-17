import * as React from 'react'
import type { MDXRemoteProps } from 'next-mdx-remote/rsc'
import { Link as TextLink } from '@/components/ui/link'
import { Num } from '@/components/ui/layout'
import { QuickCalculator } from '@/components/quick-calculator'
import { Callout } from '@/components/wissen/callout'
import { ChartFigure, Figure } from '@/components/wissen/figure'
import { ArbeitLeistungChart } from '@/components/wissen/charts/arbeit-leistung-chart'
import { NetzebenenGrafik } from '@/components/wissen/charts/netzebenen-grafik'
import { EntzerrungChart } from '@/components/wissen/charts/entzerrung-chart'

/**
 * DIE MDX-KOMPONENTEN-MAP — das Leseerlebnis des Wissen-Bereichs (§10.1
 * „Reader-seitiges ‚schönes CMS'-Erlebnis" = Phase 1).
 *
 * Hier wird aus Markdown Typografie. Zwei Dinge passieren:
 *
 *   1. STANDARD-MARKDOWN wird auf unsere Tokens gemappt (h2/h3/p/ul/a/…). Der
 *      Autor schreibt `## Was sich ändert` und bekommt `text-h2 text-ink` —
 *      er muss keine Klasse kennen. Das ist die Voraussetzung dafür, dass ein
 *      Autoren-UI (§10.1, Phase 2) je funktionieren kann: In einem WYSIWYG-Editor
 *      gibt es keine Tailwind-Klassen, nur „Überschrift 2".
 *   2. RICH-BAUSTEINE werden als Namen verfügbar gemacht (`<Callout>`,
 *      `<ChartFigure>`, …). MDX kann sie ohne Import benutzen.
 *
 * WARUM KEIN `@tailwindcss/typography` (`prose`): Das Plugin bringt eine EIGENE
 * Typo-Skala und eigene Farben mit. Die müssten anschließend Zeile für Zeile auf
 * DESIGN.md zurückgebogen werden — eine zweite Wahrheit neben `tailwind.config.ts`,
 * genau das, was DESIGN.md („Wahrheit ist globals.css") vermeidet. Eine
 * explizite Map ist länger, aber sie hat keinen Ton, den niemand entschieden hat.
 *
 * WARUM DIE BREITE AN DEN ELEMENTEN HÄNGT UND NICHT AM CONTAINER: Fließtext läuft
 * auf `max-w-prose` (68ch, DESIGN.md), Grafiken dürfen breiter stehen (§7.5,
 * s. `figure.tsx`). Läge die Begrenzung am Wrapper, könnte kein Chart je
 * ausbrechen. Deshalb trägt JEDES Textelement seine eigene `max-w-prose` —
 * unschön im Code, richtig im Ergebnis.
 *
 * ABSTÄNDE: `mt-*` an den Elementen statt `space-y` am Wrapper. Bei MDX ist die
 * Kind-Reihenfolge beliebig (ein H2 nach einem Chart braucht mehr Luft als ein
 * P nach einem P) — ein gleichmäßiges `space-y` kann das nicht unterscheiden.
 * Das ist die bewusste Ausnahme von der DESIGN.md-Regel „Abstände aus dem
 * Layout": Hier IST der Rhythmus die Typografie.
 */

/** Fließtext-Elemente teilen sich die Textbreite — an einer Stelle definiert. */
const PROSE = 'max-w-prose'

/*
 * Der Typ kommt aus `next-mdx-remote` selbst und NICHT aus `mdx/types`
 * (`@types/mdx`): Das wäre eine zusätzliche Abhängigkeit für genau einen Typ —
 * und zwar für einen, der nur zufällig derselbe ist. `MDXRemoteProps['components']`
 * ist per Definition das, was `compileMDX` hier tatsächlich entgegennimmt; eine
 * Signaturänderung dort fiele damit sofort auf.
 */
type MdxComponentMap = NonNullable<MDXRemoteProps['components']>

export const mdxComponents: MdxComponentMap = {
  /*
   * KEIN h1 IN DER MAP — mit Absicht. Die H1 des Artikels kommt aus dem
   * Frontmatter (`title`) und wird vom Artikel-Header gerendert, nicht aus dem
   * MDX-Körper. Ein `# …` im Text wäre eine zweite H1 auf derselben Seite und
   * damit ein Bruch der Heading-Hierarchie (§6.4). Schreibt ein Autor trotzdem
   * eine, fällt sie als unformatierte Standard-h1 auf — sichtbar, statt still.
   */
  h2: ({ children, ...props }) => (
    <h2 className={`mt-14 scroll-mt-24 text-h2 text-ink ${PROSE}`} {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className={`mt-10 scroll-mt-24 text-h3 text-ink ${PROSE}`} {...props}>
      {children}
    </h3>
  ),
  h4: ({ children, ...props }) => (
    <h4 className={`mt-8 scroll-mt-24 text-h4 text-ink ${PROSE}`} {...props}>
      {children}
    </h4>
  ),
  p: ({ children, ...props }) => (
    <p className={`mt-5 text-body text-text ${PROSE}`} {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    // `list-outside`: Der Aufzählungspunkt steht in der Marge, der Textblock
    // bleibt mit dem Fließtext auf einer Kante. `list-inside` würde die zweite
    // Zeile unter den Punkt ziehen und die Spalte ausfransen.
    <ul
      className={`mt-5 list-outside list-disc space-y-2 pl-5 text-body text-text ${PROSE}`}
      {...props}
    >
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol
      className={`mt-5 list-outside list-decimal space-y-2 pl-5 text-body text-text ${PROSE}`}
      {...props}
    >
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    // `marker:text-text-muted`: Der Punkt ist Struktur, nicht Inhalt — er soll
    // nicht so laut sein wie der Text daneben.
    <li className="marker:text-text-muted" {...props}>
      {children}
    </li>
  ),
  /*
   * Links im Fließtext sind UNTERSTRICHEN (`variant="inline"`, der Default):
   * Farbe allein darf nicht das einzige Merkmal sein (WCAG 1.4.1, §9.4).
   *
   * INTERN vs. EXTERN wird hier entschieden, nicht vom Autor: Ein interner Pfad
   * („/peak-shaving") muss über den locale-bewussten Link laufen (DESIGN.md:
   * „Immer der Link aus @/i18n/navigation, nie next/link"), sonst fehlt bei einer
   * zweiten Sprache das Präfix. Externe Quellen (§9.5) bekommen `rel`/`target`.
   * Der Autor schreibt in beiden Fällen nur `[Text](ziel)` — die Unterscheidung
   * ist Infrastruktur, keine Redaktionsaufgabe.
   */
  a: ({ href, children, ...props }) => {
    const target = String(href ?? '')
    if (target.startsWith('/')) {
      return (
        <TextLink href={target} {...props}>
          {children}
        </TextLink>
      )
    }
    return (
      <a
        href={target}
        target="_blank"
        // `noreferrer` zusätzlich zu `noopener`: Quellenlinks zeigen auf Behörden
        // (E-Control, RIS) — die brauchen unseren Referrer nicht.
        rel="noopener noreferrer"
        className="rounded-sm text-accent underline decoration-accent underline-offset-[3px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        {...props}
      >
        {children}
      </a>
    )
  },
  strong: ({ children, ...props }) => (
    // `text-ink` statt nur `font-semibold`: Hervorhebung im Fließtext (der auf
    // `--color-text` läuft) wird durch den dunkleren Ton zusätzlich sichtbar,
    // ohne eine Farbe einzuführen. Teal wäre hier falsch (DESIGN.md: „Teal ist
    // kein Textton").
    <strong className="font-semibold text-ink" {...props}>
      {children}
    </strong>
  ),
  blockquote: ({ children, ...props }) => (
    // Wörtliches Zitat aus einer Quelle — der senkrechte Strich statt
    // Anführungszeichen-Grafik. Ruhig, kein Dekor.
    <blockquote
      className={`mt-6 border-l-2 border-line-strong pl-5 text-body italic text-text-muted ${PROSE}`}
      {...props}
    >
      {children}
    </blockquote>
  ),
  hr: (props) => <hr className={`mt-12 border-line ${PROSE}`} {...props} />,
  /*
   * TABELLEN — der einzige Ort im Artikel, an dem Zahlen in SPALTEN stehen.
   * `tabular-nums` ist dort Pflicht (§7.4/DESIGN.md), sonst springen die Ziffern
   * und die Spalte ist nicht mehr vergleichbar. Es sitzt an `td`, nicht an der
   * Tabelle: Kopfzellen tragen Wörter, keine Beträge.
   *
   * `overflow-x-auto` am Wrapper: Eine Tabelle ist das Element, das auf 375 px
   * am ehesten die Seite sprengt — und die globale `overflow-x: clip`-Bremse
   * würde sie ABSCHNEIDEN statt scrollbar zu machen (DESIGN.md).
   */
  table: ({ children, ...props }) => (
    <div className="mt-6 max-w-prose overflow-x-auto">
      <table className="w-full border-collapse text-left text-small" {...props}>
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...props }) => (
    <th
      className="border-b border-line-strong pb-2 pr-4 align-bottom font-semibold text-ink"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td
      className="border-b border-line py-2 pr-4 align-top tabular-nums text-text-muted"
      {...props}
    >
      {children}
    </td>
  ),

  // — Rich-Bausteine: ohne Import in MDX verfügbar —
  Callout,
  ChartFigure,
  Figure,
  /*
   * Die generierten Grafiken des 2027-Artikels (§6.5/§7.5).
   *
   * Sie stehen bewusst in DIESER Map und nicht als Import im MDX: Ein
   * Autoren-UI (§10.1, Phase 2) kann keine Import-Zeile schreiben — es kennt
   * nur Bausteine, die es einfügen darf. Was hier steht, ist genau diese Palette.
   *
   * Artikelspezifisch, nicht generisch — und das ist in Ordnung: Ein Chart, das
   * die Netzebenen zeigt, ist für den 2027-Artikel gebaut. Wird er je gelöscht,
   * fällt hier eine unbenutzte Zeile auf (der Linter hat genau das schon einmal
   * getan, s. Bericht) statt still zu bleiben.
   */
  ArbeitLeistungChart,
  NetzebenenGrafik,
  EntzerrungChart,
  /**
   * `<Num>` für einzelne Finanz-/Lastwerte MITTEN im Fließtext. Im Artikel
   * selten nötig (Prosa-Zahlen stehen nicht in Spalten), aber vorhanden, damit
   * ein Autor eine Zahl, die untereinander verglichen wird, korrekt setzen kann,
   * ohne eine Klasse zu kennen.
   */
  Num,
  /**
   * Der SCHNELLRECHNER (§5.4/§6.5). UNVERÄNDERT dieselbe Komponente wie auf der
   * Startseite, /peak-shaving und den Branchenseiten — nicht geforkt, und
   * bewusst OHNE Prefill-Props: Eine Zahl, die in einem Artikel über Werkstätten
   * schon im Feld steht, liest sich als Benchmark, den §9.5 nicht deckt. Sie
   * bringt ihren eigenen CTA („Zum Kalkulator") mit; ein zweiter Button daneben
   * wäre der Doppel-CTA-Fehler, der an anderer Stelle schon behoben wurde.
   */
  Schnellrechner: () => (
    <div className="mt-8 max-w-prose">
      <QuickCalculator />
    </div>
  ),
}
