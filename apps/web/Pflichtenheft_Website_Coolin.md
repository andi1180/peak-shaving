# Pflichtenheft — coolin.at Relaunch

> **Kanonisches Spezifikationsdokument für den professionellen Neubau der Website coolin.at.**
> Selbst-enthaltend und session-übergreifend nutzbar: eine neue Session (oder ein Handover an eine andere Person/ein anderes Tool) kann allein aus diesem Dokument nahtlos anschließen. Entscheidungen sind **mit Begründung** dokumentiert, offene Punkte mit Owner.
>
> **Schwesterprojekt:** Der Peak-Shaving-Kalkulator (`Pflichtenheft_Kalkulator_MVP.md`, Repo-Regeln `CLAUDE.md`). Die Website „dreht sich" um diesen Kalkulator; die Rechen-Engine wird wiederverwendet, nicht neu gebaut.
>
> **Stand:** Konzeption abgeschlossen, Bauphase noch nicht begonnen. Version 1.0.

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

coolin.at ist die **Hauptplattform** von COOLiN Energy: klassische Marketing-Seite **plus** Login-Bereich für bezahlte Features. `[Entscheidung]` Das ersetzt bewusst das frühere Modell aus dem Kalkulator-Pflichtenheft (installateur-neutrale Produktmarke getrennt von einer COOLiN-Vitrinenseite). COOLiN ist jetzt die Dachmarke; White-Label/Reseller kommt später als eigener Layer (§3.4), nicht als getrennte Marke.

### 3.3 Monetarisierungs-Fahrplan

- **Phase 1:** Kalkulator **kostenlos** als Lead-Magnet (das bestehende Standalone-Erlebnis). `[OP#1 — Owner: Martin/Andreas]` Andreas tendiert klar zu „frei in Phase 1"; final pending Martins Meinung. **Diese Weiche ist die einzige noch offene Geschäftsentscheidung** — sie blockiert Phase 1 nicht (frei ist der Default-Baupfad).
- **Phase 2:** Login + Registrierung + Stripe; Pro-Kalkulator hinter Bezahlschranke. Preismodell (Abo vs. Einmalkauf) `[OP#2 — Owner: Andreas/Martin]`.
- **Phase 3:** Reseller-Mandantenfähigkeit.

**[Entscheidung]** CTA-Wording ist phasenfest: „**Kostenlos testen**", nie „für immer kostenlos" — damit die Copy beim Übergang frei→bezahlt nicht umgeschrieben werden muss.

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

**Prominenter CTA-Button** (eigenständig gestylt, nicht Teil der Nav-Links): „**Kostenlos testen**" → Peak-Shaving-Flaggschiff bzw. Teaser/Kalkulator.

**Nicht in der Hauptnav, aber als Seiten:** `/referenzen`, `/datenschutz`, `/impressum`, `/produkte` (bzw. `/preise` — Produkt-Übersicht, siehe §5.7).

### 4.2 Warum Peak Shaving nicht in den „Leistungen" steht

`[Entscheidung, mit Begründung]` Peak Shaving ist bei COOLiN **zwei** Dinge: eine *Methode/Dienstleistung* (überlappt stark mit Speicher + Energiemanagement) **und** ein *Produkt* (der bezahlte Kalkulator). Es doppelt in der Nav zu führen, verwässert genau die Sonderstellung, die es verdient. Daher: nur eigener Top-Level-Punkt; die Leistungs-Seiten (PV/Speicher, Energiemanagement) verlinken auf das Flaggschiff (interne Verlinkung auf die „Money-Page" ist SEO-technisch sogar besser). **Best of both worlds:** zusätzlich ein prominenter Peak-Shaving-**Block auf der Startseite** mit Teaser (§4.4), sodass Peak Shaving auch dort sichtbar ist, ohne als eine der Portfolio-Kacheln zu erscheinen.

**Evolution:** Top-Level bleibt vorerst „Peak Shaving" (stärkstes Keyword, Flaggschiff). Sobald mehrere echte Produkte existieren, wird daraus „**Produkte ▾**".

### 4.3 URL-Struktur (Slugs)

Deutsch, sprechend, keyword-orientiert (final gegen §6-Keywords gegenprüfen). Beispiele:
`/loesung` bzw. `/peak-shaving`, `/peak-shaving/kalkulator`, `/leistungen/pv-speicher`, `/leistungen/energiemanagement`, `/leistungen/smart-heating`, `/leistungen/ppa`, `/leistungen/finanzierung-foerderung`, `/leistungen/esg`, `/branchen/hotellerie`, `/branchen/gastronomie`, `/branchen/baeckerei`, `/branchen/handel`, `/wissen`, `/wissen/leistungstarif-2027`, `/ueber-uns`, `/kontakt`, `/produkte`.

**Wichtig:** i18n-vorbereitet, d. h. die Routing-Struktur muss später einen Sprach-Präfix (`/de/…`, `/en/…`) oder eine gleichwertige Lösung ohne Umbau erlauben (§8.7).

### 4.4 Startseiten-Aufbau (Reihenfolge = Hierarchie)

1. **Hero:** Problem/Lösung in einem Satz („Wir senken Ihre Leistungskosten — mit belastbaren Zahlen"), klarer Primär-CTA („Kostenlos testen") + Sekundär-CTA („Beratung anfragen"). Ruhig, seriös, kein Gradient.
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

**(b) „Der Kalkulator" (Produkt-/Preisseite).** Beschreibt das Produkt, zeigt **Screenshots des Pro-Kalkulators und der Ergebnis-Reports** (Andreas liefert; bis dahin Platzhalter). Erklärt den Unterschied Teaser vs. Pro (§5.4). Phase 1: CTA „Kostenlos testen" → freier Kalkulator. Phase 2: Preis-/Abo-Darstellung + „Jetzt starten" hinter Login. Diese Seite ist zugleich Teil der Produkt-Übersicht (§5.7).

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
| 7 | Logo-Assets in hoher Auflösung | Andreas | Wortmarke/Header final | offen |
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

*Ende Pflichtenheft v1.0. Änderungen: Entscheidungen mit Begründung ergänzen, Erledigtes aus §13 entfernen, Version hochziehen.*
