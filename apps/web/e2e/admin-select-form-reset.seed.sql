-- Ausgangslage für `admin-select-form-reset.mjs` — drei Formulare, drei Bauarten.
--
-- ⚠ Beide Zeilen starten mit dem UNAUFFÄLLIGEN Wert (Lead ohne Branche, Baustein „fundament").
-- Das ist die Bedingung des Fehlers, nicht Bequemlichkeit: Ein `<select>` fällt beim
-- Formular-Reset nach der Action auf den Stand des SEITENAUFBAUS zurück. Trüge die Zeile schon
-- den Zielwert, fiele das Feld auf die richtige Antwort zurück und der Lauf wäre grün, ohne etwas
-- gemessen zu haben.
delete from platform.leads where id = '44444444-4444-4444-8444-444444444444';
delete from public.battery_cost_components where id = '55555555-5555-4555-8555-555555555555';
delete from public.retail_tariffs where provider_id = 'e2e-select';

insert into platform.leads (id, email, first_source_key, deletion_due_at, company)
values ('44444444-4444-4444-8444-444444444444', 'e2e-select@example.test', 'direktkontakt',
        now() + interval '24 months', 'E2E AdminSelect');

insert into public.battery_cost_components (id, art, bezeichnung)
values ('55555555-5555-4555-8555-555555555555', 'fundament', 'E2E AdminSelect');
