# Pflichtenheft-Delta: Tarif- & Ladeoptimierung im Kalkulator

> **Delta zu `Pflichtenheft_Kalkulator_MVP.md`, kein Ersatz.** Alles, was hier nicht erwähnt wird — insbesondere die gesamte bestehende Peak-Shaving-Engine (§1–§7 des Basisdokuments), Prinzip 1–6, Datenmodell §3.1–§3.11, Report/UI-Grundgerüst — bleibt unverändert gültig. Wer aus diesem Dokument baut, liest **zuerst** `Pflichtenheft_Kalkulator_MVP.md`, **dann** dieses Delta, **dann** `CLAUDE_PEAKSHAVING.md` (Arbeitsregeln, unverändert gültig).
>
> **Entstehung:** Diskussionssession zwischen Andreas und Claude (Advisor-Rolle), direkt im Anschluss an die Diskussion zum DB-gestützten Batteriekatalog. Zwei begleitende Claude-Code-Bestandsaufnahmen (rein lesend, kein Code geändert) sind eingearbeitet — Kurzfassung in **Delta 12**, mit Datei:Zeile-Verweisen.
>
> **Fehlt bewusst noch:** der Bau-Übergabeprompt für Claude Code. Kommt als eigenes Dokument, NACHDEM dieses Delta bestätigt ist.
>
> **Status jedes Punkts hier:** *diskutiert und entschieden*, nicht gebaut. Exakte Feldnamen/Migrationen sind beim Bau-Prompt wie gewohnt gegen den dann aktuellen Code zu verifizieren (Verifikations-Aufwand war bei den letzten beiden Bestandsaufnahmen nicht null — CC hat dabei zweimal Annahmen aus der Diskussion korrigiert).
>
> **Legende:** wie im Basisdokument — `[ANNAHME]` = vor Bau zu bestätigen · `[MARTIN]` = Domänen-Input erforderlich · `[OFFEN]` = echte Entscheidungslücke, nicht nur Detail.

---

## Delta 1 — Zweck-Erweiterung (ergänzt §0)

Der Kalkulator bekommt einen **zweiten, unabhängigen Ersparnis-Hebel** neben Peak Shaving: Ersparnis durch **optimalen Stromtarif + optimales Ladeverhalten**, simuliert gegen echte historische Marktpreise (aWATTar), in Kombination mit der passenden Batterie.

- **Zielgruppen-Erweiterung:** Privatkunden und Betriebe **gleichberechtigt**, nicht mehr primär B2B/RLM. Der bestehende MVP-Fokus auf Gewerbekunden mit Leistungspreis-Exposure bleibt der stärkere kommerzielle Fall, aber die Engine muss ab jetzt auch Kunden **ohne** Leistungspreis-Relevanz sauber bedienen (Mechanismus: Delta 3).
- **Peak Shaving wird optional**, nicht mehr die einzige tragende Säule. Ein Kunde ohne Leistungspreis-Komponente bekommt trotzdem eine vollständige, ehrliche Analyse — nur eben ausschließlich über den Tarif-Hebel.
- **Zugangsmodell weiterhin offen** [OFFEN, s. Delta 14] — möglich, dass der Kalkulator perspektivisch frei zugänglich wird statt limitiert. Nicht danach bauen, nicht davor bauen — das Datenmodell darf diese Entscheidung nicht präjudizieren.
- **Batteriekatalog:** unverändert Baustelle, s. eigenes Delta-Dokument/Diskussion zum Batteriekatalog. Bis Martins echte Daten da sind, bleibt `DEMO_BATTERY_CATALOG` die Quelle, unabhängig von diesem Delta hier.
- **Explizit NICHT Teil dieses Deltas:** aktives Lademanagement/Steuerung (Hardware-Fernsteuerung, Option A/B aus der separaten Ladeoptimierungs-Diskussion), das Produkt „Lade-Wächter". Das wird **eine eigene App**, später. Dieses Delta baut ausschließlich die **Simulation/Analyse** aus — kein Dispatch in Echtzeit, keine Wechselrichter-Anbindung, kein Kundenbetriebszustand.

---

## Delta 2 — Neues Prinzip (ergänzt §1)

**Prinzip 1b — Für den Tarifvergleich gibt es keine Rechnung.** Prinzip 1 („Die Rechnung ist die Wahrheit") gilt unverändert für Ist-Kosten und Netzentgelte. Für den NEUEN Vergleichsfall „was hätte ich mit Batterie + optimiertem Tarif bezahlt" gibt es keine Rechnung, die das belegt — das ist zwingend Simulation gegen **echte historische Marktpreise** (aWATTar, nie ein geschätztes/synthetisches Preisprofil). Eine erfundene Preiskurve wäre hier derselbe Fehler wie ein geschätzter Tarifsatz.

**Prinzip 7 (neu) — Pessimistisch statt optimistisch, wo unsicher.** Wo eine Eingabe unsicher ist (synthetisches Lastprofil, Backtest auf Vergangenheitsdaten, Heuristik statt echtem Optimum), rechnet und zeigt der Kalkulator die **konservativere** Zahl — nie eine geschönte. Das ist kein Rabatt-Faktor auf ansonsten fertige Zahlen (das wäre selbst eine erfundene Zahl, Prinzip 1 verletzt), sondern eine Reihe **konkreter, einzeln begründeter** Modellierungsentscheidungen. Alle Anwendungsfälle in diesem Delta: **Delta 11**.

---

## Delta 3 — `hasLeistungspreis`-Mechanismus (erweitert §3.1, §3.6)

**Kein neues Feld nötig.** Laut CC-Bestandsaufnahme (Delta 12, Punkt 2) ist die reserve-freie Simulation (`cap=∞`, `socFloor≡0`, gebaut für `controlType==='static'` in OP#5) an **genau einer Stelle** gekoppelt: `simulate.ts:84`. Die drei Physik-Primitiven (`searchCaps`, `computeSocFloor`, `runCombinedDispatch`) sind bereits `controlType`-agnostisch.

**Entscheidung:** Bedingung an `simulate.ts:84` erweitern von
```ts
const isStatic = battery.controlType === 'static'
```
auf
```ts
const isStatic = battery.controlType === 'static' || tariffParams.leistungspreisEurPerKwYear === 0
```
`leistungspreisEurPerKwYear = 0` läuft laut Bestandsaufnahme (Delta 12, Punkt 3) bereits heute überall sauber durch — keine ungeschützte Division, Schema erlaubt `0` explizit. `hasLeistungspreis` ist damit **kein persistiertes Feld**, sondern genau dieser Ausdruck, an genau einer Stelle ausgewertet.

> **Stand 30.08.2026 (9b-1):** Die EINE Stelle heisst jetzt `peakShavingBlockers` (`packages/engine/src/simulation/peak-shaving.ts`) und wird von `simulateBattery` (Kappungs-Konfiguration) UND `computeBatterySavings` (Zuschreibung) gelesen — die zweite Stelle war beim Schreiben dieses Deltas übersehen worden, und ohne sie entstünde aus dem reserve-freien Fahrplan eine zufällige Differenz zum ungekappten `billedKw`, die als Ersparnis kreditiert würde. Enthalten war zunächst NUR die zweite Anwendung (`standard_profile`).
>
> **Stand 30.08.2026 (Nachtrag): die HIER beschriebene ERSTE Anwendung (`leistungspreisEurPerKwYear === 0`) ist jetzt ebenfalls gebaut** — als dritter Blocker `no_demand_charge`, an genau derselben einen Stelle. Rechnerisch war sie folgenlos (`(alt − neu) × 0 = 0`); ihre Wirkung liegt in der SIMULATION, die dadurch reserve-frei läuft und die bisher gebundene Kapazität an Eigenverbrauch und Lastverschiebung zurückgibt. ⚠ Genau deshalb muss auch die ZUSCHREIBUNG denselben Zweig nehmen, obwohl ihre Formel schon 0 ergab: derselbe reserve-freie Fahrplan verschiebt `sim.newBilledKw` gegenüber dem ungekappten Wert, und `newBilledKw` ist eine ausgewiesene Report-Zahl — sie dürfte nicht behaupten, die Batterie senke den abgerechneten Leistungswert, wenn gar nicht gekappt wurde. Am echten Demo-Lastgang gemessen (`demo-baeckerei-mit-pv-netzlastgang-2023.csv`, 60 kWh/30 kW dynamisch): ohne Leistungspreis `newBilledKw` = 50,79 kW (ungekappt) und Energie-Töpfe € 2.395,48 — mit Leistungspreis 82,92 €/kW·a `newBilledKw` = 20,79 kW, Spitzenkappung € 2.487,59 und Energie-Töpfe € 1.780,79; die SoC-Trajektorie unterscheidet sich in 17.499 von 35.040 Slots (max |Δ| 39,15 kWh).

**Woher kommt `leistungspreisEurPerKwYear = 0`:** aus der gewählten Netzbetreiber-Tarifvariante „ohne Leistungsmessung" (Delta 5) — dort ist der Grundpreis laut Tarifblatt ein reiner Jahres-Pauschalbetrag, kein €/kW-Wert. Die Variante **ist** der reale Fall hinter dem Flag, kein zusätzliches UI-Element nötig.

**Zweite Anwendung (Pessimismus, s. Delta 11) — GEBAUT am 30.08.2026 (9b-1):** Derselbe Pfad wird auch aktiviert, wenn `loadProfile.source === 'standard_profile'` — unabhängig davon, ob der Kunde nominell leistungsgemessen ist. Ohne echten Lastgang lässt sich eine individuelle Spitze nicht seriös schätzen; der Kalkulator berechnet für diesen Fall keine Leistungspreis-Ersparnis, sondern ausschließlich die Tarif-Ersparnis.

---

## Delta 4 — Engine: kombinierter Zeitfenster-Preis (erweitert §3.5, §3.7)

**IST-Stand (CC-verifiziert, Delta 12 Punkt 1):** `intervalTariffRates()` (`packages/engine/src/simulation/tou.ts`) verarbeitet genau **eine** Preisquellen-Art — ein wanduhr-basiertes Zeitfenster-Schema (`timeOfUseWindows` bzw. `energyPriceNightCtPerKwh`-Fallback), identisch für jeden Tag, ohne Datums- oder Wochentagsbezug. Der Dispatch bekommt nur ein Boolean (`isCheapWindow`), keine Preise. `arbeitspreisNetzCtPerKwh` ist **komplett tot** (Delta 12, Punkt 4) — nirgends gelesen, nur deklariert. `dynamicPriceProfile?: unknown` existiert als `[v2]`-Reservierung, ohne jede Implementierung.

**Entscheidung — zwei Preiskomponenten zu EINEM Intervall-Preis zusammenführen, kein vierter Ersparnis-Topf:**

Netzentgelt (SNAP etc.) wird **nicht** als eigener Posten neben Peak-Shaving/Eigenverbrauch/Lastverschiebung geführt (Prinzip 2 — Doppelzählungsrisiko), sondern in dieselbe Eigenverbrauchs-/Lastverschiebungs-Rechnung eingerechnet, die es heute schon gibt (`attribute.ts`), nur mit einem **kombinierten** ct/kWh-Preis statt Energiepreis allein:

```
effectivePriceCtPerKwh(t) = energyPrice(t) + netzVerbrauchspreis(t)
```

Beide Seiten werden dafür zeitvariabel, nicht nur die Energie-Seite:

- **Energiepreis-Seite:** `timeOfUseWindows`/`energyPriceNightCtPerKwh` bleiben als statischer Fallback bestehen; `dynamicPriceProfile` wird mit echten aWATTar-Zeitstempel/Preis-Paaren befüllt (Delta 7) und hat Vorrang, wenn vorhanden.
- **Netzentgelt-Seite:** `arbeitspreisNetzCtPerKwh` als flacher Wert wird abgelöst durch einen Verweis auf die gewählte Tarifzeile + deren Zeitfenster (Delta 5) — SNAP (und künftig Winter) sind dort keine Sonderfälle, sondern reguläre Fenster derselben Struktur wie `timeOfUseWindows`.

`intervalTariffRates()` wird entsprechend verallgemeinert: Rückgabe bleibt strukturell gleich (`rateCtPerKwh[]`, `isCheapWindow[]`), aber der Preis pro Intervall setzt sich aus beiden Quellen zusammen, bevor der Vergleich gegen den Referenzpreis läuft. **Der Dispatch selbst ändert sich nicht** — weiterhin nur `isCheapWindow` als Boolean an `runCombinedDispatch`, exakt wie heute.

### Nachtrag (29.08.2026, mit B21-3b gebaut) — „nicht berechenbar" gilt SYMMETRISCH

Delta 15 Regel C benennt die Lückenbehandlung nur für die **Spotpreis**-Seite. Beim Bau zeigte sich, dass sie für die **Netzentgelt**-Seite genauso gelten muss, und zwar aus demselben Grund: fehlt für einen Teil des Lastgang-Zeitraums eine gültige Tarifzeile (oder deckt keines ihrer Zeitfenster das Intervall ab), ist der kombinierte Preis `energyPrice(t) + netzVerbrauchspreis(t)` dort **nicht bildbar** — es ist dasselbe Loch in derselben Rechnung. Für den Rest zu rechnen und die Lücke zu überspringen ergäbe eine zu niedrige Vergleichszahl, die niemandem als Fehler auffiele, sondern als Ergebnis.

**Das ist eine Ergänzung, kein Widerspruch zu Delta 15.** Regel B (Untergrenze, dauerhaft, beim Nutzer) und Regel C (Lücke, vorübergehend, bei uns) bleiben unverändert getrennt. Die Netzentgelt-Lücke ist ein **dritter** Zustand mit einer eigenen Ursache: sie ist weder eine Nutzer-Sache noch ein stehengebliebener Cron, sondern ein **fehlender Pflegestand** (ein Preisblatt, das noch niemand eingetragen hat, B21-2b). Sie wird deshalb eigens benannt.

Umgesetzt als eine Angabe mit drei Feldern — `side` (`grid_tariff` / `spot_price`), `kind` (`gap` / `unavailable` / `price_basis`) und den betroffenen Zeitbereichen —, damit die Oberfläche (Delta 9) daran verzweigen kann, ohne eine Meldung zu parsen. Fehlen BEIDE Seiten, wird die Netzentgelt-Seite genannt: sie ist von Hand nachzutragen, während sich eine Spotpreis-Lücke mit dem nächsten Cron-Lauf von selbst schliesst.

**`price_basis` ist der dritte Grund und stammt aus Delta 6:** eine Preisquelle, die nicht netto ist, wird **nicht umgerechnet**, sondern macht den Hebel nicht berechenbar. Eine Umrechnung setzte einen Steuersatz voraus, und einen zu erfinden ist derselbe Fehler wie eine erfundene Tarifzahl (B11).

**Wichtig für die Ergebnistreue:** In allen diesen Fällen fällt die Engine ausdrücklich **nicht** auf das statische Fensterschema zurück. Sie liefert für den Hebel nichts und sagt warum — Peak Shaving und Eigenverbrauch bleiben davon unberührt (gemessen: bit-identisch zu einem Lauf ohne Hebel).

### Nachtrag (02.09.2026) — der Bezugswert der Preisschwelle ist das TAGES-Mittel

Der kombinierte Preis wird seit B21-3b gegen einen Durchschnitt gemessen, nicht mehr gegen `energyPriceCtPerKwh` (s. o.). Dieser Durchschnitt war bis 02.09.2026 das Mittel über den **ganzen Lastgang**; er ist jetzt das Mittel des jeweiligen **Kalendertags** (lokale Wanduhr, dieselbe Gruppierung wie `coveredMonthlyPeaksKw` §3.4/§3.5 — DST-Tage und Schaltjahre fallen dadurch von selbst richtig).

**Grund:** Über eine Jahres-Preiskurve gemessen ist ein Perioden-Mittel kein Ladefenster-Kriterium, sondern ein Saison-Filter — im teuren Winter liegt fast jede Stunde darüber (nichts gilt als günstig, obwohl es auch dort billige Nächte gibt), im billigen Sommer fast jede darunter (alles gilt als günstig, auch die Tagesspitze). Der Speicher zykliert real täglich; der Bezugswert muss deshalb ebenfalls der Tag sein.

**Randfall:** Ein Kalendertag mit weniger als der halben Tagesabdeckung (bei einem 15-min-Gitter: unter 48 von 96 Intervallen — ein Fragment am Anfang oder Ende des Lastgangs) fällt auf das **Perioden-Mittel** zurück, nicht auf 0 und nicht auf den Vortag: das Mittel eines Ausschnitts wäre kein Tagesmittel, und alles darin sähe je nach Ausschnitt willkürlich günstig oder teuer aus.

**Es ist ausdrücklich das Tages-IST, kein kausaler Proxy** (Vortag, gleitendes Fenster). Der übrige Dispatch rechnet ohnehin mit vollem Rückblick (`searchCaps`/`computeSocFloor` sehen das ganze Periodenprofil, §3.6 „Methodische Konsequenz"); ein nur an dieser einen Stelle kausaler Bezugswert wäre halbe Kausalität ohne Wirkung. Der Vorbehalt „Bestmarke mit vollem Rückblick" (§6.2) deckt das ab und gilt unverändert. Rückgabe, Signatur von `runCombinedDispatch` und der statische Fenster-Zweig sind unberührt.

### Nachtrag (02.09.2026) — aus der Schwelle wird eine Tages-Rangfolge

Die Preisschwelle sagt, WELCHE Stunden eines Tages günstig sind. Sie sagt nicht, welche davon die günstigsten sind, die heute noch kommen — und der Dispatch läuft chronologisch und greedy: er füllt die Batterie in den ERSTEN unterdurchschnittlichen Stunden und steht danach voll da, auch wenn drei Stunden später das eigentliche Tagestief folgt. Spiegelbildlich entlädt Schritt 4 bei der ersten Gelegenheit und hat in der teuersten Stunde nichts mehr übrig. Bei zwei Preisstufen (HT/NT) ist das unerheblich; bei 8.760 echt verschiedenen Stundenpreisen ist es der Unterschied zwischen „irgendwann billig geladen" und „am billigsten geladen".

**Gebaut als zwei Schranken auf denselben EINEN Fahrplan** (Ladeobergrenze in Schritt 5, Preis-Untergrenze in Schritt 4, Letztere über `max()` mit der Spitzen-Reserve verrechnet). Der Dispatch behält seine sechs Schritte; die Spitzenkappung und die Spitzenbereitschaft sind ausdrücklich ausgenommen. **Vollständige fachliche Fassung: `Pflichtenheft_Kalkulator_MVP.md` §3.6.2** — dort steht auch die tragende Einschränkung („nur, wenn die Ressource bis dahin nicht wieder beschafft werden kann"), ohne die eine Rangfolge messbar SCHLECHTER wäre als der Stand davor.

**Für dieses Delta relevant:** Die Rangfolge greift ausschliesslich im `pricing`-Zweig, also nur bei einer berechenbaren echten Preiskurve; der statische Fenster-Zweig ist unverändert, und der nicht berechenbare Fall fällt weiterhin auf gar nichts zurück (Regel C). Rückgabe und Signatur von `intervalTariffRates` sind unberührt — die Rangfolge entsteht im Orchestrator `simulateBattery`, weil sie beide Seiten braucht: die Preisreihe UND die Physik des Kandidaten.

**[OFFEN, nicht Teil des Bau-Prompts] LP-Lücke:** Der bestehende Mechanismus ist eine Greedy-Schwellwert-Heuristik, kein echter Optimierer. Bei zwei Preisstufen (HT/NT) unerheblich, bei 8.760 echt unterschiedlichen Stundenpreisen potenziell relevant. Die Studienzahlen (−43 % / 266 €/Jahr Haushalt, LP via scipy/HiGHS) sind **nicht** automatisch das, was diese Engine liefert. Validierung per kurzem, separatem Skript-Spike **nach** diesem Bau, nicht davor — s. Delta 11 und Delta 14 für die Konsequenz (keine Studienzahlen in Kundenkommunikation, bis geklärt).

---

## Delta 5 — Datenmodell: Netzbetreiber-Tarife (DB-basiert)

**Auswahl-Dimensionen, drei echte, eine falsche:**

| Dimension | Art | UI |
|---|---|---|
| Netzbetreiber | echte Auswahl (Adresse-abhängig, 9–10 größte AT-Betreiber, ausgehend von bisher 3 namentlich im Basis-Pflichtenheft) | Dropdown |
| Netzebene | echte Auswahl (aus Rechnung bekannt) | Dropdown |
| Leistungsmessungs-Variante (mit/ohne/unterbrechbar) | echte Auswahl, aber **nur relevant bei den Netzebenen, die sie anbieten** (laut Wiener-Netze-Beispiel: NE7) | Dropdown, kontextabhängig |
| Saison (SNAP, künftig Winter) | **keine Auswahl** — automatisch zeitgesteuert innerhalb der gewählten Tarifzeile | keine UI |

`step-tariff.tsx` hat laut Bestandsaufnahme (Delta 12, Punkt 5) Netzbetreiber- und Netzebene-Select bereits fertig, inkl. „Nicht angeben"-Sentinel. Fehlt: die Leistungsmessungs-Variante als dritte Dimension.

**Schema-Vorschlag** (Tabellen-/Schemanamen bewusst NICHT kalkulator-spezifisch, s. Delta 8 — dieselbe Referenzdaten-Infrastruktur trägt später das Management-Produkt mit):

```sql
-- Basiszeile: ein Tarif-Produkt eines Betreibers
public.grid_tariffs (
  id                    uuid primary key default gen_random_uuid(),
  operator_id           text not null,          -- z.B. 'wiener_netze'
  operator_name         text not null,           -- Anzeigename
  netzebene             smallint not null,        -- 3–7
  metering_variant      text,                     -- 'mit_leistungsmessung' | 'ohne_leistungsmessung' | 'unterbrechbar' | null (NE3–6)
  grundpreis_amount     numeric not null,          -- €/kW/Jahr ODER €/Jahr, je nach unit
  grundpreis_unit       text not null,             -- 'eur_per_kw_year' | 'eur_per_year'
  netzverlust_ct_per_kwh numeric not null,
  price_basis           text not null,             -- 'net' | 'gross', s. Delta 6
  valid_from             date not null,
  valid_until            date,                      -- null = weiterhin gültig
  created_by             text not null,
  created_at             timestamptz not null default now(),
  unique (operator_id, netzebene, metering_variant, valid_from)
)

-- Zeitfenster je Tarifzeile: normal (impliziter Default) + beliebig viele Ausnahmen
public.grid_tariff_rate_windows (
  id                uuid primary key default gen_random_uuid(),
  grid_tariff_id    uuid not null references public.grid_tariffs(id),
  label             text not null,     -- 'normal' | 'snap' | 'winter' | ...
  month_day_from    text,              -- 'MM-DD', null = ganzjährig
  month_day_to      text,
  time_from         time not null,
  time_to           time not null,
  ct_per_kwh        numeric not null
)
```

**Warum eine Kind-Tabelle statt fixer Spalten (`snap_ct_per_kwh` etc.):** Andreas hat explizit einen kommenden Winter-Tarif angekündigt, der heute noch nicht veröffentlicht ist. Fixe Spalten bräuchten für jeden neuen Saisontyp eine neue Migration. Die Kind-Tabelle nimmt beliebig viele Fenster auf, ohne dass sich `grid_tariffs` je wieder ändert.

**Effektiv-datierte Zeilen (`valid_from`/`valid_until`), nicht In-place-Update:** Löst nebenbei die B11-Frage „NE7 verweigert bis Verordnung" ohne Sonderregel — für 2026 existiert eine gültige Zeile, es wird gerechnet; sobald 2027 ansteht und (mangels SNE-T-V-Verordnung) noch keine Zeile existiert, gibt es automatisch keine Berechnungsgrundlage. Kein Spezialfall-Code nötig, reiner Nebeneffekt des Designs.

**„Unterbrechbare Nutzung"** [OFFEN, MARTIN] — vermutlich Nischenfall für die Zielkundschaft, vor dem Bau kurz mit Martin gegenchecken, ob er überhaupt relevant ist. Falls nein: Variante im Enum vorsehen, aber nicht in der UI anbieten.

**Admin-Pflege:** eigenes Admin-UI in `apps/web` (Andreas' Vorschlag, bestätigt) für Netzbetreiber- **und** Stromanbieter-Tarife gemeinsam. Gleiches RLS-/Schema-Muster wie der Batteriekatalog (`public`-Schema, RLS-Select für `anon`+`authenticated`, kein Schreib-Grant für irgendeine Rolle außer über den Admin-Pfad). Reale Migrations-Details (welche Rolle schreibt wie) beim Bau-Prompt festlegen, hier nur die Struktur.

---

## Delta 6 — Brutto/Netto

**Problem, real:** Die eigenen Quellen widersprechen sich bereits — Netzentgelte laut Tarifblatt „exklusive Steuern", aWATTar-Rohpreise ebenfalls netto (bestätigt), der Wien-Energie-Vergleichstarif aus der separaten Ladeoptimierungs-Studie dagegen brutto.

**Entscheidung:** `priceBasis: 'net' | 'gross'` als Pflichtfeld auf jeder Preisquelle (Tarifzeile, Stromanbieter-Tarif, aWATTar-Reihe). Intern wird durchgängig **netto** gerechnet — üblich für den B2B/RLM-Teil ohnehin, und die vorhandene Formel aus der Ladeoptimierungs-Studie (Spotpreis + Aufschlag) × 1,20 USt. zeigt bereits, wie der Sprung auf Brutto am Ende aussieht. USt. kommt ausschließlich für die private, brutto-orientierte Ergebnisdarstellung ganz am Schluss drauf, nie in der Zwischenrechnung.

---

## Delta 7 — aWATTar-Integration

**API-Fakten, verifiziert (Websuche, nicht nur aus der separaten Studien-Session übernommen):** `start`/`end`-Parameter als Epoch-Millisekunden, beliebiger historischer Bereich abfragbar, kein Auth, kostenlos, 100 Abfragen/Tag Fair-Use. Preise kommen ohne USt. (bestätigt Delta 6).

**Design:**
1. **Einmaliger Backfill** der letzten ~12 Monate beim Erstaufsetzen. **⚠ ÜBERHOLT — gebaut mit B21-2a, korrigiert am 28.08.2026:** der Backfill läuft ab einem **festen Anker `2025-01-01T00:00:00Z`** bis heute, nicht rollierend. Ein rollierendes Fenster liess eine Lücke, deren Lage vom Ausführungstag abhing (der Erstlauf begann bei 2025-08-27 und liess Jan–Aug 2025 leer). Der Anker ist zugleich die Untergrenze aus **Delta 15 Regel B**.
2. **Täglicher Cron**, kurz nach 14 Uhr CET/CEST (UTC-Umrechnung beachten, DST-Wechsel — gleiche Sorgfalt wie bei den bestehenden Cron-Jobs B4-1/B4-2), holt den neu veröffentlichten Folgetag.
3. **Tabelle**, Unique-Constraint auf `(provider, ts_start)` für sicheres Upsert:
   ```sql
   public.spot_prices (
     id           uuid primary key default gen_random_uuid(),
     provider     text not null,        -- 'awattar_at', später weitere
     ts_start     timestamptz not null,
     ts_end       timestamptz not null,
     ct_per_kwh   numeric not null,
     price_basis  text not null default 'net',
     fetched_at   timestamptz not null default now(),
     unique (provider, ts_start)
   )
   ```
4. **Cron-Endpunkt in `apps/web`** (`apps/web/app/api/cron/spot-price-sync` o. ä.) — etabliertes Muster seit B4-1/B4-2, auch wenn `apps/website` (Kalkulator) die Daten konsumiert.
5. **Ein Bau, zwei Verbraucher:** dieselbe Tabelle bedient jetzt den Kalkulator (~~rollierendes 12-Monats-Fenster für die Simulation~~ — **präzisiert durch Delta 15 Regel A:** das Fenster ist der Zeitraum des hochgeladenen Lastgangs selbst) und später — ohne Neubau — das Management-Produkt (morgige Preise ab 14 Uhr). Kein Vorgriff auf Management-Funktionalität, nur auf die Datenhaltung (konsistent mit der Entscheidung aus der Supabase-Diskussion: Referenzdaten ja, kundenspezifischer Betriebszustand nein).

**Anbieter-Offenheit:** `provider`-Spalte von Anfang an, auch wenn aktuell nur `awattar_at` befüllt wird — keine Auswahl-UI jetzt, nur der Tag, damit später keine Migration nötig ist.

---

## Delta 8 — Neue Dateneingabepfade

Zwei neue Wege neben dem bestehenden Lastgang-Upload, **komplementär, nicht redundant zueinander:**

**Rechnungs-Scan.** Extrahiert aus der gescannten Jahresrechnung (Stromanbieter + Netzbetreiber): Netzebene, Netzbetreiber, Tarifsätze, Leistungsmessungs-Variante, **Jahresverbrauch**. Liefert **keinen** 15-Minuten-Lastgang — Rechnungen enthalten keine Zeitreihe. Der extrahierte Jahresverbrauch ist der Input für das Standardlastprofil (unten), nicht ein eigenständiger dritter Pfad.

**Abgrenzung zu B8** [wichtig für die Bau-Reihenfolge]: dieselbe Fähigkeit (Rechnung → strukturierte Felder) braucht B8 (Rechnungs-Wächter) später ohnehin, dort aber blockiert auf Martins Prüfregelwerk, weil B8 zusätzlich **urteilt** (Auffälligkeiten). Der Kalkulator braucht nur **Extraktion**, kein Urteil — das ist der unblockierte Teil. Als eigenständiges, schmales Modul bauen (Umfang: die o.g. Felder, nicht mehr), aber so schneiden, dass B8 es später erweitert statt dupliziert. „KI an den Rändern, Determinismus im Kern" gilt auch hier: Extraktion ja, keine Bewertung.

**Standardlastprofil.** Für Kunden ohne echten Lastgang: Jahresverbrauch (aus Rechnungs-Scan oder manueller Eingabe) + Kundenklasse (privat/klein-gewerblich) → skaliertes synthetisches Profil (H0 für Haushalte — Begriff bereits aus der separaten Ladeoptimierungs-Studie bekannt —, passendes G-Profil für Kleingewerbe `[MARTIN, welche Quelle/welches Profilsystem in AT üblich]`). Neuer `LoadProfile.source`-Wert: `'standard_profile'`.

> **Stand 31.08.2026: DELTA 8 IST ABGESCHLOSSEN.** Der Standardlastprofil-Teil ist als **9b-1 gebaut** (H0/Privat), der Rechnungs-Scan als **9b-2a** (Extraktions-Backend) und **9b-2b** (Formular-Verdrahtung). Beide Wege münden auf denselben Generator: der extrahierte Jahresverbrauch geht in `generateStandardLoadProfile`, es gibt keinen dritten Rechenweg. **Offen bleibt allein das G-Profil für Kleingewerbe** (auf Martin blockiert). Details in Delta 9.

**Pessimismus-Konsequenz (Delta 3, zweite Anwendung):** Ein Standardprofil trägt die Tarif-Arbitrage-Rechnung (Tagesform genügt für Durchschnittspreis-Optimierung), aber **nicht** die Leistungspreis-Dimensionierung. Deshalb automatisch `hasLeistungspreis`-Pfad (Delta 3), unabhängig vom nominellen Vertragsstatus des Kunden — keine erfundene Spitzenlast-Ersparnis. Report zeigt ausschließlich die Tarif-Ersparnis, mit sichtbarem Hinweis „für die Leistungspreis-Dimension: echten Lastgang hochladen".

---

## Delta 9 — UI/UX

> **Stand 31.08.2026: Delta 9a und Delta 9b sind ABGESCHLOSSEN — 9b-1 (Standardprofil) am 30.08.2026, 9b-2 (Rechnungs-Scan) am 31.08.2026 in zwei Teilen (2a Extraktions-Backend, 2b Formular-Verdrahtung).** Die Trennlinie zwischen 9a und 9b liegt zwischen der Bedienung des Hebels (9a: Formular, Erklärungen, Ergebnisanzeige) und den zusätzlichen EINSTIEGEN in den Lastgang-Schritt. Innerhalb von 9b ist erneut geteilt, weil die beiden Einstiege nichts miteinander teilen: 9b-1 erzeugt einen Lastgang aus einer Zahl (rein, deterministisch, keine neue Infrastruktur), 9b-2 liest ihn aus einem Dokument (Extraktionsmodul, s. Abgrenzung zu B8 in Delta 8).

**9a — abgeschlossen (B21-3c, 29.08.2026):**

- ✅ **Infobuttons pro Feld/Funktion** mit kurzer Erklärung — bindende Anforderung, insbesondere für Privatkunden. Natürliche Erweiterung von Prinzip 5 (Transparenz), kein neues Prinzip. Umgesetzt als `apps/website/components/ui/info-hint.tsx`; aufklappender Absatz im Textfluss statt Hover-Tooltip (auf einem Touchgerät gibt es kein Hover) und ohne neue Abhängigkeit. **Gesetzt sind sie an den in diesem Abschnitt NEUEN Feldern** — Netzbetreiber, Netzebene, Messvariante, Aktivierungs-Schalter, Ergebniskarte; ein repo-weiter Nachtrag auf alle Bestandsfelder ist bewusst nicht erfolgt.
- ✅ **Schritt 2 (Tarif) erweitert** um die Leistungsmessungs-Variante als dritte Auswahl, kontextabhängig sichtbar (nur bei Netzebenen, die sie anbieten). Sie wird bei den übrigen Netzebenen **gar nicht gerendert**, nicht nur deaktiviert: ein deaktiviertes Feld gäbe es weiterhin, und sein Wert liefe beim nächsten Umbau in die Abfrage — wo `IS NULL` hingehört (B21-1, `nulls not distinct`).
- ✅ **`tarif-nicht-verfuegbar.tsx` überarbeitet:** die Datei unterscheidet jetzt drei Fälle. Die beiden Verweigerungen (B11: Verordnung ausstehend / Preisblatt noch nicht hinterlegt) sind unverändert und sperren weiterhin; neu daneben steht `TarifOhneLeistungsmessung` — **kein Fehler, neutrale Färbung, kein Warteliste-Link, keine Sperre**, und der Leistungspreis wird mit 0 vorbelegt, weil dieser Anschluss den Posten nicht hat.
- ✅ **Ergebnisanzeige des Hebels:** eine eigene Karte neben der Peak-Shaving-Empfehlung. Sie zeigt **entweder** die gerechnete Zahl **oder** den Grund samt betroffenem Zeitraum — nie beides, und im Blocker-Fall ausdrücklich keine Zahl (Delta 15). Sprache durchgehend rückblickend („wäre möglich gewesen"), nie als Zusage (Delta 11). Der Befund reist dafür als Contract-Feld `AnalysisResult.tariffOptimization` statt als Text in `dataQuality.warnings`.

**9b-1 — abgeschlossen (30.08.2026):**

- ✅ **Zweiter, gleichwertiger Startpunkt im Lastgang-Schritt:** „Standardprofil / Verbrauch" neben dem Datei-Upload (`apps/website/components/flow/standard-profile-panel.tsx`, Umschaltung in `step-upload.tsx`). Beide münden auf denselben `LoadProfile`-Contract, nachgelagert verzweigt nichts — bis auf die eine Stelle, an der es verzweigen MUSS (nächster Punkt). Der Datei-Pfad ist mit 0 Zeilen Verhaltensänderung unangetastet.
- ✅ **H0-Generator** (`packages/engine/src/standard-profile/h0.ts`): Jahresverbrauch + Kundenklasse → skaliertes Haushaltsprofil, rein und deterministisch, **ohne jeden Zufall**. Referenzparameter aus dem Methodik-Abschnitt „Lastprofil Haushalt" der Ladeoptimierungs-Simulationsstudie: 10 kWh/Tag Referenzmittel, Winter/Sommer 1,32, Doppelspitze Morgen/Abend, flacherer Wochenendverlauf. Gemessen (3.650 kWh/Jahr): Summe exakt 3.650,000000 kWh, Verhältnis 1,3186, Spitze/Mittel Werktag 2,471 gegen Wochenende 1,972.
- ✅ **Der `hasLeistungspreis`-Pfad wird erzwungen** (Delta 3, zweite Anwendung): `peakShavingBlockers` (`packages/engine/src/simulation/peak-shaving.ts`) ist die EINE Stelle, an der entschieden wird, ob die Spitzenkappung gerechnet und kreditiert wird — von `simulateBattery` und `computeBatterySavings` gemeinsam gelesen, damit Simulation und Zuschreibung nicht getrennt entscheiden können. Live gegengeprüft mit einem Tarif MIT Leistungsmessung: Standardprofil € 0 über alle Kandidaten, echter Lastgang € 2.487,60.
- ✅ **Report-Hinweis** direkt unter der Kern-Kennzahl (nicht in der Datenqualitäts-Box weiter unten — er qualifiziert genau die Zahl darüber): synthetisches Profil, keine gemessene Lastspitze, „für die Leistungspreis-Dimension: echten Lastgang hochladen". Sichtbar am Bildschirm UND im Druck.
- ✅ **Infobuttons** an Jahresverbrauch und Kundenklasse, plus einer zur Einordnung des ganzen Einstiegs (Muster aus 9a).
- ⚠ **Kleingewerbe ist SICHTBAR und deaktiviert**, mit Begründung daneben — nicht versteckt. Der Typ `StandardProfileCustomerClass` führt den Wert, der Generator lehnt ihn mit `no_profile_for_class` ab. **Offen und auf Martin blockiert:** welches G-Profil in Österreich üblich ist (s. Delta 8). Eine aus dem H0 abgeleitete Gewerbekurve wäre eine geratene Zahl mit seriösem Etikett.
- **Zeitraum des erzeugten Profils:** das zuletzt abgeschlossene Kalenderjahr (`standardProfileYear`, `packages/shared/src/analysis-window.ts`). Kein rollierendes Fenster — sonst wäre dieselbe Eingabe an zwei Tagen ein anderes Profil.
- **Kein Analyse-Bündel für diesen Einstieg** (B14-2): es bindet eine Analyse an ihre Ursprungsdatei, und die gibt es hier nicht. PDF und CSV bleiben unverändert verfügbar; die Oberfläche sagt das mit einem eigenen, neutralen Satz statt mit der Fehlermeldung des Datei-Pfads.

**9b-2 — abgeschlossen (31.08.2026, in zwei Teilen):**

- ✅ **9b-2a — Extraktions-Backend** (`packages/shared/src/invoice-scan.ts`, `apps/website/lib/invoice-scan/{ai-client,extract,actions}.ts`): die erste KI-Anbindung des Projekts. Ein Aufruf, ein Empfänger, ein Zweck; die Rechnung wird nirgends gespeichert, und aus der Funktion kommen ausschliesslich die extrahierten Felder. `billingModel`, `timeOfUseWindows` und `benutzungsdauerModel` werden bewusst NICHT extrahiert (eine Rechnung zeigt einen abgerechneten Wert, nicht die Regel dahinter). **Nachbesserung am 31.08.2026:** das JSON-Schema wurde von der API abgewiesen (`type`-Union zusammen mit `enum`), wodurch jeder Scan in `api_error` endete; behoben mit `anyOf`, gemessen gegen die echte API, durch einen Test gepinnt.
- ✅ **9b-2b — Formular-Verdrahtung** (`apps/website/components/flow/invoice-scan-panel.tsx` + `step-upload.tsx`/`step-tariff.tsx`/`calculator.tsx`/`types.ts`): dritter, gleichwertiger Startpunkt „Stromrechnung (PDF)". Der Jahresverbrauch belegt das Feld des 9b-1-Panels vor und läuft durch **denselben** Generator; die Tarifangaben reisen als `TariffPrefill` nach Schritt 2 und belegen dort die Felder vor. Alles bleibt editierbar — der Scan ist ein Abtipp-Ersatz, keine Feststellung.
- ⚠ **Der Datenschutz-Hinweis ist ein EIGENER und steht am Upload**, nicht in einer Fussnote. Die Sätze der beiden anderen Einstiege („wird nicht hochgeladen" / „nicht übertragen") wären hier schlicht unwahr; sie wiederzuverwenden wäre eine falsche Zusage an genau der Stelle, an der jemand eine Datei mit seinem Namen darauf ablegt. Der Block nennt Empfänger, Nicht-Speicherung und Rückgabe und verweist auf die beiden anderen Einstiege als Alternative.
- ⚠ **Nach einem Scan starten die Tariffelder LEER statt auf den Vorgabewerten** — gemessen und nicht ausgedacht: liest der Scan den Arbeitspreis nicht (bei einem Flex-Tarif mit dreizehn Monatspreisen der richtige Ausgang), stünde dort sonst weiterhin die 25 aus der Vorbelegung, und der Nutzer, dem eine Zeile darüber „Rechnung gelesen" gemeldet wurde, hält sie für seine Zahl. Stehen bleiben darf nur, was einen NENNBAREN Grund hat: die B11-Katalog-Vorbelegung (mit sichtbarer Herkunftszeile) und die 0 bei „ohne Leistungsmessung" (mit eigenem Hinweis).
- **`overriddenFields` musste nicht mitgeschrieben werden.** Die Vorbefüllung läuft durch dieselbe reine Funktion wie die Auswahl von Hand (`catalogPrefill`), setzt also auch `selection` — und `buildTariffSourceRef` leitet die Überschreibungen daraus ab. Ein aus der Rechnung gelesener Satz, der vom Katalog abweicht, erscheint dadurch von selbst als überschrieben, was er ja auch ist.
- **Abgrenzung zu B8** (Extraktion ja, kein Urteil): s. Delta 8.
- ✅ **Nachbesserung 31.08.2026 — Mehrfach-Zeitraum-Regel.** Weist eine Rechnung denselben Posten mit mehreren Sätzen für mehrere Gültigkeitszeiträume aus, gilt der Wert des **zuletzt endenden Abschnitts** — nicht `null`, nicht der erste, nicht der grösste, kein Durchschnitt. Dazu zwei Regeln aus derselben Messreihe (an der ROHEN Modellantwort ermittelt): Gutschriften werden ohne **Vorzeichen** eingetragen (das übernommene Minuszeichen der Einspeisevergütung liess `parseInvoiceExtraction` den Wert verwerfen — es sah aus wie „mal erkannt", war aber „einmal weggeworfen"), und `arbeitspreisNetzCtPerKwh` ist ausdrücklich auf **bezogene** Energie eingegrenzt (die Zeile „(Rest-)Einspeisung Erzeuger … 0,00 ct/kWh" landete sonst als Netzentgelt von 0 in der Rechnung). Gemessen: synthetische Mehrfach-Zeitraum-Rechnung und beide echten Kundenrechnungen, **alle sechs Zahlenfelder über drei Läufe bit-identisch**.
- ⚠ **Offen geblieben:** **`meteringVariant`** ist unbeständig (ein von drei Läufen `null` statt `ohne_leistungsmessung`) — ein Urteilsfeld, keine Zeitraum-Frage, mit spürbarer Folge: die Variante entscheidet, ob die B11-Sperre für Netzebene 7 greift. Braucht eine Benennungs-Regel und eine eigene Messreihe. Ein **variabler Tarif** liefert unter der neuen Regel den letzten Monat (beabsichtigt; ein Jahresmittel wäre eine gerechnete Zahl) — ob das einen eigenen Hinweis braucht, ist offen. Ebenfalls ohne Ziel: `rates.arbeitspreisNetzCtPerKwh` — der Netznutzungs-Arbeitspreis hat in Schritt 2 kein Feld, er kommt seit B21-3b aus `public.grid_tariffs`.
- **Delta 16 (PDF-Report)** ist **vollständig gebaut**: 16a (Deckblatt, Methodik-Kapitel, Druck-Layout) am 29.08.2026, **16b (Name/Firma-Gate + Lead-Schreibpfad) am 30.08.2026** — eigener Abschnitt unten.

---

## Delta 10 — Admin-UI Tarifdaten (ergänzt Delta 5)

Ein gemeinsames Admin-UI in `apps/web` für Netzbetreiber- **und** Stromanbieter-Tarife, analog zum Batteriekatalog-Pflegeweg. Effektiv-datierte Zeilen (Delta 5), keine In-place-Überschreibung. Für Analysen selbst ohnehin folgenlos (Werte werden bei Berechnung kopiert, nie referenziert — dieselbe Regel wie beim Batteriekatalog und bei B11/B14). Gleiche Migrations-Runde wie der Batteriekatalog ist naheliegend, aber keine Voraussetzung.

---

## Delta 11 — Prinzip 7 konkret: alle Anwendungsfälle

| Fall | Konkrete Entscheidung |
|---|---|
| Backtest auf aWATTar-Vergangenheitsdaten | Report-Sprache zwingend retrospektiv („wäre möglich gewesen"), nie als Zusage für die Zukunft formuliert — UI-Copy-Anforderung, nicht nur Verständnisfrage. |
| Heuristik statt echtem LP-Optimum | Kalkulator zeigt ausschließlich, was er selbst berechnet — nie die Studienzahlen (−43 %/266 €) als Versprechen. Diese Zahlen sind Referenz für die interne LP-Gap-Validierung (Delta 4), keine Marketingaussage, bis diese Validierung steht. |
| Standardlastprofil + Leistungspreis | Keine geschätzte Spitzenlast-Ersparnis (Delta 3/8) — Leistungspreis-Dimension bleibt bei echtem Lastgang. |
| Batterie-Degradation über den ROI-Horizont | **[OFFEN, angrenzend, nicht Teil dieses Deltas]** Die bestehende Engine nimmt für den vollen 10-Jahres-Horizont konstante `usableCapacityKwh`/`roundTripEfficiency` an — ein bereits vor diesem Delta bestehender, nicht durch dieses Delta verursachter Optimismus. Keine erfundene Degradationskurve nachbauen (Prinzip 1). Für jetzt: als Vereinfachung im Report kennzeichnen, falls das dort noch nicht steht — echte Modellierung ist ein eigener, späterer Punkt. |

---

## Delta 12 — Verifizierter IST-Stand (aus zwei CC-Bestandsaufnahmen, rein lesend)

Kompakt, mit Fundstellen — bei Bedarf vor dem Bau gegen den dann aktuellen Code erneut prüfen, beide Berichte sind vom Diskussionszeitpunkt.

1. **`intervalTariffRates()`** — `packages/engine/src/simulation/tou.ts` (91 Zeilen). Verarbeitet genau eine Preisquellen-Art (Zeitfenster, wanduhr-basiert). `dynamicPriceProfile` im Typ (`packages/shared/src/tariff.ts:46`) ohne jeden Konsumenten. Dispatch bekommt nur `isCheapWindow`-Boolean, nie Preise selbst.
2. **Reserve-freie Simulation** — `simulate.ts:84-97`, Kopplung an `controlType==='static'` an genau einer Stelle. Physik-Primitiven `controlType`-agnostisch.
3. **`billedKw()`/Leistungspreis=0`** — `packages/engine/src/tariff/strategy.ts`. Läuft überall sauber durch, keine ungeschützte Division; vollständige Fundstellenliste im CC-Bericht vom [Diskussionsdatum].
4. **`arbeitspreisNetzCtPerKwh`** — tot, zwei Fundstellen repoweit (Typ-Deklaration + Pflichtenheft-Kommentar), null Lesezugriffe.
5. **`step-tariff.tsx`** — größte Flow-Datei, Netzbetreiber-/Netzebene-Select bereits vorhanden inkl. „Nicht angeben"-Sentinel. `tarif-nicht-verfuegbar.tsx` bisher reiner Verweigerungstext.
6. **CSV-Parser** — generische Heuristik, Adapter-Registry **leer**, kein einziger Betreiber-/Wechselrichtername im ausführbaren Code. 9–10 statt 3 Betreiber ist damit **kein** Parser-Skalierungsproblem.
7. **Batteriekatalog-Bestandsaufnahme** (separates Delta-Thema, hier nur als Kontext): `apps/website` hat heute **keinerlei** Supabase-Anbindung. Kein Funktions-Grant an `anon` existiert im gesamten Repo — einziger anon-lesbarer Pfad ist direkter RLS-Select (`monitor.current_tariffs`-Muster), kein RPC-Wrapper. Exponierte Schemas: `public, graphql_public, monitor`. Für Delta 5/7 heißt das: `grid_tariffs`, `grid_tariff_rate_windows`, `spot_prices` gehören nach `public` mit RLS-Select für `anon`+`authenticated`, kein RPC-Muster.

---

## Delta 13 — Explizit NICHT Teil dieses Deltas

- Aktives Lademanagement/Steuerung, Hardware-Fernzugriff, Option A/B (eigene App, später, eigenes Pflichtenheft)
- Batteriekatalog-Migration selbst (eigener Diskussionsstrang, eigenständig fortzuführen)
- B8 (Rechnungs-Wächter) als vollständiges Produkt — nur die schmale Extraktions-Fähigkeit wird hier vorgezogen
- Mandantenfähigkeit (B13) — unverändert zurückgestellt
- Zugangsmodell-Entscheidung (frei vs. limitiert)

---

## Delta 14 — Offene Punkte (§8-Stil)

| # | Punkt | Owner | Blockiert |
|---|---|---|---|
| 1 | LP-Heuristik-Gap: reicht die bestehende Greedy-Logik nahe genug ans LP-Optimum, oder braucht es einen Lookahead-Mechanismus (DP, rein TS, kein externer Solver)? | Andreas/Claude, Validierungs-Spike nach dem Bau | Verwendung der Studienzahlen in Kundenkommunikation |
| 2 | Zugangsmodell (frei/limitiert) | Andreas/Martin | Entitlement-UI-Details, nicht das Datenmodell |
| 3 | „Unterbrechbare Nutzung" — relevant für die Zielkundschaft? | Martin | UI-Umfang Delta 5 |
| 4 | Standardprofil-Quelle für Kleingewerbe (welches G-Profil-System in AT) | Martin | Delta 8 |
| 5 | Winter-Tarif — noch nicht veröffentlicht | extern (Netzbetreiber) | Delta 5, Schema ist bereits vorbereitet |
| 6 | Batterie-Degradation im ROI-Horizont nicht modelliert | — | vorerst nur Report-Hinweis, echte Lösung später |
| 7 | Batteriekatalog-Daten von Martin | Martin | wie bisher, unabhängig von diesem Delta |
| 8 | ~~**Ort der Regel-B-Prüfung** (Delta 15): Parser (`parseLoadProfile`) oder Upload-Schritt (`apps/website`)? Und was geschieht mit den Demo-/Test-Lastgängen VOR dem Anker~~ **ERLEDIGT mit B21-3a (28.08.2026)** — s. Entscheidung unter der Tabelle | Andreas/Claude Code | — |
| 9 | **Schwellenwert „grosse Datenlücke"** — ab wie vielen zusammenhängend interpolierten Viertelstunden weist der Report eine Lücke eigens aus? Vorläufig gesetzt auf **2.688 Slots = 4 Wochen** (`LARGE_GAP_SLOTS_THRESHOLD`, `apps/website/lib/constants.ts`) | Martin | nichts — der Hinweis ist gebaut, offen ist nur seine Auslöseschwelle |

**Zu Punkt 9 — was gebaut ist und was Martin entscheidet (30.08.2026):**

Der Contract trägt seit dem Nachtrag zu Delta 14 ein Feld `dataQuality.largestGapSlots` — die **längste zusammenhängend interpolierte** Lücke in 15-min-Slots, neben der bereits geführten Summe `gapsInterpolated`. Der Report zieht daraus einen **eigenen** Hinweissatz, ausdrücklich nicht den Teiljahres-Satz: dort FEHLT ein Zeitraum (`coveredMonths < 12`), hier sieht der Zeitraum vollständig aus und hat trotzdem keine Substanz. **Am realen Fall gemessen, und genau das ist die Begründung für den eigenen Satz:** ein Lastgang mit einer 156-Tage-Lücke mitten im Jahr meldet `coveredMonths = 12` — die bestehende Warnung schweigt bei ihm vollständig.

**Offen ist allein die Zahl.** Welche Lücke einen Lastgang unbrauchbar macht, hängt am Abrechnungsmodell: bei `monthly_*` kann ein einziger fehlender Monat die Mittelung tragen, bei `annual_max` genügt die eine Woche, in der die Jahresspitze lag. Gesetzt sind vier Wochen, weil das die kleinste Lücke ist, die unter **jedem** der geführten Modelle sicher wehtut — eine kleinere Schwelle machte den Hinweis zur Dauerbegleitung und damit wertlos. Der Wert steht an genau **einer** Stelle und ist eine Zeile Änderung; die Auswertung (`showLargeGapWarning` in `report.tsx`) und die Zahl selbst (aus dem Parser) bleiben davon unberührt.

**Zu Punkt 8 — die getroffene Entscheidung (B21-3a, 28.08.2026):**

1. **Die Prüfung sitzt im UPLOAD-SCHRITT**, nicht im Parser: `apps/website/components/flow/step-upload.tsx`, Funktion `rejectIfBeforeAnchor`, aufgerufen in **beiden** Parse-Pfaden (stiller Pfad UND Mehrspalten-Bestätigung). Begründung: Der Parser beantwortet „lässt sich diese Datei lesen?", nicht „wollen wir mit diesem Zeitraum rechnen?" — Letzteres ist eine Produktentscheidung, die sich mit dem Datenbestand verschiebt. Zudem bleiben so die vier Engine-Testdateien mit 2023er-Fixtures unberührt.
2. **`parseLoadProfile` trägt einen Kommentar**, der die Abwesenheit der Prüfung als Entscheidung ausweist und hierher verweist — damit niemand sie später als vergessene Zeile „nachträgt".
3. **Die Demo-Lastgänge gibt es jetzt in ZWEI Jahrgängen.** Die Generatoren nehmen ein `--year`; Vorgabe ist 2025. Die 2023er-Dateien bleiben unverändert liegen (Regressionsgrundlage) und sind mit `--year 2023` byte-identisch reproduzierbar — nachgemessen. Einzelheiten und die Referenzwerte beider Jahrgänge: `dev-fixtures/README.md`.
4. **⚠ Regel B prüft den KALENDERTAG in der Zeitzone des Lastgangs, nicht den UTC-Zeitpunkt.** Ein österreichischer Kalenderjahr-2025-Export beginnt `01.01.2025 00:00` Ortszeit = `2024-12-31T23:00:00Z`, also eine Stunde VOR dem Anker; gegen den Zeitpunkt geprüft würde ausgerechnet der Regelfall abgelehnt, für den die Regel gemacht ist. Delta 15 nennt die Grenze als Datum — genau so ist sie umgesetzt (`SPOT_PRICE_ANCHOR_DATE` in `packages/shared/src/analysis-window.ts`).
5. **⚠ OFFEN GEBLIEBEN, für B21-3b:** Die erste Stunde eines solchen Lastgangs hat deshalb keinen Spotpreis (gemessen: `min(ts_start)` in der Cloud ist exakt `2025-01-01T00:00:00Z`). Das ist **keine** betriebliche Lücke im Sinn von Regel C, sondern eine systematische Kante des Ankers: sie trifft jeden Kalenderjahr-2025-Lastgang und schliesst sich nicht von selbst. Wer den Preisbereich verdrahtet, muss sie ausdrücklich behandeln — Backfill-Anker einen Tag vorziehen (dann wandern **beide** Zahlen) oder den Abfragebereich bewusst auf den Anker kappen. Sie als gewöhnliche Regel-C-Lücke durchlaufen zu lassen hiesse, für jeden solchen Lastgang den ganzen Vergleich als nicht berechenbar auszuweisen.

---

## Delta 15 — Zeitfenster-Regeln für den aWATTar-Vergleich (ergänzt Delta 4)

**Entstehung:** aus der Bau-Nachbereitung von B21-2a/b, anhand eines konkreten Beispiels (Lastgang Juni–Juni) geklärt. Ergänzt Delta 4 um drei Regeln, die dort bisher unausgesprochen blieben. **Status: entschieden, nicht gebaut** — wie das übrige Delta.

### Regel A — Zeitfenster-Symmetrie

Der aWATTar-Vergleich (`dynamicPriceProfile`, Delta 4/7) verwendet für eine gegebene Analyse **exakt den Zeitraum, den der hochgeladene Lastgang selbst abdeckt** — dessen frühesten bis spätesten Zeitstempel, **nicht** ein festes Kalenderjahr und **nicht** „die letzten 12 Monate ab heute".

Das erweitert **Prinzip 1** („Die Rechnung ist die Wahrheit") auf die Vergleichsseite: beide Seiten der Analyse — Ist-Kosten aus der Netzrechnung, Vergleichskosten aus aWATTar — beziehen sich auf **dieselbe echte Zeitscheibe**, ohne Versatz. Ein Lastgang Juni 2025 – Juni 2026 gegen Kalenderjahr-2025-Preise gerechnet wäre keine Ungenauigkeit, sondern eine Antwort auf eine andere Frage als die gestellte.

**Präzisiert Delta 7 Punkt 5** („rollierendes 12-Monats-Fenster für die Simulation") — das Fenster der Simulation ist der Lastgang, nicht der Kalender. Der Backfill (Delta 7 Punkt 1) füllt weiterhin einen festen Bereich; das ist die Vorratshaltung, nicht das Analysefenster.

### Regel B — Untergrenze

Lastgänge, deren Beginn **vor dem 1.1.2025** liegt, werden **beim Upload abgelehnt** — mit einer konkreten Meldung, nicht erst später in der Pipeline an fehlenden Preisdaten scheiternd.

**1.1.2025 ist der harte Anker:** der früheste Zeitpunkt, für den `public.spot_prices` geführt wird (Backfill-Nachtrag zu B21-2a, 28.08.2026 — `BACKFILL_ANCHOR_ISO` in `apps/web/scripts/backfill-spot-prices.mjs`, `DEPLOYMENT.md` §1k), und zugleich die bewusst gesetzte Untergrenze dessen, was der Kalkulator als Lastgang akzeptiert. Die beiden Zahlen sind dieselbe Zahl und dürfen nicht auseinanderlaufen.

**⚠ Beim Bau mitzudenken — gemessen am 28.08.2026, nicht abgeleitet:** Der eigene Bestand liegt heute **unterhalb** dieses Ankers.

| Datei / Fundstelle | Zeitraum | wird über `parseLoadProfile` gelesen |
|---|---|---|
| `dev-fixtures/demo-baeckerei-lastgang-2023.csv` | 01.01.2023 – 31.12.2023 | ja (`simulation/simulate.test.ts`, `recommendation/rank.test.ts`) |
| `dev-fixtures/demo-baeckerei-mit-pv-netzlastgang-2023.csv` + `…-pv-erzeugung-2023.csv` | 01.01.2023 – 31.12.2023 | ja (`simulation/pv-chain.test.ts`) |
| `packages/engine/src/fixtures/profiles.ts` (§3.11-Suite) | ab `2024-02-01T00:00:00Z` | nein — im Code konstruiert, kein Upload |

Daraus folgt die offene Frage in Delta 14 Punkt 8, **nicht** eine hier vorweggenommene Antwort: Sitzt die Prüfung **im Parser**, werden vier bestehende, heute grüne Engine-Testdateien rot und der Demo-Lastgang des öffentlichen Rechners unbrauchbar. Sitzt sie **im Upload-Schritt** (`apps/website`), bleiben Engine und Tests unberührt, aber der Demo-Lastgang im Browser wird abgewiesen — er müsste dann auf einen Zeitraum ab 2025 neu erzeugt werden (die Generatoren in `dev-fixtures/` sind deterministisch, das ist Arbeit, keine Hürde). **Die Regel steht; wo sie greift und was mit den Fixtures geschieht, entscheidet der Bau-Prompt.**

### Regel C — Lückenbehandlung

Fehlen für einen Teil des angeforderten Zeitraums Preisdaten in `spot_prices` (ein verpasster Cron-Tag, eine künftige Störung), wird **nicht interpoliert und nicht übersprungen**. Der aWATTar-Vergleichsteil der betroffenen Analyse wird **ausdrücklich als nicht berechenbar gekennzeichnet**, nicht mit einer still unvollständigen Zahl beantwortet.

Dieselbe Haltung wie bei **Netzebene 7** (B11: verweigert die Berechnung, statt vor der Tarifverordnung zu schätzen) — hier auf **betriebliche** Datenlücken übertragen, nicht nur auf regulatorische. Die Begründung ist in beiden Fällen dieselbe: eine zu niedrig ausgewiesene Vergleichszahl fällt niemandem als Fehler auf, sondern als Ergebnis.

### Zwei Fehlerarten, zwei Meldungen — nicht derselbe Codepfad

**Regel B prüft eine feste Grenze** (ein Datum, vor dem grundsätzlich nichts geführt wird), **Regel C eine betriebliche Unvollständigkeit** (eine Lücke innerhalb eines an sich gültigen Zeitraums). Sie sind verschiedene Zustände mit verschiedenen Konsequenzen: B ist dauerhaft und liegt beim Nutzer (anderer Lastgang), C ist vorübergehend und liegt bei uns (der nächste Sync schliesst sie). In einen gemeinsamen „Preisdaten fehlen"-Pfad zusammengelegt, bekäme der Nutzer für einen behebbaren Betriebszustand die Meldung einer dauerhaften Ablehnung — und niemand sähe an der Meldung, dass ein Cron stehengeblieben ist.

---

## Delta 16 — Erweiterter PDF-Report mit Name/Firma-Gate (ergänzt §6.2, §5.1, §7a.1(c))

> **✅ ABGESCHLOSSEN. 16a am 29.08.2026, 16b am 30.08.2026.** Die Trennlinie lag zwischen dem DOKUMENT und dem GATE. **16a:** Deckblatt, Methodik-/Vorbehalte-Kapitel, Seitenumbrüche und Druck-Typografie — reines Print-CSS in `apps/website`, ohne eine Zeile Datenbank. **16b:** das Name/Firma-Gate samt Lead-Schreibpfad — zwei Migrationen, ein eigener Herkunftsschlüssel, ein fünfter Einwilligungszweck und `apps/website`s erster Server-Kontext. Die beiden berührten einander an genau einer Stelle: der `customer`-Prop von `PrintCover`, die jetzt gefüllt wird. Handover mit den Messwerten: `CLAUDE.md`, Einträge „GEBAUT: Delta 16a" und „GEBAUT: Delta 16b".
>
> **Vier Befunde aus dem Bau von 16b, die die Entscheidung unten präzisieren:**
>
> 1. **Der Zweck ist ein NEUER Enum-Wert `offer_contact`, nicht `result_delivery`.** Dessen geseedeter Wortlaut (B1-1) lautet „Ich möchte mein Rechenergebnis per E-Mail zugeschickt bekommen. Die E-Mail-Adresse wird ausschließlich für diese Zusendung verwendet" — beides ist hier falsch: Entscheidung 1 schliesst jeden Mail-Anhang aus, und „ausschliesslich für diese Zusendung" verböte genau die Kontaktaufnahme, um die es geht. §5.1 benennt die Zweckbindung dagegen wörtlich („Kontaktaufnahme durch COOLiN bzw. den Fachpartner"), und dafür gab es keinen Wert. Zwei Migrationen, weil `alter type … add value` in derselben Transaktion nicht benutzbar ist (55P04, in B18-6 gemessen).
> 2. **Das Gate erhebt zusätzlich die E-Mail-Adresse.** `platform.leads.email` ist `not null` — ein Lead ohne Adresse ist strukturell unmöglich. §5.1 führt sie ohnehin als Pflichtfeld.
> 3. **„Funktion/Rolle im Unternehmen" (§5.1) wird NICHT erhoben.** Es gibt dafür weder eine Spalte in `platform.leads` noch einen Parameter in `capture_lead`. Erhoben und verworfen wäre es eine Requisite (der alte Stub `lead-dialog.tsx` tut bis heute genau das). Offen, sobald jemand die Spalte nachträgt.
> 4. **Der Herkunftsschlüssel `rechner-report` steht in `LEAD_SOURCE_KEYS_WITHOUT_FORM`, nicht in `LEAD_CAPTURE_FORM_KEYS`.** Sonst liesse sich über den generischen, öffentlichen Erfassungs-Endpunkt von coolin.at ein Lead anlegen, der einen heruntergeladenen Report behauptet, den es nie gab — dieselbe Gefahr wie bei `partner-empfehlung` (B16-2) und `telefonanfrage` (B19).

Basis existiert bereits: `window.print()` gegen ein Print-Stylesheet (`step-result.tsx`, U2 Prompt D) erfüllt §6.2s PDF-Export-Anforderung ohne Bibliothek. „Erweiterter Report" baut auf diesem Weg auf, ersetzt ihn nicht.

**Entscheidung 1 — Rendering:** `window.print()` bleibt der Weg, **kein serverseitiges PDF**. Begründung: ein Chart-reicher Report bräuchte `dispatchTrace` serverseitig — eine deutlich grössere Prinzip-4-Ausnahme, als ursprünglich angenommen. Die beiden Alternativen (Headless-Browser; zweite Chart-Implementierung) bringen entweder neue Infrastruktur oder ein Divergenzrisiko, das dieses Projekt sonst konsequent vermeidet. **Konsequenz: kein Mail-Anhang möglich** (kein serverseitig erzeugtes Artefakt) — der Kunde lädt selbst herunter, wie heute schon.

**Entscheidung 2 — Name/Firma-Gate:** echte **Lead-Erfassung**, konsentgebunden, kein reines Personalisierungsfeld. Fliesst in dieselbe Infrastruktur wie §5.1 (`platform.leads`/`platform.consents`, `public.capture_lead`, `consent_texts` serverseitig aufgelöst) — nicht als neue Parallel-Mechanik. Da diese Infrastruktur heute nur aus `apps/web` erreichbar ist, ist das Schreiben selbst **`apps/website`s erster Server-Kontakt überhaupt**; eigener Herkunftsschlüssel in `platform.lead_sources` nötig.

**Explizit draussen:** Partner-/White-Label-Branding (MVP §7 stuft das selbst als `[v2]` ein, keine Daten dafür vorhanden) — der Report trägt COOLiNs eigene Marke.

**Inhalt/Umfang des „erweiterten" Reports** ist mit 16a entschieden und gebaut: Deckblatt, Methodik-/Vorbehalte-Kapitel, Print-Layout. Der dort offene Bezug auf `CLAUDE.md` Punkt d aus dem B21-3c-Handover ist aufgelöst — und der Punkt war ungenau: die Blocker-Karte der Tarifoptimierung druckte immer schon vollständig mit; verborgen war die Erklärung des BERECHENBAREN Falls, die seit 16a über ein `printExplanation`-Opt-in mitdruckt.

---

## Delta 17 — Flexible Eingabe: beliebig viele Unterlagen mit freier Bezeichnung (ergänzt Delta 8, Delta 9)

> **✅ VOLLSTÄNDIG GEBAUT am 01.09.2026.** **Teil 1:** mehrzeiliger Upload + Zuordnung + Bestätigungsstufe. **Teil 2:** die eigene Batterie als freier Satz — sie füttert den BESTEHENDEN `batteryOverride`-Mechanismus (§6.2) und erfindet keinen neuen; der Katalog bleibt fest, eine genannte Kapazität führt zur AUSWAHL des nächstliegenden Kandidaten, und der Abstand wird ausdrücklich benannt statt weggerundet. Handover mit den Messwerten: `CLAUDE.md`, Einträge „GEBAUT: Delta 17 (Teil 1 von 2)" und „(Teil 2 von 2)".

**Das Problem, das die drei bestehenden Einstiege offenlassen.** Delta 8/9b hat den Kreis der bedienbaren Kunden zweimal erweitert (Standardprofil, Rechnungs-Scan), aber alle drei Einstiege setzen dieselbe Vorentscheidung voraus: **der Nutzer muss die ART seiner Unterlage kennen**, bevor er den passenden Reiter wählt. Wer einen Stapel vom Steuerberater oder vom Elektriker bekommt, weiss genau das nicht. Wer daran abbricht, kommt in keiner Zahl vor — kein Test und kein Build fängt das.

**Die Umkehrung.** Ein vierter, gleichrangiger Einstieg nimmt **beliebig viele Zeilen** entgegen, jede mit einer **frei getippten Bezeichnung** („Rechnung 01/25") und einer Datei. Die Zuordnung schlägt je Zeile eine Art vor; der Nutzer bestätigt oder korrigiert. Erst danach läuft jede Zeile in das jeweils **bestehende** Modul.

**Entscheidung 1 — Vier Zielarten, und `unbekannt` ist eine davon.** `rechnung` · `lastgang` · `tarifblatt` · `unbekannt`. Der vierte Wert ist kein Fehlerzustand, sondern die richtige Antwort für ein Dokument, das keine der drei Arten ist — UND für eines, bei dem die Zuordnung sich nicht festlegen kann. Beides führt zu derselben Handlung (der Mensch entscheidet) und braucht deshalb keine zwei Werte.

**Entscheidung 2 — Keine Konfidenz, sondern eine Ja/Nein-Aussage je Kandidat.** Das Modell beantwortet drei getrennte, geschlossene Fragen (ist das eine Rechnung? ein Lastgang? ein Tarifblatt?) statt eine Wahrscheinlichkeit zu nennen. Begründung, dieselbe wie bei „lieber nichts als geraten": eine Zahl zwischen 0 und 1 sieht aus wie eine Messung, ist aber die Selbsteinschätzung des Modells über seine eigene Antwort — und jede Schwelle darauf („ab 0,7 übernehmen") wäre eine erfundene Grenze, die nie gegen echte Dokumente geeicht wurde. **Genau eine Zustimmung ergibt die Art; keine oder mehrere ergeben `unbekannt`.** Eine Rangfolge bei mehreren Zustimmungen ist ausdrücklich NICHT gebaut: Rechnung und Tarifblatt verwechselt man, weil beide Preise auflisten — und was von beidem zutrifft, entscheidet der Bezug auf einen einzelnen Kunden, den genau das unsichere Urteil nicht feststellen konnte.

**Entscheidung 3 — Die Bestätigungsstufe ist nicht verhandelbar.** Zwischen Vorschlag und Verarbeitung steht immer ein Mensch. Es gibt keinen Auto-Durchlauf, auch nicht bei eindeutigem Urteil. Dieselbe Haltung wie beim Tarifblatt-Scan, wo die Bestätigung die Bedingung war, unter der er überhaupt gebaut werden durfte — hier zusätzlich deshalb, weil dies der **erste Ort im Produkt ist, an dem überhaupt eine Vermutung angestellt wird**.

**Entscheidung 4 — Prinzip 4 bleibt für Lastgänge unangetastet, und das bestimmt die Architektur.** Die Zuordnung ist zweigeteilt:

- **CSV/XLSX → vollständig im Browser**, ohne jeden Netzaufruf: es läuft der ECHTE Parser (§3.2). Das Ergebnis ist damit keine Vermutung, sondern eine **Messung** — „diese Datei liest sich als Lastgang" ist bewiesen, wenn sie sich liest; ein Wechselrichter-Log wird über `not_a_load_profile` positiv abgelehnt statt mangels Treffern durchgewunken. Das gelesene Profil wird behalten, dieselbe Datei wird nicht zweimal geparst.
- **PDF → Server Action**, weil ein PDF im Browser nicht zuverlässig lesbar ist (dieselbe Abwägung wie in Delta 9b-2a).

Es gibt damit **keinen Weg, auf dem ein Lastgang zum Einordnen hochgeladen wird**. Die Sperre steht nicht nur in der Oberfläche, sondern in der Server Action selbst (sie nimmt ausschliesslich PDF entgegen).

**Entscheidung 5 — Mehrere Rechnungen: Einigkeit übernimmt, Widerspruch bleibt leer und wird benannt.** Der Regelfall dieses Einstiegs sind zwei oder drei Rechnungen, Schritt 2 nimmt aber EINEN Satz Tarifangaben. Je Feld gilt: sagt keine etwas → leer; sagen alle dasselbe → dieser Wert; widersprechen sie einander → **leer, und das Feld wird dem Nutzer genannt**. Drei Alternativen sind verworfen — „die neueste gewinnt" ist **nicht möglich** (`InvoiceExtraction` trägt kein Datum; welche Rechnung die jüngere ist, steht nirgends im Ergebnis), „die erste gewinnt" wäre ein Zufall der Bedienreihenfolge, ein Mittelwert wäre eine gerechnete Zahl, die auf keiner der Rechnungen steht.

**Entscheidung 6 — Genau ein Lastgang je Analyse.** Mehrere bestätigte Lastgänge werden abgelehnt statt zusammengeführt: der Rechner wertet einen zusammenhängenden Zeitraum aus (Delta 15 Regel A), mehrere nebeneinander wären zwei Analysen.

**Bekannte, ehrlich benannte Lücke: ein Tarifblatt wird ERKANNT, aber im öffentlichen Rechner nicht ausgewertet.** Der Tarifblatt-Scan gehört zum Admin-Bereich (`apps/web`), wo ein Mensch jeden gelesenen Wert bestätigt, bevor er als Tarifstand für ALLE künftigen Analysen dieser Netzebene gilt (B21-2b: nicht mehr änderbar, kein `delete`-Grant). Diesen Weg im Kundenrechner zu öffnen hiesse, einen Kunden-Upload über die Preisgrundlage anderer Kunden entscheiden zu lassen. Der Nutzer erfährt das ausdrücklich, statt dass die Zeile still verschwindet.

**Explizit draussen:** ein Chat-artiges Freitextfeld ohne Bestätigungsstufe · jede Änderung an `invoice-scan`/`tariff-sheet-scan` selbst · die Batterie-Freitexterfassung (Teil 2) · ein Zeitraum-Freitext (Delta 15 Regel A bleibt: das Fenster IST der Lastgang).

## Delta 18 — Report-Anfrage: eine Frage in eigenen Worten statt acht Formularfelder (ergänzt §6.2, Delta 9, Delta 17)

> **✅ GEBAUT am 01.09.2026.** Ein Freitextfeld im Report übersetzt einen Satz in genau die acht Grössen, die eine Live-Neuberechnung (§6.2) entgegennimmt — mit Vorschau, ausdrücklicher Bestätigung und einer begründeten Absage für alles andere. Handover mit den Messwerten: `CLAUDE.md`, Eintrag „GEBAUT: Delta 18".

**Das Problem, das das Annahmen-Panel offenlässt.** Seit U2 Prompt C kann der Nutzer acht Annahmen ändern und das Ergebnis live neu rechnen lassen. Das setzt aber voraus, dass er **unsere Vokabeln kennt**: „Betrachtungshorizont", „Abrechnungsmodell", „Round-Trip-Wirkungsgrad". Seine Frage lautet dagegen „Was wäre bei 15 Jahren und 5 % Förderung?" — und sie steht in einer Accordion, die er erst aufklappen muss, unter Feldern, deren Namen er zuordnen muss. Dieselbe Beobachtung wie in Delta 17: wer daran abbricht, kommt in keiner Zahl vor.

**Die Umkehrung.** Ein Feld unmittelbar über „Annahmen & Rechenweise" nimmt einen Satz entgegen und schlägt daraus Änderungen vor. Bestätigt der Nutzer, läuft **derselbe** `onRecompute`-Aufruf, den auch das Panel auslöst.

**Entscheidung 1 — Es entsteht KEIN neuer Parameter, und das ist die tragende Randbedingung.** Übersetzt wird ausschliesslich in die acht bereits vorhandenen Grössen: `billingModel`, `horizonYears`, die vier Finanzgrössen (`subsidyPercent`, `fixedSubsidyEur`, `depreciationYears`, `taxRatePercent`) sowie Wirkungsgrad und Preis der **angezeigten** Batterie. Das Feld ist eine **Übersetzung**, keine Erweiterung des Rechners — es kann nichts, was das Panel darunter nicht auch kann.

**Entscheidung 2 — Alles Übrige wird ABGELEHNT und begründet, nicht verschwiegen.** Das Modell wählt aus einer **geschlossenen Liste** von sieben Ablehnungsgründen (`zeitraum` · `batteriekapazitaet` · `andere_batterie` · `boersenpreis_hebel` · `energiepreise` · `lastgang` · `sonstiges`); die Sätze dazu stehen bei uns. Ein stillschweigend ignorierter Wunsch wäre der schlimmere Ausgang: der Nutzer hielte das nächste Ergebnis für die Antwort auf seine Frage. Wo es einen Weg gibt, nennt die Absage ihn (eine andere Katalog-Batterie wählt man im Energiefluss-Chart; Energiepreise stehen in Schritt 2; ein anderer Lastgang beginnt eine neue Analyse).

**Entscheidung 3 — Keine automatische Anwendung.** Zwischen dem Gelesenen und dem Gerechneten steht eine **Vorschau je Feld (alt → neu)** und ein ausdrückliches „Übernehmen". Dieselbe Haltung wie in Delta 17 und beim Tarifblatt-Scan — hier zusätzlich deshalb, weil der Nutzer ein **fertiges Ergebnis** vor sich hat: ein Satz, der es ohne Rückfrage verändert, macht aus einer Auskunft eine Überraschung.

**Entscheidung 4 — Der Bezugspunkt der Vorschau ist der WIRKSAME Stand, nicht Schritt 2.** Verglichen wird gegen die Eingangsgrössen des **angezeigten** Laufs (`AnalysisRunInputs`), nicht gegen `originalTariff`/`originalFinancial`. Zwei Gründe: eine Vorschau gegen etwas, das der Nutzer nicht mehr vor sich hat, ist keine; und eine daraus gebaute Neuberechnung baute eine zuvor im Panel gemachte Einstellung **still wieder ab** — dieselbe Klasse von stillem Verlust wie beim Batterie-Preset (Nachtrag zu Delta 17 Teil 2). Aus demselben Grund reist ein nicht erwähnter `batteryOverride` unverändert mit, statt auf `undefined` zu fallen.

**Entscheidung 5 — Der aktuelle Stand wird NICHT an das Modell geschickt.** Es erfährt weder den Lastgang noch das Ergebnis noch die geltenden Annahmen; hinaus geht ausschliesslich der getippte Satz. Der Vergleich mit dem Ist-Stand ist eine **reine, geprüfte Funktion** (`buildRecomputeProposal`), kein Rechenschritt des Modells. Folge, ausdrücklich in Kauf genommen: **relative Wünsche** („verdopple den Horizont") sind nicht auflösbar und fallen unter `sonstiges` — mit einem Satz, der um den Zielwert bittet.

**Entscheidung 6 — Kein Umschalten des Börsenpreis-Hebels.** `useTariffOptimization` ist reiner Zustand von Schritt 2, und das Einschalten verlangt einen Netzabruf der Preisdaten (B21-3a/3b), den es aus dem fertigen Ergebnis heraus nicht gibt. Ein Rücklauf auf Schritt 2 existiert nicht (nur „Neue Analyse", die beim Upload beginnt). Der Wunsch wird deshalb abgelehnt und begründet, nicht halb umgesetzt.

**Explizit draussen:** ein Zeitraum-Parameter (Delta 15 Regel A bleibt: das Fenster IST der Lastgang) · eine frei gewählte Batteriegrösse (der Katalog ist fest, Delta 17 Teil 2) · das Umschalten des Hebels (Entscheidung 6) · jede Änderung an den vier bestehenden Extraktions-Modulen · ein mehrstufiger Dialog (das Feld beantwortet eine Anfrage, es führt kein Gespräch).

---

---

## Nächste Schritte

Dieses Delta ist inhaltlich abgeschlossen und **vollständig gebaut** (Schema → Schreibweg → Engine → Oberfläche → Report, B21-1 bis B21-3c, Delta 16a/16b, Delta 9a/9b, Delta 17 Teil 1+2 und Delta 18).

**Offen bleibt:**

- **Das G-Profil für Kleingewerbe** (Delta 8, auf Martin blockiert) — der Auswahlpunkt steht sichtbar und gesperrt im Formular.
- **Der LP-Spike** (Delta 14 Punkt 1). Bis er gelaufen ist, gehören die Studienzahlen (−43 % / 266 €) weiterhin **nicht** in die Kundenkommunikation.
- **Der finale Einwilligungswortlaut** zu `offer_contact` (`Fahrplan_2026.md` §7, Owner Martin). Der Bestand trägt einen als solchen gekennzeichneten Arbeitsstand („[MARTIN: Copy / rechtlich — Arbeitsstand, juristisch ungeprüft] …"). `platform.consent_texts` ist append-only: die geprüfte Fassung kommt als **neue Zeile mit `version = 2`**, die bestehende wird NICHT editiert — sonst zeigten bereits erteilte Einwilligungen auf einen Text, den ihnen niemand angezeigt hat.
