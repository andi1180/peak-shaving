-- B18-6 (Schema+Schreibweg), TEIL 2 VON 2 — Textstand und der Lesezugriff des Fachbetriebs.
--
-- ⚠ HINWEIS ZUR ABLAGE DER ENTSCHEIDUNGEN: `Fahrplan_2026.md` führt die Bauabschnitte B0–B17 und
-- kennt B18 (noch) NICHT — hier steht deshalb bewusst KEIN Verweis auf einen Abschnitt, den es dort
-- nicht gibt. Maßgeblich für den Stand der B18-Reihe ist der Handover in `apps/web/CLAUDE.md`.
--
-- ── WARUM ZWEI DATEIEN ──────────────────────────────────────────────────────────────────────────
-- Der Enum-Wert 'partner_lead_disclosure' entsteht in `20260804090000_partner_lead_disclosure_purpose.sql`
-- und wird HIER zum ersten Mal benutzt. Beides in einer Datei scheitert mit 55P04
-- („unsafe use of new value"), weil die Supabase-CLI jede Migrationsdatei in einer Transaktion
-- anwendet — gemessen, s. den Kopf von Teil 1.
--
-- ── WAS HIER ENTSTEHT ───────────────────────────────────────────────────────────────────────────
--   TEIL 1  der Wortlaut (ARBEITSSTAND) in `platform.consent_texts`
--   TEIL 2  `public.get_my_partner_leads()` — der ZWEITE Lesezugriff der Partner-Zugriffsebene
--
-- ── ⚠ DIE EIGENTLICHE NEUERUNG: EIN ANGEMELDETES KONTO LIEST `platform.leads` ───────────────────
-- Bis hierher hatte `platform.leads` weder für `anon` noch für `authenticated` ein Grant oder eine
-- Policy — begründet in B1-1: Ein Lead ist ein BETRIEBSdatum, kein Kontodatum; die Person dahinter
-- hat in aller Regel gar kein Konto, es gibt keine „eigene Zeile". Gelesen wurde bisher
-- ausschliesslich über die `admin_*`-Wrapper (Adminprüfung) und über `service_role`.
--
-- Diese Migration ändert daran NICHTS an der Tabelle selbst: Es entsteht KEIN Grant, KEINE Policy
-- und KEIN zweiter Lesepfad. Was entsteht, ist EIN SECURITY-DEFINER-Wrapper, dessen Auswahl doppelt
-- gebunden ist — an `auth.uid()` (welcher Fachbetrieb) und an eine BESTÄTIGTE Einwilligung (welche
-- Zeile darf einen Namen tragen). Die Bindung läuft ausdrücklich NICHT über `platform.is_admin()`:
-- Ein Partner ist kein Admin, und ihn als einen zu behandeln wäre der Anfang einer zweiten
-- Adminfläche, die niemand als solche liest.
--
-- ── KONVENTIONEN (exakt T4-1/B1-1/B14-1/B16-1/B16-4b) ───────────────────────────────────────────
-- Alles Fachliche in `platform` (nicht über die REST-API exponiert, `supabase/config.toml`), Zugriff
-- von aussen ausschliesslich über SECURITY-DEFINER-Wrapper im `public`-Schema, alle Funktionen mit
-- `SET search_path = ''` und vollqualifizierten Objektnamen, erst `revoke all … from public, anon,
-- authenticated, service_role`, dann gezielt grants. `anon` bekommt NIRGENDS etwas.
--
-- ── ARBEITSREGEL 1 (Funktionsrümpfe) — ABGEARBEITET, OBWOHL NICHTS GELÖSCHT WIRD ────────────────
-- Es wird keine Spalte umbenannt und keine gelöscht; es kommt nicht einmal eine dazu. Die Regel
-- greift trotzdem in ihrer Umkehrung: Ein neuer ENUM-WERT darf nirgends still eine bestehende
-- Auswertung verändern. Alle Rümpfe, die `platform.consent_purpose` lesen, wurden per
-- `pg_get_functiondef` durchgesehen. Drei sind einschlägig, keiner ändert sein Verhalten:
--   * `platform.purpose_requires_double_opt_in` zählt zwei Werte AUF; der neue fällt auf `false`
--     (fachlich richtig, s. Teil 1).
--   * `platform.clear_contract_data_on_withdrawal` (B3-1) prüft auf 'contract_expiry_reminder' und
--     ist unberührt.
--   * `platform.leads_matching` (B2-1) nimmt den Zweck als FILTER-Parameter entgegen; ein neuer Wert
--     ist dort ein zusätzlicher zulässiger Filter, keine Verhaltensänderung.
-- Kein Rumpf verzweigt erschöpfend über alle Enum-Werte (kein `case` ohne `else`).
--
-- ── ARBEITSREGEL 5 (kein Direktaufruf ohne Grant) ───────────────────────────────────────────────
-- Gilt für das Gate zu dieser Migration: Die fehlende Aufrufbarkeit für `anon` wird mit
-- `has_function_privilege` geprüft, NICHT durch einen Aufruf — ein solcher Aufruf hat im CI-Lauf von
-- B16-4a den Postgres-Prozess mit Signal 11 beendet.
--
-- ── WAS AUSDRÜCKLICH NICHT ENTSTEHT ─────────────────────────────────────────────────────────────
-- Keine Portalseite und kein Reiter (eigener, späterer Schritt). KEINE Änderung an
-- `public.capture_lead` (die zweite Einwilligung ist ein zweiter AUFRUF von aussen — das etablierte
-- Muster seit B3-2), an `public.get_my_partner`, an `platform.anonymize_lead`,
-- `guard_anonymized_lead`, `guard_partner_slug` oder an irgendeinem `admin_*`-Wrapper (B18-5 ist ein
-- eigener Schritt). Kein Widerrufs-Wrapper für den Partner-Zweck: Ein Widerruf läuft über die
-- bestehenden Wege (`admin_withdraw_consent`, Abmeldepfad) und wirkt hier sofort, weil die
-- Sichtbarkeit bei JEDEM Aufruf frisch aus `has_confirmed_consent` kommt und nirgends
-- zwischengespeichert wird. Kein `tenant_id`, kein Partner-Grant auf `platform.leads`.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — der Wortlaut (⚠ ARBEITSSTAND)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── ⚠ ARBEITSSTAND, WIE DIE ÜBRIGEN OFFENEN TEXTBLÖCKE DIESES BAUABSCHNITTS ─────────────────────
-- Die rechtliche PRÜFUNG (Martin) ist erfolgt und hat den Zweck freigegeben; der endgültige WORTLAUT
-- kommt von Andreas/Martina/Martin. Was hier steht, ist die sinngemässe Fassung aus
-- `B18_Partner-Portal_Ausbau.md`, ausformuliert.
--
-- EINE KORREKTUR IST VERSION 2, NIE EIN UPDATE DIESER ZEILE. `platform.consent_texts` ist append-only
-- (Trigger `reject_consent_text_mutation`, B1-1) — ein Nachweis, dessen Wortlaut nachträglich
-- änderbar ist, ist kein Nachweis. Bestehende Einwilligungen zeigen per FK weiterhin auf genau die
-- Fassung, die der Person angezeigt wurde. Der Anwendungscode liest immer die JÜNGSTE Fassung
-- (`public.get_active_consent_text`); ein Nachtragen ist deshalb ein reines INSERT ohne Codeänderung.
--
-- ── DER TEXT NENNT DEN FACHBETRIEB NICHT BEIM NAMEN — UND DAS IST EINE ENTSCHEIDUNG ─────────────
-- Die Vorlage im Konzept lautet „… meine Anfrage an [Partnername] rückmeldet". Ein eingesetzter Name
-- verlangte einen Platzhalter, den die Seite zur Laufzeit ersetzt — und damit wären ANGEZEIGTER und
-- ARCHIVIERTER Wortlaut nicht mehr derselbe String. Genau das ist die Regel, auf der der gesamte
-- Einwilligungsnachweis steht (B1-1): Man kann keine Zustimmung zu einem Text belegen, den die
-- Person nie gesehen hat. Ein Platzhaltermechanismus existiert heute nicht, und ihn als Nebenfolge
-- dieses Schritts einzuführen wäre die falsche Reihenfolge.
--
-- Der Name geht dadurch nicht verloren: Die Landingpage nennt den Fachbetrieb in der Überschrift, im
-- Fliesstext und in den nächsten Schritten — die Formulierung „der Fachbetrieb, über den ich hierher
-- gefunden habe" ist dort eindeutig. Und wer die Zuordnung später belegen muss, findet sie in
-- `platform.leads.partner_slug` an genau demselben Lead.
--
-- ⚠ WER DEN WORTLAUT NACHTRÄGT, PRÜFT ZWEI DINGE MIT:
--   (a) Die aufgezählten Datenarten müssen zu dem passen, was `get_my_partner_leads` unten
--       tatsächlich herausgibt (Firma, Name, E-Mail, Telefon). Ein Text, der weniger nennt, als der
--       Wrapper liefert, macht die Einwilligung für den Rest unwirksam; ein Text, der mehr nennt,
--       verspricht eine Weitergabe, die nicht stattfindet.
--   (b) Er darf keinen Versand versprechen. Aus dieser Einwilligung geht an den Interessenten
--       KEINE Mail — sie steuert ausschliesslich die Sichtbarkeit im Portal.
insert into platform.consent_texts (purpose, version, locale, body) values
  (
    'partner_lead_disclosure', 1, 'de',
    'Ich bin einverstanden, dass die COOLiN ENERGY GmbH meine Anfrage an den Fachbetrieb weitergibt, '
    'über den ich hierher gefunden habe — mit Firma, Name, E-Mail-Adresse und Telefonnummer, damit '
    'er mich zur Umsetzung kontaktieren kann. Diese Einwilligung kann ich jederzeit per Nachricht an '
    'energy@coolin.at widerrufen.'
  )
on conflict (purpose, version, locale) do nothing;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — public.get_my_partner_leads: die eigenen Anfragen, mit Namen nur bei Zusage
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── KEIN PARAMETER, GENAU WIE `get_my_partner` (B16-4b) UND `get_my_entitlement` (T4-2) ─────────
-- Die Bindung entsteht im Rumpf über `auth.uid()`. Es gibt nichts zu übergeben und damit keinen Weg,
-- nach den Anfragen eines FREMDEN Fachbetriebs zu fragen. Ein Slug-Parameter wäre genau dieser Weg —
-- und er brächte keinen Nutzen, weil ein Konto ohnehin höchstens einer Partnerzeile gehört
-- (UNIQUE auf `platform.partners.user_id`, B16-4a).
--
-- ── EIN INAKTIVER PARTNER SIEHT NICHTS, UND ZWAR MIT DERSELBEN ANTWORT WIE „KEIN PARTNER" ───────
-- `is_active` steht in der BEDINGUNG, nicht in der Rückgabe — wortgleich zu `get_my_partner`
-- (B16-4b), `get_active_partner` (B16-2) und `capture_lead` (B16-1). Die Deaktivierung IST die
-- Ansage; ein Portal, das danach weiterhin fremde Kontaktdaten anzeigte, wäre die schlechteste
-- denkbare Auskunft. Die Anwendung kann den dritten Zustand („gibt es, ist aber stillgelegt") gar
-- nicht erst erfinden. `{status: none}` deckt deshalb wie dort drei Fälle in einer Antwort ab: kein
-- Partner, stillgelegt, nicht angemeldet.
--
-- ── DIE ZWEI ZAHLEN SIND DER GANZE PUNKT: „ZÄHLT MIT, ABER OHNE NAMEN" ──────────────────────────
--   `total` = ALLE zugeordneten, nicht anonymisierten Anfragen — unabhängig von der Einwilligung.
--   `leads` = NUR die mit BESTÄTIGTER Einwilligung, mit Feldern.
-- Eine Anfrage ohne Zusage taucht damit in KEINER Zeile auf, sondern ausschliesslich in der Differenz
-- `total − array_length(leads)`. Das ist bewusst so und nicht als anonymisierte Platzhalterzeile
-- gebaut: Eine Zeile mit leeren Feldern trüge trotzdem ihren Zeitpunkt, und ein Zeitpunkt neben einer
-- verschickten Empfehlung ist für den Absender dieser Empfehlung oft schon die Zuordnung. Was der
-- Wrapper nicht herausgibt, kann die Oberfläche nicht versehentlich anzeigen.
--
-- ── DIE PRÜFUNG IST `platform.has_confirmed_consent`, UND ZWAR AUSSCHLIESSLICH ──────────────────
-- Keine zweite Prüfung daneben, kein `exists (select … from platform.consents …)` im Rumpf. Die
-- Funktion (B1-1) ist die EINE Stelle, die „bestätigt" definiert: ausdrücklich `false` bei `pending`
-- (unbestätigt = rechtlich wertlos), bei `withdrawn` und bei `expired`. Eine zweite Auslegung hier
-- liefe genau dann auseinander, wenn es darauf ankommt — bei einem Widerruf.
--
-- Ein Widerruf wirkt dadurch SOFORT und ohne weiteres Zutun: Die Sichtbarkeit wird bei jedem Aufruf
-- neu entschieden und nirgends zwischengespeichert. Deshalb gibt es hier auch kein Feld, das den
-- Einwilligungsstand ausweist — der Partner soll nicht erfahren, dass jemand widerrufen hat, sondern
-- die Zeile einfach nicht mehr namentlich sehen.
--
-- ── DIE FELDAUSWAHL IST DER RÜCKRUF, NICHT DER AKTENAUSZUG ─────────────────────────────────────
-- Ausgeliefert werden `company`, `first_name`, `last_name`, `email`, `phone`, `created_at` und `id`.
-- Der Massstab ist die eine Handlung, die der Fachbetrieb ausführen soll: sich melden. Ausdrücklich
-- NICHT dabei — jedes Feld mit eigenem Grund:
--
--   `status` — der LEBENSZYKLUS bei COOLiN (`new` → `contacted` → `customer`). Er ist ein interner
--     Arbeitsstand und beantwortet keine Frage des Fachbetriebs; er beantwortet sie sogar falsch,
--     denn `customer` sagt nichts über eine Montagezuteilung. Ein Betrieb, der ihn sieht, liest
--     daraus einen Anspruch, den diese Sicht nicht vergibt.
--   `retention_basis`, `deletion_due_at`, `anonymized_at`, `anonymized_by`, `anonymized_by_system` —
--     Verwaltung unserer Aufbewahrungspflichten. Sie gehen den Empfänger der Daten nichts an.
--   `first_source_key`, `referred_by_text`, `partner_slug` — Herkunft und Zuordnung. Sie sind über
--     die Auswahl bereits beantwortet (es sind seine eigenen), und `referred_by_text` ist der
--     Freitext eines Dritten über einen Betrieb.
--   Die Segmentierungsmerkmale (Branche, PLZ, Jahresverbrauch, Messart, Versorger, Vertragsende) —
--     sie sind das ERGEBNIS unserer Erhebung, nicht Voraussetzung eines Rückrufs. Sie mitzugeben
--     wäre eine Weitergabe, die der Einwilligungstext nicht nennt (s. TEIL 1, Prüfpunkt (a)).
--   Der Einwilligungsstand selbst — s. o.
--
-- `id` fährt mit, obwohl es eine interne Kennung ist: Eine Liste ohne stabilen Schlüssel zwänge die
-- Oberfläche, einen aus der E-Mail-Adresse zu bilden — Personenbezug in DOM-Attributen. Die Kennung
-- öffnet nichts: Es gibt keinen Wrapper, der von einem Partner eine Lead-ID entgegennimmt.
--
-- ── ANONYMISIERTE ANFRAGEN SIND WEDER IN DER LISTE NOCH IN DER ZAHL ────────────────────────────
-- `anonymized_at is null` in BEIDEN Abfragen. Ein anonymisierter Lead (B4-1, nach 24 bzw. 84 Monaten)
-- hat für den Fachbetrieb keine Aussage mehr — er ist kein Kontakt, den man noch anrufen könnte, und
-- als blosse Zahl wäre er eine Erinnerung an eine Anfrage, deren Person es im Bestand nicht mehr gibt.
-- Auf `status = 'anonymized'` wird bewusst NICHT zusätzlich geprüft: `platform.anonymize_lead` setzt
-- beides in derselben Anweisung, und `guard_anonymized_lead` friert die Zeile danach ein — es gibt
-- keinen Weg zu einem der beiden ohne das andere. Eine zweite Bedingung stellte die Frage, wann sie
-- auseinanderfallen, und die Antwort wäre „gar nicht".
--
-- ⚠ ZU BEACHTEN: `partner_slug` ÜBERLEBT die Anonymisierung ausdrücklich (B16-1, damit die
-- Partner-Statistik die 24-Monats-Frist überdauert). Die Ausblendung hier ist also eine Entscheidung
-- DIESES Wrappers und keine Folge des Schemas — wer die Bedingung entfernt, bekommt anonymisierte
-- Zeilen mitgezählt, ohne dass irgendetwas bricht.
--
-- ── KEINE SEITENWEISE AUSLIEFERUNG, UND KEINE STILLE OBERGRENZE ────────────────────────────────
-- Kein `limit`, kein `offset` — konsequent daraus, dass der Wrapper keinen Parameter hat. Eine feste
-- Obergrenze ohne Weiterblättern wäre eine stille Kürzung: Die Liste sähe vollständig aus und wäre es
-- nicht. Sortiert wird neueste zuerst. Sollte ein Fachbetrieb je so viele Anfragen haben, dass das
-- nicht mehr trägt, ist die Antwort Seitenweise-Auslieferung mit Parametern — dann bewusst und mit
-- der `auth.uid()`-Bindung im Rumpf, nicht als nachgeschobene Kappung.
create function public.get_my_partner_leads()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slug  text;
  v_total integer;
  v_leads jsonb;
begin
  select p.slug
    into v_slug
  from platform.partners p
  where p.user_id = auth.uid()
    and p.is_active;

  if not found then
    return jsonb_build_object('status', 'none');
  end if;

  -- Die Gesamtzahl: unabhängig von der Einwilligung. Sie ist die einzige Spur einer Anfrage ohne
  -- Zusage — und sie darf deshalb NICHT dieselbe Bedingung tragen wie die Liste darunter.
  select count(*)::integer
    into v_total
  from platform.leads l
  where l.partner_slug = v_slug
    and l.anonymized_at is null;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id',         l.id,
               'company',    l.company,
               'first_name', l.first_name,
               'last_name',  l.last_name,
               'email',      l.email,
               'phone',      l.phone,
               'created_at', l.created_at
             ) order by l.created_at desc
           ),
           '[]'::jsonb
         )
    into v_leads
  from platform.leads l
  where l.partner_slug = v_slug
    and l.anonymized_at is null
    and platform.has_confirmed_consent(l.id, 'partner_lead_disclosure');

  return jsonb_build_object(
    'status', 'ok',
    'total',  v_total,
    'leads',  v_leads
  );
end;
$$;

comment on function public.get_my_partner_leads() is
  'B18-6: die eigenen zugeordneten Anfragen des angemeldeten Fachbetriebs — der ZWEITE Lesezugriff '
  'der Partner-Zugriffsebene und der erste Weg überhaupt, auf dem ein authenticated-Konto Daten aus '
  'platform.leads sieht (die Tabelle hat weiterhin für anon und authenticated weder Grant noch '
  'Policy; die Bindung entsteht im Wrapper, nicht in der Tabelle). KEIN Parameter — wie '
  'public.get_my_partner (B16-4b) und public.get_my_entitlement (T4-2) bindet der Rumpf über '
  'auth.uid(); es gibt nichts zu übergeben und damit keinen Weg, nach fremden Anfragen zu fragen. '
  'Ausdrücklich NICHT über platform.is_admin(): ein Partner ist kein Admin. Rückgabe {status: ok, '
  'total, leads} bzw. {status: none} (kein Partner, STILLGELEGT oder nicht angemeldet — dieselbe '
  'Antwort für alle drei, wie get_my_partner). total zählt ALLE zugeordneten, nicht anonymisierten '
  'Anfragen; leads enthält NUR die mit BESTÄTIGTER Einwilligung partner_lead_disclosure, geprüft '
  'AUSSCHLIESSLICH über platform.has_confirmed_consent (keine zweite Auslegung von „bestätigt" — '
  'ein Widerruf wirkt dadurch sofort, weil die Sichtbarkeit bei jedem Aufruf neu entschieden und '
  'nirgends zwischengespeichert wird). Eine Anfrage ohne Zusage erscheint deshalb NUR in der '
  'Differenz — es gibt bewusst keine namenlose Platzhalterzeile, weil schon ihr Zeitpunkt neben '
  'einer verschickten Empfehlung die Zuordnung verraten kann. Felder: id, company, first_name, '
  'last_name, email, phone, created_at — der Massstab ist der RÜCKRUF, nicht der Aktenauszug; '
  'status (interner Lebenszyklus), Aufbewahrungsfelder, Herkunft/Zuordnung und die '
  'Segmentierungsmerkmale fahren bewusst nicht mit. Anonymisierte Leads sind aus BEIDEN Abfragen '
  'ausgeschlossen (partner_slug überlebt die Anonymisierung seit B16-1 — die Ausblendung ist also '
  'eine Entscheidung dieses Wrappers, keine Folge des Schemas). Keine Seitenweise-Auslieferung und '
  'keine stille Obergrenze. authenticated-only, anon bekommt nichts.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Rechtefläche
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- `service_role` bekommt BEWUSST kein Grant — genau wie bei `get_my_partner` (B16-4b). Über
-- `service_role` ist `auth.uid()` null, der Wrapper fände also ohnehin nichts; ein Grant wäre eine
-- Einladung, ihn irgendwann mit einem Slug-Parameter „nutzbar" zu machen und damit die einzige
-- Bindung zu entfernen, die diese Sicht sicher macht.
revoke all on function public.get_my_partner_leads() from public, anon, authenticated, service_role;
grant execute on function public.get_my_partner_leads() to authenticated;
