# Pflichtenheft-Delta: KI-Interface Kalkulator (B24)

**Delta zu:** `Pflichtenheft_Kalkulator_MVP.md`, `Pflichtenheft_Kalkulator_Delta_Tarifoptimierung.md`,
`Pflichtenheft_Kalkulator_Delta_PDF-Report.md` — kein Ersatz, siehe §9.
**Löst ab / verdichtet:** `B24_KI-Interface_Kalkulator.md` (früher Konzeptstand, 09.09.2026) —
die dort als offen markierten Punkte sind hier durchgängig referenziert und, soweit in dieser
Sitzung entschieden, aufgelöst.
**Entstanden:** Advisor-Sitzung 09.09.2026, direkt im Anschluss an das B24-Konzeptdokument.

---

> ⚠ **STATUS DIESES DOKUMENTS — bitte vor dem Bauen lesen.**
>
> | | |
> |---|---|
> | **Ist** | Der Entscheidungsstand einer Advisor-Sitzung: durchgesprochene und getroffene Architektur- und Produktentscheidungen zu B24, fachlich formuliert, für Claude Code lesbar. **Gegen `KI-Interface_Kalkulator_Bestandsaufnahme.md` (09.09.2026, Stand `26b33af`) reconciled** — vier Annahmen hielten der Messung nicht stand und sind unten korrigiert, jeweils mit Verweis auf den Befund. |
> | **Ist nicht** | Ein vollwertiges Pflichtenheft. Die Bestandsaufnahme deckt acht der hier verwendeten Annahmen ab (A, B, C, D, E, F, G, H) — sie ist reine Messung, keine Bewertung; die Korrekturen unten sind trotzdem Entscheidungen, keine Messwerte. |
> | **Was korrigiert wurde** | §3.2 (H — Grundgebühr existiert bereits), §3.4 (A — `TariffParams` trägt kein Leistungsmessungs-Feld), §4.2 (F — `grid_tariffs` ist nicht append-only im Grant-Sinn, sondern function-gated mit Advisory-Lock), §6.2 (G — zwei bestehende Vergabewege, kein genereller Grant-Wrapper vorhanden), §7 (Prinzip 4 — Eigentümerschafts-RLS hat im Repo keinen Präzedenzfall). |
> | **Was hier NICHT absichtlich offen ist** | Alles unten als entschieden Markierte ist eine echte Entscheidung dieser Sitzung, keine Vermutung. §10 listet, was tatsächlich noch offen ist. |

---

## 0 — Kurzüberblick

| Bereich | Entscheidung |
|---|---|
| Eingabe (Teil 1) | Echter freier Chat (Variante B) als Standard. Feste Pflichtfragen als Baseline im Hintergrund. |
| Formular-Weg | Bleibt vollständig erhalten, als wählbare Alternative zum Chat (pro Projekt festgelegt, nicht umschaltbar). Kein eigener Ausbau — Betrieb-Komplexität bleibt dem Chat vorbehalten. |
| Zugang | Kalkulator wird für alle offen (löst OP#1 aus `Fahrplan_2026.md`) — Registrierung mit Account, keine Kuratierung mehr. Perspektivisch Bezahlschranke möglich, jetzt nicht gebaut. |
| Kontenmodell | `Account` (nicht "Mandant" — siehe §2) → `Projekt` → `Zählpunkt` → `Analyse`. Admin ohne eigenes Konto. |
| Weg a/b (Rückfrage vs. Annahme) | Nutzer bekommt bei jeder Martin-Frage **immer beide Optionen** sichtbar, inkl. Hinweis, ob eine Annahme das Ergebnis stark verändern könnte. Offene Frage bleibt am Projekt hängen, auch nach "Annahme". |
| Frage-Guidelines (Teil 2) | Admin-pflegbar in der DB (nicht Code), Schreiben nur über admin-geprüfte Funktionen mit Ordnungspflicht im Funktionsrumpf und protokolliertem Löschweg — Vorbild `grid_tariffs`, präzisiert in §4.2. Segmentierung: Privat / Betrieb+Branche, offene Liste. |
| Report (Teil 3) | Dreistufiges Freiheitsmodell: Zahlen fix (Engine unverändert) · Auswahl & Struktur frei aus erweitertem, typisiertem Baukasten · Formulierung frei. Ausgelieferter Report wird vollständig archiviert. |
| Mehrere Zählpunkte | Kein Engine-Umbau. Neue Rollup-Schicht **über** der unveränderten Engine, analog zum bestehenden `recommendBattery`-Muster. |
| Kostenbremse | Ein Limit pro Konto (nicht separat pro Projekt), admin-editierbar (erstes admin-pflegbares Limit im Repo), Admin-Rolle ausgenommen. |
| `calculator_pro`-Entitlement (B10) | Prüfung bleibt bestehen. Automatische Vergabe bei Registrierung als **neuer, dritter** Schreibweg — Gutscheincode und Partner-Anfrage bleiben daneben bestehen (Korrektur, s. §6.2). |

---

## 1 — Begriffsklärung: warum "Account", nicht "Mandant"

**Bewusst nicht "Mandantenfähigkeit"/"B13" genannt**, obwohl das Wort in der Sitzung zunächst fiel. `Fahrplan_2026.md` vergibt B13 bereits für eine andere, dreistufige Struktur: COOLiN → Fachbetrieb (Mandant, isoliert von anderen Fachbetrieben) → dessen Endkunden — zurückgestellt bis zur Fachbetriebs-Lizenz.

Was hier gebraucht wird, ist zweistufig: COOLiN → **Account** (Kunde oder intern) → **Projekte**. Keine Fachbetrieb-Ebene, keine Isolation zwischen Fachbetrieben. Um `Fahrplan_2026.md` nicht stillschweigend zu widersprechen (dort steht B13 weiterhin als "zurückgestellt"), führt dieses Delta einen eigenen Begriff: **Account/Projekt-Modell**. B13 bleibt unberührt und wird bei Bedarf (erster realer Fachbetriebs-Reseller) separat aufgesetzt, mit dem Account/Projekt-Modell darunter.

---

## 2 — Datenmodell: Account · Projekt · Zählpunkt · Analyse

```
Account (nullable Verknüpfung zu Login/Auth)
└─ Projekt (0..n je Account; admin-erzeugte Projekte: account_id = NULL)
   ├─ Chat-Zustand (laufendes Gespräch, Uploads, Bestätigungen)
   ├─ offene Rückfragen an Martin (0..n, mit Status offen/beantwortet)
   └─ Zählpunkt (1..n)
      └─ Analyse (1..n, verkettet über bestehendes supersedes_id-Muster aus B14-1)
```

### 2.1 Account
- Eigene Entität, **nicht** 1:1 an einen Login gebunden — dieselbe Entscheidung, die `platform.partners.user_id` heute schon als *"absehbar temporär"* markiert (aktuell UNIQUE, spätere Zwischentabelle für mehrere Logins je Konto explizit vorgesehen, hier von Anfang an mitgedacht statt nachgerüstet). Grund: ein Betriebskunde (z. B. Hotel) hat vermutlich mehr als eine Person, die dasselbe Projekt sehen muss.
- Erste Ausbaustufe: genau ein Login je Account, wie bei `partners` heute. Mehrfach-Login folgt erst mit echtem Bedarf.
- Kein Typfeld "Privat/Betrieb" am Account selbst — das Segment hängt am Projekt (ein Account könnte theoretisch ein Betriebs- und ein Privatprojekt haben), siehe §4.1.

### 2.2 Projekt
- Der neue Container, löst das in der letzten Sitzung diskutierte "Kundenfall"-Konzept ab.
- `account_id` **nullable**. Gesetzt: vom Kunden selbst angelegt, RLS nach Eigentümerschaft. NULL: von einem Admin angelegt (z. B. für ein eigenes COOLiN-Projekt oder stellvertretend für einen Kunden ohne Account) — Zugriff läuft dann **nicht** über Eigentümerschaft, sondern über dieselbe `authenticated`+`is_admin`-Rollenprüfung, die `admin_list_leads`/`admin_list_analyses` bereits verwenden. Kein eigenes Konto für Admins nötig.
- Trägt ein `customer_label`-Feld denormalisiert (Vorbild: `platform.analyses.customer_label`, aus demselben Grund — Zuordenbarkeit unabhängig vom Kontostatus).
- Trägt den laufenden Chat-Zustand (Konversationsverlauf, hochgeladene Dokumente, bestätigte/offene Werte) — **neue Infrastruktur**, es gibt heute keine der sechs KI-Anbindungen mit Zustand über mehrere Turns.
- Trägt 0..n **offene Rückfragen an Martin**, mit Status. Eine Rückfrage entsteht, wenn der Chat auf eine Frage stösst, die er nicht selbst beantworten kann (§3.3). Sie verschwindet **nicht**, wenn der Nutzer stattdessen eine Annahme wählt — sie bleibt offen, bis Martin antwortet oder sie explizit geschlossen wird.
- Trägt 1..n **Zählpunkte**.

### 2.3 Zählpunkt
- Ein Projekt kann mehrere Zählpunkte tragen (Betriebskunde mit mehreren Standorten/Zählern).
- Jeder Zählpunkt trägt seine eigene Analyse-Kette — **eine eigene Instanz desselben bestehenden Musters**, nicht ein neuer Mechanismus: Lastgang rein, `simulateBattery`/`recommendBattery` unverändert, Ergebnis über `supersedes_id` korrigierbar wie heute schon für einzelne Analysen. **Präzisierung (Bestandsaufnahme E):** `supersedes_id` ist ein blosser, nullbarer Selbst-Fremdschlüssel ohne Ketten- oder Zyklusprüfung in der DB; welche Analyse eine andere ersetzt, wird in der Anwendung aus den neuesten 200 Zeilen abgeleitet, nicht datenbankseitig erzwungen. Für den Zählpunkt-Rollup reicht das (dieselbe Schwäche gilt heute schon für einzelne Analysen), sollte aber nicht als stärkere Garantie verkauft werden, als sie ist.
- **Ausdrücklich keine Änderung an der Engine.** `packages/engine` bleibt bei "ein Lastgang, ein Aufruf, ein `AnalysisResult"`. Prinzip 2 (ein Dispatch, eine ehrliche Zahl), Prinzip 3 (physikalisch korrekte Simulation) und die 100-%-Testbarkeit sind davon unberührt.

### 2.4 Rollup-Schicht (neu, oberhalb der Engine)
- Fasst die je Zählpunkt fertig berechneten `AnalysisResult`-Objekte zu einer Projekt-Gesamtsicht zusammen (Gesamtersparnis, Empfehlung je Standort).
- Strukturelles Vorbild im eigenen Repo: `recommendBattery` tut heute schon genau das für mehrere Batterie-Kandidaten (rechnet jeden einzeln durch, sortiert, gibt das volle Array zurück, kein Vorfiltern). **Durch die Bestandsaufnahme (D) doppelt bestätigt:** dasselbe Muster ("jeden Kandidaten einzeln rechnen, vollständig sortiert zurückgeben, nicht vorfiltern") existiert bereits ein zweites Mal, unabhängig von der Engine, im Analyse-Worker (`buildExistingBatteryAnalysis`) — die Rollup-Schicht wäre die dritte Instanz eines im Repo bereits zweifach bewährten Musters, nicht ein Einzelfall.
- **Das ist der grösste einzelne technische Brocken in diesem gesamten Bauabschnitt** — grösser als die Chat-Schicht selbst. Sollte im Pflichtenheft-Nachfolger als eigener Abschnitt mit eigenem Contract (Pendant zu `AnalysisResult`, aber projektweit) geführt werden.

---

## 3 — Teil 1: Eingabe als freier Chat

### 3.1 Grundprinzip — Variante B
Echtes freies Multi-Turn-Gespräch mit Datei-Upload, nicht ein regelgesteuerter Ablauf mit KI nur zur Extraktion. Begründung (Andreas): die Variablenvielfalt der Betriebe ist zu hoch für starre Eingabepfade; volle Flexibilität ist nötig.

**Klarstellung, die für Claude Code wichtig ist:** "keine Inputfelder mehr" heisst, der Mensch sieht kein Formular mehr — **nicht**, dass die Engine ihren typisierten Eingabe-Contract verliert. Der Chat muss am Ende dasselbe Zielobjekt füllen, das heute Schritt 2 des Formulars füllt (Pendant zu `TariffParams`, je nach Segment erweitert, s. §3.4) — sonst weiss die KI-Schicht nicht, wann sie fertig ist. Der Contract bleibt die Zielgrösse, auch wenn der Weg dorthin frei ist.

### 3.2 Baseline: admin-gepflegte Pflichtfragen
Der freie Chat läuft nicht ohne Aufsicht. Es gibt einen deterministischen Hintergrund-Check: eine Menge von Pflichtfragen/-kategorien je Segment (verwaltet über den Katalog aus §4), gegen die jedes Projekt vor Abschluss geprüft wird. Der Chat entscheidet selbst, **wie** er fragt und welchen Widersprüchen er im Detail nachgeht — er darf aber nicht als abgeschlossen gelten, solange Pflichtpunkte seines Segments unbeantwortet oder nicht explizit als offene Rückfrage an Martin vermerkt sind.

Ebenfalls Teil der Baseline, aus dem ursprünglichen Konzeptdokument übernommen und weiterhin gültig:
- Datei-Upload beliebiger Dokumenttypen, keine Pflichtfeld-Vorabliste.
- Mehrere Dokumente zur selben Frage zusammenführen (z. B. zwölf Monatsrechnungen statt einer Jahresrechnung) — Vorbild bereits im Repo: die bestehende Mehrfach-Rechnungs-Logik ("Einigkeit übernimmt, Widerspruch bleibt leer und wird benannt", `invoice-merge.ts`).
- Automatisierte Auffälligkeits-Prüfung **neben** dem Gespräch (z. B. Nullstunden-Muster im Lastgang) als feste Regel, kein Zufallsfund.
- Vollständigkeitsprüfung gegen eine feste Kategorienliste aller Kostenbestandteile. **Korrektur (Bestandsaufnahme H):** die ursprüngliche Annahme, der Rechnungs-Scan lese die Grundgebühr des Lieferanten nicht, ist veraltet — `InvoiceScanRates.supplierBaseFeeEurPerMonth` existiert seit PR #128 (02.09.2026), samt System-Prompt-Abgrenzung Lieferant/Netzbetreiber und Vorbelegung in Schritt 2. Der zitierte Handover-Satz in `CLAUDE.md:608` war schlicht nicht nachgeführt. Die allgemeine Vollständigkeitsprüfung gegen eine feste Kategorienliste bleibt trotzdem Neuland — sie existiert bislang nur je Einzelfeld (Rechnungs-Scan), nicht als projektweiter Check über alle Kostenbestandteile.
- Sichtbare Kennzeichnung Annahme vs. Messwert, durchgehend bis in den Report (verzahnt mit §5.4).

### 3.3 Weg (a)/(b) — Rückfrage an Martin vs. eigene Annahme

**Entschieden, abweichend vom ursprünglichen Konzeptdokument-Vorschlag:** keine automatische Regel ("Bagatelle → Annahme"), sondern **der Nutzer entscheidet**. Sobald der Chat auf eine Frage stösst, die nur mit Martins Fachwissen zu beantworten ist, bekommt der Nutzer immer beide Optionen angeboten:

1. **Warten** — die Frage geht als offene Rückfrage ans Projekt (§2.2), der Chat kann mit dem Rest weitermachen oder pausieren, Martin beantwortet sie, sobald er kann.
2. **Annahme treffen lassen** — der Chat trifft selbst eine sichtbar gekennzeichnete, begründete Annahme und macht weiter. **Die Rückfrage an Martin wird dadurch nicht gelöscht**, sondern bleibt am Projekt offen stehen, zur nachträglichen Prüfung.

**Neu, explizit gewünscht:** bei der Wahl zwischen (1) und (2) wird dem Nutzer angezeigt, **ob die Annahme das Ergebnis voraussichtlich stark verändern könnte** — z. B. "diese Annahme könnte Ihre empfohlene Speichergrösse verändern" vs. "diese Annahme hat kaum Einfluss auf das Ergebnis". Technisch: ein Sensitivitätslauf gegen die bereits vorhandene Kandidaten-Logik (`recommendBattery` rechnet ohnehin gegen den vollen Katalog) — kein neuer Rechenweg, nur eine zusätzliche Anzeige aus etwas, das die Engine schon kann.

**Korrektur nach Martins Antwort:** beantwortet Martin eine offene Rückfrage später mit einer abweichenden Zahl als der Annahme, wird die betroffene Analyse über den bestehenden `supersedes_id`-Mechanismus (B14-1) korrigiert — keine neue Infrastruktur, Wiederverwendung eines etablierten Musters. Empfehlenswert (nicht hier entschieden, s. §10): der Kunde bekommt in diesem Fall eine Nachricht, dass sein Ergebnis präzisiert wurde.

### 3.4 Privat vs. Betrieb
**Contract-first, nicht Conversation-first.** Statt die Verzweigung als Gesprächsdesign zu entwerfen, wird zuerst festgelegt, welches Zielobjekt (Pendant zu `TariffParams`) ein Betrieb-Fall zusätzlich braucht (Leistungsmessung als Regelfall, Vorsteuerabzug, mehrere Zählpunkte über §2.3/2.4) — die Verzweigung im Gespräch ist eine Konsequenz des Contracts, nicht umgekehrt.

**Bestätigt durch die Bestandsaufnahme (A):** heute existiert **keine** Privat/Betrieb-Verzweigung im Flow — der einzige Vorläufer ist `StandardProfileCustomerClass` (`'privat' | 'kleingewerbe'`, `kleingewerbe` deaktiviert), und der ist auf den Standardprofil-Einstieg beschränkt. Wichtiger für den künftigen Contract-Zuschnitt: **`TariffParams` selbst trägt heute kein Feld für die Leistungsmessungs-Variante** — sie ist reiner UI-Zustand in `step-tariff.tsx` und ein Parameter der Preisberechnung, nicht Teil des typisierten Eingabe-Contracts. Ebenso fehlt ein Vorsteuerabzugs-Feld (gerechnet wird durchgängig netto). Wer den Betrieb-Contract entwirft, muss die Leistungsmessungs-Variante also **neu** ins Contract heben, nicht nur eine bestehende UI-Option wiederverwenden. Konkreter Feldzuschnitt darüber hinaus: weiterhin **nicht Teil dieses Deltas**.

### 3.5 Umgang mit nicht abgebildeter Struktur
Da der Zugang jetzt offen ist (§6), kann sich jederzeit jemand mit einer Struktur anmelden, die das System nicht abbildet (z. B. ein sehr komplexer Betrieb mit vielen Standorten, für den selbst die Zählpunkt-Rollup-Schicht nicht reicht). **Anforderung, kein neuer Baustein:** der Chat muss das erkennen und sauber zu "das braucht Martin" überleiten (offene Rückfrage am Projekt, §2.2/§3.3) statt abzustürzen oder eine unpassende Analyse zu erzwingen. Ohne diese Anforderung wäre ein solcher Fall vorher (kuratierter Zugang über Martin) nie unvorbereitet reingekommen — jetzt schon.

---

## 4 — Teil 2: Admin-Frage-Guidelines

### 4.1 Segmentierung
**Privat / Betrieb+Branche**, als **offene Liste**, nicht als festes Enum (Unterschied zu `platform.industry`, das für die Lead-Segmentierung der Website existiert, aber einem anderen Zweck dient und deshalb nicht direkt wiederverwendet wird). Grund: neue Branchen-Pools (z. B. Hotel) sollen ohne Schema-Änderung admin-seitig entstehen können.

### 4.2 Speicherung — admin-pflegbar in der DB, nicht Code
**Entschieden, gegen den naheliegenden B11-Reflex ("Tarifsätze sind auch im Code versioniert, warum nicht Fragenkataloge auch").** Der stärkste Gegenbeleg liegt im eigenen Repo: **B21-3d** (07.09.2026) hat für Netzebenen-Verfügbarkeit exakt die umgekehrte Bewegung gemacht — vom statischen Code-Katalog zur Datenbank —, weil Admin-Pflege am Code-Katalog vorbeilief und der Fehler unsichtbar blieb ("der Defekt war unsichtbar, und das ist sein gefährlicher Teil"). Fragenkataloge sollen laut Auftrag explizit admin-pflegbar sein — das ist mit einem Code-Modul (Änderung = PR eines Entwicklers) nicht ehrlich vereinbar.

**Korrektur (Bestandsaufnahme F):** die ursprüngliche Formulierung "append-only, kein update/delete-Grant für irgendeine Rolle" beschreibt das `grid_tariffs`-Muster falsch. Gemessen: `service_role` hat auf `grid_tariffs` sehr wohl `UPDATE` und `DELETE` — es gibt sogar eine funktionierende `delete_grid_tariff`. Was tatsächlich schützt, ist etwas anderes und, für den Fragenkatalog, sogar besser geeignet:

- **Kein Rollen-Grant für `anon`/`authenticated`** — Schreiben geht ausschliesslich über `service_role`-Funktionen mit `isCurrentUserAdmin()`-Prüfung in der aufrufenden Server Action, nicht über einen offenen DB-Grant.
- **Die Ordnungspflicht sitzt im Funktionsrumpf, nicht in einer Constraint:** `create_grid_tariff` weist einen neuen Stand ab, der vor dem Beginn des aktuell offenen liegt; ein Advisory-Lock je Kombination (Netzbetreiber/Netzebene/Variante) serialisiert gleichzeitige Aufrufe; ein Unique-Constraint fängt nur den entarteten Fall (identischer Stichtag) als Rückhalt.
- **Löschen ist möglich, aber protokolliert:** `delete_grid_tariff` schreibt die gelöschte Zeile samt Fenstern in eine eigene `grid_tariff_deletions`-Tabelle, bevor sie verschwindet — Korrigierbarkeit UND Nachvollziehbarkeit, statt Unveränderlichkeit zu erzwingen.
- **`grid_tariff_rate_windows`** (die Detailzeilen je Zeitfenster) trägt dagegen tatsächlich kein `UPDATE`/`DELETE` für irgendeine Rolle — dieser Teil der ursprünglichen Annahme war richtig, nur nicht auf die Haupttabelle übertragbar.

**Konkret, revidiert:** der Fragenkatalog folgt diesem präziseren Vorbild — Schreiben ausschliesslich über admin-geprüfte `service_role`-Funktionen, Ordnungspflicht (ein neuer Katalog-Stand muss nach dem Beginn des vorherigen offenen liegen) im Funktionsrumpf durchgesetzt, ein `deleted_questions`-Protokoll analog zu `grid_tariff_deletions` für den Korrekturfall. Das ist realistischer als eine harte Unveränderlichkeit (Fragenkataloge werden vermutlich öfter korrigiert als Tarifsätze) und liefert dieselbe Reproduzierbarkeit: eine 2026 geführte Konversation muss 2028 noch sagen können, welcher Fragenkatalog-Stand ihr zugrunde lag. Ein referenziertes Projekt/eine Analyse führt den Katalog-Stand denormalisiert mit (Vorbild: `tariffSetId` bei B21-3d).

### 4.3 Verhältnis zum freien Gespräch
Die Kataloge (welche Fragen, welche Pools existieren) sind deterministische, admin-gepflegte Daten. Der Chat entscheidet nicht, *was* im Hotel-Pool steht — er entscheidet, *dass* er den Hotel-Pool laden muss, weil er im Gespräch erkannt hat, dass es sich um ein Hotel handelt. Dieselbe Trennung wie in Teil 3 (KI wählt/interpretiert, Struktur bleibt Daten).

### 4.4 Offen, aber kein Architekturpunkt: Katalog-Inhalte
Welche Fragen ein Hotel-Pool konkret enthält, ist Fachwissen (Andreas/Martin), das heute in keinem Dokument steht — vergleichbar mit den für B3-3 blockierenden Branchenkennzahlen. Reine Content-Beschaffung, kein Bauhindernis für die hier beschriebene Struktur.

---

## 5 — Teil 3: Dynamischer, KI-gebauter Report

### 5.1 Dreistufiges Freiheitsmodell
Revidiert gegenüber dem ursprünglichen Vorschlag dieser Sitzung (der nur Formulierung freigab) — auf ausdrücklichen Wunsch, mehr Freiheit zuzulassen, weil der Urbanz-Fall selbst durch Iteration und Annahme von KI-Vorschlägen entstand:

1. **Zahlen/Berechnung — fest.** Kommen unverändert aus der deterministischen Engine (`AnalysisResult`). Daran ändert dieses Delta nichts; das ist eine Zusage, kein Diskussionspunkt.
2. **Auswahl & Struktur — frei aus einem Baukasten.** Welche Kapitel, welche Grafik-Art, welche Reihenfolge, was wird betont — hier bekommt die KI echte Kompositionsfreiheit, nicht nur ein Regelwerk mit mehr Bedingungen.
3. **Formulierung — frei.**

**Bewusste Grenze bei Stufe 2:** Freiheit bei **Auswahl und Kombination** aus einem deutlich erweiterten, aber weiterhin typisierten und geprüften Baukasten an Grafik-/Abschnitts-Bausteinen — nicht Freiheit, völlig neue Grafik-Arten frei zu erfinden. Die bestehende react-pdf+Rasterbild-Pipeline (B23) ist gegen eine überschaubare Zahl bekannter, gemessener Diagramm-Typen gebaut. Der Baukasten kann über die heutigen sieben festen Grafiken deutlich hinauswachsen, bleibt aber ein Baukasten aus vordefinierten, typisierten Bausteinen — freie Diagramm-Generierung durch die KI ist eine grundsätzlich andere, hier nicht beauftragte Baustelle.

### 5.2 Reproduzierbarkeit und Archivierung
Das Zahlenwerk bleibt über B14-1 unverändert eingefroren (`AnalysisResult`, "nie nachrechnen"). Da jetzt aber auch Struktur und Auswahl KI-generiert sind, können zwei identische `AnalysisResult`-Objekte zu unterschiedlichen Reports führen. **Neue, hier fest gesetzte Anforderung:** der tatsächlich ausgelieferte Report (Struktur **und** Text, nicht nur die zugrundeliegenden Zahlen) wird vollständig archiviert — sonst ist bei einer späteren Rückfrage nicht mehr rekonstruierbar, was der Kunde tatsächlich gesehen hat. Das ist eine Erweiterung von B14-1 (heute archiviert `platform.analyses` `inputs`/`result` als jsonb, nicht das gerenderte Dokument selbst, gemessen in der Bestandsaufnahme E.6).

### 5.3 Kennzeichnung Annahme vs. Messwert im Narrativ
Damit die KI-Freiheit bei Formulierung/Struktur die bestehende Disziplin nicht unterläuft (ein Modell könnte "Ihre PV-Anlage erzeugt X kWh" schreiben, ohne "geschätzt" zu ergänzen): die KI komponiert **ausschliesslich aus vorqualifizierten Aussage-Bausteinen**, die ihre Annahme/Messwert-Kennzeichnung bereits tragen — sie erzeugt keine neuen Fakten-Aussagen frei aus Rohzahlen. Das ist eine direkte Fortschreibung der bestehenden B23c-1-Regel ("jede Aussage entsteht nur, wenn die Grösse gerechnet wurde") auf die neue Narrativ-Schicht, keine neue Erfindung.

---

## 6 — Zugang, Entitlement, Kostenbremse

### 6.1 Zugang (löst OP#1)
Kalkulator wird für alle offen zugänglich — Registrierung mit Account statt Kuratierung/Gutscheincode. Perspektivisch ("Firewall") eine Bezahlschranke möglich, hier nicht gebaut.

### 6.2 `calculator_pro`-Entitlement (B10)
Bleibt technisch bestehen — die Prüfung selbst (Sitzung + Entitlement) ändert sich nicht. **Korrektur (Bestandsaufnahme G):** die Annahme "statt Gutscheincode automatisch bei Registrierung" unterschätzte den Ist-Zustand. Es gibt heute **zwei** manuelle Vergabewege, nicht einen — Gutscheincode UND genehmigte Partner-Anfrage (B18-4, Entitlement in derselben Transaktion wie die Genehmigung) — und **keinen** generischen Vergabe-Wrapper (`admin_grant_entitlement` ist ausdrücklich nicht gebaut). Eine automatische Vergabe bei Registrierung ist damit kein Umstellen eines bestehenden Schalters, sondern ein **neuer, dritter Schreibweg**, der neben den beiden bestehenden entsteht. **In diesem Bauschritt NICHT umgesetzt** (s. NICHT-TUN) — offener Punkt 8.

**Zu entscheiden, hier nicht vorweggenommen:** bleiben Gutscheincode und Partner-Anfrage als Wege für besondere Fälle (z. B. Fachbetrieb vermittelt einen Kunden) neben der automatischen Vergabe bestehen, oder werden sie mit offenem Zugang überflüssig? Vorschlag: bestehen lassen — der Partner-Weg trägt eine andere Bedeutung (Fachbetrieb-Vermittlung, perspektivisch B13-relevant) als "irgendwer registriert sich".

### 6.3 Kostenbremse
**Ein Limit pro Konto** (nicht zusätzlich separat pro Projekt), **admin-editierbar**, **Admin-Rolle ausgenommen** (keine Grenze). Anfangs grosszügig, iterativ nachjustierbar. Das ist der erste Fall im Repo, in dem ein Limit admin-pflegbar statt Code-Konstante ist (bestehende Grössenlimits wie `MAX_INVOICE_FILE_BYTES` sitzen fest im Code) — hier bewusst anders, weil die Zahl laut Auftrag "lernend" angepasst werden soll. Erste Ausbaustufe: einfache Zählung (Nachrichten/Uploads pro Zeitraum), kein Kosten-Tracking in Euro. **In diesem Bauschritt NICHT umgesetzt** (s. NICHT-TUN) — offener Punkt 4.

---

## 7 — Verhältnis zu den nicht verhandelbaren Prinzipien

| Prinzip | Berührt? |
|---|---|
| 1. Die Rechnung ist die Wahrheit | Nein — Quellen-Vorrang-Logik bleibt, wird durch den Chat nur anders bedient. |
| 2. Ein Dispatch, eine ehrliche Zahl | Nein — Engine unverändert, auch bei mehreren Zählpunkten (§2.4). |
| 3. Physikalisch korrekte Simulation | Nein — kein Eingriff in `simulateBattery`. |
| 4. Public/Portal-Grenze + RLS | Berührt. **Präzisierung (Bestandsaufnahme E):** `platform.leads` — die bislang einzige personenbezogene Tabelle ohne Admin-only-Charakter — trägt keinen Eigentümer-Verweis und ist über RLS ganz ohne Policy gesperrt; Zugriff läuft ausschliesslich über geprüfte Wrapper-Funktionen, nicht über eine RLS-Policy auf `user_id`/`account_id`. Eigentümerschafts-RLS für `Projekt` (§2.2) hat damit **keinen Präzedenzfall** im Repo. **Konsequenz für diesen Bauschritt:** `platform.projects` folgt deshalb NICHT einer neuen RLS-Policy-Konstruktion, sondern demselben bewährten Muster wie `leads`/`analyses` — RLS aktiv, ohne Policy, Zugriff ausschliesslich über SECURITY-DEFINER-Wrapper mit Prüfung im Funktionsrumpf (`account_id` gegen `auth.uid()` bzw. `is_admin()`). |
| 5. Transparenz statt Black Box | Zentral betroffen — durchgehend mitgedacht (§3.3-Hinweis, §5.2/5.3-Archivierung). |
| 6. Für Skalierung bauen, ohne Over-Engineering | Die Rollup-Schicht (§2.4) ist der Punkt mit dem grössten Aufwand, sollte nicht vorgebaut werden, bevor ein zweiter Zählpunkt-Fall real ansteht — nicht Teil dieses Bauschritts. |

---

## 8 — Verhältnis zum bestehenden Formular-Flow

**Entschieden:** Der bestehende Formular-Weg (`step-tariff.tsx` & Geschwister) bleibt vollständig erhalten, wird nicht abgelöst. Der Kunde wählt beim Projektstart **Formular oder Chat**, **Standard: Chat**. Keine Umschaltung während eines laufenden Projekts.

**Warum das architektonisch günstig ist:** beide Wege füllen am Ende dasselbe typisierte Zielobjekt (§3.1) — der Formular-Weg tut das heute schon, der Chat tut es neu. "Formular oder Chat" ist damit kein zweites Backend, sondern zwei Front-Türen zu ein und demselben Contract.

**Bewusste Einschränkung:** Der Formular-Weg bleibt auf seinem heutigen Funktionsumfang — er wird **nicht** um Betrieb-spezifische Fähigkeiten erweitert (mehrere Zählpunkte, Branchen-Fragenkatalog). Ein Betriebskunde mit dieser Komplexität wird zum Chat geführt.

---

## 9 — Offene Punkte (ehrlich gesammelt)

1. **Konkreter Feldzuschnitt Betrieb-Contract** (§3.4) — welche Felder genau; Leistungsmessungs-Variante muss dabei neu ins Contract gehoben werden (Bestandsaufnahme A), nicht nur aus der UI übernommen.
2. **Fragenkatalog-Inhalte** (§4.4) — Fachwissen, Owner Andreas/Martin, kein Architekturpunkt.
3. **Erkennungslogik "Struktur, die wir nicht abbilden"** (§3.5) — dass es diese Anforderung gibt, ist entschieden; wie der Chat das konkret erkennt, nicht.
4. **Genaue Zahl der Kostenbremse** (§6.3) — "anfangs grosszügig", kein Startwert festgelegt; Umsetzung selbst nicht Teil dieses Schritts.
5. **Baukasten-Inhalt für Teil 3** (§5.1) — welche zusätzlichen Grafik-/Abschnitts-Typen über die bestehenden sieben hinaus, konkret.
6. **Benachrichtigung nach Martin-Korrektur** (§3.3) — empfohlen, nicht entschieden.
7. **Wie entsteht der Chat-Zustand technisch** (§2.2) — eigener, künftiger Bauschritt.
8. **Bleiben Gutscheincode und Partner-Anfrage neben der automatischen `calculator_pro`-Vergabe bestehen?** (§6.2) — Vorschlag gemacht, nicht entschieden; Umsetzung selbst nicht Teil dieses Schritts.
9. **`deleted_questions`-Protokoll für den Fragenkatalog** (§4.2) — dass es eins geben sollte, ist entschieden; der genaue Zuschnitt und die Tabelle selbst gehören zum künftigen Fragenkatalog-Bauschritt, nicht zu diesem.

---

## 10 — Baustand

**Gebaut (dieser Schritt):** Account/Projekt-Fundament — `platform.accounts`, `platform.projects`, Besitz- und Admin-Wrapper. Siehe Handover-Log für Details.

**Nächste Schritte, je eigene Session:** Chat-Infrastruktur (§2.2, §3), Zählpunkt + Rollup-Schicht (§2.3/2.4), Fragenkatalog (§4), Report-Baukasten (§5), Kostenbremse (§6.3), automatische Entitlement-Vergabe (§6.2).
