# Report-Snapshots der Referenzfälle

Sichert den **Report-Text** (Golden-Fälle sichern nur die Engine): der Wizard-Lauf
(`runAnalysisFromMeteringPointDraft`) mit eingefrorenen Ports, danach dieselbe Übergabe wie
`report-render-actions.ts` → Report-Seite. Geprüft werden der PDF-Text (`pdftotext -layout`,
Diagramme sind Rasterbilder und fehlen) und das Bildschirm-Markup (`react-dom/server`).

```
pnpm --filter website report:snapshots                          # vergleichen
REPORT_SNAPSHOT_UPDATE=1 pnpm --filter website report:snapshots # neu schreiben
```

Nicht in `pnpm test` (braucht `pdftotext`/poppler); in CI läuft er als eigener Pflicht-Job
`report-snapshots` (`.github/workflows/test.yml`). Neu geschrieben wird nur im PR einer
gewollten Report-Änderung, mit benannter Ursache — nie zum Grünmachen.

## Fälle

| Snapshot | Eingaben | Herkunft |
|---|---|---|
| `privat-bestand-pv-wien` | `packages/extractors/test/golden/privat-bestand-pv-wien/` (nur gelesen) | anonymisierter Kundenfall Privat, s. README dort |
| `gewerbe-ohne-rechnung-wien` | `fixtures/gewerbe-ohne-rechnung-wien/` | anonymisierter Kundenfall Gewerbe, s. unten |
| `gewerbe-ohne-rechnung-wien.foerderung-50-horizont-15` | wie oben + Entwurf `subsidyPercent: 50`, `horizonYears: 15` | Tarif-Station-Annahmen |
| `privat-bestand-pv-wien.foerderung-fix-ueber-investition` | wie oben + Fixbetrag 100.000 € inkl. USt | Begrenzung auf die Investition |
| `gewerbe-ohne-rechnung-wien.foerderung-50-horizont-15-steuer` | Gewerbe + 50 %, 15 Jahre, Steuersatz 23 %, IFB 20 %, AfA 10 Jahre | Steuerwirkung neben der Förderung |
| (Privat, Datei `privat-bestand-pv-wien`) | Privat + Steuerwerte im Entwurf | Steuerwerte im Privatpfad unbeachtet |
| `gewerbe-leistungspreis-teiljahr-wien` | `fixtures/gewerbe-leistungspreis-teiljahr-wien/render-request.json` | anonymisierte Render-Anfrage Gewerbe, s. unten |
| `gewerbe-leistungspreis-teiljahr-jahr-wien` | dieselbe Render-Anfrage + `fixtures/gewerbe-leistungspreis-teiljahr-jahr-wien/annual-scenario.json` | Kapitel „Hochrechnung auf ein ganzes Jahr“, s. unten |

Übergabe-Metadaten wie im Admin-Weg; Kundenname ersetzt durch „Referenzfall Privat/Gewerbe“,
keine Rechnungszeiträume (die anonymisierten Entwürfe tragen keine `_invoiceExtractions`).

## `fixtures/gewerbe-ohne-rechnung-wien`

Echter Wizard-Entwurf (Cloud, 27.09.2026): Gewerbe, Wiener Netze NE 7 ohne Leistungsmessung,
„Ohne Rechnung fortfahren“ (eigener Tarif unbekannt), keine PV, kein Bestandsspeicher, keine PLZ.

- `lastgang.csv` — E-Control-Export 01.01.–31.12.2025, **Werte × 0,93** (6 Nachkommastellen),
  Zählpunkt/Zählernummer aus dem Spaltenkopf entfernt.
- `draft.json` — Entwurf ohne `_provenance`.
- `battery-catalog.json`, `battery-catalog-meta.json` — freigegebene Gewerbe-Geräte per `anon`
  (Regel 13), Stand 27.09.2026.
- `tariff-pricing.json` — Antwort des echten Preis-Ports (`readTariffPricingForAnalysis`, per
  `anon`) für das Messfenster, Abgabenplan `{ category: 'gewerbe', postalCode: null }`.

## `fixtures/gewerbe-leistungspreis-teiljahr-wien`

Render-Anfrage eines Kundenreports (`platform.report_render_requests`, 30.09.2026): Gewerbe, Wiener Netze
NE 7 mit Leistungsmessung, `monthly_max_sum`, Lastgang 28.03.–31.08.2026 (157 Tage), fünf Rechnungszeiträume,
Kappung der Lastspitzen, keine PV, 34 Katalog-Geräte.

- `render-request.json` — `analysis_result`, `load_profile`, `report_input_meta` unverändert, ausser:
  `customerLabel` → „Muster Gastro GmbH“, `projectId`/`meteringPointId` entfernt (vom Leser nicht benutzt).
- Läuft wie `/report/[requestId]`: `readRenderRequest` → `buildReportInputFromRenderRequest` → PDF. Keine
  Neuberechnung (Engine-Änderungen zeigen sich hier nicht) und kein Bildschirm-Markup (die Seite rendert nur
  das PDF). Ohne Diagramm-Raster 18 Seiten; das Kunden-PDF mit Diagrammen hat 20.

## `fixtures/gewerbe-leistungspreis-teiljahr-jahr-wien`

Variante des Falls darüber: dieselbe Render-Anfrage, darüber gelegt `analysis_result.annualScenario`
(`annual-scenario.json`) aus einem lesenden `run-from-draft`-Lauf desselben Zählpunkts am 01.10.2026 (Entwurf
und Lastgang aus der Cloud, Preise und Katalog per `anon`, nichts gespeichert). Nur Zahlen und der
Gerätename, keine Kundenidentität. Fenster 01.09.2025–31.08.2026, 157 gemessene + 208 gefüllte Tage, Satzstand
31.08.2026. Der Hauptlauf dieses Laufs war bitgleich mit der Render-Anfrage (2.494,80 €/Jahr). Ohne
Diagramm-Raster 19 Seiten, das Kapitel steht auf Seite 7 (seit PR 6 mit Ringdiagramm: Titel, Legende und
Bildunterschrift stehen als Text im Snapshot, das Bild selbst als Fehlmeldung).
