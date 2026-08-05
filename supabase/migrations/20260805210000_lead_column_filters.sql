-- Spaltenweise Filter für die Lead-Liste — und die formlose Firmenerwähnung im Lesepfad.
--
-- ⚠ MASSGEBLICH FÜR DEN STAND DIESER REIHE IST DER HANDOVER IN `apps/web/CLAUDE.md`.
--
-- ── DER ANLASS ──────────────────────────────────────────────────────────────────────────────────
-- Die Lead-Liste bekommt eine Excel-artige Bedienung: je Spalte ein kleines Symbol im Kopf, das ein
-- Popover öffnet — Suchfeld bei Textspalten, Ankreuzliste bei kategorialen, Zeitraum beim Datum.
-- Die grosse Filtersektion oberhalb der Liste und die drei Reiter aus B18-5 entfallen dafür.
--
-- Das ist eine Oberflächen-Entscheidung, aber sie ist mit dem heutigen Schema NICHT umsetzbar.
-- GEMESSEN gegen den laufenden Stand (`pg_get_functiondef`, nicht aus Migrationen abgelesen):
-- `platform.leads_matching` trägt 15 Parameter, und AUSSER Herkunft (genau EIN Schlüssel) und
-- Einwilligung (genau EIN Zweck + EIN Zustand) gibt es zu keiner der zehn künftigen Spalten einen
-- passenden Filter. Insbesondere fehlen: Firma und E-Mail EINZELN (`p_search` durchsucht beide
-- gemeinsam), Vorname, Nachname, Telefon, Thema, Zuordnung und der Zeitraum auf `created_at`.
--
-- Nachgelagert im Anwendungscode zu filtern scheidet aus, und zwar aus dem Grund, der seit B1-3 im
-- Kopf der Lead-Seite steht: Es bräche die Seitenaufteilung (die Datenbank liefert 50 Zeilen, die
-- Anwendung wirft 40 weg und zeigt 10 — die Trefferzahl wäre falsch und „Seite 2" übersprünge
-- Treffer), es holte mehr personenbezogene Daten als je angezeigt werden, und der CSV-Export liefe
-- an den Filtern der Sicht vorbei, weil er über DIESELBE Filterdefinition geht.
--
-- ── DIE ZWEITE LÜCKE: DIE B19-FIX-ZUORDNUNG FEHLT IM LESEPFAD ───────────────────────────────────
-- Die neue Spalte „Zuordnung" zeigt je nach Herkunft Verschiedenes; bei einer intern aufgenommenen
-- Anfrage (`telefonanfrage`) ist das der Fachbetrieb ODER die formlos genannte Firma aus der
-- B19-Nachbesserung. `platform.leads.mentioned_business_id` existiert seit dem 05.08.2026 — aber
-- ebenfalls gemessen: die Zeichenfolge `mentioned_business` kommt in `public.admin_list_leads`,
-- `public.admin_export_leads`, `platform.leads_matching` und `platform.lead_filter_summary`
-- ZUSAMMEN NULL MAL vor. Gelesen wird sie bis heute ausschliesslich von `public.admin_get_lead`,
-- also nur auf der Detailseite. Ohne diese Migration bliebe die Zelle in der Liste ausgerechnet
-- dort leer, wo eine Zuordnung tatsächlich erfasst wurde.
--
-- ── WAS HIER ENTSTEHT ───────────────────────────────────────────────────────────────────────────
--   TEIL 0  `platform.like_pattern`        — die EINE Definition der Freitext-Maskierung
--   TEIL 0b `platform.invalid_lead_filter` — die EINE Ablehnungsprüfung beider Wrapper
--   TEIL 1  `platform.leads_matching`      — 13 angehängte Filterparameter
--   TEIL 2  `platform.lead_filter_summary` — dieselben 13, damit das Ausfuhrprotokoll sie benennt
--   TEIL 3  `public.admin_list_leads`      — dieselben 13 + mentioned_business_id/-name je Zeile
--   TEIL 4  `public.admin_export_leads`    — dieselben 13
--   TEIL 5  Rechte nach den DROPs wiederherstellen
--
-- ── WAS AUSDRÜCKLICH NICHT ENTSTEHT ─────────────────────────────────────────────────────────────
-- KEINE Tabellen-, Spalten- oder Datenänderung. Kein neuer Index (dazu unten mehr). Keine neue
-- Tabelle, kein neuer Wrapper, kein neues Recht für irgendeine Rolle. `platform.leads`,
-- `platform.mentioned_businesses`, `platform.partners`, `public.capture_lead`,
-- `public.admin_update_lead`, `public.admin_get_lead`, `platform.anonymize_lead`,
-- `platform.guard_anonymized_lead`, `public.get_my_partner_leads` und `public.admin_lead_source_stats`
-- bleiben unangetastet.
--
-- ⚠ `public.admin_export_leads` bekommt die FILTER, aber KEINE neue Spalte in der Datei. Das ist
-- die Entscheidung der B19-Nachbesserung, wörtlich übernommen: „eine zusätzliche Spalte im Export
-- änderte ein Dateiformat, auf das ausserhalb dieses Repos jemand baut." Ein Filter, der die
-- Zeilenmenge einschränkt, ändert dieses Format nicht — eine Spalte täte es. Folge, bewusst in
-- Kauf genommen: Man kann nach einer formlos genannten Firma FILTERN, und die ausgeführte Datei
-- weist sie nicht aus. Wer das ändern will, ändert ein Dateiformat und braucht dafür eine eigene
-- Entscheidung.
--
-- ── WARUM KEIN INDEX ────────────────────────────────────────────────────────────────────────────
-- Die neuen Bedingungen sind Substring-Suchen (`ilike '%…%'`) und eine Zeitzonen-Umrechnung auf
-- `created_at` — beides ist von einem gewöhnlichen B-Tree nicht bedienbar; es bräuchte trigram- bzw.
-- Ausdrucksindizes. Der Bestand liegt im dreistelligen Bereich, und die Filter laufen ausschliesslich
-- im Admin-Bereich mit einem einzigen Benutzer. Einen Index auf Verdacht anzulegen, hiesse eine
-- Struktur zu pflegen, deren Nutzen niemand gemessen hat. B3-1 hat seine Teilindizes zusammen mit
-- dem Filter bekommen, weil sie DORT die Segmentierung des Gesamtbestands tragen — hier ist die
-- Frage eine andere, und sie ist heute nicht gestellt.
--
-- ── ARBEITSREGEL 1 (vor jedem DROP alle Aufrufer erheben) ───────────────────────────────────────
-- Über `pg_get_functiondef` ALLER Funktionen in `public` und `platform` erhoben, dazu `pg_views`:
--   platform.leads_matching      ← public.admin_list_leads, public.admin_export_leads
--   platform.lead_filter_summary ← public.admin_export_leads
--   public.admin_list_leads      ← kein Datenbank-Aufrufer
--   public.admin_export_leads    ← kein Datenbank-Aufrufer
--   Views/Constraints darauf: 0
-- Alle vier werden hier gemeinsam neu angelegt; es bleibt kein Rumpf zurück, der eine alte Signatur
-- ruft. Im Anwendungscode rufen `app/admin/(intern)/leads/page.tsx`,
-- `app/admin/(intern)/analysen/neu/page.tsx` und `app/admin/(intern)/leads/export/route.ts` — alle
-- drei mit BENANNTEN Argumenten, und alle neuen Parameter haben einen Vorgabewert. Jeder bestehende
-- Aufruf bleibt damit gültig, auch ein positionaler.
--
-- ── KONVENTIONEN (exakt T4-1/B1-1/B2-1/B16-1/B18-5) ─────────────────────────────────────────────
-- Alles Fachliche in `platform`, Zugriff von aussen ausschliesslich über SECURITY-DEFINER-Wrapper im
-- `public`-Schema, alle Funktionen mit `SET search_path = ''` und vollqualifizierten Objektnamen,
-- erst `revoke all … from public, anon, authenticated, service_role`, dann gezielt grants. `anon`
-- bekommt NIRGENDS etwas.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 0 — platform.like_pattern: die EINE Definition der Freitext-Maskierung
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- B1-3 hat die Maskierung der LIKE-Sonderzeichen eingeführt, mit der Begründung: „ein getipptes `%`
-- soll nicht plötzlich alles treffen — der Admin sucht eine Adresse, er schreibt kein Muster."
-- Bisher stand sie genau einmal (für `p_search`) mitten in `leads_matching`. Mit sechs weiteren
-- Textfiltern stünde derselbe dreifach verschachtelte `replace`-Ausdruck siebenmal untereinander,
-- und beim ersten Abschreibfehler suchte EINE Spalte anders als die übrigen — sichtbar wäre das
-- nur daran, dass ein Treffer fehlt.
--
-- Der `escape '\'`-Zusatz gehört zwingend an JEDE Verwendung: ohne ihn ist der Backslash in
-- `ilike` kein Fluchtzeichen, und die Maskierung liefe ins Leere.
create function platform.like_pattern(p_input text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(btrim(coalesce(p_input, '')), '') is null then null
    -- Reihenfolge ist zwingend: der Backslash ZUERST, sonst maskiert der letzte Durchlauf die
    -- Fluchtzeichen der vorherigen gleich mit.
    else '%' || replace(replace(replace(btrim(p_input), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;
$$;

comment on function platform.like_pattern(text) is
  'Freitexteingabe → ILIKE-Muster mit maskierten Sonderzeichen (\, %, _), oder null bei leerer '
  'Eingabe. Die EINE Definition für alle Textfilter des Lead-Bestands: ein getipptes „%" soll '
  'suchen, nicht alles treffen. Immer mit `escape ''\''` verwenden — ohne den Zusatz ist der '
  'Backslash in ILIKE kein Fluchtzeichen und die Maskierung wirkungslos. Kein Zugriffsweg von '
  'aussen.';

revoke all on function platform.like_pattern(text)
  from public, anon, authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 0b — platform.invalid_lead_filter: die EINE Ablehnungsprüfung beider Wrapper
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Seit B2-1 stand dieselbe Liste von Ablehnungen ZWEIMAL wörtlich untereinander — einmal in
-- `admin_list_leads`, einmal in `admin_export_leads`. Mit den drei neuen Mengen-Filtern wären es
-- zwei Listen mit je zehn Prüfungen, und die Folge einer vergessenen Zeile ist asymmetrisch
-- gefährlich: Prüft die LISTE strenger als der EXPORT, lehnt die Sicht den Wert ab und die Datei
-- enthält den ungefilterten Bestand. Genau die Verdopplung, gegen die B2-1 `leads_matching`
-- eingeführt hat — nur eine Ebene höher.
--
-- Zurück kommt der NAME des beanstandeten Filters oder null. Kein `raise`: die beiden Wrapper
-- antworten fachlich (`{status: invalid_filter, filter}`) und nicht mit einem Datenbankfehler; die
-- Oberfläche kann daraus einen Satz bilden, der sagt, welches Feld gemeint ist.
--
-- Die Reihenfolge ist die aus B2-1/B16-1/B18-5 und wird NICHT umsortiert: bei mehreren zugleich
-- ungültigen Werten entscheidet sie, welcher Name zurückkommt, und darauf stehen Tests.
--
-- STABLE, nicht IMMUTABLE: die Prüfung liest `lead_sources` und `partners`.
create function platform.invalid_lead_filter(
  p_status text,
  p_consent_status text,
  p_metering_type text,
  p_postal_prefix text,
  p_partner_slug text,
  p_partner_assignment text,
  p_source_keys text[],
  p_consent_purposes text[],
  p_consent_states text[],
  p_created_from date,
  p_created_to date
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_value text;
begin
  if p_status is not null and p_status not in ('new', 'contacted', 'customer', 'anonymized') then
    return 'status';
  end if;

  if p_consent_status is not null
     and p_consent_status not in ('pending', 'confirmed', 'withdrawn', 'expired', 'none')
  then
    return 'consent_status';
  end if;

  if p_metering_type is not null
     and p_metering_type not in ('leistungsgemessen', 'netzebene_7', 'unknown')
  then
    return 'metering_type';
  end if;

  -- Der PLZ-Präfix ist eine ZIFFERNfolge von 1 bis 4 Stellen. „11a" oder „11000" könnten nie einen
  -- Treffer haben (der Spalten-CHECK erlaubt nur vier Ziffern) — eine leere Menge sähe aber aus wie
  -- „in diesem Gebiet gibt es niemanden" statt wie „diese Eingabe ergibt keinen Sinn".
  if p_postal_prefix is not null and p_postal_prefix !~ '^[0-9]{1,4}$' then
    return 'postal_prefix';
  end if;

  -- B16-1, dieselbe Regel: ein Slug, den es nicht gibt, liefert eine leere Menge, und die läse sich
  -- als „dieser Partner hat niemanden gebracht" — die schlechteste Auskunft, die man einem
  -- Fachbetrieb geben kann. Ein INAKTIVER Partner ist ausdrücklich filterbar.
  if p_partner_slug is not null
     and not exists (select 1 from platform.partners p where p.slug = p_partner_slug)
  then
    return 'partner_slug';
  end if;

  -- B18-5: ein Wert, den die Bedingung nicht kennt, filterte nichts und liesse den vollen Bestand
  -- als gefiltert erscheinen.
  if p_partner_assignment is not null
     and p_partner_assignment not in ('assigned', 'unassigned')
  then
    return 'partner_assignment';
  end if;

  -- B18-5: der eine widersprüchliche Fall. „genau dieser Fachbetrieb" UND „gar kein Fachbetrieb"
  -- ergibt per Konstruktion eine leere Menge — und die läse sich wieder als Aussage über den
  -- Bestand dieses Betriebs statt als Aussage über die Filtereingabe.
  if p_partner_slug is not null and p_partner_assignment = 'unassigned' then
    return 'partner_assignment';
  end if;

  -- Die Herkunfts-AUSWAHL wird gegen die Tabelle geprüft, nicht gegen eine Liste im Code: ein
  -- Schlüssel, den es nicht gibt, kann nur aus einer von Hand getippten Adresse stammen, und eine
  -- leere Menge läse sich als „aus diesem Kanal kam niemand".
  select s into v_value
  from unnest(coalesce(p_source_keys, '{}')) s
  where not exists (select 1 from platform.lead_sources ls where ls.key = s)
  limit 1;
  if v_value is not null then
    return 'source_keys';
  end if;

  -- Die Zwecke kommen als text[] und nicht als platform.consent_purpose[] herein — ein unbekannter
  -- Wert soll dieselbe fachliche Antwort erzeugen wie jeder andere unbekannte Filterwert. Als
  -- Enum-Array geführt scheiterte schon das Casten der Argumente, also mit einem rohen 22P02 statt
  -- mit {status: invalid_filter} (in partner-applications.test.ts einmal als Stolperstein notiert).
  select s into v_value
  from unnest(coalesce(p_consent_purposes, '{}')) s
  where not exists (
    select 1 from unnest(enum_range(null::platform.consent_purpose)) e where e::text = s
  )
  limit 1;
  if v_value is not null then
    return 'consent_purposes';
  end if;

  select s into v_value
  from unnest(coalesce(p_consent_states, '{}')) s
  where s not in ('pending', 'confirmed', 'withdrawn', 'expired', 'none')
  limit 1;
  if v_value is not null then
    return 'consent_states';
  end if;

  -- Ein verdrehter Zeitraum („ab 10.8. bis 1.8.") ergibt per Konstruktion eine leere Menge, und die
  -- läse sich als „in diesem Zeitraum kam nichts herein". Dieselbe Überlegung wie beim
  -- widersprüchlichen Partner-Paar oben.
  if p_created_from is not null and p_created_to is not null and p_created_from > p_created_to then
    return 'created_range';
  end if;

  return null;
end;
$$;

comment on function platform.invalid_lead_filter(
  text, text, text, text, text, text, text[], text[], text[], date, date
) is
  'Die EINE Ablehnungsprüfung der Lead-Filter, geteilt von public.admin_list_leads und '
  'public.admin_export_leads. Liefert den NAMEN des beanstandeten Filters oder null — die Wrapper '
  'antworten daraus fachlich mit {status: invalid_filter, filter} statt mit einem Datenbankfehler. '
  'Bis dahin stand dieselbe Liste zweimal wörtlich untereinander; eine dort vergessene Zeile ist '
  'asymmetrisch gefährlich: Prüft die LISTE strenger als der EXPORT, lehnt die Sicht den Wert ab und '
  'die ausgeführte Datei enthält den ungefilterten Bestand. Die Reihenfolge entscheidet bei mehreren '
  'ungültigen Werten, welcher Name zurückkommt, und wird deshalb nicht umsortiert. Die Themen-'
  'Schlüssel werden bewusst NICHT geprüft — platform.leads.thema trägt keinen CHECK, es gibt in der '
  'Datenbank kein Vokabular dafür. Erwartet bereits normalisierte (getrimmte, bei Slug und '
  'Zuordnung kleingeschriebene) Skalare. Kein Zugriffsweg von aussen.';

revoke all on function platform.invalid_lead_filter(
  text, text, text, text, text, text, text[], text[], text[], date, date
) from public, anon, authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — platform.leads_matching: 13 angehängte Filterparameter
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Die EINE Filterbedingung bleibt eine (B2-1): beide Wrapper reichen dieselben Parameter hierher
-- durch. Zwei eigene WHERE-Klauseln wären zwei Auslegungen desselben Filters, und die Abweichung
-- fiele erst an einer ausgeführten Datei auf, die andere Zeilen enthält als die Sicht, aus der sie
-- entstand.
--
-- ── DIE SECHS TEXTFILTER SIND EIGENE PARAMETER, NICHT EIN ERWEITERTES `p_search` ────────────────
-- `p_search` durchsucht E-Mail ODER Firma. Für eine spaltenweise Bedienung ist das genau das
-- Falsche: Wer im Kopf der Spalte „Firma" sucht, meint die Firma — träfe die Eingabe zusätzlich
-- E-Mail-Adressen, stünden im Ergebnis Zeilen, deren Firmenspalte den Suchbegriff nicht enthält,
-- und die Liste widerspräche sichtbar ihrem eigenen Filter. `p_search` BLEIBT unverändert
-- bestehen: es ist über eine gespeicherte Adresse weiter erreichbar, und die Analysen-Seite
-- (`app/admin/(intern)/analysen/neu`) benutzt es als Lead-Suche.
--
-- ── HERKUNFT: EINE SCHLÜSSELMENGE, KEINE KATEGORIE ──────────────────────────────────────────────
-- Die Oberfläche zeigt DREI Kategorien („Kontaktformular", „über einen Partner", „Manuelle Admin
-- Eingabe"), die Datenbank kennt 15 Schlüssel. Die Zuordnung bleibt bewusst im Anwendungscode
-- (`apps/web/lib/admin/lead-source-categories.ts`) und wird hier NICHT nachgebaut: `lead_sources`
-- ist eine TABELLE, weil laufend neue Einstiegspunkte dazukommen (B1-1/B3) — eine Kategorien-Regel
-- in der Datenbank wäre eine zweite Taxonomie neben der Anzeige, und beim nächsten Einstiegspunkt
-- sagten die beiden Verschiedenes.
--
-- Der Anwendungscode kann das gefahrlos, weil er die vollständige Schlüsselliste kennt
-- (`LEAD_SOURCE_KEYS`) UND das DB-Gate in BEIDE Richtungen pinnt, dass sie genau den aktiven
-- `lead_sources` entspricht (`lead-source-registry.test.ts`). Ein neuer Schlüssel ohne
-- Registry-Eintrag macht das Gate rot, bevor er hier ankommen kann.
--
-- `p_source_key` (Einzahl, B1-3) BLEIBT und wirkt unabhängig weiter — beide Bedingungen gelten
-- UND-verknüpft wie jeder andere Filter auch. Die neue Oberfläche setzt nur die Mehrzahl-Form.
--
-- ── THEMA: KATEGORIAL, obwohl die Spalte Text ist ───────────────────────────────────────────────
-- `platform.leads.thema` speichert den SCHLÜSSEL (`peakShaving`, `esg`, …), angezeigt wird das
-- übersetzte Label („Peak Shaving / Kalkulator"). Ein Suchfeld darüber wäre eine Falle: Wer den
-- Text abtippt, den er vor sich sieht, fände nichts. Deshalb eine Schlüsselmenge zum Ankreuzen —
-- dieselbe Bedienung wie bei Herkunft und aus demselben Grund (eine geschlossene, kurze Werteliste).
--
-- ⚠ EINE PRÜFUNG DER SCHLÜSSEL GIBT ES HIER BEWUSST NICHT, und das ist kein Versehen: `thema` trägt
-- ausdrücklich KEINEN CHECK (die Werteliste ist datengetrieben aus der Leistungs-Taxonomie, ein
-- Constraint wäre eine zweite und liesse die Erfassung beim ersten Rename mit 23514 scheitern). Die
-- Datenbank hat also gar kein Vokabular, gegen das sie prüfen könnte. Ein unbekannter Schlüssel
-- trifft folglich nichts — was hier die richtige Antwort ist: Es gibt keine gültige Menge, die er
-- meinen könnte.
--
-- `p_thema_none` ist ein EIGENER Parameter und kein Zauberwert im Array. Ein Sonderwert („kein
-- Thema" als Zeichenkette) wäre ein Schlüssel, den ein späterer Leistungs-Rename versehentlich
-- vergeben könnte — und dann hiesse ein echtes Thema plötzlich „ohne Thema".
--
-- ── EINWILLIGUNGEN: MEHRFACHAUSWAHL ÜBER ZWECK UND ZUSTAND ──────────────────────────────────────
-- Die Verallgemeinerung der beiden Skalare aus B1-3. `'none'` behält seine dortige Bedeutung
-- („KEINE passende Einwilligung") und darf mit echten Zuständen zusammen angekreuzt sein — dann
-- gilt die ODER-Verknüpfung, wie man es von einer Ankreuzliste erwartet.
--
-- ── DATUM: DIE ZEITZONE IST HIER KEINE KOSMETIK ─────────────────────────────────────────────────
-- Gefiltert wird über `(created_at at time zone 'Europe/Vienna')::date` — genau die Zeitzone, in der
-- die Spalte auch ANGEZEIGT wird (`lib/admin/format.ts`, fest auf de-AT/Europe/Vienna). Ohne die
-- Umrechnung filterte die Datenbank in UTC: Ein Lead, der am 5. um 00:30 Wiener Zeit hereinkommt,
-- steht in der Liste unter dem 5., fiele aber aus einem Filter „ab dem 5." heraus — und der Fehler
-- träfe ausgerechnet die Nachtstunden, in denen niemand nachsieht.
--
-- Beide Grenzen sind EINSCHLIESSLICH. Wer „bis 5.8." wählt, meint diesen Tag mit; ein `<`-Vergleich
-- gegen einen Zeitstempel liesse still alles nach Mitternacht des Vortags herausfallen.
drop function platform.leads_matching(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text
);

create function platform.leads_matching(
  p_status text default null,
  p_source_key text default null,
  p_consent_purpose platform.consent_purpose default null,
  p_consent_status text default null,
  p_search text default null,
  p_due_only boolean default false,
  p_industry platform.industry default null,
  p_metering_type text default null,
  p_postal_prefix text default null,
  p_consumption_min integer default null,
  p_consumption_max integer default null,
  p_contract_end_from date default null,
  p_contract_end_to date default null,
  p_partner_slug text default null,
  p_partner_assignment text default null,
  -- Die dreizehn Spaltenfilter, ANGEHÄNGT und je mit Vorgabewert — jeder bestehende Aufruf bleibt
  -- gültig, auch ein positionaler.
  p_email text default null,
  p_company text default null,
  p_first_name text default null,
  p_last_name text default null,
  p_phone text default null,
  p_assignment text default null,
  p_source_keys text[] default null,
  p_thema_keys text[] default null,
  p_thema_none boolean default false,
  p_consent_purposes text[] default null,
  p_consent_states text[] default null,
  p_created_from date default null,
  p_created_to date default null
)
returns setof platform.leads
language sql
stable
set search_path = ''
as $$
  with args as (
    select nullif(btrim(coalesce(p_status, '')), '')         as f_status,
           nullif(btrim(coalesce(p_source_key, '')), '')     as f_source,
           nullif(btrim(coalesce(p_consent_status, '')), '') as f_cstatus,
           nullif(btrim(coalesce(p_metering_type, '')), '')  as f_metering,
           nullif(btrim(coalesce(p_postal_prefix, '')), '')  as f_prefix,
           -- Kleingeschrieben aus demselben Grund wie in capture_lead: jeder gespeicherte Slug ist
           -- per CHECK kleingeschrieben, ein Kleinschreiben der Eingabe kann also nur treffen.
           lower(nullif(btrim(coalesce(p_partner_slug, '')), '')) as f_partner,
           -- B18-5. Kleingeschrieben aus demselben Grund wie oben, und weil die Wrapper gegen
           -- dieselbe kleingeschriebene Fassung prüfen — sonst liesse sich mit „Assigned" an der
           -- Wrapper-Prüfung vorbei ein Filter setzen, der hier nicht mehr greift.
           lower(nullif(btrim(coalesce(p_partner_assignment, '')), '')) as f_passign,
           coalesce(p_due_only, false)                       as f_due,
           -- Die Maskierung steht seit dieser Migration an EINER Stelle (TEIL 0) — sieben
           -- untereinander abgeschriebene replace-Ketten wären sieben Gelegenheiten, sich zu
           -- vertippen, und der Fehler äusserte sich nur als fehlender Treffer.
           platform.like_pattern(p_search)     as f_pattern,
           platform.like_pattern(p_email)      as f_email,
           platform.like_pattern(p_company)    as f_company,
           platform.like_pattern(p_first_name) as f_first,
           platform.like_pattern(p_last_name)  as f_last,
           platform.like_pattern(p_phone)      as f_phone,
           platform.like_pattern(p_assignment) as f_assignment,
           -- Ein LEERES Array ist KEIN Filter, sondern die Abwesenheit eines Filters — nicht die
           -- leere Menge. Die Oberfläche schickt gar nichts, wenn nichts angekreuzt ist; käme
           -- trotzdem ein leeres Array an, wäre „0 Treffer, weil nichts angekreuzt ist" eine
           -- Sackgasse, aus der die Liste selbst nicht mehr herausführt.
           case when p_source_keys is null or cardinality(p_source_keys) = 0
                then null else p_source_keys end             as f_source_keys,
           case when p_thema_keys is null or cardinality(p_thema_keys) = 0
                then null else p_thema_keys end              as f_thema_keys,
           coalesce(p_thema_none, false)                     as f_thema_none,
           case when p_consent_purposes is null or cardinality(p_consent_purposes) = 0
                then null else p_consent_purposes end        as f_purposes,
           case when p_consent_states is null or cardinality(p_consent_states) = 0
                then null else p_consent_states end          as f_states
  )
  select ld.*
  from platform.leads ld, args a
  where (a.f_status is null or ld.status = a.f_status)
    and (a.f_source is null or ld.first_source_key = a.f_source)
    -- Die Mehrzahl-Form daneben, nicht statt dessen: beide sind eigenständige UND-Bedingungen wie
    -- jeder andere Filter auch (s. Kopf dieses Teils).
    and (a.f_source_keys is null or ld.first_source_key = any(a.f_source_keys))
    -- „Zur Anonymisierung fällig": Frist erreicht UND noch nicht anonymisiert. Ohne die zweite
    -- Bedingung stünden bereits erledigte Fälle dauerhaft in der Arbeitsliste.
    and (not a.f_due or (ld.deletion_due_at <= now() and ld.anonymized_at is null))
    and (
      a.f_pattern is null
      or ld.email ilike a.f_pattern escape '\'
      or coalesce(ld.company, '') ilike a.f_pattern escape '\'
    )
    -- ── Die sechs spaltenweisen Textfilter ───────────────────────────────────────────────────────
    -- `coalesce(…, '')` überall dort, wo die Spalte nullable ist: `x ilike y` ist bei x = NULL
    -- selbst NULL und damit nicht wahr — ohne coalesce verhielte sich die Bedingung richtig, aber
    -- die Absicht („ein leeres Feld trifft keinen Suchbegriff") stünde nirgends.
    and (a.f_email   is null or ld.email ilike a.f_email escape '\')
    and (a.f_company is null or coalesce(ld.company, '')    ilike a.f_company escape '\')
    and (a.f_first   is null or coalesce(ld.first_name, '') ilike a.f_first   escape '\')
    and (a.f_last    is null or coalesce(ld.last_name, '')  ilike a.f_last    escape '\')
    and (a.f_phone   is null or coalesce(ld.phone, '')      ilike a.f_phone   escape '\')
    -- ── Zuordnung: EIN Suchbegriff über DREI Quellen ─────────────────────────────────────────────
    -- Die Spalte zeigt je nach Herkunft Verschiedenes (Fachbetrieb · formlos genannte Firma ·
    -- „empfohlen von"-Freitext). Ein Filter, der nur eine davon durchsuchte, fände genau die Zeilen
    -- nicht, die im sichtbaren Text den Suchbegriff tragen — die Liste widerspräche ihrem Filter.
    --
    -- Das ist ausdrücklich etwas ANDERES als `p_partner_slug`/`p_partner_assignment`: die beiden
    -- fragen nach der ZUORDNUNG (dem Urteil), dieser hier nach dem angezeigten Text. Sie stehen
    -- deshalb nebeneinander und ersetzen einander nicht (B16-1: Beobachtung ist nicht Urteil).
    and (
      a.f_assignment is null
      or coalesce(ld.referred_by_text, '') ilike a.f_assignment escape '\'
      or exists (
           select 1 from platform.partners p
            where p.slug = ld.partner_slug
              and p.display_name ilike a.f_assignment escape '\'
         )
      or exists (
           select 1 from platform.mentioned_businesses mb
            where mb.id = ld.mentioned_business_id
              and mb.name ilike a.f_assignment escape '\'
         )
    )
    -- ── Thema: Ankreuzliste, „ohne Thema" als eigener Parameter ──────────────────────────────────
    and (
      case
        when a.f_thema_keys is null and not a.f_thema_none then true
        else (a.f_thema_keys is not null and ld.thema = any(a.f_thema_keys))
             or (a.f_thema_none and ld.thema is null)
      end
    )
    -- ── Anlagedatum, in Wiener Ortszeit und mit einschliessenden Grenzen (s. Kopf) ───────────────
    and (
      p_created_from is null
      or (ld.created_at at time zone 'Europe/Vienna')::date >= p_created_from
    )
    and (
      p_created_to is null
      or (ld.created_at at time zone 'Europe/Vienna')::date <= p_created_to
    )
    -- ── B2-1: die Segmentierungsdimensionen aus B3-1 ─────────────────────────────────────────────
    and (p_industry is null or ld.industry = p_industry)
    and (a.f_metering is null or ld.metering_type = a.f_metering)
    -- PLZ-PRÄFIX statt Gleichheit: die führenden Ziffern einer österreichischen PLZ sind das
    -- Netzgebiet („11" trifft die Wiener Innenbezirke). Ein Gleichheitsfilter zwänge dazu, ein
    -- Gebiet als Aufzählung einzelner Postleitzahlen zu treffen — und eine vergessene wäre nicht
    -- sichtbar, sondern nur eine etwas kleinere Menge.
    and (a.f_prefix is null or ld.postal_code like a.f_prefix || '%')
    and (p_consumption_min is null or ld.annual_consumption_kwh >= p_consumption_min)
    and (p_consumption_max is null or ld.annual_consumption_kwh <= p_consumption_max)
    and (p_contract_end_from is null or ld.contract_end_date >= p_contract_end_from)
    and (p_contract_end_to is null or ld.contract_end_date <= p_contract_end_to)
    -- ── B16-1: die BESTÄTIGTE Zuordnung, nicht der Freitext ──────────────────────────────────────
    -- Gefiltert wird ausschliesslich über partner_slug. Ein Filter, der zusätzlich den Freitext
    -- durchsuchte, vermischte Beobachtung und Urteil genau dort, wo die Trennung zählt: die Frage
    -- lautet „welche Leads sind diesem Fachbetrieb ZUGESCHRIEBEN", nicht „wer hat seinen Namen
    -- erwähnt". Für die zweite Frage gibt es seit dieser Migration `p_assignment` — als eigenen
    -- Parameter, damit die beiden nicht verwechselt werden können.
    and (a.f_partner is null or ld.partner_slug = a.f_partner)
    -- ── B18-5: „irgendein Fachbetrieb" statt „genau dieser" ──────────────────────────────────────
    -- Dieselbe Spalte, andere Frage. Sie steht bewusst als EIGENE Bedingung neben dem Slug-Filter
    -- statt ihn zu ersetzen: die beiden schliessen einander nicht aus, und der Slug-Filter ist der
    -- einzige Weg, die Leads EINES Betriebs zu sehen (Grundlage jeder Partner-Auswertung).
    -- Gefiltert wird auch hier über die ZUORDNUNG, nicht über den Freitext — ein Lead mit Freitext
    -- und ohne Zuordnung gilt als „ohne Fachbetrieb", und das ist genau der Fall, den ein Mensch
    -- noch entscheiden muss.
    and (
      a.f_passign is null
      or (a.f_passign = 'assigned' and ld.partner_slug is not null)
      or (a.f_passign = 'unassigned' and ld.partner_slug is null)
    )
    -- ── Einwilligungen: die Skalare aus B1-3 ─────────────────────────────────────────────────────
    and (
      case
        when p_consent_purpose is null and a.f_cstatus is null then true
        -- 'none' ist die Umkehrung: KEINE (passende) Einwilligung. Ohne Zweck heisst das „gar
        -- keine Einwilligung", mit Zweck „keine für diesen Zweck".
        when a.f_cstatus = 'none' then not exists (
          select 1
          from platform.consents c
          join platform.consent_texts ct on ct.id = c.consent_text_id
          where c.lead_id = ld.id
            and (p_consent_purpose is null or ct.purpose = p_consent_purpose)
        )
        else exists (
          select 1
          from platform.consents c
          join platform.consent_texts ct on ct.id = c.consent_text_id
          where c.lead_id = ld.id
            and (p_consent_purpose is null or ct.purpose = p_consent_purpose)
            and (
              a.f_cstatus is null
              or platform.consent_effective_status(c.status, c.token_expires_at) = a.f_cstatus
            )
        )
      end
    )
    -- ── Einwilligungen: die Mehrfachauswahl daneben ──────────────────────────────────────────────
    -- Verallgemeinerung derselben Frage, deshalb dieselbe Struktur. Der Unterschied ist die
    -- ODER-Verknüpfung INNERHALB einer Ankreuzliste: „bestätigt oder offen" ist eine Auswahl, keine
    -- zwei Filter. `'none'` darf dabei mit echten Zuständen zusammenstehen — dann greift entweder
    -- der eine oder der andere Zweig.
    --
    -- Im zweiten Zweig bleibt `'none'` bewusst im Array stehen, statt herausgefiltert zu werden:
    -- `platform.consent_effective_status` liefert diesen Wert nie, der Vergleich kann also nicht
    -- versehentlich zutreffen — und ein zusätzliches Herausfiltern wäre eine Stelle mehr, an der
    -- die beiden Zweige auseinanderlaufen könnten.
    and (
      case
        when a.f_purposes is null and a.f_states is null then true
        else (
          a.f_states is not null
          and 'none' = any(a.f_states)
          and not exists (
            select 1
            from platform.consents c
            join platform.consent_texts ct on ct.id = c.consent_text_id
            where c.lead_id = ld.id
              and (a.f_purposes is null or ct.purpose::text = any(a.f_purposes))
          )
        )
        or (
          -- Nur wenn überhaupt ein echter Zustand angekreuzt ist (oder gar keiner — dann zählt
          -- jeder Zustand). Ohne diese Bedingung träfe „nur 'none' angekreuzt" auch jeden Lead MIT
          -- Einwilligung, und die Auswahl bewirkte das Gegenteil ihrer Beschriftung.
          (a.f_states is null or exists (select 1 from unnest(a.f_states) s where s <> 'none'))
          and exists (
            select 1
            from platform.consents c
            join platform.consent_texts ct on ct.id = c.consent_text_id
            where c.lead_id = ld.id
              and (a.f_purposes is null or ct.purpose::text = any(a.f_purposes))
              and (
                a.f_states is null
                or platform.consent_effective_status(c.status, c.token_expires_at) = any(a.f_states)
              )
          )
        )
      end
    );
$$;

comment on function platform.leads_matching(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date
) is
  'B2-1, erweitert in B16-1, B18-5 und um die Spaltenfilter: die EINE Filterbedingung des '
  'Lead-Bestands, benutzt von public.admin_list_leads UND public.admin_export_leads. Zwei eigene '
  'WHERE-Klauseln wären zwei Auslegungen desselben Filters, und die Abweichung fiele erst an einer '
  'ausgeführten Datei auf, die andere Zeilen enthält als die Sicht, aus der sie entstand. Filtert '
  'nur — projiziert nicht und prüft keine Rechte (das machen die Wrapper). SECHS spaltenweise '
  'Textfilter (p_email, p_company, p_first_name, p_last_name, p_phone, p_assignment) neben dem '
  'älteren p_search, das E-Mail UND Firma gemeinsam durchsucht und deshalb für eine spaltenweise '
  'Bedienung ungeeignet ist. p_assignment durchsucht die DREI Quellen der Zuordnungsspalte '
  '(Anzeigename des Fachbetriebs, Name der formlos genannten Firma, referred_by_text) und ist '
  'ausdrücklich etwas anderes als p_partner_slug/p_partner_assignment: die fragen nach dem URTEIL, '
  'dieser nach dem angezeigten Text. p_source_keys ist die Mengen-Form von p_source_key (die drei '
  'Anzeige-Kategorien werden im Anwendungscode zu Schlüsseln aufgelöst — lead_sources ist eine '
  'Tabelle, eine Kategorienregel hier wäre eine zweite Taxonomie). p_thema_keys/p_thema_none sind '
  'kategorial, weil gespeichert der Schlüssel und angezeigt das Label ist; die Schlüssel werden '
  'NICHT geprüft (thema trägt bewusst keinen CHECK, es gibt kein Vokabular dafür). '
  'p_consent_purposes/p_consent_states sind die Mehrfachauswahl-Form der B1-3-Skalare, mit '
  'unveränderter ''none''-Bedeutung. p_created_from/-to filtern in EUROPE/VIENNA und mit '
  'EINSCHLIESSENDEN Grenzen — dieselbe Zeitzone, in der die Spalte angezeigt wird; in UTC fiele ein '
  'nachts erfasster Lead aus dem Filter seines eigenen Anzeigetags. Ein leeres Array ist kein '
  'Filter, sondern die Abwesenheit eines Filters. Kein Zugriffsweg von aussen.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — platform.lead_filter_summary: dieselben 13 Parameter
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Zieht mit, weil sonst eine Ausfuhr mit gesetzten Spaltenfiltern im Protokoll als „alle" stünde —
-- also als die grösstmögliche Menge, obwohl eine kleine ausgeführt wurde. Ein Protokoll, das den
-- angewandten Filter nicht nennt, ist bei einer Datei, die das System verlässt, schlimmer als
-- keines: es behauptet Vollständigkeit.
--
-- IMMUTABLE bleibt sie, und deshalb nennt sie weiterhin SCHLÜSSEL statt Anzeigenamen (B16-1): der
-- Slug ist unveränderlich, der Anzeigename korrigierbar — ein Protokoll, dessen Aussage sich mit
-- einer späteren Umbenennung ändert, ist keins. Aus demselben Grund steht bei Thema und Herkunft
-- der Schlüssel und nicht das Label.
drop function platform.lead_filter_summary(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text
);

create function platform.lead_filter_summary(
  p_status text default null,
  p_source_key text default null,
  p_consent_purpose platform.consent_purpose default null,
  p_consent_status text default null,
  p_search text default null,
  p_due_only boolean default false,
  p_industry platform.industry default null,
  p_metering_type text default null,
  p_postal_prefix text default null,
  p_consumption_min integer default null,
  p_consumption_max integer default null,
  p_contract_end_from date default null,
  p_contract_end_to date default null,
  p_partner_slug text default null,
  p_partner_assignment text default null,
  p_email text default null,
  p_company text default null,
  p_first_name text default null,
  p_last_name text default null,
  p_phone text default null,
  p_assignment text default null,
  p_source_keys text[] default null,
  p_thema_keys text[] default null,
  p_thema_none boolean default false,
  p_consent_purposes text[] default null,
  p_consent_states text[] default null,
  p_created_from date default null,
  p_created_to date default null
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[] := '{}';
  v_passign text := lower(nullif(btrim(coalesce(p_partner_assignment, '')), ''));
begin
  if nullif(btrim(coalesce(p_search, '')), '') is not null then
    v_parts := v_parts || ('Suche: ' || btrim(p_search));
  end if;
  -- Die sechs Spaltenfilter, benannt wie die Spalte, in der sie stehen — wer das Protokoll liest,
  -- soll die Sicht rekonstruieren können, ohne den Anwendungscode zu kennen.
  if nullif(btrim(coalesce(p_email, '')), '') is not null then
    v_parts := v_parts || ('E-Mail enthält: ' || btrim(p_email));
  end if;
  if nullif(btrim(coalesce(p_company, '')), '') is not null then
    v_parts := v_parts || ('Firma enthält: ' || btrim(p_company));
  end if;
  if nullif(btrim(coalesce(p_first_name, '')), '') is not null then
    v_parts := v_parts || ('Vorname enthält: ' || btrim(p_first_name));
  end if;
  if nullif(btrim(coalesce(p_last_name, '')), '') is not null then
    v_parts := v_parts || ('Name enthält: ' || btrim(p_last_name));
  end if;
  if nullif(btrim(coalesce(p_phone, '')), '') is not null then
    v_parts := v_parts || ('Telefon enthält: ' || btrim(p_phone));
  end if;
  if nullif(btrim(coalesce(p_assignment, '')), '') is not null then
    v_parts := v_parts || ('Zuordnung enthält: ' || btrim(p_assignment));
  end if;
  if nullif(btrim(coalesce(p_status, '')), '') is not null then
    v_parts := v_parts || ('Status: ' || btrim(p_status));
  end if;
  if nullif(btrim(coalesce(p_source_key, '')), '') is not null then
    v_parts := v_parts || ('Herkunft: ' || btrim(p_source_key));
  end if;
  -- Die SCHLÜSSEL, nicht die drei Anzeige-Kategorien: die Kategorie ist eine Entscheidung der
  -- Oberfläche und kann sich ändern (ein neuer Einstiegspunkt fällt automatisch in eine davon) —
  -- die Schlüsselmenge ist das, was tatsächlich gefiltert hat.
  if p_source_keys is not null and cardinality(p_source_keys) > 0 then
    v_parts := v_parts || ('Herkunft (Auswahl): ' || array_to_string(p_source_keys, ', '));
  end if;
  if p_consent_purpose is not null then
    v_parts := v_parts || ('Einwilligungszweck: ' || p_consent_purpose::text);
  end if;
  if nullif(btrim(coalesce(p_consent_status, '')), '') is not null then
    v_parts := v_parts || ('Einwilligungszustand: ' || btrim(p_consent_status));
  end if;
  if p_consent_purposes is not null and cardinality(p_consent_purposes) > 0 then
    v_parts := v_parts || ('Einwilligungszwecke: ' || array_to_string(p_consent_purposes, ', '));
  end if;
  if p_consent_states is not null and cardinality(p_consent_states) > 0 then
    v_parts := v_parts || ('Einwilligungszustände: ' || array_to_string(p_consent_states, ', '));
  end if;
  if p_thema_keys is not null and cardinality(p_thema_keys) > 0 then
    v_parts := v_parts || ('Thema: ' || array_to_string(p_thema_keys, ', '));
  end if;
  -- `::text` wie bei den übrigen nackten Literalen (s. u.) — ohne den Cast löst Postgres den
  -- `||`-Operator als `anyarray || anyarray` auf und bricht mit 22P02 ab.
  if coalesce(p_thema_none, false) then
    v_parts := v_parts || 'ohne Thema'::text;
  end if;
  if p_created_from is not null then
    v_parts := v_parts || ('Eingegangen ab ' || to_char(p_created_from, 'DD.MM.YYYY'));
  end if;
  if p_created_to is not null then
    v_parts := v_parts || ('Eingegangen bis ' || to_char(p_created_to, 'DD.MM.YYYY'));
  end if;
  -- ⚠ DER CAST IST DIE BEHEBUNG EINES BESTEHENDEN FEHLERS AUS B2-1, kein Stilmittel.
  -- `text[] || 'literal'` ist mehrdeutig: Postgres kann den Operator als `anyarray || anyelement`
  -- ODER als `anyarray || anyarray` auflösen und wählt hier das Array — die untypisierte Zeichenkette
  -- wird dann als Array-Literal gelesen und die Funktion bricht mit 22P02 („malformed array
  -- literal"). Die übrigen Zweige sind nicht betroffen, weil sie eine Verkettung übergeben
  -- (`'Suche: ' || btrim(...)`), die bereits `text` ist — betroffen sind ausschliesslich die
  -- Zweige mit einem NACKTEN Literal.
  if coalesce(p_due_only, false) then
    v_parts := v_parts || 'nur zur Anonymisierung fällige'::text;
  end if;
  if p_industry is not null then
    v_parts := v_parts || ('Branche: ' || p_industry::text);
  end if;
  if nullif(btrim(coalesce(p_metering_type, '')), '') is not null then
    v_parts := v_parts || ('Messart: ' || btrim(p_metering_type));
  end if;
  if nullif(btrim(coalesce(p_postal_prefix, '')), '') is not null then
    v_parts := v_parts || ('PLZ beginnt mit ' || btrim(p_postal_prefix));
  end if;
  if p_consumption_min is not null then
    v_parts := v_parts || ('Jahresverbrauch ab ' || p_consumption_min::text || ' kWh');
  end if;
  if p_consumption_max is not null then
    v_parts := v_parts || ('Jahresverbrauch bis ' || p_consumption_max::text || ' kWh');
  end if;
  if p_contract_end_from is not null then
    v_parts := v_parts || ('Vertragsende ab ' || to_char(p_contract_end_from, 'DD.MM.YYYY'));
  end if;
  if p_contract_end_to is not null then
    v_parts := v_parts || ('Vertragsende bis ' || to_char(p_contract_end_to, 'DD.MM.YYYY'));
  end if;
  -- B16-1. Der SLUG wird protokolliert, nicht der Anzeigename: der Slug ist unveränderlich, der
  -- Anzeigename korrigierbar — ein Protokoll, dessen Aussage sich später mit einer Umbenennung
  -- ändert, ist kein Protokoll. (Aus demselben Grund ist die Funktion IMMUTABLE und liest die
  -- Partnertabelle gar nicht erst.)
  if nullif(btrim(coalesce(p_partner_slug, '')), '') is not null then
    v_parts := v_parts || ('Partner: ' || lower(btrim(p_partner_slug)));
  end if;
  -- B18-5. Bewusst als eigenständiger Satzteil und NICHT als „Partner: zugeordnet": neben der
  -- Zeile „Partner: <slug>" wäre das zweimal dasselbe Wort für zwei verschiedene Aussagen, und wer
  -- das Protokoll später liest, müsste raten, ob ein einzelner Betrieb gemeint war. Form wie
  -- „nur zur Anonymisierung fällige".
  -- `::text` aus demselben Grund wie beim Zweig darüber — nacktes Literal, sonst 22P02.
  if v_passign = 'assigned' then
    v_parts := v_parts || 'nur mit Fachbetrieb-Zuordnung'::text;
  elsif v_passign = 'unassigned' then
    v_parts := v_parts || 'nur ohne Fachbetrieb-Zuordnung'::text;
  end if;

  -- „alles" ist eine ANGEWANDTE Auswahl und wird als solche protokolliert — es gibt keinen Export
  -- ohne Filter, es gibt nur den Filter „alles".
  if cardinality(v_parts) = 0 then
    return 'alle (kein Filter gesetzt) — ohne gesperrte und anonymisierte Zeilen';
  end if;

  return array_to_string(v_parts, ' · ') || ' — ohne gesperrte und anonymisierte Zeilen';
end;
$$;

comment on function platform.lead_filter_summary(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date
) is
  'B2-1, erweitert in B16-1, B18-5 und um die Spaltenfilter: der angewandte Filter als ein Satz für '
  'platform.admin_exports.filter_summary. Steht in der Datenbank und nicht im Anwendungscode, damit '
  'das Protokoll beschreibt, was tatsächlich angewandt wurde. Ein leerer Filter wird ausdrücklich '
  'als „alle" protokolliert — es gibt keinen ungefilterten Export, nur den Filter „alles". Partner, '
  'Herkunft und Thema erscheinen als SCHLÜSSEL und nicht als Anzeigename bzw. Kategorie: Schlüssel '
  'sind unveränderlich, Anzeigenamen korrigierbar und Kategorien eine Entscheidung der Oberfläche — '
  'ein Protokoll, dessen Aussage sich damit ändert, ist keins. Die B18-5-Zuordnungsfrage erscheint '
  'als eigener Satzteil und nicht als zweites „Partner: …" — sonst stünde dasselbe Wort für zwei '
  'verschiedene Aussagen.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — public.admin_list_leads: dieselben 13 Parameter + die formlose Firmenerwähnung
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- DROP + CREATE (zehnte Erweiterung der Parameterliste). FOLGE: die Grants sind weg und werden
-- unten erneut gesetzt (TEIL 5) — in B3-1 ist genau das einmal übersehen worden.
--
-- ── DIE ZWEI NEUEN SPALTEN IN DER ANTWORT ───────────────────────────────────────────────────────
-- `mentioned_business_id` UND der Name. Der Name als Unterabfrage je Zeile und NICHT als
-- Nachschlageliste wie bei den Partnern: Fachbetriebe sind eine kurze, wiederkehrende Menge (jede
-- Zeile mit Partner zeigt auf einen von wenigen), formlos genannte Firmen sind eine offene Menge,
-- von der je Seite nur eine Handvoll überhaupt vorkommt. Eine vollständige Liste mitzuschicken
-- hiesse, den gesamten Notizbestand in jede Antwort zu legen, um darin drei Namen zu finden.
--
-- ⚠ NUR DIE LISTE, NICHT DER EXPORT — s. Kopf dieser Migration.
drop function public.admin_list_leads(
  integer, integer, text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text
);

create function public.admin_list_leads(
  p_limit integer default 50,
  p_offset integer default 0,
  p_status text default null,
  p_source_key text default null,
  p_consent_purpose platform.consent_purpose default null,
  p_consent_status text default null,
  p_search text default null,
  p_due_only boolean default false,
  p_industry platform.industry default null,
  p_metering_type text default null,
  p_postal_prefix text default null,
  p_consumption_min integer default null,
  p_consumption_max integer default null,
  p_contract_end_from date default null,
  p_contract_end_to date default null,
  p_partner_slug text default null,
  p_partner_assignment text default null,
  p_email text default null,
  p_company text default null,
  p_first_name text default null,
  p_last_name text default null,
  p_phone text default null,
  p_assignment text default null,
  p_source_keys text[] default null,
  p_thema_keys text[] default null,
  p_thema_none boolean default false,
  p_consent_purposes text[] default null,
  p_consent_states text[] default null,
  p_created_from date default null,
  p_created_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit    integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset   integer := greatest(coalesce(p_offset, 0), 0);
  v_status   text    := nullif(btrim(coalesce(p_status, '')), '');
  v_cstatus  text    := nullif(btrim(coalesce(p_consent_status, '')), '');
  v_metering text    := nullif(btrim(coalesce(p_metering_type, '')), '');
  v_prefix   text    := nullif(btrim(coalesce(p_postal_prefix, '')), '');
  v_partner  text    := lower(nullif(btrim(coalesce(p_partner_slug, '')), ''));
  v_passign  text    := lower(nullif(btrim(coalesce(p_partner_assignment, '')), ''));
  v_invalid  text;
  v_total    integer;
  v_export   integer;
  v_leads    jsonb;
  v_sources  jsonb;
  v_partners jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_list_leads: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  -- Ein unbekannter Filterwert wird ABGELEHNT und nicht ignoriert: eine still verworfene
  -- Einschränkung zeigte mehr Zeilen, als der Admin angefordert hat — und er hielte das Ergebnis
  -- für gefiltert.
  v_invalid := platform.invalid_lead_filter(
    v_status, v_cstatus, v_metering, v_prefix, v_partner, v_passign,
    p_source_keys, p_consent_purposes, p_consent_states, p_created_from, p_created_to
  );
  if v_invalid is not null then
    return jsonb_build_object('status', 'invalid_filter', 'filter', v_invalid);
  end if;

  with base as (
    select ld.id, ld.email, ld.company, ld.first_name, ld.last_name, ld.phone, ld.status,
           ld.first_source_key, ld.retention_basis, ld.last_interaction_at,
           ld.deletion_due_at, ld.anonymized_at, ld.anonymized_by, ld.created_at,
           -- B2-1: die Segmentierungsmerkmale fahren in der LISTE mit. Ohne sie liesse sich ein
           -- gesetzter Filter nicht am Ergebnis nachvollziehen — man sähe nur, dass die Menge
           -- kleiner wurde, nicht warum.
           ld.industry, ld.postal_code, ld.annual_consumption_kwh, ld.metering_type,
           ld.supplier, ld.contract_end_date,
           -- B16-1: beide Felder, aus demselben Grund — und weil erst ihr NEBENEINANDER die
           -- eigentliche Arbeit sichtbar macht: ein Lead mit Freitext, aber ohne Zuordnung ist
           -- genau der Fall, den ein Mensch entscheiden muss.
           ld.partner_slug, ld.referred_by_text,
           -- Die formlose Firmenerwähnung (B19-Nachbesserung). Bis hierher stand sie NUR in
           -- admin_get_lead, also nur auf der Detailseite — die Zuordnungsspalte der Liste bliebe
           -- ohne sie ausgerechnet bei intern aufgenommenen Anfragen leer.
           ld.mentioned_business_id,
           (select mb.name
              from platform.mentioned_businesses mb
             where mb.id = ld.mentioned_business_id) as mentioned_business_name,
           -- Das Thema der Anfrage. Der SCHLÜSSEL, nicht das Label — die Anzeige löst ihn über
           -- dieselbe Liste auf, die das Dropdown füllt (findThema). Ein hier gebildetes Label wäre
           -- eine zweite Übersetzung neben messages/*.json.
           ld.thema
    from platform.leads_matching(
           p_status, p_source_key, p_consent_purpose, p_consent_status, p_search, p_due_only,
           p_industry, p_metering_type, p_postal_prefix, p_consumption_min, p_consumption_max,
           p_contract_end_from, p_contract_end_to, p_partner_slug, p_partner_assignment,
           p_email, p_company, p_first_name, p_last_name, p_phone, p_assignment,
           p_source_keys, p_thema_keys, p_thema_none, p_consent_purposes, p_consent_states,
           p_created_from, p_created_to
         ) ld
  ),
  page as (
    select b.*,
           -- Eine Sperre steht im HASH und ist durch keinen Join sichtbar; ohne diese Spalte sähe
           -- ein Admin einen scheinbar anschreibbaren Lead, der abgemeldet ist (B1-1).
           platform.is_suppressed(b.email) as is_suppressed,
           (b.deletion_due_at <= now() and b.anonymized_at is null) as deletion_due,
           coalesce((
             select jsonb_agg(
                      jsonb_build_object(
                        'purpose',          ct.purpose,
                        'status',           c.status,
                        'effective_status',
                          platform.consent_effective_status(c.status, c.token_expires_at),
                        'granted_at',       c.granted_at,
                        'confirmed_at',     c.confirmed_at,
                        'withdrawn_at',     c.withdrawn_at
                      ) order by ct.purpose, c.granted_at desc
                    )
             from platform.consents c
             join platform.consent_texts ct on ct.id = c.consent_text_id
             where c.lead_id = b.id
           ), '[]'::jsonb) as consents
    from base b
    order by b.created_at desc
    limit v_limit offset v_offset
  )
  select (select count(*)::integer from base),
         (select count(*)::integer from base b
           where b.anonymized_at is null and not platform.is_suppressed(b.email)),
         coalesce(
           (select jsonb_agg(to_jsonb(p) order by p.created_at desc) from page p),
           '[]'::jsonb
         )
    into v_total, v_export, v_leads;

  -- Die Einstiegspunkte fahren MIT, statt einen weiteren Wrapper zu brauchen: `lead_sources` ist eine
  -- TABELLE, weil laufend neue Einstiegspunkte dazukommen (B1-1/B3) — die Filterauswahl kann sie
  -- deshalb nicht als Konstante im Anwendungscode spiegeln, sonst fehlte jede neue Quelle im Filter.
  select coalesce(jsonb_agg(jsonb_build_object('key', s.key, 'label', s.label) order by s.label), '[]'::jsonb)
    into v_sources
  from platform.lead_sources s;

  -- B16-1: die Partner aus genau demselben Grund. Zusätzlich `is_active`, damit die Auswahl einen
  -- stillgelegten Fachbetrieb kennzeichnen kann, statt ihn wegzulassen — seine Leads sind ja noch da.
  select coalesce(
           jsonb_agg(
             jsonb_build_object('slug', p.slug, 'display_name', p.display_name,
                                'is_active', p.is_active)
             order by p.display_name
           ),
           '[]'::jsonb
         )
    into v_partners
  from platform.partners p;

  return jsonb_build_object(
    'status',       'ok',
    'leads',        v_leads,
    'total',        v_total,
    'export_total', v_export,
    'limit',        v_limit,
    'offset',       v_offset,
    'sources',      v_sources,
    'partners',     v_partners
  );
end;
$$;

comment on function public.admin_list_leads(
  integer, integer, text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date
) is
  'B1-1/B1-3, erweitert in B2-1, B16-1, B18-5, um thema und um die Spaltenfilter: paginierte, '
  'gefilterte Lead-Liste (neueste zuerst, limit 1..200, default 50). Filtert AUSSCHLIESSLICH über '
  'platform.leads_matching — dieselbe Bedingung, die auch public.admin_export_leads benutzt. Je '
  'Zeile zusätzlich is_suppressed, deletion_due, die Einwilligungen mit effective_status, die '
  'Segmentierungsmerkmale, partner_slug samt referred_by_text, thema sowie '
  'mentioned_business_id/-name (die formlose Firmenerwähnung der B19-Nachbesserung, bis dahin nur '
  'in admin_get_lead: ohne sie bliebe die Zuordnungsspalte der Liste ausgerechnet bei intern '
  'aufgenommenen Anfragen leer). Der Firmenname kommt als Unterabfrage je Zeile und nicht als '
  'Nachschlageliste wie die Partner — formlos genannte Firmen sind eine offene Menge, von der je '
  'Seite nur eine Handvoll vorkommt. Ein unbekannter Filterwert wird als {status: invalid_filter, '
  'filter} ABGELEHNT und nicht ignoriert; die Prüfung steht in platform.invalid_lead_filter und ist '
  'mit admin_export_leads geteilt. WIRFT bei fehlender Adminrolle (SQLSTATE 42501). '
  'authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — public.admin_export_leads: dieselben 13 Parameter
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Die Ausfuhr übernimmt GENAU den Filter, den die Sicht gerade zeigt. Nur die Liste zu erweitern
-- hiesse: ein Admin filtert eine Spalte, löst den Export aus — und bekommt eine Datei mit dem
-- GESAMTBESTAND. Beide Zahlen wären plausibel, und die Abweichung fiele erst an der Datei auf, wenn
-- sie das System bereits verlassen hat. Genau diese Überlegung hat B16-1 und B18-5 dazu gebracht,
-- ihre Filter in beide Wrapper zu legen.
--
-- ⚠ KEINE neue SPALTE in der Datei (mentioned_business) — s. Kopf dieser Migration.
drop function public.admin_export_leads(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text
);

create function public.admin_export_leads(
  p_status text default null,
  p_source_key text default null,
  p_consent_purpose platform.consent_purpose default null,
  p_consent_status text default null,
  p_search text default null,
  p_due_only boolean default false,
  p_industry platform.industry default null,
  p_metering_type text default null,
  p_postal_prefix text default null,
  p_consumption_min integer default null,
  p_consumption_max integer default null,
  p_contract_end_from date default null,
  p_contract_end_to date default null,
  p_partner_slug text default null,
  p_partner_assignment text default null,
  p_email text default null,
  p_company text default null,
  p_first_name text default null,
  p_last_name text default null,
  p_phone text default null,
  p_assignment text default null,
  p_source_keys text[] default null,
  p_thema_keys text[] default null,
  p_thema_none boolean default false,
  p_consent_purposes text[] default null,
  p_consent_states text[] default null,
  p_created_from date default null,
  p_created_to date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metering  text := nullif(btrim(coalesce(p_metering_type, '')), '');
  v_prefix    text := nullif(btrim(coalesce(p_postal_prefix, '')), '');
  v_status    text := nullif(btrim(coalesce(p_status, '')), '');
  v_cstatus   text := nullif(btrim(coalesce(p_consent_status, '')), '');
  v_partner   text := lower(nullif(btrim(coalesce(p_partner_slug, '')), ''));
  v_passign   text := lower(nullif(btrim(coalesce(p_partner_assignment, '')), ''));
  v_invalid   text;
  v_rows      jsonb;
  v_count     integer;
  v_summary   text;
  v_export_id uuid;
  v_at        timestamptz;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_export_leads: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  -- Dieselben Ablehnungen wie in admin_list_leads, und zwar buchstäblich dieselben: ein unbekannter
  -- Filterwert darf auch hier nicht still zu einer GRÖSSEREN Menge führen — bei einer Datei, die das
  -- System verlässt, erst recht nicht. Seit dieser Migration steht die Prüfung an EINER Stelle;
  -- zwei abgeschriebene Listen hätten sich beim nächsten neuen Filterwert getrennt entwickelt.
  v_invalid := platform.invalid_lead_filter(
    v_status, v_cstatus, v_metering, v_prefix, v_partner, v_passign,
    p_source_keys, p_consent_purposes, p_consent_states, p_created_from, p_created_to
  );
  if v_invalid is not null then
    return jsonb_build_object('status', 'invalid_filter', 'filter', v_invalid);
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb),
         count(*)::integer
    into v_rows, v_count
  from (
    select ld.id,
           ld.email,
           ld.company,
           ld.first_name,
           ld.last_name,
           ld.phone,
           ld.status,
           ld.first_source_key,
           (select s.label from platform.lead_sources s where s.key = ld.first_source_key)
             as first_source_label,
           ld.industry,
           ld.postal_code,
           ld.annual_consumption_kwh,
           ld.metering_type,
           ld.supplier,
           ld.contract_end_date,
           -- B16-1: die Zuordnung samt Anzeigename (ohne ihn wäre die Datei in einem fremden
           -- Werkzeug nur eine Spalte mit Schlüsseln) UND der Freitext als Beleg.
           ld.partner_slug,
           (select p.display_name from platform.partners p where p.slug = ld.partner_slug)
             as partner_display_name,
           ld.referred_by_text,
           ld.thema,
           ld.created_at,
           ld.last_interaction_at,
           -- PFLICHTSPALTE: ohne sie ist jede Zeile in einem fremden Werkzeug ununterscheidbar
           -- anschreibbar.
           platform.marketing_consent_state(ld.id) as marketing_consent
    from platform.leads_matching(
           p_status, p_source_key, p_consent_purpose, p_consent_status, p_search, p_due_only,
           p_industry, p_metering_type, p_postal_prefix, p_consumption_min, p_consumption_max,
           p_contract_end_from, p_contract_end_to, p_partner_slug, p_partner_assignment,
           p_email, p_company, p_first_name, p_last_name, p_phone, p_assignment,
           p_source_keys, p_thema_keys, p_thema_none, p_consent_purposes, p_consent_states,
           p_created_from, p_created_to
         ) ld
    where ld.anonymized_at is null
      and not platform.is_suppressed(ld.email)
  ) r;

  v_summary := platform.lead_filter_summary(
    p_status, p_source_key, p_consent_purpose, p_consent_status, p_search, p_due_only,
    p_industry, p_metering_type, p_postal_prefix, p_consumption_min, p_consumption_max,
    p_contract_end_from, p_contract_end_to, p_partner_slug, p_partner_assignment,
    p_email, p_company, p_first_name, p_last_name, p_phone, p_assignment,
    p_source_keys, p_thema_keys, p_thema_none, p_consent_purposes, p_consent_states,
    p_created_from, p_created_to
  );

  insert into platform.admin_exports (exported_by, row_count, filter_summary)
  values (auth.uid(), v_count, v_summary)
  returning id, exported_at into v_export_id, v_at;

  return jsonb_build_object(
    'status',         'ok',
    'rows',           v_rows,
    'row_count',      v_count,
    'filter_summary', v_summary,
    'export_id',      v_export_id,
    'exported_at',    v_at
  );
end;
$$;

comment on function public.admin_export_leads(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date
) is
  'B2-1, erweitert in B16-1, B18-5, um thema und um die Spaltenfilter: die gefilterte Ausfuhr des '
  'Lead-Bestands. Übernimmt GENAU den Filter der Sicht (dieselbe platform.leads_matching) und '
  'protokolliert jeden Lauf in platform.admin_exports. Schliesst gesperrte und anonymisierte Zeilen '
  'in der ABFRAGE aus, nicht über einen Filter — eine ausgeführte Datei kann in ein fremdes Werkzeug '
  'wandern, das die Sperrliste nicht kennt. Bekommt die Spaltenfilter, aber BEWUSST KEINE neue '
  'Spalte (mentioned_business): ein Filter schränkt die Zeilenmenge ein, eine Spalte änderte das '
  'Dateiformat, auf das ausserhalb dieses Repos jemand baut. WIRFT bei fehlender Adminrolle '
  '(SQLSTATE 42501). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — Rechte nach den DROPs wiederherstellen
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Ein DROP entfernt die Grants der Funktion; ohne diesen Abschnitt wäre die Lead-Liste nach der
-- Migration für JEDEN unerreichbar (in B3-1 einmal real übersehen). Zusätzlich greifen Supabases
-- ALTER DEFAULT PRIVILEGES bei einem CREATE — deshalb erst `revoke all`, dann gezielt grants.

revoke all on function public.admin_list_leads(
  integer, integer, text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date
) from public, anon, authenticated, service_role;

revoke all on function public.admin_export_leads(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date
) from public, anon, authenticated, service_role;

-- Beide authenticated-only: `service_role` bekommt bewusst KEINEN Grant. Die Rechteprüfung steht im
-- Rumpf (`platform.is_admin()`), und die kann ohne Sitzung nichts feststellen — ein Grant, der nur
-- eine Ablehnung erzeugen kann, ist Fläche ohne Gegenwert.
grant execute on function public.admin_list_leads(
  integer, integer, text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date
) to authenticated;

grant execute on function public.admin_export_leads(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date
) to authenticated;

-- Die zwei `platform`-Funktionen sind von aussen gar nicht aufrufbar und bleiben es.
revoke all on function platform.leads_matching(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date
) from public, anon, authenticated, service_role;

revoke all on function platform.lead_filter_summary(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date
) from public, anon, authenticated, service_role;
