-- B24, erster Bauschritt — das Account/Projekt-Fundament
-- (kanonisch: `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` §2 und §7; Reihenfolge/Einordnung
-- `Fahrplan_2026.md`, B24).
--
-- ── WAS HIER ENTSTEHT, IN EINEM SATZ ────────────────────────────────────────────────────────────
-- Der BESITZ-Unterbau, an dem später Chat-Zustand, Zählpunkte, Rückfragen und Analysen hängen:
-- `platform.accounts` (die Kunden-Identität, absichtlich NICHT gleich dem Login) und
-- `platform.projects` (der Container, den ein Kunde oder ein Admin anlegt) — mehr nicht.
--
-- ── WAS HIER AUSDRÜCKLICH NICHT ENTSTEHT ────────────────────────────────────────────────────────
-- KEIN Chat-Zustand, KEINE Zählpunkte, KEINE offenen Rückfragen, KEIN Segment-/Branchenfeld, KEINE
-- Verkettung zu `platform.analyses` (Delta §2.2/§2.3 — je eigener Bauschritt). KEINE
-- Fragenkatalog-Tabelle (§4), KEINE Kostenbremse (§6.3), KEINE automatische `calculator_pro`-Vergabe
-- (§6.2, offener Punkt 8). KEIN `tenant_id` (B13 bleibt zurückgestellt) und KEINE
-- Mehrfach-Login-Zwischentabelle (Delta §2.1 — die kommt ADDITIV, wenn es echten Bedarf gibt).
--
-- Unverändert bleiben `platform.leads`, `platform.analyses`, `platform.partners`, `grid_tariffs`,
-- `platform.entitlements` samt aller ihrer Wrapper und Grants; keine Zeile dieser Migration fasst
-- sie an. Der Registrierungsweg (`apps/web/lib/leads/capture-registration.ts`) ruft NICHTS von hier:
-- ein Account entsteht LAZY beim ersten eigenen Aufruf, nicht bei jedem Signup — sonst bekäme auch
-- jedes Admin- und jedes Partner-Konto eine Kunden-Account-Zeile, die niemand haben wollte.
--
-- ── KONVENTIONEN (exakt T4-1/B1-1/B14-1/B16-1/B16-4b) ───────────────────────────────────────────
-- Alles Fachliche in `platform` (nicht über die REST-API exponiert, `supabase/config.toml`), Zugriff
-- von aussen ausschliesslich über SECURITY-DEFINER-Wrapper im `public`-Schema, alle Funktionen mit
-- `SET search_path = ''` und vollqualifizierten Objektnamen, erst `revoke all … from public, anon,
-- authenticated, service_role`, dann gezielt grants. `anon` bekommt NIRGENDS etwas.
--
-- ── WARUM RLS OHNE POLICY UND NICHT EIGENTÜMERSCHAFTS-RLS ───────────────────────────────────────
-- Die naheliegende Konstruktion für „ein Kunde sieht seine Projekte" wäre eine RLS-Policy
-- `using (account_id in (select id from platform.accounts where user_id = auth.uid()))` plus ein
-- SELECT-Grant für `authenticated`. Sie wird hier NICHT gebaut, und der Grund ist gemessen statt
-- vermutet (`KI-Interface_Kalkulator_Bestandsaufnahme.md`, Befund E): im gesamten `platform`-Schema
-- gibt es dafür keinen Präzedenzfall. `platform.leads` — die einzige personenbezogene Tabelle
-- ausserhalb des Admin-Bereichs — trägt gar keinen Eigentümer-Verweis, hat RLS OHNE Policy und ist
-- ausschliesslich über geprüfte Wrapper erreichbar; `platform.analyses` ebenso, dort sogar ganz ohne
-- Tabellen-Grant für irgendeine Rolle. Diese Tabellen folgen demselben Muster:
--   * Zwei unabhängige Schichten — ohne Policy sähe selbst eine Rolle nichts, der jemand später
--     versehentlich ein Tabellenrecht gäbe.
--   * Die Zugriffsentscheidung steht in EINER lesbaren Zeile im Funktionsrumpf, nicht in einem
--     Policy-Ausdruck, den man beim Lesen der Tabelle nicht sieht.
--   * Der Wrapper entscheidet zusätzlich, WELCHE Spalten herauskommen — was eine Server Component
--     liest, kann im ausgelieferten HTML landen, auch wenn niemand es rendert (B16-2/B16-4b).
--
-- ── DIE `ON DELETE SET NULL`-FALLE GREIFT HIER NICHT — und das ist geprüft, nicht angenommen ─────
-- Beide Fremdschlüssel dieser Migration sind `on delete set null` (`accounts.user_id` → `auth.users`,
-- `projects.account_id` → `accounts`). Die im Repo viermal aufgetretene Falle (`leads.last_edited_by`,
-- `email_events.lead_id`, `analyses.lead_id`/`created_by`, `partner_applications.user_id`) entsteht
-- erst, wenn auf DERSELBEN Tabelle ein Append-only- oder Unveränderlichkeits-Trigger sitzt: die
-- referentielle Aktion IST selbst ein UPDATE und würde von ihm abgewiesen, wodurch das referenzierte
-- Konto unlöschbar wird. Diese beiden Tabellen tragen bewusst KEINEN solchen Trigger (ein Projekt ist
-- ein veränderlicher Arbeitsstand, keine eingefrorene Baseline — anders als `platform.analyses`), es
-- gibt hier also nichts freizustellen. Wer je einen solchen Trigger ergänzt, muss die asymmetrische
-- Ausnahme mitbauen.
--
-- ── ARBEITSREGEL 1 (Funktionsrümpfe) ────────────────────────────────────────────────────────────
-- Es wird keine Spalte gelöscht oder umbenannt; die Regel greift in ihrer Umkehrung (B16-4b): eine
-- NEUE Tabelle darf nicht von selbst irgendwo nach aussen gelangen. `platform.accounts` und
-- `platform.projects` werden von KEINEM bestehenden Funktionsrumpf gelesen — sie existieren vor
-- dieser Migration nicht, und kein bestehender Wrapper benutzt `select *` über ein `platform`-Objekt,
-- das sie enthalten könnte.
--
-- ── ARBEITSREGEL 5 (kein Direktaufruf ohne Grant) ───────────────────────────────────────────────
-- Das Gate prüft fehlende Aufrufbarkeit mit `has_function_privilege`, nicht durch einen Aufruf — ein
-- solcher hat im CI-Lauf von B16-4a den Postgres-Prozess mit Signal 11 beendet.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — platform.accounts: die Kunden-Identität, absichtlich NICHT gleich dem Login
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WARUM DIE TABELLE ÜBERHAUPT EXISTIERT, statt `projects.user_id` direkt auf auth.users ────────
-- Ein Betriebskunde (Delta §2.1: „z. B. ein Hotel") hat absehbar mehr als eine Person, die dasselbe
-- Projekt sehen muss. Hinge das Projekt direkt am Login, wäre der zweite Zugang ein Umbau am
-- Eigentums-Fremdschlüssel jedes bestehenden Projekts; mit einer Account-Ebene dazwischen ist er eine
-- ADDITIVE Zwischentabelle (`platform.account_members`) und das Entfernen genau EINER Bedingung.
-- Genau diese Vorausschau steht seit B16-4a am Spaltenkommentar von `platform.partners.user_id` —
-- dort als „absehbar temporär" markiert und nachträglich erkannt; hier von Anfang an mitgedacht.
create table platform.accounts (
  id uuid primary key default gen_random_uuid(),

  -- Nullable UND unique, wortgleiches Vorbild `platform.partners.user_id` (B16-4a):
  --   * `unique`   → erste Ausbaustufe genau EIN Login je Account. Fällt später ADDITIV weg, wenn
  --                  die Zwischentabelle kommt — die Struktur wird dann nicht umgebaut, es wird eine
  --                  Bedingung entfernt.
  --   * `null`     → Postgres wertet NULL in einem gewöhnlichen UNIQUE nie als gleich zu NULL;
  --                  mehrere verwaiste Accounts sind damit möglich, und genau das ist gewollt.
  --   * `set null` → ein gelöschtes Konto darf den Account und seine Projekte NICHT mitreissen
  --                  (dieselbe Lesart wie `analyses.lead_id`: es entfällt die ZUORDNUNG, nicht der
  --                  Vorgang). Ein `cascade` machte das Löschen eines Kontos zum stillen Löschen
  --                  bezahlter Arbeit.
  user_id uuid unique references auth.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table platform.accounts is
  'B24: die Kunden-Identität des Kalkulators, absichtlich NICHT 1:1 der Login (Delta §2.1). Trägt '
  'bewusst KEIN Typfeld Privat/Betrieb — das Segment hängt am Projekt, weil ein Account beides '
  'zugleich haben kann. Entsteht LAZY über public.get_or_create_my_account bzw. '
  'public.create_my_project, NICHT bei der Registrierung: sonst bekäme jedes Admin- und '
  'Partner-Konto eine Kunden-Account-Zeile. RLS aktiv OHNE Policy, kein Tabellen-Grant.';

comment on column platform.accounts.user_id is
  'Das Login, über das dieser Account erreicht wird. UNIQUE ist die erste Ausbaustufe (genau ein '
  'Login je Account, wie platform.partners heute) und faellt spaeter ADDITIV mit einer '
  'Zwischentabelle platform.account_members. NULLABLE + ON DELETE SET NULL: ein geloeschtes Konto '
  'laesst den Account und seine Projekte bestehen — es entfaellt die Zuordnung, nicht die Arbeit.';

create trigger accounts_set_updated_at
  before update on platform.accounts
  for each row execute function platform.set_updated_at();

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — platform.projects: der Container
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
create table platform.projects (
  id uuid primary key default gen_random_uuid(),

  -- NULLABLE, und das ist eine fachliche Aussage, kein technisches Zugeständnis (Delta §2.2):
  --   gesetzt → ein Kunde hat es selbst angelegt, sichtbar ausschliesslich fuer sein Konto;
  --   null    → ein Admin hat es angelegt (eigenes COOLiN-Projekt oder stellvertretend fuer einen
  --             Kunden ohne Konto). Der Zugriff laeuft dann ueber platform.is_admin(), nicht ueber
  --             Eigentuemerschaft — ein Admin braucht dafuer KEIN eigenes Kunden-Konto.
  -- ON DELETE SET NULL aus demselben Grund wie oben: ein entfernter Account darf das Projekt nicht
  -- mitnehmen; es wird dadurch zu einem admin-gefuehrten Projekt, bleibt aber vorhanden.
  account_id uuid null references platform.accounts (id) on delete set null,

  -- DENORMALISIERT, wortgleiches Vorbild platform.analyses.customer_label (B14-1): der Kundenname
  -- muss am Projekt stehen und nicht nur am Konto, weil das Konto verschwinden kann (Loeschung,
  -- Anonymisierung des zugehoerigen Leads) und das Projekt danach zuordenbar bleiben muss.
  -- CHECK gegen den leeren String: `not null` allein liesse '' zu, und ein Projekt ohne erkennbaren
  -- Namen ist in einer Liste nicht von einem Fehler zu unterscheiden.
  customer_label text not null constraint projects_customer_label_not_blank check (btrim(customer_label) <> ''),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table platform.projects is
  'B24: der Container eines Kalkulator-Vorhabens (Delta §2.2). Traegt in diesem Bauschritt NUR den '
  'Besitz — Chat-Zustand, offene Rueckfragen, Zaehlpunkte und die Verkettung zu platform.analyses '
  'sind eigene, spaetere Schritte. account_id null heisst admin-gefuehrt, nicht defekt. Es gibt '
  'bewusst KEINEN Append-only-Trigger: ein Projekt ist ein veraenderlicher Arbeitsstand, keine '
  'eingefrorene Baseline. RLS aktiv OHNE Policy, kein Tabellen-Grant.';

comment on column platform.projects.account_id is
  'Der besitzende Account, sofern es einen gibt. NULL = admin-gefuehrtes Projekt (Zugriff ueber '
  'platform.is_admin(), nicht ueber Eigentuemerschaft). ON DELETE SET NULL, NICHT CASCADE: ein '
  'entfernter Account nimmt das Projekt nicht mit, es wird dadurch admin-gefuehrt.';

comment on column platform.projects.customer_label is
  'Kunde/Firma wie im Bericht. DENORMALISIERT wie platform.analyses.customer_label (B14-1) — das '
  'Konto kann verschwinden, die Zuordenbarkeit des Projekts darf es nicht.';

create index projects_account_id_idx on platform.projects (account_id);

create trigger projects_set_updated_at
  before update on platform.projects
  for each row execute function platform.set_updated_at();

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — platform.ensure_account: EINE Definition, zwei Konsumenten
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Zwei public-Wrapper brauchen dasselbe „nimm den Account dieses Kontos, lege ihn sonst an".
-- Zweimal ausgeschrieben liefen sie beim naechsten Umbau auseinander — und das faellt niemandem auf,
-- weil beide Wege fuer sich funktionieren. Muster: platform.has_entitlement (T4-1) hinter
-- public.get_my_entitlement (T4-2). Der Parameter ist das Konto; die BINDUNG an auth.uid() geschieht
-- ausschliesslich in den public-Wrappern, sodass es hier nichts gibt, was nach einem fremden Account
-- fragen koennte.
--
-- ── NEBENLAEUFIGKEIT: `on conflict do nothing` PLUS ZWEITES SELECT, kein Exception-Handler ───────
-- Zwei gleichzeitige erste Aufrufe desselben Kontos lesen beide „kein Account" und legen beide an.
-- Die UNIQUE-Bedingung auf user_id faengt das ab; ohne die zweite Abfrage bekaeme der Verlierer
-- jedoch NULL zurueck und der Aufrufer haette einen Fehler dort, wo alles richtig gelaufen ist.
create function platform.ensure_account(p_user_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user_id is null then
    return null;
  end if;

  select a.id into v_id from platform.accounts a where a.user_id = p_user_id;
  if found then
    return v_id;
  end if;

  insert into platform.accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing
  returning id into v_id;

  if v_id is null then
    select a.id into v_id from platform.accounts a where a.user_id = p_user_id;
  end if;

  return v_id;
end;
$$;

comment on function platform.ensure_account(uuid) is
  'B24: der Account dieses Kontos, angelegt falls noch keiner existiert. EINE Definition fuer '
  'public.get_or_create_my_account UND public.create_my_project. Nimmt das Konto als PARAMETER; die '
  'Bindung an auth.uid() geschieht in den public-Wrappern (Muster platform.has_entitlement). '
  'p_user_id null liefert null und legt NICHTS an — ein Account ohne Konto entstuende sonst still.';

revoke all on function platform.ensure_account(uuid) from public;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — Die Wrapper des angemeldeten Kunden
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Alle vier: KEIN Konto-Parameter. Die Bindung entsteht im Rumpf ueber auth.uid() (Muster
-- public.get_my_partner, B16-4b, und public.get_my_entitlement, T4-2) — es gibt nichts zu
-- uebergeben und damit keinen Weg, nach einer fremden Zeile zu fragen.

-- ── get_or_create_my_account ────────────────────────────────────────────────────────────────────
create function public.get_or_create_my_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  -- Ohne Sitzung wird NICHTS angelegt. Sonst entstuende beim ersten unangemeldeten Aufruf eine
  -- Account-Zeile mit user_id null, die niemand je wieder erreichen koennte — und die im Bestand
  -- aussaehe wie ein Account, dessen Konto geloescht wurde.
  if v_uid is null then
    return jsonb_build_object('status', 'no_session');
  end if;

  v_id := platform.ensure_account(v_uid);

  return jsonb_build_object('status', 'ok', 'account_id', v_id);
end;
$$;

comment on function public.get_or_create_my_account() is
  'B24: der eigene Account, angelegt falls noch keiner existiert (LAZY — ausdruecklich nicht bei der '
  'Registrierung, s. Tabellenkommentar). KEIN Parameter: die Bindung entsteht im Rumpf ueber '
  'auth.uid(). Ohne Sitzung {status: no_session} und KEINE neue Zeile. authenticated-only.';

-- ── create_my_project ───────────────────────────────────────────────────────────────────────────
-- Legt in EINEM Aufruf Account (falls noetig) und Projekt an. Zwei getrennte Aufrufe waeren zwei
-- Transaktionen ueber PostgREST: scheiterte der zweite, bliebe ein Account ohne Projekt stehen — der
-- Nutzer klickt erneut, und beim naechsten Mal ist es derselbe Account, weil ensure_account
-- idempotent ist. Der Zustand ist also harmlos; die Klammer ist trotzdem richtig, weil sie den
-- Aufrufer davon befreit, die Reihenfolge zu kennen.
create function public.create_my_project(p_customer_label text)
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

  insert into platform.projects (account_id, customer_label)
  values (v_acc, v_label)
  returning id into v_id;

  return jsonb_build_object('status', 'ok', 'project_id', v_id, 'account_id', v_acc);
end;
$$;

comment on function public.create_my_project(text) is
  'B24: legt ein eigenes Projekt an und, falls noch keiner existiert, den zugehoerigen Account — in '
  'EINER Transaktion. Leere Bezeichnung wird als {status: invalid_label} abgewiesen statt als roher '
  'CHECK-Fehler. Ohne Sitzung {status: no_session} und KEINE Zeile. authenticated-only.';

-- ── list_my_projects ────────────────────────────────────────────────────────────────────────────
-- Kein Account → LEERE Liste, kein Fehler und kein eigener Status. „Ich habe noch keine Projekte"
-- ist der Normalfall jedes neuen Kontos und darf im Anwendungscode nicht wie ein Problem aussehen
-- (dieselbe Ueberlegung wie {status: none} bei get_my_partner, nur mit der leeren Liste als der hier
-- richtigen Form). Der Wrapper legt dabei ausdruecklich KEINEN Account an: Lesen darf nicht
-- schreiben, sonst entstuende bei jedem Seitenaufruf eines Fremden eine Zeile.
create function public.list_my_projects()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_rows jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'ok', 'projects', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select pr.id, pr.account_id, pr.customer_label, pr.created_at, pr.updated_at
    from platform.projects pr
    join platform.accounts a on a.id = pr.account_id
    where a.user_id = v_uid
  ) p;

  return jsonb_build_object('status', 'ok', 'projects', v_rows);
end;
$$;

comment on function public.list_my_projects() is
  'B24: die eigenen Projekte, neueste zuerst. Kein Account oder keine Projekte → LEERE Liste, kein '
  'Fehler. Legt NICHTS an (ein Lesezugriff, der schreibt, erzeugte bei jedem Seitenaufruf eine '
  'Zeile). Admin-gefuehrte Projekte (account_id null) erscheinen hier NIE. authenticated-only.';

-- ── get_my_project ──────────────────────────────────────────────────────────────────────────────
-- „Gibt es nicht" und „gehoert jemand anderem" liefern DENSELBEN Status. Der Unterschied waere eine
-- Auskunft ueber fremde Daten: wer IDs durchprobiert, erfuehre sonst, welche existieren. Dieselbe
-- Nicht-Unterscheidbarkeit wie bei get_active_partner (B16-2) und submit_partner_application (B16-3).
create function public.get_my_project(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_project jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  select to_jsonb(p)
    into v_project
  from (
    select pr.id, pr.account_id, pr.customer_label, pr.created_at, pr.updated_at
    from platform.projects pr
    join platform.accounts a on a.id = pr.account_id
    where pr.id = p_id
      and a.user_id = v_uid
  ) p;

  if v_project is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object('status', 'ok', 'project', v_project);
end;
$$;

comment on function public.get_my_project(uuid) is
  'B24: EIN eigenes Projekt. Ein fremdes und ein nicht existierendes Projekt liefern denselben '
  'Status not_found — der Unterschied waere eine Auskunft darueber, welche IDs es gibt. '
  'Admin-gefuehrte Projekte (account_id null) sind darueber nie erreichbar. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — Die Admin-Wrapper
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Alle drei WERFEN bei fehlender Adminrolle (42501) statt leer zu antworten — Muster
-- admin_list_analyses (B14-1): eine leere Liste ist hier die haeufigste ECHTE Antwort und darf nicht
-- zugleich „kein Zugriff" bedeuten. `service_role` bekommt bewusst KEIN Grant: die Rolle traegt kein
-- JWT, platform.is_admin() ist dort false, die Funktionen waeren funktionslos und stets abgelehnt.

-- ── admin_create_project ────────────────────────────────────────────────────────────────────────
create function public.admin_create_project(
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

  insert into platform.projects (account_id, customer_label)
  values (p_account_id, v_label)
  returning id into v_id;

  return jsonb_build_object('status', 'ok', 'project_id', v_id, 'account_id', p_account_id);
end;
$$;

comment on function public.admin_create_project(text, uuid) is
  'B24: ein Projekt als Admin anlegen. p_account_id optional — NULL ist der Regelfall (eigenes '
  'COOLiN-Projekt oder stellvertretend fuer einen Kunden ohne Konto), ein Wert ordnet es einem '
  'bestehenden Account zu. Unbekannte Kennung → {status: unknown_account} statt eines rohen '
  'Fremdschluessel-Fehlers. WIRFT ohne Adminrolle (42501). authenticated-only.';

-- ── admin_list_projects ─────────────────────────────────────────────────────────────────────────
-- Obergrenze 200 je Aufruf, wortgleich zu admin_list_analyses (B14-1), plus die Gesamtzahl: die
-- Ansicht soll sagen koennen „200 von 640 gezeigt" statt Vollstaendigkeit vorzutaeuschen. Die
-- Parameter tragen Vorgabewerte, `admin_list_projects()` bleibt also ein gueltiger Aufruf.
create function public.admin_list_projects(
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
    select pr.id, pr.account_id, pr.customer_label, pr.created_at, pr.updated_at
    from platform.projects pr
    where p_account_id is null or pr.account_id = p_account_id
  ),
  page as (
    select b.*
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
  'Vollstaendigkeit vorzutaeuschen. WIRFT ohne Adminrolle (42501). authenticated-only.';

-- ── admin_get_project ───────────────────────────────────────────────────────────────────────────
create function public.admin_get_project(p_id uuid)
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
    select pr.id, pr.account_id, pr.customer_label, pr.created_at, pr.updated_at
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
  'B24: EIN Projekt als Admin, unabhaengig von account_id. WIRFT ohne Adminrolle (42501), liefert '
  'sonst {status: not_found} fuer eine unbekannte Kennung. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 6 — RLS und Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Muster platform.analyses (B14-1), platform.job_runs (B4-1), platform.admin_exports (B2-1):
-- RLS an, KEINE Policy, fuer KEINE Rolle ein Tabellen-Grant — auch nicht fuer service_role.
alter table platform.accounts enable row level security;
alter table platform.projects enable row level security;

-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf NEUE public-Funktionen automatisch EXECUTE an
-- anon, authenticated UND service_role (zusaetzlich zum PostgreSQL-Default-Grant an PUBLIC). Deshalb
-- wie ueberall: erst allen entziehen, dann gezielt gewaehren. `anon` und `service_role` bekommen
-- NIRGENDS etwas — jede dieser Funktionen leitet ihre Autorisierung aus auth.uid() bzw.
-- platform.is_admin() ab, was dort null bzw. false ist.
revoke all on function public.get_or_create_my_account()
  from public, anon, authenticated, service_role;
revoke all on function public.create_my_project(text)
  from public, anon, authenticated, service_role;
revoke all on function public.list_my_projects()
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_project(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_create_project(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_list_projects(integer, integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_get_project(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.get_or_create_my_account() to authenticated;
grant execute on function public.create_my_project(text) to authenticated;
grant execute on function public.list_my_projects() to authenticated;
grant execute on function public.get_my_project(uuid) to authenticated;
grant execute on function public.admin_create_project(text, uuid) to authenticated;
grant execute on function public.admin_list_projects(integer, integer, uuid) to authenticated;
grant execute on function public.admin_get_project(uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 7 — Was es hier BEWUSST NICHT GIBT
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- KEIN Wrapper, der ein Projekt AENDERT oder LOESCHT. Nicht aus Unveraenderlichkeit (die waere hier
-- falsch, s. Tabellenkommentar), sondern weil dieser Schritt den Besitz-Unterbau legt und noch keine
-- Oberflaeche hat, die eine Aenderung ausloesen koennte. Ein Wrapper ohne Aufrufer waere eine
-- Angriffsflaeche ohne Nutzen; er kommt mit dem Schritt, der ihn braucht.
--
-- KEINE Spalte created_by auf platform.projects. Bei einem admin-gefuehrten Projekt (account_id
-- null) geht dadurch verloren, WELCHER Admin es angelegt hat. Bewusst nicht vorweggenommen: der
-- Auftrag dieses Schritts zaehlt die Spalten abschliessend auf, und die Ergaenzung ist spaeter
-- additiv moeglich (`on delete set null` — und dann ist die Trigger-Falle aus dem Kopf dieser Datei
-- mitzudenken, falls bis dahin ein Unveraenderlichkeits-Trigger dazugekommen ist).
--
-- KEINE Verknuepfung zu platform.analyses und KEIN Zaehlpunkt. Die Analyse haengt heute an einem
-- Lead, nicht an einem Projekt; die Umstellung ist Teil des Zaehlpunkt-Schritts (Delta §2.3) und
-- betrifft eine append-only Tabelle — sie wird dort mit eigener Begruendung entschieden, nicht hier
-- nebenbei.
