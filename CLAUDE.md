# CLAUDE.md — Peak Shaving Kalkulator

> Diese Datei wird bei jeder Session automatisch geladen. Sie ist bewusst kurz.
> **Maßgebliches Detaildokument: `./Pflichtenheft_Kalkulator_MVP.md`** — bei Widerspruch gilt das Pflichtenheft.
> Diese Datei enthält die Regeln und Leitplanken; das Pflichtenheft enthält die Details.

---

## Was wir bauen

Ein Kalkulator, der aus dem Viertelstunden-Lastgang eines Gewerbebetriebs die Bezugsspitzen erkennt, eine Batterie **physikalisch (SoC-basiert)** simuliert und eine belastbare Wirtschaftlichkeitsrechnung samt Speicherempfehlung erzeugt. Vertrieb über Installateure/Elektriker sowie Direktakquise. Erster Bauabschnitt: die Rechen-Engine (`/packages/engine`).

---

## Rollen & Zusammenarbeit (wichtig)


**Anweisungen an Claude Code immer:**
- Du kennst die Codebase und entscheidest, **wie** etwas in dieser Codebase am besten umgesetzt wird — Struktur, Muster, Bibliotheken, Dateiaufteilung, idiomatischer Code.
- Vorgegeben (nicht selbst umdeuten): **was** gerechnet wird und **warum** — Algorithmus-Logik, Datenverträge (Input/Output-Typen), fachliche Invarianten, Randfälle, Akzeptanzkriterien.
- Deine Freiheit: **wie** du es implementierst. Wähle den in dieser Codebase effizientesten, saubersten Weg. Erfinde keine fachlichen Regeln dazu.
- Wenn eine Aufgabe eine **fachliche/energietechnische** Entscheidung erzwingt, die nicht im Pflichtenheft steht (z. B. wie die Mindestleistung greift, ob monatlich/jährlich iteriert wird, wie ein Randfall zu werten ist): **nicht selbst festlegen — kurz zurückfragen.** Das ist eine Konzeptlücke, keine Coding-Entscheidung.

---

## Arbeitsweise (Advisor-Modus, auch für dich)

- Du bist Advisor, nicht Ausführungsgehilfe. Wenn ein Auftrag suboptimal ist, sag es direkt — mit Begründung, Alternative und dem konkreten Risiko. Kein Ja-Sagen aus Höflichkeit.
- Kennzeichne Unsicherheit: **[Certain]** (harte Evidenz) · **[Likely]** (starke Schlussfolgerung) · **[Guessing]** (Lücke gefüllt).
- **Kein Frage-Ritual.** Frag nur, wenn die Antwort etwas Wesentliches klärt — keine feste Anzahl. Ist die Sache klar, leg los. Ist etwas mehrdeutig, kläre zuerst das, was den größten Unterschied macht.
- Dieses Hinterfragen gilt für **Architektur- und Richtungsentscheidungen**, nicht für triviale Umsetzungsschritte. Bei klarem Auftrag: umsetzen, nicht nachfragen.
- Führe nicht mit Zustimmung, wenn Zustimmung nicht verdient ist. Wenn ich falsch liege, sag: „Ich widerspreche, weil … / stattdessen … / das Risiko deines Ansatzes ist …".

---

## Nicht verhandelbare Prinzipien

1. **Die Rechnung ist die Wahrheit.** Tarifsätze (Leistungspreis, Abrechnungsmodell, Mindestleistung) kommen aus der Netzrechnung des Kunden, nicht aus einer gepflegten Datenbank. Das *Wie* der Umrechnung Spitze→Kosten ist eine austauschbare Strategie (`TariffStrategy`), kein hartkodierter Jahreshöchstwert.
2. **Ein Dispatch, eine ehrliche Zahl.** Peak Shaving, Eigenverbrauch und tarifbewusstes Laden konkurrieren um dieselbe Batteriekapazität. Genau ein simulierter Fahrplan, Priorität Spitzenschutz. Ersparnisanteile transparent aufschlüsseln, **nie** unabhängig addieren.
3. **Physikalisch korrekte Simulation.** Batterie = Leistung (kW) **und** Energie (kWh). Chronologischer SoC-Durchlauf über alle Viertelstunden inkl. Wirkungsgrad. Kein „Peak-Zählen".
4. **Public/Portal-Grenze + RLS von Tag 1.** Öffentlicher Rechner: client-side, Verbrauchsdaten verlassen den Browser nicht. Persistenz erst bei bewusster Lead-Abgabe mit Einwilligung. Multi-Tenancy/RLS ist Architektur, nicht Nachrüstung.
5. **Transparenz statt Black Box.** Jede Kernzahl zur Rechenweise nachvollziehbar; zentrale Annahmen editierbar.
6. **Für Skalierung bauen, ohne Over-Engineering.** Entscheidungen so treffen, als ginge das System morgen in Produktion — aber schlank, sauber, testbar. Keine Demo-Abkürzungen im Fundament; keine spekulativen v2-Features vorbauen.

---

## Engine-Regeln (`/packages/engine`)

- **Rein & isomorph:** framework-frei, keine DOM-/Node-spezifischen Abhängigkeiten, kein I/O im Rechenkern. Läuft im Browser (öffentlich) und serverseitig (Portal).
- **Deterministisch:** gleiche Eingabe → gleiche Ausgabe, keine Seiteneffekte.
- **100 % unit-testbar.** Tests zuerst gegen synthetische Lastgänge (z. B. Bäckerei mit Morgenspitze), später gegen Martins echten Referenzfall. **Erst Logik + Tests, dann UI.**
- Fachliche Invarianten aus dem Pflichtenheft sind als Tests abzusichern (z. B. „abgerechneter kW-Wert nie unter Mindestleistung", „Ersparnisanteile werden nicht doppelt gezählt", „SoC nie < 0 oder > nutzbare Kapazität").

---

## Tech-Stack & Struktur

- **Sprache/Engine:** TypeScript, framework-freies Paket `/packages/engine`.
- **Frontend:** Next.js (App Router), Tailwind CSS.
- **Backend/DB:** Supabase (PostgreSQL, RLS, Storage, Auth), Vercel.
- **Parser/Charts:** PapaParse (CSV), SheetJS/xlsx, Recharts.
- **UI/Design:** zwei Oberflächen mit **gegensätzlichem Charakter** — öffentlicher Rechner mobile-first & lebendig (darf animieren), Report/Portal desktop-first & ruhig (Tablet Pflicht). shadcn/ui, Inter, `tabular-nums` für Zahlen, **Akzent als CSS-Variable** (White-Label). Bindende Prinzipien: Pflichtenheft §6.1 · konkrete Tokens: `./DESIGN.md`. **Der Engine-unabhängige UI-Teil (Designsystem, Marketing, 4-Schritt-Gerüst, Formulare, Worker-Harness gegen gemockten Contract) läuft parallel zur Engine (§9).** Der Report mit echten Zahlen wird erst nach getestetem Engine-Kern (M1-Gate, §3.11) verdrahtet — nicht erst nach Martins Validierung.
- **Monorepo:**
  ```
  /packages/engine   ← reine Rechen-Bibliothek (zuerst)
  /packages/shared   ← Typen, Konstanten, Schemata
  /apps/website      ← öffentliche Seite + öffentlicher Rechner (client-side Engine)
  /apps/portal       ← eingeloggte Multi-Tenant-App (RLS)
  /supabase          ← Schema, Migrations, RLS-Policies
  ./*.md             ← Pflichtenheft, DESIGN.md, Konzeptdokumente (im Root, kein /docs)
  ```
- Paketspezifische Regeln können später als eigene `CLAUDE.md` je `/packages/*` bzw. `/apps/*` ergänzt werden (nächstgelegene Datei gilt).

---

## Offene Abhängigkeiten (blockieren Validierung, nicht den Bau)

Solange nicht von Martin geliefert: mit **synthetischen** Daten + **Dummy**-Batteriekatalog arbeiten. **Keine ROI-Zahl als „echt" ausgeben**, bevor gegen einen echten Lastgang + echte Netzrechnung validiert wurde.
- Echter 12-Monats-Lastgang + Netzrechnung eines Bestandskunden (Validierungs-Gate).
- Leistungspreis-Systematik der 3 Netzbetreiber (Wiener Netze, Netz NÖ, Salzburg) → `billingModel`-Default.
- Batteriekatalog, CSV-Musterexporte (Netzbetreiber + Wechselrichter).

Details und der vollständige Stand: siehe `./Pflichtenheft_Kalkulator_MVP.md`, §8.

---

## Stand & offene Entscheidungen

> Lebendiger Handover-Anker. Neueste offene Punkte, die den Bau der Engine/Simulation berühren. Erledigtes wandert raus.

- **[OFFEN] Static-Control-Simulationssemantik** (Pflichtenheft §3.6/§3.8, `controlType: 'static'` vs `'dynamic'`): Kapp-Suche + `socFloor` unterstellen aktuell jeder Batterie vorausschauende Steuerung. Eine echte statische Residential-Batterie kann das nicht (keine Vorausschau auf künftige Spitzen). Klärung mit Martin ausstehend, ob (a) gleiche Kapp-Suche + Warnhinweis, (b) eigener reaktiver Dispatch ohne `socFloor` für `controlType:'static'`, oder (c) statische Batterien nur für Eigenverbrauch ranken, nicht für Peak Shaving. **BLOCKIERT Prompt 3b (SoC-Simulation).** Alles andere ist davon unabhängig und kann gebaut werden.

- **[PROVISORISCH] `dispatchTrace`-Shape** (`packages/shared`, `AnalysisResult` §3.10/§6.2): Umgesetzter Vorschlag trägt NUR von der UI nicht ableitbare Größen — `capKwByPeriod`, `caughtPeaks` (Overlays) und `representativeDays` (15-min-Zerlegung Netz/PV/Batterie/SoC für den Tages-Energiefluss). Bewusst **keine** Duplikation der bis zu 35.040 Rohpunkte (UI hat den Lastgang client-side; Downsampling der Jahresübersicht bleibt UI-Sache, DESIGN.md uPlot). Vor dem Report-Bau (Chart-Verdrahtung) mit Martin/UI-Track bestätigen.
  - **[FIXIERT] `representativeDays`-Auswahl:** Pflicht-Tag = `label:'worst_caught_peak'` (Tag der teuersten ABGEFANGENEN Spitze); optionaler zweiter Tag = `label:'pv_strong'` (PV-starker Tag für den Eigenverbrauchs-Fall, nur wenn PV/Einspeisung vorliegt). Die Auswahl ist eine fachliche Aussage, keine UI-Kosmetik — U2 trifft sie nicht still.
  - **[FIXIERT] `batteryPowerKw`-Vorzeichen:** **+ = laden, − = entladen** (am Feld dokumentiert; verhindert spiegelverkehrten Energiefluss in U2).

- **[PROVISORISCH] `BenutzungsdauerModel`** (§3.1 referenziert den Typ, §3.5 definiert ihn nie): minimaler Platzhalter in `packages/shared/tariff.ts` (`thresholdHours` + alternative Preisspalte), damit das optionale Feld valide ist. Exakte Umschaltlogik (>Schwelle-h → andere €/kW-Spalte) ist fachlich und für M1 NICHT nötig — nicht ausformulieren, bis Martins Tarif-Systematik (§8 OP#3) vorliegt.

- **[ENTSCHIEDEN: Prozent 0–100] `FinancialParams.*Percent`-Felder** (§3.1/§3.9): Konvention ist **Prozent (0–100), nicht Anteil (0–1)** — das UI-Formular (§5) nimmt „30" entgegen. zod-Schema erzwingt `.min(0).max(100)` auf `subsidyPercent`, `investitionsfreibetragPercent`, `taxRatePercent`; **die Engine dividiert intern durch 100** (§3.9). Der Upper-Bound fängt Faktor-100-Fehler an der Boundary ab.

- **[NOTIZ] `tabular-nums` ist Report-Pflicht (U2)** (DESIGN.md · Pflichtenheft §6.1): alle Finanz-/Lastwerte mit `font-variant-numeric: tabular-nums`, sonst springen Beträge in Spalten. Bei Report-/Tabellen-Komponenten von Anfang an mitziehen — nicht nachrüsten.
