-- Delta 16b, TEIL 2 VON 2 — die Herkunft des Report-Downloads und der Wortlaut seiner Einwilligung.
--
-- Kanonische fachliche Quelle: `Pflichtenheft_Kalkulator_Delta_Tarifoptimierung.md`, Delta 16 ·
-- `Pflichtenheft_Kalkulator_MVP.md` §5.1. Der Enum-Wert 'offer_contact' entsteht in Teil 1
-- (`20260830090000_offer_contact_purpose.sql`) und kann dort aus dem gemessenen 55P04-Grund nicht
-- benutzt werden — genau deshalb steht der Textstand hier.
--
-- ── WAS HIER AUSDRÜCKLICH NICHT PASSIERT ────────────────────────────────────────────────────────
-- Keine Änderung an `public.capture_lead` — der Wrapper ist seit B16-1/B18-5 fertig und richtig, und
-- der neue Weg ist nichts weiter als ein zweiter AUFRUFER mit einem anderen `p_source_key` und einem
-- anderen `p_purpose`. Keine neue Spalte, keine neue Funktion, kein neuer Wrapper, kein Grant, kein
-- `tenant_id`. `admin_list_leads`/`admin_export_leads`/`admin_lead_source_stats` bleiben unberührt:
-- alle drei lesen die Herkunft über den FK auf `platform.lead_sources` und zeigen den neuen Wert
-- dadurch von selbst.
--
-- ⚠ AUSDRÜCKLICH AUCH NICHT: eine Spalte für „Funktion/Rolle im Unternehmen". §5.1 führt sie als
-- Pflichtfeld, `platform.leads` hat sie nicht, und `capture_lead` hat keinen Parameter dafür. Das
-- Gate erhebt sie deshalb GAR NICHT — statt sie zu erfragen und zu verwerfen (der Stub
-- `apps/website/components/report/lead-dialog.tsx` tut bis heute genau das). Ein erhobenes Feld ohne
-- Speicherort ist eine Requisite; wer die Spalte nachträgt, trägt sie in `leads`, in `capture_lead`,
-- in `guard_anonymized_lead` und in `anonymize_lead` gemeinsam nach.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — Der Herkunftsschlüssel
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WARUM 'rechner-report' UND NICHT 'rechnerergebnis' ──────────────────────────────────────────
-- 'rechnerergebnis' (B3-2) ist die ZUSENDUNG des Schnellrechner-Ergebnisses per E-Mail: ein
-- Einstiegspunkt auf coolin.at, der die Adresse erfragt und daraufhin eine Mail schickt. Der
-- Report-Download ist das Gegenteil — er findet im KALKULATOR statt (`apps/website`, eigene App,
-- eigene Herkunft), es geht keine Mail hinaus, und was der Nutzer bekommt, erzeugt sein eigener
-- Browser. Auf denselben Schlüssel gelegt liesse sich später nicht mehr sagen, wie viele Leads der
-- Rechner gebracht hat und wie viele die Marketingseite: `first_source_key` ist seit B1-1
-- unveränderlich, die Vermischung wäre nachträglich nicht mehr zu trennen.
--
-- Jeder bestehende Schlüssel benennt den KANAL aus Sicht des Interessenten ('kontaktformular',
-- 'schnellrechner', 'fachvortrag', 'branchenseite', 'partner-empfehlung'). 'rechner-report' tut
-- dasselbe: der Rechner, und darin der Report. Kein 'download-'-Präfix — das benennte die MECHANIK
-- statt die Herkunft (dieselbe Überlegung, die in B19 gegen 'admin-telefon' entschieden hat).
--
-- ── SCHREIBWEISE ────────────────────────────────────────────────────────────────────────────────
-- `platform.lead_sources.key` trägt seit B1-1 den CHECK `^[a-z0-9-]+$` (in B10-5 ist ein Unterstrich
-- real mit SQLSTATE 23514 abgewiesen worden). 'rechner-report' ist zweiteilig und benutzt deshalb
-- den BINDESTRICH, nicht den Unterstrich.
--
-- ⚠ GEGENSTÜCK IM CODE IST PFLICHT, NICHT KÜR: `lead-source-registry.test.ts` (DB-Gate) prüft in
-- BEIDE Richtungen, dass die aktiven Zeilen dieser Tabelle genau der Liste in
-- `apps/web/lib/leads/registry.ts` entsprechen. Diese Zeile ohne den dortigen Eintrag in
-- `LEAD_SOURCE_KEYS_WITHOUT_FORM` macht das Gate rot — bewusst so.
--
-- ── WARUM `LEAD_SOURCE_KEYS_WITHOUT_FORM` UND NICHT `LEAD_CAPTURE_FORM_KEYS` ────────────────────
-- Das Gate HAT ein Formular, aber keines DIESER Registry: es wird von `apps/website` gerendert, mit
-- eigenen Feldern, eigenen Texten und einer eigenen Server Action. Vier Registry-Texte, die niemand
-- rendert, wären eine Requisite — und entscheidend ist die Wirkung von `findLeadCaptureEntry`:
-- Stünde der Schlüssel in `LEAD_CAPTURE_FORM_KEYS`, liesse sich über den GENERISCHEN, öffentlichen
-- Erfassungs-Endpunkt von coolin.at ein Lead unter der Herkunft 'rechner-report' anlegen — also
-- eine Zeile, die einen heruntergeladenen Report behauptet, den es nie gab. Dieselbe Überlegung wie
-- bei 'partner-empfehlung' (B16-2) und 'telefonanfrage' (B19).
--
-- Idempotent wie alle Herkunfts-Seeds seit B1-1.
insert into platform.lead_sources (key, label) values
  ('rechner-report', 'Kalkulator — Report-Download')
on conflict (key) do nothing;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — Der Einwilligungswortlaut (version 1, locale 'de')
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ DIES IST EIN ERKENNBARER PLATZHALTER, KEIN GEPRÜFTER RECHTSTEXT — und er trägt seine
-- Kennzeichnung IM TEXT, nicht nur in diesem Kommentar.
--
-- Der Grund ist die Wirkungsweise dieser Tabelle: `platform.consent_texts` ist append-only
-- (`reject_consent_text_mutation`, B1-1), und `capture_lead` archiviert je Einwilligung genau die
-- Fassung, die dem Menschen ANGEZEIGT wurde. Ein hier frei formulierter, juristisch ungeprüfter
-- Satz sähe im Bestand ununterscheidbar aus wie ein geprüfter — und liesse sich nicht mehr
-- korrigieren, sondern nur noch durch eine Fassung 2 ergänzen. Die Kennzeichnung im Text ist
-- deshalb die einzige Form, in der ein Platzhalter hier überhaupt stehen darf: sie ist auf dem
-- Bildschirm sichtbar und macht ein versehentliches Livegehen unmöglich zu übersehen.
--
-- Zuständigkeit: `Fahrplan_2026.md` §7 „Fachliche Abhängigkeiten" — „Rechtssicherer
-- Einwilligungstext", Owner Martin; §5.1 des Kalkulator-Pflichtenhefts nennt zusätzlich den
-- PFLICHT-Link zur Datenschutzerklärung. Der Link ist NICHT Teil dieses Textes: er ist ein
-- Bedienelement der Oberfläche (`apps/website`) und kein Satz, dem jemand zustimmt — ein `<a>` in
-- einer archivierten Zeichenkette wäre entweder toter Text oder eingeschleustes Markup.
--
-- Eine geprüfte Fassung kommt als NEUE Zeile mit version 2 dazu; diese hier wird NICHT editiert.
insert into platform.consent_texts (purpose, version, locale, body) values
  (
    'offer_contact', 1, 'de',
    '[MARTIN: Copy / rechtlich — Arbeitsstand, juristisch ungeprüft] Ich willige ein, dass die '
    'COOLiN ENERGY GmbH meinen Namen, meine Firma und meine E-Mail-Adresse speichert und mich zu '
    'einem Angebot für die berechnete Auslegung kontaktiert. Meine Verbrauchsdaten werden dabei '
    'nicht übertragen. Diese Einwilligung kann ich jederzeit per Nachricht an energy@coolin.at '
    'widerrufen.'
  )
on conflict (purpose, version, locale) do nothing;
