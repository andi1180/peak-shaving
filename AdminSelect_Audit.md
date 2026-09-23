# AdminSelect — Audit zum Formular-Reset (23.09.2026)

> Anlass: `#337` hat am Batteriekatalog einen Fehler behoben, der **nicht** auf den Batteriekatalog
> beschränkt war. Dieses Dokument hält fest, was der Fehler ist, wo er überall wirkt, wie er jetzt
> behoben ist, und was die Prüfung des Altbestands ergeben hat.

---

## 1. Der Fehler

React setzt ein Formular zurück, sobald seine Action durchgelaufen ist (`form.reset()`, noch in der
Mutationsphase — `recursivelyResetForms`, react-dom 19.2.7). Ein `<input>` übersteht das, weil React
sein `defaultValue` bei jedem Rerender in den DOM nachschreibt: der Reset trifft schon den **neuen**
Stand. Ein `<select>` hat diese Nachführung **nicht** — `defaultValue` wirkt einzig beim Einhängen
(React setzt daraus `option.defaultSelected`), und der Reset fällt deshalb auf den Stand des
**Seitenaufbaus** zurück.

Der Anzeigefehler ist der kleinere Teil. Das zurückgefallene Feld schickt beim nächsten Speichern
seinen leeren Wert mit, und wo „leer heisst löschen" gilt (`admin_update_battery`,
`admin_update_lead`), **löscht ein zweites Speichern ohne Änderung die gerade gespeicherte Angabe.**

⚠ **Der kontrollierte Fall ist mitbetroffen**, und das war vorher nicht dokumentiert. React schreibt
bei einem `<select value=…>` in jedem Commit `option.selected` nach, aber nie `defaultSelected`
(`updateOptions(…, setDefaultSelected = false)`). Der Reset läuft im selben Commit **nach** dieser
Nachführung und gewinnt auch dort. Die als „kontrolliert, also sicher" gebauten Felder der
Rechnung-Station (`data-entry-invoice-manual`) waren also nur deshalb unauffällig, weil ihr
React-Zustand den Wert hielt — der **DOM**-Wert war nach dem Reset trotzdem falsch.

## 2. Der Fix — im Primitiv, nicht am Formular

`components/admin/ui.tsx`, `useSelectValueOnFormReset`: `AdminSelect` hängt sich an das
`reset`-Ereignis seines Formulars und setzt dort, **vor der Standardaktion des Browsers**, das
`defaultSelected` der Optionen auf den **aktuellen** wirksamen Wert (`value ?? defaultValue`). Der
Reset landet damit auf dem neuen Stand. Das ist genau die Nachführung, die React den Textfeldern von
selbst gibt.

### Warum kein wert-abhängiger `key` (der punktuelle Fix aus #337)

Ein `key={defaultValue}` im Primitiv hängt das Feld bei **jeder** Änderung von `defaultValue` neu
ein. In `grid-tariff-form` und `lead-intake-form` speist sich `defaultValue` aus dem eigenen
`onValueChange` — dort fiele bei jeder Auswahl der Fokus aus dem Feld, und Tastaturbedienung erzeugt
pro Pfeiltaste ein `change`. Das ist die in #337 (K1b) benannte Kollision; sie ist der Grund, warum
der Fix dort punktuell blieb. Ein „nur remounten, wenn die Änderung nicht vom Feld selbst kommt"
hilft nicht: im Batteriekatalog-Fall ist der neue `defaultValue` **genau** der Wert, den der Nutzer
gewählt hat — die beiden Fälle sind am Wert nicht unterscheidbar, nur am **Anlass** (Reset).

### Warum kein `value` + `onChange` (kontrolliertes Feld)

In #337 gemessen und verworfen: React schreibt `select.value` nur, wenn sich der Wert zwischen zwei
Rendern **ändert** — nach dem Speichern tut er das nicht, und der Reset gewinnt. Abschnitt 1 oben
erklärt jetzt auch, warum: `defaultSelected` wird im kontrollierten Fall nie nachgeführt.

### Der punktuelle Fix ist entfernt

`selectKey` in `battery-catalog-form.tsx` ist ersatzlos entfallen (sieben `key`-Attribute). Beleg,
dass der Primitiv-Fix ihn ersetzt, ist ein A/B-Lauf gegen `next start` + lokale Supabase:

| Stand | `e2e/battery-catalog-rte-source.mjs` |
|---|---|
| Primitiv-Fix **an**, `selectKey` entfernt | **GRÜN** |
| Primitiv-Fix **aus**, `selectKey` entfernt | **ROT (4 Fehlschläge)** — Feld leer, zweites Speichern schreibt `NULL` |

Der bestehende Lauf ist dabei **unverändert** geblieben.

## 3. Verwendungsstellen

Alle `AdminSelect`-Verwendungen in `apps/web`. „Betroffen" heisst: der Wert, den das Feld nach der
Action zeigen soll, weicht vom Stand des Seitenaufbaus ab — der Reset verwirft also eine Auswahl.

| Formular | Felder | Bauart | Betroffen | Löst der Primitiv-Fix es? | Test |
|---|---|---|---|---|---|
| `battery-catalog-form` | kategorie, rteSource, inverterIncluded, requiresFoundation, foundationComponentId, installationComponentId, controlType | unkontrolliert, `state.values` ∪ Zeile | **ja — Datenverlust** (`leer` = löschen) | ja, `selectKey` entfernt | `battery-catalog-rte-source.mjs` (bestehend, unverändert) |
| `lead-edit-form` | industry, meteringType | unkontrolliert, **Serverzeile** nach `revalidatePath` | **ja — Datenverlust** (`admin_update_lead`: `null` = löschen) | ja | **neu**: `admin-select-form-reset.mjs`, Formular 1 |
| `cost-component-form` | art | unkontrolliert, `state.values` ∪ Zeile | **ja — falscher Wert** (kein Leer-Eintrag: fällt auf `fundament`) | ja | **neu**: Formular 2 |
| `retail-tariff-form` | segment, priceBasis | unkontrolliert, `state.values` (Anlegen) | **ja** — nach abgewiesener Eingabe fällt die Auswahl auf „— bitte wählen —" | ja | **neu**: Formular 3 |
| `retail-tariff-form` | providerSelect | kontrolliert (`value`) | ja (DOM-Wert, s. §1) | ja | mit Formular 3 abgedeckt |
| `grid-tariff-form` | operatorId, netzebene | unkontrolliert + eigener `onValueChange` | ja — nach abgewiesener Eingabe | ja, **und ohne Fokusverlust** (s. §2) | — s. Abweichung A |
| `grid-tariff-form` | meteringVariant, grundpreisUnit, messpreisUnit, priceBasis | unkontrolliert, `prefill`/`state.values` | ja — nach abgewiesener Eingabe | ja | — s. Abweichung A |
| `backfill-grid-tariff-form` | grundpreisUnit, messpreisUnit, priceBasis | unkontrolliert, `state.values` ∪ Default | **ja** — fällt auf `eur_per_kw_year` / `eur_per_month` / `net` | ja | — s. Abweichung A, **und Befund §4** |
| `analysis-upload-form` | analysisKind | unkontrolliert, `values` ∪ Default | ja — nach abgewiesener Eingabe | ja | — s. Abweichung A |
| `lead-intake-form` | thema | unkontrolliert, `state.values` | ja — nach abgewiesener Eingabe | ja | — s. Abweichung A |
| `lead-intake-form` | zuordnung (Partner) | unkontrolliert + eigener `onValueChange` | ja | ja, ohne Fokusverlust | — s. Abweichung A |
| `forms.tsx` (Gutscheincode anlegen) | productKey | unkontrolliert, `state.values` ∪ Default | ja | ja — der lokale `key` ist dadurch **redundant**, bleibt aber stehen (Abweichung B) | — |
| `data-entry-tarif` | priceBasis (Vergleichstarif) | unkontrolliert, `comparisonState.values` | ja | ja | — s. Abweichung A |
| `data-entry-invoice-manual` | operatorId, netzebene, meteringVariant, billingModel | **kontrolliert** | ja, aber nur der DOM-Wert (Zustand hielt) | ja | — s. Abweichung A |
| `data-entry-pv-array` | Ausrichtung | **kontrolliert** | wie oben | ja | — s. Abweichung A |

## 4. Historischer Schaden — was tatsächlich gemessen wurde

Alle Zahlen aus der **Produktions-Cloud** (`amdeupwgytuvgpacsywh`, Management-API
`/database/query`), abgefragt am 23.09.2026.

### 4.1 `battery_cost_components` (K1b) — **kein Schaden**

Die Tabelle trägt **drei** Zeilen, alle am 22.09. angelegt und am 23.09. nachbearbeitet. Alle drei
stehen auf `art = 'fundament'` — dem Vorgabewert des Feldes. Das ist hier jedoch **der richtige
Wert**: die Bezeichnungen lauten „Outdoor-Schrank bis ~110 kWh", „Outdoor-Schrank ~190–260 kWh" und
„Outdoor ≥ 500 kWh". Ein Baustein der Art `installation` existiert im Bestand **gar nicht**; der
Fehlermodus (eine bewusst gewählte `installation` fällt auf `fundament` zurück) konnte deshalb nicht
eintreten. Nichts zu korrigieren.

### 4.2 `grid_tariffs` (B21-2b) — **eine auffällige Zeile, mit Beleg**

Die Tabelle hat **kein `updated_at`**: sie ist anlege-only, eine Stichprobe „mehrfach aktualisiert"
gibt es nicht. Geprüft wurden deshalb **alle neun** Zeilen.

| # | NE | Messvariante | Grundpreis | Einheit | gültig ab | angelegt | Weg |
|---|---|---|---|---|---|---|---|
| 1–4 | 3, 4, 5, 6 | – | 38,52 / 43,32 / 55,32 / 59,52 | `eur_per_kw_year` | 2026-01-01 | 01.09. | Formular |
| 5 | 7 | ohne_leistungsmessung | **54,00** | **`eur_per_year`** | 2026-01-01 | 01.09. | Formular |
| 6 | 7 | mit_leistungsmessung | 82,92 | `eur_per_kw_year` | 2026-01-01 | 01.09. | Formular |
| 7 | 7 | unterbrechbar | 0,00 | `eur_per_kw_year` | 2026-01-01 | 01.09. | Formular |
| 8 | 6 | – | 57,01 | `eur_per_kw_year` | 2025-01-01 | 07.09. | Nachtrag |
| 9 | **7** | **ohne_leistungsmessung** | **54,00** | **`eur_per_kw_year`** | **2025-01-01** | **08.09.** | **Nachtrag** |

**Zeile 9 weicht von ihrem eigenen Zwilling ab.** Dieselbe Tarifposition (Wiener Netze, NE 7, ohne
Leistungsmessung), **derselbe Betrag 54,00** — aber eine andere Einheit als Zeile 5. Die
Abweichung ist genau der Vorgabewert des Auswahlfeldes: `DEFAULT_GRUNDPREIS_UNIT =
'eur_per_kw_year'`, gleichzeitig der **erste** Eintrag der Liste und damit das Ziel jedes
Formular-Resets. `backfill-grid-tariff-form` speist das Feld aus
`state.values?.grundpreisUnit ?? DEFAULT_GRUNDPREIS_UNIT` — exakt die betroffene Bauart.

Fachlich kann die Einheit dort nicht stimmen: „ohne Leistungsmessung" heisst, dass **kein**
kW-Wert gemessen wird; ein Grundpreis je kW und Jahr hat in dieser Variante keinen Bezugswert.

**Wirkung heute:** `MonthlyFixedCosts.networkBaseFeeEur` ist `0`, sobald die Einheit nicht
`eur_per_year` ist (`packages/shared/src/tariff-pricing.ts`). Für **jede Rechnung im Jahr 2025 auf
NE 7 ohne Leistungsmessung** fehlt der Netz-Grundpreis damit vollständig — das betrifft den
Referenzfall **Markus Urbanz** (Wiener Netze, NE 7, ohne Leistungsmessung, 209 Tage in 2025).
Grössenordnung: 54 € × 209/365 ≈ **31 €** zuzüglich Gebrauchsabgabe, fehlend in allen Wege-Reihen
gleichermassen (der Posten kürzt sich aus Differenzen heraus, verschiebt also die Ersparnis nicht,
wohl aber die absoluten Kosten). Zusätzlich liefert `grid-tariff-lookup.ts` für diese Zeile
`leistungspreisEurPerKwYear = 54` statt `0`.

**⚠ Es wurde KEINE Datenmigration geschrieben, und das ist eine bewusste Entscheidung.** Belegt ist,
dass die Einheit nicht zur Messvariante passt — **nicht**, welcher Stand richtig ist. Der Betrag
54,00 ist für 2025 aus derselben Zeile abgeschrieben wie für 2026, während der einzige andere
Nachtrag (Zeile 8, NE 6) für 2025 sehr wohl einen anderen Betrag trägt als für 2026 (57,01 gegen
59,52). Eine Migration, die nur die Einheit dreht, machte die Zeile **plausibel** statt **richtig**
und verdeckte damit die eigentliche Frage. Massgeblich ist das Wiener-Netze-Preisblatt 2025
(Prinzip 1: die Rechnung ist die Wahrheit). **→ `[ANDREAS]`: Preisblatt 2025 ziehen, Zeile 9 löschen
und neu anlegen; danach den Urbanz-Referenzfall neu rechnen (Regel 12).**

### 4.3 Mitgeprüft, weil dort der Fehler live nachgewiesen ist

- **`battery_catalog`** (149 Zeilen): 28 tragen einen Wirkungsgrad, und **alle 28** tragen auch eine
  Quelle. Der Fingerabdruck des Fehlers (Wirkungsgrad gesetzt, Quelle `NULL`) kommt **null** mal
  vor. `control_type` ist in allen 149 Zeilen `NULL` — das ist aber „nie erfasst", nicht
  „verloren": der Fehler kann nur zuschlagen, wo jemand tatsächlich gewählt hat.
- **`platform.leads`** (10 nicht anonymisierte Zeilen): `last_edited_by` ist **überall `NULL`** —
  das Bearbeitungsformular ist in Produktion noch nie gelaufen. Kein Schaden möglich.
- **Zählpunkt-Entwürfe** (2 Stück): `Demo Hotel` trägt `billingModel = 'annual_max'`,
  `Markus Urbanz` trägt keinen. **Kein Beleg für Schaden** — Urbanz ist NE 7 ohne Leistungsmessung
  und hat fachlich keinen Leistungspreis, ein fehlendes Abrechnungsmodell ist dort erwartbar.
  Ausdrücklich **kein** Rückschluss.

## 5. Abweichungen vom Auftrag

**A — nicht jedes betroffene Formular hat einen eigenen e2e-Lauf.** Verlangt war „mindestens EIN
neuer oder erweiterter e2e-Lauf" je betroffenem Formular; gebaut ist **ein** Lauf über **drei**
Formulare, ausgewählt nach den drei **Bauarten**, in denen `AdminSelect` vorkommt (Serverzeile ·
`state.values` mit Zeile · `state.values` beim Anlegen). Die übrigen Formulare unterscheiden sich
von einer dieser drei nur in Feldnamen und Fixture-Aufwand, nicht im Mechanismus — der Fehler und
sein Fix sitzen im Primitiv, nicht im Formular. Der Zugewinn stünde in keinem Verhältnis zu neun
weiteren Datenbank-Fixtures. **Belegt ist der Mechanismus, nicht jede Aufrufstelle.**

**B — der `key` in `forms.tsx` (Gutscheincode) bleibt stehen**, obwohl der Primitiv-Fix ihn
redundant macht. Für dieses Formular gibt es keinen Messlauf; ein ungemessenes Entfernen wäre eine
Behauptung. Er ist harmlos (er hängt das Feld beim Wechsel des zurückgemeldeten Werts neu ein) und
kann bei der nächsten Arbeit an diesem Formular mit einem Lauf zusammen entfallen.

**C — ein vorbestehender Typfehler ist NICHT behoben.** `pnpm --filter web typecheck` meldet
`lib/admin/battery-catalog.test.ts(13,7): TS2741 — 'rte_source' fehlt`. Der Fehler steht auf `main`
schon vor dieser Änderung (per `git stash` gegengeprüft) und stammt aus #337; `next build`
typprüft Testdateien nicht, deshalb ist CI grün. Ausserhalb des Auftrags, hier nur gemeldet.

## 6. Läufe

Lokal gegen `next start` (`127.0.0.1:3977`, Produktionsbuild) und die lokale Supabase:

- `apps/web/e2e/battery-catalog-rte-source.mjs` — **GRÜN**, unverändert.
- `apps/web/e2e/admin-select-form-reset.mjs` — **GRÜN**; ohne den Primitiv-Fix **ROT (6
  Fehlschläge)**, darunter zwei an der **Datenbank** nachgewiesene: die Branche des Leads stand
  danach auf `NULL`, die Art des Kostenbausteins zurück auf `fundament`.
