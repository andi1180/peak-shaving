-- Ausgangslage: ein Tarifstand OHNE Messpreis. Das leere Auswahlfeld ist die Bedingung des
-- AdminSelect-Fehlers — mit gesetzter Einheit fiele das Feld auf den richtigen Wert zurück.
delete from platform.grid_tariff_changes where tariff_id = '44444444-4444-4444-8444-444444444444';
delete from public.grid_tariffs where operator_id = 'e2e_netz';

insert into public.grid_tariffs
  (id, operator_id, operator_name, netzebene, metering_variant, grundpreis_amount, grundpreis_unit,
   netzverlust_ct_per_kwh, price_basis, valid_from, created_by)
values ('44444444-4444-4444-8444-444444444444', 'e2e_netz', 'E2E Netz', 5, null, 38.52,
        'eur_per_kw_year', 0.3, 'net', '2026-01-01', 'e2e@example.test');

insert into public.grid_tariff_rate_windows
  (grid_tariff_id, label, time_from, time_to, ct_per_kwh, note)
values ('44444444-4444-4444-8444-444444444444', 'normal', '00:00', '24:00', 4.5, 'Preisblatt S. 2');
