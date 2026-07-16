# DESIGN.md — coolin.at (Website)

> Konkrete Design-Tokens der Marketing-Website. Die **bindenden Prinzipien** stehen im
> `./Pflichtenheft_Website_Coolin.md` (§7) — diese Datei liefert die Werte und die Begründung je Entscheidung.
> Bei Widerspruch gilt das Pflichtenheft.
>
> **Wahrheit ist `app/globals.css`.** Diese Datei beschreibt, was dort steht; sie ersetzt es nicht.
> Gespiegelt am Muster der Kalkulator-`DESIGN.md` (Repo-Root), weil Tokens sich schneller ändern als die Fachlogik.
>
> **Review-Seite: `/styleguide`** — dort ist alles live zu sehen. Nicht Teil der öffentlichen Navigation, `noindex`.

---

## Design-Philosophie

Vertrauen für Investitionsentscheidungen im fünfstelligen Bereich. Professionell, ruhig, klar
strukturiert (Pflichtenheft §7.1). Die Marketing-Seite darf ausdrucksstärker sein als der
Kalkulator — aber **nicht mit einer anderen Kern-Palette**.

**Der zentrale Konsistenz-Auftrag:** Der Nutzer geht Marketing → Pro-Kalkulator. Wenn dabei die
Farben wechseln, wirkt es wie zwei Firmen. Deshalb sind Akzent, Ink-, Surface- und Semantik-Werte
**deckungsgleich mit der Kalkulator-`DESIGN.md`** übernommen. Web-spezifisch ergänzt ist nur:

| Ergänzung | Warum |
|---|---|
| `--color-navy` (Anker) | Marke/Struktur. Der Kalkulator ist ein Werkzeug und braucht keinen Markenanker; eine Marketing-Seite schon. Bestandston aus `reference/favicon.png`. |
| `--color-node` | Der hellere Teal-Knoten des Emblems. Nur Grafik, kein UI-Ton. |
| `--color-*-subtle` | Getönte Flächen der Signalfarben (technisch nötig, s. „Kein /alpha"). |
| `--color-accent-border` | Rand einer Akzent-Fläche. |

---

## Farben

**Ein Anker + ein Akzent — nicht zwei Farben, die kämpfen** (Pflichtenheft §7.2).
Navy trägt Marke und Struktur, Teal ist das seltene Signal. Alle Werte sind CSS-Variablen.

```css
/* — Anker: Marke & Struktur — */
--color-navy:            #18336f;  /* Wortmarke, Emblem, tragende Flächen */
--color-navy-hover:      #142a5c;

/* — Akzent: EINZIG, sparsam (CTA / positive Signale) — */
--color-accent:          #0f766e;  /* Teal 700 — identisch zum Kalkulator */
--color-accent-hover:    #0e6b64;
--color-accent-subtle:   #f0fdfa;  /* Teal 50  — Callout-Flächen */
--color-accent-border:   #99f6e4;  /* Teal 200 — Rand einer Akzent-Fläche */
--color-node:            #14b8a6;  /* Teal 500 — NUR Emblem/Signature */

/* — Ink / Text — */
--color-ink:             #0f172a;  /* Slate 900 — Überschriften */
--color-text:            #1e293b;  /* Slate 800 — Fließtext */
--color-text-muted:      #475569;  /* Slate 600 — Sekundärtext */

/* — Flächen / Struktur — */
--color-surface:         #ffffff;
--color-surface-alt:     #f8fafc;  /* Slate 50  — Off-White-Grund */
--color-surface-sunken:  #f1f5f9;  /* Slate 100 — Zeilen/Felder */
--color-border:          #e2e8f0;  /* Slate 200 — dünne Ränder */
--color-border-strong:   #cbd5e1;  /* Slate 300 — Feldränder */

/* — Semantisch: NUR Zahlen mit Bedeutung — */
--color-positive:        #15803d;  --color-positive-subtle: #f0fdf4;
--color-negative:        #b91c1c;  --color-negative-subtle: #fef2f2;
--color-warning:         #b45309;  --color-warning-subtle:  #fffbeb;

/* — Kontrast-Paarungen (reine Lesbarkeit, kein Branding) — */
--color-on-accent:       #ffffff;
--color-on-navy:         #ffffff;
```

### Begründung je Entscheidung

- **Navy `#18336f` statt reinem Slate:** Bestandston der Marke (Favicon). Als Anker glaubwürdiger
  als ein generisches Dunkelgrau, und er trägt große Flächen, ohne mit dem Teal zu kämpfen.
- **Teal 700 `#0f766e` statt des alten `#15b8b0`:** das helle Teal liest sich Consumer/techy.
  Entsättigt wirkt es seriös — und ist deckungsgleich mit dem Kalkulator (§7.2).
- **Neutrale = Slate, nicht neutrales Grau:** Slate ist blaustichig und damit auf Navy/Teal
  abgestimmt. Ein reines Mittelgrau wirkt daneben unbestimmt.
- **Pastell vermieden:** die `*-subtle`-Töne sind Flächen für Text, keine Farbträger. Die
  Signalwirkung liegt immer auf dem gesättigten 700er-Ton.
- **Keine Gradienten** (§7.2): weder Tokens noch Utilities. Flache Flächen, dünne Linien.

### Geprüfte Kontraste (gerechnet, nicht geschätzt)

WCAG 2.1 AA verlangt **4,5:1** für Fließtext, **3:1** für große Schrift/UI-Elemente.

| Paarung | Ratio | Urteil |
|---|---:|---|
| Ink `#0f172a` auf Off-White `#f8fafc` | 17,06:1 | AAA |
| Text `#1e293b` auf Off-White | 13,98:1 | AAA |
| Weiß auf Navy `#18336f` | 12,06:1 | AAA |
| Navy `#18336f` auf Off-White | 11,52:1 | AAA |
| Text muted `#475569` auf Off-White | 7,24:1 | AAA |
| Text muted `#475569` auf Sunken `#f1f5f9` | 6,92:1 | AA |
| Weiß auf Accent-Hover `#0e6b64` | 6,35:1 | AA |
| Negative `#b91c1c` auf Weiß | 6,47:1 | AA |
| **Teal 700 `#0f766e` auf Weiß** | **5,47:1** | **AA (nicht AAA)** |
| Weiß auf Teal 700 (Primär-Button) | 5,47:1 | AA |
| Negative auf Negative-subtle | 5,91:1 | AA |
| Accent auf Accent-subtle | 5,25:1 | AA |
| Positive `#15803d` auf Weiß | 5,02:1 | AA |
| Warning `#b45309` auf Weiß | 5,02:1 | AA |
| Warning auf Warning-subtle | 4,84:1 | AA |
| Positive auf Positive-subtle | 4,79:1 | AA |
| Node `#14b8a6` auf Navy (Emblem) | 4,84:1 | AA (Grafik) |

**Regel — Teal ist kein Textton.** Teal 700 erfüllt auf Weiß mit 5,47:1 formal AA für Fließtext,
verfehlt AAA (7:1) aber deutlich. Fließtext läuft in Navy/Slate; Teal bleibt CTA, Links, aktiven
Zuständen und großen Elementen vorbehalten. Das ist keine reine Kontrast-Frage, sondern der
Sparsamkeits-Grundsatz: ein Akzent, der überall steht, ist kein Akzent mehr.

**Regel — Grün/Rot/Bernstein sind reserviert** für Ersparnis / Kosten / Warnung. Nie als Dekor,
sonst verlieren sie ihre Signalwirkung (identisch zur Kalkulator-`DESIGN.md`).

### Regel: kein `/alpha` auf Token-Farben

`bg-positive/10` funktioniert **nicht** und schlägt **still** fehl — die Fläche bleibt transparent,
ohne Fehlermeldung. Grund: Tailwind v3 kann den Alpha-Modifier nur auf Farben anwenden, die es
selbst zerlegen kann; unsere Tokens sind `var(--x)` mit fertigem Hex-Wert. Auf Kanal-Tripel
(`15 118 110`) umzustellen ist keine Option — Emblem und Wortmarke brauchen `fill="var(--color-node)"`
als fertige Farbe.

**Deshalb:** für getönte Flächen die `*-subtle`-Tokens nutzen. Alpha-Modifier sind nur auf Tailwinds
eigener Palette erlaubt (`bg-white/10`, `border-white/30` — die funktionieren).
*Dieser Fehler war beim Bau real vorhanden und wurde erst durch Nachmessen im Browser sichtbar.*

---

## Typografie

```css
--font-sans:    Inter (next/font, selbst gehostet)
--font-display: Source Serif 4 (next/font, selbst gehostet) — OPTIONAL, s. offene Punkte
```

- **Inter** für Text, UI und **alle Zahlen** (§7.4). Konsistent zum Kalkulator, exzellente
  Zahlen-Lesbarkeit. Über `next/font` selbst gehostet: die Dateien werden zur **Build-Zeit**
  geladen und von der eigenen Domain ausgeliefert — im Browser entsteht **kein** Request an Google.
- **`tabular-nums` ist Pflicht** bei allen Finanz-/Lastwerten — sonst springen Ziffern in Spalten
  und Beträge lassen sich nicht vergleichen. Wrapper: `<Num>` in `components/ui/layout.tsx`.

### Skala (`tailwind.config.ts`, `fontSize`)

| Token | Größe | Weight / Tracking | Einsatz |
|---|---|---|---|
| `text-h1` | 40 px | 650 / −0,022em | Seitentitel |
| `text-h2` | 30 px | 600 / −0,015em | Sektionsüberschrift |
| `text-h3` | 22 px | 600 / −0,01em | Unterabschnitt |
| `text-h4` | 18 px | 600 | Karten-Titel |
| `text-lead` | 18 px | 400 / lh 1,85 | Einleitungen |
| `text-body` | 16 px | 400 / lh 1,65 | Fließtext |
| `text-small` | 14 px | 400 | UI, Tabellen |
| `text-caption` | 13 px | 400 | Quellen, Meta |
| `text-label` | 12 px | 600 / +0,08em | Eyebrow (uppercase) |

Negatives Tracking wächst mit der Schriftgröße: große Inter-Grade laufen sonst zu locker.
Fließtext bei ~65–75 Zeichen halten (`max-w-prose` = 68ch).

---

## Marke

### Emblem — **Platzhalter**

`components/brand/emblem.tsx` ist eine **Nachzeichnung** von `reference/favicon.png` (Navy-Squircle,
dünne Netzlinien, ein heller Messpunkt, zwei Teal-Knoten) — **kein offizielles Asset**. Das
hochauflösende Original liefert Andreas (Pflichtenheft §7.4, **OP#7**). Danach wird **nur diese
Datei** ersetzt; Wortmarke und Lockup bleiben unberührt.
`inverse` liefert die Fassung für dunkle Gründe (heller Grund, Navy-Linien) — ohne sie verschwindet
der Navy-Squircle auf einer Navy-Fläche.

### Wortmarke

Drei Varianten (`components/brand/wordmark.tsx`), gemeinsame Regeln:

- „COOLiN" kräftig, „ENERGY" leichter und gesperrt (§7.4).
- **Das Klein-„i" ist die Klammer zum Emblem:** sein Punkt IST ein Teal-Knoten. Deshalb wird das
  „i" nicht als Buchstabe gesetzt, sondern als Geometrie gezeichnet (Stamm + Knoten) — nur so sitzt
  der Knoten exakt und skaliert mit.
- Flach, kein Gradient. Schrift = `currentColor` → dieselbe Komponente läuft Navy-auf-Weiß und
  Weiß-auf-Navy. `monochrome` zwingt den Knoten auf `currentColor` (1-Farb-Druck/Gravur).
- **Farbe steht am Lockup, nicht in der Wortmarke** — sonst gewinnt ein hartkodiertes `text-navy`
  gegen ein von außen gesetztes `text-white` (war ein realer Bug).

| Variante | Charakter |
|---|---|
| **A „Kompakt"** | COOLiN 700, ENERGY 400 gesperrt, satter Knoten. Sachlichste Lesart. |
| **B „Knoten"** | COOLiN 600, i-Punkt hängt an einer Leitung + Mess-Ring. Stärkster Emblem-Bezug, erzählender. |
| **C „Gestapelt"** | ENERGY exakt auf COOLiN-Breite darunter (`textLength`). Kompakteste Grundfläche, i-Punkt als offener Ring. |

**Metrik-Abhängigkeit (bewusst):** Die Koordinaten sind an Inters echten Glyphenbreiten vermessen
(`getComputedTextLength` im Browser, font-size 100) — nicht geschätzt. Für die Website korrekt:
Inter ist über `next/font` garantiert geladen, die Marke bleibt kopier-/durchsuchbar. **Für finale
Export-Assets** (Print, Partner, Systeme ohne Inter) werden die Texte **in Pfade konvertiert**.

**Clear-Space:** 0,5 × Emblemhöhe auf allen Seiten. Steht als `padding` im `Lockup`-Code, nicht nur
in einem Dokument.

### Signature-Motiv

`components/brand/signature.tsx` — aus dem Emblem abgeleitete Netzlinien mit Knoten
(`SignatureRule` = Trenner, `SignatureField` = Fläche). Linien in `currentColor` mit niedriger
Deckkraft, nur die Knoten tragen den Akzent. Gedacht als **seltenes** Wiedererkennungs-Element,
nicht als Muster über die Seite. **Aktuell nirgends verdrahtet** — Einsatz ist eine offene
Entscheidung (s. u.).

---

## Layout & Gestaltung

- **Spacing:** 4er-Raster über die Tailwind-Skala. Abstände zwischen Geschwistern kommen aus dem
  Layout (`gap`/`space-y`), **nicht** aus Einzel-Margins — die kollabieren oder verdoppeln sich sonst.
- **Container:** `max-w-container` (1152px), horizontale Ränder an genau einer Stelle
  (`components/ui/layout.tsx`).
- **Radius:** `--radius: 0.5rem` → `sm` 4px / `md` 6px / `lg` 8px. Bewusst zurückhaltend. Die einzige
  stark gerundete Form ist das Emblem — dort ist die Rundung Teil der Marke.
- **Karten:** dünner Rand (`--color-border`), **kein Schlagschatten** (§7.5). Tiefe entsteht über
  die Fläche (`surface` vs. `surface-alt` vs. `surface-sunken`).
- **Responsive:** Mobile/Tablet/Desktop gleichwertig (§7.5). `html`/`body` haben eine globale
  `overflow-x`-Bremse.

---

## Bausteine (`components/ui/`)

| Datei | Inhalt |
|---|---|
| `button.tsx` | `primary` (Teal-Akzent), `secondary` (Navy-Kontur), `ghost`; `sm`/`md`/`lg` |
| `card.tsx` | `Card` + Header/Title/Description/Content/Footer |
| `badge.tsx` | `neutral`/`accent`/`navy` + semantische `positive`/`negative`/`warning` |
| `input.tsx` | `Input`, `Textarea`, `Select`, `Label`, `FieldHint` |
| `link.tsx` | `inline` (unterstrichen), `standalone`, `quiet` |
| `layout.tsx` | `Container`, `Section`, `Eyebrow`, `Num` |

**Konventionen:**

- **shadcn/ui-Bridge:** `globals.css` mappt die shadcn-Namen (`--primary`, `--muted-foreground` …)
  auf unsere Tokens. Kein eigenes Theme — nur Aliasse, damit `shadcn add` weiter funktioniert und
  zugekaufte Primitives unsere Wahrheit rendern. Gleiche Technik wie im Kalkulator.
- **Select ist bewusst nativ.** Radix-Select wäre eine zusätzliche Abhängigkeit für einen Baustein,
  den bisher kein Formular braucht; nativ ist barrierefrei ab Werk und auf Mobile das bessere
  Muster. Sobald ein Formular Suche/Mehrfachauswahl braucht, kann Radix nachgezogen werden — die
  Tokens bleiben.
- **Eingabefelder 16 px.** Kleiner zoomt iOS beim Fokus in das Feld hinein.
- **Fokus ist Pflicht und sichtbar** (§9.4, WCAG 2.1 AA): globale `:focus-visible`-Basis in
  `globals.css`, Buttons/Links verfeinern sie zu einem Ring. Nie entfernen.
- **Links im Fließtext sind unterstrichen** — Farbe allein darf nicht das einzige Merkmal sein
  (WCAG 1.4.1).
- **`prefers-reduced-motion` wird respektiert** (globale Regel in `globals.css`).
- **Keine Gradienten, keine verspielten/Emoji-Icons** (§7.2/§7.3).

---

## Offene Auswahlpunkte — von Andreas auf `/styleguide` zu entscheiden

1. **Display-Schrift: Inter-only oder Inter + Source Serif 4?**
   `text-h1..h4` stehen im Styleguide direkt nebeneinander.
   - *Inter-only* (Default): eine Schrift für alles, ruhig/technisch, identisch zum Kalkulator,
     kein zweiter Font-Download.
   - *Inter + Source Serif 4*: Überschriften redaktioneller, trägt die Fachartikel
     (Leistungstarif 2027, §6.5). Zahlen und Text bleiben in jedem Fall Inter.
   - **Fällt die Wahl auf Inter-only,** wird der `Source_Serif_4`-Block in `app/layout.tsx` und
     `fontFamily.display` in `tailwind.config.ts` ersatzlos entfernt.

2. **Signature-Motiv: einsetzen oder weglassen?**
   Netzlinien + Knoten als seltenes Wiedererkennungs-Element. Aktuell gebaut, aber **nirgends
   verdrahtet** — bei „nein" wird `components/brand/signature.tsx` gelöscht, ohne dass etwas anderes
   davon abhängt.

Beides ist bewusst als Option gebaut und nicht vorentschieden: die Wahl prägt den Charakter jeder
späteren Seite und gehört nicht in einen Implementierungs-Prompt.

---

## Bezug zum Bauplan

Dieser Schritt liefert **nur** das visuelle Fundament (Tokens, Primitives, Marke, `/styleguide`).
Navigation, Header/Footer und echte Seiten kommen in späteren Prompts (Pflichtenheft §11) und bauen
ausschließlich auf diesen Tokens auf.
