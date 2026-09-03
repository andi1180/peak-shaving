-- B21-2e — Einen HISTORISCHEN Netzentgelt-Stand VOR dem ältesten vorhandenen einfügen (Backfill).
--
-- Kanonische fachliche Quelle: `Pflichtenheft_Kalkulator_Delta_Tarifoptimierung.md`, Delta 5
-- (Datenmodell + Admin-Pflege) und Delta 10 (Admin-UI Tarifdaten). Betriebsseite: `DEPLOYMENT.md` §3c.
--
-- ── WAS HIER ENTSTEHT ───────────────────────────────────────────────────────────────────────────
--   TEIL 1  public.grid_tariffs.backfilled_at   — Vermerk, dass eine Zeile nachgetragen wurde
--   TEIL 2  public.backfill_grid_tariff(...)    — der spiegelbildliche Weg zu create_grid_tariff
--
-- Keine neue Tabelle, kein Trigger, keine Policy, KEIN neuer Tabellen-Grant, keine Zeile Inhalt.
-- `public.create_grid_tariff`, `public.delete_grid_tariff`, `public.add_grid_tariff_rate_window`,
-- das Löschprotokoll, `public.spot_prices` und `platform` sind mit NULL Zeilen Diff unangetastet.
--
-- ── WARUM ES DIESEN WEG BRAUCHT ─────────────────────────────────────────────────────────────────
-- `create_grid_tariff` hängt ausschliesslich NACH vorne an: `p_valid_from` muss hinter dem Beginn
-- des offenen Stands liegen, sonst `invalid_valid_from`. Für einen Stand, der VOR dem ältesten
-- vorhandenen liegt, gibt es damit keinen Weg — obwohl genau der gebraucht wird, sobald ein
-- Lastgang in einen Zeitraum reicht, für den erst später ein Preisblatt erfasst wurde.
--
-- Ohne diesen Weg gäbe es für einen solchen Zeitraum gar keine Berechnungsgrundlage (B21-1: der
-- richtige, sichere Zustand — aber eben auch ein Zeitraum, den der Kalkulator nicht rechnet,
-- obwohl das Preisblatt in der Schublade liegt). Der einzige Ausweg wäre der SQL-Editor gewesen.
--
-- ── ⚠ DER FALLSTRICK, GEGEN DEN DER GANZE RUMPF GEBAUT IST: SZENARIO „NUR GESCHLOSSENE ZEILEN" ──
-- Die naheliegende Umsetzung kopiert die Abfrage aus `create_grid_tariff` — und die filtert auf
-- `valid_until is null`, sucht also den OFFENEN Stand. Für den Backfill ist das in ZWEI Richtungen
-- falsch:
--
--   (a) Der Bezugspunkt ist der ÄLTESTE Stand, nicht der offene. Gegen den offenen geprüft liefe
--       ein Backfill „vor 2026" durch, obwohl schon eine Zeile ab 2025 existiert — es entstünde
--       eine ÜBERSCHNEIDUNG, und welcher Leistungspreis in eine Analyse einginge, entschiede die
--       Sortierreihenfolge einer Abfrage (genau der Zustand, den der `unique nulls not distinct`
--       aus B21-1 ausschliessen soll).
--   (b) Es gibt Kombinationen, die GAR KEINEN offenen Stand mehr haben: der offene wurde über
--       `delete_grid_tariff` (B21-2c) entfernt, die abgelösten stehen weiter da. Auf den offenen
--       Stand gefiltert fände die Funktion nichts — sie meldete „keine Kombination" (falsch, es
--       gibt sie), oder schlimmer: sie legte die neue Zeile OHNE `valid_until` an. Dann stünde ein
--       OFFENER Stand in der VERGANGENHEIT, unter dem eine Analyse fortan jeden Zeitraum bis heute
--       mit einem historischen Preisblatt rechnete — ohne dass irgendetwas danach aussähe.
--
-- Deshalb: `min(valid_from)` über ALLE Zeilen der Kombination, offene UND geschlossene, und die
-- neue Zeile bekommt IMMER ein `valid_until` (= dieses Minimum minus einen Tag). Beide Richtungen
-- sind im DB-Gate als eigene Fälle gemessen
-- (`packages/db-tests/src/grid-tariff-backfill.test.ts`, Szenarien 1/4/7).
--
-- ── ⚠ EINE LÜCKE MITTEN IN DER HISTORIE BLEIBT UNMÖGLICH ───────────────────────────────────────
-- Dieser Weg fügt AUSSCHLIESSLICH vor dem ältesten Stand ein. Ein `p_valid_from`, das zwischen zwei
-- bestehenden Ständen läge, ist per Definition NICHT kleiner als das Minimum und wird abgewiesen —
-- es gibt also weiterhin keinen Weg, einen bereits gerechneten Zeitraum von innen zu verändern.
-- Das ist keine Nebenfolge, sondern der Grund für die Formulierung des Guards; im Gate ist es als
-- eigener Fall gemessen (Szenario 4), damit ein späterer „auch dazwischen wäre praktisch"-Umbau
-- rot wird statt still durchzulaufen.
--
-- ── EINE TRANSAKTION, WEIL ZWEI SCHREIBVORGÄNGE ZUSAMMENGEHÖREN ────────────────────────────────
-- Dieselbe Begründung wie bei `create_grid_tariff` (Migration 20260828090000): Über PostgREST wäre
-- jeder `.insert()` seine eigene Transaktion. Bräche der zweite ab, bliebe eine Tarifzeile OHNE
-- Zeitfenster stehen — eine Netzentgelt-Seite ohne Arbeitspreis, die die Engine (Delta 4) als
-- vollständig läse. „Keine Berechnungsgrundlage" ist ein sicherer Zustand, „eine halbe" nicht.
--
-- ── SECURITY INVOKER, wie alle drei Geschwisterfunktionen ──────────────────────────────────────
-- Prüft KEINE Rolle. Der Aufrufer ist `service_role` und trägt kein JWT; `auth.uid()` ist leer, es
-- gibt in der Datenbank nichts zu prüfen. Die Zugangsentscheidung liegt in `apps/web`
-- (`lib/admin/grid-tariffs-actions.ts`, `isCurrentUserAdmin()` als erste Anweisung, fail closed).
-- Diese Datei ERWEITERT damit die eine bewusste Abweichung des Systems (DEPLOYMENT.md §3c) — sie
-- schafft keine zweite: derselbe Aufruferkreis, dieselbe Prüfstelle, dieselbe Datei.
--
-- ── WAS AUSDRÜCKLICH NICHT ENTSTEHT ─────────────────────────────────────────────────────────────
-- Kein Bearbeiten (weiterhin nirgends). Kein Weg, eine Lücke MITTEN in der Historie zu füllen
-- (s. o.). Kein automatisches Ablaufdatum und kein Blocker am „seit n Jahren unverändert"-Hinweis
-- der Oberfläche — der ist reine Anzeige über `created_at`. Und keine Ergänzung des Analyse-Bündels
-- um die benutzte Preisgrundlage: das ist ein eigener, späterer Schritt mit eigenem Fassungssprung.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — public.grid_tariffs.backfilled_at
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ── ⚠ NULLABLE, OHNE DEFAULT — UND DAS IST DIE GANZE MIGRATION FÜR BESTEHENDE ZEILEN ───────────
-- Jede über `create_grid_tariff` entstandene Zeile bleibt `null`, auch rückwirkend. Das ist keine
-- Auslassung, sondern bereits die richtige Aussage: Diese Zeilen wurden VORWÄRTS angehängt, nicht
-- nachgetragen. Ein Backfill der Spalte selbst gäbe es also gar nicht zu tun — und ein Default
-- (etwa `now()`) machte aus „nicht nachgetragen" ein „am Tag der Migration nachgetragen", also aus
-- einer wahren Aussage eine falsche.
--
-- Warum überhaupt ein Vermerk: Ein nachgetragener Stand ist an seinen Daten NICHT zu erkennen — er
-- sieht aus wie jeder andere abgelöste Stand. Wer 2028 nachvollziehen will, warum für einen
-- Zeitraum plötzlich eine Berechnungsgrundlage existiert, die es zum Zeitpunkt der damaligen
-- Analyse noch nicht gab, findet die Antwort nur hier. Der Zeitstempel liegt deshalb NACH
-- `created_at` in der Bedeutung, nicht daneben: `created_at` sagt, wann die ZEILE entstand,
-- `backfilled_at` sagt zusätzlich, dass sie einen VERGANGENEN Zeitraum beschreibt.
--
-- Kein CHECK und kein Trigger, der die Spalte gegen `create_grid_tariff` verteidigt: Die Funktion
-- listet die Spalte nicht auf, der Default ist `null`, und ein Trigger fügte einer Tabelle ohne
-- jeden anderen Trigger einen hinzu, um eine Eigenschaft zu erzwingen, die aus dem Rumpf folgt.
-- Das DB-Gate misst sie stattdessen (`create_grid_tariff` → null, `backfill_grid_tariff` → gesetzt).
alter table public.grid_tariffs add column backfilled_at timestamptz;

comment on column public.grid_tariffs.backfilled_at is
  'B21-2e: Zeitpunkt, zu dem diese Zeile als HISTORISCHER Stand VOR dem damals ältesten '
  'nachgetragen wurde (public.backfill_grid_tariff). null = regulär vorwärts angehängt '
  '(public.create_grid_tariff) — das ist der Regelfall und die zutreffende Aussage für jede '
  'Zeile, die vor dieser Migration entstanden ist.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — public.backfill_grid_tariff
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ── ⚠ EIGENE STATUSWERTE, NICHT DIE VON create_grid_tariff ─────────────────────────────────────
-- `backfilled` statt `created` und `not_before_oldest` statt `invalid_valid_from`. Beide Funktionen
-- liefern jsonb mit einem `status`, und beide werden aus derselben Datei aufgerufen
-- (`grid-tariffs-actions.ts`). Gleiche Namen hiessen: eine Antwort allein sagt nicht mehr, WELCHE
-- Funktion sie gegeben hat — und die beiden Fälle sind gegensätzlich (der eine verlangt ein
-- SPÄTERES Datum, der andere ein FRÜHERES). Ein an der falschen Stelle wiederverwendeter Zweig
-- zeigte dem Eintragenden dann die Aufforderung, in die verkehrte Richtung zu korrigieren.
--
-- ── `p_operator_name` IST BEWUSST KEIN PARAMETER ───────────────────────────────────────────────
-- Der Anzeigename wird aus dem Bestand übernommen. Ein Backfill setzt eine bestehende Kombination
-- voraus; der Name ist kein Identitätsfeld (die Datierung läuft über `operator_id`, `netzebene`,
-- `metering_variant`), und ihn erneut entgegenzunehmen erzeugte die Möglichkeit, dass dieselbe
-- Kennung mit ZWEI Anzeigenamen in der Liste steht — sichtbar als zwei Gruppen, die es nicht gibt.
-- Aus derselben Quelle gelesen, aus der auch die Karte ihn zeigt, kann das nicht passieren.
--
-- ── DIE SPERREN ────────────────────────────────────────────────────────────────────────────────
--   1. `pg_advisory_xact_lock` — und er ist TRAGEND, nicht Zierrat. Zwei gleichzeitige Backfills
--      lesen sonst BEIDE dasselbe Minimum, berechnen BEIDE dasselbe `valid_until` und legen zwei
--      Zeilen mit VERSCHIEDENEM `valid_from`, aber GLEICHEM Ende an — eine Überschneidung, die der
--      `unique nulls not distinct`-Constraint (B21-1) gerade nicht abfängt, weil er über
--      `valid_from` geht. Ohne Lock gemessen: der zweite Aufruf setzt sein Ende auf genau den
--      Zeitraum, den der erste eben belegt hat (DB-Gate, Probe „Lock entfernt").
--
--      ⚠ DER SCHLÜSSEL IST DERSELBE WIE IN `create_grid_tariff` — gemessen, was das leistet und
--      was nicht. Er ist das EINZIGE, was Backfill und Vorwärts-Anlage gegeneinander serialisiert:
--      Im Gate mit einem separaten Schlüssel nachgemessen läuft der Backfill sofort durch, während
--      eine Anlage derselben Kombination offen ist (der Test wird rot). Das zeilenweise
--      `for update` fängt das nur zufällig mit ab — nämlich dann, wenn der offene Stand zugleich
--      der älteste ist; bei zwei oder mehr Ständen sind es verschiedene Zeilen, und es greift nicht.
--
--      Was der gemeinsame Schlüssel NICHT leistet, ebenso gemessen: das ERGEBNIS hängt nicht an
--      ihm. Die beiden Funktionen können ihre Entscheidungen gar nicht gegenseitig verschieben —
--      `create_grid_tariff` fügt nie eine ÄLTERE Zeile ein (es kann den Bezugspunkt des Backfills
--      nicht verschieben), der Backfill nie eine OFFENE (er kann den der Anlage nicht verschieben).
--      Der Schlüssel hält also die Reihenfolge, nicht die Richtigkeit. Er ist trotzdem derselbe:
--      zwei Sperrnamensräume auf demselben Gegenstand sind eine Einladung an die nächste Funktion,
--      zur falschen zu greifen. Eine Kombination, ein Lock.
--   2. `for update` auf der ältesten Zeile — hält den Bezugspunkt für die Dauer der Prüfung fest.
--      Der Advisory-Lock deckt das bereits ab; das Zeilen-`for update` hält zusätzlich einen
--      Schreiber auf, der an diesen Funktionen vorbei ginge (dieselbe Tiefenstaffelung wie in
--      B21-2b/2c/2d).
--
-- ⚠ `p_metering_variant` STEHT AM ENDE, aus demselben Grund wie in `create_grid_tariff`: Es ist der
-- einzige Parameter mit Vorgabewert (bei NE 3-6 gehört `null` in die Spalte), und PostgreSQL
-- verlangt, dass alle Parameter NACH einem mit Vorgabewert ebenfalls einen tragen. Weiter vorne
-- stehend zwänge es auch `p_valid_from` und `p_windows` zu optionalen Parametern — ein Aufruf ohne
-- Gültigkeitsbeginn liefe dann durch. Für den Aufrufer ist die Position ohne Bedeutung: PostgREST
-- ruft ausschliesslich mit BENANNTEN Argumenten auf.
create or replace function public.backfill_grid_tariff(
  p_operator_id            text,
  p_netzebene              smallint,
  p_grundpreis_amount      numeric,
  p_grundpreis_unit        text,
  p_netzverlust_ct_per_kwh numeric,
  p_price_basis            text,
  p_valid_from             date,
  p_created_by             text,
  p_windows                jsonb,
  p_metering_variant       text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_oldest_from  date;
  v_oldest_id    uuid;
  v_operator     text;
  v_new_until    date;
  v_new_id       uuid;
  v_windows      int;
begin
  -- Ohne mindestens ein Zeitfenster ist die Tarifzeile unvollständig (Delta 5). Die Prüfung steht
  -- VOR jedem Schreibvorgang und vor der Sperre — ein Aufruf, der ohnehin nichts anlegen kann, soll
  -- keine andere Kombination blockieren.
  if p_windows is null
     or jsonb_typeof(p_windows) <> 'array'
     or jsonb_array_length(p_windows) = 0 then
    return jsonb_build_object('status', 'no_windows');
  end if;

  -- DERSELBE Schlüssel wie in `create_grid_tariff` (s. Kopf). `coalesce` auf den Leerstring, weil
  -- `metering_variant` bei NE 3-6 null ist und ein null-Anteil den ganzen Schlüssel null machte.
  perform pg_advisory_xact_lock(
    hashtext('grid_tariff:' || p_operator_id || ':' || p_netzebene::text ||
             ':' || coalesce(p_metering_variant, ''))
  );

  -- ⚠ ÜBER ALLE ZEILEN DER KOMBINATION — ausdrücklich OHNE `valid_until is null`.
  -- Genau hier sitzt der Unterschied zu `create_grid_tariff`, und genau hier wäre der Fehler aus
  -- dem Kopf dieser Datei entstanden. `order by valid_from asc limit 1` liefert den ÄLTESTEN Stand;
  -- `for update` ist neben `order by`/`limit` zulässig (anders als neben einem Aggregat, das in
  -- B21-2b mit 0A000 aufschlug — deshalb hier bewusst kein `min()`).
  select id, valid_from, operator_name
    into v_oldest_id, v_oldest_from, v_operator
    from public.grid_tariffs
   where operator_id = p_operator_id
     and netzebene = p_netzebene
     and metering_variant is not distinct from p_metering_variant
   order by valid_from asc
   limit 1
     for update;

  -- ⚠ KEIN STILLES ANLEGEN EINER ERSTEN ZEILE.
  -- Gibt es die Kombination überhaupt nicht, ist das kein Backfill, sondern eine Erstanlage — und
  -- dafür ist `create_grid_tariff` da. Hier durchgelassen entstünde eine Zeile mit `valid_until`
  -- aus dem Nichts (es gäbe keinen Nachfolger, an dem sie enden könnte) oder eine offene Zeile in
  -- der Vergangenheit. Beides wäre falsch; die Oberfläche bietet den Weg deshalb ausschliesslich
  -- an einer bestehenden Kombination an, und diese Zeile ist die zweite Schranke.
  if not found then
    return jsonb_build_object('status', 'no_existing_stand');
  end if;

  -- Die Richtung ist die UMGEKEHRTE zu `create_grid_tariff`: dort muss der neue Stand NACH dem
  -- offenen beginnen, hier VOR dem ältesten. Gleichheit ist beides Mal ausgeschlossen — eine zweite
  -- Zeile mit demselben `valid_from` wiese ohnehin der `unique nulls not distinct`-Constraint ab
  -- (B21-1); hier bekommt der Fall vorher eine Begründung, statt hinterher ein 23505 zu werden.
  if p_valid_from >= v_oldest_from then
    return jsonb_build_object(
      'status', 'not_before_oldest',
      'min_valid_from', v_oldest_from
    );
  end if;

  -- Lückenlos UND überlappungsfrei folgt daraus von selbst, spiegelbildlich zu `create_grid_tariff`:
  -- die neue Zeile endet am Tag VOR dem Beginn der bisher ältesten. `- 1` ist der einzige Wert, der
  -- beides zugleich leistet — der gleiche Tag überlappte, ein früherer risse eine Lücke.
  --
  -- ⚠ Die bestehende älteste Zeile wird dabei NICHT angefasst (kein UPDATE): Sie ist bereits
  -- korrekt datiert, und ihr `valid_until` — ob gesetzt oder offen — bleibt genau das, was es war.
  v_new_until := v_oldest_from - 1;

  begin
    insert into public.grid_tariffs (
      operator_id, operator_name, netzebene, metering_variant,
      grundpreis_amount, grundpreis_unit, netzverlust_ct_per_kwh, price_basis,
      valid_from, valid_until, created_by, backfilled_at
    ) values (
      p_operator_id, v_operator, p_netzebene, p_metering_variant,
      p_grundpreis_amount, p_grundpreis_unit, p_netzverlust_ct_per_kwh, p_price_basis,
      p_valid_from, v_new_until, p_created_by, now()
    )
    returning id into v_new_id;
  exception
    -- Über diesen Weg unerreichbar: ein `p_valid_from` KLEINER als das Minimum kann mit keinem
    -- bestehenden `valid_from` derselben Kombination zusammenfallen. Der Zweig bleibt trotzdem
    -- stehen — dieselbe Tiefenstaffelung wie `duplicate_valid_from` in B21-2b: Er fängt einen
    -- Bestand ab, der aus einem Eingriff von Hand stammt (etwa zwei Zeilen mit demselben Beginn).
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'duplicate_valid_from';
    -- Ein Wert ausserhalb der CHECKs aus B21-1 (Netzebene, Einheit, Preisbasis). Erreichbar nur an
    -- der Oberfläche vorbei — die Auswahlfelder lassen nichts anderes zu.
    when check_violation then
      raise exception using errcode = 'P0001', message = 'invalid_input';
  end;

  begin
    insert into public.grid_tariff_rate_windows (
      grid_tariff_id, label, month_day_from, month_day_to, time_from, time_to, ct_per_kwh, note
    )
    select v_new_id, w.label, w.month_day_from, w.month_day_to, w.time_from, w.time_to,
           w.ct_per_kwh, nullif(btrim(w.note), '')
      from jsonb_to_recordset(p_windows) as w(
        label          text,
        month_day_from text,
        month_day_to   text,
        time_from      time,
        time_to        time,
        ct_per_kwh     numeric,
        note           text
      );
    get diagnostics v_windows = row_count;
  exception
    -- Eine unbrauchbare Uhrzeit/Zahl im Fenster-Block. Der ganze Aufruf fällt damit weg — samt der
    -- oben bereits angelegten Zeile. Genau dafür ist die Klammer da.
    when data_exception or not_null_violation then
      raise exception using errcode = 'P0001', message = 'invalid_window';
  end;

  return jsonb_build_object(
    'status', 'backfilled',
    'id', v_new_id,
    'window_count', v_windows,
    'new_valid_until', v_new_until,
    -- Die Zeile, VOR der eingefügt wurde. Die Oberfläche nennt damit beide Enden der neuen
    -- Gültigkeit, ohne sie selbst ausrechnen zu müssen.
    'preceded_id', v_oldest_id,
    'preceded_valid_from', v_oldest_from
  );
end;
$$;

comment on function public.backfill_grid_tariff(
  text, smallint, numeric, text, numeric, text, date, text, jsonb, text
) is
  'B21-2e: Fügt einen HISTORISCHEN Netzbetreiber-Tarifstand samt Zeitfenstern VOR dem ältesten '
  'vorhandenen Stand derselben Kombination ein und setzt sein valid_until auf dessen valid_from '
  'minus einen Tag. Der Bezugspunkt ist das Minimum über ALLE Zeilen — offene UND geschlossene: '
  'eine Kombination ohne offenen Stand (der offene wurde gelöscht) bekommt sonst eine OFFENE Zeile '
  'in der Vergangenheit. Statuswerte: backfilled | not_before_oldest (mit min_valid_from) | '
  'no_existing_stand | no_windows; P0001: duplicate_valid_from, invalid_input, invalid_window. '
  'Eine Lücke MITTEN in der Historie bleibt unmöglich. SECURITY INVOKER, prüft KEINE Rolle — die '
  'Zugangsentscheidung liegt im Admin-Bereich von apps/web (DEPLOYMENT.md §3c).';

-- ── ⚠ KEIN NEUER TABELLEN-GRANT — gemessen, nicht angenommen ───────────────────────────────────
-- Gegen den lokalen Stack (PostgreSQL 17.6) in zurückgerollten Transaktionen Stufe für Stufe
-- nachgemessen, je Stufe GENAU EIN Recht entzogen und die Funktion echt aufgerufen:
--
--   volle Grants (Stand nach B21-2b/2c/2d)     → OK, status backfilled
--   ohne INSERT auf grid_tariffs               → 42501 grid_tariffs
--   ohne SELECT auf grid_tariffs               → 42501 grid_tariffs   ← die Suche nach dem Ältesten
--   ohne UPDATE auf grid_tariffs               → 42501 grid_tariffs   ← das `for update`
--   ohne INSERT auf grid_tariff_rate_windows   → 42501 grid_tariff_rate_windows
--   ohne SELECT auf grid_tariff_rate_windows   → OK, kein Unterschied
--   ohne DELETE auf grid_tariffs               → OK, kein Unterschied
--
--   ⇒ vier Rechte, alle seit B21-2b vergeben. Diese Migration braucht KEIN neues Tabellenrecht.
--
-- ⚠ UNTERSCHIED ZU `add_grid_tariff_rate_window`, der leicht zu übersehen ist: DORT verlangt schon
-- das `returning id` DES INSERT ein SELECT auf `grid_tariff_rate_windows`. Diese Funktion braucht
-- es NICHT, weil sie die Fenster ohne `returning` einfügt und über `get diagnostics` zählt (wie
-- `create_grid_tariff`). Das Recht steht trotzdem — es stammt aus B21-2c und wird hier nur nicht
-- gebraucht. Ein Grant „vorsichtshalber" wäre kein harmloser Überschuss, sondern ein falscher Beleg
-- (B21-2b); dass DELETE auf `grid_tariffs` (B21-2c) hier ebenfalls nichts tut, ist mitgemessen.
--
-- Funktionen im `public`-Schema bekommen EXECUTE per Default an PUBLIC und über Supabases
-- ALTER DEFAULT PRIVILEGES zusätzlich an anon/authenticated/service_role — dieselbe Falle wie bei
-- den drei Geschwisterfunktionen. Ohne den `revoke` stünde dieser Weg jedem Browser-Client offen.
-- Wirksam wäre er dort nicht (SECURITY INVOKER: `anon` hat kein INSERT) — aber „läuft ins Leere"
-- ist keine Zugangsregel, sondern ein Zufall der aktuellen Grants.
revoke all on function public.backfill_grid_tariff(
  text, smallint, numeric, text, numeric, text, date, text, jsonb, text
) from public, anon, authenticated;

grant execute on function public.backfill_grid_tariff(
  text, smallint, numeric, text, numeric, text, date, text, jsonb, text
) to service_role;
