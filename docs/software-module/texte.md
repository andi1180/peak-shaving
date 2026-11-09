# Texte Software-Module (Stand 09.11.2026, freigegeben Andi)

Verbindliche Texte für `/software` und die fünf Modulseiten. Wortlaut 1:1 übernehmen (in `messages/de.json`).
Bilder: `apps/web/public/software/<slug>.png` (2400×1520, Seitenverhältnis 1200:760).
Status-Badge auf jeder Modulseite und jeder Übersichtskarte: **„In Entwicklung · Start Q1/2027"**.
Bildunterschrift unter jedem Screenshot: **„Vorschau mit Beispieldaten"**.
CTA auf jeder Seite: **„Gespräch vereinbaren"** → Kontaktformular (bestehendes Thema, s. Prompt).

---

## Übersicht `/software`

**Eyebrow:** Software
**H1:** Energiemanagement, das mitdenkt
**Lead:** Ein Speicher, eine Wärmepumpe oder eine Wallbox sparen erst dann richtig, wenn sie zur richtigen Zeit laufen. Unsere Software-Module steuern genau das – automatisch, nachvollziehbar und abgestimmt auf Ihren Betrieb.

**Abschnitt „Warum jetzt"**
H2: Ab 2027 kostet ungesteuerter Strom mehr
Text: In Österreich wird ab 2027 für alle Haushalte und Betriebe mit Smart Meter ein Leistungspreis eingeführt: Die höchste Viertelstunde im Monat bestimmt einen Teil der Netzkosten. Gleichzeitig gibt es günstigere Netz-Zeitfenster und Rabatte für steuerbare Geräte. In Deutschland gelten zeitvariable Netzentgelte für steuerbare Verbraucher bereits seit April 2025 (§ 14a EnWG). Wer seine Verbraucher steuert, zahlt weniger – von Hand ist das kaum machbar.

**Abschnitt „Module"**
H2: Fünf Module, eine Plattform
Text: Alle Module greifen auf dieselben Messdaten zu und arbeiten zusammen. Sie starten mit dem, was Ihr Betrieb braucht, und erweitern bei Bedarf.

Karten (Titel · Kurztext · Link):
1. Energie-Cockpit · Ihr Verbrauch live – und ob die geplante Ersparnis tatsächlich eintritt. · `/software/energie-cockpit`
2. Smarte Ladesteuerung · Der Speicher lädt, wenn Strom günstig ist, und hält Reserve für Lastspitzen. · `/software/ladesteuerung`
3. Tarif-Wächter · Meldet sich, wenn ein Wechsel zwischen Fixpreis und Börsentarif sich lohnt. · `/software/tarif-waechter`
4. Peak-Wächter · Erkennt eine neue Lastspitze, bevor die Viertelstunde vorbei ist. · `/software/peak-waechter`
5. Wärmepumpen-Manager · Heizt vor, wenn Strom günstig ist – ohne Komfortverlust. · `/software/waermepumpen-manager`

**Abschluss**
H2: Welche Module passen zu Ihrem Betrieb?
Text: Wir sehen uns Ihren Lastgang und Ihre Anlagen an und sagen Ihnen, wo Steuerung bei Ihnen am meisten bringt.
Button: Gespräch vereinbaren

---

## 1. Energie-Cockpit `/software/energie-cockpit` · Bild `energie-cockpit.png`

**H1:** Energie-Cockpit
**Lead:** Sehen, was im Betrieb passiert: Verbrauch, Lastspitzen und PV-Anteil auf einen Blick – und die Kontrolle, ob die geplante Ersparnis auch tatsächlich eintritt.

**H2:** Was das Cockpit zeigt
- **Live-Verbrauch:** aktuelle Leistung und Verbrauch des Tages, in Viertelstunden aufgelöst.
- **Monatsspitze:** die höchste Viertelstunde im Monat – der Wert, der Ihren Leistungspreis bestimmt.
- **Soll/Ist-Vergleich:** die Ersparnis aus unserer Analyse neben dem, was tatsächlich gespart wurde.
- **Alle Module an einem Ort:** Ladesteuerung, Peak-Wächter, Tarif-Wächter und Wärmepumpe mit ihrem aktuellen Status.

**H2:** So funktioniert's
1. **Messen:** Wir binden Ihren Smart Meter oder ein Messgerät im Verteiler an.
2. **Auswerten:** Die Daten laufen laufend in Ihr Cockpit, im Browser auf PC, Tablet und Handy.
3. **Vergleichen:** Jeden Monat sehen Sie, ob Ihre Anlage hält, was die Analyse versprochen hat.

**H2:** Für wen
Für Betriebe, die ihren Verbrauch verstehen wollen – und für alle, die einen Speicher, eine PV-Anlage oder eines unserer Module nutzen. Das Cockpit ist die Basis für alle weiteren Module.

---

## 2. Smarte Ladesteuerung `/software/ladesteuerung` · Bild `ladesteuerung.png`

**H1:** Smarte Ladesteuerung
**Lead:** Ihr Batteriespeicher lädt, wenn Strom günstig ist oder die PV-Anlage Überschuss liefert, und gibt die Energie ab, wenn Strom teuer ist. Eine feste Reserve bleibt immer für Lastspitzen frei.

**H2:** Was die Ladesteuerung macht
- **Plant den nächsten Tag:** Sobald die Börsenpreise für morgen feststehen, entsteht ein Fahrplan für jede Stunde.
- **Nutzt Ihre PV:** Erwarteter Überschuss wird eingeplant, statt ihn billig ins Netz zu speisen.
- **Schützt vor Spitzen:** Ein Teil der Kapazität ist für Lastspitzen reserviert und wird nie für Preisvorteile verbraucht.
- **Erklärt sich selbst:** Zu jedem Plan sehen Sie, warum geladen oder entladen wird.

**H2:** So funktioniert's
1. **Preise:** Die Day-Ahead-Preise für den Folgetag sind ab ca. 14 Uhr bekannt.
2. **Prognose:** Dazu kommen die PV-Prognose für Ihren Standort und Ihr eigenes Verbrauchsmuster.
3. **Fahrplan:** Die Steuerung legt fest, wann der Speicher lädt, entlädt oder hält – und setzt das automatisch um.

**H2:** Für wen
Für Betriebe mit Batteriespeicher und Börsentarif (dynamischer Stromtarif), mit oder ohne PV-Anlage. Die Logik ist dieselbe, mit der wir in unseren Analysen die Wirtschaftlichkeit eines Speichers berechnen.

---

## 3. Tarif-Wächter `/software/tarif-waechter` · Bild `tarif-waechter.png`

**H1:** Tarif-Wächter
**Lead:** Fixpreis oder Börsentarif? Der Tarif-Wächter rechnet laufend mit Ihrem eigenen Lastgang und meldet sich, wenn ein Wechsel sich voraussichtlich lohnt.

**H2:** Was der Tarif-Wächter macht
- **Rechnet mit Ihrem Verbrauch:** Was ein Börsentarif kostet, hängt davon ab, wann Sie Strom brauchen. Deshalb zählt Ihr Lastgang, nicht ein Durchschnittsprofil.
- **Schaut nach vorne:** Die Prognose stützt sich auf aktuelle Terminmarktpreise für die kommenden Monate.
- **Meldet sich nur, wenn es sich lohnt:** Sie legen fest, ab welchem Vorteil Sie einen Hinweis bekommen – per E-Mail.
- **Kein Hin und Her:** Zwischen zwei Wechseln liegen mindestens sechs Monate.

**H2:** So funktioniert's
1. **Ausgangslage:** Wir hinterlegen Ihren aktuellen Tarif und Ihren Lastgang.
2. **Laufender Vergleich:** Der Wächter vergleicht Ihren Fixpreis mit den erwarteten Kosten am Börsentarif.
3. **Hinweis:** Übersteigt der erwartete Vorteil Ihre Schwelle, erhalten Sie eine Nachricht mit den Zahlen dazu.

**H2:** Gut zu wissen
Der Tarif-Wächter gibt Hinweise auf Basis von Prognosen, keine Beratung und keine Garantie. Die Entscheidung über einen Wechsel treffen Sie.

---

## 4. Peak-Wächter `/software/peak-waechter` · Bild `peak-waechter.png`

**H1:** Peak-Wächter
**Lead:** Eine einzige teure Viertelstunde kann den Leistungspreis für den ganzen Monat bestimmen. Der Peak-Wächter erkennt eine neue Spitze, während sie entsteht, und greift ein, bevor die Viertelstunde vorbei ist.

**H2:** Was der Peak-Wächter macht
- **Rechnet mit:** Er verfolgt den Mittelwert der laufenden Viertelstunde und rechnet hoch, wo er am Ende landet.
- **Greift kurz ein:** Droht die Grenze überschritten zu werden, drosselt er freigegebene Verbraucher für wenige Minuten – etwa eine Wallbox, eine Kühlung oder eine Lüftung.
- **Sie behalten die Kontrolle:** Sie legen die Grenze fest und bestimmen, welche Geräte eingreifen dürfen und welche nie.
- **Dokumentiert jeden Eingriff:** Sie sehen, wann eingegriffen wurde und was es gebracht hat.

**H2:** So funktioniert's
1. **Messen:** Ihre Leistung wird laufend erfasst.
2. **Hochrechnen:** Mehrmals pro Minute wird geprüft, ob die Viertelstunde über Ihrer Grenze enden würde.
3. **Eingreifen:** Freigegebene Verbraucher werden kurz gedrosselt oder verschoben, danach läuft alles normal weiter.

**H2:** Für wen
Für Betriebe mit Leistungspreis – in Österreich ab 2027 auch für Kleinbetriebe mit Smart Meter. Besonders wirksam zusammen mit einem Batteriespeicher und der Smarten Ladesteuerung.

---

## 5. Wärmepumpen-Manager `/software/waermepumpen-manager` · Bild `waermepumpen-manager.png`

**H1:** Wärmepumpen-Manager
**Lead:** Gebäude und Pufferspeicher halten Wärme über Stunden. Der Wärmepumpen-Manager nutzt das: Er heizt vor, wenn Strom günstig ist, und pausiert bei Preisspitzen – innerhalb der Komfortgrenzen, die Sie festlegen.

**H2:** Was der Wärmepumpen-Manager macht
- **Heizt zur richtigen Zeit:** Börsenpreis, PV-Überschuss und günstige Netz-Zeitfenster bestimmen, wann die Wärmepumpe mehr arbeitet.
- **Pausiert bei Preisspitzen:** In teuren Stunden läuft sie mit gespeicherter Wärme weiter.
- **Komfort hat Vorrang:** Verlässt die Temperatur das festgelegte Band, kehrt die Wärmepumpe sofort in den Normalbetrieb zurück.
- **Bereit für steuerbare Netztarife:** Netzbetreiber gewähren Rabatte, wenn sie Geräte zeitweise drosseln dürfen – der Manager plant das ein.

**H2:** So funktioniert's
1. **Anbinden:** Über die SG-Ready-Schnittstelle oder Modbus, die viele Wärmepumpen bereits mitbringen.
2. **Planen:** Für den nächsten Tag entsteht ein Heizplan aus Preisen, Wetterprognose und Ihren Komfortgrenzen.
3. **Steuern:** Die Wärmepumpe wird automatisch in die passende Betriebsart geschaltet.

**H2:** Für wen
Für Betriebe und Gebäude mit Wärmepumpe und Pufferspeicher, idealerweise mit Börsentarif oder eigener PV-Anlage.
