# Batteriekatalog — Bestandsaufnahme vor dem Umbau auf eine DB-Tabelle

> Analog `PV_Zeitreihengenerator_Bestandsaufnahme.md`. Reine Bestandsaufnahme, keine
> Code-/Schema-/Katalogänderung. Die Architekturentscheidung (DB statt Code, Muster
> `grid_tariffs`) ist bereits gefallen — dieses Dokument liefert nur die gemessenen Fakten für den
> Umbau.

---

## 1. Konsumenten von `DEMO_BATTERY_CATALOG` und `BatteryCandidate`

**Typ-Definition:** `packages/shared/src/battery.ts:10-25` (`batteryCandidateSchema`, zod).
**Katalog-Konstante:** `packages/shared/src/demo-battery-catalog.ts:22` (`DEMO_BATTERY_CATALOG`,
6 Einträge, siehe §2).

| Paket/App | Datei:Zeile | Verwendung |
|---|---|---|
| `packages/shared` | `demo-battery-catalog.ts:22` | Definition |
| `packages/shared` | `battery-combination.ts:1,19` | Typ-Import (Kommentar); `combineBatteries` für Bestand+Zusatzgerät — **kein** Katalog-Import |
| `packages/shared` | `battery-combination.test.ts:10,41,68,127,128,130,135` | Testet gegen den echten Katalog |
| `packages/shared` | `analysis-bundle.ts` (Feld `batteryCatalog: BatteryCandidate[]` in `AnalysisBundleInputs`, s. §3) | Contract-Feld |
| `packages/engine` | `compute-analysis.ts:477` (Kommentar), `simulation/tou-chain.test.ts:4,95,109,136,146` | `recommendBattery(load, tariff, DEMO_BATTERY_CATALOG, …)` in Tests |
| `packages/engine` | `recommendation/dummy-catalog.ts` | **eigener, unabhängiger** Test-Fixture-Katalog — bewusst NICHT `DEMO_BATTERY_CATALOG` (Kommentar in `demo-battery-catalog.ts:9-11`: sonst koppelt eine Testdaten-Änderung an das Produktionsverhalten des öffentlichen Rechners) |
| `packages/extractors` | `run-from-draft.ts:19,453,482` | `computeAnalysis(payload, horizonYears, DEMO_BATTERY_CATALOG)` — der B24-Wizard-Analyse-Pfad (noch nicht ans UI verdrahtet, s. Fahrplan) |
| `apps/website` | `lib/analysis.worker.ts:2,56,86` | Der öffentliche Rechner rechnet im Worker gegen `DEMO_BATTERY_CATALOG` (mit optionalem `applyBatteryOverride` aus dem Annahmen-Panel) |
| `apps/website` | `lib/bundle-export.ts:2,70` | Export-Bündel trägt den (ggf. überschriebenen) Katalog-Stand |
| `apps/website` | `components/report/report.tsx:4,140` | `baselineCatalog = DEMO_BATTERY_CATALOG` für den Vergleich Override vs. Baseline |
| `apps/website` | `lib/pdf-report/basis.ts:844` (Kommentar) | Begründet, warum die Quellen-Tabelle keinen Preisstand ausweist (s. §5) |
| `apps/web` | `lib/admin/data-entry-ui.test.ts:655` | **Negativ-Wächter**: `expect(allSources).not.toContain('DEMO_BATTERY_CATALOG')` — die Wizard-Batterie-Station darf den Katalog nicht referenzieren (s. §6) |

**Positiv-Kontrolle der Absenz-Aussage in §6:** derselbe Grep-Lauf findet `DEMO_BATTERY_CATALOG` an den 15 Fundstellen oben zuverlässig (Suchmuster funktioniert), meldet aber für `apps/web/lib/admin/battery-draft.ts` und `apps/web/lib/admin/data-entry-actions-batterie.ts` **0 Treffer** — die Abwesenheit ist also gemessen, nicht nur nicht gefunden.

---

## 2. Felder des Batterie-Typs und Engine-Nutzung

`BatteryCandidate` (`packages/shared/src/battery.ts:10-24`):

```
id · name · manufacturer · class (residential|commercial) · usableCapacityKwh · maxPowerKw ·
roundTripEfficiency · pricePerKwh · inverterIncluded · extraInverterCost? · requiresFoundation ·
foundationCost? · controlType (static|dynamic)
```

**Tatsächlich gelesen von der Engine:**

| Feld | Gelesen von | Fundstelle |
|---|---|---|
| `usableCapacityKwh`, `maxPowerKw`, `roundTripEfficiency` | `simulateBattery`-Kette (Dispatch, Peak-Protection, Reserve, Daily-Price-Order) — als `BatteryPhysics`-Teilmenge | `packages/engine/src/simulation/helpers.ts:22-28` (`Pick<BatteryCandidate, …>`), `dispatch.ts:74`, `peak-protection.ts:25`, `reserve.ts:30`, `daily-price-order.ts:121` |
| `maxPowerKw` | `recommendBattery`-Ranking (Leistungsgrenzen-Warnung) | `recommendation/rank.ts:79,98` |
| `pricePerKwh`, `usableCapacityKwh` | ROI (`totalInvestment = Kapazität × Preis`) | `packages/engine/src/roi/roi.ts:20` |
| `requiresFoundation`, `foundationCost` | ROI-Investition + Warnungstext | `roi.ts:21`, `rank.ts:90-91` |
| `inverterIncluded`, `extraInverterCost` | ROI-Investition + Warnungstext | `roi.ts:22`, `rank.ts:93-94` |
| `name`, `id` | Anzeige/Empfehlungstext, `recommendation.batteryId` | `rank.ts:160,208` |
| `roundTripEfficiency` (nochmals, direkt) | `compute-analysis.ts:478` (`perBattery[0].battery.roundTripEfficiency`) | |

**Nicht von der Engine gelesen:** `manufacturer`, `class`, `controlType` — reine Metadaten für UI/Report (Katalog-Herkunfts-Kennzeichnung `[MARTIN: Katalog]`, Klassifizierung residential/commercial, `controlType` dient nur der Konvention „residential oft static, commercial dynamic", `battery.ts:23`).

**Beantwortung der Prompt-Fragen zu Feldgruppen:**

- **Hardwarepreis vs. Installationskosten:** `pricePerKwh` ist der reine Gerätepreis (Kapazität × Preis). Installation ist NICHT ein Feld, sondern zwei optionale Zuschläge: `foundationCost` (Betonsockel) und `extraInverterCost` (separater Wechselrichter, nur falls `inverterIncluded: false`). Es gibt **kein** generisches „Installationskosten"-Feld (Elektroanschluss, Montage-Arbeitsstunden o. ä.) — Positiv-Kontrolle: `foundationCost`/`extraInverterCost` sind vorhanden (`battery.ts:20,22`), ein drittes Kostenfeld existiert nicht (vollständige Feldliste oben ist erschöpfend, aus der zod-Definition abgelesen).
- **Wirkungsgrad:** `roundTripEfficiency` (0 < x ≤ 1), Round-Trip (Lade+Entlade zusammen), nicht getrennt nach Lade-/Entladewirkungsgrad.
- **Nutzbare Kapazität/DoD:** `usableCapacityKwh` — laut Kommentar (`battery.ts:15`) bereits DoD-bereinigt („nutzbare Kapazität (DoD bereits berücksichtigt)"). Es gibt **kein separates** Brutto-Kapazitäts- oder DoD-Feld.
- **Lebensdauer/Zyklen:** **Kein Feld.** Absenz gemessen (grep case-insensitiv auf `zyklen|lifetime|lebensdauer|cycle` in `battery.ts` + `demo-battery-catalog.ts` → 0 Treffer, exit code 1). Positiv-Kontrolle: derselbe Grep-Mechanismus findet `usableCapacityKwh` in `battery.ts:15` zuverlässig.
- **Max-Lade-/Entladeleistung:** `maxPowerKw` — ein einzelner Wert für BEIDE Richtungen (kein getrenntes Lade-/Entlade-Limit), an drei simulationskritischen Stellen als harte Grenze genutzt (s. Tabelle).

---

## 3. Kopie oder Referenz in gespeicherten Analysen

**Vollständige Wertkopie, keine ID-Referenz.** `AnalysisBundleInputs.batteryCatalog: BatteryCandidate[]` (`packages/shared/src/analysis-bundle.ts:238`) trägt den **kompletten Katalog-Stand** (inkl. etwaiger Annahmen-Panel-Änderungen), „vollständig, in der Reihenfolge, in der die Engine ihn bekommen hat" (Kommentar Zeile 234-236). Zusätzlich `batteryOverride?: {batteryId, roundTripEfficiency?, pricePerKwh?, source?}` (Zeile 247-252) als Diff-Information.

**Positiv-Kontrolle (Schreibstelle):** `apps/web/lib/admin/analysis-upload.ts:206-207` — `p_recommended_battery_label: extracts.recommendedBatteryLabel` wird an `public.admin_create_analysis` übergeben. Die DB-Migration `supabase/migrations/20260724150000_create_analysis_persistence.sql:119,346,429,438` legt dafür die typisierten Auszugsspalten `recommended_battery_label text` und `recommended_capacity_kwh` an — **Textlabel + Zahl, kein Fremdschlüssel**. `analysis-bundle.ts:352-371` (`reduceAnalysis`) leitet `recommendedBatteryLabel`/`recommendedCapacityKwh` aus `result.perBattery.find(e => e.battery.id === result.recommendation.batteryId)` ab, also aus dem im selben Bündel mitgelieferten Katalog-Snapshot — nicht aus einem späteren Nachschlagen gegen den aktuellen Katalogstand.

**Ergebnis für den Umbau:** Eine künftige DB-Katalogtabelle darf laut der bestehenden CLAUDE.md-Bindung (B14-1, Regel „(b) KEINE Fremdschlüssel auf veränderliche Konfiguration") **nicht per FK** aus `platform.analyses` referenziert werden — genau das ist hier bereits so umgesetzt: `inputs.batteryCatalog` ist eine Werte-Kopie im eingefrorenen `jsonb`, nicht eine Referenz auf eine Katalogzeile.

---

## 4. Wie der öffentliche Rechner `grid_tariffs` liest — wiederverwendbare Teile

**Dateien:** `apps/website/lib/tariff-data/grid-tariffs.ts` (Funktion `fetchGridTariffs`, `:97`), `apps/website/lib/tariff-data/client.ts` (`createTariffDataClient`, `isTariffDataConfigured`, `NOT_CONFIGURED`, `requestFailed` — der anon-Supabase-Client-Aufbau + Fehlerkonstanten).

**Loading/Failed-Zustände:** `apps/website/components/flow/step-tariff.tsx` — `NetzentgeltState` als Discriminated Union: `{kind:'loading'}` (`:333`) / `{kind:'failed', reason:'not_configured'|'request_failed'}` (`:338`), verwaltet über `useState<{key, state}>` (`:467`) plus `retryToken` (`:469`) für einen manuellen Retry; der `failed`-Zustand rendert `tarif-nicht-verfuegbar.tsx`.

**Wiederverwendbar für einen Batteriekatalog aus derselben Struktur:**
- Der anon-Client-Aufbau (`client.ts:56,64`) — produktweit derselbe Aufbau für jede weitere anon-lesbare Tabelle.
- Das Loading/Failed-Muster als Union-Typ + eigene Failed-Komponente (`step-tariff.tsx:333-338` + `tarif-nicht-verfuegbar.tsx`) — direkt übertragbar auf „Katalog lädt/nicht verfügbar".
- Die Fail-closed-Haltung bei `failed` (Kommentar `step-tariff.tsx:653-670`: „`failed` — ⚠ und das ist die bewusste, unbequeme Entscheidung", kein Rückfall auf einen Vorgabewert) — dieselbe Haltung, die B11 für Tarifsätze bereits durchgesetzt hat (Netzebene 7 wird verweigert statt geschätzt, CLAUDE.md).

Nicht näher untersucht (nicht Teil des Prompts): `apps/website/components/flow/types.ts` (Typ-Vokabular) und `lib/pdf-report/{build-report-input,types}.ts`/`basis.ts` — reine Konsumenten der bereits geladenen Netzentgelt-Daten im Report, kein eigener Lese-Mechanismus.

---

## 5. Batteriepreis im Report — Preisstand?

**Bildschirm:** `apps/website/components/report/assumptions-panel.tsx:133-348` (editierbares `pricePerKwh`-Feld im Annahmen-Panel) · `print-assumptions-snapshot.tsx:67-69` (Druckansicht: `€/kWh` + „Gesamtinvestition") · `recommendation-card.tsx:151,455` (`baseCost`, `roi.totalInvestment`) · `report.tsx:243,292-308` (Override-Handling) · `report-request-panel.tsx:119,129,208` (Feldbeschriftung „Batteriepreis"/„€/kWh" im Annahmen-Änderungsprotokoll).

**PDF (react-pdf):** `apps/website/lib/pdf-report/recommendation.ts:141,156,244,258` (`baseCost`, `totalInvestment`-Zeile, Amortisations-Satz) · `comparison.ts:205` (Alternativen-Tabelle) · `basis.ts` (Quellen-/Annahmen-Tabelle).

**Kein Preisstand/Datum ausgewiesen — explizit als Lücke dokumentiert.** `apps/website/lib/pdf-report/basis.ts:836-847` (Kommentarblock „⚠ DIE ZEILE STEHT IMMER, UND SIE NENNT IMMER DIE LÜCKE"): „`BatteryCandidate` führt Hersteller und Bezeichnung, aber KEIN Herkunfts- und kein Preisfeld: es gibt keine Datenblatt-Fundstelle, kein Abrufdatum und keinen Preisstand (§8: der echte Batteriekatalog steht noch aus, gerechnet wird mit `DEMO_BATTERY_CATALOG`)." Der Report zeigt für den Katalog-Fall stattdessen konsequent eine Lücken-Zeile in der Quellen-Tabelle statt eine erfundene Quelle zu behaupten.

**Für den Umbau relevant:** Sobald der Katalog in einer DB-Tabelle liegt, ist ein Preisstand/Abrufdatum (analog `grid_tariffs`-Versionierung mit Gültigkeitszeitraum) der naheliegende Weg, diese dokumentierte Lücke zu schließen — reine Feststellung, keine Empfehlung.

---

## 6. Verhältnis B24-Wizard-Batterie-Station ↔ Katalog

**Berühren sich im Code NICHT — als expliziter Wächter gepinnt.** `apps/web/lib/admin/data-entry-actions-batterie.ts:61-65` (Kommentarblock „⚠ ES GIBT KEINE KATALOG-ZUORDNUNG, und das ist seit dem 01.09.2026 so"): „Eine genannte Kapazität wird NICHT auf den nächstliegenden Katalog-Kandidaten gerundet … Gespeichert werden ausschliesslich die vier Rohwerte; `battery-combination.ts` kommt hier nicht vor." Die Wizard-Station schreibt eigene, vom Kunden genannte Rohwerte (`packages/shared/src/battery-text.ts`, `BATTERY_TEXT_NUMBER_KEYS`) in einen zählpunkteigenen Entwurf (`battery-draft.ts`) — ein eigenes, strukturell unabhängiges Schema, kein `BatteryCandidate`.

**Positiv-Kontrolle:** `apps/web/lib/admin/data-entry-ui.test.ts:655` prüft aktiv, dass `DEMO_BATTERY_CATALOG` in keiner der Wizard-Quellen vorkommt (s. §1) — der Wächter würde bei einer versehentlichen Kopplung rot.

**Vorgesehener künftiger Berührungspunkt (dokumentiert, nicht gebaut):** `battery-draft.ts:20-23` verweist selbst darauf, dass eine bestehende Kundenanlage später über `packages/shared/src/battery-combination.ts` (`combineBatteries`) in eine Rechnung einfließen könnte — „die bestehende Anlage läuft ausserhalb von `recommendBattery`" — das ist aber der **öffentliche Rechner**-Mechanismus (`apps/website`, existierender Speicher des Kunden), nicht der Wizard selbst; im Wizard-Code ist dieser Pfad laut Kommentar bewusst noch nicht verdrahtet.

---

## 7. Katalog-Empfehlungen der Referenzfälle (Ausgangswerte, Regel 12)

**Demo Hotel** (`~/Documents/…/COOLiN/Demo Daten/Hotel/Demo Hotel Report.pdf`, gerendeter Report):
Empfohlen wird **PeakStore C250** (250 kWh / 125 kW), Gesamtinvestition € 67.000 (Speicher € 52.500 + Betonsockel € 14.500), Ersparnis/Jahr € 13.170, Amortisation 5,1 Jahre. Die Alternativen-Tabelle im selben Report listet die übrigen 5 Katalog-Geräte (PeakStore C60/C40/C25, HomeStore R10/R15) mit identischen Kapazitäts-/Preisangaben wie im aktuellen `demo-battery-catalog.ts` — der Report spiegelt exakt den heutigen 6-Geräte-Katalog.

**Markus Urbanz** (`~/Documents/…/COOLiN/Kunden/Markus Urbanz/`, per Memory `urbanz-referenzfall-liegt-auf-dem-rechner.md`): Hat einen **Bestandsspeicher** (19,2 kWh / 10,6 kW / η 0,9), der über den separaten `existingBattery`-Pfad (`compute-analysis.ts:219,485`, NICHT `recommendBattery`) mit seinen exakten Werten simuliert wird — begründet in `battery-combination.ts:15-16`: „die bestehende Anlage wird mit ihren EXAKTEN Werten simuliert und läuft ausdrücklich NICHT durch `recommendBattery`/`perBattery` (kein Ranking, keine Empfehlung, keine Investition)."

**⚠ Offene Messlücke, ehrlich gemeldet statt geraten:** `compute-analysis.ts:384` ruft `recommendBattery` **unconditional** auf, auch wenn `existingBattery` gesetzt ist — der Urbanz-Report enthält also vermutlich ZUSÄTZLICH ein Katalog-Ranking (`perBattery`/`recommendation` gegen `DEMO_BATTERY_CATALOG`) neben der Bestands-Analyse. Welches Katalog-Gerät dabei konkret als `recommendation.batteryId` herauskäme, ist mit den lokal verfügbaren Unterlagen (Screenshot/Memory-Notizen) **nicht belegt** — die vorhandenen Urbanz-Kalibrierwerte dokumentieren nur den Bestandsspeicher-Pfad, keinen Katalog-Rang. Für einen späteren Vergleichslauf müsste das separat am Produktionspfad gemessen werden (Regel 11: Datenquelle wäre dann anzugeben).

---

## Offene Fragen für die Architekturentscheidung

1. **Preisstand/Herkunft:** Soll die DB-Tabelle (Muster `grid_tariffs`) analog einen Gültigkeitszeitraum/Abrufdatum je Gerät tragen, um die in §5 dokumentierte Report-Lücke zu schließen — oder bleibt der Katalog wie heute zeitstandslos?
2. **Zyklen/Lebensdauer:** Fehlt heute komplett (§2). Soll die neue Tabelle das Feld vorsehen, obwohl die Engine es aktuell an keiner Stelle liest (ROI/Amortisation rechnet rein investitions-/ersparnisbasiert, ohne Lebensdauer-Deckelung)?
3. **`class`/`controlType`:** Reine Metadaten ohne Engine-Wirkung (§2) — bleiben sie in der neuen Tabelle rein deklarativ, oder soll `controlType` künftig tatsächlich das Dispatch-Verhalten steuern (heute laut Kommentar nur Konvention)?
4. **`[MARTIN: Katalog]`-Konvention:** Der Platzhalter-Hersteller ist heute das sichtbare Signal „Demo-Daten" im Report (u. a. im Demo-Hotel-Screenshot sichtbar, laut CLAUDE.md-Handover bereits als kosmetischer Punkt vermerkt). Wie wird dieses Signal in einer DB-Tabelle abgebildet, sobald echte Herstellerdaten eingepflegt werden (ein Freitextfeld „Herkunft/Status" analog zur B11-Tarif-Provenance)?
5. **`AnalysisBundleInputs.batteryCatalog`-Kopie (§3):** Bleibt die vollständige Werte-Kopie im `jsonb`-Snapshot bei einer wachsenden DB-Tabelle praktikabel (heute 6 Einträge, feste Größe), oder soll dort langfristig nur noch der für die jeweilige Analyse relevante Ausschnitt eingefroren werden?
6. **Wizard-Anbindung (§6):** Der Wizard speichert heute bewusst unabhängig vom Katalog. Bleibt das so, wenn der Katalog eine echte, admin-pflegbare DB-Tabelle wird — oder wird die „Marke/Typ-Websuche" der Batterie-Station dann gegen den echten Katalog abgeglichen (rundet auf den nächstliegenden Kandidaten)?
7. **Urbanz-Katalograng (§7):** Die offene Messlücke — lohnt sich ein Produktionspfad-Lauf, um zu sehen, welches Katalog-Gerät Urbanz *neben* seinem Bestandsspeicher heute als `recommendation` bekäme (relevant als zweiter Vergleichspunkt vor dem Umbau)?

---

## Abweichungen vom Prompt, mit Begründung

- **Pflichtlektüre-Datei nicht auffindbar:** Der Prompt nennt `CLAUDE_PEAKSHAVING.md` als Quelle für „Regel 12" — diese Datei existiert im Repo nicht (`find` bestätigt: nur `/Users/bf/Developer/peak-shaving/CLAUDE.md`). Regel 12 wurde stattdessen aus der Root-`CLAUDE.md` gelesen (dort bereits im Sitzungskontext vollständig vorhanden), Inhalt ist identisch zu dem, was die Regel-12-Zitate in §7 referenzieren.
- **Demo-Hotel-Fundort nicht im Repo:** Wie beim Urbanz-Fall (per Memory bekannt) liegt auch der Demo-Hotel-Referenzfall NICHT im Repo, sondern lokal unter `~/Documents/Projects/ADX Ventures/Geschäftsfelder/COOLiN/Demo Daten/Hotel/`. Für §7 wurde der dort abgelegte, bereits gerenderte PDF-Report ausgewertet (`pdftotext -layout`), nicht der Produktionspfad neu gerechnet — das entspricht dem Charakter einer Bestandsaufnahme (bestehenden Beleg lesen, nicht neu rechnen) und wurde nicht als Abweichung vom NICHT-TUN-Abschnitt gewertet (kein Code/Schema angefasst).
