# Pflichtenheft — coolin.at Relaunch

> **Kanonisches Spezifikationsdokument für den professionellen Neubau der Website coolin.at.**
> Selbst-enthaltend und session-übergreifend nutzbar: eine neue Session (oder ein Handover an eine andere Person/ein anderes Tool) kann allein aus diesem Dokument nahtlos anschließen. Entscheidungen sind **mit Begründung** dokumentiert, offene Punkte mit Owner.
>
> **Schwesterprojekt:** Der Peak-Shaving-Kalkulator (`Pflichtenheft_Kalkulator_MVP.md`, Repo-Regeln `CLAUDE.md`). Die Website „dreht sich" um diesen Kalkulator; die Rechen-Engine wird wiederverwendet, nicht neu gebaut.
>
> **Stand:** Konzeption abgeschlossen, Bauphase noch nicht begonnen. Version 1.0.
>
> **Nachtrag 20.07.2026:** Übergeordnet gilt jetzt `../../Fahrplan_2026.md` — kanonische Quelle für Reihenfolge/Umfang aller Bauabschnitte. Die hier unter §10.2/§13 OP#11 skizzierte „Lead-Verwaltung" und der `/admin`-Bereich werden dort als **B1** (Lead- und Einwilligungsfundament) und **B2** (Segmentierung & Aussendung) geführt, deutlich konkreter gefasst als hier (versionierte Einwilligungen, Herkunftskontext als Pflichtfeld, Double-Opt-in). Die fachliche Tiefe zu B1–B4 wird hier ergänzt, sobald diese Abschnitte gebaut werden — **B1 ist gebaut und in §15 nachgezogen (21.07.2026)**; **B3 in §16, B4 in §17, B2-1 in §18 und B2-2 in §19 (24.07.2026)**. Offen bleibt aus diesem Bereich allein der Kampagnenversand (B2-3). Baureihenfolge: B3 **vor** B2, s. Fahrplan. Außerdem inzwischen überholt: **§8.6 nennt „Plausible oder Umami" als Analytics-Wahl — real umgesetzt ist PostHog** (cookielos, `cookieless_mode: 'always'`, kein Cookie-Banner, EU-Hosting Frankfurt), s. `apps/web/CLAUDE.md` und `DEPLOYMENT.md` §1e.

---

## 0. Status & Handover-Hinweis

**Phase:** Spezifikation fertig. Nächster Schritt = erster Claude-Code-Bau-Prompt (Repo-Scaffold, siehe §11).

**Rollenmodell (siehe §14):** Diese Datei (claude.ai / Advisor+Architekt) plant und schreibt präzise Prompts für Claude Code (Implementierung). Andreas testet nach jedem Schritt live, bevor der nächste Prompt läuft.

**Wie dieses Dokument zu lesen ist:** Tags im Text:
- `[Entscheidung]` — getroffen, mit Begründung. Nicht ohne neuen Grund umwerfen.
- `[Default Claude]` — vom Architekten eigenständig gesetzt; Andreas korrigiert bei Bedarf im Review.
- `[OP#n]` — offener Punkt, siehe §13, mit Owner.
- `[Phase 2]` / `[Phase 3]` / `[Phase 4]` — bewusst nicht in Phase 1.

**Kernauftrag:** Produktionsreife, professionelle, seriöse, gut strukturierte Marketing-Website. Kein Prototyp. Kein 1:1-Rebuild der bestehenden Seite — mehr Content, echte Menüstruktur mit Unterseiten statt einer langen Scroll-Seite. Muss auf Mobile, Tablet und Desktop gleichwertig gut aussehen. SEO-optimiert (Ziel: Top-Ranking bei Suchbegriffen rund um Energiemanagement / Peak Shaving / Lastspitzen).

---

## 1. Ziel & Nicht-Ziele

### 1.1 Ziele

1. Die Botschaft „Ihr Leistungspreis kostet Sie unnötig Geld — wir lösen das" professionell und glaubwürdig kommunizieren.
2. Erste (Test-)Kunden ansprechen und zur Interaktion bewegen (Teaser-Rechner, Kontakt, kostenloser Kalkulator).
3. Als Fundament für den späteren **Login-/Subscription-Bereich** dienen, ohne dass Copy oder Informationsarchitektur dafür umgebaut werden müssen.
4. Bei relevanten Suchbegriffen organisch ranken — insbesondere den österreich-spezifischen, brandaktuellen Hebel **Leistungstarif 2027 / SNE-GV** besetzen (siehe §6).
5. Erweiterbar bleiben: weitere Produkte/Services (v. a. in Richtung Daten/KI) und später Reseller-Mandantenfähigkeit müssen sich einfügen, ohne Neubau.

### 1.2 Nicht-Ziele (Phase 1)

- Kein Login/Auth, kein Stripe, keine Bezahlschranke (→ Phase 2).
- Keine Reseller-/Partner-Fläche mit eigenem Bereich (→ Phase 3).
- Kein volles Headless-CMS zum Selbst-Publizieren (Blog-Autoren-UI kommt als Git-backed CMS in Phase 2; Phase 1 = MDX im Repo).
- Keine Mehrsprachigkeit als aktives Feature — **aber** i18n-vorbereitete Struktur (siehe §8.7).
- Keine erfundenen Referenzen/Kennzahlen (siehe §5.6, §9.4).

**Leitprinzip gegen Scope-Creep:** Phase 1 ist eine exzellente Marketing-Website plus kostenloser Teaser. Alles Transaktionale (bezahlen, einloggen, verwalten) ist Phase 2+.

---

## 2. Zielgruppen & Priorität

| Priorität | Zielgruppe | Ansprache | Primär bedient über |
|---|---|---|---|
| 1 | **Gewerbe-Endkunden** (Bäckerei, Gastronomie, Hotellerie, Handel, Landwirtschaft, Kühlhaus) | Problem-orientiert, in ihrer Branchensprache | Startseite, Branchenseiten, Peak-Shaving-Flaggschiff, Teaser |
| 2 | **Installateure / Elektriker** (Reseller-Kanal) | Partnerprogramm, Vertriebslogik, gemeinsamer Nutzen | Seite „Für Installateure" (bzw. „Partner werden") |
| 3 | **Multiplikatoren** (WKO etc.) | Fachautorität, teilbarer Content | Wissen-Bereich (v. a. Leistungstarif-2027-Content) |

**[Entscheidung]** Der Testkunden-Push (Priorität 1) prägt Hierarchie und CTAs; „Über uns" bleibt vorhanden, aber nicht dominant. Seriosität/Vertrauen und Konversion sind gleichrangig — die Seite muss *sowohl* für kleine Direktkunden *als auch* für größere Erstkunden glaubwürdig wirken.

---

## 3. Markenrolle & Monetarisierung

### 3.1 Zwei Achsen (das zentrale mentale Modell)

`[Entscheidung]` Die Website bedient zwei verschiedene Käufer mit verschiedenem Kaufverhalten. Das wird strukturell über **zwei Achsen** abgebildet, damit sich die Botschaften nicht vermischen:

- **Leistungen** = „Wir machen es für Sie." High-Touch-Beratung/Umsetzung, Lead-Gen, „sprechen Sie mit uns". → Die 6 Services + Smart Heating.
- **Produkte** = „Software/Daten-Abos, die Sie buchen." Low-Touch, Self-Service, bezahlt. → Aktuell der Kalkulator; hier landet fast die gesamte Roadmap (siehe §5.7).

**Begründung:** Beratung sagt „maßgeschneidert", SaaS sagt „registrieren, loslegen". Ohne saubere Trennung verwirrt die Seite beide Käufergruppen. Diese Zwei-Achsen-Logik zieht sich durch IA, CTAs und Tonalität.

### 3.2 Rolle von coolin.at

coolin.at ist die **Hauptplattform** von COOLiN ENERGY: klassische Marketing-Seite **plus** Login-Bereich für bezahlte Features. `[Entscheidung]` Das ersetzt bewusst das frühere Modell aus dem Kalkulator-Pflichtenheft (installateur-neutrale Produktmarke getrennt von einer COOLiN-Vitrinenseite). COOLiN ist jetzt die Dachmarke; White-Label/Reseller kommt später als eigener Layer (§3.4), nicht als getrennte Marke.

### 3.3 Monetarisierungs-Fahrplan

- **Phase 1:** Kalkulator **kostenlos** als Lead-Magnet (das bestehende Standalone-Erlebnis). `[OP#1 — Owner: Martin/Andreas]` Andreas tendiert klar zu „frei in Phase 1"; final pending Martins Meinung. **Diese Weiche ist die einzige noch offene Geschäftsentscheidung** — sie blockiert Phase 1 nicht (frei ist der Default-Baupfad).
- **Phase 2:** Login + Registrierung + Stripe; Pro-Kalkulator hinter Bezahlschranke. Preismodell (Abo vs. Einmalkauf) `[OP#2 — Owner: Andreas/Martin]`.
- **Phase 3:** Reseller-Mandantenfähigkeit.

**[Entscheidung]** CTA-Wording ist phasenfest: „**Kalkulator**" (nennt nur das Ziel, macht keine Preis-Aussage — muss beim Übergang frei→bezahlt nicht umgeschrieben werden). Zusatz „kostenlos" ggf. als Subtext/Badge neben dem Button, nicht im CTA-Text selbst.

### 3.4 Reseller/Partner (Zukunft, nicht verbauen)

`[Phase 3]` Reseller/Partner erhalten einen eigenen Bereich und können eigene Produkte/Batterien für *ihre* Kalkulator-Instanz ergänzen (Batterien, die COOLiN selbst nicht anbietet/abbildet). Das koppelt an die bereits im Kalkulator-Projekt spezifizierte Katalog-Architektur **Plattform-Stammkatalog + Tenant-Overlay**: Produkt-/Batteriekatalog wird von Anfang an tenant-scoped *gedacht*, sodass ein Partner eigene Einträge nur für seine Instanz sieht. **Jetzt gilt:** nicht bauen, aber das Datenmodell darf es nicht verbauen (kein hartes „1 Nutzer = 1 Firma", kein hartkodierter Einzelkatalog). Konsistent mit dem Kalkulator-Projekt.

---

## 4. Informationsarchitektur / Sitemap

### 4.1 Hauptnavigation

`[Entscheidung]` 5 Top-Level-Punkte + rechts 2 Buttons. Mehr verträgt keine saubere Mobile-Nav.

```
Logo (Emblem + Wortmarke COOLiN ENERGY)
│
├─ Leistungen ▾            (Mega-Menü, gruppiert)
│    Erzeugen & Optimieren:  PV, Speicher & Eigenverbrauch · Energiemanagement & Effizienz · Smart Heating
│    Beschaffen & Finanzieren: PPA & Grünstrom · Finanzierung & Förderungen
│    Nachweisen:             ESG / CSRD
│
├─ Peak Shaving ▾          (Flaggschiff — NICHT in den Leistungen)
│    Was ist Peak Shaving (Erklärseite)
│    Der Kalkulator (Produkt- / Preisseite)
│
├─ Branchen ▾
│    Hotellerie · Gastronomie · Bäckerei · Handel    (Start; weitere später)
│
├─ Wissen                  (Blog / Fachautorität — Flaggschiff-Artikel: Leistungstarif 2027)
│
├─ Über uns
│
└─ [rechts]  Kontakt (sekundär)   ·   Login (Phase 1: „bald", Platzhalter)
```

**Prominenter CTA-Button** (eigenständig gestylt, nicht Teil der Nav-Links): „**Kalkulator**" → Peak-Shaving-Flaggschiff bzw. Teaser/Kalkulator.

**Nicht in der Hauptnav, aber als Seiten:** `/referenzen`, `/datenschutz`, `/impressum`, `/produkte` (bzw. `/preise` — Produkt-Übersicht, siehe §5.7).

### 4.2 Warum Peak Shaving nicht in den „Leistungen" steht

`[Entscheidung, mit Begründung]` Peak Shaving ist bei COOLiN **zwei** Dinge: eine *Methode/Dienstleistung* (überlappt stark mit Speicher + Energiemanagement) **und** ein *Produkt* (der bezahlte Kalkulator). Es doppelt in der Nav zu führen, verwässert genau die Sonderstellung, die es verdient. Daher: nur eigener Top-Level-Punkt; die Leistungs-Seiten (PV/Speicher, Energiemanagement) verlinken auf das Flaggschiff (interne Verlinkung auf die „Money-Page" ist SEO-technisch sogar besser). **Best of both worlds:** zusätzlich ein prominenter Peak-Shaving-**Block auf der Startseite** mit Teaser (§4.4), sodass Peak Shaving auch dort sichtbar ist, ohne als eine der Portfolio-Kacheln zu erscheinen.

**Evolution:** Top-Level bleibt vorerst „Peak Shaving" (stärkstes Keyword, Flaggschiff). Sobald mehrere echte Produkte existieren, wird daraus „**Produkte ▾**".

### 4.3 URL-Struktur (Slugs)

Deutsch, sprechend, keyword-orientiert (final gegen §6-Keywords gegenprüfen). Beispiele:
`/loesung` bzw. `/peak-shaving`, `/peak-shaving/kalkulator`, `/leistungen/pv-speicher`, `/leistungen/energiemanagement`, `/leistungen/smart-heating`, `/leistungen/ppa`, `/leistungen/finanzierung-foerderung`, `/leistungen/esg`, `/branchen/hotellerie`, `/branchen/gastronomie`, `/branchen/baeckerei`, `/branchen/handel`, `/wissen`, `/wissen/leistungstarif-2027`, `/ueber-uns`, `/kontakt`, `/produkte`.

**Wichtig:** i18n-vorbereitet, d. h. die Routing-Struktur muss später einen Sprach-Präfix (`/de/…`, `/en/…`) oder eine gleichwertige Lösung ohne Umbau erlauben (§8.7).

### 4.4 Startseiten-Aufbau (Reihenfolge = Hierarchie)

1. **Hero:** Problem/Lösung in einem Satz („Wir senken Ihre Leistungskosten — mit belastbaren Zahlen"), klarer Primär-CTA („Kalkulator") + Sekundär-CTA („Beratung anfragen"). Ruhig, seriös, kein Gradient.
2. **Peak-Shaving-Block (extra):** eigener prominenter Abschnitt mit **Teaser-Rechner** (Schnellrechner, §5.4) — sichtbar, aber nicht überdimensioniert. Führt zum Flaggschiff/Kalkulator.
3. **Leistungsportfolio:** die 6 Leistungen als Kacheln, kurz zusammengefasst, professionell — **keine verspielten Emoji-Icons** (siehe §7.3). Klick → jeweilige Leistungs-Unterseite.
4. **Branchen-Teaser:** 2–4 Branchen-Karten → Branchenseiten.
5. **Wissen-Teaser:** 2–3 aktuelle Artikel, prominent der Leistungstarif-2027-Artikel.
6. **Vorgehen / Vertrauen:** kompakter „So arbeiten wir"-Block (aus Bestandscontent ableitbar), belastbare Trust-Elemente (keine erfundenen Zahlen).
7. **Kontakt-CTA** → Kontaktformular (§5.5).

---

## 5. Seiten & Content je Typ

> Bestandscontent aus `coolin.html` ist inhaltliche Grundlage (Leistungsportfolio, Peak-Shaving-Sektion, Vorgehen, Projektbeispiele, Kontakt). Vollständige Neugestaltung erlaubt; Ton bleibt seriös. **Wo Grafiken/Screenshots erklären, sind sie vorzusehen** — Andreas liefert während des Baus, oder Claude generiert Diagramme/Datenvisualisierung selbst, wo sinnvoll (§7.5).
>
> **Wichtig für CC:** Die Referenzdateien (`coolin-legacy.html`, `favicon.png`, ggf. `logo-coolin-energy.png`) liegen unter `apps/web/reference/` im Repo — **dort lesen, nicht raten oder aus Trainingsdaten annehmen.** Diese Dateien sind aus dem claude.ai-Projektordner hierher kopiert, weil CC keinen Zugriff auf claude.ai-Projektwissen hat.

### 5.1 Leistungen (6 Unterseiten)

Je Service eine eigene Seite mit Service-Intent-Keywords (§6). Bestehende Kurzbeschreibungen als Ausgangspunkt, ausgebaut zu vollwertigen Seiten (Problem → Vorgehen → Nutzen → Cross-Link zum Peak-Shaving-Flaggschiff und/oder Kalkulator). Die 6:

1. **PV, Speicher & Eigenverbrauch** — Auslegung, Wirtschaftlichkeit, Eigenverbrauch, Flexibilität. Keywords: *Gewerbespeicher, Photovoltaik Gewerbe, PV Eigenverbrauch*.
2. **Energiemanagement & Effizienz** — Lastganganalyse, Monitoring, ISO-50001-Readiness, Optimierung von Druckluft/Wärme/Kälte/Prozessen. Keywords: *Energiemanagement Unternehmen, Energieaudit, Energiekosten senken Betrieb, Druckluft optimieren*.
3. **Smart Heating (Nachtspeicheröfen)** — `[NEU]` intelligente Nachtspeicheröfen; **Synergie hervorheben:** Nachtspeicheröfen lassen sich auch als „Batterien" fürs Peak Shaving nutzen → Cross-Link zum Flaggschiff.
4. **PPA & Grünstrom** — Beschaffungsstrategie, Preis-/Risikomodell, Vertragsstruktur; Entrypoint für größere Firmen (Nähe zu Virtual Power Plant / Bytec-Kanal). Keywords: *PPA, Power Purchase Agreement, Grünstrom*.
5. **Finanzierung & Förderungen** — Fördermittel-Screening, CAPEX/OPEX, Contracting; Andockpunkt für den späteren **Förder-Check** (§5.7). Keywords: *Förderung Batteriespeicher Gewerbe, Investitionsfreibetrag*.
6. **ESG / CSRD** — Datenmodell, Emissionsberechnung, Audit-Ready-Doku. Keywords: *CSRD, ESG Reporting, CO₂-Bilanz Unternehmen*.

### 5.2 Peak-Shaving-Flaggschiff (Top-Level „Peak Shaving")

Zwei Unterseiten:

**(a) „Was ist Peak Shaving" (Erklärseite).** Eigener, ausführlicher Erklär-Content: Leistungspreis vs. Arbeitspreis, wie eine einzelne Viertelstunden-Spitze das ganze Jahr verteuert, RLM-Messung ab 100.000 kWh, physikalische vs. RLM-Kappung, Rolle von Speicher/Steuerung/Betriebsstrategie. Inhaltliche Referenzen zur Ausarbeitung (nicht kopieren — eigener Text): die im Kalkulator-Projekt gebaute Peak-Shaving-Website (`peak-shaving-website-ten.vercel.app`, wird hier absorbiert) sowie externe Fachguides (power-sonic.com, elum-energy.com) als Struktur-/Themen-Anregung. Diagramm „Lastgang vor/nach Kappung" vorsehen (Claude kann generieren). Führt am Ende zum Kalkulator.

**(b) „Der Kalkulator" (Produkt-/Preisseite).** Beschreibt das Produkt, zeigt **Screenshots des Pro-Kalkulators und der Ergebnis-Reports** (Andreas liefert; bis dahin Platzhalter). Erklärt den Unterschied Teaser vs. Pro (§5.4). Phase 1: CTA „Kalkulator" → freier Kalkulator. Phase 2: Preis-/Abo-Darstellung + „Jetzt starten" hinter Login. Diese Seite ist zugleich Teil der Produkt-Übersicht (§5.7).

### 5.3 Branchenseiten (Template + Start-Branchen)

`[Entscheidung]` **Wenige starke statt vieler dünner Seiten** (dünne Branchenseiten schaden dem Ranking). **Start: Hotellerie, Gastronomie, Bäckerei, Handel.** Weitere (Landwirtschaft, Kühlhaus, Handwerk …) später. **Kühlhaus mit Vorsicht:** im Kalkulator-Projekt ist dokumentiert, dass die Leistungs-Warnung bei Dauerlastprofilen unzuverlässig greift — dort keine harten Zusagen.

**Wiederverwendbares Branchen-Template** (ein Layout, pro Branche befüllt):
1. Branchenspezifischer Schmerz im Hero (Hotel: gleichzeitige Last aus Küche + HLK + Wäscherei; Bäckerei: Ofen-Spitzen früh; Gastro: Stoßzeiten; Handel: Kälte/Beleuchtung/Klima).
2. „Wo Ihr Strom hingeht" — typisches Verbrauchsprofil der Branche (Grafik/Aufschlüsselung).
3. Passende Hebel aus dem Portfolio für genau diese Branche.
4. Benchmark/Statistik — **mit Quellen, keine erfundenen Zahlen**, Ranges statt Scheingenauigkeit.
5. Eingebetteter Schnellrechner + CTA zum (Pro-)Kalkulator.
6. Referenz / „Was wir für [Branche] tun" + Kontakt-CTA.

Sprache in der jeweiligen Branchensprache; Angebote identisch, Framing branchenspezifisch. Problem-Intent-Keywords: *Energiekosten/Stromkosten senken Hotel / Bäckerei / Gastronomie / Handel*.

### 5.4 Teaser-Rechner vs. Pro-Kalkulator (Namensklarheit)

`[Entscheidung]` Zwei Rechner, aber **nicht beide „Kalkulator"** — sonst versteht niemand, wofür man zahlt.

- **Schnellrechner / Spar-Check** (Martins Teaser): kostenlos, on-page, kein Login. **Für die Startseite auf 2–3 Eingaben eindampfen** (aktuelle Spitze kW, Leistungspreis, Zielreduktion) → *eine* Zahl (geschätzte Jahresersparnis) + weicher CTA. Die ausführlichere Variante (aktuell 6 Felder, siehe `coolin.html`) darf auf der Peak-Shaving-Seite stehen. Sichtbar als Orientierung deklariert (Disclaimer aus Bestand übernehmen). **Muss immer zum Pro-Kalkulator führen** — das ist die narrative Brücke frei→belastbar/bezahlt.
- **Peak-Shaving Kalkulator (Pro):** die echte Lastgang-Analyse (bestehendes Engine-/UI-Werk). Phase 1 frei zugänglich `[OP#1]`, Phase 2 hinter Login/Bezahlung.

### 5.5 Kontakt

Neugestaltung des bestehenden Formulars (siehe `coolin.html`-Modal / Screenshot). **Themen-Dropdown auf die finale Angebots-Taxonomie mappen** (die 6 Leistungen + Peak Shaving + Smart Heating + „Sonstiges"). **Technik-Wechsel:** Netlify Forms funktioniert auf Vercel/Next nicht → Formular über Next-API-Route → Supabase-Tabelle `contacts` + Benachrichtigung via Resend (§8). Bot-Schutz: **Cloudflare Turnstile** statt reCAPTCHA (kein Cookie-Banner, §9). Pflichtfelder inkl. DSGVO-Checkbox (nicht vorausgewählt, Link zur Datenschutzerklärung), analog Bestand.

### 5.6 Über uns / Referenzen

**Über uns:** Team (Andreas, Martin), Mission, Track Record. Reale Bios/Fotos `[OP#8 — Owner: Andreas/Martin]`; bis dahin Platzhalter. **Referenzen:** Struktur jetzt anlegen, Inhalt bleibt dünn bis zum ersten echten Referenzkunden `[OP#9 — Owner: Martin]` (koppelt an Kalkulator-OP#1: Gerhard/Martins Kunde). Bestehende generische Projektbeispiele durch echte anonymisierte Fälle ersetzen, sobald belastbar. **Keine erfundenen Kennzahlen.**

### 5.7 Produkte & Roadmap-Teaser

`[Entscheidung]` **Produkte als datengetriebene Collection**, nicht hartkodierte Einzelseiten: Phase 1 als Config/MDX-Liste, gerendert von *einem* wiederverwendbaren Produkt-Template. Später Supabase-Katalog. Neues Produkt = Dateneintrag, kein Umbau. Login/Account wird als **Multi-Entitlement-Container** gedacht (ein Nutzer kann mehrere Abos halten) `[Phase 2]`.

**Produkt-Übersichtsseite** (`/produkte` bzw. `/preise`): listet den **Kalkulator** (real) + **max. zwei** „bald verfügbar"-Teaser. `[Entscheidung]` Nur die zwei stärksten, dezent, kein Vaporware-Overload:
- **Monitoring (Basic/Pro)** — laufende Überwachung als Monats-Abo. Recurring-Revenue-Story, an Energiemanagement angedockt. (Basic: Auslesen des Batteriespeichers zur Verbrauchs-Schätzung; Pro: Live-Verbrauch.) Historische-Daten-/Genau-Abrechnungs-Angebote werden **mit Monitoring zu einer Produktlinie „Daten & Monitoring" gebündelt**, nicht als Einzelprodukte gezeigt.
- **Förder-Check** — Investitionsfreibetrag / ökologische Investitionsförderung berechnen. Kundennah, an Finanzierung/Förderung angedockt. Könnte später ein simpler Rechner wie der Teaser werden.

**Bewusst NICHT auf der Marketing-Seite** (interne Technik/Plumbing, kein verkaufbares Line-Item): Viertelstunden-Roboter / Portal-Auslesung (Modbus), Wechselrichter-Konnektoren + KI-Verbrauchsableitung, Batterie-Distributor-Schnittstellen + Katalog-Anbindung. **Begründung:** „Coming soon: Modbus-Konnektor" wirkt unfertig und ist Rauschen. Der *Kundennutzen* dieser Technik wird über die Produkte ausgedrückt („wir lesen Ihre Daten automatisch aus" im Monitoring; „präzisere Speicher-Empfehlung" im Kalkulator). **AI** wird als *Fähigkeit* echter/naher Produkte kommuniziert („KI-gestützte Verbrauchsprognose"), keine eigene Vaporware-„AI"-Seite.

---

## 6. SEO

### 6.1 Der strategische Hebel: Leistungstarif 2027 / SNE-GV

`[Entscheidung]` **Bester verfügbarer SEO- und Vertriebs-Hebel.** Österreich ändert die Netzentgelt-Systematik zum 1.1.2027 (SNE-Grundsatzverordnung auf Basis des ElWG). Für Klein-/Mittelbetriebe auf **Netzebene 7**, bisher pauschal abgerechnet, wird künftig der **monatliche Leistungspeak** (höchster Viertelstundenwert des Monats, via Smart Meter) zum entscheidenden Kostenfaktor. Praxis-Musterbeispiel: Betrieb mit mehreren Kompressoren, die gleichzeitig anlaufen — gilt für jede Werkstatt, Bäckerei, Gastronomie, kleinen Produktionsbetrieb.

Warum das ein Volltreffer ist: (a) Österreich-spezifisch = COOLiN-Fokus; (b) brandaktuell (Verordnung wird 2026 finalisiert); (c) erzeugt **neue** Peak-Shaving-Nachfrage bei genau den KMU-Zielbranchen; (d) dünner Wettbewerb für diesen Winkel (spezialisierte Anbieter meist deutsch: solanox.de, memodo.de, peak-energy.gmbh, 1komma5; österreich-fokussiert wenige: cf-floeckner.at, green-future.at).

**Umsetzung:** Flaggschiff-Artikel im Wissen-Bereich „**Leistungstarif 2027 / SNE-GV — was Ihr Betrieb jetzt wissen muss**". `[Entscheidung]` **Wird sofort in Phase 1 als erster Blog implementiert**, inkl. Bildern/Statistiken/Grafiken (Claude generiert, wo sinnvoll). Artikel-Outline siehe §6.5. Leitet direkt auf Peak Shaving + Kalkulator.

### 6.2 Keyword→Seite (Intent-getrennt)

Kein Keyword doppelt bedienen (Thin/Duplicate-Strafe). Intent pro Seitentyp:

- **Peak-Shaving-Flaggschiff** (Produkt/Methoden-Intent): *Peak Shaving · Lastspitzenkappung · Lastspitzen reduzieren/kappen · Leistungspreis senken · Spitzenlastkappung · Lastmanagement*
- **Leistungen/Speicher** (Service-Intent): *Gewerbespeicher · Batteriespeicher Gewerbe · Industriespeicher · Stromspeicher Unternehmen*
- **Leistungen/Energiemanagement:** *Energiemanagement Unternehmen · Energiemanagementsystem · ISO 50001 · Energieaudit · Druckluft optimieren · Energiekosten senken Betrieb*
- **Leistungen/PV:** *Photovoltaik Gewerbe · PV Eigenverbrauch Unternehmen · Gewerbe-PV*
- **Leistungen/PPA:** *PPA · Power Purchase Agreement · Grünstrom · Stromliefervertrag Unternehmen*
- **Leistungen/Förderung:** *Förderung Batteriespeicher Gewerbe · Investitionsfreibetrag Öko · ökologische Investitionsförderung*
- **Leistungen/ESG:** *CSRD · ESG Reporting · CO₂-Bilanz Unternehmen*
- **Branchen** (Problem-Intent): *Energiekosten/Stromkosten senken Hotel · Bäckerei · Gastronomie · Handel*
- **Wissen** (Info-Intent): *Leistungstarif 2027 · SNE-GV · Netzentgelte Österreich · Was ist Peak Shaving · Leistungspreis erklärt · RLM Messung · Viertelstundenleistung*

**Terminologie-Notizen (aus Recherche):** „Lastspitzenkappung" = etablierte dt. Entsprechung zu Peak Shaving; Schwelle 100.000 kWh Jahresverbrauch (ab da viertelstündliche Messung / Leistungspreis); „Netzentgelte / Netzgebühren / Netzkosten" umgangssprachlich synonym; relevante Begriffe *RLM, Viertelstundenleistung, Netzebene 7, E-Control, Smart Meter*.

### 6.3 Meta-Descriptions

Pro Seite ~150–160 Zeichen: Primär-Keyword + AT-Bezug + Nutzen + weicher CTA. Muster:
- Peak-Shaving-Seite: *„Lastspitzenkappung für Gewerbe in Österreich: Leistungspreis senken, Speicher richtig auslegen, ROI berechnen. Jetzt Einsparpotenzial testen."*
- Wissen/2027: *„Leistungstarif 2027 in Österreich: Was der neue monatliche Leistungspreis für KMU bedeutet — und wie Sie Ihre Netzkosten jetzt senken."*

Ebenso Open-Graph-Tags (Titel/Beschreibung/Bild) pro Seite.

### 6.4 SEO-Technik (ins Fundament, nicht nachrüsten)

`[Default Claude]` Standardmäßig einbauen:
- **Strukturierte Daten (JSON-LD):** `Organization` + `LocalBusiness` (Wiener Adresse: Karl-Popper-Straße 22, 1100 Wien — echter Local-Ranking-Hebel), `Article` (Blog), `Product` (Kalkulator/Produkte), `FAQPage` wo passend.
- `sitemap.xml` + `robots.txt` (automatisch generiert).
- **Core Web Vitals** als harte Anforderung (schnelle Ladezeiten, kein Layout-Shift; Bilder optimiert via `next/image`; Fonts selbst gehostet via `next/font`).
- **301-Redirects** von allen alten `.html`-Pfaden (`coolin.html`/Startseite, `/impressum.html`, `/datenschutz.html`, `/danke.html` …) auf die neuen Routen — damit bestehendes Ranking und Backlinks nicht verloren gehen.
- Saubere Heading-Hierarchie, sprechende Slugs, interne Verlinkung Leistungen↔Flaggschiff↔Branchen↔Wissen.

### 6.5 Artikel-Outline „Leistungstarif 2027" (Phase-1-Flaggschiff)

Erster Blog, mit Grafiken. Vorschlag (Feintuning später; „Was Sie wissen müssen"-Kategorie soll sich wie ein schönes CMS anfühlen — Rich-Layout, Callouts, Charts):

- **H1:** Leistungstarif 2027: Was der neue Netztarif für Ihren Betrieb bedeutet
- **H2:** Was sich ändert (SNE-GV / ElWG, ab 1.1.2027, monatlicher Leistungspeak auf NE7) — *Callout mit den Kern-Eckdaten*
- **H2:** Arbeitspreis vs. Leistungspreis — der entscheidende Unterschied — *Diagramm/Schema (Claude generiert)*
- **H2:** Wen es trifft (KMU auf NE7, bisher pauschal) und wen weniger — *Grafik Netzebenen*
- **H2:** Praxisbeispiel — mehrere Geräte, die gleichzeitig anlaufen (Bäckerei/Werkstatt/Gastro) — *Lastgang-Chart vor/nach Entzerrung (Claude generiert)*
- **H2:** Was Sie jetzt tun können — entzerren, Lastspitzen kappen, Speicher — Übergang zu Peak Shaving
- **H2:** Ihr Einsparpotenzial in 2 Minuten — *eingebetteter Schnellrechner + CTA Kalkulator*
- **H2:** FAQ (für `FAQPage`-JSON-LD) — Was ist die Viertelstundenleistung? Ab wann RLM? Gilt das für alle Netzebenen?

**Quellen für den Redaktionsstand zum Schreibzeitpunkt prüfen** (E-Control-Verordnungsstand, ElWG BGBl. I Nr. 91/2025); Zahlen/Termine vor Veröffentlichung verifizieren, da sich der Verordnungsprozess 2026 noch bewegt.

### 6.6 Keyword-Tool-Check (Merker)

`[OP#6 — Owner: Andreas/Claude]` Diese Recherche liefert Terminologie, Intent und Wettbewerbslandschaft, aber **keine harten Suchvolumina/Difficulty-Werte** (kein Keyword-Tool verfügbar). **Vor dem Live-Gang die Top ~20 Begriffe einmal mit einem Tool (Ahrefs / Semrush / Google Keyword Planner) gegenchecken** und die Slugs/Prioritäten ggf. anpassen. **Nicht vergessen.**

---

## 7. Design-System

> **Bindende Prinzipien hier; exakte Tokens in einer `DESIGN.md`** (von Claude Code zu Baubeginn angelegt, gespiegelt am Muster des Kalkulator-Projekts, wo Tokens getrennt geführt werden, weil sie sich schneller ändern als die Fachlogik). **frontend-design-Skill vor jeder UI-Arbeit konsultieren.** Mehr gestalterische Freiheit als das Kalkulator-Projekt (Marketing-Seite, kein Finanz-Tool) — **Ausnahme:** Rechtstexte (§9) unverändert, keine Kreativfreiheit.

### 7.1 Charakter

Professionell, seriös, ruhig, klar strukturiert, übersichtlich. Vertrauen für Investitionsentscheidungen im fünfstelligen Bereich. Marketing darf „leben" (dezente, zweckgebundene Animation), aber nie verspielt/unseriös wirken.

### 7.2 Farben

`[Entscheidung]` **Ein Anker + ein Akzent — nicht zwei Farben, die kämpfen.**
- **Anker (Struktur/Marke):** Navy, ~`#18336f` (Bestandston) bzw. tiefes Slate für Text/Überschriften.
- **Akzent (einzig, sparsam — CTA / positive Signale):** ein **gedämpftes Grün/Teal**, ~`#0f766e` (Teal-700, deckungsgleich mit dem Akzent der Kalkulator-`DESIGN.md` → „ein Produkt"-Gefühl beim Übergang Marketing→Kalkulator). **Bewusst ruhiger/entsättigter** als das aktuelle helle Teal `#15b8b0`, das zu „Consumer/techy" wirkt.
- **Hintergrund:** Off-White (z. B. `#f8fafc`-Bereich). **Keine radialen Farbverläufe/Glows** wie aktuell.
- **Semantische Farben** (Ersparnis grün, Kosten rot, Warnung bernstein): reserviert für **Zahlen mit Bedeutung**, nicht als Dekor — konsistent mit Kalkulator-`DESIGN.md`.
- **Pastell meiden:** für ein B2B-Energie/Finanz-nahes Thema liest sich Pastell weich/unseriös. „Dezent" = entsättigte, ruhige Profitöne (Navy + gedämpftes Grün + Off-White + Slate-Grau).

**`[Entscheidung]` Keine Gradienten** — die aktuellen Blau→Teal-Verläufe auf Buttons/CTA/Hero raus. Flache Flächen, klare Linien, dünne Ränder statt Schlagschatten.

### 7.3 Icons

`[Entscheidung]` **Keine verspielten Emoji-Icons** auf den Kacheln (aktuell ☀️📜📊⚡💶🧾 — Hauptgrund für den verspielten Eindruck). Entweder **gar keine Icons** oder **schlichte, einfärbige Line-Icons**, klein, nicht dominant.

### 7.4 Typografie & Wortmarke

- **Font:** **Inter** (Konsistenz mit Kalkulator, exzellente Zahlen-Lesbarkeit, selbst gehostet via `next/font` → schnell + DSGVO-freundlich). `font-variant-numeric: tabular-nums` bei allen Finanz-/Lastwerten.
- **Logo:** das bestehende Emblem (siehe `favicon.png`) **bleibt**. Hochauflösende Assets werden benötigt `[OP#7 — Owner: Andreas]` (aktuell nur `favicon.png` + Referenz auf `logo-coolin-energy.png`).
- **Wortmarke „COOLiN ENERGY":** Text bleibt, aber **starke Wortmarke gestalten**. Richtung: „COOLiN" in Navy, kräftiges Gewicht; „ENERGY" leichter/gesperrt; das stilisierte Klein-„i" greift den Grün-Akzent (i-Punkt) oder das Favicon-Motiv auf. **Flach, kein Gradient.** Emblem links + Wortmarke rechts als Lockup, mit Clear-Space-Regel. **Claude liefert SVG-Varianten früh im Bau** (bevor der Rest steht, damit die Marke sitzt).

### 7.5 Layout, Responsive & Grafik-Politik

- **Responsive ist harte Anforderung:** Mobile / Tablet / Desktop gleichwertig. Sauberes **Mobile-Mega-Menü-Pattern** (die aktuelle `prompt()`-basierte Mobilnavigation ist ein Platzhalter und muss weg).
- Großzügiger Weißraum, konsistentes Spacing-Raster (Tailwind-Skala), Karten mit dezenten Rändern statt Schatten.
- **Grafiken/Screenshots, wo sie erklären** — vorsehen. Andreas liefert während des Baus; **Claude generiert Diagramme/Datenvisualisierung (Lastgang, Kostenvergleich, Netzebenen-Schema, Energiefluss) selbst, wo sinnvoll.** Datenvisualisierung sauber und ruhig (Recharts o. Ä.), passend zum seriösen Charakter.

### 7.6 Bibliotheken

Komponenten **shadcn/ui** (Radix, Code im Repo, anpassbar, barrierefrei — Voraussetzung für späteres White-Label). Charts **Recharts**. Animation sparsam (**Framer Motion / CSS**, nur Marketing). Fonts **next/font**.

---

## 8. Technische Architektur

### 8.1 Repo-Verhältnis & Engine-Wiederverwendung

`[Entscheidung, mit Begründung]` **Bestehendes Monorepo wiederverwenden** (das Peak-Shaving-Repo, `github.com/andi1180/peak-shaving`), **als Konsolidierung, nicht als Anbau.** Der Pro-Kalkulator soll *innerhalb* von coolin.at hinter Login laufen und braucht `packages/engine` in-process — getrennte Repos würden entweder ein publiziertes Package (Versionierungs-Overhead) oder eine API-Grenze (Latenz/Infra) erzwingen, beides Over-Engineering für ein 2-Personen-Team. **Repo-Umbenennung `peak-shaving` → `coolin` (bzw. `coolin-platform`)** empfohlen `[OP#10 — Owner: Andreas]`.

**Ziel-Struktur (Monorepo):**
```
apps/web        ← coolin.at Marketing-Seite (NEU, Phase 1)
apps/portal     ← bezahlter Login-Bereich inkl. Pro-Kalkulator [Phase 2] + /admin [Phase 2]
packages/engine ← Rechen-Engine (unverändert, wiederverwendet)
packages/shared ← Typen/Konstanten (geteilt)
packages/ui     ← geteiltes Design-System (ggf. extrahiert, damit Marketing + Portal dieselbe Sprache sprechen)
supabase/       ← Schema, Migrations, RLS
```

**Bestehendes `apps/website`** (der Standalone-Peak-Shaving-Funnel, deployed auf `peak-shaving-website-ten.vercel.app`) **bleibt aktiv und wird parallel weiterentwickelt** — der Kalkulator ist ein eigenständiges, laufendes Projekt, keine Baustelle, die für die Website pausiert. **Erst wenn Portal/Login (Phase 2) fertig ist, wandert die Kalkulator-UI dort als Route hinein und `apps/website` wird abgelöst** (nicht vorher, nicht als Phase-1-Aufgabe). **Phase-1-De-Risking:** Phase 1 fügt nur `apps/web` (Marketing + Teaser) hinzu; die Engine/Portal-Konsolidierung ist eine Phase-2-Entscheidung — Phase 1 nur so bauen, dass sie das nicht verbaut.

**CLAUDE.md-Struktur (hierarchisch, nicht überschreiben):** Die bestehende Root-`CLAUDE.md` + `Pflichtenheft_Kalkulator_MVP.md` bleiben unverändert für die Engine-/Kalkulator-Arbeit. Dieses Pflichtenheft und eine eigene `CLAUDE.md` leben unter `apps/web/` (siehe Repo-Struktur oben) und gelten nur für die Website-Arbeit. Claude Code lädt beide Ebenen automatisch, je nachdem in welchem Ordner gearbeitet wird — kein Konflikt, keine Dateikollision.

### 8.2 Stack

Next.js (App Router), TypeScript, Tailwind CSS, pnpm-Workspaces (Monorepo), shadcn/ui, Recharts, next/font, next/image.

### 8.3 Deployment

`[Entscheidung]` **Vercel.** Phase 1 zunächst **intern über Vercel deployen** (Preview/Prod-URL); die Produktivdomain coolin.at kommt später (§12). Kein Blocker für die Bauarbeit.

### 8.4 Supabase (Scope gestaffelt)

- **Phase 1 (low-risk, sinnvoll jetzt):** Tabelle `contacts` (Kontaktanfragen). Auslöser für Datenschutz-Update (§9).
- **Phase 2:** Auth (Login/Registrierung), Stripe-Anbindung, Entitlements (Multi-Abo), `/admin`-Daten (Leads, Partner-Freigaben), Kalkulator-Verlauf (gehört fachlich zum Portal/RLS).
- **Phase 3:** Multi-Tenancy/RLS für Reseller, tenant-scoped Produkt-/Batteriekatalog (Tenant-Overlay, §3.4).

### 8.5 E-Mail

`[Entscheidung]` **Resend** für Versand von @coolin.at (Kontakt-Benachrichtigung; später Newsletter). DNS (SPF/DKIM/DMARC) einrichten (§12).

### 8.6 Formulare, Bot-Schutz, Analytics

`[Entscheidung]` **Kontaktformular** über Next-API-Route → Supabase `contacts` + Resend-Benachrichtigung (Netlify Forms entfällt). **Bot-Schutz Cloudflare Turnstile** (statt reCAPTCHA). **Analytics: Plausible oder Umami** (privacy-freundlich). **Folge:** kein Cookie-Consent-Banner nötig (§9) — DSGVO-sauber, schneller, konsistent zur datenschutzbewussten Haltung.

### 8.7 Internationalisierung (i18n)

`[Entscheidung]` **Phase 1 nur Deutsch, AT-fokussiert — aber i18n-vorbereitet von Anfang an**, sodass ein späterer Sprach-Toggle (Phase 3/4, idealerweise alle europäischen Sprachen) **ohne Umbau** möglich ist. Konkret: Routing/Struktur i18n-fähig auslegen (z. B. `next-intl` oder gleichwertig, Locale-Präfix vorbereitet), Texte nicht hart im JSX verstreuen, sondern übersetzbar strukturieren. **Übersetzungsweg = Architekten-Entscheidung** (AI-Übersetzung / Übersetzungsdienst / manuell — zum Zeitpunkt der Aktivierung entscheiden). Jetzt gilt nur: es muss **offen** bleiben. `[Default Claude]` Pragmatische Umsetzung wählen, die Phase 1 nicht ausbremst (kein voller Übersetzungs-Workflow jetzt, nur die Struktur).

### 8.8 Portal-URL-Topologie

`[OP#5 — Owner: Andreas, später]` Subdomain (`app.coolin.at`) vs. Pfad (`coolin.at/app`) für den späteren Bezahlbereich — Phase-1-irrelevant, später entscheiden. Für jetzt: interner Vercel-Deploy.

---

## 9. Datenschutz, Consent, Barrierefreiheit & Recht

### 9.1 Rechtstexte

`[Korrektur, ersetzt vorherige Annahme]` **„Verbatim übernehmen" ist beim Impressum nicht möglich — die aktuelle Live-Version ist selbst ein unvollständiger Platzhalter.** Live-Abruf am 16.07.2026 von `coolin.at/impressum` zeigt wörtlich: *„Vor dem endgültigen Einsatz: Rechtsform, Inhaber bzw. vertretungsberechtigte Person, UID, Firmenbuchdaten, Gewerbebehörde und Kammerzugehörigkeit ergänzen"* — mit `[ergänzen]`-Platzhaltern genau an diesen Stellen. Das ist eine **bestehende Rechtslücke, unabhängig vom Relaunch**: nach §5 ECG sind diese Angaben für ein Impressum verpflichtend, und sie fehlen auf der aktuell live geschalteten Seite bereits heute. Kopieren würde die Lücke nur fortschreiben.

**`[OP#13 — Owner: Andreas/Martin, DRINGEND, unabhängig vom Website-Projekt]`** Folgende Angaben müssen real zugeliefert werden, bevor die Impressum-Seite gebaut wird (Quelle: Firmenbuch-Auszug, Gewerbeschein, WKO-Mitgliedschaft):
- Rechtsform (GmbH? Einzelunternehmen?) und exakter eingetragener Firmenwortlaut
- Geschäftsführung / vertretungsberechtigte Person(en)
- Firmenbuchnummer + Firmenbuchgericht (falls im Firmenbuch)
- UID-Nummer (falls umsatzsteuerpflichtig)
- Zuständige Gewerbebehörde
- Kammerzugehörigkeit (aktuell nur „Wirtschaftskammer Wien [prüfen/ergänzen]" vermerkt)

*Anmerkung, niedrige Konfidenz `[Guessing]`:* Eine ältere Google-Indexierung von coolin.at zeigte einmal den Namen „**COOLiN Consulting and Innovation GmbH**" — falls das der eingetragene Rechtsträger ist, spart das Nachschlagen. Bitte gegenprüfen, nicht ungeprüft übernehmen.

Datenschutzerklärung: Der Live-Text ist inhaltlich vollständig (DSGVO-Pflichtangaben vorhanden), aber **explizit als Vorlage für die jetzige statische Netlify-Seite markiert** (Zitat: *„Diese Vorlage deckt die aktuelle statische Netlify-Website mit Kontaktformular ab. Bei späterem Einsatz von Analytics, [...] muss sie ergänzt werden"*) — bestätigt §9.2 als Faktum, nicht nur als Annahme. **Kann als Ausgangstext übernommen werden** (referenziert in `reference/coolin-legacy-datenschutz.md`), muss aber vor Live-Gang von Supabase/Analytics/Login gemäß §9.2 erweitert werden.

**Bis OP#13 gelöst ist:** Die Impressum-Seite bleibt Platzhalter/„in Aufbau" — keine unvollständigen Rechtsangaben live schalten, auch nicht als Zwischenstand.

### 9.2 Datenschutz-Update-Trigger

`[OP#3 — Owner: Martin/rechtlich]` **Sobald Supabase Kontaktdaten speichert** (schon Phase 1) bzw. Login/Analytics/Stripe dazukommen, ist die aktuelle Datenschutzerklärung (verfasst für die statische Netlify-Seite) **unzureichend und muss rechtlich aktualisiert werden** (Versionierung; Formular-Speicherung, Turnstile, Analytics, später Auth/Zahlung/Verlauf sauber beschreiben). **Vor Live-Gang der Formular-Speicherung.**

**`[Nachtrag 21.07.2026]` Dieser Auslöser ist inzwischen eingetreten:** Das Kontaktformular schreibt seit B1-2 real in den Lead-Bestand. Welche Verarbeitungen konkret zu beschreiben sind (Lead- und Einwilligungsdaten, die beiden Aufbewahrungsfristen, Anonymisierung als Löschverfahren, Sperrliste, IP/Browser-Kennung als Einwilligungsnachweis), steht in **§15.9 Punkt 2**.

### 9.3 Consent / Cookies

`[Entscheidung]` Durch **Plausible/Umami + Turnstile kein Cookie-Consent-Banner nötig.** Falls später doch cookie-setzende Dienste (z. B. GA4) dazukommen, wird ein Consent-Mechanismus erforderlich — dann bewusst entscheiden.

### 9.4 Barrierefreiheit

`[Entscheidung / Default Claude]` **WCAG 2.1 AA als Ziel, von Anfang an mitgebaut** (shadcn/Radix unterstützen das ab Werk). Das EU-Barrierefreiheitsgesetz (in AT seit ~Mitte 2025 in Kraft) betrifft digitale B2C-Dienste — besonders relevant, sobald der Kalkulator verkauft wird (e-commerce-nah). Nachrüsten ist teurer als gleich richtig. Genauer rechtlicher Scope `[OP#4 — Owner: rechtlich]`.

### 9.5 Claims

**Keine erfundenen Kennzahlen.** Ranges + Quellen; generische Projektbeispiele durch echte anonymisierte Fälle ersetzen, sobald belastbar (§5.6).

---

## 10. Admin & Partner

### 10.1 Blog-Autoren-UI (CMS-Gefühl)

`[Entscheidung, mit Begründung]` **Kein eigener Editor gebaut.** Stattdessen **Git-backed CMS (Keystatic)** `[Phase 2]`: Admin-Oberfläche mit CMS-Gefühl, speichert Inhalte als **MDX im Repo** (versioniert, nutzt die Rich-Komponenten aus §7.5). Martin kann darüber ohne Code publizieren. Setzt auf MDX-in-Repo auf — **Phase 1 shippt den 2027-Artikel als MDX**; das Autoren-UI wird ohne Umbau darübergelegt. (Alternative Sanity = volles Headless-CMS = mehr Infra, für ein 2-Personen-Team Overkill.)

**Reader-seitiges „schönes CMS"-Erlebnis** (Layout, Callouts, Charts, Bildlayouts) = **Phase 1** (Rich-MDX-Komponenten als wiederverwendbare Bausteine). Das Autoren-UI ist ein Layer obendrauf und blockiert Phase 1 nicht.

### 10.2 Geschäfts-Admin

`[Phase 2]` Eigener, **rollen-geschützter `/admin`-Bereich** (Supabase-backed) — **kein CMS**, echte mandantenspezifische Logik: **Partner-Freigaben**, Lead-Verwaltung, später Produkt-/Mandanten-Pflege.

**`[Nachtrag 21.07.2026]`** Der `/admin`-Bereich existiert (Rollen, Kunden, Gutscheincodes, Scraper-Ziele) und trägt seit B1-3 den Abschnitt **Leads**. Was dort möglich ist — und was bewusst **nicht** möglich ist — steht in **§15.7**. Partner-Freigaben bleiben offen.

### 10.3 Partner-Selbstregistrierung

`[Phase 2]` „**Als Partner/Reseller anmelden**": öffentliches Formular → **Freigabe-Queue im `/admin`**. Übergang zur vollen Reseller-Mandantenfähigkeit in Phase 3 (§3.4).

---

## 11. Rollout / Bauphasen (gate-basiert)

> Jede Phase in klar abgegrenzte Claude-Code-Schritte zerlegt; Andreas testet jeden Schritt live (Vercel-URL), bevor der nächste Prompt läuft (§14). Ein Prompt = ein Schritt.

**Phase 1 — Marketing-Website (Fokus jetzt).**
Repo-Scaffold/Konsolidierung → Design-System + Wortmarke (SVG) → Layout/Nav (inkl. Mobile-Mega-Menü) + i18n-Struktur → Startseite (inkl. Peak-Shaving-Block + Schnellrechner) → 6 Leistungsseiten (inkl. Smart Heating) → Peak-Shaving-Flaggschiff (Erklärseite + Produkt-/Kalkulatorseite mit Screenshots-Platzhaltern; Verlinkung zum freien Kalkulator) → Branchen-Template + 4 Start-Branchen → Wissen-Bereich + Rich-MDX-Komponenten + **Flaggschiff-Artikel „Leistungstarif 2027"** (mit Grafiken) → Produkt-Übersicht + 2 Coming-Soon-Teaser (Monitoring, Förder-Check) → Über uns / Referenzen (Struktur) → Kontakt (API-Route → Supabase `contacts` + Resend + Turnstile) → SEO-Fundament (JSON-LD, sitemap/robots, 301-Redirects, Meta/OG) → Analytics (Plausible/Umami) → WCAG-Durchgang.
*Gate Phase 1:* vollständige, professionelle, responsive Marketing-Seite live auf Vercel; SEO-Fundament steht; Kontaktanfragen landen in Supabase; kein Cookie-Banner.

**Phase 2 — Login & Monetarisierung.**
Supabase Auth (Login/Registrierung) → Entitlements (Multi-Abo) → Stripe → Bezahlschranke Pro-Kalkulator → `/admin` (Partner-Freigaben, Leads) → Partner-Selbstregistrierung → Keystatic-Autoren-UI → Newsletter (`[OP#12]`, optional). Datenschutz-Update (§9.2) muss hier spätestens final sein.

**Phase 3 — Reseller-Mandantenfähigkeit.**
Multi-Tenancy/RLS, tenant-scoped Katalog (Tenant-Overlay), Reseller-Bereich live, Partner-eigene Produkte/Batterien.

**Phase 4 (ggf. mit Phase 3) — Mehrsprachigkeit.**
Aktivierung weiterer (europäischer) Sprachen über die in Phase 1 gelegte i18n-Struktur; Übersetzungsweg dann entscheiden.

---

## 12. Migration & Setup

- **Vorbereitung vor dem ersten CC-Prompt:** `apps/web/reference/` anlegen, `coolin.html` (als `coolin-legacy.html`) + `favicon.png` aus dem claude.ai-Projektordner dorthin kopieren — CC hat keinen Zugriff auf claude.ai-Projektwissen, nur auf das lokale Repo.
- **DNS-Umzug coolin.at Netlify → Vercel ohne Downtime** (später, wenn Domain umgezogen wird; sorgfältig planen).
- **Resend-DNS** (SPF/DKIM/DMARC) für Versand von @coolin.at.
- **301-Redirects** von allen alten `.html`-Pfaden (§6.4).
- **Logo-Assets in hoher Auflösung** von Andreas `[OP#7]`.
- **Screenshots** Pro-Kalkulator + Ergebnis-Report von Andreas (Platzhalter bis dahin).

---

## 13. Offene Punkte (OP)

| # | Punkt | Owner | Blockiert | Status |
|---|---|---|---|---|
| 1 | Kalkulator Phase 1 kostenlos vs. verkauft | Martin/Andreas | Monetarisierungs-Weiche (nicht Phase-1-Bau) | Tendenz „frei"; pending Martin |
| 2 | Preismodell Kalkulator (Abo vs. Einmalkauf) | Andreas/Martin | Phase 2 | offen |
| 3 | Datenschutzerklärung aktualisieren (Supabase/Analytics/Login/Stripe) | Martin/rechtlich | Live-Gang Formular-Speicherung | offen |
| 4 | WCAG-Scope final rechtlich prüfen | rechtlich | — (Bau läuft mit AA-Ziel) | offen |
| 5 | Portal-URL-Topologie (Subdomain vs. Pfad) | Andreas | Phase 2 | später |
| 6 | Keyword-Tool-Validierung Top ~20 Begriffe | Andreas/Claude | Vor Live-Gang | **Merker, nicht vergessen** |
| 7 | Logo-Assets in hoher Auflösung | Andreas | Wortmarke/Header final | Kalkulator-Screenshots geliefert (Prompt 9); Logo weiterhin offen |
| 8 | Über uns: reale Bios/Fotos | Andreas/Martin | Über-uns final | Platzhalter ok |
| 9 | Erster echter Referenzkunde | Martin | Referenzen belastbar | koppelt an Kalkulator-OP#1 |
| 10 | Repo-Umbenennung peak-shaving → coolin | Andreas | Sauberkeit | empfohlen |
| 11 | Reseller-Selbstregistrierung + tenant-scoped Katalog | Andreas | Phase 3 | Datenmodell nicht verbauen |
| 12 | Newsletter rund um 2027-Thema | Andreas | Phase 2 | Option |
| 13 | Impressum-Pflichtangaben (Rechtsform, UID, Firmenbuchnr., Gewerbebehörde, Kammer) — live heute schon unvollständig | Andreas/Martin | Bau der Impressum-Seite; **dringend, unabhängig vom Projekt** | offen, siehe §9.1 |

---

## 14. Arbeitsregeln (eingebettet)

**Rollen.** Claude (claude.ai) = strategischer Advisor + Architekt, schreibt präzise Prompts für Claude Code. Claude Code = Implementierung, ganze Codebase im Zugriff, investigiert selbst. Andreas testet live nach jedem Schritt, bevor der nächste Prompt geschrieben wird.

**Kommunikation.** Deutsch, kurz, präzise, kein Zerpflücken von Formulierungen. Advisor, nicht Assistent: kein Zustimmungs-Opener, Position halten außer bei echter neuer Information, Confidence-Tags (`[Certain]`/`[Likely]`/`[Guessing]`) bei genuiner Unsicherheit. Rückfrage nur bei echter fachlicher Lücke, die eine Zahl, Design- oder Architekturentscheidung betrifft.

**CC-Prompts.** Klare AUFGABE mit Kontext, expliziter NICHT-TUN-Abschnitt, Verifikation gefordert (nicht nur „Tests grün", sondern konkrete Belege im Bericht). ABSCHLUSS: `pnpm build && pnpm test && git add -A && git commit`, danach `git push`. Modellwahl: **Sonnet, Standard-Effort als Default** — Content-/Design-Arbeit, kein algorithmisch tiefes Problem. Opus nur bei einer echten, schwierigen Einzelentscheidung. **Ein Prompt, ein klar abgegrenzter Schritt** — kein Sammel-Prompt.

**Gates.** Jeder Schritt wird von Andreas live getestet (Vercel-URL), bevor der nächste Prompt geschrieben wird. Bei Bugs: **Root Cause durch CC, nicht Symptom-Fix.**

**Design.** frontend-design-Skill konsultieren. Mehr gestalterische Freiheit als das Kalkulator-Projekt (Marketing-Seite) — **aber Rechtstexte (Impressum/Datenschutz) unverändert übernehmen, keine Kreativfreiheit dort.**

---

## 15. Lead- und Einwilligungsverwaltung (Bauabschnitt B1)

> **Nachgezogen am 21.07.2026, nach Abschluss von B1.** Dieses Kapitel beschreibt, **was gebaut wurde** — nicht, was geplant war. Es ist so geschrieben, dass sich der Einwilligungs- und Löschprozess **ohne Repo-Zugang** beurteilen lässt.
>
> **Seither fortgeschrieben (24.07.2026).** Die Bauabschnitte B3 (Erfassungsstellen und Segmentierung), B4 (zeitgesteuerte Vorgänge), B2-1 (Bestandspflege und Ausfuhr) und B2-2 (Rückläufer und Beschwerden) sind gebaut; sie stehen in den **Kapiteln 16 bis 19**. Dieses Kapitel 15 beschreibt weiterhin das Fundament; Stellen, die durch die späteren Abschnitte überholt wurden, sind hier bereits nachgezogen und tragen einen Verweis.
>
> **Die Wahrheit über das Datenmodell liegt im Repo**, nicht hier: `supabase/migrations/` (drei Migrationen, Präfix `20260721*`) und die zugehörigen Integrationstests in `packages/db-tests/`. Dieses Kapitel nennt Tabellen- und Spaltennamen nur dort, wo sie zur Nachvollziehbarkeit nötig sind — eine zweite Schema-Kopie im Dokument würde vom Code auseinanderdriften und wäre schlimmer als keine.

### 15.1 Zweck und Abgrenzung

**Ein Bestand, nicht getrennte Listen.** Jede Person, deren Kontaktdaten das System erreicht, wird als **ein** Eintrag geführt — mit einem Statuskennzeichen für ihren Stand in der Geschäftsbeziehung. Getrennte Listen je Kanal („Newsletter", „Kontaktanfragen", „Messe") wären beim ersten Massenversand die Fehlerquelle: dieselbe Person stünde in zwei Listen, in einer davon abgemeldet, und bekäme die Mail trotzdem. Ein Bestand macht diesen Fehler unmöglich.

**Was B1 leistet:**
- Erfassung von Kontakten mit **verpflichtender Angabe des Einstiegspunkts** (über welchen Artikel, welches Formular, welche Aktion der Kontakt entstanden ist).
- **Mehrere zweckgebundene Einwilligungen je Person über die Zeit**, jede mit eigenem Nachweis.
- **Double-Opt-in** für alle Zwecke, deren Erfüllung eine künftige E-Mail ist.
- **Abmeldung** auf zwei Ebenen (einzelner Zweck vs. dauerhafte Sperre der Adresse).
- **Aufbewahrungsfristen** als abgeleitete Größe und **Anonymisierung** als endgültigen Vorgang.
- Einen **Admin-Bereich**, in dem sich all das einsehen und ausüben lässt.

**Was ausdrücklich NICHT zu B1 gehört:**

| Fehlt in B1 noch | Kommt mit | Stand heute |
|---|---|---|
| Segmentierte Sicht, Export, Zustellprotokoll | **B2** | **gebaut** (Kapitel 18 und 19) |
| Massenversand an eine Empfängerliste (Kampagne) | **B2-3** | **offen** |
| Erfassungsstellen jenseits des Kontaktformulars; die Segmentierungsmerkmale selbst (Branche, Netzebene, PLZ, Verbrauch) | **B3** | **gebaut** (Kapitel 16) |
| Automatische Durchsetzung der Löschfristen (zeitgesteuerter Job) | **B4** | **gebaut** (Kapitel 17) |
| Mandantenfähigkeit (getrennte Bestände je Partnerbetrieb) | **B13** | offen |

Die Segmentierungsmerkmale wurden in B1 **bewusst** ausgelassen: sie werden erst mit B3 fachlich definiert. Vorratsspalten oder ein Freitext-Sammelbecken anzulegen wäre später teurer zu räumen, als sie dann sauber zu ergänzen.

**`[überholt seit B4-1, 22.07.2026]`** Die Aussage dieses Absatzes lautete ursprünglich, die Löschfrist werde von Hand durchgesetzt, weil es keinen zeitgesteuerten Vorgang gibt. **Das gilt nicht mehr:** ein täglicher Lauf setzt die Frist automatisch durch (Kapitel 17). Der Admin-Bereich zeigt an derselben Stelle, an der früher der Hinweis auf die Handarbeit stand, jetzt den **Stand des Laufs** — und hebt hervor, wenn seit mehr als 48 Stunden kein erfolgreicher Lauf stattgefunden hat.

### 15.2 Datenmodell in fachlicher Sprache

Drei Arten von Datensätzen, plus eine bewusst freistehende vierte.

**1. Der Bestandseintrag („Lead").** Trägt die Identitätsmerkmale (E-Mail-Adresse, optional Firma, Ansprechperson, Telefon), den Einstiegspunkt der **Ersterfassung**, ein Statuskennzeichen (`neu` → `kontaktiert` → `Kunde`, bzw. `anonymisiert`), die Rechtsgrundlage der Aufbewahrung, den Zeitpunkt der letzten Interaktion und die daraus abgeleitete Löschfrist. Die E-Mail-Adresse ist eindeutig — Groß-/Kleinschreibung und Leerzeichen zählen dabei nicht, damit dieselbe Person nicht zweimal im Bestand steht.

Der Einstiegspunkt der Ersterfassung ist ein **Pflichtfeld und nach dem Anlegen unveränderlich**. Eine nachträglich umgeschriebene Herkunft wäre keine Herkunft mehr.

**Das Statuskennzeichen ist reiner Lebenszyklus — eine Abmeldung steht bewusst NICHT darin.** Das ist keine Kosmetik: Man kann vom Marketing abgemeldet **und zugleich** zahlender Kunde sein. Ein einziges Statusfeld für beides würde genau diesen Normalfall unmodellierbar machen. Die Abmeldung ist ein Einwilligungszustand (§15.5).

**2. Die Einwilligung.** **Mehrere je Person über die Zeit sind der Normalfall**, nicht die Ausnahme: erteilen, widerrufen, Jahre später erneut erteilen. Jede dieser Zeilen ist ein **eigenständiger Nachweis** — mit eigenem Zeitpunkt, eigenem Einstiegspunkt, eigener Textfassung und eigenem Zustand. Es gibt bewusst keine Beschränkung auf „eine Einwilligung je Zweck": die **Historie** ist der Nachweis. Die Frage „darf ich dieser Person jetzt schreiben?" wird nie durch einen Blick auf eine einzelne Zeile beantwortet, sondern durch eine dafür vorgesehene Prüfung über den gesamten Bestand an Einwilligungen (§15.5).

**3. Der Einwilligungstext.** Versionierte, **unveränderliche** Datensätze. Jede Einwilligung zeigt auf **genau die Textfassung, die der Person angezeigt wurde** — nicht auf die heute gültige. Änderung und Löschung eines Textes sind auf Datenbankebene gesperrt; eine neue Fassung ist immer ein neuer Datensatz mit höherer Fassungsnummer. Begründung: **Ein Einwilligungsnachweis, dessen Wortlaut sich nachträglich ändern lässt, ist kein Nachweis.**

Zur Fassung gehört auch die **Sprachfassung**. Ein englisch angezeigter Text muss englisch archiviert werden — man kann keine Zustimmung zu einem Wortlaut belegen, den die Person nie gesehen hat.

**4. Die Sperrliste.** Steht bewusst frei und hat keine Verbindung zu den Bestandseinträgen — Begründung in §15.5.

**Warum die Vertragsablauf-Erinnerung keine Marketing-Einwilligung ist.** Wer sich daran erinnern lassen möchte, dass sein Stromvertrag ausläuft, hat **nicht** zugestimmt, Angebote und Neuigkeiten zu erhalten — und umgekehrt. Es sind zwei verschiedene Verarbeitungszwecke mit zwei verschiedenen Erwartungen der betroffenen Person. Sie werden deshalb als getrennte Einwilligungen geführt, getrennt bestätigt und getrennt widerrufen. Ein Widerruf der Werbeeinwilligung lässt die Erinnerung ausdrücklich bestehen, und andersherum genauso.

### 15.3 Einwilligungsarchitektur

**Die drei Zwecke:**

| Zweck | Was er erlaubt | Bestätigung nötig? |
|---|---|---|
| **Informationen & Angebote** (`marketing_email`) | Künftige Aussendungen rund um Netzentgelte, Lastspitzen und Energiekosten | **ja** |
| **Vertragsablauf-Erinnerung** (`contract_expiry_reminder`) | Eine E-Mail vor Ende der Strom-Vertragslaufzeit — in Monaten oder Jahren | **ja** |
| **Ergebnis-Zusendung** (`result_delivery`) | Die einmalige Zusendung eines gerade angeforderten Rechenergebnisses | nein |

**Die Regel, wann bestätigt werden muss: sobald die Erfüllung eine KÜNFTIGE E-Mail ist — nicht erst bei Werbung.** Deshalb ist die Vertragsablauf-Erinnerung bestätigungspflichtig, obwohl sie kein Marketing ist: Wer eine fremde Adresse einträgt, erzeugt dort einen **dauerhaften Eintrag im Verteiler**, der irgendwann eine unerwartete Mail auslöst. Die einmalige Ergebniszusendung ist es nicht: Sie **ist** die unmittelbar angeforderte Leistung. Wer seine Adresse falsch eintippt, bekommt sein Ergebnis nicht, und ein Dritter bekommt eine einzelne, von ihm nicht angeforderte Mail — keinen Verteilereintrag.

Diese Zuordnung steht an **genau einer Stelle** im System und wird von der Datenbank hart erzwungen: Eine bestätigungspflichtige Einwilligung kann den Zustand „bestätigt" **niemals ohne Bestätigungszeitstempel** erreichen — auch nicht über die Serverseite, auch nicht durch einen Administrator und auch nicht durch einen künftigen Programmierfehler.

**Der Bestätigungslink.** Beim Erfassen entsteht ein Zufallswert von 32 Byte. In der Datenbank steht **ausschließlich sein Hashwert**; der Klartext existiert nur in der E-Mail an die betroffene Person. Ein Datenbankleck enthält damit keine einlösbaren Bestätigungslinks. Der Link ist **7 Tage gültig**.

Solange eine Bestätigung offen und nicht abgelaufen ist, erzeugt ein erneutes Absenden desselben Formulars **keine zweite** Bestätigungsmail. Das ist kein Komfort: Ohne diese Sperre könnte jemand eine fremde Adresse eintippen und durch wiederholtes Absenden beliebig viele Mails dorthin auslösen — das Formular wäre ein Mail-Verstärker.

**Weder Bestätigung noch Abmeldung wirken durch bloßes Öffnen eines Links.** Beide verlangen eine ausdrückliche Handlung auf der geöffneten Seite. Grund: **Mailscanner in Unternehmen rufen Links in eingehenden Mails vorab automatisch ab.** Eine Einwilligung, die dadurch entstünde, hätte niemand erteilt — sie wäre wertlos und würde im Ernstfall den gesamten Nachweis in Zweifel ziehen. Umgekehrt wäre eine so ausgelöste Abmeldung eine Abmeldung, die niemand veranlasst hat. Der Aufruf der Bestätigungsseite ist deshalb nachweislich **rein lesend**: Er zeigt nur an, worum es geht, und verändert am Datenbestand nichts. Ein Integrationstest hält genau das fest (vollständiger Vergleich des Datensatzes vor und nach zwei Aufrufen).

*Einzige Ausnahme, bewusst:* der technische Ein-Klick-Abmeldeweg nach **RFC 8058**, den Gmail und Yahoo für Massenversender verlangen. Er läuft ebenfalls nicht über einen einfachen Seitenaufruf, sondern über eine schreibende Anfrage des Mailprogramms — dort ist der Absender das Mailprogramm der Person selbst, nicht ein Scanner.

**Was je Einwilligung erfasst wird:**
- **Zeitpunkt der Erteilung** und, getrennt davon, **Zeitpunkt der Bestätigung** sowie **Zeitpunkt eines Widerrufs**.
- Die **Textfassung** (Fassungsnummer und Sprachfassung), auf die die Einwilligung zeigt — samt vollem Wortlaut abrufbar.
- Der **Einstiegspunkt**, über den genau diese Einwilligung entstanden ist. Er kann von der Ersterfassung des Bestandseintrags abweichen: erfasst über den Schnellrechner, Jahre später Werbeeinwilligung über einen Fachvortrag.
- Die **technische Herkunft**: IP-Adresse und Browser-Kennung zum Zeitpunkt der Erteilung.

**Zur technischen Herkunft, weil das Projekt sonst kein IP-Tracking betreibt:** Diese beiden Angaben dienen **ausschließlich** dem Einwilligungsnachweis. Es gibt darüber keine Auswertung, keine Zusammenführung und keinen Suchindex. Verboten ist im Projekt die Verhaltensprofilbildung — nicht der Nachweis, dass und wann jemand zugestimmt hat. Bei einer Anonymisierung werden beide Angaben entfernt (§15.6), während der Nachweis selbst bestehen bleibt.

**Der angezeigte und der archivierte Wortlaut sind dieselbe Quelle.** Das Formular liest den Text aus der Datenbank und zeigt ihn an; dieselbe Auswahlregel bestimmt anschließend, welche Fassung archiviert wird. Eine zweite Kopie des Textes in den Oberflächen-Übersetzungen wäre exakt der Zustand, gegen den die Unveränderlichkeit gebaut ist: Der Nachweis behauptete dann einen Wortlaut, den die Person so nicht gesehen haben muss.

### 15.4 Die drei Einwilligungstexte im Wortlaut

> **⚠ ARBEITSSTAND — juristisch ungeprüft.** Diese drei Texte sind der aktuell im System hinterlegte Stand (jeweils **Fassung 1, deutsch**). Die rechtliche Prüfung steht aus (Owner: Martin, siehe §15.9). Eine geprüfte Fassung wird als **Fassung 2** neu angelegt; **die bestehende Fassung 1 wird niemals bearbeitet** — bereits erteilte Einwilligungen müssen weiter auf den Text zeigen, der ihnen tatsächlich angezeigt wurde. Anzeige und Archivierung ziehen automatisch auf die jeweils jüngste Fassung nach.

**Informationen & Angebote — Fassung 1:**

> Ich möchte von der COOLiN ENERGY GmbH Informationen und Angebote rund um Netzentgelte, Lastspitzen und Energiekosten per E-Mail erhalten. Diese Einwilligung kann ich jederzeit über den Abmeldelink in jeder E-Mail oder per Nachricht an energy@coolin.at widerrufen.

**Vertragsablauf-Erinnerung — Fassung 1:**

> Ich möchte per E-Mail an das Ende meiner Strom-Vertragslaufzeit erinnert werden. Dafür speichert die COOLiN ENERGY GmbH meinen Versorger und mein Vertragsende. Diese Einwilligung kann ich jederzeit widerrufen.

**Ergebnis-Zusendung — Fassung 1:**

> Ich möchte mein Rechenergebnis per E-Mail zugeschickt bekommen. Die E-Mail-Adresse wird ausschließlich für diese Zusendung verwendet.

### 15.5 Abmeldung und Sperre — zwei Ebenen

Jede Aussendung stellt künftig **zwei** Fragen, nicht eine. Beide müssen mit „ja" beantwortet sein.

**Ebene 1 — Widerruf eines einzelnen Zwecks.** Der Abmeldelink in jeder E-Mail bezieht sich auf **den Zweck, aus dem diese E-Mail stammt**. Wer den Newsletter nicht mehr will, will nicht zwangsläufig auch auf die Erinnerung an sein Vertragsende verzichten. Ein Widerruf trifft **alle offenen und bestätigten Einträge dieses Zwecks**, nicht nur den jüngsten — eine übersehene ältere Bestätigung würde sonst weiterhin zum Versand berechtigen.

**Ebene 2 — dauerhafte Sperre der Adresse.** Deutlich abgesetzt daneben steht „keine E-Mails mehr". Das widerruft **alle** Zwecke und trägt die Adresse zusätzlich in die Sperrliste ein. Sie erfasst außerdem dauerhafte Unzustellbarkeit, Spam-Beschwerden und händische Sperren.

**Die Sperrliste enthält nur Hashwerte, hat keine Verbindung zum Bestandseintrag und überlebt dessen Löschung — beides mit Absicht:**

- **Sie überlebt die Löschung**, weil eine Abmeldung, die mit dem Datensatz verschwindet, keine Abmeldung ist. Ohne diese Trennung stünde die Person nach der Löschung ihres Eintrags und dem nächsten Import wieder im Verteiler — und bekäme genau die E-Mail, die sie abbestellt hat. Ein technischer Verweis auf den Bestandseintrag würde den Sperreintrag mitreißen und damit die Zusage brechen.
- **Sie enthält keinen Klartext**, weil eine Liste von Menschen, die „schreiben Sie mir nicht mehr" gesagt haben, sonst die wertvollste und gefährlichste Adressliste im ganzen System wäre. Gespeichert wird nur ein Prüfwert der Adresse. Damit lässt sich fragen „ist **diese** Adresse gesperrt?" — der Fragende hat sie ohnehin, er will ihr schreiben —, aber die Liste selbst gibt keine einzige Adresse her.

Der bekannte Preis dieser Konstruktion ist benannt und angenommen: Wer eine Adresse **rät**, kann sie verifizieren. Das schützt nicht gegen gezielte Nachfrage, verhindert aber, dass die Sperrliste als Verteilerliste taugt — und genau das ist ihr Zweck. Aus demselben Grund ist auch die Einzelabfrage ausschließlich Administratoren zugänglich.

**Für Menschen gibt es deshalb keine Sperrlisten-Ansicht, sondern nur zwei Aussagen:** wie viele Sperren es gibt, und ob eine konkrete Adresse dabei ist. Das ist eine Folge des Entwurfs, kein Mangel der Oberfläche.

**Der Abmeldelink funktioniert dauerhaft**, auch in einer zwei Jahre alten E-Mail. Er trägt seine Gültigkeit als Signatur in sich und braucht keinen zugehörigen Datenbankeintrag — ein solcher würde mit der Löschung des Bestandseintrags verschwinden und den Link entwerten. Ein manipulierter oder erfundener Link führt zu einer **neutralen Seite**: Sie zeigt nirgends eine Adresse an und verrät nicht, ob es den Eintrag gibt.

### 15.6 Aufbewahrung, Löschung, Anonymisierung

**Zwei Fristen, an genau einer Stelle im System hinterlegt:**

| Rechtsgrundlage | Frist | Ab wann |
|---|---|---|
| werblich (Marketing-Lead) | **24 Monate** | ab der **letzten Interaktion**, nicht ab Ersterfassung |
| kaufmännisch (Kunde) | **7 Jahre** (84 Monate) | ab der letzten Interaktion |

**Die Löschfrist wird niemals von Hand gesetzt, sondern immer abgeleitet.** Sie ergibt sich bei jedem Schreibvorgang neu aus letzter Interaktion und Rechtsgrundlage; ein vom Anwendungscode mitgegebener Wert wird kommentarlos überschrieben. Begründung: Eine Frist, die der Anwendungscode setzen kann, ist keine Frist — ein vergessenes Nachziehen wäre unsichtbar und fiele erst beim Löschen auf, dann aber in die falsche Richtung. Jede neue oder geänderte Einwilligung — **auch ein Widerruf** — gilt als Interaktion und schiebt die Frist entsprechend nach; auch ein Widerruf ist ein Vorgang, dessen Nachweis aufzubewahren ist.

**Der Wechsel auf „Kunde" schaltet die Frist automatisch um und ist nicht rückwärts begehbar.** Sobald der Status auf „Kunde" gesetzt wird, wechselt die Rechtsgrundlage auf kaufmännisch und die Frist auf 7 Jahre — ohne Zutun der Oberfläche. Der umgekehrte Weg wird von der Datenbank **abgelehnt**, auch dann, wenn der Status später wieder zurückgesetzt wird: **Eine einmal entstandene kaufmännische Aufbewahrungspflicht endet nicht dadurch, dass ein Kunde abspringt.** Wer Kunde war, hat Belege erzeugt, die aufzubewahren sind; eine Rückstufung würde diese Unterlagen vorzeitig zur Löschung freigeben. Die Verlängerung ist möglich, die Verkürzung nicht.

**Was die Anonymisierung entfernt:**
- die E-Mail-Adresse — ersetzt durch einen garantiert unzustellbaren, je Eintrag eindeutigen Platzhalter,
- Firma, Ansprechperson und Telefonnummer,
- IP-Adresse und Browser-Kennung **aller** zugehörigen Einwilligungen.

**Was bewusst bestehen bleibt:**
- **die Einwilligungen selbst** — Zweck, Textfassung samt Wortlaut, Zeitpunkt der Erteilung, der Bestätigung und eines Widerrufs. Nach dem Entfernen der Identitätsmerkmale ist das **kein Personenbezug mehr**, aber weiterhin der Beleg, dass ordnungsgemäß gearbeitet wurde: wie viele Einwilligungen erteilt, wie viele bestätigt, zu welchem Wortlaut. Ein Bestand ohne diese Spur könnte im Streitfall nichts zeigen.
- **der Sperrlisten-Eintrag**, unangetastet (§15.5).
- Einstiegspunkt und Anlagedatum — Herkunfts- und Mengenstatistik ohne Personenbezug.

**Anonymisierung ist endgültig, auch für privilegierte Zugriffe.** Nach dem Vorgang lehnt die Datenbank jede Änderung an Adresse, Firma, Name, Telefon, Status, Aufbewahrungsgrundlage und am Anonymisierungszeitpunkt ab — für den Administrator, für die Serverseite **und für die höchstprivilegierte Datenbankrolle**. Das ist keine Zusage der Oberfläche, sondern eine Eigenschaft des Datenbestands; Integrationstests prüfen es unter genau diesen Rollen. Festgehalten werden zusätzlich **Zeitpunkt und handelnde Person**.

Ein erneuter Aufruf auf einen bereits anonymisierten Eintrag meldet Erfolg **ohne zweite Wirkung**; der ursprüngliche Zeitpunkt bleibt stehen. Ein nachgeschriebenes Datum wäre eine Fälschung.

**Durchsetzung automatisch, seit B4-1 (22.07.2026).** Ein täglicher Lauf ermittelt die fälligen Einträge und anonymisiert sie ohne menschliches Zutun; er ist in **Kapitel 17** beschrieben, samt der Mengenbegrenzung, die einen fehlerhaft ausgelösten Massenlauf vollständig verweigert statt ihn portionsweise auszuführen. Der frühere Zustand — sichtbarer Filter im Admin-Bereich, Anonymisierung von Hand — bleibt als Weg bestehen; er ist nur nicht mehr der einzige. **Die erste reale Fälligkeit tritt frühestens 2028 ein** (24 Monate ab letzter Interaktion, der Bestand beginnt 2026); bis dahin läuft der Vorgang planmäßig mit null Fällen, und genau deshalb wird jeder Lauf protokolliert (Kapitel 17).

**Was als „letzte Interaktion" gilt.** Ausschließlich tatsächliche Handlungen der betroffenen Person: ein abgesendetes Formular, eine bestätigte Einwilligung, ein Widerruf. **Nicht** das Öffnen einer E-Mail und **nicht** der Klick auf einen Link darin — beides wird nicht erhoben und dauerhaft nicht erhoben (Kapitel 19). Eine Frist, die sich durch Beobachtung des Leseverhaltens verlängerte, wäre eine Verarbeitung, die es hier bewusst nicht gibt.

### 15.7 Was der Admin kann — und was bewusst nicht

**Kann:** den Bestand einsehen und filtern (Status, Herkunft, Einwilligungszustand je Zweck, Freitextsuche, fällige Löschfristen) · zu jeder Einwilligung Zweck, Zustand, Zeitpunkte, Fassung **und vollständigen Wortlaut** einsehen · eine einzelne Einwilligung **widerrufen** · eine Adresse **dauerhaft sperren** · einen Eintrag **anonymisieren** · den Lebenszyklus-Status pflegen · abfragen, ob eine Adresse gesperrt ist.

**Kann bewusst nicht: eine Einwilligung anlegen oder bestätigen.** Es gibt dafür keine Schaltfläche und keine Schnittstelle dahinter — die Möglichkeit existiert im System schlicht nicht.

**Begründung, weil sie der Kern des ganzen Entwurfs ist:** Eine Oberfläche, in der sich „bestätigt" setzen lässt, entwertet den Nachweis **rückwirkend für alle Einwilligungen — auch für die echten**. Sobald **eine einzige** Bestätigung per Knopfdruck entstehen konnte, ist von außen keine Bestätigung mehr von einer gesetzten unterscheidbar. Der Bestand könnte dann nicht mehr belegen, dass irgendeine der darin geführten Einwilligungen tatsächlich von der betroffenen Person stammt. Diese Lücke in der Oberfläche ist das Merkmal, nicht der Mangel.

Der einzige Weg zu „bestätigt" bleibt deshalb der Klick der betroffenen Person auf den Link in ihrer eigenen Mailbox. Aus demselben Grund gibt es auch keine Möglichkeit, einen Bestandseintrag **von Hand anzulegen**: Ein so entstandener Eintrag hätte weder Herkunft noch Nachweis.

Der Admin-Bereich ist angemeldeten Administratoren vorbehalten. Die Berechtigung wird bei **jedem** Zugriff serverseitig geprüft, und zwar nicht nur von der Oberfläche, sondern zusätzlich von jeder einzelnen Datenbankoperation dahinter — ein Fehler in der Oberfläche kann niemandem Zugriff verschaffen. Eine fehlende Berechtigung führt zu einem **Fehler**, nicht zu einer leeren Liste: „kein Zugriff" darf sich nie als „keine Daten vorhanden" lesen lassen.

**`[teilweise überholt seit B2-1, 23.07.2026]`** In B1 gab es weder Export noch Korrekturweg. **Beides existiert inzwischen** und ist in **Kapitel 18** beschrieben — mitsamt den Grenzen, die dabei gelten (neun korrigierbare Felder, die E-Mail-Adresse ausdrücklich nicht darunter; der Export schließt gesperrte und anonymisierte Zeilen strukturell aus und wird protokolliert). Weiterhin gibt es **keine Sammelaktionen und keinen Versand aus dem Admin-Bereich** — das ist B2-3.

### 15.8 Erfassungsstellen

**`[überholt seit B3, 22.07.2026 — vollständig in Kapitel 16]`** Zum Zeitpunkt von B1 war das Kontaktformular auf `/kontakt` der einzige Einstiegspunkt. **Das gilt nicht mehr:** mit B3 sind mehrere kontextspezifische Erfassungsstellen platziert (Wissensartikel, Branchenseite, unter dem Rechnerergebnis, Warteliste-Landingpage samt gedrucktem QR-Zugang, Vertragsablauf-Landingpage). Die möglichen Einstiegspunkte sind im System als pflegbare Liste geführt, nicht als fester Programmcode — ein neuer Einstiegspunkt erzwingt keine Änderung am Datenmodell. Die folgenden Absätze beschreiben weiterhin das Kontaktformular, weil es der Einstiegspunkt mit den meisten Sonderregeln ist.

**Der Kontaktname wird als Vorname und Nachname getrennt erhoben** (seit 24.07.2026); im Kontaktformular sind beide Pflichtfelder. Grund und Ausnahmen: Kapitel 16.

**Der Formulareingang selbst erzeugt keine Einwilligung.** Jede Absendung legt einen Bestandseintrag an bzw. aktualisiert einen bestehenden; **Rechtsgrundlage dafür ist die Vertragsanbahnung**, nicht eine Einwilligung. Wer eine Anfrage stellt, erwartet eine Antwort darauf — und nur darauf.

**Eine Werbeeinwilligung entsteht ausschließlich über die zusätzliche, nicht vorausgewählte Ankreuzmöglichkeit.** Sie ist im Formular optisch und inhaltlich vom Anliegen getrennt, trägt den vollen Wortlaut aus der Datenbank und ist im Auslieferungszustand **leer**. Nur wenn sie aktiv gesetzt wird, entsteht eine unbestätigte Einwilligung und geht eine Bestätigungsmail hinaus.

**Der Nachrichtentext wird nicht gespeichert.** Er geht ausschließlich per E-Mail an COOLiN; der Bestand führt nur die Identitätsmerkmale, und es gibt dafür auch kein Feld. Der Schreibvorgang läuft zudem **nach** dem erfolgreichen Versand der Anfrage und kann ihn nie verhindern: Eine verlorene Kundenanfrage wiegt schwerer als ein verlorener Bestandseintrag.

**Die Rückmeldung an die absendende Person ist in allen Fällen identisch.** Sie verrät nicht, ob die Adresse bereits bekannt ist, ob sie gesperrt ist oder ob bereits eine Bestätigung offen steht. Eine gesperrte Adresse führt zur gleichen Bestätigungsseite wie jede andere — es entsteht nur keine Einwilligung und keine Mail. Eine Sperre bedeutet „schreiben Sie mir keine Werbung", nicht „ich existiere nicht"; die Anfrage selbst ist davon nicht betroffen.

### 15.9 Offene rechtliche Punkte

| # | Punkt | Owner | Status |
|---|---|---|---|
| 1 | **Wortlaut der drei Einwilligungstexte** (§15.4) juristisch prüfen. Vor breiter Aussendung erforderlich. Die geprüfte Fassung kommt als Fassung 2 neu hinzu; Fassung 1 bleibt unverändert bestehen. | Martin / rechtlich | **offen** |
| 2 | **Datenschutzerklärung erweitern** um: Verarbeitung von Lead- und Einwilligungsdaten, die beiden Aufbewahrungsfristen (24 Monate / 7 Jahre) und ihre Auslöser, die Anonymisierung als Löschverfahren, die Sperrliste als eigene Verarbeitung mit eigener Begründung sowie die Speicherung von IP und Browser-Kennung als Einwilligungsnachweis. Ergänzt §9.2 / OP#3 um die jetzt real gebauten Verarbeitungen. | Martin / rechtlich | **offen** |
| 3 | **Branchen-Benchmark aus Rechnungsdaten ist ein EIGENER Zweck** und durch keine der drei Einwilligungen aus §15.3 abgedeckt. Er ist hier ausdrücklich **nicht** geregelt und muss ab der ersten verarbeiteten Rechnung eigenständig in AGB bzw. Auftragsverarbeitungsvereinbarung abgebildet werden (siehe `Fahrplan_2026.md`, offene Entscheidung 6). | Martin / rechtlich | **offen, außerhalb B1** |

---

## 16. Erfassungsstellen und Segmentierung (Bauabschnitte B3-1, B3-2, B3-4)

> **Nachgezogen am 24.07.2026.** Beschreibt, **was gebaut wurde**. Wie Kapitel 15 ohne Schema-Details geschrieben, damit sich der Erfassungsweg ohne Repo-Zugang beurteilen lässt.

### 16.1 Ein Backend, viele Einstiegspunkte

Es gibt **nicht** ein überall gleiches Formular. Es gibt **einen** Erfassungsweg und viele kontextspezifische Einstiegspunkte, die sich in dem unterscheiden, was sie erheben und was sie versprechen: unter einem Rechenergebnis genügt die E-Mail-Adresse, auf der Warteliste-Seite ist zusätzlich die Branche nötig, auf der Vertragsablauf-Seite Versorger und Vertragsende.

**Der Zweck einer Einwilligung kommt ausschließlich aus einer getypten Liste im System („Registry"), nie von der absendenden Seite.** Das ist die zentrale Schutzregel dieses Abschnitts: Die abgesendeten Daten enthalten **gar keine Angabe des Zwecks**. Er wird allein aus dem Einstiegspunkt abgeleitet. Andernfalls könnte ein manipulierter Aufruf eine Werbeeinwilligung von einem Einstiegspunkt erzeugen, der den Werbetext nie angezeigt hat — und ein solcher Nachweis wäre nicht nur selbst wertlos, sondern zöge rückwirkend alle echten in Zweifel. Aus demselben Grund wirkt ein angekreuztes Werbe-Häkchen **nur dort, wo der Einstiegspunkt es überhaupt anbietet**; sonst wird es verworfen.

Dieselbe Liste bestimmt zugleich, welche Felder das Formular anzeigt und welche Felder die Serverseite annimmt. Zwei getrennte Definitionen liefen auseinander — das Formular zeigte ein Feld, das der Server verwirft, oder umgekehrt.

**Die Rückmeldung an die absendende Person ist in allen Fällen identisch** — gesperrte Adresse, bereits laufende Bestätigung, technischer Ausfall, glatter Erfolg. Unterschieden wird ausschließlich, was die Person selbst sieht und ändern kann: ihre eigenen Feldeingaben. Sonst wäre jedes eingebettete Formular ein Auskunftsdienst über fremde Kontakte.

### 16.2 Welche Einstiegspunkte platziert sind — und welche bewusst nicht

**Platziert und öffentlich erreichbar:**

| Einstiegspunkt | Ort | Zweck der Einwilligung |
|---|---|---|
| Kontaktformular | `/kontakt` | Anfrage (keine Einwilligung) + optional Werbung |
| Artikel-Einbettung | Flaggschiff-Artikel im Wissen-Bereich | Werbung |
| Branchenseite | `/branchen/handwerk` | Werbung |
| Unter dem Rechnerergebnis | `/peak-shaving` | einmalige Ergebniszusendung, optional zusätzlich Werbung |
| Warteliste | `/warteliste` | Werbung (Herkunft „Warteliste") |
| Warteliste, gedruckter Zugang | `/warteliste/wko` | Werbung (Herkunft „Postaktion") |
| Vertragsablauf-Landingpage | `/vertragsende-erinnerung` | Vertragsablauf-Erinnerung, optional zusätzlich Werbung |

**Bewusst nicht platziert — der Betroffenheits-Check.** Die Erfassungsstelle für den Betroffenheits-Check ist gebaut, aber **nicht in Betrieb**, weil die fachliche Grundlage fehlt: Die Branchenkennzahlen (Vollbenutzungsstunden je Branche), aus denen sich die Betroffenheit ab 2027 ableiten ließe, liegen nicht vor. **Ein Formular, das Branche, Postleitzahl und Verbrauch erhebt, aber keine belastbare Auskunft zurückgeben kann, sammelt personenbezogene Daten für eine Leistung, die es nicht gibt.** Die Platzierung ist deshalb an die Kennzahlen gebunden, nicht an einen Termin.

**Inzwischen platziert — die Vertragsablauf-Landingpage.** Sie war aus demselben Grundsatz zunächst zurückgehalten: Ein Vertragsende zu erfassen und die zugesagte Erinnerung nicht senden zu können, wäre ein gebrochenes Versprechen an eine reale Person gewesen. Mit dem Versandvorgang aus B4-2 (Kapitel 17) ist der Grund weggefallen, und die Seite ist seither in Betrieb.

### 16.3 Die Warteliste und der gedruckte Zugang — zwei Wege, zwei Herkünfte

Die Warteliste zum Leistungstarif 2027 ist über zwei Adressen erreichbar: die **organische** Seite (`/warteliste`, in der Navigation und in der Sitemap) und den **gedruckten** Zugang (`/warteliste/wko`, Ziel des QR-Codes einer Postaussendung, nicht indexierbar und nirgends intern verlinkt). Beide zeigen dasselbe Formular und erheben dieselben Felder; sie unterscheiden sich in der Ansprache und darin, **unter welcher Herkunft die Eintragung im Bestand landet**. Zwei nahezu gleiche indexierbare Seiten wären in der Suchmaschine ein Duplikat.

**Es entsteht dabei keine neue Einwilligungsart.** Die Warteliste ist fachlich dieselbe Werbeeinwilligung wie überall sonst — gleiche Bestätigungspflicht, gleiche Sperrprüfung, gleicher Widerrufsweg. Unterschieden wird allein die Herkunft. Eine eigene Art zerlegte den Bestand in getrennte Listen, deren Vereinigung jede spätere Aussendung selbst wieder herstellen müsste.

**Ein unbekanntes Wegsegment liefert 404 — es gibt bewusst keinen Rückfall auf eine Ersatzherkunft.** Zulässig ist genau ein Segment; alles andere ist ein Fehler. Der Grund ist nicht Strenge, sondern Sichtbarkeit: Ein Rückfallwert stempelte eine **falsche Herkunft** auf eine echte Einwilligung. Die Herkunft ist Pflichtangabe, nach dem Anlegen unveränderlich und die Grundlage jeder späteren Segmentierung. Ein Tippfehler in der **gedruckten** Adresse fiele damit nie auf: Die Seite funktionierte, die Eintragungen kämen an, und die Auswertung des Rücklaufs wäre still falsch. **Eine tote Adresse ist ein sichtbarer Fehler, eine falsch zugeordnete Einwilligung ein unsichtbarer.**

Weil die Adresse auf Papier steht, ist sie eine **dauerhafte Zusage**: Sie wird nicht umbenannt, nicht entfernt und nicht auf eine andere Herkunft umgehängt. Wird der Inhalt der Seite ersetzt, bleibt der Weg bestehen.

**Auf der Warteliste ist die Branche ein Pflichtfeld** — eine bewusste Abweichung vom sonstigen Grundsatz, so wenig wie möglich zu verlangen. Die Liste hat einen benannten Zweck: die Wartenden zum Erscheinen der Tarifverordnung mit bereits bekannter Betriebsgröße anzusprechen. Ohne Branche wäre das eine Rundmail. Der Preis ist am Aufwand bemessen: Die Branche ist ein Auswahlfeld, der Jahresverbrauch verlangt, eine Rechnung herauszusuchen — er bleibt optional, ebenso die Postleitzahl.

**Die Seite nennt keine einzige Zahl.** Kein Betrag, kein Prozentsatz, keine Ersparnisangabe. Sie sagt, was sich zum 1.1.2027 ändert, dass die Beträge noch nicht feststehen, weil die Tarifverordnung nicht veröffentlicht ist, was die Eintragung bewirkt — und ausdrücklich, was sie **nicht** bedeutet (keine Kosten, keine Verpflichtung, Abmeldung in jeder Nachricht, Wirkung erst nach Bestätigung).

### 16.4 Die erhobenen Segmentierungsmerkmale

Sechs Merkmale, alle optional, alle getypt und einzeln geprüft (kein Freitext-Sammelbecken): **Branche** (feste Auswahl), **Postleitzahl** (genau vier Ziffern), **Jahresverbrauch** (größer null), **Messart** (leistungsgemessen · Netzebene 7 · geprüft, aber nicht bestimmbar), **Versorger**, **Vertragsende**.

Die Messart wird abgeleitet **und gespeichert**, nicht bei jedem Lesen neu berechnet: Sie ist die zentrale Zielgruppentrennung des Marktstarts 2027, und eine Ableitung zur Lesezeit änderte die Zuordnung eines Bestandseintrags rückwirkend, sobald die Regel justiert wird — der Bestand bewegte sich unter einer laufenden Aussendung weg. „Geprüft, aber nicht bestimmbar" ist ein **echtes Ergebnis** und deshalb ein eigener Wert; „nie geprüft" ist etwas anderes, und die Oberfläche hält beides auseinander.

**Versorger und Vertragsende unterliegen einer durchgesetzten Zweckbindung.** Sie werden ausschließlich für die Vertragsablauf-Erinnerung erhoben — der Einwilligungstext sagt das wörtlich. Wird diese Einwilligung **widerrufen**, entfernt die Datenbank beide Angaben von selbst, samt bereits vorgemerkter Erinnerungen. Fällt der Zweck weg, fällt die Grundlage für die Daten weg, nicht nur die Erlaubnis, sie zu benutzen. Ein **abgelaufener** Bestätigungslink löst das ausdrücklich **nicht** aus: Er ist ein technischer Zustand, kein Widerruf — die Person hat nichts zurückgenommen und kann die Bestätigung erneut anfordern; dann wären die Angaben weg, die sie gerade gemacht hat.

**Was die Anonymisierung von diesen Merkmalen entfernt — und was nicht.** Entfernt werden **Postleitzahl, Versorger und Vertragsende**. Erhalten bleiben **Branche, Verbrauchsgröße und Messart**.

Die Trennlinie verläuft entlang **„lokalisierend" gegen „grob einordnend"**, nicht entlang „geschäftlich nützlich". Postleitzahl, Branche und Versorger zusammen erkennen einen konkreten Betrieb wieder — in einem Vierziffern-Gebiet gibt es selten zwei Kühlhäuser mit 180 MWh Jahresverbrauch. Branche, Verbrauchsgröße und Messart allein tun das nicht; sie bleiben als statistische Merkmale ohne Personenbezug nutzbar, so wie Herkunft und Anlagedatum (§15.6).

### 16.5 Die Zusammenführungsregel bei wiederholter Erfassung

Dieselbe Person wird über mehrere Einstiegspunkte erfasst, und die erheben unterschiedliche Felder. Es gibt deshalb **zwei** Vorrangregeln, und der Unterschied ist beabsichtigt:

| Feldart | Regel | Beispiel |
|---|---|---|
| **Identitätsmerkmale** (Vorname, Nachname, Firma, Telefon) | der **zuerst** erfasste Wert bleibt stehen | eine zweite, flüchtigere Eingabe überschreibt den sorgfältig eingetragenen Firmennamen nicht |
| **Segmentierungsmerkmale** (Branche, PLZ, Verbrauch, Messart, Versorger, Vertragsende) | der **zuletzt** erfasste Wert gewinnt | ein neues Vertragsende ersetzt das alte |

**Beide Regeln schützen gegen dasselbe: den stillen Verlust einer Angabe durch eine knappere zweite Absendung.** Eine leer gelassene Angabe bedeutet in beiden Fällen „keine Angabe" und löscht **nichts**. Sie unterscheiden sich allein darin, welcher Wert überlebt, wenn **zwei** Angaben vorliegen. Bei Identität ist die frühere die verlässlichere (ein Name, eine Firmierung ändert sich selten, und beim zweiten Mal wird weniger sorgfältig getippt); bei Segmentierung ist die jüngere die richtige — sie ist genau das, was sich ändert, und eine Erinnerung an ein längst ersetztes Vertragsende wäre wertlos.

Ohne diese Regeln löschte jede zweite Erfassung still, was die erste erbracht hat: kein Fehler, keine Meldung, sichtbar erst beim ersten Segmentierungslauf an einer unerklärlich kleinen Menge.

**Im Korrekturformular des Admin-Bereichs gilt die umgekehrte Lesart** — dort heißt ein geleertes Feld „das war falsch, soll weg" (Kapitel 18). Der Unterschied ist gewollt: Ein Erfassungsformular schickt, was es erhebt; ein Bearbeitungsformular schickt immer alle Felder.

### 16.6 Vorname und Nachname statt eines Namensfeldes

Der Kontaktname wird seit 24.07.2026 **an der Quelle getrennt** erhoben, nicht später zerlegt. Jede nachträgliche Zerlegung eines Freitextnamens ist eine Heuristik und scheitert genau dort, wo es auffällt: bei Doppelnamen, Namenszusätzen, Titeln, umgekehrter Schreibweise. Ein falsch geratener Nachname landet anschließend in der **Anrede** einer echten E-Mail — der eine Ort, an dem der Fehler garantiert bemerkt wird, und zwar von der betroffenen Person.

**Im Kontaktformular sind beide Felder Pflicht**, als einzigem Einstiegspunkt: Auf eine Kontaktanfrage folgt eine Antwort per E-Mail, und die beginnt mit einer Anrede. Überall sonst bleiben beide optional — der Bestand enthält Einträge aus Einstiegspunkten, die gar keinen Namen erheben, und ein Pflichtfeld machte dort jede andere Korrektur unmöglich.

Die beiden Werte reisen **getrennt** bis in den Bestand und werden auch getrennt zusammengeführt; zusammengesetzt werden sie erst dort, wo ein Mensch sie liest (Anrede, Betreffzeile). In der Ausfuhr stehen sie als **zwei** Spalten — sie beim Ausführen wieder zu verkleben, gäbe den Zweck genau dort auf, wo er am ehesten gebraucht wird.

---

## 17. Zeitgesteuerte Vorgänge (Bauabschnitte B4-1, B4-2)

> **Nachgezogen am 24.07.2026.** Das System führt seit 22.07.2026 zwei täglich laufende Vorgänge aus. Einer davon versendet E-Mails an reale Personen.

### 17.1 Die beiden Läufe

| Lauf | Zeit (täglich) | Was er tut | Versendet E-Mail? |
|---|---|---|---|
| **Fristendurchsetzung** | 03:15 UTC | ermittelt Bestandseinträge, deren Aufbewahrungsfrist abgelaufen ist, und anonymisiert sie (§15.6) | **nein** |
| **Vertragsablauf-Erinnerung** | 06:40 UTC | schreibt Personen an, deren Stromvertrag in acht Wochen oder weniger endet | **ja** |

Der Fristenlauf war bewusst der erste: Eine Aufgabe, die nachweislich keinen realen Menschen erreichen kann, und die bis 2028 planmäßig null Fälle findet. Er beweist die Kette von der Zeitsteuerung bis in die Datenbank, ohne etwas zu verändern.

Die Erinnerung läuft morgens statt nachts, weil eine Erinnerung mit Zeitstempel 04:15 maschinell wirkt und eher ungelesen weggeklickt wird. Der Fristenlauf hat kein Zustellinteresse und bleibt, wo er ist.

### 17.2 Jeder Lauf wird protokolliert — auch der leere und der verweigerte

**Der wahrscheinlichste Fehler eines zeitgesteuerten Vorgangs ist nicht, dass er scheitert, sondern dass er gar nicht läuft.** Und ein ausgebliebener Lauf ist von „es war nichts zu tun" nicht unterscheidbar — beim Fristenlauf ist „nichts zu tun" bis 2028 sogar der planmäßige Zustand. Ein Vorgang, der nur im Fehlerfall etwas hinterlässt, meldet sich in genau dem Fall nie, der zählt.

Deshalb entsteht der Protokolleintrag **beim Start**, nicht am Ende, und wird danach genau einmal vervollständigt. Ein abgestürzter Lauf hinterlässt einen erkennbar unvollständigen Eintrag; ein leerer Lauf hinterlässt einen vollständigen Eintrag mit der Zahl null; ein verweigerter Lauf hinterlässt einen Eintrag, der die Verweigerung im Klartext benennt.

Der Admin-Bereich zeigt **beide Läufe mit eigenem Stand** und hebt jeden hervor, der seit mehr als 48 Stunden nicht mehr erfolgreich war. Ein gemeinsamer „die Läufe laufen"-Indikator verschwiege den Fall, in dem der eine läuft und der andere nicht — und die Folgen sind verschieden: eine versäumte Rechtspflicht auf der einen Seite, ein gebrochenes Versprechen an eine reale Person auf der anderen.

**Es gibt bewusst keinen Knopf, mit dem sich ein Lauf von Hand auslösen ließe.** Ein Mensch, der versehentlich einen unumkehrbaren Massenvorgang startet, ist ein Risiko ohne Gegenwert.

### 17.3 Mengenbegrenzung: Verweigerung statt Abschneiden

**Beide Läufe haben eine Obergrenze, und oberhalb davon passiert gar nichts — nicht die erste Teilmenge.** Das ist der jeweils wichtigste Sicherungsmechanismus, und die Begründung ist in beiden Fällen dieselbe Struktur: Die Wirkung ist nicht zurücknehmbar, also ist ein zu **später** Lauf reparabel und ein zu **großer** nicht.

- **Fristendurchsetzung.** Die Anonymisierung ist endgültig, auch für privilegierte Zugriffe (§15.6). Ein Fehler in der Fristableitung — ein falsch gesetzter Interaktionszeitpunkt, eine geänderte Fristenlänge, ein Import mit altem Datum — machte schlagartig den **gesamten** Bestand fällig. Ein ungebremster Lauf zerstörte ihn in einer einzigen Nacht. Eine Teilmenge zu anonymisieren wäre die schlechteste Möglichkeit: derselbe unumkehrbare Vorgang, nur portionsweise, und am nächsten Tag liefe es weiter.
- **Vertragsablauf-Erinnerung.** **Eine versendete E-Mail ist nicht zurückholbar.** Ein Fehler in der Datumslogik schriebe sonst den gesamten Bestand in einem Lauf an. Daran hinge nicht nur die Peinlichkeit des Einzelfalls, sondern die **Zustellreputation der Absenderdomain** — und an der wiederum die Aussendung, die zum Erscheinen der Tarifverordnung binnen 48 Stunden hinausgehen soll.

Die Schwellwerte sind fest hinterlegt und lassen sich **nicht von außen über den Aufruf beeinflussen**. Beim Fristenlauf liegt die gesamte Entscheidung in der Datenbank: Ein von außen erreichbarer Endpunkt, der die Größe eines unumkehrbaren Vorgangs bestimmen kann, wäre selbst das Risiko.

### 17.4 Die Vertragsablauf-Erinnerung im Einzelnen

**Vorlauf: acht Wochen.** Maßgeblich ist „acht Wochen oder weniger", nicht ein Stichtag. Wer ein Vertragsende einträgt, das nur noch drei Wochen entfernt ist, bekäme mit einer Stichtagsprüfung **nie** eine Erinnerung — der Tag, an dem es acht Wochen entfernt war, liegt in der Vergangenheit. So bekommt er sie sofort.

**Doppelversand-Sperre je Vertragsende.** Vermerkt wird die Kombination aus Person **und** Vertragsende, nicht die Person allein. Korrigiert jemand sein Vertragsende, ist eine erneute Erinnerung richtig und kein Duplikat; wäre die Person allein der Schlüssel, liefe jede Korrektur still ins Leere. Die Sperre ist eine Eigenschaft des Datenbestands und keine Prüfung im Programmablauf — eine solche hätte zwischen „nachsehen" und „eintragen" ein Zeitfenster, und genau darin entstünde der Doppelversand, den sie verhindern soll.

**Vermerkt wird vor dem Versand, das Ergebnis danach.** Bricht der Vorgang dazwischen ab, bleibt ein Vermerk ohne Zustellnachweis zurück: sichtbar, prüfbar, und **keine zweite Mail**. Die umgekehrte Reihenfolge erzeugte im selben Fall einen stillen, sich täglich wiederholenden Doppelversand. Solche Fälle werden **nicht automatisch wiederholt** — automatische Wiederholung von E-Mail-Versand erzeugt Schleifen; sie sind ein Befund für den Admin-Bereich (Schwelle 24 Stunden).

**Die beiden Versandvoraussetzungen stehen in der Auswahl, nicht im Programmablauf.** Angeschrieben wird nur, wer eine **bestätigte** Einwilligung zu diesem Zweck hat und **nicht gesperrt** ist. Eine Prüfung im Programmablauf kann übersprungen werden — beim Umbau, durch einen zweiten Aufrufer, durch ein vergessenes „wenn". Was die Auswahl nicht liefert, kann nicht angeschrieben werden.

**Die Mail enthält kein Angebot — auch dann nicht, wenn die Person zusätzlich eine Werbeeinwilligung erteilt hat.** Drei Gründe:

1. Die Einwilligung lautet auf eine **Erinnerung**, nicht auf Werbung. Genau dafür sind die Zwecke seit B1 getrennt (§15.2).
2. Hinge der **Inhalt** der Mail vom Vorliegen einer zweiten Einwilligung ab, hinge ihr rechtlicher Charakter an einem Zustand — und wäre im Nachhinein nicht mehr feststellbar. Man könnte einer versendeten Mail nicht mehr ansehen, ob sie eine Erinnerung oder eine Werbesendung war.
3. Die Zurückhaltung ist an dieser Stelle das eigentliche Vertrauensargument: Wer eine unaufgeforderte Verkaufsansprache erwartet und stattdessen nur die zugesagte Erinnerung bekommt, erlebt die Zusage als eingehalten.

Der einzige Link in der Mail führt auf den **kostenlosen, unabhängigen Tarifkalkulator der E-Control**. Die Mail trägt außerdem den technischen Ein-Klick-Abmeldeweg (§15.3) und einen Abmeldelink im Fuß. Die Bestätigungsmail bekommt beides ausdrücklich **nicht**: Abgemeldet werden kann nur, was besteht.

---

## 18. Bestandspflege und Ausfuhr (Bauabschnitt B2-1)

> **Nachgezogen am 24.07.2026.** Der erste Weg, auf dem personenbezogene Daten dieses Systems seinen Wirkungsbereich **dauerhaft** verlassen — und der erste, auf dem ein Mensch die Angaben einer anderen Person von Hand überschreibt. **Dieser Abschnitt versendet nichts.**

### 18.1 Was korrigierbar ist

Korrigierbar sind **neun** Angaben: Firma · Ansprechperson (seit 24.07.2026 als Vorname und Nachname, also zehn Parameter) · Telefon · Branche · Postleitzahl · Jahresverbrauch · Messart · Versorger · Vertragsende.

**Die E-Mail-Adresse ist ausdrücklich nicht darunter** — es gibt dafür nicht einmal eine Eingabemöglichkeit. Sie ist die Adresse, **von der** die Einwilligung erteilt und **an die** die Bestätigung gesendet wurde. Eine Änderung übertrüge eine bestätigte Einwilligung auf eine Adresse, die nie zugestimmt hat — also genau die Regel „der Admin kann widerrufen, nie erteilen" (§15.7) durch die Hintertür.

Der Verzicht kostet nichts: Eine falsch eingegebene Adresse bestätigt nie, die Einwilligung bleibt offen und fällt aus jeder Aussendung heraus. **Ein unerreichbarer Eintrag wird gekennzeichnet, nicht repariert.**

Ebenfalls nicht über das Korrekturformular änderbar: der **Lebenszyklus-Status** und die **Aufbewahrungsgrundlage** (dafür gibt es den eigenen, einbahnstraßenartigen Weg aus §15.6), die **Herkunft der Ersterfassung** (seit B1 unveränderlich) und die **Löschfrist** (immer abgeleitet, nie eingegeben).

**Ein geleertes Feld löscht die Angabe** — anders als beim Erfassungsweg, wo eine fehlende Angabe „weiß ich nicht" heißt (§16.5). Ein Bearbeitungsformular schickt immer alle Felder; ein bewusst geleertes ist eine Aussage. Mit der Erfassungslogik ließe sich kein einziges Feld je bereinigen — und genau das muss ein Korrekturweg können.

**Jede Korrektur wird der handelnden Person zugeschrieben**, und die Detailansicht zeigt sie. Steht dort niemand, sagt die Oberfläche „nicht von Hand bearbeitet" statt zu raten — der Wert ist zweideutig, weil ein gelöschtes Administratorkonto ihn ebenfalls leert.

**Die Zweckbindung wird auch hier durchgesetzt.** Versorger und Vertragsende lassen sich **nicht** von Hand eintragen, wenn zu diesem Zweck keine Einwilligung (offen oder bestätigt) besteht — der Vorgang wird abgelehnt, mit einem verständlichen deutschen Satz. Andernfalls ließe sich der automatische Widerrufs-Aufräumvorgang aus §16.4 unsichtbar umgehen: Die Angaben sähen anschließend aus wie erhoben. **Auf leer setzen ist immer erlaubt** — das ist die Richtung, die Daten entfernt.

Wird das Vertragsende geändert, weist die Oberfläche **vor dem Speichern** darauf hin, dass daraus eine neue Fälligkeit und damit eine weitere Erinnerung entsteht (§17.4) — beabsichtigt, aber nicht überraschend.

### 18.2 Die Ausfuhr

Die Ausfuhr erzeugt eine Tabellendatei aus dem gefilterten Bestand. Sie ist **filtergebunden**: Es gibt keine ungefilterte Ausfuhr, sondern nur den Filter „alles" — und der wird als solcher protokolliert.

**Gesperrte und anonymisierte Einträge fallen strukturell heraus, nicht über eine Einstellung.** Der Ausschluss liegt in der Abfrage selbst. Grund: Eine ausgeführte Datei kann in ein beliebiges fremdes Werkzeug eingespielt werden, das die Sperrliste nicht kennt — und sie mangels Klartext (§15.5) auch nicht nachträglich anwenden könnte. Eine Einstellung, die jemand versehentlich weglässt, wäre an dieser Stelle keine Sicherung.

Weil die Sicht mehr Treffer zeigt als die Datei Zeilen enthält, nennt die Oberfläche **beide Zahlen** und sagt, wie viele Treffer herausfallen. Eine Oberfläche, die die Trefferzahl als Zeilenzahl anbietet, verspricht eine Datei, die es so nicht gibt — und die Differenz fiele niemandem auf, weil beide Zahlen plausibel sind.

**Je Zeile steht der Einwilligungsstand** (bestätigt · offen · widerrufen · keine). Eine Adressdatei ohne diese Angabe wäre die gefährlichste Datei des Systems: Sie sähe aus wie eine Empfängerliste. Ein **abgelaufener** Bestätigungslink zählt dabei als „keine", nicht als „offen" — bestätigt werden kann er nicht mehr, und „offen" behauptete, da käme noch etwas.

**Jede Ausfuhr wird protokolliert**, im selben Vorgang, in dem die Zeilen entstehen: Zeitpunkt, handelndes Konto, Zeilenzahl und der **von der Datenbank tatsächlich angewandte** Filtertext. Ein getrennter Protokollschritt könnte ausbleiben, und dann gäbe es eine Kopie ohne Spur. Das Protokoll ist im Admin-Bereich einsehbar; Einträge lassen sich dort nicht entfernen, und es gibt dafür auch keinen Weg.

**Die Ausfuhr ist ausdrücklich nicht der Versandweg.** Sie erzeugt eine Datei für die Arbeit an den Daten — Auswertung, Vorbereitung, Abgleich. Der Kampagnenversand ist ein eigener Bauabschnitt (B2-3) mit eigenen Prüfungen vor jeder einzelnen Zustellung; eine ausgeführte Datei in ein fremdes Versandwerkzeug zu laden, würde genau diese Prüfungen umgehen, weil dort weder die Sperrliste noch der Einwilligungsstand fortgeschrieben wird.

---

## 19. Rückläufer und Beschwerden (Bauabschnitt B2-2)

> **Nachgezogen am 24.07.2026.** Der Zustellrand des Systems: Was der versendende Dienstleister über bereits verschickte E-Mails zurückmeldet, wirkt auf den Bestand. **Dieser Abschnitt versendet nichts.**

### 19.1 Die Unterscheidung — sie ist die fachliche Achse des Abschnitts

| Rückmeldung | Sperrt die Adresse? | Widerruft Einwilligungen? |
|---|---|---|
| **Beschwerde** („als Spam markiert") | **ja** | **ja, alle** |
| **dauerhafter Rückläufer** (Adresse existiert nicht mehr) | **ja** | **nein** |
| **vorübergehender Rückläufer** (Postfach voll, verzögert) | **nein** | nein |
| Zustellung, Versand | nein | nein |

**Eine Beschwerde ist eine Willenserklärung, ein Rückläufer ein technisches Ereignis.** Wer „Spam" drückt, hat die Erlaubnis zurückgenommen — es wäre gekünstelt, dieselbe Person weiter als einwilligend zu führen, nur weil sie den vorgesehenen Abmeldeweg nicht benutzt hat. Wessen Postfach dagegen gelöscht wurde, hat **gar nichts erklärt**; dessen Einwilligung als widerrufen zu führen, wäre eine erfundene Handlung — dieselbe Fälschung, die das System in der Gegenrichtung (eine per Knopfdruck gesetzte Bestätigung, §15.7) hart verhindert.

Die praktische Folge zeigt sich, wenn die Adresse später wieder erreichbar wird: Es ist der Unterschied zwischen „muss neu einwilligen" und „war nie weg".

**Ein vorübergehender Rückläufer sperrt bewusst nicht.** Die Abwägung ist unsymmetrisch: Eine zu Unrecht gesperrte Adresse ist ohne Weg zurück verloren; eine zu spät gesperrte erzeugt beim nächsten dauerhaften Rückläufer ohnehin die richtige Sperre.

**Es entsteht dabei niemals ein neuer Bestandseintrag.** Ist die Adresse unbekannt, wird nur das Ereignis vermerkt und die Sperre gesetzt. Ein Bestandseintrag ist ein Kontakt, den jemand hinterlassen hat; aus einem Zustellfehler einen zu erzeugen hieße, einen Bestand aus Adressen aufzubauen, die uns nie jemand gegeben hat. Die Sperrliste ist genau dafür seit B1 ohne Verbindung zum Bestand gebaut (§15.5).

Was zurückgemeldet wird, wird **protokolliert, auch wenn es nichts bewirkt** — ein vorübergehender Rückläufer ebenso wie eine Zustellung. Der Freitext des Anbieters wird dabei **beim Schreiben** von allen adressförmigen Angaben bereinigt, nicht erst beim Anzeigen: Was nie gespeichert wird, muss später nicht eigens vergessen werden. Bereinigt wird bewusst breiter als „die bekannte Adresse" — eine Rückläufer-Meldung kann eine abweichende Schreibweise, einen Alias oder eine Postmaster-Adresse enthalten.

### 19.2 Kein Öffnungs- und kein Klick-Tracking — dauerhaft

**Das System erhebt nicht, ob eine E-Mail geöffnet wurde, und nicht, ob ein Link darin angeklickt wurde. Es ist nicht vorgesehen, das je zu tun.**

Die Abgrenzung ist keine Geschmacksfrage, sondern hat eine klare Linie: **Eine Zustellstatus-Meldung kommt vom empfangenden Server** und sagt aus, ob die Übermittlung technisch gelungen ist. Das ist keine Beobachtung des Verhaltens der Person. **Ein Zählpixel und umgeschriebene Links wären es** — sie melden, wann jemand eine Nachricht gelesen hat, wie oft, und was ihn daran interessiert hat. Das ist Verhaltensprofilbildung, und die findet in diesem Projekt nicht statt (dieselbe Linie wie beim Einwilligungsnachweis, §15.3: Der Nachweis, *dass* jemand zugestimmt hat, ist zulässig; ein Profil, *wie* er sich verhält, nicht).

Die Verfolgung ist beim versendenden Dienstleister **nachweislich abgeschaltet** und wird dort auch nicht abonniert; kämen solche Meldungen dennoch an, würden sie verworfen und gelangten nicht in den Datenbestand. Der Prüf- und der Abschaltweg sind im Betriebshandbuch (`DEPLOYMENT.md`, Abschnitt 2-Resend-a) als **dauerhafte Zusage** festgehalten, damit sie bei einem Wechsel des Dienstleisters nicht verlorengeht.

**Folge für die Aufbewahrung:** Die Frist bemisst sich an tatsächlichen Handlungen der Person — abgesendetes Formular, bestätigte Einwilligung, Widerruf —, nicht an einem beobachteten Leseverhalten (§15.6).

### 19.3 Eine Sperre lässt sich über keine Oberfläche aufheben

Es gibt keine Schaltfläche „doch wieder zustellen", und es gibt auch dahinter keinen Weg. **Entsperren wäre der Sache nach Erteilen** — und die Regel des gesamten Entwurfs lautet: Der Admin kann widerrufen, nie erteilen (§15.7). Eine solche Schaltfläche wäre der Weg, auf dem eine Beschwerde — die schärfste Rückmeldung, die eine Person geben kann — mit einem Klick verschwindet.

Ein begründeter Einzelfall bleibt damit ein bewusster, protokollierbarer Eingriff im Datenbestand und kein Betriebsvorgang. Der Satz steht auch in der Oberfläche, nicht nur hier.

### 19.4 Frühwarnung

Der Admin-Bereich zeigt dauerhafte Rückläufer und Beschwerden der letzten 30 Tage an der Stelle, an der ohnehin jeder hinsieht — und hebt hervor, **sobald überhaupt eine Beschwerde auftritt**. Die erste ist der Zeitpunkt zu handeln, nicht die zehnte. Eine steigende Beschwerdequote ist die einzige Frühwarnung vor einem Reputationsschaden der Absenderdomain, und niemand sucht von sich aus danach. Bei einem gesperrten Eintrag benennt die Detailansicht den **Grund** — abgemeldet · Rückläufer · Beschwerde · manuell gesperrt: Es gibt drei Wege auf die Liste, und sie bedeuten Verschiedenes.

---

*Ende Pflichtenheft v1.0. Änderungen: Entscheidungen mit Begründung ergänzen, Erledigtes aus §13 entfernen, Version hochziehen.*
