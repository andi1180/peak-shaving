-- B16-4a — Genehmigung eines Partner-Antrags: aus einer Bewerbung wird ein Fachbetrieb
-- (Fahrplan_2026.md, Abschnitt B16 — vierter Teil, erste Hälfte).
--
-- B16-1 hat die Stammdaten der Fachbetriebe angelegt, B16-2 den öffentlichen Rand, B16-3 den
-- Bewerbungsweg und seinen Prüf-Eingang. In B16-3 gab es bewusst KEINEN Weg zum Status 'approved':
-- Genehmigen heisst, einen Partner anzulegen, einen Slug zu vergeben und ein Konto zu verknüpfen —
-- ein Wrapper, der nur den Status gesetzt hätte, hinterliesse einen genehmigten Antrag OHNE Partner,
-- also einen stillen Zustand, der wie Erfolg aussieht. Diese Migration macht 'approved' erreichbar,
-- und zwar ausschliesslich zusammen mit dem Partner.
--
-- ── WAS HIER AUSDRÜCKLICH NICHT ENTSTEHT ────────────────────────────────────────────────────────
-- KEINE Genehmigungs-E-MAIL und KEIN Partner-Portal (B16-4b), keine E-Mail-Vorlagen und keine
-- Partner-Statistik (B16-5). Der genehmigte Betrieb ist danach angelegt und mit seinem Konto
-- verknüpft — benachrichtigt ist er NICHT. Das ist kein Versehen, sondern der Schnitt zwischen den
-- beiden Hälften; die Oberfläche sagt es nach jeder Genehmigung ausdrücklich, weil ein Admin den
-- Vorgang sonst für abgeschlossen hält und der Betrieb auf eine Mail wartet, die nicht kommt.
--
-- KEIN Typfeld am Konto, kein `tenant_id`, keine Partner-eigene Sicht auf Leads (unverändert B13/
-- B16-5/B16-6). Was ein Konto darf, ergibt sich weiterhin aus dem, was es HÄLT — ab jetzt zusätzlich
-- aus einer Zeile in `platform.partners`, die auf es zeigt.
--
-- KEIN LÖSCHWEG. Für `platform.partners` und `platform.partner_applications` gibt es weiterhin für
-- NIEMANDEN ein `delete`-Grant. Eine Genehmigung ist deshalb nicht zurücknehmbar, und der Slug ist
-- unwiderruflich (Trigger `guard_partner_slug`, B16-1) — beides steht in der Oberfläche im Klartext
-- VOR dem Bestätigen.
--
-- ── KONVENTIONEN (exakt T4-1/B1-1/B2-1/B14-1/B16-1/B16-3) ───────────────────────────────────────
-- Alles Fachliche in `platform` (nicht über die REST-API exponiert, `supabase/config.toml`), Zugriff
-- von aussen ausschliesslich über SECURITY-DEFINER-Wrapper im `public`-Schema, alle Funktionen mit
-- `SET search_path = ''` und vollqualifizierten Objektnamen, erst `revoke all … from public, anon,
-- authenticated, service_role`, dann gezielt grants. `anon` bekommt NIRGENDS etwas.
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ DER STOLPERDRAHT DIESES SCHRITTS — GEMESSEN, NICHT AUS DEM WÄCHTER-CODE ABGELEITET
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- `ON DELETE SET NULL` ist selbst ein UPDATE. In diesem Repo ist daran dreimal etwas hängen
-- geblieben (`leads.last_edited_by` B2-1, `email_events.lead_id` B2-2, `analyses.lead_id`/
-- `created_by` B14-1): ein Unveränderlichkeits-Trigger auf einer Tabelle mit einem solchen
-- Fremdschlüssel macht den referenzierten Datensatz UNLÖSCHBAR, wenn er die Ausnahme nicht kennt.
-- `platform.partners` trägt seit B16-1 den Trigger `guard_partner_slug`, und diese Migration hängt
-- genau so einen Fremdschlüssel an die Tabelle.
--
-- Gemessen wurde deshalb der Ernstfall in einer zurückgerollten Transaktion: Spalte `user_id`
-- angelegt, echtes `auth.users`-Konto eingefügt, Partner damit verknüpft, Konto GELÖSCHT.
--   (a) `update platform.partners set user_id = null`      → LÄUFT DURCH
--   (b) `delete from auth.users` (referentielles SET NULL)  → LÄUFT DURCH, `user_id` danach null,
--                                                             Slug unverändert
--   (c) Gegenprobe `update … set slug = 'anders'`           → BLOCKIERT (SQLSTATE P0001)
--
-- Ergebnis: Der Wächter vergleicht ausschliesslich `new.slug is distinct from old.slug` und ist
-- gegenüber jeder anderen Spalte gleichgültig. Eine asymmetrische Ausnahme wie in B2-1/B2-2/B14-1
-- wird hier deshalb NICHT gebaut — sie wäre toter Code, der eine Gefahr behauptet, die an dieser
-- Tabelle nicht besteht. Wer den Wächter später um weitere Spalten erweitert, muss die Ausnahme
-- dagegen mitbauen: `user_id` MUSS genullt werden können, sonst wird ein Konto unlöschbar,
-- ausgerechnet gegen ein Löschverlangen.
--
-- ── ZWEITER STOLPERDRAHT: FUNKTIONSRÜMPFE (Arbeitsregel 1) ──────────────────────────────────────
-- plpgsql prüft Funktionsrümpfe NICHT beim Anlegen. Vor dem Eingriff wurden deshalb alle Rümpfe in
-- `public` und `platform` per `pg_get_functiondef` nach `partners` und `partner_applications`
-- durchsucht (15 Treffer). Zwei sind für diese Migration entscheidend:
--   * `public.get_active_partner` (B16-2, service_role-only, der ÖFFENTLICHE Lesepfad) liest
--     `select p.slug, p.display_name` — eine EXPLIZITE Spaltenliste. Die zwei neuen Spalten können
--     darüber nicht nach aussen gelangen. Wäre dort `select *` oder `to_jsonb(p)` gestanden, hätte
--     diese Migration die Konto-Kennung eines Fachbetriebs auf eine öffentliche Landingpage
--     geschrieben, ohne dass jemand eine Zeile Anwendungscode angefasst hätte.
--   * `public.admin_list_partners` (B16-1) aggregiert `to_jsonb(p)` über eine Unterabfrage mit
--     EXPLIZITER Spaltenliste — die neuen Spalten erscheinen also NICHT von selbst. Sie werden unten
--     bewusst ergänzt, weil die Oberfläche sie braucht.
-- Es wird in dieser Migration keine Spalte umbenannt und keine gelöscht; die beiden Spalten kommen
-- additiv dazu.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — Zwei Verweise auf platform.partners
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ── user_id: das Konto, über das der Betrieb später sein Portal erreicht ─────────────────────────
-- NULLABLE, weil es Fachbetriebe gibt, die es geben MUSS, bevor es ihr Konto gibt: Raymann — der
-- erste reale Partner — wurde von Hand unter `/admin/partner` angelegt, lange bevor es einen
-- Bewerbungsweg gab. Ein NOT NULL machte genau diesen Weg unmöglich und zwänge dazu, für jeden
-- händisch aufgenommenen Betrieb erst ein Konto zu erfinden.
--
-- ⚠ UNIQUE — UND WARUM DIESE BEDINGUNG ABSEHBAR WIEDER FÄLLT.
-- Heute entspricht ein Konto genau einem Partner, und die Bedingung ist die einzige Stelle, die das
-- garantiert: ohne sie könnte dieselbe Anmeldung auf zwei Fachbetriebe zeigen, und spätestens das
-- Partner-Portal (B16-4b) müsste raten, welchen es anzeigt. MEHRERE LOGINS JE PARTNERBETRIEB
-- (Inhaber plus Büro, Monteur mit eigenem Zugang) sind aber absehbar und fachlich richtig. Der Weg
-- dorthin ist ADDITIV und ausdrücklich KEIN Umbau: eine Zwischentabelle
-- `platform.partner_members (partner_slug, user_id, role)` kommt dazu, die Zuordnung wandert
-- dorthin, und DIESE UNIQUE-BEDINGUNG WIRD ENTFERNT — die Spalte selbst kann als „Hauptkonto"
-- stehen bleiben oder ebenfalls wandern. Wer das baut, sucht diesen Absatz; er ist der Grund, warum
-- hier keine Zwischentabelle auf Vorrat steht (sie hätte heute genau eine Zeile je Partner und eine
-- Fragestellung, die noch niemand beantwortet hat: was darf ein Mitglied, was nur der Inhaber).
--
-- `on delete set null`, nicht `cascade` und nicht `restrict`: Löscht jemand sein Konto (DSGVO), darf
-- das weder den Fachbetrieb mitreissen (an ihm hängen die Zuordnungen aller von ihm gebrachten
-- Leads) noch die Löschung blockieren. Der Partner bleibt danach bestehen und ist schlicht wieder
-- unverknüpft — derselbe Zustand wie ein von Hand angelegter, und über
-- `public.admin_link_partner_account` (unten) wieder herstellbar. Dass der Wächter dem nicht im Weg
-- steht, ist oben gemessen.
alter table platform.partners
  add column user_id uuid unique references auth.users (id) on delete set null;

comment on column platform.partners.user_id is
  'B16-4a: das Auth-Konto des Fachbetriebs — der Zugang, über den er in B16-4b sein Portal erreicht. '
  'NULLABLE, weil ein von Hand angelegter Partner (Raymann) zunächst keins hat; über '
  'public.admin_link_partner_account nachträglich verknüpfbar. UNIQUE, weil heute ein Konto genau '
  'einem Partner entspricht — MEHRERE LOGINS JE BETRIEB sind absehbar und werden später ADDITIV über '
  'eine Zwischentabelle nachgerüstet; DANN IST DIESE UNIQUE-BEDINGUNG ZU ENTFERNEN, nicht die '
  'Struktur umzubauen. on delete set null: ein gelöschtes Konto darf weder den Partner mitreissen '
  'noch selbst unlöschbar werden (platform.guard_partner_slug steht dem nachweislich nicht im Weg — '
  'er vergleicht ausschliesslich den Slug).';

-- ── application_id: aus welchem Antrag ist dieser Fachbetrieb entstanden ─────────────────────────
-- Reiner Herkunftsnachweis. Von Hand angelegte Partner haben keinen — dieselbe Nullbarkeit und
-- derselbe Grund wie bei `user_id`.
--
-- `on delete restrict`, ANDERS als bei `user_id`, und das ist eine Entscheidung: Anträge werden
-- heute nie gelöscht (kein delete-Grant für irgendeine Rolle, und die Aufbewahrungsfrist ist eine
-- offene juristische Frage, DEPLOYMENT.md §7). Genau deshalb soll eine dennoch versuchte Löschung
-- LAUT scheitern, statt den Nachweis still zu verlieren — dieselbe Überlegung wie bei
-- `platform.leads.partner_slug` (B16-1). Ein `on delete set null` wäre hier doppelt falsch: es
-- löschte genau die Aussage, die überleben soll, und es wäre der vierte Fall der
-- SET-NULL-ist-ein-UPDATE-Familie an einer Tabelle, die ihn nicht braucht.
alter table platform.partners
  add column application_id uuid references platform.partner_applications (id) on delete restrict;

comment on column platform.partners.application_id is
  'B16-4a: der Antrag, aus dem dieser Fachbetrieb entstanden ist (Herkunftsnachweis). NULL bei von '
  'Hand angelegten Partnern — es gibt keinen Antrag, den man nachträglich erfinden könnte. '
  'on delete restrict (nicht set null): ein Antrag, aus dem ein Partner wurde, soll sich nicht still '
  'entfernen lassen; eine dennoch versuchte Löschung scheitert laut. Gesetzt wird die Spalte '
  'ausschliesslich von public.admin_approve_partner_application beim Anlegen; es gibt keinen Weg, '
  'sie nachträglich umzuhängen (kein Wrapper, kein Tabellenrecht).';

-- Ein Index auf der FK-Spalte: die Antrags-Detailseite fragt nach der Genehmigung „welcher Partner
-- ist hieraus entstanden", und ein fehlender Index auf einer FK-Spalte macht ausserdem eine
-- `restrict`-Prüfung zum Seq-Scan. Partiell, weil der Regelfall (von Hand angelegt) null ist.
create index partners_application_id_idx
  on platform.partners (application_id)
  where application_id is not null;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — public.admin_approve_partner_application: der Weg zu 'approved'
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── EINE FUNKTION, EINE TRANSAKTION — DAS IST DIE ATOMARITÄT ────────────────────────────────────
-- Partner anlegen, Konto und Antrag verknüpfen, Antrag auf 'approved' setzen und Prüfer/Zeitpunkt
-- festhalten passiert in EINEM Aufruf. Scheitert irgendetwas davon, wird der gesamte Aufruf
-- zurückgenommen — es kann keinen genehmigten Antrag ohne Partner geben und keinen Partner ohne
-- genehmigten Antrag. Zwei getrennte Wrapper (erst anlegen, dann Status setzen) hätten genau die
-- halben Zustände erzeugt, deren Vermeidung der ganze Grund war, in B16-3 auf 'approved' zu
-- verzichten. Deshalb steht das Anlegen des Partners auch VOR dem Status-Update: schlägt es fehl,
-- ist der Antrag nie angefasst worden.
--
-- ── FÜNF ABWEISUNGSGRÜNDE, JEDER MIT EIGENER, UNTERSCHEIDBARER URSACHE ──────────────────────────
-- Ein Sammelstatus („geht nicht") zwänge die Oberfläche zu raten, was zu tun ist — und die Antworten
-- sind vollkommen verschieden: einen anderen Slug wählen · gar nichts tun, weil schon entschieden ·
-- erst das Konto klären · den Antrag als Sonderfall behandeln.
--
--   already_reviewed  Der Antrag ist nicht mehr `pending`. Keine Zweitgenehmigung, kein zweiter
--                     Zeitstempel — die Prüfung ist eine einmalige Handlung (wie in
--                     admin_reject_partner_application, B16-3). Der aktuelle Status fährt mit,
--                     damit die Oberfläche „schon genehmigt" von „abgelehnt" unterscheiden kann.
--   no_account        ⚠ Der Antrag trägt KEINE Kontoverknüpfung. Siehe eigener Block unten — der
--                     wichtigste neue Grund dieses Wrappers.
--   account_taken     Das Konto des Antrags hängt bereits an einem anderen Fachbetrieb. Ohne diese
--                     Prüfung liefe der Aufruf in die UNIQUE-Bedingung und käme als 23505 zurück —
--                     ein Constraint-Text, der für die Person davor keine Auskunft ist, und vor
--                     allem ununterscheidbar von einem vergebenen Slug (der ebenfalls 23505 wäre).
--                     Der Slug des bestehenden Partners fährt mit: die Person will wissen, WELCHER.
--   duplicate_slug    Der Slug ist vergeben. Wird VORHER geprüft und als Status beantwortet, statt
--                     als 23505 durchzuschlagen — dieselbe Regel wie in admin_create_partner
--                     (B16-1). Der Antrag bleibt dabei unberührt `pending`.
--   invalid_slug      Der Slug verletzt `^[a-z0-9-]+$`. Der CHECK auf platform.partners.slug fängt
--                     ihn ohnehin (23514, in B10-5 real gemessen); hier steht die lesbare Fassung
--                     davor, damit die Oberfläche es sagen kann, bevor jemand einen unwiderruflichen
--                     Schlüssel vergibt.
--
-- ── ⚠ WARUM `no_account` EIN EIGENER GRUND IST UND NICHT WEGOPTIMIERT WERDEN DARF ───────────────
-- In Produktion real aufgetreten: `public.submit_partner_application` (B16-3) legt den Antrag auch
-- dann an, wenn die Kontoanlage scheitert — bewusst, denn eine verlorene Bewerbung wiegt schwerer
-- als eine fehlende Verknüpfung. Gemessen ist der Fall am Rate-Limit des Mailversands
-- (`429 over_email_send_rate_limit`, rund 33 Sekunden nach einem vorherigen Versuch derselben
-- Sitzung). Der Bewerber sieht trotzdem Erfolg; der Antrag existiert, ein Konto zu ihm nicht.
--
-- Ein solcher Antrag darf NICHT genehmigbar sein. Sonst entstünde ein Partner mit `user_id is null`
-- — und dieser Zustand ist ausdrücklich für von Hand aufgenommene Betriebe vorgesehen, nicht für
-- gescheiterte Bewerbungen: niemand könnte sich je in dieses Portal einloggen, der Antrag wäre
-- unwiderruflich als genehmigt abgelegt, und der Slug wäre verbraucht. Der eigentliche Defekt
-- gehört in `partner-werden` behoben (eigener Folgeauftrag); bis dahin ist diese Prüfung die Stelle,
-- an der er nicht weiterläuft. Der Ausweg für den Einzelfall ist offen und braucht keinen neuen
-- Weg: Das Konto lässt sich anlegen und der Antrag erneut stellen — oder der Betrieb wird von Hand
-- angelegt und sein Konto über `public.admin_link_partner_account` verknüpft.
--
-- ── DIE STAMMDATEN KOMMEN AUS DEM ANTRAG, NICHTS WIRD ERNEUT EINGETIPPT ─────────────────────────
-- `company` → `display_name`, `first_name`/`last_name` → `contact_first_name`/`contact_last_name`.
-- Das ist ALLES, was `platform.partners` halten kann — die Tabelle hat bewusst KEINE `contact_email`
-- und KEIN `contact_phone` (B16-1: „eine Spalte auf Vorrat wäre eine Angabe, von der niemand weiss,
-- ob sie gepflegt ist"). E-Mail, Telefon und Website des Antrags bleiben deshalb dort, wo sie
-- erhoben wurden, und sind über `application_id` jederzeit erreichbar. Sie hierher zu KOPIEREN wäre
-- eine zweite Fassung derselben Angabe, die ab dem ersten Korrekturformular auseinanderläuft — und
-- die Adresse gäbe es dann sogar dreifach (Antrag, Partner, Konto).
--
-- Der Slug ist der EINZIGE Wert, den der Admin beisteuert. Er lässt sich aus dem Firmennamen
-- vorschlagen (das macht die Oberfläche), aber nicht ableiten: er steht in Links, die ein Betrieb an
-- hunderte Bestandskunden verschickt, ist nach dem Anlegen unveränderlich, und „Elektro Müller
-- GmbH & Co KG" ergibt maschinell keinen Schlüssel, den jemand vorlesen möchte.
create function public.admin_approve_partner_application(p_id uuid, p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Kleingeschrieben angenommen, wie in admin_create_partner (B16-1): der CHECK verlangt
  -- Kleinschreibung, und „Raymann-Elektro" abzuweisen, statt daraus „raymann-elektro" zu machen,
  -- wäre eine Hürde ohne Ertrag — die Bedeutung ist eindeutig, es gibt keine zweite Lesart.
  v_slug        text := lower(nullif(btrim(p_slug), ''));
  v_application platform.partner_applications%rowtype;
  v_taken_by    text;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_approve_partner_application: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  -- Reine Eingabeprüfung zuerst: sie braucht keine Zeile und keinen Sperrvorgang.
  if v_slug is null then
    return jsonb_build_object('status', 'missing_fields');
  end if;

  if v_slug !~ '^[a-z0-9-]+$' then
    return jsonb_build_object('status', 'invalid_slug');
  end if;

  /*
   * `for update` wie in admin_reject_partner_application (B16-3): Zwei Personen können dieselbe
   * Liste offen haben. Ohne die Sperre könnten beide den Antrag als `pending` lesen und beide einen
   * Partner anlegen — der zweite scheiterte dann an der UNIQUE-Bedingung auf `user_id`, aber erst
   * als Constraint-Fehler und mit ungewisser Reihenfolge.
   */
  select * into v_application
    from platform.partner_applications pa
   where pa.id = p_id
   for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_application.status <> 'pending' then
    return jsonb_build_object(
      'status', 'already_reviewed',
      'current', v_application.status
    );
  end if;

  -- ⚠ Siehe den Block oben: ein Antrag ohne Konto ist nicht genehmigbar.
  if v_application.user_id is null then
    return jsonb_build_object('status', 'no_account');
  end if;

  select p.slug into v_taken_by
    from platform.partners p
   where p.user_id = v_application.user_id;

  if v_taken_by is not null then
    return jsonb_build_object('status', 'account_taken', 'partner_slug', v_taken_by);
  end if;

  if exists (select 1 from platform.partners p where p.slug = v_slug) then
    return jsonb_build_object('status', 'duplicate_slug');
  end if;

  /*
   * Erst der Partner, dann der Antrag. Beides in derselben Transaktion — scheitert das Anlegen aus
   * einem Grund, den die Prüfungen oben nicht kennen (ein später ergänzter CHECK, ein Trigger),
   * bleibt der Antrag unangetastet `pending` statt als genehmigt ohne Partner zurückzubleiben.
   */
  insert into platform.partners (
    slug, display_name, contact_first_name, contact_last_name, user_id, application_id
  )
  values (
    v_slug,
    v_application.company,
    v_application.first_name,
    v_application.last_name,
    v_application.user_id,
    v_application.id
  );

  update platform.partner_applications pa
     set status      = 'approved',
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where pa.id = p_id;

  /*
   * Der Rückgabewert trägt den Slug — nicht als Bestätigung der Eingabe, sondern weil die
   * Oberfläche danach auf den angelegten Fachbetrieb verweisen muss (und weil der Wrapper ihn
   * kleingeschrieben hat, der Aufrufer also nicht zwingend denselben String hält).
   */
  return jsonb_build_object('status', 'ok', 'slug', v_slug);
end;
$$;

comment on function public.admin_approve_partner_application(uuid, text) is
  'B16-4a: genehmigt eine Bewerbung und legt dabei in EINER Transaktion den Fachbetrieb an — '
  'Stammdaten AUS DEM ANTRAG (company → display_name, first_name/last_name → contact_*; E-Mail/'
  'Telefon/Website bleiben im Antrag, platform.partners hat dafür bewusst keine Spalten), '
  'user_id und application_id verknüpft, Antrag auf approved mit reviewed_by/reviewed_at. Der SLUG '
  'ist der einzige Wert, den der Admin beisteuert; er ist danach unveränderlich '
  '(platform.guard_partner_slug). ATOMAR: schlägt das Anlegen fehl, bleibt der Antrag pending — es '
  'gibt keinen genehmigten Antrag ohne Partner. Fünf unterscheidbare Ablehnungen: already_reviewed '
  '(keine Zweitgenehmigung, current fährt mit) · no_account (⚠ der Antrag trägt keine '
  'Kontoverknüpfung — real aufgetreten, wenn die Kontoanlage am Rate-Limit scheiterte; ein Partner '
  'ohne Konto käme nie ins Portal) · account_taken (das Konto hängt schon an einem Partner, dessen '
  'Slug mitfährt — sonst ununterscheidbar von duplicate_slug, weil beides als 23505 käme) · '
  'duplicate_slug · invalid_slug. Rückgabe {status: ok|not_found|missing_fields|invalid_slug|'
  'already_reviewed|no_account|account_taken|duplicate_slug, slug, current, partner_slug}. WIRFT bei '
  'fehlender Adminrolle (42501) statt leer zu antworten. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — public.admin_link_partner_account: ein Konto nachträglich verknüpfen
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WOFÜR ES DIESEN WEG ÜBERHAUPT GIBT ──────────────────────────────────────────────────────────
-- Raymann — der erste reale Partner — ist von Hand angelegt worden, bevor es einen Bewerbungsweg
-- gab. Ohne diesen Wrapper könnte genau dieser Betrieb das Portal aus B16-4b NIE benutzen: seine
-- Zeile hat keine `user_id`, und der einzige andere Weg, eine zu bekommen, führt über einen
-- genehmigten Antrag, den es für ihn nicht gibt und nicht mehr geben kann (der Slug ist vergeben,
-- eine zweite Zeile wäre ein zweiter Partner). Derselbe Weg heilt ausserdem den Fall, in dem ein
-- Betrieb sein Konto gelöscht und ein neues angelegt hat.
--
-- ── ÜBER DIE E-MAIL, NICHT ÜBER EINE KONTO-KENNUNG ──────────────────────────────────────────────
-- Ein Admin hat die Adresse (sie steht im Antrag, in der Korrespondenz, auf der Visitenkarte) — eine
-- UUID hat er nicht, und es gibt keine Liste, aus der er sie wählen könnte: `platform.profiles`
-- listet Konten nicht für den Admin-Bereich auf, und eine solche Liste anzulegen wäre ein
-- Verzeichnisdienst über alle Nutzer für eine Handlung, die zweimal im Jahr vorkommt. Dieselbe
-- Überlegung und dieselbe Auflösung wie in `public.admin_grant_role_by_email` (T4-4), inklusive der
-- beiden Sonderfälle:
--   user_not_found   Es gibt kein Konto zu dieser Adresse. Das ist kein Fehler des Admins, sondern
--                    die Auskunft, dass der Betrieb sich zuerst registrieren muss.
--   ambiguous_email  MEHRERE Konten zur Adresse. `auth.users` erzwingt Eindeutigkeit nur partiell
--                    (`users_email_partial_key`: UNIQUE (email) WHERE is_sso_user = false, im
--                    DB-Gate real gemessen). Auf den ersten aufzulösen hiesse, ein zufällig
--                    ausgewähltes FREMDES Konto auf einen Fachbetrieb zu schalten — der teuerste
--                    denkbare Fehler dieses Wrappers. Hier wird deshalb ABGEWIESEN, anders als in
--                    `submit_partner_application` (B16-3), wo eine Bewerbung auf dem Spiel steht und
--                    unverknüpft angenommen wird.
--
-- ── ⚠ EINE BESTEHENDE ZUORDNUNG WIRD NICHT ÜBERSCHRIEBEN ────────────────────────────────────────
-- Zwei getrennte Ablehnungen, und beide sind Absicht:
--   already_linked  Der PARTNER hat bereits ein Konto. Ein stilles Überschreiben nähme dem
--                   bisherigen Konto den Zugang zu seinem eigenen Betrieb, ohne dass es irgendwo
--                   auffiele — und es gäbe keinen Weg zurück, weil niemand mehr wüsste, welches
--                   Konto es war. Der Wrapper ist damit ausdrücklich KEIN Upsert (dieselbe
--                   Entscheidung wie bei `admin_create_partner`, B16-1). Wer wirklich umhängen
--                   will, tut das bewusst in der Datenbank; ein Formular dafür ist eine Fähigkeit,
--                   die niemand angefordert hat und die im Alltag nur versehentlich benutzt würde.
--   account_taken   Das KONTO hängt schon an einem anderen Partner. Ohne diese Prüfung liefe der
--                   Aufruf in die UNIQUE-Bedingung (23505) — richtig abgewiesen, aber ohne Auskunft
--                   darüber, an welchem. Der Slug fährt deshalb mit.
--
-- Es gibt bewusst KEIN Gegenstück zum Lösen einer Verknüpfung. Der einzige vorgesehene Weg dorthin
-- ist die Löschung des Kontos selbst (`on delete set null`) — also die Handlung der Person, der das
-- Konto gehört, nicht die eines Admins. Dieselbe Haltung wie beim fehlenden Entsperr-Wrapper in
-- B2-2: der Admin kann zuordnen, nicht wegnehmen.
create function public.admin_link_partner_account(p_slug text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug      text := lower(nullif(btrim(p_slug), ''));
  v_email     text := lower(nullif(btrim(p_email), ''));
  v_partner   platform.partners%rowtype;
  v_matches   integer;
  v_user_id   uuid;
  v_taken_by  text;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_link_partner_account: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if v_slug is null or v_email is null then
    return jsonb_build_object('status', 'missing_fields');
  end if;

  select * into v_partner
    from platform.partners p
   where p.slug = v_slug
   for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  /*
   * Die Prüfung auf eine bestehende Zuordnung steht VOR der E-Mail-Auflösung. Sonst bekäme jemand,
   * der eine unbekannte Adresse an einen bereits verknüpften Partner schickt, `user_not_found` zu
   * lesen — und hielte die Adresse für das Problem, obwohl der Vorgang ohnehin nicht stattfindet.
   */
  if v_partner.user_id is not null then
    return jsonb_build_object(
      'status', 'already_linked',
      'current_email', (select au.email from auth.users au where au.id = v_partner.user_id)
    );
  end if;

  select count(*) into v_matches from auth.users au where lower(au.email) = v_email;

  if v_matches = 0 then
    return jsonb_build_object('status', 'user_not_found');
  end if;

  if v_matches > 1 then
    return jsonb_build_object('status', 'ambiguous_email');
  end if;

  select au.id into v_user_id from auth.users au where lower(au.email) = v_email;

  select p.slug into v_taken_by
    from platform.partners p
   where p.user_id = v_user_id;

  if v_taken_by is not null then
    return jsonb_build_object('status', 'account_taken', 'partner_slug', v_taken_by);
  end if;

  update platform.partners p
     set user_id = v_user_id
   where p.slug = v_slug;

  return jsonb_build_object('status', 'ok', 'slug', v_slug, 'user_id', v_user_id);
end;
$$;

comment on function public.admin_link_partner_account(text, text) is
  'B16-4a: verknüpft ein BESTEHENDES Auth-Konto über seine E-Mail-Adresse mit einem von Hand '
  'angelegten Fachbetrieb — ohne diesen Weg könnte Raymann (der erste reale, von Hand aufgenommene '
  'Partner) das Portal aus B16-4b nie benutzen. Auflösung über die Adresse wie in '
  'public.admin_grant_role_by_email (T4-4): case-insensitiv, Mehrfachtreffer werden als '
  'ambiguous_email ABGEWIESEN statt auf den ersten aufgelöst (auth.users erzwingt Eindeutigkeit nur '
  'partiell — ein zufällig gewähltes fremdes Konto auf einen Fachbetrieb zu schalten wäre der '
  'teuerste Fehler dieses Wrappers). ⚠ KEIN Upsert: eine bestehende Zuordnung wird NICHT '
  'überschrieben (already_linked, die aktuelle Adresse fährt mit), und ein bereits vergebenes Konto '
  'wird abgewiesen (account_taken mit dem Slug des anderen Partners) statt als 23505 aufzuschlagen. '
  'Es gibt bewusst KEIN Gegenstück zum Lösen einer Verknüpfung — der einzige Weg dorthin ist die '
  'Löschung des Kontos durch die Person selbst (on delete set null). Rückgabe {status: ok|not_found|'
  'missing_fields|already_linked|user_not_found|ambiguous_email|account_taken, slug, user_id, '
  'current_email, partner_slug}. WIRFT bei fehlender Adminrolle (42501). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — Zwei bestehende Wrapper nachgezogen (Signaturen UNVERÄNDERT)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Beide per `create or replace` bei GLEICHER Signatur: die Parameterliste ändert sich nicht, es
-- entsteht keine zweite Überladung, und die Grants bleiben bestehen (ein DROP hätte sie entfernt —
-- in B3-1 real passiert). Sie werden im DB-Gate trotzdem nachgemessen, nicht vorausgesetzt.

-- ── admin_list_partners: die Kontoverknüpfung wird sichtbar ─────────────────────────────────────
-- Ohne diese drei Felder könnte die Partnerliste nicht zeigen, welcher Betrieb schon ein Konto hat —
-- und genau das ist die Frage, die das neue Verknüpfungsformular beantwortet. `account_email` steht
-- dabei NEBEN der Kennung: eine UUID sagt einem Menschen nichts, und der Admin soll sehen, WELCHES
-- Konto verknüpft ist, bevor er sich über ein `already_linked` wundert.
--
-- Die Unterabfrage führt weiterhin eine EXPLIZITE Spaltenliste (kein `select *`): dass eine künftige
-- Spalte hier nicht von selbst mitfährt, ist die Eigenschaft, die oben verhindert hat, dass die
-- neuen Spalten über `get_active_partner` nach aussen gelangen.
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
  'B16-1, erweitert in B16-4a: alle Fachbetriebe (nach Anzeigename sortiert) samt lead_count und '
  'customer_count sowie — neu — user_id, account_email und application_id. Der lead_count zählt '
  'anonymisierte Leads AUSDRÜCKLICH MIT (dafür ist partner_slug aus platform.guard_anonymized_lead '
  'herausgehalten); customer_count steht daneben, weil „gebracht" und „geworden" verschiedene Zahlen '
  'sind. account_email steht neben user_id, weil eine UUID einem Menschen nicht sagt, WELCHES Konto '
  'verknüpft ist. WIRFT bei fehlender Adminrolle (SQLSTATE 42501) statt eine leere Liste zu liefern. '
  'authenticated-only.';

-- ── admin_get_partner_application: zwei Fragen, die vor und nach der Genehmigung zählen ─────────
-- `account_partner_slug` beantwortet VOR dem Klick, ob das Konto des Antrags schon an einem anderen
-- Fachbetrieb hängt — sonst erführe man das erst durch die Ablehnung `account_taken`, nachdem man
-- bereits einen Slug ausgewählt und bestätigt hat. `partner_slug` beantwortet DANACH, welcher
-- Betrieb aus diesem Antrag entstanden ist; ohne dieses Feld endete ein genehmigter Antrag in einer
-- Sackgasse, weil die Gegenrichtung des Fremdschlüssels sonst nirgends gelesen wird.
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
             as account_partner_slug
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
  'B16-3, erweitert in B16-4a: ein Antrag mit ALLEN Feldern inklusive Freitext, dazu die Adresse des '
  'verknüpften Kontos (account_email) und die des Prüfers. Die Konto-Adresse steht NEBEN der '
  'Antrags-Adresse und wird nicht mit ihr verschmolzen: wer angemeldet einen Antrag stellt, kann eine '
  'abweichende Kontaktadresse angeben. NEU: partner_slug (der Fachbetrieb, der AUS diesem Antrag '
  'entstanden ist — sonst endete ein genehmigter Antrag in einer Sackgasse) und account_partner_slug '
  '(der Fachbetrieb, an dem das KONTO dieses Antrags bereits hängt — damit die Oberfläche das VOR '
  'dem Bestätigen sagen kann statt erst über die Ablehnung account_taken). WIRFT bei fehlender '
  'Adminrolle (42501); ein unbekannter Antrag ist ein fachlicher Zustand. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf NEUE public-Funktionen automatisch EXECUTE an
-- anon, authenticated UND service_role (zusätzlich zum PostgreSQL-Default-Grant an PUBLIC). Deshalb
-- wie überall: erst allen entziehen, dann gezielt gewähren.
--
-- Beide neuen Wrapper: NUR `authenticated`. `service_role` bekommt bewusst KEIN Grant — sie leiten
-- ihre Autorisierung aus `auth.uid()` ab, das dort NULL ist; sie wären funktionslos und stets
-- abgelehnt (B2-1/B16-1/B16-3). Bei der Genehmigung wiegt das zusätzlich schwerer als anderswo:
-- `reviewed_by` bliebe strukturell leer, und die Zuschreibung einer unumkehrbaren Handlung ist der
-- halbe Zweck des Protokolls (dieselbe Überlegung wie bei `created_by` in B14-1).
--
-- Es entstehen KEINE neuen Tabellenrechte. `platform.partners` behält `select` für `service_role`
-- (B16-1), `platform.partner_applications` bleibt für JEDE Rolle ohne jedes Recht (B16-3) — auch für
-- die Genehmigung, die ausschliesslich in diesen SECURITY-DEFINER-Funktionen läuft.
revoke all on function public.admin_approve_partner_application(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_link_partner_account(text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_approve_partner_application(uuid, text) to authenticated;
grant execute on function public.admin_link_partner_account(text, text) to authenticated;
