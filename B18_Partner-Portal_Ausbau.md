# B18 — Partner-Portal-Ausbau

**Sitzungsstart-Dokument.** Repo: `github.com/andi1180/peak-shaving`, lokal
`/Users/bf/Developer/peak-shaving`. Stand: 27.07.2026, verifiziert gegen `main`.

---

## ZUERST LESEN

1. `Fahrplan_2026.md` — kanonische Quelle. B10–B17 sind vergeben, **B18 ist frei**.
2. `CLAUDE_PEAKSHAVING.md` — Arbeitsregeln, u. a. **Arbeitsregel 5** (SECURITY-DEFINER-Funktion
   nie ohne Grant aufrufen, um fehlenden Zugriff zu beweisen — schiesst Postgres ab).
3. `DEPLOYMENT.md` §9 — Mailversand, Absender, Auth-SMTP-Fallstricke.
4. `apps/web/CLAUDE.md` — Handover-Log der bauenden App.

---

## AUSGANGSLAGE (gebaut, gemergt, live)

**B16 — Partner-Attribution, vollständig:**
- `platform.partners` (Slug als PK, `^[a-z0-9-]+$`, kein DELETE-Grant, `user_id` UNIQUE nullable,
  `application_id`, `notified_at`)
- `platform.partner_applications` (Insert-Guard: kein Antrag ohne aufgelöstes Konto)
- `leads.partner_slug` (bestätigte Zuordnung) + `leads.referred_by_text` (Freitext des Kunden) —
  bewusst getrennt: Urteil vs. Beobachtung
- `/partner/[slug]` Landingpage (noindex, nicht in Sitemap, 404 bei unbekannt/inaktiv)
- `/partner-werden` öffentliche Bewerbung (indexierbar, in Sitemap)
- `/partner-portal` (Login-geschützt, zeigt Link + 2 Vorlagen)
- `/admin/partner`, `/admin/partner-antraege` inkl. Genehmigung mit Slug-Vorschlag

**B17 — Admin-Portal:** eigener Eingang `/admin/anmelden`, eigener Rahmen, zwei Root-Layouts
ohne gemeinsames Elternteil (verhindert Bundle-Leak der Admin-Aktionsnamen ins anonyme HTML).
Guard leitet auf `/admin/anmelden` mit `next` (Pfad kommt per `x-admin-pathname` aus der Middleware).

**B10 — Kalkulator** hinter `calculator_pro`-Entitlement. Vergabe heute ausschliesslich über
Admin-Gutscheincodes (`CODE_PRODUCT_KEYS`). Kein Stripe-Preis, kein Selfservice.

**Betrieb:** Auth-SMTP auf Resend umgestellt, Rate-Limits erhöht, Turnstile-Schlüssel gesetzt.

---

## DAS PROBLEM

Wochenendtest mit einem echten Fachbetrieb: Das Onboarding ist zu umständlich. Der Bewerber muss
sein Konto bestätigen, **bevor** er weiss, ob er überhaupt angenommen wird — und bekommt danach
eine zweite Mail. Verifiziert im Code: `submitPartnerApplicationAction` ruft
`createAccountWithConfirmation({ next: KONTO_HREF })`, die Bestätigungsmail geht sofort raus.

---

## B18 — SECHS TEILSCHRITTE

### B18-1 — Subdomain `partner.coolin.at` (ZUERST)

**Status: gebaut, gemergt, live.** PR #54 (Basis: Host-Weiche, Indexierungssperre) +
Korrektur-PR (Wurzel = Portaleingang statt Weiterleitung auf coolin.at). B18-1b
(Cookie-Domain) entfällt — das Portal lebt vollständig auf partner.coolin.at, keine
geteilte Sitzung mit coolin.at nötig.

Bewusst vor dem Inhaltsausbau: Erst die Infrastruktur richtig aufsetzen, dann in Ruhe befüllen.

**Andreas erledigt vorab (CC kann kein DNS):**
1. world4you → DNS `coolin.at` → `partner` als CNAME auf den von Vercel genannten Zielwert
2. Vercel → `peak-shaving-web` → Settings → Domains → `partner.coolin.at` hinzufügen,
   auf „Valid Configuration" warten
3. Supabase → Authentication → URL Configuration → Redirect URLs: `https://partner.coolin.at/**`

**CC baut:**
- **Der heikelste Teil: Sitzungscookies von host-only auf `.coolin.at` umstellen.** Verifiziert:
  `apps/web/lib/supabase/server.ts` und `middleware.ts` setzen heute KEINE `domain`-Option, die
  Cookies sind host-only. Ohne Umstellung ist der Partner beim Wechsel auf die Subdomain
  ausgeloggt — genau das, was vermieden werden soll.
- Hostname-Weiche: `partner.coolin.at` bedient den Portalbereich.
- **Nachzuweisen:** Anmeldung auf `www.coolin.at` → Wechsel auf `partner.coolin.at` → weiterhin
  angemeldet. Und umgekehrt. Explizit messen, nicht annehmen.
- Prüfen, ob `sanitizeNext` und die Guard-Weiterleitungen mit der zweiten Domain umgehen können.

### B18-2 — Onboarding vereinfachen

**Status: gebaut, gemergt, live.** PR #56 (Kontoanlage ohne Mailversand,
Aktivierungslink erst bei Freischaltung) · PR #59 ("Schon Partner?"-Link auf
partner.coolin.at umgestellt) · PR #60 (Login-/Konto-Knopf aus dem öffentlichen Header
entfernt, wie ursprünglich geplant). Nebenbei gehärtet: Turnstile-Schlüssel
scharfgeschaltet, Produktionsbuild bricht seither ohne sie (PR #57/#58).

**Neue Reihenfolge:**
1. Bewerbung mit Passwort (existiert bereits) → Konto entsteht **ohne** Mailversand
   (Admin-API statt `signUp`)
2. Prüfung im Admin, Freischaltung (unverändert)
3. **Erst bei Freischaltung:** Verifizierungslink erzeugen und über **Resend** verschicken
   (`energy@coolin.at`) — eine Mail statt zwei
4. Klick auf den Link → Konto aktiv → direkt ins Portal

**Nebeneffekt:** Umgeht Supabase-Ratenlimit und Spam-Problematik für diesen Weg vollständig.

**Zusätzlich:** Login-Button im öffentlichen Nav-Header **ausblenden, nicht löschen**
(`apps/web/components/layout/site-header.tsx`, `accountHref`-Zweig). Begründung: Vorerst gibt es
ausser Partnern keine Registrierungen; sämtliche Partnerkommunikation läuft über das Portal.

**Kein neues Statusfeld für „ist Partner".** Das ist die Zeile in `platform.partners`, gelesen über
`get_my_partner()`. Ein zweites Feld wäre eine zweite Wahrheit, die auseinanderlaufen kann.

### B18-3 — Portal-Struktur mit Menüs

**Status: teilweise gebaut.** Schema/Schreibweg fertig (PR #61 — get_my_partner()
liefert zusätzlich Ansprechperson + Beitrittsdatum, Grundlage für "Allgemein"),
migriert auf die Cloud-DB. Oberfläche (Portal-Nav-Header, "Allgemein"-Seite,
"Marketing"-Umzug) noch offen.

Eigener Nav-Header im Portal (nicht der öffentliche), fortlaufend erweiterbar:

| Menü | Inhalt |
|---|---|
| **Allgemein** | Kontoinformationen des Partners |
| **Marketing** | Empfehlungslink + E-Mail-Vorlagen (das, was heute die einzige Portalseite ist) |
| **Peak Shaving** | Kalkulator-Zugang — siehe B18-4 |
| **Leads** | siehe B18-6, blockiert |

### B18-4 — Kalkulator-Anfrage über das Portal

**Status: nicht begonnen.** Wartet auf Andreas' Entscheidung: Gutscheincode-Weg für
calculator_pro daneben behalten oder ersetzen?

- Auf der „Peak Shaving"-Portalseite: Anfrageformular mit Begründungstext.
- Anfrage landet im Admin, dort ablehnen oder freigeben.
- Bei Freigabe: `calculator_pro`-Entitlement für dieses Konto → der Kalkulator erscheint auf
  derselben Portalseite als iframe. **Kein Zugangscode nötig**, der Portal-Login genügt.
- Nutzt den bestehenden Entitlement-Mechanismus, kein neuer.

**Offene Frage an Andreas:** Soll der bestehende Gutscheincode-Weg für `calculator_pro` daneben
bestehen bleiben oder ersetzt werden? Beide führen zum selben Entitlement.

### B18-5 — Admin-Leads: zwei Ansichten, EINE Tabelle

**Status: nicht begonnen.**

**Wichtig — technische Korrektur zur ursprünglichen Idee:** Zwei DB-Tabellen würden vier
funktionierende Mechanismen zerreissen:
- Sperrliste (eine abgemeldete Adresse muss überall gesperrt sein)
- E-Mail-Zusammenführung in `capture_lead` (derselbe Betrieb über zwei Wege = EIN Interessent)
- Fristen/Anonymisierung aus B4-1 (müssten dupliziert werden, inkl. Trigger und Wächter)
- Einwilligungen, Export-Protokoll, Statuskette (hängen alle an einer Lead-ID)

**Stattdessen:** eine Tabelle, im Admin **zwei Reiter** — „Partner-Leads" (mit Partnerspalte) und
„Direktanfragen" (ohne). Der Filter existiert datenseitig bereits (`partner_slug` gesetzt/nicht).
Optisch die gewünschte Trennung, darunter alles funktionsfähig.

**Spalten reduzieren.** Heute: E-Mail, Firma, Status, Herkunft, Betrieb, Einwilligungen, Letzte
Interaktion, Löschfrist.
- **Behalten:** Firma, Ansprechperson (fehlt heute, neu), E-Mail, Herkunft/Partner, Datum,
  **Einwilligungen** (entscheidet, ob angeschrieben werden darf — keine Nebeninfo)
- **Entfernen:** „Betrieb" (Segmentierungszelle aus B2-1: Branche/PLZ/kWh/Messart/Vertragsende —
  bei Partner-Leads praktisch immer leer), Status, Löschfrist (seit B4 automatisch durchgesetzt)
- **Partner-Filter ergänzen** in `lib/admin/lead-filters.ts` — dort fehlt er heute, DB-seitig ist
  er in `admin_export_leads` bereits vorhanden

Die Reiter „Partner" und „Partner-Anträge" bleiben unverändert.

### B18-6 — Partner sieht seine Leads ⚠ BLOCKIERT

**Status: rechtlich freigegeben (Martin), technisch nicht begonnen.**
Schema+Schreibweg-Prompt liegt fertig vor (neuer consent_purpose-Wert,
get_my_partner_leads(), Checkbox auf der Partner-Landingpage) — startet, sobald B18-3
komplett ist.

Der Interessent gibt seine Daten **COOLiN**, nicht dem Partner. Ihm im Portal Firmenname,
Ansprechperson und Kontaktdaten zu zeigen, ist eine Übermittlung an einen Dritten — von keiner der
drei bestehenden Einwilligungen gedeckt, auch nicht davon, dass der Partner ihn geschickt hat.

**Lösung:** Checkbox auf dem Landingpage-Formular, sinngemäss „Ich bin einverstanden, dass COOLiN
meine Anfrage an [Partnername] rückmeldet." Portal zeigt nur Leads mit dieser Einwilligung; ohne
sie zählt der Lead in der Statistik mit, aber ohne Namen.

**NICHT vorangekreuzt** (EuGH Planet49 — Einwilligung verlangt aktive Handlung). Ausgerechnet hier
wäre der Schaden am grössten: Diese Einwilligung ist die einzige Rechtsgrundlage für die gesamte
Partner-Lead-Sicht. Ist sie unwirksam, ist die Sicht von Anfang an ohne Grundlage. Stattdessen:
prominent platzieren, natürlich formulieren, direkt beim Absenden-Knopf.

**Braucht:** neuen `consent_purpose`-Wert + juristische Prüfung durch Martins Juristen —
zusammen mit den drei ohnehin offenen Einwilligungstexten.

---

## ENTSCHEIDUNGEN — nicht neu diskutieren

1. **Kein Partner-Typfeld.** Was ein Konto darf, ergibt sich aus dem, was es HÄLT (Partnerzeile,
   Entitlements). Ein Typ erzwänge Ausschliesslichkeit, die sachlich nicht gilt — ein Betrieb kann
   gleichzeitig Empfehlungspartner und Kalkulator-Nutzer sein.
2. **Der Einstiegspunkt entscheidet, was jemand wird** — nicht eine Auswahl bei der Registrierung.
   Wer über `/partner-werden` kommt, legt sein Konto dort inline an. Ein künftiges Kundenportal
   bekommt ebenso seinen eigenen Einstieg (Checkout-Fluss), nicht einen Abzweig über
   `/registrieren`.
3. **Keine Speicherung auf dem Endgerät für Attribution.** Slug läuft über URL-Pfad + Formularfeld.
   Cookie/localStorage/sessionStorage wären nach §165 TKG einwilligungspflichtig → Cookie-Banner
   für die gesamte Domain → Ende der cookielosen Analytics-Architektur.
4. **Kein zweites Authentifizierungssystem.** Ein Supabase-Auth-Bestand, Rollen/Berechtigungen
   entscheiden. Eigene Eingänge und Rahmen schaffen Klarheit, nicht Sicherheit.
5. **Modell A:** COOLiN führt Analyse und Kundenbeziehung, der Partner bekommt das erste
   Zugriffsrecht auf die Montage. **B16/B18 sind NICHT die Fachbetriebs-Lizenz** aus dem
   GTM-Briefing (249–499 €/Mon., Werkzeugübergabe) — das ist das Gegenteil.
6. **Admin-Rollen dauerhaft manuell in Supabase.** Keine Oberfläche dafür, auch nicht für Admins.

---

## OFFENE PUNKTE

**Andreas:**
- DNS/Vercel/Supabase-Redirect für `partner.coolin.at` (Vorbedingung B18-1)
- Entscheidung: Gutscheincode-Weg für `calculator_pro` neben B18-4 behalten oder ersetzen?
- `coolin2026` als Monitor-Gutscheincode deaktivieren (Altlast aus dem alten Soft-Gate)
- Vercel-CLI-Token abgelaufen — CC musste den Deployment-Nachweis über die GitHub-API führen
- Vier Textblöcke im Arbeitsstand (Landingpage, Bewerbungsseite, Bewerbungs-Mails,
  Portal-Vorlagen) → Martina, vor der ersten echten Partner-Aussendung

**Martin / extern:**
- Juristische Prüfung der Einwilligungstexte + neuer Zweck für B18-6 (blockiert B18-6)
- Aufbewahrungsfrist für abgelehnte Partner-Anträge (`run_lead_retention` fasst
  `partner_applications` nicht an — DEPLOYMENT.md §7)

**Nicht Teil von B18:** Partner-Statistik (Klickzählung ohne Cookies braucht eigene serverseitige
Lösung, wartet auf echten Verkehr), Kundenportal, Peak-Wächter (B12/B15), Stripe-Umstellung.

---

## ARBEITSWEISE — verbindlich

- Claude = Advisor/Architect (WAS und WARUM), Claude Code = Implementierung (WIE).
- Antworten auf Deutsch, kurz, direkt, keine sykophantischen Einleitungen.
- Prompts an CC vollständig und copy-paste-fertig, mit Modell-/Thinking-Empfehlung.
- Teil-PRs je Bauabschnitt (Schema → Schreibweg → Oberfläche).
- Jeder Prompt mit Code-/Migrationsänderung endet mit dem Standard-Abschlussblock aus
  `CLAUDE_PEAKSHAVING.md` (Branch → PR → CI → selbst mergen → `supabase db push` → Vercel-Hash
  abgleichen → HTTP-Fetch). Bei ROTEM CI: stoppen, nicht selbst reparieren.
- Für reine Doku-PRs abgewandelt: „Fertig" = gemergt + CI grün.

**Technische Fallstricke (aus echten Fehlern):**
- Vor DROP/RENAME einer platform-Spalte: alle Funktionsrümpfe per `pg_get_functiondef` durchsuchen
- `ON DELETE SET NULL` ist selbst ein UPDATE → asymmetrische Guard-Ausnahme nötig
- Nach jedem DROP einer Funktion: Grant-Fläche nachmessen (in B3-1 real verloren gegangen)
- Cloud-DB nach jeder Migration explizit pushen
- `assertRoutesMatchDisk()` liest nur `app/(site)/[locale]/` — `/admin` liegt ausserhalb
- Unterhalb dynamischer Routen beweist „307 statt 404" nichts
