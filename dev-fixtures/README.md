# dev-fixtures

**Demo-/Testdaten — keine echten Kundendaten.** Dient dem manuellen Testen des öffentlichen
Rechners (`apps/website`) gegen den echten Parser (`packages/engine`), solange Martins reale
Netzbetreiber-Exporte (Pflichtenheft §8 OP#4) noch ausstehen.

## `demo-baeckerei-lastgang-2023.csv`

Synthetischer 12-Monats-Viertelstunden-Lastgang einer Bäckerei **ohne PV**: Ofen-Anlauf
4–6 Uhr (Peak ~5 Uhr), Tagesbetrieb, niedrige Nachtlast, Sonntag geschlossen, Samstag
verkürzter Tag. Format: Semikolon-getrennt, deutsches Dezimalkomma, ein kombinierter
Zeitstempel je Zeile.

```
Zeitstempel;Leistung (kW)
01.01.2023 00:00;3,49
01.01.2023 00:15;3,49
...
```

**Hinweis zur Spaltenaufteilung:** Diese Demo-Datei nutzt einen **kombinierten** Zeitstempel
(`TT.MM.JJJJ HH:MM`, `de_dot`). Getrennte Datums-/Zeitspalten („Datum" + „Zeit von"/„Uhrzeit")
werden **seit OP#4 unterstützt** (Split-Timestamp, `packages/engine/src/parser/detect.ts` →
`detectDateOnlyFormat` + `looksLikeTimeColumn`) — siehe die neuen `netzbetreiber-eda-*`-Fixtures
unten. Diese Datei bleibt bewusst kombiniert (unveränderte Regressions-Grundlage).

Erzeugt **absichtlich** ein paar kleine Lücken (fehlende Viertelstunden-Werte: 10. März
13:00–13:15, 15. Juni 09:30) sowie eine größere Lücke (18. September 14:00–15:45, 2 h), damit
beim Testen sowohl die stille Interpolation als auch die explizite
Datenqualitäts-Warnung (§3.3) sichtbar werden. Zusätzlich fallen beim Parsen erfahrungsgemäß
ein paar doppelte Zeitstempel rund um die Wiener Zeitumstellung (letzter Oktober-Sonntag) an
und werden dedupliziert — erwartet, kein Fehler in der Datei.

Da `source: 'import_only'` (keine Einspeisung/PV) vorliegt, löst die Datei zusätzlich die in
§3.1 vorgeschriebene Pflichtwarnung aus („Eigenverbrauchs-/Lastverschiebungs-Ersparnis nicht
beurteilbar").

Verifiziert gegen den echten `parseLoadProfile`: `ok: true`, 35.040 Werte im aufbereiteten
`LoadProfile` (Rohdatei hat etwas weniger Zeilen — die absichtlichen Lücken werden ja erst
beim Parsen wieder aufgefüllt).

## `demo-baeckerei-mit-pv-netzlastgang-2023.csv` + `demo-baeckerei-pv-erzeugung-2023.csv` (PV-Paar)

Ein **konsistentes Paar** für den PvProfile-Pfad (Upload → Engine → Trace, §3.1):

- **…-mit-pv-netzlastgang-2023.csv** — der **signierte** Netz-Lastgang (`+` Bezug, `−` Einspeisung),
  d. h. `Verbrauch − BruttoPV`. Enthält Negativwerte (Mittags-Einspeisung) → `parseLoadProfile`
  erkennt ihn als `net_signed`. Selbe Bäckerei-Verbrauchsform wie oben, plus ein 30-kWp-Dach.
- **…-pv-erzeugung-2023.csv** — die **Brutto-PV-Erzeugung** des Wechselrichters (immer ≥ 0,
  Tagesbogen + saisonale Skalierung). Wird als optionales PvProfile über `parsePvProfile` geladen.

**Konsistenz per Konstruktion (Prinzip 1, §3.1):** Der Netz-Lastgang ist aus `Verbrauch − BruttoPV`
abgeleitet. Damit gilt `Einspeisung(t) = max(0, −netz(t)) = max(0, BruttoPV − Verbrauch) ≤ BruttoPV`
in JEDEM Slot — die Konsistenz-Warnung aus `alignPvGrossToLoad` feuert bei diesem Paar **nie**
(`inconsistentSlots = 0`). Mit dem Paar zeigt der Report den echten **4. Strom** (abgeleiteter
Verbrauch) und den PV-Eigenverbrauch. Die absichtlichen Lücken (Interpolations-/Datenqualitäts-Demo)
liegen nur im Netz-Lastgang; die PV-Datei ist lückenlos (Abdeckungslücken sind ohnehin kein
Konsistenz-Widerspruch).

## Reale Formate (OP#4) — ANONYMISIERT

Erste echte Netzbetreiber-/Wechselrichter-Formate (Pflichtenheft §8 OP#4), als **anonymisierte**
Fixtures nachgebaut. Die realen Dateien enthielten echte Zählpunkt-IDs (`AT…`) und
Energiegemeinschafts-Namen (personenbezogen) — sie sind **NICHT** im Repo. Struktur/Format sind exakt
nachgebildet, alle IDs/Namen/Werte frei erfunden. Test-Grundlage: `packages/engine/src/parser/real-formats.test.ts`.

### Format A — Netzbetreiber/EDA-CSV: `netzbetreiber-eda-{juni,maerz}-2026.csv`

BOM, `;`-getrennt, Dezimalkomma, **Split-Timestamp** (getrennte Spalten `Datum` + `Zeit von` + `Zeit bis`;
Zeitstempel = Datum + „Zeit von" = Intervall-START), **672 Zeilen = 7 Tage × 96**. Vier Zählpunkte × vier
Größen: 2× `Verbrauch` (zwei Zähler DESSELBEN Standorts → müssen **summiert** werden), 2× `Einspeiser`,
2× `Überschuss`, 2× `Restüberschuss` (die letzten vier = reine EEG-Verrechnungsartefakte, **kein**
Netz-Lastgang). Nach jeder Datenspalte eine leere Trennspalte (`;;`).

Der Parser liefert dafür **`needs_mapping`** mit der klassifizierten Spaltenliste (Zählpunkt-ID,
Bezeichnung, Einheit, Rollen-Vorschlag) — er entscheidet die Zuordnung NICHT still (bei Mehrzähler-Daten
die gefährlichste Variante). Nach Mapping mit Summierung beider Verbrauchszähler:

| Datei | Σ Verbrauch (7 Tage) | Spitze | Einheit |
|---|---|---|---|
| `…-juni-2026.csv` | **46,109 kWh** | **2,36 kW** | kWh (×4 → kW) |
| `…-maerz-2026.csv` | **69,211 kWh** | **3,28 kW** | kWh (×4 → kW) |

Diese Zahlen reproduzieren die Aggregate des realen Exports (Juni ~46,1 kWh / 2,36 kW · März
~69,2 kWh / 3,28 kW) — die ersten echten Zahlen, an denen der Parser messbar ist. Ein „wähle genau eine
Spalte"-Mapping würde ~44 % des Verbrauchs verlieren (im Test abgesichert).

### Format B — Wechselrichter/ESS-XLSX: `wechselrichter-ess-sys{1,2}-{maerz,juni}-2026.xlsx`

XLSX, Zeitzelle als **String** mit ausgeschriebenem dt. Monatsnamen (`17/März/2026 00:00`), Wertzellen
ebenfalls **String mit Dezimalkomma**. Spalten: Ein-/Ausgangsleistung, Batterielade-/-entladeleistung.
In allen vier Dateien: Batterie lädt/entlädt nie (0), Eingang == Ausgang (reiner PV-Durchlauf). Das ist
**KEIN Netz-Lastgang** — der Parser lehnt es fachlich ab (`error` / `not_a_load_profile`,
„Kein Netz-Lastgang…"), statt einen Lastgang daraus zu konstruieren. Zwei Wechselrichter × zwei
Jahreszeiten = vier Fixtures (robuste Ablehnung über Varianten).

## Neu erzeugen

```
node dev-fixtures/generate-demo-load-profile.mjs           # no-PV-Bäcker (import_only)
node dev-fixtures/generate-demo-pv-profile.mjs             # konsistentes PV-Paar (net_signed + Brutto-PV)
node dev-fixtures/generate-eda-netzbetreiber-fixtures.mjs  # Format A (Split-Timestamp + Mehrspalten)
node dev-fixtures/generate-wechselrichter-ess-fixtures.mjs # Format B (ESS-XLSX, wird abgelehnt)
```

Alle deterministisch (fixer Seed) — erzeugen bei jedem Lauf byte-identische Ausgabe (auch der
SheetJS-XLSX-Write ist byte-stabil).
