# Report-Baukasten — Auswahlschicht: Verifikation

> Erhoben am 17.09.2026 am Stand von `main` (74b8a18, „Report-Baukasten B2: Katalog-Registry über
> die 28 Bausteine"). Gemessen wurde am Code, nicht an der Doku: jede Fundstelle unten ist eine
> Datei mit Zeilenbezug.
>
> **Frage dieses Berichts:** Was muss geschehen, damit ein Mensch VOR dem Renderlauf entscheiden
> kann, welche Bausteine in einem Report stehen — und welche Bausteine sind dafür heute überhaupt
> freigebbar?
>
> Vorgelagert: `Report_Baukasten_Bestandsaufnahme.md` (was es gibt),
> `Report_Baukasten_Instanzen_Verifikation.md` (B1: Mehrfachberechnungen),
> `Report_Baukasten_KI-Schicht_Bestandsaufnahme.md` (wohin es später geht).

---

## 1 — Was heute steht und was fehlt

**Es gibt einen Katalog, aber keinen Schalter.** `registry.ts` (B2, PR #275) macht alle 28
Bausteine über eine stabile `id` ansprechbar und beweist je Kennung, dass `registry.get(id).build()`
denselben Wert liefert wie der ausgelieferte Rendering-Pfad (`registry.test.ts`, fünf Referenzfälle
× 28 Kennungen). Die Registry ist damit ein **zweites, gemessenes Artefakt** — sie rendert nichts.

Der Rendering-Pfad ist unverändert `document.tsx`: sieben Kapitel-Fassaden, jede baut ihr Kapitel
komplett, das JSX zeigt, was dabei herauskommt. **Es gibt an keiner Stelle einen Eingang, an dem
jemand einen Baustein abwählen könnte.** Was im Report steht, entscheidet ausschliesslich der
Datenbestand.

**Der Auslöser ist ein einziger Knopf.** `apps/web/app/admin/(intern)/kalkulator-projekte/[id]/page.tsx`
(Abschnitt `report`) zeigt je Zählpunkt einen `ActionButton` auf
`createReportRenderRequestAction`; die Aktion rechnet und legt eine Übergabe in
`platform.report_render_requests` ab. Mitgegeben werden genau neun Felder in `report_input_meta`
(`report-render-actions.ts`), gelesen werden davon sieben (`build-report-input.ts`).
`ActionButton` (`apps/web/components/admin/action-button.tsx`) nimmt heute **ausschliesslich
`fields: Record<string, string>`** — verborgene Felder, kein Platz für eine Eingabe.

---

## 2 — Welche der 28 Bausteine freigebbar sind

Freigebbar heisst hier: **abschaltbar, ohne dass an anderer Stelle im Dokument ein Satz ins Leere
zeigt.** Geprüft wurde je Baustein auf eingehende Verweise (Volltextsuche über alle Kapitel-Module
nach dem Ortsbezug — „oben", „darüber", „in den Kernergebnissen", Spaltennamen).

### 2.1 — Die vier ohne eingehenden Verweis

| id | Ort | Erzeuger | Bedingung heute |
|---|---|---|---|
| `data_quality` | Kap. 8 | `basis.ts` `buildDataQuality` | `dataQuality.warnings.length > 0` |
| `pv_outage` | Kap. 8 | `basis.ts` `buildPvOutage` (über `context.pvOutage`) | `hasPv === true` **und** Monatsbefund nicht leer |
| `hour_flow` | Kap. 5 | `insight.ts` `buildHourFlow` | `insightChartPlan(...).hourFlow !== null` |
| `charge_price` | Kap. 5 | `insight.ts` `buildChargePrice` | `insightChartPlan(...).chargePrice !== null` |

Diese vier sind der sinnvolle erste Zuschnitt. Alle vier sind **Beiwerk im Wortsinn**: sie melden
eine Eigenschaft dieses Datensatzes bzw. vertiefen das Ladeverhalten, und keine Zahl des Reports
hängt an ihnen.

### 2.2 — Zwei, die ausdrücklich NICHT freigebbar sind

**`addon` (Kap. 1).** Eingehender Verweis aus Kapitel 2:
`recommendation.ts:142` — „Ob sich ein ZUSÄTZLICHES Gerät neben Ihrer Anlage lohnt, steht in den
**Kernergebnissen**". Abgeschaltet schickt dieser Satz den Leser an eine Stelle, an der nichts mehr
steht.

**`table_candidates` (Kap. 6).** Eingehender Verweis aus `catalog_alternatives` auf die **Spalten**
der Tabelle: `comparison.ts:332–335` — „die Spalten ‚Ersparnis/Jahr' und ‚Netto' sind also
Differenzen". Der Klarsatz beschreibt eine Tabelle, die es dann nicht mehr gäbe.

Beide gehören in die Stufe, in der Querverweise generell ortsunabhängig werden (Stufe D), nicht in
eine Auswahlschicht.

### 2.3 — Die übrigen 22

Sie sind entweder unbedingt (`assumptions`, `limitations`, die beiden Tabellen des Schlusskapitels,
`recommendation`), tragen selbst Kernzahlen (`savings`, `peak_shaving`, `load_shift`,
`monthly_comparison`), sind Kapitel-Klarsätze (`addon_none`, `addon_table`,
`catalog_alternatives`) oder hängen als **Methodik** an einer anderen Zahl
(`method_current_tariff`, `method_spot_uncontrolled`, `method_load_control`, `method_pv_outage`).
Keiner davon ist ein Kandidat für eine Auswahl, die ein Vertriebler trifft.

---

## 3 — Die zwei Kopplungen, die beim Abschalten mitlaufen müssen

Das ist der eigentliche Befund dieses Berichts: **zwei der vier Kandidaten sind nicht allein im
Dokument.**

### 3.1 — `data_quality` → die Datenquellen-Tabelle

`basis.ts:536–537` (Parameter `hasDataQualityNotice` von `loadProfileRows`): die Zelle
„Zeitraum / Stand" der Lastgang-Zeile endet wahlweise auf

- `(Slot-Zählung: Messwerte ÷ 96, wie im Datenqualitäts-Hinweis oben)` — mit Hinweis, oder
- `(Slot-Zählung: Messwerte ÷ 96)` — ohne.

Die Bedingung ist heute `input.analysis.dataQuality.warnings.length > 0`, gesetzt in
`buildDataSources` (`basis.ts:761 ff.`). **Sie ist eine Nachbildung der Bedingung von
`buildDataQuality` und nicht dieselbe Grösse** — bis PR #273 war der Verweis unbedingt und zeigte in
jedem Report ohne Warnungen ins Leere. Eine Auswahl, die den Hinweis abschaltet, ohne diese Zelle
mitzunehmen, **stellt genau den mit #273 behobenen Fehler wieder her**.

⚠ Daraus folgt eine Auflage für die Umsetzung: die Zelle darf nicht ein zweites Mal an der Auswahl
gemessen werden, sondern **am Hinweis selbst** — sonst stehen wieder zwei Bedingungen für eine
Aussage.

### 3.2 — `pv_outage` → `method_pv_outage`

`basis.ts:1092`: `if (pvOutage && pvOutageMonths) items.push(pvOutageMethodItem(pvOutageMonths))` —
kommentiert mit „Am HINWEIS gemessen und nicht an `hasPv`/`pvOutageMonths`: eine Bedingung, ein
Ort." Der Methodik-Absatz „Wie der PV-Befund gemessen wird" hängt also bereits am Hinweis.

**Diese Kopplung trägt die Auswahl — aber nur, wenn die Auswahl an der QUELLE des Hinweises greift
(`context.pvOutage`) und nicht erst im JSX.** Im JSX abgeschaltet bliebe `context.pvOutage` gesetzt,
und im Schlusskapitel stünde eine Methodik zu einem Befund, den das Dokument nicht zeigt.

Dasselbe gilt sinngemäss für 3.1. **Beide Kandidaten des Schlusskapitels gehören deshalb im Kontext
(`context.ts`) gefiltert, nicht in `document.tsx`.**

### 3.3 — Kein solcher Fall bei `hour_flow`/`charge_price`

Geprüft: kein Methodik-Absatz, keine Tabellenzelle und kein Kapitelverweis hängt an den beiden.
Aber: siehe 4.

---

## 4 — Das Bild ist kein Teil des Bausteins

`hour_flow` und `charge_price` sind in der Registry **nur die Aussage** (`buildHourFlow(plan).statement`
bzw. `buildChargePrice(plan.price).statement`). Das zugehörige BILD entsteht an zwei anderen Orten:

- **Rasterung:** `charts.tsx` — `const hourFlowPlan = insight.hourFlow` bzw.
  `const chargePricePlan = insight.chargePrice`, jeweils
  `plan === null ? NOT_RASTERIZED : await attempt(() => captureChart(...))`. `NOT_RASTERIZED` ist
  die bestehende Form für „dieser Fall sieht das Bild gar nicht vor" — kein Lauf, keine Zeit, kein
  Zähler (`chartBuilds`).
- **Platzierung:** `document.tsx` `InsightChapter` → `<ChartFigure raster={charts.hourFlow}
  caption={chapter.hourFlow?.figure.caption ?? ''} missing={chapter.hourFlowMissing ?? …} />`.

⚠ **`ChartFigure` lässt sich nicht still weglassen, indem man nur den Statement-Text abschaltet.**
Ohne Raster rendert sie den `missing`-Satz („Für diesen Report ist keine Stunden-Heatmap
abgebildet: …") — und ohne Statement stünde ein Bild mit Bildunterschrift, aber ohne die Aussage,
die es erklärt. **Die Auswahl muss deshalb die ganze `<ChartFigure>` mitnehmen, nicht nur den
`<Statement>` darunter.**

⚠ Und: `hourFlowMissing`/`chargePriceMissing` sind eine **andere Aussage** als eine Abwahl. Sie
sagen „für diesen Fall gibt es das Bild nicht, und hier ist der fachliche Grund". Eine abgewählte
Grafik hat keinen fachlichen Grund — der Satz wäre dort eine Behauptung über die Daten, die nicht
stimmt. Die Auswahl darf also nicht in `insightChartPlan` zusammenfallen.

⚠ **Kapitel 5 ist ein BEDINGTES Kapitel.** `document.tsx` rendert die `<Page>` und den
Agenda-Eintrag gemeinsam an `context.hasInsight` („EINMAL ENTSCHIEDEN, ZWEIMAL GELESEN"). Sind
beide Bausteine abgewählt, muss diese eine Grösse mitfallen — sonst steht ein Agenda-Eintrag auf
einer Seite mit Überschrift und Vorspann und sonst nichts (D14: „Ein Kapitel, das nur sagt, dass es
leer ist").

---

## 5 — Wo die Auswahl reisen kann

`platform.report_render_requests.report_input_meta` ist **in der Migration ausdrücklich ohne
Struktur** (`20260916090000_create_report_render_requests.sql:61,75`); die Form legt der schreibende
Schritt fest. Die Leseseite ist bereits durchgängig fehlertolerant gebaut: `readMeta`
(`build-report-input.ts`) prüft jedes Feld einzeln und fällt auf „keine Angabe" zurück, mit der
ausgeschriebenen Begründung „eine Übergabe aus einer älteren Fassung trägt die Felder womöglich gar
nicht".

**Damit ist ein additives Feld der richtige Weg und eine neue Tabelle der falsche.** Die Auswahl
ist eine EINGANGSGRÖSSE dieser einen Rechnung, und B14-1 Regel (b) verlangt für eingefrorene
Auslegungen genau das: **Werte, keine Verweise auf veränderliche Konfiguration.** Ein Entwurf oder
eine Vorlage, auf die verwiesen würde, änderte eine bereits übergebene Rechnung still mit.

⚠ **Rückwärtskompatibilität ist keine Kür, sondern Pflicht:** die Übergabe lebt 24 Stunden, es
liegen also zum Zeitpunkt jedes Deployments Zeilen OHNE das neue Feld in der Tabelle. **Abwesenheit
muss „alle vier" heissen.** Daraus folgt zugleich, dass die leere Auswahl (`[]`, alle vier
abgewählt) von der Abwesenheit unterscheidbar bleiben muss — ein unangekreuztes Kontrollkästchen
sendet nichts, „nichts gesendet" und „Feld nicht vorhanden" sehen im `FormData` gleich aus.

---

## 6 — Was daraus folgt (Auflagen für Stufe C)

1. **Additives Feld in `report_input_meta`** (`optionalSections: string[]`), Abwesenheit = alle
   vier. Keine neue Tabelle, kein Entwurf/Veröffentlichen-Zustand.
2. **Die beiden Bausteine des Schlusskapitels werden im KONTEXT gefiltert** (`context.ts`), damit
   die zwei bestehenden Kopplungen (3.1, 3.2) von selbst tragen und nicht nachgebaut werden.
3. **Die beiden Bausteine des Ladeverhalten-Kapitels werden im Dokument gefiltert** — Bild und
   Aussage gemeinsam — und zusätzlich in `charts.tsx` von der Rasterung ausgenommen. Sie dürfen
   NICHT in `insightChartPlan` zusammenfallen (siehe 4).
4. **`context.hasInsight` muss die Auswahl kennen**, sonst entsteht ein leeres Kapitel 5 mit
   Agenda-Eintrag.
5. **`addon` und `table_candidates` bleiben unveränderlich sichtbar** (2.2).
6. **Keine Reihenfolge-Freiheit.** Die vier bleiben an ihrem Platz; alles andere ist Stufe D.
7. **`ActionButton` braucht einen Platz für Eingaben** — die Werte müssen mit DEMSELBEN Absenden
   reisen wie `projectId`/`meteringPointId`, sonst gibt es zwei Zustände (angekreuzt / gerechnet),
   die auseinanderlaufen können.

---

## 7 — Offen, ausdrücklich nicht Teil von Stufe C

- **Reihenfolge und Ortsunabhängigkeit** (Stufe D) — Voraussetzung dafür, dass `addon` und die
  Kandidatentabelle überhaupt freigebbar werden.
- **Eine Vorlage je Kundentyp** (dieselbe Auswahl für mehrere Läufe). Sobald sie kommt, ist die
  Regel aus 5 zu beachten: die Vorlage liefert einen WERT in die Übergabe, sie wird nicht verwiesen.
- **Die KI-Auswahl** (`Report_Baukasten_KI-Schicht_Bestandsaufnahme.md`). Sie braucht eine
  content-lose Eignungs-Schicht — die Registry hat bewusst keine („Eignung bleibt am Erzeuger:
  `build()` liefert `null`"), und für eine manuelle Auswahl ist „erzeugen und `null` heisst: gibt
  es nicht" ausreichend.
- **Der Rollup über mehrere Zählpunkte** (D13) — der Knopf rechnet weiterhin genau einen.
