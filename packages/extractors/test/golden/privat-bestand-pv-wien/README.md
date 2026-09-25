# Golden File — Referenzfall Privat, Bestandsspeicher + PV, Wien

Regressionstest nach CLAUDE.md **Regel 12**, Gegenstück zur Bäckerei (`packages/engine/test/golden/`)
für den **Wizard-Pfad**: `runAnalysisFromMeteringPointDraft` (`src/analysis/run-from-draft.ts`) läuft
mit eingefrorenen Ports, das Ergebnis muss **exakt** `expected.json` gleichen. Kein Netz-, kein
DB-Abruf; die Uhr steht im Test auf **24.09.2026 13:04:38 UTC** (sie bestimmt das Jahresfenster).

Eingefroren ist der VOLLE Lauf: `AnalysisResult` samt Tarifvergleich je Monat, Abgaben,
Bestandsspeicher-Analyse (inkl. Erweiterungsszenarien), Katalog-Urteil über 27 Heimgeräte,
Jahres-Hochrechnung (`annualScenario`) und PV-Rekonstruktion (`pvValue`), dazu
`tariffWayCosts` (Summen der Tarifwege, netto) und `pvOutageMonths`.

**⚠ `annualScenario` und `pvValue` sind bekannt fehlerhaft** (die Hochrechnung füllt fehlende Tage mit
der stärksten Woche, s. `SHOW_ANNUAL_SCENARIO_CHAPTER`) und trotzdem eingefroren. Ihr Update kommt
mit dem Engine-Fix und benennt die Ursache.

## Herkunft

Ein echter Kundenfall (Segment privat, Wiener Netze NE 7 ohne Leistungsmessung, bestehende PV mit
10,2 kWp, Bestandsspeicher 19,2 kWh / 10,6 kW / 90 %, 209 Messtage 2026). Die Eingaben stammen aus
der Cloud, Stand der Report-Erzeugung am 24.09.2026. Vor dem Einfrieren wurden die **unveränderten**
Eingaben durch den heutigen Rechenweg gerechnet: Das Ergebnis war **bitgleich** mit dem damals
gespeicherten `AnalysisResult`. Dasselbe galt nach der Bereinigung (Entwurf, CSV-Kopf, PLZ 1010),
die Skalierung kam erst danach.

## Anonymisierung

- **Lastgang × 0,93**, auf 6 Nachkommastellen gerundet (`lastgang.csv`); `annualConsumptionKwh` im
  Entwurf ebenso. Spaltenkopf neutral („Verbrauch [kWh]“), Zählpunkt- und Zählernummer entfernt.
  Aufbau der Datei (BOM, leerer Block vor Messbeginn, Datum/Zeit-von/Zeit-bis) unverändert.
- **Entwurf** (`draft.json`) ohne `_invoiceExtractions` und `_provenance` (Name, Adresse, Zählpunkt,
  Notizen, Zeitstempel); Dokumentkennungen durch `lastgang`/`pv-erzeugung` ersetzt.
- **PLZ 1010** statt der echten; beide liegen in Wien und ergeben denselben Abgabenplan.
- `pv-erzeugung.json` ist die PVGIS-Schätzreihe unverändert (Zeitreihe + Wetterjahre, kein Standort).

## Eingaben

| Datei | Inhalt |
|---|---|
| `lastgang.csv`, `pv-erzeugung.json`, `draft.json` | die drei Port-Antworten des Zählpunkts, anonymisiert wie oben |
| `battery-catalog.json` | die 27 freigegebenen Heimgeräte als `BatteryCandidate[]`, per `anon` gelesen (Regel 13) |
| `tariff-pricing.json` | die Antworten des echten Preis-Ports (`readTariffPricingForAnalysis`) je angefragtem Fenster: Messzeitraum und Jahresfenster, Netzentgelte + aWATTar-Stundenpreise per `anon`, Abgabenplan mit `{ category: 'heim', postalCode: '1010' }` |

Fragt die Rechnung ein Fenster an, das nicht eingefroren ist, bricht der Test ab.

## Pflege

`pnpm golden:update` erzeugt `expected.json` beider Golden-Fälle neu — **nur** im PR einer bewussten
Rechenänderung, mit benannten Zahlen und Ursache. Nie zum Grünmachen, die Eingaben werden nie
nachgeladen.
