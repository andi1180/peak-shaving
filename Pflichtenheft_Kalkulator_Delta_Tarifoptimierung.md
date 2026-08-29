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

**Woher kommt `leistungspreisEurPerKwYear = 0`:** aus der gewählten Netzbetreiber-Tarifvariante „ohne Leistungsmessung" (Delta 5) — dort ist der Grundpreis laut Tarifblatt ein reiner Jahres-Pauschalbetrag, kein €/kW-Wert. Die Variante **ist** der reale Fall hinter dem Flag, kein zusätzliches UI-Element nötig.

**Zweite Anwendung (Pessimismus, s. Delta 11):** Derselbe Pfad wird auch aktiviert, wenn `loadProfile.source === 'standard_profile'` — unabhängig davon, ob der Kunde nominell leistungsgemessen ist. Ohne echten Lastgang lässt sich eine individuelle Spitze nicht seriös schätzen; der Kalkulator berechnet für diesen Fall keine Leistungspreis-Ersparnis, sondern ausschließlich die Tarif-Ersparnis.

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

**Pessimismus-Konsequenz (Delta 3, zweite Anwendung):** Ein Standardprofil trägt die Tarif-Arbitrage-Rechnung (Tagesform genügt für Durchschnittspreis-Optimierung), aber **nicht** die Leistungspreis-Dimensionierung. Deshalb automatisch `hasLeistungspreis`-Pfad (Delta 3), unabhängig vom nominellen Vertragsstatus des Kunden — keine erfundene Spitzenlast-Ersparnis. Report zeigt ausschließlich die Tarif-Ersparnis, mit sichtbarem Hinweis „für die Leistungspreis-Dimension: echten Lastgang hochladen".

---

## Delta 9 — UI/UX

> **Stand 29.08.2026: Delta 9a ist ABGESCHLOSSEN, Delta 9b ist ein eigener, späterer Bauabschnitt.** Die Trennlinie liegt zwischen der Bedienung des Hebels (9a: Formular, Erklärungen, Ergebnisanzeige) und den zusätzlichen EINSTIEGEN in den Lastgang-Schritt (9b: Rechnungs-Scan, Standardprofil/manuelle Verbrauchsangabe). 9b bringt neue Datenquellen und damit eigene fachliche Fragen; 9a brauchte keine.

**9a — abgeschlossen (B21-3c, 29.08.2026):**

- ✅ **Infobuttons pro Feld/Funktion** mit kurzer Erklärung — bindende Anforderung, insbesondere für Privatkunden. Natürliche Erweiterung von Prinzip 5 (Transparenz), kein neues Prinzip. Umgesetzt als `apps/website/components/ui/info-hint.tsx`; aufklappender Absatz im Textfluss statt Hover-Tooltip (auf einem Touchgerät gibt es kein Hover) und ohne neue Abhängigkeit. **Gesetzt sind sie an den in diesem Abschnitt NEUEN Feldern** — Netzbetreiber, Netzebene, Messvariante, Aktivierungs-Schalter, Ergebniskarte; ein repo-weiter Nachtrag auf alle Bestandsfelder ist bewusst nicht erfolgt.
- ✅ **Schritt 2 (Tarif) erweitert** um die Leistungsmessungs-Variante als dritte Auswahl, kontextabhängig sichtbar (nur bei Netzebenen, die sie anbieten). Sie wird bei den übrigen Netzebenen **gar nicht gerendert**, nicht nur deaktiviert: ein deaktiviertes Feld gäbe es weiterhin, und sein Wert liefe beim nächsten Umbau in die Abfrage — wo `IS NULL` hingehört (B21-1, `nulls not distinct`).
- ✅ **`tarif-nicht-verfuegbar.tsx` überarbeitet:** die Datei unterscheidet jetzt drei Fälle. Die beiden Verweigerungen (B11: Verordnung ausstehend / Preisblatt noch nicht hinterlegt) sind unverändert und sperren weiterhin; neu daneben steht `TarifOhneLeistungsmessung` — **kein Fehler, neutrale Färbung, kein Warteliste-Link, keine Sperre**, und der Leistungspreis wird mit 0 vorbelegt, weil dieser Anschluss den Posten nicht hat.
- ✅ **Ergebnisanzeige des Hebels:** eine eigene Karte neben der Peak-Shaving-Empfehlung. Sie zeigt **entweder** die gerechnete Zahl **oder** den Grund samt betroffenem Zeitraum — nie beides, und im Blocker-Fall ausdrücklich keine Zahl (Delta 15). Sprache durchgehend rückblickend („wäre möglich gewesen"), nie als Zusage (Delta 11). Der Befund reist dafür als Contract-Feld `AnalysisResult.tariffOptimization` statt als Text in `dataQuality.warnings`.

**9b — offen, eigener Bauabschnitt:**

- **Drei gleichwertige Startpunkte für den Lastgang-Schritt:** Datei-Upload (bestehend), Rechnungs-Scan (neu), Standardprofil/manuelle Verbrauchsangabe (neu) — alle drei münden auf denselben `LoadProfile`-Contract, keine UI-Verzweigung danach. **Mitzudenken:** ein Standardprofil trägt laut Delta 3/8 die Tarif-Arbitrage, aber NICHT die Leistungspreis-Dimension — der vierte `LoadProfile.source`-Wert `standard_profile` (B21-1) existiert dafür bereits, wird aber von der Simulation noch nicht gelesen.
- **Delta 16 (PDF-Report)** bleibt ebenfalls offen und wartet auf die Klärung seiner zwei offenen Fragen.

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

## Nächste Schritte

Dieses Delta ist inhaltlich abgeschlossen. Als Nächstes: **eigener Übergabeprompt für Claude Code** (separates Dokument, kommt nach Bestätigung dieses Deltas) — mit AUFGABE/NICHT-TUN/Verifikation im gewohnten Format, vermutlich in Teil-PRs analog zur bisherigen Praxis (Schema → Schreibweg → Oberfläche).
