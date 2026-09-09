# KI-Interface Kalkulator (B24) — Bestandsaufnahme

> **Was dieses Dokument ist:** eine reine Bestandsaufnahme, entstanden am 09.09.2026 gegen den Stand
> `26b33af` (HEAD von `main`, „docs: Konzeptstand KI-Interface & dynamischer Report (B24)"). Sie
> prüft acht Annahmen einer Advisor-Sitzung gegen den echten Code und dokumentiert je Punkt die
> Fundstelle (Datei:Zeile), den tatsächlichen Zustand und ob die Annahme trägt. Alle Aussagen darin
> stammen aus gelesenem Code, gelesenen Migrationen und ausgeführten Greps mit Positivkontrolle; wo
> etwas nicht gemessen werden konnte, steht das als Fehlanzeige da.
>
> **Was dieses Dokument NICHT ist:** kein Pflichtenheft, keine Bewertung, keine Empfehlung, keine
> Architekturentscheidung. Es ist an **keiner** Zeile Anwendungscode etwas geändert worden —
> `packages/**`, `apps/**`, `supabase/**` und jede Konfiguration haben **0 Zeilen Diff**; im Commit
> steht ausschliesslich diese Datei. Die im Arbeitsbaum bereits vorher vorhandenen, unversionierten
> Änderungen (`Pflichtenheft_Zugangsplattform_MVP.md`, `Pflichtenheft_Kalkulator_Delta_KI-Interface.md`)
> stammen nicht aus dieser Messung und sind nicht Teil des Commits.
>
> **Vorgelagerte Quellen (in dieser Reihenfolge gelesen):** `Fahrplan_2026.md` (B24) ·
> `README_Doku-Struktur.md` · `CLAUDE.md` (Repo-Root) · `B24_KI-Interface_Kalkulator.md` ·
> `Pflichtenheft_Kalkulator_MVP.md` §3.10/§5 · `Pflichtenheft_Kalkulator_Delta_Tarifoptimierung.md`
> Delta 8/9/17/18 · `Pflichtenheft_Kalkulator_Delta_PDF-Report.md`. Die zu prüfenden Annahmen stammen
> aus dem Auftrag der Sitzung; das zugehörige Delta-Dokument liegt noch nicht im Repo.

---

## Kurzfassung — die acht Befunde in je einem Satz

- **A — Formular-Flow: trägt, mit einer Präzisierung.** Vier Schritte, vier gleichwertige Einstiege
  in Schritt 1, ein Formular mit **14 Schlüsseln im Formularzustand (13 Zahlen-/Zeitfelder + das
  Abrechnungsmodell als Auswahl), 3 weiteren Auswahlfeldern, 2 Ankreuzfeldern und 2 Untermodulen**
  in Schritt 2 — und **keine** Privat/Betrieb-Verzweigung: die einzige
  Kundenklassen-Unterscheidung ist `'privat' | 'kleingewerbe'` im Standardprofil, und
  `kleingewerbe` ist deaktiviert.
- **B — Contracts: gemessen, nicht angenommen.** `TariffParams` hat **13** Felder, `AnalysisResult`
  hat **8** Top-Level-Felder (davon zwei optional) — die Doku-Fassung in §3.10 des MVP-Pflichtenhefts
  ist gegenüber dem Typ **unvollständig** (s. B.4).
- **C — Sechs KI-Anbindungen: trägt vollständig.** Alle sechs folgen dem Dreiklang
  `actions.ts` / `ai-client.ts` / `extract.ts`, jede macht **genau einen** `messages.create`-Aufruf
  mit **genau einer** `user`-Nachricht; im ganzen Repo gibt es **keine** Chat-artige,
  zustandsbehaftete Struktur — auch keine ungenutzte.
- **D — `recommendBattery`: trägt.** `catalog.map(...)` über jeden Kandidaten, danach `sort`, kein
  Filter; Rückgabe ist `{ perBattery, recommendation }`, und `perBattery` ist das vollständig
  sortierte Array. Dasselbe Muster steht ein **zweites** Mal im Worker (Zusatzspeicher-Szenarien).
- **E — `platform.leads` / `platform.analyses`: trägt.** `leads` hat heute **27** Spalten, `analyses`
  **21**; `supersedes_id` ist ein blosser Selbst-Fremdschlüssel ohne Kettenprüfung,
  `customer_label` ist denormalisiert und `not null`, der Append-only-Trigger sperrt UPDATE und
  DELETE mit genau einer bit-identischen Ausnahme.
- **F — `grid_tariffs`: trägt NICHT in der Formulierung „kein update/delete-Grant für irgendeine
  Rolle".** `service_role` hat auf `grid_tariffs` seit B21-2b **UPDATE** und seit B21-2c **DELETE**;
  was es nicht gibt, ist ein Bearbeiten-Wrapper und irgendein Schreibrecht für `anon`/`authenticated`.
  Die Ordnungspflicht wird im Funktionsrumpf durchgesetzt, nicht durch eine Constraint.
- **G — `calculator_pro`: trägt nur zur Hälfte.** Der Gutscheincode ist heute **einer von zwei**
  manuellen Vergabewegen; der zweite ist die genehmigte Partner-Anfrage (B18-4), die das
  Entitlement in derselben Transaktion schreibt. Die Registrierung schreibt **kein** Entitlement.
- **H — Grundgebühr im Rechnungs-Scan: trägt NICHT.** `InvoiceExtraction` **hat** das Feld
  `rates.supplierBaseFeeEurPerMonth` seit dem 02.09.2026 (PR #128); der Handover-Satz in
  `CLAUDE.md`, auf den sich die Annahme stützt, ist seit diesem Commit veraltet.

---

## A. Formular-Flow — `calculator.tsx` und Geschwister

### A.1 Orchestrierung: `apps/website/components/flow/calculator.tsx` (139 Zeilen)

| Fundstelle | Zustand |
|---|---|
| `calculator.tsx:13` | `type Step = 1 \| 2 \| 3 \| 4` — vier Schritte, fest. |
| `calculator.tsx:17-30` | Zustand: `step`, `load: ParsedLoad \| null`, `tariffPrefill: TariffPrefill \| undefined`, `payload: CalculatorPayload \| null`, `analysis = useAnalysis()`. |
| `calculator.tsx:37-46` | `handleUpload(l, prefill?)` — setzt `load`, setzt `tariffPrefill` **auch auf `undefined`** (Zurücksetzen beim Einstiegswechsel), springt auf Schritt 2. |
| `calculator.tsx:48-69` | `handleTariff(result)` — bei übernommener PV-Schätzung ersetzt `result.estimatedPv.profile` den Lastgang **im Payload, nicht im `load`-State** (62-64); `analysis.start(p)` startet den Web Worker (68). |
| `calculator.tsx:71-77` | `handleRestart()` — Reset aller vier Zustände auf Schritt 1; **ein Rücksprung aus Schritt 4 nach Schritt 2 existiert nicht** (nur `onBack` in Schritt 2 → Schritt 1, Zeile 100). |
| `calculator.tsx:110-135` | Schritt 4 bekommt `analysis.displayResult`, `analysis.displayInputs`, `payload.load` (den gerechneten Lastgang), `onRecompute` → `analysis.recompute({...payload, tariff, financial}, horizonYears, batteryOverride)` (125-131). |

Der Worker (`apps/website/lib/analysis.worker.ts`) kennt zwei Nachrichten: `run` und `recompute`
(`apps/website/lib/analysis-protocol.ts:36-49`); beide laufen durch dieselbe Funktion
`computeAnalysis` (`analysis.worker.ts:191-322`).

### A.2 Schritt 1: `step-upload.tsx` (289 Zeilen) — vier gleichwertige Einstiege

| Fundstelle | Zustand |
|---|---|
| `step-upload.tsx:45-82` | `MODES` mit **vier** Einträgen: `datei` („Lastgang-Datei"), `standardprofil` („Standardprofil / Verbrauch"), `rechnungsscan` („Stromrechnung (PDF)"), `gemischt` („Mehrere Unterlagen"); je Eintrag ein eigener Datenschutz-Satz. |
| `step-upload.tsx:120-169` | `handleFile`: `readForParsing` → `parseLoadProfile` (128) → Regel B `rejectIfBeforeAnchor` (132) → bei `needs_mapping` mit `valueColumns` das `MappingPanel` (145-156). |
| `step-upload.tsx:172-200` | `handleMappingConfirm`: erneuter `parseLoadProfile(mapping.input, { columns, unit })` — mehrere Zähler **derselben Datei** werden über `ColumnMapping` (consumption/feed-in) summiert. |
| `step-upload.tsx:234-236` | Untermodule: `StandardProfilePanel`, `InvoiceScanPanel`, `MixedUploadPanel` — je mit `onComplete(load, tariffPrefill?)`. |
| `step-upload.tsx:249` | Datei-Einstieg nimmt `.csv,.xlsx,.xls`. |
| `standard-profile-panel.tsx:54-60` | Felder: `annualConsumption` (Zahl, kWh/Jahr), `customerClass` (Select). |
| `standard-profile-panel.tsx:78-84` | Obergrenze **100.000 kWh/Jahr**, darüber Ablehnung mit Text (kein stilles Kappen). |
| `standard-profile-panel.tsx:169-177` | `privat` („Privat (Haushalt, H0)") wählbar; `kleingewerbe` („Kleingewerbe — noch nicht verfügbar") **`disabled`**. |
| `standard-profile-panel.tsx:86-91, 113-119` | `generateStandardLoadProfile({annualConsumptionKwh, customerClass, year, timeZone})`; `onComplete` **ohne** `sourceBytes` (kein Analyse-Bündel für diesen Einstieg). |
| `invoice-scan-panel.tsx:128, 168-169, 219-222` | `scanInvoice(file)` (PDF, `accept=".pdf,application/pdf"`); der gelesene `annualConsumptionKwh` belegt das `StandardProfilePanel` vor; die Tarifangaben reisen als `TariffPrefill` nach Schritt 2. |
| `mixed-upload-panel.tsx:113, 132, 252, 305-312, 338, 373` | bis **10** Zeilen (`MAX_ROWS`); CSV/XLSX im Browser via `parseLoadProfile`, PDF via `classifyUpload`; **genau ein** bestätigter Lastgang, mehr wird abgewiesen (305-312); Rechnungen via `scanInvoice`, zusammengeführt über `mergeInvoiceExtractions` (373). |

### A.3 Schritt 2: `step-tariff.tsx` (1363 Zeilen) — das vollständige Feldinventar

**Formular-Zustand (`initial`, `step-tariff.tsx:83-105`), 14 Schlüssel — 13 Zahlen-/Zeitfelder und das Abrechnungsmodell als Auswahl:**

| Schlüssel | Vorgabewert | Sichtbar als |
|---|---|---|
| `leistungspreisEurPerKwYear` | `'90'` | NumberField „Leistungspreis" €/kW·a (1090-1097) |
| `minBillableKw` | `'0'` | NumberField „Mindestleistung" kW (1098-1105) |
| `billingModel` | `'monthly_max_average'` | Select „Abrechnungsmodell" mit 3 Werten (1107-1119) |
| `energyPriceCtPerKwh` | `'25'` | NumberField „Arbeitspreis" ct/kWh (1133-1140) |
| `einspeiseverguetungCtPerKwh` | `'8'` | NumberField „Einspeisevergütung" ct/kWh (1141-1148) |
| `energyPriceNightCtPerKwh` | `'18'` | NumberField „Nacht-/Niedertarif" — nur bei `useNight` (1200-1207) |
| `supplierBaseFeeEurPerMonth` | `'0'` | Input „Grundgebühr Ihres Stromlieferanten" €/Monat (1172-1186) |
| `windowFrom` / `windowTo` | `'22:00'` / `'06:00'` | zwei `type="time"`-Inputs — nur bei `useNight` (1210-1224) |
| `fixedSubsidyEur` | `''` | Accordion „Förderung & Steuer": „Pauschale Förderung" € (1293-1300) |
| `subsidyPercent` | `''` | „Förderung" % (1301-1309) |
| `investitionsfreibetragPercent` | `''` | „Investitionsfreibetrag" % (1310-1318) |
| `taxRatePercent` | `''` | „Steuersatz (Grenzsteuer/KöSt)" % (1319-1327) |
| `depreciationYears` | `''` | „Abschreibungsdauer (AfA)" Jahre (1328-1335) |

**Auswahl- und Ankreuzfelder ausserhalb von `initial`:**

| Zustand | Fundstelle | Werte |
|---|---|---|
| `netzbetreiber` | `403-405`, Select `883-898` | `NOT_SET` („Nicht angeben — Werte aus meiner Netzrechnung") + `NETZBETREIBER_IDS` (3: `wiener_netze`, `netz_noe`, `salzburg_netz`) |
| `netzebene` | `406`, Select `907-919` | `NOT_SET` + `NETZEBENEN` (3–7) |
| `meteringVariant` | `416-418`, Select `925-950` | **nur gerendert, wenn `hasMeteringVariant(netzebene)`** (heute: NE 7); `NOT_SET` + 3 Varianten |
| `useTariffOptimization` | `399`, Checkbox `1058-1076` | „Mit Börsen-Strompreisen vergleichen (optional)" |
| `useNight` | `378`, Checkbox `1194-1197` | „Niedertarif-/HT-NT-Fenster hinterlegen (optional)" |
| `existingBattery` | `442`, `BatteryTextPanel` `1085` | Freitext `batterieAngabe` (Textarea, `battery-text-panel.tsx:199-204`) mit Vorschau/Übernahme |
| PV-Erzeugung | Abschnitt `1230-1283` | `PvDesignPanel` (PLZ `pvPostalCode`, je Fläche Nennleistung/Neigung/Ausrichtung/Kompass-Grad, PDF-Scan `accept=".pdf,application/pdf"`, `pv-design-panel.tsx:511-619, 914-916`) **nur solange `pv == null`**; daneben `FileDrop` für ein Wechselrichter-Profil `.csv,.xlsx,.xls` (1257-1266) |

**Vorbelegung und Sperren:**

| Fundstelle | Zustand |
|---|---|
| `161-268` | `buildInitialTariffState(prefill)`: nach einem Rechnungs-Scan starten fünf Ratenfelder **leer** (181-190); Schicht 2 „ohne Leistungsmessung" setzt Leistungspreis und Sockel auf `'0'` (213-215); Schicht 3 übernimmt die gelesenen Sätze inkl. `supplierBaseFeeEurPerMonth` (227-257). |
| `321` | `REGULATION_PENDING_NETZEBENE = 7` — hartkodiert. |
| `520-564` | Netzentgelt-Vorbelegung für NE 3–6 aus `fetchGridTariffs(netzbetreiber, netzebene, null, stichtag, stichtag)` — asynchron, `findGridTariffRow` + `gridTariffPrefill`. |
| `607-624` | `pending` (B11-Verweigerung) entsteht **ausschliesslich** auf NE 7. |
| `668-672` | `blocked = (pending && !noPowerMeasurement) \|\| loading \|\| missing \|\| failed`. |
| `731-856` | `handleSubmit`: `tariffParamsSchema.safeParse` (764), `netzebene` als String `"NE <n>"` (756), `timeOfUseWindows` nur bei `useNight` (757-762), `financialParamsSchema` nur wenn mindestens ein Feld gefüllt (772-796), `loadTariffPricing(loadProfile, betreiber, netzebene, meteringVariant)` nur bei aktivem Hebel (816-831), `onComplete({ tariff, financial, pv, estimatedPv?, pvError, existingBattery?, tariffSelection, tariffPricing })` (833-855). |

**Was Schritt 2 verlässt** (`apps/website/components/flow/types.ts:17-62`): `TariffResult = { tariff, financial?, pv, tariffSelection?, pvError?, tariffPricing?, existingBattery?, estimatedPv? }`; `CalculatorPayload = TariffResult & { load: ParsedLoad }` (164-166); `RecomputeInput = { tariff, financial?, horizonYears, batteryOverride? }` (172-177).

### A.4 Schritt 4: `step-result.tsx` (498 Zeilen)

| Fundstelle | Zustand |
|---|---|
| `263-266` | CSV-Export des vollständigen `perBattery`-Arrays. |
| `276-295, 297-312` | Analyse-Bündel (JSON) — nur mit `load.sourceBytes`; beim Standardprofil ein eigener, neutraler Satz. |
| `96-100, 174-238, 349-388` | PDF: `window.print()` oder — hinter `REACT_PDF_REPORT_ENABLED` — `downloadReportPdf`; davor das Name/Firma-Gate (`ReportGateDialog`). |
| `462-493` | `Report` erhält `result`, `loadProfile`, `tariffSource`, `originalTariff`, `originalFinancial`, `existingBattery`, `estimatedPv`, `effectiveInputs`, `onRecompute`, `onResetAssumptions`. |

### A.5 Privat vs. einfacher Betrieb — was heute tatsächlich verzweigt

| Frage | Fundstelle | Zustand |
|---|---|---|
| Gibt es eine Privat/Betrieb-Auswahl im Flow? | `step-tariff.tsx` (gesamt), `step-upload.tsx:45-82` | **Nein.** Kein Feld, kein Zustand, keine Verzweigung nach Kundentyp in Schritt 1–4. |
| Einzige Kundenklassen-Unterscheidung | `packages/engine/src/standard-profile/h0.ts:48` | `export type StandardProfileCustomerClass = 'privat' \| 'kleingewerbe'` — nur im Standardprofil-Einstieg; `kleingewerbe` in der Oberfläche `disabled` (`standard-profile-panel.tsx:175`), im Generator mit `no_profile_for_class` abgewiesen (`standard-profile-panel.tsx:94`). |
| Leistungsmessung | `packages/shared/src/tariff-pricing.ts:267-289` | `METERING_VARIANTS` (3 Werte) und `NETZEBENEN_MIT_MESSVARIANTE = [7]`; die Variante ist **UI-Zustand** (`step-tariff.tsx:416`) und Parameter von `loadTariffPricing` (`apps/website/lib/tariff-pricing.ts:35-40`). **`TariffParams` selbst hat kein Feld dafür** — `grep -i "metering\|leistungsmessung" packages/shared/src/tariff.ts` liefert 0 Treffer (Positivkontrolle: 3 Treffer in `tariff-pricing.ts`). Ihre Wirkung auf die Rechnung läuft über den Leistungspreis `0` (Schicht 2) und über die geholten Tarifzeilen. |
| Gewerbe-Kennzeichen im Katalog | `packages/shared/src/battery.ts:4-8` | `BatteryClass = 'residential' \| 'commercial'`, `ControlType = 'static' \| 'dynamic'` — Eigenschaften der **Batterie**, nicht des Kunden. |
| Branchen-Segmentierung | `supabase/migrations/20260721210000_create_lead_segmentation_columns.sql:45-56` | `platform.industry` mit 10 Werten (`baeckerei` … `hotellerie` … `sonstige`) existiert **auf `platform.leads`**; im Rechner (`apps/website`) wird `industry` in **0** Dateien gelesen (Positivkontrolle: 12 Dateien in `apps/web`). |
| Vorsteuerabzug / USt-Feld | `apps/website/components/flow/*.tsx` | **kein** Feld (`grep -i "vorsteuer\|umsatzsteuer\|mwst"` über die Flow-Komponenten: 0 Treffer; Positivkontrolle: 5 Report-Dateien tragen „MwSt."-Ausweise). Gerechnet wird durchgängig netto (`packages/shared/src/tariff.ts:24-25`). |
| Mehrere Zählpunkte / Standorte | `mixed-upload-panel.tsx:305-312` | **Genau ein** Lastgang je Analyse; mehrere bestätigte Lastgänge werden abgewiesen. Mehrere Zähler **innerhalb einer Datei** summiert das `MappingPanel` (`step-upload.tsx:172-175`). |
| Förderung/Steuer | `step-tariff.tsx:1285-1339` | Accordion mit fünf optionalen Feldern (IFB, KöSt/Grenzsteuer, AfA) — betriebsnah, aber ohne Kundentyp-Bindung. |

**Befund A:** Die Annahme „Formular-Flow mit `step-tariff.tsx` und Geschwistern" trägt. Die
Annahme aus dem Konzept, Privat/Betrieb sei heute eine Verzweigung, findet im Code keine
Entsprechung: es gibt keine, und der einzige Vorläufer (`StandardProfileCustomerClass`) ist auf
`privat` beschränkt.

---

## B. `TariffParams` und `AnalysisResult` — Feldkatalog aus dem Typ

### B.1 `TariffParams` — `packages/shared/src/tariff.ts:53-80`, wortgleich

```ts
export const tariffParamsSchema = z.object({
  leistungspreisEurPerKwYear: z.number().nonnegative(),
  billingModel: billingModelSchema,
  minBillableKw: z.number().nonnegative(), // Mindestleistung (Sockel, nie unterschreitbar)
  arbeitspreisNetzCtPerKwh: z.number().nonnegative().optional(),
  energyPriceCtPerKwh: z.number().nonnegative(), // Bezugs-Arbeitspreis (Eigenverbrauchswert)
  energyPriceNightCtPerKwh: z.number().nonnegative().optional(), // Nacht-/Niedertarif
  timeOfUseWindows: z.array(timeOfUseWindowSchema).optional(),
  dynamicPriceProfile: z.unknown().optional(), // [v2] Spot-/dynamische Preise (Arbitrage)
  einspeiseverguetungCtPerKwh: z.number().nonnegative(),
  supplierBaseFeeEurPerMonth: z.number().nonnegative().optional(),
  netzebene: z.string().optional(), // Metadatum
  benutzungsdauerModel: benutzungsdauerModelSchema.optional(),
})
export type TariffParams = z.infer<typeof tariffParamsSchema>
```

(Zeilen 63-76 — der Doc-Kommentar zu `supplierBaseFeeEurPerMonth` — sind hier weggelassen; die
Feldzeilen sind unverändert.) **13 Felder**, davon 5 Pflicht (`leistungspreisEurPerKwYear`,
`billingModel`, `minBillableKw`, `energyPriceCtPerKwh`, `einspeiseverguetungCtPerKwh`). Dazu aus
derselben Datei: `billingModelSchema = z.enum(['annual_max', 'monthly_max_average',
'monthly_max_sum'])` (8-12), `priceBasisSchema = z.enum(['net', 'gross'])` (27),
`timeOfUseWindowSchema = { from, to, ctPerKwh }` (31-35), `benutzungsdauerModelSchema` (45-49, als
PROVISORISCH markiert).

### B.2 `FinancialParams` — `packages/shared/src/financial.ts:12-23`, wortgleich

```ts
export const financialParamsSchema = z.object({
  fixedSubsidyEur: z.number().nonnegative().optional(),
  subsidyPercent: z.number().min(0).max(100).optional(),
  investitionsfreibetragPercent: z.number().min(0).max(100).optional(),
  depreciationYears: z.number().positive().optional(), // AfA
  taxRatePercent: z.number().min(0).max(100).optional(),
  note: z.string().optional(),
})
```

Sechs Felder, alle optional. **`note` hat im Formular kein Feld** (Schritt 2 sammelt fünf, s. A.3).

### B.3 `AnalysisResult` — `packages/shared/src/analysis-result.ts:263-340`, Felder wortgleich

(Doc-Kommentare weggelassen; jede Feldzeile steht so in der Datei.)

```ts
export type AnalysisResult = {
  current: {
    annualPeakKw: number
    monthlyPeaksKw: number[] // 12
    billedKw: number // gem. billingModel (§3.5)
    leistungspreisCostPerYear: number
  }
  peaks: {
    top: Array<{ ts: string; kw: number }>
    distribution: PeakDistribution
  }
  perBattery: BatteryRoiEntry[]
  recommendation: {
    batteryId: string
    rationale: string
  }
  assumptions: {
    roundTripEfficiency: number
    horizonYears: number
    energyPriceCtPerKwh: number
    einspeiseverguetungCtPerKwh: number
    billingModel: BillingModel
  }
  tariffOptimization?: TariffOptimizationStatus
  existingBatteryAnalysis?: ExistingBatteryAnalysis
  dataQuality: {
    coveredDays: number
    coveredMonths: number
    gapsInterpolated: number
    largestGapSlots: number
    warnings: string[]
  }
}
```

Die referenzierten Typen, alle in derselben Datei bzw. in `tariff-pricing.ts`:

| Typ | Fundstelle | Felder (wortgleich) |
|---|---|---|
| `PeakDistribution` | `analysis-result.ts:15-19` | `byWeekday: number[]`, `byHour: number[]`, `byMonth: number[]` |
| `BatteryResultEntry` | `analysis-result.ts:172-202` | `battery: BatteryCandidate`, `newBilledKw`, `leistungspreisSavingPerYear`, `selfConsumptionSavingPerYear`, `loadShiftSavingPerYear`, `selfConsumptionSavingOverCoveredPeriod`, `loadShiftSavingOverCoveredPeriod`, `annualizationFactor`, `coveredDays`, `totalSavingPerYear`, `warnings: string[]`, `dispatchTrace?: DispatchTrace` |
| `BatteryRoiSummary` | `analysis-result.ts:205-214` | `totalInvestment`, `subsidyAmount`, `taxBenefit`, `taxEffectsIncluded: boolean`, `netInvestment`, `amortizationYears`, `netSavingOverHorizon` |
| `BatteryRoiEntry` | `analysis-result.ts:217` | `BatteryResultEntry & BatteryRoiSummary` |
| `AddonBatteryScenario` | `analysis-result.ts:236-240` | `BatteryResultEntry & BatteryRoiSummary & { combined: BatteryCandidate }` |
| `ExistingBatteryAnalysis` | `analysis-result.ts:250-255` | `entry: BatteryResultEntry`, `addonScenarios: AddonBatteryScenario[]` |
| `DispatchTrace` | `analysis-result.ts:31-112` | `capKwByPeriod: number[]`, `caughtPeaks: Array<{ts, originalKw, residualKw, caught}>`, `representativeDays: Array<{date, label: 'worst_caught_peak' \| 'pv_strong', intervals: Array<{ts, gridPowerKw, pvGenerationKw, batteryPowerKw, socKwh}>}>`, `batteryFlowByHourMonth?: (number \| null)[][]`, `monthlyChargePrice?: MonthlyChargePrice` |
| `MonthlyChargePrice` | `analysis-result.ts:143-154` | `chargeCtPerKwh`, `dischargeCtPerKwh`, `averageCtPerKwh`, `chargedKwh`, `dischargedKwh` — je `(number \| null)[]` |
| `TariffOptimizationStatus` | `tariff-pricing.ts:238-249` | `{ computable: true; monthlyComparison?: MonthlyTariffComparison } \| ({ computable: false } & TariffOptimizationBlocker)` |
| `TariffOptimizationBlocker` | `tariff-pricing.ts:134-149` | `side: 'grid_tariff' \| 'spot_price'`, `kind: 'gap' \| 'unavailable' \| 'price_basis'`, `ranges: TariffPriceRange[]`, `message: string` |
| `MonthlyTariffComparison` | `tariff-pricing.ts:173-191` | `currentTariffEur`, `spotWithoutControlEur`, `spotWithBatteryEur` (je `(number \| null)[]`, Länge 12), `coveredMonths`, `fixedCosts: MonthlyFixedCosts` |
| `MonthlyFixedCosts` | `tariff-pricing.ts:202-232` | `networkBaseFeeEur`, `supplierBaseFeeEur`, `awattarBaseFeeEur`, `supplierFeeEurPerMonth`, `awattarFeeEurPerMonth`, `coveredDays` |
| `BatteryCandidate` | `packages/shared/src/battery.ts:10-25` | `id`, `name`, `manufacturer`, `class`, `usableCapacityKwh`, `maxPowerKw`, `roundTripEfficiency`, `pricePerKwh`, `inverterIncluded`, `extraInverterCost?`, `requiresFoundation`, `foundationCost?`, `controlType` |
| `LoadProfile` | `packages/shared/src/load-profile.ts:60-67` | `readings: Array<{ts, gridPowerKw}>`, `intervalMinutes: 15`, `timezoneMeta: string`, `source: 'net_signed' \| 'import_export_split' \| 'import_only' \| 'standard_profile'`, `pvSource?: 'estimated'` |

Was **nicht** im `AnalysisResult` steht, obwohl der Report es zeigt: der Lastgang selbst (reist als
`loadProfile`-Prop, `step-result.tsx:464`), die Herkunft der Tarifsätze (`TariffSourceRef`, aus
`payload.tariffSelection` abgeleitet, `step-result.tsx:113-120`), die PV-Schätzungs-Zusammenfassung
(`payload.estimatedPv.summary`, `step-result.tsx:484`) und der Wirkungsgrad-Annahme-Vermerk des
Bestandsspeichers (`payload.existingBattery.efficiencyAssumed`, `types.ts:106`).

### B.4 Abstand zwischen Doku-Fassung §3.10 und Typ

`Pflichtenheft_Kalkulator_MVP.md` §3.10 (Zeilen 373-414) beschreibt gegenüber dem Typ einen
**älteren Stand**:

| §3.10 sagt | Der Typ sagt |
|---|---|
| `dataQuality: { coveredDays; gapsInterpolated; warnings }` (3 Felder) | 5 Felder — zusätzlich `coveredMonths`, `largestGapSlots` (`analysis-result.ts:321-339`) |
| `perBattery`-Element ohne Hochrechnungsfelder | zusätzlich `selfConsumptionSavingOverCoveredPeriod`, `loadShiftSavingOverCoveredPeriod`, `annualizationFactor`, `coveredDays` (`172-202`) |
| kein `tariffOptimization`, kein `existingBatteryAnalysis` | beide optional vorhanden (`302`, `320`) |
| `assumptions: { …; // … }` (offen) | genau 5 Felder (`279-286`) |
| `dispatchTrace?: /* aggregierte Zeitreihe */` | vollständig typisiert (`31-112`) |

Die Sitzungs-Auflage „wortgleich aus dem Typ, nicht aus der Doku" ist damit gerechtfertigt.

---

## C. Die sechs KI-Anbindungen

### C.1 Der Dreiklang — Bestand je Modul

| Anbindung | `actions.ts` | `ai-client.ts` | `extract.ts` | `limits.ts` | Zielschema (rein, testbar) | `messages.create` | Modell |
|---|---|---|---|---|---|---|---|
| Rechnungs-Scan | `apps/website/lib/invoice-scan/actions.ts` (89) | `…/ai-client.ts` (84) | `…/extract.ts` (364) | — (`MAX_INVOICE_FILE_BYTES` im Client-Modul, `ai-client.ts:60`) | `packages/shared/src/invoice-scan.ts` | `extract.ts:303` | `claude-sonnet-5` (`ai-client.ts:49`) |
| Tarifblatt-Scan (Admin) | `apps/web/lib/admin/tariff-scan/actions.ts` (97) | `…/ai-client.ts` (81) | `…/extract.ts` (421) | — | `apps/web/lib/admin/tariff-sheet-scan.ts` | `extract.ts:335` | `claude-sonnet-5` (`ai-client.ts:58`) |
| Upload-Zuordnung | `apps/website/lib/upload-classification/actions.ts` (82) | `…/ai-client.ts` (90) | `…/extract.ts` (208) | `…/limits.ts` (36) | `packages/shared/src/upload-classification.ts` | `extract.ts:149` | `claude-sonnet-5` (`ai-client.ts:66`) |
| Batterie-Freitext | `apps/website/lib/battery-text/actions.ts` (56) | `…/ai-client.ts` (70) | `…/extract.ts` (176) | `…/limits.ts` (22) | `packages/shared/src/battery-text.ts` | `extract.ts:141` | `claude-sonnet-5` (`ai-client.ts:49`) |
| Report-Anfrage | `apps/website/lib/report-request/actions.ts` (57) | `…/ai-client.ts` (71) | `…/extract.ts` (198) | `…/limits.ts` (22) | `packages/shared/src/report-request.ts` | `extract.ts:163` | `claude-sonnet-5` (`ai-client.ts:50`) |
| PV-Auslegungs-Scan | `apps/website/lib/pv-design-scan/actions.ts` (88) | `…/ai-client.ts` (90) | `…/extract.ts` (228) | — (`MAX_PV_DESIGN_FILE_BYTES` im Client-Modul, `ai-client.ts:69`) | `packages/shared/src/pv-design-scan.ts` | `extract.ts:178` | `claude-sonnet-5` (`ai-client.ts:54`) |

(Zahlen in Klammern = Zeilen der Datei.) Gemeinsame Bauweise, je gemessen: `'use server'` in jeder
`actions.ts` (Zeile 1), `import 'server-only'` in jeder `ai-client.ts` und `extract.ts` (Zeile 1),
ein frischer Client je Aufruf über `new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') })`
(z. B. `invoice-scan/ai-client.ts:77-79`), Schema-Erzwingung über
`output_config: { format: { type: 'json_schema', … } }`, eine ESLint-Allowlist je Modul, die den
Import des Clients auf **genau eine** Datei begrenzt (`eslint.config.mjs:262-580`, 78 Nennungen von
`ai-client`). Alle sieben `'use server'`-Dateien in `apps/website` sind:
`battery-text`, `invoice-scan`, `pv-design-scan`, `pvgis` (PVGIS-Proxy, kein KI-Aufruf),
`report-gate` (Lead-Schreibpfad, kein KI-Aufruf), `report-request`, `upload-classification`.
Nur der Tarifblatt-Scan prüft zusätzlich eine Rolle (`isCurrentUserAdmin()`,
`apps/web/lib/admin/tariff-scan/actions.ts:62`).

### C.2 Ein Aufruf, eine Nachricht — die Belege

| Anbindung | `messages`-Argument | Eingabe |
|---|---|---|
| Rechnungs-Scan | `messages: [{ role: 'user', content: [{ type: 'document', … }, { type: 'text', text: USER_PROMPT }] }]` (`invoice-scan/extract.ts:314-329`) | eine PDF |
| Tarifblatt-Scan | `messages: [{ role: 'user', … document + text }]` (`tariff-scan/extract.ts:373-385`) | eine PDF |
| Upload-Zuordnung | `messages: [{ role: 'user', … document + text }]` (`upload-classification/extract.ts:167-179`) | eine PDF + Bezeichnung (max. 120 Zeichen, `limits.ts:36`) |
| Batterie-Freitext | `messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt(text) }] }]` (`battery-text/extract.ts:152`) | ein Satz (max. 400 Zeichen, `limits.ts:22`) |
| Report-Anfrage | `messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt(text) }] }]` (`report-request/extract.ts:174`) | ein Satz (max. 400 Zeichen, `limits.ts:22`) |
| PV-Auslegungs-Scan | `messages: [{ role: 'user', … document + text }]` (`pv-design-scan/extract.ts:189-198`) | eine PDF |

Jede der sechs Funktionen ist eine Signatur mit **einem** Eingabewert (`pdfBase64: string`,
`text: string` bzw. `pdfBase64, label`) und liefert eine diskriminierte Union
(`{ ok: true; … } | { ok: false; reason: 'not_configured' | 'api_error' | 'unreadable' }`; die
Zuordnung ohne `unreadable`, `upload-classification/extract.ts:43-45`). Es gibt keinen Parameter für
einen vorherigen Zustand, keine Rückgabe eines Zustands und keinen Ort, an dem eine Antwort für einen
späteren Aufruf aufbewahrt würde.

### C.3 Kein Konversationszustand — Absenz mit Positivkontrolle

| Prüfung | Ergebnis |
|---|---|
| Positivkontrolle: `messages\.create` über `apps/**`, `packages/**` (ohne Tests) | **genau 6 Treffer**, je einer in den sechs `extract.ts` |
| `role: 'assistant'` in Code | **0 Treffer** |
| `conversation\|chatHistory\|multi-turn\|previousMessages\|messageHistory\|turnCount\|\bthread\b` über `apps/**`, `packages/**`, `supabase/**` (ohne Tests) | 6 Treffer, **alle** das Wort „Thread" im Sinn von Off-Main-Thread/UI-Thread (`step-result.tsx:163`, `battery-override.ts:12`, `calculator.tsx:68`, `analysis.worker.ts:34`, `analysis-protocol.ts:4`, `use-analysis.ts:34`) |
| Wort `chat` (case-insensitive, Wortgrenze) in Code | **0 Treffer** |
| Dateien mit `chat`/`conversation` im Namen (repo-weit) | **0**; die Treffer auf `dialog` sind UI-Dialoge (`components/ui/dialog.tsx`, `report-gate-dialog.tsx`, `lead-dialog.tsx`) |
| `localStorage`/`sessionStorage` in `apps/website` (Code) | **0 Treffer** |
| Alle 29 `create table` über alle Migrationen | keine Tabelle für Nachrichten, Sitzungen oder Gespräche (vollständige Liste: `monitor.tariff_snapshots/scrape_targets/scrape_runs`, `platform.profiles/customers/subscriptions/entitlements/stripe_events/user_roles/redemption_codes/code_redemptions/lead_sources/leads/consent_texts/consents/email_suppressions/contract_reminders/job_runs/admin_exports/email_events/analyses/partner_applications/partners/calculator_requests/mentioned_businesses`, `public.grid_tariffs/grid_tariff_rate_windows/spot_prices/grid_tariff_deletions`) |

Zwei Stellen, die einem Zustand ähnlich sehen und keiner sind:

- **`platform.calculator_requests.message text not null`**
  (`supabase/migrations/20260804150000_create_calculator_requests.sql:148`) — ein einmaliger Freitext
  einer Partner-Anfrage mit Status-Enum `pending/approved/rejected` (`:101`), max. 4000 Zeichen
  (`:328`), kein zweiter Turn, keine Antwortspalte.
- **Der Analyse-Worker** lebt über die Report-Sitzung (`analysis.worker.ts:324-376`) und der Hook hält
  `liveResult` neben dem Erstlauf (`use-analysis.ts`); das ist Rechenzustand für die
  Live-Neuberechnung, keine Konversation — jede `recompute`-Nachricht trägt den vollen Payload.

**Befund C:** Beide Teilannahmen tragen. Es gibt sechs Anbindungen, alle im Dreiklang, alle
einschüssig; eine Chat-artige Struktur existiert im Repo nicht — auch nicht experimentell.

---

## D. `recommendBattery` — `packages/engine/src/recommendation/rank.ts`

| Fundstelle | Zustand |
|---|---|
| `rank.ts:150-158` | Signatur `recommendBattery(loadProfile, tariffParams, catalog: BatteryCandidate[], horizonYears, financialParams?, pvProfile?, pricing?): RecommendationResult` |
| `rank.ts:26` | `RecommendationResult = Pick<AnalysisResult, 'perBattery' \| 'recommendation'>` — die Rückgabe ist ein **Objekt** `{ perBattery, recommendation }`, das sortierte Array ist `perBattery`. |
| `rank.ts:161-164` | `topPeaksKw` einmal je Profil; `const perBattery = catalog.map((battery) => buildPerBatteryEntry(…))` — **jeder** Kandidat, kein Filter davor, kein Filter danach. |
| `rank.ts:97-118` | je Kandidat die volle Kette `simulateBattery` → `computeBatterySavings` → `calculateRoi` → `buildDispatchTrace`, plus §3.8-Warnungen (`buildWarnings`, 61-78) — ungeeignete Kandidaten bekommen eine Warnung, keine Auslassung. |
| `rank.ts:166-170` | `perBattery.sort(…)`: `netSavingOverHorizon` absteigend, Tie-Break `amortizationYears` aufsteigend. |
| `rank.ts:172-177` | `const top = perBattery[0]!` — die Funktion **setzt einen nicht-leeren Katalog voraus**; `recommendation = { batteryId, rationale }` mit deterministischem Satz (`buildRationale`, 127-134). |
| `rank.test.ts:33` | Positivkontrolle im Bestand: `expect(perBattery).toHaveLength(DUMMY_BATTERY_CATALOG.length)`. |
| `packages/shared/src/demo-battery-catalog.ts:24-97` | Der produktive Katalog hat **6** Einträge (`demo-com-c25`, `-c40`, `-c60`, `-c250`, `demo-res-r10`, `-r15`). |

**Dasselbe Muster existiert ein zweites Mal**, ausserhalb der Engine: `buildExistingBatteryAnalysis`
im Worker (`apps/website/lib/analysis.worker.ts:110-189`) läuft `catalog.map((addon) => …)` über
alle Katalog-Kandidaten als Zusatzgerät zum Bestand (132-174), rechnet je Kombination
`simulateBattery` → `computeBatterySavings` → `calculateRoi(addon, …)` und sortiert mit derselben
Regel (182-186). Es ist die zweite Instanz „jeden Kandidaten einzeln rechnen, vollständig sortiert
zurückgeben, nicht vorfiltern".

**Befund D:** Trägt. Präzisierung: Rückgabe ist `{ perBattery, recommendation }`, und ein leerer
Katalog ist nicht vorgesehen.

---

## E. `platform.leads` und `platform.analyses` — Migrationsstand

### E.1 `platform.leads` — 27 Spalten heute

| Spalte | Herkunft (Migration:Zeile) |
|---|---|
| `id`, `email` (not null), `first_source_key` (FK `lead_sources`), `status` (CHECK `new/contacted/customer/anonymized`), `retention_basis` (CHECK `marketing/commercial`), `last_interaction_at`, `deletion_due_at` (not null), `anonymized_at`, `company`, `phone`, `created_at`, `updated_at` | `20260721100000_create_lead_consent_foundation.sql:206-222` (dort zusätzlich `contact_name`, später entfernt) |
| `anonymized_by` (FK `auth.users`, `on delete set null`) | `20260721180000_create_lead_admin_wrappers.sql:65-66` |
| `industry` (`platform.industry`), `postal_code` (CHECK `^[0-9]{4}$`), `annual_consumption_kwh` (CHECK `> 0`), `metering_type` (CHECK `leistungsgemessen/netzebene_7/unknown`), `supplier`, `contract_end_date` | `20260721210000_create_lead_segmentation_columns.sql:68-87` |
| `anonymized_by_system` (not null default false) + Constraint `leads_anonymized_authorship_check` | `20260722120000_create_job_runs_and_lead_retention.sql:122-133` |
| `last_edited_by` (FK `auth.users`, `on delete set null`) | `20260723090000_create_lead_editing_filters_export.sql:37-38` |
| `first_name`, `last_name`; **`contact_name` gelöscht** | `20260724090000_split_contact_name.sql:46-48, 85` |
| `partner_slug` (FK `partners.slug`, `on delete restrict`), `referred_by_text` | `20260724190000_create_partner_attribution.sql:197-199` |
| `mentioned_business_id` (FK `mentioned_businesses`, `on delete restrict`) | `20260805120000_create_mentioned_businesses.sql:178-180` |
| `thema` | `20260805150000_create_lead_thema.sql:95-96` |

Rechte: `grant select, insert, update on platform.leads to service_role`
(`20260721100000:740`), **kein `delete`**, kein Grant für `anon`/`authenticated`, RLS aktiv
(`:733`) **ohne Policy** — Zugriff ausschliesslich über die `public`-Wrapper. **Kein**
`account_id`, kein `user_id`, kein `tenant_id`: die einzigen Verweise auf `auth.users` sind
`anonymized_by` und `last_edited_by` (handelnde Konten, keine Eigentümer).

### E.2 `platform.analyses` — 21 Spalten, `20260724150000_create_analysis_persistence.sql:57-146`

| Spalte | Definition (wortgleich) |
|---|---|
| `id` | `uuid primary key default gen_random_uuid()` (58) |
| `lead_id` | `uuid null references platform.leads (id) on delete set null` (62) |
| `customer_label` | `text not null` (66) — **denormalisiert**, s. E.5 |
| `site_label` | `text null` (71) |
| `analysis_kind` | `text not null` + CHECK `in ('betreut', 'intern')` (79-80) |
| `supersedes_id` | `uuid null references platform.analyses (id)` (85) — s. E.4 |
| `engine_version`, `engine_commit_sha` | `text not null` (91-92) |
| `computed_at` | `timestamptz not null` (94) |
| `inputs`, `result` | `jsonb not null` (98, 101) |
| `baseline_billed_kw_before`, `baseline_billed_kw_after`, `baseline_annual_saving_eur` | `numeric not null` (114-116) |
| `recommended_battery_label` | `text null` (119) |
| `recommended_capacity_kwh` | `numeric null` (120) |
| `source_file_name` | `text not null` (123) |
| `source_file_sha256` | `text not null` + CHECK `~ '^[0-9a-f]{64}$'` (129-130) |
| `source_file_gzip` | `bytea not null` (135) |
| `created_by` | `uuid null references auth.users (id) on delete set null` (140) |
| `created_at` | `timestamptz not null default clock_timestamp()` (145) |

Seit dieser Migration hat **keine** weitere Migration die Tabelle verändert (die zwei späteren
Nennungen in `20260725150000` und `20260805120000` sind Kommentare). Rechte: **kein**
Tabellen-Grant für irgendeine Rolle (Grep über `grant|revoke … on platform.analyses`: 0
Treffer), RLS aktiv (`:680`); Zugriff nur über vier SECURITY-DEFINER-Wrapper mit
`platform.is_admin()`-Prüfung, alle `authenticated`-only: `admin_create_analysis` (327-449, 19
Parameter, prüft die SHA-256 der unkomprimierten Datei und Kennung/ISIZE des gzip-Stroms),
`admin_list_analyses` (473, Obergrenze 200 Zeilen je Aufruf, `:486`), `admin_get_analysis` (562),
`admin_get_analysis_source` (632); Grants 694-713.

### E.3 Der Append-only-Trigger — `20260724150000:255-302`, wortgleich

```sql
create function platform.reject_analysis_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_nulls_lead    boolean;
  v_nulls_creator boolean;
begin
  if tg_op = 'UPDATE' then
    v_nulls_lead    := old.lead_id is not null and new.lead_id is null;
    v_nulls_creator := old.created_by is not null and new.created_by is null;
    if (v_nulls_lead or v_nulls_creator)
       and (new.lead_id is not distinct from old.lead_id or v_nulls_lead)
       and (new.created_by is not distinct from old.created_by or v_nulls_creator)
       and to_jsonb(new) - 'lead_id' - 'created_by' = to_jsonb(old) - 'lead_id' - 'created_by'
    then
      return new;
    end if;
  end if;
  raise exception
    'platform.analyses ist append-only (eingefrorene Baseline, B14-1) — % nicht erlaubt. Eine '
    'korrigierte Analyse ist eine NEUE Zeile mit supersedes_id.',
    tg_op;
end;
$$;

create trigger analyses_no_update
  before update on platform.analyses
  for each row execute function platform.reject_analysis_mutation();

create trigger analyses_no_delete
  before delete on platform.analyses
  for each row execute function platform.reject_analysis_mutation();
```

Zwei Trigger, eine Funktion. Erlaubt ist ein UPDATE **nur**, wenn er `lead_id` und/oder
`created_by` von einem Wert auf `null` setzt und die Zeile sonst bit-identisch bleibt (die
`ON DELETE SET NULL`-Asymmetrie); jedes andere UPDATE und jedes DELETE wirft — ohne Rollenausnahme.

### E.4 `supersedes_id`

- **Struktur:** ein nullbarer Selbst-Fremdschlüssel (`:85`) — keine `on delete`-Klausel, kein CHECK
  gegen `supersedes_id = id`, kein Trigger, der Ketten oder Zyklen prüft, keine Rückwärtsspalte
  („ersetzt durch"). Der Grep über die Migration nach `supersedes` liefert ausser Kommentar und
  Parameterdurchreichung (`:345, 426, 435, 511, 584`) keine Prüfung.
- **Schreibweg:** `admin_create_analysis(… p_supersedes_id uuid default null …)` (`:345`); der
  Admin-Upload reicht den Wert nur durch, wenn er eine UUID ist
  (`apps/web/lib/admin/analysis-upload.ts:221`, Formularfeld `supersedesId`,
  `apps/web/lib/admin/analyses-actions.ts:64`).
- **Leseweg:** `admin_list_analyses` liefert je Zeile nur die Vorgängerin (`supersedes_id`); die
  Nachfolgerin wird in der Anwendung aus den neuesten **200** Zeilen abgeleitet
  (`apps/web/lib/admin/analyses.ts:166-193`, `SUCCESSOR_SCAN_LIMIT = 200`).

### E.5 `customer_label`

`text not null` (`:66`); der Tabellenkommentar (`:164-167`) benennt den Grund wortgleich:
„DENORMALISIERT und bewusst nicht nur am Lead: platform.leads wird nach 24 Monaten anonymisiert
(B1/B4-1), die Analyse muss danach noch Jahre zuordenbar bleiben." `lead_id` ist `on delete set
null`, nicht `cascade` (`:62`, Kommentar `:158-162`).

### E.6 Was archiviert wird — und was nicht

`inputs` und `result` als `jsonb` (`:98, 101`), die Ursprungsdatei als gzip (`:135`) samt SHA-256
(`:129`), fünf typisierte Auszüge (`:114-120`). **Es gibt keine Spalte für ein gerendertes
Dokument** (kein PDF, kein Report-Text, kein Layout). Das Austauschformat auf dem Weg dorthin ist
`AnalysisBundle` (`packages/shared/src/analysis-bundle.ts:290-302`, `ANALYSIS_BUNDLE_VERSION = 7`,
`:135`; unterstützt `[1..7]`, `:144`) mit `inputs: AnalysisBundleInputs` (`:209-279`: `tariff`,
`financial?`, `horizonYears`, `batteryCatalog`, `batteryOverride?`, `pvFileName`, `pvSource?`,
`tariffSetId?`, `tariffSetLabel?`, `tariffSetValidFrom?`, `tariffProfileKey?`,
`tariffOverriddenFields?`).

**Befund E:** Trägt. Präzisierung: „supersedes_id-Mechanismus" ist ein Fremdschlüssel plus eine
Anwendungs-Ableitung über 200 Zeilen, keine datenbankseitige Kettenlogik.

---

## F. `grid_tariffs` — Struktur, Rechte, Ordnungspflicht

### F.1 Schema — `20260827120000_create_grid_tariffs_and_spot_prices.sql`

| Objekt | Fundstelle | Inhalt |
|---|---|---|
| `public.grid_tariffs` | `:79-114` | `id`, `operator_id`, `operator_name`, `netzebene` (CHECK 3–7), `metering_variant` (CHECK 3 Werte, nullbar), `grundpreis_amount`, `grundpreis_unit` (CHECK `eur_per_kw_year/eur_per_year`), `netzverlust_ct_per_kwh`, `price_basis` (CHECK `net/gross`), `valid_from date not null`, `valid_until date`, `created_by text not null`, `created_at`; **`unique nulls not distinct (operator_id, netzebene, metering_variant, valid_from)`** (`:112-113`) |
| `+ backfilled_at timestamptz` | `20260903090000:95` | 14. Spalte |
| `public.grid_tariff_rate_windows` | `:152-161` | `id`, `grid_tariff_id` (FK `on delete cascade`), `label`, `month_day_from`, `month_day_to`, `time_from`, `time_to`, `ct_per_kwh` |
| `+ note text` | `20260902180000:74` | 9. Spalte |
| RLS + Lese-Policies | `:233-253` | `for select to anon, authenticated using (true)` auf allen drei Tabellen |
| Rechte-Grundstellung | `:255-261` | `revoke all … from public, anon, authenticated, service_role`; danach **nur** `grant select … to anon, authenticated` |

### F.2 Die vier Schreibfunktionen — alle `security invoker`, EXECUTE nur `service_role`

| Funktion | Migration:Zeile | Was sie tut |
|---|---|---|
| `public.create_grid_tariff(11 Parameter)` | `20260828090000:108-233`, per `create or replace` neu gefasst in `20260902180000:220-338` (nur `note` ergänzt) | Advisory-Lock je Kombination (`145-148`); sucht **offene** Stände (`valid_until is null … for update`, `154-164`); **`if p_valid_from <= v_latest_open → status 'invalid_valid_from'`** (`166-173`); schliesst die offenen mit `valid_until = p_valid_from - 1` (`128, 175-179`); INSERT der neuen Zeile, `unique_violation → 'duplicate_valid_from'` (`196-197`); INSERT der Fenster aus `jsonb_to_recordset` (`204-223`). Grants `:278-279, 289-295`. |
| `public.delete_grid_tariff(p_tariff_id, p_deleted_by)` | `20260901120000:154-211` | Zeile `for update` lesen, `not_found` werfen (`170-178`); Abzug samt Fenstern in `grid_tariff_deletions` (`182-194`); `delete from public.grid_tariffs where id = p_tariff_id` (`201`). Grants `:268-269, 277-279`. |
| `public.add_grid_tariff_rate_window(8 Parameter)` | `20260902180000:95-160` | nur an einen **offenen** Stand (`v_valid_until is not null → 'closed_tariff'`, `133-136`); INSERT eines Fensters (`138-144`). Grants `:193-199`. |
| `public.backfill_grid_tariff(10 Parameter)` | `20260903090000:155-298` | ältester Stand über **alle** Zeilen, offene wie geschlossene (`201-209`); **`if p_valid_from >= v_oldest_from → 'not_before_oldest'`** (`225-230`); neue Zeile bekommt `valid_until = v_oldest_from - 1` und `backfilled_at = now()` (`238-250`). Grants `:338-344`. |

Es gibt **keine** Funktion, die eine bestehende Zeile oder ein bestehendes Fenster **ändert**, und
keine, die ein einzelnes Fenster entfernt. Die Server Actions in `apps/web` prüfen vor jedem
Aufruf `isCurrentUserAdmin()` (`apps/web/lib/admin/grid-tariffs-actions.ts:82, 245, 323`).

### F.3 Die Rechtefläche heute — je Rolle, je Tabelle

| Tabelle | `anon` / `authenticated` | `service_role` | Herkunft |
|---|---|---|---|
| `grid_tariffs` | `SELECT` | **`DELETE, INSERT, SELECT, UPDATE`** | INSERT/SELECT/UPDATE `20260828090000:278`; DELETE `20260901120000:268` |
| `grid_tariff_rate_windows` | `SELECT` | `INSERT, SELECT` | INSERT `20260828090000:279`; SELECT `20260901120000:269`; **kein UPDATE, kein DELETE für irgendeine Rolle** |
| `grid_tariff_deletions` | — (nichts, auch kein SELECT) | `INSERT` | `20260901120000:117, 127` |
| `spot_prices` | `SELECT` | `INSERT, UPDATE, SELECT` | `20260827160000:65` |

Diese Fläche ist im DB-Gate exakt gepinnt: `packages/db-tests/src/grid-tariff-write-path.test.ts:428`
(`'DELETE,INSERT,SELECT,UPDATE'`) und `:448` (`'INSERT,SELECT'`), ebenso
`grid-tariff-add-window.test.ts:449-450` und `grid-tariff-backfill.test.ts:773-774`.

### F.4 Wie die zeitliche Ordnungspflicht durchgesetzt wird

1. **Im Funktionsrumpf, nicht per Constraint:** `create_grid_tariff` weist `p_valid_from <=
   v_latest_open` mit `invalid_valid_from` ab (`20260828090000:166-173`); `backfill_grid_tariff`
   weist `p_valid_from >= v_oldest_from` mit `not_before_oldest` ab (`20260903090000:225-230`).
   Beide liefern `jsonb` mit `status`, sie werfen nicht.
2. **Advisory-Lock je Kombination** (`pg_advisory_xact_lock(hashtext('grid_tariff:' || operator ||
   ':' || netzebene || ':' || coalesce(variant, '')))`, `20260828090000:145-148`, identisch in
   `20260903090000:191-194`) serialisiert gleichzeitige Aufrufe.
3. **Unique-Constraint als Rückhalt:** `unique nulls not distinct (operator_id, netzebene,
   metering_variant, valid_from)` (`20260827120000:112-113`) fängt denselben Stichtag, aber
   **nicht** eine Überschneidung mit verschiedenem `valid_from` — dafür sind 1. und 2. da.
4. **Lückenlosigkeit als Rechnung:** die Vorgängerin endet bei `p_valid_from - 1`
   (`20260828090000:128, 177`), der nachgetragene Stand bei `v_oldest_from - 1`
   (`20260903090000:238`).

**Befund F:** Die Struktur trägt, die Grant-Formulierung der Sitzung nicht — s. Abweichungen.

---

## G. `calculator_pro` — Prüfung und Vergabewege heute

### G.1 Die Prüfung

| Fundstelle | Zustand |
|---|---|
| `20260718093043_create_platform_schema.sql:32` | `create type platform.product_key as enum ('monitor', 'calculator_pro')` — seit T4-1. |
| `:125-134` | `platform.entitlements (user_id, product, is_active, valid_until, source, note, updated_at)`, PK `(user_id, product)`. |
| `:407-422` | `platform.has_entitlement(p_user_id, p_product)`: `is_active and (valid_until is null or valid_until > now())`. |
| `20260718104400_auth_rpc_wrappers.sql:23-31, 68-73` | `public.get_my_entitlement(p_product)` → `has_entitlement(auth.uid(), p_product)`; EXECUTE nur `authenticated`. |
| `apps/web/lib/kalkulator/access.ts:36, 65-82` | `CALCULATOR_PRODUCT = 'calculator_pro'`; `getCalculatorAccess()`: `getUser()` → `rpc('get_my_entitlement')`; fail closed (`error → no_entitlement`), Vergleich `data === true`. |
| `apps/web/app/(site)/[locale]/peak-shaving/kalkulator/rechner/page.tsx:76-85, 117-152` | `anonymous` → Redirect auf `/anmelden?next=…`; `granted` → iframe auf `apps/website`; `no_entitlement` → `CalculatorAccessRequest` (Partnerweg + Kontakt-Link, **kein Code-Feld**, `calculator-access-request.tsx:76-89`). |

### G.2 Die Schreibwege in `platform.entitlements` für `calculator_pro`

| Weg | Auslöser | Fundstelle | Ergebnis |
|---|---|---|---|
| **1. Gutscheincode** | Admin legt Code an: `public.admin_create_code(p_code, p_product_key, p_max_redemptions?, p_expires_at?, p_note?)` (`20260720140000:518-567`; Formular-Auswahl über `CODE_PRODUCT_KEYS = ['monitor', 'calculator_pro']`, `apps/web/lib/admin/config.ts:117`). Nutzer löst auf `/konto` ein (`RedeemCodeForm`, `apps/web/components/redemption/redeem-code-form.tsx` → `redeemCodeAction`, `apps/web/lib/redemption/actions.ts:41-119` → `rpc('redeem_code')`, `:78`). | `public.redeem_code(p_code)` `20260720120000:104-191` | Upsert `platform.entitlements (user_id, product, is_active=true, valid_until=null, source='manual')` (`:181-187`); Status `redeemed`/`invalid_code`/`expired`/`exhausted`/`already_redeemed`/`already_active`. |
| **2. Partner-Anfrage (B18-4)** | Partner reicht im Portal (`/portal/kalkulator`) `public.submit_calculator_request(p_message)` ein (`20260804150000:296-362`, nur mit aktiver Partnerzeile). Admin entscheidet auf `/admin/kalkulator-anfragen/[id]`. | `public.admin_decide_calculator_request(p_id, 'approved')` `20260804150000:452-561` | Upsert `platform.entitlements … source='manual', note='B18-4: Kalkulator-Anfrage <id>'` (`:542-550`) **in derselben Transaktion** wie `status='approved'` (`:555-559`); `already_active`, wenn bereits vorhanden (`:526-528`). |
| **3. Stripe-Trigger** | `source='stripe'` wird ausschliesslich vom DB-Trigger aus `subscriptions` abgeleitet (Kommentar `20260718093043:136-139`). | — | **Für `calculator_pro` heute wirkungslos:** es existiert kein Stripe-Preis (`apps/web/lib/admin/config.ts:108-110`: „ein Stripe-Preis existiert nicht, OP#1 ist offen"). |

Es gibt **keinen** generischen `admin_grant_entitlement`-Wrapper (ausdrücklich nicht gebaut,
`20260804150000`, Kopfkommentar) und keinen Rücknahmeweg für ein erteiltes Entitlement (ebd.).

### G.3 Die Registrierung

`apps/web/lib/leads/capture-registration.ts` ruft `capture_lead` (Lead mit Herkunft
`registrierung`/`kalkulator-registrierung`, `apps/web/lib/leads/registration-source.ts:56`) — die
Datei enthält **kein** `entitlement` und kein `redeem` (Grep 0 Treffer; Positivkontrolle:
`entitlement` steht 7× in `apps/web/lib/kalkulator/access.ts`). `apps/web/lib/auth/**` enthält
ebenfalls kein `entitlement`. Ein Konto hat nach der Registrierung also **keinen** Eintrag in
`platform.entitlements`. Der Hinweistext auf `/konto` nennt weiterhin den Gutscheincode als
Selbstfreischaltung (`apps/web/messages/de.json:1685`, `calculatorInactiveHint`).

**Befund G:** Die Prüfung trägt wie angenommen (Sitzung + Entitlement). Der Vergabeweg ist
**nicht** allein der Gutscheincode — s. Abweichungen.

---

## H. `InvoiceExtraction` — hat die Grundgebühr ein Feld?

| Fundstelle | Zustand |
|---|---|
| `packages/shared/src/invoice-scan.ts:68-98` | `interface InvoiceScanRates` mit **7** Feldern: `leistungspreisEurPerKwYear`, `minBillableKw`, `arbeitspreisNetzCtPerKwh`, `energyPriceCtPerKwh`, `energyPriceNightCtPerKwh`, `einspeiseverguetungCtPerKwh`, **`supplierBaseFeeEurPerMonth: number \| null`** (`:97`). |
| `:101-108` | `interface InvoiceExtraction { netzbetreiber; netzebene; meteringVariant; rates: InvoiceScanRates; annualConsumptionKwh }`. |
| `:111-119` | `INVOICE_SCAN_RATE_KEYS` führt `'supplierBaseFeeEurPerMonth'` (`:118`). |
| `:254-261` | JSON-Schema-Eintrag mit der Abgrenzung Lieferant/Netzbetreiber im Beschreibungstext. |
| `apps/website/lib/invoice-scan/extract.ts:176-205` | System-Prompt-Abschnitt „supplierBaseFeeEurPerMonth — die Grundgebühr des STROMLIEFERANTEN, und nur sie". |
| `apps/website/components/flow/step-tariff.tsx:254-256` | Schicht 3 der Vorbelegung übernimmt den gelesenen Wert in das Formularfeld. |
| `apps/website/components/flow/types.ts:142-147` | `TariffPrefill` trägt ihn über `rates` mit. |
| `git log -S supplierBaseFeeEurPerMonth -- packages/shared/src/invoice-scan.ts` | **genau ein Commit: `a45a268`, 2026-09-02, „feat(rechner): Grundgebühr des Lieferanten aus der Rechnung lesen (Delta 19 / §3.7.3) (#128)"** — 10 Dateien, darunter `Pflichtenheft_Kalkulator_MVP.md` (§3.7.3 nachgeführt) und `DEPLOYMENT.md`; **`CLAUDE.md` (Repo-Root) nicht darunter**. |
| `CLAUDE.md:608` | Der Handover-Satz „Der Rechnungs-Scan liest die Grundgebühr NICHT — `InvoiceExtraction` hat kein Feld dafür (ausdrücklich ausgenommen, eigener Auftrag)" stammt aus dem Delta-19-Eintrag (02.09.2026) und ist seit `a45a268` **veraltet**; ein Eintrag zu PR #128 fehlt in `CLAUDE.md` (Grep nach `#128`: 0 Treffer). |

Positivkontrolle für die Absenz-Aussagen derselben Datei: `billingModel` kommt in
`invoice-scan.ts` **nur** in Zeile 58 (Kommentar) vor — das Feld fehlt tatsächlich, wie dort
begründet; ebenso fehlen `timeOfUseWindows`, `benutzungsdauerModel`, `dynamicPriceProfile` und —
für die Mehrfach-Rechnungs-Zusammenführung relevant — jedes Datums- oder Zeitraumfeld.

**Befund H:** Trägt NICHT. Das Feld existiert.

---

## Abweichungen von den Sitzungs-Annahmen

Dieser Abschnitt ist befüllt. Vier Annahmen zeigen im Code etwas anderes:

1. **H — Grundgebühr im Rechnungs-Scan.** Angenommen: „die Grundgebühr hat kein Feld (wie im
   Handover vermerkt)". Gemessen: `InvoiceScanRates.supplierBaseFeeEurPerMonth` existiert seit
   `a45a268` (02.09.2026, PR #128), samt Schema, System-Prompt, Zusammenführung
   (`packages/shared/src/invoice-merge.ts`) und Vorbelegung in Schritt 2. Der Handover-Satz in
   `CLAUDE.md:608`, auf den sich die Annahme stützt, ist veraltet; das MVP-Pflichtenheft §3.7.3
   wurde in PR #128 nachgeführt, `CLAUDE.md` nicht.

2. **F — Rechtefläche von `grid_tariffs`.** Angenommen: „append-only nach dem grid_tariffs-Muster
   (B21-2b) — kein update/delete-Grant für irgendeine Rolle". Gemessen: `service_role` hat auf
   `public.grid_tariffs` `UPDATE` seit B21-2b (`20260828090000:278`, gebraucht zum Schliessen der
   Vorgängerin) und `DELETE` seit B21-2c (`20260901120000:268`, der protokollierte Löschweg). Was
   der Annahme entspricht: `anon`/`authenticated` haben nur `SELECT`; auf
   `grid_tariff_rate_windows` gibt es für **keine** Rolle `UPDATE` oder `DELETE`; und es existiert
   keine Funktion, die eine Zeile oder ein Fenster **bearbeitet**. Die Ordnungspflicht wird im
   Funktionsrumpf (`invalid_valid_from`, `not_before_oldest`) plus Advisory-Lock durchgesetzt, nicht
   durch eine Constraint (F.4).

3. **G — Vergabeweg von `calculator_pro`.** Angenommen: „exakter heutiger Vergabeweg über
   Gutscheincode". Gemessen: es gibt heute **zwei** manuelle Schreibwege in `platform.entitlements`
   für dieses Produkt — den Gutscheincode (`redeem_code`) **und** die genehmigte Partner-Anfrage
   (`admin_decide_calculator_request`, B18-4, Entitlement in derselben Transaktion). Beide schreiben
   `source='manual'`, `valid_until=null`. Die Registrierung schreibt kein Entitlement
   (`capture-registration.ts`, 0 Treffer). Eine „automatische Vergabe bei Registrierung" wäre ein
   dritter manueller bzw. vierter Schreibweg insgesamt, für den es heute keinen Wrapper gibt
   (`admin_grant_entitlement` ist ausdrücklich nicht gebaut).

4. **A — Privat/Betrieb als bestehende Verzweigung.** Das Konzept (`B24_KI-Interface_Kalkulator.md`
   §1.4) und die Sitzung setzen eine „Privat/Betrieb-Verzweigung" als Bezugspunkt voraus. Gemessen:
   im Flow gibt es **keine** Kundentyp-Auswahl; der einzige Vorläufer ist
   `StandardProfileCustomerClass = 'privat' | 'kleingewerbe'` mit deaktiviertem `kleingewerbe`
   (A.5). `TariffParams` trägt kein Feld für die Leistungsmessungs-Variante, kein Feld für den
   Vorsteuerabzug und `netzebene` nur als freier String (`z.string().optional()`).

### Präzisierungen (keine Widersprüche)

- **D:** `recommendBattery` gibt `{ perBattery, recommendation }` zurück; das „vollständig sortierte
  Array" ist `perBattery`. Ein leerer Katalog ist nicht vorgesehen (`perBattery[0]!`,
  `rank.ts:174`). Das Muster „jeden Kandidaten einzeln, sortiert, ungefiltert" existiert ein zweites
  Mal im Worker (`buildExistingBatteryAnalysis`, `analysis.worker.ts:132-186`).
- **E:** Der „supersedes_id-Mechanismus" ist ein Selbst-Fremdschlüssel ohne Kettenprüfung; die
  Nachfolger-Zuordnung entsteht in der Anwendung über die neuesten 200 Zeilen
  (`apps/web/lib/admin/analyses.ts:176`). `platform.leads` trägt keinen Eigentümer-Verweis
  (kein `user_id`/`account_id`) und ist über RLS **ohne** Policy gesperrt — ein
  Eigentümerschafts-RLS hat auf dieser Tabelle keinen Präzedenzfall.
- **E:** `platform.partners.user_id` ist tatsächlich `unique`
  (`20260726090000_create_partner_approval.sql:101`), wie in der Sitzung angenommen.
- **B:** Die Doku-Fassung §3.10 des MVP-Pflichtenhefts ist gegenüber dem Typ unvollständig (B.4);
  der Typ ist die einzige verlässliche Quelle.
- **C:** Die sechs Anbindungen halten keinen Zustand; die einzige über mehrere Nachrichten lebende
  Struktur im Rechner ist der Analyse-Worker mit Rechen-, nicht Konversationszustand.

---

## Anhang — wie gemessen wurde

- **Code:** vollständiges Lesen von `apps/website/components/flow/{calculator,step-upload,
  step-tariff,step-result,standard-profile-panel,types}.tsx|ts`, `apps/website/lib/analysis.worker.ts`,
  `packages/shared/src/{tariff,financial,battery,load-profile,analysis-result,tariff-pricing,
  invoice-scan}.ts`, `packages/engine/src/recommendation/rank.ts`, `apps/web/lib/kalkulator/access.ts`,
  `apps/web/lib/admin/config.ts`, den sechs KI-Modulverzeichnissen (`actions.ts`/`ai-client.ts`
  vollständig, `extract.ts` als Signatur-/Aufrufauszug, `invoice-scan/extract.ts` vollständig) sowie
  Signatur-Greps über `invoice-scan-panel.tsx`, `mixed-upload-panel.tsx`, `pv-design-panel.tsx`,
  `battery-text-panel.tsx`, `tarif-nicht-verfuegbar.tsx`, `use-analysis.ts`, `analysis-protocol.ts`,
  `analysis-bundle.ts`, `apps/web/lib/admin/analyses.ts`, `analysis-upload.ts`,
  `redemption/actions.ts`, `calculator-access-request.tsx`, `rechner/page.tsx`.
- **Migrationen:** SQL-Substanz (ohne Kommentarzeilen) von `20260718093043`, `20260718104400`,
  `20260720120000`, `20260720140000` (Auszug), `20260721100000` (Tabellenblock), `20260724150000`,
  `20260804150000`, `20260804180000`, `20260827120000`, `20260827160000`, `20260828090000`,
  `20260901120000`, `20260902180000`, `20260903090000`; alle `alter table platform.leads`-Blöcke
  über alle Migrationen; alle 29 `create table` über alle Migrationen.
- **Greps mit Positivkontrolle:** `messages.create` (6), `role: 'assistant'` (0),
  Konversationsbegriffe (6× Off-Main-Thread), `chat` (0), `industry` in `apps/website` (0) gegen
  `apps/web` (12), `metering|leistungsmessung` in `tariff.ts` (0) gegen `tariff-pricing.ts` (3),
  `entitlement|redeem` in `capture-registration.ts` (0) gegen `access.ts` (7),
  `vorsteuer|umsatzsteuer|mwst` in den Flow-Komponenten (0) gegen die Report-Komponenten (5),
  `billingModel` in `invoice-scan.ts` (nur Kommentar), `#128` in `CLAUDE.md` (0),
  `git log -S supplierBaseFeeEurPerMonth` (1 Commit).
- **Nicht gemessen:** kein Live-Lauf, keine Datenbankabfrage gegen Cloud oder lokalen Stack, kein
  Build-Vergleich — die Fragen A–H sind Struktur- und Bestandsfragen, keine Laufzeitfragen. Die
  Zeilenangaben gelten für `26b33af`.
- **Datum aller Messungen:** 09.09.2026.
