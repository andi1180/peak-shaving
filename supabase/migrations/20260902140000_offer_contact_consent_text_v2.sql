-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Delta 16b, NACHTRAG — der Einwilligungswortlaut ohne die interne Review-Markierung (version 2)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ WAS HIER PASSIERT — UND WAS AUSDRÜCKLICH NICHT:
--
-- Die in `…_create_report_download_source.sql` angelegte Fassung 1 trägt das interne Review-Tag
-- „[MARTIN: Copy / rechtlich — Arbeitsstand, juristisch ungeprüft]" ALS SICHTBAREN NUTZERTEXT: es
-- steht am Anfang des Bodys und wird deshalb im Report-Download-Dialog neben der
-- Einwilligungs-Ankreuzmöglichkeit mitgerendert. Gemeint war eine Kennzeichnung für uns, gelesen
-- hat es der Kunde. Diese Fassung nimmt die Markierung heraus.
--
-- DER SATZBESTAND DAHINTER IST WORTGLEICH UNVERÄNDERT. Es ist ausdrücklich KEINE inhaltliche
-- Änderung am Rechtstext — nur die Markierung fällt weg. Ein Diff der beiden Bodys ergibt genau
-- den entfernten Präfix samt folgendem Leerzeichen.
--
-- ── WARUM EINE NEUE ZEILE UND KEIN UPDATE ───────────────────────────────────────────────────────
-- `platform.consent_texts` ist append-only (`reject_consent_text_mutation`, B1-1), und das ist
-- keine Formalie: `capture_lead` archiviert je Einwilligung GENAU die Fassung, die dem Menschen
-- angezeigt wurde. Wer Fassung 1 nachträglich editierte, änderte rückwirkend den Wortlaut, dem
-- bereits erfasste Leads zugestimmt haben — der Nachweis wäre danach eine Behauptung. Fassung 1
-- bleibt deshalb unangetastet stehen; sie belegt weiterhin korrekt, was denjenigen gezeigt wurde,
-- die sie gesehen haben.
--
-- `public.get_active_consent_text` und `public.capture_lead` wählen beide „höchste version je
-- Zweck+Sprache" (B1-2) — ab dieser Migration ist das die neue Fassung, für Anzeige UND Archiv.
-- Es ist keine Funktion, kein Grant und keine Tabelle zu ändern.
--
-- ── ⚠ DIESER TEXT IST WEITERHIN JURISTISCH UNGEPRÜFT ────────────────────────────────────────────
-- Zuständigkeit unverändert: `Fahrplan_2026.md` §7 „Rechtssicherer Einwilligungstext", Owner
-- Martin. Was hier entfällt, ist die Markierung IM Kundentext — nicht der offene Punkt. Kommt die
-- geprüfte Fassung, ist sie eine version 3 nach demselben Muster.
--
-- Der PFLICHT-Link zur Datenschutzerklärung (§5.1) ist weiterhin NICHT Teil dieses Textes: er ist
-- ein Bedienelement der Oberfläche (`apps/website`) und kein Satz, dem jemand zustimmt.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

insert into platform.consent_texts (purpose, version, locale, body) values
  (
    'offer_contact', 2, 'de',
    'Ich willige ein, dass die '
    'COOLiN ENERGY GmbH meinen Namen, meine Firma und meine E-Mail-Adresse speichert und mich zu '
    'einem Angebot für die berechnete Auslegung kontaktiert. Meine Verbrauchsdaten werden dabei '
    'nicht übertragen. Diese Einwilligung kann ich jederzeit per Nachricht an energy@coolin.at '
    'widerrufen.'
  )
on conflict (purpose, version, locale) do nothing;
