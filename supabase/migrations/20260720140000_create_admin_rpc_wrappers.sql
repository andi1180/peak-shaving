-- T4-4, Aufgabe 1: public-RPC-Wrapper für den Admin-Bereich (/admin).
--
-- Drei Verwaltungsflächen, die bisher nur über Supabase Studio bedienbar waren: Scraper-Ziele (T2),
-- Nutzer-/Rollenverwaltung (T4-1) und Gutscheincodes (heutige redemption-codes-Migration). Genau die
-- Admin-Policies, die T4-1 bewusst NICHT auf Vorrat angelegt hat ("kommen mit T4-4"), werden hier
-- eingelöst — allerdings NICHT als RLS-Policies, sondern als SECURITY-DEFINER-Wrapper. Begründung:
--
-- ── WARUM WRAPPER UND KEINE RLS-POLICY ───────────────────────────────────────────────────────────
-- Eine Policy wirkt nur, wenn die Rolle überhaupt ein Tabellen-GRANT hat. monitor.scrape_targets und
-- platform.user_roles haben für `authenticated` KEIN insert/update-Grant (T2/T4-1, Least-Privilege) —
-- eine Admin-Policy liefe dort ins Leere, und der Weg zurück wäre, `authenticated` breite
-- Tabellenrechte zu geben und sie per Policy wieder einzuschränken. Das ist die grössere
-- Angriffsfläche: ein Policy-Fehler öffnet dann die ganze Tabelle. Ein Wrapper exponiert stattdessen
-- genau die neun Operationen, die der Admin-Bereich braucht — nicht die Tabellen. Das ist zugleich
-- Invariante J3 (ein Zugriffsweg auf `platform`, eine grantbare Fläche), die T4-2/T4-3 schon tragen.
--
-- ── WARUM STATUS-RÜCKGABE STATT EXCEPTION ────────────────────────────────────────────────────────
-- Muster wie public.redeem_code / process_stripe_subscription_event: der Wrapper gibt einen
-- sprechenden Status zurück, statt im Regelbetrieb zu werfen. Eine Exception aus der DB müsste die
-- Server Action aus einer Fehlermeldung zurückübersetzen (fehleranfällig, und der Text stünde
-- ungefiltert am Nutzer). Hier ist der Rückgabetyp durchgängig `jsonb` mit einem `status`-Feld —
-- auch bei den drei list-Wrappern, damit "kein Admin" überall dieselbe, gleich behandelbare Form hat
-- statt einmal "leere Liste" und einmal "Status-String".
--
-- ── DIE ADMIN-PRÜFUNG ────────────────────────────────────────────────────────────────────────────
-- Erste ausführbare Zeile JEDER Funktion: `if not platform.is_admin() then return forbidden`.
-- platform.is_admin() nimmt KEINE Parameter (T4-1) — es liest auth.uid() selbst. Ein user_id-Parameter
-- wäre hier auch fachlich falsch: er wäre vom Aufrufer wählbar und damit keine Prüfung.
-- is_admin() ist SECURITY DEFINER und stable; der Aufruf kostet einen Indexscan auf user_roles und
-- liest live (kein JWT-Claim) — ein Rollen-Entzug greift beim nächsten Aufruf, nicht erst beim
-- Token-Refresh (I10).
--
-- ── GRANTS ───────────────────────────────────────────────────────────────────────────────────────
-- Alle neun Wrapper: NUR `authenticated`, nie `anon`, nie `service_role`. Die Ablehnung für
-- Nicht-Admins passiert INNERHALB der Funktion, nicht über den Grant — jeder eingeloggte Nutzer darf
-- aufrufen und bekommt ohne Admin-Rolle `forbidden`. service_role bekommt bewusst KEIN Grant: diese
-- Wrapper leiten ihre Autorisierung aus auth.uid() ab, das für service_role NULL ist (sie wären dort
-- funktionslos und stets `forbidden`). Muster/Reihenfolge exakt wie T4-2/T4-3: erst
-- `revoke all … from public, anon, authenticated, service_role`, dann gezielt `grant execute`.
--
-- KEIN Admin-Bootstrap in dieser Migration: keine hartkodierte E-Mail, keine User-ID, kein
-- "erster registrierter Nutzer wird Admin" (das wäre über eine Registrierung selbst auslösbar). Die
-- erste Admin-Zeile setzt Andreas einmalig von Hand im Supabase-SQL-Editor — der Befehl steht im
-- Abschlussbericht/Handover.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 0 — Die Zugangsfrage selbst
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ── is_admin: „Darf ich den Admin-Bereich überhaupt sehen?" ──────────────────────────────────────
-- platform.is_admin() existiert seit T4-1 und ist an authenticated gegrantet — aber `platform` ist
-- NICHT in [api].schemas exponiert, ein supabase-js-`.rpc('is_admin')` erreicht es also nicht
-- (PGRST106, dieselbe Lage wie bei allen T4-2-Wrappern). Das geschützte Layout braucht die Antwort
-- vor dem Rendern, deshalb dieser dünne public-Wrapper.
--
-- Er ist bewusst KEIN vierter Rückgabetyp: `returns boolean`, nicht jsonb mit Status. Hier gibt es
-- keine Ablehnung zu formulieren — die Frage IST die Ablehnung, und ihre Antwort ist ja/nein.
-- Delegiert an platform.is_admin(), damit es genau EINE Definition von „ist Admin" gibt (dieselbe,
-- die auch die neun Wrapper unten intern prüfen — die Layout-Schranke kann nicht anders urteilen als
-- die Funktionen dahinter).
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select platform.is_admin();
$$;

comment on function public.is_admin() is
  'T4-4: ist der EINGELOGGTE Nutzer (auth.uid()) Admin? Dünner public-Wrapper um platform.is_admin() '
  '(T4-1), weil das platform-Schema nicht über REST erreichbar ist. Einzige Definition von "ist '
  'Admin" für Layout-Schranke UND die neun admin_*-Wrapper. KEIN user_id-Parameter: keine Auskunft '
  'über fremde Konten. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — Scraper-Ziele (monitor.scrape_targets, T2)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ── admin_list_scrape_targets: alle Ziele inkl. Statuscache ──────────────────────────────────────
-- Bewusst OHNE Filter/Paginierung: die kuratierte Liste ist auf "Top 15–20" ausgelegt (§7), eine
-- Seitenlogik wäre Vorratsbau. Sortierung wie die Verarbeitungsreihenfolge des Scrapers
-- (sort_priority, klein = zuerst), damit die Tabelle im Admin dieselbe Ordnung zeigt wie der Lauf.
-- last_scrape_* wird MITGELESEN (das ist der Betriebsblick, weswegen die Seite existiert), aber von
-- keinem Schreib-Wrapper entgegengenommen — s. admin_upsert_scrape_target.
create function public.admin_list_scrape_targets()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_targets jsonb;
begin
  if not platform.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.sort_priority, t.provider_name), '[]'::jsonb)
    into v_targets
  from (
    select st.id,
           st.provider_name,
           st.provider_slug,
           st.tariff_page_url,
           st.is_active,
           st.network_area,
           st.sort_priority,
           st.notes,
           st.extraction_config,
           st.last_scrape_status,
           st.last_scrape_at,
           st.last_scrape_error,
           st.updated_at
    from monitor.scrape_targets st
  ) t;

  return jsonb_build_object('status', 'ok', 'targets', v_targets);
end;
$$;

comment on function public.admin_list_scrape_targets() is
  'T4-4: alle monitor.scrape_targets inkl. last_scrape_*-Statuscache für den Admin-Bereich. '
  'Rückgabe jsonb {status: ok|forbidden, targets: []}. Prüft platform.is_admin() intern; '
  'authenticated-only (die Ablehnung ist der Status, nicht der fehlende Grant).';

-- ── admin_upsert_scrape_target: anlegen/bearbeiten über den stabilen provider_slug ───────────────
-- provider_slug ist der Konflikt-Key (unique, T2: "Referenz-Anker, unabhängig vom evtl. wechselnden
-- Anzeigenamen") — dieselbe Funktion legt also an ODER bearbeitet, je nachdem ob der Slug schon
-- existiert. Der zurückgegebene Status sagt, was passiert ist ('created'/'updated'), damit die UI
-- nicht raten muss.
--
-- WAS BEWUSST NICHT PARAMETER IST: last_scrape_status/last_scrape_at/last_scrape_error. Das sind
-- reine Scraper-OUTPUTS (Statuscache, T2) — ein Admin, der sie setzen könnte, könnte einen
-- fehlgeschlagenen Lauf als "ok" übermalen und damit den Robustheits-Alert (§7) aushebeln. Der
-- Upsert lässt sie deshalb unangetastet; ein UPDATE ohne diese Spalten überschreibt sie nicht.
--
-- provider_name/tariff_page_url sind NOT NULL in der Tabelle und daher Pflichtparameter — sie sind
-- keine Kür: ohne URL gibt es nichts zu scrapen. Leere Zeichenketten werden hier abgelehnt (der
-- NOT-NULL-Constraint würde '' durchlassen), damit ein leeres Formularfeld nicht als gültiges Ziel
-- landet.
--
-- ── extraction_config: NULL BEDEUTET „NICHT ANFASSEN", NICHT „LEEREN" ────────────────────────────
-- Die Extraktionsregel (CSS-Selektoren) pflegt die Entwicklung, nicht das Admin-Formular — dieses
-- schickt den Parameter deshalb gar nicht mit, er fiele auf den DEFAULT NULL. Ein naives
-- `set extraction_config = excluded.extraction_config` würde eine bestehende, funktionierende Regel
-- damit bei JEDER Namens-/URL-Korrektur STILL löschen: der Scraper liefe danach ins Leere, und
-- niemand sähe im Admin, dass etwas fehlt (die Spalte ist ohnehin oft leer). Deshalb `coalesce(neu,
-- alt)`: ein übergebener Wert setzt die Regel, NULL lässt sie stehen. Preis dieser Wahl, bewusst und
-- benannt: eine bestehende Regel lässt sich über DIESEN Wrapper nicht auf NULL zurücksetzen — das
-- ist ein Entwicklungs-Handgriff (Migration/Studio), kein Admin-Vorgang.
create function public.admin_upsert_scrape_target(
  p_provider_slug text,
  p_provider_name text,
  p_tariff_page_url text,
  p_is_active boolean default true,
  p_extraction_config jsonb default null,
  p_network_area text default null,
  p_sort_priority integer default 100,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text := lower(btrim(coalesce(p_provider_slug, '')));
  v_name text := btrim(coalesce(p_provider_name, ''));
  v_url  text := btrim(coalesce(p_tariff_page_url, ''));
  v_id   uuid;
  v_existed boolean;
begin
  if not platform.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  -- Pflichtfelder inhaltlich prüfen (nicht nur strukturell): '' erfüllt NOT NULL, ist aber kein Ziel.
  if v_slug = '' or v_name = '' or v_url = '' then
    return jsonb_build_object('status', 'missing_fields');
  end if;

  -- Der Slug ist ein maschinenlesbarer Key und wandert in URLs/Logs — hier eng gefasst, damit kein
  -- Leerzeichen/Sonderzeichen einen "stabilen" Anker unbrauchbar macht.
  if v_slug !~ '^[a-z0-9][a-z0-9-]*$' then
    return jsonb_build_object('status', 'invalid_slug');
  end if;

  select true into v_existed
    from monitor.scrape_targets st
   where st.provider_slug = v_slug;

  insert into monitor.scrape_targets as st
    (provider_slug, provider_name, tariff_page_url, is_active, extraction_config,
     network_area, sort_priority, notes)
  values
    (v_slug, v_name, v_url, coalesce(p_is_active, true), p_extraction_config,
     p_network_area, coalesce(p_sort_priority, 100), p_notes)
  on conflict (provider_slug) do update
     set provider_name    = excluded.provider_name,
         tariff_page_url  = excluded.tariff_page_url,
         is_active        = excluded.is_active,
         -- NULL = „nicht anfassen" (s. Kommentarblock oben) — kein stiller Verlust der Scraper-Regel.
         extraction_config = coalesce(excluded.extraction_config, st.extraction_config),
         network_area     = excluded.network_area,
         sort_priority    = excluded.sort_priority,
         notes            = excluded.notes
  returning st.id into v_id;

  return jsonb_build_object(
    'status', case when coalesce(v_existed, false) then 'updated' else 'created' end,
    'id', v_id
  );
end;
$$;

comment on function public.admin_upsert_scrape_target(
  text, text, text, boolean, jsonb, text, integer, text
) is
  'T4-4: legt ein monitor.scrape_targets-Ziel an oder bearbeitet es (Konflikt-Key provider_slug). '
  'Rückgabe {status: created|updated|forbidden|missing_fields|invalid_slug, id}. last_scrape_status/'
  '_at/_error sind BEWUSST keine Parameter (reiner Scraper-Output — ein übermalbarer Statuscache '
  'würde den Robustheits-Alert §7 aushebeln). Prüft platform.is_admin() intern; authenticated-only.';

-- ── admin_set_scrape_target_active: schneller An/Aus-Toggle ──────────────────────────────────────
-- Eigener Wrapper statt "Upsert mit allen Feldern": der Toggle ist die häufigste Aktion in der
-- Tabelle (§7 "an/aus, ohne Löschen") und soll nicht erfordern, dass die UI erst alle übrigen Felder
-- mitschickt — ein vergessenes Feld wäre sonst ein stiller Datenverlust.
create function public.admin_set_scrape_target_active(p_target_id uuid, p_is_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not platform.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  update monitor.scrape_targets st
     set is_active = p_is_active
   where st.id = p_target_id
  returning st.id into v_id;

  if v_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object('status', 'ok', 'id', v_id, 'is_active', p_is_active);
end;
$$;

comment on function public.admin_set_scrape_target_active(uuid, boolean) is
  'T4-4: setzt monitor.scrape_targets.is_active (An/Aus ohne Löschen, §7). Eigener Wrapper statt '
  'Voll-Upsert, damit der häufigste Handgriff keine Mitgabe aller übrigen Felder erzwingt (ein '
  'vergessenes Feld wäre stiller Datenverlust). Rückgabe {status: ok|forbidden|not_found}. '
  'authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — Nutzer- und Rollenverwaltung (auth.users + platform.profiles/user_roles/entitlements)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ── admin_list_users: Nutzerliste mit Rollen UND Entitlement-Herkunft ────────────────────────────
-- Liest auth.users direkt per SQL. Das ist KEIN REST-Zugriff auf das auth-Schema (das wäre über
-- PostgREST ohnehin nicht exponiert), sondern serverseitiges SQL in einer Funktion, die als Owner
-- läuft — das Standard-Supabase-Muster für genau diesen Fall. Die E-Mail bleibt damit weiterhin an
-- genau EINEM Ort (auth.users, T4-1: kein E-Mail-Duplikat in profiles).
--
-- WARUM DIE ENTITLEMENT-HERKUNFT (source) SICHTBAR IST: Die redemption-codes-Migration von heute
-- beschreibt einen Randfall, der ohne diese Sicht unsichtbar bleibt — löst ein Nutzer mit
-- ABGELAUFENEM Stripe-Abo einen Code ein, wird seine entitlements-Zeile von source=stripe auf
-- source=manual umgeschrieben. Der Sync-Trigger (WHERE source='stripe') fasst sie danach NIE wieder
-- an: ein späteres Stripe-Abo desselben Nutzers steuert seinen Zugang dann nicht mehr. Fachlich ist
-- das gewollt, aber man muss es SEHEN können — deshalb liefert diese Liste je Entitlement die
-- Herkunft, nicht nur "hat Zugang ja/nein".
--
-- `currently_active` wendet dieselbe Regel an wie platform.has_entitlement (I1/T11: is_active UND
-- valid_until nicht abgelaufen) — bewusst berechnet und nicht per has_entitlement je Zeile
-- aufgerufen, weil das ein Funktionsaufruf pro Nutzer und Produkt wäre; die Regel steht hier
-- ausgeschrieben direkt neben den Rohwerten, aus denen der Admin sie nachvollziehen kann.
--
-- OBERGRENZE: 500 Nutzer, absteigend nach Anlagedatum. Kein stiller Schnitt — `total` und
-- `truncated` fahren mit, damit die UI sagen kann, dass sie nicht alles zeigt. Eine echte
-- Suche/Paginierung kommt, wenn die Nutzerzahl sie braucht (kein Vorratsbau).
create function public.admin_list_users()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit constant integer := 500;
  v_total integer;
  v_users jsonb;
begin
  if not platform.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select count(*) into v_total from auth.users;

  select coalesce(jsonb_agg(to_jsonb(u) order by u.created_at desc), '[]'::jsonb)
    into v_users
  from (
    select au.id          as user_id,
           au.email       as email,
           au.created_at  as created_at,
           p.display_name as display_name,
           coalesce((
             select jsonb_agg(ur.role order by ur.role)
             from platform.user_roles ur
             where ur.user_id = au.id
           ), '[]'::jsonb) as roles,
           coalesce((
             select jsonb_agg(
                      jsonb_build_object(
                        'product',          e.product,
                        'source',           e.source,
                        'is_active',        e.is_active,
                        'valid_until',      e.valid_until,
                        'currently_active', e.is_active
                                            and (e.valid_until is null or e.valid_until > now())
                      ) order by e.product
                    )
             from platform.entitlements e
             where e.user_id = au.id
           ), '[]'::jsonb) as entitlements
    from auth.users au
    left join platform.profiles p on p.user_id = au.id
    order by au.created_at desc
    limit v_limit
  ) u;

  return jsonb_build_object(
    'status', 'ok',
    'users', v_users,
    'total', v_total,
    'truncated', v_total > v_limit
  );
end;
$$;

comment on function public.admin_list_users() is
  'T4-4: Nutzerliste für den Admin-Bereich — E-Mail (aus auth.users, kein Duplikat in profiles), '
  'Anzeigename, Rollen-Liste und je Entitlement dessen HERKUNFT (source stripe/manual) plus '
  'currently_active nach der has_entitlement-Regel (I1/T11). Die Herkunft ist sichtbar, weil eine '
  'Code-Einlösung auf einem abgelaufenen Stripe-Abo die Zeile dauerhaft aus dem Stripe-Sync löst '
  '(s. redemption-codes-Migration) — das muss man sehen können. Max. 500 Zeilen, mit total/truncated. '
  'Rückgabe {status: ok|forbidden, users, total, truncated}. authenticated-only.';

-- ── admin_grant_role ────────────────────────────────────────────────────────────────────────────
-- Idempotent (ON CONFLICT DO NOTHING auf dem PK (user_id, role)) — eine doppelt geklickte Vergabe ist
-- kein Fehlerfall. Die Rolle wird gegen dieselbe Menge geprüft, die der Tabellen-CHECK erlaubt, damit
-- ein Tippfehler einen sprechenden Status liefert statt einer Constraint-Exception am Nutzer vorbei.
create function public.admin_grant_role(p_target_user_id uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := lower(btrim(coalesce(p_role, '')));
begin
  if not platform.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  -- Spiegelt den CHECK auf platform.user_roles.role (aktuell nur 'admin'). Wird der CHECK je
  -- geweitet, ist DIESE Liste mitzuziehen — der Constraint bleibt die harte Grenze dahinter.
  if v_role not in ('admin') then
    return jsonb_build_object('status', 'invalid_role');
  end if;

  if not exists (select 1 from auth.users au where au.id = p_target_user_id) then
    return jsonb_build_object('status', 'unknown_user');
  end if;

  insert into platform.user_roles (user_id, role)
  values (p_target_user_id, v_role)
  on conflict (user_id, role) do nothing;

  return jsonb_build_object('status', 'ok', 'user_id', p_target_user_id, 'role', v_role);
end;
$$;

comment on function public.admin_grant_role(uuid, text) is
  'T4-4: vergibt eine Rolle (aktuell nur admin) an einen Nutzer. Idempotent (ON CONFLICT DO '
  'NOTHING) — doppeltes Klicken ist kein Fehler. Rückgabe {status: ok|forbidden|invalid_role|'
  'unknown_user}. Prüft platform.is_admin() intern; authenticated-only.';

-- ── admin_revoke_role: mit Lockout-Schutz ───────────────────────────────────────────────────────
-- HARTER GUARD: die LETZTE verbleibende admin-Zeile kann nicht entzogen werden — auch nicht von der
-- Person selbst. Ohne diesen Guard wäre der Admin-Bereich nach einem Fehlklick für NIEMANDEN mehr
-- erreichbar, und der einzige Weg zurück führte über den Supabase-SQL-Editor (also über genau den
-- manuellen Pfad, den dieser Bereich ablösen soll).
--
-- ── KEINE RACE CONDITION ────────────────────────────────────────────────────────────────────────
-- Zwei gleichzeitige Entzüge der beiden letzten Admins dürfen nicht BEIDE durchkommen ("jeder sieht
-- noch zwei"). Deshalb werden ALLE admin-Zeilen zuerst per FOR UPDATE gesperrt und ERST DANN gezählt
-- — dieselbe Serialisierungs-Idee wie die Zeilensperre in public.redeem_code. Die zweite Transaktion
-- wartet an der Sperre, liest nach dem Commit der ersten neu und sieht dann nur noch einen Admin →
-- Ablehnung. (Die Sperre muss VOR dem Zählen stehen und kann nicht Teil des count-Statements sein:
-- Postgres erlaubt FOR UPDATE nicht zusammen mit Aggregatfunktionen.)
create function public.admin_revoke_role(p_target_user_id uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_admin_count integer;
  v_deleted uuid;
begin
  if not platform.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  if v_role not in ('admin') then
    return jsonb_build_object('status', 'invalid_role');
  end if;

  if not exists (
    select 1 from platform.user_roles ur
     where ur.user_id = p_target_user_id and ur.role = v_role
  ) then
    -- Nichts zu entziehen. Kein Fehler, aber auch kein 'ok' — die UI soll den Unterschied zwischen
    -- "entzogen" und "hatte die Rolle gar nicht" anzeigen können.
    return jsonb_build_object('status', 'not_assigned');
  end if;

  if v_role = 'admin' then
    -- 1. Alle admin-Zeilen sperren (serialisiert konkurrierende Entzüge), 2. dann erst zählen.
    perform 1 from platform.user_roles ur where ur.role = 'admin' for update;

    select count(*) into v_admin_count
      from platform.user_roles ur
     where ur.role = 'admin';

    if v_admin_count <= 1 then
      return jsonb_build_object('status', 'last_admin');
    end if;
  end if;

  delete from platform.user_roles ur
   where ur.user_id = p_target_user_id and ur.role = v_role
  returning ur.user_id into v_deleted;

  return jsonb_build_object('status', 'ok', 'user_id', v_deleted, 'role', v_role);
end;
$$;

comment on function public.admin_revoke_role(uuid, text) is
  'T4-4: entzieht eine Rolle. LOCKOUT-SCHUTZ: der letzte verbleibende admin kann nicht entzogen '
  'werden (Status last_admin) — gilt auch beim Selbst-Entzug. Race-frei, weil alle admin-Zeilen vor '
  'dem Zählen per FOR UPDATE gesperrt werden (zwei gleichzeitige Entzüge serialisieren; FOR UPDATE '
  'ist mit Aggregaten nicht kombinierbar, daher sperren und dann zählen). Rückgabe {status: ok|'
  'forbidden|invalid_role|not_assigned|last_admin}. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — Gutscheincodes (platform.redemption_codes)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ── admin_list_codes ────────────────────────────────────────────────────────────────────────────
-- Zeigt den Zähler redemption_count mit an (der Grund, warum es die Seite gibt: "ist der Code
-- ausgeschöpft?"). Neueste zuerst.
create function public.admin_list_codes()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_codes jsonb;
begin
  if not platform.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb)
    into v_codes
  from (
    select rc.id,
           rc.code,
           rc.product_key,
           rc.max_redemptions,
           rc.redemption_count,
           rc.expires_at,
           rc.is_active,
           rc.note,
           rc.created_at
    from platform.redemption_codes rc
  ) c;

  return jsonb_build_object('status', 'ok', 'codes', v_codes);
end;
$$;

comment on function public.admin_list_codes() is
  'T4-4: alle platform.redemption_codes inkl. redemption_count (systemgeführter Zähler) für den '
  'Admin-Bereich, neueste zuerst. Rückgabe {status: ok|forbidden, codes: []}. authenticated-only.';

-- ── admin_create_code ───────────────────────────────────────────────────────────────────────────
-- Legt NUR an (kein Upsert): ein versehentlich doppelt abgeschickter Code darf einen bestehenden
-- nicht stillschweigend umkonfigurieren — etwa dessen Produkt oder Limit ändern, während er schon
-- eingelöst wurde. Der case-insensitive Unique-Index ist die harte Grenze; hier wird sie vorher
-- abgefangen und als 'duplicate_code' beantwortet statt als Constraint-Exception.
--
-- redemption_count ist BEWUSST kein Parameter (hier so wenig wie in einem eigenen Wrapper): der
-- Zähler ist systemgeführt und spiegelt die code_redemptions-Zeilen. Ein von Hand gesetzter Zähler
-- wäre eine zweite, abweichende Wahrheit über dieselbe Tatsache.
create function public.admin_create_code(
  p_code text,
  p_product_key platform.product_key,
  p_max_redemptions integer default null,
  p_expires_at timestamptz default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_id uuid;
begin
  if not platform.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  if v_code = '' then
    return jsonb_build_object('status', 'missing_fields');
  end if;

  -- Der Code wird vom Nutzer abgetippt — Leerzeichen im Code selbst wären eine Fehlerquelle, die
  -- niemand sieht (redeem_code trimmt nur aussen, nicht innen).
  if v_code ~ '\s' then
    return jsonb_build_object('status', 'invalid_code');
  end if;

  if p_max_redemptions is not null and p_max_redemptions <= 0 then
    -- Spiegelt den Tabellen-CHECK (max_redemptions > 0). NULL bleibt erlaubt = unbegrenzt.
    return jsonb_build_object('status', 'invalid_max_redemptions');
  end if;

  -- Case-insensitiv, weil der Unique-Index auf lower(code) liegt: 'Sommer26' und 'sommer26' sind
  -- derselbe Code (ein Nutzer könnte sie nie auseinanderhalten).
  if exists (
    select 1 from platform.redemption_codes rc where lower(rc.code) = lower(v_code)
  ) then
    return jsonb_build_object('status', 'duplicate_code');
  end if;

  insert into platform.redemption_codes (code, product_key, max_redemptions, expires_at, note)
  values (v_code, p_product_key, p_max_redemptions, p_expires_at, p_note)
  returning id into v_id;

  return jsonb_build_object('status', 'created', 'id', v_id, 'code', v_code);
end;
$$;

comment on function public.admin_create_code(text, platform.product_key, integer, timestamptz, text) is
  'T4-4: legt einen Gutscheincode an (NUR anlegen, kein Upsert — ein doppelt abgeschickter Code darf '
  'einen bereits eingelösten nicht stillschweigend umkonfigurieren). Prüft case-insensitiv auf '
  'Dublette (Unique-Index auf lower(code)) und beantwortet sie als Status statt als Exception. '
  'redemption_count ist systemgeführt und bewusst kein Parameter. Rückgabe {status: created|'
  'forbidden|missing_fields|invalid_code|invalid_max_redemptions|duplicate_code, id}. '
  'authenticated-only.';

-- ── admin_set_code_active: deaktivieren/reaktivieren, KEIN Delete ────────────────────────────────
-- Löschen ist bewusst nicht vorgesehen: an einem Code hängt das code_redemptions-Ledger (FK mit
-- ON DELETE CASCADE) — ein DELETE würde die Einlösungs-HISTORIE mitreissen, während die daraus
-- entstandenen Entitlements bestehen bleiben. Man hätte dann Zugänge ohne nachvollziehbare Herkunft.
-- is_active=false macht den Code sofort uneinlösbar (redeem_code prüft es), ohne etwas zu verlieren.
create function public.admin_set_code_active(p_code_id uuid, p_is_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not platform.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  update platform.redemption_codes rc
     set is_active = p_is_active
   where rc.id = p_code_id
  returning rc.id into v_id;

  if v_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object('status', 'ok', 'id', v_id, 'is_active', p_is_active);
end;
$$;

comment on function public.admin_set_code_active(uuid, boolean) is
  'T4-4: aktiviert/deaktiviert einen Gutscheincode. KEIN Delete-Pendant, bewusst: am Code hängt das '
  'code_redemptions-Ledger per ON DELETE CASCADE — ein DELETE risse die Einlösungshistorie mit, '
  'während die daraus entstandenen Entitlements bestehen blieben (Zugänge ohne nachvollziehbare '
  'Herkunft). Rückgabe {status: ok|forbidden|not_found}. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Rechte: alle Auto-Grants entziehen, dann gezielt NUR authenticated
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf NEUE public-Funktionen automatisch EXECUTE an
-- anon, authenticated UND service_role (zusätzlich zum PostgreSQL-Default-Grant an PUBLIC) — deshalb
-- explizit von allen entziehen und danach NUR authenticated gewähren (s. T4-2-Migration).
--
-- anon bekommt NIRGENDS ein Grant: ein nicht eingeloggter Aufrufer hat keine auth.uid(), is_admin()
-- wäre false und der Wrapper gäbe ohnehin 'forbidden' — aber die Fläche gar nicht erst zu öffnen ist
-- die belastbarere Zusage (Least-Privilege, keine Rechte auf Vorrat).

revoke all on function public.is_admin()
  from public, anon, authenticated, service_role;
revoke all on function public.admin_list_scrape_targets()
  from public, anon, authenticated, service_role;
revoke all on function public.admin_upsert_scrape_target(
  text, text, text, boolean, jsonb, text, integer, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_set_scrape_target_active(uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_list_users()
  from public, anon, authenticated, service_role;
revoke all on function public.admin_grant_role(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_revoke_role(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_list_codes()
  from public, anon, authenticated, service_role;
revoke all on function public.admin_create_code(
  text, platform.product_key, integer, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_set_code_active(uuid, boolean)
  from public, anon, authenticated, service_role;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_list_scrape_targets() to authenticated;
grant execute on function public.admin_upsert_scrape_target(
  text, text, text, boolean, jsonb, text, integer, text
) to authenticated;
grant execute on function public.admin_set_scrape_target_active(uuid, boolean) to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_grant_role(uuid, text) to authenticated;
grant execute on function public.admin_revoke_role(uuid, text) to authenticated;
grant execute on function public.admin_list_codes() to authenticated;
grant execute on function public.admin_create_code(
  text, platform.product_key, integer, timestamptz, text
) to authenticated;
grant execute on function public.admin_set_code_active(uuid, boolean) to authenticated;
