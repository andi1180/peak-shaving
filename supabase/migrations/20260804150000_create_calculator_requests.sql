-- B18-4 (Schema+Schreibweg) — ein Fachbetrieb kann den Kalkulator ANFRAGEN, der Admin entscheidet,
-- und bei einer Freigabe entsteht das `calculator_pro`-Entitlement in DERSELBEN Transaktion.
--
-- ⚠ HINWEIS ZUR ABLAGE DER ENTSCHEIDUNGEN: `Fahrplan_2026.md` führt die Bauabschnitte B0–B17 und
-- kennt B18 (noch) NICHT — hier steht deshalb bewusst KEIN Verweis auf einen Abschnitt, den es dort
-- nicht gibt. Maßgeblich für den Stand der B18-Reihe ist der Handover in `apps/web/CLAUDE.md`.
--
-- ── WAS HIER ENTSTEHT ───────────────────────────────────────────────────────────────────────────
--   TEIL 1  das Enum `platform.calculator_request_status`
--   TEIL 2  die Tabelle `platform.calculator_requests`
--   TEIL 3  `public.submit_calculator_request`            — der Weg des PARTNERS
--   TEIL 4  `public.admin_decide_calculator_request`      — die Entscheidung, EINE Transaktion
--   TEIL 5  `public.admin_list_calculator_requests`       — der Prüf-Eingang
--   TEIL 6  `public.admin_mark_calculator_request_notified` — „erst senden, dann vermerken"
--   TEIL 7  Rechte
--
-- ── ⚠ DER DRITTE SCHREIBWEG IN `platform.entitlements` — UND WARUM ER KEIN NEUES KONZEPT IST ────
-- Bis hierher schrieben genau zwei Wege in diese Tabelle: der DB-Trigger aus `subscriptions`
-- (`source='stripe'`, Invariante I2 — Anwendungscode kommt da nicht heran) und die
-- Gutscheineinlösung (`public.redeem_code`, T4-3/B10-2, `source='manual'`). Dieser Abschnitt fügt
-- einen DRITTEN hinzu, und zwar in exakt derselben Form wie der zweite: ein SECURITY-DEFINER-Wrapper
-- schreibt eine Zeile mit `source='manual'`, `valid_until = null`. Kein neuer Mechanismus, keine neue
-- Produkt-Kennung (`calculator_pro` steht seit T4-1 im Enum, s. B10-1), und ausdrücklich KEINE
-- Änderung an `public.get_my_entitlement` — der generische Lesepfad bleibt unangetastet.
--
-- ── ⚠ ES ENTSTEHT BEWUSST KEIN GENERISCHER `admin_grant_entitlement` ────────────────────────────
-- Der naheliegende Entwurf wäre ein Wrapper `admin_grant_entitlement(p_user_id, p_product)`, den
-- diese Genehmigung dann aufruft. Er wird NICHT gebaut, und der Grund ist nicht Sparsamkeit:
--
--   1. Er wäre ein Weg, JEDEM Konto JEDES Produkt zu geben — losgelöst von dem Vorgang, der die
--      Berechtigung begründet. Der Zugang zum Kalkulator hinge dann nicht mehr an einer geprüften
--      Anfrage, sondern an einer Kennung, die jemand eintippt. Genau diese Kopplung ist der Zweck
--      dieses Abschnitts: `status='approved'` und die Entitlement-Zeile entstehen ZUSAMMEN oder gar
--      nicht.
--   2. Er hätte heute genau einen Aufrufer. Ein zweiter Verwendungszweck ist nicht absehbar (der
--      Monitor läuft über Stripe und Codes), und eine Abstraktion für einen Aufrufer ist eine
--      Vermutung über die Zukunft.
--   3. Er brächte eine Frage mit, die niemand gestellt hat: Darf ein Admin ein bestehendes
--      Stripe-Entitlement überschreiben? Hier ist die Antwort eng und begründbar (s. TEIL 4); als
--      allgemeiner Wrapper müsste sie für alle Produkte gelten.
--
-- Wer später eine Admin-Oberfläche für Entitlements baut, baut sie dann bewusst — mit eigener
-- Begründung und eigenem Protokoll, nicht als Nebenfolge dieses Schritts.
--
-- ── WAS AUSDRÜCKLICH NICHT ENTSTEHT ─────────────────────────────────────────────────────────────
-- Keine Portalseite und kein Reiter, kein Admin-Tab, keine Änderung an der öffentlichen
-- Kalkulator-Seite (`lib/kalkulator/access.ts` und die Routen darunter) — das ist der nächste,
-- eigene Schritt (Oberfläche). KEINE Änderung an `public.get_my_entitlement`,
-- `platform.has_entitlement`, `public.redeem_code`, `platform.redemption_codes`,
-- `public.get_my_partner`, `public.get_my_partner_leads`, `platform.partners` oder an irgendeinem
-- bestehenden `admin_*`-Wrapper. Kein `tenant_id`, kein Typfeld am Konto, kein neuer
-- `consent_purpose` (die Rechtsgrundlage ist die bestehende Vertragsbeziehung zum Fachbetrieb),
-- kein Rücknahmeweg für ein einmal erteiltes Entitlement.
--
-- Der Gutscheincode-Weg für `calculator_pro` (B10-2, `CODE_PRODUCT_KEYS`) bleibt UNVERÄNDERT
-- bestehen. Beide Wege führen zur selben Zeile in `platform.entitlements`; ob einer davon abgelöst
-- wird, ist eine Produktentscheidung und nicht Gegenstand dieser Migration.
--
-- ── KONVENTIONEN (exakt T4-1/B1-1/B2-1/B14-1/B16-1/B16-3/B16-4a/B16-4b/B18-6) ───────────────────
-- Alles Fachliche in `platform` (nicht über die REST-API exponiert, `supabase/config.toml`), Zugriff
-- von aussen ausschliesslich über SECURITY-DEFINER-Wrapper im `public`-Schema, alle Funktionen mit
-- `SET search_path = ''` und vollqualifizierten Objektnamen, RLS auf der Tabelle, erst
-- `revoke all … from public, anon, authenticated, service_role`, dann gezielt grants. `anon` bekommt
-- NIRGENDS etwas, und es gibt für KEINE Rolle ein `delete`-Grant.
--
-- ── ARBEITSREGEL 1 (Funktionsrümpfe) — ABGEARBEITET, OBWOHL NICHTS GELÖSCHT WIRD ────────────────
-- Es wird keine Spalte umbenannt, keine gelöscht und keine bestehende Funktion ersetzt. Die Regel
-- greift trotzdem in ihrer Umkehrung: Der neue Schreibweg darf keine bestehende Auswertung still
-- verändern. Alle Rümpfe, die `platform.entitlements` anfassen, wurden per `pg_get_functiondef`
-- durchgesehen. Drei sind einschlägig, keiner ändert sein Verhalten:
--   * `platform.has_entitlement` (T4-1) filtert auf `is_active` UND `valid_until` UND `product` —
--     eine `calculator_pro`-Zeile kann darüber keinen Monitor-Zugang erzeugen (Produkt-Isolation,
--     in B10-1 eigens gemessen).
--   * `platform.sync_entitlement_from_subscription` (T4-1) fasst ausschliesslich Zeilen mit
--     `source='stripe'` an — eine hier entstandene `manual`-Zeile ist für ihn unsichtbar.
--   * `platform.guard_entitlement_stripe_source` (T4-1) sperrt nur `source='stripe'` ohne das
--     transaktionslokale Flag. `source='manual'` passiert ihn ungehindert (wie in `redeem_code`).
-- Kein Rumpf verzweigt erschöpfend über `platform.product_key` (kein `case` ohne `else`).
--
-- ── ARBEITSREGEL 5 (kein Direktaufruf ohne Grant) ───────────────────────────────────────────────
-- Gilt für das Gate zu dieser Migration: Die fehlende Aufrufbarkeit für `anon`/`service_role` wird
-- mit `has_function_privilege` geprüft, NICHT durch einen Aufruf — ein solcher Aufruf hat im
-- CI-Lauf von B16-4a den Postgres-Prozess mit Signal 11 beendet.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — Der Status einer Anfrage
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WARUM EIN EIGENES ENUM UND NICHT `platform.partner_application_status` ──────────────────────
-- Das bestehende Enum trägt exakt dieselben drei Werte, und genau deshalb ist die Versuchung gross.
-- Es wird trotzdem nicht wiederverwendet: Zwei fachlich unabhängige Lebenszyklen an einem Typ zu
-- koppeln heisst, dass ein vierter Wert für den einen still den Wertebereich des anderen erweitert —
-- und `alter type … add value` ist nicht zurücknehmbar. Eine Bewerbung („will Vertriebspartner
-- werden") und eine Kalkulator-Anfrage („bin Partner, brauche das Werkzeug") sind verschiedene
-- Vorgänge desselben Betriebs; heute gleich benannte Zustände sind kein gemeinsamer Typ.
--
-- Enum und nicht Referenztabelle: dieselbe Regel wie bei `platform.consent_purpose` (B1-1),
-- `platform.industry` (B3-1) und `platform.partner_application_status` (B16-3) — der Anwendungscode
-- MUSS jeden Wert kennen (die Oberfläche filtert danach, die Entscheidung verzweigt daran). Eine
-- Tabelle wäre richtig, wenn Werte im Betrieb dazukämen; hier wäre ein vierter Zustand eine
-- fachliche Entscheidung mit Code-Folgen.
create type platform.calculator_request_status as enum ('pending', 'approved', 'rejected');

comment on type platform.calculator_request_status is
  'B18-4: Lebenszyklus einer Kalkulator-Anfrage eines Fachbetriebs. Bewusst ein EIGENES Enum und '
  'nicht platform.partner_application_status, obwohl die Werte heute übereinstimmen: zwei '
  'unabhängige Lebenszyklen an einem Typ zu koppeln hiesse, dass ein vierter Wert für den einen '
  'still den Wertebereich des anderen erweitert — und alter type … add value ist nicht '
  'zurücknehmbar.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — platform.calculator_requests
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── DIE ANFRAGE HÄNGT AM FACHBETRIEB, NICHT AM KONTO ───────────────────────────────────────────
-- `partner_slug` und nicht `user_id`. Der Grund ist derselbe, aus dem `platform.partners.user_id`
-- seit B16-4a eine ABSEHBAR TEMPORÄRE UNIQUE-Bedingung trägt: Mehrere Logins je Partnerbetrieb
-- (Inhaber plus Büro) kommen später über eine Zwischentabelle. Hinge die Anfrage am KONTO, wäre sie
-- danach die Anfrage einer Person statt die des Betriebs — und die Regel „nur eine offene Anfrage"
-- (s. u.) hiesse plötzlich „eine je Mitarbeiter". Am Slug bleibt sie richtig, ohne dass jemand sie
-- anfassen muss.
--
-- `on delete restrict`, nicht `set null` und nicht `cascade`: Fachbetriebe werden nie gelöscht (für
-- `platform.partners` hat KEINE Rolle ein delete-Grant, B16-1), Stilllegung läuft über `is_active`.
-- Genau deshalb soll eine dennoch versuchte Löschung LAUT scheitern, statt den Vorgang still zu
-- verlieren — dieselbe Überlegung wie bei `leads.partner_slug` (B16-1) und
-- `partners.application_id` (B16-4a). `set null` wäre zusätzlich der Fall aus der
-- SET-NULL-ist-ein-UPDATE-Familie, den diese Tabelle nicht braucht.
--
-- ── DER FREITEXT IST PFLICHT ───────────────────────────────────────────────────────────────────
-- „Wofür brauchen Sie den Kalkulator?" ist die Grundlage der Entscheidung. Eine leere Anfrage ist
-- nicht prüfbar — sie zwänge dazu, den Betrieb erst anzurufen, um zu erfahren, worüber überhaupt
-- entschieden werden soll. Deshalb NOT NULL samt Leerstring-CHECK: '' erfüllt NOT NULL, ist aber
-- kein Text (wie `partner_applications.message`, B16-3).
--
-- ── ⚠ HIER STEHT EINE LÄNGENOBERGRENZE, BEI `partner_applications.message` NICHT — Absicht ─────
-- Dort ist die Obergrenze bewusst im zod-Schema des Formulars und nicht in der Spalte, weil der
-- Wrapper `service_role`-only ist und es KEINEN Aufrufer am Schema vorbei gibt. Hier ist das anders
-- und die Abweichung ist der Grund: `public.submit_calculator_request` ist an `authenticated`
-- gegrantet und damit über PostgREST direkt aus dem Browser aufrufbar. Das Formular ist dann nicht
-- die Grenze, sondern eine Bequemlichkeit — und ohne Spaltenbedingung könnte jedes angemeldete
-- Partnerkonto beliebig grosse Texte in die Datenbank schreiben. Der Wrapper weist zu lange Texte
-- vorher mit einem lesbaren Status ab (`message_too_long`); der CHECK ist die harte Grenze
-- darunter, dieselbe Zwei-Schichten-Konstruktion wie bei `duplicate_slug` (B16-4a).
create table platform.calculator_requests (
  id uuid primary key default gen_random_uuid(),

  partner_slug text not null references platform.partners (slug) on delete restrict,

  message text not null
    check (btrim(message) <> '')
    check (length(message) <= 4000),

  status platform.calculator_request_status not null default 'pending',

  created_at timestamptz not null default now(),

  -- Die Prüfung. `reviewed_by` mit `on delete set null` wie `partner_applications.reviewed_by`
  -- (B16-3) und `leads.anonymized_by` (B1-3): der Vorgang bleibt belegt, nur die Zuschreibung
  -- entfällt, wenn das Konto des Prüfers gelöscht wird.
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,

  /*
   * OB und WANN der Betrieb erfahren hat, dass sein Zugang steht — dieselbe Rolle und dieselbe
   * Begründung wie `platform.partners.notified_at` (B16-4b): Ohne die Spalte liessen sich „wurde
   * informiert und meldet sich nicht" und „hat nie eine Mail bekommen" nicht unterscheiden, obwohl
   * sie gegensätzliches Handeln verlangen. Sie steht hier an der ANFRAGE und nicht am Partner, weil
   * ein Betrieb mehrere Anfragen stellen kann (nach einer Ablehnung ist eine neue erlaubt) und die
   * Nachricht sich auf genau eine davon bezieht.
   */
  notified_at timestamptz,

  /*
   * Eine geprüfte Anfrage trägt einen Prüfzeitpunkt, eine offene keinen. Der ZEITPUNKT und nicht das
   * KONTO ist die Bedingung — sonst machte `on delete set null` beim Löschen des Prüfer-Kontos die
   * Zeile ungültig und das Konto unlöschbar (in B16-3 ausformuliert, dieselbe Asymmetrie-Familie wie
   * `leads.last_edited_by`, `email_events.lead_id`, `analyses.lead_id`, `partner_applications.user_id`).
   */
  constraint calculator_requests_review_consistent check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null)
    or (status <> 'pending' and reviewed_at is not null)
  ),

  /*
   * Ein Versandvermerk ohne Freigabe wäre die Behauptung, jemand sei über einen Zugang informiert
   * worden, den er nicht hat. Aus einer ABGELEHNTEN Anfrage geht bewusst keine Mail hinaus (die
   * Ablehnung eines Werkzeugwunsches gehört in ein Gespräch, nicht in eine automatische Nachricht) —
   * die Bedingung hält genau das auf Speicherebene fest.
   */
  constraint calculator_requests_notified_only_when_approved check (
    notified_at is null or status = 'approved'
  )
);

comment on table platform.calculator_requests is
  'B18-4: Anfragen angemeldeter Fachbetriebe nach Zugang zum Peak-Shaving-Kalkulator. Die Anfrage '
  'hängt am FACHBETRIEB (partner_slug), nicht am Konto — mehrere Logins je Betrieb kommen später '
  'additiv (s. platform.partners.user_id, B16-4a), und am Konto hiesse die Regel „nur eine offene '
  'Anfrage" plötzlich „eine je Mitarbeiter". EIGENE Tabelle und ausdrücklich nicht '
  'platform.partner_applications: dort bewirbt sich ein Betrieb, der noch keiner ist; hier fragt '
  'ein bestehender Partner ein Werkzeug an. RLS aktiv, für KEINE Rolle irgendein Tabellenrecht — '
  'jeder Zugriff läuft über die vier public-Wrapper. Kein delete-Grant. ⚠ Es gibt bewusst KEINE '
  'Aufbewahrungsfrist (s. Kopf der Migration und DEPLOYMENT.md §7).';

comment on column platform.calculator_requests.partner_slug is
  'Der anfragende Fachbetrieb. on delete restrict (nicht set null): Partner werden nie gelöscht '
  '(kein delete-Grant, Stilllegung über is_active) — eine dennoch versuchte Löschung soll laut '
  'scheitern statt den Vorgang still zu verlieren (wie leads.partner_slug B16-1 und '
  'partners.application_id B16-4a).';

comment on column platform.calculator_requests.message is
  'PFLICHT-Freitext („Wofür brauchen Sie den Kalkulator?"). Grundlage der Entscheidung; eine leere '
  'Anfrage ist nicht prüfbar. Leerstring-CHECK, weil '''' NOT NULL erfüllt und trotzdem kein Text '
  'ist. ⚠ ZUSÄTZLICH eine Längenobergrenze (4000) — anders als bei partner_applications.message, '
  'und genau deshalb: submit_calculator_request ist authenticated-only und damit über PostgREST '
  'direkt aus dem Browser aufrufbar; das Formular ist keine Grenze. Der Wrapper weist vorher mit '
  'message_too_long ab, der CHECK ist die harte Schicht darunter.';

comment on column platform.calculator_requests.status is
  'pending → approved|rejected. Gesetzt AUSSCHLIESSLICH über public.admin_decide_calculator_request '
  '— und ''approved'' entsteht dort NUR zusammen mit dem calculator_pro-Entitlement, in EINER '
  'Transaktion. Es gibt keinen Weg zu einem genehmigten Antrag ohne Zugang.';

comment on column platform.calculator_requests.notified_at is
  'B18-4: Zeitpunkt der ZUGESTELLTEN Freischaltungsmail. Gesetzt ausschliesslich über '
  'public.admin_mark_calculator_request_notified, und zwar erst NACH erfolgreichem Versand — ein '
  'Vermerk davor stünde ausgerechnet dann auf „benachrichtigt", wenn der Versand gleich darauf '
  'scheitert (Muster platform.partners.notified_at, B16-4b). Ein CHECK hält fest, dass er nur an '
  'einer GENEHMIGTEN Anfrage stehen kann.';

-- ── Indizes ──────────────────────────────────────────────────────────────────────────────────────
-- ⚠ DER PARTIELLE UNIQUE-INDEX IST DIE EIGENTLICHE INVARIANTE DIESES ABSCHNITTS.
-- „Solange eine Anfrage offen ist, gibt es keine zweite" steht damit im SPEICHER und nicht in der
-- Disziplin des Wrappers: Zwei gleichzeitige Absendungen desselben Betriebs (Doppelklick, zweiter
-- Tab) könnten beide die Vorprüfung passieren; die zweite scheitert dann hier. Der Wrapper prüft
-- trotzdem vorher und antwortet mit `already_pending` — ein 23505 ist für die Person davor keine
-- Auskunft (dieselbe Zwei-Schichten-Konstruktion wie bei `duplicate_slug`, B16-4a).
--
-- Partiell auf `status = 'pending'`, damit eine ABGELEHNTE oder GENEHMIGTE Anfrage eine neue nicht
-- blockiert — das ist ausdrücklich erlaubt.
create unique index calculator_requests_one_pending_per_partner_idx
  on platform.calculator_requests (partner_slug)
  where status = 'pending';

-- Die Liste zeigt „neueste zuerst", gefiltert oder ungefiltert; der Partner-Index bedient sowohl die
-- Sicht „alle Anfragen dieses Betriebs" als auch die `restrict`-Prüfung des Fremdschlüssels (ohne
-- ihn wäre sie ein Seq-Scan).
create index calculator_requests_created_at_idx
  on platform.calculator_requests (created_at desc);
create index calculator_requests_status_created_at_idx
  on platform.calculator_requests (status, created_at desc);
create index calculator_requests_partner_slug_idx
  on platform.calculator_requests (partner_slug);
create index calculator_requests_reviewed_by_idx
  on platform.calculator_requests (reviewed_by)
  where reviewed_by is not null;

-- ── RLS + Rechte ─────────────────────────────────────────────────────────────────────────────────
-- RLS an, KEINE Policy, für KEINE Rolle irgendein Tabellenrecht — Muster `platform.job_runs` (B4-1),
-- `platform.admin_exports` (B2-1) und `platform.partner_applications` (B16-3). Gelesen und
-- geschrieben wird ausschliesslich über die vier SECURITY-DEFINER-Wrapper unten.
alter table platform.calculator_requests enable row level security;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — public.submit_calculator_request: der Weg des Fachbetriebs
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── KEIN PARAMETER FÜR DIE PARTNER-IDENTITÄT, genau wie `get_my_partner_leads` (B18-6) ─────────
-- Die Bindung entsteht im Rumpf über `auth.uid()`. Es gibt nichts zu übergeben und damit keinen Weg,
-- im Namen eines FREMDEN Fachbetriebs anzufragen. Ein Slug-Parameter wäre genau dieser Weg — und er
-- brächte keinen Nutzen, weil ein Konto ohnehin höchstens einer Partnerzeile gehört (UNIQUE auf
-- `platform.partners.user_id`, B16-4a). Das einzige Argument ist die Begründung.
--
-- ── EIN INAKTIVER PARTNER KANN NICHT ANFRAGEN, UND ZWAR MIT DERSELBEN ANTWORT WIE „KEIN PARTNER" ─
-- `is_active` steht in der BEDINGUNG, nicht in der Rückgabe — wortgleich zu `get_my_partner`
-- (B16-4b), `get_my_partner_leads` (B18-6), `get_active_partner` (B16-2) und `capture_lead`
-- (B16-1). Die Deaktivierung IST die Ansage; die Anwendung kann den dritten Zustand („gibt es, ist
-- aber stillgelegt") gar nicht erst erfinden. `{status: none}` deckt deshalb wie dort drei Fälle in
-- EINER Antwort ab: kein Partner, stillgelegt, nicht angemeldet.
--
-- ── EINE OFFENE ANFRAGE SCHLIESST EINE ZWEITE AUS — MIT MELDUNG, NICHT STILL ────────────────────
-- Ein stilles Verwerfen wäre die schlechteste Variante: Der Betrieb sähe eine Erfolgsmeldung und
-- wartete auf eine Entscheidung über einen Text, den niemand bekommen hat. `already_pending` trägt
-- deshalb den Zeitpunkt der bestehenden Anfrage mit — die Oberfläche kann sagen, seit wann sie
-- offen ist, statt nur „geht nicht".
--
-- NACH einer Ablehnung oder Genehmigung ist eine neue Anfrage ausdrücklich ERLAUBT: Umstände ändern
-- sich, ein abgelaufenes Entitlement kommt vor, und eine einmalige Ablehnung darf einen Betrieb
-- nicht dauerhaft aussperren. Der partielle UNIQUE-Index oben ist genau deshalb partiell.
--
-- ── ES WIRD NICHT GEPRÜFT, OB DER ZUGANG SCHON BESTEHT ─────────────────────────────────────────
-- Bewusst nicht: `platform.has_entitlement` liesse sich hier aufrufen (SECURITY DEFINER), und ein
-- `already_active` wäre schnell geschrieben. Es widerspräche aber der Regel eine Zeile darüber —
-- „nach einer genehmigten Anfrage ist eine neue erlaubt" —, und es gäbe einem Aufrufer eine Auskunft
-- über den Entitlement-Bestand, die er über `get_my_entitlement` ohnehin selbst holen kann. Ob ein
-- Formular überhaupt angeboten wird, entscheidet die Oberfläche (nächster Schritt), nicht dieser
-- Wrapper.
create function public.submit_calculator_request(p_message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- BARE auth.uid(), NICHT (select auth.uid()): das Subquery-Wrapping ist eine RLS-POLICY-
  -- Optimierung und löst im Funktionskörper einen Backend-Segfault aus, sobald auth.uid() NULL ist
  -- (s. T4-2-Migration). Gleiche Form wie get_my_partner/redeem_code/is_admin.
  v_user    uuid := auth.uid();
  v_message text := nullif(btrim(p_message), '');
  v_slug    text;
  v_pending platform.calculator_requests%rowtype;
  v_id      uuid;
begin
  select p.slug
    into v_slug
  from platform.partners p
  where p.user_id = v_user
    and p.is_active;

  if not found then
    return jsonb_build_object('status', 'none');
  end if;

  if v_message is null then
    return jsonb_build_object('status', 'missing_fields');
  end if;

  -- Gemessen wird der BEREINIGTE Text: was gespeichert wird, ist auch das, was der Grenze
  -- unterliegt. Andernfalls scheiterte eine Anfrage an Leerzeichen, die gar nicht ankommen.
  if length(v_message) > 4000 then
    return jsonb_build_object('status', 'message_too_long', 'max_length', 4000);
  end if;

  /*
   * `for update` auf der bestehenden offenen Anfrage: Zwei gleichzeitige Absendungen desselben
   * Betriebs (Doppelklick, zweiter Tab) sollen sich serialisieren, statt beide die Prüfung zu
   * passieren. Der partielle UNIQUE-Index ist die harte Grenze darunter — findet die erste
   * Transaktion nichts und legt an, blockiert die zweite dort und scheitert sauber.
   */
  select * into v_pending
    from platform.calculator_requests cr
   where cr.partner_slug = v_slug
     and cr.status = 'pending'
   for update;

  if found then
    return jsonb_build_object(
      'status', 'already_pending',
      'request_id', v_pending.id,
      'created_at', v_pending.created_at
    );
  end if;

  insert into platform.calculator_requests (partner_slug, message)
  values (v_slug, v_message)
  returning id into v_id;

  /*
   * Die Rückgabe trägt die Kennung, weil die interne Benachrichtigungsmail auf die Detailansicht
   * verweisen soll (Muster `submit_partner_application`, B16-3) — und den Kurz-Key samt
   * Anzeigenamen NICHT: die kennt der Aufrufer bereits aus `get_my_partner`, und was ein Wrapper
   * nicht herausgibt, kann keine Oberfläche versehentlich anzeigen.
   */
  return jsonb_build_object('status', 'ok', 'request_id', v_id);
end;
$$;

comment on function public.submit_calculator_request(text) is
  'B18-4: nimmt die Kalkulator-Anfrage des ANGEMELDETEN Fachbetriebs entgegen. KEIN Parameter für '
  'die Partner-Identität (wie public.get_my_partner_leads, B18-6): die Bindung entsteht im Rumpf '
  'über auth.uid() — es gibt nichts zu übergeben und damit keinen Weg, im Namen eines fremden '
  'Betriebs anzufragen; das einzige Argument ist die Begründung. Löst die EIGENE AKTIVE Partnerzeile '
  'auf; ein stillgelegter Partner bekommt dieselbe Antwort wie ein Konto ohne Partnerzeile '
  '({status: none} deckt drei Fälle ab: kein Partner, stillgelegt, nicht angemeldet — wie '
  'get_my_partner). Eine bereits OFFENE Anfrage desselben Betriebs wird mit already_pending '
  'ABGEWIESEN (samt Kennung und Zeitpunkt der bestehenden), nicht still verworfen — ein stilles '
  'Verwerfen liesse den Betrieb auf eine Entscheidung über einen Text warten, den niemand bekommen '
  'hat; die harte Schicht darunter ist der partielle UNIQUE-Index. Nach einer abgelehnten ODER '
  'genehmigten Anfrage ist eine neue ausdrücklich erlaubt. Es wird NICHT geprüft, ob der Zugang '
  'schon besteht. Rückgabe {status: ok|none|missing_fields|message_too_long|already_pending, '
  'request_id, created_at, max_length}. authenticated-only, service_role bewusst ohne Grant.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — public.admin_decide_calculator_request: die Entscheidung, EINE Transaktion
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── DIE ATOMARITÄT IST DIE ZUSAGE DIESES ABSCHNITTS ────────────────────────────────────────────
-- Status setzen und Entitlement anlegen passiert in EINEM Aufruf. Scheitert eines davon, wird der
-- gesamte Aufruf zurückgenommen — es kann keine genehmigte Anfrage ohne Zugang geben und keinen
-- Zugang aus einer Anfrage, die nicht genehmigt ist. Zwei getrennte Wrapper (erst freigeben, dann
-- Entitlement) hätten genau den Zwischenzustand erzeugt, den die Aufgabe ausschliesst: Der Admin
-- sähe „freigegeben", der Betrieb stünde weiter vor der Anfrage-Seite, und niemand könnte die beiden
-- Zustände unterscheiden. Dieselbe Konstruktion und dieselbe Begründung wie
-- `admin_approve_partner_application` (B16-4a).
--
-- Deshalb steht das Entitlement auch VOR dem Status-Update: schlägt es aus einem Grund fehl, den die
-- Prüfungen oben nicht kennen (ein später ergänzter Trigger, ein CHECK), bleibt die Anfrage
-- unangetastet `pending` statt als genehmigt ohne Zugang zurückzubleiben.
--
-- ── DIE ENTSCHEIDUNG IST EIN PARAMETER — anders als in B16-3, und das ist kein Widerspruch ──────
-- `admin_reject_partner_application` (B16-3) hat den Zielstatus bewusst als LITERAL, damit sich über
-- dieselbe Funktion NICHT auch 'approved' setzen lässt: Genehmigen bedeutete dort zusätzlich
-- Partner, Slug und Freischaltung, und ein Status ohne diese drei sähe aus wie Erfolg. Hier ist die
-- Lage umgekehrt: Diese Funktion TUT bereits alles, was eine Freigabe ausmacht. Ein Parameter kann
-- deshalb keinen halben Zustand herstellen — er wählt zwischen zwei vollständigen.
--
-- `text` mit den beiden ENUM-Werten und nicht der Enum-Typ selbst: ein unbekannter Wert käme sonst
-- als 22P02 („invalid input value for enum") aus PostgREST zurück, und die Oberfläche könnte einen
-- Tippfehler nicht von einem Ausfall unterscheiden (dieselbe Regel wie beim Statusfilter in
-- `admin_list_partner_applications`, B16-3, und bei `p_partner_assignment`, B18-5). Die Werte sind
-- englisch, weil Statuswerte in diesem System durchgehend Datenbankwerte sind.
--
-- ── FÜNF ABWEISUNGSGRÜNDE, JEDER MIT EIGENER, UNTERSCHEIDBARER URSACHE ─────────────────────────
--   not_found          Die Anfrage gibt es nicht (mehr) — Seite neu laden.
--   invalid_decision   Weder 'approved' noch 'rejected'. Wird ABGEWIESEN statt still als Ablehnung
--                      gedeutet: eine falsch getippte Entscheidung darf nicht die schärfere sein.
--   already_reviewed   Nicht mehr `pending`. Keine Zweitentscheidung, kein zweiter Zeitstempel — die
--                      Prüfung ist eine einmalige Handlung (wie B16-3/B16-4a). Der aktuelle Status
--                      fährt mit, damit die Oberfläche „schon freigegeben" von „abgelehnt"
--                      unterscheiden kann.
--   no_account         ⚠ NUR beim Freigeben. Der Fachbetrieb trägt keine `user_id` — s. u.
--   missing_fields     Keine Entscheidung übergeben.
--
-- ── ⚠ `no_account` GILT NUR FÜR DIE FREIGABE, NICHT FÜR DIE ABLEHNUNG ──────────────────────────
-- Ein Entitlement hängt an einem Konto (`platform.entitlements.user_id`). Fehlt es, gibt es nichts
-- freizuschalten, und eine „genehmigte" Anfrage ohne Zugang wäre genau der stille Zustand, den die
-- Atomarität oben verhindert. Der Fall ist real und nicht theoretisch: `platform.partners.user_id`
-- trägt `on delete set null` (B16-4a) — löscht jemand sein Konto zwischen Absendung und
-- Entscheidung, steht die Anfrage ohne Konto da (bei der Absendung gab es eines, sonst hätte
-- `auth.uid()` nichts gefunden).
--
-- ABLEHNEN bleibt in diesem Fall möglich, und das ist Absicht: Es braucht kein Konto, und es ist der
-- einzige Weg, eine gegenstandslos gewordene Anfrage sauber zu schliessen. Sie sonst dauerhaft offen
-- zu lassen hiesse zusätzlich, dass der Betrieb wegen des partiellen UNIQUE-Index nie wieder eine
-- neue stellen könnte.
--
-- ── ⚠ EIN BEREITS AKTIVER ZUGANG WIRD NICHT ÜBERSCHRIEBEN ──────────────────────────────────────
-- Besteht schon ein aktives `calculator_pro` (Gutscheincode, Stripe, frühere Freigabe), wird die
-- Anfrage GENEHMIGT, die Entitlement-Zeile aber NICHT angefasst. Zwei Gründe:
--   (a) Das Ziel ist erreicht — der Betrieb HAT Zugang. Eine Zeile umzuschreiben, um denselben
--       Zustand herzustellen, ändert nur ihre Herkunft.
--   (b) Der Upsert würde eine aktive `source='stripe'`-Zeile auf `manual` umschreiben und sie damit
--       dauerhaft aus dem Stripe-Sync herauslösen (`sync_entitlement_from_subscription` fasst nur
--       `source='stripe'` an). Das Abo liefe weiter, ohne den Zugang noch zu steuern. Genau diese
--       Falle ist in `redeem_code` (T4-3) ausführlich dokumentiert und dort mit `already_active`
--       vermieden; hier darf sie die Entscheidung des Admins nicht blockieren, also wird die
--       bestehende Zeile in Ruhe gelassen.
-- Der Rückgabewert unterscheidet beides (`entitlement: granted|already_active`), damit die
-- Oberfläche und das Protokoll die Wahrheit sagen können.
--
-- Ein INAKTIVER Fachbetrieb wird NICHT abgewiesen: Stilllegung heisst, dass seine Empfehlungslinks
-- nicht mehr wirken (B16-1/B16-2), nicht dass er kein Werkzeug bekommen darf. Der Admin sieht den
-- Zustand in der Liste (`partner_is_active`) und entscheidet bewusst; eine hier erfundene Sperre
-- wäre eine Regel, die niemand aufgestellt hat.
create function public.admin_decide_calculator_request(p_id uuid, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_decision text := lower(nullif(btrim(p_decision), ''));
  v_request  platform.calculator_requests%rowtype;
  v_user_id  uuid;
  v_granted  text;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_decide_calculator_request: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  -- Reine Eingabeprüfung zuerst: sie braucht keine Zeile und keinen Sperrvorgang.
  if v_decision is null then
    return jsonb_build_object('status', 'missing_fields');
  end if;

  if v_decision not in ('approved', 'rejected') then
    return jsonb_build_object('status', 'invalid_decision');
  end if;

  /*
   * `for update` wie in `admin_reject_partner_application` (B16-3): Zwei Personen können dieselbe
   * Liste offen haben. Ohne die Sperre könnten beide die Anfrage als `pending` lesen und beide
   * entscheiden — mit ungewisser Reihenfolge und zwei Prüfzeitpunkten.
   */
  select * into v_request
    from platform.calculator_requests cr
   where cr.id = p_id
   for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_request.status <> 'pending' then
    return jsonb_build_object(
      'status', 'already_reviewed',
      'current', v_request.status
    );
  end if;

  if v_decision = 'rejected' then
    update platform.calculator_requests cr
       set status      = 'rejected',
           reviewed_by = auth.uid(),
           reviewed_at = now()
     where cr.id = p_id;

    -- Ausdrücklich KEIN Entitlement, und ausdrücklich keine Rücknahme eines etwaigen bestehenden:
    -- eine abgelehnte Anfrage sagt nichts über einen Zugang aus, den der Betrieb aus einer anderen
    -- Quelle hat.
    return jsonb_build_object('status', 'ok', 'decision', 'rejected');
  end if;

  -- ── ab hier: Freigabe ─────────────────────────────────────────────────────────────────────────
  select p.user_id
    into v_user_id
  from platform.partners p
  where p.slug = v_request.partner_slug;

  -- ⚠ s. oben: ohne Konto gibt es nichts freizuschalten. Ablehnen bleibt möglich.
  if v_user_id is null then
    return jsonb_build_object('status', 'no_account');
  end if;

  -- Der Enum-Wert ausdrücklich gecastet: mit `search_path = ''` und einer Funktion, deren Parameter
  -- ein Typ aus `platform` ist, soll die Auflösung nicht von der Coercion eines untypisierten
  -- Literals abhängen.
  if platform.has_entitlement(v_user_id, 'calculator_pro'::platform.product_key) then
    -- ⚠ s. oben: bestehenden Zugang nicht umschreiben (Stripe-Sync).
    v_granted := 'already_active';
  else
    /*
     * source='manual' passiert den Guard `guard_entitlement_stripe_source` ungehindert (der sperrt
     * nur source='stripe', Invariante I2). valid_until=NULL = unbefristet, vom CHECK ausdrücklich
     * für manual erlaubt (T4-2). Der Upsert kann eine bestehende INAKTIVE stripe-Zeile
     * (abgelaufenes Abo) auf manual umschreiben — dieselbe, in `redeem_code` ausführlich
     * dokumentierte Folge; der aktive Fall ist oben ausgeschlossen.
     *
     * `note` hält die Herkunft fest. Ab dieser Migration gibt es DREI Schreibwege in
     * platform.entitlements; ohne den Vermerk liesse sich einer manual-Zeile nicht ansehen, ob sie
     * aus einem Gutscheincode oder aus einer Partner-Anfrage stammt. Die Kennung genügt — der Rest
     * steht in der Anfrage selbst.
     */
    insert into platform.entitlements as e (user_id, product, is_active, valid_until, source, note, updated_at)
    values (v_user_id, 'calculator_pro', true, null, 'manual',
            'B18-4: Kalkulator-Anfrage ' || p_id::text, now())
    on conflict (user_id, product) do update
       set is_active   = true,
           valid_until = null,
           source      = 'manual',
           note        = excluded.note,
           updated_at  = now();

    v_granted := 'granted';
  end if;

  update platform.calculator_requests cr
     set status      = 'approved',
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where cr.id = p_id;

  return jsonb_build_object(
    'status', 'ok',
    'decision', 'approved',
    'entitlement', v_granted,
    -- Der Kurz-Key fährt mit, weil der Aufrufer danach die Freischaltungsmail auslöst und dafür den
    -- Betrieb nachschlagen muss. Eine mitgeschickte Adresse wäre hier falsch am Platz — sie gehört
    -- in den Leseweg, der auch den Vermerk setzt (Muster `notifyPartnerBySlug`, B16-4b).
    'partner_slug', v_request.partner_slug
  );
end;
$$;

comment on function public.admin_decide_calculator_request(uuid, text) is
  'B18-4: entscheidet über eine Kalkulator-Anfrage. Bei FREIGABE entstehen Status und '
  'calculator_pro-Entitlement (source=manual, valid_until=null) in EINER Transaktion — es gibt '
  'keinen genehmigten Antrag ohne Zugang und keinen Zugang aus einem nicht genehmigten Antrag; das '
  'Entitlement wird VOR dem Status geschrieben, damit ein Fehlschlag die Anfrage unangetastet '
  'pending lässt (Muster admin_approve_partner_application, B16-4a). Bei ABLEHNUNG nur der Status, '
  'kein Entitlement und keine Rücknahme eines bestehenden. Die Entscheidung ist ein text-Parameter '
  'mit den Enum-Werten approved|rejected (kein Enum-Typ: ein unbekannter Wert käme sonst als 22P02 '
  'und wäre von einem Ausfall nicht zu unterscheiden) — anders als in B16-3, wo der Zielstatus ein '
  'Literal ist, weil dort ein Parameter einen halben Zustand hätte herstellen können; hier tut die '
  'Funktion bereits alles, was eine Freigabe ausmacht. ⚠ Ein BEREITS AKTIVES Entitlement wird NICHT '
  'überschrieben (entitlement=already_active): der Upsert löste eine aktive stripe-Zeile dauerhaft '
  'aus dem Sync heraus (s. redeem_code). ⚠ no_account gilt NUR fürs Freigeben — ohne '
  'partners.user_id (on delete set null) gibt es nichts freizuschalten; ABLEHNEN bleibt möglich, '
  'sonst bliebe die Anfrage ewig offen und der partielle UNIQUE-Index sperrte jede neue. Ein '
  'INAKTIVER Fachbetrieb wird nicht abgewiesen (Stilllegung betrifft die Empfehlungslinks, nicht '
  'das Werkzeug). Rückgabe {status: ok|not_found|missing_fields|invalid_decision|already_reviewed|'
  'no_account, decision, entitlement, partner_slug, current}. WIRFT bei fehlender Adminrolle (42501) '
  'statt leer zu antworten. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — public.admin_list_calculator_requests: der Prüf-Eingang
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Neueste zuerst, seitenweise, optional nach Status gefiltert — Muster
-- `admin_list_partner_applications` (B16-3), bis hin zum abgelehnten Filterwert: Ein unbekannter
-- Status wird als `invalid_filter` BEANTWORTET statt still ignoriert, sonst hielte man ein
-- ungefiltertes Ergebnis für ein gefiltertes. `total` ist die Zahl der TREFFER (nicht des Bestands),
-- damit Seitenaufteilung und Trefferanzeige dieselbe Menge meinen.
--
-- ── DER FREITEXT FÄHRT SCHON IN DER LISTE MIT ──────────────────────────────────────────────────
-- Er ist der Grund, warum jemand eine Anfrage überhaupt öffnet, und die Liste ist kurz. Ihn erst in
-- einer Detailansicht zu zeigen hiesse, jede Anfrage einzeln anzuklicken, um zu erfahren, worum es
-- geht — dieselbe Überlegung wie bei den Partner-Bewerbungen.
--
-- ── DIE PARTNER-IDENTITÄT IST DER ANZEIGENAME, NICHT NUR DER SLUG ──────────────────────────────
-- Ein Kurz-Key ist eine Adress-Kennung, kein Name (dieselbe Entscheidung wie in der Lead-Liste,
-- B18-5). Wer über einen Zugang entscheidet, muss den Betrieb erkennen. Beides fährt mit: der Name
-- für den Menschen, der Slug für den Verweis auf `/admin/partner`.
--
-- `account_email` steht daneben, weil eine UUID einem Menschen nicht sagt, WELCHES Konto
-- freigeschaltet wird (Muster `admin_list_partners`, B16-4a) — und weil `null` dort GENAU der Fall
-- ist, den `admin_decide_calculator_request` mit `no_account` abweist. Der Admin sieht ihn damit
-- VOR dem Klick statt erst über die Abweisung.
--
-- `partner_is_active` fährt mit, weil ein stillgelegter Betrieb weiterhin entscheidbar ist (s. TEIL
-- 4) — die Oberfläche soll das benennen können, statt den Zustand zu verschweigen.
--
-- Es gibt bewusst KEIN Feld „hat aktuell calculator_pro". Der Zugang ist über
-- `admin_decide_calculator_request` bereits garantiert, sobald die Anfrage genehmigt ist; eine
-- zweite, laufend neu berechnete Aussage daneben wäre eine Einladung, ihr statt dem Vorgang zu
-- glauben. Wer den Entitlement-Bestand prüfen will, prüft ihn dort, wo er steht.
create function public.admin_list_calculator_requests(
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status platform.calculator_request_status;
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total  integer;
  v_rows   jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_list_calculator_requests: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if p_status is not null and btrim(p_status) <> '' then
    if btrim(lower(p_status)) not in ('pending', 'approved', 'rejected') then
      return jsonb_build_object('status', 'invalid_filter', 'field', 'status');
    end if;
    v_status := btrim(lower(p_status))::platform.calculator_request_status;
  end if;

  select count(*)::integer into v_total
    from platform.calculator_requests cr
   where v_status is null or cr.status = v_status;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select cr.id,
           cr.partner_slug,
           cr.message,
           cr.status,
           cr.created_at,
           cr.reviewed_at,
           cr.notified_at,
           p.display_name as partner_display_name,
           p.is_active    as partner_is_active,
           (select au.email from auth.users au where au.id = p.user_id) as account_email,
           (select au.email from auth.users au where au.id = cr.reviewed_by) as reviewed_by_email
    from platform.calculator_requests cr
    join platform.partners p on p.slug = cr.partner_slug
    where v_status is null or cr.status = v_status
    order by cr.created_at desc
    limit v_limit offset v_offset
  ) r;

  return jsonb_build_object(
    'status', 'ok',
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'requests', v_rows
  );
end;
$$;

comment on function public.admin_list_calculator_requests(text, integer, integer) is
  'B18-4: die Kalkulator-Anfragen (neueste zuerst, seitenweise, optional nach Status gefiltert). Der '
  'Freitext fährt schon hier mit — er ist der Grund, warum jemand eine Anfrage öffnet. Die '
  'Partner-Identität ist der ANZEIGENAME (partner_display_name) und nicht nur der Kurz-Key: der ist '
  'eine Adress-Kennung, kein Name (wie in der Lead-Liste, B18-5); beides fährt mit. account_email '
  'steht daneben, weil eine UUID nicht sagt, WELCHES Konto freigeschaltet wird — und weil null dort '
  'genau der Fall ist, den admin_decide_calculator_request mit no_account abweist (der Admin sieht '
  'ihn damit VOR dem Klick). partner_is_active, weil ein stillgelegter Betrieb weiterhin entscheidbar '
  'ist. KEIN Feld „hat aktuell calculator_pro" — eine zweite, laufend neu berechnete Aussage neben '
  'dem Vorgang wäre eine Einladung, ihr statt dem Vorgang zu glauben. total ist die Zahl der '
  'TREFFER, nicht des Bestands. Ein unbekannter Statusfilter wird als invalid_filter ABGEWIESEN '
  'statt still ignoriert. WIRFT bei fehlender Adminrolle (42501). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 6 — public.admin_mark_calculator_request_notified: „erst senden, dann vermerken"
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Struktureller Zwilling von `public.admin_mark_partner_notified` (B16-4b), und aus denselben
-- Gründen:
--
--   * KEIN Zeitstempel-Parameter (der Wrapper nimmt `now()`) und KEIN Gegenstück zum Nullen. Ein
--     setzbarer Zeitpunkt wäre eine Angabe über eine Zustellung, die niemand geprüft hat; ein
--     Zurücksetzen wäre der Weg, auf dem ein misslungener Versand wie ein nie unternommener
--     aussieht. Der Admin kann feststellen, nicht umschreiben.
--   * DIE REIHENFOLGE IST BINDEND: erst senden, dann vermerken. Die Freigabe (TEIL 4) ist eine
--     vollzogene, nicht zurücknehmbare Transaktion — das Entitlement steht, der Betrieb kann den
--     Kalkulator benutzen. Ein Mailausfall darf daran NICHTS ändern, und ein vor dem Versand
--     gesetzter Vermerk stünde ausgerechnet dann auf „benachrichtigt", wenn der Versand gleich
--     darauf scheitert.
--
-- ── ⚠ NUR AN EINER GENEHMIGTEN ANFRAGE, UND DIE PRÜFUNG STEHT HIER UND IM CHECK ────────────────
-- Aus einer abgelehnten Anfrage geht keine Mail hinaus; ein Vermerk daran wäre die Behauptung, ein
-- Betrieb sei über einen Zugang informiert worden, den er nicht hat. Der Wrapper antwortet dafür mit
-- `not_approved` — die Spaltenbedingung darunter ist die Schicht, die auch dann hält, wenn jemand
-- den Vermerk anders auslöst.
create function public.admin_mark_calculator_request_notified(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request platform.calculator_requests%rowtype;
  v_now     timestamptz := now();
begin
  if not platform.is_admin() then
    raise exception 'public.admin_mark_calculator_request_notified: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select * into v_request
    from platform.calculator_requests cr
   where cr.id = p_id
   for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_request.status <> 'approved' then
    return jsonb_build_object('status', 'not_approved', 'current', v_request.status);
  end if;

  update platform.calculator_requests cr
     set notified_at = v_now
   where cr.id = p_id;

  return jsonb_build_object('status', 'ok', 'notified_at', v_now);
end;
$$;

comment on function public.admin_mark_calculator_request_notified(uuid) is
  'B18-4: hält fest, dass die Freischaltungsmail ZUGESTELLT wurde — aufgerufen NACH erfolgreichem '
  'Versand. Struktureller Zwilling von admin_mark_partner_notified (B16-4b): KEIN '
  'Zeitstempel-Parameter (nimmt now()), KEIN Gegenstück zum Nullen — ein zurücksetzbarer Wert wäre '
  'der Weg, auf dem ein misslungener Versand wie ein nie unternommener aussieht. Die Reihenfolge ist '
  'bindend: die Freigabe ist bereits vollzogen und ein Mailausfall darf daran nichts ändern, aber '
  'ein Vermerk VOR dem Versand behauptete eine Nachricht, die es noch nicht gibt. ⚠ Nur an einer '
  'GENEHMIGTEN Anfrage (not_approved) — aus einer abgelehnten geht keine Mail hinaus; die '
  'Spaltenbedingung calculator_requests_notified_only_when_approved ist die Schicht darunter. '
  'Rückgabe {status: ok|not_found|not_approved, notified_at, current}. WIRFT bei fehlender '
  'Adminrolle (42501). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 7 — Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf NEUE public-Funktionen automatisch EXECUTE an
-- anon, authenticated UND service_role (zusätzlich zum PostgreSQL-Default-Grant an PUBLIC). Deshalb
-- wie überall: erst allen entziehen, dann gezielt gewähren.
--
-- ALLE VIER: nur `authenticated`. `service_role` bekommt bewusst KEIN Grant — jeder von ihnen leitet
-- seine Autorisierung aus `auth.uid()` bzw. `platform.is_admin()` ab, das dort NULL bzw. false ist;
-- sie wären funktionslos und stets abgelehnt (B2-1/B16-1/B16-3/B16-4a/B16-4b/B18-6). Bei
-- `submit_calculator_request` wiegt das zusätzlich schwerer: über `service_role` fände er per
-- Konstruktion keinen Partner, und ein Aufrufer, der das als „kein Partner" liest, sperrte einen
-- echten Fachbetrieb aus. Bei der Entscheidung wiegt es wie bei der Genehmigung in B16-4a:
-- `reviewed_by` bliebe strukturell leer, und die Zuschreibung einer Handlung, an der ein Produktzugang
-- hängt, ist der halbe Zweck des Protokolls.
--
-- Es entstehen KEINE neuen Tabellenrechte — weder auf `platform.calculator_requests` (RLS ohne
-- Policy, für niemanden ein Grant) noch auf `platform.entitlements` (unverändert: keine Nutzerrolle
-- hat dort Schreibrechte, I3). Der neue Schreibweg läuft ausschliesslich in der SECURITY-DEFINER-
-- Funktion oben.
revoke all on function public.submit_calculator_request(text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_decide_calculator_request(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_list_calculator_requests(text, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_mark_calculator_request_notified(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.submit_calculator_request(text) to authenticated;
grant execute on function public.admin_decide_calculator_request(uuid, text) to authenticated;
grant execute on function public.admin_list_calculator_requests(text, integer, integer) to authenticated;
grant execute on function public.admin_mark_calculator_request_notified(uuid) to authenticated;
