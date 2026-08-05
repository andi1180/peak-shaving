-- Das Thema einer Kontaktanfrage wird Bestand — `platform.leads.thema`.
--
-- ⚠ MASSGEBLICH FÜR DEN STAND DIESER REIHE IST DER HANDOVER IN `apps/web/CLAUDE.md`.
--
-- ── DER ANLASS: DIE EINZIGE ANGABE DER ANFRAGE, DIE NIRGENDS ANKAM ──────────────────────────────
-- Das Kontaktformular verlangt seit jeher ein Thema (Pflichtfeld, `apps/web/lib/kontakt/themen.ts`).
-- Der gewählte Wert wurde serverseitig aufgelöst, in die Betreffzeile der internen
-- Benachrichtigungsmail geschrieben — und dann fallengelassen. Im Lead-Bestand steht er nicht.
--
-- Folge: Wer die Lead-Liste öffnet, sieht Adresse, Firma und Herkunft, aber nicht, WORUM es ging.
-- Die Frage „wie viele Anfragen kommen eigentlich zu Peak Shaving?" ist heute nur durch Durchsuchen
-- eines Postfachs zu beantworten, und zwar von Hand. Die Angabe existiert bereits, sie wird nur
-- nicht aufbewahrt.
--
-- ── DIE ZENTRALE ENTSCHEIDUNG: KEIN CHECK, KEIN ENUM, REINES text ───────────────────────────────
-- Die Werteliste des Dropdowns ist in diesem Repo ausdrücklich DATENGETRIEBEN: sie fällt aus der
-- Leistungs-Taxonomie (`LEISTUNGEN` → `lib/nav.ts`) plus zwei begründeten Zusätzen. Der Kopf von
-- `lib/kontakt/themen.ts` begründet das ausführlich — eine getippte Liste wäre eine zweite
-- Taxonomie neben der Informationsarchitektur und driftete beim ersten Leistungs-Rename ab.
--
-- Ein CHECK gegen eine feste Werteliste (oder ein Enum) wäre GENAU DIESE ZWEITE LISTE, nur eine
-- Ebene tiefer und schlechter zu ändern. Er brächte zwei Fehlermöglichkeiten, die beide teuer sind:
--
--   1. Wird eine Leistung umbenannt, schlägt die Erfassung mit SQLSTATE 23514 fehl — mitten im
--      Kontaktformular, also im teuersten Moment des Trichters. Der Absender sähe einen Fehler für
--      eine Auswahl, die ihm die Seite selbst angeboten hat. (Derselbe Constraint-Typ hat in B10-5
--      real zugeschlagen, dort am Format-CHECK von `platform.lead_sources.key`.)
--   2. Oder — schlimmer, weil still — jemand ergänzt die Leistung nur im CHECK und nicht in der
--      Taxonomie (oder umgekehrt), und die beiden Listen sagen ab da Verschiedenes.
--
-- Deshalb: `text`, nullable, ohne CHECK. Die Gültigkeit wird dort geprüft, wo die Liste ENTSTEHT —
-- `kontaktSchema` validiert mit `z.enum(THEMA_KEYS)` gegen genau die Liste, die das Dropdown
-- rendert. Die Datenbank nimmt entgegen, was diese eine Stelle durchgelassen hat.
--
-- ── GESPEICHERT WIRD DER SCHLÜSSEL, NICHT DAS LABEL ─────────────────────────────────────────────
-- `themen.ts` sagt es selbst: „`key` ist der Wert im Formular, im API-Contract UND in der internen
-- E-Mail — nie das Label. Ein Label ist übersetzbar und darf sich ändern; der Schlüssel darf es
-- nicht." Für den Bestand gilt das doppelt: Ein Label wäre eine zweite, veraltende Kopie von
-- `messages/de.json`, und eine Auswertung über zwei Sprachen zerfiele in zwei Gruppen für dieselbe
-- Sache. Die Anzeige löst den Schlüssel wieder auf — mit derselben Funktion, die das Dropdown füllt.
--
-- ── NUR EIN ERFASSUNGSWEG BEFÜLLT DIE SPALTE ────────────────────────────────────────────────────
-- Ein Thema hat nur, wer eines ausgewählt hat. Partner-Landingpage, Telefonaufnahme (B19),
-- Registrierung, Kalkulator-Registrierung, Warteliste, Rechnerergebnis und die eingebetteten
-- Artikel-Formulare übergeben nichts und lassen die Spalte null. Das ist der Grund für `nullable`
-- und zugleich der Grund gegen jeden Vorgabewert: „kein Thema angegeben" und „Thema X" sind zwei
-- verschiedene Aussagen, und ein Rückfallwert machte aus der ersten still die zweite.
--
-- ── ZUSAMMENFÜHRUNG: DER JÜNGERE WERT GEWINNT ───────────────────────────────────────────────────
-- Also die B3-1-Segmentierungsregel (`coalesce(neu, Bestand)`) und ausdrücklich NICHT die
-- Identitätsregel von company/first_name/last_name/phone/partner_slug (Bestand gewinnt). Begründung:
-- Das Thema ist kein Identitätsmerkmal, sondern das ANLIEGEN dieser Absendung. Wer vor einem Jahr
-- wegen Smart Heating geschrieben hat und heute wegen Peak Shaving schreibt, hat heute ein anderes
-- Anliegen — und die Rückmeldung soll sich am heutigen richten. Die ältere Nennung geht dabei nicht
-- verloren, wo sie hingehört: jede Anfrage hat ihre eigene interne Mail. Ein übergebenes null lässt
-- den Bestand unberührt, sonst löschte jede Erfassung über einen themenlosen Weg das Thema.
--
-- ── WAS HIER ENTSTEHT ───────────────────────────────────────────────────────────────────────────
--   TEIL 1  die Spalte `platform.leads.thema`
--   TEIL 2  `platform.guard_anonymized_lead` nachgezogen (18. Spalte)
--   TEIL 3  `public.capture_lead` — `p_thema` ANGEHÄNGT, mit Vorgabewert null
--   TEIL 4  `public.admin_list_leads` / `public.admin_export_leads` — die Spalte fährt mit
--   TEIL 5  Rechte nach dem DROP wiederherstellen
--
-- ── WAS AUSDRÜCKLICH NICHT ENTSTEHT ─────────────────────────────────────────────────────────────
-- Kein CHECK, kein Enum, keine zweite Werteliste in der Datenbank. Kein Index (es gibt noch keinen
-- Filter, der einen bräuchte — B3-1 hat seine Teilindizes zusammen mit dem Filter bekommen, nicht
-- davor). Kein Parameter in `public.admin_update_lead`: Das Thema ist die ANGABE des Absenders, kein
-- Urteil eines Admins — dieselbe Trennlinie wie zwischen `referred_by_text` und `partner_slug`
-- (B16-1). Kein Filter in `platform.leads_matching`/`lead_filter_summary`. Keine Änderung an
-- `public.admin_get_lead` und keine an der Admin-Oberfläche (Tabelle, Detailansicht, Filter) — das
-- ist der folgende Schritt, und er wird `admin_get_lead` um dieselbe eine Zeile erweitern müssen.
-- Keine Änderung an `platform.anonymize_lead` (s. TEIL 2), an den übrigen Erfassungswegen, an
-- `public.get_my_partner_leads` (ein Fachbetrieb sieht das Thema nicht) und keine an `platform.leads`
-- darüber hinaus. Kein `tenant_id`, kein neuer `consent_purpose`.
--
-- ── ARBEITSREGEL 1 ──────────────────────────────────────────────────────────────────────────────
-- Es wird keine Spalte umbenannt oder entfernt; die Regel greift hier nicht. Trotzdem geprüft, was
-- eine NEUE Spalte auf `platform.leads` umwerfen könnte: ein `insert` ohne Spaltenliste (es gibt
-- keinen — `capture_lead` listet sie auf) und ein `select *`/`%rowtype`, das eine feste Spaltenzahl
-- erwartet. Gefunden wurde genau eines: `platform.leads_matching` mit `returns setof platform.leads`
-- und `select ld.*` — das passt sich der neuen Spalte selbst an und bleibt deshalb unangetastet.
-- `public.admin_get_lead` baut seine Spaltenliste dagegen explizit auf und übernimmt die neue Spalte
-- eben NICHT von selbst (s. o., folgender Schritt).
--
-- ── KONVENTIONEN (exakt T4-1/B1-1/B2-1/B16-1/B19) ───────────────────────────────────────────────
-- Alles Fachliche in `platform`, Zugriff von aussen ausschliesslich über SECURITY-DEFINER-Wrapper im
-- `public`-Schema, alle Funktionen mit `SET search_path = ''` und vollqualifizierten Objektnamen,
-- erst `revoke all … from public, anon, authenticated, service_role`, dann gezielt grants. `anon`
-- bekommt NIRGENDS etwas.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — die Spalte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
alter table platform.leads
  add column thema text;

comment on column platform.leads.thema is
  'Das im Kontaktformular gewählte Thema — der SCHLÜSSEL aus apps/web/lib/kontakt/themen.ts '
  '(z. B. peakShaving, esg), NIE das übersetzte Label: ein Label ist änderbar und sprachabhängig, '
  'im Bestand wäre es eine zweite, veraltende Kopie von messages/*.json. BEWUSST OHNE CHECK und ohne '
  'Enum: die Werteliste ist datengetrieben aus der Leistungs-Taxonomie (LEISTUNGEN → lib/nav.ts), '
  'eine feste Liste in der Datenbank wäre eine zweite Taxonomie und liesse beim ersten '
  'Leistungs-Rename entweder die Erfassung mit 23514 scheitern (mitten im Kontaktformular) oder '
  'still abdriften. Geprüft wird dort, wo die Liste entsteht: kontaktSchema mit z.enum(THEMA_KEYS). '
  'NUR das Kontaktformular befüllt die Spalte (beide Endpunkte); alle anderen Erfassungswege lassen '
  'sie null — „kein Thema angegeben" ist eine eigene Aussage und bekommt deshalb keinen '
  'Vorgabewert. Zusammenführung bei wiederholter Erfassung: der JÜNGERE Wert gewinnt '
  '(B3-1-Segmentierungsregel) — das Thema ist das Anliegen dieser Absendung, kein '
  'Identitätsmerkmal. ÜBERLEBT die Anonymisierung (eine Themenkategorie lokalisiert niemanden, wie '
  'industry) und ist danach unveränderlich (guard_anonymized_lead).';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — platform.guard_anonymized_lead: die 18. Spalte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WARUM `platform.anonymize_lead` UNVERÄNDERT BLEIBT ──────────────────────────────────────────
-- Das Thema wird beim Anonymisieren NICHT genullt. Es ist eine grobe Kategorie aus einer
-- veröffentlichten Liste von sechs Leistungen plus zwei Zusätzen — sie ordnet ein, sie lokalisiert
-- niemanden. Exakt dieselbe Einstufung wie bei `industry`/`annual_consumption_kwh`/`metering_type`
-- (B3-1), und entlang derselben Trennlinie: „lokalisierend" gegen „grob einordnend". Ohne die
-- Kategorie verlöre jede Auswertung über den Anfragebestand nach 24 Monaten still ihren Boden.
--
-- ── WARUM SIE TROTZDEM IN DEN GUARD GEHÖRT ──────────────────────────────────────────────────────
-- Genau WEIL sie überlebt. Eine Spalte, die die Anonymisierung übersteht und danach noch geändert
-- werden kann, ist eine nachträglich umschreibbare Aussage über einen Menschen, den man gerade
-- unkenntlich gemacht hat. `industry` steht aus demselben Grund seit B3-1 im Guard.
--
-- Das ist die einzige Erweiterung dieser Migration über die Spalte und ihren Schreibweg hinaus, und
-- sie ist bewusst getroffen: Ob eine neue Spalte auf `platform.leads` in den Guard gehört, ist eine
-- Entscheidung, die beim Anlegen der Spalte fällt (so in B3-1, B4-1 und B16-1 gehalten) — sie später
-- nachzuholen hiesse, sie zu rekonstruieren.
--
-- `platform.leads.partner_slug` ist weiterhin die EINE bewusste Ausnahme (B16-1): Die Zuordnung muss
-- nachträglich feststellbar UND korrigierbar bleiben. Für das Thema gibt es keinen solchen Bedarf —
-- es gibt gar keinen Wrapper, der es nachträglich ändern könnte.
create or replace function platform.guard_anonymized_lead()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.anonymized_at is null then
    return new;
  end if;

  if new.email           is distinct from old.email
     or new.company      is distinct from old.company
     -- Der aufgetrennte Kontaktname. Beide Spalten stehen einzeln in der Liste: eine Prüfung nur
     -- auf den Nachnamen liesse den Vornamen frei änderbar, und ein Vorname ist genauso ein
     -- Identitätsmerkmal wie der Rest.
     or new.first_name   is distinct from old.first_name
     or new.last_name    is distinct from old.last_name
     or new.phone        is distinct from old.phone
     or new.status       is distinct from old.status
     or new.retention_basis is distinct from old.retention_basis
     or new.anonymized_at   is distinct from old.anonymized_at
     -- B3-1: die Segmentierungsspalten.
     or new.industry               is distinct from old.industry
     or new.postal_code            is distinct from old.postal_code
     or new.annual_consumption_kwh is distinct from old.annual_consumption_kwh
     or new.metering_type          is distinct from old.metering_type
     or new.supplier               is distinct from old.supplier
     or new.contract_end_date      is distinct from old.contract_end_date
     -- B4-1: die Urheberschaft der Anonymisierung.
     or new.anonymized_by_system   is distinct from old.anonymized_by_system
     -- B16-1: die Empfehlungsangabe des Interessenten. Freitext einer Person, kann Namen Dritter
     -- enthalten. platform.leads.partner_slug steht bewusst NICHT hier (s. Kopf dieses Teils).
     or new.referred_by_text       is distinct from old.referred_by_text
     -- Das Thema der Anfrage: es überlebt die Anonymisierung (wie industry) und ist deshalb ab hier
     -- unveränderlich.
     or new.thema                  is distinct from old.thema
     -- B2-1: der Bearbeiter. NUR das SETZEN ist verboten (s. Begründung oben) — ein Übergang auf
     -- null bleibt möglich, weil ON DELETE SET NULL sonst am Guard scheiterte.
     or (new.last_edited_by is distinct from old.last_edited_by and new.last_edited_by is not null)
  then
    raise exception
      'platform.leads %: der Lead ist seit % anonymisiert — E-Mail, Firma, Vor- und Nachname, '
      'Telefon, Status, Aufbewahrungsgrundlage, der Anonymisierungszeitpunkt, sämtliche '
      'Segmentierungsmerkmale (Branche, PLZ, Jahresverbrauch, Messart, Versorger, Vertragsende), '
      'die Urheberschaft der Anonymisierung, die Empfehlungsangabe, das Thema der Anfrage und die '
      'Zuschreibung einer Bearbeitung sind unveränderlich. Anonymisierung ist endgültig, auch für '
      'service_role und für den Admin',
      old.id, old.anonymized_at;
  end if;

  return new;
end;
$$;

comment on function platform.guard_anonymized_lead() is
  'BEFORE UPDATE auf leads: ist anonymized_at gesetzt, sind email, company, first_name, last_name, '
  'phone, status, retention_basis, anonymized_at, (seit B3-1) industry, postal_code, '
  'annual_consumption_kwh, metering_type, supplier, contract_end_date, (seit B4-1) '
  'anonymized_by_system, (seit B16-1) referred_by_text, thema und (seit B2-1) last_edited_by '
  'unveränderlich — auch für service_role und für den Admin. thema steht in der Liste, WEIL es die '
  'Anonymisierung überlebt (Themenkategorie, kein Identitätsmerkmal — dieselbe Einstufung wie '
  'industry): eine überlebende Spalte, die danach noch änderbar wäre, wäre eine nachträglich '
  'umschreibbare Aussage über einen unkenntlich gemachten Menschen. platform.leads.partner_slug '
  'steht BEWUSST NICHT in der Liste: die Zuordnung ist nach der Anonymisierung nicht mehr '
  'personenbezogen, und die Partner-Statistik muss die Aufbewahrungsfrist überleben. Bei '
  'last_edited_by ist nur das SETZEN gesperrt, nicht das Nullen: die Spalte trägt ON DELETE SET '
  'NULL, und diese referentielle Aktion ist selbst ein UPDATE — ein vollständiger Schutz blockierte '
  'das Löschen des handelnden Kontos. anonymized_at steht bewusst mit in der Liste (sonst liesse '
  'sich der Guard durch Nullen seiner eigenen Bedingung aushebeln).';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — public.capture_lead: ein angehängter Parameter
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- DROP + CREATE, nicht `create or replace`: die Parameterliste wächst, und `create or replace` kann
-- sie nicht erweitern. Ein blosses CREATE erzeugte eine ZWEITE Überladung — jeder bestehende Aufruf
-- wäre dann mehrdeutig („function is not unique") und der gesamte Erfassungspfad läge lahm.
-- Dasselbe Vorgehen wie in B3-1, bei der Namensauftrennung und in B16-1.
--
-- ── DER NEUE PARAMETER HÄNGT HINTEN AN, mit Vorgabewert null ────────────────────────────────────
-- Genau das Muster von `p_locale` (B1-2), den sechs Segmentierungsfeldern (B3-1) und zuletzt
-- `p_partner_slug`/`p_referred_by_text` (B16-1): jeder bestehende Aufruf — auch ein POSITIONALER,
-- wie ihn das B1-2-Gate bewusst führt — bleibt unverändert gültig. Die sieben übrigen
-- Erfassungswege übergeben nichts und schreiben damit null, wie bisher.
--
-- ── DER JÜNGERE WERT GEWINNT (Begründung im Kopf) ───────────────────────────────────────────────
-- `coalesce(v_thema, l.thema)` — also wie die sechs Segmentierungsfelder und ausdrücklich nicht wie
-- die Identitätsfelder. Ein null lässt den Bestand unberührt; sonst löschte jede Erfassung über
-- einen themenlosen Weg (Warteliste, Rechnerergebnis, Telefonaufnahme) das zuvor genannte Thema.
--
-- ── LEERSTRING IST KEINE ANGABE ─────────────────────────────────────────────────────────────────
-- Wie bei jedem anderen Textfeld hier: `nullif(btrim(...), '')`. Ohne die Normalisierung schriebe
-- ein leer mitgeschicktes Feld ein '' in den Bestand — das ist kein null, überlebt jedes COALESCE
-- und verdrängte damit eine früher erhobene, echte Angabe.
drop function public.capture_lead(
  text, text, platform.consent_purpose, text, timestamptz, text, text, text, text, inet, text, text,
  platform.industry, text, integer, text, text, date, text, text
);

create function public.capture_lead(
  p_email text,
  p_source_key text,
  p_purpose platform.consent_purpose default null,
  p_token_hash text default null,
  p_token_expires_at timestamptz default null,
  p_company text default null,
  p_first_name text default null,
  p_last_name text default null,
  p_phone text default null,
  p_source_ip inet default null,
  p_user_agent text default null,
  p_locale text default 'de',
  p_industry platform.industry default null,
  p_postal_code text default null,
  p_annual_consumption_kwh integer default null,
  p_metering_type text default null,
  p_supplier text default null,
  p_contract_end_date date default null,
  -- B16-1, beide mit Vorgabewert null und ANGEHÄNGT:
  p_partner_slug text default null,
  p_referred_by_text text default null,
  -- Das Thema der Anfrage, ebenso angehängt und ebenso mit Vorgabewert null:
  p_thema text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead_id         uuid;
  v_consent_text_id uuid;
  v_consent_id      uuid;
  -- Verlangt DIESER Zweck eine Bestätigung? Einmal gelesen, dreimal gebraucht (Token-Pflicht,
  -- Kollisionsprüfung, Anlage-Zustand) — und ausschliesslich aus der EINEN Zuordnungsfunktion.
  v_requires_doi    boolean := p_purpose is not null
                               and platform.purpose_requires_double_opt_in(p_purpose);
  -- Leerstring ist keine Angabe. Ohne diese Normalisierung schriebe ein leer abgesendetes
  -- Formularfeld ein '' in den Bestand — das ist kein null, überlebt jedes COALESCE und überschriebe
  -- damit eine früher erhobene, echte Angabe. Gilt seit der Namensauftrennung ausdrücklich AUCH für
  -- Vor- und Nachname: das Kontaktformular verlangt beide, andere Einstiegspunkte nicht — ein dort
  -- leer gelassenes Feld darf einen bereits erfassten Namen nicht verdrängen.
  v_first_name    text := nullif(btrim(p_first_name), '');
  v_last_name     text := nullif(btrim(p_last_name), '');
  v_postal_code   text := nullif(btrim(p_postal_code), '');
  v_metering_type text := nullif(btrim(p_metering_type), '');
  v_supplier      text := nullif(btrim(p_supplier), '');
  -- B16-1. Der Slug wird zusätzlich KLEINGESCHRIEBEN: er kommt aus einem Link, den ein Mensch
  -- abtippen kann, und der CHECK auf platform.partners.slug garantiert, dass jeder GESPEICHERTE
  -- Slug bereits kleingeschrieben ist. Das Kleinschreiben kann deshalb nur einen Nicht-Treffer in
  -- den RICHTIGEN Treffer verwandeln, niemals in einen falschen.
  v_partner_slug  text := lower(nullif(btrim(p_partner_slug), ''));
  v_referred_by   text := nullif(btrim(p_referred_by_text), '');
  -- Das Thema. NUR getrimmt — ausdrücklich NICHT kleingeschrieben: anders als der Slug ist es ein
  -- Schlüssel aus einer Liste, die diese Anwendung selbst rendert, und die Schlüssel sind
  -- camelCase ('peakShaving'). Ein lower() machte aus jedem davon einen Wert, den findThema nicht
  -- mehr auflösen kann.
  v_thema         text := nullif(btrim(p_thema), '');
begin
  if p_email is null or btrim(p_email) = '' then
    raise exception 'public.capture_lead: p_email ist Pflicht' using errcode = '22023';
  end if;

  -- Ein bestätigungspflichtiger Zweck OHNE Token erzeugte eine pending-Einwilligung, die niemand je
  -- bestätigen kann — ein stiller Dauerzustand, der im Bestand wie eine offene Bestätigung aussieht
  -- und zugleich jede weitere Erfassung dieses Zwecks blockiert (s. Prüfung unten). Lieber laut.
  if v_requires_doi and (p_token_hash is null or btrim(p_token_hash) = '') then
    raise exception
      'public.capture_lead: Zweck % ist bestätigungspflichtig — p_token_hash ist dann Pflicht',
      p_purpose
      using errcode = '22023';
  end if;

  -- ── Partner-Slug prüfen: unbekannt oder inaktiv wird VERWORFEN, nicht abgewiesen ───────────────
  -- Ein INAKTIVER Partner wird wie ein unbekannter behandelt: die Deaktivierung ist genau die
  -- Ansage, dass Links dieses Fachbetriebs nicht mehr attributieren sollen. Wäre es anders, hätte
  -- `is_active` für den einzigen Pfad, der im Betrieb Zuordnungen erzeugt, keine Wirkung.
  -- (public.admin_update_lead verfährt bewusst anders — dort ist eine historische Zuordnung zu einem
  -- inzwischen inaktiven Partner eine zulässige Feststellung eines Menschen.)
  if v_partner_slug is not null and not exists (
    select 1 from platform.partners p where p.slug = v_partner_slug and p.is_active
  ) then
    v_partner_slug := null;
  end if;

  -- ── Lead anlegen oder wiederverwenden ──────────────────────────────────────────────────────────
  -- Konflikt-Ziel ist der AUSDRUCKS-Index aus B1-1 (platform.normalize_email(email)) — also
  -- dieselbe Definition von „dieselbe Adresse", die auch der BEFORE-Trigger anwendet. `do nothing`
  -- statt `do update`, weil der Wiederverwendungsfall unten mehr tut als ein Upsert ausdrücken
  -- könnte (Identitätsfelder nur ERGÄNZEN, Segmentierungsfelder AKTUALISIEREN).
  --
  -- Ein unzulässiger p_metering_type oder eine vierstellenwidrige PLZ wird hier NICHT abgefangen:
  -- der CHECK auf der Spalte lehnt sie ab, und zwar hart. Eine stille Bereinigung („nimm halt
  -- unknown") erzeugte einen Bestand, der geprüfte von geratenen Werten nicht mehr unterscheidet.
  -- Für `thema` gibt es aus der im Kopf genannten Begründung gar keinen CHECK — geprüft wird an der
  -- Stelle, an der die Werteliste entsteht.
  insert into platform.leads (
    email, first_source_key, company, first_name, last_name, phone,
    industry, postal_code, annual_consumption_kwh, metering_type, supplier, contract_end_date,
    partner_slug, referred_by_text, thema
  )
  values (
    p_email,
    p_source_key,
    nullif(btrim(p_company), ''),
    v_first_name,
    v_last_name,
    nullif(btrim(p_phone), ''),
    p_industry,
    v_postal_code,
    p_annual_consumption_kwh,
    v_metering_type,
    v_supplier,
    p_contract_end_date,
    v_partner_slug,
    v_referred_by,
    v_thema
  )
  on conflict (platform.normalize_email(email)) do nothing
  returning id into v_lead_id;

  if v_lead_id is null then
    -- Bestehender Lead: last_interaction_at rückt (und mit ihr die Löschfrist, Trigger
    -- sync_lead_retention). Identitätsfelder werden nur GEFÜLLT, wo bisher nichts stand: eine
    -- spätere, knappere Absendung darf eine früher genannte Firma/Telefonnummer nicht löschen.
    -- VOR- UND NACHNAME FOLGEN DERSELBEN REGEL wie company/phone (Bestand gewinnt) und
    -- ausdrücklich NICHT der B3-1-Segmentierungsregel: ein Name ist ein Identitätsmerkmal, das sich
    -- selten und dann bewusst ändert — anders als Verbrauch, Versorger oder Vertragsende, wo die
    -- JÜNGERE Angabe die richtige ist. Die beiden Regeln stehen deshalb bewusst gegenläufig
    -- nebeneinander (ausführlich begründet in B3-1).
    --
    -- Die zwei Felder werden EINZELN zusammengeführt, nicht als Paar: ein Einstiegspunkt, der nur
    -- den Nachnamen erhebt, soll ihn ergänzen können, ohne dass ein fehlender Vorname etwas
    -- bewirkt.
    -- first_source_key bleibt unangetastet (Trigger guard_lead_first_source würde es ohnehin
    -- ablehnen) — die Ersterfassungs-Herkunft ist einmalig.
    --
    -- B16-1: partner_slug und referred_by_text folgen der Bestand-gewinnt-Regel. Kommt derselbe
    -- Kontakt später über den Link eines ANDEREN Fachbetriebs, bleibt die ERSTE Zuordnung stehen —
    -- sonst entschiede die zufällige Reihenfolge zweier Formularabsendungen darüber, wer das
    -- Montageprojekt bekommt. Auch hier EINZELN: ein Aufruf, der nur den Freitext trägt, darf ihn
    -- ergänzen, ohne dass ein fehlender Slug etwas bewirkt.
    --
    -- `thema` steht bewusst auf der ANDEREN Seite: der JÜNGERE Wert gewinnt (wie die
    -- Segmentierungsfelder). Es beschreibt das Anliegen dieser Absendung, nicht die Person.
    update platform.leads l
       set last_interaction_at = now(),
           company    = coalesce(l.company,    nullif(btrim(p_company), '')),
           first_name = coalesce(l.first_name, v_first_name),
           last_name  = coalesce(l.last_name,  v_last_name),
           phone      = coalesce(l.phone,      nullif(btrim(p_phone), '')),
           industry               = coalesce(p_industry,               l.industry),
           postal_code            = coalesce(v_postal_code,            l.postal_code),
           annual_consumption_kwh = coalesce(p_annual_consumption_kwh, l.annual_consumption_kwh),
           metering_type          = coalesce(v_metering_type,          l.metering_type),
           supplier               = coalesce(v_supplier,               l.supplier),
           contract_end_date      = coalesce(p_contract_end_date,      l.contract_end_date),
           partner_slug           = coalesce(l.partner_slug,     v_partner_slug),
           referred_by_text       = coalesce(l.referred_by_text, v_referred_by),
           thema                  = coalesce(v_thema,            l.thema)
     where platform.normalize_email(l.email) = platform.normalize_email(p_email)
    returning l.id into v_lead_id;
  end if;

  if v_lead_id is null then
    -- Weder angelegt noch gefunden: darf nicht vorkommen (der Insert scheitert nur am
    -- E-Mail-UNIQUE, und dann findet das UPDATE die Zeile). Nicht still weiterlaufen.
    raise exception 'public.capture_lead: Lead für die übergebene Adresse konnte nicht ermittelt werden';
  end if;

  if p_purpose is null then
    return jsonb_build_object('outcome', 'lead_only', 'lead_id', v_lead_id);
  end if;

  -- ── Sperrliste (B1-1: die zweite Pflichtfrage vor jedem Versand) ───────────────────────────────
  if platform.is_suppressed(p_email) then
    return jsonb_build_object('outcome', 'suppressed', 'lead_id', v_lead_id);
  end if;

  -- ── Läuft für diesen Lead und diesen Zweck schon eine Bestätigung? ─────────────────────────────
  -- Der Zweck kommt über den verknüpften Text (B1-1: es gibt keine zweite, denormalisierte
  -- Zweck-Angabe an der Einwilligung, die davon abweichen könnte).
  --
  -- B3-2: NUR NOCH FÜR BESTÄTIGUNGSPFLICHTIGE ZWECKE. Die Prüfung schützt davor, dass wiederholtes
  -- Absenden fremde Adressen mit BESTÄTIGUNGSMAILS zudeckt — sie hat nur dort einen Gegenstand, wo
  -- solche Mails entstehen. Bei einem Zweck ohne Bestätigungspflicht gibt es keine pending-Zeile
  -- mehr; träfe die Prüfung dort noch eine Alt-Zeile, verweigerte sie ausgerechnet die sofortige
  -- Lieferung.
  if v_requires_doi and exists (
    select 1
    from platform.consents c
    join platform.consent_texts ct on ct.id = c.consent_text_id
    where c.lead_id = v_lead_id
      and ct.purpose = p_purpose
      and c.status = 'pending'
      and (c.token_expires_at is null or c.token_expires_at > now())
  ) then
    return jsonb_build_object('outcome', 'consent_already_pending', 'lead_id', v_lead_id);
  end if;

  -- ── Jüngste passende Textfassung (identische Regel wie get_active_consent_text) ────────────────
  select ct.id into v_consent_text_id
  from platform.consent_texts ct
  where ct.purpose = p_purpose
    and ct.locale  = coalesce(p_locale, 'de')
  order by ct.version desc, ct.valid_from desc
  limit 1;

  if v_consent_text_id is null then
    -- Ohne Wortlaut keine Einwilligung. Ein Fallback auf eine andere Sprache wäre ein Nachweis über
    -- einen Text, den die Person nicht gesehen hat.
    raise exception
      'public.capture_lead: kein Einwilligungstext für Zweck % in Sprache % vorhanden',
      p_purpose, coalesce(p_locale, 'de')
      using errcode = '22023';
  end if;

  -- ── Die Einwilligung entsteht — in EINEM von zwei Zuständen ────────────────────────────────────
  -- Bestätigungspflichtig  → 'pending' mit Token und Ablauf (unverändert B1-2).
  -- Nicht bestätigungspflichtig → SOFORT 'confirmed' mit confirmed_at = now().
  --
  -- EIN ÜBERGEBENER TOKEN WIRD IM ZWEITEN FALL NICHT GESPEICHERT — weder Hash noch Ablauf. Er wäre
  -- ein einlösbares Geheimnis ohne Einlösestelle: `public.confirm_consent` findet nur pending-
  -- Zeilen, der Token könnte also nichts mehr bewirken, stünde aber dauerhaft in einer Tabelle, die
  -- genau solche Werte bewusst nicht führen soll (B1-1, Kommentar an consents.token_hash). Dass ein
  -- Aufrufer versehentlich einen mitschickt, darf daher keine Spur hinterlassen; ein db-test pinnt
  -- das.
  insert into platform.consents (
    lead_id, consent_text_id, source_key, status, confirmed_at,
    token_hash, token_expires_at, source_ip, user_agent
  )
  values (
    v_lead_id,
    v_consent_text_id,
    p_source_key,
    case when v_requires_doi then 'pending' else 'confirmed' end,
    case when v_requires_doi then null      else now() end,
    case when v_requires_doi then p_token_hash       else null end,
    case when v_requires_doi then p_token_expires_at else null end,
    p_source_ip,
    p_user_agent
  )
  returning id into v_consent_id;

  return jsonb_build_object(
    'outcome',    case when v_requires_doi then 'consent_created' else 'consent_confirmed' end,
    'lead_id',    v_lead_id,
    'consent_id', v_consent_id
  );
end;
$$;

comment on function public.capture_lead(
  text, text, platform.consent_purpose, text, timestamptz, text, text, text, text, inet, text, text,
  platform.industry, text, integer, text, text, date, text, text, text
) is
  'B1-2, erweitert in B3-1, korrigiert in B3-2, Kontaktname aufgetrennt, erweitert in B16-1 und um '
  'p_thema: EIN atomarer Erfassungsaufruf (Lead + optionale Einwilligung in EINER Transaktion — '
  'Lead und Nachweis dürfen nicht getrennt committen). Rückgabe {outcome, lead_id} mit outcome aus '
  'lead_only (kein Zweck übergeben) · consent_created (bestätigungspflichtiger Zweck: pending + '
  'Token, der Anwendungscode versendet die Bestätigungsmail) · consent_confirmed (NICHT '
  'bestätigungspflichtiger Zweck: sofort confirmed mit confirmed_at, der Anwendungscode liefert '
  'unmittelbar; ein übergebener Token wird dabei NICHT gespeichert) · consent_already_pending '
  '(offene, nicht abgelaufene Bestätigung — verhindert, dass wiederholtes Absenden fremde Adressen '
  'mit Bestätigungsmails zudeckt; greift nur bei bestätigungspflichtigen Zwecken) · suppressed '
  '(Adresse gesperrt: KEINE Einwilligung, der Lead bleibt — eine Anfrage ist keine Einwilligung). '
  'Bestätigungspflichtiger Zweck ohne p_token_hash wirft. ZUSAMMENFÜHRUNG bei wiederholter '
  'Erfassung: die sechs Segmentierungsfelder (industry, postal_code, annual_consumption_kwh, '
  'metering_type, supplier, contract_end_date) UND thema werden von einem übergebenen Wert '
  'ÜBERSCHRIEBEN, ein null-Wert lässt den bestehenden UNBERÜHRT; company/first_name/last_name/phone '
  'sowie seit B16-1 partner_slug/referred_by_text folgen bewusst der umgekehrten Vorrangregel '
  '(Bestand gewinnt — die ERSTE Nennung eines Partners gilt, wie bei first_source_key). B16-1: ein '
  'p_partner_slug, der auf keinen existierenden AKTIVEN Partner zeigt, wird VERWORFEN statt den Lead '
  'scheitern zu lassen (ein Link mit Tippfehler darf keinen Lead kosten); ein mitgeschickter '
  'Freitext bleibt davon unberührt. Der Slug wird kleingeschrieben verglichen — der CHECK auf '
  'platform.partners.slug garantiert, dass jeder gespeicherte Slug kleingeschrieben ist. p_thema '
  'dagegen wird NUR getrimmt und ausdrücklich NICHT kleingeschrieben (die Themen-Schlüssel sind '
  'camelCase) und gegen KEINE Werteliste geprüft — die Liste ist datengetrieben aus der '
  'Leistungs-Taxonomie und wird in kontaktSchema geprüft. In der Praxis übergibt ihn NUR das '
  'Kontaktformular. service_role-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — die zwei Lesewege: public.admin_list_leads und public.admin_export_leads
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- BEIDE, nicht nur die Liste — und aus demselben Grund, aus dem B16-1 den Partner-Filter in beide
-- gelegt hat: Wer eine Angabe in der Liste sieht, erwartet sie in der Datei wieder. Eine Spalte, die
-- am Bildschirm steht und im Export fehlt, fällt erst auf, wenn die Datei bereits in einem fremden
-- Werkzeug liegt.
--
-- ADDITIV wie first_name/last_name: eine zusätzliche Spalte in der Antwort bzw. je Exportzeile.
-- Kein Filterparameter (der Filter ist der folgende Schritt und braucht dann auch den Index).
--
-- `create or replace` bei UNVERÄNDERTER Signatur — die Grants beider Funktionen bleiben unangetastet
-- (nur `capture_lead` oben braucht wegen des DROP eine Wiederherstellung, TEIL 5).
--
-- `platform.leads_matching` bleibt unberührt: es liefert `setof platform.leads` und trägt die neue
-- Spalte damit von selbst. Beide Wrapper wählen aus dieser Menge explizit aus — deshalb hier je
-- eine Zeile.
create or replace function public.admin_list_leads(
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
  p_partner_assignment text default null
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
  if v_status is not null and v_status not in ('new', 'contacted', 'customer', 'anonymized') then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'status');
  end if;

  if v_cstatus is not null
     and v_cstatus not in ('pending', 'confirmed', 'withdrawn', 'expired', 'none')
  then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'consent_status');
  end if;

  if v_metering is not null
     and v_metering not in ('leistungsgemessen', 'netzebene_7', 'unknown')
  then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'metering_type');
  end if;

  -- Der PLZ-Präfix ist eine ZIFFERNfolge von 1 bis 4 Stellen. „11a" oder „11000" könnten nie einen
  -- Treffer haben (der Spalten-CHECK erlaubt nur vier Ziffern) — eine leere Menge sähe aber aus wie
  -- „in diesem Gebiet gibt es niemanden" statt wie „diese Eingabe ergibt keinen Sinn".
  if v_prefix is not null and v_prefix !~ '^[0-9]{1,4}$' then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'postal_prefix');
  end if;

  -- B16-1, dieselbe Regel: ein Slug, den es nicht gibt, liefert eine leere Menge, und die läse sich
  -- als „dieser Partner hat niemanden gebracht" — die schlechteste Auskunft, die man einem
  -- Fachbetrieb geben kann. Anders als in capture_lead wird hier NICHT verworfen, sondern
  -- abgelehnt: dort steht ein echter Interessent auf dem Spiel, hier nur eine Ansicht.
  -- Ein INAKTIVER Partner ist ausdrücklich filterbar — seine Leads existieren weiter.
  if v_partner is not null
     and not exists (select 1 from platform.partners p where p.slug = v_partner)
  then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'partner_slug');
  end if;

  -- B18-5, aus demselben Grund: ein Wert, den die Bedingung nicht kennt, filterte nichts und liesse
  -- den vollen Bestand als gefiltert erscheinen.
  if v_passign is not null and v_passign not in ('assigned', 'unassigned') then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'partner_assignment');
  end if;

  -- B18-5: der eine widersprüchliche Fall. „genau dieser Fachbetrieb" UND „gar kein Fachbetrieb"
  -- ergibt per Konstruktion eine leere Menge — und die läse sich wieder als Aussage über den
  -- Bestand dieses Betriebs statt als Aussage über die Filtereingabe.
  if v_partner is not null and v_passign = 'unassigned' then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'partner_assignment');
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
           -- genau der Fall, den ein Mensch entscheiden muss. Derselbe Grund trägt den
           -- B18-5-Filter: ohne partner_slug in der Antwort liesse er sich nicht nachvollziehen.
           ld.partner_slug, ld.referred_by_text,
           -- Das Thema der Anfrage. Der SCHLÜSSEL, nicht das Label — die Anzeige löst ihn über
           -- dieselbe Liste auf, die das Dropdown füllt (findThema). Ein hier gebildetes Label wäre
           -- eine zweite Übersetzung neben messages/*.json.
           ld.thema
    from platform.leads_matching(
           p_status, p_source_key, p_consent_purpose, p_consent_status, p_search, p_due_only,
           p_industry, p_metering_type, p_postal_prefix, p_consumption_min, p_consumption_max,
           p_contract_end_from, p_contract_end_to, p_partner_slug, p_partner_assignment
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
  platform.industry, text, text, integer, integer, date, date, text, text
) is
  'B1-1/B1-3, erweitert in B2-1, B16-1, B18-5 und um thema: paginierte, gefilterte Lead-Liste '
  '(neueste zuerst, limit 1..200, default 50). Filtert AUSSCHLIESSLICH über '
  'platform.leads_matching — dieselbe Bedingung, die auch public.admin_export_leads benutzt. Je '
  'Zeile zusätzlich is_suppressed, deletion_due, die Einwilligungen mit effective_status, die '
  'Segmentierungsmerkmale, seit B16-1 partner_slug samt referred_by_text (erst ihr Nebeneinander '
  'zeigt die zu entscheidenden Fälle) und thema (der SCHLÜSSEL des im Kontaktformular gewählten '
  'Themas, nicht das Label — die Anzeige löst ihn über dieselbe Liste auf, die das Dropdown füllt). '
  'B18-5: p_partner_assignment (assigned/unassigned) beantwortet „hat irgendeinen Fachbetrieb" bzw. '
  '„hat keinen" — p_partner_slug bleibt für „genau dieser". Für thema gibt es (noch) KEINEN Filter. '
  'In der Antwort fahren die Einstiegspunkte UND die Partner als Auswahllisten mit (beides Tabellen, '
  'die der Anwendungscode nicht als Konstante spiegeln kann). Ein unbekannter Filterwert wird als '
  '{status: invalid_filter, filter} ABGELEHNT und nicht ignoriert — auch ein unbekannter '
  'partner_slug, dessen leere Ergebnismenge sich sonst als „dieser Partner hat niemanden gebracht" '
  'läse, und ebenso die widersprüchliche Kombination Slug + unassigned. WIRFT bei fehlender '
  'Adminrolle (SQLSTATE 42501). authenticated-only.';

create or replace function public.admin_export_leads(
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
  p_partner_assignment text default null
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

  -- Dieselben Ablehnungen wie in admin_list_leads: ein unbekannter Filterwert darf auch hier nicht
  -- still zu einer GRÖSSEREN Menge führen — bei einer Datei, die das System verlässt, erst recht
  -- nicht.
  if v_status is not null and v_status not in ('new', 'contacted', 'customer', 'anonymized') then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'status');
  end if;
  if v_cstatus is not null
     and v_cstatus not in ('pending', 'confirmed', 'withdrawn', 'expired', 'none')
  then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'consent_status');
  end if;
  if v_metering is not null
     and v_metering not in ('leistungsgemessen', 'netzebene_7', 'unknown')
  then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'metering_type');
  end if;
  if v_prefix is not null and v_prefix !~ '^[0-9]{1,4}$' then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'postal_prefix');
  end if;
  if v_partner is not null
     and not exists (select 1 from platform.partners p where p.slug = v_partner)
  then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'partner_slug');
  end if;
  if v_passign is not null and v_passign not in ('assigned', 'unassigned') then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'partner_assignment');
  end if;
  if v_partner is not null and v_passign = 'unassigned' then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'partner_assignment');
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
           -- Das Thema. Hier steht bewusst NUR der Schlüssel und KEIN aufgelöstes Label daneben
           -- (anders als bei partner_display_name): das Label käme aus messages/*.json, also aus dem
           -- Anwendungscode und in EINER Sprache — die Datenbank hätte es zu erfinden. Der
           -- Schlüssel ist zudem lesbar genug („peakShaving").
           ld.thema,
           ld.created_at,
           ld.last_interaction_at,
           -- PFLICHTSPALTE: ohne sie ist jede Zeile in einem fremden Werkzeug ununterscheidbar
           -- anschreibbar.
           platform.marketing_consent_state(ld.id) as marketing_consent
    from platform.leads_matching(
           p_status, p_source_key, p_consent_purpose, p_consent_status, p_search, p_due_only,
           p_industry, p_metering_type, p_postal_prefix, p_consumption_min, p_consumption_max,
           p_contract_end_from, p_contract_end_to, p_partner_slug, p_partner_assignment
         ) ld
    where ld.anonymized_at is null
      and not platform.is_suppressed(ld.email)
  ) r;

  v_summary := platform.lead_filter_summary(
    p_status, p_source_key, p_consent_purpose, p_consent_status, p_search, p_due_only,
    p_industry, p_metering_type, p_postal_prefix, p_consumption_min, p_consumption_max,
    p_contract_end_from, p_contract_end_to, p_partner_slug, p_partner_assignment
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
  platform.industry, text, text, integer, integer, date, date, text, text
) is
  'B2-1, erweitert in B16-1, B18-5 und um thema: führt den gefilterten Bestand als Zeilen aus und '
  'protokolliert die Ausfuhr in platform.admin_exports (row_count + der von '
  'platform.lead_filter_summary erzeugte Filtertext). Nimmt DIESELBEN Filterparameter entgegen wie '
  'public.admin_list_leads und benutzt DIESELBE Bedingung (platform.leads_matching) — beide '
  'Partner-Filter sind hier ausdrücklich eingeschlossen: eine auf Fachbetrieb-Leads gefilterte '
  'Sicht, aus der eine Datei mit dem GESAMTBESTAND fiele, wäre genau die Divergenz, gegen die diese '
  'Schicht gebaut ist. Gesperrte und anonymisierte Zeilen sind in der ABFRAGE ausgeschlossen, nicht '
  'über einen Filter. Je Zeile fahren der Marketing-Einwilligungsstand (Pflicht), seit B16-1 '
  'partner_slug samt Anzeigename und referred_by_text sowie thema mit — thema als SCHLÜSSEL ohne '
  'aufgelöstes Label, weil das Label aus dem Anwendungscode und in nur einer Sprache käme. WIRFT bei '
  'fehlender Adminrolle (42501). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — Rechte nach dem DROP wiederherstellen
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf NEUE public-Funktionen automatisch EXECUTE an
-- anon, authenticated UND service_role (zusätzlich zum PostgreSQL-Default-Grant an PUBLIC). Ein DROP
-- entfernt zugleich die bestehenden Grants. Für die eine hier neu angelegte Funktion gilt deshalb:
-- erst allen entziehen, dann gezielt gewähren — exakt die Rechtefläche, die sie vorher hatte. In
-- B3-1 ist genau dieser Schritt schon einmal ausdrücklich geprüft worden; das DB-Gate misst ihn nach.
--
-- Die zwei Admin-Wrapper aus TEIL 4 sind `create or replace` bei unveränderter Signatur und behalten
-- ihre Rechte; sie tauchen hier bewusst NICHT auf. Ebenso platform.guard_anonymized_lead.

-- capture_lead: NUR service_role. Kein Grant an `authenticated` (der Erfassungspfad ist anonym und
-- kennt keinen eingeloggten Nutzer) und keiner an `anon` (ein Browser-Grant machte das Formular zum
-- offenen Schreibzugang auf den Lead-Bestand).
revoke all on function public.capture_lead(
  text, text, platform.consent_purpose, text, timestamptz, text, text, text, text, inet, text, text,
  platform.industry, text, integer, text, text, date, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.capture_lead(
  text, text, platform.consent_purpose, text, timestamptz, text, text, text, text, inet, text, text,
  platform.industry, text, integer, text, text, date, text, text, text
) to service_role;
