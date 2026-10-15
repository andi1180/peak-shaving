# Golden File — DE, Benutzungsdauer-Stufen (Schritt 8b)

**Synthetischer Fall**, keine Kunden- oder Netzbetreiberdaten. Er prüft den Einbau der
Netzentgelt-Stufen (`computeNetworkTierCost`, `packages/shared/src/network-tier.ts`) in Ist-Kosten
und Geräte-Ersparnis: Der Ist-Lastgang liegt in Stufe 1, ein Gerät bleibt in Stufe 1, eines
wechselt in Stufe 2.

Zwei Läufe im Test (`../de-benutzungsdauer-knick.test.ts`):

| Datei | Netzentgelt-Zeilen | Zweck |
|---|---|---|
| `expected.json` | `grid-tariff-rows.json` (2025 + 2026, mit Stufen) | der Stufenfall |
| `expected-ohne-stufen.json` | `grid-tariff-rows-ohne-stufen.json` (eine Zeile ab 2025, ohne Stufen) | Gegenprobe: **vor** dem Einbau eingefroren, danach bitgleich |

## Eingaben

| Datei | Inhalt |
|---|---|
| `fixture.ts` | Lastgang und Spotreihe als Formel (s. unten) |
| `tariff.json` | `annual_max`, Entwurfs-LP 22,75 €/kW·a, Mindestleistung 0, Arbeitspreis 20 ct, Einspeisung 0, Horizont 10 J. |
| `grid-tariff-rows.json` | Zeile 2025 (01.01.–31.12.2025): LP₁ 29,81 €/kW·a, AP₁ 8,76 ct, LP₂ 131,80, AP₂ 4,68 ct · Zeile 2026 (ab 01.01.2026): LP₁ 22,75, AP₁ 7,80 ct, LP₂ 115,43, AP₂ 4,09 ct · beide Schwelle 2.500 h, Netzverlust 0, ein ganzjähriges Fenster |
| `grid-tariff-rows-ohne-stufen.json` | eine Zeile ab 01.01.2025: LP 22,75, AP 7,80 ct, ohne Stufenfelder |
| `levies.json` | DE-Abgabenplan, `buildLevySchedule('netz_test', 7, '2025-07-01', '2026-06-30', null, { category: 'gewerbe', postalCode: null, country: 'DE' })`, am 15.10.2026 eingefroren |
| `battery-catalog.json` | `test-klein` (4 kWh / 1 kW) und `test-mittel` (10 kWh / 5 kW), beide dynamisch, η 0,9, 500 €/kWh |

**Lastgang** (lokal 01.07.2025 – 30.06.2026, Europe/Berlin, 365 Tage, 15 min): 8 kW von 18 bis 04 Uhr UTC,
17,34 kW von 04 bis 18 Uhr UTC, dazu eine kurze Spitze von 49 kW am 12.11.2025, 10:00–10:30 MEZ.
**Spotreihe**: stündlich, netto, 9 + 4 · sin((h − 12) · π/12) ct/kWh (h = UTC-Stunde), vollständig.

## Erwartungswerte je Reihe, von Hand nachgerechnet

Tage je Zeile: 2025 = 184 Tage, 2026 = 181 Tage (365 gesamt), f = 1.

- LPeff₁ = (29,81 · 184 + 22,75 · 181) / 365 = 9.602,79 / 365 = **26,3090 €/kW·a**
- LPeff₂ = (131,80 · 184 + 115,43 · 181) / 365 = 45.144,03 / 365 = **123,6823 €/kW·a**
- Kosten_t = LPeff_t · P + AP_t(2025) · W₂₀₂₅ + AP_t(2026) · W₂₀₂₆ · N = min(Kosten₁, Kosten₂) − AP₁-Anteil

P und W je Reihe stammen aus dem Lauf (P = abgerechnete kW nach Dispatch, W = positiver Netzbezug):

| Reihe | P (kW) | W₂₀₂₅ (kWh) | W₂₀₂₆ (kWh) | h/a | AP₁-Anteil | Kosten Stufe 1 | Kosten Stufe 2 | Stufe | N |
|---|---|---|---|---|---|---|---|---|---|
| Ist | 49,0000 | 59.411,67 | 58.411,56 | 2.404,6 | 9.760,56 | 11.049,71 | 11.229,93 | 1 | 1.289,14 |
| test-klein | 48,0001 | 59.491,50 | 58.492,00 | 2.458,0 | 9.773,83 | 11.036,67 | 11.113,28 | 1 | 1.262,83 |
| test-mittel | 44,0001 | 59.611,39 | 58.612,67 | 2.686,9 | 9.793,75 | 10.951,34 | 10.629,10 | **2** | 835,35 |

Rechenweg je Zeile, am Beispiel test-mittel:

- AP₁-Anteil = 0,0876 · 59.611,39 + 0,078 · 58.612,67 = 5.221,96 + 4.571,79 = 9.793,75
- Kosten₁ = 26,3090 · 44,0001 + 9.793,75 = 1.157,60 + 9.793,75 = 10.951,34
- Kosten₂ = 123,6823 · 44,0001 + 0,0468 · 59.611,39 + 0,0409 · 58.612,67 = 5.442,03 + 2.789,81 + 2.397,26 = 10.629,10
- N = 10.629,10 − 9.793,75 = 835,35

Ist (W₂₀₂₅ = 184 · 322,76 + 15,83 Spitze + 8 Zeitumstellung, W₂₀₂₆ = 181 · 322,76 − 8):
Kosten₁ = 26,3090 · 49 + 0,0876 · 59.411,67 + 0,078 · 58.411,56 = 1.289,14 + 9.760,56 = 11.049,71;
Kosten₂ = 123,6823 · 49 + 0,0468 · 59.411,67 + 0,0409 · 58.411,56 = 6.060,43 + 5.169,50 = 11.229,93.

**Ersparnis Leistungsteil** = N(Ist) − N(Gerät), Gebrauchsabgabe-Faktor 1 (DE):

| Gerät | Ersparnis | zum Vergleich ΔkW · 22,75 (Skalar-Weg) |
|---|---|---|
| test-klein | 1.289,14 − 1.262,83 = **26,31 €** | 0,9999 · 22,75 = 22,75 € |
| test-mittel | 1.289,14 − 835,35 = **453,79 €** | 4,9999 · 22,75 = 113,75 € (ΔkW · LPeff₁ = 131,54 €) |

Die Ist-Kosten des Leistungsteils (`current.leistungspreisCostPerYear`) sind N(Ist) = 1.289,14 €
statt 49 · 22,75 = 1.114,75 € im Skalar-Weg (die Zeile gewinnt gegen den Entwurfs-LP).

## Pflege

`pnpm golden:update` schreibt beide Erwartungsdateien neu — nur im PR einer bewussten
Rechenänderung, mit Begründung. `expected-ohne-stufen.json` darf sich durch Stufen-Arbeiten nicht
bewegen.
