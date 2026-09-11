-- B24 — Teil 1, Baustein 1: der Zaehlpunkt bekommt seinen Lastgang-Bezug (Zeitraum, Intervall,
-- Luecken) und die drei Wrapper, ueber die er entsteht.
--
-- Kanonische fachliche Quelle: `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` §2.3 (Zaehlpunkt)
-- und §3.2 (Dokumente). Einordnung: `Fahrplan_2026.md`, B24 — Teil 1, Baustein 1.
--
-- ── WAS HIER ENTSTEHT ───────────────────────────────────────────────────────────────────────────
--   TEIL 1  fuenf neue Spalten auf `platform.metering_points`
--   TEIL 2  `public.admin_set_metering_point_count` — Zaehlpunkte anlegen/entfernen (admin-only)
--   TEIL 3  `public.list_metering_points` — der Leseweg des Chats
--   TEIL 4  `public.set_metering_point_load_profile` — der Schreibweg der Metadaten
--   TEIL 5  Rechte
--   TEIL 6  Was es hier BEWUSST NICHT GIBT
--
-- ── ⚠ DIE EINE ENTSCHEIDUNG, DIE DIESE MIGRATION TRAEGT: METADATEN, KEINE ZEITREIHE ────────────
-- Gespeichert wird, WAS eine Datei abdeckt — nicht ihr Inhalt. Die Rohdatei bleibt in
-- `platform.project_documents` bzw. im Bucket und wird bei Bedarf erneut gelesen. Der naheliegende
-- Gegenentwurf (die Viertelstundenwerte in eine Tabelle schreiben) haette zwei Fassungen derselben
-- Messreihe erzeugt — und die Frage „welche gilt?" waere erst aufgefallen, wenn sie auseinander-
-- laufen. Dieselbe Ueberlegung wie bei `platform.analyses` (B14-1): dort liegt die Ursprungsdatei
-- gzip-komprimiert als EIN Abzug daneben, nicht als zweite, parallel gepflegte Zeilenmenge.
--
-- Konkret heisst das: `interval_minutes`, `covered_from`, `covered_to` und `gaps` sind ABGELEITETE
-- Angaben ueber `source_document_id`. Verschwindet das Dokument, bleiben sie stehen (s. TEIL 1) —
-- sie sind dann die letzte Aussage darueber, was einmal gelesen wurde, und keine Behauptung ueber
-- eine Datei, die es noch gibt.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — die fuenf neuen Spalten
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Die Migration 20260911090000 hat die Tabelle bewusst inhaltsleer angelegt: WELCHE Angaben ein
-- Zaehlpunkt traegt, sollte die Dateneingabe entscheiden. Sie entscheidet jetzt — und zwar genau so
-- weit, wie der Lastgang-Leser tatsaechlich etwas liefert. Zaehlpunktnummer, Netzebene und
-- Messvariante kommen NICHT mit: sie stehen nicht in einer Lastgang-Datei, und eine Spalte dafuer
-- entschiede erneut den offenen Punkt 1 des Deltas still.

alter table platform.metering_points
  -- ⚠ 15 ODER 60, und der CHECK ist die zweite Schicht ueber dem Leser. Der Rechenkern
  -- (`parseLoadProfile`) rechnet ausschliesslich mit 15-min; 60-min-Exporte gibt es trotzdem, und
  -- sie hier abzuweisen hiesse, einen realen Netzbetreiber-Export als „unlesbar" auszugeben. Was
  -- mit einem Stundenprofil gerechnet werden kann, entscheidet ein spaeterer Bauschritt — dass es
  -- eines IST, wird hier festgehalten.
  add column interval_minutes integer
    constraint metering_points_interval_supported
      check (interval_minutes is null or interval_minutes in (15, 60)),

  -- Beginn des ERSTEN Intervalls mit Messwert.
  add column covered_from timestamptz,

  -- ⚠ ENDE des LETZTEN Intervalls mit Messwert, nicht dessen Beginn — `[covered_from, covered_to)`
  -- ist halboffen und damit exakt die abgedeckte Zeit. Andere Konvention als
  -- `AnalysisWindow.endIso` (`packages/shared/src/analysis-window.ts`, beide Grenzen inklusiv);
  -- die Begruendung steht ausfuehrlich an `LoadProfileMetadata.coveredTo`. Wer die beiden
  -- verwechselt, verliert bzw. erfindet ein Intervall.
  add column covered_to timestamptz,

  -- ⚠ NUR die Luecken ueber der Toleranzschwelle (mehr als EIN fehlendes Intervall) — ein
  -- einzelner Ausfall ist in einem realen Export Alltag und machte die Liste unlesbar. Die Schwelle
  -- steht als `GAP_TOLERANCE_INTERVALS` im Leser, nicht hier: die Datenbank speichert, was gemessen
  -- wurde, sie misst nicht mit.
  --
  -- Format: `[{"from": "...", "to": "..."}]`, beide ISO/UTC, halboffen wie `covered_*`. Der CHECK
  -- prueft nur die aeussere Form — er ist die Sperre gegen ein versehentliches Objekt oder einen
  -- Skalar, nicht gegen einen falschen Eintrag (Muster `projects.draft`).
  add column gaps jsonb not null default '[]'::jsonb
    constraint metering_points_gaps_is_array check (jsonb_typeof(gaps) = 'array'),

  -- ⚠ `ON DELETE SET NULL`, nicht `CASCADE`: ein geloeschtes Dokument nimmt dem Zaehlpunkt seine
  -- QUELLE, nicht seine Existenz. Die abgeleiteten Angaben bleiben stehen — sie sind dann die
  -- letzte Aussage darueber, was einmal gelesen wurde.
  --
  -- ⚠ DIE BEKANNTE FALLE GREIFT HIER NICHT, UND DAS IST GEPRUEFT: `on delete set null` IST selbst
  -- ein UPDATE und laeuft in jeden Append-only-/Unveraenderlichkeits-Trigger (sechsmal im Repo
  -- aufgetreten: `leads.last_edited_by`, `email_events.lead_id`, `analyses.lead_id`/`created_by`,
  -- `partner_applications.user_id`). Auf `platform.metering_points` steht KEIN Trigger, und das
  -- DB-Gate pinnt genau das seit 20260911090000 („0 nicht-interne Trigger" — dort noch wegen der
  -- Kaskade auf `projects`). ⚠ Wer hier je einen Trigger ergaenzt, braucht die asymmetrische
  -- Ausnahme fuer DIESE Spalte, sonst wird ein Dokument unloeschbar.
  add column source_document_id uuid references platform.project_documents (id) on delete set null,

  -- Ein Zeitraum mit nur einer Grenze ist keine Aussage, sondern ein halb geschriebener Datensatz.
  -- Der CHECK verlangt deshalb beide gemeinsam — und dass sie in dieser Reihenfolge stehen.
  add constraint metering_points_covered_range check (
    (covered_from is null and covered_to is null)
    or (covered_from is not null and covered_to is not null and covered_to > covered_from)
  );

comment on column platform.metering_points.interval_minutes is
  'Messintervall des Lastgangs in Minuten — 15 oder 60, AUS DER DATEI ERKANNT (nicht angenommen). '
  'NULL = es wurde noch kein Lastgang eingelesen. ⚠ 60 ist zugelassen, obwohl der Rechenkern heute '
  'nur 15-min rechnet: ein Stundenprofil ist ein realer Netzbetreiber-Export, und ihn als unlesbar '
  'auszugeben waere eine Falschaussage ueber die Datei.';

comment on column platform.metering_points.covered_from is
  'Beginn des ERSTEN Intervalls mit Messwert (ISO/UTC). Gemeinsam mit covered_to gesetzt oder gar '
  'nicht — der CHECK metering_points_covered_range erzwingt das.';

comment on column platform.metering_points.covered_to is
  '⚠ ENDE des LETZTEN Intervalls mit Messwert, nicht dessen Beginn: [covered_from, covered_to) ist '
  'halboffen und damit exakt die abgedeckte Zeit. ANDERE Konvention als AnalysisWindow.endIso '
  '(packages/shared/src/analysis-window.ts, beide Grenzen inklusiv) — wer sie verwechselt, verliert '
  'bzw. erfindet ein Intervall; bei einem Jahreslastgang fehlten die letzten 15 Minuten des 31.12.';

comment on column platform.metering_points.gaps is
  'Bereiche OHNE Messwert, als Array von {from, to} (ISO/UTC, halboffen wie covered_*). ⚠ Enthaelt '
  'NUR Luecken ueber der Toleranzschwelle des Lesers (mehr als ein fehlendes Intervall) — ein '
  'einzelner Ausfall ist Alltag eines Exports und stuende hier als Rauschen. Die Zahl ALLER '
  'fehlenden Intervalle bleibt ableitbar: (covered_to − covered_from) / interval_minutes minus der '
  'tatsaechlich gelesenen Intervalle. ⚠ Am Tag der Zeitumstellung im Herbst steht hier ein '
  'zusaetzlicher Eintrag von einer Stunde — eine Eigenschaft der Zeitstempel-Aufloesung des '
  'Parsers, im Kopf von packages/engine/src/parser/metadata.ts benannt und dort als Test gepinnt.';

comment on column platform.metering_points.source_document_id is
  'Das project_documents-Dokument, aus dem interval_minutes/covered_*/gaps gelesen wurden. ⚠ ON '
  'DELETE SET NULL: ein geloeschtes Dokument nimmt dem Zaehlpunkt seine QUELLE, nicht seine '
  'Existenz — die abgeleiteten Angaben bleiben als letzte Aussage stehen. Die ZEITREIHE selbst '
  'steht hier bewusst NICHT: sie bleibt in der Datei und wird bei Bedarf erneut gelesen, damit es '
  'keinen zweiten Speicherort fuer dieselben Verbrauchsdaten gibt.';

-- Ein Teilindex auf den belegten Verweis: die Gegenrichtung des Fremdschluessels (welche
-- Zaehlpunkte haengen an diesem Dokument?) wird beim Loeschen eines Dokuments durchlaufen, und
-- `set null` ist ein UPDATE ueber genau diese Zeilen.
create index metering_points_source_document_idx
  on platform.metering_points (source_document_id)
  where source_document_id is not null;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — admin_set_metering_point_count
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── ⚠ WARUM ADMIN-ONLY, OBWOHL DER CHAT DIE ZAEHLPUNKTE BRAUCHT ────────────────────────────────
-- „Wie viele Zaehlpunkte hat dieser Betrieb?" ist eine FACHLICHE Frage, die der Fragenkatalog
-- stellen soll (Delta §4) — und der Katalog-Eintrag dafuer ist ausdruecklich ein spaeterer
-- Bauschritt. Bis dahin legt ein Mensch die Zaehlpunkte an. Diesen Weg jetzt schon fuer den Kunden
-- zu oeffnen hiesse, das Modell ueber die Struktur eines Betriebs entscheiden zu lassen, bevor
-- irgendjemand entschieden hat, wie danach gefragt wird.
--
-- ── ⚠ VERKLEINERN LOESCHT, ABER NIE ETWAS MIT INHALT ───────────────────────────────────────────
-- Entfernt werden die ZULETZT angelegten Zeilen (created_at desc, id desc als Tie-Break) — eine
-- deterministische Reihenfolge, damit die Frage „welcher ist weg?" beantwortbar bleibt. Traegt eine
-- davon bereits einen Lastgang-Bezug, wird der GESAMTE Aufruf abgewiesen und NICHTS geaendert.
--
-- ⚠ FOLGE, DIE MAN KENNEN MUSS: liegt der Lastgang ausgerechnet auf dem juengsten Zaehlpunkt, laesst
-- sich gar nicht verkleinern — auch dann nicht, wenn ein aelterer leer ist. Das ist die bewusst
-- gewaehlte Seite des Tauschs: still den „passenden" Zaehlpunkt auszusuchen machte die Reihenfolge
-- datenabhaengig und die Frage „welcher ist weg?" unbeantwortbar. Wer einen BESTIMMTEN Zaehlpunkt
-- entfernen will, braucht dafuer einen eigenen Wrapper — den gibt es hier bewusst nicht (TEIL 6).
create function public.admin_set_metering_point_count(
  p_project_id uuid,
  p_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- ⚠ KEINE Produktgrenze, sondern eine TIPPFEHLER-BREMSE. Ohne sie legte ein versehentliches „500"
  -- fuenfhundert Zeilen an, und der Rueckweg waere derselbe Wrapper mit demselben Risiko. Muster
  -- p_refuse_above in platform.run_lead_retention (B4-1): oberhalb der Grenze wird bewusst gar
  -- nichts getan, nicht die erste Teilmenge.
  c_max_count constant integer := 100;
  v_current   integer;
  v_blocked   integer;
  v_removed   integer := 0;
  v_created   integer := 0;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_set_metering_point_count: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if p_count is null or p_count < 1 or p_count > c_max_count then
    return jsonb_build_object('status', 'invalid_count', 'max', c_max_count);
  end if;

  -- Das Projekt muss existieren — sonst liefe das INSERT in einen rohen 23503, aus dem die
  -- Oberflaeche keinen Satz bilden kann.
  if not exists (select 1 from platform.projects pr where pr.id = p_project_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- ⚠ Die Zeilen werden gesperrt, bevor gezaehlt wird: zwei gleichzeitige Aufrufe laesen sonst
  -- beide denselben Stand und legten beide an. Dieselbe Ueberlegung wie beim Advisory-Lock in
  -- public.create_grid_tariff (B21-2b); hier genuegt die Zeilensperre, weil es um genau die Zeilen
  -- geht, die veraendert werden.
  perform 1 from platform.metering_points mp where mp.project_id = p_project_id for update;

  select count(*)::integer into v_current
  from platform.metering_points mp
  where mp.project_id = p_project_id;

  if p_count > v_current then
    insert into platform.metering_points (project_id)
    select p_project_id from generate_series(1, p_count - v_current);
    v_created := p_count - v_current;

  elsif p_count < v_current then
    with doomed as (
      select mp.id, mp.source_document_id
      from platform.metering_points mp
      where mp.project_id = p_project_id
      order by mp.created_at desc, mp.id desc
      limit v_current - p_count
    )
    select count(*)::integer into v_blocked
    from doomed d
    where d.source_document_id is not null;

    if v_blocked > 0 then
      -- Kein stiller Datenverlust: der GESAMTE Aufruf faellt aus, nichts ist geaendert.
      return jsonb_build_object(
        'status', 'has_load_profile',
        'count', v_current,
        'blocked', v_blocked
      );
    end if;

    with doomed as (
      select mp.id
      from platform.metering_points mp
      where mp.project_id = p_project_id
      order by mp.created_at desc, mp.id desc
      limit v_current - p_count
    )
    delete from platform.metering_points mp
    using doomed d
    where mp.id = d.id;

    get diagnostics v_removed = row_count;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'count', p_count,
    'created', v_created,
    'removed', v_removed
  );
end;
$$;

comment on function public.admin_set_metering_point_count(uuid, integer) is
  'B24 Teil 1: setzt die Zahl der Zaehlpunkte eines Projekts. Legt fehlende an; verkleinert, indem '
  'es die ZULETZT angelegten entfernt (created_at desc, id desc — deterministisch, damit '
  '„welcher ist weg?" beantwortbar bleibt). ⚠ Traegt eine der betroffenen Zeilen bereits '
  'source_document_id, wird der GESAMTE Aufruf mit has_load_profile abgewiesen und NICHTS geaendert '
  '— kein stiller Datenverlust. Folge: liegt der Lastgang auf dem juengsten Zaehlpunkt, laesst sich '
  'nicht verkleinern, auch wenn ein aelterer leer ist; ein gezielter Loeschweg ist bewusst nicht '
  'gebaut. Obergrenze 100 ist eine Tippfehler-Bremse, keine Produktgrenze. WIRFT ohne Adminrolle '
  '(42501). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — list_metering_points
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Der Leseweg des Chats: er laeuft als das angemeldete KONTO des Kunden, nicht als Admin. Deshalb
-- `platform.project_accessible` (eigenes Projekt ODER Adminrolle) und nicht `platform.is_admin()`.
--
-- ⚠ KEIN p_limit/p_offset — bewusste Abweichung von Regel 3 des Chat-Zustand-Schritts („jede Liste
-- hat Seiten"). Dort war die Begruendung, dass die Menge durch nichts nach oben geschlossen ist;
-- hier IST sie es: `admin_set_metering_point_count` ist der einzige Weg, auf dem eine Zeile
-- entsteht, und er ist bei 100 gedeckelt. Eine Seitung, die nie greift, waere eine Zusage ueber
-- eine Kuerzung, die es nicht gibt.
create function public.list_metering_points(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not platform.project_accessible(p_project_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- AELTESTE ZUERST: die Reihenfolge, in der die Zaehlpunkte angelegt wurden, ist die einzige, die
  -- ein Mensch wiedererkennt („der erste, den wir angelegt haben"). Dieselbe Sortierung wie
  -- list_project_messages und admin_list_open_questions, und aus verwandtem Grund.
  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_rows
  from (
    select mp.id,
           mp.project_id,
           mp.interval_minutes,
           mp.covered_from,
           mp.covered_to,
           mp.gaps,
           mp.source_document_id,
           mp.created_at
    from platform.metering_points mp
    where mp.project_id = p_project_id
  ) m;

  return jsonb_build_object('status', 'ok', 'metering_points', v_rows);
end;
$$;

comment on function public.list_metering_points(uuid) is
  'B24 Teil 1: die Zaehlpunkte eines Projekts samt Lastgang-Metadaten, AELTESTE ZUERST. Prueft '
  'platform.project_accessible — der Chat laeuft als das Konto des Kunden, nicht als Admin. '
  '„Gibt es nicht" und „gehoert jemand anderem" liefern beide not_found. Ohne Seitung, weil '
  'admin_set_metering_point_count die Menge bei 100 deckelt und eine nie greifende Kuerzung eine '
  'Zusage ueber etwas waere, das nicht vorkommt. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — set_metering_point_load_profile
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Der Schreibweg der Metadaten. Er ERSETZT die vier Angaben gemeinsam — ein Zaehlpunkt traegt
-- genau EINEN gelesenen Zeitraum, und ein feldweises Nachziehen erzeugte Zwischenstaende, in denen
-- `gaps` zu einem anderen Dokument gehoerte als `covered_from`.
--
-- ── ⚠ DAS DOKUMENT MUSS ZUM SELBEN PROJEKT GEHOEREN, UND DAS PRUEFT NUR DIESE FUNKTION ─────────
-- Der Fremdschluessel sagt nur „es gibt dieses Dokument", nicht „es gehoert hierher". Ohne die
-- Pruefung koennte ein Kunde mit zwei Projekten den Zaehlpunkt von Projekt A auf ein Dokument von
-- Projekt B zeigen lassen: kein Leck ueber Kundengrenzen (beide gehoeren ihm), aber ein Datensatz,
-- der eine Herkunft behauptet, die nicht stimmt — und 2027 nicht mehr aufloesbar waere.
create function public.set_metering_point_load_profile(
  p_metering_point_id uuid,
  p_source_document_id uuid,
  p_interval_minutes integer,
  p_covered_from timestamptz,
  p_covered_to timestamptz,
  p_gaps jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_gaps       jsonb := coalesce(p_gaps, '[]'::jsonb);
begin
  select mp.project_id into v_project_id
  from platform.metering_points mp
  where mp.id = p_metering_point_id;

  -- Reihenfolge wie ueberall: erst „gibt es das und darf ich?", dann die Form der Argumente. Sonst
  -- verriete eine Argument-Fehlermeldung, dass die Kennung existiert.
  if v_project_id is null or not platform.project_accessible(v_project_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  if p_interval_minutes is null or p_interval_minutes not in (15, 60) then
    return jsonb_build_object('status', 'invalid_interval');
  end if;
  if p_covered_from is null or p_covered_to is null or p_covered_to <= p_covered_from then
    return jsonb_build_object('status', 'invalid_range');
  end if;
  if jsonb_typeof(v_gaps) <> 'array' then
    return jsonb_build_object('status', 'invalid_gaps');
  end if;

  if p_source_document_id is null then
    return jsonb_build_object('status', 'invalid_document');
  end if;
  if not exists (
    select 1 from platform.project_documents d
    where d.id = p_source_document_id and d.project_id = v_project_id
  ) then
    -- Ein Dokument eines FREMDEN Projekts und ein gar nicht existierendes liefern denselben Status:
    -- die Antwort soll nicht verraten, welche Dokumentkennungen es sonst noch gibt.
    return jsonb_build_object('status', 'unknown_document');
  end if;

  update platform.metering_points mp
     set source_document_id = p_source_document_id,
         interval_minutes   = p_interval_minutes,
         covered_from       = p_covered_from,
         covered_to         = p_covered_to,
         gaps               = v_gaps
   where mp.id = p_metering_point_id;

  return jsonb_build_object(
    'status', 'ok',
    'metering_point_id', p_metering_point_id,
    'project_id', v_project_id
  );
end;
$$;

comment on function public.set_metering_point_load_profile(uuid, uuid, integer, timestamptz, timestamptz, jsonb) is
  'B24 Teil 1: schreibt die aus einer Lastgang-Datei GELESENEN Metadaten (Intervall, Zeitraum, '
  'Luecken) an einen Zaehlpunkt und haelt fest, aus welchem Dokument sie stammen. ERSETZT alle vier '
  'Angaben gemeinsam — ein feldweises Nachziehen erzeugte Zwischenstaende, in denen gaps zu einem '
  'anderen Dokument gehoerte als covered_from. ⚠ Das Dokument muss zum SELBEN Projekt gehoeren; der '
  'Fremdschluessel allein sagt das nicht. Speichert KEINE Zeitreihe — die Datei bleibt die Quelle. '
  'Prueft platform.project_accessible. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Muster des gesamten Schemas: `anon` und `service_role` bekommen NIRGENDS ein EXECUTE. Jede dieser
-- Funktionen leitet ihre Autorisierung aus `auth.uid()` bzw. `platform.is_admin()` ab, und beides
-- ist dort null bzw. false — ein Grant waere eine Tuer, hinter der nichts liegt ausser einer
-- Ablehnung. Die Tabellen-Grants bleiben unangetastet: `platform.metering_points` hat fuer KEINE
-- Rolle ein Tabellenrecht, und das aendert dieser Schritt nicht.
--
-- ── ⚠ ES MUSS `from public, anon, authenticated, service_role` HEISSEN, NICHT NUR `from public` ─
-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf JEDE neue Funktion im `public`-Schema ein
-- EXECUTE an `anon`, `authenticated` UND `service_role` — DIREKT, nicht ueber die Pseudo-Rolle
-- PUBLIC. Ein blosses `revoke ... from public` nimmt deshalb nur den PostgreSQL-Default-Grant und
-- laesst die drei Supabase-Grants stehen; die Funktionen waeren fuer `anon` aufrufbar.
--
-- ⚠ Das ist in dieser Migration real passiert und vom DB-Gate gefangen worden: der erste Wurf
-- revokte nur von PUBLIC, und `pg_proc.proacl` trug danach `anon=X`, `service_role=X` auf allen
-- drei Wrappern. Der Grant-Test ist genau dafuer da — die Abweichung ist an der Funktion selbst
-- nicht sichtbar, und aufgefallen waere sie erst, wenn jemand sie anonym aufruft.
revoke all on function public.admin_set_metering_point_count(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.list_metering_points(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.set_metering_point_load_profile(uuid, uuid, integer, timestamptz, timestamptz, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_set_metering_point_count(uuid, integer) to authenticated;
grant execute on function public.list_metering_points(uuid) to authenticated;
grant execute on function public.set_metering_point_load_profile(uuid, uuid, integer, timestamptz, timestamptz, jsonb) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 6 — Was es hier BEWUSST NICHT GIBT
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
--   * KEINE Zeitreihen-Tabelle. Die Viertelstundenwerte bleiben in der Datei (s. Kopf). Ein zweiter
--     Speicherort fuer dieselben Verbrauchsdaten waere eine zweite Wahrheit, und die Frage „welche
--     gilt?" fiele erst auf, wenn sie auseinanderlaufen.
--   * KEIN gezielter Loeschweg fuer EINEN Zaehlpunkt. Er waere die naheliegende Ergaenzung zu der
--     in TEIL 2 benannten Folge — und er braucht eine eigene Entscheidung darueber, was mit einem
--     bereits gelesenen Lastgang geschieht. Nebenbei gesetzt waere er genau der stille Datenverlust,
--     den TEIL 2 verhindert.
--   * KEINE Zaehlpunktnummer, KEINE Netzebene, KEINE Messvariante. Sie stehen nicht in einer
--     Lastgang-Datei; eine Spalte dafuer entschiede erneut den offenen Punkt 1 des Deltas still.
--   * KEINE Beziehung Zaehlpunkt→Analyse und KEINE Rollup-Schicht (Delta §2.4) — eigener Schritt.
--   * KEIN Fragenkatalog-Eintrag fuer „Anzahl Zaehlpunkte" (Delta §4) — eigener Schritt; bis dahin
--     legt ein Mensch die Zaehlpunkte ueber TEIL 2 an.
--   * KEINE Aufbewahrungsfrist. `platform.run_lead_retention` (B4-1) fasst die Tabelle nicht an.
--     ⚠ Sie traegt ab jetzt allerdings eine Aussage ueber den Verbrauchszeitraum eines Kunden —
--     die offene juristische Frage (`DEPLOYMENT.md` §7) waechst damit, wenn auch schwach: es sind
--     Zeitpunkte und Zahlen, keine Messwerte.
