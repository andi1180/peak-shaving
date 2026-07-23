# Fahrplan 2026 — Leadgenerierung und Vorbereitung des Marktstarts 2027

> **Kanonische Quelle für ALLE Bauentscheidungen ab 20.07.2026.** Bei Widerspruch zu einem Pflichtenheft gilt diese Datei. Ersetzt den bisherigen Haushalts-Tarifmonitor als Bauziel (s. „Was ruhend gestellt ist" unten).

---

## Kontext

Richtungsänderung vom 20.07.2026: Der Haushalts-Tarifmonitor als Eigenbau wird eingestellt. Grund: E-Control betreibt mit dem Tarifkalkulator samt Watchdog dieselbe Funktion kostenlos, bei gesetzlich erzwungener Vollständigkeit aller Anbieterdaten — für Haushalte UND Gewerbe. Ein Eigenbau ist weder inhaltlich noch preislich zu gewinnen. Der Tarifvergleich wird künftig kostenlos über ein eingebettetes E-Control-Widget angeboten. Die Plattform richtet sich stattdessen auf Leadgenerierung 2026 und den Marktstart 2027 (Leistungstarif Netzebene 7) aus.

2026 ist ein Beschaffungsjahr: beschafft werden Kontakte, Rechnungsdaten, Referenzfälle und Partner. Voller Marktstart Anfang 2027.

---

## Dokumenten-Hierarchie (welches Dokument regelt was)

- **`Fahrplan_2026.md`** (diese Datei) — kanonisch für Reihenfolge, Umfang und Begründung ALLER Bauabschnitte. Bei Widerspruch zu einem Pflichtenheft gilt diese Datei.
- **Pflichtenhefte** (`Pflichtenheft_*.md`) — kanonisch für die fachliche Tiefe je Produkt: was genau rechnet und tut das Produkt. Werden je Bauabschnitt aktualisiert, kurz BEVOR er gebaut wird — nicht auf Vorrat.
- **`CLAUDE.md` je App/Paket** — Handover-Log: was wurde gebaut, welche Entscheidungen fielen, welche Fallstricke sind bekannt.
- **`DEPLOYMENT.md`** — Env-/Dashboard-Stand, niemals echte Werte.
- **`README_Doku-Struktur.md`** — Landkarte über alles.

Ein Pflichtenheft für den Rechnungs-Wächter (B7–B9) existiert bewusst NOCH NICHT. Es wird unmittelbar vor B7 geschrieben, wenn Martins Prüfregelwerk vorliegt — vorher wäre es Fiktion. Die fachliche Tiefe zu B1–B3 erweitert das Website-Pflichtenheft, zu B10/B11/B14 das Kalkulator-Pflichtenheft. **Nachgezogen in `apps/web/Pflichtenheft_Website_Coolin.md`: §15** (B1 — Einwilligungsarchitektur, Wortlaute, Abmeldung/Sperre, Aufbewahrung und Anonymisierung, Grenzen des Admin-Bereichs), **§16** (B3 — Erfassungsstellen, Segmentierung, Zusammenführungsregeln), **§17** (B4 — die beiden zeitgesteuerten Läufe, Protokollpflicht, Mengenbegrenzung), **§18** (B2-1 — Bestandspflege und Ausfuhr), **§19** (B2-2 — Rückläufer und Beschwerden, kein Öffnungs-/Klick-Tracking).

---

## Was ruhend gestellt ist (nicht gelöscht)

| Alt | Schicksal |
|---|---|
| T1 Tarif-Engine (`packages/tariff-monitor`) | ruhend — Code UND Tests bleiben in CI, sie sind grün und beweisen die Funktionsfähigkeit |
| T2 Scraper | entfällt — wurde nie gebaut |
| T3 Gratis-Check (`/strom-check`) | ruhend — bleibt bestehen, bleibt `noindex`, bleibt unverlinkt, NICHT löschen |
| T4 Auth/Stripe/Entitlements/Admin | UNVERÄNDERT AKTIV — trägt alle künftigen Produkte |
| T5 Monitor-Dashboard | entfällt ersatzlos |
| T6 Rechnungsscan Haushalt | umgelenkt auf Gewerbe → B8 |
| T7 Cron/Benachrichtigung | Infrastrukturgedanke lebt weiter → B4 |

Reaktivierbar, falls sich ein Bedarf jenseits des E-Control-Angebots zeigt (z. B. anderer Markt).

---

## Bauabschnitte (neue Nummerierung B0–B16)

### Stand je Bauabschnitt

Mit inzwischen zwölf gebauten Teilabschnitten ist aus der Beschreibung unten sonst nicht mehr erkennbar, was existiert und was Vorhaben ist. Diese Tabelle nennt **nur den Zustand** — kein Datum, keine Fortschrittsangabe. Die Begründungen und der Umfang stehen unverändert in den Absätzen darunter.

| # | Stand | Anmerkung |
|---|---|---|
| **B0** Doku-Umstellung | **gebaut** | |
| **B1** Lead- und Einwilligungsfundament | **gebaut** | B1-1 bis B1-3 |
| **B2** Segmentierung & Aussendung | **teilweise gebaut** | B2-1 Bestandspflege und Ausfuhr gebaut · B2-2 Rückläuferverarbeitung gebaut · **B2-3 Kampagnenversand offen** |
| **B3** Lead-Erfassungskomponente + Einsatzorte | **teilweise gebaut** | B3-1 Segmentierung, B3-2 Registry und erste Einsatzorte, B3-4 Warteliste + Postaktions-QR gebaut · **B3-3 Betroffenheits-Check blockiert** auf die Branchenkennzahlen (Vollbenutzungsstunden je Branche, Owner Martin) |
| **B4** Vertragsablauf-Erinnerung | **gebaut** | B4-1 Scheduling + Fristdurchsetzung · B4-2 Erinnerung + Landingpage |
| **B5** Förder-Check | **blockiert** | auf die steuerliche Absicherung (IFB / EAG-Speicherförderung) |
| **B6** E-Control-Widget + Netzbetreiber-Anleitungen | **blockiert** | auf die technische Prüfung des Cookie-Verhaltens (offene Entscheidung 5) |
| **B7** Rechnungs-Prüfregelwerk | **blockiert** | auf Martins Prüfregelwerk als Fachdokument |
| **B8** Rechnungseingang + Extraktion | **offen** | zusätzlich abhängig von offener Entscheidung 3 (Eingangsweg) |
| **B9** Rechnungs-Wächter als Abo | **offen** | setzt B7/B8 voraus |
| **B10** Kalkulator ans Entitlement-System | **gebaut** | B10-1 Nachweis `calculator_pro` (PR #33, `48096fa`) · B10-2 Routenschutz + Ablösung des Zugangscodes (PR #34, `779a8d7`) · B10-3 Doku + `apps/portal`-Aufräumen (PR #35, `db97293`) · B10-4 Gutschein-Einlösung auf der Kalkulator-Anfrage-Seite (PR #36, `ebfdb9d`) · B10-5 Registrierung erfasst Firma + Ansprechperson und schreibt einen Lead (PR #37, `2ca9adc`) · **Zugang aktuell auf handverlesene Partner beschränkt (s. Absatz unten)** |
| **B11** Kalkulator auf Verordnungssätze umstellbar | **gebaut** | als Codemodul, s. unten |
| **B12** Datenanbindung Vortageswerte | **offen** | |
| **B13** Mandantenfähigkeit | **zurückgestellt** | bewusst additiv später; bekommt mit der Fachbetriebs-Lizenz den ersten realen Anwendungsfall |
| **B14** Analyse-Persistenz Kalkulator | **gebaut** | B14-1 Ablage · B14-2 Export/Upload/Ansicht |
| **B15** Echtzeit-Datenpfad | **offen** | ab Q2 2027 |
| **B16** Partner-Attribution | **teilweise gebaut** | B16-1 Datenbank + B16-2 Landingpage/Lead-Erfassung/Partner-Stammdaten + B16-3 öffentliche Bewerbung mit Kontoerstellung und Prüf-Eingang + B16-4a Genehmigung samt Partner-Anlage und Kontoverknüpfung + B16-4b Partner-Portal, E-Mail-Vorlagen und Genehmigungsmail gebaut · **B16-5 und B16-6 offen** (Partner-Statistik, Partner-Sicht auf Leads) |

### Die B-Nummern sind Namen, keine Positionen

Eine B-Nummer klebt an ihrem **Inhalt** und wird nie gegen eine andere getauscht — auch dann nicht, wenn sich die Baureihenfolge ändert (wie bei B3 vor B2 geschehen). **Die Reihenfolge ist eine getrennte Angabe**, kein Ordnungsmerkmal der Nummer.

Grund: Die Bezeichner sind außerhalb dieses Dokuments in Gebrauch — in bereits **angewandten** Datenbank-Migrationen, in Code-Kommentaren, in den Handover-Logs und in den Pflichtenheft-Kapiteln. Ein Nummerntausch machte alle diese Stellen stillschweigend falsch, ohne dass irgendein Test rot würde: Der Code liefe unverändert, und nur die Erklärung, warum er so ist, zeigte auf den falschen Abschnitt.

- **B0** Doku-Umstellung (diese Aufgabe)
- **B1** Lead- und Einwilligungsfundament — `platform.leads`, EIN Bestand mit Statuskennzeichen; MEHRERE zweckgebundene Einwilligungen je Lead über die Zeit (Vertragsablauf-Erinnerung ist NICHT Marketing-Einwilligung — anderer Zweck); versionierte Einwilligungstexte als eigene unveränderliche Datensätze, auf die der Einwilligungseintrag zeigt; Zeitpunkt + technische Herkunft; Herkunftskontext als PFLICHTFELD (welcher Artikel/welche Branche/welche Anleitung/welches Rechenergebnis/QR-Quelle); Double-Opt-in; Abmeldemechanismus; Admin-Abschnitt „Leads"; Kontaktformular schreibt mit. Additiv mandantenfähig VORBEREITET (kein `tenant_id` jetzt, aber ein Modell, das es ohne Umbau verträgt — die Fachbetriebs-Lizenz enthält „Lead-Verwaltung" für den Partner).
- **B3** Lead-Erfassungskomponente + erste Einsatzorte — EIN Backend, VIELE kontextspezifische Einstiegspunkte; kein überall gleiches Formular. Einbettbar in MDX-Artikel, Branchen-/Leistungsseiten, unter Rechnerergebnisse, als eigene Landingpage für den Postbrief-QR-Code. Wertleiter: anonym rechnen → E-Mail für Ergebnisdokument/Anleitung/Warteliste → Versorger+Ablaufdatum für echte Erinnerung → zahlen. Betroffenheits-Check (PLZ + Verbrauch + Branche → Betroffenheit ab 2027 + Lastspitzen-Größenordnung, deterministisch über Vollbenutzungsstunden; Segmentierung leistungsgemessen vs. Netzebene 7) ist der ERSTE Konsument dieser Komponente, nicht ihr Zweck. Der bestehende Schnellrechner (`components/quick-calculator.tsx`) ist die Ausgangsbasis.
- **B2** Segmentierung & Aussendung — gefilterte Sicht, Export/Versand, Suppression-Liste, Zustellprotokoll. Das ist die 48-Stunden-Aktivierung des Gesamtbestands zum Erscheinen der Tarifverordnung. Muss stehen, BEVOR der Bestand groß ist.

  **ERLEDIGT: B2-1 (23.07.2026, Bestand bearbeitbar machen — Segmentierungsfilter, Korrekturweg, Export samt Protokoll, ohne jeden Versand).** Damit ist der Bestand les- und korrigierbar; die Aussendung selbst (Kampagnenversand, Zustellprotokoll je Kampagne) bleibt B2-3. Mit B2-1 verlassen erstmals personenbezogene Daten den Wirkungsbereich des Systems dauerhaft (als Datei); die Sperrliste und anonymisierte Zeilen sind deshalb in der ABFRAGE ausgeschlossen und nicht in einer Einstellung, und jede Ausfuhr wird protokolliert. Details im Handover `apps/web/CLAUDE.md`.

  **ERLEDIGT: B2-2 (23.07.2026, Rückläufer und Beschwerden — Resend-Webhook auf die Sperrliste, ohne jeden Versand).** Der Zustellrand: was Resend über bereits versendete Mails zurückmeldet, wirkt jetzt auf den Bestand. Eine **Beschwerde** sperrt die Adresse UND widerruft alle Einwilligungen (sie ist eine Willenserklärung), ein **dauerhafter Rückläufer** sperrt nur (ein technisches Zustellversagen ist keine), ein **vorübergehender** tut bewusst nichts (eine Sperre darauf verlöre echte Kontakte unwiederbringlich). Der Webhook legt niemals einen Lead an; die Sperrliste ist seit B1-1 genau dafür ohne Fremdschlüssel gebaut. **Es gibt bewusst keinen Weg, eine Sperre über die Oberfläche aufzuheben** — Entsperren wäre der Sache nach Erteilen. Neu ausserdem die Frühwarnung auf `/admin/leads` (Rückläufer und Beschwerden der letzten 30 Tage, hervorgehoben ab der ersten Beschwerde). **Der Endpunkt ist in Produktion noch NICHT scharf geschaltet** — Registrierung bei Resend und `RESEND_WEBHOOK_SECRET` sind ein bewusster Betriebsschritt (Anleitung `DEPLOYMENT.md` §1h). Damit bleibt von B2 nur noch **B2-3** offen: Kampagnenmodell, Empfängerliste, gestaffelter Versand, Zustellprotokoll je Kampagne. Details im Handover `apps/web/CLAUDE.md`.

  **`[Reihenfolge korrigiert 21.07.2026]` B3 wird VOR B2 gebaut.** B2 baut die gefilterte Sicht — aber die Filterdimensionen (Branche, Netzebene, PLZ) entstehen erst mit B3 und wurden in B1 ausdrücklich ausgeklammert. B2 vor B3 hieße, gegen nicht existierende Dimensionen und einen leeren Bestand zu bauen. Der ursprüngliche Grund für ein frühes B2 — es muss stehen, BEVOR der Bestand groß ist — bleibt unverändert gültig; er richtet sich gegen ein SPÄTES B2, nicht für ein sofortiges. B3 füllt den Bestand und definiert die Dimensionen, B2 wertet beides aus. **Die Nummern B2/B3 bleiben an ihren Inhalten** (sie sind in Migrationen, Code-Kommentaren und Handover-Logs als Bezeichner in Gebrauch); geändert ist allein die Baureihenfolge.
- **B4** Vertragsablauf-Erinnerung — Versorger + Ablaufdatum erfassen, Erinnerung 2–3 Monate vorher. Erster zeitgesteuerter Job im System. **ERLEDIGT: B4-1 (22.07.2026, Scheduling + Fristdurchsetzung, ohne jeden Versand) und B4-2 (22.07.2026, Erinnerung + Landingpage `/vertragsende-erinnerung`, acht Wochen Vorlauf, täglich 06:40 UTC).** Mit B4-2 versendet die Plattform erstmals automatisiert E-Mails an reale Personen; die Doppelversand-Sperre ist der Primärschlüssel `(lead_id, contract_end_date)`, nicht eine Prüfung im Anwendungscode. Details im Handover `apps/web/CLAUDE.md`.
- **B5** Förder-Check — IFB + EAG-Speicherförderung, rein deterministisch. Inhaltlich blockiert auf steuerliche Absicherung.
- **B6** E-Control-Widget + Netzbetreiber-Anleitungen (Wiener Netze, Netz NÖ, Netz Burgenland). Widget ERST nach technischer Prüfung des Cookie-Verhaltens (s. offene Entscheidungen). **B6a (Cookie-Verhalten-Prüfung) ist an CC delegiert, Ergebnis noch ausständig** — kein Befund in dieser Session vorgefunden, deshalb hier nur als offener Faden vermerkt statt stillschweigend übergangen.
- **B7** Rechnungs-Prüfregelwerk — deterministische Prüfungen auf strukturierten Rechnungsdaten: verrechnete Leistungsspitze, Angemessenheit der vereinbarten netzwirksamen Leistung (Mindestbemessung 20 %), Sommer-Nieder-Arbeitspreis (seit 01.04.2026, −20 % werktags 10–16 Uhr bei aktiver Viertelstundenauslesung), Blindarbeits-Positionen, korrekte Tarifzuordnung. Konfidenz-Flags. Dient BEIDEN Bezahlprodukten — der Einmal-Check ist der Einstiegsmonat des Abos, dieselbe Logik.

  VIER VERBINDLICHE SPEICHERREGELN (Datenoffenheit für künftige Produkte):
  1. Originalrechnung bleibt unverändert archiviert — spätere, bessere Extraktion muss die Historie neu auswerten können.
  2. Extraktion strikt getrennt von Interpretation: extrahierte Werte mit Extraktionsversion, Modell und Konfidenz JE FELD; Prüfregeln als eigene Schicht darüber. Neue Regeln müssen rückwirkend über den Gesamtbestand laufen können.
  3. ALLE Rechnungspositionen normalisiert erfassen, nicht nur die, die heutige Regeln brauchen.
  4. Jede Monatsrechnung ist eine unveränderliche Beobachtung mit Periodenbezug — nie überschreiben.
- **B8** Rechnungseingang + Extraktion — Eingangsweg, Dateiablage, KI-gestützte Extraktion AM RAND (Prinzip „KI an den Rändern, Determinismus im Kern" gilt unverändert: KI extrahiert, KI urteilt nicht).
- **B9** Rechnungs-Wächter als Abo (19 €/Monat) — Stripe-Produkt auf bestehender T4-Infrastruktur, Monatszyklus, Kundenbericht, Prüf-Queue im Admin AUSSCHLIESSLICH für Auffälligkeiten, Kundenbereich mit Berichtshistorie. BINDENDE KONSTRUKTIONSVORGABE: Bei 19 €/Monat darf keine Rechnung routinemäßig manuell geprüft werden — automatisiert, persönliche Prüfung nur bei ausgewiesener Auffälligkeit. Mengendimension (Zählpunkte/Standorte) beim Bau mitdenken, da Multi-Standort später darauf aufsetzt.
- **B10** Kalkulator ans Entitlement-System — Ablösung des separaten, DB-losen Zugangscodes (`lib/kalkulator-access.ts`). Vorbedingung für jede Fachbetriebs-Lizenz.

  **ERLEDIGT (22.07.2026), in fünf Schritten: B10-1 (PR #33, `48096fa`), B10-2 (PR #34, `779a8d7`), B10-3 (PR #35, `db97293`), B10-4 (PR #36, `ebfdb9d`) und B10-5 (PR #37, `2ca9adc`).** Der Produktschlüssel `calculator_pro` musste **nicht angelegt werden** — er steht seit T4-1 im Enum `platform.product_key`, weil `platform` von Anfang an für beide Produkte gebaut wurde; B10-1 hat ihn deshalb nicht hinzugefügt, sondern erstmals BENUTZT und die Produkt-Isolation als Verhalten abgesichert (bis dahin war jede Entitlement-Invariante ausschliesslich mit `monitor` geprüft — „der Parameter trägt den zweiten Wert schon mit" war eine Behauptung über eine nie so aufgerufene Funktion). **In B10-1/B10-2 entstand keine Migration.**

  B10-2 schützt `/peak-shaving/kalkulator/rechner` server-seitig: **Sitzung UND aktives `calculator_pro`-Entitlement**, gelesen über denselben Wrapper wie der Monitor (`public.get_my_entitlement` — das Produkt ist dort ein Parameter, es gibt bewusst keinen zweiten Lesepfad). Der alte Zugangscode ist **vollständig entfernt, nicht umgangen**: `lib/kalkulator-access.ts` und `components/peak-shaving/calculator-gate.tsx` sind gelöscht, es gibt kein Eingabefeld mehr. **B10-3 hat `apps/portal` nicht reaktiviert, sondern ersatzlos gelöscht** (nicht verschoben — der Portalteil lebt faktisch in `apps/web`) und die Doku nachgezogen; kein eigener Funktionsschritt, reine Aufräumarbeit. Fachliche Tiefe in `Pflichtenheft_Kalkulator_MVP.md` §7a.3, Handover in `apps/web/CLAUDE.md`.

  **B10-4** legt den fehlenden Vergabeweg direkt auf die Kalkulator-Anfrage-Seite: Gutscheincode-Einlösung über denselben Mechanismus wie beim Monitor (`CODE_PRODUCT_KEYS`), ohne den Umweg über `/konto`. **Für `calculator_pro` gibt es weiterhin bewusst keinen Stripe-Preis und keinen Checkout** — die Preisfrage (OP#1, Root-`CLAUDE.md`) bleibt offen und wird hier nicht durch einen Platzhalter vorweggenommen.

  **Betriebsphase (Stand 26.07.2026):** Der Kalkulator wird bewusst NICHT breit beworben oder öffentlich zugänglich gemacht. Zugang erhalten ausschliesslich von COOLiN handverlesene Betriebe, freigeschaltet per manuell ausgestelltem Gutscheincode — kein Self-Service, kein öffentlicher Anmeldeweg, kein Stripe-Preis. Das ist keine technische Einschränkung, sondern eine bewusste GTM-Entscheidung (Andreas, 26.07.2026). Unverändert offen bleibt OP#1: OB und zu welchem Preis der Zugang später über diesen engen Kreis hinaus geöffnet wird.

  **B10-5 schliesst den zuvor offenen Punkt „Registrierung trägt kein Rücksprungziel durch den Bestätigungsmail-Flow":** Die Registrierung erfasst jetzt Firma + Vorname/Nachname als plattformweite Pflichtfelder (EIN Formular für Monitor- UND Kalkulator-Trichter, kein kalkulator-eigenes) und schreibt darüber einen Lead über denselben `capture_lead`-Wrapper wie das Kontaktformular (B1-2). Die Herkunft wird aus dem sanierten `?next=` abgeleitet — zwei neue `lead_sources`-Zeilen, `kalkulator-registrierung` (**mit Bindestrich**: der ursprünglich vorgesehene Unterstrich verletzt den `^[a-z0-9-]+$`-Constraint aus B1-1, real als SQLSTATE 23514 gemessen, deshalb korrigiert) und `registrierung`. `next` reist jetzt durch die gesamte Bestätigungsmail-Kette bis zurück auf die Rechner-Route.

  **Ein Punkt bleibt bewusst offen — kein Blocker:** Der Zugriff ist an **einzelne Konten** gebunden; Gruppen-/Reseller-Zugriff ist **B13** und unverändert zurückgestellt.
- **B11** Kalkulator auf Verordnungssätze umstellbar machen — Tarifsätze als konfigurierbare Datenschicht, damit Nov/Dez 2026 eine Konfigurationsänderung genügt statt eines Umbaus unter Zeitdruck.

  **ERLEDIGT (21.07.2026).** Die „konfigurierbare Datenschicht" ist als getyptes Codemodul umgesetzt (`packages/shared/src/tariff-catalog.ts`), nicht als Datenbanktabelle: was eine DB-Lösung hier leisten müsste — Versionierung, Freigabe durch eine zweite Person, Unveränderlichkeit nach der Auslieferung, Nachvollziehbarkeit der Quelle — leistet die Versionsverwaltung bereits, während ein Laufzeitabruf den vollständig im Browser rechnenden Rechner von einem Netzaufruf abhängig machte oder `anon` erstmals Zugriff auf `platform` gäbe. Eine Satzänderung ist damit ein PR mit einer Datei (Anleitung: `DEPLOYMENT.md` §3a).

  **`[Nachtrag 24.07.2026]` Dieselbe Begründung gilt für die Branchenkennzahlen aus B3-3** (Vollbenutzungsstunden je Branche). Auch sie sind Werte, die **bestimmen, was eine Rechnung bedeutet** — sie entscheiden über die Aussage „Sie sind ab 2027 betroffen". Solche Werte gehören in den Code und damit in die Versionsverwaltung: Jede Änderung ist datiert, begründet, einer Person zurechenbar und durch eine zweite prüfbar, bevor sie wirkt. Eine im laufenden Betrieb über eine Oberfläche änderbare Kennzahl ließe rückwirkend nicht mehr feststellen, mit welchem Wert eine bereits erteilte Auskunft gerechnet wurde. **Im Admin-Bereich werden sie später ausschließlich LESEND angezeigt** — sichtbar, damit niemand sie im Code suchen muss; nicht bearbeitbar, damit die Nachvollziehbarkeit bestehen bleibt. Netzebene 7 wird bis zur Tarifverordnung ausdrücklich **verweigert statt geschätzt**, mit Verweis auf `/warteliste`. Fachliche Tiefe in `Pflichtenheft_Kalkulator_MVP.md` §7a.2.
- **B12** Datenanbindung Vortageswerte — Netzbetreiber-Schnittstelle, Zeitreihen-Speicher. Fundament für Peak-Wächter (Vortag), Wirkungsnachweis und Anomalie-Erkennung. Größter Einzelbaustein für 2027.
- **B13** Mandantenfähigkeit — `tenant_id` additiv in `platform.entitlements` und `platform.leads`. In T4-1 bewusst vorbereitet und zurückgestellt; bekommt mit der Fachbetriebs-Lizenz den ersten realen Anwendungsfall.
- **B14** Analyse-Persistenz Kalkulator — Auslegung und Prognose-Baseline serverseitig speichern. HOCH PRIORISIERT, MUSS VOR DER ERSTEN PILOTANALYSE STEHEN. Begründung: Das Alleinstellungsmerkmal des Wirkungsnachweises (29 €/Mon., ab Q1 2027) ist, dass nur COOLiN die Prognose-Baseline aus der Auslegung besitzt. Der Kalkulator speichert heute NICHTS serverseitig (localStorage; Supabase dort bewusst zurückgestellt). Jede Pilot- und 990-€-Analyse ohne B14 erzeugt eine Baseline, die verloren geht — ausgerechnet für die ersten Referenzkunden wäre der Wirkungsnachweis 2027 dann nicht lieferbar.
- **B15** Echtzeit-Datenpfad (Peak-Wächter Echtzeit, ab Q2 2027) — anderer Datenpfad als B12: Wechselrichter- bzw. Zähler-Kundenschnittstelle statt Netzbetreiber-API, plus Hardware.
- **B16** Partner-Attribution — **Modell A:** Fachbetriebe verweisen ihre Bestandskunden per personalisiertem Link an COOLiN; COOLiN führt Analyse und Kundenbeziehung, der Partner bekommt das erste Zugriffsrecht auf die Montage. Ausdrücklich NICHT die Fachbetriebs-Lizenz — **die Abgrenzung liegt nicht im Zugang, sondern im Umfang.** Seit B16-4b hat der Partner sehr wohl ein eigenes Konto und ein eigenes Portal, sieht dort aber ausschliesslich seinen eigenen Empfehlungslink und die E-Mail-Vorlagen: keine Sicht auf Leads (**B16-6**, wartet auf einen noch nicht existierenden Einwilligungszweck), keine Analysen, kein Zugriff auf die Kalkulator-Engine. Die Fachbetriebs-Lizenz aus dem GTM-Briefing wäre Werkzeugübergabe; Modell A ist das Gegenteil. Die Mandantenfähigkeit (**B13**) bleibt davon unberührt zurückgestellt — ein Partner-Konto entspricht heute genau einem Betrieb.

  **Abgrenzung zu B10 — der Kalkulator-Zugang hängt NICHT an einer Partnerschaft:** Eine über B16 genehmigte Partnerbewerbung verleiht KEIN `calculator_pro`-Entitlement. Beides sind heute getrennte Mechanismen (Partner-Attribution vs. Kalkulator-Zugang); eine mögliche Zusammenlegung ist keine getroffene Entscheidung. Zum aktuellen Vergabeweg des Kalkulator-Zugangs s. „Betriebsphase (Stand 26.07.2026)" im B10-Absatz oben.

  **ERLEDIGT: B16-1 (24.07.2026, NUR DATENBANK).** Migration `supabase/migrations/20260724190000_create_partner_attribution.sql`: `platform.partners` (Slug als Primärschlüssel mit demselben Format-CHECK wie `lead_sources.key`, unveränderlich per Trigger, kein `delete`-Grant für irgendwen — Stilllegung über `is_active`), zwei neue Spalten auf `platform.leads`, vier Partner-Wrapper, und `capture_lead`/`admin_list_leads`/`admin_export_leads`/`admin_update_lead`/`admin_get_lead` nachgezogen. 38 neue Tests im DB-Gate (328 → **366**). **Keine Route, keine Landingpage, kein UI** — das sind B16-2 und B16-3.

  **ERLEDIGT: B16-2 (25.07.2026, der öffentliche Rand).** Die Landingpage `/partner/<slug>` (dynamische Route in `apps/web`, `noindex, nofollow`, nicht in der sitemap — viele fast identische Seiten mit wechselndem Firmennamen sind aus Suchmaschinensicht Doorway Pages), die Lead-Erfassung darüber, das optionale Freitextfeld „Empfohlen durch" im bestehenden Kontaktformular samt `?partner=`-Parameter, und ein minimales Admin-UI für die Partner-Stammdaten (`/admin/partner`: auflisten, anlegen, umbenennen, aktiv/inaktiv — kein Löschen, das gibt es in der Datenbank bewusst nicht). Migration `supabase/migrations/20260725090000_create_partner_landing_source.sql`: eine `lead_sources`-Zeile (`partner-empfehlung`) und EIN enger Lesezugriff (`public.get_active_partner`, service_role-only, liefert ausschliesslich Slug und Anzeigename). 26 neue Anwendungstests (163 → **189**), 13 neue im DB-Gate (366 → **379**). **Kein Einladungsversand, kein E-Mail-Template, keine Genehmigungsstrecke, kein Partner-Login** — das bleibt B16-3 bis B16-6.

  **ERLEDIGT: B16-3 (25.07.2026, die Bewerbung von aussen).** Die öffentliche Seite `/partner-werden` (indexierbar und in der sitemap — anders als die Landingpages: es gibt genau EINE Seite mit eigenem Inhalt, und suchende Fachbetriebe sollen sie finden), das Bewerbungsformular MIT Kontoerstellung, zwei Mails (interne Benachrichtigung mit Freitext und Detail-Link, Eingangsbestätigung an den Bewerber) und der Prüf-Eingang unter `/admin/partner-antraege`. Migration `supabase/migrations/20260725150000_create_partner_applications.sql`: eigene Tabelle `platform.partner_applications` (ausdrücklich NICHT `platform.leads` — anderer Lebenszyklus, andere Auswertung), Statusenum und vier Wrapper. 22 neue Anwendungstests (189 → **211**), 33 neue im DB-Gate (379 → **412**). **Kein Genehmigen, keine Partner-Anlage aus einem Antrag, keine Slug-Vergabe, kein Partner-Login** — das bleibt B16-4 bis B16-6.

  **Die Entscheidung, die B16-3 trägt: es gibt kein Partner-Typfeld.** Was ein Konto darf, ergibt sich aus dem, was es HÄLT — eine Zeile in `platform.partners` (darf verweisen) und/oder ein Entitlement wie `calculator_pro` (darf ein Produkt nutzen). Ein Betrieb kann beides gleichzeitig halten; ein Typ-Enum erzwänge eine Ausschliesslichkeit, die sachlich nicht gilt, und müsste beim ersten Mischfall umgebaut werden.

  **Und: es entsteht kein LEAD.** Der Registrierungsweg schreibt seit B10-5 automatisch einen; die Bewerbung ruft ihn ausdrücklich nicht auf. Ein Fachbetrieb, der Vertriebspartner werden will, ist kein Peak-Shaving-Interessent — mitgezählt verfälschte er genau die Kennzahl, an der die Marktnachfrage gemessen wird (Ziel 500 Kontakte), und zwar unbemerkt, weil die Zeile plausibel aussieht.

  **In B16-3 liess sich ein Antrag nur ABLEHNEN** (aufgelöst mit B16-4a, s. u.). Genehmigen erzeugt zusätzlich einen Partnereintrag, einen Kurz-Key und die Verknüpfung des Kontos; ein Weg, der nur den Status gesetzt hätte, hinterliesse einen genehmigten Antrag ohne Partner — ein stiller Zustand, der wie Erfolg aussieht. Die Sperre lag auf drei Schichten: kein Wrapper in der Datenbank, kein Tabellenrecht für irgendeine Rolle, und der Zielstatus des Ablehn-Wrappers ist ein Literal statt eines Parameters.

  **ERLEDIGT: B16-4a (26.07.2026, die Genehmigung).** `platform.partners` bekommt zwei Verweise (`user_id` → `auth.users`, nullable und UNIQUE; `application_id` → `platform.partner_applications`, `on delete restrict`), dazu die zwei Wrapper `public.admin_approve_partner_application` (genehmigt UND legt den Fachbetrieb an, in EINER Transaktion, mit den Stammdaten AUS DEM ANTRAG) und `public.admin_link_partner_account` (hängt ein bestehendes Konto per Adresse an einen von Hand angelegten Betrieb — ohne diesen Weg käme Raymann nie in das Portal aus B16-4b). Migration `supabase/migrations/20260726090000_create_partner_approval.sql`; `admin_list_partners` und `admin_get_partner_application` per `create or replace` nachgezogen. Oberfläche: Genehmigungsschritt auf der Antrags-Detailseite mit Slug-Vorschlag aus dem Firmennamen (Umlaute aufgelöst: „Müller" → `mueller`), Verfügbarkeitsprüfung beim Tippen und Bestätigungs-Häkchen; Kontoverknüpfung unter `/admin/partner`. 9 neue Anwendungstests (211 → **220**), 26 neue im DB-Gate (412 → **438**). **Keine Genehmigungs-E-Mail, kein Partner-Portal, keine E-Mail-Vorlagen, keine Statistik** — das ist B16-4b/B16-5.

  **ERLEDIGT: B16-4b (26.07.2026, das Portal und die Mail dorthin).** Das eingeloggte Partner-Portal `/partner-portal` (persönlicher Empfehlungslink zum Kopieren, zwei E-Mail-Vorlagen mit BEREITS eingesetztem Link, `noindex`, nicht in der sitemap) und die Genehmigungsmail, die dorthin führt. Migration `supabase/migrations/20260726150000_create_partner_portal.sql`: `public.get_my_partner()` (kein Parameter — die Bindung entsteht im Rumpf über `auth.uid()`; liefert ausschliesslich Slug und Anzeigename, ein INAKTIVER Partner ist darüber nicht auffindbar), die Spalte `platform.partners.notified_at` und `public.admin_mark_partner_notified`; `admin_list_partners` und `admin_get_partner_application` per `create or replace` nachgezogen. Dazu die Admin-Aktion „Benachrichtigung senden" für zwei reale Fälle: ein fehlgeschlagener Versand und ein von Hand angelegter Betrieb (Raymann), dessen Konto erst nachträglich verknüpft wurde. 17 neue Anwendungstests (224 → **241**), 24 neue im DB-Gate (443 → **467**). **Keine Statistik, keine Klickzählung, keine Sicht auf Leads** — das bleibt B16-5/B16-6.

  **⚠ Der Mailversand darf die Genehmigung nicht umwerfen — und das ist die tragende Entscheidung von B16-4b.** Die Genehmigung ist EINE unumkehrbare Transaktion; ist sie durch, ist sie durch. Ein Mailproblem als Fehlschlag der Genehmigung zurückzumelden hiesse: Der Admin liest „hat nicht geklappt", der Betrieb ist trotzdem angelegt, und der naheliegende zweite Versuch läuft ins Leere. Der Benachrichtigungs-Ablauf wirft deshalb NIE; jeder Fehlschlag wird zu einem benannten Zustand mit der jeweils nächsten Handlung. Reihenfolge bindend: ERST senden, DANN `notified_at` setzen — ein Vermerk vor dem Versand stünde ausgerechnet dann auf „benachrichtigt", wenn der Versand gleich darauf scheitert.

  **⚠ „Mail raus, Vermerk fehlt" ist ein EIGENER Zustand.** Er sieht im Bestand aus wie „nie benachrichtigt", ist es aber nicht — die Nachricht liegt bereits im Postfach. Mit „Versand fehlgeschlagen" zusammengefasst riete die Oberfläche zum erneuten Senden, und der Betrieb bekäme dieselbe Mail zweimal. Er hat deshalb einen eigenen Text, der ausdrücklich VOM erneuten Senden abrät.

  **⚠ Im Bau gemessen: die Erfolgsmeldung der Genehmigung bleibt NICHT stehen.** Das Genehmigungsformular wird nur gerendert, solange der Antrag `pending` ist; mit dem Erfolg wechselt der Status, das Formular verschwindet — und mit ihm seine Meldung (derselbe Fehler wie in B1-3). Ausgerechnet „ACHTUNG: die Benachrichtigung konnte NICHT versendet werden" wäre damit der Satz, den niemand zu sehen bekommt. Antwort: kein längeres Stehenlassen einer flüchtigen Meldung, sondern ein DAUERHAFT lesbarer Zustand — `admin_get_partner_application` führt `partner_notified_at` mit, und die Antragsseite zeigt ihn nach jedem Neuladen.

  **Der Genehmigungsweg führt NUR über den Partner, und das steht in der Signatur.** `admin_approve_partner_application` verlangt einen Slug; es gibt keinen Aufruf, der `'approved'` erreicht, ohne dass ein Fachbetrieb entsteht — und beides passiert in derselben Transaktion (im DB-Gate gemessen, indem die Partner-Anlage künstlich zum Scheitern gebracht wurde: der Antrag bleibt `pending`). Fünf Ablehnungen sind einzeln unterscheidbar; zwei davon (`account_taken`, `duplicate_slug`) kämen ohne Vorprüfung als derselbe 23505 zurück, verlangen aber vollkommen verschiedene Handlungen.

  **⚠ Ein Antrag OHNE verknüpftes Konto ist nicht genehmigbar** (`no_account`). Der Fall ist in Produktion real aufgetreten: `submit_partner_application` legt den Antrag auch dann an, wenn die Kontoanlage scheitert (gemessen: `429 over_email_send_rate_limit`) — bewusst, denn eine verlorene Bewerbung wiegt schwerer als eine fehlende Verknüpfung. Genehmigt entstünde daraus ein Fachbetrieb, in dessen Zugang sich niemand einloggen könnte, und der Kurz-Key wäre unwiderruflich verbraucht. Der eigentliche Defekt gehört in `partner-werden` behoben (eigener Folgeauftrag).

  **⚠ Die UNIQUE-Bedingung auf `partners.user_id` fällt absehbar wieder.** Heute entspricht ein Konto genau einem Partner; mehrere Logins je Betrieb (Inhaber plus Büro) werden später ADDITIV über eine Zwischentabelle nachgerüstet — dann ist die Bedingung zu entfernen, nicht die Struktur umzubauen. Vermerkt im Spaltenkommentar und im Kopf der Migration.

  **⚠ Offen geblieben, bewusst: die Aufbewahrungsfrist für abgelehnte Anträge.** Die B4-1-Maschinerie greift ausschliesslich auf `platform.leads`. Welche Frist gilt, gehört in dieselbe juristische Prüfung wie die noch ausstehenden Einwilligungstexte (§7, Owner Martin) — vermerkt im Kopf der Migration und in `DEPLOYMENT.md` §7.

  **Die Entscheidung, die B16-2 trägt: der Slug kommt aus dem PFAD, nie aus dem Formular.** An der Zuordnung hängt später die Zuteilung eines Montageprojekts; ein verstecktes Formularfeld wäre im Browser in fünf Sekunden geändert. Die Landingpage sendet deshalb an einen eigenen Endpunkt (`/api/partner/<slug>/kontakt`), der seinen Slug aus den eigenen `params` liest und ein `partner` im Rumpf gar nicht erst ansieht. Der `?partner=`-Weg auf `/kontakt` ist der ausdrücklich schwächere Zwilling für Links, die direkt auf die Kontaktseite zeigen — dort wird der Wert serverseitig gegen die aktiven Fachbetriebe geprüft und bei einem Treffer übernommen, sonst stillschweigend verworfen.

  **Und: die Ansprechperson des Fachbetriebs erreicht die öffentliche Seite nicht.** Nicht, weil die Komponente sie nicht rendert, sondern weil der Datenbank-Wrapper sie nicht herausgibt. Was eine Server Component liest, kann im ausgelieferten HTML landen, auch wenn niemand es anzeigt — eine Auswahlliste im TypeScript-Leser wäre eine Zusage, die der nächste Umbau versehentlich zurücknimmt.

  **Die Entscheidung, die den Abschnitt trägt: ZWEI Spalten, nicht eine.** `partner_slug` ist die BESTÄTIGTE Zuordnung, `referred_by_text` der Freitext, den der Interessent selbst eingegeben hat („Empfohlen durch"). Dieselbe Trennlinie wie in B7 zwischen Extraktion und Interpretation: die Kundenangabe ist Beobachtung, die Zuordnung ist Urteil. Der Freitext trifft in der Praxis oft keinen Slug („Fa. Raymann Elektro", „mein Elektriker aus Wiener Neustadt") und ist trotzdem der Beleg, auf den sich eine spätere Zuordnung stützt; in einem Feld vermischt liesse sich nicht mehr feststellen, ob ein Wert dort steht, weil der Kunde ihn schrieb oder weil jemand ihn zuordnete. Folgerichtig ist nur die Zuordnung über den Admin korrigierbar — der Freitext hat bewusst gar keinen Parameter.

  **Die zweite Entscheidung: die Anonymisierung behandelt die beiden Spalten unterschiedlich.** `referred_by_text` wird genullt und ist danach unveränderlich (Freitext einer Person, kann Namen Dritter enthalten). `partner_slug` ÜBERLEBT und steht bewusst nicht im Guard: ohne E-Mail, Name und PLZ ist „kam über Partner X" keine personenbezogene Angabe mehr, und die Partner-Statistik muss die werbliche Aufbewahrungsfrist von 24 Monaten überdauern — sonst verlöre ein Fachbetrieb rückwirkend den Nachweis über die von ihm gebrachten Kontakte.

  **Kein Cookie, kein localStorage, kein sessionStorage.** Die Attribution läuft ausschliesslich über den URL-Pfad und ein Formularfeld. Eine Speicherung auf dem Endgerät wäre nach §165 TKG einwilligungspflichtig und brächte einen Cookie-Banner für die gesamte Domain — das beendete die bestehende, cookielose Analytics-Architektur (offene Entscheidung 5). Diese Festlegung gilt auch für B16-2/B16-3.

---

## Angebotsportfolio 2026 (Kurzfassung, für Kontext beim Bauen)

Leitregel: kostenlos ist alles, was reine Rechenlogik oder Weiterleitung ist. Bezahlt wird, sobald ein Fachurteil auf echten Kundendaten stattfindet.

- **KOSTENLOS:** Betroffenheits-Check, Tarifvergleich (E-Control-Widget), Vertragsablauf-Erinnerung, Förder-Check, Netzbetreiber-Anleitungen, Erstgespräch.
- **BEZAHLT:** Netzentgelt- und Anschlussleistungs-Check (149–249 € einmalig), Rechnungs-Wächter (19 €/Mon.), Lastspitzen-Analyse (990 €), Projekt.

Lastspitzen-Analyse und Projekt sind KEINE Bauabschnitte — sie sind Datenarbeit (Batteriekatalog, Wiener-Netze-Methodik, echtes Lastprofil) und hängen an Martin.

---

## Wiederkehrende Erlöse — Zuordnung zu Bauabschnitten

Quelle: `GTM_Briefing_COOLiN_ENERGY.docx` §4 + `Fahrplan_2026_Leadgenerierung_COOLiN.docx` §3.3.

| Modul | Richtpreis | Voraussetzung | Zuordnung |
|---|---|---|---|
| Wirkungsnachweis | 29 €/Mon., Jahr 1 inkl. | Abgeschlossenes Speicherprojekt | B14 (gebaut) liefert die Baseline; das Abo selbst hat keinen B-Namen |
| Peak-Wächter, Vortag | 49 €/Mon./Zählpunkt | Datenanbindung Netzbetreiber | hängt an B12, offen, nicht begonnen |
| Peak-Wächter, Echtzeit | 99–129 €/Mon. + Hardware | Wechselrichter-/Zähler-Schnittstelle | B15, ab Q2 2027 |
| Netzentgelt-Prüfung | im Rechnungs-Wächter enthalten | — | vorgezogen in B7, kein eigener Punkt |
| Anomalie-Erkennung | Aufpreis | Kontinuierliche Messdaten | hängt an B12/B15, kein eigener B-Name |
| Multi-Standort | ab 29 €/Standort | Laufende Datenanbindung | 2026 als Mengenrabatt im Rechnungs-Wächter vorwegnehmbar; volle Form ab Q2 2027 |
| Fachbetriebs-Lizenz | 249–499 €/Mon. | Fertiger Pro-Kalkulator + Batteriekatalog | B10 (gebaut) war die Vorbedingung; B13 folgt mit dem ersten Reseller |

Nahezu das gesamte Abo-Portfolio hängt an B12 (Datenanbindung Vortageswerte) — offen, nicht begonnen, wartet auf niemanden. Die Meilenstein-Tabelle im GTM-Briefing will sie bis Nov/Dez 2026 „in Erprobung", damit Q1 2027 hält. Verdient vor Herbst eine echte Aufschlüsselung wie B7–B9, ist aber laut §7 des GTM-Briefings 2026 nicht umsatzkritisch — keine Dringlichkeit, nur nicht vergessen.

---

## Aufräumen — nicht vergessen

- **`coolin2026` als Monitor-Gutscheincode:** Altlast aus dem früheren Kalkulator-Soft-Gate-Code (der Zugangscode selbst ist mit B10-2 gelöscht, dieselbe Zeichenfolge existiert aber unverändert als eingelöster Gutscheincode für `monitor`). Sollte über die Admin-Oberfläche deaktiviert werden. Owner: Andreas. Kein Bauauftrag.
- **Beobachtet, bewusst nicht behoben:** Wird der `monitor`-Code auf der Kalkulator-Anfrage-Seite eingelöst, ist das Verhalten korrekt (Produkt-Isolation greift), aber die Weiterleitung gibt keinen Hinweis darauf, dass der Code für das andere Produkt gilt.
- **OP#1 (Kalkulator-Preis) bleibt weiterhin OFFEN — seit 26.07.2026 aber mit ENGERER Fragestellung.** Nicht mehr die allgemeine Frage „kostenlos oder verkauft": Der Zugang ist in der laufenden Betriebsphase auf handverlesene Betriebe beschränkt und wird per manuell ausgestelltem Gutscheincode vergeben (s. „Betriebsphase" im B10-Absatz). Zu entscheiden ist damit konkret: **OB der Zugang über diesen engen Kreis hinaus geöffnet wird, und zu welchem Preis.** Eine jüngste Äußerung deutet auf ein bezahltes Modell hin — hier ausdrücklich NICHT als Entscheidung eingetragen, nur als Beobachtung vermerkt.

---

## Offene Entscheidungen (blockieren die genannten Bausteine)

1. ~~Aufbewahrungsfrist und Löschkonzept für Leads → blockiert B1.~~ **ERLEDIGT mit B1 (21.07.2026):** 24 Monate ab letzter Interaktion für werbliche Leads — **„letzte Interaktion" heißt: eine tatsächliche Handlung der Person (abgesendetes Formular, bestätigte Einwilligung, Widerruf), ausdrücklich NICHT das Öffnen einer E-Mail oder ein Klick darin**; beides wird seit B2-2 dauerhaft nicht erhoben (s. Punkt „kein Öffnungs-/Klick-Tracking", `apps/web/Pflichtenheft_Website_Coolin.md` §19.2), und der Code hat es nie anders gemacht —, 7 Jahre ab Vertragsschluss als getrennte Rechtsgrundlage; die Frist wird nie von Hand gesetzt, sondern abgeleitet; Löschung erfolgt als Anonymisierung, die den Einwilligungsnachweis und die Sperrliste bewusst überleben lässt; ~~Durchsetzung manuell bis B4~~ **Durchsetzung seit B4-1 (22.07.2026) automatisch** (täglicher Cron 03:15 UTC → `platform.run_lead_retention`, mit Mengenobergrenze, die oberhalb des Schwellwerts VOLLSTÄNDIG verweigert). Ausformuliert in `apps/web/Pflichtenheft_Website_Coolin.md` §15.6.
2. ~~Double-Opt-in ja/nein → blockiert B1.~~ **ERLEDIGT mit B1 (21.07.2026): ja** — für jeden Zweck, dessen Erfüllung eine KÜNFTIGE E-Mail ist (Werbung und Vertragsablauf-Erinnerung), nicht für die einmalige Ergebniszusendung. Ausformuliert in §15.3 des Website-Pflichtenhefts.
3. Rechnungseingang: Weiterleitung an dedizierte Adresse (hält das Versprechen „keine Mitwirkung über das Weiterleiten hinaus", braucht Inbound-Mail-Infrastruktur — Resend kann nur SENDEN) vs. Upload im Kundenportal (deutlich billiger, Auth existiert, mehr Mitwirkung) → blockiert B8.
4. Einmalzahlung Netzentgelt-Check: Stripe-Einmalzahlung (heute NICHT gebaut, Stripe-Integration ist abo-only) vs. manuelle Rechnung. Empfehlung: manuell für 2026.
5. **UNVERÄNDERT OFFEN — blockiert B6.** E-Control-Widget: Cookie-Verhalten technisch prüfen → blockiert B6 UND potenziell die gesamte bannerlose Analytics-Architektur. Setzt das Widget Cookies, ist ein Cookie-Banner für die ganze Domain fällig; dann eher verlinken statt einbetten. (Die Analytics-Architektur ist inzwischen real cookielos umgesetzt — PostHog, `cookieless_mode`, kein Banner; das erhöht den Einsatz, es entscheidet ihn nicht.)
6. **UNVERÄNDERT OFFEN, seit B14-1 mit erweitertem Gegenstand.** Branchen-Benchmark aus Rechnungsdaten ist datenschutzrechtlich ein EIGENER ZWECK, nicht dieselbe Verarbeitung wie „ich prüfe Ihre Rechnung" — muss ab der ERSTEN Rechnung in AGB/AV-Vereinbarung abgedeckt sein. **Seit B14-1 betrifft derselbe Punkt zusätzlich den archivierten Lastgang:** Das Analyse-Archiv hält die Ursprungsdatei einer Kundenanalyse sieben Jahre vor. Sie zur Bildung von Branchenkennzahlen heranzuziehen, ist gegenüber „ich lege Ihre Batterie aus" ebenfalls ein eigener Zweck und von der Beauftragung nicht gedeckt — der Zweckbindungsvermerk dazu steht in `DEPLOYMENT.md` §6.
7. **NEU, aus B3-3.** Die **Branchenkennzahlen** (Vollbenutzungsstunden je Branche), ohne die der Betroffenheits-Check keine belastbare Auskunft geben kann, liegen nicht vor → blockiert B3-3. Owner: Martin. Bis dahin bleibt die Erfassungsstelle gebaut, aber nicht platziert (`apps/web/Pflichtenheft_Website_Coolin.md` §16.2).

---

## Fachliche Abhängigkeiten (Owner: Martin)

- Prüfregelwerk B7 als Fachdokument — HÄRTESTE Abhängigkeit des gesamten Plans. Was eine korrekte Netzentgelt-Abrechnung ausmacht, welche Blindarbeits-Positionen auffällig sind, wann eine vereinbarte Anschlussleistung unangemessen ist: das ist Fachwissen, nicht Code. Die Software drumherum ist vergleichsweise einfach.
- **Branchenkennzahlen (Vollbenutzungsstunden je Branche)** — blockiert B3-3; ohne sie bleibt der Betroffenheits-Check gebaut, aber unplatziert
- Batteriekatalog mit belastbaren Preisen
- Validierter Referenzfall mit echter Netzrechnung
- Rechtssicherer Einwilligungstext
- Geklärte Einbettungsbedingungen des E-Control-Widgets
- Echter CoolIn-Stripe-Account (Test-Account weiterhin in Verwendung)

---

## Neue Infrastruktur, die es heute nicht gibt

~~Zeitsteuerung (B4)~~ · Dateiablage (B8) · eingehende E-Mail (B8, falls Weiterleitung) · erste LLM-Anbindung im Produkt (B8) · **Massenversand** (B2-3) · Zeitreihen-Speicher (B12).

`[Nachtrag 24.07.2026]` **Die Zeitsteuerung existiert seit B4-1** (zwei tägliche Läufe, Laufprotokoll, 48-Stunden-Frühwarnung im Admin-Bereich) und ist damit keine neue Infrastruktur mehr. **Ein Dateiweg existiert seit B14-2 ebenfalls** — allerdings als Upload im Admin-Bereich in die Datenbank, nicht als Dateiablage im Sinne von B8.

`[Nachtrag 21.07.2026]` **Abmeldemechanismus und Suppression-Liste sind mit B1 bereits gebaut** und standen ursprünglich in dieser Zeile — offen ist nur noch der Massenversand selbst.

---

## Session-Einstieg — in dieser Reihenfolge lesen

1. Diese Datei (`Fahrplan_2026.md`) — kanonisch für alles Kommende
2. `README_Doku-Struktur.md` — Landkarte
3. Das Handover der betroffenen App (`apps/web/CLAUDE.md` bzw. Root-`CLAUDE.md`)
4. `DEPLOYMENT.md` — Env- und Dashboard-Stand

Die Monitor-Dokumente (`Pflichtenheft_Monitor_MVP.md`, `packages/tariff-monitor/CLAUDE.md`) sind RUHEND und nur historisch zu lesen.
