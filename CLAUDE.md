# CLAUDE.md — Peak Shaving Kalkulator

> Diese Datei wird bei jeder Session automatisch geladen. Sie ist bewusst kurz.
> **Maßgebliches Detaildokument: `./Pflichtenheft_Kalkulator_MVP.md`** — bei Widerspruch gilt das Pflichtenheft.
> Diese Datei enthält die Regeln und Leitplanken; das Pflichtenheft enthält die Details.

---

## Was wir bauen

Ein Kalkulator, der aus dem Viertelstunden-Lastgang eines Gewerbebetriebs die Bezugsspitzen erkennt, eine Batterie **physikalisch (SoC-basiert)** simuliert und eine belastbare Wirtschaftlichkeitsrechnung samt Speicherempfehlung erzeugt. Vertrieb über Installateure/Elektriker sowie Direktakquise. Erster Bauabschnitt: die Rechen-Engine (`/packages/engine`).


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
- **Deployment:** vercel
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
- **Parser-Einschränkung (sichtbar fürs nächste Handover, hängt an OP#4):** `parser/detect.ts` erkennt aktuell genau EINE Zeitstempel-Spalte pro Zeile (kombiniert `TT.MM.JJJJ HH:MM` o.ä.) — ein Datum/Uhrzeit-Spaltenpaar (zwei getrennte Spalten) wird nicht unterstützt. Bislang nur in `dev-fixtures/README.md` dokumentiert, deshalb der Demo-Lastgang mit kombinierter Spalte gebaut. Reale Netzbetreiber-Exporte liefern das ggf. anders — beim Eintreffen der OP#4-Musterexporte prüfen und ggf. fixen.

Details und der vollständige Stand: siehe `./Pflichtenheft_Kalkulator_MVP.md`, §8.

---

## Stand & offene Entscheidungen

> Lebendiger Handover-Anker. Neueste offene Punkte, die den Bau der Engine/Simulation berühren. Erledigtes wandert raus.

- **[GESAMTSTATUS]** Committed: Prompt 0, 1, Contract-Härtung, U1, Prompt 2 (Parser), Parser-Einhängung in `apps/website` + Demo-Lastgang, react-hooks-Fix + CI-Fix (pnpm-Version aus dem Workflow entfernt, `pnpm/action-setup` liest die Version jetzt aus `packageManager` in `package.json`), Prompt 3a (TariffStrategy, §3.5) + §3.4 (Spitzenerkennung & Ist-Kosten). Nächster geplanter Schritt: **3b (SoC-Simulation)**. Blockiert: **3b** wartet auf Martins Static-Control-Antwort (s. u.); **reale CSV-Formate** warten auf OP#4.

- **[GEPARKT — bewusst NICHT gebaut] Zentrale kundenübergreifende Datenbasis für KI-Analysen:** Idee, Lastgänge/Ergebnisse aller Kunden zentral zu sammeln und für KI-Analysen zu nutzen. Diese Daten dürfen **NICHT an Energieversorger/Netzbetreiber weitergegeben** werden — strikte Zweckbindung. Weitergabe widerspräche dem „Daten bleiben im Browser"-Versprechen (Prinzip 4) und dem Kern-Vertrauensversprechen. Falls später relevant, gehört derselbe Instinkt (zweckgebunden, kein Durchreichen an Netzbetreiber) in den bestehenden **VPP-Kanal (Bytec)**. Kein Bau ohne explizite fachliche/rechtliche Freigabe.

- **[OFFEN] Static-Control-Simulationssemantik** (Pflichtenheft §3.6/§3.8, `controlType: 'static'` vs `'dynamic'`): Kapp-Suche + `socFloor` unterstellen aktuell jeder Batterie vorausschauende Steuerung. Eine echte statische Residential-Batterie kann das nicht (keine Vorausschau auf künftige Spitzen). Klärung mit Martin ausstehend, ob (a) gleiche Kapp-Suche + Warnhinweis, (b) eigener reaktiver Dispatch ohne `socFloor` für `controlType:'static'`, oder (c) statische Batterien nur für Eigenverbrauch ranken, nicht für Peak Shaving. **BLOCKIERT Prompt 3b (SoC-Simulation).** Alles andere ist davon unabhängig und kann gebaut werden.

- **[PROVISORISCH] `dispatchTrace`-Shape** (`packages/shared`, `AnalysisResult` §3.10/§6.2): Umgesetzter Vorschlag trägt NUR von der UI nicht ableitbare Größen — `capKwByPeriod`, `caughtPeaks` (Overlays) und `representativeDays` (15-min-Zerlegung Netz/PV/Batterie/SoC für den Tages-Energiefluss). Bewusst **keine** Duplikation der bis zu 35.040 Rohpunkte (UI hat den Lastgang client-side; Downsampling der Jahresübersicht bleibt UI-Sache, DESIGN.md uPlot). Vor dem Report-Bau (Chart-Verdrahtung) mit Martin/UI-Track bestätigen.
  - **[FIXIERT] `representativeDays`-Auswahl:** Pflicht-Tag = `label:'worst_caught_peak'` (Tag der teuersten ABGEFANGENEN Spitze); optionaler zweiter Tag = `label:'pv_strong'` (PV-starker Tag für den Eigenverbrauchs-Fall, nur wenn PV/Einspeisung vorliegt). Die Auswahl ist eine fachliche Aussage, keine UI-Kosmetik — U2 trifft sie nicht still.
  - **[FIXIERT] `batteryPowerKw`-Vorzeichen:** **+ = laden, − = entladen** (am Feld dokumentiert; verhindert spiegelverkehrten Energiefluss in U2).

- **[PROVISORISCH] `BenutzungsdauerModel`** (§3.1 referenziert den Typ, §3.5 definiert ihn nie): minimaler Platzhalter in `packages/shared/tariff.ts` (`thresholdHours` + alternative Preisspalte), damit das optionale Feld valide ist. Exakte Umschaltlogik (>Schwelle-h → andere €/kW-Spalte) ist fachlich und für M1 NICHT nötig — nicht ausformulieren, bis Martins Tarif-Systematik (§8 OP#3) vorliegt.

- **[ENTSCHIEDEN: Prozent 0–100] `FinancialParams.*Percent`-Felder** (§3.1/§3.9): Konvention ist **Prozent (0–100), nicht Anteil (0–1)** — das UI-Formular (§5) nimmt „30" entgegen. zod-Schema erzwingt `.min(0).max(100)` auf `subsidyPercent`, `investitionsfreibetragPercent`, `taxRatePercent`; **die Engine dividiert intern durch 100** (§3.9). Der Upper-Bound fängt Faktor-100-Fehler an der Boundary ab.

- **[NOTIZ] `tabular-nums` ist Report-Pflicht (U2)** (DESIGN.md · Pflichtenheft §6.1): alle Finanz-/Lastwerte mit `font-variant-numeric: tabular-nums`, sonst springen Beträge in Spalten. Bei Report-/Tabellen-Komponenten von Anfang an mitziehen — nicht nachrüsten. Umgesetzt via `components/report/num.tsx` (`<Num>`); im Stepper/Progress ebenfalls angewandt.

- **[GEBAUT: U1] Öffentliche Rechner-Hülle** (`/apps/website`, engine-unabhängig, §9-Paralleltrack): shadcn/ui an DESIGN.md-Tokens gebunden (globals.css = Wahrheit, Bridge-Aliasse), Marketing-Landingpage (mobile-first, animierter Energiefluss), 4-Schritt-Flow (`/rechner`), Report-Grundstruktur (desktop-first, Charts als Platzhalter), Lead-Dialog-Stub. Rendert weiter gegen das **Mock-AnalysisResult** (bis auf `dataQuality`, s. u.) — noch KEINE echte Rechnung. Verbleibender Andockpunkt für Folge-Prompts:
  - **Prompt 4 (Engine) → `lib/analysis.worker.ts`:** die Off-Main-Thread-/Progress-Verdrahtung ist real; im Worker sitzt nur eine Mock-Funktion (bis auf `dataQuality`, s. u.). Nur den Rechen-Block durch den echten Engine-Aufruf ersetzen — Protokoll/Hook (`lib/use-analysis.ts`) bleiben. Der Mock lebt allein in `lib/mock-analysis.ts`.
  - **Offen:** alle sichtbaren Texte sind `[MARTIN: Copy]`-Platzhalter (Headlines, Katalog-Namen, Rechtstexte §5.1); echte Charts (Recharts) + editierbares Annahmen-Panel sind U2; Lead-Persistenz ist M3.

- **[GEBAUT: Parser] CSV/XLSX-Parser + Lastgang-Aufbereitung** (`/packages/engine/src/parser`, §3.2/§3.3): rein & isomorph, kein Datei-I/O (Inhalt kommt als String/ArrayBuffer herein). `parseLoadProfile`/`parsePvProfile` → `ParseOutcome` (Discriminated Union: `ok` · `needs_mapping` bei uneindeutiger Einheit · `error`). Generische Erkennung (Delimiter `;`/`,`, Dezimal `,`/`.`, Datumsformate inkl. Excel-Serial, BOM/Header/Leerzeilen, kW-vs-kWh mit `kW = kWh × 4`), alle drei `source`-Fälle → signiertes `gridPowerKw`, UTC-Normalisierung (DST-bewusst über Intl), 15-min-Gitter mit Lücken-Interpolation + `dataQuality`. **Pflichtwarnung §3.1** (`import_only` ohne PV) ist als Test abgesichert. Gegen **synthetische** Fixtures bewiesen (23 Tests) — die **realen** Formate NICHT.
  - **[OFFEN, OP#4] Echte Netzbetreiber-/Wechselrichter-Muster** (Wiener Netze, Netz NÖ, Salzburg; Fronius/SMA/Sungrow): der eine ausstehende Input. Adapter-Layer (`parser/adapters.ts`, Registry) ist der Andockpunkt — reale Profile kommen als eigene `FormatAdapter` rein, OHNE den generischen Kern zu ändern. Alle Format-Annahmen im Code als `[ANNAHME: unbestätigt bis Martins Muster (OP#4)]` markiert (Import/Export-Header-Keywords inkl. OBIS-Kürzel, XLSX-Datumszellen = lokale Wanduhr, all-positive Einzelspalte → `import_only`). Schaltet die reale Format-Abdeckung + das §10-Akzeptanzkriterium (drei Netzbetreiber-Formate) frei.

- **[GEBAUT] Parser real in `apps/website` eingehängt** (`components/flow/step-upload.tsx`, PARSE-SLOT aus U1 aufgelöst): `onFile` ruft jetzt echt `parseLoadProfile` auf (Datei client-side per `file.text()`/`arrayBuffer()` gelesen, Prinzip 4 gewahrt). `ok` → getyptes `LoadProfile` + `dataQuality` wandert als `CalculatorPayload.load` in den Worker-Payload (`analysis-protocol.ts`: Payload ist nicht mehr `unknown`); `analysis.worker.ts` übernimmt bereits jetzt die **echte** `dataQuality` in das sonst weiter gemockte `AnalysisResult` (Report zeigt reale Lücken/Warnungen). `needs_mapping`/`error` → einfache Inline-Meldung (amber/rot), „Weiter" bleibt gesperrt. Damit `engine` clientseitig bündelbar ist, ist sein `package.json` jetzt wie `shared` auf Source-Exporte umgestellt (`main`/`types` → `src/index.ts`) + `transpilePackages: ['shared','engine']`; kein Build-Order-Zwang. Per Playwright (Happy-Path + `needs_mapping` + `error`) gegen den echten Dev-Server verifiziert.
  - **[OFFEN] Voller Mapping-Bestätigungsdialog (§3.2)** für `needs_mapping` ist NICHT gebaut — bewusst aus diesem Prompt ausgeklammert. Aktuell nur die vom Parser gelieferte Problem-Meldung (z. B. Einheit uneindeutig) als Text, keine Korrektur-UI (Spalten/Einheit manuell zuordnen). Nachziehen, sobald reale Formate (OP#4) das öfter nötig machen.
  - **[NOTIZ] Demo-Lastgang** (`dev-fixtures/demo-baeckerei-lastgang-2023.csv` + Generator-Skript, reproduzierbar/deterministisch): synthetische Bäckerei, kein PV, 35.040 Viertelstunden-Werte im aufbereiteten `LoadProfile` (Rohdatei hat wegen absichtlicher Lücken etwas weniger Zeilen). Nutzt EINE kombinierte Zeitstempel-Spalte (`TT.MM.JJJJ HH:MM`) statt eines Datum/Uhrzeit-Spaltenpaars, weil die generische Erkennung (`parser/detect.ts`) aktuell genau eine Zeitstempel-Spalte pro Zeile erwartet — Details in `dev-fixtures/README.md`.

- **[GEBAUT] TariffStrategy (§3.5) + Spitzenerkennung & Ist-Kosten (§3.4)** (`/packages/engine/src/tariff`, `/packages/engine/src/peaks`): reine Engine-Logik, noch KEINE Worker-/UI-Verdrahtung (folgt erst mit Prompt 4, sobald 3.6–3.9 stehen). `TariffStrategy`-Interface + drei Implementierungen (`annual_max`, `monthly_max_average`, `monthly_max_sum`), Mindestleistung immer zuletzt (`billedKw = max(computed, minBillableKw)`). `benutzungsdauerModel` bewusst nicht verdrahtet (wartet auf OP#3). Monats-/Wochentag-/Stunden-Gruppierung läuft über **lokale** Zeit (`loadProfile.timezoneMeta`, DST-bewusst via `parser/datetime.ts:utcMsToLocalFields`, neu extrahiert), nicht UTC. `analyzeCurrentPeaks()` liefert `AnalysisResult.current` + `.peaks` (Jahres-/Monatshöchstwerte, Top-N-Spitzen, Verteilung, `leistungspreisCostPerYear`). Zwei Annahmen fixiert und im Code markiert: **Top-N = 10** (`[ANNAHME]`, im Pflichtenheft nicht beziffert) und **`PeakDistribution`-Bucket-Semantik = maximaler Bezug (kW) je Bucket**, nicht Anzahl/Summe (Typ-Kommentar in `packages/shared/analysis-result.ts` aktualisiert). Pflicht-Regressionstest (§3.5/§3.11) zeigt konkret: bei einem Profil mit einem einzelnen dominanten Jahres-Peak liefert `annual_max` billedKw=200 kW gegenüber `monthly_max_average` billedKw=35 kW (Verdünnung auf ~1/12) — bestätigt die Tarif-Korrektheits-These im Code. 18 neue Tests (59 gesamt im Monorepo), `pnpm build`/`lint` grün.

- **[NOTIZ] react-hooks-ESLint aktiv** (`eslint.config.mjs`, nur `apps/**`): `react-hooks/rules-of-hooks` + `exhaustive-deps` als **error**. Bestehender Code war ohne Änderung konform — bei neuen Hooks/Effekten greift die Regel hart (Dependencies vollständig halten, bewusste Ausschlüsse gezielt kommentieren, nicht pauschal deaktivieren).
