-- Ausgangslage: Zählpunkt 1 ohne jede Batterie-Angabe.
--
-- ⚠ Der Entwurf wird GELEERT, nicht ergänzt: der Lauf speichert selbst und prüft anschliessend
-- den Zustand „erfasst, aber ohne Kenndaten". Ein Rest aus dem vorigen Lauf machte ihn
-- unerreichbar, und der Test wäre grün, ohne etwas gemessen zu haben.
update platform.metering_points
   set draft = '{}'::jsonb
 where id = '22222222-2222-4222-8222-222222222222';
