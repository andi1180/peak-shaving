-- B16-2 — der öffentliche Rand der Partner-Attribution: eine Herkunft und EIN enger Lesezugriff
-- (Fahrplan_2026.md, Abschnitt B16 — zweiter von sechs Teilen).
--
-- B16-1 hat Stammdaten, Zuordnung, Trigger und die vier Admin-Wrapper angelegt. Was dort bewusst
-- fehlte, ist alles, was NACH AUSSEN zeigt: die Landingpage `/partner/<slug>`, die daraus
-- entstehende Lead-Erfassung und das Admin-Formular, das einen Fachbetrieb überhaupt erst anlegt.
-- Diese Migration liefert die zwei Datenbank-Voraussetzungen dafür und sonst NICHTS.
--
-- ── WAS HIER AUSDRÜCKLICH NICHT PASSIERT ────────────────────────────────────────────────────────
-- Keine Änderung an `public.capture_lead`, `platform.anonymize_lead` oder `guard_anonymized_lead` —
-- die sind seit B16-1 fertig und richtig, insbesondere die Regel „ein unbekannter oder INAKTIVER
-- Slug wird in capture_lead VERWORFEN, der Lead entsteht trotzdem" (ein Link mit Tippfehler darf
-- keinen Lead kosten). Keine neue Spalte, kein neuer `consent_purpose` (die Rechtsgrundlage einer
-- über einen Partnerlink entstandenen Anfrage ist dieselbe wie beim Kontaktformular:
-- Vertragsanbahnung), kein `tenant_id`, kein Partner-Login (B13/B16-4).

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — Die Herkunft der Partner-Landingpage
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WARUM EINE EIGENE HERKUNFT UND NICHT 'kontaktformular' ──────────────────────────────────────
-- Die Landingpage trägt dasselbe Formularmodul wie `/kontakt` (B16-2 extrahiert es, statt es zu
-- kopieren). Sie unter derselben Herkunft zu führen, wäre trotzdem falsch: `first_source_key` ist
-- seit B1-1 unveränderlich und die Grundlage jeder Kanal-Auswertung. Die Frage „hat die
-- Partner-Aussendung Anfragen erzeugt?" wäre dann unbeantwortbar, ohne dass es jemandem auffiele —
-- der Lead wäre ja da. Dasselbe Argument, mit dem B10-5 zwei getrennte Registrierungs-Herkünfte
-- angelegt hat.
--
-- ── DIE HERKUNFT IST NICHT DIE ATTRIBUTION ──────────────────────────────────────────────────────
-- `first_source_key = 'partner-empfehlung'` sagt „kam über eine Partner-Landingpage".
-- `partner_slug` sagt, über WELCHEN Fachbetrieb. Beide werden gebraucht: die Herkunft überlebt eine
-- verworfene Zuordnung (unbekannter/inaktiver Slug, s. capture_lead), und die Zuordnung überlebt die
-- Anonymisierung, während der Rest des Leads verschwindet (B16-1).
--
-- ── SCHREIBWEISE: BINDESTRICH ───────────────────────────────────────────────────────────────────
-- `platform.lead_sources.key` trägt seit B1-1 den CHECK `^[a-z0-9-]+$`. In B10-5 ist ein
-- Unterstrich real mit SQLSTATE 23514 abgewiesen worden — die Schreibweise ist hier keine Vorliebe,
-- sondern die geltende Regel dieser Tabelle. (Es ist derselbe Format-CHECK, den B16-1 bewusst
-- wortgleich für `platform.partners.slug` übernommen hat.)
--
-- Idempotent wie alle Herkunfts-Seeds seit B1-1.
insert into platform.lead_sources (key, label) values
  ('partner-empfehlung', 'Partner-Empfehlung (Landingpage)')
on conflict (key) do nothing;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — public.get_active_partner: der EINZIGE Lesezugriff nach aussen
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Die Landingpage muss zwei Dinge wissen: GIBT es diesen Fachbetrieb (und ist er aktiv), und wie
-- heisst er. Mehr darf sie nicht erfahren — und mehr kann sie über diesen Wrapper auch nicht.
--
-- ── DIE RÜCKGABE IST DIE EIGENTLICHE ENTSCHEIDUNG: SLUG UND ANZEIGENAME, SONST NICHTS ───────────
-- `platform.partners` trägt zusätzlich `contact_first_name`/`contact_last_name` (die Ansprechperson
-- beim Fachbetrieb), `is_active`, `created_at` und `updated_at`. Nichts davon fährt mit. Der Grund
-- ist nicht Sparsamkeit um ihrer selbst willen: Die Landingpage ist eine Server Component, und was
-- eine Server Component liest, landet im ausgelieferten HTML bzw. im Flight-Payload, sobald es durch
-- eine Komponentengrenze wandert — auch dann, wenn niemand es rendert. Ein `select *` wäre damit
-- keine „unbenutzte Spalte", sondern der Name einer realen Person auf einer öffentlichen Seite.
--
-- Die Beschränkung steht deshalb HIER und nicht (nur) im Anwendungscode: eine Auswahlliste im
-- TypeScript-Leser wäre eine Zusage, die der nächste Umbau versehentlich zurücknimmt. Der Wrapper
-- kann den Kontaktnamen gar nicht erst herausgeben.
--
-- ── UND DESHALB BEKOMMT `anon` AUCH HIER NICHTS ─────────────────────────────────────────────────
-- Die Aufgabenstellung liess die Wahl zwischen einem engen `anon`-Wrapper und dem bestehenden
-- Muster „service_role aus dem Server-Kontext" (`app/api/kontakt/route.ts`, `lib/leads/store.ts`).
-- Gewählt ist das bestehende Muster, aus drei Gründen:
--   1. Die Seite wird ohnehin serverseitig gerendert; ein Browser-Grant brächte keinen Aufruf, den
--      es sonst nicht gäbe — nur eine zusätzliche, von aussen erreichbare Fläche.
--   2. `anon` hat in `platform` bis heute NIRGENDS ein Recht (T4-1/B1-1/B14-1/B16-1). Die erste
--      Ausnahme davon für eine reine Anzeige zu machen, kostet mehr als sie einbringt.
--   3. Mit einem `anon`-Grant wäre der Wrapper ein Verzeichnisdienst: wer ihn in einer Schleife
--      aufruft, hat die Liste aller aktiven Fachbetriebe. Über `service_role` ist er das nicht.
-- Die Rückgabe ist trotzdem auf Slug + Anzeigename beschränkt — die Auflage der Aufgabenstellung
-- galt dem `anon`-Fall, die Begründung oben gilt unabhängig davon.
--
-- ── EIN INAKTIVER PARTNER IST NICHT AUFFINDBAR ──────────────────────────────────────────────────
-- `is_active` wird in der Bedingung geprüft, nicht zurückgegeben. Die Route kann damit keinen
-- dritten Zustand erfinden („gibt es, aber stillgelegt" → freundliche Ersatzseite): Stilllegung
-- heisst, dass die Links dieses Fachbetriebs nicht mehr wirken, und die einzige ehrliche Antwort
-- darauf ist dieselbe wie bei einem erfundenen Slug. Genau so verfährt auch `capture_lead` seit
-- B16-1 (inaktiv = unbekannt), und genau so verfährt `admin_update_lead` bewusst NICHT (eine
-- historische Zuordnung zu einem stillgelegten Betrieb ist eine zulässige Feststellung).
--
-- Der Slug wird kleingeschrieben verglichen — dieselbe Überlegung wie in `capture_lead`: der CHECK
-- garantiert, dass jeder GESPEICHERTE Slug kleingeschrieben ist, das Kleinschreiben der Anfrage kann
-- also nur einen Nicht-Treffer in den richtigen Treffer verwandeln, niemals in einen falschen.
-- Ein Slug, der den Format-CHECK verletzt, findet per Konstruktion nichts.
create function public.get_active_partner(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slug    text := lower(nullif(btrim(p_slug), ''));
  v_partner record;
begin
  if v_slug is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  select p.slug, p.display_name
    into v_partner
  from platform.partners p
  where p.slug = v_slug
    and p.is_active;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'slug', v_partner.slug,
    'display_name', v_partner.display_name
  );
end;
$$;

comment on function public.get_active_partner(text) is
  'B16-2: die Prüfung eines Partner-Slugs für die öffentliche Landingpage /partner/<slug> und für '
  'den ?partner=-Parameter auf /kontakt. Liefert AUSSCHLIESSLICH slug und display_name — die '
  'Ansprechperson (contact_first_name/contact_last_name) sowie Zeitstempel und Status fahren '
  'bewusst NICHT mit: was eine Server Component liest, kann im ausgelieferten HTML landen, auch '
  'wenn es niemand rendert. Ein INAKTIVER Partner ist nicht auffindbar (gleiche Antwort wie ein '
  'unbekannter) — dieselbe Lesart wie in public.capture_lead. service_role-only: die Seite rendert '
  'serverseitig, ein anon-Grant brächte keinen zusätzlichen Aufruf, wohl aber einen '
  'Verzeichnisdienst über alle aktiven Fachbetriebe.';

-- ── Rechte ───────────────────────────────────────────────────────────────────────────────────────
-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf NEUE public-Funktionen automatisch EXECUTE an
-- anon, authenticated UND service_role (zusätzlich zum PostgreSQL-Default an PUBLIC). Deshalb wie
-- überall: erst allen entziehen, dann gezielt gewähren.
revoke all on function public.get_active_partner(text) from public, anon, authenticated, service_role;
grant execute on function public.get_active_partner(text) to service_role;
