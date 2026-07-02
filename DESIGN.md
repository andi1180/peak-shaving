# DESIGN.md — Peak Shaving Kalkulator

> Konkrete Design-Tokens. Die **bindenden Prinzipien** stehen im Pflichtenheft (§6.1) — diese Datei liefert die Werte.
> Tokens ändern sich schneller als die Fachlogik und variieren pro White-Label-Partner; deshalb hier getrennt gehalten.

---

## Design-Philosophie

Zwei Oberflächen, gegensätzlicher Charakter (siehe Pflichtenheft §6.1):

| | Öffentlicher Rechner (Marketing) | Report / Portal |
|---|---|---|
| Ziel | Konversion, Vertrauen, Verständlichkeit | Belastbarkeit, Seriosität, Nachvollziehbarkeit |
| Ton | warm, lebendig, darf animieren | ruhig, datendicht, statisch |
| Priorität | **Mobile-first** | **Desktop-first, Tablet Pflicht** |
| Vorbild | Tibber, Octopus Energy | Stripe (Dashboard/Docs), McKinsey-Exhibits |

**Referenz-Anlehnung bewusst *nicht* an andere Batterierechner.** Tibber/Octopus zeigen, wie man Energiedaten für Laien greifbar macht; Stripe ist der Maßstab für „datendicht, aber ruhig und vertrauenswürdig".

---

## Farben

Ein Akzent, nicht drei. Alle Farben als CSS-Variablen (Tailwind-Theme-Tokens), damit White-Label-Partner den Akzent überschreiben können.

```css
:root {
  /* Akzent (White-Label-überschreibbar) */
  --color-accent:        #0f766e;  /* Teal 700 – energie-assoziiert, seriös */
  --color-accent-hover:  #0e6b64;
  --color-accent-subtle: #f0fdfa;  /* Teal 50 – Flächen/Callouts */

  /* Ink / Text */
  --color-ink:           #0f172a;  /* Slate 900 – Überschriften, primärer Text */
  --color-text:          #1e293b;  /* Slate 800 – Fließtext */
  --color-text-muted:    #475569;  /* Slate 600 – Sekundärtext */

  /* Flächen / Struktur */
  --color-surface:       #ffffff;
  --color-surface-alt:   #f8fafc;  /* Slate 50 – Karten-/Zeilen-Hintergrund */
  --color-border:        #e2e8f0;  /* Slate 200 */

  /* Semantisch – NUR für Zahlen mit Bedeutung (Information, kein Dekor) */
  --color-positive:      #15803d;  /* Grün – Ersparnis */
  --color-negative:      #b91c1c;  /* Rot – Kosten */
  --color-warning:       #b45309;  /* Bernstein – Warnhinweise (statische Steuerung, Sockel nötig …) */
}
```

**Regel:** Grün/Rot/Bernstein sind reserviert für Ersparnis / Kosten / Warnung. Nicht als Dekor verwenden, sonst verlieren sie ihre Signalwirkung.

---

## Typografie

Ein einziger, exzellenter Sans — kein Font-Mixing.

```css
--font-sans: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, monospace; /* optional, für rohe kW/kWh-Detailwerte */
```

- **Inter** für UI + Text. Neutral, exzellente Zahlen-Lesbarkeit, frei, De-facto-Standard für diese Tool-Klasse. Via `next/font` selbst hosten (kein externer Request → schneller, DSGVO-freundlicher).
- **Pflicht bei allen Finanz-/Lastwerten:** `font-variant-numeric: tabular-nums;` — sonst springen Ziffern in Spalten und Beträge lassen sich nicht vergleichen.
- Mono nur optional in Detailansichten für rohe Messwerte.

Skala (Report, Richtwerte): dominante Kennzahl ~32–40px, Sektionsüberschrift ~20px, Fließtext ~15–16px, Tabellen ~14px. Klare Hierarchie: **eine** dominante Zahl pro Sektion.

---

## Layout & Gestaltung

- **Report:** großzügiger Weißraum, Karten mit dezenten Rändern (`--color-border`) statt Schlagschatten, Zahlen groß und tabellarisch, aufklappbare Rechenweise als unaufdringliches „Details"-Element. Liest sich wie ein Exhibit, nicht wie eine Consumer-App.
- **Marketing:** großzügige Hero-Fläche, animierter Energiefluss (Sonne → Batterie → Verbraucher → Netz), klare CTA. Animationen sparsam und zweckgebunden.
- Radius/Spacing: konsistent über Tailwind-Skala (z. B. `rounded-lg`, 4/8/12/16px-Raster).

---

## Bibliotheken

| Zweck | Wahl | Begründung |
|---|---|---|
| Komponenten | **shadcn/ui** (Radix-basiert) | Code liegt im Repo, voll anpassbar, barrierefrei, kein Fremd-Look → Voraussetzung für White-Label |
| Charts | **Recharts** | reicht für Lastgang, Kostenvergleich, Energiefluss (im Pflichtenheft festgelegt) |
| Animation | **Framer Motion** / CSS | nur Marketing-Seite, sparsam |
| Fonts | **next/font** (Inter selbst gehostet) | Performance + Datenschutz |

`[Guessing]` Falls der Lastgang-Chart mit 35.040 Punkten (12 Monate × 15-min) ruckelt: auf **uPlot** ausweichen oder Daten für die Übersicht downsamplen, volle Auflösung nur im Zoom. Performance-Detail — von Claude Code bei Bedarf zu entscheiden, nicht vorab.

---

## White-Label-Hinweis

Der Akzent (`--color-accent*`) und optional Logo/Name werden pro Mandant überschrieben. Tokens von Anfang an als CSS-Variablen führen — nicht nachträglich extrahieren. Semantische Farben (positiv/negativ/warning) bleiben mandantenübergreifend konstant (sie sind Information, nicht Branding).

---

## Bezug zum MVP

UI ist **nicht** der kritische Pfad — die Engine ist es. Design-Tokens einmal sauber anlegen, dann UI-Feintuning zurückstellen, bis die Rechenlogik gegen Martins echten Referenzfall validiert ist. Reihenfolge bleibt: Engine + Tests → öffentlicher Rechner → Report → Portal.
