# Engine-Kern-Audit (§3.4–§3.9) — 2026-07-03

> Read-only-Konsolidierung nach Abschluss von §3.4–§3.9 (`packages/engine`). Keine Fixes, keine
> Worker-/UI-Änderungen. Analog zum Status-Audit vom Projektstart, jetzt gescoped auf den
> fertigen Engine-Kern. Alle Zahlen in diesem Bericht stammen aus tatsächlichen Testläufen
> gegen den echten Code (Skript verworfen, nicht Teil des Commits — siehe Methodik am Ende).

---

## TEIL 1 — End-to-End-Kettenverifikation

Vollständiger `recommendBattery()`-Lauf gegen den §3.8-Dummy-Katalog (`recommendation/dummy-catalog.ts`,
6 Kandidaten) und den echten Demo-Bäckerei-Lastgang (`dev-fixtures/demo-baeckerei-lastgang-2023.csv`,
35.040 Viertelstunden-Werte). Tarif: `annual_max`, Leistungspreis 90 €/kW·a, Arbeitspreis 25 ct/kWh,
Einspeisevergütung 7 ct/kWh, `minBillableKw=0`, `horizonYears=10`, keine `financialParams`.

### Ausgangslage

| Größe | Wert |
|---|---|
| `positiveAnnualPeakKw(lp)` (roher Jahres-Peak) | 50,78 kW |
| `oldBilledKw` (TariffStrategy auf Rohprofil, `annual_max`) | 50,78 kW |

### Ranking (`perBattery`, vollständig sortiert)

| # | Kandidat | `netSavingOverHorizon` | `totalSavingPerYear` | `amortizationYears` |
|---|---|---:|---:|---:|
| 1 | `dummy-com-m60` | **€6.000** | €2.700 | 7,78 J |
| 2 | `dummy-com-s40` | €600 | €1.800 | 9,72 J |
| 3 | `dummy-res-s5` | −€3.750 | €0 | ∞ |
| 4 | `dummy-com-l100` | −€4.553 | €3.495 | 11,32 J |
| 5 | `dummy-res-m10-lowpower` | −€8.300 | €0 | ∞ |
| 6 | `dummy-res-l15` | −€9.000 | €0 | ∞ |

`recommendation = { batteryId: 'dummy-com-m60', rationale: 'Dummy Commercial M60 spart voraussichtlich €2700 pro Jahr und amortisiert sich nach 7.8 Jahren — Netto-Ersparnis über 10 Jahre: €6000.' }`

— konsistent mit `perBattery[0]`. Bemerkenswert: `dummy-com-l100` hat den höchsten `totalSavingPerYear`
(€3.495, mehr Batterie shavt mehr), landet aber wegen der hohen Investition (100 kWh × 320 €/kWh +
Sockel + WR = €39.500) auf Platz 4 — die Rangfolge nach `netSavingOverHorizon` bestätigt sich als
das richtige Kriterium (nicht einfach „größte Batterie gewinnt" oder „größte Jahresersparnis gewinnt").

### Top-Kandidat (`dummy-com-m60`, 60 kWh / 30 kW / η 0,9 / 350 €/kWh / dynamic) — volle Kette

**1) `simulateBattery`-Output** (§3.6/§3.6.1):

```
capKwByPeriod          [ 20.780081634521487 ]   // annual_max → 1 Slot
newBilledKw            20.780081634521526
startSocKwh            30                        // 50 % von 60 kWh [ANNAHME]
socFloorKwh  min/max   0 / 28.2648571395874
dispatch.socKwh min/max         0 / 29.1275
dispatch.gridAfterKw min/max    0 / 20.780081634521526   // hält den cap exakt
dispatch.batteryPowerKw min/max −29.999918365478514 / 17.830081634521488
```

`newBilledKw ≈ 50,78 − 30 = 20,78 kW` — deckt sich exakt mit `peak − maxPowerKw`: dieser Kandidat ist
**leistungsbegrenzt** (bestätigt durch die §3.8-Warnung, s. u.), nicht durch SoC-Erschöpfung
(`socFloorKwh`/`dispatch.socKwh` bleiben deutlich über 0 im Maximum, laufen aber bis auf 0 herunter —
konsistent mit „Reserve wird bis zum Rand ausgenutzt, aber nicht verletzt").

**2) `computeBatterySavings`-Output** (§3.7):

```
newBilledKw                     20.780081634521526
leistungspreisSavingPerYear     2699.9926528930628   // (50,78 − 20,78) × 90 €/kW
selfConsumptionSavingPerYear    0                     // kein PV im Demo-Lastgang (import_only)
loadShiftSavingPerYear          0                     // keine timeOfUseWindows im Tarif
totalSavingPerYear              2699.9926528930628
warnings                        []
```

Nur der Leistungspreis-Topf ist aktiv — konsistent mit dem PV-freien `import_only`-Demo-Lastgang und
einem Tarif ohne HT/NT-Fenster (beide andere Töpfe sind strukturell 0, nicht weil etwas fehlschlägt).

**3) `calculateRoi`-Output** (§3.9):

```
totalInvestment       21000     // 60 kWh × 350 €/kWh, kein Sockel, kein Extra-WR
subsidyAmount         0         // keine financialParams
taxBenefit            0
taxEffectsIncluded    false     // „keine Angabe", nicht „geprüft und Null"
netInvestment         21000
amortizationYears      7.77779894234095   // 21000 / 2699,99
netSavingOverHorizon   5999.926528930628   // 2699,99 × 10 − 21000
```

**4) Finale `perBattery`-Zeile** (aus `recommendBattery`, nicht erneut manuell zusammengesetzt): exakt
die Vereinigung der drei vorigen Blöcke plus `warnings: ['Leistung des Kandidaten reicht nicht für
alle Spitzen (30 kW maximale Lade-/Entladeleistung) — die Kappung ist leistungs-, nicht
energiebegrenzt.']`. Die manuell aneinandergehängten Aufrufe (`simulateBattery` →
`computeBatterySavings` → `calculateRoi`) und der interne `recommendBattery`-Durchlauf liefern
**bit-identische Zahlen** — die Kette ist nicht nur einzeln getestet, sondern durchgängig
nachvollzogen, ohne Drift zwischen den Bausteinen.

---

## TEIL 2 — [ANNAHME]/Scope-Konsolidierung

Alle über §3.4–§3.9 verstreuten `[ANNAHME]`-Marker und bewussten Scope-Entscheidungen, an einer
Stelle gesammelt. Bewertung/Änderung ist NICHT Teil dieses Audits — nur Fundstelle + Konsequenz.
Wo CLAUDE.md die Sache bereits ausführlich dokumentiert, wird verlinkt statt dupliziert.

| # | Thema | Fundstelle (Code) | Kurze Konsequenz | CLAUDE.md |
|---|---|---|---|---|
| 1 | **Start-SoC 1.1. = 50 % Kapazität** | `simulation/helpers.ts:37-44` (`START_SOC_FRACTION`), gespiegelt in `simulate.ts:31`, `cap-search.ts:84`, `savings/attribute.ts:88` | Neutrale Konvention ohne Bias; Auswirkung dämpft sich über den Jahreslauf selbst, aber ungeprüft gegen echtes Referenzprofil. | CLAUDE.md:108 |
| 2 | **Perioden-Übertrag-Verzerrung bei `monthly_*`** (Peak-Protection-Carry ist optimistischer geladen als der echte Dispatch) | `simulation/cap-search.ts` (`searchCaps`, sequenzieller Carry) | Ersparnis wird bei `monthly_*`-Tarifen tendenziell **überschätzt, nicht unterschätzt** (nicht nur „leicht optimistisch"). Bei `annual_max` entfällt der Effekt (eine Periode). Vor echten ROI-Zahlen quantifizieren. | CLAUDE.md:111 (ausführlich, inkl. Richtungsbeweis per Test) |
| 3 | **`subsidyAmount` additiv** (`fixedSubsidyEur` + `subsidyPercent` gleichzeitig wirksam, nicht alternativ) | `roi/roi.ts:28-37` (`calculateSubsidyAmount`) | Falls Martin die beiden Felder als sich ausschließende Optionen gemeint hat, würde diese Annahme die Förderung überzeichnen. | CLAUDE.md:105 |
| 4 | **`taxBenefit`-Platzierung „über den Betrachtungszeitraum"** (IFB = Einmaleffekt, AfA über `min(depreciationYears, horizonYears)` Jahre summiert) | `roi/roi.ts:42-70` (`calculateTaxEffect`) | Andere Lesart („IFB auch über den Horizont skaliert") würde `taxBenefit` und damit `netInvestment`/`amortizationYears` verändern. | CLAUDE.md:105 |
| 5 | **`amortizationYears`-Grenzfälle** (`netInvestment ≤ 0` → `0`; `totalSavingPerYear ≤ 0` → `Infinity`) | `roi/roi.ts:74-85` (`calculateAmortizationYears`) | Verhindert NaN/negative Jahre im Report; beide Fälle sind Pflichtenheft-Leerstellen, nicht spezifiziert. | CLAUDE.md:105 |
| 6 | **Top-N = 10 Spitzen** | `peaks/metrics.ts:40-41` (`TOP_PEAKS_N`) | Pflichtenheft §3.4 beziffert N nicht; 10 ist eine Vertriebs-/UI-Konvention, kein fachlicher Wert. | CLAUDE.md:103 |
| 7 | **`PeakDistribution`-Bucket-Semantik = Maximum je Bucket** (nicht Anzahl/Summe) | `peaks/metrics.ts:56-73` (`peakDistribution`), Typ-Kommentar `shared/analysis-result.ts:5-18` | Ändert die Charts fundamental (Wann ist die Last hoch? vs. Wie oft?) — bei abweichender UI-Erwartung nicht kompatibel. | CLAUDE.md:103 |
| 8 | **`monthly_max_average` = AT-Default (Wiener-Netze-Definition)** | `tariff/strategy.ts:35-39`, `shared/tariff.ts:10` | Ungeprüft gegen echte Netz-NÖ-/Salzburg-Rechnungen (OP#1/#3) — betrifft direkt `billedKw`, damit jede Ersparniszahl. | Nicht als eigene Zeile in CLAUDE.md — nur implizit über OP#1/#3-Verweise; **Konsolidierungslücke**, s. Befund unten. |
| 9 | **Default-NT-Fenster 22:00–06:00**, wenn nur `energyPriceNightCtPerKwh` (ohne `timeOfUseWindows`) gesetzt ist | `simulation/tou.ts:10-14,40-51` (`DEFAULT_NIGHT_WINDOW`) | Reale NT-Fenster können abweichen (z. B. 22:00–06:00 ist nicht jeder Netzbetreiber-Tarif) — betrifft `loadShiftSavingPerYear`. | CLAUDE.md:115 |
| 10 | **static-controlType-Eigenverbrauchs-Caveat**: Eigenverbrauchs-/Lastverschiebungswerte für `static`-Batterien laufen unter derselben Spitzen-Reserve (`socFloor`) wie `dynamic` — echte statische Batterien bräuchten diese Reserve ggf. nicht, Werte damit potenziell **unterschätzt** | `savings/attribute.ts:144-149` (Warntext, TEIL 0 des §3.8-Prompts) | Wirkt der Verzerrungsrichtung von #2 entgegen (dort: eher überschätzt; hier: `static`-Eigenverbrauch eher unterschätzt) — die Nettorichtung ist NICHT trivial zu addieren, da unterschiedliche Mechanismen. | CLAUDE.md:122 |
| 11 | **`benutzungsdauerModel`-Platzhalter** (Typ existiert, Umschaltlogik nicht verdrahtet) | `shared/tariff.ts` (`benutzungsdauerModelSchema`), `tariff/strategy.ts:10-13` | Optionales Feld ist valide, wirkt aber auf keinen Rechenweg — TariffParams mit gesetztem `benutzungsdauerModel` verhalten sich identisch zu ohne. Wartet auf OP#3. | CLAUDE.md:87 |
| 12 | **Split-Timestamp-Parser-Limitation** *(§3.2/3.3, außerhalb des engeren §3.4–§3.9-Scopes, aber explizit re­levant für jede Kette, die auf `parseLoadProfile` aufsetzt)* | `parser/detect.ts` | Ein separates Datum+Uhrzeit-Spaltenpaar (statt kombinierter Zeitstempel-Spalte) läuft aktuell in `needs_mapping`/`error`, nicht in `ok`. Reale Netzbetreiber-Exporte (OP#4) könnten dieses Format liefern. | CLAUDE.md:63 (ausführlich) |
| 13 | **§3.8-Leistungslimit-Heuristik-Toleranz (1e-2 kW)** | `recommendation/rank.ts` (`POWER_LIMIT_TOLERANCE_KW`, `isPowerLimited`) | Vergleicht `cap` gegen `Periodenpeak − maxPowerKw` mit fixer absoluter Toleranz, nicht relativ zur Peak-Größe — bei sehr kleinen oder sehr großen Peaks ungeprüft, ob 1e-2 kW immer die richtige Trennschärfe ist. | CLAUDE.md:121 |
| 14 | **Kein `controlType`-Branching in §3.6/§3.6.1** (Physik ist controlType-unabhängig; Zuschreibung ausschließlich in §3.7) | `simulation/simulate.ts` (Docstring), `simulation/helpers.ts:18-21` (`BatteryPhysics`) | Bewusste Architekturgrenze, keine Annahme im eigentlichen Sinn — aufgeführt, weil sie oft mit #10 verwechselt wird (Physik vs. Zuschreibung sind zwei verschiedene Dinge). | CLAUDE.md:78-81 (ausführlich) |
| 15 | **Keine `PvProfile`-Verdrahtung in §3.6** (nur der bereits signierte `LoadProfile.gridPowerKw` zählt) | `simulation/simulate.ts` (Docstring) | Ein separates Erzeugungsprofil (z. B. für PV-Prognose-Was-wäre-wenn) wird nirgends gelesen — nur Ist-Einspeisung im Lastgang. | CLAUDE.md:107 |
| 16 | **PV-Eigenverbrauch fix zu `(energyPrice − einspeise)` bewertet** (nicht zum Fensterpreis des Entlade-Intervalls) | `savings/attribute.ts` (Kommentar bei `pvSelfConsumptionCtPerKwh`) | Bei Tarifen mit starken Fenster-Preisschwankungen könnte der reale Wert einer entladenen PV-kWh vom fixen Wert abweichen. | CLAUDE.md:117 |
| 17 | **Start-SoC als neutrale `'grid'`-Schicht zum Standardpreis** (FIFO-Attribution, §3.7) | `savings/attribute.ts:88-92` | Erzeugt selbst keine Ersparnis, verhindert nur FIFO-Unterlauf — konservativ, aber am Jahresanfang (falls Start-SoC groß relativ zum Verbrauch) theoretisch relevant. | CLAUDE.md:117 |
| 18 | **Am Jahresende verbleibende Batterie-Energie erzeugt keine Ersparnis/keinen Kostenposten** | `savings/attribute.ts` (FIFO-Restbestand nach der letzten Iteration) | Leicht optimistisch (Wert wird verschenkt, nicht negativ verbucht) — bei einem Mehrjahres-Horizont mit Jahresgrenzen ggf. zu prüfen. | CLAUDE.md:117 |

**Befund zur Konsolidierung selbst:** Von den 18 gefundenen Punkten ist **#8 (AT-Default
`monthly_max_average`)** der einzige, der zwar im Code klar als `[ANNAHME]` markiert ist
(`tariff/strategy.ts:37`), aber in CLAUDE.md bisher **keine eigene Zeile** hat — er taucht nur indirekt
über die allgemeinen OP#1/#3-Verweise auf. Da er direkt `billedKw` und damit jede nachgelagerte
Ersparniszahl beeinflusst, ist er ein Kandidat für eine eigene CLAUDE.md-Zeile bei nächster
Gelegenheit (hier nur festgestellt, nicht behoben — Audit ist read-only).

---

## TEIL 3 — Diagnose Leistungs-Warnung (kein Fix, nur Befund)

**Frage:** Ist die hohe Warnungsdichte im Bäckerei-Fall (5 von 6 Dummy-Kandidaten tragen „Leistung
reicht nicht") ein Artefakt der schmalen Bäckerei-Spitzenform oder tritt sie auch bei breiteren
Lastprofilen auf?

**Vorgehen:** `recommendBattery()` zusätzlich gegen ein zweites, synthetisches Profil laufen lassen —
„Kühlhaus"-artig: 30 Tage, 15-Min-Raster, kein PV (`import_only`, wie beim Bäckerei-Profil, um den
Vergleich auf die Peak-**Form** zu isolieren). Tagesmuster: 4-Stunden-Blöcke im Wechsel, 48 kW
(Kompressor läuft) / 18 kW (Pause) — 12 h „hoch" / 12 h „tief" pro Tag, verteilt über den ganzen Tag,
statt eines kurzen Ofen-Anlaufs von 1,5–2 h. Gleicher Tarif, gleicher Katalog, `horizonYears=10`.

### Ergebnis

| Profil | roher Jahres-Peak | Kandidaten mit „Leistung reicht nicht"-Warnung |
|---|---:|---:|
| **Bäckerei** (schmale Spitze, ~1,5–2 h/Tag) | 50,78 kW | **5 / 6** |
| **Kühlhaus** (breite Spitze, 12 h/Tag) | 48,0 kW | **0 / 6** |

Detail Kühlhaus-Lauf (`newBilledKw` je Kandidat, `oldBilledKw` = 48,0 kW):

| Kandidat | `maxPowerKw` | `newBilledKw` | Leistungs-Warnung |
|---|---:|---:|---|
| `dummy-res-s5` | 2,5 | 48,0 kW (≈ keine Kappung) | nein |
| `dummy-res-m10-lowpower` | 1,5 | 48,0 kW | nein |
| `dummy-res-l15` | 7,5 | 48,0 kW | nein |
| `dummy-com-s40` | 20 | 43,0 kW | nein |
| `dummy-com-m60` | 30 | 40,5 kW | nein |
| `dummy-com-l100` | 50 | 35,5 kW | nein |

### Diagnose

Die hohe Warnungsdichte im Bäckerei-Fall ist ein **Artefakt der Spitzenform, keine allgemeine
Eigenschaft der Heuristik oder des Katalogs.** Erklärung:

- Beim Bäckerei-Profil dauert die dominante Spitze nur ~1,5–2 h. Selbst kleine Batterien haben genug
  Energie, um über diese kurze Dauer mit voller Leistung durchzuhalten — die Kapp-Suche findet dann
  exakt `cap = peak − maxPowerKw` (SoC reicht immer), also **leistungsbegrenzt**.
- Beim Kühlhaus-Profil dauert der „hohe" Zustand 4 h am Stück (bzw. netto 12 h/Tag), **wiederholt über
  30 Tage**. Um `cap` durchgehend zu halten, müsste eine Batterie 4 h am Stück mit konstanter Leistung
  entladen — das übersteigt bei jedem der 6 Kandidaten die verfügbare Energie, bevor die
  Leistungsgrenze überhaupt greift. Beispiel `dummy-res-s5` (5 kWh/2,5 kW): 5 kWh reichen bei 2,5 kW
  für 2 h Entladung, nicht für 4 h — die Batterie ist nach der Hälfte des Blocks leer, der volle
  48-kW-Bezug „leckt" in der zweiten Hälfte jedes Blocks durch. Deshalb bleibt `cap` bei **exakt dem
  vollen Peak (48,0 kW, keinerlei Kappung)** statt bei `peak − maxPowerKw = 45,5 kW` — die Batterie
  ist **energiebegrenzt**, nicht leistungsbegrenzt, obwohl ihre Leistung ebenfalls sehr klein ist.
- Bei `dummy-com-l100` (50 kW `maxPowerKw`) ist `peak − maxPowerKw = 48 − 50 < 0` — die Heuristik
  schließt das korrekt aus (Guard `powerLimitedCap > TOLERANCE`), da eine Batterie mit mehr Leistung
  als der gesamte Peak per Definition nicht leistungsbegrenzt sein kann; auch hier ist die
  tatsächliche `cap` (35,5 kW) weit von „quasi 0" entfernt → energiebegrenzt.

**Schlussfolgerung:** Die Heuristik selbst arbeitet korrekt (sie unterscheidet plausibel zwischen den
beiden Profilen); die 5/6-Quote ist spezifisch für Lastprofile mit einer **kurzen, dominanten** Spitze
(wie die synthetische Bäckerei). Breitere/nachhaltigere Lastspitzen (Kühlhaus-artig, Dauerbetrieb)
drücken denselben Katalog komplett in den energiebegrenzten Bereich — dort ist die Warnung
„Leistung reicht nicht" nicht mehr die relevante Diagnose; treffender wäre dort eher „Kapazität
reicht nicht" (diese Warnung existiert aktuell nicht — reine Beobachtung, keine Empfehlung zur
Code-Änderung im Rahmen dieses Audits).

---

## TEIL 4 — Baseline

Nach Entfernen des Audit-Hilfsskripts (s. Methodik) erneut sauber verifiziert:

```
pnpm build      → apps/portal, packages/shared, packages/engine, apps/website: alle „Done" / kompiliert
pnpm lint       → eslint . — keine Ausgabe (sauber)
pnpm test       → packages/shared: 18 passed (18)
                   packages/engine: 80 passed (80), 11 Testdateien
                   Monorepo gesamt: 98 Tests grün
pnpm typecheck  → apps/portal, packages/shared, packages/engine, apps/website: alle „Done"
```

Keine Regressionen, keine offenen Fehler.

---

## Methodik (Teil 1 + Teil 3)

Für Teil 1 und Teil 3 wurde ein temporäres Vitest-Script
(`packages/engine/src/recommendation/__audit-scratch.test.ts`) angelegt, ausgeführt und die reale
Konsolen-Ausgabe in diesen Bericht übernommen. Das Script wurde **vor dem Commit wieder gelöscht**
(reines Beobachtungswerkzeug, kein Produktions- oder Testcode — dieser Audit ist explizit
read-only und fügt der Engine keine neue Logik hinzu). Alle Zahlen in TEIL 1 und TEIL 3 sind damit
reale, reproduzierbare Läufe gegen den aktuellen `main`-Stand, keine Schätzungen.
