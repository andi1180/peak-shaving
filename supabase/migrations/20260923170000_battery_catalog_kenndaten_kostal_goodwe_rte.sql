-- K2b-3b: zwei Nacharbeiten aus K2b-3 — GoodWe ESA bekommt seinen System-Wirkungsgrad, und die
-- fuenf Kostal-&-Dyness-Buendel bekommen die Leistung, die K2b-3 offenlassen musste.
--
-- Beides sind KORREKTUREN an Zeilen, die K2b-3 bereits angefasst hat. Die WHERE-Bedingung ist
-- deshalb nicht „Feld ist leer", sondern „Feld traegt noch genau den Wert aus K2b-3" — hat ein
-- Mensch im Admin gepflegt, laeuft das UPDATE vorbei (dieselbe Sicherung, anderes Praedikat).

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL A — GoodWe 13784 ESA 125/261: „Max. System Efficiency 92.0 %" gilt als System-RTE
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠ DIES KEHRT EINE ENTSCHEIDUNG AUS K2b-3 UM, und zwar bewusst und auf Andreas' Urteil.
-- K2b-3 hatte die 92 % mit derselben Begruendung verworfen wie Pylontech in K2c: es ist ein
-- MAXIMUM. Der Unterschied, der jetzt den Ausschlag gibt, ist die BEZUGSEBENE — die drei in
-- K2c/K2b-3 verworfenen Werte (SolarEdge, SMA, Pylontech) waren Einzel-Durchgang-Maxima eines
-- Umrichters oder eines Schranks ohne Umrichter; ein Wert auf SYSTEMebene kann rechnerisch nur
-- beide Richtungen enthalten, und 92 % liegt im Bereich echter Round-Trip-Werte (ein
-- Einzeldurchgang laege bei 96–98 %). Die Linie aus K2c bleibt damit unangetastet: sie verbietet
-- den KONSTRUIERTEN Wert und den Einzeldurchgang, nicht die ausgewiesene Systemangabe.
update public.battery_catalog set
  round_trip_efficiency = 0.92,
  rte_source            = 'datenblatt',
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || 'K2b-3b: Wirkungsgrad auf 0,92 (datenblatt) korrigiert — die in K2b-3 verworfene Angabe "Max. System Efficiency 92.0%" wird als System-RTE gewertet. Datenblatt nennt "Max. System Efficiency", keine explizite Lade-/Entlade-Richtungsangabe — als System-RTE gewertet, nicht als Einzel-Umrichterwert.'), '')
where memodo_id = 13784
  and round_trip_efficiency = 0.88
  and rte_source = 'annahme';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL B — Kostal & Dyness 16402–16406: die Leistung steht auf der Produktseite
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- K2b-3 liess `max_power_kw` leer, weil kein HERSTELLER-Blatt den Wechselrichter des Buendels
-- benennt. Die memodo.at-PRODUKTSEITE tut es — sie fuehrt je Paket eine Stueckliste und rechnet
-- die batterieseitige AC-Leistung selbst aus. Quelle ist deshalb hier die Produktseite, nicht ein
-- Datenblatt; `datasheet_url` bleibt auf dem Dyness-Blatt (die Kapazitaetsquelle) und die
-- Produktseiten-URL steht in `notes`.
--
-- ⚠ EINE ANNAHME AUS K2b-3 WAR FALSCH und wird hier zurueckgenommen: die Notiz an 16405 schloss
-- aus der abweichenden Paketleistung, „Commercial" und „Retrofit" benutzten nicht dasselbe Geraet.
-- Sie benutzen denselben BATTERIE-Wechselrichter (KOSTAL PLENTICORE BI 25 G3, in allen fuenf
-- Paketen); was bei „Commercial" hinzukommt, ist ein PV-Wechselrichter (PIKO CI 30/50 G2), und der
-- begrenzt die Batterieleistung nicht. Die alte Zeile wird aus `notes` entfernt statt ergaenzt —
-- sie ist keine ueberholte Herleitung, sondern eine falsche Tatsachenbehauptung.
--
-- ⚠ DIE LEISTUNG HAENGT AN DER MODULZAHL, NICHT NUR AM WECHSELRICHTER. Der BI 25 G3 erreicht seine
-- 25 kW Basisleistung erst oberhalb einer Turmspannung, die 6 bzw. 10 Module nicht erreichen; die
-- Produktseite weist deshalb je Paket eine eigene Zahl aus („Max. Leistungsentnahme mit diesem
-- Turm"). Das ist das Minimum aus Batterie und Wechselrichter, nur dass hier die BATTERIE bindet —
-- dieselbe Lage wie bei GoodWe Lynx D in K2b-3, und wieder deutlich unter der Geraetezahl.
--
-- Der Wirkungsgrad bleibt 0,88 als Annahme: die Produktseiten nennen „Max. Wirkungsgrad
-- Bat2AC/AC2Bat: 98,3 %" — ein Maximum je EINZELNER Richtung, kein System-Round-Trip (anders als
-- GoodWe ESA in TEIL A). Damit greift die K2c-Regel unveraendert.

update public.battery_catalog set
  max_power_kw          = 12.3,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  notes                 = nullif(btrim(regexp_replace(coalesce(notes, ''), ' LEISTUNG OFFEN:.*$', '') || ' · K2b-3b: Leistung 12,3 kW aus der Produktseite https://www.memodo.at/kostal-dyness-retrofit-s/16402 — Stueckliste "1x KOSTAL PLENTICORE BI 25 G3 (Batterie-Wechselrichter, Basisleistung 25 kW)" + "6x Dyness Stack 100 Batteriemodul, je 5,12 kWh". Minimum aus Batterie und Wechselrichter: es bindet die BATTERIE, "Da die Batteriespannung bei 6 Modulen (ca. 307 V) noch unter der fuer die volle Wechselrichterleistung noetigen Schwelle liegt, betraegt die batterieseitige AC-Leistung 12,3 kW (statt der Basisleistung von 25 kW)". Die Produktseite bestaetigt zugleich die in K2b-3 hergeleitete Modulzahl und Kapazitaet ("Nutzbare Kapazitaet: 29,2 kWh (95 % DoD)"). Wirkungsgrad 0,88 als Annahme: die Seite nennt nur "Max. Wirkungsgrad Bat2AC/AC2Bat: 98,3 %", ein Maximum je einzelner Richtung, keinen System-Round-Trip.'), '')
where memodo_id = 16402
  and max_power_kw is null and round_trip_efficiency is null and rte_source is null;

update public.battery_catalog set
  max_power_kw          = 20.5,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  notes                 = nullif(btrim(regexp_replace(coalesce(notes, ''), ' LEISTUNG OFFEN:.*$', '') || ' · K2b-3b: Leistung 20,5 kW aus der Produktseite https://www.memodo.at/kostal-dyness-retrofit-m/16403 — Stueckliste "1x KOSTAL PLENTICORE BI 25 G3 (Batterie-Wechselrichter, Basisleistung 25 kW)" + "10x Dyness Stack 100 Batteriemodul, je 5,12 kWh". Minimum aus Batterie und Wechselrichter: es bindet die BATTERIE, "Max. Leistungsentnahme mit diesem Turm (10 Module): 20,5 kW" (statt der vollen Basisleistung von 25 kW, weil ca. 512 V Turmspannung). Die Produktseite bestaetigt Modulzahl und Kapazitaet ("Nutzbare Kapazitaet: 48,6 kWh (95 % DoD)"). Wirkungsgrad 0,88 als Annahme: nur "Max. Wirkungsgrad Bat2AC/AC2Bat: 98,3 %" je einzelner Richtung, kein System-Round-Trip.'), '')
where memodo_id = 16403
  and max_power_kw is null and round_trip_efficiency is null and rte_source is null;

update public.battery_catalog set
  max_power_kw          = 25,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  notes                 = nullif(btrim(regexp_replace(coalesce(notes, ''), ' LEISTUNG OFFEN:.*$', '') || ' · K2b-3b: Leistung 25 kW aus der Produktseite https://www.memodo.at/kostal-dyness-retrofit-l/16404 — Stueckliste "1x KOSTAL PLENTICORE BI 25 G3 (Batterie-Wechselrichter, 25 kW)" + "13x Dyness Stack 100 Batteriemodul, je 5,12 kWh". Minimum aus Batterie und Wechselrichter: hier binden beide gleich, "Max. Leistungsentnahme mit diesem Turm (13 Module): 25,0 kW (volle Wechselrichterleistung)". Die Produktseite bestaetigt Modulzahl und Kapazitaet ("Nutzbare Kapazitaet: 63,3 kWh (95 % DoD)"; die gerechneten 63,232 kWh sind dieselbe Zahl, die Seite rundet uneinheitlich auf 63,2 bzw. 63,3). Wirkungsgrad 0,88 als Annahme: nur "Max. Wirkungsgrad Bat2AC/AC2Bat: 98,3 %" je einzelner Richtung, kein System-Round-Trip.'), '')
where memodo_id = 16404
  and max_power_kw is null and round_trip_efficiency is null and rte_source is null;

update public.battery_catalog set
  max_power_kw          = 20.5,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  notes                 = nullif(btrim(regexp_replace(coalesce(notes, ''), ' LEISTUNG OFFEN:.*$', '') || ' · K2b-3b: Leistung 20,5 kW aus der Produktseite https://www.memodo.at/kostal-dyness-commercial-s/16405 — Stueckliste "1x KOSTAL PLENTICORE BI 25 G3 (Batterie-Wechselrichter, Basisleistung 25 kW)" + "1x Kostal Piko CI 30 G2 (PV-Wechselrichter, 30 kW)" + "10x Dyness Stack 100 Batteriemodul, je 5,12 kWh". Massgeblich ist der BATTERIE-Wechselrichter; der PIKO CI ist ein PV-Wechselrichter und begrenzt die Batterieleistung nicht. Es bindet die Batterie: "Bei 10 Modulen (ca. 512 V Turmspannung) liefert der BI 25 G3 rund 20,5 kW batterieseitig" — identisch mit Retrofit M, weil dort dasselbe Geraet und dieselbe Modulzahl steckt. Die in K2b-3 vermutete abweichende Geraetewahl ist damit widerlegt. Wirkungsgrad 0,88 als Annahme: nur "Max. Wirkungsgrad Bat2AC/AC2Bat: 98,3 %" je einzelner Richtung, kein System-Round-Trip.'), '')
where memodo_id = 16405
  and max_power_kw is null and round_trip_efficiency is null and rte_source is null;

update public.battery_catalog set
  max_power_kw          = 25,
  round_trip_efficiency = 0.88,
  rte_source            = 'annahme',
  notes                 = nullif(btrim(regexp_replace(coalesce(notes, ''), ' LEISTUNG OFFEN:.*$', '') || ' · K2b-3b: Leistung 25 kW aus der Produktseite https://www.memodo.at/kostal-dyness-commercial-m/16406 — Stueckliste "1x KOSTAL PLENTICORE BI 25 G3 (Batterie-Wechselrichter, 25 kW)" + "1x Kostal Piko CI 50 G2 (PV-Wechselrichter, 50 kW)" + "13x Dyness Stack 100 Batteriemodul, je 5,12 kWh". Massgeblich ist der BATTERIE-Wechselrichter; der PIKO CI ist ein PV-Wechselrichter und begrenzt die Batterieleistung nicht. "Bei 13 Modulen (ca. 666 V Turmspannung) erreicht der BI 25 G3 seine volle Leistung von 25 kW" — identisch mit Retrofit L. Wirkungsgrad 0,88 als Annahme: nur "Max. Wirkungsgrad Bat2AC/AC2Bat: 98,3 %" je einzelner Richtung, kein System-Round-Trip.'), '')
where memodo_id = 16406
  and max_power_kw is null and round_trip_efficiency is null and rte_source is null;
