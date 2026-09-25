# Golden File — Gewerbe, eigener Liefertarif unbekannt

Regressionstest nach CLAUDE.md **Regel 12** für den Zustand `supplierTariff: 'unknown'`
(„Eigener Tarif unbekannt", 25.09.2026): ein Gewerbekunde ohne Stromrechnung, Wiener Netze NE 7
ohne Leistungsmessung, keine PV, kein Bestandsspeicher. Zwei Läufe, zwei erwartete Ergebnisse:

| Datei | Lauf |
|---|---|
| `expected.json` | ohne Vergleichstarif — nur absolute Kosten, keine Bezugsgrösse |
| `expected-mit-vergleichstarif.json` | mit `comparison-supplier.json` — der Vergleichstarif ist Weg und Bezugsgrösse |

## Eingaben

| Datei | Inhalt | Herkunft |
|---|---|---|
| `../baeckerei/lastgang.csv` | Lastgang | **synthetischer Testlastgang** (derselbe wie im Bäckerei-Fall, keine Einspeisung) |
| `../baeckerei/tariff-pricing.json` | Netzentgelte, Spotpreise, Abgaben | eingefroren 23./24.09.2026, s. `../baeckerei/README.md` |
| `../baeckerei/battery-catalog.json` | 31 Gewerbe-Geräte | eingefroren 23.09.2026, s. dort |
| `tariff.json` | `TariffParams` + Horizont | **von Hand**: kein Arbeitspreis, keine Einspeisevergütung, Leistungspreis 0, `billingModel: null` |
| `comparison-supplier.json` | Vergleichstarif (Variante 2) | **von Hand**: 12 ct/kWh netto, 5 €/Monat |

Die Bäckerei-Eingaben werden gelesen, nicht kopiert: sie sind selbst eingefroren und dürfen sich
nicht ändern (s. dort).

## Pflege

Wie beim Bäckerei-Fall: `pnpm golden:update` nur im PR einer bewussten Rechenänderung, nie zum
Grünmachen.
