-- B18-3 (Schema+Schreibweg) — public.get_my_partner liefert zusätzlich Ansprechperson und Beitritt
-- (Fahrplan_2026.md, Abschnitt B18 — dritter Teil, Datenbankhälfte).
--
-- ── WAS SICH ÄNDERT, IN EINEM SATZ ──────────────────────────────────────────────────────────────
-- Die Rückgabe wächst ADDITIV um `contact_first_name`, `contact_last_name` und `created_at`. Sonst
-- nichts: kein Parameter, keine neue Spalte, keine geänderte Bedingung, kein geändertes
-- `{status: none}`-Verhalten, keine geänderte Rechtefläche.
--
-- `create or replace` bei UNVERÄNDERTER Signatur. Damit bleiben die B16-4b-Grants bestehen (ein
-- DROP hätte sie entfernt — in B3-1 real passiert); nachgemessen werden sie im DB-Gate trotzdem,
-- statt vorausgesetzt zu werden.
--
-- ── WARUM DIE FELDER BISHER FEHLTEN — UND WARUM DAS KEINE SICHERHEITSENTSCHEIDUNG WAR ───────────
-- B16-4b hat die Rückgabe auf Slug und Anzeigename beschränkt und dafür zwei Gründe genannt, die
-- sauber auseinanderzuhalten sind:
--
--   (a) `notified_at` ist ein BETRIEBSVERMERK (wer davon erfährt, kann daran ablesen, wie unser
--       Prozess läuft), `user_id` und `application_id` sind Kennungen FREMDER Datensätze. Das ist
--       eine Sicherheitsentscheidung, und sie gilt unverändert weiter.
--
--   (b) Ansprechperson und Zeitstempel waren „keine Nebenfolge DIESES Wrappers" — sie waren für den
--       damals EINZIGEN Verbraucher (die Anzeige des Empfehlungslinks auf der Marketing-Seite)
--       schlicht nicht nötig. Das ist Wrapper-Minimalismus, keine Zurückhaltung GEGENÜBER diesen
--       Feldern: Der Partner sieht ausschliesslich seine EIGENE Zeile, und die eigene Ansprechperson
--       ist genau die Angabe, die er im Portal auf Richtigkeit prüfen können soll.
--
-- Mit der „Allgemein"-Seite (B18-3-Oberfläche, eigener späterer Schritt) entsteht der zweite, echte
-- Verbraucher. Damit fällt Grund (b) weg — und ausschliesslich der.
--
-- ── WAS AUSDRÜCKLICH WEITER NICHT MITFÄHRT ──────────────────────────────────────────────────────
-- `notified_at`, `user_id`, `application_id` aus Grund (a). Dazu zwei Felder, die nie zur Debatte
-- standen und deren Fehlen trotzdem eine Entscheidung ist:
--   `is_active` wird weiterhin in der BEDINGUNG geprüft und NICHT zurückgegeben (B16-4b). Ein
--   inaktiver Partner ist über diesen Wrapper nicht auffindbar und bekommt dieselbe Antwort wie ein
--   Konto ohne Partnerzeile; die Anwendung kann den dritten Zustand („gibt es, ist aber
--   stillgelegt") deshalb gar nicht erst erfinden.
--   `updated_at` ist ein Wartungsvermerk. Er beantwortet keine Frage, die ein Fachbetrieb über sich
--   selbst stellt — anders als `created_at`, das sagt, seit wann er Partner ist.
--
-- ── DER MASSSTAB BLEIBT DERSELBE ────────────────────────────────────────────────────────────────
-- Was eine Server Component liest, kann im ausgelieferten HTML bzw. im Flight-Payload landen, auch
-- wenn niemand es rendert. Die drei neuen Felder bestehen diese Prüfung, weil sie dem angemeldeten
-- Konto selbst gehören; `notified_at` besteht sie nicht. Die Beschränkung steht deshalb weiterhin in
-- der DATENBANK und nicht (nur) im TypeScript-Leser: Eine Auswahlliste dort wäre eine Zusage, die
-- der nächste Umbau versehentlich zurücknimmt.
--
-- ── NULL BLEIBT NULL ────────────────────────────────────────────────────────────────────────────
-- `contact_first_name` und `contact_last_name` sind seit B16-1 nullable, und ein von Hand
-- aufgenommener Betrieb ohne hinterlegte Ansprechperson ist der reale Normalfall. `jsonb_build_object`
-- liefert dafür JSON-`null` — ausdrücklich KEINEN Leerstring und ausdrücklich kein Weglassen des
-- Schlüssels: „keine Ansprechperson hinterlegt" und „heisst zufällig nichts" sind verschiedene
-- Aussagen, und der Leser muss sie unterscheiden können, ohne raten zu müssen.
--
-- ── AUSDRÜCKLICH NICHT ANGEFASST ────────────────────────────────────────────────────────────────
-- `public.get_active_partner` (B16-2, der ÖFFENTLICHE Lesepfad): andere Funktion, andere
-- Berechtigung, andere Frage. Dort sitzt kein angemeldetes Konto davor, sondern eine Landingpage,
-- die jeder aufrufen kann — seine explizite Spaltenliste bleibt, wie sie ist.
-- `public.admin_list_partners` (B16-1/B16-4a/B16-4b): führt diese Felder für Admins längst.
-- `platform.partners`: KEINE neue Spalte — beide Namensfelder und `created_at` existieren seit
-- B16-1. `guard_partner_slug`, `public.admin_mark_partner_notified` und sämtliche Grants und
-- Tabellenrechte: unverändert.
--
-- ── VORHER GEPRÜFT (Arbeitsregel 1 sinngemäss) ──────────────────────────────────────────────────
-- Hier wird nichts umbenannt oder entfernt, aber die Rückgabe WÄCHST — dieselbe Kategorie Risiko
-- wie eine neue Spalte, die ungewollt nach aussen gelangt. Deshalb vorab alle Aufrufer erhoben:
-- `pg_get_functiondef` über `public` und `platform` (und `pg_views`/`pg_constraint`) nennt
-- AUSSCHLIESSLICH die Funktion selbst — es gibt keinen zweiten Rumpf, der sie aufruft und dessen
-- Rückgabe still mitwüchse. Im Anwendungscode gibt es genau EINEN Aufrufer
-- (`apps/web/components/partner-portal/partner-portal-route.tsx`), und die Marketing-Seite dahinter
-- liest die neuen Felder bewusst NICHT.

create or replace function public.get_my_partner()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_partner record;
begin
  select p.slug, p.display_name, p.contact_first_name, p.contact_last_name, p.created_at
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
    'display_name', v_partner.display_name,
    'contact_first_name', v_partner.contact_first_name,
    'contact_last_name', v_partner.contact_last_name,
    'created_at', v_partner.created_at
  );
end;
$$;

-- Der Kommentar behauptete wörtlich „Rückgabe AUSSCHLIESSLICH {status: ok, slug, display_name}" und
-- führte Ansprechperson und Zeitstempel in derselben Aufzählung wie notified_at/user_id/
-- application_id. Beides stimmt ab hier nicht mehr — und ein Funktionskommentar, der eine engere
-- Zusage macht als die Funktion, ist schlimmer als keiner: Er ist genau das, was jemand liest, statt
-- den Rumpf zu prüfen.
comment on function public.get_my_partner() is
  'B16-4b/B18-3: die EIGENE Partnerzeile des angemeldeten Kontos — der einzige Lesezugriff der '
  'Partner-Zugriffsebene. KEIN Parameter (wie public.get_my_entitlement, T4-2): die Bindung entsteht '
  'im Rumpf über auth.uid(), es gibt nichts zu übergeben und damit keinen Weg, nach einer fremden '
  'Zeile zu fragen. Rückgabe {status: ok, slug, display_name, contact_first_name, contact_last_name, '
  'created_at} bzw. {status: none}; die beiden Namensfelder sind nullable und kommen dann als '
  'JSON-null, nicht als Leerstring. notified_at, user_id und application_id fahren weiterhin '
  'ausdrücklich NICHT mit (Betriebsvermerk bzw. Kennungen fremder Datensätze — was eine Server '
  'Component liest, kann im ausgelieferten HTML landen, auch wenn niemand es rendert; die '
  'Beschränkung gehört deshalb in die Datenbank und nicht in den TypeScript-Leser). is_active wird '
  'geprüft, nicht zurückgegeben: ein INAKTIVER Partner ist darüber nicht auffindbar und bekommt '
  'dieselbe Antwort wie ein Konto ohne Partnerzeile — dieselbe Lesart wie get_active_partner (B16-2) '
  'und capture_lead (B16-1): Stilllegung heisst, dass die Links dieses Betriebs nicht mehr wirken, '
  'und ein Portal, das danach weiterhin einen Empfehlungslink anböte, wäre die schlechteste denkbare '
  'Auskunft. authenticated-only (Grants unverändert seit B16-4b — create or replace bei gleicher '
  'Signatur fasst sie nicht an).';
