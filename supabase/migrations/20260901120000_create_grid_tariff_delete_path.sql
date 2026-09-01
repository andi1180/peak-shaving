-- B21-2c — Löschweg für die Netzbetreiber-Tarife: eine Tarifzeile verschwindet, ihre Spur bleibt.
--
-- Kanonische fachliche Quelle: `Pflichtenheft_Kalkulator_Delta_Tarifoptimierung.md`, Delta 5
-- (Datenmodell + Admin-Pflege). Betriebsseite: `DEPLOYMENT.md` §3c.
--
-- ── WAS HIER ENTSTEHT ───────────────────────────────────────────────────────────────────────────
--   TEIL 1  public.grid_tariff_deletions  — das Löschprotokoll samt vollständigem Abzug der Zeile
--   TEIL 2  public.delete_grid_tariff(...) — EIN Aufruf, EINE Transaktion: protokollieren, löschen
--   TEIL 3  Die Rechte, die dieser Weg braucht — gemessen, nicht angenommen
--
-- Kein Trigger, keine Spalte an bestehenden Tabellen, keine Policy-Änderung, keine Zeile Inhalt.
-- `public.create_grid_tariff`, der `unique nulls not distinct`-Constraint und die SELECT-Policies
-- für `anon`/`authenticated` sind NICHT angefasst. `public.spot_prices` und `platform` ebenfalls
-- nicht.
--
-- ── ⚠ WARUM ES ÜBERHAUPT EIN LÖSCHEN GIBT — UND WARUM ES TROTZDEM EINE AUSNAHME BLEIBT ──────────
-- B21-2b hat das Löschen ausdrücklich ausgeschlossen, und die Begründung gilt für einen
-- VERÖFFENTLICHTEN Tarifstand unverändert: Er ist eine Aussage über einen Zeitraum, und eine 2026
-- archivierte Analyse (B14) muss 2028 noch sagen können, welcher Stand ihr zugrunde lag.
--
-- Was in der Praxis fehlt, ist etwas anderes: der Pflegeweg ist ein reiner Anhänge-Weg, und ein
-- vertippter PROBEEINTRAG blieb bisher für immer stehen — samt der Nebenwirkung, dass er die
-- Kombination belegt und jeden echten Stand mit früherem Beginn auf `invalid_valid_from` laufen
-- lässt. Das Löschen behebt genau das und ist deshalb ausdrücklich ein Werkzeug für TESTZEILEN,
-- keine rückwirkende Korrektur eines bereits gerechneten Zeitraums.
--
-- Damit die Unterscheidung nicht bloss eine Absichtserklärung ist, hinterlässt jedes Löschen einen
-- vollständigen Abzug der Zeile. Wer 2028 vor einer Lücke in der Effektiv-Datierung steht, findet
-- dort, WAS gelöscht wurde, WER es getan hat und WANN — und kann den Stand daraus wiederherstellen.
-- Ohne dieses Protokoll wäre eine gelöschte Zeile von einer nie angelegten nicht unterscheidbar.
--
-- ── ⚠ DIE AUTORISIERUNG LIEGT WIE BEI create_grid_tariff IM ANWENDUNGSCODE ──────────────────────
-- `security invoker`, keine Rollenprüfung im Rumpf — EXAKT wie `create_grid_tariff` und aus
-- demselben Grund: Der Aufrufer ist `service_role`, die trägt kein JWT, `auth.uid()` ist leer, es
-- gibt in der Datenbank nichts zu prüfen. Ein hier eingebautes `platform.is_admin()` prüfte eine
-- Sitzung, die es an dieser Stelle gar nicht gibt, und wäre damit eine Zusage, die nichts hält.
--
--   ⇒ Die Zugangsentscheidung liegt vollständig in `apps/web`:
--       `app/admin/(intern)/layout.tsx`     → die Schranke des Bereichs
--       `lib/admin/grid-tariffs-actions.ts` → `isCurrentUserAdmin()` VOR dem Anlegen des Clients
--
-- Diese Datei ERWEITERT damit die eine bewusste Abweichung des Systems (DEPLOYMENT.md §3c), sie
-- schafft keine zweite: derselbe Aufruferkreis, dieselbe Prüfstelle, dieselbe Datei.
--
-- ── WAS AUSDRÜCKLICH NICHT ENTSTEHT ─────────────────────────────────────────────────────────────
-- Kein Bearbeiten. Kein Soft-Delete-Flag (`is_active`) — die Anforderung ist echtes Löschen einer
-- Testzeile, und ein deaktivierter Eintrag belegte die Kombination weiter, also genau das Problem,
-- das gelöst werden soll. Keine Mehrfachauswahl: genau EINE Zeile je Aufruf. Keine Oberfläche zum
-- Durchsuchen des Protokolls und deshalb auch KEIN Lese-Wrapper darauf — beides kommt, wenn es
-- gebraucht wird, und ein ungenutzter Lesepfad wäre nur eine zusätzliche Fläche.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — public.grid_tariff_deletions
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ── ⚠ KEIN FREMDSCHLÜSSEL AUF grid_tariffs, UND ZWAR ZWINGEND ───────────────────────────────────
-- Die referenzierte Zeile existiert nach dem Vorgang nicht mehr. Ein Fremdschlüssel wäre entweder
-- unmöglich (`restrict` — der Vorgang liefe nie) oder selbstzerstörend (`cascade` — das Protokoll
-- verschwände zusammen mit dem, was es belegt). `grid_tariff_id` ist deshalb bewusst eine BLOSSE
-- uuid: der Verweis auf etwas, das es nicht mehr gibt.
--
-- Dieselbe Überlegung wie bei `platform.admin_exports` (B2-1) — auch dort hängt am protokollierten
-- Gegenstand (einer ausgeführten Datei) nichts mehr, das auf seine Entstehung zeigt.
--
-- ── ⚠ DER SNAPSHOT MUSS DIE ZEITFENSTER ENTHALTEN ───────────────────────────────────────────────
-- Die eigentlichen Arbeitspreise (ct/kWh) stehen NICHT auf der Elternzeile, sondern in
-- `grid_tariff_rate_windows`. Ein Protokoll, das nur die Elternzeile abzöge, hielte den Grundpreis
-- fest und verlöre genau die Sätze, mit denen gerechnet wurde — es sähe vollständig aus und wäre es
-- nicht. Der Abzug trägt deshalb die Elternzeile mit einem zusätzlichen Schlüssel `rate_windows`.
--
-- Anders als bei `platform.admin_exports` ist die Inhaltskopie hier RICHTIG und nicht falsch: Dort
-- wäre sie eine zweite dauerhafte Kopie personenbezogener Daten gewesen; hier sind es
-- veröffentlichte Preisblattdaten ohne Personenbezug, und die Kopie IST der Zweck des Protokolls.
create table public.grid_tariff_deletions (
  id uuid primary key default gen_random_uuid(),
  -- Die id der gelöschten Zeile. Kein FK (s. o.) — sie zeigt bewusst ins Leere.
  grid_tariff_id uuid not null,
  -- WER gelöscht hat, als Adresse und nicht als Kennung — dieselbe Wahl wie bei
  -- `grid_tariffs.created_by` (B21-2b): eine UUID sagt 2028 niemandem, wer den Stand entfernt hat.
  deleted_by text not null,
  -- clock_timestamp(), NICHT now(): `now()` ist die TRANSAKTIONSzeit und in einer Transaktion
  -- konstant — zwei Löschungen derselben Transaktion (im DB-Gate der Normalfall) wären nicht
  -- ordenbar. Befund aus B4-1, seither auch in platform.admin_exports (B2-1).
  deleted_at timestamptz not null default clock_timestamp(),
  -- Die vollständige Zeile: alle Spalten von grid_tariffs plus `rate_windows` als Array.
  tariff_snapshot jsonb not null
);

comment on table public.grid_tariff_deletions is
  'B21-2c: Löschprotokoll der Netzbetreiber-Tarifzeilen. Enthält einen VOLLSTÄNDIGEN Abzug der '
  'gelöschten Zeile samt ihrer Zeitfenster (die ct/kWh-Sätze stehen dort, nicht auf der Elternzeile) '
  '— ohne ihn wäre eine gelöschte Zeile von einer nie angelegten nicht unterscheidbar. Bewusst OHNE '
  'Fremdschlüssel auf grid_tariffs: die referenzierte Zeile existiert danach nicht mehr. RLS an, '
  'keine Policy, nur ein INSERT-Grant für service_role (Muster platform.admin_exports/job_runs) — '
  'geschrieben wird ausschliesslich aus public.delete_grid_tariff.';

comment on column public.grid_tariff_deletions.grid_tariff_id is
  'Die id der gelöschten Zeile — eine blosse uuid ohne Fremdschlüssel. Ein FK wäre entweder '
  'unmöglich (restrict) oder selbstzerstörend (cascade).';

comment on column public.grid_tariff_deletions.tariff_snapshot is
  'Die Elternzeile als jsonb, ergänzt um den Schlüssel `rate_windows` mit allen zugehörigen '
  'Zeitfenstern. Der Abzug ist die einzige Stelle, an der die gelöschten Arbeitspreise erhalten '
  'bleiben — und damit die Grundlage, aus der sich ein versehentlich gelöschter Stand '
  'wiederherstellen lässt.';

-- Kein Index auf `deleted_at` oder `grid_tariff_id`: Die Tabelle wächst mit Einzelvorgängen eines
-- Menschen, nicht mit Datenverkehr — dieselbe Überlegung wie bei platform.admin_exports (B2-1).
-- Ein Index auf Vorrat wäre hier Aufwand ohne Nutzen.

-- ⚠ Der `revoke`-Block ist keine Formsache: Supabase vergibt per ALTER DEFAULT PRIVILEGES auf NEUE
-- Tabellen im `public`-Schema automatisch ALLE Tabellenrechte an anon, authenticated UND
-- service_role — DELETE und TRUNCATE eingeschlossen (in B21-1 gemessen). Ohne ihn wäre ausgerechnet
-- das Protokoll von jedem Browser-Client löschbar.
alter table public.grid_tariff_deletions enable row level security;

revoke all on table public.grid_tariff_deletions from public, anon, authenticated, service_role;

-- Zwei Schichten, wie überall in diesem Bereich, und beide nötig:
--   (a) Grant: NUR `insert`, NUR für service_role. Kein select (es gibt keinen Lesepfad und keine
--       Oberfläche dafür), kein update, kein delete — ein Protokoll, das sein Urheber ändern oder
--       entfernen kann, belegt nichts.
--   (b) RLS aktiv, ausdrücklich OHNE Policy. Für `anon`/`authenticated` ist das die zweite Sperre
--       (sie haben ohnehin keinen Grant). Für `service_role` ist es KEINE: die Rolle trägt in
--       Supabase `rolbypassrls` (nachgemessen) — dort wirkt allein der Grant, und genau deshalb ist
--       er so eng.
grant insert on table public.grid_tariff_deletions to service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — public.delete_grid_tariff
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ── EINE FUNKTION, WEIL ES ZWEI SCHREIBVORGÄNGE SIND ────────────────────────────────────────────
-- Protokolleintrag und Löschung gehören in EINE Transaktion, und über PostgREST wäre jeder Aufruf
-- seine eigene. Bräche der zweite ab, stünde ein Protokolleintrag über eine Löschung, die nie
-- stattgefunden hat; in umgekehrter Reihenfolge wäre die Zeile weg und ihre Spur nicht entstanden.
-- Dieselbe Klammer und dieselbe Begründung wie bei `create_grid_tariff` (B21-2b) und
-- `public.admin_export_leads` (B2-1): „ein getrennter ‚protokolliere jetzt'-Aufruf könnte
-- ausbleiben — dann gäbe es eine Kopie ohne Spur".
--
-- ── KEIN TREFFER IST EIN FEHLER, KEIN STILLER ERFOLG ────────────────────────────────────────────
-- Ein `delete … where id = …` ohne Treffer meldet von sich aus nichts — der Aufruf sähe aus wie ein
-- Erfolg, und die Oberfläche zeigte „gelöscht" für eine Zeile, die jemand anderes längst entfernt
-- hat. Die Funktion wirft deshalb; die Server Action macht daraus einen Satz, der zum Neuladen
-- auffordert.
--
-- ── `for update` IST NICHT DEKORATION ───────────────────────────────────────────────────────────
-- Gelesen wird der Abzug, geschrieben wird abhängig davon. Ohne Zeilensperre könnten zwei
-- gleichzeitige Aufrufe beide denselben Abzug lesen und beide einen Protokolleintrag schreiben,
-- während nur eine Löschung tatsächlich stattfindet — das Protokoll behauptete dann einen Vorgang
-- zu viel. Mit Sperre wartet der zweite Aufruf und findet die Zeile danach nicht mehr: `not_found`,
-- also genau die Wahrheit. Ein Advisory-Lock wie in `create_grid_tariff` braucht es hier nicht — es
-- geht um EINE benannte Zeile, nicht um die Frage, ob eine offene Zeile existiert.
create or replace function public.delete_grid_tariff(
  p_tariff_id  uuid,
  p_deleted_by text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tariff   jsonb;
  v_windows  jsonb;
  v_deleted  int;
begin
  -- (a) Der Abzug. `to_jsonb(t)` nimmt ALLE Spalten mit, auch künftig hinzukommende — ein Protokoll,
  -- das eine Spaltenliste ausschreibt, verliert beim nächsten Schema-Zuwachs still ein Feld.
  select to_jsonb(t) into v_tariff
    from public.grid_tariffs t
   where t.id = p_tariff_id
     for update;

  -- (b) Kein Treffer → Ausnahme, kein stiller No-op (s. Kopf).
  if v_tariff is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  -- Die Zeitfenster tragen die Arbeitspreise und MÜSSEN mit in den Abzug (s. TEIL 1). Stabil
  -- sortiert, damit zwei Abzüge derselben Zeile vergleichbar sind.
  select coalesce(jsonb_agg(to_jsonb(w) order by w.label, w.time_from), '[]'::jsonb)
    into v_windows
    from public.grid_tariff_rate_windows w
   where w.grid_tariff_id = p_tariff_id;

  -- (c) Erst protokollieren, dann löschen. Die Reihenfolge ist innerhalb der Transaktion ohne
  -- Wirkung — sie steht so, weil sie die Absicht liest: die Spur entsteht, bevor die Zeile geht.
  insert into public.grid_tariff_deletions (grid_tariff_id, deleted_by, tariff_snapshot)
  values (
    p_tariff_id,
    p_deleted_by,
    v_tariff || jsonb_build_object('rate_windows', v_windows)
  );

  -- (d) Die Zeitfenster räumt die Kaskade ab (`on delete cascade`, B21-1). GEMESSEN und nicht
  -- angenommen: dafür genügt das DELETE-Recht auf `grid_tariffs`; ein eigenes DELETE auf der
  -- Kind-Tabelle ist NICHT nötig, weil die referentielle Aktion im systemeigenen Constraint-Trigger
  -- mit den Rechten des Eigentümers läuft (Stufenmessung im Kopf von
  -- `packages/db-tests/src/grid-tariff-delete-path.test.ts`).
  delete from public.grid_tariffs where id = p_tariff_id;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'status', 'deleted',
    'id', p_tariff_id,
    'window_count', jsonb_array_length(v_windows),
    'deleted_count', v_deleted
  );
end;
$$;

comment on function public.delete_grid_tariff(uuid, text) is
  'B21-2c: Löscht EINEN Netzbetreiber-Tarifstand und schreibt in DERSELBEN Transaktion einen '
  'vollständigen Abzug nach public.grid_tariff_deletions (Elternzeile + Zeitfenster). Die '
  'Zeitfenster selbst entfernt die Kaskade aus B21-1. Kein Treffer wirft P0001 not_found — ein '
  'stiller No-op sähe an der Oberfläche wie ein Erfolg aus. SECURITY INVOKER, prüft KEINE Rolle: '
  'die Zugangsentscheidung liegt im Admin-Bereich von apps/web (DEPLOYMENT.md §3c).';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — Die Rechte
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ── ⚠ DIE ERWEITERUNG IST GEMESSEN, NICHT ABGELEITET ───────────────────────────────────────────
-- Gegen den lokalen Stack (PostgreSQL 17.6) in zurückgerollten Transaktionen Stufe für Stufe
-- nachgemessen, indem `public.delete_grid_tariff` unter `set local role service_role` mit einer
-- echten Zeile samt zwei Zeitfenstern TATSÄCHLICH aufgerufen wurde. Je Stufe wurde GENAU EIN Recht
-- entzogen (Ergebnistabelle auch im Kopf von `packages/db-tests/src/grid-tariff-delete-path.test.ts`):
--
--   volle Grants dieser Migration                → OK: Eltern 0, Kinder 0, Protokoll 1
--   ohne DELETE   auf grid_tariffs               → 42501 grid_tariffs
--   ohne SELECT   auf grid_tariff_rate_windows   → 42501 grid_tariff_rate_windows
--   ohne INSERT   auf grid_tariff_deletions      → 42501 grid_tariff_deletions
--   ohne SELECT   auf grid_tariffs               → 42501 grid_tariffs
--   ohne UPDATE   auf grid_tariffs               → 42501 grid_tariffs
--   ZUSÄTZLICH DELETE auf grid_tariff_rate_windows → OK (kein Unterschied)
--
-- Jedes einzelne Recht trägt also, und das überzählige trägt nichts.
--
-- ── ⚠ DIE KASKADE BRAUCHT KEIN DELETE AUF DER KIND-TABELLE ─────────────────────────────────────
-- Eigene Vorab-Stufenmessung, ebenfalls mit einem echten `delete` auf der Elternzeile:
--
--   kein DELETE-Grant                            → 42501 grid_tariffs   ← Stand vor dieser Migration
--   NUR grid_tariffs: delete                     → OK, Eltern 0 UND Kinder 0
--   grid_tariffs + rate_windows: delete          → OK (kein Unterschied)
--   NUR rate_windows: delete                     → 42501 grid_tariffs
--
-- ⇒ `grid_tariff_rate_windows` bekommt KEIN delete. Die referentielle Aktion läuft im systemeigenen
--   Constraint-Trigger mit den Rechten des Eigentümers, nicht mit denen des Aufrufers (die Tabelle
--   trägt `relforcerowsecurity = false`, RLS steht der Kaskade damit ebenfalls nicht im Weg — beides
--   nachgemessen). Ein DELETE-Grant dort wäre ein falscher Beleg: er behauptete, dieser Weg lösche
--   die Kind-Zeilen selbst. Der 42501-Nachweis für die Kind-Tabelle bleibt deshalb im DB-Gate stehen.
--
-- ── ⚠ WAS DIE KIND-TABELLE SEHR WOHL BRAUCHT: SELECT ───────────────────────────────────────────
-- Das ist die einzige echte Aufweichung dieser Migration, und sie hat einen benennbaren Grund: Der
-- Abzug MUSS die Zeitfenster enthalten (die ct/kWh-Sätze stehen dort), also LIEST die Funktion die
-- Kind-Tabelle. Ohne dieses Recht scheitert der Aufruf mit 42501 (Stufe 2 oben).
--
-- B21-2b hatte an dieser Stelle notiert, ein SELECT-Grant „vorsichtshalber" wäre ein falscher Beleg,
-- weil der Schreibweg dort nichts liest. Das gilt unverändert — der Grant kommt jetzt nicht
-- vorsichtshalber, sondern weil ein zweiter Weg die Tabelle tatsächlich liest.
--
-- ── NEBENBEFUND ZUR ZEILENSPERRE ────────────────────────────────────────────────────────────────
-- Stufe „ohne UPDATE" scheitert, obwohl die Funktion nichts ändert: `select … for update` verlangt
-- das UPDATE-Recht. Es kommt aus B21-2b (dort für das Schliessen der Vorgängerin) und wird hier
-- mitbenutzt — dieser Weg braucht also KEIN zusätzliches Recht dafür. Wer den UPDATE-Grant je
-- entfernt, weil `create_grid_tariff` ihn nicht mehr braucht, nimmt auch diesem Weg die Sperre.
grant delete on table public.grid_tariffs             to service_role;
grant select on table public.grid_tariff_rate_windows to service_role;

-- Funktionen im `public`-Schema bekommen EXECUTE per Default an PUBLIC und über Supabases
-- ALTER DEFAULT PRIVILEGES zusätzlich an anon/authenticated/service_role — dieselbe Falle wie bei
-- create_grid_tariff. Ohne den `revoke` stünde ein Löschweg jedem Browser-Client offen.
--
-- Wirksam wäre er dort nicht (SECURITY INVOKER: `anon` hat kein DELETE, der Aufruf endete mit
-- 42501) — aber „läuft ins Leere" ist keine Zugangsregel, sondern ein Zufall der aktuellen Grants.
revoke all on function public.delete_grid_tariff(uuid, text) from public, anon, authenticated;

grant execute on function public.delete_grid_tariff(uuid, text) to service_role;
