-- Ausgangslage: ein Testgerät OHNE jede Kenngrösse, insbesondere ohne Wirkungsgrad-Quelle.
--
-- ⚠ Der leere Ausgangsstand ist die Bedingung des Fehlers, nicht Bequemlichkeit: Ein `<select>`
-- fällt beim Formular-Reset nach der Action auf den Stand des SEITENAUFBAUS zurück. Trüge die
-- Zeile schon eine Quelle, fiele das Feld auf die richtige Antwort zurück und der Lauf wäre grün,
-- ohne etwas gemessen zu haben.
delete from public.battery_catalog where hersteller = 'E2E' and bezeichnung = 'RTE-Quelle';

insert into public.battery_catalog (id, kategorie, hersteller, bezeichnung)
values ('33333333-3333-4333-8333-333333333333', 'gewerbe', 'E2E', 'RTE-Quelle');
