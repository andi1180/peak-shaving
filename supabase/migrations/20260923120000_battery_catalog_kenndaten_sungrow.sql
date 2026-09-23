-- K2b-2: Kenndaten für die vier verbliebenen Sungrow-Gewerbegeräte.
--
-- Quelle sind vier Datenblätter, die lokal unter `data/batteriekatalog/datenblaetter/` liegen und
-- für die es keine belastbare öffentliche URL gibt; `datasheet_url` trägt deshalb den Dateinamen
-- statt eines Links. Von Hand geschrieben (nicht aus `kenndaten_gewerbe.csv` erzeugt wie K2b-1).
--
-- Feldregeln unverändert aus K2b-1/K2c: nutzbare Kapazität nur aus Nennkapazität × Entladetiefe,
-- wenn BEIDE im Datenblatt stehen; `round_trip_efficiency` nur dann `rte_source = 'datenblatt'`,
-- wenn der Hersteller einen System-/AC-Round-Trip nennt — sonst 0,88 als gekennzeichnete Annahme.
-- Keiner der vier Hersteller nennt hier einen Round-Trip; alle vier bekommen die Annahme.
--
-- ⚠ DIE WHERE-BEDINGUNG IST DIE SICHERUNG (wie K2b-1): geändert wird nur eine Zeile, die den
-- jeweiligen Wert noch gar nicht trägt. Hat ein Mensch im Admin gepflegt, läuft das UPDATE vorbei;
-- daraus folgt zugleich die Idempotenz.
--
-- Fundament- und Installationspreise werden ausdrücklich NICHT gesetzt.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 14591 — Sungrow PowerStack ST510kWh-125kW-4h  (Datenblatt ST510CS-4H, Version 2)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
update public.battery_catalog set
  usable_capacity_kwh     = 514,
  max_power_kw            = 125,
  round_trip_efficiency   = 0.88,
  rte_source              = 'annahme',
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = true,
  datasheet_url           = 'data/batteriekatalog/datenblaetter/Sungrow PowerStack ST510CS-4h_Datasheet.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Nutzbar = 514 kWh Nennkapazitaet x "Depth of charge and discharge 0 % ~ 100 %" = 514 kWh; der Modellname rundet auf 510. Leistung = "Nominal power 125 kW" (AC, On-Grid). Wirkungsgrad 0,88 als Annahme: das Datenblatt nennt nur "DC/AC power converter unit features a high efficiency of up to 98.5 %" — ein Wechselrichter-Spitzenwert, kein Round-Trip. Fundament: IP55-Aussenschrank, 5300 kg, "Cabinets can be installed side by side".'), '')
where memodo_id = 14591
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and inverter_included is null
  and requires_foundation is null;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 15670 — Sungrow PowerKeeper ST250CF + SH125CX
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Ein Paket aus zwei Geräten mit zwei Datenblättern. Die Leistung ist das Minimum beider Seiten;
-- hier bindet die Batterie (0,5 P), nicht der Wechselrichter.
--
-- ⚠ `requires_foundation` bleibt LEER. Das Datenblatt nennt die Aufstellungsart nicht: es sagt
-- "Floor-standing" und beschreibt mit IP66/C5/50 cm Überflutung eine aussentaugliche Ausführung,
-- aber nicht, ob das Gerät im Freien steht. Ein geratenes "nein" liesse die Fundamentkosten aus
-- der Investition fallen und machte die Amortisation still zu gut — die K2b-1-Präzedenz bei
-- unklarer Aufstellungsart ist deshalb null. Folge: die Zeile bleibt bis zu einem Urteil gesperrt.
update public.battery_catalog set
  usable_capacity_kwh     = 249.6,
  max_power_kw            = 124.8,
  round_trip_efficiency   = 0.88,
  rte_source              = 'annahme',
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  datasheet_url           = 'data/batteriekatalog/datenblaetter/Sungrow ST050-250CF.pdf + Sungrow SH 125 CX.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Nutzbar = 249,6 kWh Systemkapazitaet (ST250CF, 20 Packs x 12,48 kWh) x "Depth of discharge (DOD) 0 % - 100 %" = 249,6 kWh. Leistung = Minimum aus Batterie und Wechselrichter: 249,6 kWh x "Nominal charge / discharge rate 0.5 P" = 124,8 kW gegen "Rated AC output power 125 kW" des SH125CX — es bindet die Batterie. Wirkungsgrad 0,88 als Annahme: der SH125CX nennt "Max. efficiency / European efficiency 98.6 % / 98.3 %" (Wechselrichter, kein Round-Trip), das Batterie-Datenblatt gar keinen. Aufstellungsart nicht benannt ("Floor-standing", IP66/C5), daher kein Fundament-Urteil.'), '')
where memodo_id = 15670
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and inverter_included is null
  and requires_foundation is null;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 15673 — Sungrow PowerKeeper ST50CF + SH125CX
-- ════════════════════════════════════════════════════════════════════════════════════════════════
update public.battery_catalog set
  usable_capacity_kwh     = 49.9,
  max_power_kw            = 24.95,
  round_trip_efficiency   = 0.88,
  rte_source              = 'annahme',
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  datasheet_url           = 'data/batteriekatalog/datenblaetter/Sungrow ST050-250CF.pdf + Sungrow SH 125 CX.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Nutzbar = 49,9 kWh Systemkapazitaet (ST050CF, 4 Packs x 12,48 kWh) x "Depth of discharge (DOD) 0 % - 100 %" = 49,9 kWh. Leistung = Minimum aus Batterie und Wechselrichter: 49,9 kWh x "Nominal charge / discharge rate 0.5 P" = 24,95 kW gegen 125 kW des SH125CX — es bindet die Batterie, der Wechselrichter ist um das Fuenffache ueberdimensioniert. Wirkungsgrad 0,88 als Annahme (nur Wechselrichter-Spitzenwirkungsgrad im Datenblatt). Aufstellungsart nicht benannt ("Floor-standing", IP66/C5), daher kein Fundament-Urteil.'), '')
where memodo_id = 15673
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and inverter_included is null
  and requires_foundation is null;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 12957 — Sungrow PowerStack ST225kWh-110kW-2h: nur der Wirkungsgrad
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Die Zeile trug schon 110 kW und (aus K2c) das Fundament-Urteil samt Baustein; sie hat den
-- K2c-Wirkungsgrad-Backfill nur deshalb verpasst, weil der an `usable_capacity_kwh is not null`
-- hing.
--
-- ⚠ DIE KAPAZITÄT BLEIBT LEER, und das lokale Datenblatt ändert daran nichts. Die deutsche
-- Fassung (Version 3) nennt wie die englische "Nennkapazität 229 kWh" und KEINE Entladetiefe —
-- die Schwestermodelle ST255CS und ST510CS führen "0 % - 100 %", dieses Blatt nicht. Die Zeile
-- bleibt damit gesperrt; eine aus dem Nachbardatenblatt übernommene Entladetiefe wäre geschätzt.
update public.battery_catalog set
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  datasheet_url         = 'data/batteriekatalog/datenblaetter/Sungrow ST225kWh-110kW-2h_PowerStack_Datenblatt.pdf',
  notes                 = notes || ' K2b-2: Wirkungsgrad 0,88 als Annahme gesetzt (deutsches Datenblatt Version 3 nennt nur "max. Wirkungsgrad von 98,5 %" des Batteriewechselrichters). Kapazitaet weiterhin offen: auch diese Fassung nennt keine Entladetiefe.'
where memodo_id = 12957
  and round_trip_efficiency is null;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Fundament-Baustein für 14591
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- 514 kWh Nennkapazität → Grössenklasse "Outdoor ≥ 500 kWh". Der Weg führt wie in K1b/K2c über
-- `public.admin_update_battery` statt über ein direktes UPDATE: die Zuordnung ist eine
-- Admin-Entscheidung und soll denselben Weg nehmen wie die Oberfläche (samt Art-Prüfung).
do $$
declare
  v_admin  uuid;
  v_gross  uuid;
  v_row    public.battery_catalog%rowtype;
  v_result jsonb;
begin
  select user_id into v_admin from platform.user_roles where role = 'admin' limit 1;
  if v_admin is null then
    raise notice 'K2b-2: kein Admin-Konto gefunden — die Zuordnung unterbleibt.';
    return;
  end if;

  select id into v_gross from public.battery_cost_components
   where bezeichnung = 'Outdoor ≥ 500 kWh';

  -- ⚠ NUR die JWT-Angabe, KEIN Rollenwechsel (Begründung im Kopf des K1b-DO-Blocks).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  select * into v_row from public.battery_catalog where memodo_id = 14591;
  if v_row.id is null or v_row.foundation_component_id is not null then
    return;
  end if;

  v_result := public.admin_update_battery(
    p_id                        => v_row.id,
    p_kategorie                 => v_row.kategorie,
    p_hersteller                => v_row.hersteller,
    p_bezeichnung               => v_row.bezeichnung,
    p_memodo_id                 => v_row.memodo_id,
    p_usable_capacity_kwh       => v_row.usable_capacity_kwh,
    p_max_power_kw              => v_row.max_power_kw,
    p_round_trip_efficiency     => v_row.round_trip_efficiency,
    p_rte_source                => v_row.rte_source,
    p_list_price_net            => v_row.list_price_net,
    p_inverter_included         => v_row.inverter_included,
    p_extra_inverter_cost_net   => v_row.extra_inverter_cost_net,
    p_requires_foundation       => true,
    p_foundation_component_id   => v_gross,
    p_installation_component_id => v_row.installation_component_id,
    p_price_as_of               => v_row.price_as_of,
    p_source_url                => v_row.source_url,
    p_datasheet_url             => v_row.datasheet_url,
    p_control_type              => v_row.control_type,
    p_notes                     => v_row.notes
  );

  if v_result->>'status' <> 'updated' then
    raise exception 'K2b-2: Zuordnung fuer memodo_id 14591 abgewiesen: %', v_result;
  end if;
end $$;
