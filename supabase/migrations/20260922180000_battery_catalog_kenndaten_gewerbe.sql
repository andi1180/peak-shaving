-- K2b-1: Kenndaten für 15 Gewerbe-Geräte (SMA, SolarEdge, Sungrow, Fox ESS, Pylontech).
--
-- ERZEUGT — nicht von Hand bearbeiten. Quelle: data/batteriekatalog/kenndaten_gewerbe.csv,
-- Generator: scripts/battery-catalog/csv-to-sql.mjs.
--
-- Jeder Wert stammt aus dem Datenblatt des Herstellers; der Weg dorthin steht als Rechenweg in
-- `notes` und die Quelle in `datasheet_url`. Was ein Datenblatt nicht hergibt, bleibt null —
-- ein geschätzter Wirkungsgrad wäre von einem belegten nicht mehr zu unterscheiden und liefe
-- anschliessend durch jede Viertelstunde der Simulation.
--
-- ⚠ DIE WHERE-BEDINGUNG IST DIE SICHERUNG: geändert wird nur eine Zeile, die noch GAR KEINE
-- Kenndaten trägt — also genau den Zustand aus K2a. Hat ein Mensch im Admin auch nur ein Feld
-- gepflegt, läuft das UPDATE an ihr vorbei. Daraus folgt zugleich die Idempotenz: ein zweiter
-- Lauf findet seine eigenen Zeilen nicht mehr und hängt den Rechenweg nicht ein zweites Mal an.
--
-- Fundament- und Installationskosten werden ausdrücklich NICHT gesetzt (nicht recherchiert).
-- Für die Geräte mit `requires_foundation = true` heisst das: `battery_catalog_active_complete`
-- lässt eine Freigabe nicht zu, solange die Fundamentkosten fehlen. Das ist gewollt.

update public.battery_catalog set
  usable_capacity_kwh     = 89,
  max_power_kw            = 30,
  round_trip_efficiency   = null,
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = false,
  datasheet_url           = 'https://manuals.sma.de/SMAStorageXLPackage/en-US/15963340683.html',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Datenblatt nennt "Energy (at 100% DoD) 89 kWh" und keine davon abweichende nutzbare Kapazitaet. Wirkungsgrad offen: SMA nennt nur "Maximum battery efficiency 98 %" (ein Maximum, kein Round-Trip) und Wechselrichter-Spitzenwirkungsgrade.'), '')
where memodo_id = 15821
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and inverter_included is null
  and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = 89,
  max_power_kw            = 50,
  round_trip_efficiency   = null,
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = false,
  datasheet_url           = 'https://manuals.sma.de/SMAStorageXLPackage/en-US/15963340683.html',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Datenblatt nennt "Energy (at 100% DoD) 89 kWh" und keine davon abweichende nutzbare Kapazitaet. Wirkungsgrad offen: SMA nennt nur "Maximum battery efficiency 98 %" (ein Maximum, kein Round-Trip) und Wechselrichter-Spitzenwirkungsgrade.'), '')
where memodo_id = 15822
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and inverter_included is null
  and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = 107,
  max_power_kw            = 30,
  round_trip_efficiency   = null,
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = true,
  datasheet_url           = 'https://manuals.sma.de/SMAStorageXLPackage/en-US/15963340683.html',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Datenblatt nennt "Energy (at 100% DoD) 107 kWh". Fundament: das Handbuch fuehrt "Requirements on the Foundation" ausschliesslich fuer die Outdoor-Ausfuehrung. Wirkungsgrad offen (nur Maximalwerte angegeben).'), '')
where memodo_id = 15823
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and inverter_included is null
  and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = 107,
  max_power_kw            = 50,
  round_trip_efficiency   = null,
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = true,
  datasheet_url           = 'https://manuals.sma.de/SMAStorageXLPackage/en-US/15963340683.html',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Datenblatt nennt "Energy (at 100% DoD) 107 kWh". Fundament: das Handbuch fuehrt "Requirements on the Foundation" ausschliesslich fuer die Outdoor-Ausfuehrung. Wirkungsgrad offen (nur Maximalwerte angegeben).'), '')
where memodo_id = 15824
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and inverter_included is null
  and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = 197,
  max_power_kw            = 50,
  round_trip_efficiency   = null,
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = false,
  datasheet_url           = 'https://manuals.sma.de/SMAStorageXLPackage/en-US/15963340683.html',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Datenblatt nennt "Energy (at 100% DoD) 197 kWh". Indoor-Ausfuehrung, daher kein Fundament. Wirkungsgrad offen (nur Maximalwerte angegeben).'), '')
where memodo_id = 15825
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and inverter_included is null
  and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = 197,
  max_power_kw            = 50,
  round_trip_efficiency   = null,
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = true,
  datasheet_url           = 'https://manuals.sma.de/SMAStorageXLPackage/en-US/15963340683.html',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Datenblatt nennt "Energy (at 100% DoD) 197 kWh". Fundament: das Handbuch fuehrt "Requirements on the Foundation" ausschliesslich fuer die Outdoor-Ausfuehrung. Wirkungsgrad offen (nur Maximalwerte angegeben).'), '')
where memodo_id = 15826
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and inverter_included is null
  and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = 92.16,
  max_power_kw            = 50,
  round_trip_efficiency   = null,
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = true,
  datasheet_url           = 'https://knowledge-center.solaredge.com/sites/kc/files/se-css-od-battery-cabinet-and-battery-inverter-datasheet-eng.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Nutzbare Kapazitaet direkt angegeben ("Usable Battery Capacity 92.16 kWh" bei 102,4 kWh gesamt). Leistung = "Rated AC Active Power Output 50 kW" (PCS050). Schrank laut Datenblatt fuer den Aussenbereich (IP54). Wirkungsgrad offen: nur "Maximum Inverter Efficiency 97.5 %", kein Round-Trip.'), '')
where memodo_id = 12650
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and inverter_included is null
  and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = 102.14,
  max_power_kw            = 49.9,
  round_trip_efficiency   = null,
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = true,
  datasheet_url           = 'https://knowledge-center.solaredge.com/sites/kc/files/se-css-od-107kwh-battery-cabinet-and-battery-inverter-datasheet-eng.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Nutzbare Kapazitaet direkt angegeben ("Usable Battery Capacity 102.14 kWh" bei 107,52 kWh gesamt). Leistung = "Rated AC Active Power Output 49.9 kW" (die 50-kW-Variante des Datenblatts, nicht 29,9 kW). Aussenschrank IP54. Wirkungsgrad offen (nur Wechselrichter-Spitzenwirkungsgrad).'), '')
where memodo_id = 15687
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and inverter_included is null
  and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = 187.15,
  max_power_kw            = 50,
  round_trip_efficiency   = null,
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = true,
  datasheet_url           = 'https://knowledge-center.solaredge.com/sites/kc/files/se-css-od_197kwh-battery-cabinet-and-battery-inverter-datasheet-eng.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Nutzbare Kapazitaet direkt angegeben ("Usable Battery Capacity 187.15 kWh" bei 197,12 kWh gesamt). Leistung = ein PCS050 mit 50 kW. Aussenschrank IP54. Wirkungsgrad offen (nur Wechselrichter-Spitzenwirkungsgrad).'), '')
where memodo_id = 15920
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and inverter_included is null
  and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = 187.15,
  max_power_kw            = 100,
  round_trip_efficiency   = null,
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = true,
  datasheet_url           = 'https://knowledge-center.solaredge.com/sites/kc/files/se-css-od_197kwh-battery-cabinet-and-battery-inverter-datasheet-eng.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Gleicher Schrank wie die 50-kW-Variante (187,15 kWh nutzbar). Leistung 100 kW = zwei PCS050 — das Datenblatt erlaubt ausdruecklich "1 or 2" Wechselrichter je 197-kWh-Schrank. Wirkungsgrad offen (nur Wechselrichter-Spitzenwirkungsgrad).'), '')
where memodo_id = 15921
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and inverter_included is null
  and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = 184.32,
  max_power_kw            = 100,
  round_trip_efficiency   = null,
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = true,
  datasheet_url           = 'https://knowledge-center.solaredge.com/sites/kc/files/se-css-od-battery-cabinet-and-battery-inverter-datasheet-eng.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Buendel aus zwei kompletten CSS-OD 102,4/50: 2 x 92,16 = 184,32 kWh nutzbar, 2 x 50 = 100 kW. Die Verdopplung stuetzt sich auf den Artikelnamen ("2x") und den Hinweis "Bundle 2 Einheiten", nicht auf ein eigenes Datenblatt. Wirkungsgrad offen (nur Wechselrichter-Spitzenwirkungsgrad).'), '')
where memodo_id = 16259
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and inverter_included is null
  and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = 215,
  max_power_kw            = 100,
  round_trip_efficiency   = 0.89,
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = true,
  datasheet_url           = 'https://www.fox-ess.com/Public/Uploads/uploadfile/files/20260612/ENGMAXDatasheetV1.620260529.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Nutzbar = 215 kWh Systemkapazitaet x DoD 0-100 % = 215 kWh. Leistung = "Rated Output Power 100 kW" (nicht die 110 kW Spitzenleistung). Round-Trip ">89 %" steht als Systemwert unter GENERAL DATA, konservativ als 0,89 uebernommen. Container fuer den Aussenbereich.'), '')
where memodo_id = 12956
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and inverter_included is null
  and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = 254.8,
  max_power_kw            = 125,
  round_trip_efficiency   = 0.931,
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = null,
  datasheet_url           = 'https://pylonwebs3.s3.amazonaws.com/upload/2024/09/26/OPTIM%20US%20L260-OMNI_20240926105739A032.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Nutzbar = 260 kWh Nennkapazitaet x 98 % DoD = 254,8 kWh. Leistung = "Rated AC Power 125 kW". Wirkungsgrad = Batterie-Round-Trip >95 % x CEC-Wirkungsgrad des PCS 98 % = 0,931 — beide Faktoren sind Grenzwerte, der Wert ist damit eine Obergrenze und enthaelt nur EINEN Umrichterdurchgang. Aufstellungsart im Datenblatt nicht benannt, daher kein Fundament-Urteil.'), '')
where memodo_id = 14238
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and inverter_included is null
  and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = null,
  max_power_kw            = 110,
  round_trip_efficiency   = null,
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = null,
  datasheet_url           = 'https://ger.sungrowpower.com/upload/file/20241108/EN_DS_ST225kWh-110kW-2h_PowerStack_Datasheet.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Leistung = "Nominal power 110 kW". Kapazitaet offen: das Datenblatt nennt 229 kWh Nennkapazitaet, aber keine Entladetiefe. Wirkungsgrad offen: nur PCS-Spitzenwirkungsgrad. Aufstellungsart nicht benannt.'), '')
where memodo_id = 12957
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and inverter_included is null
  and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = 257,
  max_power_kw            = 125,
  round_trip_efficiency   = null,
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = null,
  datasheet_url           = 'https://www.sungrowpower.com/en/products/c-i-energy-storage-system/st255cs-2h',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Nutzbar = 257 kWh Nennkapazitaet x "Depth of charge and discharge 0 % - 100 %" = 257 kWh. Leistung = "Nominal power 125 kW". Wirkungsgrad offen: nur PCS-Spitzenwirkungsgrad. Aufstellungsart nicht benannt.'), '')
where memodo_id = 15106
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and inverter_included is null
  and requires_foundation is null;

-- Freigabe — ausschliesslich für Zeilen, die ALLE Engine-Pflichtfelder tragen. Die Bedingung ist
-- wortgleich der CHECK `battery_catalog_active_complete`: was hier nicht durchkommt, würde beim
-- Setzen von `active` ohnehin abgewiesen. Die Aufzählung steht hier zum zweiten Mal, weil eine
-- Migration, die an ihrem eigenen CHECK scheitert, die Bedingung nicht mehr erklären kann.
update public.battery_catalog set active = true
where kategorie = 'gewerbe'
  and not active
  and usable_capacity_kwh is not null
  and max_power_kw is not null
  and round_trip_efficiency is not null
  and list_price_net is not null
  and inverter_included is not null
  and requires_foundation is not null
  and (inverter_included or extra_inverter_cost_net is not null)
  and (not requires_foundation or foundation_cost_net is not null);
