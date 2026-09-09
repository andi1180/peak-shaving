# B24 — KI-Interface für den Kalkulator: geführte Dateneingabe und dynamischer Report

**Sitzungsstart-Dokument.** Repo: `github.com/andi1180/peak-shaving`, lokal
`/Users/bf/Developer/peak-shaving`. Stand: 09.09.2026.

> **⚠ FRÜHER KONZEPTSTAND, KEIN PFLICHTENHEFT.** Diese Datei hält fest, was in einer
> Advisor-Sitzung am echten Kundenfall **Markus Urbanz** durchexerziert wurde — sie trifft
> **keine** Architekturentscheidung, beziffert keinen Umfang und schreibt keinen Bau vor.
> Einzuordnen wie seinerzeit `PV_Zeitreihengenerator_Bestandsaufnahme.md` oder
> `PDF_Rendering_Spike_Bestandsaufnahme.md` **vor** ihrem jeweiligen Pflichtenheft: der Stand ist
> festgehalten, damit er beim nächsten Gespräch nicht neu rekonstruiert werden muss.
>
> **Diese Datei ergänzt die bestehenden Kalkulator-Pflichtenhefte, sie ersetzt sie nicht.**
> `Pflichtenheft_Kalkulator_MVP.md`, `Pflichtenheft_Kalkulator_Delta_Tarifoptimierung.md` und
> `Pflichtenheft_Kalkulator_Delta_PDF-Report.md` bleiben unverändert in Kraft und beschreiben
> weiterhin korrekt, was heute gebaut ist. Nichts hier ist als „obsolet" zu lesen.
>
> **Kanonisch für B24** — bei Widerspruch zu `Fahrplan_2026.md` gilt für B24-Fragen diese Datei,
> so wie `B18_Partner-Portal_Ausbau.md` für B18. Für Reihenfolge und Einordnung gegenüber anderen
> Bauabschnitten bleibt `Fahrplan_2026.md` massgeblich.

---

## ZUERST LESEN

1. `Fahrplan_2026.md` — kanonische Quelle für Reihenfolge und Umfang. B24 steht dort als
   **Konzeptstand**, nicht als geplanter Bauabschnitt mit Umfangsschätzung.
2. `Pflichtenheft_Kalkulator_MVP.md` — der bestehende Ansatz: Formularfelder in Schritt 2
   (§5), `AnalysisResult` als Contract (§3.10), Bildschirm-Report (§6.2).
3. `Pflichtenheft_Kalkulator_Delta_PDF-Report.md` — der bestehende Report-Ansatz (B23):
   react-pdf, sieben Grafiken, benannte Kapitel, gemessene Agenda-Seitenverweise.
4. `CLAUDE.md` (Repo-Root) — Handover-Log, insbesondere die sechs bereits gebauten
   KI-Anbindungen (Rechnungs-Scan, Upload-Zuordnung, Bestandsspeicher-Freitext,
   Report-Anfrage, Tarifblatt-Scan, PV-Auslegungs-Scan). **Das hier ist keine erste
   KI-Anbindung, sondern die Frage, ob das Interface selbst eine wird.**

**Diese Datei löst die Arbeitsnotiz `Konzept_KI-gestuetzte_Dateneingabe.md` ab** (nie committet,
Inhalt vollständig in Teil 1 aufgegangen). Jene Notiz hatte in ihrem eigenen Kopf vermerkt, sie sei
zu verlinken, „sobald ein Bauabschnitt vergeben wird" — das ist hiermit geschehen.

---

## 0 — Was dieses Dokument ist und was nicht

| | |
|---|---|
| **Ist** | Der festgehaltene Stand einer Advisor-Sitzung, die live an einem echten Kundenfall gezeigt hat, wie eine KI-geführte Konversation Kundendaten aufnimmt und daraus einen Report baut. |
| **Ist nicht** | Ein Pflichtenheft. Eine Architekturentscheidung. Eine Umfangsschätzung. Eine Aussage darüber, dass der bestehende Weg falsch wäre. |
| **Vorbild** | Die Bestandsaufnahmen vor B22 und B23 — erst messen und festhalten, dann entscheiden, dann bauen. |
| **Nächster Schritt** | Keiner (s. letzter Abschnitt). |

Alle in Teil 1–3 als offen markierten Punkte sind **hier nicht entschieden**, auch wo eine Lösung
naheliegt. Das ist Absicht: eine im Vorbeigehen getroffene Architekturentscheidung wäre genau die
Sorte stiller Festlegung, die dieses Repo sonst vermeidet.

---

## 1 — Ausgangslage

Der Urbanz-Fall wurde **nicht durch ein ausgefülltes Formular korrekt**, sondern durch ein langes,
iteratives Gespräch: Dokumente nachgereicht, Widersprüche aufgedeckt, Rückfragen gestellt, Annahmen
explizit gemacht statt still getroffen.

Starre Eingabefelder können das strukturell nicht leisten. Ein Feld „Ihr Arbeitspreis" nimmt
entgegen, was eingetragen wird, und prüft **nicht**, ob es zur hochgeladenen Rechnung passt.

**These der Sitzung:** die Dateneingabe für den Kalkulator sollte perspektivisch ein **Chat** sein —
mit Datei-Upload, Rückfragen und eigenständiger Prüfung auf Widersprüche — statt eines Formulars mit
vordefinierten Feldern. Das ist kein Selbstzweck, sondern die direkte Konsequenz aus dem, was im
Urbanz-Fall den Unterschied gemacht hat.

---

# TEIL 1 — KI-gestützte Dateneingabe statt Formularfelder

## 1.1 Was der Urbanz-Fall konkret zeigt

Sieben einzelne Momente, an denen ein starres Formular falsch geblieben wäre. **Jeder einzelne hat
im Verlauf eine bereits fertig geglaubte Zahl korrigiert** — das ist der Punkt, nicht die Zahl der
Beispiele.

1. **Falscher Arbeitspreis unbemerkt im System.** Der Rechner hatte € 0,09/kWh hinterlegt; die
   echte Rechnung ergab **€ 0,131/kWh verbrauchsgewichtet**. Der Abstand war in **keinem
   Einzelfeld sichtbar** — er entstand erst im Abgleich gegen die hochgeladene Rechnung.

2. **Unvollständige Kostenbestandteile ohne Fehlermeldung.** „Ihr Tarif heute" enthielt keine
   Netzleistungs-Pauschale und keine Steuern/Abgaben. **Kein Feld war falsch ausgefüllt** — es
   fehlten ganze Kategorien, ohne dass irgendwo „unvollständig" stand. Ein Formular kann diesen
   Fehler grundsätzlich nicht melden: es kennt nur die Felder, die es hat.

3. **Widersprechende Quellen zur selben Anlage.** Martins E-Mail: **8 kW**. Das Anlagenangebot:
   **10,2 kWp**. Ein Formular hätte eines der beiden unkommentiert übernommen — und zwar das,
   welches zuletzt eingetragen wurde, nicht das richtige.

4. **Eine Anomalie, die nur durch Mustererkennung auffiel, nicht durch Nachfragen.** Der
   **PV-Ausfall Feb–Apr** wurde nicht erfragt, sondern aus dem Lastgang selbst erkannt: fehlende
   Nullstunden, systematisch abwesend in drei Wintermonaten. **Kein Nutzer hätte das von sich aus
   gemeldet**, weil ihm die Auffälligkeit gar nicht bewusst war. Eine Rückfrage hätte hier nichts
   genützt — es gab niemanden, den man hätte fragen können.

5. **Datenlücken, die eine sichtbar gekennzeichnete Annahme brauchten.** **156 von 365 Tagen ohne
   Lastgang.** Die Hochrechnung brauchte eine explizite, begründete Annahme statt einer
   stillschweigenden Interpolation.

6. **Heterogene Dokumenttypen, die kein Formular vorhersehen kann.** Rechnung, PV-Angebot,
   Netzbetreiber-Preisblatt, Konkurrenz-Tarifblatt, Marktdaten-Exporte — von denen zu Beginn
   **kein einziger** als Pflichtfeld vorgesehen war.

7. **Fachliche Auflösung von Widersprüchen brauchte eine Person mit Kontext.** Ob 8 kW oder
   10,2 kWp gilt, konnte nur jemand mit Fachwissen entscheiden (**Martin**) — nicht der Endkunde,
   und keine Regel, die man vorab hätte kodieren können.

### Verhältnis zu bereits Gemessenem im Repo

Zwei Anker, damit die Zahlen oben nicht freistehen — **beide sind Beobachtungen, keine Bestätigung
der übrigen Zahlen**:

- Punkt 5 deckt sich mit dem bereits dokumentierten Urbanz-Lastgang: dieser trägt **209 abgedeckte
  Tage** (`Pflichtenheft_Kalkulator_MVP.md`, mehrfach in `CLAUDE.md`). 365 − 209 = **156** — dieselbe
  Lücke, aus der anderen Richtung beschrieben.
- Der Arbeitspreis in Punkt 1 stammt aus der Advisor-Sitzung und ist **hier nicht gegen den Bestand
  gegengeprüft.** `CLAUDE.md` führt für denselben Kunden an anderer Stelle **9,5 ct/kWh** — dort
  ausdrücklich als „aus dem Screenshot zurückgerechnet, nicht von der Rechnung abgelesen".
  Ob und wie die beiden Zahlen zusammengehören, ist **offen und hier nicht geklärt.**

## 1.2 Zielbild

Statt eines Formulars: ein Chat, an den Dokumente hochgeladen werden, der **aktiv nachfragt**, wenn
Angaben fehlen oder sich widersprechen, und der **Annahmen explizit macht statt sie still zu
treffen** — im Kern dieselbe Arbeitsweise, die die Sitzung über den ganzen Urbanz-Fall hinweg
ausgemacht hat, jetzt als wiederholbarer Prozess statt als Einzelfall.

**Start: internes Werkzeug (Martin / Vertrieb), nicht kundenseitig.** Direkt aus Punkt 7 abgeleitet:
die Auflösung von Widersprüchen braucht Fachwissen über Anlage, Kunde und Vertragslage — das hat der
Endkunde in aller Regel nicht.

**Langfristig: kundenseitige Selbstbedienung über die Website.** Dann stellt sich eine Frage, die
intern gar nicht existiert: **was tut der Chat, wenn er auf etwas stösst, das nur Martin oder ein
Techniker beantworten kann?** Zwei Wege stehen im Raum:

**(a) Nachfragen und später liefern.** Der Chat stellt die Frage, die Analyse bleibt liegen, bis die
Antwort da ist. Setzt voraus:
- ein **Kundenaccount** (Login, Sitzung bleibt über Tage oder Wochen erhalten),
- eine **Benachrichtigung**, wenn die Antwort vorliegt.

**(b) Der Chat trifft selbst eine Annahme** — sichtbar gekennzeichnet und begründet, statt zu warten.

**Offen: welcher Weg wann greift.** Die Vermutung aus der Sitzung — Bagatelle → (b),
entscheidungsrelevant → (a) — ist eine Vermutung und **hier nicht entschieden.**

## 1.3 Notwendige Fähigkeiten

- **Datei-Upload beliebiger, nicht vorab festgelegter Dokumenttypen** — Rechnung, Angebote,
  Preisblätter, E-Mails, Marktdaten-Exporte. Keine Vorab-Liste mit Pflichtfeldern.

- **Die Jahresrechnung ist nicht die einzige Form.** Manche Kunden haben **zwölf Monatsrechnungen**
  statt einer Jahresabrechnung; mehrere Dokumente zur selben Frage müssen zusammengeführt werden
  können. **Das ist eher Chance als Zusatzaufwand:** zwölf Monatsrechnungen zeigen den echten Satz
  **jedes einzelnen Monats** direkt — ohne den Verbrauchsgewichtungs-Umweg, den die eine
  Urbanz-Jahresrechnung nötig gemacht hat (Punkt 1 oben).

- **Aktive Rückfrage statt stiller Annahme** — fehlt eine Angabe oder widersprechen sich zwei
  Quellen, wird nachgefragt, nicht automatisch eine der beiden übernommen.

- **Automatisierte Auffälligkeits-Prüfung NEBEN dem Gespräch.** Punkt 4 (der PV-Ausfall) kam nicht
  aus einer Frage, sondern aus einer Musteranalyse der Rohdaten. Das muss als eigener, automatischer
  Prüfschritt **neben** dem Chat laufen — z. B. „Nullstunden-Muster im Lastgang gegen Jahreszeit
  prüfen" als **feste Regel, nicht als Zufallsfund**.

- **Vollständigkeits-Prüfung gegen eine feste Kategorienliste** aller Kostenbestandteile, gegen die
  jede Berechnung geprüft wird, bevor sie als vollständig gilt — damit Punkt 2 nicht wieder
  passiert.

- **Quellen-Vorrang mit Rückfrage bei Widerspruch**, nie stille Bevorzugung einer Quelle: das
  Problem wird benannt („Rechnung sagt X, E-Mail sagt Y") und die Entscheidung eingeholt.

- **Sichtbare Kennzeichnung von Annahmen vs. Messwerten** durchgehend bis in den fertigen Report.
  Das war im Urbanz-Dokument selbst durchgehendes Prinzip und muss aus der Eingabephase
  **mitkommen**, nicht am Ende nachträglich einsortiert werden.

## 1.4 Privat- vs. Betriebskunden — vermutlich eine echte Verzweigung, nicht nur mehr Felder

Urbanz ist ein **Privatkunde** mit vergleichsweise einfacher Ausgangslage: ein Zählpunkt,
Netzebene 7 ohne Leistungsmessung, eine Rechnung, **eine** Person, die entscheidet.

Ein **Betriebskunde** (Hotel-Beispiel) bringt mutmasslich zusätzliche Komplexität mit, die kein
reines „mehr desselben" ist:

- **Leistungsmessung ist bei Gewerbekunden die Regel, nicht die Ausnahme** — andere
  Netzentgelt-Struktur, andere Kappungslogik, andere Kernfrage (nicht nur „welcher Tarif", auch
  „wie viel Leistungspreis lässt sich kappen").
- **Mehrere Zählpunkte, mehrere Gebäude oder Standorte** möglich — die Grundannahme „ein Lastgang,
  ein Kunde" trägt dann nicht mehr.
- **Vorsteuerabzugsberechtigung** ändert die Rechnungsbasis (bei einem Unternehmen der Regelfall,
  nicht die Ausnahme).
- **Andere Entscheidungsstruktur** — ein Betrieb mit eigener Buchhaltung/Technik statt einer
  Einzelperson; die Frage „wer beantwortet Rückfragen" stellt sich nochmal anders (und hängt
  unmittelbar an den zwei Wegen (a)/(b) aus 1.2).
- **Andere Lastprofil-Charakteristik** — durchgehende Grundlast statt der wohnhaus-typischen
  Morgen-/Abendspitzen, was auch die Dispatch-Logik anders gewichten dürfte.

**Vorschlag, hier nicht entschieden:** die Eingabe-Konversation sollte **früh verzweigen**
(Privat/Betrieb), nicht als nachträglicher Filter auf ein gemeinsames Formular — weil sich schon die
Bündel der überhaupt relevanten Dokumente und Fragen unterscheiden.

---

# TEIL 2 — Admin-konfigurierbare Frage-Guidelines

**Neu aus einem Folgegespräch; in der ursprünglichen Arbeitsnotiz nicht enthalten.**

Die „feste Kategorienliste" und die Muss-Fragen aus Teil 1.3 sollen **nicht hart im Code stehen**,
sondern über einen **Admin-Bereich pflegbar** sein: welche Fragen ein Kundengespräch **immer**
stellen muss, je nach Kundensegment.

Beispiele aus dem Gespräch, bewusst als Beispiele und nicht als Katalog:
- „Hat Ihr Hotel eine Sauna?"
- „Gibt es Ladestationen fürs Personal?"

**Segmentierung:** Privat/Betrieb, gegebenenfalls feiner nach Branche.

**Verhältnis zur Dynamik aus Teil 1:** die gepflegte Liste ist die **Baseline** — das KI-Interface
hält sich daran, bleibt aber **frei, zusätzliche Rückfragen dynamisch zu stellen** (Widersprüche,
fehlende Angaben, Auffälligkeiten). Die Liste ist ein Minimum, keine Obergrenze.

**Offen und hier nicht entschieden:**
- die genaue Admin-UI,
- die Granularität der Segmentierung (nur Privat/Betrieb? Branchen? Wie viele?),
- **die Versionierung der Fragenkataloge über Zeit.** Das Repo hält Tarif- und Steuersätze bewusst
  **versioniert im Code** statt in der Datenbank (B11, `packages/shared/src/tariff-catalog.ts` —
  Begründung dort und in `DEPLOYMENT.md` §3a). Ob dasselbe Prinzip für Fragenkataloge gilt oder ob
  ein pflegbarer Admin-Bereich hier gerade das Gegenteil verlangt, ist eine **offene
  Architekturfrage** und wird hier nicht beantwortet.

---

# TEIL 3 — Dynamischer, KI-gebauter Kundenreport

**Neu aus einem Folgegespräch; in der ursprünglichen Arbeitsnotiz nicht enthalten.**

## 3.1 Was die Sitzung gezeigt hat

Der in der Urbanz-Sitzung entstandene Report hat drei Dinge getan, die der heutige Weg nicht tut:

1. **Er wählte selbst, was hervorzuheben ist.** Der PV-Ausfall stand zunächst prominent am
   Seitenanfang und wurde nachträglich an eine sachlich passendere Stelle verschoben — eine
   **Gewichtungsentscheidung** über den Befund, nicht über ein Layout.

2. **Er baute Grafiken passend zum tatsächlich Gefundenen** — nicht aus einem festen Chart-Katalog
   ausgewählt, sondern zur konkreten Datenlage gebaut.

3. **Er erzeugte Abschnitte, die es nur gibt, WEIL bestimmte Datenlücken oder Befunde aufgetreten
   sind.** Der Jahres-Hochrechnungs-Abschnitt existiert ausschliesslich deshalb, weil echte Daten
   fehlten (Punkt 5 aus Teil 1.1). Ohne die Lücke gäbe es den Abschnitt nicht.

## 3.2 Verhältnis zum bestehenden Ansatz (B23) — genau benannt, nicht pauschal

Der bestehende Report ist in `Pflichtenheft_Kalkulator_Delta_PDF-Report.md` beschrieben:
`@react-pdf/renderer`, **sieben Report-Grafiken**, benannte Kapitel („Kernergebnisse" · „Empfehlung
und Lastverlauf" · „Kostenverlauf und ein Tag im Detail" · „Das Ladeverhalten Ihres Speichers" ·
„Speichergrösse und Gerätewahl" · „Methodik & Vorbehalte" · „Annahmen und Datengrundlage"),
gemessene Agenda-Seitenverweise.

**Damit der Unterschied nicht überzeichnet wird — der bestehende Weg ist nicht durchgehend starr:**
- **Zwei Kapitel sind bereits BEDINGT** und entfallen samt Agenda-Eintrag, wenn ihr Inhalt fehlt.
  `REPORT_AGENDA` ist deshalb seit B23c-3 **keine Konstante mehr, sondern eine Funktion.**
- Auch die **Aussagen** sind bereits bedingt: die tragende Regel aus B23c-1/c-2 lautet **„jede
  Aussage entsteht nur, wenn die Grösse gerechnet wurde — fehlt die Grundlage, fehlt die Zeile"**.
- **Höchstens sechs der sieben Grafiken** stehen je Dokument, weil Monatsvergleich und kumulierter
  Kostenvergleich einander ausschliessen.

**Der Unterschied liegt also nicht bei „starr gegen dynamisch", sondern eine Ebene tiefer:** heute
ist die **Menge der möglichen Kapitel, Grafiken und Aussagen im Code festgelegt** und die Auswahl
daraus folgt festen Regeln. Der in der Sitzung gezeigte Report hat die **Menge selbst** aus der
Datenlage gebildet.

## 3.3 Die offene Architekturfrage — ausdrücklich NICHT entschieden

**Frage 1: Wie tief geht die Dynamik?**
- **Variante A:** Die Engine läuft weiter wie heute (deterministische Berechnung, `AnalysisResult`
  als Contract), und eine **KI-Schicht obendrauf** baut nur Auswahl, Narrativ und
  Chart-Zusammenstellung.
- **Variante B:** Die Dynamik geht tiefer.

Was „tiefer" konkret hiesse und welche Zusagen dabei fielen, ist hier **nicht ausgearbeitet.** Die
Frage steht, die Antwort steht nicht.

**Frage 2: Wie verträgt sich „dynamisch, KI-gebaut" mit den bestehenden Zusagen an Kunden?**
Konkret betroffen:
- **Reproduzierbarkeit** — dieselbe Eingabe muss denselben Report ergeben. Das Repo hält das heute
  an mehreren Stellen fest, unter anderem im Analyse-Bündel (B14: eine archivierte Analyse wird
  **nie nachgerechnet**, weil eine 2027 neu gerechnete Baseline eine Prognose wäre, die 2026 niemand
  abgegeben hat).
- **Nachvollziehbarkeit** — Prinzip 5 („Transparenz statt Black Box", `CLAUDE.md`): jede Kernzahl
  muss in ihrer Rechenweise nachvollziehbar bleiben.
- **Kennzeichnung von Annahmen vs. Messwerten** — die Forderung aus Teil 1.3 gilt für den **Report
  genauso wie für die Eingabe**. Ein dynamisch gebauter Abschnitt darf diese Kennzeichnung nicht
  verlieren.

Beide Fragen sind **hier bewusst offen gelassen.**

---

## Bewusst offen gelassen (Sammlung)

**Aus Teil 1:**
1. Wann greift Weg **(a)** (nachfragen + später liefern, mit Kundenaccount und Benachrichtigung) und
   wann Weg **(b)** (sichtbar gekennzeichnete Annahme)? Vermutung: Bagatelle → (b),
   entscheidungsrelevant → (a). **Nicht entschieden.**
2. Der konkrete Zuschnitt der **Privat/Betrieb-Verzweigung** — 1.4 benennt die vermutete Richtung,
   nicht die endgültige Struktur.
3. Wie viel darf **automatisch entschieden** werden, bevor ein Mensch bestätigt? Im Urbanz-Fall lag
   die Endentscheidung („das Angebot zählt, 8 kW war ein Irrtum") **immer** bei einem Menschen, nie
   beim Modell. Ob und wo sich daran etwas ändern soll, ist offen.
4. Die **technische Umsetzung** (welche Schnittstelle, System-Prompt-Inhalt im Detail, Kostenrahmen
   pro Fall) — gehört in ein Pflichtenheft, nicht in diese Notiz.
5. Der **Arbeitspreis-Anker** aus 1.1 Punkt 1 gegenüber der in `CLAUDE.md` dokumentierten Zahl
   (s. „Verhältnis zu bereits Gemessenem").
6. Ab wann das Werkzeug **kundenseitig** wird — die Festlegung „zuerst intern" gilt vorerst, eine
   spätere kundenseitige Stufe ist ausdrücklich nicht ausgeschlossen.

**Aus Teil 2:**
7. Die genaue **Admin-UI** für die Frage-Guidelines.
8. Die **Granularität der Segmentierung** (nur Privat/Betrieb? nach Branche? wie fein?).
9. Die **Versionierung der Fragenkataloge** — Code (B11-Muster) oder Datenbank? Offene
   Architekturfrage.

**Aus Teil 3:**
10. **Wie tief geht die Dynamik** — KI-Schicht über unveränderter Engine, oder tiefer?
11. Wie verträgt sich der dynamische Report mit **Reproduzierbarkeit, Nachvollziehbarkeit und der
    Kennzeichnung von Annahmen vs. Messwerten**?

**Querschnittlich:**
12. Das **Verhältnis zum bestehenden Bau**: was von B21/B22/B23 bleibt unverändert, was wird
    ergänzt, was — falls überhaupt — abgelöst? Hier ist **nichts** als abgelöst markiert.

---

## Nächster Schritt: keiner, bis in einer eigenen Sitzung vertieft

**Dieses Dokument hält nur den Stand fest.** Es ist kein Bau-Auftrag, keine Freigabe und keine
Priorisierung gegenüber den offenen Punkten anderer Bauabschnitte.

Bevor irgendetwas davon gebaut wird, braucht es — nach dem Vorbild von B22 und B23 — den üblichen
Zwischenschritt: **erst eine Bestandsaufnahme gegen den echten Code, dann die Entscheidungen, dann
ein Pflichtenheft, dann der Bau.** Keiner dieser drei Schritte ist hier vorweggenommen.
