-- T4-4-Nacharbeit: Rollenträger und Kunden werden getrennt.
--
-- Die T4-4-Migration hatte EINEN Wrapper `admin_list_users()`, der jede auth.users-Zeile mit ihren
-- Rollen UND ihren Entitlements ausgab. Der erste echte Live-Test hat gezeigt, warum das die
-- falsche Schnittebene ist: die Liste beantwortet zwei völlig verschiedene Fragen gleichzeitig
-- („wer darf verwalten?" und „wer hat bezahlt?"), und beide Antworten ertrinken darin. Wer eine
-- Rolle vergeben will, sucht einen von zwei Admins in einer Liste aller Konten; wer einen Zugang
-- prüfen will, sieht Rollen-Spalten, die ihn nichts angehen.
--
-- Deshalb ZWEI Wrapper mit je EINER Frage:
--   admin_list_admins()    — Konten mit mindestens einer platform.user_roles-Zeile.
--   admin_list_customers() — Konten mit mindestens einer platform.entitlements-Zeile.
-- Ein Konto kann in beiden stehen (der Admin, der selbst ein Abo hat) — das ist kein Widerspruch,
-- sondern zwei zutreffende Aussagen über dieselbe Person.
--
-- ── WARUM DIE ROLLENVERGABE JETZT ÜBER DIE E-MAIL LÄUFT ──────────────────────────────────────────
-- Die alte UI vergab Rollen per Knopf in der Zeile eines Kontos — das setzte voraus, dass JEDES
-- Konto gelistet ist. `admin_list_admins()` listet aber definitionsgemäß nur die, die schon eine
-- Rolle haben: der erste Admin eines neuen Kollegen stünde nicht darin. Die Vergabe braucht also
-- einen Weg, der nicht an der Liste hängt — die E-Mail, die man ohnehin kennt.
-- Der ENTZUG bleibt unverändert bei `admin_revoke_role(user_id, role)`: dessen Ziel steht per
-- Definition in der (jetzt kurzen) Admin-Liste, eine user_id ist dort vorhanden, und der
-- Lockout-Schutz samt Zeilensperre bleibt damit unangetastet.
--
-- Muster/Rechte wie in der T4-4-Migration: Rückgabe durchgängig `jsonb` mit `status`, erste
-- ausführbare Zeile ist `platform.is_admin()`, Grants NUR an `authenticated`.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — admin_list_admins: wer darf verwalten?
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- Kein Limit, bewusst: die Menge der Rollenträger ist per Konstruktion klein (aktuell zwei), und
-- eine Obergrenze auf einer Liste, aus der der Lockout-Schutz gespeist wird, wäre gefährlicher als
-- nützlich — ein abgeschnittener Admin sähe aus, als gäbe es ihn nicht.
-- Sortierung nach E-Mail statt nach Anlagedatum: man sucht hier eine Person, keine Chronologie.
create function public.admin_list_admins()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admins jsonb;
begin
  if not platform.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.email), '[]'::jsonb)
    into v_admins
  from (
    select au.id          as user_id,
           au.email       as email,
           au.created_at  as created_at,
           p.display_name as display_name,
           (
             select jsonb_agg(ur.role order by ur.role)
             from platform.user_roles ur
             where ur.user_id = au.id
           ) as roles
    from auth.users au
    left join platform.profiles p on p.user_id = au.id
    -- Der Filter IST die Definition dieser Liste: mindestens eine Rollenzeile.
    where exists (select 1 from platform.user_roles ur where ur.user_id = au.id)
  ) a;

  return jsonb_build_object('status', 'ok', 'admins', v_admins);
end;
$$;

comment on function public.admin_list_admins() is
  'T4-4-Nacharbeit: Konten mit MINDESTENS EINER platform.user_roles-Zeile (E-Mail, Anzeigename, '
  'Rollen), alphabetisch nach E-Mail. Löst zusammen mit admin_list_customers() die kombinierte '
  'admin_list_users() ab. BEWUSST OHNE Obergrenze — aus dieser Liste speist sich die Anzeige des '
  'Lockout-Schutzes; ein abgeschnittener Admin sähe aus, als gäbe es ihn nicht. '
  'Rückgabe {status: ok|forbidden, admins: []}. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — admin_list_customers: wer hat Zugang?
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- „Kunde" heisst hier: mindestens eine entitlements-Zeile — AKTIV ODER HISTORISCH. Ein gekündigtes
-- Abo verschwindet nicht aus dieser Liste, es steht darin als inaktiv. Wer nur die Aktiven zeigte,
-- könnte die häufigste Support-Frage („der hatte doch mal Zugang?") nicht beantworten.
--
-- Die Herkunft (source) fährt mit, aus demselben Grund wie in der abgelösten admin_list_users:
-- löst ein Nutzer mit ABGELAUFENEM Stripe-Abo einen Gutscheincode ein, wird seine Zeile von
-- source=stripe auf source=manual umgeschrieben, und der Sync-Trigger (WHERE source='stripe') fasst
-- sie danach NIE wieder an. Fachlich gewollt — aber nur brauchbar, wenn man es sehen kann.
--
-- `currently_active` wendet dieselbe Regel an wie platform.has_entitlement (I1/T11: is_active UND
-- valid_until nicht abgelaufen), ausgeschrieben neben den Rohwerten, aus denen sie sich ergibt.
--
-- REIN LESEND, bewusst: hier gibt es keine Aktion. Zugang entsteht über Stripe oder über einen
-- Gutscheincode — beides hat seinen eigenen, nachvollziehbaren Weg. Ein Knopf „Zugang geben" an
-- dieser Tabelle wäre ein dritter, der in keinem Ledger auftaucht.
create function public.admin_list_customers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit constant integer := 500;
  v_total integer;
  v_customers jsonb;
begin
  if not platform.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  select count(distinct e.user_id) into v_total from platform.entitlements e;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb)
    into v_customers
  from (
    select au.id          as user_id,
           au.email       as email,
           au.created_at  as created_at,
           p.display_name as display_name,
           (
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
           ) as entitlements
    from auth.users au
    left join platform.profiles p on p.user_id = au.id
    where exists (select 1 from platform.entitlements e where e.user_id = au.id)
    order by au.created_at desc
    limit v_limit
  ) c;

  return jsonb_build_object(
    'status', 'ok',
    'customers', v_customers,
    'total', v_total,
    'truncated', v_total > v_limit
  );
end;
$$;

comment on function public.admin_list_customers() is
  'T4-4-Nacharbeit: Konten mit MINDESTENS EINER platform.entitlements-Zeile (aktiv ODER historisch — '
  'ein gekündigtes Abo steht darin als inaktiv, nicht gar nicht), je Entitlement product/source/'
  'is_active/valid_until plus currently_active nach der has_entitlement-Regel (I1/T11). REIN LESEND: '
  'Zugang entsteht über Stripe oder Gutscheincode, beide mit eigenem Ledger — ein Knopf hier wäre ein '
  'dritter Weg ohne Spur. Max. 500 Konten, mit total/truncated. '
  'Rückgabe {status: ok|forbidden, customers, total, truncated}. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — admin_grant_role_by_email: Rollenvergabe ohne Gesamtliste
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ── WARUM `text` UND NICHT EIN ENUM ──────────────────────────────────────────────────────────────
-- platform.user_roles.role ist `text` mit einem CHECK, kein Enum-Typ (T4-1) — es gibt keinen
-- Rollen-Enum, den dieser Parameter tragen könnte. Signatur und Prüfliste sind deshalb identisch zu
-- admin_grant_role(uuid, text): dieselbe Menge, derselbe Status bei einem Tippfehler.
--
-- ── E-MAIL-SUCHE ─────────────────────────────────────────────────────────────────────────────────
-- Case-insensitiv (`lower(...)`), weil niemand die Schreibweise seines eigenen Kontos kennt.
-- Mehrfachtreffer werden NICHT stillschweigend auf den ersten aufgelöst, sondern als
-- 'ambiguous_email' abgelehnt: auth.users erzwingt keine globale E-Mail-Eindeutigkeit (mehrere
-- Identity-Provider), und eine Admin-Rolle an „irgendeines der Konten mit dieser Adresse" zu geben
-- wäre die schlechteste Art, diesen Fall zu entdecken.
--
-- Ansonsten VERHALTENSGLEICH zu admin_grant_role: idempotent (ON CONFLICT DO NOTHING), gleiche
-- Rollen-Prüfliste, gleicher Erfolgs-Status. Die zurückgegebene user_id ist der Beleg, WEN es
-- getroffen hat — die UI zeigt danach die Admin-Liste, in der das Konto neu erscheint.
create function public.admin_grant_role_by_email(p_email text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role  text := lower(btrim(coalesce(p_role, '')));
  v_matches integer;
  v_user_id uuid;
begin
  if not platform.is_admin() then
    return jsonb_build_object('status', 'forbidden');
  end if;

  if v_email = '' then
    return jsonb_build_object('status', 'missing_fields');
  end if;

  -- Spiegelt den CHECK auf platform.user_roles.role (aktuell nur 'admin'), wie admin_grant_role.
  if v_role not in ('admin') then
    return jsonb_build_object('status', 'invalid_role');
  end if;

  select count(*) into v_matches
    from auth.users au
   where lower(au.email) = v_email;

  if v_matches = 0 then
    return jsonb_build_object('status', 'user_not_found');
  end if;

  if v_matches > 1 then
    return jsonb_build_object('status', 'ambiguous_email');
  end if;

  select au.id into v_user_id
    from auth.users au
   where lower(au.email) = v_email;

  insert into platform.user_roles (user_id, role)
  values (v_user_id, v_role)
  on conflict (user_id, role) do nothing;

  return jsonb_build_object('status', 'ok', 'user_id', v_user_id, 'role', v_role);
end;
$$;

comment on function public.admin_grant_role_by_email(text, text) is
  'T4-4-Nacharbeit: vergibt eine Rolle über die E-MAIL statt über die user_id — nötig, seit '
  'admin_list_admins() nur noch Rollenträger listet und ein künftiger Admin darin per Definition '
  'noch nicht steht. Case-insensitiv; Mehrfachtreffer werden als ambiguous_email ABGELEHNT statt '
  'auf den ersten aufgelöst (auth.users erzwingt keine globale E-Mail-Eindeutigkeit). Sonst '
  'verhaltensgleich zu admin_grant_role: idempotent, gleiche Rollen-Prüfliste. Rückgabe '
  '{status: ok|forbidden|missing_fields|invalid_role|user_not_found|ambiguous_email, user_id, role}. '
  'authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — die abgelöste Funktion verschwindet
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Kein Nebeneinander: eine kombinierte Liste, die niemand mehr aufruft, wäre ein zweiter, stiller
-- Zugriffsweg auf auth.users samt Entitlements — genau die Fläche, die die T4-4-Migration
-- ausdrücklich klein halten wollte (Invariante J3, eine grantbare Fläche je Zweck).
drop function public.admin_list_users();

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Rechte: alle Auto-Grants entziehen, dann gezielt NUR authenticated
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf NEUE public-Funktionen automatisch EXECUTE an
-- anon, authenticated UND service_role — deshalb explizit entziehen und danach gezielt gewähren.

revoke all on function public.admin_list_admins()
  from public, anon, authenticated, service_role;
revoke all on function public.admin_list_customers()
  from public, anon, authenticated, service_role;
revoke all on function public.admin_grant_role_by_email(text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_list_admins() to authenticated;
grant execute on function public.admin_list_customers() to authenticated;
grant execute on function public.admin_grant_role_by_email(text, text) to authenticated;
