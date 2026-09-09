-- B24-Nachtrag — `platform.projects.created_by`: WER hat dieses Projekt angelegt?
-- (kanonisch: `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` §2.2; die Lücke steht wörtlich in
-- TEIL 7 der Vorgänger-Migration `20260909120000_create_account_project_foundation.sql`.)
--
-- ── DER ANLASS STEHT IN DER VORGÄNGER-MIGRATION SELBST ──────────────────────────────────────────
-- Ihr TEIL 7 nennt die Auslassung im Klartext: „KEINE Spalte created_by auf platform.projects. Bei
-- einem admin-gefuehrten Projekt (account_id null) geht dadurch verloren, WELCHER Admin es angelegt
-- hat. Bewusst nicht vorweggenommen: der Auftrag dieses Schritts zaehlt die Spalten abschliessend
-- auf, und die Ergaenzung ist spaeter additiv moeglich." Das ist dieser Schritt — eine reine
-- Korrektur der selbst offengelegten Lücke, kein neuer Funktionsumfang.
--
-- Warum das ohne die Spalte teuer wird: `admin_create_project` ist der EINZIGE Weg zu einem Projekt
-- mit `account_id = null`, und genau dieser Weg ist danach anonym. Ein solches Projekt hat weder
-- Account noch Login, an dem sich seine Herkunft ablesen liesse — die Frage „wer hat das angelegt"
-- ist ohne die Spalte aus dem Bestand ÜBERHAUPT NICHT beantwortbar, auch nicht mit Aufwand. Das
-- unterscheidet die Lücke von einer blossen Bequemlichkeit.
--
-- ── WAS HIER ENTSTEHT ───────────────────────────────────────────────────────────────────────────
--   TEIL 1  die Spalte `platform.projects.created_by`
--   TEIL 2  `public.create_my_project`     — setzt sie (der Kunde selbst)
--   TEIL 3  `public.admin_create_project`  — setzt sie (der handelnde Admin; die eigentliche Lücke)
--   TEIL 4  `public.admin_list_projects` / `public.admin_get_project` — die Spalte fährt mit
--
-- ── WAS AUSDRÜCKLICH NICHT ENTSTEHT ─────────────────────────────────────────────────────────────
-- KEIN Wrapper, der ein Projekt ändert oder löscht (unverändert aus der Vorgänger-Migration: es gibt
-- weiterhin keine Oberfläche, die eine Änderung auslösen könnte, und ein Wrapper ohne Aufrufer wäre
-- Angriffsfläche ohne Nutzen). KEINE Änderung an `platform.accounts`, an `platform.ensure_account`,
-- an `public.get_or_create_my_account`, an `public.list_my_projects` und an `public.get_my_project`
-- (zu den beiden letzten s. TEIL 4). KEIN Index, KEIN Backfill, KEIN neuer Parameter an irgendeiner
-- Funktion, KEIN `tenant_id`, KEINE Verkettung zu `platform.analyses`, KEIN Zählpunkt.
--
-- ── KEIN BACKFILL, UND DAS IST GEMESSEN STATT ANGENOMMEN ────────────────────────────────────────
-- Beide Tabellen stehen in der Produktions-Cloud bei **0 Zeilen** (09.09.2026 über die
-- Management-API gezählt, wie schon beim Push der Vorgänger-Migration). Es gibt nichts nachzutragen;
-- ein Backfill hätte gar keine Zeile zu füllen und müsste den Urheber ohnehin erfinden.
--
-- ── ARBEITSREGEL 1 (Funktionsrümpfe) ────────────────────────────────────────────────────────────
-- Es wird keine Spalte gelöscht oder umbenannt; die Regel greift in ihrer Umkehrung — eine NEUE
-- Spalte darf nicht von selbst irgendwo nach aussen gelangen. Gegen die Cloud gemessen: GENAU SECHS
-- Funktionsrümpfe nennen `platform.projects` (die sechs Projekt-Wrapper der Vorgänger-Migration),
-- und jeder von ihnen baut seine Spaltenliste EXPLIZIT auf — keiner benutzt `select *` oder
-- `%rowtype`. Die neue Spalte gelangt also nirgends von selbst hinaus; sie muss dort, wo sie
-- erscheinen soll, ausdrücklich ergänzt werden (TEIL 4), und bleibt dort, wo sie nicht erscheinen
-- soll, ohne jedes Zutun draussen.
--
-- ── `CREATE OR REPLACE` BEI UNVERÄNDERTER SIGNATUR: DIE GRANTS BLEIBEN ──────────────────────────
-- Alle vier Funktionen behalten ihre Signatur Zeichen für Zeichen; es kommt kein Parameter dazu.
-- PostgreSQL erhält bei `create or replace` die bestehende ACL — im Gegensatz zu DROP+CREATE, wo die
-- Rechte neu zu setzen wären (in B3-1/B4-1/B2-1 real der Fall, hier ausdrücklich nicht). Deshalb
-- steht in dieser Migration KEIN einziger `grant`/`revoke`. Dass das trägt, prüft das DB-Gate
-- ohnehin bei jedem Lauf: der bestehende Test „EXECUTE auf den sieben Wrappern: exakt authenticated"
-- läuft nach dieser Migration und würde einen Rechteverlust sofort rot melden.
--
-- ── KONVENTIONEN (exakt T4-1/B1-1/B14-1/B16-1) ──────────────────────────────────────────────────
-- Alles Fachliche in `platform`, Zugriff von aussen ausschliesslich über SECURITY-DEFINER-Wrapper im
-- `public`-Schema, alle Funktionen mit `SET search_path = ''` und vollqualifizierten Objektnamen.
-- `anon` und `service_role` bekommen NIRGENDS etwas.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — die Spalte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WARUM `ON DELETE SET NULL` UND WARUM ES HIER OHNE TRIGGER-AUSNAHME AUSKOMMT ─────────────────
-- Wortgleiches Vorbild `platform.analyses.created_by` (B14-1) und `platform.admin_exports.exported_by`
-- (B2-1): das Projekt überlebt das Konto, das es angelegt hat — es entfällt die ZUORDNUNG, nicht die
-- Arbeit. Ein `cascade` machte das Löschen eines Admin-Kontos zum stillen Löschen fremder Projekte,
-- ein `restrict` machte das Konto unlöschbar, sobald es je ein Projekt angelegt hat — ausgerechnet
-- gegen ein Löschverlangen.
--
-- ⚠ Die im Repo FÜNFMAL aufgetretene Falle (`leads.last_edited_by`, `email_events.lead_id`,
-- `analyses.lead_id`/`created_by`, `partner_applications.user_id`) greift hier NICHT, und das ist
-- geprüft statt angenommen: die referentielle Aktion IST selbst ein UPDATE und wird nur dann zum
-- Problem, wenn auf DERSELBEN Tabelle ein Append-only- oder Unveränderlichkeits-Trigger sitzt, der
-- sie abweist. `platform.projects` trägt bewusst keinen solchen Trigger (ein Projekt ist ein
-- veränderlicher Arbeitsstand, keine eingefrorene Baseline — so schon im Tabellenkommentar) und
-- ausser `projects_set_updated_at` überhaupt keinen. Es gibt hier also nichts freizustellen.
-- **Wer je einen Unveränderlichkeits-Trigger auf diese Tabelle setzt, muss die asymmetrische
-- Ausnahme für BEIDE Fremdschlüssel mitbauen — `account_id` UND jetzt zusätzlich `created_by`.**
--
-- ── WARUM NULLABLE, UND WARUM DAS KEIN ZUGESTÄNDNIS IST ─────────────────────────────────────────
-- `not null` ginge nicht: `on delete set null` widerspräche ihm unmittelbar (das Löschen eines
-- Kontos scheiterte mit 23502 und machte es unlöschbar — in B16-3 genau so gemessen). Und die
-- Aussage ist ohnehin richtig: „das Konto, das dieses Projekt angelegt hat, gibt es nicht mehr" ist
-- ein legitimer Zustand, kein defekter. NULL heisst hier deshalb genau das — und ausdrücklich NICHT
-- „von niemandem angelegt".
--
-- ── KEIN INDEX ──────────────────────────────────────────────────────────────────────────────────
-- Es gibt keinen Filter, der einen bräuchte. `admin_list_projects` filtert über `account_id` (dafür
-- steht der Index seit der Vorgänger-Migration), nicht über den Urheber. Dieselbe Zurückhaltung wie
-- bei `platform.leads.thema`: B3-1 hat seine Teilindizes zusammen mit dem Filter bekommen, nicht
-- davor.
alter table platform.projects
  add column created_by uuid null references auth.users (id) on delete set null;

comment on column platform.projects.created_by is
  'Das Konto, das dieses Projekt ANGELEGT hat — bei create_my_project der Kunde selbst, bei '
  'admin_create_project der handelnde Admin. Letzteres ist der eigentliche Zweck der Spalte: ein '
  'admin-gefuehrtes Projekt (account_id null) hat weder Account noch Login, an dem sich seine '
  'Herkunft sonst ablesen liesse. BEWUSST auch dort gesetzt, wo es aus account_id abgeleitet werden '
  'koennte — explizit statt implizit, und die beiden koennen unabhaengig voneinander entfallen: wird '
  'der ACCOUNT geloescht, steht account_id auf null und created_by weiterhin auf dem Menschen, der '
  'es angelegt hat. NULLABLE + ON DELETE SET NULL wie analyses.created_by (B14-1): null heisst „das '
  'Konto gibt es nicht mehr", NICHT „von niemandem angelegt". Erscheint NUR in den Admin-Wrappern, '
  'nicht in list_my_projects/get_my_project — ein Kunde hat fuer die Kennung eines internen Kontos '
  'keine Verwendung.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — public.create_my_project: der Kunde selbst
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WARUM AUCH HIER, OBWOHL ES AUS `account_id` ABLEITBAR SCHEINT ───────────────────────────────
-- Auf den ersten Blick redundant: der Account gehört dem aufrufenden Konto, `created_by` ist also
-- dasselbe Konto. Zwei Gründe sprechen trotzdem dafür, und der zweite ist der tragende:
--
--   (a) Explizit statt implizit — dieselbe Haltung wie bei `projects.customer_label` und
--       `analyses.customer_label`: eine Angabe, die aus einem Join ableitbar WÄRE, steht trotzdem
--       da, weil der Join verschwinden kann.
--   (b) Und er verschwindet real: wird der ACCOUNT gelöscht (nicht das Konto), steht `account_id`
--       auf null — das Projekt sieht danach aus wie ein admin-geführtes. `created_by` sagt dann
--       weiterhin, dass ein KUNDE es angelegt hat, und welcher. Ohne die Zeile hier trüge
--       ausgerechnet der häufigere der beiden Erzeugerwege gar keinen Urheber, und die Spalte
--       hiesse in der Praxis „von einem Admin angelegt oder gar nicht angelegt".
--
-- Der Rumpf ist im Übrigen unverändert; `auth.uid()` liegt als `v_uid` bereits vor (die Funktion
-- bricht ohne Sitzung vorher ab), es kommt KEIN Parameter dazu und die Signatur bleibt gleich.
create or replace function public.create_my_project(p_customer_label text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_label text := nullif(btrim(coalesce(p_customer_label, '')), '');
  v_acc   uuid;
  v_id    uuid;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'no_session');
  end if;

  -- Als STATUS abgewiesen, nicht als roher 23514 aus dem CHECK: ein Constraint-Fehler traegt keinen
  -- Feldbezug, den die Oberflaeche anzeigen koennte (dieselbe Aufteilung wie bei den
  -- grid_tariff-Wrappern — Grenze im Schema, Meldung im Rumpf).
  if v_label is null then
    return jsonb_build_object('status', 'invalid_label');
  end if;

  v_acc := platform.ensure_account(v_uid);

  insert into platform.projects (account_id, customer_label, created_by)
  values (v_acc, v_label, v_uid)
  returning id into v_id;

  return jsonb_build_object('status', 'ok', 'project_id', v_id, 'account_id', v_acc);
end;
$$;

comment on function public.create_my_project(text) is
  'B24: legt ein eigenes Projekt an und, falls noch keiner existiert, den zugehoerigen Account — in '
  'EINER Transaktion. Setzt created_by = auth.uid() (der Kunde selbst): auch dort explizit, wo es '
  'aus account_id ableitbar waere, weil ein geloeschter ACCOUNT account_id nullt und das Projekt '
  'sonst wie ein admin-gefuehrtes aussaehe. Leere Bezeichnung wird als {status: invalid_label} '
  'abgewiesen statt als roher CHECK-Fehler. Ohne Sitzung {status: no_session} und KEINE Zeile. '
  'authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — public.admin_create_project: der handelnde Admin (die eigentliche Lücke)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Hier war die Auslassung wirklich teuer: dies ist der einzige Weg zu einem Projekt mit
-- `account_id = null`, und ohne diese Zeile bliebe genau dieses Projekt dauerhaft anonym.
--
-- ── KEIN PARAMETER FÜR DEN URHEBER, und das ist eine Sicherheitsentscheidung ────────────────────
-- Der Urheber ist der AUFRUFER, nicht eine Angabe. Ein `p_created_by`-Parameter liesse einen Admin
-- ein Projekt unter fremdem Namen anlegen — dieselbe Überlegung, aus der `analyses.created_by` in
-- B14-1 aus `auth.uid()` stammt und nicht aus dem Aufruf, und aus der die Kunden-Wrapper der
-- Vorgänger-Migration gar keinen Konto-Parameter haben („es gibt nichts zu übergeben und damit
-- keinen Weg, nach einer fremden Zeile zu fragen").
--
-- `auth.uid()` ist hier nie null: `platform.is_admin()` hat unmittelbar davor eine Sitzung mit
-- Admin-Rolle verlangt und wirft sonst. Es wird trotzdem nicht darauf gebaut — die Spalte ist
-- nullable, ein hypothetisches null ist also kein Fehlerfall, sondern trüge dieselbe Aussage wie ein
-- nachträglich gelöschtes Konto.
create or replace function public.admin_create_project(
  p_customer_label text,
  p_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := nullif(btrim(coalesce(p_customer_label, '')), '');
  v_id    uuid;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_create_project: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if v_label is null then
    return jsonb_build_object('status', 'invalid_label');
  end if;

  -- Eine unbekannte Account-Kennung wird BENANNT abgewiesen, nicht als roher 23503 durchgereicht:
  -- ein Fremdschluessel-Fehler sagt dem Admin nicht, WELCHE Angabe falsch war (dieselbe Ueberlegung
  -- wie bei der Slug-Pruefung in admin_update_lead, B16-1).
  if p_account_id is not null
     and not exists (select 1 from platform.accounts a where a.id = p_account_id) then
    return jsonb_build_object('status', 'unknown_account');
  end if;

  insert into platform.projects (account_id, customer_label, created_by)
  values (p_account_id, v_label, auth.uid())
  returning id into v_id;

  return jsonb_build_object('status', 'ok', 'project_id', v_id, 'account_id', p_account_id);
end;
$$;

comment on function public.admin_create_project(text, uuid) is
  'B24: ein Projekt als Admin anlegen. Setzt created_by = auth.uid() — der handelnde Admin; das ist '
  'der eigentliche Zweck der Spalte, denn dies ist der einzige Weg zu einem Projekt mit account_id '
  'null, das sonst dauerhaft anonym bliebe. KEIN Parameter fuer den Urheber: er ist der Aufrufer, '
  'nicht eine Angabe (sonst liesse sich unter fremdem Namen anlegen). p_account_id optional — NULL '
  'ist der Regelfall (eigenes COOLiN-Projekt oder stellvertretend fuer einen Kunden ohne Konto), ein '
  'Wert ordnet es einem bestehenden Account zu. Unbekannte Kennung → {status: unknown_account} statt '
  'eines rohen Fremdschluessel-Fehlers. WIRFT ohne Adminrolle (42501). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — die beiden Admin-Leser: die Spalte fährt mit
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WARUM AUSSCHLIESSLICH IM ADMIN-WEG ──────────────────────────────────────────────────────────
-- `public.list_my_projects` und `public.get_my_project` bleiben mit 0 Zeilen Diff unangetastet. Der
-- Wrapper entscheidet, WELCHE Spalten herauskommen (B16-2/B16-4b: was eine Server Component liest,
-- kann im ausgelieferten HTML landen, auch wenn niemand es rendert) — und ein Kunde hat für die
-- Kennung des internen Kontos, das sein Projekt angelegt hat, keine Verwendung. Bei seinen eigenen
-- Projekten wäre sie ohnehin seine eigene; bei einem stellvertretend angelegten wäre sie die eines
-- COOLiN-Mitarbeiters, und die gehört nicht ins Browser-Bündel eines Kunden.
--
-- ── ⚠ WARUM ZUSÄTZLICH `created_by_email` — MESSUNG, NICHT KOMFORT ──────────────────────────────
-- Die reine UUID wäre für den Admin-Bereich WERTLOS, und das ist gemessen statt vermutet:
-- `has_table_privilege(…, 'auth.users', 'SELECT')` ist für `anon`, `authenticated` UND `service_role`
-- gleichermassen **false** (09.09.2026 gegen den lokalen Stack). Es gibt also keinen zweiten Weg,
-- über den die Anwendung eine Kennung in einen Menschen auflösen könnte — die Lücke wäre „in der
-- Spalte vorhanden" und für jeden Leser trotzdem geschlossen. Aufgelöst wird deshalb IM Wrapper, der
-- als SECURITY DEFINER dem `postgres`-Eigentümer gehört; wortgleiches Vorbild
-- `public.admin_list_analyses`/`admin_get_analysis` (B14-1), die für dasselbe Feld genau das tun.
--
-- Und wie dort: aufgelöst wird NUR für die ausgelieferte SEITE, nicht für die Gesamtzahl — ein Join
-- über alle Treffer kostete für Zeilen, die niemand sieht.
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
    select pr.id, pr.account_id, pr.customer_label, pr.created_by, pr.created_at, pr.updated_at
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
  'Kennung waere fuer den Admin-Bereich nicht aufloesbar. WIRFT ohne Adminrolle (42501). '
  'authenticated-only.';

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
  'admin_get_analysis). WIRFT ohne Adminrolle (42501), liefert sonst {status: not_found} fuer eine '
  'unbekannte Kennung. authenticated-only.';
