-- K2b-3: Kenndaten für die restlichen Gewerbegeräte — GoodWe, Dyness, Kostal & Dyness, Solinteg.
--
-- 17 Zeilen, alle bisher ohne jede Kenndate. Quelle ist je Gerät das öffentliche Hersteller-
-- Datenblatt; `datasheet_url` trägt deshalb durchgehend echte URLs (anders als K2b-2, wo die
-- Sungrow-Blätter nur lokal vorlagen). Bei Paketen stehen beide Blätter mit " + " nebeneinander.
--
-- Feldregeln unverändert aus K2b-1/K2c/K2b-2: nutzbare Kapazität nur aus Nennkapazität × Entlade-
-- tiefe, wenn BEIDE im Blatt stehen; Leistung bei Paketen als Minimum aus Batterie und Wechsel-
-- richter; `round_trip_efficiency` nur dann `rte_source = 'datenblatt'`, wenn der Hersteller einen
-- System-/AC-AC-Round-Trip nennt — sonst 0,88 als gekennzeichnete Annahme.
--
-- ⚠ KEIN EINZIGES DER 17 BLÄTTER NENNT EINEN AC-AC-ROUND-TRIP; alle bekommen die Annahme. Drei
-- Zahlen kamen dabei nah heran und wurden bewusst VERWORFEN — die Begründung steht jeweils an der
-- Zeile: GoodWe BAT-C „Round-trip Efficiency 96 %" und Lynx C „95 %" sind Batterie-Round-Trips des
-- Schranks ohne jeden Umrichterdurchgang (der Wechselrichter ist ein separater Artikel des Pakets),
-- GoodWe ESA „Max. System Efficiency 92.0 %" ist ein MAXIMUM. Den Batteriewert mit dem Wechsel-
-- richter-Spitzenwirkungsgrad zu multiplizieren wäre genau der konstruierte Wert, den K2c an
-- Pylontech zurückgenommen hat.
--
-- ⚠ DIE WHERE-BEDINGUNG IST DIE SICHERUNG (wie K2b-1/K2b-2): geändert wird nur eine Zeile, die den
-- jeweiligen Wert noch gar nicht trägt. Hat ein Mensch im Admin gepflegt, läuft das UPDATE vorbei;
-- daraus folgt zugleich die Idempotenz.
--
-- Fundament- und Installationspreise werden ausdrücklich NICHT gesetzt.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- GoodWe — 12921  BAT60 mit ET 29.9
-- ════════════════════════════════════════════════════════════════════════════════════════════════
update public.battery_catalog set
  usable_capacity_kwh     = 60,
  max_power_kw            = 29.9,
  round_trip_efficiency   = 0.88,
  rte_source              = 'annahme',
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = true,
  datasheet_url           = 'https://en.goodwe.com/Ftp/EN/Downloads/Datasheet/GW_BAT-60-112_Datasheet-EN.pdf + https://en.goodwe.com/Ftp/EN/Downloads/Datasheet/GW_ET%2015-30kW_Datasheet-EN.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'BAT60 = GW61.4-BAT-AC-G10: "Usable Energy 60 kWh" direkt angegeben (Nennenergie 61,4 kWh, "Depth of Discharge 100 %"). Leistung = Minimum aus Batterie und Wechselrichter: "Max. Charge / Discharge Power 55.2 / 67.5 kW" gegen "Nominal Apparent Power 29.9 kVA" des GW29.9K-ET — es bindet der Wechselrichter. Wirkungsgrad 0,88 als Annahme: das Blatt nennt "Round-trip Efficiency 96%@100%DOD" der BATTERIE (Schrank ohne Umrichter) und der Wechselrichter "Max. Battery to AC Efficiency 97.5 %" fuer EINE Richtung; ein AC-AC-Systemwert steht nirgends. Fundament: IP55-Aussenschrank, Anti-corrosion C4 (C5-M optional), <950 kg, Klimageraet.'), '')
where memodo_id = 12921
  and usable_capacity_kwh is null and max_power_kw is null
  and round_trip_efficiency is null and inverter_included is null and requires_foundation is null;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- GoodWe — 12984 / 12985  Lynx D 30 bzw. 40 kWh mit GW29.9K-ET
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠ HIER BINDET DIE BATTERIE, NICHT DER WECHSELRICHTER — und die Abweichung ist gross. Das Lynx-D-
-- Modul traegt "Max. Charge / Discharge Power (kW) 3" je Modul; sechs bzw. acht Module ergeben 18
-- bzw. 24 kW gegen 29,9 kW des GW29.9K-ET. Haendlerangaben fuehren fuer beide Pakete pauschal die
-- Wechselrichterleistung (30 kW). Der Minimum-Regel zu folgen heisst hier, deutlich unter der
-- beworbenen Zahl zu bleiben; die Gegenrichtung liesse den Rechner eine Spitzenkappung versprechen,
-- die die Batterie nicht liefern kann.
--
-- ⚠ FUNDAMENT FALSE, obwohl IP66: das Blatt nennt die Aufstellungsart ausdruecklich
-- ("Mounting Method: Floor stacked / Wall-mounted"), es gibt also keine Unklarheit, in der die
-- IP-Klasse als Indiz einspraenge. Was sich an eine Wand haengen laesst, braucht keine Bodenplatte.
update public.battery_catalog set
  usable_capacity_kwh     = 30,
  max_power_kw            = 18,
  round_trip_efficiency   = 0.88,
  rte_source              = 'annahme',
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = false,
  datasheet_url           = 'https://www.goodwe.com.au/Ftp/EN/Downloads/ZUO/GW_Lynx-D_Datasheet-AU-C.pdf + https://en.goodwe.com/Ftp/EN/Downloads/Datasheet/GW_ET%2015-30kW_Datasheet-EN.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Nutzbar = 6 Module x "Usable Energy (kWh) 5" = 30 kWh (Lynx D, bis 8 Module je Stack). Leistung = Minimum aus Batterie und Wechselrichter: 6 x "Max. Charge / Discharge Power (kW) 3" = 18 kW gegen 29,9 kVA des GW29.9K-ET — es bindet die BATTERIE. Wirkungsgrad 0,88 als Annahme: das Modulblatt nennt keinen Wirkungsgrad, der Wechselrichter nur "Max. Efficiency 98.0 %" und "Max. Battery to AC Efficiency 97.5 %" fuer eine Richtung. Kein Fundament: "Mounting Method: Floor stacked / Wall-mounted".'), '')
where memodo_id = 12984
  and usable_capacity_kwh is null and max_power_kw is null
  and round_trip_efficiency is null and inverter_included is null and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = 40,
  max_power_kw            = 24,
  round_trip_efficiency   = 0.88,
  rte_source              = 'annahme',
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = false,
  datasheet_url           = 'https://www.goodwe.com.au/Ftp/EN/Downloads/ZUO/GW_Lynx-D_Datasheet-AU-C.pdf + https://en.goodwe.com/Ftp/EN/Downloads/Datasheet/GW_ET%2015-30kW_Datasheet-EN.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Nutzbar = 8 Module x "Usable Energy (kWh) 5" = 40 kWh (Lynx D, Maximum je Stack). Leistung = Minimum aus Batterie und Wechselrichter: 8 x "Max. Charge / Discharge Power (kW) 3" = 24 kW gegen 29,9 kVA des GW29.9K-ET — es bindet die BATTERIE. Wirkungsgrad 0,88 als Annahme (kein Wirkungsgrad im Modulblatt, nur Einweg-Werte beim Wechselrichter). Kein Fundament: "Mounting Method: Floor stacked / Wall-mounted".'), '')
where memodo_id = 12985
  and usable_capacity_kwh is null and max_power_kw is null
  and round_trip_efficiency is null and inverter_included is null and requires_foundation is null;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- GoodWe — 13784  ESA 125/261
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠ DIE EINZIGE ZAHL DIESES ABSCHNITTS, DIE EINE ENTSCHEIDUNG VERLANGT HAT: das Blatt fuehrt
-- "Max. System Efficiency 92.0%" neben "Max. PCS Efficiency 98.6%". 92 % auf SYSTEMebene kann
-- rechnerisch nur ein Round-Trip sein — es ist aber ein MAXIMUM, und K2c hat genau dafuer die
-- Linie gezogen (Pylontech: eine Obergrenze belegt keinen Betriebswert). Deshalb 0,88 mit
-- `annahme`; der Wortlaut steht in `notes`, damit die Entscheidung mit einem Handgriff umkehrbar
-- ist, falls Andreas den Wert als AC-AC-Systemangabe gelten laesst.
update public.battery_catalog set
  usable_capacity_kwh     = 261.25,
  max_power_kw            = 125,
  round_trip_efficiency   = 0.88,
  rte_source              = 'annahme',
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = true,
  datasheet_url           = 'https://en.goodwe.com/Ftp/EN/Downloads/Datasheet/GW_ESA-261kWh_Datasheet-EN.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Nutzbar = "Rack Usable Energy (kWh) 261.25" direkt angegeben (Rack Nominal Energy ebenfalls 261,25). Das Blatt empfiehlt daneben "Depth of Discharge 90% ~ 100% (90% Recommended)" — eine Empfehlung, keine abweichende nutzbare Kapazitaet; uebernommen wird der ausgewiesene Wert. Leistung = "Nominal Output Power (kW) 125" (nicht die 137,5 kW Spitzenleistung). Wirkungsgrad 0,88 als Annahme: "Max. System Efficiency 92.0%" ist als MAXIMUM angegeben und damit eine Obergrenze (dieselbe Linie wie bei Pylontech in K2c); "Max. PCS Efficiency 98.6%" ist ein Umrichterwert. Fundament: IP54-Aussenschrank, Anti-Corrosion C4 (C5 optional), 2580 kg, Fluessigkuehlung.'), '')
where memodo_id = 13784
  and usable_capacity_kwh is null and max_power_kw is null
  and round_trip_efficiency is null and inverter_included is null and requires_foundation is null;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- GoodWe — 14807  Blackout Ready Paket (BAT112 + ET100 + STS)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
update public.battery_catalog set
  usable_capacity_kwh     = 110,
  max_power_kw            = 100,
  round_trip_efficiency   = 0.88,
  rte_source              = 'annahme',
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = true,
  datasheet_url           = 'https://en.goodwe.com/Ftp/EN/Downloads/Datasheet/GW_BAT-60-112_Datasheet-EN.pdf + https://en.goodwe.com/Ftp/EN/Downloads/Datasheet/GW_ET-100_Datasheet-EN.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'BAT112 = GW112.6-BAT-AC-G10: "Usable Energy 110 kWh" direkt angegeben (Nennenergie 112,6 kWh, "Depth of Discharge 100 %"). Leistung = Minimum aus Batterie und Wechselrichter: "Max. Charge / Discharge Power 101.3 / 123.9 kW" gegen "Nominal Apparent Power 100 kVA" des GW100K-ET-G10 (dessen Batterieanschluss traegt 110 kW) — es bindet der Wechselrichter. Die STS-Box ist ein Umschalter und begrenzt nichts. Wirkungsgrad 0,88 als Annahme: "Round-trip Efficiency 96%@100%DOD" ist der Batterie-Round-Trip des Schranks, der Wechselrichter nennt nur "Max. Battery to AC Efficiency 98.2 %" fuer eine Richtung. Fundament: IP55-Aussenschrank, Anti-corrosion C4 (C5-M optional), <1400 kg.'), '')
where memodo_id = 14807
  and usable_capacity_kwh is null and max_power_kw is null
  and round_trip_efficiency is null and inverter_included is null and requires_foundation is null;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Dyness Stack100 — 14429 / 15838 / 15923 / 15924
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Vier Pakete auf demselben Batteriebaustein. Das STACK100-Blatt nennt "Module Voltage/Capacity
-- 51.2V/100Ah" (= 5,12 kWh je Modul) UND "Depth of Discharge 95 %" — beide Werte stehen da, die
-- nutzbare Kapazitaet ist damit rechenbar: 5,12 x 0,95 = 4,864 kWh je Modul.
--
-- Leistung: das Blatt fuehrt "Recommended Charge/Discharge Current 50A (0.5C)" NEBEN
-- "Max.Charge/Discharge Current 100A (1C)" (die Spitze ist getrennt als 125 A / 2 min angegeben).
-- Gerechnet wird mit dem ausgewiesenen Dauer-MAXIMUM 1C; in allen vier Paketen bindet dadurch der
-- Wechselrichter, die Unterscheidung 0,5C/1C wirkt sich also nur bei den beiden SMA-Paketen
-- ueberhaupt aus (dort waeren es sonst 25,6 statt 30 bzw. 38,4 statt 50 kW).
--
-- ⚠ FUNDAMENT FALSE FUER ALLE VIER: "Protection Level IP20", "Installation method Stack type" —
-- ein Innenraumgeraet. Die IP-Klasse des SMA-Wechselrichters (IP65) aendert daran nichts, sie
-- beschreibt ein anderes Geraet des Pakets.
update public.battery_catalog set
  usable_capacity_kwh     = 29.184,
  max_power_kw            = 15,
  round_trip_efficiency   = 0.88,
  rte_source              = 'annahme',
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = false,
  datasheet_url           = 'https://dyness.com/Public/Uploads/uploadfile/files/20241223/STACK100Datasheet.pdf + https://solarpartners.se/wp-content/uploads/2024/08/INTEG-M-10-20KW-Hybrid-Inverter-1.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Nutzbar = 6 Module x 5,12 kWh ("Module Voltage/Capacity 51.2V/100Ah") x "Depth of Discharge 95 %" = 29,184 kWh. Leistung = Minimum aus Batterie und Wechselrichter: 6 x 51,2 V x "Max.Charge/Discharge Current 100A (1C)" = 30,72 kW gegen "Rated Output Power 15.00 kW" des MHT-15K-40 — es bindet der Wechselrichter. Wirkungsgrad 0,88 als Annahme: das Batterieblatt nennt gar keinen Wirkungsgrad, der Wechselrichter "Max. Efficiency 98.4 %" / "European Efficiency 97.5 %". Kein Fundament: "Protection Level IP20", "Installation method Stack type".'), '')
where memodo_id = 14429
  and usable_capacity_kwh is null and max_power_kw is null
  and round_trip_efficiency is null and inverter_included is null and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = 38.912,
  max_power_kw            = 20,
  round_trip_efficiency   = 0.88,
  rte_source              = 'annahme',
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = false,
  datasheet_url           = 'https://dyness.com/Public/Uploads/uploadfile/files/20241223/STACK100Datasheet.pdf + https://solarpartners.se/wp-content/uploads/2024/08/INTEG-M-10-20KW-Hybrid-Inverter-1.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Nutzbar = 8 Module x 5,12 kWh x "Depth of Discharge 95 %" = 38,912 kWh. Leistung = Minimum aus Batterie und Wechselrichter: 8 x 51,2 V x 100 A (1C) = 40,96 kW gegen "Rated Output Power 20.00 kW" des MHT-20K-40 — es bindet der Wechselrichter. Wirkungsgrad 0,88 als Annahme (kein Wirkungsgrad im Batterieblatt, nur Umrichterwerte). Kein Fundament: IP20, Stack type.'), '')
where memodo_id = 15838
  and usable_capacity_kwh is null and max_power_kw is null
  and round_trip_efficiency is null and inverter_included is null and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = 48.64,
  max_power_kw            = 30,
  round_trip_efficiency   = 0.88,
  rte_source              = 'annahme',
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = false,
  datasheet_url           = 'https://dyness.com/Public/Uploads/uploadfile/files/20241223/STACK100Datasheet.pdf + https://files.sma.de/downloads/SIxx-20-DS-en-21.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Nutzbar = 10 Module x 5,12 kWh x "Depth of Discharge 95 %" = 48,64 kWh. Leistung = Minimum aus Batterie und Wechselrichter: 10 x 51,2 V = 512 V (im Bereich "DC voltage range at nominal power 200 V to 980 V") x 100 A (1C) = 51,2 kW gegen "Rated power at nominal voltage 30000 W" des SI30-20 — es bindet der Wechselrichter. Wirkungsgrad 0,88 als Annahme: das Batterieblatt nennt keinen, SMA nur "Max. efficiency / European Efficiency 98.0 % / 97.6 %" fuer eine Richtung. Kein Fundament: die Batterie ist IP20 / Stack type; die IP65 des Wechselrichters beschreibt ein anderes Geraet.'), '')
where memodo_id = 15923
  and usable_capacity_kwh is null and max_power_kw is null
  and round_trip_efficiency is null and inverter_included is null and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = 72.96,
  max_power_kw            = 50,
  round_trip_efficiency   = 0.88,
  rte_source              = 'annahme',
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = false,
  datasheet_url           = 'https://dyness.com/Public/Uploads/uploadfile/files/20241223/STACK100Datasheet.pdf + https://files.sma.de/downloads/SIxx-20-DS-en-21.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Nutzbar = 15 Module x 5,12 kWh x "Depth of Discharge 95 %" = 72,96 kWh. Leistung = Minimum aus Batterie und Wechselrichter: 15 x 51,2 V = 768 V (im Bereich "DC voltage range at nominal power 350 V to 980 V") x 100 A (1C) = 76,8 kW gegen "Rated power at nominal voltage 50000 W" des SI50-20 — es bindet der Wechselrichter. Wirkungsgrad 0,88 als Annahme (kein Wirkungsgrad im Batterieblatt, bei SMA nur Einweg-Werte). Kein Fundament: die Batterie ist IP20 / Stack type.'), '')
where memodo_id = 15924
  and usable_capacity_kwh is null and max_power_kw is null
  and round_trip_efficiency is null and inverter_included is null and requires_foundation is null;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Dyness — 14646  BF100-C100: fast alles bleibt offen, und das ist der Befund
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠ ZWEI PFLICHTWERTE SIND AUS DEM DATENBLATT NICHT ZU HOLEN, und keiner davon darf geschaetzt
-- werden:
--   (a) LEISTUNG. Das Geraet ist ein Batterieschrank OHNE Wechselrichter. Eine AC-Dauerentlade-
--       leistung hat es damit nicht — sie entstuende erst mit einem PCS, der nicht Teil des
--       Artikels ist. Das Blatt nennt nur die DC-Seite ("Rated current 140A (0.5C)", "Max. current
--       160A").
--   (b) KAPAZITAET. Das Blatt nennt "System capacity 100kWh" und KEINE Entladetiefe — dieselbe
--       Lage wie beim Sungrow ST225 in K2b-2. Die 95 % des Schwestergeraets STACK100 zu uebernehmen
--       waere geschaetzt.
-- Die Zeile bleibt damit gesperrt. Gesetzt werden nur die beiden Angaben, die belegt sind: die
-- Aufstellungsart und die Quelle.
update public.battery_catalog set
  inverter_included       = false,
  requires_foundation     = true,
  datasheet_url           = 'https://dyness.com/Public/Uploads/uploadfile/files/20250901/DynessBF100DatasheetEN20250826-626.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'K2b-3: Batterieschrank OHNE Wechselrichter — eine AC-Dauerentladeleistung hat der Artikel nicht, das Blatt nennt nur DC ("Rated current 140A (0.5C)", "Max. current 160A"). Kapazitaet weiterhin offen: "System capacity 100kWh" ohne jede Entladetiefe (gleiche Lage wie Sungrow ST225 in K2b-2). Wirkungsgrad offen, solange Kapazitaet und Leistung fehlen; das Blatt nennt ohnehin nur "System efficiency 93%" ohne Angabe der Messrichtung. Fundament: IP55, Anti-corrosion grade C3 (optional C5), rund 1500 kg, Handbuchtitel "EnerCore Outdoor Air-cooling Battery Cabinet". Kenndaten der Serienfassung V1.0 entnommen — die aktuelle PDF-Fassung ist rein bildbasiert.'), '')
where memodo_id = 14646
  and inverter_included is null and requires_foundation is null;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Kostal & Dyness — 16402 / 16403 / 16404 / 16405 / 16406: Kapazität ja, Leistung nein
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠ FUER DIESE FUENF PAKETE GIBT ES KEIN HERSTELLER-DATENBLATT, DAS DEN WECHSELRICHTER BENENNT.
-- Es sind vom Distributor zusammengestellte Buendel; KOSTAL veroeffentlicht die Kompatibilitaet
-- des Stack100 mit PLENTICORE G2/G3 und PIKO CI, aber nirgends, welches Geraet in „Retrofit S/M/L"
-- bzw. „Commercial S/M" steckt. `max_power_kw` bleibt deshalb LEER — und damit auch der
-- Wirkungsgrad, der erst mit Kapazitaet UND Leistung faellig wird.
--
-- Die KAPAZITAET ist dagegen belegt und wird gesetzt: die Paketangabe der nutzbaren Kapazitaet
-- laesst genau eine Modulzahl zu (6 / 10 / 13 Module), und aus dem Dyness-Blatt folgt daraus
-- 5,12 kWh x 0,95 = 4,864 kWh je Modul. Beide Wege ergeben dieselbe Zahl; geschaetzt ist daran
-- nichts, hergeleitet ist nur die Modulzahl.
update public.battery_catalog set
  usable_capacity_kwh     = 29.184,
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = false,
  datasheet_url           = 'https://dyness.com/Public/Uploads/uploadfile/files/20241223/STACK100Datasheet.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'K2b-3: Nutzbar = 6 Module x 5,12 kWh ("Module Voltage/Capacity 51.2V/100Ah") x "Depth of Discharge 95 %" = 29,184 kWh; die Modulzahl folgt eindeutig aus der ausgewiesenen Paketkapazitaet von 29,2 kWh. Kein Fundament: "Protection Level IP20", "Installation method Stack type". LEISTUNG OFFEN: das Paket nennt den KOSTAL-Wechselrichter nicht, und KOSTAL veroeffentlicht keine Stueckliste dazu — ohne Modell kein Minimum aus Batterie und Wechselrichter. Wirkungsgrad bleibt damit ebenfalls offen.'), '')
where memodo_id = 16402
  and usable_capacity_kwh is null and inverter_included is null and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = 48.64,
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = false,
  datasheet_url           = 'https://dyness.com/Public/Uploads/uploadfile/files/20241223/STACK100Datasheet.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'K2b-3: Nutzbar = 10 Module x 5,12 kWh x "Depth of Discharge 95 %" = 48,64 kWh (Modulzahl aus der Paketkapazitaet 48,6 kWh). Kein Fundament: IP20, Stack type. LEISTUNG OFFEN: der KOSTAL-Wechselrichter des Pakets ist nirgends benannt. Wirkungsgrad bleibt damit ebenfalls offen.'), '')
where memodo_id = 16403
  and usable_capacity_kwh is null and inverter_included is null and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = 63.232,
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = false,
  datasheet_url           = 'https://dyness.com/Public/Uploads/uploadfile/files/20241223/STACK100Datasheet.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'K2b-3: Nutzbar = 13 Module x 5,12 kWh x "Depth of Discharge 95 %" = 63,232 kWh (Modulzahl aus der Paketkapazitaet 63,3 kWh). Kein Fundament: IP20, Stack type. LEISTUNG OFFEN: der KOSTAL-Wechselrichter des Pakets ist nirgends benannt. Wirkungsgrad bleibt damit ebenfalls offen.'), '')
where memodo_id = 16404
  and usable_capacity_kwh is null and inverter_included is null and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = 48.64,
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = false,
  datasheet_url           = 'https://dyness.com/Public/Uploads/uploadfile/files/20241223/STACK100Datasheet.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'K2b-3: Nutzbar = 10 Module x 5,12 kWh x "Depth of Discharge 95 %" = 48,64 kWh (Modulzahl aus der Paketkapazitaet 48,6 kWh). Kein Fundament: IP20, Stack type. LEISTUNG OFFEN: der KOSTAL-Wechselrichter des Pakets ist nirgends benannt — bei „Commercial" weicht die ausgewiesene Paketleistung ausserdem von „Retrofit" bei gleicher Batterie ab, die beiden Reihen benutzen also nicht dasselbe Geraet. Wirkungsgrad bleibt damit ebenfalls offen.'), '')
where memodo_id = 16405
  and usable_capacity_kwh is null and inverter_included is null and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = 63.232,
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = false,
  datasheet_url           = 'https://dyness.com/Public/Uploads/uploadfile/files/20241223/STACK100Datasheet.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'K2b-3: Nutzbar = 13 Module x 5,12 kWh x "Depth of Discharge 95 %" = 63,232 kWh (Modulzahl aus der Paketkapazitaet 63,2 kWh). Kein Fundament: IP20, Stack type. LEISTUNG OFFEN: der KOSTAL-Wechselrichter des Pakets ist nirgends benannt. Wirkungsgrad bleibt damit ebenfalls offen.'), '')
where memodo_id = 16406
  and usable_capacity_kwh is null and inverter_included is null and requires_foundation is null;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Solinteg — 15879 / 15880
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Ein Blatt fuer beide Seiten: Solinteg fuehrt Schrank und Wechselrichter in EINER Tabelle
-- (E2BR-S64K-C … S112-C gegen M2HT-25-150 … M2HT-50-150). Die Paketnamen des Katalogs schreiben
-- „M2HT-30K-150"/„M2HT-50K-150", das Blatt „M2HT-30-150"/„M2HT-50-150" — dasselbe Geraet.
--
-- ⚠ BEI 15880 BINDET DIE BATTERIE: 307,2 V x 150 A = 46,08 kW gegen 50 kW des Wechselrichters.
-- Bei 15879 bindet der Wechselrichter knapp (30 gegen 30,72 kW).
update public.battery_catalog set
  usable_capacity_kwh     = 57.87,
  max_power_kw            = 30,
  round_trip_efficiency   = 0.88,
  rte_source              = 'annahme',
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = true,
  datasheet_url           = 'https://solar-distribution.baywa-re.cz/out/media/05-600142_Solinteg_M2HT-xx-150_datasheet.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Nutzbar = "Battery System Energy 64.3 kWh" x "Depth of Discharge 90 %" = 57,87 kWh (4 Packs). Leistung = Minimum aus Batterie und Wechselrichter: "Rated Voltage 204.8 V" x "Max. Charge/Discharge Current 150 A" = 30,72 kW gegen "Rated Output Power 30 kW" des M2HT-30-150 — es bindet der Wechselrichter. Wirkungsgrad 0,88 als Annahme: das Blatt nennt "Max. Efficiency 97.80 %", "European Efficiency 97.20 %" und "Battery Charge/Discharge Efficiency 97.50 %" — alles Einweg-Werte, kein AC-AC-Round-Trip. Fundament: "Ingress Protection Cabinet: IP55", "Anti-corrosion Degree C4 (C5 Optional)", 1330 kg, Klimageraet im Schrank.'), '')
where memodo_id = 15879
  and usable_capacity_kwh is null and max_power_kw is null
  and round_trip_efficiency is null and inverter_included is null and requires_foundation is null;

update public.battery_catalog set
  usable_capacity_kwh     = 86.76,
  max_power_kw            = 46.08,
  round_trip_efficiency   = 0.88,
  rte_source              = 'annahme',
  inverter_included       = true,
  extra_inverter_cost_net = 0,
  requires_foundation     = true,
  datasheet_url           = 'https://solar-distribution.baywa-re.cz/out/media/05-600142_Solinteg_M2HT-xx-150_datasheet.pdf',
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || 'Nutzbar = "Battery System Energy 96.4 kWh" x "Depth of Discharge 90 %" = 86,76 kWh (6 Packs). Leistung = Minimum aus Batterie und Wechselrichter: "Rated Voltage 307.2 V" x "Max. Charge/Discharge Current 150 A" = 46,08 kW gegen "Rated Output Power 50 kW" des M2HT-50-150 — hier bindet die BATTERIE, der Wechselrichter ist ueberdimensioniert. Wirkungsgrad 0,88 als Annahme (nur Einweg-Werte im Blatt). Fundament: Schrank IP55, "Anti-corrosion Degree C4 (C5 Optional)", 1570 kg.'), '')
where memodo_id = 15880
  and usable_capacity_kwh is null and max_power_kw is null
  and round_trip_efficiency is null and inverter_included is null and requires_foundation is null;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Fundament-Bausteine für die sechs Aussenschränke
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Zuordnung nach NENNkapazität (nicht nach der nutzbaren), wie in K2c/K2b-2:
--   12921  61,4 kWh  · 14646 100 kWh · 14807 112,6 kWh · 15879 64,3 kWh · 15880 96,4 kWh
--        → „Outdoor-Schrank bis ~110 kWh"   (14807 liegt mit 112,6 kWh knapp darüber, das Gewicht
--          von <1400 kg passt zur Klasse, und die nächste Klasse beginnt erst bei ~190 kWh)
--   13784 261,25 kWh, 2580 kg → „Outdoor-Schrank ~190–260 kWh"
--
-- Der Weg führt wie in K1b/K2c/K2b-2 über `public.admin_update_battery` statt über ein direktes
-- UPDATE: die Zuordnung ist eine Admin-Entscheidung und soll denselben Weg nehmen wie die
-- Oberfläche (samt Art-Prüfung). Preise werden dabei nicht angefasst.
do $$
declare
  v_admin  uuid;
  v_klein  uuid;
  v_mittel uuid;
  v_target uuid;
  v_row    public.battery_catalog%rowtype;
  v_result jsonb;
  v_memodo int;
begin
  select user_id into v_admin from platform.user_roles where role = 'admin' limit 1;
  if v_admin is null then
    raise notice 'K2b-3: kein Admin-Konto gefunden — die Zuordnungen unterbleiben.';
    return;
  end if;

  select id into v_klein  from public.battery_cost_components where bezeichnung = 'Outdoor-Schrank bis ~110 kWh';
  select id into v_mittel from public.battery_cost_components where bezeichnung = 'Outdoor-Schrank ~190–260 kWh';

  -- ⚠ NUR die JWT-Angabe, KEIN Rollenwechsel (Begründung im Kopf des K1b-DO-Blocks).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  foreach v_memodo in array array[12921, 13784, 14646, 14807, 15879, 15880] loop
    v_target := case when v_memodo = 13784 then v_mittel else v_klein end;

    select * into v_row from public.battery_catalog where memodo_id = v_memodo;
    continue when v_row.id is null or v_row.foundation_component_id is not null;

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
      p_foundation_component_id   => v_target,
      p_installation_component_id => v_row.installation_component_id,
      p_price_as_of               => v_row.price_as_of,
      p_source_url                => v_row.source_url,
      p_datasheet_url             => v_row.datasheet_url,
      p_control_type              => v_row.control_type,
      p_notes                     => v_row.notes
    );

    if v_result->>'status' <> 'updated' then
      raise exception 'K2b-3: Zuordnung fuer memodo_id % abgewiesen: %', v_memodo, v_result;
    end if;
  end loop;
end $$;
