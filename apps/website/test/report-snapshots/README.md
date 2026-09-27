# Report-Snapshots der Referenzfälle

Sichert den **Report-Text** (Golden-Fälle sichern nur die Engine): der Wizard-Lauf
(`runAnalysisFromMeteringPointDraft`) mit eingefrorenen Ports, danach dieselbe Übergabe wie
`report-render-actions.ts` → Report-Seite. Geprüft werden der PDF-Text (`pdftotext -layout`,
Diagramme sind Rasterbilder und fehlen) und das Bildschirm-Markup (`react-dom/server`).

```
pnpm --filter website report:snapshots                          # vergleichen
REPORT_SNAPSHOT_UPDATE=1 pnpm --filter website report:snapshots # neu schreiben
```

Nicht in `pnpm test`/CI: `pdftotext` (poppler) fehlt dort. Neu geschrieben wird nur im PR einer
gewollten Report-Änderung, mit benannter Ursache — nie zum Grünmachen.

## Fälle

| Snapshot | Eingaben | Herkunft |
|---|---|---|
| `privat-bestand-pv-wien` | `packages/extractors/test/golden/privat-bestand-pv-wien/` (nur gelesen) | anonymisierter Kundenfall Privat, s. README dort |
| `gewerbe-ohne-rechnung-wien` | `fixtures/gewerbe-ohne-rechnung-wien/` | anonymisierter Kundenfall Gewerbe, s. unten |

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
