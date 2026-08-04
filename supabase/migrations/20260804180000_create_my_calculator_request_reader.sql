-- B18-4 (Portal-Oberfläche): der Lesepfad „meine eigene letzte Kalkulator-Anfrage".
--
-- ── DIE LÜCKE, DIE HIER GESCHLOSSEN WIRD ────────────────────────────────────────────────────────
-- Der Schema-Schritt (20260804150000) hat den SCHREIBweg des Fachbetriebs gebaut
-- (`submit_calculator_request`) und den admin-weiten LESEweg (`admin_list_calculator_requests`) —
-- aber keinen, mit dem ein Betrieb seine EIGENE Anfrage nachsehen kann. Ohne ihn müsste die
-- Portalseite raten, ob bereits etwas läuft: Sie zeigte jedem, der noch keinen Zugang hat, ein
-- leeres Formular — auch dem, dessen Anfrage seit gestern offen ist. Der Betrieb erführe von seiner
-- eigenen laufenden Anfrage erst dadurch, dass ein zweites Absenden mit `already_pending`
-- scheitert. Eine Abweisung als einzige Auskunft über einen erfolgreichen eigenen Vorgang ist die
-- falsche Reihenfolge; und sie sähe aus wie ein Fehler.
--
-- Der Admin-Wrapper taugt dafür nicht und darf es nicht: Er WIRFT ohne Adminrolle (42501) und
-- lieferte, wäre er offen, den gesamten Prüf-Eingang — also die Anfragen fremder Fachbetriebe.
--
-- ── KEIN PARAMETER, wie `get_my_partner` (B16-4b) und `get_my_partner_leads` (B18-6) ────────────
-- Die Bindung entsteht im Rumpf über `auth.uid()`. Es gibt nichts zu übergeben und damit keinen Weg,
-- nach der Anfrage eines FREMDEN Betriebs zu fragen. Ausdrücklich NICHT über `platform.is_admin()`:
-- ein Partner ist kein Admin. Und ausdrücklich KEIN zweiter Weg an der Tabelle vorbei: auf
-- `platform.calculator_requests` hat weiterhin KEINE Rolle irgendein Tabellenrecht, es entsteht
-- weder Grant noch Policy.
--
-- ── DIE LETZTE, NICHT DIE OFFENE — und das ist eine Entscheidung ────────────────────────────────
-- Zurück kommt die ZULETZT ANGELEGTE Anfrage dieses Betriebs, unabhängig von ihrem Status. Der
-- naheliegende engere Entwurf („liefere die offene, sonst nichts") wäre billiger und falsch: Die
-- Oberfläche muss eine ABGELEHNTE Anfrage benennen können, bevor sie dem Betrieb erneut dasselbe
-- leere Formular hinstellt, als sei nie etwas passiert. Eine GENEHMIGTE zu liefern kostet nichts —
-- in dem Fall hat der Betrieb ohnehin den Zugang, und die Seite fragt gar nicht erst.
--
-- Ältere Anfragen fahren bewusst NICHT mit. Es gibt keine Frage im Portal, die eine Historie
-- beantwortet; und was ein Wrapper nicht herausgibt, kann keine Oberfläche versehentlich anzeigen.
-- Käme sie je (etwa als „Ihre bisherigen Anfragen"), ist das ein eigener Schritt mit eigener
-- Begründung — additiv, ohne diesen hier umzubauen.
--
-- ── WAS MITFÄHRT, UND WAS NICHT ─────────────────────────────────────────────────────────────────
-- `id`, `status`, `message`, `created_at`, `reviewed_at`. Der Betrieb sieht damit seinen eigenen
-- Text, seit wann er offen ist und wann entschieden wurde.
--
-- ⚠ `reviewed_by` fährt NICHT mit — weder als Kennung noch als Adresse. Wer intern entschieden hat,
-- ist eine Auskunft über UNSERE Organisation und beantwortet keine Frage, die ein Fachbetrieb über
-- sich selbst stellt (dieselbe Trennlinie wie bei `get_my_partner`, B18-3: was eine Server Component
-- liest, kann im ausgelieferten HTML landen, auch wenn niemand es rendert). Ebenso wenig
-- `notified_at`: das ist ein interner Betriebsvermerk über einen Mailversand, kein Zustand des
-- Vorgangs.
create function public.get_my_calculator_request()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- BARE auth.uid(), NICHT (select auth.uid()): das Subquery-Wrapping ist eine RLS-POLICY-
  -- Optimierung und löst im Funktionskörper einen Backend-Segfault aus, sobald auth.uid() NULL ist
  -- (s. T4-2-Migration). Gleiche Form wie get_my_partner/submit_calculator_request/is_admin.
  v_user    uuid := auth.uid();
  v_slug    text;
  v_request platform.calculator_requests%rowtype;
begin
  -- `is_active` steht in der BEDINGUNG, nicht in der Rückgabe — wortgleich zu `get_my_partner`
  -- (B16-4b), `get_my_partner_leads` (B18-6) und `submit_calculator_request`. `{status: none}` deckt
  -- deshalb dieselben drei Fälle in EINER Antwort ab: kein Partner, stillgelegt, nicht angemeldet.
  -- Die Anwendung kann den dritten Zustand („gibt es, ist aber stillgelegt") gar nicht erfinden.
  select p.slug
    into v_slug
  from platform.partners p
  where p.user_id = v_user
    and p.is_active;

  if not found then
    return jsonb_build_object('status', 'none');
  end if;

  select * into v_request
    from platform.calculator_requests cr
   where cr.partner_slug = v_slug
   order by cr.created_at desc
   limit 1;

  -- ⚠ „Es gibt keine" ist ein EIGENER Zustand und nicht `none`. `none` heisst „kein Partnerzugang";
  -- daraus folgt für die Oberfläche etwas völlig anderes (Erklärseite statt Formular). Beides in
  -- eine Antwort zu legen zwänge den Leser zu raten, welcher Fall vorliegt.
  if not found then
    return jsonb_build_object('status', 'ok', 'request', null);
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'request', jsonb_build_object(
      'id',          v_request.id,
      'status',      v_request.status,
      'message',     v_request.message,
      'created_at',  v_request.created_at,
      'reviewed_at', v_request.reviewed_at
    )
  );
end;
$$;

comment on function public.get_my_calculator_request() is
  'B18-4 (Portal): die EIGENE, zuletzt angelegte Kalkulator-Anfrage des angemeldeten Fachbetriebs. '
  'KEIN Parameter — wie public.get_my_partner (B16-4b), public.get_my_partner_leads (B18-6) und '
  'public.get_my_entitlement (T4-2) bindet der Rumpf über auth.uid(); es gibt nichts zu übergeben '
  'und damit keinen Weg, nach der Anfrage eines fremden Betriebs zu fragen. Ausdrücklich NICHT über '
  'platform.is_admin(): ein Partner ist kein Admin — und admin_list_calculator_requests taugt hier '
  'nicht, weil sie ohne Adminrolle wirft und sonst den gesamten Prüf-Eingang lieferte. Es entsteht '
  'weder Grant noch Policy auf platform.calculator_requests. Rückgabe {status: ok, request} bzw. '
  '{status: none} (kein Partner, STILLGELEGT oder nicht angemeldet — dieselbe Antwort für alle drei, '
  'wie get_my_partner). request ist null, wenn dieser Betrieb noch nie angefragt hat: ein EIGENER '
  'Zustand, ausdrücklich nicht none — daraus folgt für die Oberfläche etwas anderes (Formular statt '
  'Erklärseite). Geliefert wird die ZULETZT angelegte Anfrage unabhängig vom Status, nicht nur eine '
  'offene: die Oberfläche muss eine ABGELEHNTE benennen können, bevor sie erneut dasselbe leere '
  'Formular hinstellt. Ältere Anfragen fahren bewusst nicht mit (keine Historie im Portal). Felder: '
  'id, status, message, created_at, reviewed_at — reviewed_by fährt NICHT mit (wer intern entschied, '
  'ist eine Auskunft über unsere Organisation), notified_at ebenso wenig (interner Betriebsvermerk '
  'über einen Mailversand). authenticated-only, service_role bewusst ohne Grant.';

-- ── Rechte ───────────────────────────────────────────────────────────────────────────────────────
-- Supabase setzt ALTER DEFAULT PRIVILEGES für neue Funktionen; das pauschale REVOKE davor ist
-- deshalb keine Formalie, sondern die einzige Stelle, an der `anon` und `service_role` wirklich
-- ausgeschlossen werden. `service_role` bewusst OHNE Grant — wie get_my_partner und
-- get_my_partner_leads: die Bindung ist die SITZUNG, und ein service_role-Aufruf hätte keine
-- (auth.uid() wäre null, die Antwort immer {status: none}). Ein Grant, der nur eine nutzlose Antwort
-- liefern kann, ist eine Fläche ohne Gegenwert.
revoke all on function public.get_my_calculator_request() from public, anon, authenticated, service_role;
grant execute on function public.get_my_calculator_request() to authenticated;
