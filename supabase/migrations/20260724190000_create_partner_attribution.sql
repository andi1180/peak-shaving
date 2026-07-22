-- B16-1 — Partner-Attribution: Stammdaten der Fachbetriebe und die Zuordnung am Lead
-- (Fahrplan_2026.md, Abschnitt B16 — erster von drei Teilen).
--
-- MODELL A: Ein Fachbetrieb verweist seine Bestandskunden über einen personalisierten Link an
-- COOLiN. COOLiN führt die Analyse und die Kundenbeziehung; der Partner bekommt das erste
-- Zugriffsrecht auf die Montage. Der Partner bekommt damit ausdrücklich KEINEN eigenen Zugang und
-- KEINE eigene Sicht auf Leads — das wäre B13 (Mandantenfähigkeit) und hinge zusätzlich an einem
-- Einwilligungszweck, den es nicht gibt.
--
-- REIN DATENBANK. Keine Route, keine Landingpage, kein UI, kein Admin-Screen — das sind B16-2 und
-- B16-3. Diese Migration legt Tabelle, Spalten, Trigger, RLS/Grants und die public-Wrapper an,
-- gegen die die beiden Folgeschritte dann bauen.
--
-- ── KONVENTIONEN (exakt T4-1/B1-1/B2-1/B14-1) ────────────────────────────────────────────────────
-- Alles Fachliche in `platform` (nicht über die REST-API exponiert, `supabase/config.toml`), Zugriff
-- von aussen ausschliesslich über SECURITY-DEFINER-Wrapper im `public`-Schema, alle Funktionen mit
-- `SET search_path = ''` und vollqualifizierten Objektnamen, erst `revoke all … from public, anon,
-- authenticated, service_role`, dann gezielt grants. `anon` bekommt NIRGENDS etwas.
--
-- ── DIE ZENTRALE ENTSCHEIDUNG: ZWEI SPALTEN, NICHT EINE ──────────────────────────────────────────
-- `platform.leads` bekommt `partner_slug` UND `referred_by_text` — die BESTÄTIGTE Zuordnung und den
-- FREITEXT, den der Interessent selbst eingegeben hat („Empfohlen durch"). Es ist dieselbe
-- Trennlinie, die B7 zwischen Extraktion und Interpretation zieht: die Kundenangabe ist eine
-- BEOBACHTUNG, die Zuordnung ist ein URTEIL.
--
-- Der Freitext trifft in der Praxis oft keinen Slug („Fa. Raymann Elektro", „mein Elektriker aus
-- Wiener Neustadt") und ist trotzdem der Beleg, auf den sich eine spätere Zuordnung stützt. In EINEM
-- Feld vermischt liesse sich nachträglich nicht mehr feststellen, ob „raymann" dort steht, weil der
-- Kunde es geschrieben hat oder weil jemand es zugeordnet hat — und an dieser Zuordnung hängt
-- später, wer ein Montageprojekt bekommt.
--
-- ── DIE ZWEITE ENTSCHEIDUNG: ANONYMISIERUNG BEHANDELT DIE BEIDEN SPALTEN UNTERSCHIEDLICH ─────────
-- `referred_by_text` wird von `platform.anonymize_lead` GENULLT und in `guard_anonymized_lead`
-- mitgeschützt: es ist Freitext einer Person und kann Namen Dritter enthalten („mein Schwager, der
-- Elektriker Huber") — genau die Angaben, die eine Anonymisierung entfernen soll.
--
-- `partner_slug` BLEIBT ERHALTEN und steht bewusst NICHT im Guard. „Dieser (anonymisierte) Lead kam
-- über Partner X" ist keine personenbezogene Angabe mehr, sobald E-Mail, Name und PLZ weg sind — und
-- die Partner-Statistik muss die werbliche Aufbewahrungsfrist von 24 Monaten ÜBERLEBEN. Andernfalls
-- verlöre ein Fachbetrieb rückwirkend den Nachweis über die Kontakte, die er gebracht hat, und zwar
-- ausgerechnet für die ältesten und damit wertvollsten. Die Trennlinie ist dieselbe wie in B3-1
-- („lokalisierend" gegen „grob einordnend"): der Partner lokalisiert niemanden.
--
-- ── WAS HIER AUSDRÜCKLICH NICHT ENTSTEHT ────────────────────────────────────────────────────────
-- Kein `tenant_id` und kein Partner-Login (B13). Kein neuer `consent_purpose` — B16-1 berührt
-- Einwilligungen nicht; die Rechtsgrundlage einer über einen Partnerlink entstandenen Anfrage ist
-- dieselbe wie beim Kontaktformular (Vertragsanbahnung). Und ausdrücklich KEIN Cookie, kein
-- localStorage, kein sessionStorage: die Attribution läuft ausschliesslich über den URL-Pfad und ein
-- Formularfeld. Eine Speicherung auf dem Endgerät wäre nach §165 TKG einwilligungspflichtig und
-- brächte einen Cookie-Banner für die gesamte Domain mit sich — das beendete die bestehende,
-- cookielose Analytics-Architektur (Fahrplan_2026.md, offene Entscheidung 5).

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — platform.partners: die Stammdaten der Fachbetriebe
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WARUM DER SLUG DER PRIMÄRSCHLÜSSEL IST UND ES KEINE ZWEITE KENNUNG GIBT ──────────────────────
-- Struktureller Zwilling von `platform.lead_sources` (B1-1): ein stabiler, maschinenlesbarer
-- Schlüssel, der in URLs wandert, von `platform.leads` referenziert wird, nie gelöscht und über
-- `is_active` stillgelegt wird. Eine zusätzliche `id uuid` wäre eine ZWEITE Identität für etwas,
-- dessen ganzer Zweck ein einziger, unwiderruflicher Schlüssel ist — und sie erzeugte die Frage,
-- welche der beiden in einem Link, in einer Auswertung und in einem Admin-Formular steht.
--
-- ── DERSELBE FORMAT-CONSTRAINT WIE lead_sources.key — aus B10-5 real gelernt ─────────────────────
-- `^[a-z0-9-]+$`. In B10-5 war ein Unterstrich als Herkunftsschlüssel vorgesehen und wurde von genau
-- diesem CHECK mit SQLSTATE 23514 abgewiesen; die Alternative wäre gewesen, die Invariante für eine
-- Namensvorliebe zu lockern. Hier wiegt das noch schwerer: der Partner-Slug steht in einem Link, den
-- ein Fachbetrieb an hunderte Bestandskunden verschickt. Er ist unwiderruflich, sobald die Mail raus
-- ist — ein Bestand mit zwei Schreibkonventionen liesse sich danach nicht mehr vereinheitlichen,
-- ohne bereits verteilte Links zu brechen.
create table platform.partners (
  slug text primary key check (slug ~ '^[a-z0-9-]+$'),
  display_name text not null check (btrim(display_name) <> ''),
  contact_first_name text,
  contact_last_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table platform.partners is
  'B16-1: Stammdaten der Fachbetriebe, die im Modell A ihre Bestandskunden per personalisiertem Link '
  'an COOLiN verweisen. Struktureller Zwilling von platform.lead_sources: der Schlüssel IST der '
  'Primärschlüssel (keine zweite Kennung), er wandert in URLs, wird von platform.leads.partner_slug '
  'referenziert und trägt denselben Format-CHECK. KEIN Partner-Login und keine Partner-eigene Sicht '
  'auf Leads (B13). Es gibt für NIEMANDEN ein delete-Grant — Stilllegung läuft über is_active.';

comment on column platform.partners.slug is
  'Der Schlüssel, der im personalisierten Link steht (kleingeschrieben, nur a-z 0-9 und Bindestrich, '
  'per CHECK erzwungen — dieselbe Regel wie platform.lead_sources.key, in B10-5 real als SQLSTATE '
  '23514 gemessen). Nach dem Anlegen UNVERÄNDERLICH (Trigger guard_partner_slug): er ist '
  'unwiderruflich, sobald der Fachbetrieb seine Kunden angeschrieben hat.';

comment on column platform.partners.display_name is
  'Anzeigename/Firma des Fachbetriebs — das EINZIGE frei korrigierbare Stammdatum neben der '
  'Kontaktperson. Pflichtfeld inklusive Leerstring-CHECK: '''' erfüllt NOT NULL, ist aber kein Name, '
  'und eine Partnerliste mit einer namenlosen Zeile ist nicht bedienbar.';

comment on column platform.partners.contact_first_name is
  'Vorname der Ansprechperson beim Fachbetrieb. Getrennt vom Nachnamen geführt, weil genau diese '
  'Zusammenlegung bei platform.leads einen Migrationsschritt gekostet hat (Auftrennung des '
  'Kontaktnamens, 24.07.2026): ein zusammengesetzter Freitextname lässt sich bei Doppelnamen, '
  'Namenszusätzen und Titeln nicht zuverlässig zerlegen, und der Fehler landet in einer Anrede. Ein '
  'zweites contact_name anzulegen hiesse, denselben Defekt eine Migration später neu einzuführen.';

comment on column platform.partners.contact_last_name is
  'Nachname der Ansprechperson (s. contact_first_name). Bewusst KEINE contact_email und KEIN '
  'contact_phone: es gibt in B16-1 keinen Benachrichtigungspfad, der sie benutzte (die Weitergabe '
  'eines Montageprojekts ist B16-3), und eine Spalte auf Vorrat wäre eine Angabe, von der niemand '
  'weiss, ob sie gepflegt ist. Additiv nachrüstbar.';

comment on column platform.partners.is_active is
  'Partner aktiv? Eine beendete Zusammenarbeit wird deaktiviert, NIE gelöscht — an ihr hängen die '
  'bereits erfolgten Zuordnungen (FK von platform.leads.partner_slug). Wirkung: public.capture_lead '
  'ordnet einem INAKTIVEN Partner nichts mehr zu (ein alter Link attributiert nicht weiter), '
  'public.admin_update_lead darf ihn dagegen weiterhin zuordnen — eine historische Zuordnung zu '
  'einem heute inaktiven Partner ist eine zulässige Feststellung.';

-- ── guard_partner_slug: der Schlüssel ist einmalig ───────────────────────────────────────────────
-- Muster exakt wie platform.guard_lead_first_source (B1-1). Der Fremdschlüssel allein reichte NICHT:
-- er blockiert nur die Änderung eines BEREITS REFERENZIERTEN Slugs (ON UPDATE NO ACTION). Ein
-- Partner, der noch keinen Lead gebracht hat, liesse sich sonst umbenennen — und genau dann ist der
-- Schaden am grössten, weil die verschickten Links ins Leere zeigen und die Leads, die daraufhin
-- kämen, gar nicht mehr entstehen. Ein Fehler, der sich als Ausbleiben äussert, wird nicht bemerkt.
create function platform.guard_partner_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is distinct from old.slug then
    raise exception
      'platform.partners.slug ist nach dem Anlegen unveränderlich (% → %) — der Schlüssel steht in '
      'bereits verschickten Links und kann nicht zurückgeholt werden. Ein neuer Schlüssel ist ein '
      'neuer Partnereintrag; der alte wird über is_active stillgelegt',
      old.slug, new.slug;
  end if;
  return new;
end;
$$;

comment on function platform.guard_partner_slug() is
  'BEFORE UPDATE auf partners: blockt jede Änderung des Slugs. Der Fremdschlüssel allein schützt nur '
  'bereits referenzierte Slugs; ungefährlich ist eine Umbenennung aber gerade dann NICHT, wenn noch '
  'kein Lead da ist — die verschickten Links zeigten ins Leere, und der Fehler äusserte sich als '
  'AUSBLEIBEN von Leads, was niemand bemerkt.';

create trigger partners_guard_slug
  before update on platform.partners
  for each row execute function platform.guard_partner_slug();

create trigger partners_set_updated_at
  before update on platform.partners
  for each row execute function platform.set_updated_at();

-- ── RLS und Grants ───────────────────────────────────────────────────────────────────────────────
-- RLS aktiv OHNE Policy (Muster wie platform.redemption_codes/job_runs/admin_exports): ohne Policy
-- sieht jede Nicht-BYPASSRLS-Rolle nichts, selbst wenn ihr jemand später versehentlich ein
-- Tabellen-Grant gibt — zwei unabhängige Schichten.
--
-- service_role bekommt SELECT: public.capture_lead ist zwar SECURITY DEFINER (und liest damit unter
-- dem Eigentümer), aber die Erfassung ist der einzige Pfad, der die Tabelle im Betrieb überhaupt
-- berührt, und das Grant macht sie ohne Umweg prüfbar. KEIN insert/update — Partner entstehen
-- ausschliesslich über die Admin-Wrapper unten (ein Fachbetrieb ist eine Vereinbarung, kein
-- Nebenprodukt einer anonymen Formularabsendung).
--
-- KEIN DELETE-GRANT, FÜR NIEMANDEN. Ein gelöschter Partner machte jede bereits erfolgte Zuordnung
-- unerklärbar: in `platform.leads` stünde ein Slug, zu dem es keine Zeile mehr gibt (der FK
-- verhinderte das zwar, aber genau deshalb ist die Löschung eines Partners mit Leads ohnehin
-- unmöglich — und für einen Partner OHNE Leads ist sie unnötig). Muster wie
-- monitor.scrape_targets: an/aus statt weg.
alter table platform.partners enable row level security;

grant select on platform.partners to service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — Die zwei Spalten auf platform.leads
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── DIE FK-AKTION, obwohl sie gegenstandslos ist ────────────────────────────────────────────────
-- Partner werden nie gelöscht (TEIL 1: kein delete-Grant), die Wahl der Aktion hat im Betrieb also
-- keinen Anwendungsfall. Sie wird trotzdem AUSGESCHRIEBEN statt weggelassen, damit die Entscheidung
-- in der DDL steht und nicht aus einer fehlenden Klausel erschlossen werden muss:
--
--   `on delete restrict` — eine Löschung, die mit erhöhten Rechten dennoch versucht würde, scheitert
--   LAUT. Das ist hier die richtige Richtung: die Zuordnung entscheidet später darüber, wer ein
--   Montageprojekt bekommt; sie stillschweigend zu verlieren wäre der teurere Ausgang als ein Fehler.
--
--   `on delete set null` ist ausdrücklich AUSGESCHLOSSEN — und zwar aus zwei Gründen. Erstens löschte
--   es genau die Aussage, die überleben soll. Zweitens ist eine referentielle SET-NULL-Aktion SELBST
--   EIN UPDATE und träfe damit auf die Asymmetrie, die in diesem Repo schon dreimal aufgeschlagen
--   ist (leads.last_edited_by B2-1, email_events.lead_id B2-2, analyses.lead_id/created_by B14-1):
--   jeder Unveränderlichkeits-Trigger auf der Zieltabelle bräuchte dann eine Ausnahme für genau
--   diese Spalte. `partner_slug` steht bewusst nicht im Guard — aber sich diese Kopplung gar nicht
--   erst einzuhandeln ist der belastbarere Weg.
--
-- `on update` bleibt bei der Voreinstellung (NO ACTION, blockiert ebenfalls) und ist doppelt
-- abgesichert: platform.guard_partner_slug lässt eine Slug-Änderung gar nicht erst zu.
alter table platform.leads
  add column partner_slug text references platform.partners (slug) on delete restrict,
  add column referred_by_text text;

comment on column platform.leads.partner_slug is
  'B16-1: die BESTÄTIGTE Partner-Zuordnung (FK auf platform.partners.slug), nullable. Eine '
  'FESTSTELLUNG, keine Kundenangabe — sie entscheidet später darüber, wer das erste Zugriffsrecht '
  'auf ein Montageprojekt bekommt. Entsteht entweder aus einem gültigen personalisierten Link '
  '(public.capture_lead, nur bei AKTIVEM Partner) oder durch eine Admin-Entscheidung '
  '(public.admin_update_lead). ÜBERLEBT die Anonymisierung bewusst und steht deshalb NICHT in '
  'guard_anonymized_lead: ohne E-Mail, Name und PLZ ist „kam über Partner X" keine personenbezogene '
  'Angabe mehr, und die Partner-Statistik muss die 24-Monats-Frist überdauern.';

comment on column platform.leads.referred_by_text is
  'B16-1: der FREITEXT, den der Interessent selbst eingegeben hat („Empfohlen durch"), nullable. '
  'BEOBACHTUNG, nicht Urteil — er trifft oft keinen Slug („Fa. Raymann Elektro", „mein Elektriker '
  'aus Wiener Neustadt") und ist trotzdem der Beleg, auf den sich eine spätere Zuordnung stützt. '
  'Bewusst NICHT über public.admin_update_lead korrigierbar (es ist die Angabe des Kunden, kein Feld, '
  'das jemand nachbessert). Wird von platform.anonymize_lead GENULLT und ist danach unveränderlich '
  '(guard_anonymized_lead): Freitext einer Person kann Namen Dritter enthalten.';

-- Zugriffspfad des Partner-Filters (public.admin_list_leads/admin_export_leads) UND der
-- Leadzählung je Partner (public.admin_list_partners). Partiell, weil der ganz überwiegende Teil des
-- Bestands keinen Partner trägt — und ausdrücklich OHNE die B3-1-Bedingung `anonymized_at is null`:
-- die Zählung MUSS anonymisierte Zeilen enthalten, das ist der Zweck der Ausnahme im Guard.
create index leads_partner_slug_idx on platform.leads (partner_slug)
  where partner_slug is not null;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — Anonymisierung: das eine Feld weg, das andere bleibt
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Der Guard schützte 16 Spalten (Namensauftrennung); es werden 17. Derselbe Grund wie in B3-1, B4-1
-- und bei der Auftrennung: ein Schutz, der seine eigene Erweiterung nicht abdeckt, läuft an ihr
-- vorbei — hier hiesse das, dass sich einem anonymisierten Lead nachträglich wieder ein Freitext
-- anheften liesse, der den Namen eines Dritten trägt.
--
-- `partner_slug` kommt bewusst NICHT dazu. Das ist kein Vergessen, sondern die Entscheidung aus dem
-- Kopfkommentar: die Zuordnung ist nach der Anonymisierung nicht mehr personenbezogen und muss
-- weiterhin feststellbar UND nachträglich zuordenbar bleiben. Praktisch bleibt der Weg dahin
-- trotzdem eng: public.admin_update_lead beantwortet einen anonymisierten Lead mit
-- {status: anonymized}, bevor es irgendetwas schreibt. Der Guard ist also nicht die einzige Hürde,
-- sondern die, die hier bewusst offen bleibt.
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
     -- B2-1: der Bearbeiter. NUR das SETZEN ist verboten (s. Begründung oben) — ein Übergang auf
     -- null bleibt möglich, weil ON DELETE SET NULL sonst am Guard scheiterte.
     or (new.last_edited_by is distinct from old.last_edited_by and new.last_edited_by is not null)
  then
    raise exception
      'platform.leads %: der Lead ist seit % anonymisiert — E-Mail, Firma, Vor- und Nachname, '
      'Telefon, Status, Aufbewahrungsgrundlage, der Anonymisierungszeitpunkt, sämtliche '
      'Segmentierungsmerkmale (Branche, PLZ, Jahresverbrauch, Messart, Versorger, Vertragsende), '
      'die Urheberschaft der Anonymisierung, die Empfehlungsangabe und die Zuschreibung einer '
      'Bearbeitung sind unveränderlich. Anonymisierung ist endgültig, auch für service_role und '
      'für den Admin',
      old.id, old.anonymized_at;
  end if;

  return new;
end;
$$;

comment on function platform.guard_anonymized_lead() is
  'BEFORE UPDATE auf leads: ist anonymized_at gesetzt, sind email, company, first_name, last_name, '
  'phone, status, retention_basis, anonymized_at, (seit B3-1) industry, postal_code, '
  'annual_consumption_kwh, metering_type, supplier, contract_end_date, (seit B4-1) '
  'anonymized_by_system, (seit B16-1) referred_by_text und (seit B2-1) last_edited_by unveränderlich '
  '— auch für service_role und für den Admin. platform.leads.partner_slug steht BEWUSST NICHT in der '
  'Liste: die Zuordnung ist nach der Anonymisierung nicht mehr personenbezogen, und die '
  'Partner-Statistik muss die Aufbewahrungsfrist überleben. Bei last_edited_by ist nur das SETZEN '
  'gesperrt, nicht das Nullen: die Spalte trägt ON DELETE SET NULL, und diese referentielle Aktion '
  'ist selbst ein UPDATE — ein vollständiger Schutz blockierte das Löschen des handelnden Kontos. '
  'anonymized_at steht bewusst mit in der Liste (sonst liesse sich der Guard durch Nullen seiner '
  'eigenen Bedingung abschalten); anonymized_by bewusst gar nicht (dieselbe ON-DELETE-Begründung, '
  'dort ohne Teillösung). last_interaction_at bleibt änderbar — der B1-1-Trigger '
  'touch_lead_on_consent muss weiter laufen können.';

-- ── platform.anonymize_lead ──────────────────────────────────────────────────────────────────────
-- Nullt zusätzlich `referred_by_text`. `partner_slug` wird ausdrücklich NICHT angefasst — dieselbe
-- Trennlinie wie bei industry/annual_consumption_kwh/metering_type, die B3-1 bewusst stehen lässt.
--
-- `create or replace` mit UNVERÄNDERTER Signatur (uuid, uuid, boolean) — die Grants/Revokes aus
-- B4-1 bleiben unangetastet.
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
         contract_end_date = null,
         -- B16-1: die Empfehlungsangabe des Interessenten. Freitext, kann Namen Dritter enthalten.
         -- partner_slug bleibt bewusst STEHEN (s. Kopfkommentar): „kam über Partner X" ist ohne
         -- Identitätsmerkmale keine personenbezogene Angabe mehr, und die Partner-Statistik muss
         -- die Aufbewahrungsfrist überleben.
         referred_by_text  = null
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
  'zusätzlich postal_code/supplier/contract_end_date → null, seit B16-1 auch referred_by_text → null '
  '(Freitext einer Person, kann Namen Dritter enthalten), seit B4-2 werden die Zeilen in '
  'platform.contract_reminders GELÖSCHT (das Vertragsende steht dort im Primärschlüssel und liesse '
  'sich nicht nullen), status=anonymized, anonymized_at gesetzt. BLEIBEN: die Einwilligungszeilen '
  'selbst (Zweck, Textfassung, Zeitpunkte — ohne Identitätsmerkmale kein Personenbezug mehr, aber '
  'weiterhin der Beleg, dass korrekt gearbeitet wurde), der Sperrlisten-Eintrag (er MUSS die '
  'Löschung überleben, B1-1), industry/annual_consumption_kwh/metering_type sowie seit B16-1 '
  'partner_slug (die Partner-Statistik muss die Aufbewahrungsfrist überdauern). Die Trennlinie '
  'verläuft entlang „lokalisierend" gegen „grob einordnend". SEIT B4-1: p_by_system => true '
  'kennzeichnet den Fristenlauf als Urheber (anonymized_by null, anonymized_by_system true) und '
  'WIRFT, wenn zugleich ein p_actor mitkommt. Bestehende Zwei-Argument-Aufrufe verhalten sich '
  'unverändert. Idempotent: ein bereits anonymisierter Lead liefert Erfolg ohne zweite Wirkung, und '
  'die Urheberschaft bleibt beim ERSTEN. {status: ok|not_found}, outcome: '
  'anonymized|already_anonymized.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — public.capture_lead: zwei angehängte Parameter
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- DROP + CREATE, nicht `create or replace`: die Parameterliste wächst, und `create or replace` kann
-- sie nicht erweitern. Ein blosses CREATE erzeugte eine ZWEITE Überladung — jeder bestehende Aufruf
-- wäre dann mehrdeutig („function is not unique") und der gesamte Erfassungspfad läge lahm. Dasselbe
-- Vorgehen wie in B3-1 und bei der Namensauftrennung.
--
-- ── DIE ZWEI NEUEN PARAMETER HÄNGEN HINTEN AN, mit Vorgabewert null ─────────────────────────────
-- Genau das Muster, mit dem `p_locale` (B1-2) und die sechs Segmentierungsfelder (B3-1) ergänzt
-- wurden: jeder bestehende Aufruf — auch ein POSITIONALER, wie ihn das B1-2-Gate bewusst führt —
-- bleibt unverändert gültig. Bei der Namensauftrennung wurde ausdrücklich ANDERS verfahren (Einschub
-- an der Stelle des abgelösten Parameters), weil dort ein Name neben die Firma gehört; die
-- Partner-Attribution ist dagegen ein eigener Gegenstand und kein Teil der Kontaktangaben.
--
-- ── ZUSAMMENFÜHRUNG: BEIDE FOLGEN `coalesce(Bestand, neu)` — die ERSTE Nennung gilt ─────────────
-- Also wie company/first_name/last_name/phone und ausdrücklich NICHT wie die sechs
-- Segmentierungsfelder aus B3-1 (dort gewinnt der neue Wert, weil Verbrauch, Versorger und
-- Vertragsende genau das sind, was sich ändert). Begründung: kommt derselbe Kontakt später über den
-- Link eines ANDEREN Fachbetriebs erneut, darf das die ursprüngliche Herkunft nicht überschreiben —
-- dieselbe Logik wie bei `first_source_key`, nur ohne dessen Unveränderlichkeits-Trigger, weil ein
-- Admin die Zuordnung als Urteil revidieren können muss (public.admin_update_lead).
--
-- ── EIN LINK MIT TIPPFEHLER DARF KEINEN LEAD KOSTEN ─────────────────────────────────────────────
-- Ein `p_partner_slug`, der auf keinen existierenden AKTIVEN Partner zeigt, wird VERWORFEN; der Lead
-- entsteht trotzdem, und ein mitgeschickter Freitext bleibt stehen. Dieselbe Abwägung wie überall
-- sonst hier: die Erfassung ist der teuerste Moment im Trichter, und ein harter Fehler an dieser
-- Stelle verlöre einen echten Interessenten wegen eines fremden Schreibfehlers.
--
-- Der verworfene Slug wird bewusst NICHT ersatzweise in `referred_by_text` geschrieben. Das Feld ist
-- per Definition, was der INTERESSENT eingegeben hat; ein aus dem Link nachgereichter Wert machte
-- genau die Unterscheidung kaputt, für die es die zweite Spalte überhaupt gibt.
drop function public.capture_lead(
  text, text, platform.consent_purpose, text, timestamptz, text, text, text, text, inet, text, text,
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
  p_contract_end_date date default null,
  -- B16-1, beide mit Vorgabewert null und ANGEHÄNGT:
  p_partner_slug text default null,
  p_referred_by_text text default null
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
  insert into platform.leads (
    email, first_source_key, company, first_name, last_name, phone,
    industry, postal_code, annual_consumption_kwh, metering_type, supplier, contract_end_date,
    partner_slug, referred_by_text
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
    v_referred_by
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
           referred_by_text       = coalesce(l.referred_by_text, v_referred_by)
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
  platform.industry, text, integer, text, text, date, text, text
) is
  'B1-2, erweitert in B3-1, korrigiert in B3-2, Kontaktname aufgetrennt, erweitert in B16-1: EIN '
  'atomarer Erfassungsaufruf (Lead + optionale Einwilligung in EINER Transaktion — Lead und Nachweis '
  'dürfen nicht getrennt committen). Rückgabe {outcome, lead_id} mit outcome aus lead_only (kein '
  'Zweck übergeben) · consent_created (bestätigungspflichtiger Zweck: pending + Token, der '
  'Anwendungscode versendet die Bestätigungsmail) · consent_confirmed (NICHT '
  'bestätigungspflichtiger Zweck: sofort confirmed mit confirmed_at, der Anwendungscode liefert '
  'unmittelbar; ein übergebener Token wird dabei NICHT gespeichert) · consent_already_pending '
  '(offene, nicht abgelaufene Bestätigung — verhindert, dass wiederholtes Absenden fremde Adressen '
  'mit Bestätigungsmails zudeckt; greift nur bei bestätigungspflichtigen Zwecken) · suppressed '
  '(Adresse gesperrt: KEINE Einwilligung, der Lead bleibt — eine Anfrage ist keine Einwilligung). '
  'Bestätigungspflichtiger Zweck ohne p_token_hash wirft. ZUSAMMENFÜHRUNG bei wiederholter '
  'Erfassung: die sechs Segmentierungsfelder (industry, postal_code, annual_consumption_kwh, '
  'metering_type, supplier, contract_end_date) werden von einem übergebenen Wert ÜBERSCHRIEBEN, ein '
  'null-Wert lässt den bestehenden UNBERÜHRT; company/first_name/last_name/phone sowie seit B16-1 '
  'partner_slug/referred_by_text folgen bewusst der umgekehrten Vorrangregel (Bestand gewinnt — die '
  'ERSTE Nennung eines Partners gilt, wie bei first_source_key). B16-1: ein p_partner_slug, der auf '
  'keinen existierenden AKTIVEN Partner zeigt, wird VERWORFEN statt den Lead scheitern zu lassen (ein '
  'Link mit Tippfehler darf keinen Lead kosten); ein mitgeschickter Freitext bleibt davon unberührt. '
  'Der Slug wird kleingeschrieben verglichen — der CHECK auf platform.partners.slug garantiert, dass '
  'jeder gespeicherte Slug kleingeschrieben ist. service_role-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — Die Filterschicht: EINE Definition, zwei Konsumenten (unverändert B2-1)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- `platform.leads_matching` und `platform.lead_filter_summary` bekommen den Partner-Filter, und
-- BEIDE Konsumenten (`admin_list_leads` UND `admin_export_leads`) reichen ihn durch.
--
-- ── WARUM DER EXPORT DEN FILTER MITBEKOMMT, obwohl die Aufgabe nur die Liste nennt ──────────────
-- Genau der Fall, gegen den B2-1 diese Schicht gebaut hat: Ein Admin filtert die Sicht auf einen
-- Partner, löst den Export aus — und bekäme eine Datei mit dem GESAMTEN Bestand. Beide Zahlen wären
-- plausibel, die Abweichung fiele erst an der Datei auf, und dann hätte sie das System bereits
-- verlassen. Eine Filterbedingung mit zwei Auslegungen ist keine Filterbedingung.
--
-- Beide Funktionen per DROP + CREATE (die Parameterliste wächst; `create or replace` kann das
-- nicht, und ein blosses CREATE erzeugte eine zweite Überladung). Sie sind kein Zugriffsweg von
-- aussen und tragen keine Grants, die wiederherzustellen wären — der Entzug wird trotzdem am Ende
-- erneut ausgesprochen, damit die Aussage in dieser Datei gesetzt und nicht vorausgesetzt ist.
drop function platform.leads_matching(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date
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
  -- B16-1, angehängt mit Vorgabewert null:
  p_partner_slug text default null
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
           coalesce(p_due_only, false)                       as f_due,
           -- LIKE-Sonderzeichen maskieren, damit ein getipptes „%" nicht plötzlich alles trifft
           -- (B1-3): der Admin sucht eine Adresse, er schreibt kein Muster.
           case
             when nullif(btrim(coalesce(p_search, '')), '') is null then null
             else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_')
                      || '%'
           end                                               as f_pattern
  )
  select ld.*
  from platform.leads ld, args a
  where (a.f_status is null or ld.status = a.f_status)
    and (a.f_source is null or ld.first_source_key = a.f_source)
    -- „Zur Anonymisierung fällig": Frist erreicht UND noch nicht anonymisiert. Ohne die zweite
    -- Bedingung stünden bereits erledigte Fälle dauerhaft in der Arbeitsliste.
    and (not a.f_due or (ld.deletion_due_at <= now() and ld.anonymized_at is null))
    and (
      a.f_pattern is null
      or ld.email ilike a.f_pattern escape '\'
      or coalesce(ld.company, '') ilike a.f_pattern escape '\'
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
    -- erwähnt". Der Freitext ist über die bestehende Freitextsuche ohnehin nicht erreichbar (sie
    -- geht über E-Mail und Firma) — das ist Absicht und wird hier nicht nebenbei geändert.
    and (a.f_partner is null or ld.partner_slug = a.f_partner)
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
    );
$$;

comment on function platform.leads_matching(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text
) is
  'B2-1, erweitert in B16-1: die EINE Filterbedingung des Lead-Bestands, benutzt von '
  'public.admin_list_leads UND public.admin_export_leads. Zwei eigene WHERE-Klauseln wären zwei '
  'Auslegungen desselben Filters, und die Abweichung fiele erst an einer ausgeführten Datei auf, die '
  'andere Zeilen enthält als die Sicht, aus der sie entstand. Filtert nur — projiziert nicht und '
  'prüft keine Rechte (das machen die Wrapper). PLZ als PRÄFIX (führende Ziffern = Netzgebiet). '
  'B16-1: der Partner-Filter greift auf partner_slug (die bestätigte Zuordnung), NICHT auf '
  'referred_by_text — gefragt ist „wem zugeschrieben", nicht „wer wurde erwähnt". Kein Zugriffsweg '
  'von aussen.';

-- ── platform.lead_filter_summary ─────────────────────────────────────────────────────────────────
drop function platform.lead_filter_summary(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date
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
  p_partner_slug text default null
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[] := '{}';
begin
  if nullif(btrim(coalesce(p_search, '')), '') is not null then
    v_parts := v_parts || ('Suche: ' || btrim(p_search));
  end if;
  if nullif(btrim(coalesce(p_status, '')), '') is not null then
    v_parts := v_parts || ('Status: ' || btrim(p_status));
  end if;
  if nullif(btrim(coalesce(p_source_key, '')), '') is not null then
    v_parts := v_parts || ('Herkunft: ' || btrim(p_source_key));
  end if;
  if p_consent_purpose is not null then
    v_parts := v_parts || ('Einwilligungszweck: ' || p_consent_purpose::text);
  end if;
  if nullif(btrim(coalesce(p_consent_status, '')), '') is not null then
    v_parts := v_parts || ('Einwilligungszustand: ' || btrim(p_consent_status));
  end if;
  if coalesce(p_due_only, false) then
    v_parts := v_parts || 'nur zur Anonymisierung fällige';
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

  -- „alles" ist eine ANGEWANDTE Auswahl und wird als solche protokolliert — es gibt keinen Export
  -- ohne Filter, es gibt nur den Filter „alles" (s. TEIL 3).
  if cardinality(v_parts) = 0 then
    return 'alle (kein Filter gesetzt) — ohne gesperrte und anonymisierte Zeilen';
  end if;

  return array_to_string(v_parts, ' · ') || ' — ohne gesperrte und anonymisierte Zeilen';
end;
$$;

comment on function platform.lead_filter_summary(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text
) is
  'B2-1, erweitert in B16-1: der angewandte Filter als ein Satz für '
  'platform.admin_exports.filter_summary. Steht in der Datenbank und nicht im Anwendungscode, damit '
  'das Protokoll beschreibt, was tatsächlich angewandt wurde. Ein leerer Filter wird ausdrücklich '
  'als „alle" protokolliert — es gibt keinen ungefilterten Export, nur den Filter „alles". Der '
  'Partner erscheint als SLUG und nicht als Anzeigename: der Slug ist unveränderlich, der '
  'Anzeigename korrigierbar, und ein Protokoll, dessen Aussage sich mit einer späteren Umbenennung '
  'ändert, ist keins.';

-- ── public.admin_list_leads ──────────────────────────────────────────────────────────────────────
-- DROP + CREATE (achte Erweiterung der Parameterliste, dieselbe Begründung wie in B2-1). FOLGE: die
-- Grants sind weg und werden unten erneut gesetzt.
drop function public.admin_list_leads(
  integer, integer, text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date
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
  -- B16-1, angehängt:
  p_partner_slug text default null
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
           ld.partner_slug, ld.referred_by_text
    from platform.leads_matching(
           p_status, p_source_key, p_consent_purpose, p_consent_status, p_search, p_due_only,
           p_industry, p_metering_type, p_postal_prefix, p_consumption_min, p_consumption_max,
           p_contract_end_from, p_contract_end_to, p_partner_slug
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
  platform.industry, text, text, integer, integer, date, date, text
) is
  'B1-1/B1-3, erweitert in B2-1 und B16-1: paginierte, gefilterte Lead-Liste (neueste zuerst, limit '
  '1..200, default 50). Filtert AUSSCHLIESSLICH über platform.leads_matching — dieselbe Bedingung, '
  'die auch public.admin_export_leads benutzt. Je Zeile zusätzlich is_suppressed, deletion_due, die '
  'Einwilligungen mit effective_status, die Segmentierungsmerkmale und seit B16-1 partner_slug samt '
  'referred_by_text (erst ihr Nebeneinander zeigt die zu entscheidenden Fälle). In der Antwort '
  'fahren die Einstiegspunkte UND die Partner als Auswahllisten mit (beides Tabellen, die der '
  'Anwendungscode nicht als Konstante spiegeln kann). Ein unbekannter Filterwert wird als '
  '{status: invalid_filter, filter} ABGELEHNT und nicht ignoriert — auch ein unbekannter '
  'partner_slug, dessen leere Ergebnismenge sich sonst als „dieser Partner hat niemanden gebracht" '
  'läse. WIRFT bei fehlender Adminrolle (SQLSTATE 42501). authenticated-only.';

-- ── public.admin_export_leads ────────────────────────────────────────────────────────────────────
-- Ebenfalls DROP + CREATE. Die zwei neuen Spalten fahren in der DATEI mit: `partner_slug` ist die
-- Angabe, wegen der eine partnerbezogene Auswertung überhaupt ausgeführt wird, und `referred_by_text`
-- ist der Beleg, ohne den sie nicht überprüfbar wäre.
drop function public.admin_export_leads(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date
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
  p_partner_slug text default null
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
           ld.created_at,
           ld.last_interaction_at,
           -- PFLICHTSPALTE: ohne sie ist jede Zeile in einem fremden Werkzeug ununterscheidbar
           -- anschreibbar.
           platform.marketing_consent_state(ld.id) as marketing_consent
    from platform.leads_matching(
           p_status, p_source_key, p_consent_purpose, p_consent_status, p_search, p_due_only,
           p_industry, p_metering_type, p_postal_prefix, p_consumption_min, p_consumption_max,
           p_contract_end_from, p_contract_end_to, p_partner_slug
         ) ld
    where ld.anonymized_at is null
      and not platform.is_suppressed(ld.email)
  ) r;

  v_summary := platform.lead_filter_summary(
    p_status, p_source_key, p_consent_purpose, p_consent_status, p_search, p_due_only,
    p_industry, p_metering_type, p_postal_prefix, p_consumption_min, p_consumption_max,
    p_contract_end_from, p_contract_end_to, p_partner_slug
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
  platform.industry, text, text, integer, integer, date, date, text
) is
  'B2-1, erweitert in B16-1: führt den gefilterten Bestand als Zeilen aus und protokolliert die '
  'Ausfuhr in platform.admin_exports (row_count + der von platform.lead_filter_summary erzeugte '
  'Filtertext). Nimmt DIESELBEN Filterparameter entgegen wie public.admin_list_leads und benutzt '
  'DIESELBE Bedingung (platform.leads_matching) — der Partner-Filter ist hier ausdrücklich '
  'eingeschlossen: eine auf einen Fachbetrieb gefilterte Sicht, aus der eine Datei mit dem '
  'GESAMTBESTAND fiele, wäre genau die Divergenz, gegen die diese Schicht gebaut ist. Gesperrte und '
  'anonymisierte Zeilen sind in der ABFRAGE ausgeschlossen, nicht über einen Filter. Je Zeile fahren '
  'der Marketing-Einwilligungsstand (Pflicht), seit B16-1 partner_slug samt Anzeigename und '
  'referred_by_text mit. WIRFT bei fehlender Adminrolle (42501). authenticated-only.';

-- ── public.admin_update_lead ─────────────────────────────────────────────────────────────────────
-- DROP + CREATE (die Parameterliste wächst um eins). Aus ZEHN bearbeitbaren Feldern werden ELF.
--
-- ── partner_slug IST bearbeitbar, referred_by_text NICHT ────────────────────────────────────────
-- Das ist die Anwendung derselben Trennlinie, die die zwei Spalten überhaupt begründet: die
-- Zuordnung ist ein URTEIL und muss revidierbar sein — genau hierüber ordnet ein Admin einen
-- Freitext („Fa. Raymann Elektro") einer echten Partnerzeile zu. Der Freitext ist die ANGABE DES
-- KUNDEN; ihn nachzubessern hiesse, die Beobachtung an das Urteil anzugleichen und damit den Beleg
-- zu vernichten, auf den sich das Urteil stützt. Er hat deshalb — wie `email` seit B2-1 — bewusst
-- GAR KEINEN Parameter.
--
-- Ein unbekannter Slug WIRFT hier (22023) und wird NICHT verworfen. Anders als in capture_lead steht
-- hier kein echter Interessent auf dem Spiel, sondern eine bewusste Handlung eines Menschen: eine
-- still verworfene Zuordnung sähe für ihn aus wie eine erfolgte.
-- Ein INAKTIVER Partner ist dagegen zulässig — eine historische Zuordnung zu einem Fachbetrieb, mit
-- dem die Zusammenarbeit inzwischen endete, ist eine korrekte Feststellung und kein Fehler.
drop function public.admin_update_lead(
  uuid, text, text, text, text, platform.industry, text, integer, text, text, date
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
  p_contract_end_date date default null,
  -- B16-1, angehängt:
  p_partner_slug text default null
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
  v_partner     text := lower(nullif(btrim(p_partner_slug), ''));
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
    --
    -- B16-1: partner_slug steht bewusst NICHT im Guard (die Zuordnung überlebt die Anonymisierung),
    -- doch dieser Weg bleibt trotzdem zu — die Ausnahme im Guard ist dafür da, dass die BESTEHENDE
    -- Zuordnung erhalten bleibt, nicht dafür, dass ein anonymisierter Lead nachträglich einem
    -- Fachbetrieb zugeschrieben wird. Für den fehlte nach der Anonymisierung jede Grundlage: der
    -- Freitext, der eine Zuordnung belegen würde, ist gerade gelöscht worden.
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

  -- B16-1: der Fremdschlüssel würde einen unbekannten Slug ebenfalls ablehnen — aber als
  -- 23503-Verletzung ohne Satz, den eine Oberfläche anzeigen könnte. Hier steht der Grund drin.
  if v_partner is not null
     and not exists (select 1 from platform.partners p where p.slug = v_partner)
  then
    raise exception
      'public.admin_update_lead: Partner "%" existiert nicht. Die Zuordnung wird bewusst NICHT '
      'stillschweigend verworfen — sie entscheidet später darüber, wer ein Montageprojekt bekommt, '
      'und eine verworfene Zuordnung sähe aus wie eine erfolgte. Ein Partner ist vorher anzulegen '
      '(public.admin_create_partner); ein INAKTIVER Partner ist hier ausdrücklich zulässig.',
      v_partner
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
         -- NULL heisst auch hier LÖSCHEN: eine falsch getroffene Zuordnung muss zurücknehmbar sein,
         -- sonst wäre das Urteil endgültiger als die Beobachtung, auf der es beruht.
         partner_slug           = v_partner,
         -- auth.uid() funktioniert auch in einer SECURITY-DEFINER-Funktion (es liest die
         -- JWT-Claims der Sitzung, nicht die Datenbankrolle) — der Handelnde ist damit der echte
         -- angemeldete Admin und nicht der Eigentümer der Funktion (Muster wie B1-3).
         last_edited_by         = auth.uid()
   where l.id = p_lead_id;

  return jsonb_build_object('status', 'ok');
end;
$$;

comment on function public.admin_update_lead(
  uuid, text, text, text, text, platform.industry, text, integer, text, text, date, text
) is
  'B2-1, Kontaktname aufgetrennt, erweitert in B16-1: Korrekturweg für GENAU ELF Stammdatenfelder '
  '(company, first_name, last_name, phone, industry, postal_code, annual_consumption_kwh, '
  'metering_type, supplier, contract_end_date, partner_slug) und setzt dabei last_edited_by = '
  'auth.uid(). Über p_partner_slug ordnet ein Admin einen Freitext einer echten Partnerzeile zu — '
  'das ist der einzige Weg dorthin. NICHT bearbeitbar und bewusst ohne Parameter: email (eine '
  'Änderung übertrüge eine bestätigte Einwilligung auf eine Adresse, die nie zugestimmt hat), '
  'referred_by_text (seit B16-1: die Angabe DES KUNDEN, kein Feld, das jemand nachbessert — sie ist '
  'der Beleg, auf den sich die Zuordnung stützt), status/retention_basis (dafür gibt es '
  'admin_set_lead_status samt Einbahnstrassen-Trigger), first_source_key (seit B1-1 unveränderlich), '
  'deletion_due_at (immer abgeleitet). NULL heisst hier SETZE AUF NULL, nicht „lasse unberührt" — '
  'anders als bei capture_lead, weil ein Bearbeitungsformular alle Felder schickt und ein geleertes '
  'Feld eine Aussage ist; für partner_slug heisst das, dass eine falsche Zuordnung zurücknehmbar '
  'ist. WIRFT (22023), wenn supplier oder contract_end_date ohne Einwilligung zu '
  'contract_expiry_reminder gesetzt werden sollen, und ebenso (22023) bei einem unbekannten '
  'partner_slug — anders als capture_lead wird hier NICHT verworfen, weil eine still verworfene '
  'Zuordnung wie eine erfolgte aussähe; ein INAKTIVER Partner ist zulässig. WIRFT bei fehlender '
  'Adminrolle (42501); not_found und anonymized sind fachliche Zustände. authenticated-only.';

-- ── public.admin_get_lead ────────────────────────────────────────────────────────────────────────
-- `create or replace` bei UNVERÄNDERTER Signatur — die Grants bleiben. Beide neuen Felder fahren mit,
-- und der Anzeigename des Partners dazu: ein Slug allein zwänge die Detailansicht zu einem zweiten
-- Aufruf, nur um einen Namen anzeigen zu können.
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
           -- B16-1: Zuordnung, Anzeigename und Freitext. Der Anzeigename fährt mit, damit die
           -- Detailansicht keinen zweiten Aufruf braucht, um einen Namen statt eines Schlüssels zu
           -- zeigen; is_active dazu, weil „zugeordnet zu einem stillgelegten Fachbetrieb" ein
           -- Zustand ist, den man sehen muss, statt ihn aus dem Ausbleiben zu schliessen.
           ld.partner_slug,
           (select p.display_name from platform.partners p where p.slug = ld.partner_slug)
             as partner_display_name,
           (select p.is_active from platform.partners p where p.slug = ld.partner_slug)
             as partner_is_active,
           ld.referred_by_text,
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
  'B1-1, erweitert in B1-3, B3-1, B4-1, B4-2, B2-1, B2-2 und B16-1: ein Lead samt allen '
  'Einwilligungen (inkl. angezeigtem Textkörper, Version/Sprache und effective_status), den sechs '
  'Segmentierungsmerkmalen, der Urheberschaft einer Anonymisierung, dem Versandprotokoll der '
  'Vertragsablauf-Erinnerung, last_edited_by samt Konto-E-Mail, dem GRUND einer Sperre '
  '(suppression_reason) und seit B16-1 der Partner-Attribution: partner_slug, partner_display_name, '
  'partner_is_active (ein stillgelegter Fachbetrieb ist ein sichtbarer Zustand, kein Ausbleiben) und '
  'referred_by_text. Der Kontaktname kommt seit der Auftrennung als first_name und last_name. '
  'token_hash/token_expires_at fahren bewusst nicht mit. WIRFT bei fehlender Adminrolle (42501); ein '
  'unbekannter Lead ist ein fachlicher Zustand. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 6 — Die vier Partner-Wrapper
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Alle vier: SECURITY DEFINER, ausschliesslich an `authenticated` gegrantet, und jeder prüft als
-- erste Anweisung `platform.is_admin()` und WIRFT sonst SQLSTATE 42501 — dasselbe Muster wie
-- `admin_list_leads` (B1-1) und die bewusste Abweichung von T4-4: „kein Zugriff" darf sich nie als
-- „keine Partner" lesen lassen. Ein leeres Ergebnis und eine Ablehnung sind verschiedene Dinge; eine
-- Exception kann man nicht verwechseln.
--
-- Fachliche Zustände (Slug schon vergeben, Partner nicht gefunden, Pflichtfeld leer) bleiben Status.

-- ── admin_create_partner ─────────────────────────────────────────────────────────────────────────
-- Legt NUR an (kein Upsert, Muster wie admin_create_code aus T4-4): ein versehentlich doppelt
-- abgeschicktes Formular darf einen bestehenden Fachbetrieb nicht stillschweigend umbenennen,
-- während seine Links bereits im Umlauf sind.
--
-- Der Format-CHECK wird VORHER geprüft und als Status beantwortet, statt ihn als 23514 durchschlagen
-- zu lassen: der Slug ist die einzige Eingabe dieses Formulars, die eine Regel hat, und ein
-- Constraint-Text ist für die Person, die ihn tippt, keine Auskunft. Der CHECK bleibt trotzdem die
-- harte Grenze — hier steht nur die lesbare Fassung davor.
create function public.admin_create_partner(
  p_slug text,
  p_display_name text,
  p_contact_first_name text default null,
  p_contact_last_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Kleingeschrieben angenommen: der CHECK verlangt Kleinschreibung, und ein Formular mit
  -- „Raymann-Elektro" abzuweisen, statt daraus „raymann-elektro" zu machen, wäre eine Hürde ohne
  -- Ertrag — die Bedeutung ist eindeutig, es gibt keine zweite Lesart.
  v_slug         text := lower(nullif(btrim(p_slug), ''));
  v_display_name text := nullif(btrim(p_display_name), '');
  v_first_name   text := nullif(btrim(p_contact_first_name), '');
  v_last_name    text := nullif(btrim(p_contact_last_name), '');
begin
  if not platform.is_admin() then
    raise exception 'public.admin_create_partner: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if v_slug is null or v_display_name is null then
    return jsonb_build_object('status', 'missing_fields');
  end if;

  if v_slug !~ '^[a-z0-9-]+$' then
    return jsonb_build_object('status', 'invalid_slug');
  end if;

  if exists (select 1 from platform.partners p where p.slug = v_slug) then
    return jsonb_build_object('status', 'duplicate_slug');
  end if;

  insert into platform.partners (slug, display_name, contact_first_name, contact_last_name)
  values (v_slug, v_display_name, v_first_name, v_last_name);

  return jsonb_build_object('status', 'created', 'slug', v_slug);
end;
$$;

comment on function public.admin_create_partner(text, text, text, text) is
  'B16-1: legt einen Fachbetrieb an (NUR anlegen, kein Upsert — ein doppelt abgeschicktes Formular '
  'darf einen bestehenden Partner nicht umbenennen, während seine Links im Umlauf sind). Der Slug '
  'wird kleingeschrieben übernommen und muss ^[a-z0-9-]+$ erfüllen; die Ablehnung kommt als Status '
  'statt als 23514, weil ein Constraint-Text für die tippende Person keine Auskunft ist (der CHECK '
  'bleibt die harte Grenze dahinter). Rückgabe {status: created|missing_fields|invalid_slug|'
  'duplicate_slug, slug}. WIRFT bei fehlender Adminrolle (42501). authenticated-only.';

-- ── admin_update_partner ─────────────────────────────────────────────────────────────────────────
-- Der Slug ist hier BEZEICHNER, nicht bearbeitbares Feld — genau wie `email` in admin_update_lead
-- (B2-1) keinen Parameter hat. Er steht in verschickten Mails und kann nicht zurückgeholt werden;
-- ein Wrapper, der ihn änderte, brächte die bereits verteilten Links zum Erliegen. Der Trigger
-- guard_partner_slug ist die harte Grenze dahinter.
--
-- Für die Kontaktperson gilt die admin_update_lead-Regel (NULL heisst LÖSCHEN, nicht „unberührt
-- lassen"): das ist ein Bearbeitungsformular, es schickt alle Felder, und ein geleertes Feld ist eine
-- Aussage. Der Anzeigename ist davon ausgenommen — er ist Pflichtfeld, ein leerer Wert wäre keine
-- Aussage, sondern ein unbedienbarer Listeneintrag.
create function public.admin_update_partner(
  p_slug text,
  p_display_name text,
  p_contact_first_name text default null,
  p_contact_last_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug         text := lower(nullif(btrim(p_slug), ''));
  v_display_name text := nullif(btrim(p_display_name), '');
  v_found        text;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_update_partner: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if v_slug is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_display_name is null then
    return jsonb_build_object('status', 'missing_fields');
  end if;

  update platform.partners p
     set display_name       = v_display_name,
         contact_first_name = nullif(btrim(p_contact_first_name), ''),
         contact_last_name  = nullif(btrim(p_contact_last_name), '')
   where p.slug = v_slug
  returning p.slug into v_found;

  if v_found is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object('status', 'ok', 'slug', v_found);
end;
$$;

comment on function public.admin_update_partner(text, text, text, text) is
  'B16-1: korrigiert Anzeigename und Kontaktperson eines Fachbetriebs. Der SLUG ist Bezeichner und '
  'hat bewusst keinen ändernden Parameter — genau wie email in public.admin_update_lead: er steht in '
  'bereits verschickten Links und kann nicht zurückgeholt werden (der Trigger '
  'platform.guard_partner_slug ist die harte Grenze dahinter). Für die Kontaktperson heisst NULL '
  'LÖSCHEN (Bearbeitungsformular-Regel wie in admin_update_lead); der Anzeigename ist Pflicht und '
  'kann nicht geleert werden. Rückgabe {status: ok|not_found|missing_fields, slug}. WIRFT bei '
  'fehlender Adminrolle (42501). authenticated-only.';

-- ── admin_set_partner_active ─────────────────────────────────────────────────────────────────────
-- Das Gegenstück zum fehlenden Löschweg. Deaktiviert wirkt sofort dort, wo es zählt: capture_lead
-- ordnet einem inaktiven Partner nichts mehr zu, ein bereits verschickter Link attributiert also
-- nicht weiter. Alles Bestehende bleibt — die Zuordnungen, die Statistik, die Historie.
create function public.admin_set_partner_active(p_slug text, p_is_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug   text := lower(nullif(btrim(p_slug), ''));
  v_active boolean := coalesce(p_is_active, false);
  v_found  text;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_set_partner_active: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if v_slug is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  update platform.partners p
     set is_active = v_active
   where p.slug = v_slug
  returning p.slug into v_found;

  if v_found is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object('status', 'ok', 'slug', v_found, 'is_active', v_active);
end;
$$;

comment on function public.admin_set_partner_active(text, boolean) is
  'B16-1: legt einen Fachbetrieb still bzw. reaktiviert ihn. KEIN Delete-Pendant, und für niemanden '
  'ein delete-Grant auf platform.partners: an einem Partner hängen die bereits erfolgten '
  'Zuordnungen, und ein gelöschter Partner machte sie unerklärbar. is_active=false wirkt sofort dort, '
  'wo es zählt — public.capture_lead ordnet einem inaktiven Partner nichts mehr zu, ein bereits '
  'verschickter Link attributiert also nicht weiter; public.admin_update_lead darf ihn dagegen '
  'weiterhin zuordnen (eine historische Feststellung). Rückgabe {status: ok|not_found, slug, '
  'is_active}. WIRFT bei fehlender Adminrolle (42501). authenticated-only.';

-- ── admin_list_partners ──────────────────────────────────────────────────────────────────────────
-- Je Zeile die Zahl der zugeordneten Leads. Sie ist der Gegenstand der ganzen Attribution, und sie
-- zählt AUSDRÜCKLICH die anonymisierten mit — genau dafür ist partner_slug aus dem Guard
-- herausgehalten. Eine Zählung, die nach 24 Monaten schrumpft, nähme einem Fachbetrieb rückwirkend
-- den Nachweis über die Kontakte, die er gebracht hat.
--
-- `customer_count` daneben, weil „gebracht" und „geworden" verschiedene Zahlen sind und die zweite
-- die ist, über die später abgerechnet oder verhandelt wird.
create function public.admin_list_partners()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_partners jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_list_partners: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.display_name), '[]'::jsonb)
    into v_partners
  from (
    select pt.slug,
           pt.display_name,
           pt.contact_first_name,
           pt.contact_last_name,
           pt.is_active,
           pt.created_at,
           pt.updated_at,
           (select count(*)::integer from platform.leads l where l.partner_slug = pt.slug)
             as lead_count,
           (select count(*)::integer from platform.leads l
             where l.partner_slug = pt.slug and l.status = 'customer')
             as customer_count
    from platform.partners pt
  ) p;

  return jsonb_build_object('status', 'ok', 'partners', v_partners);
end;
$$;

comment on function public.admin_list_partners() is
  'B16-1: alle Fachbetriebe (nach Anzeigename sortiert) samt lead_count und customer_count. Der '
  'lead_count zählt anonymisierte Leads AUSDRÜCKLICH MIT — genau dafür ist partner_slug aus '
  'platform.guard_anonymized_lead herausgehalten und wird von platform.anonymize_lead nicht '
  'genullt; eine Zahl, die nach 24 Monaten schrumpft, nähme einem Partner rückwirkend den Nachweis '
  'über die von ihm gebrachten Kontakte. customer_count steht daneben, weil „gebracht" und '
  '„geworden" verschiedene Zahlen sind. WIRFT bei fehlender Adminrolle (SQLSTATE 42501) statt eine '
  'leere Liste zu liefern — „kein Zugriff" darf sich nie als „keine Partner" lesen lassen. '
  'authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 7 — Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf NEUE public-Funktionen automatisch EXECUTE an
-- anon, authenticated UND service_role (zusätzlich zum PostgreSQL-Default-Grant an PUBLIC). Ein DROP
-- entfernt zugleich die bestehenden Grants. Für JEDE hier neu angelegte Funktion gilt deshalb: erst
-- allen entziehen, dann gezielt gewähren — exakt die Rechtefläche, die sie vorher hatte. In B3-1 ist
-- genau dieser Schritt schon einmal ausdrücklich geprüft worden; das DB-Gate misst sie nach.

-- capture_lead: NUR service_role. Kein Grant an `authenticated` (der Erfassungspfad ist anonym und
-- kennt keinen eingeloggten Nutzer) und keiner an `anon` (ein Browser-Grant machte das Formular zum
-- offenen Schreibzugang auf den Lead-Bestand).
revoke all on function public.capture_lead(
  text, text, platform.consent_purpose, text, timestamptz, text, text, text, text, inet, text, text,
  platform.industry, text, integer, text, text, date, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.capture_lead(
  text, text, platform.consent_purpose, text, timestamptz, text, text, text, text, inet, text, text,
  platform.industry, text, integer, text, text, date, text, text
) to service_role;

-- Die vier neu angelegten Admin-Wrapper auf leads: NUR authenticated. service_role bekommt bewusst
-- KEIN Grant — sie leiten ihre Autorisierung aus auth.uid() ab, das dort NULL ist; sie wären
-- funktionslos und stets abgelehnt (B2-1).
revoke all on function public.admin_list_leads(
  integer, integer, text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text
) from public, anon, authenticated, service_role;

revoke all on function public.admin_export_leads(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text
) from public, anon, authenticated, service_role;

revoke all on function public.admin_update_lead(
  uuid, text, text, text, text, platform.industry, text, integer, text, text, date, text
) from public, anon, authenticated, service_role;

grant execute on function public.admin_list_leads(
  integer, integer, text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text
) to authenticated;

grant execute on function public.admin_export_leads(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text
) to authenticated;

grant execute on function public.admin_update_lead(
  uuid, text, text, text, text, platform.industry, text, integer, text, text, date, text
) to authenticated;

-- Die vier Partner-Wrapper.
revoke all on function public.admin_create_partner(text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_update_partner(text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_set_partner_active(text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_list_partners()
  from public, anon, authenticated, service_role;

grant execute on function public.admin_create_partner(text, text, text, text) to authenticated;
grant execute on function public.admin_update_partner(text, text, text, text) to authenticated;
grant execute on function public.admin_set_partner_active(text, boolean) to authenticated;
grant execute on function public.admin_list_partners() to authenticated;

-- Die zwei neu angelegten platform-Funktionen sind kein Zugriffsweg von aussen. Der Entzug wird
-- ausgesprochen, damit die Aussage in dieser Datei gesetzt und nicht vorausgesetzt ist (Muster
-- B3-1); der neue Trigger-Rumpf ebenso. platform.guard_anonymized_lead und platform.anonymize_lead
-- sind `create or replace` und behalten ihre Rechte unverändert.
revoke all on function platform.leads_matching(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text
) from public, anon, authenticated, service_role;

revoke all on function platform.lead_filter_summary(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text
) from public, anon, authenticated, service_role;

revoke all on function platform.guard_partner_slug() from public;
