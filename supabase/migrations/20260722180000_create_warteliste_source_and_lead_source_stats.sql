-- B3-4 — Warteliste als Einstiegspunkt und die Herkunftszählung im Admin-Bereich
-- (Fahrplan_2026.md, Abschnitt B3: „… als eigene Landingpage für den Postbrief-QR-Code").
--
-- Zwei kleine, voneinander unabhängige Dinge:
--   TEIL 1 — eine neue Zeile in platform.lead_sources ('warteliste'). Der zweite Einstiegspunkt
--            dieses Bauabschnitts ('wko-postaktion-qr') existiert seit B1-1 und wird jetzt
--            lediglich PLATZIERT — dafür ist keine Migration nötig.
--   TEIL 2 — public.admin_lead_source_stats: die kleinste Auswertung, die die Frage beantwortet,
--            ob die Postaktion Rücklauf erzeugt hat.
--
-- ── ES ENTSTEHT KEINE NEUE EINWILLIGUNGSART ─────────────────────────────────────────────────────
-- Die Warteliste ist fachlich `marketing_email` und wird über den `source_key` der Einwilligung
-- unterschieden — B1-1 hält den Herkunftskontext je Einwilligung genau dafür vor
-- (`platform.consents.source_key`, ein eigener Fremdschlüssel auf lead_sources, ausdrücklich NICHT
-- der des Leads).
--
-- Eine eigene Art (`platform.consent_purpose`-Wert) verhielte sich in JEDER Hinsicht identisch:
-- dieselbe Bestätigungspflicht (`purpose_requires_double_opt_in`), dieselbe Sperrprüfung
-- (`is_suppressed`), dieselbe Aktivierung. Sie hätte genau einen Effekt — sie zerlegte den Bestand
-- vor der 48-Stunden-Aktivierung in getrennte Listen, deren Vereinigung dann jede Aussendung
-- selbst wieder herstellen müsste. Das ist genau das, was der Fahrplan ausschliesst.
--
-- ── KONVENTIONEN (exakt B1-1/B1-2/B1-3/B3-1/B3-2/B4-1/B4-2) ─────────────────────────────────────
-- Alles Fachliche in `platform` (nicht über die REST-API exponiert), Zugriff von aussen
-- ausschliesslich über SECURITY-DEFINER-Wrapper im `public`-Schema, alle Funktionen mit
-- `SET search_path = ''` und vollqualifizierten Objektnamen, erst `revoke all … from public, anon,
-- authenticated, service_role`, dann gezielt grants. `anon` bekommt NIRGENDS etwas.
--
-- NICHT hier: der Betroffenheits-Check (B3-3, blockiert auf die Branchenkennzahlen), gefilterte
-- Sicht, Export, Massenaussendung und das kampagnenbezogene Zustellprotokoll (B2), Bearbeitbarkeit
-- der Stammdaten (B2), `tenant_id` (B13).

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — der Einstiegspunkt 'warteliste'
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Idempotent wie die Seeds aus B1-1 und B3-1. Steht in einer Migration und nicht im Seed, weil
-- `leads.first_source_key` ein Fremdschlüssel ist: ohne diese Zeile könnte die Landingpage gar
-- keinen Lead anlegen, und der Fehler fiele erst beim ersten echten Aufruf auf.
--
-- 'wko-postaktion-qr' steht NICHT noch einmal hier — die Zeile gibt es seit B1-1. Was B3-4 daran
-- ändert, ist ausschliesslich Anwendungscode (Registry-Eintrag + Route); die Datenbank kennt den
-- Unterschied zwischen „vorhanden" und „platziert" bewusst nicht.
insert into platform.lead_sources (key, label) values
  ('warteliste', 'Warteliste Leistungstarif 2027')
on conflict (key) do nothing;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — public.admin_lead_source_stats: Rücklauf je Herkunftsquelle
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WARUM ES DIESE FUNKTION GIBT ────────────────────────────────────────────────────────────────
-- B3-4 teilt einen Einstiegspunkt in ZWEI Routen (organisch und gedruckter QR-Code). Ohne eine
-- Auswertung, die beide Herkünfte nebeneinander zeigt, wäre diese Teilung folgenlos: die Leads
-- lägen unterscheidbar im Bestand, aber niemand könnte die Frage beantworten, für die sie getrennt
-- erfasst werden — hat der Brief Rücklauf erzeugt?
--
-- ── ABGRENZUNG ZU B2, ausdrücklich ──────────────────────────────────────────────────────────────
-- Das hier ist KEINE gefilterte Sicht und KEIN Export. Es gibt keine Parameter, keine Seiten, keine
-- Adressen: die Antwort enthält ausschliesslich Zahlen je Quelle. Segmentierung (nach Branche,
-- Netzebene, PLZ), Export und Massenaussendung bleiben B2 — und zwar deshalb, weil sie an einer
-- Zustell- und Sperrprüfungsschicht hängen, die es noch nicht gibt. Eine Zahl kann man ansehen;
-- eine Adressliste kann man versenden.
--
-- ── ZÄHLUNG IN SQL, NICHT IM ANWENDUNGSCODE ─────────────────────────────────────────────────────
-- Im Anwendungscode zu zählen hiesse, den Bestand dafür zu LADEN — also personenbezogene Daten aus
-- der Datenbank zu holen, um sie zu verwerfen. Ausserdem wäre die Zahl an das Seitenfenster der
-- Liste gebunden und damit still falsch, sobald der Bestand grösser als eine Seite ist.
--
-- ── DIE BEIDEN SPALTEN HABEN VERSCHIEDENE BEZUGSGRÖSSEN — Absicht, kein Versehen ────────────────
--   lead_count                : gezählt über `leads.first_source_key` — wo der Lead ins System kam.
--                               Die Spalte ist seit B1-1 unveränderlich (guard_lead_first_source),
--                               ein Lead wird also nie umgehängt.
--   confirmed_marketing_count : gezählt über `consents.source_key` — wo GENAU DIESE Einwilligung
--                               erteilt wurde.
--
-- Beide über `first_source_key` zu zählen wäre die naheliegende, aber falsche Vereinfachung: Wer
-- den Betrieb bereits über einen Artikel kennengelernt hat und Monate später den Brief bekommt und
-- den QR-Code scannt, behält `first_source_key = 'artikel-inline'` — die Reaktion auf den Brief
-- würde dem älteren Kanal gutgeschrieben und der Brief systematisch zu niedrig bewertet. Genau die
-- Frage, für die diese Auswertung existiert, wäre damit falsch beantwortet.
--
-- Folge, und sie steht auch in der Oberfläche: die beiden Spalten müssen sich NICHT zueinander
-- verhalten wie „davon" — eine Quelle kann mehr Einwilligungen als Leads tragen.
--
-- ── ANONYMISIERTE LEADS BLEIBEN ENTHALTEN ───────────────────────────────────────────────────────
-- Sie waren echter Rücklauf. Die Anonymisierung entfernt die Identitätsmerkmale (B1-3), die
-- HERKUNFT überlebt sie bewusst — sie ist kein Personenmerkmal. Sie herauszurechnen hiesse, dass
-- eine Kampagne im Nachhinein schlechter dasteht, weil ihre Leads ordnungsgemäss gelöscht wurden.
--
-- ── `status = 'confirmed'` UND NICHT DER ABGELEITETE ZUSTAND ────────────────────────────────────
-- `platform.consent_effective_status` (B1-3) unterscheidet sich vom gespeicherten Wert nur bei
-- `pending` (verfallener Token → 'expired'). Eine BESTÄTIGTE Einwilligung verfällt nicht. Der
-- direkte Vergleich ist hier also dieselbe Aussage, nur ohne Funktionsaufruf je Zeile.
create function public.admin_lead_source_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sources jsonb;
begin
  -- Muster wie B1-1/B1-3/B4-1: WERFEN statt einer leeren Antwort. „Kein Zugriff" darf sich nie als
  -- „keine Leads aus dieser Quelle" lesen lassen — hier besonders, weil eine Null die eigentliche
  -- Aussage dieser Auswertung ist („der Brief hat nichts gebracht").
  if not platform.is_admin() then
    raise exception 'public.admin_lead_source_stats: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.lead_count desc, s.key), '[]'::jsonb)
    into v_sources
  from (
    select ls.key,
           ls.label,
           ls.is_active,
           -- Jede Quelle erscheint, auch mit 0: „keine Reaktion" ist ein Ergebnis und darf nicht
           -- als fehlende Zeile aussehen. Deshalb die Unterabfragen statt eines Joins mit group by.
           (select count(*)
              from platform.leads l
             where l.first_source_key = ls.key) as lead_count,
           -- Der Zweck hängt am TEXT, nicht an der Einwilligungszeile (B1-1: `consents` trägt keine
           -- eigene `purpose`-Spalte — die Fassung, der zugestimmt wurde, IST der Zweck). Derselbe
           -- Join wie in `platform.has_confirmed_consent`.
           (select count(*)
              from platform.consents c
              join platform.consent_texts ct on ct.id = c.consent_text_id
             where c.source_key = ls.key
               and ct.purpose = 'marketing_email'
               and c.status = 'confirmed') as confirmed_marketing_count
    from platform.lead_sources ls
  ) s;

  return jsonb_build_object('status', 'ok', 'sources', v_sources);
end;
$$;

comment on function public.admin_lead_source_stats() is
  'B3-4: Anzahl Leads je Herkunftsquelle (über leads.first_source_key) und je Quelle die Zahl der '
  'BESTÄTIGTEN Marketing-Einwilligungen (über consents.source_key — wo die Einwilligung erteilt '
  'wurde, nicht wo der Lead herkam; sonst würde die Reaktion auf eine Kampagne einem älteren Kanal '
  'gutgeschrieben). Quellen ohne Leads erscheinen mit 0. Anonymisierte Leads bleiben enthalten: sie '
  'waren echter Rücklauf, und die Herkunft überlebt die Anonymisierung. KEINE gefilterte Sicht und '
  'KEIN Export (beides B2) — die Antwort enthält ausschliesslich Zahlen, keine Adressen. WIRFT bei '
  'fehlender Adminrolle (42501). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Supabases ALTER DEFAULT PRIVILEGES hat der neuen Funktion EXECUTE an anon, authenticated und
-- service_role gegeben (zusätzlich zum PostgreSQL-Default-Grant an PUBLIC). Erst allen entziehen,
-- dann gezielt gewähren — dieselbe Reihenfolge wie in allen vorangegangenen Migrationen.
--
-- KEIN Grant an service_role: die Auswertung ist eine Auskunft an einen MENSCHEN. Ein
-- Maschinenpfad, der Bestandszahlen je Kanal liest, existiert nicht und soll nicht auf Vorrat
-- entstehen.
revoke all on function public.admin_lead_source_stats()
  from public, anon, authenticated, service_role;
grant execute on function public.admin_lead_source_stats() to authenticated;
