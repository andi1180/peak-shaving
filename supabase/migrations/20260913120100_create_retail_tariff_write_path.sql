-- Schreibweg für den Lieferanten-Tarifkatalog: `public.create_retail_tariff`.
--
-- Kanonische fachliche Quelle: `Pflichtenheft_Kalkulator_Delta_Tarifoptimierung.md`, Delta 5
-- (Admin-Pflege) und Delta 10 (gemeinsames Admin-UI für Netzbetreiber- UND Stromanbieter-Tarife).
-- Gehört zur Nachbarmigration `…120000`, die die Tabelle anlegt.
--
-- ── WAS HIER ENTSTEHT ───────────────────────────────────────────────────────────────────────────
--   TEIL 1  public.create_retail_tariff(...) — EIN Aufruf, EINE Transaktion: offene Zeile
--                                              schliessen, neue anlegen.
--   TEIL 2  Die Rechte, die dieser Weg braucht — gemessen, nicht angenommen.
--
-- Keine Tabelle, keine Spalte, kein Trigger, keine Policy, keine Zeile Inhalt. `grid_tariffs`,
-- `grid_tariff_rate_windows`, `spot_prices` und `platform` werden NICHT angefasst; es entsteht kein
-- Anwendungscode (das Admin-UI ist der nächste Schritt).
--
-- ── ⚠ WARUM ES EINE DATENBANKFUNKTION BRAUCHT, OBWOHL ES NUR EIN INSERT IST ─────────────────────
-- Bei `create_grid_tariff` war die Begründung die Drei-Schritt-Atomarität (Zeile schliessen, Zeile
-- anlegen, Zeitfenster anlegen). Die trägt hier nicht — es gibt keine Zeitfenster. Zwei andere
-- tragen, und jede für sich genügt:
--
--   (1) DIE ENTSCHEIDUNG BERUHT AUF EINEM VORHERIGEN LESEN. Der Ablauf ist „offene Zeile suchen →
--       Reihenfolge prüfen → schliessen → anlegen". Über PostgREST wäre jeder Schritt seine eigene
--       Transaktion. Zwei gleichzeitige Aufrufe läsen beide „es gibt keine offene Zeile" und legten
--       beide eine an — mit VERSCHIEDENEM `valid_from`, sodass der Unique-Constraint NICHT greift.
--       Danach stünden zwei gleichzeitig gültige Vergleichspreise desselben Anbieters nebeneinander,
--       und welcher in eine Analyse einginge, entschiede die Sortierreihenfolge einer Abfrage.
--       Ein Advisory-Lock löst das — und den kann nur eine Funktion halten.
--
--   (2) EIN ABBRUCH ZWISCHEN SCHLIESSEN UND ANLEGEN HINTERLIESSE EINEN FALSCHEN BESTAND. Die
--       Vorgängerin trüge dann ein Ende, obwohl ihr nie etwas nachgefolgt ist: ein Preis, der als
--       abgelöst markiert ist, ohne dass es einen Nachfolger gäbe. Das ist nicht „keine Aussage",
--       sondern eine falsche.
--
-- Ausserdem ist die Effektiv-Datierung damit eine Eigenschaft der Datenbank und nicht eine Regel,
-- die jeder künftige Aufrufer neu erfinden müsste.
--
-- ── SECURITY INVOKER — die Autorisierung liegt im Anwendungscode ────────────────────────────────
-- Wie `create_grid_tariff` und aus denselben Gründen: Die Funktion läuft mit den Rechten ihres
-- Aufrufers, verschafft niemandem Rechte, die er nicht schon hat, und prüft AUSDRÜCKLICH KEINE
-- Rolle. Der Aufrufer ist `service_role` und trägt kein JWT — `auth.uid()` ist leer, es gibt in der
-- Datenbank nichts zu prüfen.
--
--   ⇒ Die Zugangsentscheidung fällt in `apps/web`, im Admin-Bereich, vor dem Anlegen des Clients
--     (`isCurrentUserAdmin()`, fail closed) — dieselbe eine Ausnahme, die DEPLOYMENT.md §3c für die
--     Netzbetreiber-Tarife beschreibt. Es entsteht KEINE zweite Art von Ausnahme: derselbe
--     Aufrufkreis, dieselbe eng geführte ESLint-Erlaubnisliste für den service_role-Client.
--
-- Die Alternative wäre ein Schreib-Grant für `authenticated` gewesen — der gälte für JEDES
-- angemeldete Konto und liesse sich nur mit einer RLS-Policy über `platform.is_admin()` einfangen,
-- also mit genau dem Wrapper-Muster, das für diese Referenzdaten-Tabellen verworfen wurde.
--
-- ── WAS AUSDRÜCKLICH NICHT ENTSTEHT ─────────────────────────────────────────────────────────────
-- KEIN Ändern und KEIN Löschen bestehender Zeilen, für keine Rolle: kein `delete`-Grant und keine
-- Funktion dafür. Ein Stand ist eine Aussage über einen Zeitraum, gegen die verglichen wurde.
--
-- ⚠ AUFLAGE AN DEN NÄCHSTEN SCHRITT (Staleness/`checked_at`). `service_role` bekommt unten UPDATE
-- auf `retail_tariffs` — nicht, um Zeilen zu ändern, sondern für das Schliessen der Vorgängerin und
-- die Zeilensperre. Über PostgREST liesse sich mit diesem Recht JEDE Spalte überschreiben, auch der
-- Preis selbst. Wer die Neuprüfung eines unveränderten Stands baut, baut sie deshalb als EIGENE
-- Funktion, die nichts anfasst ausser `checked_at` — und nicht als `.update()` aus dem
-- Anwendungscode. Sonst wäre „nie in-place überschrieben" eine Konvention statt einer Regel.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — public.create_retail_tariff
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ── DIE EFFEKTIV-DATIERUNG PASSIERT HIER ───────────────────────────────────────────────────────
-- Existiert für dieselbe Kombination (`provider_id`, `segment`) eine offene Zeile
-- (`valid_until is null`), bekommt sie in DERSELBEN Transaktion `valid_until = p_valid_from - 1`.
-- Lückenlos UND überlappungsfrei folgt daraus von selbst: Der alte Preis endet am Tag VOR dem
-- Beginn des neuen. `valid_from - 1` ist der einzige Wert, der beides zugleich leistet — derselbe
-- Tag überlappte, ein späterer risse eine Lücke.
--
-- ── DIE FUNKTION HÄNGT NUR AN, SIE KORRIGIERT NICHT ────────────────────────────────────────────
-- `p_valid_from` muss NACH dem `valid_from` der offenen Zeile liegen; sonst entstünde eine
-- geschlossene Zeile, deren Ende vor ihrem Anfang liegt. Der GLEICHE Tag ist durch den
-- Unique-Constraint ohnehin ausgeschlossen — hier wird er nur VORHER und mit einer Begründung
-- beantwortet, statt hinterher als 23505.
--
-- ── MEHRERE OFFENE ZEILEN WERDEN ALLE GESCHLOSSEN ──────────────────────────────────────────────
-- Der Zustand soll nicht entstehen, kann aber aus einem Eingriff von Hand stammen. Nur eine davon
-- zu schliessen hiesse, den Fehler zu halbieren und stehen zu lassen. Geprüft wird gegen die
-- SPÄTESTE — sie ist die, hinter der die neue liegen muss.
--
-- ── ALLE PARAMETER SIND PFLICHT ────────────────────────────────────────────────────────────────
-- Es gibt keinen mit Vorgabewert, und damit auch nicht die Reihenfolge-Falle aus
-- `create_grid_tariff` (dort musste `p_metering_variant` ans Ende, weil PostgreSQL nach einem
-- Parameter mit Vorgabewert für alle weiteren einen verlangt — sonst wäre ein Aufruf ohne
-- Gültigkeitsbeginn durchgelaufen). Die Reihenfolge hier folgt schlicht der Spaltenreihenfolge;
-- für den Aufrufer ist sie ohne Bedeutung, PostgREST ruft mit BENANNTEN Argumenten auf.
create or replace function public.create_retail_tariff(
  p_provider_id             text,
  p_provider_name           text,
  p_segment                 text,
  p_energy_price_ct_per_kwh numeric,
  p_base_fee_eur_per_month  numeric,
  p_price_basis             text,
  p_source_url              text,
  p_valid_from              date,
  p_created_by              text
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
begin
  -- Serialisiert genau diese Kombination für die Dauer der Transaktion (s. Kopf).
  -- `coalesce` nicht, weil `segment` legitim null sein könnte — es ist `not null` — sondern weil
  -- `hashtext` strikt ist: ein null-Anteil machte den ganzen Schlüssel null, und
  -- `pg_advisory_xact_lock(null)` nähme LAUTLOS gar keine Sperre. Ein fehlerhafter Aufruf soll am
  -- INSERT scheitern, nicht vorher die Serialisierung verlieren.
  perform pg_advisory_xact_lock(
    hashtext('retail_tariff:' || coalesce(p_provider_id, '') || ':' || coalesce(p_segment, ''))
  );

  -- Die Sperre steht IM Unterausdruck, nicht am Aggregat: `for update` ist neben einer
  -- Aggregatfunktion nicht zulässig (0A000 — in B21-2b beim Messen aufgeschlagen). Der
  -- Advisory-Lock oben serialisiert diese Kombination bereits; das Zeilen-`for update` hält
  -- zusätzlich einen Schreiber auf, der an dieser Funktion vorbeiginge.
  select array_agg(id), max(valid_from)
    into v_closed_ids, v_latest_open
    from (
      select id, valid_from
        from public.retail_tariffs
       where provider_id = p_provider_id
         and segment = p_segment
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
    -- Angefasst wird AUSSCHLIESSLICH `valid_until`. Insbesondere bleibt `checked_at` der
    -- Vorgängerin stehen: Ablösen ist keine Neuprüfung.
    update public.retail_tariffs
       set valid_until = v_closed_until
     where id = any(v_closed_ids);
  end if;

  begin
    -- `checked_at` wird bewusst NICHT gesetzt und läuft in seinen Default `now()`. Für einen neu
    -- eingetragenen Stand ist „gerade eben bestätigt" die Wahrheit; ein Parameter dafür wäre eine
    -- Einladung, ein älteres Datum zu behaupten.
    insert into public.retail_tariffs (
      provider_id, provider_name, segment, energy_price_ct_per_kwh, base_fee_eur_per_month,
      price_basis, source_url, valid_from, created_by
    ) values (
      p_provider_id, p_provider_name, p_segment, p_energy_price_ct_per_kwh, p_base_fee_eur_per_month,
      p_price_basis, p_source_url, p_valid_from, p_created_by
    )
    returning id into v_new_id;
  exception
    -- Ein bereits ARCHIVIERTER Stand mit genau diesem `valid_from` — die offene Zeile liegt davor,
    -- die Ordnungsprüfung oben greift deshalb nicht. Der Constraint ist die Wahrheit; hier bekommt
    -- er nur einen Namen, mit dem die Oberfläche etwas anfangen kann.
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'duplicate_valid_from';
    -- Ein Wert ausserhalb der CHECKs der Tabelle: Segment, Preisbasis oder ein leerer Quellenbeleg.
    -- Erreichbar nur an der Oberfläche vorbei — deren Auswahlfelder lassen nichts anderes zu.
    when check_violation then
      raise exception using errcode = 'P0001', message = 'invalid_input';
  end;

  return jsonb_build_object(
    'status', 'created',
    'id', v_new_id,
    'closed_count', coalesce(array_length(v_closed_ids, 1), 0),
    'closed_valid_until', case when v_closed_ids is null then null else v_closed_until end
  );
end;
$$;

comment on function public.create_retail_tariff(
  text, text, text, numeric, numeric, text, text, date, text
) is
  'Legt einen Lieferanten-Tarifstand an und schliesst die bisher offene Zeile derselben '
  'Kombination (provider_id, segment) in DERSELBEN Transaktion (valid_until = valid_from - 1). '
  'SECURITY INVOKER — prüft KEINE Rolle; die Zugangsentscheidung liegt im Admin-Bereich von '
  'apps/web. Nur Anhängen: kein Ändern, kein Löschen, keine rückwirkende Korrektur.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — Die Rechte
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ── ⚠ DIE RECHTEFLÄCHE IST GEMESSEN, NICHT ABGELEITET ──────────────────────────────────────────
-- Gegen den lokalen Stack (PostgreSQL 17.6) in zurückgerollten Transaktionen Stufe für Stufe
-- nachgemessen, indem die Funktion unter `set local role service_role` mit einer bereits offenen
-- Vorgängerzeile tatsächlich AUFGERUFEN wurde — nur so läuft der UPDATE-Zweig überhaupt an. Die
-- Ergebnistabelle steht im Kopf von `packages/db-tests/src/retail-tariff-write-path.test.ts`.
--
-- Ergebnis: `retail_tariffs` braucht INSERT + SELECT + UPDATE, und jedes der drei trägt:
--   INSERT  legt die neue Zeile an.
--   SELECT  wird zweimal gebraucht — für die Suche nach der offenen Zeile UND für das
--           `returning id` des INSERT.
--   UPDATE  schliesst die Vorgängerin UND ist die Voraussetzung des `select … for update`
--           (PostgreSQL verlangt für eine Zeilensperre das Schreibrecht, auch wenn nichts
--           geschrieben wird).
--
-- Mehr bekommt die Rolle nicht: kein DELETE, kein TRUNCATE. Ein Grant „vorsichtshalber" wäre hier
-- kein harmloser Überschuss, sondern ein falscher Beleg über diesen Weg — und der nächste Umbau
-- nähme ihn als gegeben.
--
-- ── DIE CLIENT-ROLLEN BLEIBEN UNVERÄNDERT NUR LESEND ───────────────────────────────────────────
-- `anon` und `authenticated` behalten exakt `SELECT` aus der Nachbarmigration. Der Admin-Bereich
-- LIEST über den angemeldeten Client und SCHREIBT über `service_role` — dieselbe Trennung wie bei
-- den Netzbetreiber-Tarifen.
grant insert, select, update on table public.retail_tariffs to service_role;

-- Funktionen im `public`-Schema bekommen EXECUTE per Default an PUBLIC und über Supabases
-- ALTER DEFAULT PRIVILEGES zusätzlich an `anon`/`authenticated`/`service_role` — dieselbe Falle wie
-- bei den Tabellen, seit T4-2 in einem Dutzend Migrationen dokumentiert. Der `revoke` ist deshalb
-- kein Zierrat: ohne ihn stünde die Funktion jedem Browser-Client offen.
--
-- Wirksam wäre sie dort nicht (SECURITY INVOKER: `anon` hat kein Schreibrecht, der INSERT endete mit
-- 42501) — aber „läuft ins Leere" ist keine Zugangsregel, sondern ein Zufall der aktuellen Grants.
revoke all on function public.create_retail_tariff(
  text, text, text, numeric, numeric, text, text, date, text
) from public, anon, authenticated;

grant execute on function public.create_retail_tariff(
  text, text, text, numeric, numeric, text, text, date, text
) to service_role;
