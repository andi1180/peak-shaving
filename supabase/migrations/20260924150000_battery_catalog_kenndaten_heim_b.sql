-- H2-B: Kenndaten und Freigabe für 15 Heimgeräte (Sungrow SBR, GoodWe Lynx Home D,
-- Fox ESS EQ3300, Pylontech Force H3, E3/DC one, SolarEdge Home Battery HV).
--
-- ERZEUGT — nicht von Hand bearbeiten. Quelle: data/batteriekatalog/kenndaten_heim_b.csv,
-- Generator: scripts/battery-catalog/csv-to-sql.mjs.
--
-- `max_power_kw` ist die Leistung des SPEICHERS laut Blatt; die Begrenzung durch den in H1
-- zugeordneten Wechselrichter-Baustein rechnet der Loader (min(Speicher, Wechselrichter)).
-- Ausnahme E3/DC one: Umrichter eingebaut, kein Baustein — dort ist es die AC-Nennleistung des
-- Systems laut Blatt. Kein Blatt nennt einen System-Round-Trip — alle tragen 0,88 als Annahme.
--
-- ⚠ DIE WHERE-BEDINGUNG IST DIE SICHERUNG: geändert wird nur eine Zeile, deren Kenndatenfelder
-- noch ALLE leer sind. Hat ein Mensch im Admin gepflegt, läuft das UPDATE vorbei; daraus folgt
-- zugleich die Idempotenz.

update public.battery_catalog set
  usable_capacity_kwh   = 6.4,
  max_power_kw          = 3.84,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://uk.sungrowpower.com/upload/file/20240827/EN_DS_SBR064_SBR096_SBR128_SBR160_SBR192_SBR224_SBR256_Datasheet.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-B: Datenblatt nennt "Energy (useable) 6.4 kWh" direkt (100 % DoD, 0,2C). Leistung = Nennspannung 128 V x "Max. charging/discharging current: continuous 30 A" = 3,84 kW (Blatt nennt keinen kW-Wert). Blatt-Fussnote: am Sungrow-SHRT-Wechselrichter nur 20 A (2,56 kW) - der H1-Baustein ist kein SHRT. Wirkungsgrad 0,88 angenommen: Blatt nennt keinen Wirkungsgrad. Bodenstapel IP55 indoor/outdoor, kein Outdoor-Schrank.'), '')
where memodo_id = 12659
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 9.6,
  max_power_kw          = 5.76,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://uk.sungrowpower.com/upload/file/20240827/EN_DS_SBR064_SBR096_SBR128_SBR160_SBR192_SBR224_SBR256_Datasheet.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-B: Datenblatt nennt "Energy (useable) 9.6 kWh" direkt (100 % DoD, 0,2C). Leistung = Nennspannung 192 V x "Max. charging/discharging current: continuous 30 A" = 5,76 kW (Blatt nennt keinen kW-Wert). Wirkungsgrad 0,88 angenommen: Blatt nennt keinen Wirkungsgrad. Bodenstapel IP55 indoor/outdoor, kein Outdoor-Schrank.'), '')
where memodo_id = 6765
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 16,
  max_power_kw          = 9.6,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://uk.sungrowpower.com/upload/file/20240827/EN_DS_SBR064_SBR096_SBR128_SBR160_SBR192_SBR224_SBR256_Datasheet.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-B: Datenblatt nennt "Energy (useable) 16 kWh" direkt (100 % DoD, 0,2C). Leistung = Nennspannung 320 V x "Max. charging/discharging current: continuous 30 A" = 9,6 kW (Blatt nennt keinen kW-Wert). Wirkungsgrad 0,88 angenommen: Blatt nennt keinen Wirkungsgrad. Bodenstapel IP55 indoor/outdoor, kein Outdoor-Schrank.'), '')
where memodo_id = 6769
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 5,
  max_power_kw          = 3,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://fr.goodwe.com/Ftp/EN/Downloads/Datasheet/GW_Lynx-D_Datasheet-EN.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-B: Datenblatt (ein Modul LX D5.0-10) nennt "Usable Energy 5 kWh" (100 % DoD, 0,2C) und "Nominal Power 3 kW" direkt (Handbuch: "Nominal Charge/Discharge Power 3 kW"). Spitzenwert "5 kW, 10s" nicht verwendet. Wirkungsgrad 0,88 angenommen: weder Blatt noch Handbuch nennen einen Wirkungsgrad. Boden gestapelt/Wand IP66, kein Outdoor-Schrank.'), '')
where memodo_id = 12789
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 10,
  max_power_kw          = null,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://fr.goodwe.com/Ftp/EN/Downloads/Datasheet/GW_Lynx-D_Datasheet-EN.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-B: Turm aus 2 Modulen LX D5.0-10. Nutzbare Energie 2 x 5 kWh = 10 kWh laut Handbuch ("Each battery has a usable energy of 5kWh, and the total capacity of n+m batteries is n+m multiply by 5kWh"). LEISTUNG BEWUSST LEER: kein offizielles GoodWe-Dokument (Datenblatt EN/DE/EMEA, Handbuch, Kompatibilitätsliste, ET-Systemhandbuch, Produktseite) nennt eine Leistung für mehrere Module, nur 3 kW je Modul - eine Hochrechnung wäre eine Schätzung. Die Zeile bleibt Entwurf, bis ein belegter Wert vorliegt. Wirkungsgrad 0,88 angenommen: kein Wirkungsgrad genannt. Boden gestapelt/Wand IP66, kein Outdoor-Schrank.'), '')
where memodo_id = 13061
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 15,
  max_power_kw          = null,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://fr.goodwe.com/Ftp/EN/Downloads/Datasheet/GW_Lynx-D_Datasheet-EN.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-B: Turm aus 3 Modulen LX D5.0-10. Nutzbare Energie 3 x 5 kWh = 15 kWh laut Handbuch ("Each battery has a usable energy of 5kWh, and the total capacity of n+m batteries is n+m multiply by 5kWh"). LEISTUNG BEWUSST LEER: kein offizielles GoodWe-Dokument (Datenblatt EN/DE/EMEA, Handbuch, Kompatibilitätsliste, ET-Systemhandbuch, Produktseite) nennt eine Leistung für mehrere Module, nur 3 kW je Modul - eine Hochrechnung wäre eine Schätzung. Die Zeile bleibt Entwurf, bis ein belegter Wert vorliegt. Wirkungsgrad 0,88 angenommen: kein Wirkungsgrad genannt. Boden gestapelt/Wand IP66, kein Outdoor-Schrank.'), '')
where memodo_id = 13063
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 5.76,
  max_power_kw          = 6.4,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://www.fox-ess.com/wp-content/uploads/2024/10/EN-EQ3300-Datasheet-V1.2-8.15.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-B: Blatt (Spalte EQ3300-L2 = 1 Master + 1 Slave) nennt keine nutzbare Energie, nur "Nominal Capacity 6.4 kWh" und "Depth of discharge 90 %" - nutzbar = 6,4 x 0,9 = 5,76 kWh. Leistung = Nennspannung 128 V x "Max. Charge/Discharge Current 50 A" = 6,4 kW (Spitze "Peak Discharge Current 65 A @60sec" nicht verwendet, "Recommend Discharge Current 25 A" ergäbe 3,2 kW). Wirkungsgrad 0,88 angenommen: Blatt nennt nur "Battery Pack Round-Trip Efficiency >95 %" (Batterie/DC). Stehend outdoor/indoor IP65, kein Outdoor-Schrank.'), '')
where memodo_id = 14468
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 8.64,
  max_power_kw          = 9.6,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://www.fox-ess.com/wp-content/uploads/2024/10/EN-EQ3300-Datasheet-V1.2-8.15.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-B: Blatt (Spalte EQ3300-L3 = 1 Master + 2 Slave) nennt keine nutzbare Energie, nur "Nominal Capacity 9.6 kWh" und "Depth of discharge 90 %" - nutzbar = 9,6 x 0,9 = 8,64 kWh. Leistung = Nennspannung 192 V x "Max. Charge/Discharge Current 50 A" = 9,6 kW (Spitze "Peak Discharge Current 65 A @60sec" nicht verwendet, "Recommend Discharge Current 25 A" ergäbe 4,8 kW). Wirkungsgrad 0,88 angenommen: Blatt nennt nur "Battery Pack Round-Trip Efficiency >95 %" (Batterie/DC). Stehend outdoor/indoor IP65, kein Outdoor-Schrank.'), '')
where memodo_id = 14529
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 14.4,
  max_power_kw          = 16,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://www.fox-ess.com/wp-content/uploads/2024/10/EN-EQ3300-Datasheet-V1.2-8.15.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-B: Blatt (Spalte EQ3300-L5 = 1 Master + 4 Slave) nennt keine nutzbare Energie, nur "Nominal Capacity 16.0 kWh" und "Depth of discharge 90 %" - nutzbar = 16,0 x 0,9 = 14,4 kWh. Leistung = Nennspannung 320 V x "Max. Charge/Discharge Current 50 A" = 16 kW (Spitze "Peak Discharge Current 65 A @60sec" nicht verwendet, "Recommend Discharge Current 25 A" ergäbe 8 kW). Wirkungsgrad 0,88 angenommen: Blatt nennt nur "Battery Pack Round-Trip Efficiency >95 %" (Batterie/DC). Stehend outdoor/indoor IP65, kein Outdoor-Schrank.'), '')
where memodo_id = 14532
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 9.69,
  max_power_kw          = 10.24,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://pylonwebs3.s3.amazonaws.com/upload/2024/09/26/Force-H3_20240926105617A025.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-B: Datenblatt (2 Module) nennt "Usable Capacity 9.69 kWh" direkt (Systemkapazität 10.24 kWh, DoD 95 %). Das australische Blatt V0.2 (10/2025) nennt 10,24 kWh bei 100 % DoD - der niedrigere Wert ist übernommen. Leistung = "Battery System Voltage 204.8 V" x "Charge/Discharge (Normal) 50 A" = 10,24 kW (Spitze "55 A @15MIN" nicht verwendet, australisches Blatt nennt "Rated DC power 10.24 kW" direkt). Wirkungsgrad 0,88 angenommen: nur das australische Blatt nennt "Efficiency 96 % at 0.5C" (Batterie/DC). Stapel mit Bodenplatte IP55, kein Outdoor-Schrank.'), '')
where memodo_id = 13572
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 14.73,
  max_power_kw          = 15.36,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://pylonwebs3.s3.amazonaws.com/upload/2024/09/26/Force-H3_20240926105617A025.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-B: Datenblatt (3 Module) nennt "Usable Capacity 14.73 kWh" direkt (Systemkapazität 15.36 kWh, DoD 95 %). Das australische Blatt V0.2 (10/2025) nennt 15,36 kWh bei 100 % DoD - der niedrigere Wert ist übernommen. Leistung = "Battery System Voltage 307.2 V" x "Charge/Discharge (Normal) 50 A" = 15,36 kW (Spitze "55 A @15MIN" nicht verwendet, australisches Blatt nennt "Rated DC power 15.36 kW" direkt). Wirkungsgrad 0,88 angenommen: nur das australische Blatt nennt "Efficiency 96 % at 0.5C" (Batterie/DC). Stapel mit Bodenplatte IP55, kein Outdoor-Schrank.'), '')
where memodo_id = 13573
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 5.5,
  max_power_kw          = 6,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://www.e3dc.com/wp-data/uploads/2025/10/E3DC_Technisches-Datenblatt_one.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-B: Datenblatt (Stand 10.11.2025, Spalte one 6) nennt "Nutzbare Batteriekapazität 5,5 kWh" direkt. Umrichter eingebaut, kein Baustein: Leistung = "Nennleistung Laden / Entladen 6 kW" (Fussnote: AC-Ladeleistung maximal die Nennleistung des Batteriesystems), nicht die Wechselrichtergrenze "Max. AC-Nennleistung 12.000 W". Wirkungsgrad 0,88 angenommen: Blatt nennt nur "Max. Systemwirkungsgrad inkl. Batterie >95 %" - ein Maximalwert ohne Round-Trip-Angabe - und "Wirkungsgrad PV-Wechselrichter EU >98 %" (PV zu AC). IP65, kein Fundament genannt.'), '')
where memodo_id = 15713
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 8.7,
  max_power_kw          = 9,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://www.e3dc.com/wp-data/uploads/2025/10/E3DC_Technisches-Datenblatt_one.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-B: Datenblatt (Stand 10.11.2025, Spalte one 9) nennt "Nutzbare Batteriekapazität 8,7 kWh" direkt. Umrichter eingebaut, kein Baustein: Leistung = "Nennleistung Laden / Entladen 9 kW" (Fussnote: AC-Ladeleistung maximal die Nennleistung des Batteriesystems), nicht die Wechselrichtergrenze "Max. AC-Nennleistung 12.000 W". Wirkungsgrad 0,88 angenommen: Blatt nennt nur "Max. Systemwirkungsgrad inkl. Batterie >95 %" - ein Maximalwert ohne Round-Trip-Angabe - und "Wirkungsgrad PV-Wechselrichter EU >98 %" (PV zu AC). IP65, kein Fundament genannt.'), '')
where memodo_id = 15744
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 11.8,
  max_power_kw          = 12,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://www.e3dc.com/wp-data/uploads/2025/10/E3DC_Technisches-Datenblatt_one.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-B: Datenblatt (Stand 10.11.2025, Spalte one 12) nennt "Nutzbare Batteriekapazität 11,8 kWh" direkt. Umrichter eingebaut, kein Baustein: Leistung = "Nennleistung Laden / Entladen 12 kW" (Fussnote: AC-Ladeleistung maximal die Nennleistung des Batteriesystems) = zugleich "Max. AC-Nennleistung 12.000 W". Wirkungsgrad 0,88 angenommen: Blatt nennt nur "Max. Systemwirkungsgrad inkl. Batterie >95 %" - ein Maximalwert ohne Round-Trip-Angabe - und "Wirkungsgrad PV-Wechselrichter EU >98 %" (PV zu AC). IP65, kein Fundament genannt.'), '')
where memodo_id = 15745
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;

update public.battery_catalog set
  usable_capacity_kwh   = 9.7,
  max_power_kw          = 5,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  requires_foundation   = false,
  datasheet_url         = 'https://knowledge-center.solaredge.com/sites/kc/files/se-solaredge-home-battery-400v-datasheet-eng.pdf',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'H2-B: Datenblatt (BAT-10K1P, DS-000164-EU vom 09.07.2024) nennt "Usable Energy (100% depth of discharge) 9700 Wh" und "Continuous Output Power 5000 W" direkt (Fussnote: gilt für Laden und Entladen, Spitze "7500 W for 10 seconds" nicht verwendet). Wirkungsgrad 0,88 angenommen: Blatt nennt nur "Peak Roundtrip Efficiency 94.5 %" - Spitzenwert am Batteriegerät ohne Angabe der Messebene. Boden (Standfuss) oder Wand IP55, kein Outdoor-Schrank. Herstellerserver liefert die Datei nur mit Browser-Abfrage, gelesen über die unveränderte Archivkopie derselben URL.'), '')
where memodo_id = 6598
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
    raise notice 'H2-B: kein Admin-Konto gefunden — die Freigaben unterbleiben.';
    return;
  end if;

  -- NUR die JWT-Angabe, KEIN Rollenwechsel (Begründung im Kopf des K1b-DO-Blocks).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  foreach v_memodo in array array[12659, 6765, 6769, 12789, 13061, 13063, 14468, 14529, 14532, 13572, 13573, 15713, 15744, 15745, 6598] loop
    select * into v_row from public.battery_catalog where memodo_id = v_memodo and kategorie = 'heim';
    continue when v_row.id is null or v_row.active;

    v_result := public.admin_set_battery_active(v_row.id, true);
    if v_result->>'status' <> 'activated' then
      raise notice 'H2-B: memodo_id % bleibt Entwurf: %', v_memodo, v_result;
    end if;
  end loop;
end $$;
