# Pflichtenheft: Zugangsplattform Wechselrichter-Fernzugriff (MVP)

> **Session-Handover-Dokument** — Start eines Pflichtenhefts, geschrieben aus
> einer strategischen Diskussion heraus, NICHT aus einer Bau-Session. Dient
> als Ausgangspunkt für die Bau-Session, in der die Plattform tatsächlich
> gebaut wird — analog zu `Pflichtenheft_Kalkulator_MVP.md` und
> `Pflichtenheft_Monitor_MVP.md`.
>
> **v3 — Stand: August 2026.** Aus der ersten Konzept-Diskussion der
> Bau-Session heraus aktualisiert, vor dem ersten CC-Prompt. Gegenüber v2:
> Rollenmodell festgelegt — Firmenadmin / Techniker / Prüfer (§6.2), rechtlich
> hergeleitet aus dem NISG-2026-Maßnahmenkatalog (§2.4). Betreiber-Referenz
> von „ggf." zu Pflichtfeld (§6.2). Datenmodell generalisiert auf ein
> anbieter- und objekttyp-offenes „Zugriffsobjekt" bei weiterhin einziger
> konkreter Anbindung Teltonika — neuer Architekturgrundsatz „generisches
> Rückgrat, konkrete Anbindung" (§6.2, §8). Objekt-Zuordnung
> Installateur↔Betreiber zeitlich befristet statt fix (§6.2). Protokollierung
> auf zwei getrennte Append-only-Ledger erweitert — Zugriff **und**
> Berechtigung (§6.4), direkt aus der Nachweispflicht des Betreibers
> abgeleitet (§2.6). Keine harten Preisstufen-Limits, dafür vollständige
> Kostenzuordnung pro Objekt (§6.5). Bau-Reihenfolge für den ersten CC-Prompt
> präzisiert (§6). **§2 grundlegend überarbeitet und korrigiert:** rechtlicher
> Status NISG 2018 (aktuell gültig) vs. NISG 2026 (Novelle, ab 01.10.2026)
> sauber getrennt — eine Verwechslung dazu ist in der Recherche zu diesem
> Dokument selbst passiert und wird dort offengelegt statt verschwiegen —,
> Zeitplan, Zahl der betroffenen Organisationen korrigiert (quellenbasiert),
> konkreter Maßnahmenkatalog, Klarstellung, dass die Nachweispflicht
> rechtlich beim Betreiber liegt, nicht bei COOLiN oder dem Installateur
> direkt.
>
> Sprache: Deutsch (Projektsprache). **Technischer Weg: Teltonika only** als
> konkrete Anbindung — das Datenmodell selbst ist bewusst anbieteroffen
> gehalten, s. §8. Ewon/Talk2M wurde geprüft, verglichen, bewusst nicht
> gewählt.

---

## 0. Einordnung: eigenständiges drittes Produkt

Dies ist **nicht** dasselbe Produkt wie der Haushalts-Energiemonitor
(`Pflichtenheft_Monitor_MVP.md`) und **nicht** dasselbe wie das Partner-Portal.
Eigene Subdomain, eigene Bau-Session — siehe §8 für die Architektur-Entscheidung.

**Produktname (Arbeitstitel):** Zugangsplattform — noch nicht final benannt.

**Bewusst objekttyp-offen gehaltener Name:** „Zugangsplattform" nennt weder
Gerät noch Hersteller — passt zum Datenmodell-Grundsatz aus §8 (das
Rückgrat ist generisch, s. §6.2). Für den MVP ändert das nichts an
Zielkunde und Vertriebsfokus (§7.1): PV-Installateur, Wechselrichter,
Teltonika. Die Offenheit ist eine strukturelle Vorsichtsmaßnahme im
Datenmodell, keine Erweiterung des aktuellen Verkaufsversprechens.

---

## 1. Problem & Ausgangslage

Wechselrichter (SMA, Fronius, Huawei u. a.) werden über ein Installateurspasswort
verwaltet, das bei vielen Herstellern **nicht personengebunden** ist — bei SMA ist
das Passwort der Rolle „Installateur" zugleich das Anlagenpasswort; alle Geräte mit
demselben Passwort bilden eine Anlage.

**Konsequenzen:**
- Volle Rechte für jeden, der das Passwort kennt (Daten lesen UND netzrelevante
  Parameter verstellen)
- Keine Protokollierung, wer was geändert hat
- Kein Zugriffsentzug bei Mitarbeiterwechsel — das Passwort bleibt im Umlauf

**Kein theoretisches Risiko:** Forescout fand 46 Schwachstellen in Wechselrichtern
von SMA, Sungrow und Growatt; eine Folgeanalyse fand 35.000 Geräte weltweit mit
offenem Management-Interface im Internet, 76 % davon in Europa. Die
niederländische Aufsichtsbehörde RDI fand: 0 von 9 geprüften Wechselrichtern
erfüllten die Sicherheitsanforderungen.

---

## 2. Regulatorischer Kontext — NISG 2026 (überarbeitet und korrigiert, August 2026)

### 2.1 Rechtlicher Status: zwei Gesetze, nicht eines

**Wichtig für alle, die später mit diesem Dokument oder dem RIS-PDF im
Projektordner arbeiten** — eine Verwechslung dazu ist in der Recherche zu
dieser Version selbst passiert und wird hier festgehalten, damit sie sich
nicht wiederholt:

- **NISG 2018** (BGBl. I Nr. 111/2018) — **aktuell geltendes Recht**, bis
  30.09.2026. Betrifft rund 100 Unternehmen (kritische Infrastruktur,
  Anbieter digitaler Dienste). Enthält **keine** der unten genannten
  Pflichten (Risikomanagement, Zugriffskontrolle, MFA, Lieferkette) — die
  existieren in diesem Gesetzestext schlicht noch nicht.
- **NISG 2026** (Novelle, BGBl. I Nr. 94/2025, kundgemacht 23.12.2025) —
  **tritt am 01.10.2026 in Kraft**, löst NISG 2018 an diesem Tag ab. Setzt
  die NIS-2-Richtlinie ((EU) 2022/2555) um. Enthält alle unten
  beschriebenen Pflichten.

**Das RIS-PDF im Projektordner**
(`RIS__Netz_und_Informationssystemsicherheitsgesetz...pdf`) zeigt die
„geltende Fassung" zum Zeitpunkt seiner Erstellung. Solange dieser Zeitpunkt
vor dem 01.10.2026 liegt, ist das **korrekt der NISG-2018-Text** — kein
Fehler in der Datei, sondern exakt das, was „geltende Fassung" bedeutet:
was heute gilt, nicht was demnächst gilt. Der Hinweis „Änderung BGBl. I Nr.
94/2025" im Dokumentkopf ist der korrekte Verweis auf die bereits
beschlossene, aber noch nicht wirksame Novelle. **Für die Substanz unten
wurde die Novelle separat recherchiert** (Quellen s. §10); der Volltext der
Novelle selbst ist über RIS für automatisierten Zugriff gesperrt
(robots.txt) — manueller Abruf im Browser:
`ris.bka.gv.at/Dokumente/BgblAuth/BGBLA_2025_I_94/BGBLA_2025_I_94.pdf`
(37 Seiten, authentischer Text). Nützlich spätestens für den Anwaltstermin
zur AGB-Haftungsverteilung, s. §9.

### 2.2 Zeitplan

| Datum | Ereignis |
|---|---|
| 23.12.2025 | Kundmachung NISG 2026 im Bundesgesetzblatt |
| 01.10.2026 | Inkrafttreten. NISG 2018 tritt zeitgleich außer Kraft. Risikomanagementmaßnahmen inkl. Lieferkette und Meldepflichten gelten ab hier. |
| 31.12.2026 | Registrierungspflicht für wesentliche/wichtige Einrichtungen |
| 30.09.2027 | Selbstdeklaration der umgesetzten Risikomanagementmaßnahmen fällig |
| ab 01.10.2028 | frühester Zeitpunkt, ab dem die Cybersicherheitsbehörde zur Prüfung/zum Nachweis auffordern kann |

Für unser Verkaufsfenster heißt das: Vorbereitungsdruck beim Kunden entsteht
real ab Herbst 2026 und verschärft sich Richtung Selbstdeklaration Mitte
2027. Deckt sich brauchbar mit dem NE7-Fahrplan der Schwesterprodukte.

### 2.3 Betroffene Organisationen — Zahl korrigiert

**Die vorherige Angabe in diesem Dokument („steigt von ~1.000 auf ~5.000")
war unbelegt und wird hier durch eine quellenbasierte Zahl ersetzt:**
Aktuell (NISG 2018) rund 100 Unternehmen in Österreich. Ab 01.10.2026
(NISG 2026) rund 4.000 Unternehmen und Einrichtungen ab mittlerer Größe aus
18 Sektoren. Falls die alte Zahl aus einer bekannten, belastbaren Quelle
stammt, bitte gegenprüfen — diese Korrektur beruht auf einer einzelnen,
wenn auch reputablen Quelle (WKO, in Kooperation mit der NIS-Behörde/BMI).

Größenschwelle „mittleres Unternehmen": ab 50 Mitarbeitern ODER
Jahresumsatz über 10 Mio. € UND Bilanzsumme über 10 Mio. €. Für unseren
Zielkunden (§7.1, Installateur-Betriebe, meist klein) heißt das: **die
Installateure selbst fallen fast nie direkt unter NISG 2026.** Ihre Kunden
(Bäckerei, Hotel, Kälteanlagenbetreiber als Teil eines größeren
Unternehmens etc.) können aber sehr wohl darunterfallen — genau der in §7.4
beschriebene Lieferketten-Hebel, jetzt mit Zahlen unterlegt statt nur
behauptet.

### 2.4 Relevante Pflichten — nur was für dieses Produkt zählt

Das Gesetz verlangt Risikomanagementmaßnahmen. Für dieses Produkt zählen
vier Punkte aus dem vollständigen Katalog:

- Konzepte zu **Rollen, Verantwortlichkeiten und Weisungsbefugnissen**
- Sicherheit der **Lieferkette** der unmittelbaren Anbieter/Dienstleister
- Sicherheit des Personals, **Konzepte für die Zugriffskontrolle** und
  Management von Anlagen
- **Multi-Faktor-Authentifizierung oder kontinuierliche Authentifizierung**

Diese vier Punkte sind fast wörtlich das, was §6.2 (Rollenmodell) und §6.4
(Protokollierung) dieses Dokuments technisch umsetzen — nicht zufällig,
die Produktentscheidung wurde bewusst an diesem Katalog ausgerichtet.

Für digitale Sektoren gibt es eine konkretere EU-Durchführungsverordnung
((EU) 2024/2690) samt ENISA-Leitlinien; für alle anderen Sektoren wird eine
nationale Verordnung erwartet, die sich voraussichtlich daran orientiert.
Für ein wirklich belastbares Zugriffskontroll-/Sitzungsmanagement-Konzept
(privilegierte Konten, Sitzungsverwaltung) wäre eine Vertiefung dort der
nächste Rechercheschritt — bewusst nicht Teil dieses Dokuments, sondern
offener Punkt (§9).

### 2.5 Wesentliche vs. wichtige Einrichtungen, Sanktionen, Geschäftsleitung

Der Unterschied liegt bei Aufsicht und Nachweis, nicht bei den Pflichten
selbst:

| | Wesentliche Einrichtung | Wichtige Einrichtung |
|---|---|---|
| Aufsicht | anlasslos (ex-ante) + ex-post | nur ex-post, nur bei begründetem Verdacht |
| Nachweisfrist ab Aufforderung | 2 Jahre (technisch), 2 Monate (operativ/organisatorisch) | 2 Jahre |
| Sanktionsrahmen | bis 10 Mio. € oder 2 % Jahresumsatz | bis 7 Mio. € oder 1,4 % Jahresumsatz |

**Die Geschäftsleitung haftet persönlich** und muss die Umsetzung aktiv
überwachen — nicht nur formal verantworten —, inklusive verpflichtender
eigener Cybersicherheitsschulung. Aus zwei unabhängigen Quellen mit
identischer Aussage bestätigt (s. §10).

### 2.6 Wer die Dokumentations- und Nachweispflicht tatsächlich trifft

**Rechtlich: den Betreiber (den NISG-pflichtigen Endkunden), nicht COOLiN
und in aller Regel nicht den Installateur direkt.** Der Betreiber muss der
Cybersicherheitsbehörde die Selbstdeklaration übermitteln und auf
Aufforderung den Nachweis der Risikomanagementmaßnahmen erbringen (§2.2,
§2.5). Bis zum Installateur kommt die Pflicht nur über den vertraglichen
Lieferketten-Hebel: der Betreiber muss die Cybersicherheitspraxis seiner
unmittelbaren Dienstleister berücksichtigen — in der Praxis heißt das, er
fragt seinen Installateur, und der Installateur muss liefern können.

**Konsequenz für den Bau, direkt umgesetzt in §6.4:** Die Plattform baut
keine Meldefunktion an eine Behörde. Sie baut das Beweisstück, das der
Installateur seinem Betreiber-Kunden liefert, wenn dessen Auditor fragt —
zwei getrennte, unveränderliche Protokolle statt eines, s. §6.4.

---

## 3. Marktgröße (mit Quellenlage, keine erfundene Präzision)

**Zur Abgrenzung:** Die Zahlen hier betreffen den Zielkunden — die
Installateure. Das ist eine andere Grundgesamtheit als die NISG-2026-
regulierten Organisationen aus §2.3 (das sind die Kunden der Installateure,
nicht die Installateure selbst).

**Gesamtbestand PV-Anlagen Österreich:** ~550.000–600.000, grob hochgerechnet aus
E-Control-Eckwerten (250.000 Zählpunkte Ende 2022, +138.000 in 2023, +62.300 in
2025 — 2024 nicht belastbar gefunden). **Keine offizielle Gesamtsumme**, eigene
Rechnung.

**Wichtig:** Die „97 % Niederspannungsebene"-Zahl taugt NICHT als Trennlinie
Privat/Gewerbe — Gewerbe/Werkstatt/Bäckerei hängen laut COOLiNs eigener
NE7-Terminologie selbst am Niederspannungsnetz.

**Relevanter für dieses Produkt — die Installateure (der eigentliche Zielkunde,
siehe §7.1):**
- 7.700 Elektrotechnik-Arbeitgeberbetriebe gesamt (Bundesinnung, fast
  durchwegs Klein-/Mittelbetriebe) — breite Basis, nicht alle PV-aktiv
- 450+ Mitglieder Photovoltaic Austria — ACHTUNG: inkl. aller 9 Landesinnungen
  als Bulk-Mitglieder, nicht 450 Einzelfirmen
- **250+ zertifizierte „SolarPartner"-Betriebe** (Erneuerbare Energie
  Österreich) — bislang präzisester Wert für „ernsthaft PV-aktiv"
- Erkennbare Spitzengruppe von ~200 großen Betrieben (kommerzielle
  „Top-200"-Liste)

**Grobe Schätzung, als Schätzung markiert:** 500–1.500 realistisch adressierbare
PV-aktive Installationsbetriebe, davon ~200–300 groß genug für die oberen
Preisstufen.

**Weiterhin offene Lücke:** Wie viele Anlagen ein Installateur im Schnitt
betreut, ist nirgends veröffentlicht. **Empfehlung unverändert:** Martin fragt
5–10 Installateure aus seinem Netzwerk direkt.

---

## 4. Gewähltes technisches Konzept — Teltonika only

### 4.1 Hardware: Teltonika RUT200 (Standard), RUT301 (Alternative)

**RUT200 bestellt.** Zur Klarstellung, da anfangs missverständlich diskutiert:
Der RUT200 gibt es **nicht in einer Variante ohne WLAN** — WLAN ist serienmäßig
immer dabei, keine „nur LTE"-Bestellvariante existiert. Der tatsächliche
WLAN-lose Bruder in der Teltonika-Familie heißt **RUT230**, ist aber für dieses
Projekt nicht relevant.

| | RUT200 | RUT301 |
|---|---|---|
| Uplink | 4G LTE (Cat4) + WLAN + 2× Ethernet, WAN-Failover | nur Ethernet (5 Ports), kein Mobilfunk |
| Preis (Richtwert) | ~100–115 € | ~63 € exkl. USt |
| Empfehlung | **Standard** — s. u. zur Netzwerk-Unabhängigkeit | Fallback bei Kostenfokus |

**WLAN-Client-Modus VERIFIZIERT (war in v1 offen):** RUT200 kann sich per
„WiFi WAN" bei einem bestehenden WLAN einwählen (Interface wird von LAN auf WAN
umgestellt, Scan-Funktion, Passworteingabe) — offiziell in Teltonikas Wiki
dokumentiert. Damit sind für die Internetanbindung drei Wege möglich: SIM,
Ethernet-WAN, WLAN-Client.

**Wichtige, geschäftskritische Erkenntnis zur Wahl des Uplinks — bitte bei der
Konfiguration jedes Kundengeräts bewusst entscheiden, nicht dem Zufall
überlassen:**

Nur die **SIM-Verbindung** ist wirklich unabhängig vom Kundennetz. Sobald die
Box per Ethernet oder WLAN am Kundenrouter hängt, ist sie **Teil desselben
Netzwerks** wie alles andere beim Kunden — inklusive dessen eigener
Schwachstellen. Das untergräbt das zentrale Verkaufsargument aus §7.4 („unsere
Box hängt nicht im Netzwerk Ihres Kunden").

- **Für internes Testen/Entwicklung:** Ethernet oder WLAN reichen völlig aus,
  keine SIM nötig — es wird Software getestet, nicht das
  Netzwerk-Isolations-Versprechen.
- **Für Kundenproduktion:** SIM sollte die **primäre** Verbindung sein, damit
  das Verkaufsversprechen tatsächlich eingehalten wird, nicht nur behauptet.
  Ethernet/WLAN allenfalls als WAN-Failover (Rückfallebene), nicht als
  Normalbetrieb — sonst gilt die Netzwerk-Trennung nur in Ausnahmefällen.
- Denkbare spätere Produktidee (nicht jetzt zu entscheiden): eine günstigere
  „Basic"-Stufe explizit mit Kundennetz-Anbindung, klar kommuniziert als
  „im Kundennetz, kein isolierter Zugang", neben der vollwertigen SIM-Variante.

### 4.2 Cloud-Schicht: Teltonika RMS — NICHT self-hosted

- **RMS läuft bei Teltonika selbst auf AWS** (offiziell bestätigt: „RMS is
  hosted on AWS").
- **„Private RMS" (On-Premise-Variante) wurde geprüft und verworfen.** Keine
  öffentlich verfügbaren technischen Spezifikationen gefunden; würde zudem
  Betriebsverantwortung für fremde Software auf COOLiN übertragen.
- **Stattdessen: Integration über die offizielle RMS-API**
  (`wiki.teltonika-networks.com/view/RMS_API`), explizit dafür gebaut, RMS-
  Funktionen in eine **eigene** Plattform/Oberfläche einzubetten. Zwei zentrale,
  bestätigte Fähigkeiten: befristete Connect-Links per API erzeugen (= „Tunnel
  nur für diese Sitzung"), Lizenzzuweisung per API automatisieren.

**Noch zu tun, vor Bau-Beginn:** volle Endpoint-Dokumentation der RMS-API im
Detail einsehen — bewusst Aufgabe der Bau-Session, nicht dieses Dokuments.
Dabei auch klären: kann ein Connect-Link vorzeitig widerrufen werden oder
läuft er nur ab (s. §9) — entscheidet, ob „Entzug bei Mitarbeiterwechsel"
sofort oder verzögert wirkt.

#### 4.2.1 Kostenstruktur — WICHTIGE PRÄZISIERUNG gegenüber v1

**Management-Lizenz und Connect/VPN-Datenvolumen sind zwei komplett getrennte,
unabhängig abgerechnete Dinge.** Das war in v1 vermischt („8 €/Jahr/Gerät" ohne
diese Unterscheidung) — hier die korrekte, vollständige Aufschlüsselung:

**a) Management-Lizenz** — macht ein Gerät im RMS-Portal sichtbar/verwaltbar
(Online-Status, Firmware-Updates, Konfigurationsänderungen, Alarme). **Enthält
KEIN Datenvolumen für tatsächlichen Fernzugriff.**
- 5-Jahres-Lizenz, 1 Gerät: **40 € exkl. USt** (= 8 €/Jahr/Gerät), Artikel
  RMSMP0500000. Bestätigte Produkt-URL:
  `https://www.capestone.com/en/product/teltonika-rms-5-year/`
- Bleibt bis weit über 100 Anlagen/Installateur günstiger als eine
  Talk2M-Pro-Flatrate wäre — wirtschaftliche Grundlage für die Preisstaffel
  in §7.2 bestätigt.

**b) Connect/VPN-Datenvolumen** — wird verbraucht, sobald jemand tatsächlich
über den Tunnel auf den Wechselrichter zugreift (jede Sitzung zählt).
- **Jedes neue Firmenkonto erhält einmalig 5 GB gratis** (kein monatliches
  Geschenk — ein einmaliger, kontoweiter Topf).
- Danach: separates Datenpaket nötig, z. B. **150 GB, 10 Jahre, 1 Gerät:
  £34,29 exkl. USt (≈ 40 €)**, Artikel RMSDT101G150. Bestätigte Produkt-URL:
  `https://capestone.com/en/product/150gb-data-for-rms-connectvpn/`
  Entspricht im Schnitt ~1,25 GB/Monat — für reguläre Fernwartung mehr als
  ausreichend, außer bei regelmäßig großen Dateiübertragungen.

**c) Einzel-Credits** — flexible dritte Option, ~2,50 €/Credit. Ein Credit
kann **wahlweise** 30 Tage Management **oder** 2 GB Connect-Daten sein — **nicht
beides gleichzeitig aus einem Credit.** Pool verfällt nicht. Sinnvoll für kurze
Testphasen oder zur Überbrückung, bevor feststeht, ob ein Gerät dauerhaft
bleibt — nicht wirtschaftlich für Langzeitbetrieb (2,50 € × 12 = 30 €/Jahr vs.
8 €/Jahr bei der 5-Jahres-Lizenz).

**Gesamtkosten pro Produktivgerät, einmalig: rund 80 €** (40 € Management +
40 € Datenpaket) für 5–10 Jahre Betrieb. **Eingeordnet:** Bei einer
Servicegebühr von 69–599 €/Monat (§7.2) ist das keine Kostenfrage, die eine
Grundsatzentscheidung (z. B. „selbst bauen statt Teltonika nutzen") rechtfertigt
— das wurde explizit durchgerechnet und verworfen, s. §5.

**30-Tage-Testphase bei Kontoregistrierung:** Laut Händlerangabe (Capestone),
**nicht direkt in Teltonikas eigener Primärdokumentation gefunden** — mit
entsprechender Vorsicht behandeln. Verlässlichster Weg: nach Registrierung
direkt im RMS-Dashboard nachsehen, was an Guthaben/Testzeitraum tatsächlich
angezeigt wird.

#### 4.2.2 Registrierungsablauf (Kurzreferenz)

1. Router physisch verbinden (Ethernet an „LAN1" oder per WLAN-Aufkleber-Login),
   lokale WebUI öffnen — startet Einrichtungsassistent
2. Assistent durchlaufen (Passwort setzen, Zeitzone), beim RMS-Schritt
   **„Enabled" belassen** (Werkseinstellung)
3. RMS-Konto anlegen unter `rms.teltonika-networks.com` (jederzeit möglich,
   kostenlos, startet keine Frist)
4. Im RMS-Portal: „Add Device" → „Get Token"
5. Im Router-WebUI: Services → Cloud Solutions → RMS → Token eintragen → Save
6. Router erscheint nach 1–2 Minuten im Portal als „Online"

**Hintergrund:** Werkseitig versucht ein neuer Router 14 Tage lang automatisch
alle 2–5 Minuten, eine RMS-Verbindung herzustellen — muss also nicht sofort
klappen.

**Bestätigt (RMS-Produktbeschreibung):** RMS ermöglicht Fernzugriff auch auf
Geräte, die NICHT von Teltonika stammen, sofern sie am LAN-Port eines
RMS-verwalteten Routers hängen — der Wechselrichter wird also exakt wie
angenommen als gewöhnliches „verbundenes Gerät" behandelt.

### 4.3 Architekturfluss (Kurzform, unverändert)

```
Installateur → Login + TOTP bei COOLiN
             → COOLiN prüft: Zugriff auf GENAU diese Anlage?
             → COOLiN ruft RMS-API: Connect-Link für diese Sitzung erzeugen
             → Techniker erhält befristeten Link, verbindet sich
             → RMS (Teltonika, AWS) vermittelt zur RUT200 beim Kunden
             → RUT200 ↔ Wechselrichter (unverändert, kein Eingriff)
             → COOLiN protokolliert: wer, wann, welche Anlage
```

---

## 5. Was COOLiN NICHT baut

- Die Box (RUT200/RUT301) — kauft der Betreiber
- Die Tunnel-/VPN-Technik — liefert Teltonika RMS
- Das Hosting der Vermittlungsschicht — läuft bei Teltonika auf AWS

**Diese Entscheidung wurde explizit gegengerechnet und bestätigt** (nicht nur
angenommen): Ein Eigenbau der Tunnel-Infrastruktur wurde als Option erneut
durchdacht, nachdem die getrennte Kostenstruktur (§4.2.1) zunächst nach mehr
Komplexität aussah. Ergebnis: ~80 € Gesamtkosten pro Gerät sind trivial
gegenüber dem Betriebsrisiko eines eigenen 24/7-Cloud-Vermittlers (SPOF,
eigenes Angriffsziel, benötigte OT-Security-Kompetenz, die aktuell nicht im
Haus ist). Bei Teltonika bleiben — bestätigte Entscheidung, kein offener Punkt.

---

## 6. Was COOLiN baut — sechs Bausteine

**Wichtig für die Bau-Reihenfolge — wann wird die Hardware tatsächlich
gebraucht:** Nicht von Anfang an. Bausteine 6.1, 6.2, 6.5, 6.6 lassen sich
vollständig ohne registrierten Router entwickeln und testen (Auth-Logik,
Datenmodell mit Platzhalter-Geräte-ID, Stripe-Anbindung, Dashboard-UI gegen
Testdaten). **Erst Baustein 6.3 (RMS-API-Integration) und der vollständige
End-zu-Ende-Test von 6.4 brauchen ein tatsächlich registriertes Gerät.** Ein
kostenloses RMS-Konto kann trotzdem schon früh angelegt werden (keine Frist
startet dadurch), um API-Zugang und Dokumentation vorzubereiten.

**Reihenfolge für die Bau-Session festgelegt (August 2026):** Erster
CC-Prompt = 6.2 allein, reines Datenbankschema + RLS, kein UI — Schema-first,
gleiches Vorgehen wie beim Kalkulator. 6.1 (kein Neubau, bestehende
Supabase-Auth wird nur verdrahtet) zusammen mit 6.6 (Dashboard-Skeleton gegen
Testdaten) als zweiter Prompt. 6.5 (Stripe) als dritter. 6.3/6.4 erst, sobald
ein Gerät real registriert ist.

### 6.1 Login + MFA
**Kein Neubau.** Gleiche Auth-Schicht wie für Pro-Kalkulator und Haushalts-Monitor
geplant (Supabase Auth). Ein System für alle COOLiN-Produkte.

### 6.2 Datenmodell (überarbeitet, August 2026)

**Kern, generalisiert:** `Installateur` (Firma) → `Person` (Nutzer, gehört
zu einem Installateur, trägt genau eine Rolle) → `Zugriffsobjekt`
(Objekttyp + Anbieter + anbieterseitige Referenz; gehört dem **Betreiber**,
nicht dem Installateur) → zeitlich befristete **Zuweisung** zwischen
Installateur und Zugriffsobjekt (nicht fix).

**Warum generalisiert statt „Anlage mit RUT200-ID":** Absehbar, dass künftig
andere Hardware oder andere Zugriffsarten dasselbe Grundproblem haben
(anderes Gewerk, anderer Hersteller, ein Herstellerportal statt eines
Tunnels). Das Rückgrat — Organisation → Person → Rolle → Berechtigung auf
ein Objekt → befristete Sitzung → unveränderliches Protokoll — ist davon
unabhängig und wird deshalb jetzt generisch gebaut, nicht erst beim zweiten
Anwendungsfall nachgezogen. **Bewusst NICHT generalisiert: die
Anbieter-Anbindung selbst.** Eine Schnittstelle, eine Implementierung
(Teltonika/RMS), kein Plugin-Framework, keine Registry für „künftige
Anbieter" — das wäre Abstraktion über eine Stichprobe von genau einem
Hersteller, dessen API wir noch nicht einmal vollständig gelesen haben
(§9). Abstrahiert wird, wenn ein zweiter Anbieter real ist, mit echten
Datenpunkten statt geratenen. Näher begründet in §8.

**Betreiber-Referenz: Pflichtfeld, nicht optional** (Korrektur gegenüber
v2, dort „ggf."). Begründung: Der eigentliche Verkaufsgegenstand ist laut
§7.4 die Zuordnung zu einem konkreten Endkunden/einer Compliance-Akte,
nicht der Zugang selbst. Ohne verpflichtende Betreiber-Referenz kann die
Plattform genau diesen Nachweis nicht liefern und wäre technisch nur eine
Oberfläche über RMS — das Verkaufsargument aus §7.4 würde entfallen.

**Objekt-Zuordnung zeitlich befristet, nicht fix:** Ein Zugriffsobjekt
gehört dauerhaft dem Betreiber; die Zuweisung an einen Installateur trägt
einen Gültigkeitszeitraum. Grund: Installateurwechsel beim Endkunden kommt
vor. Bei fixer Zuordnung würde das Protokoll (§6.4) genau in dem Moment
seine Aussagekraft verlieren, in dem sie am wichtigsten wäre — und die
Nachweispflicht des Betreibers (§2.6) liefe ins Leere. Jede Neu- oder
Umzuweisung ist ein Eintrag im Berechtigungsprotokoll (§6.4), kein bloß
geändertes Feld.

**Rollenmodell (neu, ersetzt die bisherige Einzel-Rolle „Techniker"):**
Rechtlich hergeleitet aus dem NISG-Katalog (§2.4: „Rollen, Verantwortlich-
keiten und Weisungsbefugnisse", „Konzepte für die Zugriffskontrolle") — mit
nur einer Rolle ist das nicht nachweisbar, weil jeder Techniker jedem
anderen Zugriff erteilen könnte, was das Grundproblem aus §1 auf einer
anderen Ebene neu schafft.

- **Firmenadmin** — verwaltet Personen im eigenen Konto, vergibt/entzieht
  Objektzuweisungen, sieht Abrechnung. Kann sich selbst die Rolle nicht
  entziehen, ohne dass ein anderer Firmenadmin existiert (verhindert
  Aussperrung).
- **Techniker** — kann ausschließlich Zugriffssitzungen auf ihm/ihr
  zugewiesene Objekte anfordern. Kann weder Personen noch Zuweisungen
  verwalten.
- **Prüfer** (nur lesend) — sieht Zugriffs- und Berechtigungsprotokoll,
  keine operativen Rechte. Gedacht auch für spätere Nutzung durch den
  Betreiber selbst oder dessen Auditor: „Sie sehen, wer wann auf Ihre
  Anlage zugegriffen hat" ist das eigentliche Produktversprechen aus §7.4,
  nicht nur ein Zusatz-Feature.

Rechte hängen an der Person über ihre Rolle, nicht an einem geteilten
Geheimnis — löst das Kernproblem aus §1 strukturell, unverändert aus v2.

### 6.3 RMS-API-Integration
- Zugriffsanfrage → MFA-Prüfung bestanden → Rechteprüfung (diese Person, diese
  Anlage, jetzt) → RMS-API: Connect-Link erzeugen → an Techniker durchreichen
- Neue Anlage angelegt → RMS-API: Lizenz zuweisen (automatisiert statt manuell)

### 6.4 Protokollierung (erweitert, August 2026 — direkt aus §2.6 abgeleitet)

**Zwei getrennte, beide append-only, keine DELETE-Grants:**

- **Zugriffsprotokoll** (aus v2 unverändert): wer, wann, welche Anlage —
  jede tatsächliche Zugriffssitzung.
- **Berechtigungsprotokoll** (neu): wer hat wem wann welche Objektzuweisung
  erteilt oder entzogen, angeordnet von wem. Erfasst insbesondere jede
  Neuzuordnung aus §6.2 (Installateurwechsel).

**Warum zwei statt einem:** Ein reines Zugriffsprotokoll beantwortet „wer
war online". Der NISG-Katalog verlangt aber ein Konzept für Rollen,
Verantwortlichkeiten und Zugriffskontrolle (§2.4) — also nicht nur wer
zugegriffen hat, sondern wer wem wann die Berechtigung dazu erteilt hat und
mit welcher Autorität. Das ist das eigentliche Beweisstück aus §2.6 für den
Installateur gegenüber seinem NISG-pflichtigen Kunden.

Architektur-Grundsatz aus dem Kalkulator-Projekt 1:1 wiederverwendbar
(keine DELETE-Grants auf Audit-Tabellen) — bestätigt übertragbar,
unverändert aus v2.

**Bestätigt bereits übertragbar:** Das `platform`-Schema-Muster aus dem
Kalkulator-Projekt (SECURITY-DEFINER-Wrapper, manuelle Admin-Rollenzuweisung
via SQL/Supabase Studio statt eigener UI) wurde bereits als Vorlage genutzt —
Martin wurde als erster Admin exakt nach diesem Muster angelegt
(`insert into platform.user_roles ...`). Bestätigt die Wiederverwendbarkeit
der Kalkulator-Architektur für dieses Produkt.

**Offen: Aufbewahrungsdauer beider Protokolle.** In keiner geprüften Quelle
eine konkrete Frist gefunden — die Nachweisfristen ab behördlicher
Aufforderung (§2.2, §2.5) sind etwas anderes als eine Speicherfrist.
Zusätzlich eine DSGVO-Frage (Speicherbegrenzung), nicht nur NISG. S. §9 —
mit dem Anwalt zusammen mit der AGB-Haftungsverteilung zu klären, nicht
hier zu entscheiden.

### 6.5 Abrechnung (präzisiert, August 2026)

Preisstaffel (§7.2) technisch abbilden. Stripe ist im Gesamtprojekt bereits
vorhanden — keine neue Zahlungsanbindung nötig.

**Keine harte technische Durchsetzung der Anlagen-Limits pro Stufe.**
Ausdrückliche Entscheidung, kein MVP-Kompromiss: Ziel ist der Endausbau,
nicht die Demo — ein hartes Limit wäre genau die Art Provisorium, die
später teuer nachgerüstet werden müsste. Stattdessen: **vollständige
Kostenzuordnung pro Zugriffsobjekt von Anfang an** (reale ~80 € RMS-Lizenz
+ Datenpaket, §4.2.1), sichtbar im Firmenadmin- wie im COOLiN-internen
Dashboard. Durchsetzung/Nachfassen bei Überschreitung bleibt vorerst
manuell (Martin).

### 6.6 Dashboard
- **Installateur-Sicht:** eigene Anlagen, Techniker verwalten, Zugriff auslösen
- **COOLiN-intern:** Kundenübersicht, Anlagenbestand, Support

---

## 7. Geschäftsmodell

### 7.1 Zielkunde
**Der Installateur**, nicht der einzelne Anlagenbetreiber. Verwaltet viele
Kundenanlagen unter einem Konto.

**Nicht jetzt zu entscheiden, aber durch §6.2/§8 technisch bereits
angelegt:** Das generalisierte Datenmodell trägt grundsätzlich auch andere
Gewerke mit Fernwartungsbedarf (z. B. Kältetechnik). Verkauft wird trotzdem
bewusst weiterhin eng an PV-Installateure — der Zielkunde muss den Schmerz
als Teil seiner Identität empfinden, dasselbe Prinzip wie beim Kalkulator.

### 7.2 Preisstaffel (COOLiN-Servicegebühr, pro Installateur-Konto, NICHT pro Anlage)

| Stufe | Anlagen | Preis/Monat |
|---|---|---|
| Start | bis 10 | 69 € |
| Team | bis 30 | 149 € |
| Wachstum | bis 100 | 299 € |
| Groß | über 100 | ab 599 €, individuell |

**Kalkulationsgrundlage bestätigt** (s. §4.2.1): Reale Gerätekosten von ~80 €
einmalig plus 8 €/Jahr Management sind gegenüber dieser Staffel vernachlässigbar
— die Marge liegt fast vollständig bei der Dienstleistung, nicht bei der
durchgereichten Hardware/Lizenz.

### 7.3 Kostenaufstellung für den Endkunden (vollständig, mit Quellen)

| Posten | Zahler | Rhythmus | Betrag | Quelle |
|---|---|---|---|---|
| RUT200 | Anlagenbetreiber | einmalig | ~100–115 € | Marktbeobachtung |
| RMS-Management-Lizenz | Betreiber oder Installateur | einmalig (5 J.) | 40 € exkl. USt | Capestone, RMSMP0500000 |
| RMS-Datenpaket | Betreiber oder Installateur | einmalig (10 J.) | ~40 € (£34,29 exkl. USt) | Capestone, RMSDT101G150 |
| SIM-Datentarif (Mobilfunk) | Betreiber oder Installateur | laufend | **weiterhin OFFEN** | noch kein Angebot eingeholt |
| COOLiN-Servicegebühr | Installateur | laufend/Monat | 69–599 € je nach Stufe | s. §7.2 |

**Wichtige Klarstellung:** Das RMS-Datenpaket (Teltonika-Cloud-Traffic) und der
SIM-Datentarif (Mobilfunkanbieter-Vertrag für die physische Internetverbindung)
sind **zwei unterschiedliche Kostenquellen** — nicht zu verwechseln. Ersteres
ist jetzt beziffert, Letzteres weiterhin offen.

**Offen, vor erstem Kundengespräch zu klären:** Wer zahlt Hardware/Lizenz/SIM in
der Praxis — Installateur (legt es auf seinen Servicevertrag um) oder direkt der
Betreiber?

### 7.4 Value Proposition — WARUM nicht einfach Teltonika RMS direkt

Ein technisch versierter Installateur KÖNNTE RUT200 kaufen und sich direkt bei
Teltonika RMS anmelden — RMS bietet bereits Nutzerrechte pro Gerät,
Gruppierung, Zugriffsprotokoll.

**COOLiNs Wert liegt NICHT im Zugang selbst** (den bekommt man auch direkt bei
Teltonika), sondern in:
1. **Zuordnung zu einem konkreten Endkunden/einer Compliance-Akte**, nicht nur
   einem internen Geräte-Account — RMS kennt keine „Kundenzuordnung mit
   NISG-Nachweis", das ist reine Geräteverwaltung
2. **Automatischer, disziplinierter Entzug** bei Mitarbeiterwechsel
3. **Ein Ansprechpartner, lokal, auf Deutsch**, eingebettet in die bestehende
   COOLiN-Kundenbeziehung

**Konsequenz fürs Verkaufsgespräch:** NICHT „wir geben Ihnen Zugang" verkaufen —
sondern „wir liefern die geprüfte Nachweisführung, die NISG von Ihnen verlangt."
Mit §2.4–§2.6 jetzt konkret unterlegt: Rollen-/Zugriffskontrollkonzept, MFA,
Lieferketten-Hebel, Nachweispflicht — kein pauschales Argument mehr, sondern
punktgenau auf den Gesetzestext gemünzt.

---

## 8. Architektur (Entscheidungen getroffen — war in v1 noch offen)

**Repo-Ort/Subdomain — ENTSCHIEDEN:** Läuft **innerhalb von `apps/web`**,
eigene Subdomain **`access.coolin.at`** (Name vorläufig). Spiegelt exakt das
bestehende, bewährte Muster des Partner-Portals (`partner.coolin.at`, ebenfalls
gegen `apps/web` gebaut). **Kein eigener App-Ordner, kein separates
Vercel-Projekt.**

Begründung: Das Muster ist bereits bewiesen funktionsfähig; für ein Team dieser
Größe wiegt der geringere Betriebsaufwand (ein Deploy-Zyklus, eine
Env-Verwaltung) schwerer als der theoretische Vorteil einer separaten
Infrastruktur. Das erhöhte Risikoprofil des Produkts (RMS-API-Zugriff,
sicherheitskritische Zugriffslogik) wird über **Trennung im Code** adressiert,
nicht über getrennte Infrastruktur:

- RMS-API-Credentials und jede Zugriffs-/Freischaltungslogik müssen
  **server-only** sein, dürfen nie im Client-Bundle landen
- Klar abgegrenztes Modul/Route-Gruppe, nicht mit Website-Marketing-Code
  vermischt, auch wenn beides im selben Repo/derselben App lebt
- Falls das Produkt später eigenständig groß wird (viele Installateure,
  spürbarer eigener Traffic, externes Compliance-Audit), ist eine Trennung in
  ein eigenes Deployment ein sinnvoller **späterer** Schritt — jetzt bewusst
  nicht vorweggenommen

**Neuer Grundsatz (August 2026): generisches Rückgrat, konkrete Anbindung.**
Datenmodell und Protokoll sind objekttyp- und anbieteroffen gebaut (§6.2) —
das ändert sich nicht, egal welche Hardware oder welcher Anbieter künftig
dazukommt. Die Anbieter-Anbindung selbst bleibt bewusst eng an Teltonika:
eine Schnittstelle, eine Implementierung, kein Abstraktionsframework für
hypothetische künftige Anbieter. Begründung: Eine Abstraktion über eine
Stichprobe von einem Hersteller wird von dessen Eigenheiten geformt und tut
nur so, als sei sie neutral. Der wahrscheinlichste zweite Anbietertyp ist
zudem strukturell anders als Teltonika — Herstellerportale wie SMA Sunny
Portal oder Fronius Solar.web verwalten personenbezogenen Zugang zu einem
geteilten Konto, nicht befristete Tunnel. Eine jetzt erfundene gemeinsame
Schnittstelle würde dafür ohnehin nicht passen. Abstrahiert wird erst, wenn
ein zweiter Anbieter real ansteht, mit echten Datenpunkten statt geratenen.

**Übrige Prinzipien (aus dem Gesamtprojekt übernommen, unverändert):**
- **Kein iframe.** Wird von Anfang an nativ gebaut.
- **Append-only Ledger für Audit-Trails**, keine DELETE-Grants — bereits als
  übertragbar bestätigt (s. §6.4), jetzt zwei getrennte Ledger statt einem.
- **Neue, eigene Bau-Session**, getrennt von Website-, Kalkulator- und
  Partner-Portal-Session. Eigene Dateien mit Suffix im claude.ai-Projektordner
  (`CLAUDE_Zugangsplattform.md`), niemals bare `CLAUDE.md`.

---

## 9. Offene Punkte (Checkliste, Stand v3)

- [x] ~~Volle RMS-API-Endpoint-Dokumentation einsehen~~ → bewusst Aufgabe der
      Bau-Session, nicht mehr Blocker für den Start
- [x] ~~WLAN-Client-Modus verifizieren~~ → **erledigt, bestätigt unterstützt**
      (§4.1)
- [x] ~~Repo-Ort/Architektur festlegen~~ → **entschieden** (§8)
- [x] ~~Rollenmodell festlegen~~ → **entschieden** (§6.2): Firmenadmin /
      Techniker / Prüfer, rechtlich hergeleitet aus §2.4
- [x] ~~Betreiber-Referenz Pflichtfeld oder optional~~ → **entschieden**
      (§6.2): Pflichtfeld
- [x] ~~Objekt-Zuordnung fix oder befristet~~ → **entschieden** (§6.2):
      befristet, Objekt gehört dem Betreiber
- [x] ~~Harte Anlagen-Limits pro Preisstufe, ja/nein~~ → **entschieden**
      (§6.5): nein, stattdessen vollständige Kostenzuordnung
- [ ] **Neu:** Aufbewahrungsdauer der beiden Protokolle (§6.4) — rechtlich
      (DSGVO-Speicherbegrenzung und NISG-Nachweisfristen sind nicht
      dasselbe) mit Anwalt klären, zusammen mit der AGB-Haftungsverteilung
- [ ] **Neu:** Kann ein RMS-Connect-Link vorzeitig widerrufen werden, oder
      läuft er nur ab? Entscheidet, ob „Entzug bei Mitarbeiterwechsel" sofort
      oder verzögert wirkt — vor dem Einfrieren des Sitzungsmodells (6.3) zu
      klären, Teil der ohnehin anstehenden RMS-API-Dokumentationssichtung
- [ ] **Neu:** Zugriffskontroll-/Sitzungsmanagement-Konzept anhand der
      EU-Durchführungsverordnung (EU) 2024/2690 und der ENISA-Leitlinien
      vertiefen (§2.4) — bevor das Sitzungsmodell (6.3) im Detail feststeht
- [ ] Exakte Bezeichnung/Quelle der Teltonika-Zertifizierung dokumentieren
      (Andreas hat mündlich bestätigt, dass sie existiert — für
      Vertriebsunterlagen noch zitierfähig zu machen)
- [ ] SIM-/Datentarif-Anbieter anfragen, echten Preis einholen — **weiterhin
      offen, unverändert seit v1**
- [~] **Rechtlich/kommerziell prüfen: Reseller-Konditionen bei Capestone** —
      **IN BEARBEITUNG.** Anfrage als Reseller (nicht nur Endkunde) bereits
      gestellt, inkl. grober 12-Monats-Rollout-Schätzung (20–150 Geräte).
      Antwort ausständig. Sobald da: Preiskonditionen im Großeinkauf und
      formale Bestätigung des Weiterverkaufs-/White-Label-Modells hier
      nachtragen.
- [ ] Mit Anwalt klären: Haftungsverteilung Hardware (Betreiber) / Cloud-Schicht
      (Teltonika) / Plattform (COOLiN) explizit in AGB — **jetzt im selben
      Termin wie die Aufbewahrungsdauer-Frage oben zu klären**
- [ ] Marktgrößen-Schätzung mit echten Gesprächen validieren (5–10 Installateure
      aus Martins Netzwerk, s. §3)
- [ ] Entscheiden: zahlt Installateur oder Betreiber Hardware/Lizenz/SIM (§7.3)
- [ ] Produktname festlegen (aktuell nur Arbeitstitel), finaler Subdomain-Name
      bestätigen (`access.coolin.at` vorläufig)

**Stand Hardware/Bestellung:** RUT200 bestellt. Registrierung im RMS-Portal
bewusst noch **nicht** vorgenommen — erfolgt planmäßig erst, sobald die
Bau-Session bei Baustein 6.3 (RMS-API-Integration) angelangt ist, s. §6.

---

## 10. Quellen (Auswahl, für Rückfragen)

- SMA Passwort-Mechanik: SMA Handbuch / SMA Sunny Blog
- Forescout „SUN:DOWN" (46 Schwachstellen) + Folgeanalyse (35.000 exponierte Geräte)
- Niederländische Aufsichtsbehörde RDI (9 geprüfte Wechselrichter)
- NISG 2018 (BGBl. I Nr. 111/2018) — aktuell geltender Text:
  `ris.bka.gv.at`, Bundesrecht konsolidiert (s. Quellenhinweis §2.1 zur
  Interpretation des „Fassung vom..."-Datums)
- **NISG 2026 (BGBl. I Nr. 94/2025):** Gesetzgebungsverfahren/Regierungsvorlage
  308 d.B. — `parlament.gv.at/gegenstand/XXVIII/I/308`; authentischer Volltext
  `ris.bka.gv.at/Dokumente/BgblAuth/BGBLA_2025_I_94/BGBLA_2025_I_94.pdf`
  (37 Seiten, automatisierter Zugriff gesperrt, nur manuell im Browser
  abrufbar); Einordnung und Praxisfolgen: `wko.at/it-sicherheit/nis2-uebersicht`
  (Stand 09.07.2026, in Kooperation mit der NIS-Behörde/BMI erstellt);
  unabhängige zweite Bestätigung: Schoenherr-Kurzüberblick „NISG 2026"
  (Kanzlei-PDF, `schoenherr.eu`) — deckt sich mit WKO in Zeitplan,
  Maßnahmenkatalog und Governance-Pflichten
- E-Control: PV-Zählpunkt-Zahlen
- Bundesinnung Elektrotechnik (7.700 Betriebe), Photovoltaic Austria
  (Mitgliederzahlen), Erneuerbare Energie Österreich (SolarPartner-Programm)
- Teltonika: `teltonika-networks.com/products/rut200`,
  `.../products/rut301`, `.../products/rms`,
  `wiki.teltonika-networks.com/view/RMS_API`,
  Wiki-Artikel zu WiFi-WAN-Konfiguration
- Capestone (Diamond Distributor Teltonika):
  `capestone.com/en/product/teltonika-rms-5-year/` (Management-Lizenz),
  `capestone.com/en/product/150gb-data-for-rms-connectvpn/` (Datenpaket)
- Weitere Händler (GPS-WATCH, ime.de, Wireless Logic Help Centre) zur
  Bestätigung von Credit-Preisen und Werkseinstellungen
