-- Lieferanten-Tarifkatalog, SCHEMA-EBENE: `public.retail_tariffs`.
--
-- Kanonische fachliche Quelle: `Pflichtenheft_Kalkulator_Delta_Tarifoptimierung.md`, Delta 5
-- (Datenmodell + Absatz „Admin-Pflege" — dort ausdrücklich für BEIDE Seiten, Netzbetreiber UND
-- Stromanbieter) und Delta 6 (Brutto/Netto). Delta 10 beschreibt das gemeinsame Admin-UI.
-- Einordnung: `Fahrplan_2026.md`, Zeile B21 — B21-2b hat die Netzbetreiber-Seite gebaut und die
-- Lieferanten-Seite dabei AUSDRÜCKLICH offengelassen. Diese Migration schliesst sie.
--
-- ── WAS HIER ENTSTEHT ───────────────────────────────────────────────────────────────────────────
--   TEIL 1  public.retail_tariffs — ein Listenpreis eines Stromanbieters je (Anbieter, Segment,
--                                   Stand), effektiv datiert
--   TEIL 2  RLS und Rechte
--
-- ── WAS AUSDRÜCKLICH NICHT ENTSTEHT ─────────────────────────────────────────────────────────────
-- Kein Schreibweg (der folgt in der Nachbarmigration `…120100`, und zwar bewusst als EIGENE Datei
-- — s. den nächsten Absatz), keine Zeitfenster-Kindtabelle, keine Zeile Inhalt, kein Admin-UI,
-- keine Engine-Änderung. `grid_tariffs`, `grid_tariff_rate_windows` und `spot_prices` werden NICHT
-- angefasst, `platform` ebenfalls nicht.
--
-- ── WARUM ZWEI MIGRATIONEN, OBWOHL BEIDE AM SELBEN TAG KOMMEN ───────────────────────────────────
-- Die Trennung ist nicht die Nacherzählung einer Zeitachse (B21-1 und B21-2b lagen einen Tag und
-- einen PR auseinander, diese beiden nicht), sondern eine Aussage über die Tabelle: Ihr
-- Grundzustand ist NUR-LESBAR, und Schreibzugriff entsteht ausschliesslich zusammen mit dem einen
-- Weg, der ihn braucht. Wer später `service_role`-Rechte auf dieser Tabelle sucht, findet sie
-- genau dort, wo die Funktion steht, die sie verlangt — und nicht verstreut in der Tabellen-DDL.
--
-- ── WARUM EINE EIGENE TABELLE UND NICHT EINE ZEILENART IN `grid_tariffs` ────────────────────────
-- Netzentgelt und Lieferantenpreis sind zwei verschiedene VERTRÄGE desselben Kunden, und sie haben
-- keine gemeinsame Auswahl-Dimension: Netzebene und Leistungsmessungs-Variante gibt es beim
-- Lieferanten nicht, das Segment (Privat/Betrieb) beim Netzbetreiber nicht. In einer gemeinsamen
-- Tabelle stünde deshalb in jeder Zeile die Hälfte der Spalten strukturell auf null, und der
-- Unique-Constraint — der bei `grid_tariffs` die eine Sicherung gegen zwei gleichzeitig gültige
-- Stände ist — liesse sich für beide Arten nicht gemeinsam formulieren.
--
-- ── WARUM ES HIER KEINE ZEITFENSTER-KINDTABELLE GIBT ───────────────────────────────────────────
-- `grid_tariff_rate_windows` existiert, weil ein Netzentgelt laut Tarifblatt saisonale und
-- tageszeitliche Staffeln trägt (SNAP heute, Winter angekündigt). Dieser Katalog führt dagegen
-- LISTENPREISE zum Vergleich: ein Arbeitspreis, eine Grundgebühr, mehr gibt ein beworbener
-- Anbieterpreis nicht her.
--
-- Das heisst ausdrücklich NICHT, dass es keine gestaffelten Lieferantentarife gäbe — HT/NT- und
-- Flex-Tarife sind real. Sie kommen nur an anderer Stelle in die Rechnung: die individuellen
-- Vertragswerte des Kunden über seine eigene Rechnung (Delta 9b-2, `TariffParams`), die Börsen-
-- preise über `public.spot_prices` (Delta 7). Dieser Katalog beantwortet eine andere Frage —
-- „was verlangen andere Anbieter heute?" — und ein Durchschnittspreis, den niemand so bewirbt,
-- wäre dafür die schlechtere Antwort.
--
-- Erweist sich das als zu eng, ist der Weg bekannt und ändert diese Tabelle NICHT: eine
-- Kind-Tabelle nach dem Vorbild von `grid_tariff_rate_windows`.
--
-- ── WARUM `public` UND NICHT `platform` ─────────────────────────────────────────────────────────
-- Dieselbe Begründung wie für die drei Tabellen aus B21-1, und sie trägt hier genauso: `platform`
-- ist wegen personenbezogener Daten bewusst NICHT über die Data API exponiert und ausschliesslich
-- über SECURITY-DEFINER-Wrapper erreichbar (DEPLOYMENT.md §2a). Ein beworbener Anbieter-Listenpreis
-- ist das Gegenteil davon: veröffentlicht, ohne Personenbezug, für jeden lesbar. Er folgt deshalb
-- dem anon-lesbaren Muster — direkter RLS-Select auf die Tabelle — und nicht dem Wrapper-Muster.
--
-- ── ⚠ DIE RECHTE ENTSTEHEN VON SELBST, UND ZWAR FALSCH ─────────────────────────────────────────
-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf JEDE neue Tabelle im `public`-Schema
-- automatisch alle Tabellenrechte an `anon`, `authenticated` und `service_role` — INSERT, UPDATE,
-- DELETE und TRUNCATE eingeschlossen (in B21-1 gegen PostgreSQL 17.6 gemessen). „Kein
-- Schreib-Grant" ist also nicht dadurch erfüllt, dass diese Datei keinen schreibt; es verlangt ein
-- ausdrückliches `revoke all`. TEIL 2 tut das, das DB-Gate misst es nach.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — public.retail_tariffs
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Eine Zeile ist EIN Listenpreis EINES Anbieters für EIN Segment zu EINEM Stand. Effektiv datiert
-- und nie in-place überschrieben, aus demselben Grund wie bei den Netzentgelten: Ein 2026
-- archivierter Tarifvergleich (B14) muss 2028 noch sagen können, gegen welche Preise damals
-- verglichen wurde. Ein neuer Preis ist eine neue Zeile, kein UPDATE.
--
-- ── `segment` — dieselben zwei Werte wie am Projekt, und das ist Absicht ────────────────────────
-- `platform.projects.segment` und `platform.question_catalog_entries.segment` führen exakt
-- `('privat', 'betrieb')`. Hier stehen dieselben, damit ein Projekt seinen Vergleichstarif ohne
-- Übersetzungstabelle findet. Bewusst als CHECK und NICHT als geteiltes Enum: ein Typ aus
-- `platform` machte diese `public`-Tabelle von einem Schema abhängig, das gar nicht über die Data
-- API erreichbar ist — die anon-Lesbarkeit hinge dann an einem Schema, das für `anon` verschlossen
-- ist. Drei gleichlautende CHECKs sind hier der schlankere Preis; wer einen dritten Wert einführt,
-- ändert sie gemeinsam.
--
-- ── `price_basis` — der Fehler, den diese Spalte verhindert, ist genau hier am wahrscheinlichsten ─
-- Delta 6 verlangt die Preisbasis an JEDER Preisquelle. Bei den Netzentgelten war das Vorsorge
-- (Tarifblätter sind durchgängig netto); bei Endkundentarifen ist es der Regelfall: Anbieter
-- bewerben gegenüber Haushalten üblicherweise BRUTTO, gegenüber Betrieben netto. Ohne die Angabe an
-- der Quelle wäre ein Vergleich zwischen einem hier hinterlegten Preis und einem netto gerechneten
-- Netzentgelt stillschweigend um 20 % falsch — und zwar in einer Richtung, die niemandem als Fehler
-- auffiele, sondern als Ergebnis.
--
-- ── `source_url` — Quellenbeleg-Pflicht, und warum sie einen CHECK braucht ──────────────────────
-- Ein Listenpreis ohne Beleg ist eine Behauptung. Das wiegt hier schwerer als bei den Netzentgelten,
-- weil die Tabelle absehbar teilweise aus einer KI-Websuche gefüllt wird: Was nicht belegt ist,
-- lässt sich nachträglich weder prüfen noch bestreiten.
--
-- `not null` allein setzt das NICHT durch — der Leerstring läuft durch. Deshalb zusätzlich ein
-- CHECK auf „nicht leer". ⚠ Das ist die EINE Stelle, an der diese Migration über die vorgegebene
-- Spaltenliste hinausgeht; sie tut es, weil die Pflicht sonst nur ein Kommentar wäre, und sie
-- braucht dafür keinen neuen Fehlerweg: ein `check_violation` ist im Schreibweg bereits als
-- `invalid_input` benannt.
--
-- Ausdrücklich KEINE Formatprüfung auf eine URL: ein Beleg darf auch „Preisblatt per E-Mail vom
-- 12.09.2026" sein. Der Spaltenname sagt, was der Regelfall ist; die Spalte ist `text`, damit der
-- Ausnahmefall nicht erfunden werden muss.
--
-- ── `checked_at` — „zuletzt bestätigt", NICHT „gültig ab" ──────────────────────────────────────
-- Die beiden beantworten verschiedene Fragen. `valid_from` sagt, ab wann der Preis gilt;
-- `checked_at` sagt, wann zuletzt jemand nachgesehen hat, dass er noch dasteht. Ein Stand vom
-- 01.01. kann heute frisch bestätigt sein — ohne die zweite Spalte sähe er aus wie ein
-- Datenbestand von neun Monaten.
--
-- Genau daran hängt der nächste Schritt (Staleness-/Abweichungs-Warnung im Admin-UI): „seit X nicht
-- mehr geprüft" lässt sich aus `valid_from` nicht ableiten.
--
-- ⚠ BENANNTE LÜCKE: Einen Weg, `checked_at` FORTZUSCHREIBEN, gibt es in dieser Runde nicht — der
-- Schreibweg legt ausschliesslich neue Stände an, und für einen neuen Stand ist der Default `now()`
-- die Wahrheit. Wer die Neuprüfung eines UNVERÄNDERTEN Stands baut, baut sie als eigene Funktion,
-- die NUR diese eine Spalte anfasst; s. die Auflage im Kopf der Nachbarmigration.
create table public.retail_tariffs (
  id                      uuid primary key default gen_random_uuid(),
  provider_id             text not null,
  provider_name           text not null,
  segment                 text not null,
  energy_price_ct_per_kwh numeric not null,
  base_fee_eur_per_month  numeric not null,
  price_basis             text not null,
  source_url              text not null,
  valid_from              date not null,
  valid_until             date,
  checked_at              timestamptz not null default now(),
  created_by              text not null,
  created_at              timestamptz not null default now(),

  constraint retail_tariffs_segment_check
    check (segment in ('privat', 'betrieb')),
  constraint retail_tariffs_price_basis_check
    check (price_basis in ('net', 'gross')),
  constraint retail_tariffs_source_url_check
    check (btrim(source_url) <> ''),

  -- Ein GEWÖHNLICHES `unique` genügt hier — anders als bei `grid_tariffs`, wo `metering_variant`
  -- bei NE 3–6 legitim null ist und deshalb `nulls not distinct` nötig war, damit NULL als „gleiche
  -- Kombination" gilt. `segment` ist hier `not null` und durch den CHECK auf zwei Werte begrenzt;
  -- es gibt in diesem Schlüssel keine nullbare Spalte, an der die NULL-Sonderregel greifen könnte.
  --
  -- Der Constraint ist zugleich der Index, über den der Schreibweg seine offene Zeile sucht; ein
  -- zweiter Index ist bei einem Katalog dieser Grössenordnung nichts als Ballast.
  constraint retail_tariffs_unique
    unique (provider_id, segment, valid_from)
);

comment on table public.retail_tariffs is
  'Listenpreise von Stromanbietern, effektiv datiert (Delta 5) — die Lieferanten-Seite neben den '
  'Netzentgelten in public.grid_tariffs. Veröffentlichte Preise ohne Personenbezug: RLS-Select für '
  'anon+authenticated, Schreiben ausschliesslich über public.create_retail_tariff. Nie in-place '
  'überschreiben — ein neuer Preis ist eine neue Zeile.';

comment on column public.retail_tariffs.segment is
  'privat | betrieb — wortgleich zu platform.projects.segment, damit ein Projekt seinen '
  'Vergleichstarif ohne Übersetzung findet.';

comment on column public.retail_tariffs.price_basis is
  'net | gross (Delta 6). Endkundenpreise werden gegenüber Haushalten üblicherweise BRUTTO '
  'beworben, Netzentgelte sind netto — ohne diese Angabe wäre der Vergleich stillschweigend um '
  'den Steuersatz falsch. Gerechnet wird intern durchgängig netto.';

comment on column public.retail_tariffs.source_url is
  'Quellenbeleg, nie leer (CHECK): die Preisseite bzw. der vom Admin angegebene Beleg. Bewusst '
  'ohne Formatprüfung — ein Beleg muss keine URL sein.';

comment on column public.retail_tariffs.checked_at is
  'Zuletzt bestätigt — unabhängig von valid_from. Grundlage der Staleness-Anzeige; sagt NICHT, ab '
  'wann der Preis gilt.';

comment on column public.retail_tariffs.valid_until is
  'null = weiterhin gültig. Gibt es für einen Zeitraum keine Zeile, existiert kein Vergleichspreis '
  '— das ist ein Nebeneffekt der Effektiv-Datierung, kein Sonderfall-Code.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — RLS und Rechte
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Zwei Schichten, jede für sich ausreichend gegen einen Schreibzugriff:
--
--   (a) `revoke all` → `grant select`: nimmt die automatisch vergebenen Schreibrechte wieder weg
--       (s. Kopf) und gibt gezielt nur das Lesen zurück. `service_role` bekommt in DIESER Migration
--       GAR KEINEN Grant — auch keinen lesenden; was der Schreibweg braucht, entscheidet er in
--       seiner eigenen Datei, gemessen statt vorsorglich.
--   (b) RLS mit ausschliesslich einer SELECT-Policy: es existiert kein INSERT/UPDATE/DELETE-Pfad,
--       auch nicht als Policy, die eine spätere Migration versehentlich aufweichen könnte.
alter table public.retail_tariffs enable row level security;

create policy retail_tariffs_public_read
  on public.retail_tariffs
  for select
  to anon, authenticated
  using (true);

revoke all on table public.retail_tariffs from public, anon, authenticated, service_role;

grant select on table public.retail_tariffs to anon, authenticated;
