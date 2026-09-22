-- K1 — Batteriekatalog in der Datenbank + Admin-Pflege.
--
-- Bis hierher ist der Batteriekatalog ein CODEMODUL: `packages/shared/src/demo-battery-catalog.ts`
-- (`DEMO_BATTERY_CATALOG`, sechs frei erfundene Geräte). Jede Preisänderung ist damit ein PR, und
-- der Report muss an der Stelle, an der sonst die Herkunft stünde, eine Lücke ausweisen
-- (`apps/website/lib/pdf-report/basis.ts`: „kein Herkunfts- und kein Preisfeld").
--
-- Diese Migration legt die Tabelle an, aus der der Katalog künftig kommt. Sie ändert AM RECHNEN
-- NICHTS: `DEMO_BATTERY_CATALOG`, `packages/engine` und `apps/website` sind in diesem Schritt
-- unangetastet, und die Tabelle ist leer. Das Befüllen ist K2, das Umhängen des Rechners K3.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- DIE FÜNF ENTSCHEIDUNGEN, DIE DIESE MIGRATION TRÄGT
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ── (1) `public` MIT DIREKTEM RLS-SELECT — WIE `grid_tariffs`, UND AUS DEMSELBEN GRUND ─────────
-- Ein Batteriekatalog ist kein Personenbezug, sondern eine Geräteliste mit Listenpreisen. Er wird
-- vom ÖFFENTLICHEN Rechner (`apps/website`) gelesen, der ausschliesslich einen `anon`-Client hat
-- (B21-3a). Deshalb dasselbe Muster wie `grid_tariffs`/`retail_tariffs`: Tabelle in `public`, RLS
-- mit genau EINER Select-Policy.
--
-- ⚠ MIT EINEM UNTERSCHIED, UND ER IST DER GRUND FÜR DIE HALBE MIGRATION: die Policy gibt nur die
-- AKTIVEN Zeilen frei. Ein Katalog wird zeilenweise erfasst — Kapazität heute, Preis morgen, das
-- Datenblatt übermorgen. Eine halbfertige Zeile, die der Rechner schon sieht, ist keine harmlose
-- Lücke: `recommendBattery` würde sie ranken, und ein Gerät ohne Preis gewönne jeden
-- Amortisationsvergleich. `active` ist deshalb kein Anzeige-Schalter, sondern die Grenze zwischen
-- Entwurf und Rechengrundlage.
--
-- ── (2) DIE ADMIN-SEITE LÄUFT ÜBER SECURITY-DEFINER-WRAPPER, NICHT ÜBER `service_role` ─────────
-- ⚠ HIER WEICHT K1 BEWUSST VOM `grid_tariffs`-MUSTER AB, und zwar aus zwei Gründen, die beide aus
-- Punkt (1) folgen:
--
--   (a) Der Admin muss die INAKTIVEN Zeilen sehen — sonst könnte er nichts fertigstellen. Über den
--       angemeldeten Client kommt er an sie nicht heran (die Policy gibt nur `active` frei), und
--       ein `service_role`-Client in einer Server COMPONENT ist im Repo ein Lint-Fehler
--       (`eslint.config.mjs`: „ein Import in einer Server-Component/Page ist weiterhin ein
--       Lint-Fehler"). Es braucht also ohnehin einen admin-geprüften Leseweg.
--   (b) Der Einkaufspreis (TEIL 4) verlangt laut Auftrag einen SECURITY-DEFINER-Wrapper mit
--       Adminprüfung. Damit steht dieser Weg für dieselbe Seite bereits; den Rest der Pflege
--       daneben über `service_role` zu führen, hiesse zwei Zugangsarten für einen Bildschirm.
--
-- Die Migration 20260828090000 nennt die Anwendungscode-Autorisierung der Netzbetreiber-Tarife
-- ausdrücklich „die einzige Stelle des Systems, an der das so ist" und „Es entsteht KEINE zweite
-- Art von Ausnahme". Eine zweite zu eröffnen, wo der Fall sie nicht erzwingt, wäre genau das.
-- `service_role` bekommt auf `public.battery_catalog` deshalb GAR KEIN Grant.
--
-- ── (3) VOLLSTÄNDIGKEIT IST EINE DATENBANK-BEDINGUNG, KEINE PRÜFUNG IM FORMULAR ────────────────
-- Der CHECK `battery_catalog_active_complete` sagt: eine Zeile darf nur dann `active` sein, wenn
-- alles dasteht, was die Engine aus ihr liest. Er gilt für `service_role` und `postgres` ebenso
-- wie für den Wrapper. Die Alternative wäre eine Prüfung im Wrapper allein — sie wäre beim nächsten
-- Umbau genau so lange wahr, wie niemand einen zweiten Schreibweg baut.
--
-- Welche Felder das sind, steht am CHECK. Bedingt dazu: ein Gerät OHNE eingebauten Wechselrichter
-- braucht dessen Aufpreis, ein Gerät MIT Fundamentbedarf dessen Kosten — genau die zwei Zuschläge,
-- die `packages/engine/src/roi/roi.ts:21-22` addiert. Fehlten sie, wäre die Investition zu niedrig
-- und die Amortisation zu gut; niemandem fiele das als Fehler auf, sondern als Ergebnis.
--
-- ── (4) PREISE STEHEN NETTO, UND ES GIBT KEINE BRUTTO-SPALTE ──────────────────────────────────
-- Brutto ist netto × 1,2 und damit eine Anzeigefrage, keine Angabe. Eine zweite Spalte wäre eine
-- zweite Wahrheit, die beim ersten Steuersatzwechsel oder beim ersten von Hand korrigierten Wert
-- auseinanderläuft. Gerechnet wird im ganzen System netto (Delta 6).
--
-- ── (5) KEINE EFFEKTIV-DATIERUNG, KEINE HISTORIE — ANDERS ALS BEI DEN TARIFEN ──────────────────
-- `grid_tariffs` und `retail_tariffs` datieren ihre Stände, weil eine ALTE Rechnung mit dem ALTEN
-- Preis nachvollziehbar bleiben muss. Für den Batteriekatalog ist das bereits anders gelöst: eine
-- abgelegte Analyse trägt den kompletten Katalogstand als Wertkopie in ihrem eingefrorenen `jsonb`
-- (`AnalysisBundleInputs.batteryCatalog`, B14-1). Eine zweite Historie daneben beantwortete
-- dieselbe Frage ein zweites Mal — und die beiden Antworten könnten sich widersprechen.
--
-- `price_as_of` ist deshalb ausdrücklich KEINE Gültigkeit, sondern ein PREISSTAND: „dieser Preis
-- stand an diesem Tag so im Angebot". Genau die Angabe, die der Report heute als Lücke ausweisen
-- muss.
--
-- ⚠ Folge, die mitzudenken ist: eine Preisänderung ÜBERSCHREIBT hier. Wer wissen will, was der
-- Katalog im März trug, sieht in einer Analyse aus dem März nach, nicht in dieser Tabelle.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — public.battery_catalog
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠ ALLE ENGINE-FELDER SIND NULLBAR, UND DAS IST DER ZWECK DER TABELLE. Sie ist ein Arbeitsplatz:
-- eine Zeile entsteht mit Hersteller und Bezeichnung und wächst, bis sie vollständig ist. `not null`
-- auf den Kenndaten hiesse, ein Gerät lässt sich nur in einem Zug erfassen — und ein Datenblatt, das
-- den Wirkungsgrad nicht nennt, blockierte die ganze Zeile. Die Vollständigkeit wird stattdessen
-- dort verlangt, wo sie zählt: beim Aktivieren (s. CHECK unten).
create table public.battery_catalog (
  id                      uuid primary key default gen_random_uuid(),

  -- Kennung beim Grosshändler (Memodo), sofern von dort übernommen. Nullbar: ein von Hand
  -- erfasstes Gerät hat keine. UNIQUE, damit ein zweiter Importlauf (K2) dieselbe Zeile
  -- wiederfindet statt sie ein zweites Mal anzulegen.
  memodo_id               integer unique,

  kategorie               text not null,
  hersteller              text not null,
  bezeichnung             text not null,

  -- ── Kenndaten: was die Simulation liest ──────────────────────────────────────────────────────
  -- Entsprechung in `BatteryCandidate` (packages/shared/src/battery.ts): usableCapacityKwh,
  -- maxPowerKw, roundTripEfficiency.
  usable_capacity_kwh     numeric,
  max_power_kw            numeric,
  round_trip_efficiency   numeric,

  -- ── Kosten: was die ROI-Rechnung liest ───────────────────────────────────────────────────────
  -- ⚠ `list_price_net` ist der GESAMTPREIS des Geräts, `BatteryCandidate.pricePerKwh` dagegen ein
  -- Preis JE KILOWATTSTUNDE. Die Engine rechnet `totalInvestment = Kapazität × pricePerKwh`
  -- (roi.ts:20) — die Übersetzung ist also eine Division durch `usable_capacity_kwh` und gehört in
  -- den Loader (K3), nicht in diese Tabelle. Gespeichert wird, was auf der Rechnung steht; ein
  -- €/kWh-Wert wäre bereits ein Rechenergebnis, und die Rundung daraus liefe in die Investition.
  list_price_net          numeric,
  inverter_included       boolean,
  extra_inverter_cost_net numeric,
  requires_foundation     boolean,
  foundation_cost_net     numeric,

  -- Montage/Elektroanschluss. ⚠ Die Engine hat dafür KEIN Feld (Bestandsaufnahme §2: es gibt nur
  -- die zwei Zuschläge oben). Die Spalte steht hier als Angabe für die Angebotslegung und ist
  -- deshalb auch zum Aktivieren NICHT erforderlich. Wer sie eines Tages in die Investition nimmt,
  -- erweitert `BatteryCandidate` — und erst dann gehört sie in den CHECK unten.
  installation_cost_net   numeric,

  price_as_of             date,
  source_url              text,
  datasheet_url           text,

  -- ⚠ `control_type` steht hier, obwohl es im Auftrag nicht aufgezählt ist: `BatteryCandidate`
  -- führt das Feld (`static|dynamic`), und ohne Spalte müsste der Loader es erfinden. Die Engine
  -- LIEST es heute an keiner Stelle (Bestandsaufnahme §2), es ist also kein Pflichtfeld zum
  -- Aktivieren; bleibt es leer, gilt die Konvention aus `battery.ts:23` (heim → static,
  -- gewerbe → dynamic). Eine Spalte, die null sein darf, ist billiger als eine Annahme im Loader,
  -- die niemand mehr als Annahme erkennt.
  control_type            text,

  notes                   text,

  -- Grenze zwischen Entwurf und Rechengrundlage (s. Kopf, Punkt 1). Vorgabe `false`: eine neu
  -- angelegte Zeile ist NIE sofort öffentlich.
  active                  boolean not null default false,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint battery_catalog_kategorie_check
    check (kategorie in ('heim', 'gewerbe')),
  constraint battery_catalog_control_type_check
    check (control_type is null or control_type in ('static', 'dynamic')),
  constraint battery_catalog_hersteller_check
    check (btrim(hersteller) <> ''),
  constraint battery_catalog_bezeichnung_check
    check (btrim(bezeichnung) <> ''),
  constraint battery_catalog_memodo_id_check
    check (memodo_id is null or memodo_id > 0),

  -- ── Plausible Wertebereiche ──────────────────────────────────────────────────────────────────
  -- Sie fangen den Tippfehler um eine Grössenordnung NICHT (25 statt 2,5 kWh ist eine gültige
  -- Zahl) — sie fangen das Unmögliche: eine Batterie ohne Kapazität, ohne Leistung, mit einem
  -- Wirkungsgrad über 100 %. Eine erfundene Obergrenze für Kapazität oder Preis wiese irgendwann
  -- ein echtes Gerät ab (Prinzip 1) und steht deshalb nicht da.
  constraint battery_catalog_capacity_check
    check (usable_capacity_kwh is null or usable_capacity_kwh > 0),
  constraint battery_catalog_power_check
    check (max_power_kw is null or max_power_kw > 0),
  constraint battery_catalog_efficiency_check
    check (round_trip_efficiency is null
           or (round_trip_efficiency > 0 and round_trip_efficiency <= 1)),
  constraint battery_catalog_list_price_check
    check (list_price_net is null or list_price_net > 0),
  -- Die drei Zuschläge dürfen 0 sein (ein Fundament, das nichts kostet, ist eine Aussage),
  -- aber nicht negativ.
  constraint battery_catalog_extra_inverter_cost_check
    check (extra_inverter_cost_net is null or extra_inverter_cost_net >= 0),
  constraint battery_catalog_foundation_cost_check
    check (foundation_cost_net is null or foundation_cost_net >= 0),
  constraint battery_catalog_installation_cost_check
    check (installation_cost_net is null or installation_cost_net >= 0),

  -- ── ⚠ DIE TRAGENDE BEDINGUNG DIESER TABELLE ─────────────────────────────────────────────────
  -- Aufgezählt ist GENAU das, was `packages/engine` aus einem Katalog-Eintrag liest:
  --   Simulation (helpers.ts/dispatch.ts/peak-protection.ts): Kapazität, Leistung, Wirkungsgrad
  --   ROI (roi.ts:20-22):                                     Preis + die zwei Zuschläge
  -- `hersteller`, `bezeichnung` und `kategorie` fehlen hier, weil sie bereits `not null` sind.
  -- `installation_cost_net`, `price_as_of`, `source_url`, `datasheet_url` und `control_type`
  -- fehlen, weil die Engine sie nicht liest — sie zu verlangen hiesse, das Aktivieren an einer
  -- Angabe aufzuhängen, die am Ergebnis nichts ändert.
  constraint battery_catalog_active_complete
    check (
      not active
      or (
        usable_capacity_kwh is not null
        and max_power_kw is not null
        and round_trip_efficiency is not null
        and list_price_net is not null
        and inverter_included is not null
        and requires_foundation is not null
        and (inverter_included or extra_inverter_cost_net is not null)
        and (not requires_foundation or foundation_cost_net is not null)
      )
    )
);

comment on table public.battery_catalog is
  'K1: der Batteriekatalog des Kalkulators — Geräte, Kenndaten und Netto-Listenpreise. Ersetzt '
  'perspektivisch DEMO_BATTERY_CATALOG (K3). anon/authenticated lesen ausschliesslich AKTIVE '
  'Zeilen; gepflegt wird über die admin_*_battery-Wrapper (SECURITY DEFINER, platform.is_admin). '
  'Keine Effektiv-Datierung: eine abgelegte Analyse traegt den Katalogstand als Wertkopie (B14-1).';

comment on column public.battery_catalog.active is
  'Die Grenze zwischen Entwurf und Rechengrundlage: nur aktive Zeilen sind ueberhaupt lesbar. Nur '
  'ueber public.admin_set_battery_active setzbar, und nur an einer vollstaendigen Zeile '
  '(CHECK battery_catalog_active_complete).';

comment on column public.battery_catalog.list_price_net is
  'Netto-Listenpreis des GERAETS, nicht je kWh und nicht brutto. Der Engine-Wert pricePerKwh ist '
  'list_price_net / usable_capacity_kwh und entsteht im Loader (K3). Brutto = netto x 1,2 bei der '
  'Anzeige; eine Brutto-Spalte gibt es bewusst nicht.';

comment on column public.battery_catalog.price_as_of is
  'Preisstand — an welchem Tag dieser Preis so galt. KEINE Gueltigkeit: die Tabelle historisiert '
  'nicht, ein neuer Preis ueberschreibt. Schliesst die im Report ausgewiesene Herkunfts-Luecke '
  '(apps/website/lib/pdf-report/basis.ts).';

comment on column public.battery_catalog.installation_cost_net is
  'Montage/Elektroanschluss — eine Angabe fuer die Angebotslegung. Die Engine hat dafuer KEIN Feld '
  'und rechnet sie nicht mit; deshalb auch zum Aktivieren nicht erforderlich.';

comment on column public.battery_catalog.control_type is
  'static | dynamic (BatteryCandidate.controlType). Von der Engine heute NICHT gelesen. Bleibt es '
  'leer, gilt im Loader die Konvention aus battery.ts: heim -> static, gewerbe -> dynamic.';

-- Der Lesepfad des oeffentlichen Rechners fragt nach den aktiven Zeilen einer Kategorie. Ein
-- Teilindex auf genau dieser Bedingung ist bei einem Katalog dieser Groessenordnung eher Form als
-- Notwendigkeit — er steht hier, weil die Policy dieselbe Bedingung traegt und beide zusammen
-- gelesen werden sollen.
create index battery_catalog_active_idx
  on public.battery_catalog (kategorie)
  where active;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — RLS und Rechte
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Zwei Schichten, jede fuer sich ausreichend gegen einen Schreibzugriff — wortgleich zu
-- `retail_tariffs`:
--   (a) `revoke all` -> `grant select`: Supabase vergibt auf NEUE public-Tabellen per
--       ALTER DEFAULT PRIVILEGES automatisch ALLE Tabellenrechte an anon/authenticated/service_role.
--       „Kein Schreib-Grant" ist also nicht dadurch erfuellt, dass hier keiner steht.
--   (b) RLS mit ausschliesslich einer SELECT-Policy, und die traegt `active` als Bedingung.
--
-- ⚠ `service_role` bekommt hier GAR KEIN Grant — auch kein lesendes. Der Pflegeweg laeuft ueber
-- SECURITY-DEFINER-Wrapper (TEIL 5), die als Eigentuemer laufen und keines brauchen. Ein Grant
-- „vorsichtshalber" waere ein falscher Beleg ueber diesen Weg, und der naechste Umbau naehme ihn
-- als gegeben.
alter table public.battery_catalog enable row level security;

create policy battery_catalog_public_read
  on public.battery_catalog
  for select
  to anon, authenticated
  using (active);

revoke all on table public.battery_catalog from public, anon, authenticated, service_role;

grant select on table public.battery_catalog to anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — updated_at
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Ohne Trigger stuende in der Spalte das ANLAGEdatum und saehe aus wie ein Pflegestand. Der
-- Zeitpunkt kommt aus der Uhr, nicht aus einem Parameter — dieselbe Ueberlegung wie bei
-- `confirm_retail_tariff`.
create function public.battery_catalog_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger battery_catalog_touch_updated_at
  before update on public.battery_catalog
  for each row
  execute function public.battery_catalog_touch_updated_at();

revoke all on function public.battery_catalog_touch_updated_at() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — platform.battery_purchase_prices (der Einkaufspreis)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ── ⚠ WARUM DER EINKAUFSPREIS NICHT IN `public.battery_catalog` STEHT ─────────────────────────
-- Er ist die eine Zahl dieses Katalogs, die NIEMAND ausser COOLiN sehen darf: aus Listenpreis und
-- Einkaufspreis ergibt sich die Marge, und der oeffentliche Rechner laeuft im Browser des Kunden.
-- Eine Spalte in derselben Tabelle waere ueber ein `select *` des `anon`-Clients mitgeliefert, auch
-- wenn keine Oberflaeche sie rendert — PostgREST liefert Spalten, nicht Ansichten. Eine
-- Spaltenauswahl im TypeScript-Leser naehme der naechste Umbau versehentlich zurueck.
--
-- Deshalb eine EIGENE Tabelle im `platform`-Schema: dieses Schema ist gar nicht ueber die Data API
-- exponiert. Dazu — Muster `job_runs` (B4-1) und `admin_exports` (B2-1) — RLS aktiv, KEINE Policy,
-- fuer KEINE Rolle irgendein Tabellenrecht. Erreichbar ausschliesslich ueber die Wrapper in TEIL 5.
--
-- ── DER PRIMAERSCHLUESSEL IST DIE BATTERIE ────────────────────────────────────────────────────
-- Genau ein Einkaufspreis je Geraet, kein Verlauf. Dieselbe Entscheidung wie beim Listenpreis
-- (Kopf, Punkt 5) und aus demselben Grund; ein Verlauf ohne Leser waere Ballast.
--
-- ⚠ `on delete cascade`: wird ein Geraet aus dem Katalog entfernt, geht sein Einkaufspreis mit.
-- Eine verwaiste Zeile waere ein Preis ohne Gegenstand — und nichts im System koennte sie je
-- wieder zuordnen. Ein `restrict` waere hier falsch: es machte eine Fehleingabe im Katalog
-- unloeschbar, sobald jemand einen EK eingetragen hat.
create table platform.battery_purchase_prices (
  battery_id         uuid primary key
                     references public.battery_catalog (id) on delete cascade,
  purchase_price_net numeric not null,
  as_of              date not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint battery_purchase_prices_amount_check
    check (purchase_price_net > 0)
);

comment on table platform.battery_purchase_prices is
  'K1: Einkaufspreise je Katalog-Geraet, netto. Bewusst NICHT in public.battery_catalog: aus '
  'Listen- und Einkaufspreis ergibt sich die Marge, und der oeffentliche Rechner liest den Katalog '
  'als anon. RLS aktiv, keine Policy, fuer keine Rolle ein Grant — Zugriff ausschliesslich ueber '
  'public.admin_set_battery_purchase_price und public.admin_list_battery_catalog.';

alter table platform.battery_purchase_prices enable row level security;

revoke all on table platform.battery_purchase_prices
  from public, anon, authenticated, service_role;

create trigger battery_purchase_prices_touch_updated_at
  before update on platform.battery_purchase_prices
  for each row
  execute function public.battery_catalog_touch_updated_at();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — Die Wrapper
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Alle sieben nach dem bestehenden `platform`-Muster: SECURITY DEFINER, `set search_path = ''`,
-- erste ausfuehrbare Zeile `if not platform.is_admin() then raise ... 42501`, Grant NUR an
-- `authenticated`. `service_role` bekommt ausdruecklich KEINEN — ein Katalog-Eintrag ist die
-- Entscheidung eines Menschen, und es gibt keinen maschinellen Aufrufer (der Import in K2 laeuft
-- ueber dieselben Wrapper als angemeldeter Admin).
--
-- ⚠ Die Wrapper WERFEN bei fehlender Adminrolle, statt leer zu antworten — wie admin_create_partner
-- (B16-1). Eine leere Liste waere von „es gibt keine Geraete" nicht zu unterscheiden.

-- ── admin_list_battery_catalog ──────────────────────────────────────────────────────────────────
-- Der Leseweg der Admin-Seite: ALLE Zeilen, auch die inaktiven (genau dafuer gibt es ihn — die
-- Policy in TEIL 2 gibt dem angemeldeten Client nur die aktiven).
--
-- ⚠ Der Einkaufspreis faehrt HIER mit und nicht in einem zweiten Aufruf: die Liste zeigt ihn je
-- Zeile, und zwei Abfragen koennten zwischen Katalog und Preis auseinanderlaufen (ein Geraet
-- geloescht, sein Preis noch in der zweiten Antwort). Er verlaesst dabei die Definer-Grenze nur an
-- einen geprueften Admin.
create function public.admin_list_battery_catalog(
  p_kategorie text default null,
  p_active boolean default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_list_battery_catalog: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.hersteller, r.bezeichnung), '[]'::jsonb)
    into v_rows
  from (
    select b.*,
           pp.purchase_price_net,
           pp.as_of as purchase_price_as_of
      from public.battery_catalog b
      left join platform.battery_purchase_prices pp on pp.battery_id = b.id
      -- Ein nicht uebergebener Filter filtert nicht. Die beiden Bedingungen sind die Filter der
      -- Admin-Liste (Kategorie, aktiv/inaktiv) und stehen in der ABFRAGE, damit die Oberflaeche
      -- nicht alles laden und selbst sieben muss.
     where (p_kategorie is null or b.kategorie = p_kategorie)
       and (p_active is null or b.active = p_active)
  ) r;

  return v_rows;
end;
$$;

comment on function public.admin_list_battery_catalog(text, boolean) is
  'K1: alle Katalog-Geraete samt Einkaufspreis, optional nach Kategorie und Aktiv-Status '
  'gefiltert. Liefert AUCH inaktive Zeilen — dafuer gibt es diesen Weg. WIRFT bei fehlender '
  'Adminrolle (42501). authenticated-only.';

-- ── admin_get_battery ───────────────────────────────────────────────────────────────────────────
create function public.admin_get_battery(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_get_battery: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select to_jsonb(r)
    into v_row
  from (
    select b.*,
           pp.purchase_price_net,
           pp.as_of as purchase_price_as_of
      from public.battery_catalog b
      left join platform.battery_purchase_prices pp on pp.battery_id = b.id
     where b.id = p_id
  ) r;

  -- Ein Nicht-Treffer ist hier ein STATUS und kein Fehler: er entsteht im Alltag zweier offener
  -- Browser-Fenster (das Geraet wurde inzwischen geloescht). Dieselbe Lesart wie
  -- confirm_retail_tariff.
  if v_row is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object('status', 'ok', 'battery', v_row);
end;
$$;

comment on function public.admin_get_battery(uuid) is
  'K1: ein Katalog-Geraet samt Einkaufspreis. Rueckgabe {status: ok|not_found, battery}. WIRFT bei '
  'fehlender Adminrolle (42501). authenticated-only.';

-- ── admin_create_battery ────────────────────────────────────────────────────────────────────────
--
-- ⚠ `active` ist KEIN Parameter. Eine neu angelegte Zeile ist nie sofort Rechengrundlage; das
-- Aktivieren ist ein eigener Schritt mit eigener Pruefung (admin_set_battery_active). Waere es ein
-- Parameter, liesse sich die Vollstaendigkeitspruefung in einem Zug mitnehmen — und der einzige
-- Moment, in dem jemand die Zeile bewusst freigibt, fiele weg.
create function public.admin_create_battery(
  p_kategorie text,
  p_hersteller text,
  p_bezeichnung text,
  p_memodo_id integer default null,
  p_usable_capacity_kwh numeric default null,
  p_max_power_kw numeric default null,
  p_round_trip_efficiency numeric default null,
  p_list_price_net numeric default null,
  p_inverter_included boolean default null,
  p_extra_inverter_cost_net numeric default null,
  p_requires_foundation boolean default null,
  p_foundation_cost_net numeric default null,
  p_installation_cost_net numeric default null,
  p_price_as_of date default null,
  p_source_url text default null,
  p_datasheet_url text default null,
  p_control_type text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kategorie    text := lower(nullif(btrim(p_kategorie), ''));
  v_hersteller   text := nullif(btrim(p_hersteller), '');
  v_bezeichnung  text := nullif(btrim(p_bezeichnung), '');
  v_control_type text := lower(nullif(btrim(p_control_type), ''));
  v_id           uuid;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_create_battery: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if v_kategorie is null or v_hersteller is null or v_bezeichnung is null then
    return jsonb_build_object('status', 'missing_fields');
  end if;

  if v_kategorie not in ('heim', 'gewerbe') then
    return jsonb_build_object('status', 'invalid_kategorie');
  end if;

  if v_control_type is not null and v_control_type not in ('static', 'dynamic') then
    return jsonb_build_object('status', 'invalid_control_type');
  end if;

  begin
    insert into public.battery_catalog (
      kategorie, hersteller, bezeichnung, memodo_id,
      usable_capacity_kwh, max_power_kw, round_trip_efficiency,
      list_price_net, inverter_included, extra_inverter_cost_net,
      requires_foundation, foundation_cost_net, installation_cost_net,
      price_as_of, source_url, datasheet_url, control_type, notes
    ) values (
      v_kategorie, v_hersteller, v_bezeichnung, p_memodo_id,
      p_usable_capacity_kwh, p_max_power_kw, p_round_trip_efficiency,
      p_list_price_net, p_inverter_included, p_extra_inverter_cost_net,
      p_requires_foundation, p_foundation_cost_net, p_installation_cost_net,
      p_price_as_of, nullif(btrim(p_source_url), ''), nullif(btrim(p_datasheet_url), ''),
      v_control_type, nullif(btrim(p_notes), '')
    )
    returning id into v_id;
  exception
    -- Der einzige UNIQUE der Tabelle. Die Kennung des Grosshaendlers ist absichtlich eindeutig,
    -- damit ein zweiter Importlauf (K2) dieselbe Zeile wiederfindet.
    when unique_violation then
      return jsonb_build_object('status', 'duplicate_memodo_id');
    -- Ein Wert ausserhalb der Wertebereichs-CHECKs (Kapazitaet <= 0, Wirkungsgrad > 1, negativer
    -- Zuschlag). Der CHECK bleibt die harte Grenze; hier bekommt er nur einen Namen, mit dem die
    -- Oberflaeche etwas anfangen kann.
    when check_violation then
      return jsonb_build_object('status', 'invalid_values');
  end;

  return jsonb_build_object('status', 'created', 'id', v_id);
end;
$$;

comment on function public.admin_create_battery(
  text, text, text, integer, numeric, numeric, numeric, numeric, boolean, numeric, boolean,
  numeric, numeric, date, text, text, text, text
) is
  'K1: legt ein Katalog-Geraet an — IMMER inaktiv (active ist kein Parameter). Rueckgabe {status: '
  'created|missing_fields|invalid_kategorie|invalid_control_type|duplicate_memodo_id|'
  'invalid_values, id}. WIRFT bei fehlender Adminrolle (42501). authenticated-only.';

-- ── admin_update_battery ────────────────────────────────────────────────────────────────────────
--
-- ⚠ HIER HEISST `null` LOESCHEN, NICHT „UNBERUEHRT LASSEN" — gegensaetzlich zu `capture_lead`
-- (B3-1) und aus einem klaren Grund: der Aufrufer ist ein Formular, das JEDES Feld mitschickt. Ein
-- geleertes Feld ist dort eine Aussage („der Wert stimmt nicht mehr"), und mit
-- coalesce(Bestand, neu) liesse sich eine falsche Zahl nie wieder entfernen.
--
-- `active` ist auch hier KEIN Parameter (eigener Wrapper, eigene Pruefung), und der Einkaufspreis
-- ebenso wenig — er liegt in einer anderen Tabelle und in einem anderen Schema.
create function public.admin_update_battery(
  p_id uuid,
  p_kategorie text,
  p_hersteller text,
  p_bezeichnung text,
  p_memodo_id integer default null,
  p_usable_capacity_kwh numeric default null,
  p_max_power_kw numeric default null,
  p_round_trip_efficiency numeric default null,
  p_list_price_net numeric default null,
  p_inverter_included boolean default null,
  p_extra_inverter_cost_net numeric default null,
  p_requires_foundation boolean default null,
  p_foundation_cost_net numeric default null,
  p_installation_cost_net numeric default null,
  p_price_as_of date default null,
  p_source_url text default null,
  p_datasheet_url text default null,
  p_control_type text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kategorie    text := lower(nullif(btrim(p_kategorie), ''));
  v_hersteller   text := nullif(btrim(p_hersteller), '');
  v_bezeichnung  text := nullif(btrim(p_bezeichnung), '');
  v_control_type text := lower(nullif(btrim(p_control_type), ''));
  v_count        integer;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_update_battery: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if v_kategorie is null or v_hersteller is null or v_bezeichnung is null then
    return jsonb_build_object('status', 'missing_fields');
  end if;

  if v_kategorie not in ('heim', 'gewerbe') then
    return jsonb_build_object('status', 'invalid_kategorie');
  end if;

  if v_control_type is not null and v_control_type not in ('static', 'dynamic') then
    return jsonb_build_object('status', 'invalid_control_type');
  end if;

  begin
    update public.battery_catalog set
      kategorie               = v_kategorie,
      hersteller              = v_hersteller,
      bezeichnung             = v_bezeichnung,
      memodo_id               = p_memodo_id,
      usable_capacity_kwh     = p_usable_capacity_kwh,
      max_power_kw            = p_max_power_kw,
      round_trip_efficiency   = p_round_trip_efficiency,
      list_price_net          = p_list_price_net,
      inverter_included       = p_inverter_included,
      extra_inverter_cost_net = p_extra_inverter_cost_net,
      requires_foundation     = p_requires_foundation,
      foundation_cost_net     = p_foundation_cost_net,
      installation_cost_net   = p_installation_cost_net,
      price_as_of             = p_price_as_of,
      source_url              = nullif(btrim(p_source_url), ''),
      datasheet_url           = nullif(btrim(p_datasheet_url), ''),
      control_type            = v_control_type,
      notes                   = nullif(btrim(p_notes), '')
    where id = p_id;

    get diagnostics v_count = row_count;
  exception
    when unique_violation then
      return jsonb_build_object('status', 'duplicate_memodo_id');
    -- ⚠ Faengt AUCH battery_catalog_active_complete: wer einer AKTIVEN Zeile einen Pflichtwert
    -- wegnimmt, bekommt eine Ablehnung statt einer stillen Luecke in der Rechengrundlage. Genau
    -- dafuer steht die Bedingung in der Datenbank und nicht im Formular.
    when check_violation then
      return jsonb_build_object('status', 'invalid_values');
  end;

  if v_count = 0 then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object('status', 'updated');
end;
$$;

comment on function public.admin_update_battery(
  uuid, text, text, text, integer, numeric, numeric, numeric, numeric, boolean, numeric, boolean,
  numeric, numeric, date, text, text, text, text
) is
  'K1: schreibt ein Katalog-Geraet vollstaendig neu — null LOESCHT ein Feld (Gegenteil von '
  'capture_lead; der Aufrufer ist ein Formular, das jedes Feld mitschickt). active und der '
  'Einkaufspreis sind KEINE Parameter. Rueckgabe {status: updated|not_found|missing_fields|'
  'invalid_kategorie|invalid_control_type|duplicate_memodo_id|invalid_values}. WIRFT bei fehlender '
  'Adminrolle (42501). authenticated-only.';

-- ── admin_set_battery_active ────────────────────────────────────────────────────────────────────
--
-- ⚠ DER EIGENTLICHE GRUND, WARUM DAS AKTIVIEREN EIN EIGENER WRAPPER IST: er sagt, WAS fehlt.
-- Der CHECK der Tabelle weist eine unvollstaendige Zeile ohnehin ab (23514) — aber „neue Zeile fuer
-- Relation verletzt Check-Constraint battery_catalog_active_complete" ist fuer den Menschen davor
-- keine Auskunft. Die Liste der fehlenden Felder entsteht deshalb hier, in derselben Transaktion,
-- aus derselben Bedingung.
create function public.admin_set_battery_active(p_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.battery_catalog%rowtype;
  v_missing text[] := '{}';
begin
  if not platform.is_admin() then
    raise exception 'public.admin_set_battery_active: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select * into v_row from public.battery_catalog where id = p_id for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if p_active then
    if v_row.usable_capacity_kwh is null then
      v_missing := v_missing || 'usable_capacity_kwh'::text;
    end if;
    if v_row.max_power_kw is null then
      v_missing := v_missing || 'max_power_kw'::text;
    end if;
    if v_row.round_trip_efficiency is null then
      v_missing := v_missing || 'round_trip_efficiency'::text;
    end if;
    if v_row.list_price_net is null then
      v_missing := v_missing || 'list_price_net'::text;
    end if;
    if v_row.inverter_included is null then
      v_missing := v_missing || 'inverter_included'::text;
    end if;
    if v_row.requires_foundation is null then
      v_missing := v_missing || 'requires_foundation'::text;
    end if;
    -- Die zwei BEDINGTEN Pflichtfelder — genau die zwei Zuschlaege, die roi.ts addiert. Ohne sie
    -- waere die Investition zu niedrig und die Amortisation zu gut.
    if v_row.inverter_included is false and v_row.extra_inverter_cost_net is null then
      v_missing := v_missing || 'extra_inverter_cost_net'::text;
    end if;
    if v_row.requires_foundation is true and v_row.foundation_cost_net is null then
      v_missing := v_missing || 'foundation_cost_net'::text;
    end if;

    if array_length(v_missing, 1) is not null then
      -- Ohne Schreibvorgang zurueck: eine abgelehnte Freigabe darf die bestehende Lage nicht
      -- veraendert haben.
      return jsonb_build_object('status', 'incomplete', 'missing', to_jsonb(v_missing));
    end if;
  end if;

  update public.battery_catalog set active = p_active where id = p_id;

  return jsonb_build_object('status', case when p_active then 'activated' else 'deactivated' end);
end;
$$;

comment on function public.admin_set_battery_active(uuid, boolean) is
  'K1: gibt ein Katalog-Geraet fuer den Rechner frei oder nimmt es zurueck. Beim Aktivieren wird '
  'die Vollstaendigkeit der Engine-Pflichtfelder geprueft und im Fehlerfall BENANNT (status: '
  'incomplete, missing[]); die harte Grenze bleibt der CHECK battery_catalog_active_complete, der '
  'auch fuer service_role und postgres gilt. Rueckgabe {status: activated|deactivated|incomplete|'
  'not_found}. WIRFT bei fehlender Adminrolle (42501). authenticated-only.';

-- ── admin_delete_battery ────────────────────────────────────────────────────────────────────────
--
-- ⚠ Das Loeschen vernichtet KEINE Rechnung: eine abgelegte Analyse traegt den Katalogstand als
-- Wertkopie in ihrem eingefrorenen jsonb (B14-1, „KEINE Fremdschluessel auf veraenderliche
-- Konfiguration"). Es gibt deshalb keinen Grund, eine Katalogzeile unloeschbar zu machen — und
-- einen guten, sie loeschbar zu halten: ein Probeeintrag soll wieder verschwinden koennen.
-- Der Einkaufspreis geht per `on delete cascade` mit (TEIL 4).
create function public.admin_delete_battery(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not platform.is_admin() then
    raise exception 'public.admin_delete_battery: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  delete from public.battery_catalog where id = p_id;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object('status', 'deleted');
end;
$$;

comment on function public.admin_delete_battery(uuid) is
  'K1: entfernt ein Katalog-Geraet samt seinem Einkaufspreis (on delete cascade). Abgelegte '
  'Analysen bleiben unberuehrt — sie tragen den Katalogstand als Wertkopie (B14-1). Rueckgabe '
  '{status: deleted|not_found}. WIRFT bei fehlender Adminrolle (42501). authenticated-only.';

-- ── admin_set_battery_purchase_price ────────────────────────────────────────────────────────────
--
-- ⚠ EIN Wrapper fuer Setzen UND Entfernen: ein uebergebener `null`-Preis LOESCHT den Eintrag. Bei
-- einem Datensatz aus genau zwei Angaben gibt es dafuer keine zweite Lesart, und ein eigener
-- Loesch-Wrapper waere eine weitere Funktion mit eigener Adminpruefung fuer denselben Vorgang.
create function public.admin_set_battery_purchase_price(
  p_battery_id uuid,
  p_purchase_price_net numeric default null,
  p_as_of date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_set_battery_purchase_price: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select exists(select 1 from public.battery_catalog where id = p_battery_id) into v_exists;
  if not v_exists then
    return jsonb_build_object('status', 'not_found');
  end if;

  if p_purchase_price_net is null then
    delete from platform.battery_purchase_prices where battery_id = p_battery_id;
    return jsonb_build_object('status', 'cleared');
  end if;

  if p_purchase_price_net <= 0 then
    return jsonb_build_object('status', 'invalid_values');
  end if;

  -- Der Stichtag ist Pflicht, sobald ein Preis dasteht: ein Einkaufspreis ohne Datum ist in einem
  -- Jahr nicht mehr beurteilbar, und `now()` zu nehmen hiesse zu behaupten, er sei heute erhoben
  -- worden. Dieselbe Ueberlegung wie bei `price_as_of` im Katalog.
  if p_as_of is null then
    return jsonb_build_object('status', 'missing_fields');
  end if;

  insert into platform.battery_purchase_prices (battery_id, purchase_price_net, as_of)
  values (p_battery_id, p_purchase_price_net, p_as_of)
  on conflict (battery_id) do update
    set purchase_price_net = excluded.purchase_price_net,
        as_of              = excluded.as_of;

  return jsonb_build_object('status', 'saved');
end;
$$;

comment on function public.admin_set_battery_purchase_price(uuid, numeric, date) is
  'K1: setzt den Netto-Einkaufspreis eines Katalog-Geraets oder entfernt ihn (null als Preis). '
  'Der einzige Schreibweg auf platform.battery_purchase_prices — die Tabelle hat fuer keine Rolle '
  'ein Grant. Rueckgabe {status: saved|cleared|not_found|missing_fields|invalid_values}. WIRFT bei '
  'fehlender Adminrolle (42501). authenticated-only.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 6 — Die Rechte der Wrapper
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Funktionen im `public`-Schema bekommen EXECUTE per Default an PUBLIC und ueber Supabases
-- ALTER DEFAULT PRIVILEGES zusaetzlich an anon/authenticated/service_role — dieselbe Falle wie bei
-- den Tabellen, seit T4-2 in einem Dutzend Migrationen dokumentiert. Ohne den `revoke` stuende
-- jeder dieser Wrapper jedem Browser-Client offen; SECURITY DEFINER heisst, er liefe dann auch.
-- Die Adminpruefung im Rumpf faenge das ab — aber „laeuft ins Leere" ist keine Zugangsregel.
--
-- ⚠ `service_role` bleibt bewusst OHNE Grant: es gibt keinen maschinellen Aufrufer, und ein
-- service_role-Client traegt kein JWT — `platform.is_admin()` waere dort immer falsch, der Aufruf
-- endete in einer 42501, die wie ein Fehler aussieht.
revoke all on function public.admin_list_battery_catalog(text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_get_battery(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_create_battery(
  text, text, text, integer, numeric, numeric, numeric, numeric, boolean, numeric, boolean,
  numeric, numeric, date, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_update_battery(
  uuid, text, text, text, integer, numeric, numeric, numeric, numeric, boolean, numeric, boolean,
  numeric, numeric, date, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_set_battery_active(uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_delete_battery(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_set_battery_purchase_price(uuid, numeric, date)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_list_battery_catalog(text, boolean) to authenticated;
grant execute on function public.admin_get_battery(uuid) to authenticated;
grant execute on function public.admin_create_battery(
  text, text, text, integer, numeric, numeric, numeric, numeric, boolean, numeric, boolean,
  numeric, numeric, date, text, text, text, text
) to authenticated;
grant execute on function public.admin_update_battery(
  uuid, text, text, text, integer, numeric, numeric, numeric, numeric, boolean, numeric, boolean,
  numeric, numeric, date, text, text, text, text
) to authenticated;
grant execute on function public.admin_set_battery_active(uuid, boolean) to authenticated;
grant execute on function public.admin_delete_battery(uuid) to authenticated;
grant execute on function public.admin_set_battery_purchase_price(uuid, numeric, date)
  to authenticated;
