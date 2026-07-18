-- T4-2, Aufgabe 3: public-RPC-Wrapper für den EINGELOGGTEN Nutzer.
--
-- WARUM RPC UND NICHT DIREKT-READ: `platform` ist bewusst NICHT in [api].schemas exponiert
-- (T4-1-Entscheidung, §4.3) — ein supabase-js-`.from('platform.…')` erreicht das Schema über
-- PostgREST gar nicht. Der Auth-Server-Code liest `platform` deshalb AUSSCHLIESSLICH über
-- SECURITY-DEFINER-Wrapper im exponierten `public`-Schema (Invariante J3 des T4-2-Prompts):
-- ein Zugriffsweg, eine grantbare Fläche. Kein DATABASE_URL, keine zweite Verbindung.
--
-- Muster exakt wie T4-1: SET search_path = '' (alle Objekte fully-qualified), SECURITY DEFINER,
-- erst `revoke all … from public`, dann gezielt `grant execute … to authenticated` — NIE an anon
-- (Least-Privilege, keine Rechte auf Vorrat, J9). service_role braucht diese Wrapper nicht
-- (sie leiten sich aus auth.uid() ab, das für service_role null ist) und bekommt sie daher nicht.

-- ── get_my_entitlement: Zugangsstatus des EINGELOGGTEN Nutzers zu einem Produkt ──────────────────
-- KEIN user_id-Parameter (nur das Produkt): eine übergebbare User-ID wäre eine Auskunfts-
-- schnittstelle über fremde Konten. Die Identität kommt aus auth.uid() (dem JWT der Session),
-- nie aus einem Argument. Delegiert an platform.has_entitlement() — dieselbe eine Wahrheit über
-- „aktiver Zugang" (is_active UND valid_until nicht abgelaufen, I1/T11), die auch T7 (Cron) nutzt.
-- BARE auth.uid(), NICHT (select auth.uid()): das Subquery-Wrapping ist eine RLS-POLICY-
-- Optimierung (initplan-Caching in USING-Klauseln) — im Funktionskörper bringt es nichts und
-- löst hier einen Postgres-Backend-Segfault aus, sobald auth.uid() NULL ist (anon/kein JWT).
-- platform.is_admin() (T4-1) nutzt aus demselben Grund die blanke Form. Verifiziert (s. Report).
create function public.get_my_entitlement(p_product platform.product_key)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select platform.has_entitlement(auth.uid(), p_product);
$$;

comment on function public.get_my_entitlement(platform.product_key) is
  'RPC-Wrapper (T4-2, J3/J8): aktiver Zugang des EINGELOGGTEN Nutzers (auth.uid()) zu einem Produkt. '
  'Delegiert an platform.has_entitlement — kennt kein Stripe, keine subscriptions-Tabelle (die zwei '
  'kommerziellen Flags leben in platform.entitlements, §3). KEIN user_id-Parameter: keine Auskunft '
  'über fremde Konten. SECURITY DEFINER, weil platform nicht exponiert ist; nur authenticated.';

-- ── get_my_profile: Basisdaten des EIGENEN Profils ───────────────────────────────────────────────
-- Nur, was die Kontoseite braucht UND nicht ohnehin im Auth-User-Objekt steht: display_name (die
-- einzige nutzer-editierbare Profilspalte, T4-1) + created_at. E-Mail kommt aus auth.users (kein
-- E-Mail-Duplikat in profiles, T4-1) und wird hier bewusst NICHT gespiegelt. Kein user_id-Parameter
-- → strukturell nur die eigene Zeile (WHERE user_id = auth.uid()); fremde Profile sind nicht abfragbar.
create function public.get_my_profile()
returns table (user_id uuid, display_name text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, p.display_name, p.created_at
  from platform.profiles p
  where p.user_id = auth.uid(); -- blanke Form, s. Kommentar bei get_my_entitlement (Segfault-Vermeidung)
$$;

comment on function public.get_my_profile() is
  'RPC-Wrapper (T4-2, J3): Basisdaten des EIGENEN Profils (display_name, created_at) für die '
  'Kontoseite. Liest platform.profiles WHERE user_id = auth.uid() — keine fremde Zeile abfragbar. '
  'E-Mail kommt aus auth.users, nicht hier. SECURITY DEFINER, nur authenticated.';

-- ── Rechte: alle Auto-Grants entziehen, dann gezielt NUR authenticated ───────────────────────────
-- ACHTUNG, Unterschied zu T4-1: Diese Funktionen liegen in `public`, nicht in `platform`. Supabase
-- vergibt per ALTER DEFAULT PRIVILEGES auf NEUE public-Funktionen automatisch EXECUTE an anon,
-- authenticated UND service_role (zusätzlich zum PostgreSQL-Default-Grant an PUBLIC). Ein bloßes
-- `revoke … from public` (wie es in platform genügte, wo diese Default-Privileges nicht greifen)
-- ließe anon hier also weiterhin ausführen. Deshalb explizit von allen dreien + PUBLIC entziehen und
-- danach NUR authenticated gewähren. (Verifiziert per aclexplode-Introspektion — s. Report/DB-Gate.)
revoke all on function public.get_my_entitlement(platform.product_key)
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_profile()
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_entitlement(platform.product_key) to authenticated;
grant execute on function public.get_my_profile() to authenticated;
