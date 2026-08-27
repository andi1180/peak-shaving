-- B21-1 — Tarif- & Ladeoptimierung, SCHEMA-EBENE. Drei Referenzdaten-Tabellen im `public`-Schema.
--
-- Kanonische Quelle für den fachlichen Gegenstand: `Pflichtenheft_Kalkulator_Delta_Tarifoptimierung.md`
-- (Delta 5 = Netzbetreiber-Tarife, Delta 6 = Brutto/Netto, Delta 7 = aWATTar-Spotpreise).
-- Bauabschnitt und Reihenfolge: `Fahrplan_2026.md`, Zeile B21.
--
-- ── WAS HIER ENTSTEHT ───────────────────────────────────────────────────────────────────────────
--   TEIL 1  public.grid_tariffs             — eine Tarifzeile je (Betreiber, Netzebene, Variante, Stand)
--   TEIL 2  public.grid_tariff_rate_windows — beliebig viele Zeitfenster je Tarifzeile (SNAP, Winter, …)
--   TEIL 3  public.spot_prices              — historische Marktpreise (aWATTar), Basis der Simulation
--   TEIL 4  RLS und Rechte für alle drei
--
-- Alle drei gehören zusammen und kommen deshalb in EINER Migration: eine Tarifzeile ohne ihre
-- Zeitfenster ist unvollständig, und die Simulation aus Delta 4 führt Netzentgelt und Energiepreis
-- zu EINEM Intervallpreis zusammen — sie braucht beide Seiten oder keine.
--
-- ── WAS AUSDRÜCKLICH NICHT ENTSTEHT ─────────────────────────────────────────────────────────────
-- Kein Schreibweg (kein Wrapper, kein Cron-Endpunkt, kein Admin-UI, kein Schreib-Grant für IRGEND-
-- EINE Rolle), keine Zeile Inhalt (die Tabellen bleiben leer), keine Engine-Änderung, keine Berührung
-- von `packages/shared/src/tariff-catalog.ts` (B11) und keine Änderung am `platform`-Schema.
-- Der Schreibweg ist der nächste Teil-PR, die Oberfläche der übernächste.
--
-- ── WARUM `public` UND NICHT `platform` ─────────────────────────────────────────────────────────
-- `platform` trägt personenbezogene Daten (Konten, Leads, Zahlungsspiegel) und ist deshalb bewusst
-- NICHT über die Data API exponiert (DEPLOYMENT.md §2a): erreichbar nur über SECURITY-DEFINER-Wrapper
-- in `public`. Diese drei Tabellen sind das Gegenteil — VERÖFFENTLICHTE Preisblätter und
-- Börsenpreise, kein Personenbezug, für jeden lesbar. Sie folgen deshalb dem einzigen bereits
-- bestehenden anon-lesbaren Muster im Repo: direkter RLS-Select auf die Tabelle
-- (`monitor.tariff_snapshots`/`monitor.current_tariffs`, Migration 20260717174454), NICHT dem
-- RPC-Wrapper-Muster. `public` ist über die Data API bereits per Default exponiert — im Dashboard
-- ist für diese Migration NICHTS zu tun (anders als seinerzeit bei `monitor`, s. DEPLOYMENT.md §2a).
--
-- Der Konsument ist `apps/website` (der Kalkulator), und der hat heute KEINERLEI Supabase-Anbindung.
-- Ein RPC-Wrapper hätte dort denselben Client gebraucht wie ein direkter Select — er hätte nichts
-- geschützt, was hier zu schützen wäre, und eine zweite Aufrufkonvention eingeführt.
--
-- ── ⚠ DER STOLPERDRAHT, GEMESSEN: NEUE TABELLEN IN `public` SIND NICHT VON SELBST NUR-LESBAR ────
-- Dies sind die ERSTEN Tabellen, die dieses Repo im `public`-Schema anlegt (bisher stehen dort
-- ausschliesslich Funktionen). Für Funktionen ist die Falle seit T4-2 in einem Dutzend Migrationen
-- dokumentiert; für TABELLEN gilt sie genauso, und sie ist hier zum ersten Mal relevant:
--
--   Supabase legt per ALTER DEFAULT PRIVILEGES auf NEUE Tabellen im `public`-Schema automatisch
--   ALLE Tabellenrechte an `anon`, `authenticated` UND `service_role` — INSERT, UPDATE, DELETE
--   und TRUNCATE eingeschlossen.
--
-- Nachgemessen gegen den lokalen Stack (PostgreSQL 17.6, `create table public.…` in einer zurück-
-- gerollten Transaktion): alle drei Rollen bekamen ungefragt
-- `DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE`. Die Vorgabe „kein Schreib-Grant für
-- irgendeine Rolle" ist also NICHT dadurch erfüllt, dass man keinen Grant schreibt — sie verlangt
-- ein ausdrückliches `revoke all`. TEIL 4 tut das, und das DB-Gate misst es nach.
--
-- Das ist auch der Grund, warum das `monitor`-Muster hier nicht wortgleich übernommen werden konnte:
-- `monitor` steht nicht in `pg_default_acl`, dort genügte ein blosser `grant select`.
-- Wer künftig eine Tabelle in `public` anlegt: den `revoke`-Block aus TEIL 4 mitnehmen.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — public.grid_tariffs
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Eine Zeile ist EIN Tarif-Produkt eines Netzbetreibers zu EINEM Stand. Effektiv datiert
-- (`valid_from`/`valid_until`), NIE in-place überschrieben: eine 2026 archivierte Analyse (B14) muss
-- auch 2028 noch sagen können, welcher Stand ihr zugrunde lag. Neue Preisblätter erzeugen eine neue
-- Zeile, nicht ein UPDATE.
--
-- Nebeneffekt dieses Entwurfs, kein Sonderfall-Code: Solange für 2027 mangels Tarifverordnung
-- (SNE-T-V) keine Zeile existiert, gibt es automatisch keine Berechnungsgrundlage — genau die
-- Verweigerung, die B11 heute über `availability: 'pending_regulation'` im Code abbildet.
--
-- `grundpreis_amount` + `grundpreis_unit` als PAAR: Bei „mit Leistungsmessung" ist der Grundpreis ein
-- €/kW·Jahr-Wert (der Leistungspreis, an dem die gesamte Peak-Shaving-Rechnung hängt), bei „ohne
-- Leistungsmessung" laut Tarifblatt ein reiner Jahres-Pauschalbetrag. Zwei getrennte Spalten liessen
-- den Zustand „beides gesetzt" zu und damit die Frage, welche gilt; eine Spalte ohne Einheit liesse
-- die Zahl ihre Bedeutung verlieren. Der Unterschied ist fachlich tragend: `eur_per_year` bedeutet
-- Leistungspreis 0 €/kW·a und damit den Pfad ohne Spitzenkappung (Delta 3).
--
-- `price_basis` als Pflichtfeld auf JEDER Preisquelle (Delta 6): Netzentgelte laut Tarifblatt netto,
-- aWATTar-Rohpreise netto, verglichene Endkundentarife dagegen brutto. Ohne die Angabe an der Quelle
-- ist ein Vergleich zwischen zwei Zahlen aus verschiedenen Quellen stillschweigend um 20 % falsch.
create table public.grid_tariffs (
  id                     uuid primary key default gen_random_uuid(),
  operator_id            text not null,
  operator_name          text not null,
  netzebene              smallint not null,
  metering_variant       text,
  grundpreis_amount      numeric not null,
  grundpreis_unit        text not null,
  netzverlust_ct_per_kwh numeric not null,
  price_basis            text not null,
  valid_from             date not null,
  valid_until            date,
  created_by             text not null,
  created_at             timestamptz not null default now(),

  constraint grid_tariffs_netzebene_check
    check (netzebene between 3 and 7),
  constraint grid_tariffs_metering_variant_check
    check (metering_variant in ('mit_leistungsmessung', 'ohne_leistungsmessung', 'unterbrechbar')),
  constraint grid_tariffs_grundpreis_unit_check
    check (grundpreis_unit in ('eur_per_kw_year', 'eur_per_year')),
  constraint grid_tariffs_price_basis_check
    check (price_basis in ('net', 'gross')),

  -- ⚠ `nulls not distinct` (PostgreSQL 15+, Cloud und lokal laufen auf 17.6) — und das ist der
  -- wichtigste Constraint dieser Tabelle.
  --
  -- `metering_variant` ist laut Delta 5 nur bei den Netzebenen belegt, die eine Variante anbieten
  -- (Beispiel Wiener Netze: NE 7); bei NE 3–6 steht dort `null`. Ein GEWÖHNLICHES `unique` wertet
  -- NULL niemals als gleich zu NULL — es liesse also ausgerechnet für NE 3–6, den heute belegten
  -- Regelfall, beliebig viele Duplikate derselben Kombination zu. Zwei gleichzeitig gültige
  -- Tarifzeilen für dieselbe Kombination sind aber kein Vorrang, sondern ein Fehler: welcher
  -- Leistungspreis in eine Analyse einginge, entschiede die Sortierreihenfolge einer Abfrage.
  constraint grid_tariffs_unique
    unique nulls not distinct (operator_id, netzebene, metering_variant, valid_from)
);

comment on table public.grid_tariffs is
  'Netzbetreiber-Tarifzeilen, effektiv datiert (Delta 5). Öffentliche Preisblattdaten, kein '
  'Personenbezug: RLS-Select für anon+authenticated, kein Schreib-Grant für irgendeine Rolle. '
  'Nie in-place überschreiben — ein neuer Stand ist eine neue Zeile.';

comment on column public.grid_tariffs.grundpreis_unit is
  'Bestimmt die Bedeutung von grundpreis_amount: eur_per_kw_year = Leistungspreis (Peak-Shaving '
  'relevant), eur_per_year = Jahrespauschale ohne Leistungsmessung (Leistungspreis 0 €/kW·a).';

comment on column public.grid_tariffs.price_basis is
  'net | gross (Delta 6). Intern wird durchgängig netto gerechnet; USt. kommt ausschliesslich '
  'ganz am Schluss für die brutto-orientierte Ergebnisdarstellung drauf, nie in der Zwischenrechnung.';

comment on column public.grid_tariffs.valid_until is
  'null = weiterhin gültig. Existiert für einen Zeitraum keine Zeile, gibt es keine '
  'Berechnungsgrundlage — die Verweigerung ist Nebeneffekt des Entwurfs, kein Sonderfall-Code.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — public.grid_tariff_rate_windows
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Die zeitabhängige Arbeitspreis-Seite des Netzentgelts. Eine Kind-Tabelle statt fixer Spalten
-- (`snap_ct_per_kwh`, `winter_ct_per_kwh`, …), weil ein Winter-Tarif angekündigt, aber noch nicht
-- veröffentlicht ist: fixe Spalten brauchten für jeden neuen Saisontyp eine neue Migration, die
-- Kind-Tabelle nimmt beliebig viele Fenster auf, ohne dass sich `grid_tariffs` je wieder ändert.
--
-- Für die Engine (Delta 4) sind SNAP und Winter damit keine Sonderfälle, sondern reguläre Fenster
-- derselben Struktur wie die bestehenden `timeOfUseWindows` der Energiepreis-Seite.
--
-- `month_day_from`/`month_day_to` als 'MM-DD'-Text und null = ganzjährig: ein `date` verlangte ein
-- Jahr, das eine wiederkehrende Saison nicht hat.
--
-- `on delete cascade`: Ein Fenster ohne seine Tarifzeile hat keine Bedeutung. Es gibt hier bewusst
-- KEINE der asymmetrischen `on delete set null`-Ausnahmen, die das `platform`-Schema durchziehen —
-- diese Tabellen tragen keinen Verweis auf ein Konto oder einen Lead, und damit auch nicht die
-- Falle, dass eine referentielle Aktion einen Unveränderlichkeits-Trigger auslöst.
create table public.grid_tariff_rate_windows (
  id             uuid primary key default gen_random_uuid(),
  grid_tariff_id uuid not null references public.grid_tariffs(id) on delete cascade,
  label          text not null,
  month_day_from text,
  month_day_to   text,
  time_from      time not null,
  time_to        time not null,
  ct_per_kwh     numeric not null
);

-- Der Fremdschlüssel bekommt seinen eigenen Index: PostgreSQL legt für eine FK-Spalte KEINEN an, und
-- ohne ihn führt jedes `delete` auf einer Tarifzeile zu einem vollen Durchlauf der Kind-Tabelle.
-- Ausserdem ist „alle Fenster zu dieser Tarifzeile" die einzige Abfrage, die diese Tabelle je sieht.
create index grid_tariff_rate_windows_tariff_idx
  on public.grid_tariff_rate_windows (grid_tariff_id);

comment on table public.grid_tariff_rate_windows is
  'Zeitfenster je Tarifzeile (Delta 5): normal, snap, winter, … Beliebig viele — ein neuer '
  'Saisontyp braucht deshalb nie wieder eine Migration.';

comment on column public.grid_tariff_rate_windows.month_day_from is
  'Saison-Beginn als MM-DD (wiederkehrend, jahreslos). null = ganzjährig.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — public.spot_prices
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Echte historische Marktpreise. Prinzip 1b (Delta 2): Für den Vergleichsfall „was hätte ich mit
-- Batterie und optimiertem Tarif bezahlt" gibt es keine Rechnung, die das belegt — das ist zwingend
-- Simulation gegen ECHTE Marktpreise. Eine erfundene oder synthetische Preiskurve wäre hier derselbe
-- Fehler wie ein geschätzter Tarifsatz.
--
-- `unique (provider, ts_start)` ist die Voraussetzung für ein sicheres Upsert: der tägliche Abruf
-- (Delta 7, kommt im Schreibweg-PR) holt den Folgetag und darf einen bereits geholten Zeitraum
-- gefahrlos erneut schreiben.
--
-- `provider` von Anfang an, obwohl vorerst nur 'awattar_at' befüllt wird — kein Auswahl-UI, nur der
-- Tag, damit eine zweite Quelle später keine Migration braucht.
--
-- EIN Bau, zwei Verbraucher: dieselbe Tabelle bedient den Kalkulator (rollierendes 12-Monats-Fenster
-- für die Simulation) und später ohne Neubau das Management-Produkt (morgige Preise ab 14 Uhr). Das
-- ist ausdrücklich KEIN Vorgriff auf Management-Funktionalität, sondern nur auf die Datenhaltung.
create table public.spot_prices (
  id          uuid primary key default gen_random_uuid(),
  provider    text not null,
  ts_start    timestamptz not null,
  ts_end      timestamptz not null,
  ct_per_kwh  numeric not null,
  price_basis text not null default 'net',
  fetched_at  timestamptz not null default now(),

  constraint spot_prices_price_basis_check
    check (price_basis in ('net', 'gross')),
  constraint spot_prices_provider_ts_start_unique
    unique (provider, ts_start)
);

comment on table public.spot_prices is
  'Historische Marktpreise je Viertelstunde/Stunde (Delta 7, Quelle aWATTar). Prinzip 1b: der '
  'Tarifvergleich wird gegen ECHTE Vergangenheitspreise simuliert, nie gegen ein geschätztes Profil.';

comment on column public.spot_prices.price_basis is
  'aWATTar liefert netto (verifiziert). Der Default net ist deshalb die Wahrheit der heutigen '
  'Quelle, keine Vermutung — eine brutto liefernde Quelle setzt den Wert ausdrücklich.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — RLS und Rechte
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Zwei Schichten, beide nötig, jede für sich ausreichend gegen einen Schreibzugriff:
--
--   (a) `revoke all` → `grant select`: nimmt die von Supabases ALTER DEFAULT PRIVILEGES automatisch
--       vergebenen INSERT/UPDATE/DELETE/TRUNCATE-Rechte wieder weg (s. Kopf dieser Datei) und gibt
--       gezielt nur das Lesen zurück. `service_role` bekommt bewusst GAR KEINEN Grant — auch keinen
--       lesenden: es gibt heute keinen serverseitigen Verbraucher, und der Schreibweg entscheidet in
--       seinem eigenen PR, welche Rolle wie schreibt.
--   (b) RLS mit ausschliesslich einer SELECT-Policy: kein INSERT/UPDATE/DELETE-Pfad existiert, auch
--       nicht als Policy, die eine künftige Migration versehentlich aufweichen könnte.
--
-- `grant usage on schema public` ist nicht nötig — anders als bei `monitor` besteht es bereits.
alter table public.grid_tariffs             enable row level security;
alter table public.grid_tariff_rate_windows enable row level security;
alter table public.spot_prices              enable row level security;

create policy grid_tariffs_public_read
  on public.grid_tariffs
  for select
  to anon, authenticated
  using (true);

create policy grid_tariff_rate_windows_public_read
  on public.grid_tariff_rate_windows
  for select
  to anon, authenticated
  using (true);

create policy spot_prices_public_read
  on public.spot_prices
  for select
  to anon, authenticated
  using (true);

revoke all on table public.grid_tariffs             from public, anon, authenticated, service_role;
revoke all on table public.grid_tariff_rate_windows from public, anon, authenticated, service_role;
revoke all on table public.spot_prices              from public, anon, authenticated, service_role;

grant select on table public.grid_tariffs             to anon, authenticated;
grant select on table public.grid_tariff_rate_windows to anon, authenticated;
grant select on table public.spot_prices              to anon, authenticated;
