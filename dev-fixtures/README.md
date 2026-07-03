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

**Abweichung von der ursprünglich angedachten Spaltenaufteilung:** Der generische Parser
(`packages/engine/src/parser/detect.ts`) erkennt genau **eine** Zeitstempel-Spalte pro Zeile
(kombiniertes Datum+Uhrzeit, z. B. `de_dot`-Format `TT.MM.JJJJ HH:MM`) — ein separates
Spaltenpaar „Datum" + „Uhrzeit" wird von der generischen Erkennung aktuell nicht
zusammengeführt. Damit die Datei tatsächlich über `parseLoadProfile` läuft (statt in
`needs_mapping`/`error` zu enden), verwendet die Demo-Datei einen kombinierten
`Zeitstempel`. Getrenntes Datum/Uhrzeit ist ein plausibles reales Format (siehe OP#4) und
könnte bei Bedarf als generische Erweiterung oder Format-Adapter nachgezogen werden — nicht
Teil dieses Prompts.

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

## Neu erzeugen

```
node dev-fixtures/generate-demo-load-profile.mjs   # no-PV-Bäcker (import_only)
node dev-fixtures/generate-demo-pv-profile.mjs      # konsistentes PV-Paar (net_signed + Brutto-PV)
```

Beide deterministisch (fixer Seed) — erzeugen bei jedem Lauf byte-identische Ausgabe.
