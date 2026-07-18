-- Altlast aus T4-1 abgeräumt (T4-2, Aufgabe 0a): CHECK-Constraint gegen ein FAIL-OPEN
-- in platform.entitlements. Migrationshistorie bleibt append-only — die T4-1-Migration
-- (20260718093043_create_platform_schema.sql) wird NICHT editiert, dieser Constraint kommt
-- additiv obendrauf.
--
-- ── DAS FAIL-OPEN, das hier geschlossen wird ─────────────────────────────────────────────────────
-- platform.has_entitlement() (T4-1) behandelt `valid_until IS NULL` als UNBEGRENZT gültig
-- (WHERE ... and (e.valid_until is null or e.valid_until > now())). Das ist bei source='manual'
-- korrekt (Lifetime-/Testkonten laufen nie ab), bei source='stripe' aber ein Loch: eine
-- Stripe-abgeleitete Zeile mit is_active=true und valid_until=NULL gewährt DAUERHAFT Zugang,
-- obwohl ein Stripe-Abo per Definition ein Ablaufdatum (current_period_end) hat.
--
-- KONKRETER ANLASS (T4-3-Fallstrick, jetzt festgezurrt statt später schmerzhaft entdeckt):
-- Stripe hat mit der API-Version 2025-03-31 ("Basil") current_period_end/current_period_start
-- vom Subscription-Objekt ENTFERNT und auf das SubscriptionItem verschoben. Ein T4-3-Webhook-
-- Handler, der naiv `subscription.current_period_end` liest, bekommt seit "Basil" `undefined`
-- → schriebe current_period_end=NULL in platform.subscriptions → der Sync-Trigger
-- (platform.sync_entitlement_from_subscription) leitete daraus valid_until=NULL bei is_active=true
-- ab → ein GEKÜNDIGTER Kunde behielte über has_entitlement() dauerhaft Zugang. Ein still
-- verschenktes Produkt, das niemandem auffällt, bis die Umsätze fehlen.
--
-- Dieser Constraint lässt genau das LAUT scheitern (die entitlements-Ableitung im Sync-Trigger
-- bricht ab) statt still Zugang zu verschenken. Die richtige T4-3-Antwort ist, current_period_end
-- aus dem SubscriptionItem (Basil) zu lesen; bis dahin ist ein harter Fehler das ehrliche Verhalten.
--
-- source='manual' bleibt bewusst mit valid_until=NULL erlaubt (Lifetime-/Testkonten, I2).

alter table platform.entitlements
  add constraint entitlements_stripe_active_requires_valid_until
  check (not (source = 'stripe' and is_active = true and valid_until is null));

comment on constraint entitlements_stripe_active_requires_valid_until on platform.entitlements is
  'Fail-open-Schutz (T4-2, Aufgabe 0a): eine aktive Stripe-Zeile MUSS ein valid_until tragen. '
  'has_entitlement() behandelt valid_until IS NULL als unbegrenzt — bei source=stripe wäre das '
  'Dauerzugang trotz gekündigtem Abo (Stripe-"Basil"-API verschob current_period_end aufs '
  'SubscriptionItem; ein naiver T4-3-Handler bekäme undefined → NULL). source=manual bleibt mit '
  'valid_until NULL erlaubt (Lifetime-/Testkonten, I2).';
