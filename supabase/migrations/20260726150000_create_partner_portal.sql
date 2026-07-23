-- B16-4b — das Partner-Portal und die Genehmigungsmail, die dorthin führt
-- (Fahrplan_2026.md, Abschnitt B16 — vierter Teil, zweite Hälfte).
--
-- B16-4a hat den Weg von der Bewerbung zum Fachbetrieb geschlossen: genehmigen legt in EINER
-- Transaktion den Partner an, verknüpft Konto und Antrag und setzt den Status. Was dort ausdrücklich
-- fehlte, war alles, was der Betrieb davon MERKT — kein Portal, keine Mail. Die Oberfläche sagt das
-- nach jeder Genehmigung im Klartext („er ist angelegt, aber NICHT benachrichtigt"). Diese Migration
-- liefert die drei Datenbank-Voraussetzungen dafür, dass dieser Satz nicht mehr stimmen muss.
--
-- ── DIE NEUE ZUGRIFFSEBENE, IN EINEM SATZ ───────────────────────────────────────────────────────
-- Ein Partner ist weder Kunde noch Admin. Was er darf, ergibt sich weiterhin ausschliesslich daraus,
-- was sein Konto HÄLT (B16-3: es gibt kein Typfeld am Konto) — ab jetzt zusätzlich daraus, dass eine
-- Zeile in `platform.partners` auf es zeigt. `public.get_my_partner` ist der einzige Lesezugriff, den
-- diese Ebene bekommt, und er liefert AUSSCHLIESSLICH die eigene Zeile.
--
-- ── WAS HIER AUSDRÜCKLICH NICHT ENTSTEHT ────────────────────────────────────────────────────────
-- KEINE Statistik und keine Klickzählung (B16-5 entscheidet die Zählweise gesondert — und mit ihr,
-- ob überhaupt gezählt wird, s. §165 TKG und die cookielose Analytics-Architektur aus B16-1).
-- KEINE Sicht auf Leads, weder namentlich noch aggregiert (B16-6; die namentliche Sicht setzt einen
-- Einwilligungszweck voraus, den es noch nicht gibt, und der wartet auf die juristische Prüfung).
-- KEIN `tenant_id`, KEINE Mehrfach-Logins je Partner (die UNIQUE-Bedingung auf
-- `platform.partners.user_id` aus B16-4a bleibt unangetastet — sie fällt später ADDITIV mit einer
-- Zwischentabelle, s. den Spaltenkommentar dort). KEIN Löschweg, kein neuer `consent_purpose`.
--
-- Unverändert bleiben ausserdem `public.capture_lead`, `platform.anonymize_lead`,
-- `guard_anonymized_lead`, `guard_partner_slug`, `public.get_active_partner`,
-- `public.submit_partner_application` und `public.admin_approve_partner_application`.
--
-- ── KONVENTIONEN (exakt T4-1/B1-1/B2-1/B14-1/B16-1/B16-3/B16-4a) ────────────────────────────────
-- Alles Fachliche in `platform` (nicht über die REST-API exponiert, `supabase/config.toml`), Zugriff
-- von aussen ausschliesslich über SECURITY-DEFINER-Wrapper im `public`-Schema, alle Funktionen mit
-- `SET search_path = ''` und vollqualifizierten Objektnamen, erst `revoke all … from public, anon,
-- authenticated, service_role`, dann gezielt grants. `anon` bekommt NIRGENDS etwas.
--
-- ── ARBEITSREGEL 1 (Funktionsrümpfe) — ABGEARBEITET, OBWOHL NICHTS GELÖSCHT WIRD ────────────────
-- Es wird in dieser Migration keine Spalte umbenannt und keine gelöscht; `notified_at` kommt additiv
-- dazu. Die Regel greift trotzdem in ihrer Umkehrung: Eine NEUE Spalte auf `platform.partners` darf
-- nicht von selbst irgendwo nach aussen gelangen. Alle Rümpfe, die diese Tabelle lesen, wurden per
-- `pg_get_functiondef` durchgesehen. Entscheidend sind zwei:
--   * `public.get_active_partner` (B16-2, der ÖFFENTLICHE Lesepfad) liest eine EXPLIZITE Spaltenliste
--     (`p.slug, p.display_name`). `notified_at` kann darüber nicht auf eine Landingpage geraten.
--   * `public.admin_list_partners` (B16-1/B16-4a) aggregiert `to_jsonb(p)` über eine Unterabfrage mit
--     EXPLIZITER Spaltenliste — die Spalte erscheint also NICHT von selbst und wird unten bewusst
--     ergänzt, weil der Admin-Bereich sie braucht.
-- Kein einziger Rumpf benutzt `select *` oder `to_jsonb(partners)` direkt.
--
-- ── ARBEITSREGEL 5 (kein Direktaufruf ohne Grant) ───────────────────────────────────────────────
-- Gilt für das Gate zu dieser Migration: die fehlende Aufrufbarkeit wird mit `has_function_privilege`
-- geprüft, nicht durch einen Aufruf — ein solcher Aufruf hat im CI-Lauf von B16-4a den
-- Postgres-Prozess mit Signal 11 beendet.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — platform.partners.notified_at: OB und WANN der Betrieb erfahren hat, dass es losgeht
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WARUM DIE SPALTE ÜBERHAUPT NÖTIG IST ────────────────────────────────────────────────────────
-- Ohne sie lässt sich der häufigste Betriebsfall nicht auseinanderhalten: „wurde informiert und
-- meldet sich nicht" gegen „hat nie eine Mail bekommen". Beide sehen im Admin-Bereich identisch aus
-- (ein Fachbetrieb, von dem nichts kommt), verlangen aber gegensätzliches Handeln — abwarten bzw.
-- nachfassen gegen: erneut senden. Der Mailversand ist dabei der wahrscheinlichste Fehlerpunkt des
-- ganzen Vorgangs: er hängt an einem fremden Dienst, an einer Konfiguration (`RESEND_*`) und an einer
-- zustellenden Gegenstelle.
--
-- ── SIE STEHT AUF `partners`, NICHT AUF `partner_applications` ──────────────────────────────────
-- Die Benachrichtigung gilt dem FACHBETRIEB und seinem Portalzugang, nicht dem Antrag. Zwei Gründe,
-- die beide für sich reichen: (a) Raymann — der erste reale Partner — ist von Hand angelegt worden
-- und hat gar keinen Antrag; auf `partner_applications` wäre er strukturell nicht benachrichtigbar,
-- also genau der Fall, für den die Sende-Aktion im Admin-Bereich gebaut wird. (b) Der Antrag ist mit
-- der Prüfung abgeschlossen (`reviewed_at`), der Portalzugang beginnt danach — ein zweiter Zeitstempel
-- am Antrag beschriebe einen Vorgang, der nicht mehr seiner ist.
--
-- ── DER WERT IST DIE LETZTE ERFOLGREICHE BENACHRICHTIGUNG, NICHT DIE ERSTE ──────────────────────
-- Ein erneutes Senden überschreibt ihn. Gefragt ist im Alltag „wann hat er zuletzt etwas von uns
-- gehört" — die erste von mehreren Sendungen zu konservieren beantwortete eine Frage, die niemand
-- stellt, und verschwiege die, die gestellt wird. Eine Versandhistorie ist ausdrücklich nicht Zweck
-- dieser Spalte; wer sie braucht, findet sie im Zustell-Ledger `platform.email_events` (B2-2).
--
-- NULLABLE, und `null` ist ein echter Zustand: „noch nie benachrichtigt". Er gilt für jeden vor
-- B16-4b angelegten Betrieb und für jede Genehmigung, deren Mailversand gescheitert ist.
alter table platform.partners
  add column notified_at timestamptz;

comment on column platform.partners.notified_at is
  'B16-4b: Zeitpunkt der ZULETZT ERFOLGREICH zugestellten Benachrichtigung über den Portalzugang '
  '(Genehmigungsmail bzw. erneuter Versand aus dem Admin-Bereich). NULL heisst „noch nie '
  'benachrichtigt" — der Zustand jedes vor B16-4b angelegten Betriebs und jeder Genehmigung, deren '
  'Mailversand fehlgeschlagen ist. Ohne diese Spalte liessen sich „wurde informiert und meldet sich '
  'nicht" und „hat nie eine Mail bekommen" nicht unterscheiden, obwohl sie gegensätzliches Handeln '
  'verlangen. Gesetzt AUSSCHLIESSLICH über public.admin_mark_partner_notified, und zwar erst NACH '
  'erfolgreicher Zustellung — ein Zeitstempel vor dem Versand behauptete eine Nachricht, die es '
  'nicht gibt. Ein erneuter Versand überschreibt den Wert; eine Versandhistorie ist nicht Zweck '
  'dieser Spalte (die steht in platform.email_events, B2-2).';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — public.get_my_partner: der Lesezugriff des eingeloggten Fachbetriebs
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Struktureller Zwilling von `public.get_my_entitlement` (T4-2): kein Parameter, keine Auswahl, keine
-- Möglichkeit, nach einer FREMDEN Zeile zu fragen. Die Bindung entsteht im Rumpf über `auth.uid()`;
-- ein Aufrufer kann sie nicht beeinflussen, weil es nichts zu übergeben gibt.
--
-- ── DIE RÜCKGABE IST DIE EIGENTLICHE ENTSCHEIDUNG: SLUG UND ANZEIGENAME, SONST NICHTS ───────────
-- Genau derselbe Umfang wie beim öffentlichen `get_active_partner` (B16-2) und aus derselben
-- Überlegung: Das Portal ist eine Server Component, und was eine Server Component liest, landet im
-- ausgelieferten HTML bzw. im Flight-Payload, sobald es durch eine Komponentengrenze wandert — auch
-- dann, wenn niemand es rendert. Hier kommt hinzu, dass die zurückgehaltenen Felder INTERNE Angaben
-- sind: `notified_at` ist ein Betriebsvermerk (wer davon erfährt, kann daran ablesen, wie unser
-- Prozess läuft), `application_id` und `user_id` sind Kennungen fremder Datensätze, und
-- `created_at`/`updated_at` sind für den Betrieb ohne Belang. Die Beschränkung steht deshalb in der
-- DATENBANK und nicht (nur) im TypeScript-Leser: eine Auswahlliste dort wäre eine Zusage, die der
-- nächste Umbau versehentlich zurücknimmt.
--
-- Ansprechperson, Lead-Zahlen und Kundenzahlen fahren ebenfalls NICHT mit — die Zahlen sind B16-5
-- und dort eine eigene Entscheidung, keine Nebenfolge dieses Wrappers.
--
-- ── EIN INAKTIVER PARTNER IST ÜBER DIESEN WRAPPER NICHT AUFFINDBAR ──────────────────────────────
-- `is_active` wird in der Bedingung geprüft, nicht zurückgegeben — wortgleich zu
-- `get_active_partner`. Damit kann das Portal den dritten Zustand („gibt es, ist aber stillgelegt")
-- gar nicht erst erfinden, und der eingeloggte Betrieb sieht dasselbe wie an seiner Landingpage, die
-- ab der Stilllegung 404 antwortet. Die Deaktivierung IST die Ansage; ein Portal, das danach
-- weiterhin einen Empfehlungslink zum Kopieren anbietet, wäre die schlechteste denkbare Auskunft —
-- der Link führt nachweislich ins Leere, und eine daraus entstandene Aussendung erzeugte Anfragen
-- ohne Zuordnung.
--
-- ── `{status: none}` STATT SQL-NULL ─────────────────────────────────────────────────────────────
-- Ein Konto ohne Partnerzeile ist der NORMALFALL (jeder Monitor- und Kalkulator-Kunde). Er ist kein
-- Fehler und darf im Anwendungscode nicht wie einer aussehen; dieselbe Konstruktion wie `not_found`
-- in `get_active_partner`. Der Wrapper unterscheidet dabei bewusst NICHT zwischen „kein Partner",
-- „stillgelegt" und „nicht angemeldet" (`auth.uid()` ist dann null und findet nichts) — alle drei
-- führen zum selben Zustand, und die Anmeldung entscheidet ohnehin die Route davor.
create function public.get_my_partner()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_partner record;
begin
  select p.slug, p.display_name
    into v_partner
  from platform.partners p
  where p.user_id = auth.uid()
    and p.is_active;

  if not found then
    return jsonb_build_object('status', 'none');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'slug', v_partner.slug,
    'display_name', v_partner.display_name
  );
end;
$$;

comment on function public.get_my_partner() is
  'B16-4b: die EIGENE Partnerzeile des angemeldeten Kontos — der einzige Lesezugriff der '
  'Partner-Zugriffsebene. KEIN Parameter (wie public.get_my_entitlement, T4-2): die Bindung entsteht '
  'im Rumpf über auth.uid(), es gibt nichts zu übergeben und damit keinen Weg, nach einer fremden '
  'Zeile zu fragen. Rückgabe AUSSCHLIESSLICH {status: ok, slug, display_name} bzw. {status: none} — '
  'notified_at, user_id, application_id, Ansprechperson und Zeitstempel fahren bewusst NICHT mit '
  '(was eine Server Component liest, kann im ausgelieferten HTML landen, auch wenn niemand es '
  'rendert; die Beschränkung gehört deshalb in die Datenbank und nicht in den TypeScript-Leser). Ein '
  'INAKTIVER Partner ist darüber nicht auffindbar und bekommt dieselbe Antwort wie ein Konto ohne '
  'Partnerzeile — dieselbe Lesart wie get_active_partner (B16-2) und capture_lead (B16-1): '
  'Stilllegung heisst, dass die Links dieses Betriebs nicht mehr wirken, und ein Portal, das danach '
  'weiterhin einen Empfehlungslink anböte, wäre die schlechteste denkbare Auskunft. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — public.admin_mark_partner_notified: den erfolgten Versand festhalten
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WARUM DAS EIN EIGENER AUFRUF IST UND NICHT IN DER GENEHMIGUNG STECKT ────────────────────────
-- Die Genehmigung (B16-4a) ist EINE Transaktion und darf nicht scheitern; der Mailversand geschieht
-- danach, ausserhalb der Datenbank, gegen einen fremden Dienst. Ein `notified_at`, das die
-- Genehmigung mitsetzte, behauptete eine Nachricht, bevor sie unterwegs ist — und stünde ausgerechnet
-- dann auf „benachrichtigt", wenn der Versand gleich darauf scheitert. Genau die Unterscheidung, für
-- die die Spalte existiert, wäre damit verloren.
--
-- Die Reihenfolge ist deshalb bindend und steht auch im Anwendungscode: ERST senden, DANN
-- festhalten. Bricht es dazwischen ab, bleibt `notified_at` leer — der Admin-Bereich zeigt „nicht
-- benachrichtigt", und ein erneuter Versand ist möglich. Die Fehlerrichtung ist bewusst gewählt: eine
-- zweite Mail ist ärgerlich, ein Fachbetrieb, der laut Anzeige informiert wurde und es nicht ist,
-- wartet auf etwas, das nie kommt.
--
-- ── ES GIBT KEINEN WEG, `notified_at` ZU LÖSCHEN ODER ZU SETZEN, WANN MAN WILL ──────────────────
-- Der Wrapper hat keinen Zeitstempel-Parameter (er nimmt `now()`) und kein Gegenstück zum Nullen.
-- Ein setzbarer Zeitpunkt wäre eine Angabe über eine Zustellung, die niemand geprüft hat; ein
-- Zurücksetzen wäre der Weg, auf dem ein misslungener Versand wie ein nie unternommener aussieht.
-- Dieselbe Haltung wie beim fehlenden Entsperr-Wrapper in B2-2: der Admin kann feststellen, nicht
-- umschreiben.
--
-- ── ⚠ OHNE VERKNÜPFTES KONTO WIRD ABGEWIESEN, UND DAS IST KEINE FORMALIE ────────────────────────
-- Die Mail verweist auf ein Portal, das eine Anmeldung verlangt. Ohne `user_id` gibt es diese
-- Anmeldung nicht — der Empfänger stünde vor einem Login, das er nicht bedienen kann, und
-- `notified_at` behauptete danach, er sei über seinen Zugang informiert worden. Der Admin-Bereich
-- sperrt die Sende-Aktion bereits sichtbar (`user_id is null` → kein Knopf); diese Prüfung ist die
-- Schicht darunter, die auch dann hält, wenn jemand die Aktion anders auslöst. Der Fall ist real:
-- von Hand angelegte Betriebe (Raymann) haben zunächst kein Konto, und ein gelöschtes Konto nullt
-- die Spalte (`on delete set null`, B16-4a).
create function public.admin_mark_partner_notified(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug    text := lower(nullif(btrim(p_slug), ''));
  v_partner platform.partners%rowtype;
  v_now     timestamptz := now();
begin
  if not platform.is_admin() then
    raise exception 'public.admin_mark_partner_notified: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if v_slug is null then
    return jsonb_build_object('status', 'missing_fields');
  end if;

  select * into v_partner
    from platform.partners p
   where p.slug = v_slug
   for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- ⚠ s. oben: ohne Konto gibt es keine Anmeldung, auf die die Mail verweisen könnte.
  if v_partner.user_id is null then
    return jsonb_build_object('status', 'no_account');
  end if;

  update platform.partners p
     set notified_at = v_now
   where p.slug = v_slug;

  return jsonb_build_object('status', 'ok', 'notified_at', v_now);
end;
$$;

comment on function public.admin_mark_partner_notified(text) is
  'B16-4b: hält fest, dass die Benachrichtigung über den Portalzugang ZUGESTELLT wurde — aufgerufen '
  'NACH erfolgreichem Versand (Genehmigung oder erneutes Senden im Admin-Bereich). Die Reihenfolge '
  'ist bindend: ein notified_at vor dem Versand behauptete eine Nachricht, die es noch nicht gibt, '
  'und stünde ausgerechnet dann auf „benachrichtigt", wenn der Versand gleich darauf scheitert. KEIN '
  'Zeitstempel-Parameter (der Wrapper nimmt now()) und KEIN Gegenstück zum Nullen — ein '
  'zurücksetzbarer Wert wäre der Weg, auf dem ein misslungener Versand wie ein nie unternommener '
  'aussieht. ⚠ Ohne verknüpftes Konto wird ABGEWIESEN (no_account): die Mail verweist auf ein '
  'Portal mit Anmeldung, und ohne user_id gibt es die nicht. Rückgabe {status: ok|not_found|'
  'missing_fields|no_account, notified_at}. WIRFT bei fehlender Adminrolle (42501) statt leer zu '
  'antworten. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — public.admin_list_partners nachgezogen (Signatur UNVERÄNDERT)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Per `create or replace` bei GLEICHER Signatur: die Parameterliste ändert sich nicht, es entsteht
-- keine zweite Überladung, und die Grants bleiben bestehen (ein DROP hätte sie entfernt — in B3-1
-- real passiert). Im DB-Gate wird das trotzdem nachgemessen, nicht vorausgesetzt.
--
-- `notified_at` wird ERGÄNZT und kommt nicht von selbst mit: die Unterabfrage führt weiterhin eine
-- EXPLIZITE Spaltenliste. Genau diese Eigenschaft hat oben (Arbeitsregel 1) verhindert, dass die neue
-- Spalte über `get_active_partner` auf eine öffentliche Landingpage gerät.
create or replace function public.admin_list_partners()
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
           pt.user_id,
           pt.application_id,
           pt.notified_at,
           (select au.email from auth.users au where au.id = pt.user_id) as account_email,
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
  'B16-1, erweitert in B16-4a und B16-4b: alle Fachbetriebe (nach Anzeigename sortiert) samt '
  'lead_count und customer_count, user_id, account_email, application_id sowie — neu — notified_at. '
  'Der lead_count zählt anonymisierte Leads AUSDRÜCKLICH MIT (dafür ist partner_slug aus '
  'platform.guard_anonymized_lead herausgehalten); customer_count steht daneben, weil „gebracht" und '
  '„geworden" verschiedene Zahlen sind. account_email steht neben user_id, weil eine UUID einem '
  'Menschen nicht sagt, WELCHES Konto verknüpft ist. notified_at unterscheidet „wurde informiert und '
  'meldet sich nicht" von „hat nie eine Mail bekommen" — ohne die Spalte sähen beide identisch aus '
  'und verlangen doch gegensätzliches Handeln. WIRFT bei fehlender Adminrolle (SQLSTATE 42501) statt '
  'eine leere Liste zu liefern. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — public.admin_get_partner_application nachgezogen (Signatur UNVERÄNDERT)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── ⚠ WARUM DIESER WRAPPER MITMUSS — EIN IM BAU GEMESSENER BEFUND ───────────────────────────────
-- Die Antrags-Detailseite zeigte bis B16-4a nach einer Genehmigung den Satz „Der Betrieb wurde NICHT
-- benachrichtigt". Er stimmt seit B16-4b nicht mehr, und der naheliegende Ersatz wäre die
-- Erfolgsmeldung der Genehmigungs-Action gewesen — die sagt ja, ob die Mail rausging.
--
-- Gemessen (Playwright gegen den Production-Build): DIESE MELDUNG IST NACH DEM KLICK NICHT MEHR DA.
-- Das Genehmigungsformular wird nur gerendert, solange der Antrag `pending` ist; mit dem Erfolg
-- wechselt der Status, das Formular verschwindet — und mit ihm sein `useActionState` samt Meldung.
-- Genau der Fehler, der in B1-3 schon einmal gefangen wurde („die Rückmeldung verschwand durch ihren
-- eigenen Erfolg"), hier mit einer teureren Folge: Ausgerechnet der Satz „ACHTUNG: Die
-- Benachrichtigung konnte NICHT versendet werden" wäre der, den niemand zu sehen bekommt.
--
-- Die Antwort darauf ist kein längeres Stehenlassen einer flüchtigen Meldung, sondern ein DAUERHAFT
-- lesbarer Zustand: `partner_notified_at` fährt am Antrag mit, und die Detailseite zeigt nach der
-- Genehmigung, ob und wann benachrichtigt wurde — auch beim nächsten Aufruf und für jeden anderen
-- Admin.
--
-- Der Wert wird über den entstandenen Fachbetrieb GELESEN, nicht am Antrag gespeichert: Es gibt ihn
-- genau einmal (auf `platform.partners`, s. Teil 1), und eine zweite Fassung liefe ab dem ersten
-- erneuten Versand auseinander.
--
-- `create or replace` bei GLEICHER Signatur — keine zweite Überladung, die Grants bleiben bestehen
-- (ein DROP hätte sie entfernt, in B3-1 real passiert). Im DB-Gate wird beides nachgemessen.
create or replace function public.admin_get_partner_application(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_get_partner_application: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select to_jsonb(r) into v_row
  from (
    select pa.id,
           pa.company,
           pa.first_name,
           pa.last_name,
           pa.email,
           pa.phone,
           pa.website,
           pa.message,
           pa.status,
           pa.created_at,
           pa.reviewed_at,
           pa.user_id,
           (select au.email from auth.users au where au.id = pa.user_id) as account_email,
           (select au.email from auth.users au where au.id = pa.reviewed_by) as reviewed_by_email,
           -- Der Fachbetrieb, der AUS DIESEM ANTRAG entstanden ist (B16-4a).
           (select p.slug from platform.partners p where p.application_id = pa.id) as partner_slug,
           -- Der Fachbetrieb, an dem das KONTO dieses Antrags bereits hängt (B16-4a). Beides kann
           -- gleichzeitig gesetzt und identisch sein — nach der Genehmigung ist es das immer.
           (select p.slug from platform.partners p where p.user_id = pa.user_id)
             as account_partner_slug,
           -- ⚠ B16-4b: OB und WANN der entstandene Fachbetrieb benachrichtigt wurde. NULL heisst
           -- „noch nie" — und genau dieser Fall ist der, den ein Admin sehen muss, wenn der
           -- Mailversand bei der Genehmigung gescheitert ist (s. Begründung im Kopf dieses Teils).
           (select p.notified_at from platform.partners p where p.application_id = pa.id)
             as partner_notified_at
    from platform.partner_applications pa
    where pa.id = p_id
  ) r;

  if v_row is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object('status', 'ok', 'application', v_row);
end;
$$;

comment on function public.admin_get_partner_application(uuid) is
  'B16-3, erweitert in B16-4a und B16-4b: ein Antrag mit ALLEN Feldern inklusive Freitext, dazu die '
  'Adresse des verknüpften Kontos (account_email) und die des Prüfers. Die Konto-Adresse steht NEBEN '
  'der Antrags-Adresse und wird nicht mit ihr verschmolzen: wer angemeldet einen Antrag stellt, kann '
  'eine abweichende Kontaktadresse angeben. partner_slug ist der Fachbetrieb, der AUS diesem Antrag '
  'entstanden ist (sonst endete ein genehmigter Antrag in einer Sackgasse), account_partner_slug der '
  'Fachbetrieb, an dem das KONTO dieses Antrags bereits hängt (damit die Oberfläche das VOR dem '
  'Bestätigen sagen kann statt erst über die Ablehnung account_taken). NEU: partner_notified_at — OB '
  'und WANN der entstandene Betrieb über seinen Portalzugang benachrichtigt wurde; GELESEN vom '
  'Partner, nicht am Antrag gespeichert (eine zweite Fassung liefe ab dem ersten erneuten Versand '
  'auseinander). Nötig, weil die Erfolgsmeldung der Genehmigung nach dem Klick nicht stehen bleibt '
  '(das Formular verschwindet mit dem Statuswechsel — gemessen); ein gescheiterter Mailversand wäre '
  'sonst nirgends auf dieser Seite sichtbar. WIRFT bei fehlender Adminrolle (42501); ein unbekannter '
  'Antrag ist ein fachlicher Zustand. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 6 — Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf NEUE public-Funktionen automatisch EXECUTE an
-- anon, authenticated UND service_role (zusätzlich zum PostgreSQL-Default-Grant an PUBLIC). Deshalb
-- wie überall: erst allen entziehen, dann gezielt gewähren.
--
-- Beide neuen Wrapper: NUR `authenticated`. `service_role` bekommt bewusst KEIN Grant — beide leiten
-- ihre Autorisierung aus `auth.uid()` bzw. `platform.is_admin()` ab, das dort NULL bzw. false ist;
-- sie wären funktionslos und stets abgelehnt (B2-1/B16-1/B16-3/B16-4a). Bei `get_my_partner` wiegt
-- das zusätzlich schwerer als anderswo: über `service_role` aufgerufen fände er per Konstruktion
-- nichts, und ein Aufrufer, der das als „kein Partner" liest, sperrte einen echten Fachbetrieb aus
-- seinem eigenen Portal aus.
--
-- Es entstehen KEINE neuen Tabellenrechte. `platform.partners` behält `select` für `service_role`
-- (B16-1) und sonst nichts; insbesondere gibt es weiterhin für NIEMANDEN ein `update`-Grant — die
-- neue Spalte ist ausschliesslich über den Wrapper oben erreichbar.
revoke all on function public.get_my_partner() from public, anon, authenticated, service_role;
revoke all on function public.admin_mark_partner_notified(text)
  from public, anon, authenticated, service_role;

grant execute on function public.get_my_partner() to authenticated;
grant execute on function public.admin_mark_partner_notified(text) to authenticated;
