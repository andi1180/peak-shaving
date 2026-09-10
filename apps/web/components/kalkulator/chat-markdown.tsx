'use client'

/**
 * B24 — MARKDOWN IM CHAT-VERLAUF (neunter Bauschritt).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ NUR DIE ANZEIGE ZIEHT NACH — DAS MODELL ANTWORTET SEIT JE IN MARKDOWN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `system-prompt.ts` sagt zur FORMATIERUNG nichts (gemessen: kein Wort zu Markdown, Listen oder
 * Fettung); Claude schreibt von sich aus `**…**` und nummerierte Listen. Bis hierher rendete
 * `project-chat.tsx` diesen Text als `whitespace-pre-wrap`-Plaintext — die Steuerzeichen standen
 * also WÖRTLICH in der Blase. Geändert wird deshalb ausschliesslich die Darstellung; Agent,
 * Werkzeuge, Ausführer und System-Prompt sind mit 0 Zeilen Diff unangetastet.
 *
 * ── ⚠ WARUM NICHT `next-mdx-remote`, das im Repo BEREITS LIEGT ────────────────────────────────
 * Die Pflichtprüfung „ist schon ein Markdown-Renderer da?" fällt formal mit JA aus
 * (`apps/web` führt `next-mdx-remote` für die Wissen-Artikel). Wiederverwenden geht trotzdem
 * nicht, und zwar aus zwei unabhängigen Gründen:
 *
 *   (1) ES IST SERVER-ONLY. Der einzige Einstieg im Repo ist `compileMDX` aus
 *       `next-mdx-remote/rsc` (`components/wissen/article-page.tsx`) — eine async RSC-Funktion.
 *       Der Chat-Verlauf wächst dagegen CLIENT-seitig: nach jedem Turn hängt `setEntries` eine
 *       Blase an, ohne dass die Seite neu vom Server kommt. Ein serverseitig kompilierter Körper
 *       erreichte genau die neu eintreffenden Antworten nie.
 *   (2) MDX WERTET JSX AUS. Das ist für redaktionelle Repo-Dateien der Zweck (`<Callout>`,
 *       `<ChartFigure>`), für Modelltext wäre es die „raw html"-Fläche, die dieser Schritt
 *       ausdrücklich nicht öffnen soll — `<img onerror=…>` im Antworttext wäre dort ein Element
 *       und kein Text.
 *
 * Deshalb `react-markdown`: verbreitet, rein clientfähig, und es erzeugt React-Elemente DIREKT.
 * Es gibt in dieser Kette kein `dangerouslySetInnerHTML` und keinen HTML-String — die
 * Sicherheitszusage ist damit eine Eigenschaft des Aufbaus und nicht einer Einstellung.
 *
 * ── ⚠ ROHES HTML: NICHTS AUSGEFÜHRT, NICHTS STILL VERSCHLUCKT ─────────────────────────────────
 * `rehype-raw` ist NICHT eingebunden (und darf es nicht werden). react-markdown macht aus einem
 * `raw`-Knoten dann einen TEXT-Knoten — `<script>…</script>` erscheint also als sichtbarer,
 * escapeter Text und wird nicht ausgeführt. `skipHtml` (das ihn ersatzlos entfernen würde) ist
 * bewusst NICHT gesetzt: der Verlauf zeigt, was das Modell gesagt hat (Kopf von `transcript.ts` —
 * weggelassen wird nur, WOMIT die Anwendung gearbeitet hat, nie eine Antwort an den Kunden), und
 * ein spurlos verschwundener Halbsatz wäre die schlechtere Auskunft.
 *
 * `allowedElements` ist die ZWEITE Schicht, unabhängig von der ersten: sie hält auch dann, wenn
 * jemand später `rehype-raw` ergänzt (dann würden aus `raw`-Knoten echte Elemente — und
 * `<script>`/`<iframe>`/`<style>` stehen hier nicht in der Liste). Dieselbe Richtung wie die
 * Erlaubnisliste in `transcript.ts`: ein künftiges Element erscheint nicht von selbst.
 * ⚠ Wer die Liste erweitert (etwa um `table` für `remark-gfm`), ergänzt unten auch die
 * Darstellung — ein erlaubtes Element ohne Eintrag in der Map rendert ohne jede Klasse.
 *
 * ── WARUM EINE EIGENE KOMPONENTEN-MAP UND NICHT `components/wissen/mdx-components.tsx` ────────
 * Jene ist ARTIKEL-Typografie (`mt-14`, `text-h2`, `max-w-prose`) und zieht ausserdem
 * `QuickCalculator` und drei Recharts-Grafiken mit — die lägen danach im Client-Bündel der
 * Chat-Route. Übernommen ist von dort die BEGRÜNDUNG, kein Code: kein
 * `@tailwindcss/typography`, sondern eine ausdrückliche Map auf DESIGN.md-Tokens. Das Plugin
 * brächte eine eigene Typo-Skala und eigene Farben mit — eine zweite Wahrheit neben
 * `tailwind.config.ts`.
 *
 * ── ABSTÄNDE: `mt-*` AM ELEMENT, `first:mt-0` STATT `space-y` AM WRAPPER ──────────────────────
 * Wie in der Artikel-Map: die Kind-Reihenfolge ist beliebig (eine Liste nach einem Absatz braucht
 * anderen Abstand als ein Absatz nach einem Absatz), und der ERSTE Block darf keinen Abstand nach
 * oben haben — er sitzt direkt unter der Rollen-Beschriftung der Blase.
 */
import * as React from 'react'
import Markdown, { type Components } from 'react-markdown'

/**
 * Was gerendert werden darf. Bewusst KEINE Sperrliste (`disallowedElements`): mit ihr erschiene
 * jedes künftig hinzukommende Element von selbst, und niemand merkte es beim Hinzufügen.
 *
 * `br` steht darin, weil ein harter Zeilenumbruch (zwei Leerzeichen am Zeilenende) gültiges
 * CommonMark ist; `table`/`del` fehlen, weil ohne `remark-gfm` gar keine entstehen können.
 */
const ALLOWED_ELEMENTS = [
  'p',
  'br',
  'strong',
  'em',
  'ul',
  'ol',
  'li',
  'a',
  'code',
  'pre',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
]

/** Alle Blockelemente teilen sich denselben Abstand nach oben — an einer Stelle definiert. */
const BLOCK = 'mt-3 first:mt-0'

const COMPONENTS: Components = {
  p: ({ children, ...props }) => (
    <p className={`${BLOCK} break-words text-body text-ink`} {...props}>
      {children}
    </p>
  ),
  /*
   * `text-ink` zusätzlich zu `font-semibold` — dieselbe Entscheidung wie in der Artikel-Map:
   * Hervorhebung wird durch den dunkleren Ton zusätzlich sichtbar, ohne eine Farbe einzuführen.
   * (Teal wäre hier falsch, DESIGN.md: „Teal ist kein Textton".)
   */
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-ink" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="italic" {...props}>
      {children}
    </em>
  ),
  /*
   * `list-outside`: der Aufzählungspunkt steht in der Marge, die zweite Zeile bleibt mit der
   * ersten auf einer Kante. `list-inside` zöge sie unter den Punkt und liesse die Spalte
   * ausfransen — in einer 85 % breiten Blase auf 375 px besonders sichtbar.
   */
  ul: ({ children, ...props }) => (
    <ul className={`${BLOCK} list-outside list-disc space-y-1 pl-5 text-body text-ink`} {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol
      className={`${BLOCK} list-outside list-decimal space-y-1 pl-5 text-body text-ink`}
      {...props}
    >
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="break-words marker:text-text-muted" {...props}>
      {children}
    </li>
  ),
  /*
   * Links im Modelltext gehen IMMER in einen neuen Tab: der Kunde soll ein laufendes Gespräch
   * nicht dadurch verlassen, dass er auf eine Quelle klickt (der Entwurf lebt im Client-Zustand,
   * eine Navigation weg und zurück verlöre die nicht abgeschickte Eingabe).
   *
   * Ausdrücklich NICHT der locale-bewusste Link aus `@/i18n/navigation`: was hier ankommt, ist
   * eine ADRESSE aus einem Modelltext und kein Pfad-Schlüssel unserer Seitenstruktur.
   *
   * `javascript:`-Ziele fängt react-markdowns `defaultUrlTransform` ab (der Href wird dann leer)
   * — das ist Standardverhalten und wird hier bewusst NICHT durch eine eigene Prüfung ersetzt.
   */
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-sm text-accent underline decoration-accent underline-offset-[3px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      {...props}
    >
      {children}
    </a>
  ),
  /*
   * ⚠ EIN ELEMENT, ZWEI FÄLLE: `code` steht für Inline-Code UND für den Inhalt eines Codeblocks
   * (`pre > code`). Die Klassen hier sind für den INLINE-Fall gesetzt; im Block bringt `pre` die
   * Fläche mit, und ein zweiter Kasten im ersten sähe wie ein Fehler aus.
   *
   * Aufgelöst wird das über einen Nachfahren-Selektor an `pre` (s. dort) und ausdrücklich NICHT
   * über den gerenderten Baum: react-markdown 10 hat den `inline`-Prop entfernt, und der Elterntyp
   * ist im übergebenen `node` nicht getypt (`Element` kennt kein `parentNode` — vom Typecheck
   * gemessen). Die `language-*`-Klasse taugt ebenfalls nicht: die trägt ein Block nur, wenn das
   * Modell eine Sprache angegeben hat.
   */
  code: ({ children, ...props }) => (
    <code className="rounded bg-surface px-1 py-0.5 text-[0.9em] text-ink" {...props}>
      {children}
    </code>
  ),
  /*
   * `overflow-x-auto`: ein Codeblock ist das Element, das auf 375 px am ehesten die Seite sprengt
   * — und die globale `overflow-x: clip`-Bremse (DESIGN.md) würde ihn ABSCHNEIDEN statt scrollbar
   * zu machen. Dieselbe Vorkehrung wie bei den Tabellen der Artikel-Map.
   *
   * `[&>code]:…` nimmt dem inneren `code` seine Inline-Fläche wieder ab (s. oben) — ein
   * Kind-Selektor, damit ein Inline-Code in einem Absatz DANEBEN unberührt bleibt.
   */
  pre: ({ children, ...props }) => (
    <pre
      className={`${BLOCK} overflow-x-auto rounded-md bg-surface p-3 text-small text-ink [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit`}
      {...props}
    >
      {children}
    </pre>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      className={`${BLOCK} border-l-2 border-line-strong pl-4 text-body italic text-text-muted`}
      {...props}
    >
      {children}
    </blockquote>
  ),
  hr: (props) => <hr className={`${BLOCK} border-line`} {...props} />,
}

/*
 * ⚠ ALLE SECHS ÜBERSCHRIFTENGRADE AUF DIESELBE, ZURÜCKHALTENDE FORM.
 * Eine Sprechblase ist kein Dokument: `# Ihre Auslegung` als `text-h1` (2,5 rem) neben einem
 * 16-px-Absatz sähe aus, als sei die Seite kaputt. Sie werden deshalb bewusst NICHT
 * gestaffelt — was sie leisten sollen, ist eine Zwischenüberschrift, nicht eine Hierarchie.
 * Und sie bleiben `<hN>`, statt auf `<p>` umgebogen zu werden: was das Modell als Überschrift
 * meint, soll auch vorgelesen eine sein.
 */
for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
  COMPONENTS[tag] = ({ children, ...props }) => {
    const Tag = tag
    return (
      <Tag className={`${BLOCK} break-words text-h4 text-ink`} {...props}>
        {children}
      </Tag>
    )
  }
}

/**
 * Der Antworttext einer `assistant`-Blase als Markdown.
 *
 * ⚠ AUSDRÜCKLICH NUR DORT: Nutzer-Blasen bleiben Plaintext. Der Kunde schreibt kein Markdown, und
 * seine eigenen Zeichen (`*`, `_`, `#`, eine Zeile, die mit `1.` beginnt) dürfen seine Nachricht
 * nicht umformatieren — was er getippt hat, muss dastehen, wie er es getippt hat.
 */
export function ChatMarkdown({ text }: { text: string }) {
  return (
    <Markdown allowedElements={ALLOWED_ELEMENTS} components={COMPONENTS}>
      {text}
    </Markdown>
  )
}
