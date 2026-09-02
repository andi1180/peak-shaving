-- B21-2d — Ein Zeitfenster nachträglich an einen Tarifstand hängen, plus ein Notizfeld.
--
-- Kanonische fachliche Quelle: `Pflichtenheft_Kalkulator_Delta_Tarifoptimierung.md`, Delta 5
-- (Datenmodell + Admin-Pflege) und Delta 10 (Admin-UI Tarifdaten). Betriebsseite: `DEPLOYMENT.md` §3c.
--
-- ── WAS HIER ENTSTEHT ───────────────────────────────────────────────────────────────────────────
--   TEIL 1  public.grid_tariff_rate_windows.note        — Freitext je Zeitfenster, nullable
--   TEIL 2  public.add_grid_tariff_rate_window(...)     — der Guard: nur an einen OFFENEN Stand
--   TEIL 3  public.create_grid_tariff(...) nachgezogen  — damit auch Fenster der ERSTEN Stunde
--                                                         eine Notiz tragen können
--
-- Keine neue Tabelle, kein Trigger, keine Policy, KEIN neuer Tabellen-Grant, keine Zeile Inhalt.
-- `public.delete_grid_tariff`, das Löschprotokoll, `public.spot_prices` und `platform` sind NICHT
-- angefasst.
--
-- ── ⚠ WARUM DAS HINZUFÜGEN KEINE ATOMARITÄTS-FUNKTION BRAUCHT (im Unterschied zu B21-2b/2c) ─────
-- `create_grid_tariff` und `delete_grid_tariff` sind Datenbankfunktionen, weil sie MEHRERE
-- Schreibvorgänge klammern müssen (Vorgängerin schliessen + Zeile + Fenster; bzw. protokollieren +
-- löschen). Über PostgREST wäre jeder einzelne davon seine eigene Transaktion, und ein Abbruch
-- dazwischen hinterliesse einen halben Zustand.
--
-- Ein Fenster HINZUFÜGEN ist genau EIN INSERT. Es gibt nichts zu klammern, und ein Advisory-Lock
-- schützte nichts: zwei gleichzeitige Aufrufe legen zwei Fenster an, und das ist kein Fehlerfall,
-- sondern zweimal dasselbe legitime Ergebnis (mehrere Fenster je Tarifzeile sind der Regelfall).
-- Ein Löschprotokoll gibt es aus demselben Grund nicht: Es wird nichts entfernt.
--
-- ── ⚠ WOFÜR ES DIE FUNKTION TROTZDEM GIBT: DER EINE GUARD ──────────────────────────────────────
-- Ein Zeitfenster darf NUR an einen OFFENEN Stand (`valid_until is null`). Ein abgelöster Stand ist
-- eine abgeschlossene Aussage über einen VERGANGENEN Zeitraum — ein nachträglich angehängtes
-- Fenster änderte rückwirkend den Preis, mit dem einem Kunden gegenüber bereits gerechnet wurde,
-- und zwar ohne dass irgendetwas danach aussähe: In der Liste stünde die Zeile unverändert da, nur
-- mit einem Fenster mehr. Eine 2026 archivierte Analyse (B14) beriefe sich damit auf einen Stand,
-- den es 2026 so nicht gab.
--
-- Der Guard steht deshalb in der DATENBANK und nicht (nur) in der Oberfläche: Die Oberfläche bietet
-- den Weg an einem abgelösten Stand gar nicht erst an, aber „wird nicht angeboten" ist keine Regel,
-- sondern der Zustand einer Ansicht. Dieselbe Tiefenstaffelung wie bei `duplicate_valid_from` in
-- B21-2b: Der Zweig ist über die Oberfläche unerreichbar und bleibt trotzdem stehen.
--
-- ── ⚠ ES GIBT WEITERHIN KEIN DELETE AUF grid_tariff_rate_windows, FÜR NIEMANDEN ────────────────
-- Damit ist ein hinzugefügtes Fenster nicht einzeln zurücknehmbar. Rückgängig macht es nur das
-- Löschen des GANZEN Tarifstands über `public.delete_grid_tariff` (B21-2c) — protokolliert, mit
-- vollständigem Abzug. Das ist ausdrücklich so gewollt und steht wortgleich im Bestätigungstext des
-- Formulars: Wer ein Fenster anhängt, ändert die Preisgrundlage, und diese Änderung soll denselben
-- Weg zurück nehmen wie jede andere.
--
-- ── SECURITY INVOKER, wie die beiden Geschwisterfunktionen ─────────────────────────────────────
-- Prüft KEINE Rolle. Der Aufrufer ist `service_role` und trägt kein JWT; `auth.uid()` ist leer, es
-- gibt in der Datenbank nichts zu prüfen. Die Zugangsentscheidung liegt in `apps/web`
-- (`lib/admin/grid-tariffs-actions.ts`, `isCurrentUserAdmin()` als erste Anweisung, fail closed).
-- Diese Datei ERWEITERT damit die eine bewusste Abweichung des Systems (DEPLOYMENT.md §3c) — sie
-- schafft keine zweite: derselbe Aufruferkreis, dieselbe Prüfstelle, dieselbe Datei.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — die Notiz
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ── ⚠ SIE HEISST `note` UND NICHT `comment` ────────────────────────────────────────────────────
-- `COMMENT` ist ein SQL-Schlüsselwort (`comment on table …`). Eine so benannte Spalte wäre in jeder
-- Handabfrage ein Anführungszeichen-Fall und in jedem `to_jsonb`-Abzug eine Stolperstelle, ohne
-- dafür irgendetwas zu gewinnen.
--
-- ── NULLABLE, KEIN DEFAULT, KEIN CHECK, KEINE LÄNGENGRENZE ─────────────────────────────────────
-- Kein Default: `null` heisst „keine Notiz", ein Leerstring hiesse „es wurde eine leere Notiz
-- eingetragen" — zwei verschiedene Aussagen, und nur eine davon ist wahr. Keine Längengrenze in der
-- Datenbank, weil eine dort gesetzte Zahl den Eintragenden mit einem rohen 23514 abwiese; die
-- Grenze steht in `gridTariffWindowSchema` und meldet sich AM FELD — dieselbe Aufteilung wie bei
-- `label` (B21-2b).
--
-- Wozu: Ein Preisblatt trägt Fussnoten („gilt nur für Kund*innen auf Netzebene 7"), und ein Jahr
-- später ist nicht mehr rekonstruierbar, warum ein Fenster genau so zugeschnitten wurde. Die Notiz
-- ist für Menschen; sie geht in KEINE Berechnung ein (der Kalkulator liest sie nicht, s. die
-- Spaltenliste in `apps/website/lib/tariff-data/grid-tariffs.ts`).
alter table public.grid_tariff_rate_windows add column note text;

comment on column public.grid_tariff_rate_windows.note is
  'B21-2d: Freitext-Notiz zum Zeitfenster (Herkunft, Fussnote des Preisblatts, Begründung des '
  'Zuschnitts). Für Menschen, nicht für die Rechnung — der Kalkulator liest die Spalte nicht. '
  'null = keine Notiz; ein Leerstring wäre eine andere Aussage und entsteht nicht.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — public.add_grid_tariff_rate_window
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ── KEIN TREFFER IST EIN FEHLER, KEIN STILLER ERFOLG ────────────────────────────────────────────
-- Dieselbe Haltung wie in `delete_grid_tariff`: Ein INSERT gegen eine Tarifzeile, die es nicht mehr
-- gibt, scheiterte zwar am Fremdschlüssel (23503) — aber mit einer Meldung, die der Oberfläche
-- nichts sagt. `not_found` ist die Auskunft, aus der ein Satz wird („bitte die Seite neu laden").
--
-- ── `for update` HÄLT DEN STAND FÜR DIE DAUER DER PRÜFUNG ──────────────────────────────────────
-- Gelesen wird `valid_until`, geschrieben wird abhängig davon. Ohne Zeilensperre könnte zwischen
-- Prüfung und INSERT ein `create_grid_tariff` desselben Kombinations-Schlüssels den Stand ablösen —
-- und das Fenster landete an einer Zeile, die in dem Moment, in dem es entsteht, bereits Geschichte
-- ist. Das UPDATE-Recht dafür stammt aus B21-2b und wird hier mitbenutzt (wie schon in B21-2c).
create or replace function public.add_grid_tariff_rate_window(
  p_tariff_id      uuid,
  p_label          text,
  p_time_from      time,
  p_time_to        time,
  p_ct_per_kwh     numeric,
  -- ⚠ DIE DREI OPTIONALEN STEHEN AM ENDE, und das ist kein Stilentscheid: PostgreSQL verlangt, dass
  -- alle Parameter NACH einem mit Vorgabewert ebenfalls einen tragen. Weiter vorne stehend zwängen
  -- sie also auch `p_time_from`/`p_time_to`/`p_ct_per_kwh` zu optionalen Parametern — ein Aufruf
  -- ohne Uhrzeit liefe dann durch. Dieselbe Überlegung und dieselbe Anordnung wie bei
  -- `p_metering_variant` in `create_grid_tariff` (B21-2b). Für den Aufrufer ist die Position ohne
  -- Bedeutung: PostgREST ruft ausschliesslich mit BENANNTEN Argumenten auf, und die erzeugten
  -- TypeScript-Typen führen die drei dadurch korrekt als optional.
  p_month_day_from text default null,
  p_month_day_to   text default null,
  p_note           text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_valid_until date;
  v_window_id   uuid;
  v_count       int;
begin
  -- `select … into` setzt FOUND: das unterscheidet „Zeile fehlt" von „Zeile ist offen"
  -- (`valid_until is null`) — an `v_valid_until` allein wären beide nicht auseinanderzuhalten.
  select valid_until into v_valid_until
    from public.grid_tariffs
   where id = p_tariff_id
     for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if v_valid_until is not null then
    -- Ein abgelöster Stand ist eine abgeschlossene Aussage über einen vergangenen Zeitraum (s. Kopf).
    raise exception using errcode = 'P0001', message = 'closed_tariff';
  end if;

  insert into public.grid_tariff_rate_windows (
    grid_tariff_id, label, month_day_from, month_day_to, time_from, time_to, ct_per_kwh, note
  ) values (
    p_tariff_id, p_label, p_month_day_from, p_month_day_to, p_time_from, p_time_to, p_ct_per_kwh,
    nullif(btrim(p_note), '')
  )
  returning id into v_window_id;

  -- Die Zahl der Fenster NACH dem Anhängen — die Oberfläche sagt damit, wie viele die Zeile jetzt
  -- trägt, statt „hinzugefügt" ohne Bezugsgrösse zu melden. Das SELECT-Recht auf dieser Tabelle
  -- stammt aus B21-2c (dort für den Löschabzug) und wird hier mitbenutzt.
  select count(*)::int into v_count
    from public.grid_tariff_rate_windows
   where grid_tariff_id = p_tariff_id;

  return jsonb_build_object(
    'status', 'added',
    'id', v_window_id,
    'grid_tariff_id', p_tariff_id,
    'window_count', v_count
  );
end;
$$;

comment on function public.add_grid_tariff_rate_window(uuid, text, time, time, numeric, text, text, text) is
  'B21-2d: Hängt GENAU EIN Zeitfenster an einen Netzbetreiber-Tarifstand. Nur an einen OFFENEN '
  'Stand (valid_until is null) — ein abgelöster Stand ist eine abgeschlossene Aussage über einen '
  'vergangenen Zeitraum, ein nachträgliches Fenster änderte rückwirkend eine bereits gerechnete '
  'Preisgrundlage (P0001 closed_tariff). Unbekannte Kennung: P0001 not_found. SECURITY INVOKER, '
  'prüft KEINE Rolle — die Zugangsentscheidung liegt im Admin-Bereich von apps/web '
  '(DEPLOYMENT.md §3c). Es gibt weiterhin KEIN delete auf grid_tariff_rate_windows: rückgängig '
  'macht das nur das Löschen des ganzen Tarifstands (public.delete_grid_tariff, protokolliert).';

-- ── ⚠ KEIN NEUER TABELLEN-GRANT — gemessen, nicht angenommen ───────────────────────────────────
-- Alle drei Rechte, die diese Funktion braucht, stehen bereits:
--
--   grid_tariffs             SELECT  (B21-2b) → das `select valid_until`
--   grid_tariffs             UPDATE  (B21-2b) → das `for update` verlangt es (Befund aus B21-2c)
--   grid_tariff_rate_windows INSERT  (B21-2b) → das Anhängen
--   grid_tariff_rate_windows SELECT  (B21-2c) → s. den Nebenbefund gleich darunter
--
-- Stufenmessung im Kopf von `packages/db-tests/src/grid-tariff-add-window.test.ts`: je Stufe GENAU
-- ein Recht entzogen und die Funktion echt aufgerufen. Ein Grant „vorsichtshalber" wäre hier kein
-- harmloser Überschuss, sondern ein falscher Beleg (B21-2b).
--
-- ⚠ NEBENBEFUND, beim Messen aufgeschlagen und deshalb hier und nicht im Kopf geraten: Das SELECT
-- auf `grid_tariff_rate_windows` verlangt schon das `returning id` DES INSERT — nicht erst die
-- Zählabfrage darunter (der 42501 trifft die INSERT-Anweisung, nicht das `count(*)`). Wer die
-- Zählung je entfernt, weil sie entbehrlich scheint, wird das Recht trotzdem brauchen.
--
-- Funktionen im `public`-Schema bekommen EXECUTE per Default an PUBLIC und über Supabases
-- ALTER DEFAULT PRIVILEGES zusätzlich an anon/authenticated/service_role — dieselbe Falle wie bei
-- create_grid_tariff und delete_grid_tariff. Ohne den `revoke` stünde dieser Weg jedem
-- Browser-Client offen. Wirksam wäre er dort nicht (SECURITY INVOKER: `anon` hat kein INSERT) —
-- aber „läuft ins Leere" ist keine Zugangsregel, sondern ein Zufall der aktuellen Grants.
revoke all on function public.add_grid_tariff_rate_window(
  uuid, text, time, time, numeric, text, text, text
) from public, anon, authenticated;

grant execute on function public.add_grid_tariff_rate_window(
  uuid, text, time, time, numeric, text, text, text
) to service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — public.create_grid_tariff trägt die Notiz mit
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ── ⚠ WARUM DAS HIER MIT MUSS UND NICHT „SPÄTER AUCH NOCH" ─────────────────────────────────────
-- Ohne diesen Nachtrag könnten NUR nachträglich angehängte Fenster eine Notiz tragen, von Anfang an
-- angelegte dagegen nie. Zwei Fenster derselben Tarifzeile unterschieden sich dann in ihrer
-- Erfassbarkeit — und zwar nach einem Merkmal, das ein Leser der Liste nicht sehen kann (WANN das
-- Fenster entstanden ist). Ein leeres Notizfeld hiesse dort „keine Notiz eingetragen" statt „konnte
-- damals keine tragen".
--
-- `create or replace` bei UNVERÄNDERTER Signatur: die Parameterliste, ihre Typen und ihre
-- Reihenfolge bleiben Zeichen für Zeichen gleich, die EXECUTE-Grants bleiben damit bestehen
-- (Muster B3-2). Geändert sind GENAU zwei Zeilen im Rumpf: die Spaltenliste des INSERT und die
-- Feldliste von `jsonb_to_recordset`.
--
-- ⚠ Ein Aufrufer, der `note` NICHT mitschickt, bleibt gültig: `jsonb_to_recordset` liefert für ein
-- fehlendes Feld `null`, und die Spalte ist nullable. Der bestehende Aufruf aus
-- `createGridTariffAction` und jeder Fixture-Aufruf im DB-Gate laufen unverändert durch.
create or replace function public.create_grid_tariff(
  p_operator_id            text,
  p_operator_name          text,
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
  v_latest_open  date;
  v_closed_until date := p_valid_from - 1;
  v_closed_ids   uuid[];
  v_new_id       uuid;
  v_windows      int;
begin
  -- Ohne mindestens ein Zeitfenster ist die Tarifzeile unvollständig (Delta 5: die zeitabhängige
  -- Arbeitspreis-Seite des Netzentgelts). Die Prüfung steht VOR jedem Schreibvorgang — es soll
  -- nicht erst eine Vorgängerin geschlossen werden, um dann am letzten Schritt zu scheitern.
  if p_windows is null
     or jsonb_typeof(p_windows) <> 'array'
     or jsonb_array_length(p_windows) = 0 then
    return jsonb_build_object('status', 'no_windows');
  end if;

  -- Serialisiert genau diese Kombination für die Dauer der Transaktion (s. Migration 20260828090000).
  perform pg_advisory_xact_lock(
    hashtext('grid_tariff:' || p_operator_id || ':' || p_netzebene::text ||
             ':' || coalesce(p_metering_variant, ''))
  );

  -- Die Sperre steht IM Unterausdruck, nicht am Aggregat: `for update` ist neben einer
  -- Aggregatfunktion nicht zulaessig (0A000).
  select array_agg(id), max(valid_from)
    into v_closed_ids, v_latest_open
    from (
      select id, valid_from
        from public.grid_tariffs
       where operator_id = p_operator_id
         and netzebene = p_netzebene
         and metering_variant is not distinct from p_metering_variant
         and valid_until is null
         for update
    ) offen;

  if v_latest_open is not null and p_valid_from <= v_latest_open then
    -- Bewusst OHNE Schreibvorgang zurück: eine abgelehnte Anlage darf die bestehende Lage nicht
    -- verändert haben.
    return jsonb_build_object(
      'status', 'invalid_valid_from',
      'open_valid_from', v_latest_open
    );
  end if;

  if v_closed_ids is not null then
    update public.grid_tariffs
       set valid_until = v_closed_until
     where id = any(v_closed_ids);
  end if;

  begin
    insert into public.grid_tariffs (
      operator_id, operator_name, netzebene, metering_variant,
      grundpreis_amount, grundpreis_unit, netzverlust_ct_per_kwh, price_basis,
      valid_from, created_by
    ) values (
      p_operator_id, p_operator_name, p_netzebene, p_metering_variant,
      p_grundpreis_amount, p_grundpreis_unit, p_netzverlust_ct_per_kwh, p_price_basis,
      p_valid_from, p_created_by
    )
    returning id into v_new_id;
  exception
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'duplicate_valid_from';
    when check_violation then
      raise exception using errcode = 'P0001', message = 'invalid_input';
  end;

  begin
    -- ⚠ B21-2d: `note` ist hier NEU. `jsonb_to_recordset` liefert für ein fehlendes Feld null, ein
    -- Aufrufer ohne Notiz bleibt damit unverändert gültig.
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
    when data_exception or not_null_violation then
      raise exception using errcode = 'P0001', message = 'invalid_window';
  end;

  return jsonb_build_object(
    'status', 'created',
    'id', v_new_id,
    'window_count', v_windows,
    'closed_count', coalesce(array_length(v_closed_ids, 1), 0),
    'closed_valid_until', case when v_closed_ids is null then null else v_closed_until end
  );
end;
$$;
