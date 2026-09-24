-- H2-A: Kenndaten und Freigabe für 12 Heimgeräte (Fronius Reserva, SMA Home Storage,
-- BYD Battery-Box HVB, KOSTAL HELIVOR HV).
--
-- ERZEUGT — nicht von Hand bearbeiten. Quelle: data/batteriekatalog/kenndaten_heim_a.csv,
-- Generator: scripts/battery-catalog/csv-to-sql.mjs.
--
-- `max_power_kw` ist die Leistung des SPEICHERS laut Blatt; die Begrenzung durch den in H1
-- zugeordneten Wechselrichter-Baustein rechnet der Loader (min(Speicher, Wechselrichter)).
-- Kein Blatt nennt einen System-Round-Trip — alle tragen 0,88 als Annahme (K2c-Regel).
--
-- ⚠ DIE WHERE-BEDINGUNG IST DIE SICHERUNG: geändert wird nur eine Zeile, deren Kenndatenfelder
-- noch ALLE leer sind. Hat ein Mensch im Admin gepflegt, läuft das UPDATE vorbei; daraus folgt
-- zugleich die Idempotenz.

update public.battery_catalog set
  usable_capacity_kwh   = 6.31,
  max_power_kw          = 6.55,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://www.fronius.com/en/~/downloads/Solar%20Energy/Datasheets/SE_DS_Fronius_Reserva_EN.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-A: Datenblatt nennt "Usable energy 6.31 kWh" direkt. Leistung "Maximum charge/discharge power 6.55 kW" (einziger Leistungswert, kein getrennter Spitzenwert, = Nennspannung 204,8 V x max. Ausgangsstrom 32 A). Wirkungsgrad 0,88 angenommen: Blatt nennt nur "Battery efficiency 95 %" (Batterie/DC, 0,2C) - kein System-Round-Trip. Installation "Indoor and protected outdoor areas", kein Outdoor-Schrank.'), '')
where memodo_id = 13189
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 9.47,
  max_power_kw          = 9.83,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://www.fronius.com/en/~/downloads/Solar%20Energy/Datasheets/SE_DS_Fronius_Reserva_EN.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-A: Datenblatt nennt "Usable energy 9.47 kWh" direkt. Leistung "Maximum charge/discharge power 9.83 kW" (einziger Leistungswert, kein getrennter Spitzenwert, = Nennspannung 307,2 V x max. Ausgangsstrom 32 A). Wirkungsgrad 0,88 angenommen: Blatt nennt nur "Battery efficiency 95 %" (Batterie/DC, 0,2C) - kein System-Round-Trip. Installation "Indoor and protected outdoor areas", kein Outdoor-Schrank.'), '')
where memodo_id = 13190
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 15.79,
  max_power_kw          = 16.38,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://www.fronius.com/en/~/downloads/Solar%20Energy/Datasheets/SE_DS_Fronius_Reserva_EN.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-A: Datenblatt nennt "Usable energy 15.79 kWh" direkt. Leistung "Maximum charge/discharge power 16.38 kW" (einziger Leistungswert, kein getrennter Spitzenwert, = Nennspannung 512 V x max. Ausgangsstrom 32 A). Wirkungsgrad 0,88 angenommen: Blatt nennt nur "Battery efficiency 95 %" (Batterie/DC, 0,2C) - kein System-Round-Trip. Installation "Indoor and protected outdoor areas", kein Outdoor-Schrank.'), '')
where memodo_id = 13196
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 6.56,
  max_power_kw          = 6.912,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://files.sma.de/downloads/HS-BM-10-DS-en-16.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-A: Datenblatt nennt "Usable energy capacity 6.56 kWh" direkt (100 % DoD, 0,2C). Leistung = Nennspannung 192 V x "Max. charging / discharging current 36 A" = 6,912 kW (Blatt nennt keinen kW-Wert und keinen getrennten Spitzenstrom). Wirkungsgrad 0,88 angenommen: Blatt nennt nur "Battery efficiency 94.5 %" (Batterie/DC) - kein System-Round-Trip. Montage Boden/Wand, kein Outdoor-Schrank.'), '')
where memodo_id = 10522
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 9.84,
  max_power_kw          = 10.368,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://files.sma.de/downloads/HS-BM-10-DS-en-16.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-A: Datenblatt nennt "Usable energy capacity 9.84 kWh" direkt (100 % DoD, 0,2C). Leistung = Nennspannung 288 V x "Max. charging / discharging current 36 A" = 10,368 kW (Blatt nennt keinen kW-Wert und keinen getrennten Spitzenstrom). Wirkungsgrad 0,88 angenommen: Blatt nennt nur "Battery efficiency 94.5 %" (Batterie/DC) - kein System-Round-Trip. Montage Boden/Wand, kein Outdoor-Schrank.'), '')
where memodo_id = 10523
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 16.4,
  max_power_kw          = 17.28,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://files.sma.de/downloads/HS-BM-10-DS-en-16.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-A: Datenblatt nennt "Usable energy capacity 16.40 kWh" direkt (100 % DoD, 0,2C). Leistung = Nennspannung 480 V x "Max. charging / discharging current 36 A" = 17,28 kW (Blatt nennt keinen kW-Wert und keinen getrennten Spitzenstrom). Wirkungsgrad 0,88 angenommen: Blatt nennt nur "Battery efficiency 94.5 %" (Batterie/DC) - kein System-Round-Trip. Montage Boden/Wand, kein Outdoor-Schrank.'), '')
where memodo_id = 10525
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 5.94,
  max_power_kw          = 5.12,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://www.bydenergy.com/material/energy_stroage/serviceandsupport/downloadcenter/pdf/pl/hvb/datasheet/Datasheet_Battery-Box%20HVB_V1.5_EN.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-A: Datenblatt nennt "Usable Energy 5.94 kWh" direkt (DC, 100 % DoD, 0,2C). Leistung = Nennspannung 102,4 V x "Max Output Current 50 A" = 5,12 kW (Spitzenstrom 98 A fuer 15 s nicht verwendet). Wirkungsgrad 0,88 angenommen: "Round-trip Efficiency >= 95 %" ist ein Batterie-/DC-Wert ohne Umrichterdurchgang - kein System-Round-Trip. "Floor installation", kein Outdoor-Schrank.'), '')
where memodo_id = 14144
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 11.88,
  max_power_kw          = 10.24,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://www.bydenergy.com/material/energy_stroage/serviceandsupport/downloadcenter/pdf/pl/hvb/datasheet/Datasheet_Battery-Box%20HVB_V1.5_EN.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-A: Datenblatt nennt "Usable Energy 11.88 kWh" direkt (DC, 100 % DoD, 0,2C). Leistung = Nennspannung 204,8 V x "Max Output Current 50 A" = 10,24 kW (Spitzenstrom 98 A fuer 15 s nicht verwendet). Wirkungsgrad 0,88 angenommen: "Round-trip Efficiency >= 95 %" ist ein Batterie-/DC-Wert ohne Umrichterdurchgang - kein System-Round-Trip. "Floor installation", kein Outdoor-Schrank.'), '')
where memodo_id = 14147
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 14.85,
  max_power_kw          = 12.8,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://www.bydenergy.com/material/energy_stroage/serviceandsupport/downloadcenter/pdf/pl/hvb/datasheet/Datasheet_Battery-Box%20HVB_V1.5_EN.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-A: Datenblatt nennt "Usable Energy 14.85 kWh" direkt (DC, 100 % DoD, 0,2C). Leistung = Nennspannung 256 V x "Max Output Current 50 A" = 12,8 kW (Spitzenstrom 98 A fuer 15 s nicht verwendet). Wirkungsgrad 0,88 angenommen: "Round-trip Efficiency >= 95 %" ist ein Batterie-/DC-Wert ohne Umrichterdurchgang - kein System-Round-Trip. "Floor installation", kein Outdoor-Schrank.'), '')
where memodo_id = 14148
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 6.1,
  max_power_kw          = 6.4,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://www.kostal-solar-electric.com/fileadmin/downloadcenter/kse/DB/HELIVOR/DB_HELIVOR-HV_de.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-A: Datenblatt nennt zwei nutzbare Kapazitaeten, "100% DoD 6,4 kWh" und "95% DoD 6,1 kWh" - der niedrigere Wert ist uebernommen. Leistung = Nennspannung 128 V x "Max. Lade-/Entladestrom Batteriesystem 50 A" = 6,4 kW (Peak 65 A fuer 5 s nicht verwendet). Wirkungsgrad 0,88 angenommen: "Zykluswirkungsgrad >= 96 %" ist ein Batteriewert ohne Umrichterdurchgang - kein System-Round-Trip. Innen- und Aussenbereich (IP65), kein Outdoor-Schrank.'), '')
where memodo_id = 14483
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 9.1,
  max_power_kw          = 9.6,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://www.kostal-solar-electric.com/fileadmin/downloadcenter/kse/DB/HELIVOR/DB_HELIVOR-HV_de.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-A: Datenblatt nennt zwei nutzbare Kapazitaeten, "100% DoD 9,6 kWh" und "95% DoD 9,1 kWh" - der niedrigere Wert ist uebernommen. Leistung = Nennspannung 192 V x "Max. Lade-/Entladestrom Batteriesystem 50 A" = 9,6 kW (Peak 65 A fuer 5 s nicht verwendet). Wirkungsgrad 0,88 angenommen: "Zykluswirkungsgrad >= 96 %" ist ein Batteriewert ohne Umrichterdurchgang - kein System-Round-Trip. Innen- und Aussenbereich (IP65), kein Outdoor-Schrank.'), '')
where memodo_id = 14484
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 15.2,
  max_power_kw          = 16,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://www.kostal-solar-electric.com/fileadmin/downloadcenter/kse/DB/HELIVOR/DB_HELIVOR-HV_de.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-A: Datenblatt nennt zwei nutzbare Kapazitaeten, "100% DoD 16,0 kWh" und "95% DoD 15,2 kWh" - der niedrigere Wert ist uebernommen. Leistung = Nennspannung 320 V x "Max. Lade-/Entladestrom Batteriesystem 50 A" = 16,0 kW (Peak 65 A fuer 5 s nicht verwendet). Wirkungsgrad 0,88 angenommen: "Zykluswirkungsgrad >= 96 %" ist ein Batteriewert ohne Umrichterdurchgang - kein System-Round-Trip. Innen- und Aussenbereich (IP65), kein Outdoor-Schrank.'), '')
where memodo_id = 14486
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

-- Freigabe über denselben Wrapper wie die Oberfläche (samt Bausteinprüfung). Eine unvollständige
-- Zeile bleibt Entwurf und wird gemeldet, statt die Migration abzubrechen.
do $$
declare
  v_admin  uuid;
  v_row    public.battery_catalog%rowtype;
  v_result jsonb;
  v_memodo int;
begin
  select user_id into v_admin from platform.user_roles where role = 'admin' limit 1;
  if v_admin is null then
    raise notice 'H2-A: kein Admin-Konto gefunden — die Freigaben unterbleiben.';
    return;
  end if;

  -- NUR die JWT-Angabe, KEIN Rollenwechsel (Begründung im Kopf des K1b-DO-Blocks).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  foreach v_memodo in array array[13189, 13190, 13196, 10522, 10523, 10525, 14144, 14147, 14148, 14483, 14484, 14486] loop
    select * into v_row from public.battery_catalog where memodo_id = v_memodo and kategorie = 'heim';
    continue when v_row.id is null or v_row.active;

    v_result := public.admin_set_battery_active(v_row.id, true);
    if v_result->>'status' <> 'activated' then
      raise notice 'H2-A: memodo_id % bleibt Entwurf: %', v_memodo, v_result;
    end if;
  end loop;
end $$;
