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
Marke wechselt, wirkt es wie zwei Firmen. Deshalb sind **Akzent (Teal 700) und die semantischen
Signalfarben deckungsgleich** mit der Kalkulator-`DESIGN.md` übernommen.

**Bewusste Abweichung vom Kalkulator — die Grau-Rampe.** `[Entscheidung Andreas]` Die Neutralen sind
hier **hueless** (Hue-Cast 0), der Kalkulator nutzt noch Slate (blaustichig). Begründung: das
„ein Produkt"-Gefühl trägt der Akzent + die Semantik, nicht der Grauton — und eine blaustichige
Grau-Rampe neben einem Navy-Anker verwässert, welches Blau Absicht ist. Wenn `apps/website` in das
Monorepo absorbiert wird (Pflichtenheft §8.1), übernimmt es diese Neutralen; bis dahin ist die
Abweichung bekannt und gewollt. `apps/website` wurde NICHT angefasst.

| Web-spezifisch | Warum |
|---|---|
| `--color-navy` (Anker) | Marke/Struktur. Der Kalkulator ist ein Werkzeug und braucht keinen Markenanker; eine Marketing-Seite schon. Bestandston aus `reference/favicon.png`. |
| `--color-node` | Der hellere Teal-Knoten des Emblems. Nur Grafik, kein UI-Ton. |
| `--color-*-subtle` | Getönte Flächen der Signalfarben (technisch nötig, s. „Kein /alpha"). |
| `--color-accent-border` | Rand einer Akzent-Fläche. |
| `--color-border-input` | Feldrand mit ≥ 3:1 (WCAG 1.4.11), s. „Geprüfte Kontraste". |
| neutrale Grau-Rampe | s. oben. |

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

/* — Ink / Text — NEUTRAL (Hue-Cast 0), kein Slate — */
--color-ink:             #171717;  /* Neutral 900 — Überschriften */
--color-text:            #262626;  /* Neutral 800 — Fließtext */
--color-text-muted:      #525252;  /* Neutral 600 — Sekundärtext */

/* — Flächen / Struktur — ebenfalls neutral — */
--color-surface:         #ffffff;
--color-surface-alt:     #fafafa;  /* Neutral 50  — Off-White-Grund */
--color-surface-sunken:  #f5f5f5;  /* Neutral 100 — Zeilen/Felder */
--color-border:          #e5e5e5;  /* Neutral 200 — dünne Ränder */
--color-border-strong:   #d4d4d4;  /* Neutral 300 — ruhige Trenner/Konturen */
--color-border-input:    #8f8f8f;  /* Feldrand — MUSS 3:1 erreichen (1.4.11) */

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
- **Neutrale = hueless, NICHT Slate** `[Entscheidung Andreas]`**:** Off-White `#fafafa` und die
  ganze Grau-Rampe tragen keinen Farbstich (gemessen: max(R,G,B) − min(R,G,B) = 0; Slate lag bei
  4–34). Weder blau noch cremefarben. Dadurch sind Navy und Teal die **einzigen** Farben im System —
  sie lesen als Absicht, nicht als Zufall. Die Rampe wurde geschlossen neutralisiert (Flächen,
  Ränder UND Text): eine halb-neutrale Rampe mit blaustichigem Text wäre in sich widersprüchlich.
- **Pastell vermieden:** die `*-subtle`-Töne sind Flächen für Text, keine Farbträger. Die
  Signalwirkung liegt immer auf dem gesättigten 700er-Ton.
- **Keine Gradienten** (§7.2): weder Tokens noch Utilities. Flache Flächen, dünne Linien.

### Geprüfte Kontraste (gerechnet, nicht geschätzt)

WCAG 2.1 AA verlangt **4,5:1** für Fließtext, **3:1** für große Schrift/UI-Elemente.

| Paarung | Ratio | Urteil |
|---|---:|---|
| Ink `#171717` auf Off-White `#fafafa` | 17,18:1 | AAA |
| Text `#262626` auf Off-White | 14,50:1 | AAA |
| Weiß auf Navy `#18336f` | 12,06:1 | AAA |
| Navy `#18336f` auf Off-White | 11,55:1 | AAA |
| Text muted `#525252` auf Off-White | 7,49:1 | AAA |
| Text muted `#525252` auf Sunken `#f5f5f5` | 7,17:1 | AAA |
| Negative `#b91c1c` auf Weiß | 6,47:1 | AA |
| Weiß auf Accent-Hover `#0e6b64` | 6,35:1 | AA |
| Negative `#b91c1c` auf Off-White | 6,20:1 | AA |
| Negative auf Negative-subtle | 5,91:1 | AA |
| **Teal 700 `#0f766e` auf Weiß** | **5,47:1** | **AA (nicht AAA)** |
| Weiß auf Teal 700 (Primär-Button) | 5,47:1 | AA |
| Accent auf Accent-subtle | 5,25:1 | AA |
| Teal 700 auf Off-White | 5,24:1 | AA |
| Positive `#15803d` / Warning `#b45309` auf Weiß | je 5,02:1 | AA |
| Node `#14b8a6` auf Navy (Emblem) | 4,84:1 | AA (Grafik) |
| Warning auf Warning-subtle | 4,84:1 | AA |
| Positive / Warning auf Off-White | je 4,81:1 | AA |
| Positive auf Positive-subtle | 4,79:1 | AA |
| **Feldrand `#8f8f8f` auf Weiß** (1.4.11) | **3,23:1** | **AA (Nicht-Text)** |

Durch die Neutralisierung ist **keine** Paarung schlechter geworden; Text muted stieg von 7,24:1 auf
7,49:1. Alle Werte gegen den neuen Grund `#fafafa` nachgerechnet.

**Regel — Feldränder sind dunkler als Deko-Ränder.** WCAG 2.1 AA (1.4.11 Non-text Contrast) verlangt
≥ 3:1 für die Begrenzung eines Bedienelements: ein **leeres** Eingabefeld ist nur an seinem Rand als
Feld erkennbar. Deshalb `--color-border-input` (3,23:1) für Input/Textarea/Select — nicht der ruhige
`--color-border-strong` (1,48:1), der nur Deko-Linien trägt. *Beim Neu-Messen aufgefallen: der
vorherige Feldrand (slate-300) verfehlte das Kriterium bereits — der Fehler ist älter als die
Neutralisierung, nicht ihre Folge.* Buttons brauchen das nicht: sie tragen ein Label.

**Regel — Teal ist kein Textton.** Teal 700 erfüllt auf Weiß mit 5,47:1 formal AA für Fließtext,
verfehlt AAA (7:1) aber deutlich. Fließtext läuft in Ink/Neutral; Teal bleibt CTA, Links, aktiven
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

### Regel: eigene Schriftgrößen müssen tailwind-merge bekannt sein

`lib/utils.ts` erweitert tailwind-merge um unsere `fontSize`-Namen (`text-body`, `text-h4` …).
**Ohne diese Erweiterung hält tailwind-merge ein unbekanntes `text-body` für eine Textfarbe** und
wirft innerhalb von `cn()` die echte Farbe als vermeintliches Duplikat weg — still, ohne Fehler.
Real aufgetreten: `<Button size="lg" variant="primary">` verlor `text-accent-foreground` und rendrte
dunklen Text auf Teal, während `size="sm"` korrekt weiß blieb. **Wer die `fontSize`-Skala in
`tailwind.config.ts` erweitert, muss den Namen auch in `lib/utils.ts` nachtragen.**

---

## Typografie

```css
--font-sans: Inter (next/font, selbst gehostet)   /* die EINZIGE Schrift */
```

**`[Entscheidung Andreas]` Inter-only.** Es gibt bewusst keine Display-Schrift und kein
Font-Mixing. Source Serif 4 wurde vollständig aus dem Projekt entfernt (Layout, Tailwind-Config,
Styleguide). Eine Schrift für Text, UI und Zahlen — ruhig, technisch, konsistent zum Kalkulator,
und ein Font-Download weniger.

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
Deckkraft, nur die Knoten tragen den Akzent.

**`[Entscheidung Andreas]` Das Motiv bleibt — und gilt unter Disziplin-Regel:**

> **Boldness an einer Stelle.** Das Signature-Motiv erscheint an **wenigen, bewusst gewählten**
> Stellen — z. B. einmal im Footer, an einer Navy-Sektion oder als Trenner zwischen zwei großen
> Abschnitten. Es ist **NIE** wiederholte Deko auf jeder Karte, in jeder Kachel oder neben jeder
> Überschrift.

Begründung: Ein Wiedererkennungs-Element wirkt durch Seltenheit. Sobald es überall auftaucht, ist es
Tapete — es kostet Aufmerksamkeit und liefert keine mehr. Dieselbe Logik wie beim Akzent: an einer
Stelle laut, drumherum ruhig.

**Faustregel für Folge-Prompts:** höchstens **ein** Auftritt pro Seitenansicht. Wer einen zweiten
setzen will, muss den ersten entfernen.

### Kanonischer Ort: der Footer `[Entscheidung Andreas]`

**Der Auftritt ist der Footer — `components/layout/site-footer.tsx`, `SignatureRule` als Abschluss
der Markenspalte. Und sonst nirgends.**

Begründung: Der Footer läuft auf *jeder* Seite. Dadurch trägt **jede Seite das Motiv genau einmal**,
und es wird zu dem, was es sein soll — eine **wiederkehrende Signatur**. Ein Einzelauftritt auf einer
einzigen Seite kann keine Wiedererkennung stiften; er ist dort nur Dekor. Die Regel „max. 1× pro
Seitenansicht" ist so **systemisch** erfüllt und muss nicht pro Seite neu verhandelt werden.

**Damit ist die Regel für Folge-Prompts einfach:** Das Motiv **nicht** in Sektionen, Karten, Heroes
oder Trenner setzen. Der Footer hat es schon — ein zusätzlicher Auftritt wäre auf jeder Seite der
zweite und damit ein Regelbruch. Wer trotzdem einen setzen will, muss ihn im Footer entfernen (und
opfert dafür das Motiv auf allen anderen Seiten).

*Historie: Mit dem Startseiten-Bau stand das Motiv kurzzeitig als `SignatureField` hinter der
Peak-Shaving-Sektion und war dafür aus dem Footer entfernt. Zurückgedreht — die Flaggschiff-Fläche
trug es zwar sichtbarer, aber nur auf einer Seite; als Signatur wirkt es erst über die Seiten hinweg.
Die Navy-Sektion bleibt bestehen, nur ohne Motiv.*

**Regel aus dem Bau: das Motiv läuft NIE hinter oder durch Text.** Im Footer ist das durch die
Platzierung erledigt — es steht in einer eigenen Zeile der Markenspalte, nicht als Hintergrund.
Bleibt als Warnung für den Fall, dass jemand `SignatureField` doch je als Flächen-Hintergrund
einsetzt (dann gilt: nur hinter **deckenden** Flächen): Beim Startseiten-Bau lag eine Karte mit
`bg-white/5` über dem `SignatureField` — die Netzlinien liefen sichtbar quer durch Überschrift und
Fließtext. Genau das „konkurriert mit dem Inhalt", das dieses Motiv nie tun darf. Eine durchscheinende
Fläche über dem Motiv ist der Fehler, nicht seine Deckkraft.

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
| `link.tsx` | `inline` (unterstrichen), `standalone`, `quiet` — nutzt den locale-bewussten Link |
| `layout.tsx` | `Container`, `Section`, `Eyebrow`, `Num` |
| `navigation-menu.tsx` | Radix-Mega-Menü (Desktop-Nav) |
| `sheet.tsx` | Radix-Dialog als Schublade (Mobile-Menü) |
| `accordion.tsx` | Radix-Accordion (Untermenüs mobil) |

**Konventionen:**

- **shadcn/ui-Bridge:** `globals.css` mappt die shadcn-Namen (`--primary`, `--muted-foreground` …)
  auf unsere Tokens. Kein eigenes Theme — nur Aliasse, damit `shadcn add` weiter funktioniert und
  zugekaufte Primitives unsere Wahrheit rendern. Gleiche Technik wie im Kalkulator.
- **Select ist bewusst nativ.** Radix-Select wäre eine zusätzliche Abhängigkeit für einen Baustein,
  den bisher kein Formular braucht; nativ ist barrierefrei ab Werk und auf Mobile das bessere
  Muster. Sobald ein Formular Suche/Mehrfachauswahl braucht, kann Radix nachgezogen werden — die
  Tokens bleiben.
- **Radix dort, wo Handarbeit fehleranfällig wäre:** Mega-Menü, Mobile-Drawer und Accordion laufen
  über Radix (Fokus-Falle, Escape, `aria-expanded`, Fokus-Rückgabe, Hintergrund inert). Das ist die
  Abwägung aus §7.6 — nicht jede Dependency ist Ballast, aber jede braucht einen Grund.
- **`Button asChild`** rendert die Button-Optik auf ein `<a>`. Ein Link, der navigiert, MUSS ein
  `<a>` bleiben (Tastatur, „in neuem Tab öffnen", Screenreader) — auch wenn er wie ein Button
  aussieht.
- **Eingabefelder 16 px.** Kleiner zoomt iOS beim Fokus in das Feld hinein.
- **Fokus ist Pflicht und sichtbar** (§9.4, WCAG 2.1 AA): globale `:focus-visible`-Basis in
  `globals.css`, Buttons/Links verfeinern sie zu einem Ring. Nie entfernen.
- **Links im Fließtext sind unterstrichen** — Farbe allein darf nicht das einzige Merkmal sein
  (WCAG 1.4.1).
- **`prefers-reduced-motion` wird respektiert** (globale Regel in `globals.css`).
- **Keine Gradienten, keine verspielten/Emoji-Icons** (§7.2/§7.3).

---

## Getroffene Entscheidungen (vormals offen)

Beide auf `/styleguide` beurteilt und entschieden:

1. **Display-Schrift → NEIN, Inter-only.** Source Serif 4 ist restlos entfernt; es gibt keine
   zweite Schrift im Projekt (s. „Typografie").
2. **Signature-Motiv → JA, bleibt** — unter der Disziplin-Regel „Boldness an einer Stelle"
   (s. „Signature-Motiv"). Einziger Einsatz: **Footer** (`SignatureRule`), und damit auf jeder
   Seite genau 1×.

Zusätzlich entschieden: **neutrale Grau-Rampe** statt Slate (s. „Design-Philosophie" und „Farben").

---

## i18n & Navigation

- **Routing:** `next-intl`, `localePrefix: 'as-needed'`, Default `de` → die deutschen URLs bleiben
  **ohne** Präfix (`/leistungen`). Eine zweite Sprache = ein Eintrag in `i18n/routing.ts` + eine
  Datei `messages/<locale>.json`. Kein Strukturumbau (Pflichtenheft §8.7).
- **Keine Strings im JSX.** Alle nutzergerichteten Texte stehen in `messages/de.json`.
- **Immer der Link aus `@/i18n/navigation`**, nie `next/link` — nur der setzt das Locale-Präfix
  automatisch. `components/ui/link.tsx` baut bereits darauf auf.
- **Zwei Root-Layouts über Route-Groups:** `(site)/[locale]` trägt Header/Footer und setzt
  `<html lang>` aus der Locale; `(dev)` trägt `/styleguide` außerhalb der Sprach-Struktur. Die
  Gruppen tauchen in keiner URL auf. Ohne diese Trennung müsste `<html lang>` global hart auf „de"
  stehen — genau der Umbau, den §8.7 vermeiden will.
- **IA an einer Stelle:** `lib/nav.ts` (Struktur + Slugs). Header, Mobile-Menü und Footer lesen von
  dort; Labels über `labelKey` aus der Message-Datei.
- **Firmendaten:** `COMPANY` in `lib/nav.ts`, verbatim aus `reference/coolin-legacy.html`.
  Nicht erfinden — Adressen sind rechtlich relevant (§9.1).

---

## Bezug zum Bauplan

Gebaut sind das visuelle Fundament (Tokens, Primitives, Marke, `/styleguide`) und das strukturelle
Gerüst (Header mit Mega-Menü, Mobile-Drawer, Footer, i18n-Routing, Platzhalter-Routen).

Dazu die Startseite und der **Schnellrechner** (`components/quick-calculator.tsx`) — der freie Teaser
aus Pflichtenheft §5.4. Er liegt bewusst top-level unter `components/`, nicht unter `components/home/`:
Peak-Shaving-Seite und Branchenseiten binden dieselbe Komponente ein. Er bringt seinen eigenen hellen
Kartengrund (`Card`) mit und ist dadurch von der Sektion unabhängig, in der er steht — nur so gelten
auch die hier gemessenen Kontraste (Feldrand und Teal-Button sind gegen **Weiß** vermessen, nicht
gegen Navy). Er rechnet mit einer trivialen lokalen Formel, **nicht** über `packages/engine`: die
Engine gehört dem Pro-Kalkulator (§5.4 „nicht beide Kalkulator").

**Noch nicht gebaut:** echter Seiten-Content der Unterseiten, Grafiken, Formulare,
JSON-LD/sitemap, Supabase/Resend/Turnstile/Analytics. Die Platzhalter-Seiten tragen bewusst nur
Titel + „in Aufbau" — Inhalte kommen in eigenen Prompts (Pflichtenheft §11) und bauen ausschließlich
auf diesen Tokens und `lib/nav.ts` auf.
