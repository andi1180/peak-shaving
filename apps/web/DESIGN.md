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
| `--color-navy-subtle` | Getönte Fläche für Navy (Blue 50, gleiche Methodik wie die übrigen `*-subtle`-Tokens — 50er-Stufe der nächstliegenden Tailwind-Familie). Für eigenständig abgesetzte Karten (z. B. Monitor-Abo-Teaser, `gratis-check-result.tsx`), die sich vom umgebenden `surface`/`surface-alt` abheben sollen, ohne eine Navy-Vollfläche/Hero zu sein (dafür bleibt `--color-navy` reserviert) und ohne mit dem semantischen `--color-positive`-Grün zu konkurrieren. |
| `--color-node` | Der hellere Teal-Knoten des Emblems. Nur Grafik, kein UI-Ton. |
| `--color-*-subtle` | Getönte Flächen der Signalfarben (technisch nötig, s. „Kein /alpha"). |
| `--color-accent-border` | Rand einer Akzent-Fläche. |
| `--color-warning-border` | Rand einer Warnung-Fläche (Warnung-Callout im Wissen-Bereich). Gegenstück zu `--color-accent-border` und aus demselben Grund nötig: `/alpha` scheidet auf `var()`-Hex-Tokens aus. Amber 200 verhält sich zu Amber 50 wie Teal 200 zu Teal 50 — der Kasten wird damit genauso laut wie ein Akzent-Callout, nicht lauter. Der gesättigte `--color-warning` als Kontur hätte ihn alarmistisch gemacht; die Signalwirkung trägt die Überschrift im Kasten. |
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
--color-navy-subtle:     #eff6ff;  /* Blue 50   — abgesetzte Flächen (z. B. Abo-Karte), kein Hero */

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
--color-warning-border:  #fde68a;  /* Amber 200 — Rand einer Warnung-Fläche */

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
| Ink `#171717` auf Weiß `#ffffff` (Header) | 17,93:1 | AAA |
| Ink `#171717` auf Off-White `#fafafa` | 17,18:1 | AAA |
| Text `#262626` auf Weiß | 15,13:1 | AAA |
| Text `#262626` auf Off-White | 14,50:1 | AAA |
| Navy `#18336f` auf Weiß (Wortmarke im Header) | 12,06:1 | AAA |
| Text muted `#525252` auf Weiß (Nav-/Login-Links) | 7,81:1 | AAA |
| Weiß auf Navy `#18336f` | 12,06:1 | AAA |
| Navy `#18336f` auf Off-White | 11,55:1 | AAA |
| Text muted `#525252` auf Off-White (Footer-Links) | 7,49:1 | AAA |
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

### Chrome-Grund (Header & Footer): neutral, kein Grünton `[Entscheidung Andreas]`

**Header `bg-surface` (#ffffff), Footer `bg-surface-alt` (#fafafa) — beide neutral, kein Hue-Cast.**

Der in Prompt 7 gebaute getönte Chrome-Grund (`--color-surface-subtle: #f5fcfa`, ein halber Hauch
Teal 50, Hue-Cast 7) ist **am Bild verworfen und zurückgenommen**; der Token ist ersatzlos entfernt
(`globals.css`, `tailwind.config.ts`, beide Klassennamen). Damit gilt „Neutrale = hueless"
(s. „Design-Philosophie") **ausnahmslos** — es steht keine getönte Fläche mehr neben der
Grau-Rampe, und Navy und Teal bleiben die einzigen Farben im System.

**Warum der Versuch verworfen wurde** (bleibt dokumentiert, damit der Ton nicht erneut
vorgeschlagen wird): Der sichtbare Effekt im Header war zu ~90 % *„nicht mehr reinweiß"*, nicht
*„grün"*; im Footer (vorher schon #fafafa) war die Änderung praktisch unsichtbar. Der Ton leistete
weniger, als der Aufwand vermuten ließ — und kostete dafür die Hueless-Regel.

**Der Kontrast ist von der Rücknahme unberührt:** der neutrale Grund war bereits AAA und ist es
weiterhin (Nav-Text 17,93:1 · muted 7,81:1 · Wortmarke 12,06:1 — s. Kontrast-Tabelle oben). Kein
Wert wechselt sein AA/AAA-Band; die Grünton-Werte (17,23 / 7,51 / 11,59) lagen durchweg minimal
darunter.

**Nebenbefund aus dem Versuch, weiterhin offen (kein Blocker):** Auf reinweißem Header liest sich
der `secondary`-Button („Kontakt", `bg-surface` = Weiß) weiß-auf-weiß und ist nur an seinem Rand
erkennbar. Das ist ein **Button-Thema**, kein Argument für einen getönten Header — falls es stört,
gehört die Lösung an die `secondary`-Variante, nicht an die Fläche dahinter.

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

### Regel: `h1`/`h2` trennen global — keine Utility-Klasse pro Überschrift

`globals.css` setzt `hyphens: auto` + `overflow-wrap: break-word` **global auf `h1, h2`**. Deutsche
Komposita („Speicherempfehlung", „Viertelstunden-Lastgang") sind auf einer AT-Seite der Normalfall:
bei den festen Stufen `text-h1` (40 px) / `text-h2` (30 px) ist so ein Wort auf einem 375-px-Gerät
breiter als die Textspalte und läuft aus dem Bild. Die `overflow-x`-Bremse verhindert dabei nur die
Scrollleiste — sie **schneidet das Wort ab, statt es zu retten**.

`hyphens: auto` greift, weil beide Root-Layouts `<html lang>` setzen; `-webkit-hyphens` ergänzt
autoprefixer. `h3` und kleiner bleiben bewusst außen vor: ab 22 px passen die Komposita in die Spalte.

**Die Regel gehört an die Stufe, nicht an den Zufall eines langen Titels.** Deshalb steht sie in
`globals.css` und **nicht** als `hyphens-auto break-words` an einzelnen Überschriften — die zwei
H1, die das noch einzeln trugen, wurden entschlackt. Gemessen: alle `h1`/`h2` auf `/`,
`/peak-shaving` und `/peak-shaving/kalkulator` tragen bei 375 px `hyphens=auto`, keine läuft über.

---

## Marke

### Emblem — **Original eingetroffen (OP#7 gelöst, Prompt 23)**

Andreas' hochauflösendes Original liegt unter `reference/logo-coolin-emblem-master.png` (128×128,
transparenter Grund) — die alte `reference/favicon.png` war eine ungenaue Vorabkopie und ist nicht
mehr Quelle.

- **`components/brand/emblem-image.tsx`** bindet die PNG-Vorlage direkt ein (`next/image`,
  `public/brand/coolin-emblem.png`) — für jede Stelle, die ein `<img>` verträgt (Header, Footer,
  Mobile-Drawer). Kein Nachzeichnungsrisiko mehr.
- **`components/brand/emblem.tsx`** bleibt als SVG-Vektorfassung bestehen, aber nur noch für
  Stellen, die zwingend Vektor/Satori brauchen (`opengraph-image.tsx`) oder eine `inverse`-Fassung
  zeigen müssen (Styleguide) — pixelgenau gegen die PNG-Vorlage vermessen (Node-Zentren/-Radien via
  Distanztransformation, Linien via Hough-Transformation + linearer Regression je Segment): Netzlinien
  enden an den Knotenpunkten (bzw. laufen an der Bild-Kante offen aus) statt darunter hindurchzulaufen.
  `inverse` liefert die Fassung für dunkle Gründe (heller Grund, Navy-Linien) — ohne sie verschwindet
  der Navy-Squircle auf einer Navy-Fläche.
- Favicon/Apple-Touch-Icon (`app/icon.png`/`app/apple-icon.png`) sind direkt aus derselben
  PNG-Vorlage generiert (Navy-Pixel auf exakt `#18336f` umgefärbt, s. „Farben" oben) — kein
  drittes Nachzeichnungsrisiko.

### Wortmarke

Drei Varianten (`components/brand/wordmark.tsx`), gemeinsame Regeln:

- „COOLiN" kräftig, „ENERGY" leichter und gesperrt (§7.4). **Variante A ist seit Prompt 23
  zweizeilig** (Header/Footer/OG-Bild): „COOLiN" oben unverändert, „ENERGY" darunter auf exakt
  dieselbe Breite gestreckt (`textLength`/`lengthAdjust="spacingAndGlyphs"`; im OG-Bild, das kein
  SVG-`<text>` kennt, per `transform: scaleX()`). B/C bleiben einzeilige Entwurfsvarianten für den
  Styleguide-Vergleich, nicht live verdrahtet.
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
  `overflow-x`-Bremse — als **`clip`**, nicht `hidden`, s. nächste Regel.
- **Header-Höhe ist ein Token:** `--header-h: 4rem`. Sie steuert drei Dinge, die sonst
  auseinanderdriften: die Header-Höhe selbst, `scroll-padding-top` für Anker-Sprünge und die
  iframe-Höhe des eingebetteten Kalkulators (`calc(100dvh - var(--header-h))`).

### Regel: die Overflow-Bremse ist `clip`, niemals `hidden`

**`overflow-x: hidden` auf `<body>` setzt `position: sticky` still außer Kraft.** Das ist kein
Aberglaube, sondern gemessen: Der Header trug `sticky top-0 z-40`, `getComputedStyle` meldete
`position: sticky` — und er scrollte trotzdem mit der Seite weg (nach 1200 px Scroll lag seine
Oberkante bei −1200 px statt bei 0).

**Ursache:** Die CSS-Spec zwingt bei `overflow-x: hidden` den Nachbarwert `overflow-y: visible` auf
den *benutzten* Wert `auto`. Damit wird `<body>` zum **Scroll-Container**. Ein sticky Element klebt
immer an seinem nächsten Scroll-Container — hier also an `<body>`. Gescrollt wird aber der Viewport
(gemessen: `document.scrollTop = 1200`, `body.scrollTop = 0`). Der Header klebte an einer Box, die
nie scrollt.

**Fix:** `overflow-x: clip`. `clip` erzeugt keinen Scroll-Container, `overflow-y` bleibt `visible`,
der Header klebt am Viewport — die Bremse wirkt unverändert. `hidden` steht in `globals.css`
als Fallback davor (Browser ohne `clip`, Safari < 16, behalten wenigstens die Bremse).

**Für Folge-Prompts:** Wer `clip` auf `html`/`body` je wieder zu `hidden` macht, bricht den Header —
ohne Fehlermeldung, ohne dass die Klasse am Header verdächtig aussieht. Dieselbe Falle steckt
unverändert in `apps/website/app/globals.css`; der dortige Kommentar behauptet ausdrücklich das
Gegenteil („vertikales Scrollen/`position: sticky` bleiben unberührt") und ist damit **falsch** —
nicht als Vorlage nehmen.

---

## Bausteine (`components/ui/`)

| Datei | Inhalt |
|---|---|
| `button.tsx` | `primary` (Teal-Akzent), `secondary` (Navy-Kontur), `ghost`; `sm`/`md`/`lg` |
| `card.tsx` | `Card` + Header/Title/Description/Content/Footer |
| `badge.tsx` | `neutral`/`accent`/`navy` + semantische `positive`/`negative`/`warning` |
| `input.tsx` | `Input`, `Textarea`, `Select`, `Checkbox`, `Label`, `FieldHint` |
| `link.tsx` | `inline` (unterstrichen), `standalone`, `quiet` — nutzt den locale-bewussten Link |
| `layout.tsx` | `Container`, `Section`, `Eyebrow`, `Num` |
| `navigation-menu.tsx` | Radix-Mega-Menü (Desktop-Nav) |
| `sheet.tsx` | Radix-Dialog als Schublade (Mobile-Menü) |
| `accordion.tsx` | Radix-Accordion (Untermenüs mobil) |

**Konventionen:**

- **shadcn/ui-Bridge:** `globals.css` mappt die shadcn-Namen (`--primary`, `--muted-foreground` …)
  auf unsere Tokens. Kein eigenes Theme — nur Aliasse, damit `shadcn add` weiter funktioniert und
  zugekaufte Primitives unsere Wahrheit rendern. Gleiche Technik wie im Kalkulator.
- **Select und Checkbox sind bewusst nativ.** Radix-Select wäre eine zusätzliche Abhängigkeit für
  einen Baustein, den bisher kein Formular braucht; nativ ist barrierefrei ab Werk und auf Mobile
  das bessere Muster. Sobald ein Formular Suche/Mehrfachauswahl braucht, kann Radix nachgezogen
  werden — die Tokens bleiben. Bei der **Checkbox** (Kontaktformular, §5.5) trägt `accent-color`
  (Utility `accent-accent`) den Teal-Haken: Der einzige historische Grund, eine Checkbox
  nachzubauen, war ihre Unstylebarkeit — `accent-color` löst genau das und behält Tastatur,
  Screenreader und `<label>`-Kopplung ab Werk. Ein nachgebautes Control wäre hier mehr Code für
  weniger Barrierefreiheit.
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

Dazu die **Peak-Shaving-Flaggschiff-Seiten** (§5.2) und der **eingebettete Kalkulator**
(`/peak-shaving/kalkulator/rechner`): Der echte Rechner läuft weiter in `apps/website` und wird
per iframe in die coolin.at-Hülle geholt — `apps/web` importiert dafür bewusst weder
`packages/engine` noch Kalkulator-UI (§5.4/§8.1). Quelle + Embed-Parameter stehen in
`lib/config.ts`, die interne Route in `lib/nav.ts`. Die zwei Grafik-Sektionen der Produktseite
(4 Schritte, Energiefluss) sind **nativ nachgebaut**, nicht eingebettet — sie sollen mit der Seite
altern, nicht mit der App.

**Regel für die Energiefluss-Leiste:** genau **ein** Knoten trägt den Akzent (die Batterie), weil
sie das Einzige ist, was der Kalkulator dimensioniert — Farbe ist auch hier Information, nicht
Dekor. Die Vorlage in `apps/website` färbt alle vier Knoten teal und legt einen Glow darunter;
beides ist hier bewusst nicht übernommen (Glow ist der Sache nach ein Verlauf, §7.2).

Dazu der **Wissen-Bereich** (`/wissen` + `/wissen/[slug]`) mit der **Rich-MDX-Bibliothek**
(`components/wissen/`): `Callout` (info/accent/warning), `Figure`/`ChartFigure` und die
Typografie-Map (`mdx-components.tsx`), die Markdown auf die Tokens dieser Datei abbildet.

**Regel: kein `@tailwindcss/typography` (`prose`).** Das Plugin bringt eine EIGENE Typo-Skala und
eigene Farben mit — sie müssten Zeile für Zeile auf diese Datei zurückgebogen werden und wären
danach eine zweite Wahrheit neben `tailwind.config.ts`. Die MDX-Map ist stattdessen explizit: länger
im Code, aber ohne einen Ton, den niemand entschieden hat. Wer `prose` nachrüstet, bricht das.

**Regel: die Textbreite hängt an den Elementen, nicht am Container.** Fließtext läuft auf
`max-w-prose`, Grafiken dürfen breiter stehen (Pflichtenheft §7.5). Läge die Begrenzung am Wrapper,
könnte kein Chart je ausbrechen — deshalb trägt jedes Textelement der MDX-Map seine eigene
`max-w-prose`.

Dazu das **Kontaktformular** (`/kontakt`, `components/kontakt/`) — der erste echte Formular-Fall
und damit der erste Einsatz von `Input`/`Textarea`/`Select`/`Checkbox`/`Label`/`FieldHint` im
Verbund. Regeln, die dort entstanden und für jedes weitere Formular gelten: **`noValidate` am
`<form>`** (die native Browser-Blase spricht in der Browser-Sprache, nicht in der Sprache dieser
Seite, und zeigt immer nur einen Fehler) — die `required`-Attribute bleiben trotzdem stehen, sie
tragen die Semantik für Screenreader. **Fehlertexte sind Keys, keine Sätze** (`messages/de.json`
ist die Wortwahl, das zod-Schema die Regel). **Jedes Feld trägt `aria-invalid` + `aria-describedby`
auf seine Meldung**; der Fokus springt ins erste fehlerhafte Feld, nicht in die Sammelmeldung.

**Noch nicht gebaut:** echter Seiten-Content der übrigen Unterseiten,
JSON-LD/sitemap, Supabase/Analytics. Die Platzhalter-Seiten tragen bewusst nur
Titel + „in Aufbau" — Inhalte kommen in eigenen Prompts (Pflichtenheft §11) und bauen ausschließlich
auf diesen Tokens und `lib/nav.ts` auf.
