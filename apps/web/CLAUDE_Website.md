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

- **[GESAMTSTATUS]** Prompt 1 (Scaffold) + Prompt 2 (Design-System) + Prompt 3 (Layout/Nav/i18n) abgeschlossen und live getestet auf `peak-shaving-web.vercel.app`. **Prompt 4 (Mega-Menü-Feinschliff + Startseite) gebaut** — s. eigener Absatz unten. Nächster Schritt: Schnellrechner (Peak-Shaving-Block trägt nur einen Platzhalter-Rahmen) bzw. Kontaktformular (§5.5).
- **[DOKU-KONFLIKT, ungelöst — Owner: Andreas/Advisor]** Es existieren ZWEI Handover-Dateien: `apps/web/CLAUDE.md` (tracked, wird automatisch geladen) und `apps/web/CLAUDE_Website.md` (diese Datei). Commit `99b99d3` hatte `CLAUDE_Website.md` → `CLAUDE.md` umbenannt, damit das Auto-Loading greift; danach ist `CLAUDE_Website.md` mit dem NEUEREN Inhalt wieder aufgetaucht, während `CLAUDE.md` auf einem älteren Stand stehenblieb („Konzeption abgeschlossen, Bauphase noch nicht begonnen"). Die automatisch geladene Datei ist damit die veraltete — genau der Zustand, den der Rename verhindern sollte. Die Stand-Abschnitte beider Dateien wurden mit Prompt 4 gleichgezogen; **welche Datei bleibt, muss entschieden werden** (Empfehlung: `CLAUDE.md` behalten, `CLAUDE_Website.md` löschen).

- **[GEBAUT: Prompt 4] Mega-Menü-Feinschliff + Startseite (/)**
  - **[MEGA-MENÜ, Raster an der Wurzel]** Die drei Leistungen-Spalten (3/2/1 Einträge) richteten sich je an ihrem EIGENEN Inhalt aus — die zweizeilige Überschrift „Beschaffen & Finanzieren" und umbrechende Labels („PV, Speicher & Eigenverbrauch") verschoben die Einträge darunter. Jetzt EIN Raster über alle Spalten: Zeile 1 = Überschriften, Zeile 2..n = Eintrag 1..n; die `<ul>` hängen sich per **CSS `subgrid`** in genau diese Zeilen ein, statt eigene aufzumachen. `<ul>`/`<li>`-Semantik bleibt erhalten. Zeilenzahl datengetrieben aus `lib/nav.ts` (`Math.max(...items.length)`) — ein neuer Eintrag wirkt automatisch. **Gemessen (Playwright, 1440px):** alle drei Überschriften `top=76`, Eintrag 1 jeder Spalte `top=120`, Eintrag 2 `top=180`. Hierarchie über Gewicht/Größe/Versalien/Sperrung + `pb-3` unter der Überschrift, Farbe `text-ink` statt `text-text-muted` (derselbe neutrale Ton wie die Footer-Spaltenköpfe) — KEIN zusätzlicher Akzent.
  - **[STARTSEITE]** Sieben Sektionen in der Reihenfolge §4.4, je eine Komponente unter `components/home/` (Hero · Peak-Shaving-Block · Portfolio · Branchen · Wissen · Vorgehen · Kontakt-CTA). Alle Texte in `messages/de.json` (Namespace `Home`), nichts hart im JSX. Karten-Listen lesen aus `lib/nav.ts` (`LEISTUNGEN_FLAT`/`BRANCHEN_FLAT`), keine zweite Liste.
  - **[SIGNATURE-MOTIV verschoben: Footer → Startseite]** Der Footer läuft auf JEDER Seite; sein `SignatureRule` wäre auf der Startseite der zweite Auftritt gewesen. Nach der DESIGN.md-Regel („höchstens ein Auftritt pro Seitenansicht; wer einen zweiten setzen will, muss den ersten entfernen") ist er dort entfernt, der Auftritt ist jetzt das `SignatureField` der Peak-Shaving-Navy-Sektion. **Folge: alle anderen Seiten zeigen das Motiv derzeit gar nicht** (regelkonform, aber bewusst zu wissen). In DESIGN.md dokumentiert.
  - **[SCHNELLRECHNER = PLATZHALTER]** Nur ein Rahmen („Schnellrechner / folgt") ohne Eingaben, Formel oder Beispielzahl — eine gerechnete Zahl ohne Rechenlogik wäre eine erfundene Kennzahl (§9.5). Eigener Prompt (§5.4).
  - **[KENNZAHLEN-ENTSCHEIDUNG, §9.5]** „6–10 Wochen bis zur umsetzbaren Roadmap" aus dem Bestand ÜBERNOMMEN (echte Spanne über den eigenen Prozess, von COOLiN selbst belegbar). „bis zu −25 % typische Energiekostenreduktion" WEGGELASSEN — Bestwert-Versprechen über Kundenergebnisse ohne Quelle/Referenzfall. Auch die Legacy-Projektbeispiele sind NICHT übernommen (gehören zu §5.6/OP#9, echte anonymisierte Fälle).
  - **[WISSEN-TEASER, Linkziel]** Alle drei Artikel zeigen auf `/wissen`, NICHT auf `/wissen/leistungstarif-2027` — die Route existiert nicht, dorthin zu verlinken hieße wissentlich in einen 404 zu führen. Beim Bau des Artikels ist das Ziel in `components/home/wissen-teaser.tsx` zu setzen (`WISSEN_HREF`). Die Karten sind als „in Vorbereitung" markiert.
- **[DRINGEND, unabhängig vom Bau-Fortschritt] OP#13:** Das aktuell LIVE geschaltete Impressum auf coolin.at ist selbst unvollständig (`[ergänzen]`-Platzhalter für Rechtsform/UID/Firmenbuchnr./Gewerbebehörde/Kammer — Pflicht nach §5 ECG). Andreas/Martin müssen diese Angaben real zuliefern, bevor die Impressum-Seite gebaut wird. Bis dahin bleibt `/impressum` Platzhalter. Siehe Pflichtenheft §9.1.
- **[OFFEN, einzige Geschäfts-Weiche] OP#1:** Kalkulator in Phase 1 kostenlos (Lead-Magnet) vs. verkauft. Andreas tendiert „frei"; pending Martin. Blockiert Phase 1 nicht (frei ist der Default-Baupfad).
- **[MERKER] OP#6:** Vor Live-Gang Top ~20 Keywords mit Tool (Ahrefs/Semrush/Keyword Planner) gegenchecken. Nicht vergessen.
- **[ASSETS offen]** OP#7 Logo hochauflösend + Kalkulator-Screenshots von Andreas. Bis dahin Platzhalter/Signature-Motiv-Nachzeichnung.
- **[ENTSCHEIDUNG, bestätigt]** Repo bleibt `peak-shaving` (kein Umbenennen — interner Name, Konfliktvermeidung mit Kalkulator).
