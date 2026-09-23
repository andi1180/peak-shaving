# CLAUDE.md — Peak Shaving Kalkulator

> Diese Datei wird bei jeder Session automatisch geladen. Sie ist bewusst kurz.
> **Maßgebliches Detaildokument: `./Pflichtenheft_Kalkulator_MVP.md`** — bei Widerspruch gilt das Pflichtenheft.
> Diese Datei enthält die Regeln und Leitplanken; das Pflichtenheft enthält die Details.
>
> Hinweis: Das Repo enthält zusätzlich `apps/web` (Website coolin.at) mit eigener `apps/web/CLAUDE.md` und `apps/web/Pflichtenheft_Website_Coolin.md` — für Website-Arbeit gelten diese, nicht diese Datei.
>
> **Übergeordnet: `./Fahrplan_2026.md`** — kanonische Quelle für Reihenfolge/Umfang aller Bauabschnitte seit 20.07.2026. Für den Kalkulator relevant: **B10** (Anbindung ans Entitlement-System — **gebaut, 22.07.2026**: Zugang zur Rechner-Route über Sitzung + `calculator_pro`-Entitlement, der DB-lose Zugangscode ist gelöscht statt umgangen, Vergabe über den bestehenden Gutscheincode-Mechanismus ohne Stripe-Preis; fachliche Tiefe in `Pflichtenheft_Kalkulator_MVP.md` §7a.3; **nachgezogen mit B10-5, 22.07.2026**: die Registrierung erfasst Firma + Vor-/Nachname als Pflichtfelder und schreibt darüber einen Lead — Herkunft aus dem Rücksprungziel abgeleitet (`kalkulator-registrierung` vs. `registrierung`), und das Ziel reist jetzt durch den gesamten Bestätigungs-Mail-Flow bis auf die Rechner-Route; Handover in `apps/web/CLAUDE.md`), **B11** (Tarifsätze auf konfigurierbare Verordnungssätze umstellbar machen — **gebaut, 21.07.2026**: getypte Datenschicht `packages/shared/src/tariff-catalog.ts` statt Datenbank, Netzebene 7 wird bis zur Tarifverordnung verweigert statt geschätzt; fachliche Tiefe in `Pflichtenheft_Kalkulator_MVP.md` §7a.2, Anleitung zum Nachtragen in `DEPLOYMENT.md` §3a) und **B14** (Analyse-Persistenz — **gebaut, 24.07.2026**: B14-1 Ablage, B14-2 Export/Upload/Ansicht; fachliche Tiefe in `Pflichtenheft_Kalkulator_MVP.md` §7a.1).

---

## Was wir bauen

Ein Kalkulator, der aus dem Viertelstunden-Lastgang eines Gewerbebetriebs die Bezugsspitzen erkennt, eine Batterie **physikalisch (SoC-basiert)** simuliert und eine belastbare Wirtschaftlichkeitsrechnung samt Speicherempfehlung erzeugt. Vertrieb über Installateure/Elektriker sowie Direktakquise. Erster Bauabschnitt: die Rechen-Engine (`/packages/engine`).


---

## Nicht verhandelbare Prinzipien

1. **Die Rechnung ist die Wahrheit.** Tarifsätze (Leistungspreis, Abrechnungsmodell, Mindestleistung) kommen aus der Netzrechnung des Kunden, nicht aus einer gepflegten Datenbank. Das *Wie* der Umrechnung Spitze→Kosten ist eine austauschbare Strategie (`TariffStrategy`), kein hartkodierter Jahreshöchstwert.
2. **Ein Dispatch, eine ehrliche Zahl.** Peak Shaving, Eigenverbrauch und tarifbewusstes Laden konkurrieren um dieselbe Batteriekapazität. Genau ein simulierter Fahrplan, Priorität Spitzenschutz. Ersparnisanteile transparent aufschlüsseln, **nie** unabhängig addieren.
3. **Physikalisch korrekte Simulation.** Batterie = Leistung (kW) **und** Energie (kWh). Chronologischer SoC-Durchlauf über alle Viertelstunden inkl. Wirkungsgrad. Kein „Peak-Zählen".
4. **Public/Portal-Grenze + RLS von Tag 1.** Öffentlicher Rechner: client-side, Verbrauchsdaten verlassen den Browser nicht. Persistenz erst bei bewusster Lead-Abgabe mit Einwilligung. Multi-Tenancy/RLS ist Architektur, nicht Nachrüstung.
5. **Transparenz statt Black Box.** Jede Kernzahl zur Rechenweise nachvollziehbar; zentrale Annahmen editierbar.
6. **Für Skalierung bauen, ohne Over-Engineering.** Entscheidungen so treffen, als ginge das System morgen in Produktion — aber schlank, sauber, testbar. Keine Demo-Abkürzungen im Fundament; keine spekulativen v2-Features vorbauen.

---

## Engine-Regeln (`/packages/engine`)

- **Rein & isomorph:** framework-frei, keine DOM-/Node-spezifischen Abhängigkeiten, kein I/O im Rechenkern. Läuft im Browser (öffentlich) und serverseitig (Portal).
- **Deterministisch:** gleiche Eingabe → gleiche Ausgabe, keine Seiteneffekte.
- **100 % unit-testbar.** Tests zuerst gegen synthetische Lastgänge (z. B. Bäckerei mit Morgenspitze), später gegen Martins echten Referenzfall. **Erst Logik + Tests, dann UI.**
- Fachliche Invarianten aus dem Pflichtenheft sind als Tests abzusichern (z. B. „abgerechneter kW-Wert nie unter Mindestleistung", „Ersparnisanteile werden nicht doppelt gezählt", „SoC nie < 0 oder > nutzbare Kapazität").

---

## Tech-Stack & Struktur

- **Sprache/Engine:** TypeScript, framework-freies Paket `/packages/engine`.
- **Frontend:** Next.js (App Router), Tailwind CSS.
- **Deployment:** vercel
- **Backend/DB:** Supabase (PostgreSQL, RLS, Storage, Auth), Vercel.
- **Geteiltes `platform`-Schema (produktübergreifend, NICHT Kalkulator-eigen):** Login/Rollen/Entitlements/Stripe-Spiegel für die ganze CoolIn-Plattform liegen in einem Postgres-Schema `platform`, gebaut im **Monitor-Bauabschnitt T4-1** — der künftige Kalkulator-Portalteil hängt daran (gemeinsames Konto über beide Produkte). Fundort: `supabase/migrations/` (`…_create_platform_schema.sql` + T4-2-Nachträge: Auth-RPC-Wrapper, Entitlement-Constraint + **T4-3-Nachtrag: Stripe-RPC-Wrapper** `…_create_stripe_rpc_wrappers.sql`), abgesichert per DB-Gate in `packages/db-tests`. **Der Stripe-Webhook (`apps/web/app/api/stripe/webhook`) schreibt `platform` NICHT direkt, sondern über SECURITY-DEFINER-`public`-Wrapper (service_role-only); die Entitlement-Zeile leitet der DB-Trigger ab.** Der künftige Kalkulator-Portalteil liest denselben `platform.entitlements`-Spiegel (`get_my_entitlement`, Produkt `calculator_pro`). **~~Änderungen an `platform` sind geteilte Infrastruktur und mit der Monitor-Doku synchron zu halten~~ (`Pflichtenheft_Monitor_MVP.md` §15, `packages/tariff-monitor/CLAUDE.md`) — DIESE PFLICHT IST SEIT B14-2 (24.07.2026) AUSSER KRAFT, nicht erfüllt.** Begründung: Die Regel entstand, als der Monitor das aktive Produkt war und `platform` dort gebaut wurde. Seit 20.07.2026 sind `Pflichtenheft_Monitor_MVP.md` und `packages/tariff-monitor/CLAUDE.md` **ruhend gestellt und ausdrücklich nur historisch zu lesen** (Banner in beiden Dateien, Fahrplan_2026.md). Neue Schema-Einträge dort nachzutragen machte genau diese Kennzeichnung falsch: die Dateien behaupteten damit einen aktuellen Stand, den sie ansonsten nicht mehr führen, und ein Leser könnte nicht mehr unterscheiden, was historisch und was gültig ist. **Maßgeblich für `platform` sind ab sofort diese Datei (Root-`CLAUDE.md`) und die Handover-Logs der AKTIVEN Apps** (`apps/web/CLAUDE.md`). Die Monitor-Dokumente bleiben unangetastet — sie beschreiben korrekt den Stand, den `platform` bei ihrer Ruhestellung hatte. **Seit B1-1 (21.07.2026) trägt `platform` zusätzlich das Lead- und Einwilligungsfundament** (`…_create_lead_consent_foundation.sql`: `leads`, `consents`, `consent_texts`, `lead_sources`, `email_suppressions` + `public.admin_list_leads`/`admin_get_lead`), erweitert um den Schreibpfad (B1-2, `…_create_lead_capture_wrappers.sql`, service_role-only) und **den Admin-Pfad (B1-3, `…_create_lead_admin_wrappers.sql`)** — Produkt der Website-Bauabschnitte B1–B3, Handover in `apps/web/CLAUDE.md`. **Mit B1-3 schreibt erstmals ein ANGEMELDETER Nutzer (`authenticated`, admin-geprüft) in `platform`-Daten** — bisher lief jeder Schreibzugriff über `service_role`. Zwei neue Trigger auf `platform.leads` (`sync_retention_basis_on_customer`, `guard_anonymized_lead`) machen „Kunde ⇒ 7 Jahre Aufbewahrung" und „anonymisiert ⇒ unveränderlich" zu DB-Invarianten, die auch für `service_role` und `postgres` gelten. Für den Kalkulator ohne unmittelbare Folge, aber beim Anfassen von `platform` mitzudenken — insbesondere: **BEFORE-ROW-Trigger auf `leads` feuern alphabetisch nach Triggernamen, die Namen sind dort Ablaufsteuerung** (Begründung im Kopf der B1-3-Migration). **Seit B3-1 (21.07.2026) trägt `platform.leads` zusätzlich sechs Segmentierungsspalten** (`…_create_lead_segmentation_columns.sql`: Enum `platform.industry`, `industry`/`postal_code`/`annual_consumption_kwh`/`metering_type`/`supplier`/`contract_end_date`, alle nullable, plus Teilindizes auf `anonymized_at is null`), einen dritten Trigger auf `platform.consents` (`clear_contract_data_on_withdrawal` — Zweckbindung: Widerruf der Vertragsablauf-Erinnerung nullt Versorger und Vertragsende) und ein erweitertes `public.capture_lead` (sechs angehängte Parameter mit COALESCE-Zusammenführung: ein übergebener Wert überschreibt, `null` lässt unberührt). `guard_anonymized_lead` und `platform.anonymize_lead` sind entsprechend nachgezogen. **Seit B3-2 (22.07.2026) ist `public.capture_lead` ein zweites Mal neu gefasst** (`…_lead_capture_single_opt_in.sql`, `create or replace` bei UNVERÄNDERTER Signatur — Grants bleiben): eine Einwilligung zu einem Zweck OHNE Bestätigungspflicht (`purpose_requires_double_opt_in = false`, konkret `result_delivery`) entsteht jetzt SOFORT mit `status='confirmed'` und `confirmed_at`, ein übergebener Token wird dabei NICHT gespeichert, und der Rückgabewert `outcome` trägt dafür den eigenen Wert `consent_confirmed` (statt `consent_created`). Ein idempotenter Backfill in derselben Migration hat bestehende `pending`-Zeilen solcher Zwecke auf `confirmed` mit `confirmed_at = granted_at` gestellt. **Für den Kalkulator-Portalteil relevant, sobald er selbst Einwilligungen erfasst:** an `outcome` verzweigen, nicht am Zweck — `consent_created` heisst Bestätigungsmail, `consent_confirmed` heisst sofortige Lieferung. **Seit B4-1 (22.07.2026) trägt `platform` zusätzlich die Scheduling-Infrastruktur** (`…_create_job_runs_and_lead_retention.sql`): Laufprotokoll `platform.job_runs` (RLS, keine Policy, für KEINE Rolle ein Grant — geschrieben nur aus `platform.run_lead_retention`, gelesen nur über `public.admin_list_job_runs`), die Auswahl-/Ausführungsfunktionen `leads_due_for_anonymization`/`run_lead_retention` sowie die Wrapper `public.run_lead_retention_job` (service_role-only, ausgelöst vom Vercel-Cron `apps/web/app/api/cron/lead-retention`, täglich 03:15 UTC) und `public.admin_list_job_runs` (authenticated-only). **Der erste zeitgesteuerte Job der Plattform — er versendet bewusst KEINE E-Mail.** Neue Spalte `platform.leads.anonymized_by_system` + CHECK macht die Urheberschaft eines unumkehrbaren Vorgangs eindeutig (System ODER Konto, nie beides); `anonymize_lead` hat dafür einen dritten Parameter `p_by_system` (DROP+CREATE, bestehende Zwei-Argument-Aufrufe unverändert), `guard_anonymized_lead` schützt die neue Spalte mit. **Für den Kalkulator ohne unmittelbare Folge, aber beim Anfassen von `platform` mitzudenken — insbesondere: die Mengenobergrenze (`p_refuse_above`, Vorgabe 1000) ist die EINZIGE Sicherung gegen einen fehlerhaft ausgelösten Massen-Anonymisierungslauf; oberhalb davon wird bewusst gar nichts abgearbeitet, nicht die erste Teilmenge.** **Seit B2-1 (23.07.2026) trägt `platform` zusätzlich den Korrektur- und Ausfuhrpfad** (`…_create_lead_editing_filters_export.sql`): Spalte `leads.last_edited_by` (ON DELETE SET NULL), `public.admin_update_lead` (GENAU neun bearbeitbare Felder — `email` hat bewusst KEINEN Parameter, `status`/`retention_basis`/`first_source_key`/`deletion_due_at` ebenso wenig), die geteilte Filterbedingung `platform.leads_matching` (benutzt von `admin_list_leads` UND `admin_export_leads` — eine Definition, zwei Konsumenten) samt `lead_filter_summary`/`marketing_consent_state`, sowie das Ausfuhrprotokoll `platform.admin_exports` + `public.admin_export_leads`/`admin_list_exports` (authenticated-only, RLS ohne Policy und ohne Grant wie `job_runs`). `admin_list_leads` wurde dafür per DROP+CREATE um sieben Filterparameter erweitert; ein bestehender Aufruf mit den bisherigen acht BENANNTEN Argumenten bleibt gültig. **Für den Kalkulator-Portalteil beim Anfassen von `platform` mitzudenken: (a) `guard_anonymized_lead` schützt jetzt 15 Spalten, bei `last_edited_by` aber ASYMMETRISCH — nur das SETZEN ist gesperrt, das Nullen muss durchlaufen, sonst blockierte `ON DELETE SET NULL` das Löschen eines Kontos; (b) `admin_update_lead` deutet `null` als LÖSCHEN, `capture_lead` dagegen als „unberührt lassen“ — die beiden Regeln sind bewusst gegensätzlich und in der Migration nebeneinander begründet; (c) der Export schliesst gesperrte und anonymisierte Zeilen in der ABFRAGE aus, nicht über einen Filter.** **Seit B2-2 (23.07.2026) trägt `platform` zusätzlich den Zustellrand** (`…_create_email_events_ledger.sql`): den APPEND-ONLY-Ereignis-Ledger `platform.email_events` (PK = Ereigniskennung des Anbieters, Muster `stripe_events`; bewusst OHNE Rohnutzlast, weil die die Empfängeradresse im Klartext trüge und eine zweite, eigens zu löschende Kopie personenbezogener Daten wäre), die Helfer `strip_emails`/`is_permanent_bounce` sowie `public.record_email_event` (service_role-only, ausgelöst vom Resend-Webhook `apps/web/app/api/resend/webhook`) und `public.admin_list_email_events`/`admin_email_event_stats` (authenticated-only); `admin_get_lead` liefert zusätzlich `suppression_reason`. **Für den Kalkulator ohne unmittelbare Folge, aber beim Anfassen von `platform` mitzudenken: (a) `reject_email_event_mutation` hat GENAU EINE Ausnahme — das Nullen von `lead_id` bei sonst bit-identischer Zeile, weil die referentielle Aktion `ON DELETE SET NULL` selbst ein UPDATE ist und ein ausnahmsloser Trigger jeden Lead mit Zustellereignissen unlöschbar machte (dieselbe Asymmetrie wie bei `last_edited_by`, s. o.); (b) „dauerhafter Rückläufer" ist an EINER Stelle definiert (`platform.is_permanent_bounce`) und wird von Wirkung, Auswertung und Anzeige gemeinsam benutzt; (c) eine Beschwerde widerruft Einwilligungen, ein Rückläufer NICHT — die Unterscheidung Willenserklärung/technisches Ereignis ist die fachliche Achse dieses Abschnitts; (d) es gibt bewusst KEINEN Wrapper, der eine Sperre aufhebt.** **Seit dem 24.07.2026 ist der Kontaktname aufgetrennt** (`…_split_contact_name.sql`): `platform.leads.contact_name` ist DURCH `first_name`/`last_name` ERSETZT (Backfill + `drop column` in derselben Migration — der reale Bestand trug keine echten Leads mit diesem Feld, begründet im Kopf der Migration), damit künftige Korrespondenz eine korrekte Anrede bilden kann; nachträgliches Parsen eines zusammengesetzten Namens ist bei Doppelnamen/Titeln unzuverlässig. **Zwei Signaturen sind BRECHEND geändert** (`public.capture_lead` und `public.admin_update_lead`, je DROP+CREATE mit `p_first_name`/`p_last_name` an der Stelle des früheren `p_contact_name`, Grants danach erneut gesetzt) — **ein bestehender Aufruf mit `p_contact_name` bricht zur Laufzeit, nicht beim Anlegen der Migration.** `guard_anonymized_lead` (jetzt 16 Spalten, beide Namensfelder EINZELN), `platform.anonymize_lead`, `admin_list_leads`, `admin_export_leads` und `admin_get_lead` sind nachgezogen. **Für den Kalkulator-Portalteil beim Anfassen von `platform` mitzudenken: `first_name`/`last_name` sind IDENTITÄTSfelder und folgen in `capture_lead` `coalesce(Bestand, neu)` wie `company`/`phone` — NICHT der B3-1-Segmentierungsregel; und sie werden einzeln zusammengeführt, nicht als Paar.** **Seit B14-1/B14-2 (24.07.2026) trägt `platform` zusätzlich das Analyse-Archiv — der erste `platform`-Bereich, der dem KALKULATOR gehört und nicht der Website** (`…_create_analysis_persistence.sql`): die append-only Tabelle `platform.analyses` (eingefrorene Auslegung: `inputs`/`result` als jsonb wortgleich wie berechnet, fünf typisierte Auszüge als eigene Spalten, `engine_version`/`engine_commit_sha`, die gzip-komprimierte Ursprungsdatei + SHA-256 über die UNKOMPRIMIERTE Fassung, `supersedes_id`) samt vier Wrappern `public.admin_create_analysis`/`admin_list_analyses`/`admin_get_analysis`/`admin_get_analysis_source` — **alle vier `authenticated`-only, ausdrücklich AUCH der schreibende** (eine Analyse entsteht durch einen Menschen, der sie verantwortet: `created_by = auth.uid()`; über `service_role` wäre die Spalte strukturell leer). Die isomorphen Archiv-Funktionen liegen in `packages/shared/src/archive.ts` (gzip/SHA-256, Web-Streams statt `node:zlib`, damit `shared` client-bündelbar bleibt), das Austauschformat in `packages/shared/src/analysis-bundle.ts`. **Bindende Regeln für alles, was `platform.analyses` künftig anfasst: (a) NIE nachrechnen** — eine 2027 neu gerechnete Baseline wäre eine Prognose, die 2026 niemand abgegeben hat; eine verbesserte Rechnung ist eine NEUE Zeile mit `supersedes_id`, und der Append-only-Trigger erzwingt das auch gegen `service_role` und `postgres`. **(b) KEINE Fremdschlüssel auf veränderliche Konfiguration** — Tarifsätze, Batteriepreise und Annahmen stehen als WERTE in `inputs`; das gilt ausdrücklich auch für B11, wenn die Tarifschicht konfigurierbar wird (ein Verweis änderte die eingefrorene Baseline still mit). **(c) Die Ausnahme vom Append-only ist eng** — nur das Nullen von `lead_id`/`created_by` bei sonst bit-identischer Zeile, weil `ON DELETE SET NULL` selbst ein UPDATE ist (zum dritten Mal derselbe Fall, s. `last_edited_by` und `email_events.lead_id` oben); Setzen und Umhängen bleiben gesperrt. **(d) `customer_label` steht DENORMALISIERT auf der Analyse** — der Lead wird nach 24 Monaten anonymisiert, die Analyse muss sieben Jahre zuordenbar bleiben; sie hängt deshalb bewusst NICHT am Kaskadenlöschen des Leads. **(e) KEIN `installer_id`** (§4 des Kalkulator-Pflichtenhefts stammt aus der Zeit vor der Plattform-Entscheidung und ist für diesen Bereich überholt) und **kein `tenant_id`** (B13, additiv später). Der Schreib- und Leseweg im Anwendungscode ist B14-2: Export im Rechner (`apps/website`), Upload/Ansicht im Admin-Bereich (`apps/web/app/admin/analysen/**`) — s. „Stand & offene Entscheidungen" und `apps/web/CLAUDE.md`. **Seit B16-1 (24.07.2026) trägt `platform` zusätzlich die Partner-Attribution** (`…_create_partner_attribution.sql`, Modell A: Fachbetriebe verweisen ihre Bestandskunden per personalisiertem Link, COOLiN führt Analyse und Kundenbeziehung): die Stammdatentabelle `platform.partners` (der `slug` IST der Primärschlüssel — struktureller Zwilling von `lead_sources.key`, **derselbe Format-CHECK `^[a-z0-9-]+$`**, nach dem Anlegen unveränderlich per Trigger `guard_partner_slug`, **kein `delete`-Grant für IRGENDEINE Rolle**, Stilllegung über `is_active`), zwei neue Spalten auf `platform.leads` (`partner_slug` FK **`on delete restrict`** + `referred_by_text`) und vier Wrapper `public.admin_create_partner`/`admin_update_partner`/`admin_set_partner_active`/`admin_list_partners` (alle `authenticated`-only, alle WERFEN 42501 statt leer zu antworten). `capture_lead` (zwei angehängte Parameter), `leads_matching`/`lead_filter_summary`, `admin_list_leads`, `admin_export_leads`, `admin_update_lead`, `admin_get_lead`, `guard_anonymized_lead` und `anonymize_lead` sind nachgezogen. **Für den Kalkulator-Portalteil beim Anfassen von `platform` mitzudenken: (a) ZWEI Spalten sind Absicht** — `partner_slug` ist die bestätigte Zuordnung (URTEIL, nur über `admin_update_lead` änderbar), `referred_by_text` der Freitext des Interessenten (BEOBACHTUNG, bewusst OHNE Parameter in `admin_update_lead`); dieselbe Trennlinie wie in B7 zwischen Extraktion und Interpretation. **(b) Die Anonymisierung behandelt sie GEGENSÄTZLICH** — `referred_by_text` wird genullt und ist danach im Guard (jetzt 17 Spalten), `partner_slug` überlebt und steht ausdrücklich NICHT im Guard, damit die Partner-Statistik die 24-Monats-Frist überdauert; das ist die vierte Ausnahme dieser Art und die einzige, die NICHT der `ON DELETE SET NULL`-Asymmetrie entspringt. **(c) Beide neuen `capture_lead`-Parameter folgen `coalesce(Bestand, neu)`** (die ERSTE Nennung eines Partners gilt, wie `first_source_key`) — NICHT der B3-1-Segmentierungsregel. **(d) Ein unbekannter oder INAKTIVER Slug wird in `capture_lead` VERWORFEN** (ein Link mit Tippfehler darf keinen Lead kosten), in `admin_update_lead` dagegen mit 22023 ABGEWIESEN (eine still verworfene Zuordnung sähe aus wie eine erfolgte) — und ein inaktiver Partner ist dort ausdrücklich zulässig. **(e) Kein `tenant_id`, kein Partner-Login, kein neuer `consent_purpose`, und ausdrücklich kein Cookie/localStorage/sessionStorage** (§165 TKG — eine Speicherung auf dem Endgerät brächte einen Cookie-Banner für die gesamte Domain und beendete die cookielose Analytics-Architektur). **Seit B16-2 (25.07.2026) trägt `platform` dazu den öffentlichen Rand** (`…_create_partner_landing_source.sql`): eine `lead_sources`-Zeile (`partner-empfehlung` — die HERKUNFT eines Leads von der Landingpage, ausdrücklich nicht dasselbe wie die ZUORDNUNG in `partner_slug`) und den einzigen Lesezugriff, den die öffentliche Seite braucht: `public.get_active_partner(p_slug)`, **service_role-only**. **Für den Kalkulator-Portalteil beim Anfassen von `platform` mitzudenken: (a) der Wrapper liefert AUSSCHLIESSLICH `slug` und `display_name`** — die Ansprechperson des Fachbetriebs, Zeitstempel und Status fahren bewusst nicht mit, und die Beschränkung steht in der DATENBANK, nicht im Anwendungscode: was eine Server Component liest, kann im ausgelieferten HTML landen, auch wenn niemand es rendert, und eine Auswahlliste im TypeScript-Leser nähme der nächste Umbau versehentlich zurück. **(b) Ein INAKTIVER Partner ist über den Wrapper nicht auffindbar** (gleiche Antwort wie ein unbekannter — dieselbe Lesart wie in `capture_lead`, damit die Anwendung den Zustand „gibt es, ist aber stillgelegt" gar nicht erst erfinden kann). **(c) Weiterhin kein `anon`-Grant** — die Seite rendert serverseitig; mit einem Browser-Grant wäre der Wrapper ein Verzeichnisdienst über alle aktiven Fachbetriebe. `capture_lead`, `anonymize_lead` und `guard_anonymized_lead` sind in B16-2 **unverändert** geblieben. **Seit B16-3 (25.07.2026) trägt `platform` zusätzlich die Partner-Bewerbungen** (`…_create_partner_applications.sql`): das Enum `platform.partner_application_status` (`pending`/`approved`/`rejected`), die Tabelle `platform.partner_applications` (Firma, Vor-/Nachname GETRENNT, E-Mail, optional Telefon/Website, **Pflicht-Freitext**, `user_id` → `auth.users` mit `on delete set null`, Status/`reviewed_by`/`reviewed_at`; RLS aktiv, **für KEINE Rolle irgendein Tabellenrecht**, kein `delete`-Grant) und vier Wrapper: `public.submit_partner_application` (**service_role-only**, der öffentliche Schreibweg) sowie `admin_list_partner_applications`/`admin_get_partner_application`/`admin_reject_partner_application` (alle `authenticated`-only, alle WERFEN 42501). **Für den Kalkulator-Portalteil beim Anfassen von `platform` mitzudenken: (a) EIGENE Tabelle, ausdrücklich NICHT `platform.leads`** — anderer Lebenszyklus und andere Auswertung; in `leads` vermischt liesse sich „will Kunde werden" nicht mehr von „will Vertriebspartner werden" trennen, und die Zahl, an der die Marktnachfrage gemessen wird, wäre still verfälscht. **(b) KEIN UNIQUE auf E-Mail oder Firma, und das ist eine Sicherheitsentscheidung** — ein Constraint-Fehler wäre ein Enumerationsleck („diese Adresse hat sich schon beworben"); Mehrfachbewerbungen sind erlaubt. **(c) Die Kontoverknüpfung entsteht IM WRAPPER** (laufende Sitzung, sonst das GENAU EINE Konto zur Adresse; bei keinem oder mehreren Treffern bleibt `user_id` null), und die Rückgabe sagt darüber NICHTS — was der Anwendungscode nicht erfährt, kann er nicht weitergeben. **(d) Es gibt KEINEN Weg zu `approved`**: kein Wrapper, kein Tabellenrecht, und der Zielstatus des Ablehn-Wrappers ist ein Literal statt eines Parameters (Genehmigen erzeugt in B16-4 zusätzlich Partner, Slug und Freischaltung — ein Status ohne diese drei sähe aus wie Erfolg). **(e) Der CHECK verlangt `reviewed_at`, NICHT `reviewed_by`** — sonst machte `on delete set null` beim Löschen des Prüfer-Kontos die Zeile ungültig und das Konto unlöschbar (dieselbe Asymmetrie-Familie wie `leads.last_edited_by`, `email_events.lead_id`, `analyses.lead_id`). **(f) ⚠ Es gibt KEINE Aufbewahrungsfrist** — `platform.run_lead_retention` (B4-1) fasst diese Tabelle nicht an; die Frist ist eine offene juristische Frage (`DEPLOYMENT.md` §7). **(g) Kein Typfeld am Konto, kein `tenant_id`, kein neuer `consent_purpose`** (Rechtsgrundlage ist Vertragsanbahnung). **Seit B16-4a (26.07.2026) ist der Weg von der Bewerbung zum Fachbetrieb geschlossen** (`…_create_partner_approval.sql`): `platform.partners` trägt zwei Verweise (`user_id` → `auth.users`, nullable + **UNIQUE**, `on delete set null`; `application_id` → `platform.partner_applications`, `on delete restrict`), dazu die Wrapper `public.admin_approve_partner_application` und `public.admin_link_partner_account` (beide `authenticated`-only, beide WERFEN 42501); `admin_list_partners` und `admin_get_partner_application` sind per `create or replace` nachgezogen. **Für den Kalkulator-Portalteil beim Anfassen von `platform` mitzudenken: (a) Genehmigen und Partner-Anlage sind EIN Aufruf und damit EINE Transaktion** — der Wrapper VERLANGT einen Slug, es gibt also keinen Weg zu `'approved'`, der keinen Fachbetrieb erzeugt; im Gate ist das gemessen, indem die Partner-Anlage künstlich zum Scheitern gebracht wurde (der Antrag bleibt `pending`). **(b) ⚠ DER STOLPERDRAHT WURDE GEMESSEN UND ENTSCHÄRFTE SICH SELBST:** `guard_partner_slug` (B16-1) vergleicht ausschliesslich `new.slug is distinct from old.slug` und blockiert ein referentielles `SET NULL` auf `user_id` NICHT (in einer zurückgerollten Transaktion mit echtem Konto-Löschen nachgewiesen, Gegenprobe „Slug umbenennen" weiterhin P0001). Eine asymmetrische Ausnahme wie bei `leads.last_edited_by`/`email_events.lead_id`/`analyses.lead_id` wurde deshalb bewusst NICHT gebaut — **wer den Trigger später um weitere Spalten erweitert, muss sie mitbauen**, sonst wird ein Konto unlöschbar. **(c) `application_id` ist ausdrücklich `restrict`, nicht `set null`** (ein Antrag, aus dem ein Partner wurde, soll sich nicht still entfernen lassen — dieselbe Überlegung wie bei `leads.partner_slug`). **(d) Die UNIQUE-Bedingung auf `user_id` ist ABSEHBAR TEMPORÄR:** mehrere Logins je Partnerbetrieb kommen später über eine Zwischentabelle, und dann ist die Bedingung zu ENTFERNEN, nicht die Struktur umzubauen. **(e) Ein Antrag mit `user_id is null` ist NICHT genehmigbar** (`no_account`) — der Fall entsteht real, wenn die Kontoanlage bei der Bewerbung am Rate-Limit scheitert; ein daraus genehmigter Partner hätte nie ein Login und der Slug wäre unwiderruflich verbraucht. **(f) Weiterhin kein `delete`-Grant, kein Typfeld, kein `tenant_id`, keine Genehmigungs-Mail und kein Partner-Portal** (B16-4b/B16-5). **Seit der B16-3-NACHBESSERUNG (26.07.2026) entsteht ein solcher Antrag gar nicht mehr** (`…_partner_application_requires_account.sql`, Korrektur eines in Produktion gemessenen Fehlers — kein neuer Funktionsumfang): `public.submit_partner_application` (per `create or replace`, **Signatur und Grants unverändert**) legt NICHTS mehr an, wenn sich kein Konto auflösen lässt, und antwortet `{status: no_account}`; der neue Trigger `partner_applications_require_account` setzt dieselbe Bedingung auf Speicherebene durch, auch gegen `service_role` und `postgres`. Der Abweisungsgrund in `admin_approve_partner_application` BLEIBT als Tiefenstaffelung stehen, obwohl er dadurch unerreichbar wird. **Für den Kalkulator-Portalteil beim Anfassen von `platform` mitzudenken — und das ist der wichtigste Punkt dieses Nachtrags: (a) ⚠ ES IST BEWUSST KEIN `NOT NULL` AUF DER SPALTE, und der Grund ist GEMESSEN, nicht abgeleitet.** `user_id` trägt `on delete set null`, und diese referentielle Aktion IST SELBST EIN UPDATE — dieselbe Falle wie bei `leads.last_edited_by`, `email_events.lead_id` und `analyses.lead_id`/`created_by`, hier zum **fünften** Mal und in der schärfsten Form. In zurückgerollten Transaktionen gegen PostgreSQL 17.6 nachgewiesen: `NOT NULL` + `set null` → `delete from auth.users` scheitert mit **23502**, das Konto ist unlöschbar, sobald irgendein Antrag daran hängt; `NOT NULL` + `cascade` → das Löschen vernichtet den offenen Antrag UND scheitert mit **23503** an `partners_application_id_fkey`, sobald aus dem Antrag ein Partner wurde. Beide Wege brechen also entweder die Löschbarkeit eines Kontos oder die Aufbewahrung des Antrags. **(b) Die Invariante ist deshalb enger gefasst, als eine Spaltenbedingung sie ausdrücken kann: Ein Antrag darf nicht ohne Konto ENTSTEHEN.** Dass die Verknüpfung SPÄTER entfällt, weil jemand sein Konto löscht, ist kein illegitimer Antrag — genau dafür ist `on delete set null` da. Der Trigger erlaubt folglich AUSSCHLIESSLICH das Nullen bei sonst bit-identischer Zeile; Setzen und Umhängen sind gesperrt (an `user_id` entscheidet B16-4a, WER freigeschaltet wird). **(c) ⚠ OFFENGELEGTE GRENZE: der Wrapper unterscheidet ab jetzt bekannte von unbekannten Adressen** (`created` gegen `no_account`) — „kein Antrag ohne Konto" und „die Antwort verrät nichts über die Existenz einer Adresse" schliessen einander aus, sobald die Kontoanlage scheitert. Erreichbar ist der Unterschied nur in genau diesem Fehlerfall; der Wrapper bleibt service_role-only mit EINEM Aufrufer, und nach aussen führen beide Abbruchgründe (kein Konto / Datenbank weg) zu **derselben** neutralen Meldung. **(d) „Mehrere Konten zur Adresse" endet jetzt ebenfalls im Abbruch** und bewusst mit DEMSELBEN Status — ein eigener wäre eine Auskunft über den Kontobestand zu einer fremden Adresse. **Seit B16-4b (26.07.2026) trägt `platform` zusätzlich den Partner-Zugang und den Benachrichtigungsvermerk** (`…_create_partner_portal.sql`): die Spalte `platform.partners.notified_at` sowie `public.get_my_partner()` und `public.admin_mark_partner_notified` (beide `authenticated`-only, `service_role` bewusst ohne Grant); `admin_list_partners` und `admin_get_partner_application` sind per `create or replace` nachgezogen (Signaturen und Grants unverändert). **Für den Kalkulator-Portalteil beim Anfassen von `platform` mitzudenken — hier entsteht die ERSTE Zugriffsebene, die weder Kunde noch Admin ist: (a) `get_my_partner` hat KEINEN Parameter**, struktureller Zwilling von `get_my_entitlement` (T4-2) — die Bindung entsteht im Rumpf über `auth.uid()`, es gibt nichts zu übergeben und damit keinen Weg, nach einer fremden Zeile zu fragen; zurück kommen ausschliesslich Slug und Anzeigename, wie beim öffentlichen `get_active_partner` und aus demselben Grund (was eine Server Component liest, landet im ausgelieferten HTML, auch wenn niemand es rendert). **(b) Ein INAKTIVER Partner ist darüber nicht auffindbar** und bekommt dieselbe Antwort wie ein Konto ohne Partnerzeile — dieselbe Lesart wie `get_active_partner` (B16-2) und `capture_lead` (B16-1); die Anwendung kann den dritten Zustand gar nicht erst erfinden. **(c) `notified_at` sagt die Wahrheit oder nichts**: kein Zeitstempel-Parameter (der Wrapper nimmt `now()`), kein Gegenstück zum Nullen, kein `update`-Grant auf `platform.partners` für irgendeine Rolle — und der Vermerk entsteht ausschliesslich NACH erfolgreicher Zustellung, denn vor dem Versand gesetzt stünde er ausgerechnet dann auf „benachrichtigt", wenn der Versand gleich darauf scheitert. **(d) Ohne verknüpftes Konto wird der Vermerk ABGEWIESEN** (`no_account`): die Nachricht verweist auf ein Portal mit Anmeldung, und ohne `user_id` gibt es die nicht (real: von Hand aufgenommene Betriebe, und `on delete set null` beim Löschen eines Kontos). **(e) `guard_partner_slug` steht dem NICHT im Weg** — er vergleicht weiterhin ausschliesslich den Slug (im Gate mit gesetztem `notified_at` und echtem Konto-Löschen gemessen; der Vermerk überlebt und macht das Konto nicht unlöschbar). **(f) Weiterhin kein `delete`-Grant, kein Typfeld am Konto, kein `tenant_id`, keine Partner-eigene Sicht auf Leads und keine Statistik** (B16-5/B16-6) — und die UNIQUE-Bedingung auf `partners.user_id` aus B16-4a bleibt unangetastet. **Seit Delta 16b (30.08.2026) trägt `platform` einen FÜNFTEN Einwilligungszweck und eine neue Herkunft** (`…_offer_contact_purpose.sql` + `…_create_report_download_source.sql`, zwei Dateien, weil `alter type … add value` in derselben Transaktion nicht benutzbar ist — 55P04, in B18-6 gemessen): der Enum-Wert `platform.consent_purpose.'offer_contact'` (Kontaktaufnahme zu einem Angebot, §5.1), die `lead_sources`-Zeile `rechner-report` und eine `consent_texts`-Fassung dazu. **Keine Tabelle, keine Spalte, keine Funktion, kein Grant, keine Änderung an `capture_lead`, `purpose_requires_double_opt_in`, `anonymize_lead` oder `guard_anonymized_lead`** — der neue Weg ist nichts als ein zweiter AUFRUFER mit anderem `p_source_key`/`p_purpose`. **Für den Kalkulator-Portalteil beim Anfassen von `platform` mitzudenken: (a) der neue Zweck ist NICHT bestätigungspflichtig** — `purpose_requires_double_opt_in` zählt weiterhin nur `marketing_email` und `contract_expiry_reminder` auf, ein neuer Wert fällt automatisch auf `false`, und genau das ist hier richtig: die Erfüllung (der Download) findet im selben Moment statt, und `apps/website` hat gar keinen Mailversand. **(b) Der Schreibpfad liegt zum ersten Mal AUSSERHALB von `apps/web`** (`apps/website/lib/report-gate/store.ts`, service_role, genau zwei Wrapper) — der service_role-Schlüssel existiert damit in ZWEI Vercel-Projekten und ist bei jeder Rotation in beiden zu erneuern (`DEPLOYMENT.md` §1a und §1-Website-b). **(c) Der Wortlaut in `consent_texts` ist ein als solcher GEKENNZEICHNETER Arbeitsstand** („[MARTIN: Copy / rechtlich …"); die geprüfte Fassung kommt als **version 2**, die bestehende wird nicht editiert (append-only). **Seit K1 (22.09.2026) trägt `platform` zusätzlich den Einkaufspreis des Batteriekatalogs** (`…_create_battery_catalog.sql`): `platform.battery_purchase_prices` (Primärschlüssel ist die Batterie — genau ein Preis je Gerät, kein Verlauf; FK auf `public.battery_catalog` mit `on delete cascade`; RLS aktiv, **keine Policy, für KEINE Rolle ein Tabellenrecht**, Muster `job_runs`/`admin_exports`), erreichbar ausschliesslich über `public.admin_set_battery_purchase_price` (Schreiben UND Entfernen) und die beiden Lesewege `admin_list_battery_catalog`/`admin_get_battery` — alle `authenticated`-only mit `platform.is_admin()` im Rumpf, **`service_role` bewusst ohne Grant** (ein Katalog-Eintrag ist die Entscheidung eines Menschen, und ein service_role-Client trägt kein JWT). Der KATALOG selbst liegt dagegen in `public` und ist per RLS öffentlich lesbar — aber **nur mit `active = true`**; die Freigabe hängt am CHECK `battery_catalog_active_complete`, der auch gegen `service_role` und `postgres` gilt. **Für den Kalkulator beim Anfassen von `platform` mitzudenken: (a) die Trennung der beiden Tabellen IST die Sicherung** — aus Listen- und Einkaufspreis ergibt sich die Marge, und der öffentliche Rechner liest den Katalog im Browser des Kunden; eine Spalte in `public.battery_catalog` führe über ein `select *` mit, auch wenn keine Oberfläche sie rendert. **(b) `on delete cascade` ist hier richtig und NICHT die `ON DELETE SET NULL`-Falle** — es hängt kein Unveränderlichkeits-Trigger an der Tabelle, und ein verwaister Einkaufspreis wäre ein Preis ohne Gegenstand. **(c) Keine Effektiv-Datierung, weder beim Listen- noch beim Einkaufspreis** — eine abgelegte Analyse trägt den Katalogstand bereits als Wertkopie (B14-1), eine zweite Historie beantwortete dieselbe Frage ein zweites Mal; `price_as_of` ist ein PREISSTAND, keine Gültigkeit. **(d) Kein `tenant_id`, kein Partner-Zugriff, und keinen Weg, eine Zeile beim Anlegen sofort zu aktivieren.**
- **Parser/Charts:** PapaParse (CSV), SheetJS/xlsx, Recharts.
- **UI/Design:** zwei Oberflächen mit **gegensätzlichem Charakter** — öffentlicher Rechner mobile-first & lebendig (darf animieren), Report/Portal desktop-first & ruhig (Tablet Pflicht). shadcn/ui, Inter, `tabular-nums` für Zahlen, **Akzent als CSS-Variable** (White-Label). Bindende Prinzipien: Pflichtenheft §6.1 · konkrete Tokens: `./DESIGN.md`. **Der Engine-unabhängige UI-Teil (Designsystem, Marketing, 4-Schritt-Gerüst, Formulare, Worker-Harness gegen gemockten Contract) läuft parallel zur Engine (§9).** Der Report mit echten Zahlen wird erst nach getestetem Engine-Kern (M1-Gate, §3.11) verdrahtet — nicht erst nach Martins Validierung.
- **Monorepo:**
  ```
  /packages/engine   ← reine Rechen-Bibliothek (zuerst)
  /packages/shared   ← Typen, Konstanten, Schemata
  /apps/website      ← öffentliche Seite + öffentlicher Rechner (client-side Engine)
  /apps/web          ← coolin.at: Marketing, Konto/Auth, Admin — UND der eingeloggte Portalteil
  /supabase          ← Schema, Migrations, RLS-Policies
  ./*.md             ← Pflichtenheft, DESIGN.md, Konzeptdokumente (im Root, kein /docs)
  ```
  **`/apps/portal` ist mit B10-3 (22.07.2026) GELÖSCHT** — ersatzlos, nicht verschoben. Der Ordner war seit dem ersten Prompt ein leeres Next-Gerüst („Grundgerüst — Auth & RLS folgen."), ohne Abhängigkeit auf `shared` oder `engine` und ohne Vercel-Projekt. Der eingeloggte Teil ist faktisch in **`apps/web`** entstanden: Auth (T4-2), Konto, Entitlements, Gutscheineinlösung und der Zugangsschutz des Kalkulators (B10) liegen dort bereits. Eine zweite App für denselben Zweck wäre eine zweite Auth-Domain und ein zweites Deployment für nichts.
- Paketspezifische Regeln können später als eigene `CLAUDE.md` je `/packages/*` bzw. `/apps/*` ergänzt werden (nächstgelegene Datei gilt).

---

## Arbeitsregeln — aus Fehlern entstanden, verbindlich

**Grundsatz (Andreas, 21.09.2026):** Abweichungen vom Pflichtenheft sind erlaubt, wenn sie fachlich Sinn machen — wir arbeiten agil, nicht starr.

> Der Grundsatz steht bewusst VOR den nummerierten Regeln und ist die einzige Zeile hier, die nicht
> aus einem Fehler entstanden ist. Er entbindet nicht von den Regeln darunter und nicht von der
> Pflicht, eine Abweichung im betroffenen Dokument als Revision zu vermerken (nicht zu löschen).

> Jede dieser Regeln steht hier, weil ihr Fehlen mindestens einmal einen Fehler erzeugt hat, den **kein Test und kein Build gefangen hat**. Sie gelten für jede Arbeit an `platform`, an den Wrappern und an den Deployments — Kalkulator wie Website.

1. **Vor jedem `DROP` oder `RENAME` einer Spalte im `platform`-Schema werden ALLE Funktionsrümpfe per `pg_get_functiondef` nach dem Spaltennamen durchsucht.** plpgsql prüft Funktionsrümpfe **nicht** beim Anlegen: Die Migration läuft sauber durch, und die Funktion bricht erst beim **ersten Aufruf** — also im Betrieb, nicht im CI. **Zweimal aufgetreten** (B3-4: ein fehlender Join in `admin_lead_source_stats`; Namens-Split: `admin_list_leads`/`admin_export_leads`/`admin_get_lead` lasen `ld.contact_name` und standen gar nicht in der Aufgabenstellung).
2. **Jeder neue oder geänderte `public`-Wrapper wird im DB-Gate mindestens einmal tatsächlich AUFGERUFEN.** Introspektion (`proargnames`, Grants, Existenz) beweist ausschließlich, dass eine Funktion da ist — nicht, dass sie läuft. Der Aufruf ist die einzige Prüfung, die Regel 1 überhaupt greifen lässt.
3. **Die Vorher-Baseline für einen Live-Nachweis wird VOR dem Merge gemessen.** Nach dem Merge steht das Production-Deployment binnen Minuten, und ältere Deployment-URLs sind durch Deployment Protection abgeschirmt — die Vorher-Zahl ist dann nicht mehr erhebbar, und der Nachweis reduziert sich auf „sieht richtig aus".
4. **Wird eine Änderung in `apps/website` (Kalkulator) wirksam, müssen ZWEI Vercel-Projekte für den Merge-Commit deployt haben:** `peak-shaving-web` **und** `peak-shaving-website`. Der Commit-Hash ist **je Projekt einzeln** abzugleichen — ein Projekt kann den Build überspringen (unveränderter Pfad, `ignoreCommand`), und ein grünes Deployment des einen sagt nichts über das andere.

5. **Eine SECURITY-DEFINER-Funktion wird NIE direkt als Rolle ohne EXECUTE-Grant aufgerufen, um fehlenden Zugriff zu beweisen.** Ein solcher Aufruf ist dafür bekannt, den Postgres-Prozess abzuschießen (**Signal 11**) statt sauber mit 42501 abzulehnen. Bisher wurde das nur als Konvention für Prüfungen gegen die **Cloud**-DB gelebt („kein Funktionsaufruf — Segfault-Vermeidung", seit B10-1); am **26.07.2026 ist es in B16-4a erstmals im CI-Image aufgeschlagen** — der Server nahm mitten im DB-Gate keine Verbindungen mehr an, die nachfolgende Testdatei scheiterte an der Erreichbarkeitsprüfung, und der Lauf sah aus wie ein Infrastrukturproblem. Stattdessen **`has_function_privilege`** verwenden. **Ein echter Aufruf ist nur sicher, wenn die aufrufende Rolle einen Grant BESITZT und die Ablehnung im Funktionsrumpf selbst erfolgt (`RAISE`), nicht auf Grant-Ebene** — der eingeloggte Nicht-Admin, der real 42501 bekommt, bleibt also der richtige Test; der anonyme Aufruf auf eine Funktion ohne Grant ist es nicht.

**Dazu eine wiederkehrende Schema-Eigenschaft, die dreimal zugeschlagen hat:** `ON DELETE SET NULL` **ist selbst ein UPDATE**. Jeder Append-only- oder Unveränderlichkeits-Trigger auf einer Tabelle mit einem solchen Fremdschlüssel braucht deshalb die **asymmetrische Ausnahme**: Das **Nullen** genau dieser Spalte ist erlaubt, sofern die Zeile sonst **bit-identisch** bleibt; **Setzen und Umhängen bleiben gesperrt**. Ohne die Ausnahme wird der referenzierte Datensatz (ein Konto, ein Lead) **unlöschbar** — ausgerechnet gegen ein Löschverlangen. Aufgetreten bei `leads.last_edited_by` (B2-1), `email_events.lead_id` (B2-2) und `analyses.lead_id`/`created_by` (B14-1).

**Und eine zweite Eigenschaft dieser Art, die NICHT im `platform`-Schema wohnt und deshalb leicht übersehen wird:** `storage.objects` ist **nur EINFACH gesichert**. In `platform` schützen zwei Schichten unabhängig voneinander — RLS ohne Policy UND fehlendes Tabellen-Grant; dort gibt es nur eine. Gemessen (B24, Migration `…_create_project_chat_state.sql` TEIL 7): RLS ist aktiv und es gibt **0 Policies**, aber `anon` UND `authenticated` haben auf `storage.objects` die **VOLLEN Tabellenrechte**, von Supabase selbst vergeben. **Die Abwesenheit einer Policy ist also das Einzige, was einen Bucket verschliesst.** Daraus folgt eine bindende Auflage: **jede künftige Policy auf `storage.objects` MUSS eine `bucket_id`-Bedingung tragen** — eine permissive Policy ohne sie öffnet mit demselben Federstrich JEDEN Bucket, auch die, die es beim Schreiben der Policy noch gar nicht gibt. Ein Test auf die Policy-ZAHL fängt das nicht (er bliebe grün); geprüft wird das VERHALTEN — beide Rollen versuchen echt zu lesen und zu schreiben, mit `service_role` als Positivkontrolle.

6. **Bei Aufträgen, die ein bestehendes Muster eng nachbauen sollen ("spiegle X exakt"), wird der Referenz-Ausschnitt möglichst WÖRTLICH im Auftrag mitgegeben, statt CC zum eigenständigen Lesen der Referenzdatei zu schicken.** In dieser Session ist der CC-Kontext mehrfach genau an diesem Muster zusammengebrochen (Autocompact-Thrashing) — grosse `sed -n`-Lesevorgänge über bestehende, sehr kommentarreiche Dateien, um ein Muster zu „verstehen", bevor es nachgebaut wurde.
7. **Keine Datei unter `apps/web/lib/admin/**` oder `apps/web/components/admin/**` soll über ~1000 Zeilen wachsen — rechtzeitig aufteilen, nicht erst wenn ein Absturz zwingt.** `data-entry-actions.ts` wuchs unbemerkt auf 3404 Zeilen (jede neue Stations-Action einfach angehängt) und hat dabei DREIMAL denselben Absturz ausgelöst, bis sie stationsweise aufgeteilt wurde (PR #212). Dasselbe traf zuvor `data-entry-battery.tsx` (PR #204).
8. **PRs werden STAND 13.09.2026 sofort gemergt, ohne vorheriges Klick-Testen auf einer Vorschau-URL — solange es keine Live-Kunden im Admin-Bereich gibt.** Sobald reale Kunden aktiv sind, gilt wieder: erst Andreas testet selbst (Vorschau-URL oder coolin.at, je nach Lage), dann mergen — Abschluss-Ketten dann wieder ohne `gh pr merge` enden lassen, bis er bestätigt hat.

### Regel 9 — Sparsam bauen und berichten (ab 15.09.2026, nach einem 2-Mio-Token-Vorfall an einer Zwei-Zeilen-Änderung)

Kommentare: ein Satz pro nicht offensichtlicher Entscheidung. Keine Historie, keine verworfenen Alternativen, keine Testzahlen-Erzählung im Code.

Tests: 1–3 pro Änderung — Erfolgsfall plus das, was wirklich brechen könnte. Keine Wächter-Proben (Code absichtlich kaputt machen und zurücksetzen), keine A/B-Läufe gegen `git stash`, ausser die Änderung selbst ist riskant oder schwer auf andere Weise zu verifizieren — dann kurz benennen, warum diese Ausnahme hier gilt.

Abschlussbericht an Andreas: was geändert wurde, in wenigen Zeilen. Keine Testzahlen-Choreografie, keine Schritt-für-Schritt-Erzählung des Prüflaufs. **Die Zahlen, die dabei vorkommen, nennen ihre Datenquelle — s. Regel 11.**

### Regel 10 — Vor jedem Merge-Versuch frisch mit main abgleichen

`git fetch && git rebase origin/main` unmittelbar vor jedem `gh pr merge`-Versuch, als fester
Schritt der Abschluss-Kette — nicht erst als Reaktion auf einen abgelehnten Merge. Grund: an einem
Tag mit vielen PRs wächst `main` auch NACH dem Abzweigen eines Branches weiter; „von frischem main
abzweigen" allein verhindert die Divergenz deshalb nicht zuverlässig (zweimal aufgetreten,
15.09.2026).

### Regel 11 — Jede berichtete Kennzahl nennt ihre Datenquelle, unaufgefordert

Jede Zahl, die CC in einem Bericht aus einer BERECHNUNG meldet, trägt die Herkunft ihrer Eingaben
direkt daneben — nicht erst auf Rückfrage. Zum Beispiel:

- „Cloud-Entwurf, `_provenance.source: measured` vom 19.09.2026" — echte Produktionsdaten,
- „Kalibrier-Fixture des öffentlichen Rechners (9,5 ct), nicht Cloud-Live" — von Hand gesetzt,
- „synthetischer Testlastgang" — gar keine Kundendaten.

Das gilt je Eingabeseite getrennt, sobald sie verschiedene Herkunft haben: „Lastgang und Preisdaten
live, Tarifparameter von Hand" ist eine andere Aussage als „live gemessen" und muss auch so
dastehen.

**Anlass:** #295 meldete eine Kalibrier-Fixture als „live gemessen, echte Cloud-Preisdaten". Der
Fehler überlebte mehrere Nachrichten, weil die Fixture-Zahl (843,00 €) durch **Zufall** nur 4 Cent
neben einem echten Bug-Wert lag (842,96 € aus einem bekannt falschen Tarifsatz) — die Verwechslung
sah dadurch aus wie eine Regression im Code. Aufgefallen ist sie erst, weil Andreas nachgefragt hat.

**⚠ Das steht NICHT im Widerspruch zu Regel 9** („keine Testzahlen-Choreografie"): Verlangt ist
eine kurze Klammer an der Zahl, kein Prüflauf-Protokoll. Wer die Herkunft weglässt, spart keine
Zeile, sondern verschiebt die Prüfung auf den Leser.

### Regel 12 — Geteilter Code heisst geteiltes Risiko: neue Fälle können bestehende leise verändern

Report- und Engine-Code ist bewusst geteilt (eine Rechnung, keine zwei Wahrheiten) — das heisst
aber auch: eine Änderung für einen NEUEN Fall (z. B. ein Kunde mit Kappungsbedarf, ohne PV, wo
bisher ein anderer Zweig lief) kann denselben Code treffen, den ein bereits abgeschlossener
Referenzfall benutzt. Ein grüner Testlauf beweist „die Logik tut, was sie soll" — **nicht** „die
Zahlen bestehender Fälle haben sich nicht verändert".

Nach JEDEM Änderungs-Batch, der Report- oder Engine-Code berührt, der von mehr als einem Fall
genutzt wird: mindestens einen bestehenden Referenzfall (aktuell **Markus Urbanz** über den
Wizard-Pfad `run-from-draft.ts` und die **Demo-Bäckerei** über den öffentlichen Rechner)
neu als Report ziehen und die Kopfzahlen gegen den letzten bekannten Stand prüfen — nicht nur die
neuen Tests grün sehen.

**⚠ Der zweite Fall ist seit K3b (23.09.2026) die Bäckerei und nicht mehr das Demo Hotel**, und der
Grund ist nicht Geschmack: die beiden Fälle sollen die ZWEI Analysepfade abdecken, die es gibt —
den Wizard (`apps/web` → `extractors`) und den öffentlichen Rechner (`apps/website`). Der
Bäckerei-Lastgang liegt als Fixture im Repo und läuft über die echte Oberfläche; das Demo Hotel
existiert nur als gerenderter Report in einem Kundenordner und lässt sich nicht nachziehen.
**⚠ Genommen wird `dev-fixtures/demo-baeckerei-lastgang-verschoben-2025.csv`, nicht der
2023er-Jahrgang** — dieselbe Wertereihe, nur um 735 Tage (wochentagserhaltend) verschoben: ein
Lastgang vor dem 1.1.2025 wird im Upload abgewiesen (Delta 15 Regel B, alle vier Einstiege).

**⚠ DIE PRÜFUNG HAT SEIT K3b-2 (23.09.2026) EINE SCHÄRFERE FORM — und die ist billiger, nicht
teurer:** statt „Kopfzahlen vergleichen" wird das **vollständige `AnalysisResult` als JSON** vorher
und nachher abgelegt und TIEF verglichen; jede Differenz ist ein Fehler, den man findet, statt ihn
zu erklären. Damit der Vergleich trägt, müssen die EINGABEN eingefroren sein: die Preisdaten einmal
aus der Cloud holen, als Datei wegschreiben und für beide Läufe wiederverwenden — sonst läuft der
Vorher-Lauf gegen einen anderen Cloud-Stand als der Nachher-Lauf, und die Differenz ist die
Datenbank, nicht der Code. **Referenzstand 23.09.2026 — Bäckerei aus dem Golden File (s. unten;
synthetischer Lastgang, Tarif von Hand: 9,5 ct / 50 €/kW·a / `monthly_max_sum` / Einspeisung 0,
Netzentgelte/Spotpreise/Katalog am 23.09.2026 per `anon` eingefroren):** `billedKw` **606,56**,
31 Katalog-Kandidaten, Leistungspreis 2.527,33 €/Jahr, Empfehlung `6845c64d…` (**Kostal & Dyness
Retrofit L**, 1.875 €/Jahr, Amortisation 5,84 Jahre, netto 7.803 € über 10 Jahre) · Urbanz
mit den Cloud-Entwurfs-Parametern (13,081 ct / 3,50 €/Monat / 4,56 ct) `billedKw` **69,132** (bis
zur Mindestleistung je Monat 60,212 — der Entwurf trägt `minBillableKw` 7, Leistungspreis 0, kein
Euro-Betrag hat sich dadurch bewegt).
**⚠ KORREKTUR:** hier stand bis zum Golden File „Empfehlung `f5d5344a…` (Dyness Stack 100
40,96 kWh)". Die Zeile hat zwei Läufe vermischt — `billedKw` stammte aus der eingefrorenen
`monthly_max_sum`-Probe, die Empfehlung aus einem Lauf über die Oberfläche (Vorgabe
`monthly_max_average`, Tarifwerte nicht festgehalten). Mit den eingefrorenen Eingaben ist sie aus
KEINEM der beiden Modelle reproduzierbar (`monthly_max_average` ergibt „Kostal & Dyness Retrofit
L"); die K3d-Probe mit demselben Parametersatz nannte bereits Solinteg E2BR-S96K-C. ⚠ Die
Oberfläche des öffentlichen Rechners gibt `monthly_max_average` vor — wer dort misst und die
Baseline-Zahl erwartet, muss das Modell umstellen, sonst steht dort der ZWÖLFTE Teil des
`billedKw` (die Leistungskosten sind seit dem Faktor-12-Fix in beiden Modellen gleich). **⚠ Die
Empfehlung hat sich mit dem Faktor-12-Fix (23.09.2026) GEWOLLT geändert** — vorher Solinteg
E2BR-S96K-C (`ad294919…`, 0,84 Jahre Amortisation), weil das Zwölffach des Leistungspreises jede
Spitzenkappung überbewertete und das leistungsstärkste Gerät nach vorn schob. Je Gerät hat sich
dabei nur die Leistungspreis-Ersparnis (exakt ÷ 12) und was daraus folgt bewegt; Fahrplan und
`newBilledKw` sind unverändert.

**Anlass:** Dreimal in einer Session ist genau diese Fehlerklasse aufgetreten, nicht spekulativ:
`reduceAnalysis` liess `annualScenario` und `pvValue` aus seiner Pick-Liste aus (Feld existierte,
Typprüfung erlaubte es, Report zeigte trotzdem nichts — **#320**, **#321**); „Berechnungsmethodik je
Kennzahl" kannte Vergleichstarif und Kappung nicht, obwohl beide in anderen Fällen längst aktiv
waren (**#326**); das Inhaltsverzeichnis führte Unterpunkte für ein Kapitel, für ein gleichrangiges
anderes nicht (**#327**). Keiner dieser drei Fälle wurde von einem automatisierten Test gefangen —
sie fielen erst auf, weil der echte Report gegen den Produktionspfad gezogen und von Auge geprüft
wurde.

**Golden File Bäckerei — `[GEBAUT, 23.09.2026]`:** `packages/engine/test/golden/baeckerei.test.ts`
rechnet `computeAnalysis` mit eingefrorenen Eingaben (`test/golden/baeckerei/`: Lastgang,
Tarifwerte, Netzentgelte, Spotpreise, Abgaben, 31 Katalog-Geräte — Herkunft und Begründung in der
README dort) und verlangt das vollständige `AnalysisResult` EXAKT wie in `expected.json`, ohne
Toleranz; bei Abweichung listet er Pfad und alt → neu. Läuft in CI mit `pnpm --filter engine test`.
Er ersetzt die Regel für den Rechner-Pfad **auf Engine-Ebene**, nicht ganz: Report-Aufbau und der
Wizard-Pfad (Urbanz, echter Kunde, bleibt ausserhalb des Repos) sind weiterhin von Hand
nachzuziehen. **Pflege:** `pnpm golden:update` erzeugt `expected.json` neu — nur im PR der
bewussten Rechenänderung, und der PR-Bericht nennt, welche Zahlen sich bewegt haben und warum.
**Nie zum Grünmachen**, und die Eingaben werden nicht nachgeladen (ein neuer Cloud-Stand ist kein
Grund für ein Update).

### Regel 13 — Der Batteriekatalog wird nur mit einer Rolle gelesen, für die RLS gilt (ab 23.09.2026, K3c)

Rechenpfade (öffentlicher Rechner, Wizard, künftige) lesen `public.battery_catalog` ausschliesslich
als `anon` oder `authenticated` — **nie mit `service_role` und nie über die SECURITY-DEFINER-
Pflegewrapper** (`admin_list_battery_catalog`/`admin_get_battery`). Beide sehen inaktive Entwürfe;
ein Entwurf mit ungeprüften Kenndaten stünde dann als Empfehlung im Kundenreport. Das gilt auch für
Messungen. Festgehalten an beiden Abrufstellen (`apps/website/lib/battery-catalog/source.ts`,
`apps/web/lib/admin/battery-catalog-source.ts`).

---

## Offene Abhängigkeiten (blockieren Validierung, nicht den Bau)

Solange nicht von Martin geliefert: mit **synthetischen** Daten + **Dummy**-Batteriekatalog arbeiten. **Keine ROI-Zahl als „echt" ausgeben**, bevor gegen einen echten Lastgang + echte Netzrechnung validiert wurde.
- Echter 12-Monats-Lastgang + Netzrechnung eines Bestandskunden (Validierungs-Gate).
- Leistungspreis-Systematik der 3 Netzbetreiber (Wiener Netze, Netz NÖ, Salzburg) → `billingModel`-Default.
- Batteriekatalog, CSV-Musterexporte (Netzbetreiber + Wechselrichter).
- **Parser-Einschränkung (BEHOBEN mit OP#4-Teillösung):** ~~`parser/detect.ts` erkennt genau EINE Zeitstempel-Spalte pro Zeile — ein Datum/Uhrzeit-Spaltenpaar wird nicht unterstützt.~~ Split-Timestamp (getrennte Datums- + Zeitspalte, Intervall-START) ist jetzt gebaut (`detectDateOnlyFormat`/`looksLikeTimeColumn`/`parseSplitTimestamp`, generisch für „Datum"/„Zeit von"/„Uhrzeit"). Der Demo-Bäcker bleibt bewusst kombiniert (Regressions-Grundlage). Details: s. OP#4-Teillösungs-Absatz unter „Stand & offene Entscheidungen".
- **Contract-Lücke (keine Blockade): Finanzierungsmodelle-Vergleichsansicht** (§3.9, Kauf vs. Subscription/Contracting). `AnalysisResult.perBattery` (§3.10) hat dafür noch KEIN Feld — bewusst nicht mitgebaut in Prompt 3.9, um den Contract nicht ohne vorherige Entscheidung zu erweitern (was genau enthält so ein Feld: monatliche Rate? Vergleichs-Break-even? beides?). ROI-Rechnung (`packages/engine/src/roi`) deckt bislang nur das Kauf-Modell (Einmalinvestment) ab. Vor dem Bau klären, welche Kennzahlen die Contracting-Ansicht braucht, dann Contract + Engine gemeinsam erweitern.

Details und der vollständige Stand: siehe `./Pflichtenheft_Kalkulator_MVP.md`, §8.

---

## Stand & offene Entscheidungen

> Lebendiger Handover-Anker. Neueste offene Punkte, die den Bau der Engine/Simulation berühren. Erledigtes wandert raus.

### Leistungspreis bei `monthly_max_sum`: Jahressatz ÷ 12 je Monat (23.09.2026)

Der Leistungspreis-Satz ist in ALLEN Abrechnungsmodellen ein Jahressatz (€/kW·a). Die Umrechnung
steht an einer Stelle, `packages/shared/src/demand-charge.ts` (`demandChargeKwPerYear`); Ist-Kosten,
Ersparnis und EAG-Grundpreis rechnen darüber, der Report rechnet den Satz darüber zurück
(`billedKwPerYear`, `apps/website/lib/pdf-report/basis.ts`). Befund und Belege:
`Leistungspreis_Einheiten_Bestandsaufnahme.md`.

**⚠ Beim nächsten Umbau mitzudenken: (a)** `billedKw` bleibt bei `monthly_max_sum` die SUMME;
wer `Kosten ÷ billedKw` rechnet, bekommt ein Zwölftel des Satzes. **(b)** Ein Teiljahr wird mit
12/beobachtete Monate hochgerechnet (sonst stünde ein 7-Monats-Betrag in einer `…PerYear`-Grösse
neben hochgerechneten Energie-Töpfen); ohne Mindestleistung sind die Leistungskosten von Summe
und Mittel damit gleich. Der D6-Jahreslauf deckt 12 Monate ab, dort ist der Faktor 1 — keine zweite
Hochrechnung (Test: `packages/engine/src/tariff/demand-charge.test.ts`). **(c) Mindestleistung
beim Summenmodell JE MONAT (23.09.2026):** abgerechnet wird Σ max(Monatsspitze, `minBillableKw`)
(`strategy.ts`). **⚠ Das Mittel-Modell legt den Sockel weiterhin an den MITTELWERT** — liegt die
Mindestleistung zwischen den Monatsspitzen, rechnen die beiden Modelle deshalb verschieden
(gemessen: Spitzen 11 × 20 + 200 kW, Sockel 30 → Summe 530/12 = 44,17 kW·a, Mittel 35 kW·a; Test
in `strategy.test.ts`). Liegt er über oder unter allen Spitzen, sind sie gleich. Ob das
Mittel-Modell ebenfalls je Monat greifen muss, hängt an der Netzbetreiber-Systematik (OP#3).

### Analyse ohne Speicherkandidaten ist ein gültiger Zustand — K3b-2 (23.09.2026)

`AnalysisResult.recommendation` ist **nullable**, daneben steht `noRecommendationReason`
(`'no_candidates'`). `recommendBattery` wirft auf leerem Katalog nicht mehr; Ist-Kosten, Spitzen und
der Tarifvergleich werden unverändert gerechnet. Fachliche Tiefe und die Messwerte:
`apps/web/CLAUDE.md`, Absatz `[GEBAUT: K3b-2 …]`.

**⚠ Was beim nächsten Umbau mitzudenken ist:**

**(a) `recommendation === null` heisst „leerer Katalog", NICHT „es rechnet sich keiner".** Der
zweite Fall ist der ältere: voller Katalog, `perBattery` gefüllt, eine Empfehlung, von der der
Report abrät. Beide Zweige stehen nebeneinander und sind am Contract unterscheidbar
(`perBattery.length`); der zweite ist in K3b-2 **nicht** angefasst worden.

**(b) Der Monatsvergleich kann jetzt ZWEI Reihen haben** (`spotWithBatteryEur` ist optional). Die
Bedingung dafür ist `perBattery.length === 0` und ausdrücklich nicht „kein Dispatch" — ein
Bestandsspeicher trägt die dritte Reihe auch bei leerem Katalog, und „es rechnet sich keiner"
erzeugt weiterhin gar keinen Vergleich. `tariffWayCosts` liefert `controlledEur`/`controlVariant`
gemeinsam als `null`; wer eine der beiden Grössen liest, prüft die andere mit.

**(c) Die Kapitelwahl des Reports hat jetzt `hasDetail`.** „Kostenverlauf und ein Tag im Detail"
war bis hierher das EINZIGE Kapitel ohne Prädikat. Ein künftiges Kapitel bekommt seines von Anfang
an — sonst steht es mit seinen Ersatzsätzen da, und einer davon war hier zugleich grammatisch
kaputt und sachlich falsch.

**(d) Der Speicherkatalog-Abruf hat als EINZIGER eine Frist** (`BATTERY_CATALOG_TIMEOUT_MS`, 3 s,
plus `retry(false)`). Grund: `postgrest-js` wiederholt einen gescheiterten GET dreimal mit 1/2/4 s
Backoff, und ein HÄNGENDER Abruf lief unbegrenzt. **Diese Frist gehört nicht auf `tariff-data/**`**
— dort werden bis zu 35.040 Preiszeilen seitenweise geholt.

### Zwei stille Mängel aus #295 behoben — CI wieder grün (23.09.2026)

Beide standen seit dem 21.09.2026 im roten DB-Gate, beide auch in Produktion gemessen
(Management-API), Korrektur in `20260923190000_fix_grid_tariff_messpreis_check_and_note.sql`:

**(a) `grid_tariffs_messpreis_check` liess einen Betrag OHNE Einheit durch.** Nicht vergessen,
sondern dreiwertige Logik: `messpreis_unit in (…)` ergibt bei `null` NULL statt FALSE, und ein CHECK
gilt als erfüllt, sobald sein Ausdruck NULL ist. Die Gegenrichtung (Einheit ohne Betrag) war nie
betroffen — diese Asymmetrie hat den Mangel unauffällig gemacht. **⚠ Wer künftig einen Paar-CHECK
schreibt, prüft BEIDE Richtungen echt gegen die DB; die Introspektion des Constraint-Texts sieht
richtig aus.** Vorher gegen Produktion gemessen: 9 Zeilen, 0 verletzende.

**(b) `create_grid_tariff` verlor die Notiz am Zeitfenster.** #295 hat die Funktion per DROP+CREATE
neu angelegt und dafür die Fassung aus **B21-2b** als Vorlage genommen — also die vor B21-2d, die
`note` noch nicht kannte. Die Messpreis-Parameter kamen dazu, `note` fiel dabei still heraus; der
INSERT lief weiter, die Notiz landete nur nirgends (in Produktion bestätigt). Der Zwilling
`backfill_grid_tariff` in derselben Migration war korrekt. **⚠ Eine per DROP+CREATE erneuerte
Funktion wird gegen die JÜNGSTE Fassung abgeglichen, nicht gegen die, aus der die Aufgabe stammt.**

Dazu vier Typfehler in Testdateien, die nie getypt wurden, weil der erste Fehler den Lauf abbrach
(`pnpm -r` hält an): `CalculatorPayload` aus `'shared'` statt `'engine'` importiert, fehlendes
`pv: null` im Payload-Fixture, unvollständige `PdfReportInput`/`PvOutageMonth`-Fixturen. Kein
Produktionscode beteiligt.

### Vorausschauende Ladesteuerung — „Zahl 2" gebaut, aber nur intern (21.09.2026)

`packages/engine/src/foresight/` rechnet den **vorausschauenden `controlValueEur`**: denselben
Fahrplan, aber die Tages-Rangfolge (`daily-price-order.ts`) sieht statt des gemessenen Netzbezugs
eine **Leave-one-out-Prognose aus der eigenen Historie des Kunden**. Ausgeführt wird weiterhin auf
dem echten Lastgang — eine Steuerung plant mit ihrer Erwartung und bezahlt die Wirklichkeit. Kein
zweiter Planer, kein zweiter Dispatch-Pfad; **kein Rendering, keine Oberfläche, kein
Analyse-Bündel.** Der Marker `basis: 'foresight_unvalidated'` reist mit der Zahl (Muster
`energyPriceBasis`). Fachliche Tiefe: `Pflichtenheft_Vorausschauende_Ladesteuerung.md`,
Messgrundlage `Vorausschauende_Ladesteuerung_Bestandsaufnahme.md`.

**~~Nur Weg c, nur ohne Leistungspreis~~ — seit 21.09.2026 WEG a, für alle Kunden:** `cap` und
`socFloor` kommen aus einem Rückblick-Lauf desselben Kunden und Zeitraums
(`simulation/peak-constraints.ts`, dieselbe Funktion wie `simulateBattery`); der Blocker
`demand_charge` ist entfallen. Getauscht bleibt allein die Verbrauchserwartung — **der Lauf ist
damit nur zur Hälfte vorausschauend, die Spitzenschutz-Seite ist perfektes Wissen**, und genau das
steht im Modulkopf. Verweigert werden weiterhin `standard_profile` (Muster und Wahrheit wären
dieselbe Formel) und eine fehlende echte Preiskurve; Weg b bleibt offen `[ANDREAS]`.

**⚠ Beim Lesen der Zahl mitzudenken (an einer synthetischen Leistungspreis-Last gemessen):**
`searchCaps` liefert die niedrigste tragbare Schwelle — bindet die daraus folgende Reserve fast die
ganze Batterie (Plateau-Last, `socFloor` max 25,8 von 30 kWh), wird die Zahl gegenüber der Prognose
unempfindlich: `realizationRatio` exakt 1,000, obwohl sich die Preis-Untergrenze in 420 von 480
Intervallen unterscheidet. Bei kurzer Spitze (`socFloor` max 8,0 kWh) schlägt dieselbe Prognose
durch (0,955). **Eine 1,000 ist hier zuerst ein Hinweis auf eine gebundene Batterie, nicht auf eine
perfekte Prognose.**

**⚠ Die Eimer-Einteilung `month` ist `[ANNAHME, vorläufig]` und revisionspflichtig**
(`DEFAULT_CONSUMPTION_PATTERN_SCHEME`); alle drei zulässigen Schemata sind als Parameter rechenbar,
`weekday_month` ist ausgeschlossen. Die Wahl wartet auf einen **gewerblichen** Lastgang `[MARTIN]` —
gemessen ist sie an einem Haushalt, bei dem die Wochentagsachse nichts trägt.

**Am echten Urbanz-Fall gemessen** (Cloud-Entwurf 13,081 ct / 3,50 €/Monat / 4,56 ct, echte
`grid_tariffs`/`spot_prices`, 209 Tage, Bestandsspeicher 19,2 kWh): Zahl 1 **201,99 €**, Zahl 2
(`month`) **200,86 €**, `realizationRatio` **0,994**. **⚠ Das belegt die Prognosegüte NICHT.**
Derselbe Lauf mit dem trivialen Vorhersager ergibt 200,62 €, mit einer Null-Prognose 200,15 € — die
ganze Spanne zwischen vollem Rückblick und gar keiner Prognose ist **1,84 €**. Ohne Tages-Rangfolge
fällt derselbe Posten dagegen auf **77,60 €**. Der Fahrplan hängt hier also fast nur am PREIS; der
Speicher ist gegenüber 20,5 kWh Tagesmittel (Sommer 2–7 kWh) so gross, dass die beiden Schranken
selten binden. **Eine aussagekräftige Zahl braucht einen Kunden mit knappem Speicher.**

### B24 Teil 1 — Dateneingabe-Wizard (aktueller Stand, 15.09.2026, Live-geprüft)

Admin-geführter Wizard unter `/admin/kalkulator-projekte/[id]/dateneingabe`: Segment (Privat/Betrieb) → Anzahl Zählpunkte → je Zählpunkt fünf Stationen. Alle fünf vollständig, in allen Wegen:

- **Lastgang**: Datei hochladen ODER Standardprofil aus Jahresverbrauch; entfernen/neu hochladen.
- **Rechnung**: mehrere Rechnungen lesen/zusammenführen (Widerspruch bleibt leer, wird benannt)/einzeln zurücknehmen, manuelle Eingabe mit Netzbetreiber-Preisblatt-Vorschlag, oder ausdrücklich ohne Rechnungsdaten fortfahren (`invoiceSkipped`). **⚠ Die Handeingabe hat bis zum 22.09.2026 nur GESCHRIEBEN, nie zurückgelesen** — wer Werte eintrug und die Station verliess, stand bei der Rückkehr vor einem leeren Formular, obwohl der Entwurf alles trug (die Zusammenfassung darüber hängt an den gelesenen RECHNUNGEN, nicht am Entwurf, und zeigte es deshalb auch nicht). Gegenrichtung ist jetzt `readManualTariffDraft`; der Block klappt bei erfasstem Stand offen auf.
- **Batterie**: Freitext, Datenblatt-Scan, Marke/Typ-Websuche mit Quellenbeleg-Pflicht; löschbar, Frage erscheint danach neu. **⚠ „Ja" OHNE Kenndaten ist ein gewollter Zustand** (`{hasBattery: true}` allein) — bis zum 22.09.2026 blendete die Sichtbarkeitsbedingung dabei aber die vier Kenndatenfelder aus, weil `batteryDraftIsEmpty` schon durch `hasBattery` falsch wird; das von der Station selbst gegebene Versprechen „lassen sich hier jederzeit nachtragen" war nur über den Umweg „Batterie-Angaben löschen" einlösbar. Das Formular folgt jetzt `showValueForm` statt der Ja/Nein-Weiche.
- **PV**: Erzeugungsprofil hochladen, Anlagendaten (Freitext/Datenblatt, mehrflächig) oder PVGIS-Generator aus Standort+Anlagendaten; einzelne Modulfläche UND die ganze PV-Angabe löschbar.
- **Tarif**: kein "Tarif behalten" mehr — der Vergleich mit aWATTar läuft immer automatisch; optional ein selbst gefundener zweiter Vergleichstarif, löschbar.

Nach der Tarif-Station des letzten Zählpunkts: ein "Fertig"-Abschluss mit Hinweis auf die KI-Energieprüfung + Link zurück zur Projektseite — die früheren Platzhalter "KI-Check"/"Abbruchprüfung" sind vollständig entfernt.

`retail_tariffs` (Lieferanten-Tarifkatalog, Betrieb+Privat, Admin-Pflege unter `/admin/lieferanten-tarife`) existiert als Schema+UI, wird von der Tarif-Station aber NICHT gelesen — bewusste Entscheidung gegen einen Katalog-Vergleich, nur der eine selbst gefundene Tarif zählt.

**Der Energieberater** (Kachel "KI-Prüfung" auf der Projekt-Übersichtsseite, Popup): eigenständiges Gespräch (`kind: 'ki_check'`, getrennt vom Kunden-Chat, eigener System-Prompt über `/admin/ki-prompts` admin-pflegbar). Startet automatisch beim ersten Öffnen. Prüft `check_data_consistency` (Zeitraum-Abgleich, interne Lücken) plus eigene fachliche Einschätzung der Plausibilität (Batterie-/PV-Grösse, Tarifwerte, Auffälligkeiten). Spricht in Sie-Form, nennt keine internen Bezeichner und keine Personennamen. Bestätigungen ohne Datenänderung werden genauso festgehalten wie Annahmen (über `flag_open_question`) — ein späterer Lauf fragt nicht erneut nach bereits geklärten Punkten.

**Projekte sind vom Admin löschbar** (Papierkorb auf der Projektkarte, `admin_delete_project` — kaskadiert auf Nachrichten/Dokumente/Rückfragen/Zählpunkte, Storage-Bytes werden vorher einzeln entfernt).

⚠ **Ein loser Faden:** die Migration zu `admin_delete_project` wurde mangels funktionierendem CLI-Zugang direkt über den Supabase-SQL-Editor in der Cloud angelegt, NICHT über `supabase db push`. Sie fehlt deshalb in Supabase's eigener Migrations-Historie. Der nächste `supabase db push` könnte auf dieser einen Datei mit "existiert bereits" scheitern — dann die Datei einmalig überspringen oder die Historie von Hand nachtragen, nicht neu anlegen.

### Jahres-Hochrechnung als eigenes Kapitel — geschätzt ist der LASTGANG (22.09.2026)

Neues, bedingtes Report-Kapitel **„Was wäre, wenn wir ein ganzes Jahr hätten?"** direkt hinter den
fünf Wegen, bei `coveredDays < 365` für jeden Kunden. Der Weg dorthin ist bewusst nicht die
naheliegende Streckung der Ersparnis-Zahlen: aus der **verbrauchsstärksten zusammenhängenden Woche**
des echten Lastgangs (`findReferenceWeek`) wird ein vollständiger 365-Tage-Lastgang gefüllt
(`buildSyntheticYearProfile`, jeder fehlende Tag bekommt den ECHTEN Viertelstundenverlauf desselben
WOCHENTAGS), und darauf läuft ein **zweiter, unveränderter `computeAnalysis`-Lauf** — Dispatch,
Ladesteuerung und Spitzenkappung eingeschlossen. Fachliche Tiefe:
`Pflichtenheft_Kalkulator_Delta_Report-Baukasten.md`, „D6 Teil 3 umgesetzt".

**⚠ Was beim nächsten Umbau mitzudenken ist:**

**(a) Die Referenzwoche ist NICHT die kälteste, sondern die stärkste** — und das ist eine bewusste
Abweichung von der ursprünglichen D6-Fassung: eine Auswahl nach Kalendermonat unterstellt einen
heizlastgetriebenen Kunden und wählte für einen Kühlhaus-Betrieb die schwächste Zeit. Keine
Wetterannahme, keine Verbrauchertyp-Kategorie.

**(b) Die gefüllten Tage tragen ECHTE Messwerte, nicht skalierte.** Daraus folgt, dass die PV-Wirkung
mitreist (bei bestehender Anlage steckt sie im Netzbezug) — es braucht **keine** zweite
PVGIS-Schätzung, und es darf auch keine geben. Eine mitgelieferte Brutto-PV-Reihe wird nach
DEMSELBEN Plan verlängert; getrennte Zuordnungen brächten Netzbezug und Erzeugung aus verschiedenen
Tagen zusammen.

**(c) Das Fenster hängt an Grenzen, die die ENGINE nicht kennen darf.** 365 Tage innerhalb
`[Preisanker 01.01.2025, gestern]`, gewählt wird das spätestmögliche. Die Grenzen kommen als
`SyntheticYearBounds` herein; die Uhr liest `run-from-draft.ts`, nicht der Rechenkern. Passt kein
Fenster, kommt `no_window` zurück — es wird **nichts zurechtgeschnitten**.

**(d) Es wird NICHTS genähert.** Deckt der Preisbestand das Jahresfenster nicht, entfällt das Kapitel
(`not_computable`). Das Nachladen/Nähern gibt es weiterhin nur im parallelen Weg
`projectAnnualTariffComparison` (D6 Teil 2b, `annualProjection`) — die beiden Contract-Felder
beantworten verschiedene Fragen und sind **nicht** gegeneinander austauschbar.

**(e) Weg 5 steht im Ersparnis-Kasten, nicht in der Kostentabelle**, und der Kasten ist die **einzige
Stelle im ganzen Report, an der Weg 5 addiert werden darf** (dort sind alle Zahlen Jahresgrössen —
im Kapitel davor ausdrücklich nicht). **Keine der Zahlen erreicht die Ersparnis-Spanne der
Zusammenfassung** (D8): `summary.ts` liest `annualScenario` nirgends, ein Test pinnt die
Bit-Gleichheit der Kopfzahlen mit und ohne Szenario.

**(f) Kein Chart** — eine zyklisch wiederholte Woche als Heatmap sähe aus wie ein gemessener
Jahresgang.

**(g) Neu geteilt: `tariffWayCosts` (`shared`)** entscheidet jetzt für BEIDE Läufe, welche Reihe des
Monatsvergleichs welcher Weg ist; `primaryBatteryEntry` (`shared`) ebenso für „wessen Speicher".
`summaryWaysOf`/`primaryEntryOf` delegieren dorthin — Verhalten unverändert, die bestehenden
Wege-Tests sind unberührt grün.

**Noch nicht gemessen:** das Kapitel ist gegen synthetische Lastgänge und ein gerendertes PDF
geprüft (18 statt 17 Seiten, Text und Tabelle gelesen), **nicht gegen den Urbanz-Fall über den
Produktionspfad** — s. Regel 11.

### Inhaltsverzeichnis mit Unterpunkten, „Unser Vorschlag" vorgezogen, Lastgang-Kennzahlen (22.09.2026)

Drei unabhängige Änderungen am PDF-Report; fachliche Tiefe:
`Pflichtenheft_Kalkulator_Delta_Report-Baukasten.md`, „D9 Nachtrag umgesetzt".

**(1)** „Unser Vorschlag" steht jetzt VOR „Methodik & Vorbehalte". **(2)** „Ihr Lastgang" trägt
unter dem Diagramm drei Kennzahlen (`apps/website/lib/pdf-report/load.ts`): Gesamtverbrauch,
Ø Tagesverbrauch, Lastfaktor — keine neue Datenquelle, und die Spitzenleistung ist
`current.annualPeakKw`, WIEDERVERWENDET von der Voraussetzungs-Seite. **(3)** Die TOC-Unterpunkte
kommen aus einer gemeinsamen Struktur (`ChapterSubsections`, `content.ts`): ein Kapitel MELDET seine
Unterabschnitte, und zwar aus derselben Liste, aus der es sie rendert. Gilt für beide heutigen
Kapitel mit Unterabschnitten und für jedes künftige, ohne dass `buildReportAgenda` es kennt.

**⚠ Beim nächsten Umbau mitzudenken: (a)** ein bedingter Abschnitt steht im Verzeichnis genau dann,
wenn er gerendert wird — die Bedingung wird am GEBAUTEN Kapitel abgelesen, nicht zweitformuliert.
**(b)** Das Schlusskapitel wird seither EINMAL je Durchlauf gebaut und an Agenda und Kapitel
gereicht; `selectedNotice` ist entfallen, weil die Baukasten-C-Auswahl schon im Kontext greift.
**(c)** Ein Agenda-Unterpunkt verlangt eine Überschrift im Kapitel — die Herkunft der Tarifsätze
hat dafür eine bekommen, und ihre Sätze beginnen nicht mehr mit „Tarifsätze:" (der Bildschirmweg
behält sein Präfix). **(d)** Gemessen am erzeugten PDF (18 Seiten, beide Durchläufe gleich), der
Lastfaktor zusätzlich gegen eine Handrechnung — **nicht** gegen den Urbanz-Fall über den
Produktionspfad (s. Regel 11).

### Kapitel „Ihre PV-Anlage" — rekonstruiert, nicht gemessen (22.09.2026)

Neues, bedingtes Report-Kapitel hinter der Jahres-Hochrechnung: **was die BESTEHENDE PV-Anlage über
den Zeitraum wert war**. Der Lastgang eines Netzbetreiber-Exports beantwortet die Frage „was wäre
ohne die Anlage gewesen?" strukturell nicht — die Eigenversorgung steht dort nur als gesenkter
Bezug. Gerechnet wird deshalb ein zweiter Lastgang (`Netzbezug + geschätzte Erzeugung`), und
**beide Seiten gehen durch dieselbe Tarifkosten-Funktion**, aus der auch „Ihr Tarif heute" entsteht.
Contract `AnalysisResult.pvValue`; fachliche Tiefe:
`Pflichtenheft_Kalkulator_Delta_Report-Baukasten.md`, „D5 Teil 2 umgesetzt".

**⚠ Was beim nächsten Umbau mitzudenken ist:**

**(a) Es ist die GEGENRICHTUNG zu `pv_already_in_grid_profile` und kein Widerspruch dazu.** Dort
wird die PVGIS-Schätzung NICHT abgezogen (sie steckt im Bezug bereits); hier wird sie addiert. Der
gerechnete Lastgang aller übrigen Zahlen bleibt unberührt — die Rekonstruktion verlässt das
Contract-Feld nicht, und ein Test pinnt das mit. **`run-from-draft.ts` liest die abgelegte
Erzeugungsreihe seither AUCH im abgelehnten Fall** — genau in diesem einen, nicht bei
`measured_feed_in`.

**(b) Die Bedingung wird am bereits gefallenen Urteil abgelesen**, nicht neu formuliert: kein
zweites `hasPv && source === 'import_only'`. Bei GEPLANTER Anlage und bei gemessener Einspeisung
entfällt das Kapitel von selbst; der Einspeise-Fall (direkter, gemessener Wert möglich) ist ein
bewusst offener Sonderfall.

**(c) Ausfallmonate (`detectPvOutageMonths`) bekommen 0 Erzeugung — EINMAL gesetzt**, bevor addiert,
summiert oder ins Jahr verlängert wird. In den Monatsbalken tragen sie `null` statt eines
Nullbalkens.

**(d) Die Jahreszahl läuft über EINEN `buildSyntheticYearProfile`-Aufruf**, nicht zwei: der Baustein
wählt die Referenzwoche nach dem höchsten Verbrauch, und zwei Läufe könnten verschiedene Wochen
wählen — die Differenz enthielte dann einen Anteil aus der Auswahl statt aus der Anlage. Das Fenster
kommt aus dem Kapitel davor (`annualScenario`); ohne das gibt es keine Jahreszahl und **es wird
nichts genähert**.

**(e) Der PV-Wert gehört in KEINE Ersparnis-Spanne (D8)** — er ist bereits gehoben und steckt in den
Ist-Kosten.

**(e2) Der Befund steht GENAU EINMAL ausführlich, und wo, hängt am Kapitel (Nachtrag 22.09.2026).**
Gibt es das PV-Kapitel, zeigt der Satz der Zusammenfassung dorthin und der Hinweis in „Annahmen und
Datengrundlage" kürzt sich auf die betroffenen Monate plus einen Zeiger; sonst bleibt beides
wortgleich wie zuvor. **Dafür ist der Absatz `pv_value_finding` als 26. Baustein in die Registry
gewandert** — ohne einen Katalog-Eintrag kann ein Verweis auf ein Kapitel gar nicht auflösen
(`WAYS_SECTION` benennt genau diese Bedingung). Der Halbsatz hängt weiterhin am BEFUND und nicht am
Kapitel: ohne auffälligen Monat gibt es das Kapitel sehr wohl, den Satz aber nicht.

**(f) `pvValue` steht von Anfang an in `reduceAnalysis`** und in dessen Prüfung — der Fehler aus
#320 (ein optionales Feld fällt in der Verengung still weg) ist diesmal vorweggenommen, nicht
repariert.

**Noch nicht gemessen:** geprüft gegen synthetische Lastgänge und ein gerendertes PDF (16 statt 15
Seiten), Chart über einen esbuild+jsdom-Harness — **nicht gegen den Urbanz-Fall über den
Produktionspfad** (s. Regel 11).

### Report-Baukasten — das Wege-Kapitel führt FÜNF Wege (21.09.2026)

D7 ist auf die Revision vom 21.09.2026 umgestellt (`Pflichtenheft_Kalkulator_Delta_Report-Baukasten.md`
D7, Abschnitt „D7 umgesetzt"): 1) Ihr Tarif heute · 2) der selbst gefundene Vergleichstarif · 3)
aWATTar ohne Steuerung · 4) aWATTar mit **vorausschauender** Ladesteuerung · 5) Lastspitzenkappung.
**Jeder Weg steht nur da, wenn er zutrifft**; der Kapiteltitel zählt sie (`waysSectionTitle`), Agenda
und Überschrift aus derselben Zahl.

Neu in der Engine: `TariffParams.comparisonSupplier` (der Vergleichstarif aus der Wizard-Station
reist jetzt bis in den Rechenkern, `draft-mapping.ts`) und zwei Reihen auf
`MonthlyTariffComparison` — `comparisonTariffEur` (Weg 2) und `spotWithPredictiveControlEur`
(Weg 4, aus `computePredictiveControlValue`). **Bündel-Fassung 8.**

**⚠ Drei Dinge, die beim nächsten Umbau mitzudenken sind: (a) Weg 5 ist KEIN Balken und steht
NICHT in der D8-Spanne** — Jahres-Ersparnis gegen Zeitraum-Kosten, zwei Einheiten auf einer Achse;
der Absatz sagt das selbst. **(b) Ein BRUTTO eingetragener Vergleichstarif lässt Weg 2 entfallen**
statt durch einen geratenen Steuersatz zu teilen (Muster `tou.ts`, `kind: 'price_basis'`).
**(c) Weg 4 macht die Kopfzahl der Zusammenfassung konservativer**, weil die vorausschauende Zahl
die Bestmarke nicht übertreffen kann; `realizationRatio` steht bewusst nicht im Kundenreport, der
Hinweistext dazu ist ein `[ENTWURF]` (`PREDICTIVE_NOTE`, `ways.ts`) und wartet auf Andreas.

**Beschriftung und Chart-Optik des Wege-Kapitels (21.09.2026, Nachtrag):** Die gesteuerte Reihe
heisst jetzt ÜBERALL `CONTROLLED_WAY_LABEL` = „aWATTar mit Ladesteuerung" (`lib/report-copy.ts`,
Wortlaut aus dem Urbanz-Zielbild) — Wege-Kapitel, Monatsvergleich-Legende, Detail-Tabelle und die
Bildschirm-Karte. Vorher hing sie am Fall („aWATTar mit" + Possessivum) und trug im Monatsvergleich
zusätzlich „(Ladung optimiert)": **derselbe Gegenstand mit drei Beschriftungen in einem Dokument.**
`monthlyBatteryRef` bleibt für den FLIESSTEXT, wo ein Satz den Dativ auch tragen kann;
`buildMonthly` hat seinen `isExisting`-Parameter dadurch verloren.

Das Balkendiagramm (`tariff-ways-chart.tsx`) hat drei Angleichungen ans Zielbild bekommen:
Wertelabels fett über den Balken, rotierter Achsentitel „Kosten über N Tage (netto, EUR)" (N kommt
aus `WaysChapter.coveredDays`, nicht neu gebildet) und mehrzeilige, zentrierte Kategorielabels.
**⚠ Umbrochen wird an der BALKENbreite, nicht an der Spaltenbreite** — die Zeichenbreite ist im SVG
erst nach dem Satz bekannt, die Komponente muss davor entscheiden, und 6 px/Zeichen bei Inter 11 px
ist die Schätzung dafür. **⚠ Die Wertelabels tragen `formatEur` („€ 1.061") und nicht die
Schreibweise des Zielbilds („€1.061")** — zwei Euro-Schreibweisen in einem Dokument wären schlimmer
als eine Abweichung um ein Leerzeichen vom Referenzbild; wer das ändern will, ändert `formatEur`
für den ganzen Report.

**⚠ Der Wege-Chart hängt heute NUR am PDF-Pfad.** `TariffWaysChart` hat genau einen Aufrufer
(`charts.tsx`); der Bildschirm-Report zeigt das Wege-Kapitel nicht. D2 ist damit strukturell
erfüllt (eine Zeichenimplementierung), aber ein Bildschirm-Gegencheck ist heute nicht möglich —
gemessen wird die Komponente über einen esbuild+jsdom-Harness im Scratchpad.

**⚠ Kein `⚠` in Kundentext des PDF-Reports** — die Report-Schrift trägt das Zeichen nicht, es
verschwindet beim Rendern spurlos (am erzeugten PDF gemessen, 21.09.2026). Und `monthlyBatteryRef`
liefert eine DATIV-Fügung („der empfohlenen Batterie"): sie trägt nur nach „mit", nicht als
Satzsubjekt.

### Report-Baukasten — Kapitel 1 ist die „Zusammenfassung" (19.09.2026)

Das erste inhaltliche Kapitel des PDF-Reports heisst nicht mehr „Kernergebnisse" und trägt die Form von Seite 2 des Urbanz-Zielbildes: **zwei Kopfzahlen** (Ihre Stromkosten heute · Mögliche Ersparnis als Spanne), ein **Fliesstext** (was der Kunde hat, wie viele Wege es gibt), ein **PV-Satz** nur bei angegebener Anlage, und der teal Kasten **„Ausserdem schon geklärt"**. Fachliche Tiefe: `Pflichtenheft_Kalkulator_Delta_Report-Baukasten.md` D8.

**⚠ Drei Bausteine sind ersatzlos entfallen** (`savings`, `peak_shaving`, `load_shift`) — der Katalog hat 25 statt 28 Kennungen. Das ist die Ein-Spanne-Regel: vier Euro-Grössen nebeneinander, von denen drei nicht addiert werden durften. **Benannte Folge: der Spitzenkappungs-BETRAG steht danach in keinem Kapitel mehr** (die Kapp-Aussage unter dem Lastgang-Diagramm bleibt, sie beziffert nichts). Der Ladesteuerungs-Betrag ist erhalten — `load_control` hat seine Kopfzahl zurück, weil der Abschnitt sonst die Herkunft einer Zahl erklärte, die es nicht mehr gibt.

**Was daraus für jeden Umbau am Report folgt:** die Kopfzahlen und die zwei Textblöcke stehen bewusst NICHT in der Registry — sie sind keine der vier Formen, die `document.tsx` rendert. Ihre Querverweise lösen über einen unbekannten Ursprung auf und nennen deshalb das Zielkapitel beim Namen statt einer Richtung. Wer einen davon zum Baustein machen will, braucht zuerst eine fünfte Form.

**Neu in der Übergabe:** `report_input_meta.pvPeakPowerKwp` (Summe über die erfassten Modulflächen, `null` sobald einer Fläche die Nennleistung fehlt) — eine ANGABE für einen Halbsatz, keine Rechengrösse.

**Am Urbanz-Fall über den PRODUKTIONSPFAD gemessen** (`run-from-draft.ts`, 209 Tage, Cloud-Entwurf `_provenance.source: measured` vom 19.09.2026, echte `grid_tariffs`/`spot_prices`): Kapitel 1 zeigt **€ 1.022 Ist-Kosten** (gerechnet 1.021,89) und eine **Ersparnis-Spanne € 59 – € 261** — **zwei tragende Wege**, weil der reine Tarifwechsel mit **+58,55 €** positiv ist und die Ladesteuerung ihn auf 260,54 € hebt. `formatEur` rundet auf ganze Euro; die Spanne entsteht aus `positiveWays` (summary.ts), das beide Wege behält, sobald beide über null liegen. Die Zahlen des Zielbildes (€1.061, €53–€207) stammen aus einer Handrechnung und sind weiterhin nicht reproduziert — sie liegen dem gemessenen Stand seither aber nahe.

**⚠ KORREKTUR 21.09.2026 — hier stand „€ 770 Ist-Kosten, € 84 mögliche Ersparnis, eine Zahl statt einer Spanne, weil der reine Tarifwechsel bei diesem Kunden negativ ist".** Diese Aussage beschrieb einen Stand vor **#293** (PV-Kopplung), **#295** (fünf Abgabenposten) und **#296**, und sie war mit der **Kalibrier-Fixture des öffentlichen Rechners** (9,5 ct/kWh, keine Lieferanten-Grundgebühr, Einspeisung 0) gerechnet statt mit dem Cloud-Entwurf (13,081 ct) — s. Regel 11. Mit dem echten Arbeitspreis **kehrt sich das Vorzeichen des Tarifwechsels um**, und aus dem Einzelwert wird eine Spanne. Wer die alte Aussage irgendwo zitiert findet, prüft zuerst den Parametersatz.

### Fünf fehlende Kostenposten im Tarifvergleich (21.09.2026)

Der Vergleich rechnete bis hierher nur Arbeitspreis, Netz-Arbeitspreis, Netzverlust,
Netz-Grundpreis und die beiden Lieferanten-Grundgebühren. Neu dazu, alle in der **gemeinsamen,
tarifübergreifenden Schicht** und damit in allen drei Reihen gleich: **Messpreis** (neue,
nullable Spalte `grid_tariffs.messpreis_amount`/`_unit`, Migration
`20260921120000_add_grid_tariff_messpreis.sql`), **Elektrizitätsabgabe**, **EAG-Förderbeitrag**,
**EAG-Pauschale** und **Gebrauchsabgabe** (6 % → 7 % ab 01.03.2026, **nur auf den Netzpreis**:
Netznutzung + Netzverlust + Netz-Grundpreis + Messpreis, ausdrücklich nicht auf Arbeitspreis,
Lieferanten-Grundgebühr oder die übrigen Abgaben).

Die vier Verordnungssätze liegen als versionierte Code-Konstanten in
`packages/shared/src/levies.ts` (Muster `supplier-tariffs.ts`), aufgelöst an den Rändern
(`apps/website/lib/tariff-pricing.ts`, `apps/web/lib/admin/analysis-tariff-inputs.ts`) und als
Pflichtfeld `TariffPricingInputs.levies` in den Rechenkern gereicht. Anleitung und Stichtage:
`DEPLOYMENT.md` §3a-bis.

**⚠ Was daraus für jeden Umbau folgt:** (a) **Was nicht belegt ist, wird nicht gerechnet, sondern
verweigert** — fehlt für eine Kombination aus Netzbetreiber/Netzebene/Zeitraum ein Satz, entsteht
kein Abgabenzeitraum und der ganze Börsenpreis-Vergleich fällt mit benannter Lücke aus (neue
Blocker-Seite `side: 'levy'`). Konkret: **NE 3–6, Netz NÖ, Salzburg Netz und ab 01.01.2027 ALLE**
rechnen den Vergleich heute nicht. (b) Die Posten dürfen **nie** an `currentTariffEur` hängen —
sonst stünde die spätere „Drei Wege"-Gegenüberstellung auf zwei Massstäben. (c) `LEVIES_NONE` ist
ein Test-Hilfsmittel; ein Wächter in `packages/shared/src/levies.test.ts` hält es aus jedem
Rechenweg heraus.

**Am echten Urbanz-Fall über den PRODUKTIONSPFAD gemessen** (`run-from-draft.ts`, 209 Tage,
Cloud-Entwurf `_provenance.source: measured` vom 19.09.2026, echte `grid_tariffs`/`spot_prices`):
Ihr Tarif heute **948,62 € → 1.021,89 €**, aWATTar ungesteuert **890,07 € → 963,34 €** (beide
+73,27 €, identischer Massstab), aWATTar mit Speicher **685,85 € → 761,35 €** (+75,50 € — die
Ladeverluste erhöhen die bezogene Energiemenge, an der die ct/kWh-Abgaben hängen). Der
Netto-Disclaimer in `basis.ts` benennt jetzt die Umsatzsteuer statt der behobenen Posten und hängt
an derselben Bedingung wie die Monatszahlen selbst.

**⚠ KORREKTUR 21.09.2026 — hier standen 769,73 € → 843,00 €, und das war NICHT der Urbanz-Live-Wert.**
Die Zahlen stammten aus der **Kalibrier-Fixture des öffentlichen Rechners** (9,5 ct/kWh, keine
Lieferanten-Grundgebühr, Einspeisevergütung 0) — dem Parametersatz, der den Report-Screenshot
reproduziert, nicht dem Cloud-Entwurf (13,081 ct, 3,50 €/Monat, 4,56 ct). Nur Lastgang und
Preisdaten waren live; die Tarifseite war von Hand gesetzt, und der Bericht nannte das nicht.
**Der Fehler blieb über mehrere Nachrichten unentdeckt, weil die beiden Parametersätze im selben
Rechenweg auf 4 Cent zusammenfallen** (gemessen: 8,94 ct + Entwurfsgebühren = 842,96 € gegen
9,5 ct ohne Gebühren = 843,00 €; 24,20 € Energiedifferenz gegen 24,16 € anteilige Grundgebühr über
209 Tage). Die Fixture-Zahl sah dadurch aus wie ein bekannter Bug-Wert. Daraus folgt **Regel 11**.

⚠ Die beiden aWATTar-Reihen sind in BEIDEN Parametersätzen identisch und deshalb unverändert
geblieben: sie hängen an keinem Lieferantenpreis, und der Urbanz-Lastgang trägt keine Einspeisung.

### PV-Kopplung: kein Abzug mehr, wo die Anlage schon im Bezug steckt (19.09.2026)

Für `source: 'import_only'` bei einem Kunden mit vorhandener PV-Anlage (`hasPv === true`) wird die geschätzte PVGIS-Erzeugung **nicht mehr vom Lastgang abgezogen** (`pvGeneratorEligibility`, dritte Prüfung, Grund `pv_already_in_grid_profile`). Ein Netzbetreiber-Export misst am Anschlusspunkt — die Eigenversorgung ist dort als gesenkter Bezug bereits enthalten. Am echten Urbanz-Fall: 5.212,67 kWh abgezogene Erzeugung gegen 4.321,17 kWh gemessenen Netzbezug über 209 Tage (das 1,21-fache); der gekoppelte Lastgang ersetzte dabei den echten für **alle** Rechnungen, weshalb schon Kapitel 1 falsche Kopfzahlen trug.

**Was bleibt:** die Reihe wird weiter erzeugt und abgelegt (sie ist die Eingabe der künftigen „ohne PV"-Vergleichsrechnung des PV-Kapitels, die **addiert** statt abzuziehen); `standard_profile` ist ausdrücklich unberührt; der öffentliche Rechner (`apps/website`) erhebt die Frage „haben Sie schon PV?" gar nicht und verhält sich deshalb unverändert — **offener Punkt**, s. `Pflichtenheft_PV_Zeitreihengenerator.md` §2.4.

**Nächster grosser Schritt: der übrige Report-Baukasten (Teil 3)** — die weiteren Zielseiten (Voraussetzungs-Seite, Drei-Wege-Seite, PV-Kapitel, Jahres-Hochrechnung) sind unangetastet.

**Weiterhin nicht gebaut:** Engine-Anbindung des Wizard-Entwurfs (rechnet nichts), Rollup-Schicht über mehrere Zählpunkte, Fragenkatalog-Inhalte, eigene Kostenbremse für den Energieberater-Endpunkt (teilt sich die des Kunden-Chats), ein Erzeugungsprofil zu ersetzen/entfernen (nur einzelne Fläche geht), echter PVGIS-Aufruf nur gemockt verifiziert, echter Batteriekatalog (**seit K3b, 23.09.2026, rechnet der ÖFFENTLICHE Rechner gegen `public.battery_catalog` — 31 freigegebene Gewerbe-Geräte; für `heim` ist noch keines freigegeben, ein Haushalt bekommt seit K3b-2 deshalb eine Analyse OHNE Speichervorschlag statt gar keiner. seit K3c rechnet auch der Wizard-Pfad (`apps/web`/`extractors`) gegen den echten Katalog, `DEMO_BATTERY_CATALOG` liegt nur noch als Prüf-Fixture unter `shared/fixtures`**), ein Lauf über die echte Oberfläche für die meisten B24-Schritte (durchgängig nur Typen/Logik/Wächter bzw. jsdom-Harness geprüft — **Ausnahmen seit 22.09.2026: Rechnung- und Batterie-Station**, `apps/web/e2e/{rechnung,batterie}-station.mjs`).
