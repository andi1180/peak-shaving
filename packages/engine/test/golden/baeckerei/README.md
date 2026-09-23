# Golden File — Referenzfall Bäckerei

Regressionstest nach CLAUDE.md **Regel 12**: `computeAnalysis` wird mit eingefrorenen Eingaben
gerechnet, das vollständige `AnalysisResult` muss **exakt** `expected.json` gleichen — kein
Toleranzfenster. Der Test (`../baeckerei.test.ts`) macht keinen Netz- und keinen DB-Abruf.

Abgedeckt ist der Pfad des **öffentlichen Rechners** (`apps/website`): Parser → `computeAnalysis`
mit Netzentgelten, Spotpreisen, Abgaben und dem Gewerbe-Katalog — genau das, was der Worker
bekommt (`analysis.worker.ts`). Nicht abgedeckt: der Wizard-Pfad (`run-from-draft.ts`) und der
Report-Aufbau.

## Eingaben

Alle Dateien sind **Engine-Eingaben**, nicht Datenbankzeilen: eingefroren wurde am Rand, an dem
die Datenschicht an die Engine übergibt. Eine Änderung an der Datenschicht selbst (Abruf, Mapping,
Katalog-Loader) fängt dieser Test deshalb bewusst nicht.

| Datei | Inhalt | Herkunft |
|---|---|---|
| `lastgang.csv` | Kopie von `dev-fixtures/demo-baeckerei-lastgang-verschoben-2025.csv` (05.01.2025–04.01.2026) | **synthetischer Testlastgang**, keine Kundendaten |
| `tariff.json` | `TariffParams` + Horizont | **von Hand festgelegt**, s. unten |
| `tariff-pricing.json` | `TariffPricingInputs`: 2 Netzentgelt-Zeilen, 8.760 Spotpreise (vollständig), Abgabenplan | Cloud per `anon`, `loadTariffPricing(…, 'wiener_netze', 7, 'ohne_leistungsmessung')`, 23.09.2026 |
| `battery-catalog.json` | die 31 freigegebenen Gewerbe-Geräte als `BatteryCandidate[]` (Wertkopie) | Cloud per `anon`, `fetchBatteryCatalog('gewerbe')`, 23.09.2026 |

### Tarifwerte (`tariff.json`) und warum

- **Arbeitspreis 9,5 ct/kWh, Einspeisevergütung 0, keine Lieferanten-Grundgebühr, Mindestleistung 0**
  — der Parametersatz, mit dem die Bäckerei seit K3b in allen Regel-12-Proben gerechnet wurde.
- **Leistungspreis 50 €/kW·a, `monthly_max_sum`** — ebenfalls der bisherige Proben-Stand;
  `monthly_max_sum` ist zudem der SNE-V-Standardfall (`DEFAULT_DRAFT_BILLING_MODEL`).
  `billedKw` bleibt die Summe (606,56 kW); seit dem Faktor-12-Fix (23.09.2026) wird jeder Monat mit
  Satz/12 abgerechnet, also 2.527,33 €/Jahr, derselbe Betrag wie mit `monthly_max_average`.
  Vorher stand hier das Zwölffache (30.328 €/Jahr), s. `Leistungspreis_Einheiten_Bestandsaufnahme.md`.
- **Wiener Netze NE 7 `ohne_leistungsmessung`** — die einzige Kombination, für die die Cloud eine
  Netzentgelt-Zeile ab 01.01.2025 trägt; nur damit ist der Tarifvergleich über das ganze Fenster
  rechenbar. Zusammen mit einem Leistungspreis ist das bewusst konstruiert, kein realer Tarif.
- **Horizont 10 Jahre** — `DEFAULT_HORIZON_YEARS` des öffentlichen Rechners.

Die 2025er Netzentgelt-Zeile trug ursprünglich einen Netzverlust von **7 ct/kWh** — ein
Erfassungsfehler in Produktion, am 23.09.2026 dort über `update_grid_tariff` korrigiert (Protokoll:
Grund „Tippfehler", 7 → 0,7, sonst unverändert). Diese eine Zeile ist am 23.09.2026 per `anon`
neu eingefroren (Netzverlust 0,7; die Fenster-ID hat der Bearbeitungspfad neu vergeben); alle
übrigen Eingaben sind unverändert der Stand vom 23.09.2026 vor der Korrektur.

## Pflege

`expected.json` wird **nur** neu erzeugt, wenn sich die Rechnung **bewusst** ändert:

```bash
pnpm golden:update
```

Das geschieht im selben PR wie die Änderung, und der PR-Bericht benennt, welche Zahlen sich bewegt
haben und warum. **Nie zum Grünmachen.** Die Eingaben werden nicht nachgeladen — neue Preisdaten
oder ein neuer Katalogstand sind kein Grund, den Golden File zu erneuern.
