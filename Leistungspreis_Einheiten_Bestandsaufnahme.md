# Bestandsaufnahme: Einheit des Leistungspreises gegen das Abrechnungsmodell

> Stand 23.09.2026, `main` @ `8264da3`. Reine Bestandsaufnahme — **kein Code geändert, keine Daten
> geändert, Golden File nicht neu erzeugt.** Anlass: Befund aus #347 (Golden File Bäckerei).
> Keine Aussage zur Abrechnungspraxis in Österreich, nur was der Code tut und was er voraussetzt.

## Status: behoben (23.09.2026)

Der Satz ist in allen Modellen ein Jahressatz. Bei `monthly_max_sum` wird jeder Monat mit Satz/12
abgerechnet, ein Teiljahr mit 12/beobachtete Monate aufs Jahr gebracht. Die Umrechnung steht an
einer Stelle, `packages/shared/src/demand-charge.ts`. Über sie laufen die drei Engine-Stellen aus
Abschnitt 1 (Ist-Kosten, Ersparnis, EAG-Grundpreis). `billedKw` bleibt die Summe.

**Nachtrag zu dieser Bestandsaufnahme:** Sie hat vier Report-Stellen übersehen, die den alten
Zusammenhang „Kosten = Satz × `billedKw`" voraussetzten. Sie sind mitgezogen:

- Satz-Rückrechnung in `apps/website/components/report/report.tsx` (Lastgang-Diagramm)
- Satz-Rückrechnung in `apps/website/lib/pdf-report/basis.ts` (Tabelle „Leistungspreis")
- Satz-Rückrechnung in `apps/website/lib/pdf-report/recommendation.ts` (EAG-Zeile)
- Teiler des Lastgang-Diagramms in `apps/website/components/report/load-chart.tsx`: beim
  Summenmodell 12 statt 1

Ohne diesen Nachzug hätte der PDF-Report der Bäckerei „4,17 €/kW·a" statt 50 gezeigt.

Offen bleibt die Mindestleistung: `minBillableKw` wird beim Summenmodell weiterhin gegen die
Monatssumme verglichen, nicht je Monat.

## Kurzfassung

Jeder Weg, auf dem ein Leistungspreis in den Rechner kommt, liefert ihn als **Jahressatz (€/kW·a)**
und rechnet dafür notfalls ×12 um. Die Engine multipliziert diesen Satz bei `monthly_max_sum` mit
der **Summe** der Monatsspitzen. Das ist nur mit einem **Monatssatz** stimmig. Über ein volles Jahr
ergibt das den Faktor 12 gegenüber `monthly_max_average`: an der Bäckerei aus #347 gemessen
606,56 gegen 50,5467 kW (synthetischer Testlastgang). Der Widerspruch sitzt in der Engine. Die
Oberflächen beschriften einheitlich „je Jahr" und halten sich damit an den Contract.

**Heute betroffen: nichts in Produktion.** Es gibt 0 abgelegte Analysen und 1 Zählpunkt-Entwurf
(Urbanz). Der rechnet zwar mit `monthly_max_sum`, aber mit Leistungspreis 0.

---

## 1. Abrechnungsmodelle und Formeln der Engine

Es gibt drei Modelle (`packages/shared/src/tariff.ts:11-14`). Die Engine bildet je Modell einen
`billedKw` (`packages/engine/src/tariff/strategy.ts`) und multipliziert ihn an **drei** Stellen mit
einem Satz, **ohne Faktor**:

| Modell | `billedKw` (strategy.ts) | Formel |
|---|---|---|
| `annual_max` | :42-44 `positiveAnnualPeakKw` | max(Jahr) |
| `monthly_max_average` | :56-58 `average(coveredMonthlyPeaksKw)` | Σ Monatsspitzen ÷ belegte Monate |
| `monthly_max_sum` | :69-71 `sum(coveredMonthlyPeaksKw)` | Σ Monatsspitzen |

Anschliessend jeweils `max(…, minBillableKw)`. Diese drei Stellen verbrauchen `billedKw`:

1. **Ist-Kosten:** `packages/engine/src/peaks/analyze.ts:21`:
   `leistungspreisCostPerYear = leistungspreisEurPerKwYear * billedKw`
2. **Ersparnis-Zuschreibung:** `packages/engine/src/savings/attribute.ts:371`:
   `(oldBilledKw - newBilledKw) * leistungspreisEurPerKwYear`
3. **EAG-Förderbeitrag Grundpreis:** `packages/engine/src/tariff/eag-demand-charge.ts:74,80`.
   Der Satz muss `eur_per_kw_year` sein (sonst `undefined`) und geht dann als `rate * billedKw` ein.
   Aufgerufen wird die Funktion mit `current.billedKw` (`compute-analysis.ts:315`).

**Welche Satz-Einheit jede Formel stillschweigend voraussetzt** (Ergebnis soll ein Jahresbetrag
sein, weil die Felder `…PerYear` heissen):

| Modell | `billedKw` ist … | Satz muss sein … |
|---|---|---|
| `annual_max` | ein kW-Wert fürs Jahr | €/kW·a |
| `monthly_max_average` | ein kW-Wert fürs Jahr (Mittel) | €/kW·a |
| `monthly_max_sum` | Summe von bis zu 12 Monatswerten („kW·Monate") | **€/kW·Monat** |

### Mini-Rechnung, per Testaufruf gemessen

Das ist ein temporärer Test, nicht committet. Aufgerufen wurden `analyzeCurrentPeaks` und
`eagDemandChargePerYear` aus `packages/engine/src`. Eingaben: synthetischer Lastgang Jan+Feb 2025
(Ortszeit Wien), Grundlast 5 kW, je eine Spitze von **10 kW (Jan)** und **20 kW (Feb)**;
Leistungspreis **100 €/kW·a**; EAG-Grundpreis **5 €/kW·a**; `minBillableKw` 0.

| Modell | `monthlyPeaksKw[0..2]` | `billedKw` | `leistungspreisCostPerYear` | EAG-Grundpreis |
|---|---|---|---|---|
| `annual_max` | [10, 20, 0] | 20 | 2.000 € | 100 € |
| `monthly_max_average` | [10, 20, 0] | 15 | 1.500 € | 75 € |
| `monthly_max_sum` | [10, 20, 0] | **30** | **3.000 €** | **150 €** |

Die Zahlen bestätigen die Formeln aus Frage 1. Bei zwei Monaten liegt die Summe beim Doppelten
des Mittels, bei zwölf belegten Monaten beim Zwölffachen. Den Zwölffach-Fall hat #347 am
Jahreslastgang der Bäckerei gemessen (synthetischer Testlastgang, eingefrorene Eingaben):
`billedKw` 606,56 (`sum`) gegen 50,5467 (`average`), also Quotient 12,000.
(Ein erster Lauf mit Monatsgrenze in UTC statt Ortszeit hatte vier Viertelstunden in den März
geschoben; die Tabelle stammt aus dem korrigierten Lauf.)

## 2. Trägt der Satz eine Einheit?

**Ja, und zwar überall „je Jahr". Nirgends gibt es eine Monatseinheit.**

- **Feldname:** `leistungspreisEurPerKwYear` (`packages/shared/src/tariff.ts:131`). Das Schema selbst
  hat keinen Einheiten-Kommentar und keinen Bezug zum Modell.
- **Contract:** `current.leistungspreisCostPerYear` (`packages/shared/src/analysis-result.ts:280`).
- **Datenbank:** `grid_tariffs.grundpreis_unit` erlaubt nur `'eur_per_kw_year'` und `'eur_per_year'`
  (`supabase/migrations/20260827120000_create_grid_tariffs_and_spot_prices.sql:98-99`).
- **Begründung im Code:** `apps/web/lib/admin/tariff-sheet-scan.ts:18` sagt wörtlich
  „`leistungspreisEurPerKwYear` KODIERT DIE EINHEIT IM FELDNAMEN".
- **Absenz „€/kW·Monat":** Die Suche nach `kW·Monat|kW und Monat|PerKwMonth|per_kw_month` über
  `packages`, `apps` und `supabase` (`.ts/.tsx/.sql`) findet genau **einen** Treffer. Das ist ein
  Beispieltext im Preisblatt-Scan, der Monatsbeträge ausdrücklich dem **Jahres**satz zuordnet
  (s. 4). Positiv-Kontrolle: dieselbe Suche findet diesen einen Treffer tatsächlich, das Muster
  greift also.
- `tariff.ts:40-41` benennt den Faktor 12 im **kW-Wert** („Die beiden Modelle unterscheiden sich
  um den Faktor 12 im abgerechneten kW-Wert"), sagt aber nichts über die Einheit des Satzes.
  `strategy.ts:25-26`: „Alle drei Strategien nehmen einen konstanten `leistungspreisEurPerKwYear`
  an."
- Die Spezifikation (`Pflichtenheft_Kalkulator_MVP.md:213-216`) definiert `billedKw` je Modell,
  aber keine Satz-Einheit je Modell. `Pflichtenheft_Kalkulator_Delta_Tarifoptimierung.md` enthält
  0 Treffer auf `monthly_max`. Positiv-Kontrolle: dieselbe Suche findet dort
  „Leistungspreis"/„billingModel" (z. B. :47, :244).

## 3. Oberflächen

| Stelle | Beschriftung des Satzes | Modell-Vorgabe | Umrechnung? |
|---|---|---|---|
| Öffentlicher Rechner, Schritt „Tarif" | `€/kW·a` (`apps/website/components/flow/step-tariff.tsx:1108`) | `monthly_max_average` (:86); alle drei wählbar (:1128-1132) | keine: der Satz geht unverändert in `TariffParams` (:756) |
| Annahmen-Panel (Ergebnis, öffentlicher Rechner) | Satz dort **nicht** editierbar | Modell umschaltbar (`apps/website/components/report/assumptions-panel.tsx:295-310`) | keine: `{ ...originalTariff, billingModel }` (:232). Der Wechsel `average → sum` behält den Satz, bei zwölf Monaten also Ist-Kosten ×12 |
| B24-Wizard, Rechnungs-Station (Handeingabe) | `€/kW und Jahr` (`apps/web/components/admin/data-entry-invoice-manual.tsx:81`) | `monthly_max_sum` (`DEFAULT_DRAFT_BILLING_MODEL`, `packages/shared/src/tariff.ts:43`; eingesetzt `apps/web/lib/admin/data-entry-actions-rechnung.ts:684`, `invoice-extractions.ts:513`) | keine |
| Wizard, Rechenpfad | — | fehlt `billingModel` im Entwurf → `monthly_max_sum` (`packages/engine/src/tariff/draft-mapping.ts:121-126`) | keine |

Die Netzentgelt-Vorbelegung (beide Apps) übernimmt `grundpreis_amount` nur bei
`eur_per_kw_year` und ohne Umrechnung, egal welches Modell im Formular steht
(`packages/shared/src/grid-tariff-prefill.ts:134-136`, `apps/web/lib/admin/grid-tariff-lookup.ts:122-125`).
Der B11-Tarifkatalog paart seinen einzigen Satz (Wiener Netze NE 3, 38,52 €/kW·a) mit
`monthly_max_average` (`packages/shared/src/tariff-catalog.ts:220-221`). Sein Modell wird aber in
kein Formular geschrieben: `step-tariff.tsx:1014-1020`, und `lookupTariffProfile` entscheidet dort
nur noch über die Sperre (:604-629).

Keine Oberfläche weist darauf hin, dass der Satz beim Summenmodell eine andere Bedeutung hätte.
`BILLING_MODEL_HINTS.monthly_max_sum` („alle zwölf addiert", `tariff.ts:59-64`) beschreibt nur den
kW-Wert.

## 4. Rechnungs-Scan (und Preisblatt-Scan)

- **Einheit, die gelesen wird:** Das Schema verlangt „Euro je kW und JAHR. Steht die Rechnung auf
  einen Monatsbetrag, auf das Jahr umrechnen (×12)" (`packages/shared/src/invoice-scan.ts:382-385`).
  Gleichlautend der System-Prompt: `packages/extractors/src/invoice-scan/extract.ts:168-169`.
- **Modell-Vorschlag:** Eine monatsweise Aufschlüsselung mit addierten Beträgen deutet auf
  `monthly_max_sum` hin (`extract.ts:300-303`). Ist nicht zu erkennen, ob summiert oder gemittelt
  wird, gilt `monthly_max_sum` als Vorgabe (`extract.ts:319-322`).
- **Wo der Wert landet:**
  - Wizard: unverändert in `draft.leistungspreisEurPerKwYear` (`apps/web/lib/admin/invoice-extractions.ts:305`),
    das Modell in `draft.billingModel` (:303/:379).
  - Öffentlicher Rechner: nur der Satz (`step-tariff.tsx:228-230`), das Modell **nicht**.
    Absenz: 0 Treffer auf `billingModel` in `invoice-scan-panel.tsx`. Positiv-Kontrolle:
    7 Treffer auf `rates|leistungspreisEurPerKwYear` in derselben Datei.
- **Folge:** Genau die Rechnungsform, die der Scan als Summenmodell erkennt (Monatszeilen mit
  €/kW-Monatsbetrag), wird zum Jahressatz ×12 und dann in der Engine mit der Monatssumme
  multipliziert.
- **Preisblatt-Scan** (`apps/web/lib/admin/tariff-scan/extract.ts:106`, :192-193): „je kW und
  MONAT … dann ×12". Das Ergebnis ist `eur_per_kw_year` in `grid_tariffs` (s. 5).

## 5. Netzentgelt-Leistungspreis gegen Lieferanten-Leistungspreis

**Getrennt, und es gibt nur einen Leistungspreis-Weg: den Netzbetreiber.**

- Netz: `grid_tariffs.grundpreis_amount` + `grundpreis_unit ∈ {eur_per_kw_year, eur_per_year}`.
  Nur `eur_per_kw_year` wird zum Leistungspreis (`grid-tariff-prefill.ts:134-136`). Im
  Monatsvergleich wird er ausdrücklich **nicht** verteilt (`packages/shared/src/tariff-pricing.ts:70-75`).
- Lieferant: `comparisonSupplierTariffSchema` kennt nur `energyPriceCtPerKwh`,
  `baseFeeEurPerMonth` und `priceBasis` (`packages/shared/src/tariff.ts:118-124`).
  Absenz eines kW-Satzes: 0 Treffer auf `kw|per_kw|PerKw` in `supplier-tariffs.ts` und in
  `…retail_tariffs.sql`. Positiv-Kontrolle: 2 bzw. 6 Treffer auf `ctPerKwh|baseFee` bzw.
  `ct_per_kwh|base_fee`.
- Der **EAG-Förderbeitrag Grundpreis** ist ein zweiter kW-Satz neben dem Leistungspreis
  (`eag-demand-charge.ts:17-18`). Er kommt aus `packages/shared/src/levies.ts`, ist fest
  `eur_per_kw_year` und hängt am **selben** `billedKw`. Er hat dasselbe Problem (s. Messung in 1).

## 6. Reichweite in Produktion

Gemessen am 23.09.2026 über die Management-API (`/database/query`). Rollentreu: Die Admin-Kennung
wurde als `postgres` bestimmt, danach `set local role authenticated` und
`request.jwt.claims.sub = <Admin>`. Gelesen wurde **ausschliesslich über die Admin-Wrapper**
(`admin_list_projects`, `list_metering_points`, `admin_list_analyses`, `admin_get_analysis`).
Kein `service_role`, keine Schreibvorgänge. `current_user` im Lauf: `authenticated`.

| Bestand | Anzahl | `monthly_max_sum` mit Leistungspreis ≠ 0 |
|---|---|---|
| Abgelegte Analysen (`platform.analyses`) | **0** | 0 |
| Projekte | 1 | — |
| Zählpunkt-Entwürfe | **1** (`5aeeae3a-7e9a-4337-923d-869ce4bce833`, Projekt `259155fa-25df-47f9-80b1-cd70e6fa27e6` = Urbanz, Segment privat) | **0** |

- Zur Leere bei den Analysen: `admin_list_analyses` **wirft** ohne Adminrolle (42501). Ein
  `total = 0` ist also eine echte Antwort und kein fehlender Zugriff.
- **Urbanz:** Der Entwurf trägt **weder** `billingModel` **noch** `leistungspreisEurPerKwYear`.
  Positiv-Kontrolle: derselbe Entwurf liefert `minBillableKw`, `meteringVariant =
  ohne_leistungsmessung` und 30 weitere Schlüssel. Daraus folgt im Rechenpfad:
  - Modell `monthly_max_sum` (Vorgabe, `draft-mapping.ts:121-126`).
  - Leistungspreis **0** (`draft-mapping.ts:153-157`, ohne Leistungsmessung).
  - EAG-Grundpreis `undefined`, weil NE 7 ohne Leistungsmessung `eur_per_year` trägt
    (`eag-demand-charge.ts:74`).

  `billedKw` 60,212 aus CLAUDE.md Regel 12 ist damit eine Summe, geht aber mit Satz 0 in keine
  Euro-Zahl ein. **Urbanz ist rechnerisch nicht betroffen.**
- Der öffentliche Rechner legt nichts ab (Prinzip 4). Dort entsteht der Fehler nur im Browser des
  Nutzers, wenn er `monthly_max_sum` wählt oder im Annahmen-Panel darauf umschaltet. Das lässt
  sich nicht zählen.

## 7. Fazit

**(a) Engine-Fehler: ja.** Beleg:

- Die Engine hat eine eigene, feste Einheit: Feldname `…PerKwYear` (`tariff.ts:131`),
  `…CostPerYear` (`analysis-result.ts:280`), `eur_per_kw_year`-Prüfung (`eag-demand-charge.ts:74`).
- Die Formel des Summenmodells passt nur zu €/kW·Monat (`strategy.ts:69-71` × `analyze.ts:21`,
  `attribute.ts:371`, `eag-demand-charge.ts:80`).
- Gemessen: 30 statt 15 kW bei zwei Monaten, 606,56 statt 50,5467 kW bei zwölf. Ist-Kosten,
  Ersparnis und EAG-Grundpreis wachsen um denselben Faktor.
- Beim EAG-Grundpreis gibt es keine Oberfläche dazwischen: Die Einheit ist dort garantiert
  jährlich, und das Ergebnis ist bei `monthly_max_sum` trotzdem ×12.

**(b) Beschriftungs- oder Eingabefehler in der Oberfläche: nein.** Alle Eingabestellen beschriften
den Satz als Jahressatz (3) und rechnen Monatsbeträge ×12 auf das Jahr um (4). Das ist konsistent
mit dem Contract. Zwei Stellen machen den Engine-Fehler aber **erreichbar**:

- Der Wizard und der Scan geben `monthly_max_sum` **als Vorgabe** vor (`tariff.ts:43`,
  `extract.ts:319-322`).
- Das Annahmen-Panel schaltet das Modell um, ohne den Satz anzufassen
  (`assumptions-panel.tsx:232`).

Keine Stelle weist auf die Wechselwirkung hin.

**(c) Nur falsche Kombination in der Golden-Probe: teilweise.** NE 7 „ohne Leistungsmessung"
zusammen mit 50 €/kW·a ist konstruiert, das steht auch in der README. Den Faktor 12 verursacht das
aber **nicht**: Er folgt allein aus `monthly_max_sum` mit einem Jahressatz. Genau diese Kombination
erzeugt der Wizard für jeden Betriebskunden mit Leistungspreis, sobald der Entwurf kein Modell
trägt oder der Scan eines vorschlägt. Die Golden-Probe friert also echtes Engine-Verhalten ein und
ist keine Fehlbedienung. Wird der Fehler behoben, muss sie mit Begründung neu erzeugt werden
(Regel 12).
