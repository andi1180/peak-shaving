# Netzentgelt-Backfill — Bestandsaufnahme

Docker/Supabase lokal wieder gestoppt, Arbeitsbaum sauber (die eine modifizierte Datei war vorher schon da). Produktion nur lesend angefasst.

## Bestandsaufnahme — historischen Netzentgelt-Stand vor dem ältesten einfügen

## 0. Messaufbau

Lokaler Supabase-Stack auf HEAD (alle vier `grid_tariff*`-Migrationen), jede Probe in einer zurückgerollten Transaktion unter `set local role service_role`, die Funktionen echt aufgerufen (Arbeitsregel 2). Produktion ausschliesslich lesend über den anon-Schlüssel.

## 1. Der heutige Bestand — gemessen, nicht angenommen

Produktion (`grid_tariffs`, 03.09.2026):

```
Zeilen: 7
davon valid_until is null (offen): 7
davon geschlossen: 0
verschiedene Kombinationen: 7 (WN NE 3/4/5/6 + NE 7 × drei Varianten)
Stände je Kombination: genau 1
valid_from: bei allen sieben 2026-01-01
Zeitfenster gesamt: 10
```

Daraus folgt mit Zahlen belegt: Es gibt heute keine einzige Kette und damit auch kein Loch mitten in der Historie. Der einzige real vorkommende Fall ist „ein Stand, offen, ab 2026-01-01" — und ein Kunde mit Lastgang 2025 liegt vollständig davor.

Die zweite Untergrenze, die dabei mitzudenken ist: `spot_prices` läuft von 2024-12-31T23:00Z bis 2026-09-03T21:00Z (14 663 Zeilen). Ein nachgetragener Netzentgelt-Stand für 2024 wäre also wirkungslos — Delta 15 Regel B lehnt solche Lastgänge ohnehin beim Upload ab. Der nutzbare Backfill-Bereich ist praktisch 2025-01-01 bis 2025-12-31.

## 2. Die exakte heutige Prüfung — und was sie nicht sieht

`create_grid_tariff` liest ausschliesslich offene Zeilen:

```sql
where operator_id = … and netzebene = … and metering_variant is not distinct from …
  and valid_until is null            -- ← geschlossene Zeilen kommen gar nicht vor
  for update
```

Geprüft wird dann nur `p_valid_from <= max(valid_from der offenen)`. Geschlossene Zeilen sind für die Prüfung unsichtbar.

Fünf Szenarien, echt gefahren:

```
Szenario 1: Ausgangslage offen ab 2026-01-01, Aufruf 2025-01-01 → invalid_valid_from (open_valid_from: 2026-01-01), unverändert, kein Schreibvorgang
Szenario 2: Ausgangslage offen ab 2026-01-01, Aufruf 2026-01-01 → invalid_valid_from (nicht duplicate_valid_from), unverändert
Szenario 6: Ausgangslage 2024 (zu) · Loch 2025 · 2026 (offen), Aufruf 2025-01-01 → invalid_valid_from, unverändert
Szenario 7: Ausgangslage nur 2025 (zu), kein offener Stand, Aufruf 2025-01-01 → P0001 duplicate_valid_from
Szenario 5 (Kontrolle): Ausgangslage offen ab 2026-01-01, Aufruf 2027-01-01 → created, closed_count: 1, closed_valid_until: 2026-12-31, lückenlose Kette
```

Befund zu Punkt 1 der Aufgabenstellung: Ein Loch mitten in der Historie ist heute ebenfalls nicht füllbar (Szenario 6) — der Guard greift, weil das Loch immer vor dem offenen Stand liegt. Ein solches Loch kann über den normalen Weg gar nicht erst entstehen: das automatische Schliessen setzt `valid_until = neues valid_from − 1` und überbrückt dadurch jeden Abstand (in Szenario 3 gemessen: 2024 + 2026 angelegt ⇒ die 2024er Zeile läuft bis 2025-12-31, nicht bis 2024-12-31). Ein echtes Loch entsteht nur durch Löschen einer mittleren Zeile — protokolliert, selten, und heute nicht existent (0 geschlossene Zeilen).

⇒ Der Backfill ist eindeutig, solange die Regel lautet: `p_valid_from < min(valid_from)` der Kombination, strikt. Das „Loch in der Mitte" ist ein eigener, komplizierterer Fall — er darf über denselben Weg nicht möglich werden.

## 3. ⚠ Ein gemessener Defekt im Bestand, der beim Bau mitzudenken ist

Szenario 8: nur geschlossene Zeilen (der offene Stand wurde gelöscht), dann anlegen mit früherem `valid_from`:

```
vorher:   2025-01-01 … 2025-12-31   (geschlossen)
Aufruf:   2024-01-01                → status: created, closed_count: 0
nachher:  2024-01-01 … offen        ← valid_until NULL!
          2025-01-01 … 2025-12-31
```

Die neue Zeile ist offen und gilt damit auch nach dem Ende der geschlossenen — für immer. Mit der echten Engine-Funktion `findGridTariffRow` gegengeprüft:

```
2024-06-01 → alte Zeile (2024)      2026-06-01 → alte Zeile (2024)   ← falsch
2025-06-01 → echte 2025er Zeile     2030-06-01 → alte Zeile (2024)   ← falsch
```

Ein 2024er Preisstand gilt danach still für 2026 und jedes Folgejahr. Erreichbar ist der Zustand über den Löschweg (er darf jede Zeile entfernen, auch die offene). Kein akutes Produktionsrisiko (0 geschlossene Zeilen), aber eine Backfill-Funktion muss diesen Fall ausdrücklich beantworten, statt ihn zu erben.

## 4. Architektur: eigene Funktion, nicht ein Modus auf `create_grid_tariff`

Das Bestandsargument trägt hier doppelt:
- `delete_grid_tariff` wurde getrennt gehalten, weil es eine andere fachliche Aussage ist.
- `add_grid_tariff_rate_window` ist getrennt, obwohl es technisch nur ein INSERT ist — wegen des einen Guards, der es rechtfertigt.

Genau das gilt hier: Der Backfill braucht einen entgegengesetzten Guard (`p_valid_from < min(valid_from)` statt `> max(valid_from der offenen)`) und ein entgegengesetztes Schliessen (die neue Zeile bekommt ein `valid_until`, die bestehende bleibt unberührt). Als Parametermodus stünden in einem Rumpf zwei gegenläufige Ordnungsregeln nebeneinander, unterschieden durch ein Flag — und `create_grid_tariff` ist die Funktion, an der die gesamte Effektiv-Datierung hängt. Zusätzlich: ein Flag mit Vorgabewert müsste an das Ende der Parameterliste (hinter `p_metering_variant`), und die erzeugten TS-Typen führten es als optional — ein Aufrufer, der es vergisst, bekäme stillschweigend das Anhänge-Verhalten.

Vorschlag: `public.backfill_grid_tariff(...)`, gleiche Signaturform wie `create_grid_tariff`, `security invoker`, EXECUTE nur `service_role`.

Zwei Bedingungen, die im Rumpf stehen müssen:
1. Denselben Advisory-Lock-Schlüssel benutzen (`hashtext('grid_tariff:' || operator || ':' || netzebene || ':' || coalesce(variant,''))`) — sonst könnten create und backfill derselben Kombination gleichzeitig laufen und beide eine offene Zeile hinterlassen.
2. `min(valid_from)` über ALLE Zeilen der Kombination, offen wie geschlossen — nicht nur die offenen. Nur so ist Szenario 8 ausgeschlossen und ein Loch in der Mitte nicht erreichbar. Kein Treffer (Kombination ganz leer) ⇒ abweisen (`no_existing_stand`, „dafür ist der normale Anlageweg da"), nicht still ein offenes Ur-Zeile anlegen.

## 5. Automatisches Schliessen — spiegelbildlich, in einer Transaktion

Die neue Zeile bekommt `valid_until := min(valid_from) − 1`; die bestehende älteste wird nicht angefasst. Damit gilt dieselbe Zusage wie beim Anhängen: keine Lücke, keine Überschneidung, und `valid_from − 1` ist wieder der einzige Wert, der beides zugleich leistet. Der Guard aus (4.2) garantiert `valid_until >= valid_from` der neuen Zeile.

Atomar ist es aus demselben Grund wie in B21-2b: neue Zeile + 1..n Zeitfenster sind über PostgREST zwei Transaktionen; ein Abbruch dazwischen hinterliesse eine Netzentgelt-Zeile ohne Arbeitspreis, die die Engine als vollständig läse.

## 6. RLS/Rechte — bestätigt, nicht übernommen

Gemessene Rechtefläche (lokal, `information_schema.role_table_grants`; deckt sich mit `DEPLOYMENT.md` §3c):

```
grid_tariffs: anon/authenticated SELECT, service_role DELETE/INSERT/SELECT/UPDATE
grid_tariff_rate_windows: anon/authenticated SELECT, service_role INSERT/SELECT
grid_tariff_deletions: anon/authenticated —, service_role INSERT
```

Alle drei Funktionen: `prosecdef = false` (SECURITY INVOKER), EXECUTE `anon`/`authenticated` false, `service_role` true.

Ein Backfill braucht KEINEN neuen Grant. Er liest (SELECT auf `grid_tariffs`), sperrt (`for update` ⇒ verlangt UPDATE — der Befund aus B21-2c), fügt ein (INSERT auf beide Tabellen). Alles vorhanden. Die Autorisierung liegt wie bei den drei Geschwistern im Anwendungscode (`isCurrentUserAdmin()` als erste Anweisung, fail closed) — das erweitert die eine bewusste Abweichung (§3c), es schafft keine zweite. Die ESLint-Erlaubnisliste ist bereits auf `grid-tariffs-actions.ts` gesetzt; eine neue Action in derselben Datei braucht dort nichts.

## 7. Audit — ja, aber aus einem anderen Grund als vermutet

Zwei gemessene Punkte:
- Eine archivierte Analyse ändert sich NICHT. `platform.analyses` friert `inputs`/`result` als jsonb ein und wird nie nachgerechnet (B14-1 Regel a). Ein Backfill kann keine bereits gerechnete Zahl verschieben.
- Aber: `AnalysisBundleInputs` trägt die Netzentgelt-Seite gar nicht (gemessen: `gridTariff`/`pricing`/`spotPrice` kommen in `analysis-bundle.ts` 0× vor). Das Bündel hält `inputs.tariff` und die B11-Herkunft fest — welche `grid_tariffs`-Zeile und welche Zeitfenster eine Analyse benutzt hat, steht nirgends.

⇒ Der Backfill ändert nicht die Vergangenheit, aber er ändert, was dieselbe Vergangenheit bei einer erneuten Rechnung ergibt — von „nicht berechenbar" zu einer Zahl, und beim zweiten Backfill von Zahl A zu Zahl B. Weil das Archiv die Preisgrundlage nicht mitführt, ist das aus dem Bestand heraus nicht rekonstruierbar.

Empfehlung: ein Protokoll, aber nicht nach dem Muster `grid_tariff_deletions` (das existiert, weil dort etwas verschwindet — hier verschwindet nichts). Die schlankere und ehrlichere Form ist eine Spalte auf der Zeile selbst, z. B. `backfilled_at timestamptz` (null = auf dem normalen Weg entstanden). Sie kostet keine Tabelle, keinen Grant, kein zweites Leseproblem, sie reist über `to_jsonb(t)` automatisch in den Löschabzug mit, und sie macht die Zeile in der Liste als das kennzeichenbar, was sie ist: nachträglich ergänzt. `created_by`/`created_at` tragen bereits Wer und Wann.

Die grössere Lücke ist die fehlende Preisgrundlage im Bündel — das ist ein eigener Schritt (Fassungssprung), nicht Teil dieses hier.

## 8. UI — eigener Weg, sichtbar verschieden

Der Platz ist vorgezeichnet: „Zeitfenster ergänzen" sitzt seit B21-2d als `<details>` in der Listenkarte am offenen Stand. Der Backfill gehört spiegelbildlich als `<details>` am ältesten Stand derselben Karte — „Früheren Stand ergänzen" —, weil dort der Bezugspunkt sichtbar ist (gültig ab 01.01.2026), gegen den der neue laufen muss.

Ausdrücklich nicht im Abschnitt „Neuen Tarifstand anlegen": dort ist die Frage „was gilt ab jetzt", hier „was galt vorher". Drei Dinge, die der Weg mitbringen muss:
1. Die Kombination ist fest (aus der Karte übernommen, verstecktes Feld) — nicht wählbar. Dieselbe Begründung wie beim Scan-Formular in B21-2b Teil A: die Preise gehören zu dieser Zeile.
2. Die Bestätigung nennt beide Daten im Klartext („gilt dann vom … bis 31.12.2025, unmittelbar vor dem heutigen Stand") — und dass die Zeile kein aktueller Stand wird.
3. Die Karte kennzeichnet die Zeile danach als nachgetragen (s. 7).

## 9. Jährliche Kontrollpflicht — eigener Punkt, und er trifft ein gemessenes, stilles Versagen

Das ist keine Wiederholung von (1)–(8), sondern die Gegenrichtung, und sie ist die gefährlichere.

Gemessen: Ein offener Stand (`valid_until is null`) deckt jeden späteren Tag ab — `findGridTariffRow` liefert für 2030-06-01 die Zeile ab 2026-01-01. Alle sieben Produktionszeilen sind offen.

Damit gibt es zwei gegensätzliche Fehlerarten:
- Stand fehlt (Zukunft, z. B. NE 7 ab 2027): laut — „nicht berechenbar", `TariffOptimizationBlocker`, kein Preis erfunden
- Stand veraltet (Preisblatt 2027 nie eingetragen): still — die 2026er Sätze gelten weiter, der Report zeigt eine plausible Zahl, nichts warnt

Der erste Fall ist der Entwurf, wie er gedacht ist (B21-1: „Nebeneffekt des Entwurfs, kein Sonderfall-Code"). Der zweite ist der blinde Fleck, und er ist genau die Klasse Fehler, gegen die dieses Projekt sonst konsequent baut: eine Zahl, die als Ergebnis aussieht statt als Fehler.

Bewertung: Eine jährliche Kontrollpflicht (nicht Neuerfassung) ist sinnvoll und die richtige Antwort — die Datenbank kann sie nicht ersetzen: sie weiss nicht, dass ein Preisblatt erschienen ist, und ein automatisches Verfallsdatum wäre schlimmer (es machte funktionierende Analysen künstlich unberechenbar und erfände eine Gültigkeitsdauer, die auf keinem Preisblatt steht). Der Prozess gehört nach `DEPLOYMENT.md` §3c, Owner Martin/Andreas, Termin ~Jänner (Preisblätter gelten kalenderjahrweise).

Was der Bau dazu beitragen kann, ohne eine Entscheidung vorwegzunehmen: die Listenkarte weist bereits `created_by` · `created_at` aus. Ein sichtbarer Hinweis „aktueller Stand seit n Jahren unverändert" wäre reine Anzeige über vorhandene Daten, sperrt nichts und erfindet nichts — die Kontrollpflicht bleibt organisatorisch, bekommt aber einen Ort, an dem sie auffällt. Ausdrücklich kein Blocker, kein Ablaufdatum in der Datenbank.

## 10. Was ich nicht gemessen habe

- Kein Backfill-Rumpf gebaut oder gefahren — die Rechteflächen-Aussage in (6) beruht auf der gemessenen Grant-Tabelle plus den bereits gemessenen Bedarfen der drei bestehenden Funktionen, nicht auf einer Stufenmessung des neuen Wegs. Die gehört in den Bau-PR.
- Nichts über den konkreten neuen Kunden — sein Zeitraum, sein Netzbetreiber und die Frage, ob für 2025 überhaupt ein Preisblatt vorliegt, sind Auslöser, nicht Gegenstand.
- Keine Zeile in Produktion geschrieben.

---

## Nachtrag: Bau abgeschlossen, PR #147

NACHTRAG (Bau abgeschlossen, PR #147, 03.09.2026):

Was gebaut wurde: `public.backfill_grid_tariff` + Spalte `grid_tariffs.backfilled_at`, Server Action, `<details>`-Formular an der ältesten Zeile jeder Kombination, passiver „seit n Monaten unverändert"-Hinweis.

Die Falle, gegen die der Rumpf gebaut ist — Szenario 8: Kopiert man die Abfrage aus `create_grid_tariff` (die auf `valid_until is null` filtert), findet der Guard bei einer Kombination ohne offenen Stand nichts und legt die neue Zeile ohne `valid_until` an: ein offener Stand in der Vergangenheit, unter dem jede Analyse fortan mit einem historischen Preisblatt rechnet. Der Guard misst deshalb `min(valid_from)` über alle Zeilen. Probe: mit der falschen Bedingung werden genau 5 Tests rot, darunter beide Szenario-7-Wächter.

Weitere gemessene Befunde:
- Die Korrektur verlangt hier die umgekehrte Richtung („VOR diesem Tag") — ein aus dem Anlegen übernommener Satz schickte den Eintragenden nach hinten und erneut in dieselbe Abweisung. Daher auch eigene Statuswerte (`backfilled`/`not_before_oldest` statt `created`/`invalid_valid_from`).
- Grant-Stufenmessung: vier Rechte nötig, alle vorhanden. Anders als `add_grid_tariff_rate_window` braucht der Backfill kein SELECT auf den Zeitfenstern.
- Advisory-Lock: ohne ihn setzt der zweite Backfill sein Ende auf genau den Zeitraum, den der erste belegt hat — eine Überschneidung, die der Unique-Constraint nicht fängt. Der gemeinsame Schlüssel mit `create_grid_tariff` ist separat gemessen.
- Ein Test, der sich selbst nicht mass: die ersten zwei Fassungen des Nebenläufigkeits-Wächters blieben mit separatem Lock-Schlüssel grün — beim zweiten Mal, weil `for update` die Advisory-Lock-Zusage zufällig mit abdeckte. Erst der Aufbau mit zwei Ständen isoliert sie.

`build`/`test`/`typecheck`/`lint` grün, DB-Gate 736/736, apps/web 703. CI grün, Branch gelöscht. Migration zum Zeitpunkt dieses Nachtrags NOCH NICHT gegen Produktion gepusht (folgt als eigener Schritt).
