-- B24 — Zaehlpunkt-Geruest und die zwei Admin-Leser, die Segment und Branche bisher verschwiegen.
--
-- Kanonische fachliche Quelle: `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` §2.3 (Zaehlpunkt:
-- „Ein Projekt kann mehrere Zaehlpunkte tragen") und §2.2 (Projekt traegt 1..n Zaehlpunkte).
-- Einordnung: `Fahrplan_2026.md`, B24 — Teil 1, Schritt 1 (Admin-Projektliste + Projekt anlegen).
--
-- ── WAS HIER ENTSTEHT ───────────────────────────────────────────────────────────────────────────
--   TEIL 1  `platform.metering_points` — das GERUEST der 1:n-Beziehung Projekt→Zaehlpunkt
--   TEIL 2  `public.admin_list_projects` liefert segment und industry mit (Rumpf, nicht Signatur)
--   TEIL 3  `public.admin_get_project` desgleichen
--   TEIL 4  RLS und Rechte
--   TEIL 5  Was es hier BEWUSST NICHT GIBT
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — platform.metering_points
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── ⚠ EINE TABELLE OHNE INHALT, UND DAS IST DER ZWECK ──────────────────────────────────────────
-- Delta §2.3 stellt den Zaehlpunkt zwischen Projekt und Analyse. WELCHE Angaben er traegt
-- (Zaehlpunktnummer, Netzebene, Messvariante, Lastgang-Bezug) entscheidet erst die Dateneingabe —
-- und zwar aus demselben Grund, aus dem `platform.projects.draft` ein `jsonb` geworden ist: der
-- Zuschnitt des Betrieb-Contracts ist offener Punkt 1 des Deltas. Spalten dafuer JETZT anzulegen
-- hiesse, eine offene fachliche Frage ueber ein Schema zu entscheiden, und zwar an der Stelle, an
-- der es am teuersten waere: eine falsch geschnittene Zaehlpunkt-Spalte traegt spaeter die
-- Netzebene, gegen die gerechnet wird.
--
-- Was diese Migration deshalb leistet, ist genau eine Sache: die BEZIEHUNG steht fest und ist
-- referentiell abgesichert, bevor der erste Schreibweg entsteht. Ein Zaehlpunkt gehoert zu genau
-- einem Projekt, und er verschwindet mit ihm.
--
-- ── ⚠ `ON DELETE CASCADE`, NICHT `SET NULL` — anders als bei `projects.account_id` ─────────────
-- Das Fundament und `platform.leads`/`analyses`/`partners` tragen durchgaengig `set null`, weil der
-- Vorgang seinen Bezug ueberleben soll: eine Analyse ohne Lead ist immer noch eine Analyse. Hier
-- gibt es diesen Grund nicht — ein Zaehlpunkt ohne Projekt ist kein Messpunkt mehr, sondern eine
-- Kennung, die niemand mehr einordnen kann. Wortgleiche Entscheidung und Begruendung wie bei
-- `project_messages`/`project_documents`/`project_open_questions` (20260910090000).
--
-- ⚠ DIE AUFLAGE, DIE MIT DER KASKADE KOMMT, GILT HIER GENAUSO: auf diese Tabelle darf NIE ein
-- Trigger, der DELETE abweist. Ein Append-only-Trigger im Sinn von `platform.analyses` machte das
-- Projekt UNLOESCHBAR. Die Unveraenderlichkeit eines Zaehlpunkts — falls sie je gewollt ist —
-- gehoert in die Rechteflaeche (kein Grant, Schreiben nur ueber gepruefte Wrapper), nicht in einen
-- Trigger.
create table platform.metering_points (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null references platform.projects (id) on delete cascade,

  created_at timestamptz not null default now()
);

comment on table platform.metering_points is
  'B24 (Delta §2.3): GERUEST der 1:n-Beziehung Projekt→Zaehlpunkt. Traegt bewusst nur die Beziehung '
  'und den Zeitstempel — der INHALT (Zaehlpunktnummer, Netzebene, Messvariante, Lastgang-Bezug) '
  'kommt erst mit der Dateneingabe, weil der Zuschnitt des Betrieb-Contracts offener Punkt 1 des '
  'Deltas ist und eine jetzt angelegte Spalte ihn still entscheiden wuerde. Es gibt in diesem '
  'Bauschritt KEINEN Wrapper und KEINE Oberflaeche dazu: die Tabelle ist leer und hat keinen '
  'Schreibweg. ⚠ ON DELETE CASCADE — deshalb darf hier NIE ein Trigger stehen, der DELETE abweist '
  '(er machte das Projekt unloeschbar).';

comment on column platform.metering_points.project_id is
  'Das Projekt, zu dem der Zaehlpunkt gehoert. NOT NULL: einen Zaehlpunkt ohne Projekt gibt es '
  'fachlich nicht (Delta §2.2: das Projekt traegt 1..n Zaehlpunkte, nicht umgekehrt).';

-- Der Index ist KEINE Vorratshaltung fuer einen kuenftigen Leser, sondern deckt eine Kante ab, die
-- es HEUTE schon gibt: ein Fremdschluessel ohne Index auf der Kindspalte zwingt jedes
-- `delete from platform.projects` zu einem Seq-Scan dieser Tabelle — und geloescht wird bereits
-- (das DB-Gate raeumt in mehreren Dateien so auf). Spaltenreihenfolge wie bei den drei
-- Geschwistertabellen: Projekt zuerst, Zeit danach.
create index metering_points_project_created_idx
  on platform.metering_points (project_id, created_at);

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — admin_list_projects liefert segment und industry mit
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── ⚠ DIE SIGNATUR BLEIBT UNANGETASTET — geaendert wird ausschliesslich der RUMPF ──────────────
-- `create or replace` bei identischer Parameterliste: die Grants bleiben stehen, es gibt nichts
-- nachzusetzen (ein DROP naehme sie mit — in B3-1 real passiert). Wortgleicher Zug und wortgleiche
-- Begruendung wie `20260910150000` TEIL 1, das `get_project` um `industry` erweitert hat.
--
-- ── WARUM ES NOETIG IST ─────────────────────────────────────────────────────────────────────────
-- Beide Admin-Leser fuehren eine AUSGESCHRIEBENE Spaltenliste (kein `select *`, kein `to_jsonb(pr)`
-- ueber die Tabelle) — genau deshalb erschienen `segment` und `industry` bisher nirgends, obwohl
-- beide Spalten seit dem zweiten bzw. fuenften Bauschritt existieren und der Chat sie fuellt. Die
-- Projektliste soll das Segment zeigen; ohne diese Erweiterung muesste sie es je Zeile ueber einen
-- zweiten Wrapper (`get_project`) nachladen — eine Abfrage je Zeile fuer eine Angabe, die in
-- derselben Zeile steht.
--
-- ⚠ FUER DEN ADMIN-BEREICH SIND DAS ZWEI VERSCHIEDENE AUSSAGEN, und beide muessen lesbar sein:
-- `segment is null` heisst „das Gespraech hat es noch nicht bestimmt" (nicht „Privat"), und
-- `industry is null` heisst bei einem Privat-Projekt „gibt es dort dauerhaft nicht". Die Ansicht
-- darf deshalb nichts ergaenzen, wo nichts steht.
create or replace function public.admin_list_projects(
  p_limit integer default 50,
  p_offset integer default 0,
  p_account_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total  integer;
  v_rows   jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_list_projects: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  with base as (
    select pr.id, pr.account_id, pr.customer_label, pr.segment, pr.industry,
           pr.created_by, pr.created_at, pr.updated_at
    from platform.projects pr
    where p_account_id is null or pr.account_id = p_account_id
  ),
  page as (
    select b.*,
           -- Nur für die Seite aufgelöst, nicht für die Gesamtzahl (Muster admin_list_analyses,
           -- B14-1): `base` wird materialisiert, und ein Join über alle Treffer kostete für Zeilen,
           -- die niemand sieht.
           (select au.email from auth.users au where au.id = b.created_by) as created_by_email
    from base b
    order by b.created_at desc
    limit v_limit offset v_offset
  )
  select (select count(*)::integer from base),
         coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc) from page p), '[]'::jsonb)
    into v_total, v_rows;

  return jsonb_build_object('status', 'ok', 'total', v_total, 'projects', v_rows);
end;
$$;

comment on function public.admin_list_projects(integer, integer, uuid) is
  'B24: alle Projekte, unabhaengig von account_id, seitenweise (Obergrenze 200 je Aufruf, Muster '
  'admin_list_analyses) und MIT Gesamtzahl — damit die Ansicht die Kuerzung offenlegen kann statt '
  'Vollstaendigkeit vorzutaeuschen. Liefert created_by UND das dazu aufgeloeste created_by_email '
  '(nur fuer die ausgelieferte Seite): auth.users ist fuer KEINE Client-Rolle lesbar, eine blosse '
  'Kennung waere fuer den Admin-Bereich nicht aufloesbar. Liefert seit 20260911090000 zusaetzlich '
  'segment und industry — beide NULLABLE, und NULL heisst „noch nicht bestimmt", nicht „privat" '
  'bzw. nicht „keine Branche". WIRFT ohne Adminrolle (42501). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — admin_get_project desgleichen
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Dieselbe Aenderung am selben Grund. Die naheliegende Alternative — die Detailseite liest
-- zusaetzlich `public.get_project`, das segment und industry seit 20260910150000 mitliefert und
-- ueber `platform.project_accessible` auch fuer einen Admin offen steht — waere ein zweiter
-- Roundtrip fuer EINEN Projektkopf, und die Seite haette zwei Quellen fuer dieselbe Zeile.
--
-- `admin_get_project` bleibt daneben bestehen und ist hier der richtige Leser: es liefert
-- `created_by_email`, und `get_project` tut das bewusst nicht (Kundensicht).
create or replace function public.admin_get_project(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_project jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_get_project: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select to_jsonb(p)
    into v_project
  from (
    select pr.id,
           pr.account_id,
           pr.customer_label,
           pr.segment,
           pr.industry,
           pr.created_by,
           (select au.email from auth.users au where au.id = pr.created_by) as created_by_email,
           pr.created_at,
           pr.updated_at
    from platform.projects pr
    where pr.id = p_id
  ) p;

  if v_project is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object('status', 'ok', 'project', v_project);
end;
$$;

comment on function public.admin_get_project(uuid) is
  'B24: EIN Projekt als Admin, unabhaengig von account_id. Liefert created_by UND das dazu '
  'aufgeloeste created_by_email (auth.users ist fuer keine Client-Rolle lesbar, Muster '
  'admin_get_analysis) sowie seit 20260911090000 segment und industry. WIRFT ohne Adminrolle '
  '(42501), liefert sonst {status: not_found} fuer eine unbekannte Kennung. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — RLS und Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Muster platform.accounts/projects (Fundament), platform.analyses (B14-1), die drei Chat-Tabellen
-- (20260910090000): RLS an, KEINE Policy, fuer KEINE Rolle ein Tabellen-Grant — auch nicht fuer
-- service_role. Zwei Schichten, die unabhaengig voneinander tragen: ohne Policy saehe selbst eine
-- Rolle nichts, der jemand spaeter versehentlich ein Tabellenrecht gaebe.
--
-- ⚠ `platform` steht — anders als `public` — NICHT in pg_default_acl: Supabase vergibt hier nichts
-- ungefragt, ein `revoke` waere also wirkungslose Zeremonie. Fuer eine Tabelle in `public` gilt das
-- Gegenteil (B21-1 hat das gemessen); wer diese Tabelle je dorthin verschoebe, braeuchte den
-- revoke-Block.
alter table platform.metering_points enable row level security;

-- Die beiden Funktionen oben sind per `create or replace` ersetzt, nicht neu angelegt: ihre Grants
-- (`authenticated` ja, `anon`/`service_role` nein) stehen unveraendert seit 20260909120000 bzw.
-- 20260909150000. Hier ist deshalb ausdruecklich NICHTS nachzusetzen — und genau das prueft das
-- DB-Gate, weil ein versehentliches DROP+CREATE sie stillschweigend mitgenommen haette.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — Was es hier BEWUSST NICHT GIBT
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
--   * KEIN Wrapper auf `metering_points` — weder lesend noch schreibend. Ein Wrapper ohne Aufrufer
--     ist Angriffsflaeche ohne Nutzen (dieselbe Regel wie TEIL 9 der Chat-Zustand-Migration), und
--     ein schreibender muesste entscheiden, WELCHE Angaben ein Zaehlpunkt traegt — also genau die
--     Frage, die dieser Schritt offen laesst.
--   * KEINE weitere Spalte. Der Bau-Auftrag zaehlt sie abschliessend auf; eine vierte waere eine
--     stille Erweiterung. Das DB-Gate misst die Spaltenliste EXAKT und wird rot, sobald jemand hier
--     etwas anhaengt, ohne es zu entscheiden.
--   * KEINE Beziehung Zaehlpunkt→Analyse. `platform.analyses` haengt heute am LEAD (B14-1) und ist
--     append-only; sie umzuhaengen ist Teil des Zaehlpunkt-/Rollup-Schritts (Delta §2.4) und
--     braucht dort eine eigene Begruendung, nicht eine nebenbei gesetzte Spalte.
--   * KEINE Aufbewahrungsfrist. `platform.run_lead_retention` (B4-1) fasst die Tabelle nicht an —
--     sie traegt heute ohnehin keine personenbezogene Angabe. Die offene juristische Frage
--     (`DEPLOYMENT.md` §7) waechst durch diesen Schritt nicht.
