# DE-Gewerbe mit Netzentgelt-Stufen — Baseline (Schritt 10, PR 0)

**Synthetisch**, keine Kunden- oder Netzbetreiberdaten. Zwei gefrorene Render-Anfragen
(`report_render_requests`-Form) für die Snapshots `de-gewerbe-benutzungsdauer-stufe1` und `-stufe2`,
PDF-Text und Bildschirm-Markup.

**Zweck:** Ist-Zustand des Reports für einen DE-Gewerbefall festhalten. Der Snapshot enthält
**bekannte Fehler** — u. a. „Gebrauchsabgabe darauf“ in Weg 5, aWATTar-Texte trotz anderem
dynamischem Tarif, AT-Abgabennamen, „Jän“, „ohne Leistungsmessung“/„keinen Leistungspreis-Bestandteil“
bei Stufe 2 (`hasLeistungspreis`), negativer Leistungspreis-Satz. Sie werden in PR 1–5 behoben; jeder
dieser PRs ändert nur diese beiden Snapshots, die AT-Snapshots bleiben bitgleich.

## Eingaben

Engine-Golden `packages/engine/test/golden/de-benutzungsdauer-knick` (Netzentgelt-Zeilen mit Stufen,
Spotreihe, DE-Abgabenplan, Tarif `annual_max`, zwei Testspeicher), dazu der dynamische Tarif
`{ supplier: 'Spot-Test', markupCtPerKwh: 1.2, baseFeeEurPerMonth: 9.9 }`. Übergabe-Metadaten:
Netzbetreiber `netz_test` / „Netz Test GmbH“, Netzebene 7, Gewerbe, netto, ohne Rechnung, ohne PV.

| Ordner | Lastgang | Ist |
|---|---|---|
| `stufe1/` | der Golden-Lastgang (8 / 17,34 kW + Spitze 49 kW, ≈ 2.405 h/a) | Stufe 1, N = 1.289,14 € |
| `stufe2/` | flache Grundlast 20 kW + dieselbe Spitze 49 kW (≈ 3.576 h/a) | Stufe 2, N = −766,94 € |

## Erzeugen

```
pnpm --filter website exec vitest run --config test/report-snapshots/vitest.de-baseline.config.ts
```

`generate.test.ts` rechnet beide Fälle mit `computeAnalysis`, prüft die Stufe (A: 1; B: 2 und
N ≤ 0) und schreibt `*/render-request.json`. Deterministisch; neu erzeugen nur bei einer gewollten
Änderung, wie bei den Golden Files.
