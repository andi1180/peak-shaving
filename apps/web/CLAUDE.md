# CLAUDE.md — coolin.at Website

> Wird bei jeder Session automatisch geladen. Bewusst kurz.
> **Maßgebliches Detaildokument: `./Pflichtenheft_Website_Coolin.md`** — bei Widerspruch gilt das Pflichtenheft.
> Diese Datei enthält Regeln und Leitplanken; das Pflichtenheft enthält Details, Entscheidungen (mit Begründung) und offene Punkte.
> Exakte Design-Tokens: `./DESIGN.md`.
>
> **Dateiname-Hinweis:** Diese Datei heißt `CLAUDE.md` (damit Claude Code sie in `apps/web/` automatisch lädt). Es darf KEINE Parallel-Datei `CLAUDE_Website.md` o. Ä. im Repo liegen — sonst driftet der Stand. Immer nur diese eine Datei pflegen.

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

- **[GESAMTSTATUS]** Prompt 1 (Scaffold), 2 (Design-System), 3 (Layout/Nav/i18n), 4 (Mega-Menü-Feinschliff + Startseite), 5 (Signature→Footer · CTA „Kalkulator" · Schnellrechner) abgeschlossen. Startseite hat 7 Sektionen, der Schnellrechner rechnet echt. Nächster Schritt: offen — Kandidaten sind die Peak-Shaving-Flaggschiff-Seite (§5.2) oder die Leistungs-Unterseiten (§5.1); beide binden den bestehenden `QuickCalculator` nur ein, bauen ihn nicht neu.
- **[GEBAUT: Prompt 5] Signature-Motiv → Footer · CTA → „Kalkulator" · Schnellrechner echt rechnend.**
  - **Signature:** kanonischer Ort ist jetzt der **Footer** (`SignatureRule`, Markenspalte) — DESIGN.md nachgezogen. Der Footer läuft auf jeder Seite ⇒ jede Seite zeigt das Motiv genau 1× (Playwright: `/`, `/leistungen`, `/peak-shaving` je `total=1, imFooter=1`). Regel für Folge-Prompts: **das Motiv nirgends sonst setzen** — der Footer hat es schon, jeder weitere Auftritt wäre der zweite.
  - **CTA:** `Nav.cta` + `Home.Hero.ctaPrimary` = „Kalkulator" (Ziel unverändert `/peak-shaving/kalkulator`). Code folgt damit dem Pflichtenheft §3.3/§4.1/§4.4. „Kostenlos testen" existiert nirgends mehr.
  - **Schnellrechner:** `components/quick-calculator.tsx` — top-level, NICHT unter `components/home/`, weil Peak-Shaving-/Branchenseiten dieselbe Komponente einbinden. Props nur Default-Werte (500/100/120). Rechnet `Zielreduktion × Leistungspreis` **lokal**, bewusst NICHT über `packages/engine` (§5.4 Teaser/Pro-Grenze; `apps/web` hat weiterhin keine workspace-Dependency auf engine/shared).
- **[ENTSCHEIDUNG, Prompt 5] Der Schnellrechner bringt seinen eigenen hellen Kartengrund mit** (`Card`, `bg-surface`) statt einer Navy-Variante — deshalb ist er von der Sektion unabhängig, in der er steht, und auf Branchen-/Flaggschiff-Seiten ohne Umbau einsetzbar. Zweiter, härterer Grund: die in DESIGN.md **gemessenen** Kontraste (Feldrand `#8f8f8f` 3,23:1, Teal-Button 5,47:1) sind gegen **Weiß** vermessen, nicht gegen Navy — eine Navy-Fassung hätte neue, ungemessene Töne gebraucht.
- **[OFFEN, Design-Detail für den nächsten Prompt] Zwei Teal-Buttons auf dasselbe Ziel im Peak-Shaving-Block:** die Sektion trägt links „Peak-Shaving Kalkulator" (primary) und die Rechner-Karte rechts „Zum Kalkulator" (primary) — beide → `/peak-shaving/kalkulator`, auf Desktop gleichzeitig sichtbar. Widerspricht „Akzent sparsam". Bewusst NICHT in Prompt 5 geändert (die Button-Zeile war „anderer Seiten-Content"). Vorschlag: den linken `ctaPrimary` entfernen — die Karte trägt den CTA jetzt am besseren Ort (direkt nach der Zahl), links bliebe „Was ist Peak Shaving" als Sektions-CTA.
- **[OFFEN, Andreas' Entscheidung] `Home.metaDescription` enthält weiter „Einsparpotenzial kostenlos testen".** Kein Button-Text, daher außerhalb des CTA-Scopes von Prompt 5 — aber dieselbe Preis-Aussage, die §3.3 aus dem CTA verbannt hat, und OP#1 (frei vs. bezahlt) ist offen. Vor Live-Gang entscheiden: stehenlassen (Lead-Magnet-Argument) oder neutralisieren.
- **[DRINGEND, unabhängig vom Bau] OP#13:** Das aktuell LIVE geschaltete Impressum auf coolin.at ist selbst unvollständig (`[ergänzen]`-Platzhalter für Rechtsform/UID/Firmenbuchnr./Gewerbebehörde/Kammer — Pflicht nach §5 ECG). Andreas/Martin müssen diese Angaben real zuliefern, bevor die Impressum-Seite gebaut wird. Bis dahin bleibt `/impressum` Platzhalter. Siehe Pflichtenheft §9.1.
- **[OFFEN, einzige Geschäfts-Weiche] OP#1:** Kalkulator in Phase 1 kostenlos (Lead-Magnet) vs. verkauft. Andreas tendiert „frei"; pending Martin. Blockiert Phase 1 nicht (frei ist der Default-Baupfad).
- **[MERKER] OP#6:** Vor Live-Gang Top ~20 Keywords mit Tool (Ahrefs/Semrush/Keyword Planner) gegenchecken. Nicht vergessen.
- **[ASSETS offen]** OP#7 Logo hochauflösend + Kalkulator-Screenshots von Andreas. Bis dahin Platzhalter (Emblem ist eine saubere Favicon-Nachzeichnung).
- **[ENTSCHEIDUNG, bestätigt]** Repo bleibt `peak-shaving` (kein Umbenennen — interner Name, Konfliktvermeidung mit Kalkulator).
