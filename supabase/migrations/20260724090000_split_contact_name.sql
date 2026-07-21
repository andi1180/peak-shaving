-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Kontaktname auftrennen: first_name und last_name statt contact_name
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- `platform.leads.contact_name` ist seit B1-1 EIN Freitextfeld, geteilt über alle Einstiegspunkte.
-- Für eine korrekte Anrede in künftiger Korrespondenz (u. a. der Rechnungs-Wächter, Fahrplan B9)
-- reicht das nicht: „Sehr geehrte Frau …" verlangt den Nachnamen als eigenen Wert, und ein
-- zusammengesetzter Name lässt sich nachträglich nicht zuverlässig zerlegen.
--
-- ── WARUM NICHT SPÄTER ABLEITEN ──────────────────────────────────────────────────────────────────
-- Jede Zerlegung eines Freitextnamens ist eine Heuristik, und sie scheitert genau dort, wo sie
-- auffällt: bei Doppelnamen („Anna Maria Gruber"), bei Namenszusätzen („von der Leyen"), bei
-- akademischen Titeln („Dr. Max Muster"), bei umgekehrter Schreibweise („Muster, Max"). Ein falsch
-- geratener Nachname steht anschliessend in der ANREDE einer echten E-Mail — das ist der eine Ort,
-- an dem ein Fehler garantiert bemerkt wird, und zwar von der betroffenen Person. Deshalb wird an
-- der QUELLE getrennt: das Kontaktformular fragt zwei Felder, und beide Werte reisen getrennt bis
-- in die Datenbank.
--
-- ── WARUM BACKFILL UND DROP IN EINEM SCHRITT VERTRETBAR SIND ─────────────────────────────────────
-- Ein brechender Spaltenwechsel verlangt normalerweise einen zweistufigen Rollout (erst schreiben
-- beide, dann lesen alle neu, dann alte Spalte weg), weil sonst ein noch laufender alter
-- Anwendungsstand gegen eine verschwundene Spalte läuft.
--
-- Hier entfällt der Grund: der reale Bestand enthält aktuell KEINE echten Leads mit diesem Feld —
-- die wenigen Testfälle sind bereits anonymisiert, und `platform.anonymize_lead` nullt
-- `contact_name` seit B1-3. Der Backfill unten hat damit voraussichtlich null Zeilen zu bewegen; er
-- steht trotzdem da, weil eine Migration nicht davon ausgehen darf, dass die Datenlage bei ihrem
-- Lauf noch dieselbe ist wie beim Schreiben. Fände er doch Zeilen, verlöre der zweistufige Rollout
-- ohnehin seinen Zweck, sobald die Anwendung im selben Deployment nachzieht — und genau das tut sie.
--
-- ── DIE ZERLEGUNGSREGEL DES BACKFILLS, MIT BEISPIELRECHNUNG ──────────────────────────────────────
-- Bis zum ERSTEN Leerzeichen → first_name, der Rest → last_name.
--   'Max Muster'        → first_name 'Max'       · last_name 'Muster'
--   'Anna Maria Gruber' → first_name 'Anna'      · last_name 'Maria Gruber'
--   'Muster'            → first_name NULL        · last_name 'Muster'
--   'Bäckerei Muster'   → first_name 'Bäckerei'  · last_name 'Muster'
--
-- Ein EINZELNER Wert wird bewusst zum NACHNAMEN und nicht zum Vornamen: wer nur ein Wort einträgt,
-- schreibt in aller Regel einen Nachnamen oder einen Firmennamen. Als Vorname geführt landete er in
-- einer Anrede („Sehr geehrter Herr Muster" würde zu „Sehr geehrter Herr" ohne Namen), als Nachname
-- ist er im schlechtesten Fall ein etwas förmlich benutzter Vorname — der harmlosere Fehler.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — Die zwei Spalten, der Backfill, und contact_name weg
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
alter table platform.leads
  add column first_name text,
  add column last_name text;

comment on column platform.leads.first_name is
  'Vorname der Ansprechperson. Getrennt von last_name geführt, weil eine korrekte Anrede in '
  'Korrespondenz (Fahrplan B9) den Nachnamen als eigenen Wert braucht und die nachträgliche '
  'Zerlegung eines zusammengesetzten Namens bei Doppelnamen, Namenszusätzen und Titeln '
  'unzuverlässig ist. Nullable: nicht jeder Einstiegspunkt erhebt einen Namen. Wird von '
  'platform.anonymize_lead genullt und ist danach unveränderlich (guard_anonymized_lead).';

comment on column platform.leads.last_name is
  'Nachname der Ansprechperson (s. first_name). Trägt bei einem einwortigen Eintrag den GESAMTEN '
  'Wert — ein Einzelname ist eher ein Nach- oder Firmenname als ein Vorname.';

-- Der Backfill. `strpos(…, ' ') = 0` heisst „kein Leerzeichen enthalten". `btrim` vorweg, damit ein
-- führendes Leerzeichen nicht einen leeren Vornamen erzeugt.
--
-- IDEMPOTENT über `first_name is null and last_name is null`: ein zweiter Lauf fände keine Zeile
-- mehr. Nach dem DROP unten ist die Anweisung ohnehin nicht wiederholbar — die Bedingung ist gegen
-- ein Wiederanwenden VOR dem Drop gerichtet, nicht danach.
update platform.leads l
   set first_name = case
                      when strpos(btrim(l.contact_name), ' ') = 0 then null
                      else split_part(btrim(l.contact_name), ' ', 1)
                    end,
       last_name  = case
                      when strpos(btrim(l.contact_name), ' ') = 0 then btrim(l.contact_name)
                      else btrim(substr(btrim(l.contact_name), strpos(btrim(l.contact_name), ' ') + 1))
                    end
 where l.contact_name is not null
   and btrim(l.contact_name) <> ''
   and l.first_name is null
   and l.last_name is null;

-- ── Erst DANACH darf contact_name weg ────────────────────────────────────────────────────────────
-- Der Guard und anonymize_lead nennen die Spalte noch; plpgsql prüft Funktionsrümpfe nicht beim
-- Anlegen, ein Aufruf ZWISCHEN Drop und Neufassung scheiterte aber zur Laufzeit. Innerhalb dieser
-- Transaktion ist dieses Fenster nicht beobachtbar — Migrationen laufen atomar.
alter table platform.leads drop column contact_name;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — guard_anonymized_lead und platform.anonymize_lead
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Der Guard schützte 15 Spalten (B2-1); es bleiben 16, weil aus einer geschützten Spalte zwei
-- geworden sind. Derselbe Grund wie in B3-1 und B4-1: ein Schutz, der seine eigene Erweiterung nicht
-- abdeckt, läuft an ihr vorbei — hier hiesse das, dass sich einem anonymisierten Lead nachträglich
-- wieder ein Name anheften liesse, ausgerechnet über die Spalten, die ihn jetzt tragen.
--
-- Die ASYMMETRIE bei last_edited_by (nur das Setzen ist gesperrt, das Nullen läuft durch, weil
-- ON DELETE SET NULL selbst ein UPDATE ist) bleibt unverändert — B2-1 begründet sie ausführlich.
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
     -- B2-1: der Bearbeiter. NUR das SETZEN ist verboten (s. Begründung oben) — ein Übergang auf
     -- null bleibt möglich, weil ON DELETE SET NULL sonst am Guard scheiterte.
     or (new.last_edited_by is distinct from old.last_edited_by and new.last_edited_by is not null)
  then
    raise exception
      'platform.leads %: der Lead ist seit % anonymisiert — E-Mail, Firma, Vor- und Nachname, '
      'Telefon, Status, Aufbewahrungsgrundlage, der Anonymisierungszeitpunkt, sämtliche '
      'Segmentierungsmerkmale (Branche, PLZ, Jahresverbrauch, Messart, Versorger, Vertragsende), '
      'die Urheberschaft der Anonymisierung und die Zuschreibung einer Bearbeitung sind '
      'unveränderlich. Anonymisierung ist endgültig, auch für service_role und für den Admin',
      old.id, old.anonymized_at;
  end if;

  return new;
end;
$$;

comment on function platform.guard_anonymized_lead() is
  'BEFORE UPDATE auf leads: ist anonymized_at gesetzt, sind email, company, first_name, last_name, '
  'phone, status, retention_basis, anonymized_at, (seit B3-1) industry, postal_code, '
  'annual_consumption_kwh, metering_type, supplier, contract_end_date, (seit B4-1) '
  'anonymized_by_system und (seit B2-1) last_edited_by unveränderlich — auch für service_role und '
  'für den Admin. first_name/last_name haben contact_name abgelöst (Auftrennung des Kontaktnamens); '
  'beide stehen einzeln in der Liste. Bei last_edited_by ist nur das SETZEN gesperrt, nicht das '
  'Nullen: die Spalte trägt ON DELETE SET NULL, und diese referentielle Aktion ist selbst ein '
  'UPDATE — ein vollständiger Schutz blockierte das Löschen des handelnden Kontos. anonymized_at '
  'steht bewusst mit in der Liste (sonst liesse sich der Guard durch Nullen seiner eigenen '
  'Bedingung abschalten); anonymized_by bewusst gar nicht (dieselbe ON-DELETE-Begründung, dort ohne '
  'Teillösung). last_interaction_at bleibt änderbar — der B1-1-Trigger touch_lead_on_consent muss '
  'weiter laufen können.';

-- ── platform.anonymize_lead ──────────────────────────────────────────────────────────────────────
-- Nullt statt `contact_name` jetzt `first_name` und `last_name`. Sonst UNVERÄNDERT: die zwei
-- Spalten sind dasselbe Identitätsmerkmal wie zuvor, nur in zwei Werten geführt — die Trennlinie
-- „lokalisierend gegen grob einordnend" (B3-1) verschiebt sich dadurch nicht.
--
-- `create or replace` mit UNVERÄNDERTER Signatur (uuid, uuid, boolean) — die B4-1-Grants/Revokes
-- bleiben unangetastet.
create or replace function platform.anonymize_lead(
  p_lead_id uuid,
  p_actor uuid,
  p_by_system boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anonymized_at timestamptz;
  v_by_system     boolean := coalesce(p_by_system, false);
begin
  -- Ein Systemlauf HAT kein handelndes Konto. Käme trotzdem eines mit, wäre entweder der Aufrufer
  -- verwirrt oder die Zuschreibung falsch — beides ist ein Programmierfehler und keine Lage, in der
  -- eine unumkehrbare Operation weiterlaufen soll. Die Ablehnung kommt VOR jeder Wirkung; der CHECK
  -- auf der Tabelle fängt denselben Fall ein zweites Mal ab, dann aber erst beim Schreiben.
  if v_by_system and p_actor is not null then
    raise exception
      'platform.anonymize_lead: p_by_system => true verlangt p_actor => null — ein Systemlauf hat '
      'kein handelndes Konto, und zwei Urheber in einer Zeile sind keine genauere Angabe, sondern '
      'ein Widerspruch';
  end if;

  if p_lead_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Zeilensperre: zwei gleichzeitige Klicks auf „Anonymisieren" sollen nicht beide durchlaufen —
  -- und seit B4-1 auch nicht ein Klick und ein Systemlauf gleichzeitig.
  -- (FOUND unterscheidet „keine Zeile" von „Zeile mit anonymized_at = null" — der Null-Wert allein
  -- wäre mehrdeutig.)
  select l.anonymized_at
    into v_anonymized_at
  from platform.leads l
  where l.id = p_lead_id
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- IDEMPOTENT: Erfolg ohne zweite Wirkung. anonymized_at bleibt der ERSTE Zeitpunkt (dasselbe
  -- Prinzip wie confirmed_at in B1-2 — ein nachgeschriebenes Datum wäre eine Fälschung), und der
  -- Guard-Trigger würde ein Überschreiben ohnehin ablehnen. Die Urheberschaft bleibt aus demselben
  -- Grund beim ERSTEN: ein Systemlauf, der über einen bereits vom Admin anonymisierten Lead läuft,
  -- schreibt sich nicht nachträglich als Urheber ein.
  if v_anonymized_at is not null then
    return jsonb_build_object(
      'status', 'ok', 'outcome', 'already_anonymized', 'anonymized_at', v_anonymized_at
    );
  end if;

  -- ZUERST die Einwilligungen, DANN der Lead. Grund: der B1-1-Trigger touch_lead_on_consent
  -- schreibt bei jeder Einwilligungsänderung auf den Lead zurück. In dieser Reihenfolge trifft er
  -- eine noch nicht anonymisierte Zeile; umgekehrt liefe er gegen den frisch gesetzten Guard —
  -- der zwar last_interaction_at durchliesse, aber die Abhängigkeit wäre unnötig fein.
  update platform.consents c
     set source_ip  = null,
         user_agent = null
   where c.lead_id = p_lead_id
     and (c.source_ip is not null or c.user_agent is not null);

  -- B4-2: das Versandprotokoll trägt das Vertragsende im Primärschlüssel. Es unten mit `null` zu
  -- überschreiben ist unmöglich (Primärschlüssel), also wird die Zeile entfernt — sonst überlebte
  -- ausgerechnet das lokalisierende Merkmal, das die Anonymisierung am Lead gerade löscht. Der
  -- Nachweis, dass korrekt gearbeitet wurde, hängt daran nicht: er steht in den Einwilligungszeilen,
  -- die bewusst bestehen bleiben (B1-1).
  delete from platform.contract_reminders cr
   where cr.lead_id = p_lead_id;

  update platform.leads l
     set email         = 'anonymized+' || p_lead_id::text || '@invalid',
         company       = null,
         first_name    = null,
         last_name     = null,
         phone         = null,
         status        = 'anonymized',
         anonymized_at = now(),
         -- Bei einem Systemlauf ist p_actor per Prüfung oben bereits null; der CASE schreibt die
         -- Regel trotzdem hin, damit sie beim Lesen der Zeile nicht erst hergeleitet werden muss.
         anonymized_by        = case when v_by_system then null else p_actor end,
         anonymized_by_system = v_by_system,
         -- B3-1, lokalisierende Merkmale:
         postal_code       = null,
         supplier          = null,
         contract_end_date = null
   where l.id = p_lead_id;

  return jsonb_build_object(
    'status', 'ok', 'outcome', 'anonymized', 'by_system', v_by_system
  );
end;
$$;

comment on function platform.anonymize_lead(uuid, uuid, boolean) is
  'Anonymisiert einen Lead UNUMKEHRBAR: E-Mail → anonymized+<lead_id>@invalid (RFC 2606, nie '
  'zustellbar, je Lead eindeutig — hält den UNIQUE über die normalisierte Adresse ein), company/'
  'first_name/last_name/phone → null, source_ip/user_agent ALLER Einwilligungen → null, seit B3-1 '
  'zusätzlich postal_code/supplier/contract_end_date → null, seit B4-2 werden die Zeilen in '
  'platform.contract_reminders GELÖSCHT (das Vertragsende steht dort im Primärschlüssel und liesse '
  'sich nicht nullen), status=anonymized, anonymized_at gesetzt. first_name/last_name haben '
  'contact_name abgelöst — dasselbe Identitätsmerkmal, in zwei Werten geführt. BLEIBEN: die '
  'Einwilligungszeilen selbst (Zweck, Textfassung, Zeitpunkte — ohne Identitätsmerkmale kein '
  'Personenbezug mehr, aber weiterhin der Beleg, dass korrekt gearbeitet wurde), der '
  'Sperrlisten-Eintrag (er MUSS die Löschung überleben, B1-1) sowie industry/'
  'annual_consumption_kwh/metering_type. Die Trennlinie verläuft entlang „lokalisierend" gegen '
  '„grob einordnend". SEIT B4-1: p_by_system => true kennzeichnet den Fristenlauf als Urheber '
  '(anonymized_by null, anonymized_by_system true) und WIRFT, wenn zugleich ein p_actor mitkommt. '
  'Bestehende Zwei-Argument-Aufrufe verhalten sich unverändert. Idempotent: ein bereits '
  'anonymisierter Lead liefert Erfolg ohne zweite Wirkung, und die Urheberschaft bleibt beim '
  'ERSTEN. {status: ok|not_found}, outcome: anonymized|already_anonymized.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — public.capture_lead
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- DROP + CREATE, nicht `create or replace`: die Parameterliste ändert sich (ein Parameter wird zu
-- zweien), und `create or replace` kann sie nicht umbauen. Ein blosses CREATE erzeugte eine ZWEITE
-- Überladung — jeder bestehende Aufruf wäre dann mehrdeutig („function is not unique") und der
-- gesamte Erfassungspfad läge lahm. Dasselbe Vorgehen wie in B3-1.
--
-- Die zwei neuen Parameter stehen an DERSELBEN Stelle, an der p_contact_name stand (nach p_company,
-- vor p_phone). Ein Anhängen ans Ende wäre bequemer gewesen und hier falsch: die Reihenfolge der
-- Parameter ist die Lesereihenfolge der Erfassung, und ein Name gehört neben die Firma, nicht hinter
-- das Vertragsende.
drop function public.capture_lead(
  text, text, platform.consent_purpose, text, timestamptz, text, text, text, inet, text, text,
  platform.industry, text, integer, text, text, date
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
  p_contract_end_date date default null
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

  -- ── Lead anlegen oder wiederverwenden ──────────────────────────────────────────────────────────
  -- Konflikt-Ziel ist der AUSDRUCKS-Index aus B1-1 (platform.normalize_email(email)) — also
  -- dieselbe Definition von „dieselbe Adresse", die auch der BEFORE-Trigger anwendet. `do nothing`
  -- statt `do update`, weil der Wiederverwendungsfall unten mehr tut als ein Upsert ausdrücken
  -- könnte (Identitätsfelder nur ERGÄNZEN, Segmentierungsfelder AKTUALISIEREN).
  --
  -- Ein unzulässiger p_metering_type oder eine vierstellenwidrige PLZ wird hier NICHT abgefangen:
  -- der CHECK auf der Spalte lehnt sie ab, und zwar hart. Eine stille Bereinigung („nimm halt
  -- unknown") erzeugte einen Bestand, der geprüfte von geratenen Werten nicht mehr unterscheidet.
  insert into platform.leads (
    email, first_source_key, company, first_name, last_name, phone,
    industry, postal_code, annual_consumption_kwh, metering_type, supplier, contract_end_date
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
    p_contract_end_date
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
           contract_end_date      = coalesce(p_contract_end_date,      l.contract_end_date)
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
  platform.industry, text, integer, text, text, date
) is
  'B1-2, erweitert in B3-1, korrigiert in B3-2, Kontaktname aufgetrennt: EIN atomarer '
  'Erfassungsaufruf (Lead + optionale Einwilligung in EINER Transaktion — Lead und Nachweis dürfen '
  'nicht getrennt committen). Rückgabe {outcome, lead_id} mit outcome aus lead_only (kein Zweck '
  'übergeben) · consent_created (bestätigungspflichtiger Zweck: pending + Token, der '
  'Anwendungscode versendet die Bestätigungsmail) · consent_confirmed (NICHT '
  'bestätigungspflichtiger Zweck: sofort confirmed mit confirmed_at, der Anwendungscode liefert '
  'unmittelbar; ein übergebener Token wird dabei NICHT gespeichert) · consent_already_pending '
  '(offene, nicht abgelaufene Bestätigung — verhindert, dass wiederholtes Absenden fremde Adressen '
  'mit Bestätigungsmails zudeckt; greift nur bei bestätigungspflichtigen Zwecken) · suppressed '
  '(Adresse gesperrt: KEINE Einwilligung, der Lead bleibt — eine Anfrage ist keine Einwilligung). '
  'Bestätigungspflichtiger Zweck ohne p_token_hash wirft. ZUSAMMENFÜHRUNG bei wiederholter '
  'Erfassung: die sechs Segmentierungsfelder (industry, postal_code, annual_consumption_kwh, '
  'metering_type, supplier, contract_end_date) werden von einem übergebenen Wert ÜBERSCHRIEBEN, ein '
  'null-Wert lässt den bestehenden UNBERÜHRT; company/first_name/last_name/phone folgen bewusst der '
  'umgekehrten Vorrangregel (Bestand gewinnt). p_first_name/p_last_name haben p_contact_name '
  'abgelöst und stehen an derselben Stelle der Parameterliste. service_role-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — public.admin_update_lead
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Ebenfalls DROP + CREATE (aus demselben Grund wie bei capture_lead: die Parameterliste wächst um
-- eins). Aus den NEUN bearbeitbaren Feldern werden damit ZEHN — dieselbe Feldmenge, der Kontaktname
-- nur in zwei Werten.
--
-- Unverändert bleiben: `email` hat weiterhin GAR KEINEN Parameter, status/retention_basis/
-- first_source_key/deletion_due_at ebenso wenig (Begründungen ausführlich in B2-1); NULL heisst hier
-- LÖSCHEN und nicht „lasse unberührt" (bewusst gegenläufig zu capture_lead, s. dort); und die
-- Zweckbindungsprüfung für supplier/contract_end_date wirft weiterhin 22023. Sie betrifft andere
-- Felder und ist von der Namensauftrennung nicht berührt.
drop function public.admin_update_lead(
  uuid, text, text, text, platform.industry, text, integer, text, text, date
);

create function public.admin_update_lead(
  p_lead_id uuid,
  p_company text default null,
  p_first_name text default null,
  p_last_name text default null,
  p_phone text default null,
  p_industry platform.industry default null,
  p_postal_code text default null,
  p_annual_consumption_kwh integer default null,
  p_metering_type text default null,
  p_supplier text default null,
  p_contract_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anonymized_at timestamptz;
  -- Leerstring ist keine Angabe (dieselbe Normalisierung wie capture_lead, B3-1): ohne sie schriebe
  -- ein leer abgesendetes Formularfeld ein '' in den Bestand — das ist kein null, überlebt jedes
  -- COALESCE und liefe in den PLZ-CHECK.
  v_company     text := nullif(btrim(p_company), '');
  v_first_name  text := nullif(btrim(p_first_name), '');
  v_last_name   text := nullif(btrim(p_last_name), '');
  v_phone       text := nullif(btrim(p_phone), '');
  v_postal_code text := nullif(btrim(p_postal_code), '');
  v_metering    text := nullif(btrim(p_metering_type), '');
  v_supplier    text := nullif(btrim(p_supplier), '');
begin
  if not platform.is_admin() then
    raise exception 'public.admin_update_lead: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if p_lead_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Zeilensperre: zwei gleichzeitig abgesendete Formulare sollen nicht ineinander schreiben.
  select l.anonymized_at into v_anonymized_at
  from platform.leads l
  where l.id = p_lead_id
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_anonymized_at is not null then
    -- Der Trigger würde es ohnehin ablehnen — aber als Exception. Ein anonymisierter Lead ist hier
    -- ein fachlicher Zustand („dieser Vorgang ist abgeschlossen"), kein Autorisierungsfehler
    -- (dieselbe Unterscheidung wie in admin_set_lead_status, B1-3).
    return jsonb_build_object('status', 'anonymized');
  end if;

  if (v_supplier is not null or p_contract_end_date is not null)
     and not exists (
       select 1
       from platform.consents c
       join platform.consent_texts ct on ct.id = c.consent_text_id
       where c.lead_id = p_lead_id
         and ct.purpose = 'contract_expiry_reminder'
         and c.status in ('pending', 'confirmed')
     )
  then
    raise exception
      'public.admin_update_lead: Versorger und Vertragsende sind ausschliesslich für die '
      'Vertragsablauf-Erinnerung erhoben. Für Lead % besteht dafür keine Einwilligung (weder offen '
      'noch bestätigt) — ohne Zweck gibt es für diese Daten keine Grundlage. Auf null setzen ist '
      'weiterhin möglich.',
      p_lead_id
      using errcode = '22023';
  end if;

  update platform.leads l
     set company                = v_company,
         first_name             = v_first_name,
         last_name              = v_last_name,
         phone                  = v_phone,
         industry               = p_industry,
         postal_code            = v_postal_code,
         annual_consumption_kwh = p_annual_consumption_kwh,
         metering_type          = v_metering,
         supplier               = v_supplier,
         contract_end_date      = p_contract_end_date,
         -- auth.uid() funktioniert auch in einer SECURITY-DEFINER-Funktion (es liest die
         -- JWT-Claims der Sitzung, nicht die Datenbankrolle) — der Handelnde ist damit der echte
         -- angemeldete Admin und nicht der Eigentümer der Funktion (Muster wie B1-3).
         last_edited_by         = auth.uid()
   where l.id = p_lead_id;

  return jsonb_build_object('status', 'ok');
end;
$$;

comment on function public.admin_update_lead(
  uuid, text, text, text, text, platform.industry, text, integer, text, text, date
) is
  'B2-1, Kontaktname aufgetrennt: Korrekturweg für GENAU ZEHN Stammdatenfelder (company, '
  'first_name, last_name, phone, industry, postal_code, annual_consumption_kwh, metering_type, '
  'supplier, contract_end_date) und setzt dabei last_edited_by = auth.uid(). NICHT bearbeitbar und '
  'bewusst ohne Parameter: email (eine Änderung übertrüge eine bestätigte Einwilligung auf eine '
  'Adresse, die nie zugestimmt hat), status/retention_basis (dafür gibt es admin_set_lead_status '
  'samt Einbahnstrassen-Trigger), first_source_key (seit B1-1 unveränderlich), deletion_due_at '
  '(immer abgeleitet). NULL heisst hier SETZE AUF NULL, nicht „lasse unberührt" — anders als bei '
  'capture_lead, weil ein Bearbeitungsformular alle Felder schickt und ein geleertes Feld eine '
  'Aussage ist. WIRFT (22023), wenn supplier oder contract_end_date auf einen Wert ungleich null '
  'gesetzt werden sollen und für den Lead keine Einwilligung zu contract_expiry_reminder im Zustand '
  'pending oder confirmed besteht: der B3-1-Trigger löscht diese Felder beim Widerruf, ein '
  'händischer Eintrag umginge genau diese Zweckbindung. Auf null setzen ist immer erlaubt. WIRFT '
  'bei fehlender Adminrolle (42501); not_found und anonymized sind fachliche Zustände. '
  'authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — Die drei lesenden Wrapper
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Alle drei lasen `ld.contact_name` und liefen nach dem DROP oben zur Laufzeit auf eine
-- verschwundene Spalte. `create or replace` bei UNVERÄNDERTER Signatur — die Grants bleiben.
--
-- admin_list_leads und admin_export_leads standen NICHT in der Aufgabenstellung; sie sind trotzdem
-- Teil dieser Migration, weil plpgsql Funktionsrümpfe nicht beim Anlegen prüft: ohne sie liefe die
-- Migration sauber durch und die Lead-Liste bräche beim ersten Aufruf (derselbe Befund wie in B3-4).

-- ── public.admin_list_leads ──────────────────────────────────────────────────────────────────────
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
  p_contract_end_to date default null
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
  v_total    integer;
  v_export   integer;
  v_leads    jsonb;
  v_sources  jsonb;
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

  with base as (
    select ld.id, ld.email, ld.company, ld.first_name, ld.last_name, ld.phone, ld.status,
           ld.first_source_key, ld.retention_basis, ld.last_interaction_at,
           ld.deletion_due_at, ld.anonymized_at, ld.anonymized_by, ld.created_at,
           -- B2-1: die Segmentierungsmerkmale fahren in der LISTE mit. Ohne sie liesse sich ein
           -- gesetzter Filter nicht am Ergebnis nachvollziehen — man sähe nur, dass die Menge
           -- kleiner wurde, nicht warum.
           ld.industry, ld.postal_code, ld.annual_consumption_kwh, ld.metering_type,
           ld.supplier, ld.contract_end_date
    from platform.leads_matching(
           p_status, p_source_key, p_consent_purpose, p_consent_status, p_search, p_due_only,
           p_industry, p_metering_type, p_postal_prefix, p_consumption_min, p_consumption_max,
           p_contract_end_from, p_contract_end_to
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

  return jsonb_build_object(
    'status',       'ok',
    'leads',        v_leads,
    'total',        v_total,
    'export_total', v_export,
    'limit',        v_limit,
    'offset',       v_offset,
    'sources',      v_sources
  );
end;
$$;

-- ── public.admin_export_leads ────────────────────────────────────────────────────────────────────
-- Die Datei bekommt aus einer Spalte zwei — bewusst NICHT wieder zu einer zusammengeführt. Der Grund
-- für die Trennung (korrekte Anrede, Wiederverwendbarkeit in einem Serienbrief) gilt für die
-- ausgeführte Datei genauso wie für die Anzeige; sie beim Ausführen wieder zu verkleben, hiesse den
-- Zweck der Auftrennung genau dort aufzugeben, wo er am ehesten gebraucht wird.
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
  p_contract_end_to date default null
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
           ld.created_at,
           ld.last_interaction_at,
           -- PFLICHTSPALTE: ohne sie ist jede Zeile in einem fremden Werkzeug ununterscheidbar
           -- anschreibbar.
           platform.marketing_consent_state(ld.id) as marketing_consent
    from platform.leads_matching(
           p_status, p_source_key, p_consent_purpose, p_consent_status, p_search, p_due_only,
           p_industry, p_metering_type, p_postal_prefix, p_consumption_min, p_consumption_max,
           p_contract_end_from, p_contract_end_to
         ) ld
    where ld.anonymized_at is null
      and not platform.is_suppressed(ld.email)
  ) r;

  v_summary := platform.lead_filter_summary(
    p_status, p_source_key, p_consent_purpose, p_consent_status, p_search, p_due_only,
    p_industry, p_metering_type, p_postal_prefix, p_consumption_min, p_consumption_max,
    p_contract_end_from, p_contract_end_to
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

-- ── public.admin_get_lead ────────────────────────────────────────────────────────────────────────
create or replace function public.admin_get_lead(p_lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lead      jsonb;
  v_consents  jsonb;
  v_reminders jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_get_lead: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select to_jsonb(l) into v_lead
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
           ld.retention_basis,
           ld.last_interaction_at,
           ld.deletion_due_at,
           ld.anonymized_at,
           ld.anonymized_by,
           ld.anonymized_by_system,
           (select au.email from auth.users au where au.id = ld.anonymized_by)
             as anonymized_by_email,
           ld.last_edited_by,
           (select au.email from auth.users au where au.id = ld.last_edited_by)
             as last_edited_by_email,
           ld.industry,
           ld.postal_code,
           ld.annual_consumption_kwh,
           ld.metering_type,
           ld.supplier,
           ld.contract_end_date,
           ld.created_at,
           ld.updated_at,
           platform.is_suppressed(ld.email) as is_suppressed,
           -- B2-2: WARUM gesperrt. Nicht aus dem Ereignis-Ledger abgeleitet (eine Abmeldung über
           -- den Link erzeugt kein Ereignis), sondern aus der Liste selbst.
           (select s.reason
              from platform.email_suppressions s
             where s.email_hash = platform.email_hash(ld.email)) as suppression_reason,
           (ld.deletion_due_at <= now() and ld.anonymized_at is null) as deletion_due
    from platform.leads ld
    where ld.id = p_lead_id
  ) l;

  if v_lead is null then
    -- Fachlicher Zustand (veralteter Link), kein Autorisierungsfehler → Status, keine Exception.
    return jsonb_build_object('status', 'not_found');
  end if;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.granted_at desc), '[]'::jsonb)
    into v_consents
  from (
    select cs.id,
           ct.purpose,
           cs.status,
           platform.consent_effective_status(cs.status, cs.token_expires_at) as effective_status,
           cs.source_key,
           (select s.label from platform.lead_sources s where s.key = cs.source_key)
             as source_label,
           cs.granted_at,
           cs.confirmed_at,
           cs.withdrawn_at,
           cs.source_ip,
           cs.user_agent,
           ct.version    as consent_text_version,
           ct.locale     as consent_text_locale,
           ct.body       as consent_text_body,
           platform.purpose_requires_double_opt_in(ct.purpose) as requires_double_opt_in
    from platform.consents cs
    join platform.consent_texts ct on ct.id = cs.consent_text_id
    where cs.lead_id = p_lead_id
  ) c;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.contract_end_date desc), '[]'::jsonb)
    into v_reminders
  from (
    select cr.contract_end_date,
           cr.attempted_at,
           cr.delivered_at,
           cr.error
    from platform.contract_reminders cr
    where cr.lead_id = p_lead_id
  ) r;

  return jsonb_build_object(
    'status', 'ok', 'lead', v_lead, 'consents', v_consents, 'contract_reminders', v_reminders
  );
end;
$$;

comment on function public.admin_get_lead(uuid) is
  'B1-1, erweitert in B1-3, B3-1, B4-1, B4-2, B2-1 und B2-2: ein Lead samt allen Einwilligungen '
  '(inkl. angezeigtem Textkörper, Version/Sprache und effective_status), den sechs '
  'Segmentierungsmerkmalen, der Urheberschaft einer Anonymisierung, dem Versandprotokoll der '
  'Vertragsablauf-Erinnerung, last_edited_by samt Konto-E-Mail und seit B2-2 dem GRUND einer Sperre '
  '(suppression_reason: unsubscribed | bounced | complaint | manual; null, wenn nicht gesperrt oder '
  'der Lead anonymisiert ist). Der Kontaktname kommt seit der Auftrennung als first_name und '
  'last_name (nicht mehr contact_name). token_hash/token_expires_at fahren bewusst nicht mit. WIRFT '
  'bei fehlender Adminrolle (42501); ein unbekannter Lead ist ein fachlicher Zustand. '
  'authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 6 — Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Die zwei neu ANGELEGTEN Funktionen (drop + create) haben durch Supabases ALTER DEFAULT PRIVILEGES
-- wieder EXECUTE an anon, authenticated UND service_role bekommen (zusätzlich zum
-- PostgreSQL-Default-Grant an PUBLIC). Also erst allen entziehen, dann gezielt gewähren — exakt die
-- Rechtefläche, die sie vorher hatten. Ein DROP entfernt bestehende Grants; in B3-1 wurde genau das
-- schon einmal ausdrücklich geprüft.
--
-- capture_lead: NUR service_role. Kein Grant an `authenticated` (der Erfassungspfad ist anonym und
-- kennt keinen eingeloggten Nutzer) und keiner an `anon` (ein Browser-Grant machte das Formular zum
-- offenen Schreibzugang auf den Lead-Bestand).
revoke all on function public.capture_lead(
  text, text, platform.consent_purpose, text, timestamptz, text, text, text, text, inet, text, text,
  platform.industry, text, integer, text, text, date
) from public, anon, authenticated, service_role;

grant execute on function public.capture_lead(
  text, text, platform.consent_purpose, text, timestamptz, text, text, text, text, inet, text, text,
  platform.industry, text, integer, text, text, date
) to service_role;

-- admin_update_lead: NUR authenticated. service_role bekommt bewusst KEIN Grant — der Wrapper
-- leitet seine Autorisierung aus auth.uid() ab, das dort NULL ist; er wäre funktionslos und stets
-- abgelehnt (B2-1).
revoke all on function public.admin_update_lead(
  uuid, text, text, text, text, platform.industry, text, integer, text, text, date
) from public, anon, authenticated, service_role;

grant execute on function public.admin_update_lead(
  uuid, text, text, text, text, platform.industry, text, integer, text, text, date
) to authenticated;

-- Die vier `create or replace`-Funktionen behalten ihre Rechte (CREATE OR REPLACE lässt Eigentümer
-- und ACL unangetastet): admin_list_leads/admin_export_leads/admin_get_lead bleiben
-- authenticated-only, platform.anonymize_lead bleibt von aussen gar nicht aufrufbar. Der Entzug für
-- letztere wird trotzdem erneut ausgesprochen, damit die Aussage in dieser Datei gesetzt und nicht
-- nur vorausgesetzt ist (Muster B3-1).
revoke all on function platform.anonymize_lead(uuid, uuid, boolean) from public;
