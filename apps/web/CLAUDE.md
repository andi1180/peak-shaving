# CLAUDE.md — coolin.at Website

> Wird bei jeder Session automatisch geladen. Bewusst kurz.
> **Maßgebliches Detaildokument: `./Pflichtenheft_Website_Coolin.md`** — bei Widerspruch gilt das Pflichtenheft.
> Diese Datei enthält Regeln und Leitplanken; das Pflichtenheft enthält Details, Entscheidungen (mit Begründung) und offene Punkte.
> Exakte Design-Tokens: `./DESIGN.md` (zu Baubeginn anzulegen, gespiegelt am Kalkulator-Projekt).

---

## Was wir bauen

Der professionelle Neubau von **coolin.at** — der Marketing-Plattform von COOLiN Energy. Klassische Marketing-Seite mit echter Menüstruktur/Unterseiten (kein 1:1-Rebuild der alten Scroll-Seite), plus Fundament für einen späteren Login-/Subscription-Bereich. Die Website „dreht sich" um den bestehenden **Peak-Shaving-Kalkulator** (Schwesterprojekt), der als bezahltes Produkt hinter Login integriert wird. **Erster Bauabschnitt: die Marketing-Website (`apps/web`).**

## Nicht verhandelbare Prinzipien

1. **Zwei Achsen, nicht vermischen.** *Leistungen* (Beratung/Umsetzung, Lead-Gen) vs. *Produkte* (Software/Daten-Abos, bezahlt). IA, CTAs und Ton trennen beide sauber.
2. **Peak Shaving ist das Flaggschiff** — eigener Top-Level-Punkt (nicht in den Leistungen) + prominenter Startseiten-Block mit Teaser. Zwei Rechner sauber getrennt: **Schnellrechner** (frei, Teaser) vs. **Pro-Kalkulator** (echte Analyse).
3. **SEO ins Fundament.** Intent-getrennte Seiten (Leistungen/Branchen/Wissen/Flaggschiff kannibalisieren sich nicht), JSON-LD (Organization/LocalBusiness Wien), sitemap/robots, Core Web Vitals, 301-Redirects von alten `.html`-Pfaden. **Flaggschiff-Content: „Leistungstarif 2027 / SNE-GV"** — bester AT-Hebel, erster Blog in Phase 1.
4. **Für Skalierung bauen, ohne Over-Engineering.** Produkte als datengetriebene Collection; Login später als Multi-Entitlement-Container; Reseller-Mandantenfähigkeit (Tenant-Overlay) nicht verbauen — aber jetzt nicht bauen. Keine Demo-Abkürzungen im Fundament, keine spekulativen v2/v3-Features vorbauen.
5. **i18n-vorbereitet.** Phase 1 nur Deutsch (AT), aber Struktur so, dass ein Sprach-Toggle (europäische Sprachen, Phase 3/4) ohne Umbau geht. Texte übersetzbar strukturieren, Locale-Routing vorbereiten.
6. **Seriös & ehrlich.** Professionell, ruhig, keine Gradienten, keine verspielten Emoji-Icons, gedämpfte Profitöne (Navy + ein Grün-Akzent + Off-White). Mobile/Tablet/Desktop gleichwertig. **Keine erfundenen Kennzahlen/Referenzen.**
7. **Rechtstexte unantastbar.** Impressum/Datenschutz verbatim übernehmen. Datenschutz muss aktualisiert werden, sobald Daten (Supabase/Analytics/Login/Stripe) verarbeitet werden — `[rechtlich]`.

## Stack (bestätigt)

Next.js (App Router), TypeScript, Tailwind, pnpm-Workspaces (Monorepo), shadcn/ui, Recharts, next/font, next/image. Supabase (Phase 1: `contacts`; später Auth/Stripe/RLS). Resend (E-Mail). Cloudflare Turnstile (Bot-Schutz). Plausible/Umami (Analytics → **kein Cookie-Banner**). Deploy: Vercel (Phase 1 interner Deploy; Domain später).

**Monorepo (Ziel):** `apps/web` (Marketing, Phase 1) · `apps/portal` (Login/Pro-Kalkulator/admin, Phase 2) · `packages/engine` (wiederverwendet) · `packages/shared` · `packages/ui` · `supabase/`. Bestehendes `apps/website` (Standalone-Peak-Shaving-Funnel) wird absorbiert/retired.

## Arbeitsregeln (Kurzform)

- **Rollen:** claude.ai = Advisor/Architekt (schreibt Prompts). Claude Code = Implementierung (investigiert selbst). Andreas testet jeden Schritt live (Vercel-URL), bevor der nächste Prompt läuft.
- **Kommunikation:** Deutsch, kurz, präzise. Advisor statt Assistent — Position halten, kein Zustimmungs-Opener, Confidence-Tags bei echter Unsicherheit. Rückfrage nur bei echter fachlicher Lücke.
- **CC-Prompts:** klare AUFGABE + Kontext, expliziter NICHT-TUN-Abschnitt, konkrete Verifikation im Bericht. ABSCHLUSS: `pnpm build && pnpm test && git add -A && git commit`, dann `git push`. Sonnet/Standard-Effort als Default; Opus nur bei echter schwieriger Einzelentscheidung. Ein Prompt = ein Schritt.
- **Gates:** Bugs → Root Cause durch CC, nicht Symptom-Fix.
- **Design:** frontend-design-Skill konsultieren. Mehr Freiheit als Kalkulator-Projekt, außer bei Rechtstexten.

## Stand & offene Entscheidungen

> Lebendiger Handover-Anker. Neueste offene Punkte. Erledigtes wandert raus. Vollständige OP-Tabelle: Pflichtenheft §13.

- **[GESAMTSTATUS]** Konzeption abgeschlossen, Pflichtenheft v1.0 steht. Bauphase noch nicht begonnen. Nächster Schritt: erster CC-Prompt = Repo-Scaffold/Konsolidierung (Pflichtenheft §11, Phase 1).
- **[OFFEN, einzige Geschäfts-Weiche] OP#1:** Kalkulator in Phase 1 kostenlos (Lead-Magnet) vs. verkauft. Andreas tendiert „frei"; pending Martin. Blockiert Phase 1 nicht (frei ist der Default-Baupfad).
- **[MERKER] OP#6:** Vor Live-Gang Top ~20 Keywords mit Tool (Ahrefs/Semrush/Keyword Planner) gegenchecken. Nicht vergessen.
- **[ASSETS offen]** OP#7 Logo hochauflösend + Kalkulator-Screenshots von Andreas. Bis dahin Platzhalter.
- **[ENTSCHEIDUNG offen] OP#10:** Repo-Umbenennung `peak-shaving` → `coolin` empfohlen.
