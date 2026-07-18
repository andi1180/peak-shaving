-- Plattform-Fundament — geteiltes Auth-/Rollen-/Entitlement-Schema (T4-1,
-- Pflichtenheft_Monitor_MVP.md §3/§4.3/§4.4/§10/§13, Invarianten I1–I10).
--
-- Dieses Schema trägt ZWEI Produkte: den Haushalts-Monitor (jetzt) und den Kalkulator-Portalteil
-- (später). Es liegt bewusst NICHT im Schema `monitor` — ein Produkt-Schema darf nie eine
-- Abhängigkeit des geteilten Fundaments werden. `platform` kennt kein Produktwissen außer einem
-- Produktschlüssel (platform.product_key).
--
-- Stripe ist die Wahrheit über Zahlungen. `platform` ist ein SPIEGEL, damit Cron-Jobs (T7) und
-- Server-Reads (T4-2) ohne Stripe-Live-Call entscheiden können (§4.3). Der Spiegel entwickelt nie
-- eine eigene Meinung: die Zugangs-Entscheidung wird aus platform.subscriptions per DB-Trigger nach
-- platform.entitlements abgeleitet, nicht von Anwendungscode (I2).
--
-- REIN DATENBANK. Kein Auth-Code, kein Stripe-Code, keine App-Anbindung — das kommt in T4-2/T4-3/
-- T4-4. Stilvorgabe: die beiden monitor-Migrationen (Namens-/Kommentar-/RLS-/Grant-/Append-only-/
-- search_path-Konvention).

create schema if not exists platform;

comment on schema platform is
  'Produktübergreifendes Auth-/Rollen-/Entitlement-Fundament (Pflichtenheft_Monitor_MVP.md §4.4). '
  'Geteilt von Monitor UND künftigem Kalkulator-Portal — bewusst getrennt von den Produkt-Schemas '
  '(monitor, …). Trägt Stripe-SPIEGEL-Daten (§4.3): Zahlungswahrheit liegt bei Stripe, hier nur '
  'ableitbarer Zugangsstatus. Änderungen hier sind produktübergreifend und mit der Kalkulator-Doku '
  'synchron zu halten (§15).';

-- ── Typen ──────────────────────────────────────────────────────────────────────────────────────
-- product_key + entitlement_source sind UNSER Vokabular → Enum (ein Tippfehler soll hart scheitern,
-- nicht stillschweigend ein leeres Entitlement erzeugen). subscription_status ist FREMDvokabular
-- (Stripe, einseitig erweiterbar) → text + CHECK, per Migration leichter zu weiten als ein Enum.

create type platform.product_key as enum ('monitor', 'calculator_pro');

comment on type platform.product_key is
  'Produkt-Schlüssel des Entitlement-/Subscription-Modells. Enum, weil es UNSER kontrolliertes '
  'Vokabular ist — ein Tippfehler im Produktschlüssel soll hart scheitern statt still ein leeres '
  'Entitlement zu erzeugen.';

create type platform.entitlement_source as enum ('stripe', 'manual');

comment on type platform.entitlement_source is
  'Herkunft eines Entitlements: stripe (per DB-Trigger aus subscriptions abgeleitet, I2) oder '
  'manual (händischer Grant, z. B. Testnutzer — vom Sync-Trigger NIE angefasst).';

-- ── profiles: 1:1 zu auth.users (I7), automatisch per Trigger angelegt ───────────────────────────
-- KEIN E-Mail-Duplikat: die E-Mail lebt in auth.users, ein zweiter Ort wäre eine Divergenzquelle.

create table platform.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table platform.profiles is
  'Ein Profil je auth.users-Eintrag (I7 — per platform.handle_new_user automatisch angelegt, kein '
  'Anwendungscode-Pfad erzeugt "User ohne Profil"). Bewusst OHNE E-Mail-Spalte (lebt in auth.users, '
  'kein zweiter Ort). display_name ist die EINZIGE vom Nutzer editierbare Spalte (Column-Grant unten).';

-- ── customers: Stripe-Customer-Spiegel, bewusst getrennt von profiles ─────────────────────────────
-- Ein Stripe-Customer kann VOR jedem Abo existieren, und Stripe-Wissen gehört nicht ins Profil.

create table platform.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table platform.customers is
  'Zuordnung auth.users → Stripe-Customer. Getrennt von profiles, weil ein Stripe-Customer vor dem '
  'ersten Abo existieren kann und Stripe-Interna nicht ins Profil gehören. stripe_customer_id ist '
  'unique (der Rückweg Customer→User, den der Webhook T4-3 braucht). 1 Customer/Nutzer ist die '
  'Erwartung, aber nicht hart erzwungen (Stripe kann in Randfällen mehrere anlegen).';

create index customers_user_id_idx on platform.customers (user_id);

-- ── subscriptions: Stripe-Subscription-Spiegel (Quelle der Entitlement-Ableitung, I2/I9) ─────────
-- stripe_event_created_at trägt den Out-of-order-Schutz (I5): ein Update mit älterem Event wird
-- verworfen (Trigger unten). price_id/current_period_end bewusst NULLbar — ein incomplete-Abo hat
-- sie evtl. noch nicht; ein Spiegel soll an unvollständigen Zwischenständen nicht scheitern.

create table platform.subscriptions (
  stripe_subscription_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  product platform.product_key not null,
  status text not null check (status in (
    'active', 'past_due', 'unpaid', 'canceled',
    'incomplete', 'incomplete_expired', 'trialing', 'paused'
  )),
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  stripe_event_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table platform.subscriptions is
  'Stripe-Subscription-Spiegel. AUSSCHLIESSLICH über den Webhook (T4-3, service_role) geschrieben. '
  'status ist Stripe-Vokabular (text + CHECK statt Enum — Stripe kann es einseitig erweitern). '
  'Aus dieser Tabelle leitet platform.sync_entitlement_from_subscription die entitlements-Zeile ab '
  '(I2/I9) — NIE der Handler selbst.';

comment on column platform.subscriptions.status is
  'Stripe-Subscription-Status (die acht bekannten Werte, s. CHECK). Fremdvokabular: bei einer '
  'künftigen Stripe-Erweiterung wird der CHECK per Migration geweitet. Hinweis: das Pflichtenheft '
  'nennt "neun" Werte, Stripe kennt aktuell aber genau diese ACHT — s. Handover/Report.';

comment on column platform.subscriptions.stripe_event_created_at is
  'Zeitstempel des zugrunde liegenden Stripe-Events (event.created). Out-of-order-Schutz I5: '
  'platform.reject_stale_subscription_update verwirft ein Update mit älterem Wert.';

comment on column platform.subscriptions.cancel_at_period_end is
  'Geplante Kündigung zum Periodenende. Ändert die Aktivität NICHT (I9): bezahlt ist bezahlt bis '
  'current_period_end — fachliche Aussage, kein Implementierungsdetail.';

create index subscriptions_user_id_idx on platform.subscriptions (user_id);

-- ── entitlements: die EINE Tabelle, die Anwendungscode zur Zugangsentscheidung liest (I1) ─────────
-- hasActiveMonitor = ein Read hier, nie eine Stripe-Abfrage, nie ein Join über subscriptions.
-- Pro Nutzer und Produkt genau eine Zeile.

create table platform.entitlements (
  user_id uuid not null references auth.users (id) on delete cascade,
  product platform.product_key not null,
  is_active boolean not null,
  valid_until timestamptz,
  source platform.entitlement_source not null,
  note text,
  updated_at timestamptz not null default now(),
  primary key (user_id, product)
);

comment on table platform.entitlements is
  'Die EINZIGE Tabelle, die Anwendungscode zur Zugangsentscheidung liest (I1 — hasActiveMonitor). '
  'Zeilen mit source=stripe werden AUSSCHLIESSLICH vom DB-Trigger aus subscriptions abgeleitet (I2), '
  'nie von Anwendungscode — der Handler kann das Nachziehen vergessen, die DB nicht. Der Guard '
  'platform.guard_entitlement_stripe_source erzwingt das hart. source=manual (Testnutzer) schreibt '
  'die App per service_role und der Sync-Trigger fasst es nie an.';

comment on column platform.entitlements.valid_until is
  'Gültig bis (Spiegel von current_period_end bei source=stripe). NULL = unbefristet (typisch bei '
  'manual). platform.has_entitlement sperrt bei abgelaufenem valid_until auch dann, wenn is_active '
  '= true (I1/T11).';

-- ── stripe_events: Idempotenz-Ledger, append-only (I6) — Muster wie monitor.scrape_runs ──────────
-- Primärschlüssel ist die Stripe-Event-ID: ein zweites Insert derselben ID schlägt fehl — GENAU
-- der Idempotenz-Mechanismus, den der Webhook (T4-3) nutzt. Bewusst OHNE user_id: die
-- Idempotenz-Zeile entsteht, BEVOR der Handler Customer→User auflöst; ein user_id-Bezug wäre oft
-- NULL und architektonisch falsch. Personenbezug (DSGVO I8) lebt in den fünf user-gebundenen
-- Tabellen (allesamt ON DELETE CASCADE) — payload-Aufbewahrung ist Sache des Handlers (T4-3).

create table platform.stripe_events (
  stripe_event_id text primary key,
  type text,
  received_at timestamptz not null default now(),
  payload jsonb
);

comment on table platform.stripe_events is
  'Append-only Idempotenz-Ledger der verarbeiteten Stripe-Webhook-Events (I6). PK = Stripe-Event-ID: '
  'ein zweites Insert derselben ID scheitert (der Idempotenz-Mechanismus für T4-3). UPDATE/DELETE '
  'sind zusätzlich per Trigger geblockt. Bewusst NICHT user-gebunden (Idempotenz vor User-Auflösung).';

-- ── user_roles: Rollen, Admin-Prüfung über SECURITY-DEFINER-Funktion (I10) ───────────────────────
-- Kein Rollenwissen in JWT-Claims: ein entzogenes Admin-Recht muss SOFORT greifen (nächster Read),
-- nicht erst beim Token-Refresh.

create table platform.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

comment on table platform.user_roles is
  'Rollenzuweisungen. role als text + CHECK (aktuell nur admin; weitere Rollen per Migration). '
  'Admin-Prüfung läuft über platform.is_admin() (SECURITY DEFINER), damit RLS-Policies nicht '
  'rekursiv auf diese RLS-geschützte Tabelle zugreifen (I10). Kein Rollenwissen in JWT-Claims — '
  'ein Entzug greift sofort, nicht erst beim Token-Refresh.';

-- ── Funktionen & Trigger (alle mit SET search_path = '', Muster wie monitor) ─────────────────────

-- set_updated_at: EIGENE Kopie im platform-Schema (nicht monitor.set_updated_at referenziert).
-- Bewusste Entscheidung (Schema-Autarkie): platform ist das geteilte Fundament und darf NICHT von
-- einem Produkt-Schema (monitor) abhängen — genau das wäre die verbotene Abhängigkeitsrichtung.
-- Eine identische, aber eigenständige Funktion ist der geringere Preis gegenüber einer
-- Fundament→Produkt-Kopplung.
create function platform.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function platform.set_updated_at is
  'Generischer BEFORE UPDATE-Trigger: setzt updated_at auf now(). Eigenständige platform-Kopie '
  '(NICHT monitor.set_updated_at) — das Fundament darf nicht vom Produkt-Schema abhängen.';

-- handle_new_user: I7. AFTER INSERT auf auth.users, SECURITY DEFINER (die auth-interne Rolle hat
-- keinen Schreibzugriff auf platform), idempotent (ON CONFLICT DO NOTHING).
create function platform.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into platform.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

comment on function platform.handle_new_user is
  'I7: legt zu jedem neuen auth.users-Eintrag genau eine platform.profiles-Zeile an. SECURITY '
  'DEFINER (Insert durch die auth-interne Rolle), idempotent — kein Codepfad kann "User ohne '
  'Profil" erzeugen.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function platform.handle_new_user();

-- reject_stale_subscription_update: I5. RETURN NULL bricht das Update für diese Zeile ab (Zeile
-- bleibt unverändert, KEIN Fehler; der AFTER-Sync-Trigger feuert dann NICHT). Ein doppelt
-- zugestelltes altes Event ist ein Normalfall, kein Fehlerfall — der Aufrufer darf nicht scheitern.
create function platform.reject_stale_subscription_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stripe_event_created_at < old.stripe_event_created_at then
    return null;
  end if;
  return new;
end;
$$;

comment on function platform.reject_stale_subscription_update is
  'I5 Out-of-order-Schutz: verwirft ein subscriptions-UPDATE, dessen stripe_event_created_at ÄLTER '
  'ist als der gespeicherte Stand (RETURN NULL → Zeile unverändert, kein Fehler, kein Sync). '
  'Gleichstand oder neuer → durchlassen.';

create trigger subscriptions_reject_stale_update
  before update on platform.subscriptions
  for each row execute function platform.reject_stale_subscription_update();

create trigger subscriptions_set_updated_at
  before update on platform.subscriptions
  for each row execute function platform.set_updated_at();

-- reject_stripe_event_mutation: I6 append-only. Muster wie monitor.reject_tariff_snapshot_mutation
-- (eigene Funktion statt Wiederverwendung — das Fundament hängt nicht am Produkt-Schema, s. o.).
create function platform.reject_stripe_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'platform.stripe_events ist append-only (Idempotenz-Ledger, Invariante I6) — % nicht erlaubt',
    tg_op;
end;
$$;

comment on function platform.reject_stripe_event_mutation is
  'I6: blockt UPDATE/DELETE auf stripe_events hart (append-only Idempotenz-Ledger). Zusätzlich zum '
  'fehlenden update/delete-Grant — greift auch gegen BYPASSRLS-Rollen (service_role) und künftige '
  'Grant-Fehler.';

create trigger stripe_events_no_update
  before update on platform.stripe_events
  for each row execute function platform.reject_stripe_event_mutation();

create trigger stripe_events_no_delete
  before delete on platform.stripe_events
  for each row execute function platform.reject_stripe_event_mutation();

-- status_grants_access: EINZIGE Stelle des I9-Status-Mappings (Stripe-Status → aktiv/inaktiv).
-- active/trialing/past_due → aktiv (Stripe wiederholt den Einzug bei past_due; ein zahlender Kunde
-- wird nicht wegen einer abgelaufenen Karte sofort ausgesperrt). Alles andere → inaktiv.
create function platform.status_grants_access(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('active', 'trialing', 'past_due');
$$;

comment on function platform.status_grants_access is
  'I9-Status-Mapping (einzige Quelle): true für active/trialing/past_due, sonst false. '
  'cancel_at_period_end fließt bewusst NICHT ein — bezahlt ist bezahlt bis current_period_end.';

-- guard_entitlement_stripe_source: erzwingt I2 hart. Ein Schreibzugriff, der eine source=stripe-
-- Zeile erzeugen/hinterlassen würde, ist NUR aus dem Sync-Trigger heraus erlaubt (der setzt das
-- transaktionslokale Flag platform.entitlement_sync='on'). Anwendungscode (service_role) kann so
-- keine stripe-Entitlements fälschen; manuelle Grants (source<>'stripe') passieren ungehindert.
create function platform.guard_entitlement_stripe_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source = 'stripe'
     and coalesce(current_setting('platform.entitlement_sync', true), 'off') <> 'on'
  then
    raise exception
      'platform.entitlements.source=stripe wird ausschließlich vom Trigger '
      'sync_entitlement_from_subscription geschrieben (Invariante I2) — kein direkter Schreibzugriff';
  end if;
  return new;
end;
$$;

comment on function platform.guard_entitlement_stripe_source is
  'I2-Hartschutz: source=stripe-Zeilen dürfen NUR aus sync_entitlement_from_subscription entstehen '
  '(erkennbar am transaktionslokalen Flag platform.entitlement_sync). Anwendungscode kann keine '
  'stripe-Entitlements schreiben; manuelle Grants (source=manual) bleiben unberührt.';

create trigger entitlements_guard_stripe_source
  before insert or update on platform.entitlements
  for each row execute function platform.guard_entitlement_stripe_source();

create trigger entitlements_set_updated_at
  before update on platform.entitlements
  for each row execute function platform.set_updated_at();

-- sync_entitlement_from_subscription: I2/I9. AFTER INSERT OR UPDATE auf subscriptions. Leitet die
-- entitlements-Zeile (user_id, product) ab — Upsert, aber NUR wenn die bestehende Zeile source=
-- stripe ist (WHERE e.source='stripe'): eine manuelle Zeile wird nie überschrieben (I2). SECURITY
-- DEFINER, damit die Ableitung unabhängig von den Grants der schreibenden Rolle garantiert ist.
-- WARUM Trigger statt Handler-Code: der Webhook-Handler (T4-3) kann das Nachziehen vergessen — die
-- DB nicht. Die Zugangswahrheit hängt so nie an fehlerfreiem Anwendungscode.
create function platform.sync_entitlement_from_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('platform.entitlement_sync', 'on', true);

  insert into platform.entitlements as e
    (user_id, product, is_active, valid_until, source, updated_at)
  values
    (new.user_id,
     new.product,
     platform.status_grants_access(new.status),
     new.current_period_end,
     'stripe',
     now())
  on conflict (user_id, product) do update
    set is_active   = excluded.is_active,
        valid_until = excluded.valid_until,
        updated_at  = now()
  where e.source = 'stripe';

  perform set_config('platform.entitlement_sync', 'off', true);
  return null;
end;
$$;

comment on function platform.sync_entitlement_from_subscription is
  'I2/I9: leitet die entitlements-Zeile (user_id, product) aus einer subscriptions-Zeile ab. '
  'is_active = platform.status_grants_access(status), valid_until = current_period_end, '
  'source = stripe. Upsert nur über bestehende stripe-Zeilen (WHERE source=stripe) — manuelle '
  'Grants bleiben unangetastet (I2). SECURITY DEFINER (garantierte Ableitung), Trigger statt '
  'Handler (die DB vergisst nicht).';

create trigger subscriptions_sync_entitlement
  after insert or update on platform.subscriptions
  for each row execute function platform.sync_entitlement_from_subscription();

-- is_admin: I10. SECURITY DEFINER → liest user_roles unter Umgehung von dessen RLS und vermeidet so
-- die Rekursion, wenn künftige RLS-Policies (T4-4) is_admin() aufrufen.
create function platform.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from platform.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'admin'
  );
$$;

comment on function platform.is_admin is
  'I10: true, wenn der aktuelle auth.uid() die Rolle admin hat. SECURITY DEFINER, damit RLS-Policies '
  'diese Funktion nutzen können, ohne rekursiv auf die RLS-geschützte user_roles zuzugreifen. Liest '
  'die Tabelle live (kein JWT-Claim) — ein Entzug greift sofort.';

-- has_entitlement: die EINZIGE Funktion, die T7 (Cron) später aufruft, um ohne Stripe-Live-Call zu
-- entscheiden, ob ein Nutzer Zugang hat (I1). Zeitablauf sperrt auch bei is_active=true (I1/T11).
create function platform.has_entitlement(p_user_id uuid, p_product platform.product_key)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from platform.entitlements e
    where e.user_id = p_user_id
      and e.product = p_product
      and e.is_active
      and (e.valid_until is null or e.valid_until > now())
  );
$$;

comment on function platform.has_entitlement is
  'I1: aktiver Zugang eines Nutzers zu einem Produkt — is_active UND (valid_until IS NULL OR '
  'valid_until > now()). Die EINZIGE Funktion, die T7 (Cron) aufruft (kein Stripe-Live-Call, §4.3). '
  'Ein abgelaufenes valid_until sperrt auch bei is_active=true (T11).';

-- ── RLS + Grants: Least-Privilege (Muster wie monitor — kein Grant ist die Voreinstellung) ───────
-- anon bekommt NIRGENDS ein Grant oder eine Policy (auch keine Schema-Usage) → jeder Zugriff scheitert
-- an "permission denied" (I3/T4). authenticated darf ausschließlich EIGENE Zeilen LESEN (I4) und auf
-- profiles den Anzeigenamen ändern. Schreibzugriff auf customers/subscriptions/entitlements/
-- stripe_events/user_roles hat KEINE Nutzer-Rolle (I3). service_role (BYPASSRLS, serverseitig) bekommt
-- genau die Rechte, die Webhook (T4-3)/Cron (T7) brauchen — nirgends delete (Löschung läuft
-- ausschließlich über den auth.users-Cascade, I8).

grant usage on schema platform to authenticated, service_role;

alter table platform.profiles enable row level security;
alter table platform.customers enable row level security;
alter table platform.subscriptions enable row level security;
alter table platform.entitlements enable row level security;
alter table platform.stripe_events enable row level security;
alter table platform.user_roles enable row level security;

-- profiles: eigene Zeile lesen; Anzeigename der eigenen Zeile ändern (Column-Grant, nicht nur Policy).
-- (select auth.uid()) statt auth.uid(): initplan-Caching, Supabase-RLS-Performance-Empfehlung.
create policy profiles_select_own on platform.profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy profiles_update_own on platform.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
grant select on platform.profiles to authenticated;
grant update (display_name) on platform.profiles to authenticated;
grant select, insert, update on platform.profiles to service_role;

-- customers: nur eigene Zeile lesen.
create policy customers_select_own on platform.customers
  for select to authenticated using (user_id = (select auth.uid()));
grant select on platform.customers to authenticated;
grant select, insert, update on platform.customers to service_role;

-- subscriptions: nur eigene Zeile lesen.
create policy subscriptions_select_own on platform.subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
grant select on platform.subscriptions to authenticated;
grant select, insert, update on platform.subscriptions to service_role;

-- entitlements: nur eigene Zeile lesen — KEIN Schreibrecht für Nutzer (der Bezahlschutz, I3/T3).
create policy entitlements_select_own on platform.entitlements
  for select to authenticated using (user_id = (select auth.uid()));
grant select on platform.entitlements to authenticated;
-- service_role darf schreiben für MANUELLE Grants (source=manual). source=stripe bleibt trotz dieses
-- Grants durch guard_entitlement_stripe_source hart gesperrt (I2).
grant select, insert, update on platform.entitlements to service_role;

-- stripe_events: KEIN anon/authenticated-Zugriff (weder Grant noch Policy). service_role nur
-- select+insert (append-only, zusätzlich Trigger-geblockt).
grant select, insert on platform.stripe_events to service_role;

-- user_roles: nur eigene Zeile lesen. Schreiben (Rollenvergabe) hat aktuell KEINE App-Rolle — läuft
-- über Migration/DB-Admin, bis T4-4 einen kontrollierten Pfad ergänzt (keine Rechte auf Vorrat).
create policy user_roles_select_own on platform.user_roles
  for select to authenticated using (user_id = (select auth.uid()));
grant select on platform.user_roles to authenticated;
grant select on platform.user_roles to service_role;

-- Funktions-Rechte: SECURITY-DEFINER-Funktionen erst von PUBLIC entziehen, dann gezielt vergeben.
revoke all on function platform.handle_new_user() from public;
revoke all on function platform.sync_entitlement_from_subscription() from public;
revoke all on function platform.is_admin() from public;
revoke all on function platform.has_entitlement(uuid, platform.product_key) from public;
-- is_admin wird von RLS-Policies (T4-4) im authenticated-Kontext ausgewertet → authenticated braucht
-- execute. has_entitlement ruft nur Server-Code (T7 Cron, service_role) auf — bewusst NICHT für
-- authenticated freigegeben (sonst könnte ein Nutzer den Abo-Status BELIEBIGER user_ids abfragen).
grant execute on function platform.is_admin() to authenticated, service_role;
grant execute on function platform.has_entitlement(uuid, platform.product_key) to service_role;

-- ── Bewusst NICHT gebaut (keine Rechte auf Vorrat) ───────────────────────────────────────────────
-- Admin-Policies (platform.is_admin() als USING-Bedingung, damit ein Admin fremde profiles/
-- subscriptions/entitlements liest/verwaltet) werden ERST mit dem Admin-UI (T4-4) gebraucht und
-- deshalb hier NICHT vorsorglich angelegt. Die Funktion is_admin() existiert und ist getestet
-- (T10) — die Policies, die sie nutzen, kommen mit T4-4.
--
-- config.toml: `platform` wird NICHT in [api].schemas exponiert (anders als das öffentliche
-- monitor-Schema). Diese Tabellen tragen personenbezogene Auth-/Zahlungs-Spiegel und dürfen nicht
-- über die öffentliche REST-API mit anon-Key erreichbar sein — Server-Code (T4-2/T4-3/T7) liest sie
-- mit service_role bzw. RLS-geschützt. Das ist Transport-Ebenen-Schutz zusätzlich zu RLS. Details/
-- Begründung: Report + Handover.
