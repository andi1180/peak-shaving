-- Ausgangslage: Zählpunkt 1 ohne jede PV-Angabe.
--
-- ⚠ Der Entwurf wird GELEERT, nicht ergänzt. Der Lauf beantwortet die Frage selbst und prüft
-- danach, was gespeichert ist; eine stehengebliebene Antwort aus dem vorigen Lauf machte die
-- Frage unerreichbar, und der Test wäre grün, ohne etwas gemessen zu haben.
update platform.metering_points
   set draft = '{}'::jsonb
 where id = '22222222-2222-4222-8222-222222222222';
