-- B1-3 — Admin-Abschnitt „Leads": Invarianten, Anonymisierung und Statuspflege
-- (Fahrplan_2026.md, Abschnitt B1 — schliesst B1 ab).
--
-- B1-1 hat das Schema gebaut, B1-2 den anonymen Schreibpfad (service_role). Diese Migration baut die
-- dritte und letzte Zugriffsrichtung: den ANGEMELDETEN Admin. Damit schreibt erstmals ein
-- eingeloggter Nutzer in `platform`-Lead-Daten — bisher konnte `authenticated` dort ausschliesslich
-- LESEN (admin_list_leads/admin_get_lead, B1-1).
--
-- NICHT hier: Export, Versand, Zustellprotokoll und Segmentierungsfilter nach Branche/Netzebene/PLZ
-- (B2 — die Segmentierungsspalten entstehen ohnehin erst mit B3), kein zeitgesteuerter Job (B4),
-- kein `tenant_id` (B13).
--
-- ── DIE NEUE PRIVILEGIENGRENZE, IN EINEM SATZ ────────────────────────────────────────────────────
-- Der Admin darf WIDERRUFEN, SPERREN, den Lebenszyklus pflegen und ANONYMISIEREN. Er darf keine
-- Einwilligung erteilen, keine bestätigen und keine Anonymisierung rückgängig machen. Die ersten
-- beiden Verbote sind unten als fehlende Wrapper begründet, das dritte als Trigger gebaut.
--
-- ── WARUM DIE INVARIANTEN WIEDER IN DER DB STEHEN (B1-1, I2) ─────────────────────────────────────
-- Die zwei neuen Regeln sind keine Oberflächenlogik: „Kunde ⇒ kaufmännische Aufbewahrung" und
-- „anonymisiert ⇒ unveränderlich" müssen auch für service_role, für einen künftigen zweiten
-- Anwendungspfad und für ein `psql` gelten. Eine Anonymisierung, die sich per UPDATE zurückdrehen
-- liesse, wäre keine; eine Aufbewahrungspflicht, an die nur die Admin-UI denkt, ist keine Pflicht.
--
-- ── KONVENTIONEN (exakt B1-1/B1-2) ───────────────────────────────────────────────────────────────
-- Alles Fachliche in `platform` (nicht über die REST-API exponiert), Zugriff von aussen
-- ausschliesslich über SECURITY-DEFINER-Wrapper im `public`-Schema, alle Funktionen mit
-- `SET search_path = ''` und vollqualifizierten Objektnamen, erst `revoke all … from public, anon,
-- authenticated, service_role`, dann gezielt grants. `anon` bekommt NIRGENDS etwas.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 0 — WAS ES HIER BEWUSST NICHT GIBT
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ES GIBT KEINEN WRAPPER, DER EINE EINWILLIGUNG ANLEGT ODER BESTÄTIGT.
--
-- Der Admin kann widerrufen und sperren, nie erteilen. Eine Oberfläche, in der sich „bestätigt"
-- ankreuzen lässt, entwertet den gesamten Nachweis rückwirkend — auch die echten Einwilligungen:
-- sobald EINE Bestätigung per Knopfdruck entstehen konnte, ist von aussen keine mehr von einer
-- gesetzten unterscheidbar. Der einzige Weg zu `status='confirmed'` bleibt `public.confirm_consent`
-- (B1-2), also der Klick der betroffenen Person auf den Link in ihrer eigenen Mailbox; der
-- B1-1-Trigger `guard_consent_confirmation` hält zusätzlich fest, dass es ohne `confirmed_at`
-- überhaupt nicht geht. Diese Lücke ist das Merkmal, nicht der Mangel.
--
-- Aus demselben Grund gibt es keinen Wrapper, der einen Lead ANLEGT: Erfassung ist der Vorgang, bei
-- dem eine Person selbst handelt (B1-2, `capture_lead` über den anonymen Server-Pfad). Ein
-- händisch im Admin angelegter Lead hätte weder Herkunft noch Nachweis.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — anonymized_by: WER anonymisiert hat
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- EINE Spalte, keine Audit-Tabelle. Bei zwei handelnden Personen wäre eine Tabelle Aufwand ohne
-- Erkenntnis (die Anonymisierung ist ein einmaliger, endgültiger Vorgang je Lead — es gibt keine
-- Historie, die sich entfalten könnte); die Spalte kostet nichts und trägt den späteren Fall mit.
--
-- ── `on delete set null`, NICHT die Voreinstellung ───────────────────────────────────────────────
-- Die drei denkbaren Verhalten beim Löschen des handelnden Kontos:
--   * cascade   — würde den LEAD löschen, weil jemand sein Konto schliesst. Absurd.
--   * no action — würde das Löschen des Kontos BLOCKIEREN. Ein Admin, der sein eigenes Konto
--                 entfernen lässt (selbst ein Betroffenenrecht), bliebe an fremden Lead-Zeilen
--                 hängen; die Ablehnung käme aus einer Tabelle, die mit seinem Konto nichts zu tun
--                 hat.
--   * set null  — das Konto geht, `anonymized_at` bleibt. Der VORGANG und sein Zeitpunkt sind
--                 weiterhin belegt, nur die Zuschreibung auf ein nicht mehr existierendes Konto
--                 fällt weg. Das ist der ehrliche Verlust.
-- Deshalb `set null`. Die Oberfläche zeigt in dem Fall „Konto entfernt" statt einer leeren Zelle.
alter table platform.leads
  add column anonymized_by uuid references auth.users (id) on delete set null;

comment on column platform.leads.anonymized_by is
  'WER die Anonymisierung ausgelöst hat (auth.users). Eine Spalte statt einer Audit-Tabelle: der '
  'Vorgang ist je Lead einmalig und endgültig, es gibt keine Historie zu entfalten. '
  'ON DELETE SET NULL — das Löschen des handelnden Kontos darf weder den Lead mitreissen (cascade) '
  'noch das Konto festhalten (no action); anonymized_at belegt den Vorgang dann weiter, nur die '
  'Zuschreibung entfällt. Bewusst NICHT vom Trigger guard_anonymized_lead geschützt, sonst '
  'blockierte der Guard genau diesen ON-DELETE-Pfad.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — consent_effective_status: EINE Definition von „abgelaufen"
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- B1-2 räumt abgelaufene Bestätigungen LAZY ab (vor B4 gibt es im System bewusst keine
-- Zeitsteuerung): eine `pending`-Zeile, deren Token vor Monaten verfallen ist, steht bis zum
-- nächsten Bestätigungsversuch weiter als `pending` in der Tabelle. Genau so gespeichert ist das
-- richtig — angezeigt wäre es falsch: die Einwilligungsspalte im Admin ist die operativ wichtigste
-- (nur BESTÄTIGTE sind im November aktivierbar), und „offen" liest sich dort als „da kommt noch
-- was".
--
-- Diese Funktion leitet den WIRKSAMEN Zustand ab, ohne den gespeicherten anzufassen. Sie steht
-- genau einmal und wird von der Liste, der Detailsicht UND dem Filter benutzt — drei Stellen mit
-- drei eigenen CASE-Ausdrücken wären drei Gelegenheiten, auseinanderzulaufen.
--
-- STABLE (nicht IMMUTABLE): das Ergebnis hängt an now().
create function platform.consent_effective_status(
  p_status text,
  p_token_expires_at timestamptz
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
           when p_status = 'pending'
                and p_token_expires_at is not null
                and p_token_expires_at <= now()
             then 'expired'
           else p_status
         end;
$$;

comment on function platform.consent_effective_status(text, timestamptz) is
  'Der WIRKSAME Zustand einer Einwilligung: wie der gespeicherte status, ausser bei einer '
  'pending-Zeile mit verfallenem Token — die zählt als expired. Hintergrund: B1-2 setzt expired '
  'LAZY (kein Hintergrundjob vor B4), gespeichert bleibt also pending. Einzige Definition dieses '
  'Unterschieds; benutzt von admin_list_leads (Anzeige UND Filter) und admin_get_lead. Ändert '
  'NICHTS an der Zeile — has_confirmed_consent bleibt die Sendefrage.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — Trigger: die zwei neuen Invarianten
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ── sync_retention_basis_on_customer ─────────────────────────────────────────────────────────────
-- WARUM DER RÜCKWEG VERBOTEN IST: eine einmal entstandene kaufmännische Aufbewahrungspflicht endet
-- nicht dadurch, dass ein Kunde abspringt. Wer 2027 Kunde war, hat Belege erzeugt, die aufzubewahren
-- sind — der Statuswechsel zurück auf 'contacted' (oder ein versehentliches Zurücksetzen der
-- Rechtsgrundlage) darf die Frist nicht von 84 auf 24 Monate stutzen und damit Unterlagen
-- vorzeitig zur Löschung freigeben. Die Eskalation ist erlaubt, die Deeskalation nicht.
--
-- `deletion_due_at` zieht NICHT diese Funktion nach, sondern der bestehende B1-1-Trigger
-- sync_lead_retention — deshalb muss dieser hier VORHER laufen (s. Trigger-Reihenfolge unten).
create function platform.sync_retention_basis_on_customer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Kunde werden ist eine geschäftliche Beziehung, keine werbliche: die Rechtsgrundlage der
  -- Aufbewahrung wechselt automatisch mit. Nicht der Anwendungscode setzt sie, sondern der Status.
  if new.status = 'customer' and old.status is distinct from 'customer' then
    new.retention_basis = 'commercial';
  end if;

  if old.retention_basis = 'commercial' and new.retention_basis = 'marketing' then
    raise exception
      'platform.leads.retention_basis: der Rückweg commercial → marketing ist nicht erlaubt — eine '
      'einmal entstandene kaufmännische Aufbewahrungspflicht endet nicht dadurch, dass ein Kunde '
      'abspringt (Lead %)',
      old.id;
  end if;

  return new;
end;
$$;

comment on function platform.sync_retention_basis_on_customer() is
  'BEFORE UPDATE auf leads: Wechsel des Status auf ''customer'' setzt retention_basis auf '
  '''commercial'' (84 statt 24 Monate; deletion_due_at zieht der Trigger sync_lead_retention nach, '
  'der danach läuft). Der Rückweg commercial → marketing WIRFT — eine entstandene kaufmännische '
  'Aufbewahrungspflicht endet nicht mit dem Absprung des Kunden. Eskalation ja, Deeskalation nein.';

-- ── guard_anonymized_lead ────────────────────────────────────────────────────────────────────────
-- Anonymisierung ist endgültig — auch für service_role und für den Admin. Ohne diese Sperre wäre
-- „anonymisiert" nur eine Behauptung des Anwendungscodes: ein einziges UPDATE könnte den Status
-- zurückdrehen und die Zeile wieder wie einen normalen Lead aussehen lassen (die Identitätsmerkmale
-- wären zwar weg, aber der Bestand behauptete etwas Falsches über sich selbst).
--
-- ── `anonymized_at` STEHT MIT IN DER GESCHÜTZTEN LISTE — bewusst über die Aufgabenstellung hinaus ─
-- Die Aufgabe nennt email, company, contact_name, phone, status und retention_basis. Ohne
-- `anonymized_at` liesse sich der Guard aber mit seiner eigenen Bedingung ausschalten: ein
-- `update … set anonymized_at = null` liefe durch (die Spalte stünde ja nicht unter Schutz), und
-- danach wäre die Zeile wieder frei änderbar. Ein Schloss, dessen Schlüssel aussen steckt, ist
-- keins — deshalb ist der Zeitstempel mitgeschützt.
--
-- `anonymized_by` ist dagegen ausdrücklich NICHT geschützt: die Spalte trägt `ON DELETE SET NULL`,
-- und dieser referentielle Pfad ist selbst ein UPDATE auf die Zeile. Ein Schutz hier würde das
-- Löschen des handelnden Kontos blockieren — genau das, was TEIL 1 vermeiden will.
create function platform.guard_anonymized_lead()
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
     or new.contact_name is distinct from old.contact_name
     or new.phone        is distinct from old.phone
     or new.status       is distinct from old.status
     or new.retention_basis is distinct from old.retention_basis
     or new.anonymized_at   is distinct from old.anonymized_at
  then
    raise exception
      'platform.leads %: der Lead ist seit % anonymisiert — E-Mail, Firma, Name, Telefon, Status, '
      'Aufbewahrungsgrundlage und der Anonymisierungszeitpunkt sind unveränderlich. Anonymisierung '
      'ist endgültig, auch für service_role und für den Admin',
      old.id, old.anonymized_at;
  end if;

  return new;
end;
$$;

comment on function platform.guard_anonymized_lead() is
  'BEFORE UPDATE auf leads: ist anonymized_at gesetzt, sind email, company, contact_name, phone, '
  'status, retention_basis UND anonymized_at unveränderlich — auch für service_role und für den '
  'Admin. anonymized_at steht bewusst mit in der Liste (sonst liesse sich der Guard durch Nullen '
  'seiner eigenen Bedingung abschalten); anonymized_by bewusst NICHT (die Spalte trägt ON DELETE '
  'SET NULL, ein Schutz blockierte das Löschen des handelnden Kontos). last_interaction_at bleibt '
  'änderbar — der B1-1-Trigger touch_lead_on_consent muss weiter laufen können.';

-- ── Trigger-Reihenfolge auf platform.leads ───────────────────────────────────────────────────────
-- Postgres feuert BEFORE-ROW-Trigger in ALPHABETISCHER Reihenfolge ihres NAMENS. Die Namen sind
-- deshalb kein Geschmack, sondern Ablaufsteuerung:
--
--   leads_customer_retention_basis  (neu)  ← muss VOR leads_sync_retention laufen, sonst rechnete
--                                            der die Frist noch mit der alten Rechtsgrundlage
--   leads_guard_first_source        (B1-1)
--   leads_normalize_email           (B1-1)
--   leads_protect_anonymized        (neu)  ← muss NACH leads_normalize_email laufen, sonst läse der
--                                            Guard „Max@x.at" gegen „max@x.at" als Änderung
--   leads_set_updated_at            (B1-1)
--   leads_sync_retention            (B1-1)
--
-- Ein naheliegender Name wie `leads_sync_retention_basis` wäre genau falsch gewesen: er sortiert
-- HINTER `leads_sync_retention` (längerer Name mit gleichem Präfix), und der Wechsel auf
-- 'commercial' hätte die Frist erst beim NÄCHSTEN Update nachgezogen.
create trigger leads_customer_retention_basis
  before update on platform.leads
  for each row execute function platform.sync_retention_basis_on_customer();

create trigger leads_protect_anonymized
  before update on platform.leads
  for each row execute function platform.guard_anonymized_lead();

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — anonymize_lead: die eine unumkehrbare Operation
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- WAS BLEIBT UND WARUM:
--   * Die EINWILLIGUNGSZEILEN bleiben bestehen (Zweck, Textfassung, Zeitpunkte, Herkunft). Nach dem
--     Entfernen der Identitätsmerkmale sind sie kein Personenbezug mehr, belegen aber weiterhin,
--     dass korrekt gearbeitet wurde: wie viele Einwilligungen erteilt, wie viele bestätigt, zu
--     welchem Wortlaut. Ein Bestand ohne diese Spur könnte im Streitfall nichts zeigen.
--   * `platform.email_suppressions` bleibt UNANGETASTET. Das ist der Kern des B1-1-Entwurfs: die
--     Sperre überlebt die Löschung. Würde sie mitgelöscht, stünde die Person nach dem nächsten
--     Import wieder im Verteiler — und bekäme genau die Mail, die sie abbestellt hat.
--   * `first_source_key`, `created_at`, `deletion_due_at` bleiben — Herkunfts- und Mengenstatistik
--     ohne Personenbezug.
--
-- WAS GEHT: E-Mail (durch eine garantiert unzustellbare, eindeutige Konstruktion ERSETZT, nicht
-- geleert — die Spalte ist NOT NULL und der UNIQUE über die normalisierte Adresse muss halten),
-- Firma, Name, Telefon sowie `source_ip`/`user_agent` ALLER zugehörigen Einwilligungen (die beiden
-- sind laut B1-1 ausschliesslich Einwilligungsnachweis; nach dem Wegfall der Identität haben sie
-- keinen Nachweiswert mehr, sind aber weiterhin personenbeziehbare Merkmale).
--
-- `.invalid` ist nach RFC 2606 reserviert und wird nie an ein reales Postfach zugestellt; das
-- `anonymized+<lead_id>@invalid`-Schema bleibt je Lead eindeutig und hält damit
-- `leads_email_normalized_key` ein (ein fester Platzhaltertext für alle würde beim ZWEITEN
-- anonymisierten Lead am UNIQUE scheitern — der Vorgang bräche mitten in der Löschung ab).
--
-- SECURITY DEFINER: die Funktion schreibt in Tabellen, auf die der aufrufende Admin
-- (`authenticated`) kein Grant hat — dieselbe Bauart wie B1-1s touch_lead_on_consent.
create function platform.anonymize_lead(p_lead_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anonymized_at timestamptz;
begin
  if p_lead_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Zeilensperre: zwei gleichzeitige Klicks auf „Anonymisieren" sollen nicht beide durchlaufen.
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
  -- Guard-Trigger würde ein Überschreiben ohnehin ablehnen.
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

  update platform.leads l
     set email         = 'anonymized+' || p_lead_id::text || '@invalid',
         company       = null,
         contact_name  = null,
         phone         = null,
         status        = 'anonymized',
         anonymized_at = now(),
         anonymized_by = p_actor
   where l.id = p_lead_id;

  return jsonb_build_object('status', 'ok', 'outcome', 'anonymized');
end;
$$;

comment on function platform.anonymize_lead(uuid, uuid) is
  'Anonymisiert einen Lead UNUMKEHRBAR: E-Mail → anonymized+<lead_id>@invalid (RFC 2606, nie '
  'zustellbar, je Lead eindeutig — hält den UNIQUE über die normalisierte Adresse ein), company/'
  'contact_name/phone → null, source_ip/user_agent ALLER Einwilligungen → null, status=anonymized, '
  'anonymized_at/anonymized_by gesetzt. BLEIBEN: die Einwilligungszeilen selbst (Zweck, Textfassung, '
  'Zeitpunkte — ohne Identitätsmerkmale kein Personenbezug mehr, aber weiterhin der Beleg, dass '
  'korrekt gearbeitet wurde) und der Sperrlisten-Eintrag (er MUSS die Löschung überleben, B1-1). '
  'Idempotent: ein bereits anonymisierter Lead liefert Erfolg ohne zweite Wirkung. '
  '{status: ok|not_found}, outcome: anonymized|already_anonymized.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — Die sechs Admin-Schreib-/Auskunftswrapper
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Alle sechs: SECURITY DEFINER, ausschliesslich an `authenticated` gegrantet, und JEDER prüft als
-- erste Anweisung `platform.is_admin()` und WIRFT sonst SQLSTATE 42501 — dasselbe Muster wie
-- `admin_list_leads` aus B1-1 und dieselbe bewusste Abweichung von T4-4: „kein Zugriff" darf sich
-- nie als „nichts gefunden" lesen lassen. Ein leeres Ergebnis und eine Ablehnung sind hier
-- verschiedene Dinge; eine Exception kann man nicht verwechseln.
--
-- ── WARUM ZWEI DER SECHS DIE B1-2-WRAPPER AUFRUFEN, STATT SQL ZU WIEDERHOLEN ─────────────────────
-- `admin_withdraw_consent` und `admin_suppress_lead` delegieren an `public.withdraw_consent` bzw.
-- `public.suppress_email_and_withdraw_all`. Diese sind zwar nur an service_role gegrantet — als
-- SECURITY-DEFINER-Funktionen laufen die Wrapper hier aber unter ihrem Eigentümer und dürfen sie
-- aufrufen. Der Grund für die Delegation ist fachlich: ein Widerruf muss ALLE offenen UND
-- bestätigten Zeilen des Zwecks treffen (B1-1: kein UNIQUE auf (lead_id, purpose); eine übersehene
-- bestätigte Zeile liesse `has_confirmed_consent` weiter „darf senden" sagen). Diese Regel ein
-- zweites Mal hinzuschreiben hiesse, zwei Definitionen von „widerrufen" zu haben — und die zweite
-- fiele erst beim ersten Massenversand auf.

-- ── admin_set_lead_status ────────────────────────────────────────────────────────────────────────
-- 'anonymized' ist BEWUSST kein erlaubter Zielwert: dieser Status ist die FOLGE der Anonymisierung,
-- nicht ihr Auslöser. Wäre er hier setzbar, entstünde ein Lead, der anonymisiert HEISST und alle
-- Identitätsmerkmale noch trägt — die schlimmste Form eines falschen Sicherheitsgefühls.
create function public.admin_set_lead_status(p_lead_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_set_lead_status: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('new', 'contacted', 'customer') then
    return jsonb_build_object('status', 'invalid_status');
  end if;

  select l.anonymized_at into v
  from platform.leads l
  where l.id = p_lead_id
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v.anonymized_at is not null then
    -- Der Trigger würde es ohnehin ablehnen — aber als Exception. Ein anonymisierter Lead ist hier
    -- ein fachlicher Zustand („dieser Vorgang ist abgeschlossen"), kein Autorisierungsfehler.
    return jsonb_build_object('status', 'anonymized');
  end if;

  update platform.leads l set status = p_status where l.id = p_lead_id;

  -- Zurück kommt, was die TRIGGER daraus gemacht haben (Rechtsgrundlage + Frist), nicht was der
  -- Aufrufer wollte: die Oberfläche soll den echten Zustand zeigen, nicht ihre eigene Erwartung.
  select l.status, l.retention_basis, l.deletion_due_at into v
  from platform.leads l where l.id = p_lead_id;

  return jsonb_build_object(
    'status',          'ok',
    'lead_status',     v.status,
    'retention_basis', v.retention_basis,
    'deletion_due_at', v.deletion_due_at
  );
end;
$$;

comment on function public.admin_set_lead_status(uuid, text) is
  'B1-3: Lebenszyklus-Status eines Leads setzen (new|contacted|customer). ''anonymized'' ist '
  'bewusst KEIN erlaubter Zielwert — der Status ist die Folge der Anonymisierung, nicht ihr '
  'Auslöser. Der Wechsel auf ''customer'' hebt über den Trigger '
  'sync_retention_basis_on_customer die Aufbewahrung dauerhaft auf 84 Monate; die Antwort trägt '
  'retention_basis und deletion_due_at ZURÜCK, wie die Trigger sie gesetzt haben. WIRFT bei '
  'fehlender Adminrolle (42501); not_found / anonymized / invalid_status sind fachliche Zustände. '
  'authenticated-only.';

-- ── admin_withdraw_consent ───────────────────────────────────────────────────────────────────────
create function public.admin_withdraw_consent(
  p_lead_id uuid,
  p_purpose platform.consent_purpose
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anonymized_at timestamptz;
  v_result        jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_withdraw_consent: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if p_lead_id is null or p_purpose is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  select l.anonymized_at into v_anonymized_at
  from platform.leads l where l.id = p_lead_id;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_anonymized_at is not null then
    return jsonb_build_object('status', 'anonymized');
  end if;

  -- Delegation an den B1-2-Wrapper: EINE Definition von „widerrufen" (s. Kopf dieses Teils).
  v_result := public.withdraw_consent(p_lead_id, p_purpose);

  return jsonb_build_object(
    'status',          'ok',
    'withdrawn_count', coalesce((v_result ->> 'withdrawn_count')::integer, 0)
  );
end;
$$;

comment on function public.admin_withdraw_consent(uuid, platform.consent_purpose) is
  'B1-3: widerruft ALLE offenen und bestätigten Einwilligungen EINES Zwecks — delegiert dafür an '
  'public.withdraw_consent (B1-2), damit es nur EINE Definition von „widerrufen" gibt (eine '
  'übersehene bestätigte Zeile liesse has_confirmed_consent weiter „darf senden" sagen). '
  'Idempotent. WIRFT bei fehlender Adminrolle (42501). authenticated-only.';

-- ── admin_suppress_lead ──────────────────────────────────────────────────────────────────────────
-- Bei einem ANONYMISIERTEN Lead lehnt der Wrapper ab, und zwar nicht aus Formalismus: dessen
-- gespeicherte Adresse ist bereits `anonymized+…@invalid`. Eine Sperre darauf sperrte nichts
-- (die echte Adresse ist unwiederbringlich weg) und schriebe einen dauerhaften Müll-Hash in eine
-- Liste, die per Konstruktion nie aufgeräumt wird.
create function public.admin_suppress_lead(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anonymized_at timestamptz;
  v_result        jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_suppress_lead: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if p_lead_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  select l.anonymized_at into v_anonymized_at
  from platform.leads l where l.id = p_lead_id;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_anonymized_at is not null then
    return jsonb_build_object('status', 'anonymized');
  end if;

  v_result := public.suppress_email_and_withdraw_all(p_lead_id);

  return jsonb_build_object(
    'status',          'ok',
    'withdrawn_count', coalesce((v_result ->> 'withdrawn_count')::integer, 0)
  );
end;
$$;

comment on function public.admin_suppress_lead(uuid) is
  'B1-3: widerruft ALLE Zwecke des Leads und sperrt seine Adresse dauerhaft (SHA-256 in '
  'platform.email_suppressions) — delegiert an public.suppress_email_and_withdraw_all (B1-2). Der '
  'Sperreintrag hat keinen FK auf leads und überlebt jede spätere Anonymisierung/Löschung bewusst. '
  'Ein bereits ANONYMISIERTER Lead wird abgelehnt: seine gespeicherte Adresse ist '
  'anonymized+…@invalid, eine Sperre darauf sperrte nichts und verschmutzte die Liste dauerhaft. '
  'WIRFT bei fehlender Adminrolle (42501). authenticated-only.';

-- ── admin_anonymize_lead ─────────────────────────────────────────────────────────────────────────
-- `auth.uid()` funktioniert auch innerhalb einer SECURITY-DEFINER-Funktion (es liest die
-- JWT-Claims der Sitzung, nicht die Datenbankrolle) — der Handelnde ist damit der echte
-- angemeldete Admin und nicht der Eigentümer der Funktion.
create function public.admin_anonymize_lead(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not platform.is_admin() then
    raise exception 'public.admin_anonymize_lead: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  return platform.anonymize_lead(p_lead_id, auth.uid());
end;
$$;

comment on function public.admin_anonymize_lead(uuid) is
  'B1-3: ruft platform.anonymize_lead mit auth.uid() als Handelndem auf — die einzige unumkehrbare '
  'Operation des Admin-Bereichs. Idempotent (outcome already_anonymized). WIRFT bei fehlender '
  'Adminrolle (42501). authenticated-only.';

-- ── admin_is_email_suppressed ────────────────────────────────────────────────────────────────────
-- Eine Ja/Nein-Auskunft, keine Liste. `platform.email_suppressions` speichert ausschliesslich
-- SHA-256-Werte (B1-1: eine Liste von Personen, die Löschung verlangt haben, darf nicht selbst als
-- Verteilerliste taugen). Für Menschen ist eine Hash-Liste unlesbar — die Einzelabfrage ist deshalb
-- die einzige sinnvolle Darstellung, und das ist eine FOLGE des B1-1-Entwurfs, kein Mangel.
--
-- Nur für Admins, obwohl die Auskunft harmlos wirkt: für `authenticated` wäre sie ein Orakel, mit
-- dem sich beliebige Adressen prüfen liessen (dieselbe Begründung wie bei platform.is_suppressed).
create function public.admin_is_email_suppressed(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not platform.is_admin() then
    raise exception 'public.admin_is_email_suppressed: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if p_email is null or btrim(p_email) = '' then
    return jsonb_build_object('status', 'invalid_email');
  end if;

  return jsonb_build_object(
    'status',           'ok',
    'normalized_email', platform.normalize_email(p_email),
    'is_suppressed',    platform.is_suppressed(p_email)
  );
end;
$$;

comment on function public.admin_is_email_suppressed(text) is
  'B1-3: Ja/Nein-Auskunft, ob eine Adresse auf der Sperrliste steht. Gibt die normalisierte Form '
  'mit zurück, damit sichtbar ist, WAS geprüft wurde. Einzelabfrage statt Liste, weil '
  'email_suppressions nur SHA-256-Werte hält (B1-1) — für Menschen unlesbar, und genau das ist '
  'gewollt. WIRFT bei fehlender Adminrolle (42501). authenticated-only.';

-- ── admin_suppression_count ──────────────────────────────────────────────────────────────────────
create function public.admin_suppression_count()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_suppression_count: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select count(*)::integer into v_count from platform.email_suppressions;

  return jsonb_build_object('status', 'ok', 'count', v_count);
end;
$$;

comment on function public.admin_suppression_count() is
  'B1-3: Anzahl der Sperren. Die einzige Gesamtaussage, die sich über eine reine Hash-Liste treffen '
  'lässt, ohne sie preiszugeben. WIRFT bei fehlender Adminrolle (42501). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 6 — admin_list_leads: Filter, und zwar in SQL
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- B1-1 hatte die Liste bewusst ohne Filter gebaut (die SEGMENTIERUNG nach Branche/Netzebene/PLZ ist
-- B2 und braucht Spalten, die erst B3 anlegt). Was hier dazukommt, ist etwas anderes: die
-- BETRIEBSSICHT auf den bestehenden Bestand — Status, Herkunft, Einwilligungsstand, Freitext,
-- Löschfrist. Alles davon existiert seit B1-1 als Spalte.
--
-- ── WARUM IN SQL UND NICHT IN DER ANWENDUNG ──────────────────────────────────────────────────────
-- Nachgelagertes Filtern im Anwendungscode bricht bei wachsendem Bestand die Seitenaufteilung: die
-- Datenbank lieferte Seite 1 (50 Zeilen), die Anwendung würfe davon 40 weg und zeigte 10 — die
-- Trefferzahl wäre falsch, „Seite 2" überspränge Treffer, und es wanderten mehr personenbezogene
-- Daten über die Verbindung, als jemals angezeigt werden. Filter und LIMIT müssen in derselben
-- Abfrage stehen, sonst bedeuten sie nichts.
--
-- Die zurückgegebene `total` ist deshalb die Zahl der Treffer NACH Filterung, nicht die Bestandsgröße.
drop function if exists public.admin_list_leads(integer, integer);

create function public.admin_list_leads(
  p_limit integer default 50,
  p_offset integer default 0,
  p_status text default null,
  p_source_key text default null,
  p_consent_purpose platform.consent_purpose default null,
  p_consent_status text default null,
  p_search text default null,
  p_due_only boolean default false
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
  v_source   text    := nullif(btrim(coalesce(p_source_key, '')), '');
  v_cstatus  text    := nullif(btrim(coalesce(p_consent_status, '')), '');
  v_search   text    := nullif(btrim(coalesce(p_search, '')), '');
  v_pattern  text;
  v_due      boolean := coalesce(p_due_only, false);
  v_total    integer;
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

  -- Freitext über E-Mail UND Firma. Die LIKE-Sonderzeichen werden maskiert, damit ein getipptes
  -- „%" nicht plötzlich alles trifft (der Admin sucht eine Adresse, er schreibt kein Muster).
  if v_search is not null then
    v_pattern := '%' ||
      replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with base as (
    select ld.id, ld.email, ld.company, ld.contact_name, ld.phone, ld.status,
           ld.first_source_key, ld.retention_basis, ld.last_interaction_at,
           ld.deletion_due_at, ld.anonymized_at, ld.anonymized_by, ld.created_at
    from platform.leads ld
    where (v_status is null or ld.status = v_status)
      and (v_source is null or ld.first_source_key = v_source)
      -- „Zur Anonymisierung fällig": Frist erreicht UND noch nicht anonymisiert. Ohne die zweite
      -- Bedingung stünden bereits erledigte Fälle dauerhaft in der Arbeitsliste.
      and (not v_due or (ld.deletion_due_at <= now() and ld.anonymized_at is null))
      and (
        v_pattern is null
        or ld.email ilike v_pattern escape '\'
        or coalesce(ld.company, '') ilike v_pattern escape '\'
      )
      and (
        case
          when p_consent_purpose is null and v_cstatus is null then true
          -- 'none' ist die Umkehrung: KEINE (passende) Einwilligung. Ohne Zweck heisst das „gar
          -- keine Einwilligung", mit Zweck „keine für diesen Zweck".
          when v_cstatus = 'none' then not exists (
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
                v_cstatus is null
                or platform.consent_effective_status(c.status, c.token_expires_at) = v_cstatus
              )
          )
        end
      )
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
         coalesce(
           (select jsonb_agg(to_jsonb(p) order by p.created_at desc) from page p),
           '[]'::jsonb
         )
    into v_total, v_leads;

  -- Die Einstiegspunkte fahren MIT, statt einen siebten Wrapper zu brauchen: `lead_sources` ist eine
  -- TABELLE, weil laufend neue Einstiegspunkte dazukommen (B1-1/B3) — die Filterauswahl kann sie
  -- deshalb nicht als Konstante im Anwendungscode spiegeln, sonst fehlte jede neue Quelle im Filter.
  select coalesce(jsonb_agg(jsonb_build_object('key', s.key, 'label', s.label) order by s.label), '[]'::jsonb)
    into v_sources
  from platform.lead_sources s;

  return jsonb_build_object(
    'status',  'ok',
    'leads',   v_leads,
    'total',   v_total,
    'limit',   v_limit,
    'offset',  v_offset,
    'sources', v_sources
  );
end;
$$;

comment on function public.admin_list_leads(
  integer, integer, text, text, platform.consent_purpose, text, text, boolean
) is
  'B1-3 (erweitert B1-1): paginierte Lead-Liste mit Filtern — Status, Herkunftsquelle, '
  'Einwilligungsstatus je Zweck (inkl. ''none'' = keine passende Einwilligung), Freitext über '
  'E-Mail/Firma sowie „zur Anonymisierung fällig" (deletion_due_at <= now() und noch nicht '
  'anonymisiert). Gefiltert wird in SQL, nicht in der Anwendung: nachgelagertes Filtern bricht die '
  'Seitenaufteilung und holt mehr personenbezogene Daten, als angezeigt werden. `total` ist die '
  'Zahl der TREFFER, nicht die Bestandsgröße. Je Zeile zusätzlich is_suppressed, deletion_due und '
  'die Einwilligungen mit gespeichertem UND wirksamem Status '
  '(platform.consent_effective_status — B1-2 setzt expired lazy). Ein unbekannter Filterwert wird '
  'als {status: invalid_filter} abgelehnt, nicht still ignoriert. `sources` trägt die '
  'Einstiegspunkte mit, damit der Filter echte Bezeichnungen zeigt (lead_sources ist eine Tabelle, '
  'kein Enum — die Anwendung darf sie nicht spiegeln). WIRFT bei fehlender Adminrolle (42501). '
  'authenticated-only.';

-- ── admin_get_lead: wirksamer Einwilligungsstatus + der Handelnde der Anonymisierung ─────────────
-- `create or replace` (gleiche Signatur) — die Grants aus B1-1 bleiben damit unangetastet.
--
-- ZWEI ERGÄNZUNGEN, beide von der Detailsicht verlangt:
--   * `effective_status` je Einwilligung — dieselbe Ableitung wie in der Liste. Zwei Seiten, die
--     denselben Nachweis unterschiedlich benennen, wären schlimmer als eine ungenaue Benennung.
--   * `anonymized_by` samt E-Mail des Kontos. Bei einer unumkehrbaren Operation muss die
--     Detailsicht sagen können, WER sie ausgelöst hat; ist das Konto inzwischen gelöscht, steht die
--     Spalte auf null (ON DELETE SET NULL) und die Oberfläche sagt genau das.
-- token_hash/token_expires_at fahren weiterhin NICHT mit (Sicherheitsartefakt ohne Nachweiswert);
-- der Ablauf steckt bereits im abgeleiteten Status.
create or replace function public.admin_get_lead(p_lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lead     jsonb;
  v_consents jsonb;
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
           ld.contact_name,
           ld.phone,
           ld.status,
           ld.first_source_key,
           -- Die BEZEICHNUNG des Einstiegspunkts fährt mit: `lead_sources` ist eine Tabelle (B1-1),
           -- die Anwendung darf sie nicht als Konstante spiegeln. Ohne diese Spalte zeigte die
           -- Detailsicht den rohen Schlüssel, während die Liste (die `sources` mitbekommt) den
           -- Klartext zeigt — dieselbe Angabe in zwei Schreibweisen.
           (select s.label from platform.lead_sources s where s.key = ld.first_source_key)
             as first_source_label,
           ld.retention_basis,
           ld.last_interaction_at,
           ld.deletion_due_at,
           ld.anonymized_at,
           ld.anonymized_by,
           (select au.email from auth.users au where au.id = ld.anonymized_by)
             as anonymized_by_email,
           ld.created_at,
           ld.updated_at,
           platform.is_suppressed(ld.email) as is_suppressed,
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

  return jsonb_build_object('status', 'ok', 'lead', v_lead, 'consents', v_consents);
end;
$$;

comment on function public.admin_get_lead(uuid) is
  'B1-1, erweitert in B1-3: ein Lead samt allen Einwilligungen — INKLUSIVE des jeweils angezeigten '
  'Textkörpers und seiner Version/Sprache (ohne den Wortlaut wäre der Nachweis keiner: die Person '
  'hat einen Satz gelesen, keinen Zweckschlüssel). NEU: effective_status je Einwilligung (dieselbe '
  'Ableitung wie in admin_list_leads) sowie anonymized_by samt E-Mail des Kontos (null, wenn das '
  'Konto gelöscht wurde). token_hash/token_expires_at fahren bewusst nicht mit. WIRFT bei fehlender '
  'Adminrolle (42501); ein unbekannter Lead ist ein fachlicher Zustand ({status: not_found}). '
  'authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 7 — Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf NEUE public-Funktionen automatisch EXECUTE an
-- anon, authenticated UND service_role (zusätzlich zum PostgreSQL-Default-Grant an PUBLIC) —
-- deshalb erst allen entziehen, dann NUR authenticated gewähren (Muster T4-2/T4-4/B1-1).
--
-- service_role bekommt bewusst KEIN Grant: diese Wrapper leiten ihre Autorisierung aus auth.uid()
-- ab, das für service_role NULL ist — sie wären dort funktionslos und stets abgelehnt. Wer
-- serverseitig ohne angemeldeten Nutzer schreiben muss, benutzt die B1-2-Wrapper.
revoke all on function public.admin_set_lead_status(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_withdraw_consent(uuid, platform.consent_purpose)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_suppress_lead(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_anonymize_lead(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_is_email_suppressed(text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_suppression_count()
  from public, anon, authenticated, service_role;
revoke all on function public.admin_list_leads(
  integer, integer, text, text, platform.consent_purpose, text, text, boolean
) from public, anon, authenticated, service_role;

grant execute on function public.admin_set_lead_status(uuid, text) to authenticated;
grant execute on function public.admin_withdraw_consent(uuid, platform.consent_purpose)
  to authenticated;
grant execute on function public.admin_suppress_lead(uuid) to authenticated;
grant execute on function public.admin_anonymize_lead(uuid) to authenticated;
grant execute on function public.admin_is_email_suppressed(text) to authenticated;
grant execute on function public.admin_suppression_count() to authenticated;
grant execute on function public.admin_list_leads(
  integer, integer, text, text, platform.consent_purpose, text, text, boolean
) to authenticated;

-- platform.anonymize_lead ist KEIN öffentlicher Zugriffsweg: sie wird ausschliesslich von
-- public.admin_anonymize_lead aufgerufen (und läuft dort unter dem Eigentümer). Deshalb PUBLIC
-- entziehen und niemandem sonst gewähren — dieselbe Behandlung wie platform.touch_lead_on_consent.
revoke all on function platform.anonymize_lead(uuid, uuid) from public;

-- Die abgeleitete Statusfunktion berührt keine Daten und behält das PUBLIC-Execute (wie
-- platform.retention_months u. a. in B1-1); zusätzlich explizit an service_role, weil ein künftiger
-- serverseitiger Leser (B2) sie mit den Rechten der AUFRUFENDEN Rolle auswerten würde.
grant execute on function platform.consent_effective_status(text, timestamptz) to service_role;
