-- Seed: die erfundenen AT-Tarif-Fixtures aus T1
-- (packages/tariff-monitor/src/fixtures/{tariffs,scenarios}.ts) als monitor.tariff_snapshots-
-- Zeilen, source='seed_placeholder'.
--
-- PLATZHALTER — KEINE echten Anbieterdaten. Dieselben erfundenen, aber plausiblen AT-Werte, gegen
-- die die T1-Engine bereits testet (s. dortige Kommentare zu Datenschutz/ToS). Zweck: T3
-- (Gratis-Check) kann gegen echte Tabellen-Zeilen entwickeln/testen statt gegen hartkodierte
-- Frontend-Fixtures. Echte Tarife (source='scrape') ersetzen diesen Seed, sobald der T2-Scraper
-- reale Targets hat (§12 #6) — bis dahin bleibt er die einzige Datenquelle für current_tariffs.

-- ── Historisierungs-Beweis (§7): zwei Snapshots DESSELBEN Tarifs mit unterschiedlichem
-- captured_at. monitor.current_tariffs (DISTINCT ON … ORDER BY captured_at DESC) darf NUR den
-- neueren zeigen — der ältere bleibt nur in der vollen tariff_snapshots-Zeitreihe sichtbar. ──
insert into monitor.tariff_snapshots
  (provider_name, tariff_name, energy_price_ct_per_kwh, base_fee_eur_per_year, bonus_eur,
   bonus_condition_text, price_guarantee_months, contract_commitment_months, billing_cycle,
   green_energy, requires_prepayment, captured_at, source)
values
  -- älterer Snapshot (fiktiver Vor-Preis, frei erfunden zur Demonstration der Zeitreihe) — MUSS
  -- aus current_tariffs verschwinden.
  ('Sonnenstrom Direkt', 'Klick Strom Online', 23.9, 96, 150,
   'Einmaliger Wechselbonus, gültig im ersten Vertragsjahr', 12, 0, 'monthly',
   true, false, now() - interval '30 days', 'seed_placeholder'),
  -- aktueller Snapshot == T1-Fixture `bonusGuaranteeTariff` (tariffs.ts) — MUSS in
  -- current_tariffs stehen.
  ('Sonnenstrom Direkt', 'Klick Strom Online', 22.5, 96, 150,
   'Einmaliger Wechselbonus, gültig im ersten Vertragsjahr', 12, 0, 'monthly',
   true, false, now(), 'seed_placeholder');

-- ── Übrige T1-Fixtures, je ein aktueller Snapshot (captured_at = Default now()). ──
insert into monitor.tariff_snapshots
  (provider_name, tariff_name, energy_price_ct_per_kwh, base_fee_eur_per_year, bonus_eur,
   bonus_condition_text, price_guarantee_months, contract_commitment_months, billing_cycle,
   green_energy, requires_prepayment, source)
values
  -- tariffs.ts: noBonusNoGuaranteeTariff
  ('Basis Energie AG', 'Strom Klassik', 24.9, 110, 0,
   null, null, 12, 'annual', false, true, 'seed_placeholder'),

  -- scenarios.ts: HOUSEHOLD_CANDIDATES
  ('SparStrom Direkt', 'SparStrom Bonus', 21.9, 90, 120,
   'Einmaliger Wechselbonus, gültig im ersten Vertragsjahr', null, 0, 'monthly',
   true, false, 'seed_placeholder'),
  ('Komfort Energie', 'Komfort Fix', 27.5, 120, 0,
   null, null, 0, 'monthly', false, false, 'seed_placeholder'),
  ('Blitz Energie', 'Blitz Prepaid', 19.9, 75, 0,
   null, null, 0, 'monthly', false, true, 'seed_placeholder'),
  ('Öko Energie', 'Öko Vorkasse', 20.9, 85, 0,
   null, null, 0, 'monthly', true, true, 'seed_placeholder'),

  -- scenarios.ts: SMALL_BUSINESS_CANDIDATES
  ('SparStrom Gewerbe', 'Gewerbe Spar Bonus', 20.9, 150, 300,
   'Einmaliger Wechselbonus, gültig im ersten Vertragsjahr', null, 0, 'monthly',
   true, false, 'seed_placeholder'),
  ('Komfort Energie Gewerbe', 'Gewerbe Komfort', 26.5, 200, 0,
   null, null, 0, 'monthly', false, false, 'seed_placeholder'),
  ('Blitz Energie Gewerbe', 'Blitz Gewerbe Prepaid', 18.9, 120, 0,
   null, null, 0, 'monthly', false, true, 'seed_placeholder'),
  ('Öko Energie Gewerbe', 'Öko Gewerbe Vorkasse', 19.9, 130, 0,
   null, null, 0, 'monthly', true, true, 'seed_placeholder');
