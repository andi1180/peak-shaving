-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- B24 Teil 1 — die Verkleinerungs-Sperre deckt auch das STANDARDPROFIL ab
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- `public.admin_set_metering_point_count` weist ein Verkleinern ab, sobald eine der betroffenen
-- Zeilen Daten traegt, die dabei verloren gingen (`has_load_profile`, Migration 20260911120000
-- TEIL 2). Die Bedingung dafuer war `source_document_id is not null` — sie beschrieb den damals
-- EINZIGEN Weg, auf dem ein Zaehlpunkt einen Zeitraum bekommt: die hochgeladene Datei.
--
-- ── ⚠ WAS SICH GEAENDERT HAT ───────────────────────────────────────────────────────────────────
-- Seit `public.set_metering_point_standard_profile` (Migration 20260911200000) gibt es einen
-- ZWEITEN Weg, und der setzt `source_document_id` ausdruecklich auf `null` — ein erzeugtes Profil
-- hat keine Datei und soll auch keine vortaeuschen. Ein Zaehlpunkt mit Standardprofil trug damit
-- vollstaendige Zeitraum-Daten UND lief durch die Sperre hindurch: das Verkleinern meldete `ok`
-- und nahm ihn mit. Kein Fehlschlag, keine Meldung — genau die Form von stillem Datenverlust,
-- gegen die die Sperre gebaut ist.
--
-- ── DIE NEUE BEDINGUNG: `source_document_id` ODER `covered_from` ───────────────────────────────
-- Beide decken je einen der zwei Wege ab, und `covered_from` wird von BEIDEN gesetzt, sobald es
-- ueberhaupt Zeitraum-Daten gibt (gemessen: es gibt im ganzen Schema genau drei Schreibstellen —
-- die zwei Profil-Setzer und `admin_reset_metering_point_load_profile`, das es zusammen mit den
-- uebrigen vier Spalten nullt). Die Sperre folgt damit der DATENLAGE statt der HERKUNFT.
--
-- ⚠ SIE WIRD DADURCH NICHT BREITER ALS GEWOLLT: ein blosser Entwurf (`mp.draft`, etwa ein
-- eingetragener Jahresverbrauch ohne erzeugtes Profil) setzt `covered_from` NICHT und bleibt
-- verkleinerbar. Genau das war der Vorbehalt, mit dem die Ausweitung in 20260911200000 noch
-- zurueckgestellt wurde („entscheidet damit zugleich ueber jeden Zaehlpunkt mit blossem Entwurf") —
-- er trifft auf diese Fassung nicht zu, weil sie an `covered_from` haengt und nicht an `draft`.
-- Ebenso unberuehrt bleibt die Zusage aus 20260911180000: nach einem Reset laesst sich wieder
-- verkleinern, denn der Reset nullt `covered_from` mit.
--
-- ── WAS SICH NICHT AENDERT ─────────────────────────────────────────────────────────────────────
--   * Die Signatur. `create or replace` bei UNVERAENDERTER Signatur — die Grants aus
--     20260911120000 (authenticated-only) bleiben bestehen und werden hier bewusst nicht neu
--     gesetzt.
--   * Der Rueckgabewert. Es bleibt bei `has_load_profile` samt `count`/`blocked`; die Oberflaeche
--     verzweigt weiterhin an demselben Status. Ein eigener Status fuer den Standardprofil-Fall
--     waere eine Unterscheidung ohne Folge: der Aufrufer kann in beiden Faellen dasselbe tun
--     (den Zeitraum ueber `admin_reset_metering_point_load_profile` entfernen, dann verkleinern).
--   * `set_metering_point_load_profile`, `set_metering_point_standard_profile` und
--     `admin_reset_metering_point_load_profile` — 0 Zeilen Diff.
--
-- Aenderung am Rumpf: GENAU ZWEI Zeilen (die Spalte in der CTE, die Bedingung darunter).
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.admin_set_metering_point_count(
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
      select mp.id, mp.source_document_id, mp.covered_from
      from platform.metering_points mp
      where mp.project_id = p_project_id
      order by mp.created_at desc, mp.id desc
      limit v_current - p_count
    )
    select count(*)::integer into v_blocked
    from doomed d
    -- ⚠ ODER, nicht UND: `source_document_id` deckt den hochgeladenen Lastgang ab, `covered_from`
    -- zusaetzlich das erzeugte Standardprofil (das bewusst OHNE Dokument entsteht). Beide Wege
    -- setzen `covered_from`; die zweite Bedingung allein taete es also fachlich — die erste bleibt
    -- stehen, damit auch der Rest aus einem `on delete set null` (Dokument entfernt, Zeitraum
    -- steht noch) weiterhin faellt, und weil eine Sperre, die den offensichtlichen Fall nicht
    -- selbst nennt, beim naechsten Umbau leicht wegoptimiert wird.
    where d.source_document_id is not null
       or d.covered_from is not null;

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
  'source_document_id ODER covered_from, wird der GESAMTE Aufruf mit has_load_profile abgewiesen '
  'und NICHTS geaendert — kein stiller Datenverlust. Die zweite Bedingung deckt das erzeugte '
  'Standardprofil ab, das bewusst OHNE Dokument entsteht; ein blosser Entwurf (draft) setzt '
  'covered_from nicht und bleibt verkleinerbar. Folge: liegt der Zeitraum auf dem juengsten '
  'Zaehlpunkt, laesst sich nicht verkleinern, auch wenn ein aelterer leer ist; ein gezielter '
  'Loeschweg ist bewusst nicht gebaut, der Rueckweg ist '
  'admin_reset_metering_point_load_profile. Obergrenze 100 ist eine Tippfehler-Bremse, keine '
  'Produktgrenze. WIRFT ohne Adminrolle (42501). authenticated-only.';
