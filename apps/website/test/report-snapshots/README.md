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
| `gewerbe-leistungspreis-teiljahr-jahr-wien` | dieselbe Render-Anfrage, `analysis_result` ersetzt durch `fixtures/gewerbe-leistungspreis-teiljahr-jahr-wien/analysis-result.json` | Jahreskapitel mit Jahresreihung (E2), s. unten |

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

Variante des Falls darüber: dieselbe Render-Anfrage (Lastgang, Metadaten), `analysis_result` ersetzt durch
`analysis-result.json` — seit E2 (08.10.2026) neu erzeugt mit dem Ablauf von `run-from-draft`: Jahreslauf über alle
34 Katalog-Geräte (`buildAnnualScenario`), dann der Messzeitraum-Lauf mit dessen Reihung. Eingaben: Lastgang,
Katalog (Fixture-Pauschalen) und Datenqualität aus der Render-Anfrage, Tarifparameter daraus rekonstruiert, Preise
und Abgaben im Stand des Fixtures (Gegenprobe: der lineare Lauf mit denselben Eingaben ist bitgleich zum
`analysis_result` der Render-Anfrage, der Jahreslauf der Retrofit S bitgleich zu `annual-scenario.json`). Fenster
01.09.2025–31.08.2026, 157 gemessene + 208 gefüllte Tage, Satzstand 31.08.2026. Empfehlung auf Jahresbasis:
Dyness Stack 100 30,72 kWh (Netto 13.299 € gegen 12.700 € der Retrofit S). Ohne Diagramm-Raster 19 Seiten.

`annual-scenario.json` bleibt als Ergebnis vor Fassung 17 (Jahreskapitel ohne Jahresreihung, Empfehlung linear
gereiht): darüber laufen die Unit-Tests der Vorderseite (`test/executive-summary-cases.ts`) und der Altfall in
`lib/pdf-report/annual-basis.test.ts`.

## Seiteneinschub prüfen

Wird eine Seite eingefügt (etwa eine Vorderseite hinter dem Deckblatt), ändern sich alle `.pdf.txt`
zwangsläufig. Ob sie sich NUR um den Einschub geändert haben, prüft nach dem UPDATE-Lauf:

```
pnpm --filter website report:snapshots:verify-insert --base origin/main --at 1 --pages 1 [--strict]
```

`--at` ist der 0-basierte Index der ersten eingefügten Seite (1 = hinter dem Deckblatt), `--pages`
ihre Anzahl. Je Snapshot wird der Stand aus `--base` verschoben und mit dem Arbeitsstand ohne die
eingefügten Seiten verglichen; die eingefügten Seiten werden nur ausgegeben. Eine Seitenzahl in einem
unbekannten Muster ist ein Fehler. `.screen.html` ist von PDF-Seiten nicht betroffen und wird nicht geprüft.

- **Fusszeile und Agenda** (beide Modi): die Zahlen müssen exakt um `--pages` verschoben sein
  („Seite n von N", Agenda-Einträge ab Seite `at+1`); nur der Leerraum dieser Zeilen wird zusammengefasst.
- **Alle übrigen Zeilen, Standard:** verglichen wird die Zeile mit getrimmtem Rand und jedem
  Space/Tab-Run als ein Leerzeichen; jedes andere Zeichen byte-genau. Grund: `pdftotext -layout`
  richtet Spalten je Seite aus, und schon eine längere Fusszeile („von 19" → „von 20") verschiebt
  Tabellenzeilen derselben Seite um ein Leerzeichen (in #428 an 7 Zeilen gesehen).
- **Alle übrigen Zeilen, `--strict`:** byte-genau.
- Zeilenzahl und Reihenfolge je Seite sind in beiden Modi strikt.

Die Zeile `Info: N Zeile(n) nur im Leerraum verschoben` zählt, was roh abweicht und nur normalisiert
gleich ist (mit den ersten 10 Fundstellen). Sie ist kein Fehler; eine hohe Zahl auf Seiten, deren
Fusszeile sich nicht in der Länge geändert hat, ist trotzdem einen Blick wert.
