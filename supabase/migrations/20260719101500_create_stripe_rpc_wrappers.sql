-- T4-3, Aufgabe 2: public-RPC-Wrapper für den Stripe-Webhook + Checkout/Portal + Kontoseite.
--
-- ── WARUM RPC UND NICHT DIREKTZUGRIFF (K2/J3) ────────────────────────────────────────────────────
-- Der Webhook-Handler (T4-3) schreibt NICHT direkt in `platform`-Tabellen. Zwei Gründe, dieselbe
-- Konsequenz wie bei den T4-2-Lesewrappern:
--   1. `platform` ist bewusst NICHT in [api].schemas exponiert (T4-1) — ein supabase-js-`.from()` mit
--      dem service_role-Key erreicht das Schema über PostgREST gar nicht (PGRST106).
--   2. Invariante J3 (T4-2) verlangt GENAU EINEN Zugriffsweg auf `platform`: SECURITY-DEFINER-Wrapper
--      im exponierten `public`-Schema, eine grantbare Fläche. Die T4-1-Handover-Notiz „der Webhook
--      schreibt als service_role direkt" ist damit ÜBERHOLT (K2).
-- Alle Schreib-/Lesewrapper des Webhooks/Checkouts sind AUSSCHLIESSLICH an service_role gegrantet
-- (nicht authenticated, nicht anon — kein Recht auf Vorrat). Der eine nutzerseitige Wrapper
-- (get_my_subscription, Kontoseite) ist authenticated-only und liest strukturell nur die eigene Zeile.
--
-- Muster exakt wie T4-1/T4-2: SET search_path = '' (alle Objekte fully-qualified), SECURITY DEFINER,
-- erst `revoke all … from public, anon, authenticated, service_role`, dann gezielt grant execute.
-- (public-Funktionen bekommen per Supabase-ALTER-DEFAULT-PRIVILEGES sonst automatisch EXECUTE an
-- anon/authenticated/service_role — deshalb explizit von allen entziehen, s. T4-2-Migration.)

-- ── process_stripe_subscription_event: der atomare Webhook-Arbeitspferd-Wrapper ──────────────────
-- Vereint ABSICHTLICH drei Schritte in EINER Transaktion (= ein RPC-Aufruf): (1) Event aufzeichnen
-- (Idempotenz K5/I6), (2) Customer-Zuordnung verankern (K3, defensiv/idempotent), (3) Subscription
-- spiegeln (I2/I5/I9 über die bestehenden subscriptions-Trigger).
--
-- WARUM ATOMAR STATT DREI GETRENNTE WRAPPER: Würde der Handler „Event aufzeichnen" und „Subscription
-- spiegeln" als ZWEI RPC-Roundtrips (= zwei Transaktionen) ausführen, entstünde ein Lost-Update:
-- Schlägt das Spiegeln nach dem bereits committeten Event-Insert fehl, sähe Stripes Wiederholung das
-- Event als Duplikat (K5) und übersprünge das Spiegeln endgültig. In EINER Transaktion rollt ein
-- Fehler im Spiegeln den Event-Insert mit zurück → die Wiederholung verarbeitet erneut. „Event zuerst,
-- dann spiegeln" (K5-Reihenfolge) ist hier die erste Anweisung der Transaktion, nicht ein separater
-- Roundtrip.
--
-- RÜCKGABE: 'duplicate' (Event-ID war schon bekannt → Handler antwortet 200, keine Verarbeitung) oder
-- 'processed'. Ein Fehler in Schritt 3 (z. B. der valid_until-CHECK bei fehlendem current_period_end,
-- K7) wird NICHT geschluckt — die Funktion wirft, der Handler antwortet != 2xx, Stripe wiederholt.
-- Die vier zuletzt stehenden Parameter sind bewusst nullable/optional (DEFAULT): current_period_end,
-- price_id, customer_id fehlen bei unvollständigen Zwischenständen (z. B. incomplete-Abo); der
-- Supabase-Typgenerator markiert Parameter-mit-Default als OPTIONAL, sodass der Handler sie sauber
-- als `?? undefined` (= weglassen = SQL-Default NULL) übergeben kann, statt `null` gegen einen
-- non-null-Typ zu casten. Die TYP-Signatur (…, text, text, text, text, timestamptz, boolean) bleibt
-- gegenüber einer defaultfreien Fassung unverändert — Grants/Kommentar bleiben gültig.
create function public.process_stripe_subscription_event(
  p_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_user_id uuid,
  p_product platform.product_key,
  p_stripe_subscription_id text,
  p_status text,
  p_stripe_customer_id text default null,
  p_price_id text default null,
  p_current_period_end timestamptz default null,
  p_cancel_at_period_end boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 1. Idempotenz ZUERST (K5/I6): Event-ID ist der PK. Ein Konflikt = Duplikat → nichts weiter tun.
  --    FOUND ist nach `insert … on conflict do nothing` false, wenn der Konflikt griff (0 Zeilen).
  insert into platform.stripe_events (stripe_event_id, type)
  values (p_event_id, p_event_type)
  on conflict (stripe_event_id) do nothing;

  if not found then
    return 'duplicate';
  end if;

  -- 2. Customer-Zuordnung verankern (K3). Der Regelfall verankert sie schon beim Checkout-Start
  --    (upsert_stripe_customer, VOR dem Checkout); dieser idempotente Zweig ist die Selbstheilung,
  --    falls die Zuordnung dort fehlte. Write-once: ein bestehender Customer bleibt unangetastet.
  if p_stripe_customer_id is not null then
    insert into platform.customers (user_id, stripe_customer_id)
    values (p_user_id, p_stripe_customer_id)
    on conflict (stripe_customer_id) do nothing;
  end if;

  -- 3. Subscription spiegeln. Der BEFORE-UPDATE-Trigger reject_stale_subscription_update (I5) verwirft
  --    ein älteres Event (RETURN NULL → Zeile unverändert, AFTER-Sync feuert dann nicht); der
  --    AFTER-Trigger sync_entitlement_from_subscription (I2/I9) leitet die entitlements-Zeile ab.
  insert into platform.subscriptions as s
    (stripe_subscription_id, user_id, product, status, price_id,
     current_period_end, cancel_at_period_end, stripe_event_created_at)
  values
    (p_stripe_subscription_id, p_user_id, p_product, p_status, p_price_id,
     p_current_period_end, coalesce(p_cancel_at_period_end, false), p_event_created_at)
  on conflict (stripe_subscription_id) do update
    set status                  = excluded.status,
        price_id                = excluded.price_id,
        current_period_end      = excluded.current_period_end,
        cancel_at_period_end    = excluded.cancel_at_period_end,
        stripe_event_created_at = excluded.stripe_event_created_at,
        user_id                 = excluded.user_id,
        product                 = excluded.product;

  return 'processed';
end;
$$;

comment on function public.process_stripe_subscription_event(
  text, text, timestamptz, uuid, platform.product_key, text, text, text, text, timestamptz, boolean
) is
  'T4-3 (K1/K2/K5/K7): atomarer Webhook-Wrapper. Zeichnet das Stripe-Event auf (Idempotenz K5/I6), '
  'verankert die Customer-Zuordnung (K3, idempotent) und spiegelt die Subscription (I2/I5/I9 über die '
  'Trigger) — alles in EINER Transaktion. Rückgabe ''duplicate'' (Event bekannt) oder ''processed''. '
  'Der Zugang entsteht NICHT hier, sondern über den entitlements-Sync-Trigger (K1). service_role-only.';

-- ── upsert_stripe_customer: Nutzer↔Customer-Zuordnung VOR dem Checkout verankern (K3) ─────────────
-- Wird von der Checkout-Start-Server-Action aufgerufen, nachdem der Stripe-Customer angelegt/
-- nachgeschlagen wurde. Write-once (ON CONFLICT DO NOTHING auf der unique stripe_customer_id): eine
-- bestehende Zuordnung wird nie überschrieben — die Abbildung Customer→User ist unveränderlich.
create function public.upsert_stripe_customer(p_user_id uuid, p_stripe_customer_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into platform.customers (user_id, stripe_customer_id)
  values (p_user_id, p_stripe_customer_id)
  on conflict (stripe_customer_id) do nothing;
end;
$$;

comment on function public.upsert_stripe_customer(uuid, text) is
  'T4-3 (K3): verankert die Nutzer↔Stripe-Customer-Zuordnung VOR dem Checkout (Checkout-Start-Action). '
  'Write-once (ON CONFLICT DO NOTHING) — die Abbildung ist unveränderlich. service_role-only.';

-- ── get_stripe_customer_id: bestehende Zuordnung nachschlagen (Checkout-Start + Portal) ───────────
-- Liefert die stripe_customer_id des Nutzers oder NULL. 1 Customer/Nutzer ist die Erwartung, aber
-- nicht hart erzwungen (T4-1) — bei mehreren die zuletzt angelegte (der aktuellste Bezug).
create function public.get_stripe_customer_id(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select c.stripe_customer_id
  from platform.customers c
  where c.user_id = p_user_id
  order by c.created_at desc
  limit 1;
$$;

comment on function public.get_stripe_customer_id(uuid) is
  'T4-3 (K3): stripe_customer_id eines Nutzers (oder NULL). Checkout-Start (bestehenden Customer '
  'wiederverwenden statt einen zweiten anzulegen) + Portal-Start (Ziel-Customer). service_role-only.';

-- ── get_my_subscription: Abo-Detail des EINGELOGGTEN Nutzers für die Kontoseite (K10-Anzeige) ─────
-- Die Zugangs-WAHRHEIT liest die Kontoseite weiter über get_my_entitlement (Boolean, K1). Dieser
-- Wrapper liefert nur die menschenlesbaren DETAILS (Status, Gültigkeit, geplante Kündigung) für die
-- Anzeige. KEIN user_id-Parameter → strukturell nur die eigene Zeile (WHERE user_id = auth.uid()).
-- BARE auth.uid() (nicht (select auth.uid())): Segfault-Vermeidung wie bei den T4-2-Wrappern.
create function public.get_my_subscription(p_product platform.product_key)
returns table (status text, current_period_end timestamptz, cancel_at_period_end boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.status, s.current_period_end, s.cancel_at_period_end
  from platform.subscriptions s
  where s.user_id = auth.uid()
    and s.product = p_product
  order by s.current_period_end desc nulls last
  limit 1;
$$;

comment on function public.get_my_subscription(platform.product_key) is
  'T4-3 (K10): Abo-Detail (status/current_period_end/cancel_at_period_end) des EINGELOGGTEN Nutzers '
  'für die Kontoseite-ANZEIGE. Die Zugangsentscheidung liest weiter get_my_entitlement (K1). '
  'Nur die eigene Zeile (WHERE user_id = auth.uid()); authenticated-only.';

-- ── Rechte: alle Auto-Grants entziehen, dann gezielt vergeben (Least-Privilege) ──────────────────
-- Die Webhook-/Checkout-/Portal-Wrapper: NUR service_role (nie authenticated/anon). Ein authentifizierter
-- Nutzer darf weder Events aufzeichnen noch Subscriptions/Customers schreiben (der Bezahlschutz, I3).
revoke all on function public.process_stripe_subscription_event(
  text, text, timestamptz, uuid, platform.product_key, text, text, text, text, timestamptz, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.upsert_stripe_customer(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_stripe_customer_id(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_subscription(platform.product_key)
  from public, anon, authenticated, service_role;

grant execute on function public.process_stripe_subscription_event(
  text, text, timestamptz, uuid, platform.product_key, text, text, text, text, timestamptz, boolean
) to service_role;
grant execute on function public.upsert_stripe_customer(uuid, text) to service_role;
grant execute on function public.get_stripe_customer_id(uuid) to service_role;
-- Der einzige nutzerseitige Wrapper: authenticated-only (liest die eigene Zeile), nie service_role
-- (der hat keine auth.uid()) und nie anon.
grant execute on function public.get_my_subscription(platform.product_key) to authenticated;
