-- Gutscheincode-Einlösung: zweiter, kostenloser Freischaltweg für den Monitor neben dem
-- Stripe-Checkout (T4-3). Ergänzt `platform` additiv — bestehende Migrationen werden NICHT editiert.
--
-- ── WARUM DAS OHNE NEUE ZUGANGS-WAHRHEIT AUSKOMMT ────────────────────────────────────────────────
-- Der Zugang entsteht auch hier NICHT in einer eigenen Tabelle, sondern als ganz normale Zeile in
-- platform.entitlements mit source='manual' und valid_until=NULL. Genau dieser Fall ist seit T4-2
-- ausdrücklich vorgesehen (CHECK entitlements_stripe_active_requires_valid_until schließt nur
-- source='stripe' von valid_until=NULL aus; manual/Lifetime bleibt erlaubt, I2). Die Kontoseite,
-- platform.has_entitlement und der spätere Cron lesen unverändert dieselbe eine Tabelle (I1) — die
-- HERKUNFT des Zugangs ist für jeden Leser irrelevant. Es gibt bewusst keinen zweiten Lesepfad.
--
-- Muster exakt wie T4-1/T4-2/T4-3: SET search_path = '' (alle Objekte fully-qualified), SECURITY
-- DEFINER, `platform` NICHT über REST exponiert, erst `revoke all … from public, anon, authenticated,
-- service_role`, dann gezielt `grant execute`. Zugriff auf beide Tabellen läuft AUSSCHLIESSLICH über
-- den public-Wrapper unten (Invariante J3: ein Zugriffsweg, eine grantbare Fläche).

-- ── redemption_codes: die einlösbaren Codes ──────────────────────────────────────────────────────
-- max_redemptions NULL = unbegrenzt (Marketing-/Partner-Code). redemption_count ist ein
-- Zähl-SPIEGEL der code_redemptions-Zeilen, kein zweiter Wahrheitsanspruch: die harte Grenze gegen
-- Doppel-Einlösung ist der UNIQUE-Constraint unten, der Zähler dient dem max_redemptions-Vergleich
-- (ein count(*) unter Zeilensperre wäre gleichwertig, aber teurer je Einlösung).
create table platform.redemption_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  product_key platform.product_key not null,
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  expires_at timestamptz,
  is_active boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);

comment on table platform.redemption_codes is
  'Einlösbare Gutscheincodes (zweiter, kostenloser Freischaltweg neben Stripe). Eine Einlösung '
  'erzeugt eine platform.entitlements-Zeile mit source=manual/valid_until=NULL — es gibt KEINE '
  'zweite Zugangs-Wahrheit neben entitlements (I1). Geschrieben/gelesen ausschließlich über '
  'public.redeem_code (J3); keine Nutzer-Rolle hat ein Tabellen-Grant.';

comment on column platform.redemption_codes.code is
  'Der einzulösende Code. Vergleich ist CASE-INSENSITIV (unique index auf lower(code)) — ein Nutzer '
  'tippt "COOLIN2026" oder "coolin2026"; beides muss denselben Code treffen, und beides darf nicht '
  'als zwei verschiedene Codes anlegbar sein.';

comment on column platform.redemption_codes.max_redemptions is
  'Obergrenze der Einlösungen. NULL = unbegrenzt (Marketing-/Partner-Code). Bei gesetztem Wert '
  'sperrt public.redeem_code unter Zeilensperre (FOR UPDATE), damit zwei gleichzeitige Einlösungen '
  'den Code nicht überziehen.';

comment on column platform.redemption_codes.redemption_count is
  'Anzahl erfolgter Einlösungen — Zähl-Spiegel der code_redemptions-Zeilen für den '
  'max_redemptions-Vergleich. Die harte Grenze gegen Doppel-Einlösung ist der UNIQUE-Constraint auf '
  'code_redemptions (code_id, user_id), nicht dieser Zähler.';

-- Case-insensitiver Eindeutigkeitsschutz: verhindert ZWEI Codes, die sich nur in der Groß-/
-- Kleinschreibung unterscheiden (die der Nutzer nie auseinanderhalten könnte), und ist zugleich der
-- Index, über den redeem_code nachschlägt.
create unique index redemption_codes_code_lower_key
  on platform.redemption_codes (lower(code));

-- ── code_redemptions: wer hat welchen Code eingelöst ─────────────────────────────────────────────
-- ON DELETE CASCADE auf user_id: Personenbezug verschwindet mit dem auth.users-Eintrag (I8, DSGVO —
-- wie alle user-gebundenen platform-Tabellen). Der Zähler in redemption_codes bleibt dabei bewusst
-- stehen: eine Kontolöschung soll einen begrenzten Code nicht rückwirkend wieder auffüllen.
create table platform.code_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references platform.redemption_codes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (code_id, user_id)
);

comment on table platform.code_redemptions is
  'Ledger der Einlösungen. UNIQUE (code_id, user_id) ist die HARTE Grenze: derselbe Nutzer kann '
  'denselben Code kein zweites Mal einlösen, auch wenn ein Anwendungsfehler es versuchte. '
  'public.redeem_code gibt vorher den sprechenden Status already_redeemed zurück, statt den '
  'Constraint als Fehler an den Client durchschlagen zu lassen. user_id cascadet mit auth.users (I8).';

create index code_redemptions_user_id_idx on platform.code_redemptions (user_id);

-- ── redeem_code: die EINE Transaktion, die eine Einlösung vollzieht ──────────────────────────────
-- Rückgabe ist ein STATUS-STRING (Muster wie process_stripe_subscription_event) — nie ein Klartext-
-- Fehler und nie eine Exception im Normalfall: die Server Action mappt den Status auf Nutzertext.
-- Ein `raise exception` im Regelbetrieb wäre eine Fehlermeldung aus der DB direkt am Nutzer vorbei.
--
-- STATUS: 'redeemed' | 'invalid_code' | 'expired' | 'exhausted' | 'already_redeemed' | 'already_active'
--
-- ── PRÜFREIHENFOLGE (bewusst, eine Abweichung ist begründet) ─────────────────────────────────────
-- 1. Code nachschlagen (case-insensitiv) + is_active/expires_at/max_redemptions.
-- 2. Hat DIESER Nutzer DIESEN Code schon eingelöst? → already_redeemed
-- 3. Hat der Nutzer bereits ein aktives Entitlement (EGAL welcher Quelle)? → already_active
-- Schritt 2 steht VOR Schritt 3, obwohl die Aufgabenstellung sie andersherum nummeriert: eine
-- zweite Einlösung DESSELBEN Codes erzeugt beide Bedingungen gleichzeitig (die erste Einlösung hat
-- das Entitlement ja gerade erzeugt). Käme already_active zuerst, wäre already_redeemed praktisch
-- unerreichbar und der Nutzer bekäme auf „ich tippe meinen Code nochmal" die unpassendere Auskunft.
-- Die spezifischere Aussage gewinnt; die fachliche Wirkung ist identisch (beide lehnen ab, beide
-- überschreiben NICHTS).
--
-- ── SPERRE ──────────────────────────────────────────────────────────────────────────────────────
-- Der Nachschlag läuft IMMER mit FOR UPDATE, nicht nur bei gesetztem max_redemptions: die Sperre ist
-- billig (eine Zeile, sofort wieder frei am Transaktionsende) und eine Fallunterscheidung hätte
-- genau dann gefehlt, wenn jemand später ein max_redemptions nachträgt. Zwei gleichzeitige
-- Einlösungen eines begrenzten Codes serialisieren damit sauber am Zähler.
create function public.redeem_code(p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- BARE auth.uid(), NICHT (select auth.uid()): das Subquery-Wrapping ist eine RLS-POLICY-
  -- Optimierung und löst im Funktionskörper einen Backend-Segfault aus, sobald auth.uid() NULL ist
  -- (s. T4-2-Migration). Gleiche Form wie get_my_entitlement/is_admin.
  v_user uuid := auth.uid();
  v_code platform.redemption_codes%rowtype;
begin
  -- Ohne Session gibt es niemanden freizuschalten. Der Wrapper ist ohnehin nur an authenticated
  -- gegrantet; das ist die defensive Rückfalllinie (z. B. abgelaufenes JWT).
  if v_user is null then
    return 'invalid_code';
  end if;

  -- 1. Code case-insensitiv nachschlagen; führende/folgende Leerzeichen aus dem Formularfeld fallen
  --    weg (ein kopierter Code trägt sie regelmäßig mit).
  select * into v_code
    from platform.redemption_codes rc
   where lower(rc.code) = lower(btrim(p_code))
     for update;

  if not found or not v_code.is_active then
    -- Ein deaktivierter Code ist für den Nutzer nicht von einem nie existierenden zu unterscheiden —
    -- und soll es auch nicht sein (keine Auskunft darüber, welche Codes es gibt).
    return 'invalid_code';
  end if;

  if v_code.expires_at is not null and v_code.expires_at <= now() then
    return 'expired';
  end if;

  if v_code.max_redemptions is not null and v_code.redemption_count >= v_code.max_redemptions then
    return 'exhausted';
  end if;

  -- 2. Schon von diesem Nutzer eingelöst? (s. Prüfreihenfolge oben)
  if exists (
    select 1 from platform.code_redemptions cr
     where cr.code_id = v_code.id and cr.user_id = v_user
  ) then
    return 'already_redeemed';
  end if;

  -- 3. Bereits aktiver Zugang, EGAL welcher Quelle → ablehnen, NICHT überschreiben. Ein zahlender
  --    Stripe-Kunde soll seinen Code nicht versehentlich gegen ein manuelles Entitlement tauschen
  --    (das würde seine Zeile aus dem Stripe-Sync herauslösen, s. Hinweis unten).
  if platform.has_entitlement(v_user, v_code.product_key) then
    return 'already_active';
  end if;

  -- 4. Vollzug — eine Transaktion. Der UNIQUE-Constraint bleibt die harte Grenze, falls zwei
  --    gleichzeitige Einlösungen DESSELBEN Nutzers an Schritt 2 vorbeikommen.
  insert into platform.code_redemptions (code_id, user_id)
  values (v_code.id, v_user);

  update platform.redemption_codes rc
     set redemption_count = rc.redemption_count + 1
   where rc.id = v_code.id;

  -- source='manual' passiert den Guard guard_entitlement_stripe_source ungehindert (der sperrt nur
  -- source='stripe', I2). valid_until=NULL = unbefristet, vom CHECK ausdrücklich für manual erlaubt.
  --
  -- HINWEIS zur Interaktion mit Stripe: Der Upsert kann eine bestehende, INAKTIVE stripe-Zeile
  -- (abgelaufenes/gekündigtes Abo) auf source=manual umschreiben. Das ist gewollt — der Zugang
  -- kommt ab jetzt tatsächlich vom Code. Folge: der Sync-Trigger
  -- (sync_entitlement_from_subscription, WHERE e.source='stripe') fasst diese Zeile danach NICHT
  -- mehr an. Ein späteres Stripe-Abo desselben Nutzers spiegelt sich dann nicht mehr in
  -- entitlements. Der Nutzer verliert dadurch KEINEN Zugang (das manuelle Entitlement ist
  -- unbefristet aktiv), es entsteht aber ein Abo, das den Zugang nicht mehr steuert. Aktiver
  -- Zugang wird vorher abgelehnt (Schritt 3), der Fall bleibt also auf „abgelaufenes Abo + Code"
  -- beschränkt. Sauber auflösbar erst mit einem Admin-Pfad (T4-4), der Entitlements zurücksetzen
  -- kann — bewusst hier nicht vorweggenommen.
  insert into platform.entitlements as e (user_id, product, is_active, valid_until, source, updated_at)
  values (v_user, v_code.product_key, true, null, 'manual', now())
  on conflict (user_id, product) do update
     set is_active   = true,
         valid_until = null,
         source      = 'manual',
         updated_at  = now();

  return 'redeemed';
end;
$$;

comment on function public.redeem_code(text) is
  'Löst einen Gutscheincode für den EINGELOGGTEN Nutzer ein (auth.uid()) — eine Transaktion: Code '
  'prüfen (case-insensitiv, is_active/expires_at/max_redemptions unter FOR UPDATE), Ledger-Zeile '
  'schreiben, Zähler erhöhen, entitlements-Zeile mit source=manual/valid_until=NULL upserten. '
  'Rückgabe: redeemed | invalid_code | expired | exhausted | already_redeemed | already_active — '
  'die Server Action mappt auf Nutzertext (kein Klartext-Fehler aus der DB an den Client). KEIN '
  'user_id-Parameter: niemand kann fremde Konten freischalten. authenticated-only.';

-- ── Rechte: Least-Privilege, keine Rechte auf Vorrat ─────────────────────────────────────────────
-- KEIN Tabellen-Grant für anon/authenticated/service_role auf die beiden neuen Tabellen (die
-- Voreinstellung; hier nur explizit festgehalten). Codeverwaltung läuft bis zu einem Admin-UI (T4-4)
-- über Migration/DB-Admin — genau wie die Rollenvergabe in user_roles.
alter table platform.redemption_codes enable row level security;
alter table platform.code_redemptions enable row level security;

-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf NEUE public-Funktionen automatisch EXECUTE an
-- anon, authenticated UND service_role (zusätzlich zum PostgreSQL-Default-Grant an PUBLIC) —
-- deshalb explizit von allen entziehen und danach NUR authenticated gewähren (s. T4-2-Migration).
revoke all on function public.redeem_code(text) from public, anon, authenticated, service_role;
grant execute on function public.redeem_code(text) to authenticated;

-- ── Erster Code ──────────────────────────────────────────────────────────────────────────────────
-- Unbegrenzt (Marketing-/Partner-Code), unbefristet, aktiv. Idempotent, damit ein erneutes Anwenden
-- der Migration auf einer Datenbank mit bereits eingelösten Zeilen den Zähler nicht zurücksetzt.
insert into platform.redemption_codes (code, product_key, max_redemptions, is_active, note)
values ('coolin2026', 'monitor', null, true, 'Erster Marketing-/Partner-Code, unbegrenzt einlösbar')
on conflict do nothing;
