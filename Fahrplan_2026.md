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

Ein Pflichtenheft für den Rechnungs-Wächter (B7–B9) existiert bewusst NOCH NICHT. Es wird unmittelbar vor B7 geschrieben, wenn Martins Prüfregelwerk vorliegt — vorher wäre es Fiktion. Die fachliche Tiefe zu B1–B3 erweitert das Website-Pflichtenheft, zu B10/B11/B14 das Kalkulator-Pflichtenheft. **B1 ist dort nachgezogen: `apps/web/Pflichtenheft_Website_Coolin.md` §15** (Lead- und Einwilligungsverwaltung — Einwilligungsarchitektur, Wortlaute, Abmeldung/Sperre, Aufbewahrung und Anonymisierung, Grenzen des Admin-Bereichs).

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

## Bauabschnitte (neue Nummerierung B0–B15)

- **B0** Doku-Umstellung (diese Aufgabe)
- **B1** Lead- und Einwilligungsfundament — `platform.leads`, EIN Bestand mit Statuskennzeichen; MEHRERE zweckgebundene Einwilligungen je Lead über die Zeit (Vertragsablauf-Erinnerung ist NICHT Marketing-Einwilligung — anderer Zweck); versionierte Einwilligungstexte als eigene unveränderliche Datensätze, auf die der Einwilligungseintrag zeigt; Zeitpunkt + technische Herkunft; Herkunftskontext als PFLICHTFELD (welcher Artikel/welche Branche/welche Anleitung/welches Rechenergebnis/QR-Quelle); Double-Opt-in; Abmeldemechanismus; Admin-Abschnitt „Leads"; Kontaktformular schreibt mit. Additiv mandantenfähig VORBEREITET (kein `tenant_id` jetzt, aber ein Modell, das es ohne Umbau verträgt — die Fachbetriebs-Lizenz enthält „Lead-Verwaltung" für den Partner).
- **B3** Lead-Erfassungskomponente + erste Einsatzorte — EIN Backend, VIELE kontextspezifische Einstiegspunkte; kein überall gleiches Formular. Einbettbar in MDX-Artikel, Branchen-/Leistungsseiten, unter Rechnerergebnisse, als eigene Landingpage für den Postbrief-QR-Code. Wertleiter: anonym rechnen → E-Mail für Ergebnisdokument/Anleitung/Warteliste → Versorger+Ablaufdatum für echte Erinnerung → zahlen. Betroffenheits-Check (PLZ + Verbrauch + Branche → Betroffenheit ab 2027 + Lastspitzen-Größenordnung, deterministisch über Vollbenutzungsstunden; Segmentierung leistungsgemessen vs. Netzebene 7) ist der ERSTE Konsument dieser Komponente, nicht ihr Zweck. Der bestehende Schnellrechner (`components/quick-calculator.tsx`) ist die Ausgangsbasis.
- **B2** Segmentierung & Aussendung — gefilterte Sicht, Export/Versand, Suppression-Liste, Zustellprotokoll. Das ist die 48-Stunden-Aktivierung des Gesamtbestands zum Erscheinen der Tarifverordnung. Muss stehen, BEVOR der Bestand groß ist.

  **ERLEDIGT: B2-1 (23.07.2026, Bestand bearbeitbar machen — Segmentierungsfilter, Korrekturweg, Export samt Protokoll, ohne jeden Versand).** Damit ist der Bestand les- und korrigierbar; die Aussendung selbst (Kampagnenversand, Zustellprotokoll je Kampagne, Rückläufer- und Beschwerdeverarbeitung) bleibt B2-2 — der getrennte, unumkehrbare Teil. Mit B2-1 verlassen erstmals personenbezogene Daten den Wirkungsbereich des Systems dauerhaft (als Datei); die Sperrliste und anonymisierte Zeilen sind deshalb in der ABFRAGE ausgeschlossen und nicht in einer Einstellung, und jede Ausfuhr wird protokolliert. Details im Handover `apps/web/CLAUDE.md`.

  **`[Reihenfolge korrigiert 21.07.2026]` B3 wird VOR B2 gebaut.** B2 baut die gefilterte Sicht — aber die Filterdimensionen (Branche, Netzebene, PLZ) entstehen erst mit B3 und wurden in B1 ausdrücklich ausgeklammert. B2 vor B3 hieße, gegen nicht existierende Dimensionen und einen leeren Bestand zu bauen. Der ursprüngliche Grund für ein frühes B2 — es muss stehen, BEVOR der Bestand groß ist — bleibt unverändert gültig; er richtet sich gegen ein SPÄTES B2, nicht für ein sofortiges. B3 füllt den Bestand und definiert die Dimensionen, B2 wertet beides aus. **Die Nummern B2/B3 bleiben an ihren Inhalten** (sie sind in Migrationen, Code-Kommentaren und Handover-Logs als Bezeichner in Gebrauch); geändert ist allein die Baureihenfolge.
- **B4** Vertragsablauf-Erinnerung — Versorger + Ablaufdatum erfassen, Erinnerung 2–3 Monate vorher. Erster zeitgesteuerter Job im System. **ERLEDIGT: B4-1 (22.07.2026, Scheduling + Fristdurchsetzung, ohne jeden Versand) und B4-2 (22.07.2026, Erinnerung + Landingpage `/vertragsende-erinnerung`, acht Wochen Vorlauf, täglich 06:40 UTC).** Mit B4-2 versendet die Plattform erstmals automatisiert E-Mails an reale Personen; die Doppelversand-Sperre ist der Primärschlüssel `(lead_id, contract_end_date)`, nicht eine Prüfung im Anwendungscode. Details im Handover `apps/web/CLAUDE.md`.
- **B5** Förder-Check — IFB + EAG-Speicherförderung, rein deterministisch. Inhaltlich blockiert auf steuerliche Absicherung.
- **B6** E-Control-Widget + Netzbetreiber-Anleitungen (Wiener Netze, Netz NÖ, Netz Burgenland). Widget ERST nach technischer Prüfung des Cookie-Verhaltens (s. offene Entscheidungen).
- **B7** Rechnungs-Prüfregelwerk — deterministische Prüfungen auf strukturierten Rechnungsdaten: verrechnete Leistungsspitze, Angemessenheit der vereinbarten netzwirksamen Leistung (Mindestbemessung 20 %), Sommer-Nieder-Arbeitspreis (seit 01.04.2026, −20 % werktags 10–16 Uhr bei aktiver Viertelstundenauslesung), Blindarbeits-Positionen, korrekte Tarifzuordnung. Konfidenz-Flags. Dient BEIDEN Bezahlprodukten — der Einmal-Check ist der Einstiegsmonat des Abos, dieselbe Logik.

  VIER VERBINDLICHE SPEICHERREGELN (Datenoffenheit für künftige Produkte):
  1. Originalrechnung bleibt unverändert archiviert — spätere, bessere Extraktion muss die Historie neu auswerten können.
  2. Extraktion strikt getrennt von Interpretation: extrahierte Werte mit Extraktionsversion, Modell und Konfidenz JE FELD; Prüfregeln als eigene Schicht darüber. Neue Regeln müssen rückwirkend über den Gesamtbestand laufen können.
  3. ALLE Rechnungspositionen normalisiert erfassen, nicht nur die, die heutige Regeln brauchen.
  4. Jede Monatsrechnung ist eine unveränderliche Beobachtung mit Periodenbezug — nie überschreiben.
- **B8** Rechnungseingang + Extraktion — Eingangsweg, Dateiablage, KI-gestützte Extraktion AM RAND (Prinzip „KI an den Rändern, Determinismus im Kern" gilt unverändert: KI extrahiert, KI urteilt nicht).
- **B9** Rechnungs-Wächter als Abo (19 €/Monat) — Stripe-Produkt auf bestehender T4-Infrastruktur, Monatszyklus, Kundenbericht, Prüf-Queue im Admin AUSSCHLIESSLICH für Auffälligkeiten, Kundenbereich mit Berichtshistorie. BINDENDE KONSTRUKTIONSVORGABE: Bei 19 €/Monat darf keine Rechnung routinemäßig manuell geprüft werden — automatisiert, persönliche Prüfung nur bei ausgewiesener Auffälligkeit. Mengendimension (Zählpunkte/Standorte) beim Bau mitdenken, da Multi-Standort später darauf aufsetzt.
- **B10** Kalkulator ans Entitlement-System — Ablösung des separaten, DB-losen Zugangscodes (`lib/kalkulator-access.ts`). Vorbedingung für jede Fachbetriebs-Lizenz.
- **B11** Kalkulator auf Verordnungssätze umstellbar machen — Tarifsätze als konfigurierbare Datenschicht, damit Nov/Dez 2026 eine Konfigurationsänderung genügt statt eines Umbaus unter Zeitdruck.
- **B12** Datenanbindung Vortageswerte — Netzbetreiber-Schnittstelle, Zeitreihen-Speicher. Fundament für Peak-Wächter (Vortag), Wirkungsnachweis und Anomalie-Erkennung. Größter Einzelbaustein für 2027.
- **B13** Mandantenfähigkeit — `tenant_id` additiv in `platform.entitlements` und `platform.leads`. In T4-1 bewusst vorbereitet und zurückgestellt; bekommt mit der Fachbetriebs-Lizenz den ersten realen Anwendungsfall.
- **B14** Analyse-Persistenz Kalkulator — Auslegung und Prognose-Baseline serverseitig speichern. HOCH PRIORISIERT, MUSS VOR DER ERSTEN PILOTANALYSE STEHEN. Begründung: Das Alleinstellungsmerkmal des Wirkungsnachweises (29 €/Mon., ab Q1 2027) ist, dass nur COOLiN die Prognose-Baseline aus der Auslegung besitzt. Der Kalkulator speichert heute NICHTS serverseitig (localStorage; Supabase dort bewusst zurückgestellt). Jede Pilot- und 990-€-Analyse ohne B14 erzeugt eine Baseline, die verloren geht — ausgerechnet für die ersten Referenzkunden wäre der Wirkungsnachweis 2027 dann nicht lieferbar.
- **B15** Echtzeit-Datenpfad (Peak-Wächter Echtzeit, ab Q2 2027) — anderer Datenpfad als B12: Wechselrichter- bzw. Zähler-Kundenschnittstelle statt Netzbetreiber-API, plus Hardware.

---

## Angebotsportfolio 2026 (Kurzfassung, für Kontext beim Bauen)

Leitregel: kostenlos ist alles, was reine Rechenlogik oder Weiterleitung ist. Bezahlt wird, sobald ein Fachurteil auf echten Kundendaten stattfindet.

- **KOSTENLOS:** Betroffenheits-Check, Tarifvergleich (E-Control-Widget), Vertragsablauf-Erinnerung, Förder-Check, Netzbetreiber-Anleitungen, Erstgespräch.
- **BEZAHLT:** Netzentgelt- und Anschlussleistungs-Check (149–249 € einmalig), Rechnungs-Wächter (19 €/Mon.), Lastspitzen-Analyse (990 €), Projekt.

Lastspitzen-Analyse und Projekt sind KEINE Bauabschnitte — sie sind Datenarbeit (Batteriekatalog, Wiener-Netze-Methodik, echtes Lastprofil) und hängen an Martin.

---

## Offene Entscheidungen (blockieren die genannten Bausteine)

1. ~~Aufbewahrungsfrist und Löschkonzept für Leads → blockiert B1.~~ **ERLEDIGT mit B1 (21.07.2026):** 24 Monate ab letzter Interaktion für werbliche Leads, 7 Jahre ab Vertragsschluss als getrennte Rechtsgrundlage; die Frist wird nie von Hand gesetzt, sondern abgeleitet; Löschung erfolgt als Anonymisierung, die den Einwilligungsnachweis und die Sperrliste bewusst überleben lässt; ~~Durchsetzung manuell bis B4~~ **Durchsetzung seit B4-1 (22.07.2026) automatisch** (täglicher Cron 03:15 UTC → `platform.run_lead_retention`, mit Mengenobergrenze, die oberhalb des Schwellwerts VOLLSTÄNDIG verweigert). Ausformuliert in `apps/web/Pflichtenheft_Website_Coolin.md` §15.6.
2. ~~Double-Opt-in ja/nein → blockiert B1.~~ **ERLEDIGT mit B1 (21.07.2026): ja** — für jeden Zweck, dessen Erfüllung eine KÜNFTIGE E-Mail ist (Werbung und Vertragsablauf-Erinnerung), nicht für die einmalige Ergebniszusendung. Ausformuliert in §15.3 des Website-Pflichtenhefts.
3. Rechnungseingang: Weiterleitung an dedizierte Adresse (hält das Versprechen „keine Mitwirkung über das Weiterleiten hinaus", braucht Inbound-Mail-Infrastruktur — Resend kann nur SENDEN) vs. Upload im Kundenportal (deutlich billiger, Auth existiert, mehr Mitwirkung) → blockiert B8.
4. Einmalzahlung Netzentgelt-Check: Stripe-Einmalzahlung (heute NICHT gebaut, Stripe-Integration ist abo-only) vs. manuelle Rechnung. Empfehlung: manuell für 2026.
5. E-Control-Widget: Cookie-Verhalten technisch prüfen → blockiert B6 UND potenziell die gesamte bannerlose Analytics-Architektur. Setzt das Widget Cookies, ist ein Cookie-Banner für die ganze Domain fällig; dann eher verlinken statt einbetten.
6. Branchen-Benchmark aus Rechnungsdaten ist datenschutzrechtlich ein EIGENER ZWECK, nicht dieselbe Verarbeitung wie „ich prüfe Ihre Rechnung" — muss ab der ERSTEN Rechnung in AGB/AV-Vereinbarung abgedeckt sein.

---

## Fachliche Abhängigkeiten (Owner: Martin)

- Prüfregelwerk B7 als Fachdokument — HÄRTESTE Abhängigkeit des gesamten Plans. Was eine korrekte Netzentgelt-Abrechnung ausmacht, welche Blindarbeits-Positionen auffällig sind, wann eine vereinbarte Anschlussleistung unangemessen ist: das ist Fachwissen, nicht Code. Die Software drumherum ist vergleichsweise einfach.
- Batteriekatalog mit belastbaren Preisen
- Validierter Referenzfall mit echter Netzrechnung
- Rechtssicherer Einwilligungstext
- Geklärte Einbettungsbedingungen des E-Control-Widgets
- Echter CoolIn-Stripe-Account (Test-Account weiterhin in Verwendung)

---

## Neue Infrastruktur, die es heute nicht gibt

Zeitsteuerung (B4) · Dateiablage (B8) · eingehende E-Mail (B8, falls Weiterleitung) · erste LLM-Anbindung im Produkt (B8) · **Massenversand** (B2) · Zeitreihen-Speicher (B12).

`[Nachtrag 21.07.2026]` **Abmeldemechanismus und Suppression-Liste sind mit B1 bereits gebaut** und standen ursprünglich in dieser Zeile — offen ist nur noch der Massenversand selbst.

---

## Session-Einstieg — in dieser Reihenfolge lesen

1. Diese Datei (`Fahrplan_2026.md`) — kanonisch für alles Kommende
2. `README_Doku-Struktur.md` — Landkarte
3. Das Handover der betroffenen App (`apps/web/CLAUDE.md` bzw. Root-`CLAUDE.md`)
4. `DEPLOYMENT.md` — Env- und Dashboard-Stand

Die Monitor-Dokumente (`Pflichtenheft_Monitor_MVP.md`, `packages/tariff-monitor/CLAUDE.md`) sind RUHEND und nur historisch zu lesen.
