-- B21-2b — Schreibweg für die Netzbetreiber-Tarife: der Admin-Pflegeweg.
--
-- Kanonische fachliche Quelle: `Pflichtenheft_Kalkulator_Delta_Tarifoptimierung.md`, Delta 5
-- (Datenmodell + Absatz „Admin-Pflege") und Delta 10 (Admin-UI Tarifdaten).
-- Bauabschnitt und Reihenfolge: `Fahrplan_2026.md`, Zeile B21.
--
-- ── WAS HIER ENTSTEHT ───────────────────────────────────────────────────────────────────────────
--   TEIL 1  public.create_grid_tariff(...)  — EIN Aufruf, EINE Transaktion: alte Zeile schliessen,
--                                             neue Zeile anlegen, ihre Zeitfenster anlegen.
--   TEIL 2  Die Rechte, die dieser Weg braucht — gemessen, nicht angenommen.
--
-- Kein Trigger, keine Spalte, keine Policy, keine Zeile Inhalt. `public.spot_prices` wird NICHT
-- angefasst (der aWATTar-Sync aus B21-2a bleibt unverändert), `platform` ebenfalls nicht.
--
-- ── ⚠ WARUM ES ÜBERHAUPT EINE DATENBANKFUNKTION GIBT — ATOMARITÄT, NICHT KONVENTION ─────────────
-- B21-1 hat für diese Tabellen bewusst KEIN Wrapper-Muster gewählt: sie tragen veröffentlichte
-- Preisblätter ohne Personenbezug und werden per direktem RLS-Select gelesen. Diese Entscheidung
-- gilt für das LESEN unverändert weiter — `apps/website` und die Admin-Liste lesen weiterhin direkt.
--
-- Für das SCHREIBEN trägt sie nicht, und der Grund ist keine Stilfrage:
--
--   Ein Tarifstand entsteht aus DREI Schreibvorgängen (Vorgängerin schliessen, neue Zeile anlegen,
--   1..n Zeitfenster anlegen). Über PostgREST ist jeder `.insert()`/`.update()` seine EIGENE
--   Transaktion — es gibt keinen Weg, drei Aufrufe zu klammern.
--
-- Bräche der dritte Schritt ab, bliebe eine Tarifzeile OHNE Zeitfenster stehen: eine Netzentgelt-
-- Seite ohne Arbeitspreis, die die Engine (Delta 4) als vollständig lesen würde. Und die
-- Vorgängerin wäre bereits geschlossen — für den Zeitraum dazwischen gäbe es dann eine Zeile, die
-- nichts sagt, statt gar keiner. „Keine Berechnungsgrundlage" ist ein sicherer Zustand (B21-1);
-- „eine halbe Berechnungsgrundlage" ist es nicht.
--
-- Eine kompensierende Aufräum-Löschung wäre kein Ersatz: sie bräuchte ein DELETE-Recht, das hier
-- ausdrücklich niemand hat, und sie wäre selbst nicht atomar.
--
-- ── ⚠ SECURITY INVOKER — UND WAS DAS FÜR DIE AUTORISIERUNG BEDEUTET ─────────────────────────────
-- Die Funktion läuft mit den Rechten ihres AUFRUFERS, nicht denen des Eigentümers. Sie ist damit
-- KEIN Wrapper im Sinne von `platform`: sie verschafft niemandem Rechte, die er nicht schon hat,
-- und sie prüft AUSDRÜCKLICH KEINE Rolle.
--
-- Das ist eine bewusste Abweichung von jedem bisherigen Admin-Schreibweg, und sie muss offen
-- dastehen: Die `admin_*`-Wrapper in `platform` sind `authenticated`-only und rufen
-- `platform.is_admin()` als erste Anweisung auf — die Autorisierung hängt dort NICHT am
-- Anwendungscode. Hier ist der Aufrufer `service_role` und trägt gar kein JWT; `auth.uid()` ist
-- leer, es gibt nichts zu prüfen.
--
--   ⇒ Die Zugangsentscheidung liegt vollständig in `apps/web`:
--       `app/admin/(intern)/layout.tsx`        → die Schranke des Bereichs
--       `lib/admin/grid-tariffs-actions.ts`    → `isCurrentUserAdmin()` VOR dem Anlegen des Clients
--
-- Warum trotzdem so: Diese Tabellen liegen in `public` und werden von `anon` gelesen; ein
-- SECURITY-DEFINER-Wrapper mit `authenticated`-Grant führte für Referenzdaten ohne Personenbezug
-- eine zweite Aufrufkonvention ein, die B21-1 gerade vermieden hat. Und der Kreis der Aufrufer ist
-- eng: die Funktion hat EXECUTE nur für `service_role`, und `service_role` erreicht die Anwendung
-- ausschliesslich über `lib/supabase/service-role.ts`, dessen Importe eine ESLint-Regel begrenzt.
--
-- ── WAS AUSDRÜCKLICH NICHT ENTSTEHT ─────────────────────────────────────────────────────────────
-- KEIN Ändern und KEIN Löschen bestehender Zeilen. Es gibt weder ein `delete`-Grant noch eine
-- Funktion dafür — auch nicht für `service_role`. Ein Tarifstand ist eine Aussage über einen
-- Zeitraum; eine 2026 archivierte Analyse (B14) muss 2028 noch sagen können, welcher Stand ihr
-- zugrunde lag. Eine rückwirkende Korrektur bleibt bewusst ein seltener Eingriff von Hand, kein
-- Knopf: sie ändert nachträglich, was einem Kunden gegenüber bereits gerechnet wurde.
--
-- KEIN `retail_tariffs` / Stromanbieter-Tarife (Delta 5 nennt beides gemeinsam; für diesen
-- Bauabschnitt ausdrücklich entschieden, nur die Netzbetreiber-Seite zu bauen).

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — public.create_grid_tariff
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ── DIE EFFEKTIV-DATIERUNG PASSIERT HIER, NICHT IM ANWENDUNGSCODE ───────────────────────────────
-- Existiert für dieselbe Kombination (`operator_id`, `netzebene`, `metering_variant`) eine offene
-- Zeile (`valid_until is null`), bekommt sie in DERSELBEN Transaktion `valid_until = p_valid_from
-- - 1 Tag`. Kein Zwei-Schritt-Weg über die Oberfläche: zwischen „neue Zeile angelegt" und „alte
-- geschlossen" gäbe es sonst einen Moment mit ZWEI gültigen Zeilen — genau den Zustand, den der
-- `unique nulls not distinct`-Constraint aus B21-1 verhindern soll, und in dem die Sortierreihenfolge
-- einer Abfrage entscheidet, welcher Leistungspreis in eine Analyse eingeht.
--
-- Lückenlos UND überlappungsfrei folgt daraus von selbst: Die alte Zeile endet am Tag VOR dem
-- Beginn der neuen. `valid_from - 1` ist der einzige Wert, der beides zugleich leistet — ein
-- gleicher Tag überlappte, ein späterer Tag risse eine Lücke.
--
-- ── DIE FUNKTION HÄNGT NUR AN, SIE KORRIGIERT NICHT ─────────────────────────────────────────────
-- `p_valid_from` muss NACH dem `valid_from` der offenen Zeile liegen. Sonst entstünde eine
-- geschlossene Zeile, deren Ende vor ihrem Anfang liegt.
--
-- Der GLEICHE Tag ist dabei kein Sonderwunsch dieser Funktion, sondern durch das Schema ohnehin
-- ausgeschlossen: `unique nulls not distinct (operator_id, netzebene, metering_variant, valid_from)`
-- weist eine zweite Zeile mit demselben Stand ab. Hier wird derselbe Fall nur VORHER und mit einer
-- Begründung beantwortet, statt hinterher als 23505.
--
-- ── DER SPERRSCHRITT IST NICHT DEKORATION ───────────────────────────────────────────────────────
-- Gelesen wird „gibt es eine offene Zeile?", geschrieben wird abhängig von der Antwort. Ohne Sperre
-- könnten zwei gleichzeitige Aufrufe beide „nein" lesen und beide eine offene Zeile anlegen — mit
-- verschiedenem `valid_from`, sodass der Unique-Constraint NICHT greift. Der Advisory-Lock
-- serialisiert genau die betroffene Kombination und nichts sonst; er endet mit der Transaktion.
--
-- ── MEHRERE OFFENE ZEILEN WERDEN ALLE GESCHLOSSEN ───────────────────────────────────────────────
-- Der Zustand soll nicht entstehen (s. o.), kann aber aus einem Eingriff von Hand stammen. Nur eine
-- davon zu schliessen hiesse, den Fehler zu halbieren und stehen zu lassen. Geprüft wird gegen die
-- SPÄTESTE der offenen Zeilen — sie ist die, hinter der die neue liegen muss.
--
-- ⚠ `p_metering_variant` STEHT AM ENDE, UND ZWAR NICHT AUS NACHLÄSSIGKEIT: Es ist der einzige
-- Parameter mit einem Vorgabewert (bei NE 3-6 gibt es keine Variante, dort gehört `null` in die
-- Spalte), und PostgreSQL verlangt, dass alle Parameter NACH einem mit Vorgabewert ebenfalls einen
-- tragen. Weiter vorne stehend zwänge es also auch `p_valid_from` und `p_windows` zu optionalen
-- Parametern — ein Aufruf ohne Gültigkeitsbeginn liefe dann durch. Für den Aufrufer ist die
-- Position ohne Bedeutung: PostgREST ruft ausschliesslich mit BENANNTEN Argumenten auf.
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

  -- Serialisiert genau diese Kombination für die Dauer der Transaktion (s. Kopf).
  -- `coalesce` auf den Leerstring, weil `metering_variant` bei NE 3–6 null ist und ein null-Anteil
  -- den ganzen Schlüssel null machte — dieselbe Falle, die das `nulls not distinct` motiviert.
  perform pg_advisory_xact_lock(
    hashtext('grid_tariff:' || p_operator_id || ':' || p_netzebene::text ||
             ':' || coalesce(p_metering_variant, ''))
  );

  -- Die Sperre steht IM Unterausdruck, nicht am Aggregat: `for update` ist neben einer
  -- Aggregatfunktion nicht zulaessig (0A000, beim Messen der Rechteflaeche aufgeschlagen). Der
  -- Advisory-Lock oben serialisiert diese Kombination bereits; das Zeilen-`for update` haelt
  -- zusaetzlich einen Schreiber auf, der an dieser Funktion vorbei ginge.
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
    -- Ein bereits ARCHIVIERTER Stand mit genau diesem `valid_from` (die offene Zeile liegt davor,
    -- die Ordnungsprüfung oben greift deshalb nicht). Der Constraint ist die Wahrheit; hier bekommt
    -- er nur einen Namen, mit dem die Oberfläche etwas anfangen kann.
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'duplicate_valid_from';
    -- Ein Wert ausserhalb der CHECKs aus B21-1 (Netzebene, Einheit, Preisbasis). Erreichbar nur an
    -- der Oberfläche vorbei — die Auswahlfelder lassen nichts anderes zu.
    when check_violation then
      raise exception using errcode = 'P0001', message = 'invalid_input';
  end;

  begin
    insert into public.grid_tariff_rate_windows (
      grid_tariff_id, label, month_day_from, month_day_to, time_from, time_to, ct_per_kwh
    )
    select v_new_id, w.label, w.month_day_from, w.month_day_to, w.time_from, w.time_to, w.ct_per_kwh
      from jsonb_to_recordset(p_windows) as w(
        label          text,
        month_day_from text,
        month_day_to   text,
        time_from      time,
        time_to        time,
        ct_per_kwh     numeric
      );
    get diagnostics v_windows = row_count;
  exception
    -- Eine unbrauchbare Uhrzeit/Zahl im Fenster-Block. Der ganze Aufruf fällt damit weg —
    -- einschliesslich der oben bereits geschlossenen Vorgängerin. Genau dafür ist die Klammer da.
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

comment on function public.create_grid_tariff(
  text, text, smallint, numeric, text, numeric, text, date, text, jsonb, text
) is
  'B21-2b: Legt einen Netzbetreiber-Tarifstand samt Zeitfenstern an und schliesst die bisher offene '
  'Zeile derselben Kombination in DERSELBEN Transaktion (valid_until = valid_from - 1). '
  'SECURITY INVOKER — prüft KEINE Rolle; die Zugangsentscheidung liegt im Admin-Bereich von '
  'apps/web. Nur Anhängen: kein Ändern, kein Löschen, keine rückwirkende Korrektur.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — Die Rechte
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ── ⚠ DIE RECHTEFLÄCHE IST GEMESSEN, NICHT ABGELEITET ──────────────────────────────────────────
-- Vorgesehen war `grant insert, update, select` auf BEIDE Tabellen. Gegen den lokalen Stack
-- (PostgreSQL 17.6) in einer zurückgerollten Transaktion Stufe für Stufe nachgemessen, indem die
-- Funktion oben unter `set local role service_role` tatsächlich AUFGERUFEN wurde (Ergebnistabelle
-- im Kopf von `packages/db-tests/src/grid-tariff-write-path.test.ts` und in `DEPLOYMENT.md` §3c):
--
--   grid_tariffs             braucht INSERT + SELECT + UPDATE
--   grid_tariff_rate_windows braucht NUR INSERT
--
-- `grid_tariffs` braucht SELECT nicht wegen einer Leseabfrage der Anwendung, sondern weil die
-- Funktion die offene Zeile SUCHT (`where … valid_until is null`) und die neue Zeile mit
-- `returning id` anlegt — beides liest Spalten. UPDATE braucht sie fürs Schliessen der Vorgängerin.
--
-- Für `grid_tariff_rate_windows` genügt INSERT: die Funktion liest dort nichts und ändert nichts.
-- Insbesondere braucht der Fremdschlüssel auf `grid_tariffs` KEIN `references`-Recht zur Laufzeit —
-- die Prüfung läuft im systemeigenen Constraint-Trigger, nicht mit den Rechten des Aufrufers
-- (ebenfalls gemessen: mit ausschliesslich INSERT läuft der Aufruf durch).
--
-- Ein SELECT-Grant „vorsichtshalber" wäre hier kein harmloser Überschuss, sondern ein falscher
-- Beleg: er behauptete, der Schreibweg lese diese Tabelle — und der nächste Umbau nähme das als
-- gegeben. Die kleinste Fläche, die den vorgesehenen Weg gehen kann, ist die richtige.
--
-- ── KEIN DELETE, FÜR NIEMANDEN ──────────────────────────────────────────────────────────────────
-- Auch nicht für `service_role`, und auch nicht auf den Zeitfenstern (obwohl deren `on delete
-- cascade` sie technisch mitnähme). Es gibt keinen Weg, einen einmal veröffentlichten Tarifstand
-- verschwinden zu lassen.
--
-- ── DIE CLIENT-ROLLEN BLEIBEN UNVERÄNDERT NUR LESEND ────────────────────────────────────────────
-- `anon` und `authenticated` behalten exakt `SELECT` auf beiden Tabellen. Der Admin-Bereich LIEST
-- über den angemeldeten Client (er hat SELECT seit B21-1) und SCHREIBT über `service_role` — das
-- ist dieselbe Trennung wie im Lead-Erfassungspfad.
grant insert, select, update on table public.grid_tariffs             to service_role;
grant insert                 on table public.grid_tariff_rate_windows to service_role;

-- Funktionen im `public`-Schema bekommen EXECUTE per Default an PUBLIC und über Supabases
-- ALTER DEFAULT PRIVILEGES zusätzlich an `anon`/`authenticated`/`service_role` — dieselbe Falle wie
-- bei den Tabellen in B21-1, seit T4-2 in einem Dutzend Migrationen dokumentiert. Der `revoke` ist
-- deshalb kein Zierrat: ohne ihn stünde die Funktion jedem Browser-Client offen.
--
-- Wirksam wäre sie dort nicht (SECURITY INVOKER: `anon` hat kein Schreibrecht, der erste INSERT
-- endete mit 42501) — aber „läuft ins Leere" ist keine Zugangsregel, sondern ein Zufall der
-- aktuellen Grants. Die Regel steht hier.
revoke all on function public.create_grid_tariff(
  text, text, smallint, numeric, text, numeric, text, date, text, jsonb, text
) from public, anon, authenticated;

grant execute on function public.create_grid_tariff(
  text, text, smallint, numeric, text, numeric, text, date, text, jsonb, text
) to service_role;
