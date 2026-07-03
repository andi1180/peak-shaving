# Status-Audit gegen Pflichtenheft §0–§10 — 2026-07-03

> Read-only-Ist-Stand-Erhebung. Verifiziert am Code, an git und am laufenden System — nicht an den
> Behauptungen der MD-Dateien. Referenzstand: `origin/main @ fad9e91`.
> Methodik: lokale Quality-Gates + GitHub-API + 15 unabhängige Audit-Agents (Mapping je Baustein,
> Claim-für-Claim-Verifikation von CLAUDE.md, Vollständigkeits-Kritiker mit Stichproben) + Headless-Browser-Durchlauf des Rechner-Flows.

**Kurzfazit:** Das Repo ist in einem sauberen, ehrlichen Zwischenstand. Alles, was CLAUDE.md als gebaut
meldet, existiert und ist grün (eine Marker-Behauptung nur teilweise, s. Abschnitt 5). Der gesamte
Rechenkern (§3.4–§3.9, §3.11) ist — wie dokumentiert — noch nicht begonnen; die Engine besteht aus dem
Parser, das UI läuft vollständig gegen den Mock. Supabase/Portal sind leere Hüllen (M3/M4, planmäßig).
CI ist seit dem letzten Commit erstmals grün; die fünf Runs davor waren alle rot (pnpm-Versionskonflikt).

---

## 1. Build/Quality lokal

Alle fünf Gates **grün** (Node v25.9.0, pnpm 10.33.4):

| Kommando | Ergebnis | Detail |
|---|---|---|
| `pnpm install` | ✅ grün | Lockfile up to date. Hinweis: Build-Scripts von `esbuild`/`sharp` werden von pnpm ignoriert (`pnpm approve-builds` ausstehend, bisher folgenlos). |
| `pnpm -r typecheck` | ✅ grün | 4 Pakete (`engine`, `shared`, `website`, `portal`), je `tsc --noEmit`. |
| `pnpm -r lint` | ✅ grün | Je-Paket-`eslint .`; root-weites `pnpm lint` ebenfalls exit 0. |
| `pnpm -r test` | ✅ grün | `shared`: 18/18 (contract.test.ts) · `engine`: 23/23 (parse.test.ts 14 + datetime.test.ts 9). |
| `pnpm -r build` | ✅ grün | `shared`/`engine` tsc, `website`/`portal` next build. Routen website: `/` + `/rechner` (statisch). |

Einziger Build-Hinweis (kein Fehler): `next build` warnt „The Next.js plugin was not detected in your
ESLint configuration" — das root-`eslint.config.mjs` bindet `@next/eslint-plugin-next` nicht ein.
Kosmetisch; Lint läuft über die eigene Flat-Config.

## 2. Pflichtenheft-Mapping §0–§10

Status je Baustein, belegt am Code (repo-relative Pfade; Tests = existierende Abdeckung):

| Baustein | Status | Dateien | Tests |
|---|---|---|---|
| **Typen §3.1** | **GEBAUT** | `packages/shared/src/{load-profile,tariff,battery,financial,simulation}.ts` | `contract.test.ts` (18): loadProfile 5, batteryCandidate 4, tariffParams 3, financialParams 4, simulationConfig 2. Lücke: `pvProfileSchema` hat 0 Tests. |
| **Parser §3.2** | **GEBAUT** | `packages/engine/src/parser/{parse,types,detect,datetime,number,table,normalize,limits}.ts` | `parse.test.ts` (14 `it()`), `datetime.test.ts` (9) — alle grün. ParseOutcome-Union (ok/needs_mapping/error), Delimiter `;`/Tab/`,`/`|`, Dezimal inkl. Tausendertrenner, ISO/de-dot/Excel-Serial, BOM, kW=kWh×4 (`normalize.ts:29-32`), alle 3 `source`-Fälle → signiertes `gridPowerKw`. Fixtures rein synthetisch/inline. |
| **Lastgang-Aufbereitung §3.3** | **GEBAUT** | `packages/engine/src/parser/{prepare,datetime}.ts` | DST/UTC via Intl (`datetime.ts:59-100`, Tests `datetime.test.ts:5-21`), 15-min-Gitter + lineare Lücken-Interpolation + `dataQuality` (`parse.test.ts:104-157`). Pflichtwarnung `import_only` ohne PV (§3.1): implementiert `parse.ts:153-158`, **beide Richtungen getestet** (`parse.test.ts:64-82`). |
| — Adapter-Registry (OP#4) | TEILWEISE | `packages/engine/src/parser/adapters.ts` | Registry + `matchAdapter` verdrahtet (`parse.ts:75-89`), aber **0 reale Adapter** — §3.2-Mindestabdeckung (3 Netzbetreiber + Fronius/SMA/Sungrow) NICHT erfüllt, blockiert durch OP#4. Keine Adapter-Tests. |
| **Spitzenerkennung §3.4** | **NICHT GEBAUT** | — (nur Contract-Typ `analysis-result.ts:72-81` + Mock-Werte) | keine. grep über `packages/engine/src` nach peak/annualPeak/monthlyPeak: nur Plausibilitäts-Warnstring `prepare.ts:133`. |
| **TariffStrategy §3.5** | **TEILWEISE** (nur Typen) | Typen: `packages/shared/src/tariff.ts:8-13,30-35,38-51` (BillingModel-Enum, BenutzungsdauerModel-Platzhalter, TariffParams). **Interface + Implementierung: NICHT GEBAUT** — grep `TariffStrategy\|billedKw` trifft nur Kommentare (`tariff.ts:6`, `engine/src/index.ts:2`). | Schema-Tests `contract.test.ts:85-99`; kein Verhaltens-Test (kein Verhalten). |
| **SoC-Simulation + Kapp-Suche + Reserve §3.6/§3.6.1** | **NICHT GEBAUT** | — (nur `simulationConfigSchema` `simulation.ts:4-11`, `DispatchTrace`-Typ) | keine. Konsistent: blockiert durch Static-Control-Frage (CLAUDE.md/OP#5). |
| **Kombinierter Dispatch §3.7** | **NICHT GEBAUT** | — (Ersparnisanteile nur als Contract-Felder + frei erfundene Mock-Werte `mock-analysis.ts:101-104,174-184`) | keine |
| **Empfehlung §3.8** | **NICHT GEBAUT** | — (BatteryCandidate-Typ inkl. `controlType`; Mock-Empfehlung hartkodiert `mock-analysis.ts:192-196`) | keine |
| **ROI §3.9** | **NICHT GEBAUT** | — (einzige ROI-Arithmetik: UI-Mock `mock-analysis.ts:82-127`; kein Förder-/IFB-/AfA-Pfad in der Engine) | keine |
| **Ausgabe-Contract §3.10** | **GEBAUT** | `packages/shared/src/analysis-result.ts` — Feld-für-Feld vollständig ggü. §3.10 (current/peaks/perBattery inkl. Savings-Aufschlüsselung „aus DEMSELBEN Fahrplan"/recommendation/assumptions/dataQuality); `DispatchTrace` (capKwByPeriod, caughtPeaks, representativeDays) | Bewusst kein zod-Mirror (dokumentiert `:66-69`); Absicherung nur compile-time über den typgeprüften Mock. PROVISORISCH-Marker an DispatchTrace/PeakDistribution wie im Handover. |
| **Test-Fixtures §3.11** | **NICHT GEBAUT** | — | Kein Bäckerei-/PV-/HT-NT-/Billing-Regressions-Fixture; die Inline-Generatoren in `parse.test.ts:9-33` testen Formate, keine Lastprofile. **M1-Gate vollständig offen.** |
| **UI-Flow §5 (4-Schritt-Rechner)** | **GEMOCKT** | `apps/website/components/flow/*` (9 Dateien), `lib/{analysis-protocol,analysis.worker,use-analysis,mock-analysis}.ts` | keine UI-Tests. Flow-Hülle komplett; Tarif-Formular validiert real gegen shared-zod-Schemata (`step-tariff.tsx:148,171`) inkl. Faktor-100-Hinweis. **Parser NICHT verdrahtet** (PARSE-SLOT leer, `step-upload.tsx:30-35`; 0 engine-Imports in apps/website). Worker-Verdrahtung real, Rechnung 100 % Mock (`analysis.worker.ts:29-43`). |
| **Report §6.2** | **TEILWEISE** | `apps/website/components/report/{report,key-metric,recommendation-card,chart-placeholder,num,lead-dialog}.tsx` | keine. Vorhanden: Kern-Kennzahl, Empfehlungskarte mit Ersparnis-Aufschlüsselung, Hindsight-Hinweis (§6.2-Pflicht, `recommendation-card.tsx:90-95`), Alternativen, `tabular-nums` via `<Num>`. Fehlt (= U2): alle 3 Charts (Recharts nicht mal dependency), editierbares Annahmen-Panel (nur Read-only-Accordion, `report.tsx:96-117`), „Kernzahl aufklappbar zur Rechenweise", PDF-Export. |
| **Lead/Schema §4/§5.1** | **GEMOCKT / NICHT GEBAUT** | Lead-Dialog-Stub `lead-dialog.tsx` (Pflichtfelder + Consent-Checkbox korrekt, **persistiert nichts**, kein Datenschutz-Link, keine consent_version — M3). `supabase/` enthält **nur `.gitkeep`**: keine Migration, keine Tabelle, keine RLS-Policy (M3/M4). `apps/portal` = Hello-World-Scaffold („Auth & RLS folgen."). | keine |

## 3. Commit-Nachweis

`git log --oneline origin/main` (vollständig, 8 Commits) und Zuordnung zu den CLAUDE.md-Bausteinen:

| Commit | Baustein lt. CLAUDE.md |
|---|---|
| `316b43b` chore: monorepo scaffold | Prompt 0 (Scaffold, 4 Pakete + CI-Grundgerüst) |
| `b70486b` chore: align docs + harden CI | CI-Härtung / Doku-Abgleich |
| `74b4a23` feat(shared): domain contract | Prompt 1 (Contract) |
| `8b4f9e7` fix(shared): tighten contract units + trace shape | Contract-Härtung (Units, dispatchTrace-Shape) |
| `9c86ff7` feat(website): public flow shell + design system | U1 (öffentliche Rechner-Hülle) |
| `cb08d2e` feat(engine): CSV/XLSX parser + load-profile preparation | Prompt 2 (Parser §3.2/§3.3) |
| `6b9278b` chore: enable react-hooks eslint + document parser | react-hooks-Fix |
| `fad9e91` chore: close out session state before handover | CI-Fix (pnpm-Version aus Workflow entfernt) + Handover-Doku |

Lokal = `origin/main` (kein unpushed Commit). **Uncommitted zum Audit-Zeitpunkt:** nur `CLAUDE.md`
(modifiziert): Abschnitte „Rollen & Zusammenarbeit" und „Arbeitsweise (Advisor-Modus)" entfernt,
Zeile „Deployment: vercel" ergänzt. Keine untracked Dateien (vor diesem Bericht).

## 4. CI-Status

- **Workflow-Definition** (`.github/workflows/test.yml`): `pnpm/action-setup@v4` **ohne** `version:`-Feld
  → liest die Version aus `packageManager: "pnpm@10.33.4"` in `package.json` (vorhanden). Der
  Versionskonflikt-Fix ist **wirklich aktiv**. Gates: Lint → Typecheck → Test engine → Test shared →
  Build website+portal.
- **Run-Historie** (GitHub-API, `gh` CLI lokal nicht installiert):

  | Run | Commit | Ergebnis |
  |---|---|---|
  | #6 | `fad9e91` | ✅ **success** (letzter Run auf main, 2026-07-03) |
  | #5 | `6b9278b` | ❌ failure — Step `pnpm/action-setup@v4` schlug fehl, alles danach skipped (= der Versionskonflikt) |
  | #4–#1 | `9c86ff7`…`316b43b` | ❌ failure (gleiche Ursache) |

  Der letzte Run ist grün; **alle fünf Runs davor waren rot**. Der Fix in `fad9e91` hat CI zum ersten
  Mal überhaupt durchlaufen lassen — d. h. die vorherigen Commits wurden nie von CI abgesegnet, sind
  aber durch die heutigen lokalen Gates (Abschnitt 1) rückwirkend abgedeckt.

## 5. Delta CLAUDE.md ↔ Realität

Jede Behauptung aus „Stand & offene Entscheidungen" wurde einzeln am Code verifiziert (unabhängiger
Agent je Claim + Kritiker-Gegenprobe). Ergebnis:

**Nicht (voll) gedeckt — das eigentliche Delta:**

1. **„Alle Format-Annahmen im Code als `[ANNAHME: unbestätigt bis Martins Muster (OP#4)]` markiert" → TEILWEISE.**
   Der volle OP#4-Marker existiert nur an 3 Stellen (`detect.ts:10` Import/Export-Keywords inkl. OBIS,
   `datetime.ts:121` XLSX-Wanduhr, `adapters.ts:43` Kommentar-Skelett). Die dritte in CLAUDE.md
   genannte Annahme (**all-positive Einzelspalte → `import_only`**, `detect.ts:184-186`) trägt nur ein
   nacktes `[ANNAHME]` ohne OP#4-Verweis, und die Fallback-Heuristik **„größere Summe = Import"**
   (`detect.ts:171-175`) trägt gar keinen Marker. → Zwei Marker nachziehen, wenn OP#4 ansteht.
2. **Nuance zu §3.2 „Struktur zeigen und bestätigen lassen":** `needs_mapping` wird nur bei
   uneindeutiger **Einheit** ausgelöst; Spalten-/source-Ambiguität wird heuristisch **still**
   entschieden (nur über `detection` einsehbar). CLAUDE.md behauptet das nicht falsch, aber die
   §3.2-Bestätigungs-UX ist auch UI-seitig nicht vorhanden (kein Mapping-Dialog im Flow).

**Gedeckt (Claim für Claim bestätigt):** Parser-Detailbehauptungen inkl. exakt 23 Tests (14+9) und
Pflichtwarnungs-Test in beide Richtungen · `dispatchTrace`-Shape mit genau den 3 Feldern, Labels
`worst_caught_peak`/`pv_strong`, Vorzeichen-Doku am Feld (`analysis-result.ts:51,56-57`) ·
`BenutzungsdauerModel`-Platzhalter (`src/tariff.ts:30-35` — Pfad in CLAUDE.md ohne `src/`) ·
zod `.min(0).max(100)` auf allen drei Percent-Feldern inkl. Boundary-Tests (300 abgelehnt) ·
`tabular-nums` via `<Num>` in Report **und** Stepper/Progress · U1-Hülle komplett inkl. beider
Andockpunkte (PARSE-SLOT, `payload: unknown`, Mock nur in `mock-analysis.ts`) und
`transpilePackages`/Source-Exports · react-hooks-ESLint beide Regeln als error, nur `apps/**`,
0 `eslint-disable` im Repo · „Engine = nur Parser, keine versteckten Stubs" (Gegenprobe über
src+dist, Export-Liste vollständig geprüft).

**Übererfüllt (Code kann mehr als dokumentiert):** Parser akzeptiert zusätzlich `Uint8Array`;
Delimiter-Erkennung auch Tab/Pipe; Dezimal-Erkennung inkl. Tausendertrenner; `BenutzungsdauerModel`
hat zusätzlich optionales `alternativeArbeitspreisCtPerKwh`; Größen-Limits (25 MB / 40.000 Zeilen)
nirgends in CLAUDE.md erwähnt.

**Präzisierungen fürs nächste Handover (keine Widersprüche):**
- „Die Engine dividiert intern durch 100" ist **Konvention im Doc-Comment** (`financial.ts:10-19`),
  noch kein Code — es existiert kein Engine-Konsument der Percent-Felder. Formulierung ist als
  Vorgabe lesbar, sollte aber nicht als „gebaut" verstanden werden.
- `[MARTIN:`-Platzhalter: 20 gesamt in apps/website, davon 11 exakt `[MARTIN: Copy]` (Rest: Katalog /
  rechtlich §5.1 / prüfen / bestätigen / Beispiel-Datensatz).
- Ein Typ „BatterySpec" existiert nirgends — Pflichtenheft und Code sagen durchgängig `BatteryCandidate`.
- Aufbereitung §3.3, bewusst festhalten: **große** Lücken werden ebenfalls linear interpoliert (nur mit
  Warnung markiert, nicht ausgespart); `coveredDays` = belegte Slots/96, keine Kalendertage.

## 6. Lokaler App-Lauf

`pnpm dev` (apps/website) startet sauber („Ready in 1171ms", keine Fehler im Server-Log). Der
4-Schritt-Flow wurde headless (Chrome via Playwright) mit einem synthetischen 2-Tage-Lastgang
(CSV, `;`-getrennt, deutsches Dezimal) komplett durchgefahren:

```
LANDING OK: Peak Shaving Kalkulator
STEP 1 (Upload) OK          ← Datei angenommen (PARSE-SLOT: kein Parsing, erwartet)
STEP 2 (Tarif) OK           ← Defaults, „Analyse starten"
STEP 3 (Analyzing) erreicht ← Worker-Progress (Mock)
STEP 4 (Report) OK — Überschriften: „Ihr Ergebnis", „PeakStore C40",
                     „1 Alternativen ansehen", „Annahmen & Rechenweise"
```

Report rendert vollständig gegen das Mock-AnalysisResult: Kern-Kennzahl (82,4 kW / € 6.210,
abgerechnet 69 kW), Ersparnis-Aufschlüsselung (1.530 + 520 + 0 = 2.050 €, nicht doppelt gezählt),
Investition, drei „[Chart folgt in U2]"-Platzhalter, Datenqualitäts-Box, Demo-Disclaimer.

Konsolen-Befund: **keine JS-/React-Fehler**. Einziger 404: `/favicon.ico` (fehlt schlicht als Asset).
Zwei `ERR_ABORTED` auf `_rsc`/`hot-update` sind Dev-Server-Hot-Reload-Artefakte während der
Navigation, kein App-Fehler.

---

*Erstellt durch automatisierten Audit (Claude Code), 2026-07-03. Grundlage: origin/main @ fad9e91 +
uncommittete CLAUDE.md-Anpassung. Read-only — keine Feature-Änderungen vorgenommen.*
