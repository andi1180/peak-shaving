# CLAUDE.md — coolin.at Website

> Wird bei jeder Session automatisch geladen. Bewusst kurz.
> **Maßgebliches Detaildokument: `./Pflichtenheft_Website_Coolin.md`** — bei Widerspruch gilt das Pflichtenheft.
> Diese Datei enthält Regeln und Leitplanken; das Pflichtenheft enthält Details, Entscheidungen (mit Begründung) und offene Punkte.
> Exakte Design-Tokens: `./DESIGN.md`.
>
> **Dateiname-Hinweis:** Diese Datei heißt `CLAUDE.md` (damit Claude Code sie in `apps/web/` automatisch lädt). Es darf KEINE Parallel-Datei `CLAUDE_Website.md` o. Ä. im Repo liegen — sonst driftet der Stand. Immer nur diese eine Datei pflegen.
>
> **Naming-Hinweis (nur claude.ai-Projektordner, nicht Repo):** Im flachen claude.ai-Projektordner liegt diese Datei bewusst unter dem Namen **`CLAUDE_Website.md`**, weil dort bereits eine `CLAUDE.md` für das Kalkulator-Schwesterprojekt existiert und zwei gleichnamige Dateien im selben flachen Ordner nicht unterscheidbar wären. **Im Repo** heißt sie korrekt `CLAUDE.md` (in `apps/web/`) — dort eindeutig, weil eigener Ordner. Beim Hochladen hier im Projektordner also immer `CLAUDE_Website.md` verwenden, nie `CLAUDE.md`.

---

## Was wir bauen

Der professionelle Neubau von **coolin.at** — der Marketing-Plattform von COOLiN Energy. Klassische Marketing-Seite mit echter Menüstruktur/Unterseiten (kein 1:1-Rebuild der alten Scroll-Seite), plus Fundament für einen späteren Login-/Subscription-Bereich. Die Website „dreht sich" um den bestehenden **Peak-Shaving-Kalkulator** (Schwesterprojekt), der als bezahltes Produkt hinter Login integriert wird. **Erster Bauabschnitt: die Marketing-Website (`apps/web`).**

## Nicht verhandelbare Prinzipien

1. **Zwei Achsen, nicht vermischen.** *Leistungen* (Beratung/Umsetzung, Lead-Gen) vs. *Produkte* (Software/Daten-Abos, bezahlt). IA, CTAs und Ton trennen beide sauber.
2. **Peak Shaving ist das Flaggschiff** — eigener Top-Level-Punkt (nicht in den Leistungen) + prominenter Startseiten-Block mit Teaser. Zwei Rechner sauber getrennt: **Schnellrechner** (frei, Teaser) vs. **Pro-Kalkulator** (echte Analyse).
3. **SEO ins Fundament.** Intent-getrennte Seiten (Leistungen/Branchen/Wissen/Flaggschiff kannibalisieren sich nicht), JSON-LD (Organization/LocalBusiness Wien), sitemap/robots, Core Web Vitals, 301-Redirects von alten `.html`-Pfaden. **Flaggschiff-Content: „Leistungstarif 2027 / SNE-GV"** — bester AT-Hebel, erster Blog in Phase 1.
4. **Für Skalierung bauen, ohne Over-Engineering.** Produkte als datengetriebene Collection; Login später als Multi-Entitlement-Container; Reseller-Mandantenfähigkeit (Tenant-Overlay) nicht verbauen — aber jetzt nicht bauen. Keine Demo-Abkürzungen im Fundament, keine spekulativen v2/v3-Features vorbauen.
5. **i18n-vorbereitet.** Phase 1 nur Deutsch (AT), aber Struktur so, dass ein Sprach-Toggle (europäische Sprachen, Phase 3/4) ohne Umbau geht. Texte übersetzbar strukturieren, Locale-Routing vorbereiten.
6. **Seriös & ehrlich.** Professionell, ruhig, keine Gradienten, keine verspielten Emoji-Icons, gedämpfte Profitöne (Navy + ein Grün-Akzent + neutrales Off-White). Mobile/Tablet/Desktop gleichwertig. **Keine erfundenen Kennzahlen/Referenzen.**
7. **Rechtstexte:** Datenschutz aus Bestand als Ausgangstext (referenziert in `reference/`), muss vor Live-Gang von Daten/Analytics/Login/Stripe erweitert werden `[rechtlich]`. **Impressum: der Bestand ist selbst unvollständig** (siehe OP#13) — nicht kopieren, bis Pflichtangaben vorliegen.

## Stack (bestätigt)

Next.js 15 (App Router), TypeScript, Tailwind 3, pnpm-Workspaces (Monorepo), shadcn/ui (Radix), lucide-react, next-intl, next/font, next/image. Supabase (Phase 1: `contacts`; später Auth/Stripe/RLS). Resend (E-Mail). Cloudflare Turnstile (Bot-Schutz). Plausible/Umami (Analytics → **kein Cookie-Banner**). Deploy: Vercel (Projekt `peak-shaving-web`, Root Directory `apps/web`; Domain später).

**Monorepo:** `apps/web` (Marketing, Phase 1, aktiv) · `apps/website` (Standalone-Peak-Shaving-Funnel — **läuft parallel weiter**, wird erst mit Portal/Phase 2 abgelöst) · `apps/portal` (Login/Pro-Kalkulator/admin, Phase 2) · `packages/engine` (wiederverwendet) · `packages/shared` · `supabase/`.

**Harte Bau-Constraints (aus DESIGN.md, gelten für jeden Prompt):** KEIN `/alpha` auf `var()`-Hex-Tokens (nur `*-subtle`-Tokens; Alpha nur auf Tailwinds eigener Palette wie `white/5`). Keine Gradienten. Keine Emoji-Icons (nur schlichte einfarbige lucide-Line-Icons oder keine). **Signature-Motiv max. 1× pro Seitenansicht** und nie hinter Text laufend. Akzent (Teal) sparsam.

## Arbeitsregeln (Kurzform)

- **Rollen:** claude.ai = Advisor/Architekt (schreibt Prompts). Claude Code = Implementierung (investigiert selbst). Andreas testet jeden Schritt live (Vercel-URL), bevor der nächste Prompt läuft.
- **Kommunikation:** Deutsch, kurz, präzise. Advisor statt Assistent — Position halten, kein Zustimmungs-Opener, Confidence-Tags bei echter Unsicherheit. Rückfrage nur bei echter fachlicher Lücke.
- **CC-Prompts:** klare AUFGABE + Kontext, expliziter NICHT-TUN-Abschnitt, konkrete Verifikation (gemessene Belege) im Bericht. ABSCHLUSS: `pnpm build && pnpm test && git add -A && git commit`, dann `git push`. Sonnet/Standard-Effort als Default; Opus nur bei echter schwieriger Einzelentscheidung. Ein Prompt = ein Schritt.
- **Gates:** Bugs → Root Cause durch CC, nicht Symptom-Fix.
- **Design:** frontend-design-Skill konsultieren. Mehr Freiheit als Kalkulator-Projekt, außer bei Rechtstexten.

## Stand & offene Entscheidungen

> Lebendiger Handover-Anker. Neueste offene Punkte. Erledigtes wandert raus. Vollständige OP-Tabelle: Pflichtenheft §13.

- **[GESAMTSTATUS]** Prompts 1–9 abgeschlossen, live auf `peak-shaving-web.vercel.app`. **Nächster Schritt: Prompt 10 — die Branchenseiten** (Template + Hotellerie/Gastronomie/Bäckerei/Handel, §5.3).
- **Fertig gebaut:** Scaffold · Design-System (Tokens, Inter-only, Signature-Motiv, neutrales Off-White) · Layout/Nav/i18n-Grundgerüst · Startseite (7 Sektionen) · Mega-Menü-Feinschliff · Schnellrechner (funktionsfähig, live nachrechnend, `components/quick-calculator.tsx`) · Peak-Shaving-Flaggschiff (`/peak-shaving` Erklärseite mit Diagramm + `/peak-shaving/kalkulator` Produktseite) · Sticky Header (Root-Cause-Fix: `overflow-x: clip` statt `hidden`, s. u.) · Kalkulator-iframe-Einbettung (`/peak-shaving/kalkulator/rechner`, embed-Modus in `apps/website`) · 2 native Grafik-Sektionen auf der Produktseite · 6 Leistungsseiten + Übersicht über EIN Template (`lib/leistungen.ts` + `components/leistung/leistung-page.tsx`) · **Report-Galerie mit 4 echten Kalkulator-Screenshots** (`components/peak-shaving/report-gallery.tsx`, ersetzt die Platzhalter — `screenshot-placeholder.tsx` ist gelöscht).

- **[GEBAUT: Prompt 9] Report-Galerie auf `/peak-shaving/kalkulator`.** Die 2 „Screenshot folgt"-Rahmen sind weg, an ihrer Stelle stehen 4 echte Report-Ansichten (`public/images/kalkulator-report/`, Dateien auf kebab-case umbenannt — sie kamen mit Leerzeichen im Namen). Alle 4 Bilder vor dem Bau angesehen; die vorgeschlagene Zuordnung stimmte in allen 4 Fällen (Lastgang · Kostenvergleich · Tages-Energiefluss · Empfehlung). Gemessen: CLS **0** auf Desktop UND Mobile, kein horizontaler Scroll @375px, keine Konsolenfehler.
  - **[POSITION] Galerie ans Seitenende gezogen**, direkt vor den CTA (vorher gleich nach dem Schnellrechner-Vergleich). Erklärung → Ergebnis → Start: Der Beweis, dass das Werkzeug liefert, wirkt unmittelbar vor der Handlungsaufforderung. Der Datenschutz-Callout („Ihre Verbrauchsdaten bleiben bei Ihnen") ist als Teil der Sektion mitgewandert — steht damit als letzter Einwand-Abbau vor dem Klick, was besser passt als vorher. **HowItWorks und EnergyFlow haben ihre `Section`-Töne getauscht** (jetzt alt/default statt default/alt), sonst stünden nach dem Umzug zwei gleichfarbige Sektionen aneinander; der Grund-Wechsel alt/default/…/navy ist unverändert intakt.
  - **[LAYOUT — bewusste Abweichung von „2×2", gemessen begründet]** Gebaut ist **1 + 3**: der Jahres-Lastgang über die volle Zeile, darunter die drei Hochformate nebeneinander (Desktop); alles einspaltig ab < 1024px. Grund: Drei Bilder sind hochformatig (0,56/0,66/0,66), eines querformatig (1224×664 = 1,84). Im zuerst gebauten 2×2 lief der Lastgang auf **40 % seiner nativen Breite** (486 px von 1224) und stand mit **356 px totem Weißraum** in seiner Zelle — die Zelle wirkte leer, die Achsenbeschriftung war unlesbar. In der jetzigen Fassung ist er **1054 px breit (86 % nativ)** und gestochen. Die drei Hochformate sitzen in Fenstern im Seitenverhältnis des höchsten Bildes → gleiche Kartenhöhen, Bildunterschriften auf EINER Baseline (gemessen: alle drei bei y=4387). Ein 2×2 ohne Loch ist mit 3 Hoch- + 1 Querformat geometrisch nicht möglich.
  - **[§9.5] Sichtbarer Einordnungssatz VOR den Bildern:** „Beispielhafter Report, gerechnet mit einem synthetischen Demo-Lastgang — kein realer Kundenfall." Die Bilder zeigen nachweislich einen Demo-Lauf (Demo-Bäckerei + `DEMO_BATTERY_CATALOG`), keine Kundendaten. **Keine identifizierenden Daten sichtbar** — kein Name, keine Adresse, keine Zählpunkt-ID (alle 4 Bilder geprüft).
  - **[TECHNIK]** `next/image` mit echten Pixelmaßen (kein Roh-`<img>`), `sizes` auf die tatsächliche Anzeigebreite, `quality={90}` (Default 75 verwischt die Achsenziffern sichtbar), lazy. Alle 4 PNGs haben **transparente** Hintergründe (Eckpixel RGBA 0,0,0,0) — deshalb sitzen sie auf `bg-surface` (weiß) und die Pillarbox der Hochformate ist unsichtbar.

- **[OFFEN, kosmetisch, Andreas' Entscheidung] „[MARTIN: Katalog]" steht sichtbar im Empfehlungs-Screenshot.** Der Demo-Katalog des Kalkulators führt den Hersteller als Platzhalter (`manufacturer: '[MARTIN: Katalog]'`), und dieser Marker ist im Bild unter „PeakStore C60" lesbar — auf einer öffentlichen Produktseite liest er sich wie ein vergessenes internes TODO. Nicht blockierend (die Sektion ist als Demo gekennzeichnet), aber **ein neuer Screenshot dieser einen Karte, sobald Martins echter Katalog steht (OP#2), räumt es auf.** Kein Fix im Bild selbst — Screenshots werden nicht retuschiert.
- **[TECHNISCHE NOTIZ, wichtig für künftige Prompts]** `overflow-x: hidden` macht `<body>` zum Scroll-Container und bricht `position: sticky` (Web-Plattform-Verhalten, kein Bug im engeren Sinn) → **immer `overflow-x: clip` verwenden**, `hidden` nur als Safari-<16-Fallback davor. Der gleiche Fehler steckt **ungefixt in `apps/website/app/globals.css`** (dessen Kommentar behauptet fälschlich, sticky bleibe unberührt) — Fix ansteht, sobald der Kalkulator in Phase 2 nach `apps/web` migriert wird, nicht vorher (Scope).
- **[ENTSCHEIDUNG, gesetzt] Kalkulator-Einbindung Phase 1 = iframe, nicht Migration.** `/peak-shaving/kalkulator/rechner` bettet `apps/website` per iframe ein (`?embed=1` blendet die App-eigene Headline aus — einzige bewusste Änderung an `apps/website`, eng gekapselt, Standalone-Verhalten ohne Parameter unverändert verifiziert). Route ist `noindex, follow` (leere Hülle soll nicht gegen die Produktseite ranken). **Echte Engine-Migration bleibt Phase 2** (§8.1) — hängt auch an OP#1.
- **[ENTSCHEIDUNG, gesetzt] Header/Footer neutral, kein Grünton.** Prompt 7 hatte testweise einen zarten Teal-Tint eingeführt (Kontraste waren einwandfrei), Andreas fand es am Bild zu unruhig → zurückgenommen. Aktueller Zustand: Header weiß, Footer Off-White (`#fafafa`) — bewusst nicht zwingend identisch, siehe DESIGN.md.
- **[OFFEN, klein] Weißer „Kontakt"-Button auf weißem Header** ist nur an seinem Rand erkennbar (Nebenbefund aus Prompt 7, seit Grünton-Rückbau wieder relevant). Kein Blocker, in DESIGN.md notiert — bei Gelegenheit lösen (z. B. dezenter Rand/Fläche).
- **[DRINGEND, unabhängig vom Bau] OP#13:** Das aktuell LIVE geschaltete Impressum auf coolin.at ist selbst unvollständig (`[ergänzen]`-Platzhalter für Rechtsform/UID/Firmenbuchnr./Gewerbebehörde/Kammer — Pflicht nach §5 ECG). Andreas/Martin müssen diese Angaben real zuliefern, bevor die Impressum-Seite gebaut wird. Bis dahin bleibt `/impressum` Platzhalter. Siehe Pflichtenheft §9.1.
- **[OFFEN, einzige Geschäfts-Weiche] OP#1:** Kalkulator in Phase 1 kostenlos (Lead-Magnet) vs. verkauft. Andreas tendiert „frei"; pending Martin. Blockiert den Bau weiterhin nicht.
- **[MERKER] OP#6:** Vor Live-Gang Top ~20 Keywords mit Tool (Ahrefs/Semrush/Keyword Planner) gegenchecken. Nicht vergessen.
- **[ASSETS] OP#7:** Kalkulator-Report-Screenshots sind geliefert **und in Prompt 9 eingebaut** (Galerie auf `/peak-shaving/kalkulator`). Offen bleiben: **Logo hochauflösend** (Emblem bleibt bis dahin eine saubere Favicon-Nachzeichnung) und ein **Screenshot der Kalkulator-OBERFLÄCHE** — die Galerie zeigt bewusst nur den Ergebnis-Report, den 4-Schritt-Flow erklärt stattdessen die native „So funktioniert's"-Sektion.
- **[ENTSCHEIDUNG, bestätigt]** Repo bleibt `peak-shaving` (kein Umbenennen).
- **CTA-Wording überall „Kalkulator"** (nicht „Kostenlos testen") — phasenfest, macht keine Preis-Aussage, Entscheidung aus Prompt 5, seither konsistent durchgezogen.
