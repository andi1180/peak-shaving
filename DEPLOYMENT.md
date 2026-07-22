# DEPLOYMENT.md — Cloud-Setup (Supabase + Vercel)

> Operative Anleitung: **welche Variable wohin, welche Dashboard-Einstellung wo.**
> **Diese Datei enthält NIEMALS echte Werte** (Prinzip S1): keine Keys, kein DB-Passwort,
> keine Project-Ref, keine Projekt-URL. Alles davon lebt ausschließlich im Supabase-/Vercel-
> Dashboard bzw. in gitignoreten `.env*.local`-Dateien. Hier stehen nur **Namen und Fundorte**.
>
> Stand: Cloud-Projekt „coolin_energy" (Org „CoolIn", Region **EU / Frankfurt / eu-central-1**)
> ist mit dem Repo verknüpft, alle Migrationen sind gepusht, Seed ist eingespielt. Was noch fehlt,
> damit ein Deploy tatsächlich läuft, steht unten.
>
> **Nachtrag 20.07.2026:** Der Haushalts-Tarifmonitor ist ruhend gestellt (`./Fahrplan_2026.md`). Die
> unten dokumentierten monitor-bezogenen Punkte (u. a. §2a „Exposed schemas → `monitor`") sind damit
> **ruhend, nicht entfernt** — sie bleiben gültig für den bestehenden, weiterhin deployten Code
> (`monitor`-Schema, `/strom-check`) und werden bei einer Reaktivierung wieder gebraucht.

---

## 0. Fundorte im Supabase-Dashboard (einmal merken)

| Was | Pfad im Dashboard |
|---|---|
| Project-Ref (Reference ID) | Project Settings → **General** → „Reference ID" |
| Project-URL | Project Settings → **API** → „Project URL" (bzw. **Connect**-Dialog) |
| anon / publishable Key | Project Settings → **API Keys** → `anon` `public` (bzw. „Publishable key") |
| service_role / secret Key | Project Settings → **API Keys** → `service_role` `secret` — **diese Runde NICHT verwenden** |
| Exponierte Schemas | Project Settings → **API** → „Exposed schemas" / „Data API" |
| Auth-URLs | **Authentication** → „URL Configuration" |
| SMTP | Project Settings → **Authentication** → „SMTP Settings" |
| DB-Verbindungsstrings | **Connect**-Dialog (oben in der Projektleiste) |

---

## 1. Vercel — Projekt `peak-shaving-web` (= `apps/web`)

Environment Variables unter **Vercel → Project `peak-shaving-web` → Settings → Environment Variables.**
Die zentrale Validierung (`apps/web/lib/env.public.ts` / `env.server.ts`) bricht Build/Start **laut** ab,
wenn ein gesetzter Wert formal ungültig ist. Fehlende optionale Variablen sind erlaubt (die Seite meldet
das an der betroffenen Stelle sichtbar).

### 1a. Supabase-Anbindung (server-only, Pflicht für Auth + Monitor-Read)

| Variable | Scope | Wert-Herkunft (Dashboard-Feld) |
|---|---|---|
| `SUPABASE_URL` | Production, Preview, Development | Project Settings → API → **Project URL** |
| `SUPABASE_ANON_KEY` | Production, Preview, Development | Project Settings → API Keys → **`anon` `public`** (die neue „Publishable key" ist gleichwertig) |

- **Bewusst NICHT `NEXT_PUBLIC_`-präfixt.** `apps/web` liest Supabase ausschließlich server-seitig
  (Monitor-Tarif-Read T3 + Auth T4-2, `@supabase/ssr`). Ein non-präfixter Name kann strukturell nie
  ins Client-Bundle inlinen. **Nicht** unter `NEXT_PUBLIC_SUPABASE_*` eintragen — die sind im Root-
  `.env.example` für einen künftigen Client-SDK-Einsatz reserviert und werden von `apps/web` nicht gelesen.
- Alle drei Scopes zeigen auf **dasselbe eine** Supabase-Projekt (eine Plattform, ein Projekt).

### 1b. Basis-URL / Indexierung (Pflicht im Production-Scope)

| Variable | Scope | Wert |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | **nur Production** | die aktuelle Live-Adresse des Vercel-Projekts (`https://peak-shaving-web.vercel.app`); beim DNS-Umzug auf `https://coolin.at` umstellen |
| `NEXT_PUBLIC_SITE_URL` | Preview, Development | **weglassen** (Preview kanonisiert auf sich selbst; eine Preview, die auf coolin.at kanonisiert, wäre ein Duplikat) |
| `NEXT_PUBLIC_VERCEL_URL` | — | **nie manuell setzen**, Vercel setzt sie automatisch je Deployment |

- **Wichtig fürs Indexierungs-Gate (§6.4 Website):** Solange `NEXT_PUBLIC_SITE_URL != https://coolin.at`,
  liefert `robots.txt` „Disallow: /" — **die ganze Seite bleibt aus dem Index.** Genau das ist gewollt,
  solange der Neubau auf `peak-shaving-web.vercel.app` liegt. Das deckt zusätzlich das `/strom-check`-
  noindex ab (die Route trägt außerdem ihr eigenes route-level `noindex`) — relevant, weil die Tarife
  aktuell **Platzhalter** sind (s. §3 unten „Offener Punkt").

### 1c. Kontaktformular + Bot-Schutz (optional; ohne sie läuft die Seite, meldet aber sichtbar „nicht eingerichtet")

| Variable | Scope | Wert-Herkunft | Pflicht |
|---|---|---|---|
| `RESEND_API_KEY` | Production (Preview optional) | resend.com → API Keys (beginnt mit `re_`) | optional, aber ohne sie versendet das Kontaktformular nichts |
| `RESEND_FROM` | wie oben | Absender auf **verifizierter** Resend-Domain, z. B. `COOLiN ENERGY <noreply@…>` | wie oben |
| `RESEND_TO` | optional | Empfänger der internen Benachrichtigung (Default: `energy@coolin.at`) | optional |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | optional | dash.cloudflare.com → Turnstile → Site | optional (sonst Honeypot) |
| `TURNSTILE_SECRET_KEY` | optional | dash.cloudflare.com → Turnstile → Site (Secret) | optional |

- **Seit B1-2 versendet derselbe Resend-Zugang zusätzlich die Double-Opt-in-Bestätigungsmail**
  (`apps/web/lib/leads/mail.ts`). Fehlt der Key, bleibt eine erteilte Einwilligung auf `pending` —
  rechtlich wirkungslos, aber ohne sichtbaren Fehler für den Absender. Der Fehlschlag steht als
  `[leads] Bestätigungsmail NICHT versendet …` im Vercel-Function-Log. S. §1f.

### 1d. Stripe + service_role (T4-3, server-only, Pflicht für Checkout/Webhook)

Alle server-only, NIEMALS `NEXT_PUBLIC_`-präfixen. Der Build läuft ohne sie durch (require-on-use);
ohne sie sind Checkout/Portal/Webhook nicht funktionsfähig.

| Variable | Scope | Wert-Herkunft |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Production (Preview optional) | Project Settings → API Keys → **`service_role` `secret`** (umgeht RLS — nur im Stripe-Pfad genutzt) |
| `STRIPE_SECRET_KEY` | Production (Preview optional) | Stripe Dashboard → Developers → API keys → **Secret key** (`sk_live_…`; für Preview/Test ein `sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | Production | das **Signing secret des im Dashboard angelegten Webhook-Endpoints** (`whsec_…`, s. §2d) — NICHT der `stripe listen`-Wert (der gilt nur lokal) |
| `STRIPE_MONITOR_PRICE_ID` | Production (Preview optional) | Stripe → Product „COOLiN Strom-Monitor" → Preis → **Price-ID** (`price_…`). Der PREIS steht NUR hier, nie im Code (§12 #1). |

- **Live- vs. Test-Keys:** In Production der Live-Account (`sk_live_…` + Live-Price-ID + Live-Webhook-Secret).
  Aktuell ist der Bau gegen einen **fremden Test-Account** verifiziert (§12 #11) — vor dem Livegang durch
  CoolIns eigenen Stripe-Account ersetzen (neue Keys, neues Produkt/Preis, neuer Endpoint).

### 1e. Analytics: PostHog, cookielos (optional; ohne sie läuft die Seite unverändert, nur ohne Messung)

Code: `apps/web/components/analytics/posthog.tsx` · Vorlage: `apps/web/.env.example`

| Variable | Scope | Wert-Herkunft | Pflicht |
|---|---|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | **nur Production** | PostHog → Project Settings → Project API Key (beginnt mit `phc_`) | optional; ohne sie lädt Analytics gar nicht |
| `NEXT_PUBLIC_POSTHOG_HOST` | nur Production | `https://eu.i.posthog.com` (EU-Cloud Frankfurt) | optional — der Code fällt selbst auf den EU-Host zurück |

- **Preview/Development: beide weglassen.** Ohne Key wird der `posthog-js`-Chunk nie angefordert
  (kein Script, kein Request, kein Fehler) — eine Preview soll die Produktions-Statistik nicht verfälschen.
- **`NEXT_PUBLIC_POSTHOG_HOST` weglassen ist sicher, aber nicht beliebig:** Der Code defaultet auf die
  **EU**-Cloud, NICHT auf den US-Default der Bibliothek. Nur setzen, wenn eine andere Region gilt —
  ein falscher Wert hier ist ein stiller Drittlandtransfer.
- **Kein Cookie-Banner nötig, und das ist der Grund:** Der Code läuft mit `cookieless_mode: 'always'` —
  PostHog legt **nie** ein Cookie und **nie** einen localStorage-Eintrag an. `identify()` wird nirgends
  aufgerufen (PostHog sperrt es in diesem Modus ohnehin); es gibt keine personenbezogene Wiedererkennung
  und keine Verknüpfung mit der Supabase-Session. Session Replay ist **im Code** abgeschaltet, nicht nur
  im Dashboard.
- **⚠ DASHBOARD-VORAUSSETZUNG, sonst kommt nichts an:** In PostHog unter
  **Project Settings → Web analytics** die Option **„Cookieless server hash mode" aktivieren.**
  Ohne sie verwirft PostHog die cookielos gesendeten Events serverseitig — der Code ist dann korrekt,
  die Statistik bleibt aber leer. Nebenwirkung dieses Modus (erwartet, kein Defekt): GeoIP-Anreicherung
  und Bot-Erkennung entfallen, die Weltkarte in Web Analytics bleibt leer.
- **`/admin` sendet nichts** — der Verwaltungsbereich hat ein eigenes Root-Layout und durchläuft die
  Analytics-Einhängestelle strukturell nicht. Nichts zu konfigurieren, nur zu wissen.

### 1f. Lead-/Einwilligungspfad (B1-2, server-only)

Code: `apps/web/lib/leads/**` · Vorlage: `apps/web/.env.example`

| Variable | Scope | Wert-Herkunft | Pflicht |
|---|---|---|---|
| `LEAD_TOKEN_SECRET` | Production (Preview optional) | selbst erzeugt: `openssl rand -base64 32` | ohne sie sind Abmeldelinks nicht erzeugbar/prüfbar |
| `SUPABASE_SERVICE_ROLE_KEY` | s. §1d | derselbe Wert wie im Stripe-Pfad | ohne ihn wird **kein Lead geschrieben** und die Einwilligungs-Checkbox erscheint nicht |
| `RESEND_API_KEY` / `RESEND_FROM` | s. §1c | dieselben Werte wie beim Kontaktformular | ohne sie geht **keine Bestätigungsmail** raus (die Einwilligung bleibt `pending` = wirkungslos) |

- **⚠ `LEAD_TOKEN_SECRET` NICHT ROUTINEMÄSSIG ROTIEREN.** Die Abmeldelinks sind **zustandslos**: die
  HMAC-Signatur ist der einzige Beweis, dass ein Link echt ist — es gibt bewusst keine Token-Tabelle
  dahinter (ein Abmeldelink muss auch in einer zwei Jahre alten E-Mail noch funktionieren, und eine
  Token-Tabelle verschwände mit der Lead-Löschung). Ein **neues Geheimnis entwertet damit JEDEN je
  versendeten Abmeldelink auf einen Schlag**; die Empfänger sähen die neutrale „Link ungültig"-Seite
  und griffen stattdessen zur Spam-Schaltfläche — dauerhafter Zustellbarkeitsschaden für **alle**
  Empfänger. Rotation nur bei nachgewiesenem Leck, und dann als bewusster Vorgang.
- **Fehlt eine der Variablen, bricht nichts sichtbar:** Die Kontaktanfrage wird weiterhin zugestellt
  (der Schreibvorgang läuft NACH dem Versand und blockiert ihn nie), der Fehlschlag steht laut im
  Vercel-Function-Log (`[leads] …`). Das ist gewollt — aber es heisst auch, dass ein fehlender Key
  **still** dazu führt, dass keine Leads entstehen. Nach dem Setzen: Redeploy und prüfen, dass
  `https://coolin.at/kontakt` im Markup `name="marketing"` enthält.
- **Nichts im Supabase-Dashboard zu tun:** Der Lead-Pfad läuft über `public`-RPC-Wrapper (§2a bleibt
  unverändert — `platform` ist weiterhin **nicht** exponiert und soll es nicht werden).

### 1g. Zeitgesteuerte Jobs / Cron (B4-1, server-only)

Code: `apps/web/app/api/cron/**` · Zeitplan: `apps/web/vercel.json` · Vorlage: `apps/web/.env.example`

| Variable | Scope | Wert-Herkunft | Pflicht |
|---|---|---|---|
| `CRON_SECRET` | Production (Preview nicht nötig — Crons laufen nur in Production) | selbst erzeugt: `openssl rand -base64 32` | ohne sie antwortet der Endpunkt **401** und der Fristenlauf findet nicht statt |
| `SUPABASE_SERVICE_ROLE_KEY` | s. §1d | derselbe Wert wie im Stripe-/Lead-Pfad | ohne ihn kann der Job den RPC-Wrapper nicht aufrufen |

- **Registrierter Job 1:** `/api/cron/lead-retention`, täglich **03:15 UTC** — Durchsetzung der
  Löschfristen des Lead-Bestands (anonymisiert fällige Leads). **Versendet keine E-Mail.** Nicht zur
  vollen Stunde, weil dort plattformweit die meisten Jobs anlaufen.
- **Registrierter Job 2 (B4-2):** `/api/cron/contract-reminders`, täglich **06:40 UTC** — die
  Vertragsablauf-Erinnerung, acht Wochen vor dem Vertragsende. **Der erste automatisierte
  E-Mail-Versand an reale Personen.** Morgens statt nachts, weil eine Erinnerung mit Zeitstempel
  04:15 maschinell wirkt und eher weggeklickt wird; der Fristenlauf hat kein Zustellinteresse und
  bleibt, wo er ist. **Zusätzlich nötig:** `RESEND_API_KEY` + `RESEND_FROM` (§1c) — ohne sie wird
  jeder fällige Fall als Fehlschlag protokolliert und **nicht** automatisch wiederholt (automatische
  Wiederholung von E-Mail-Versand erzeugt Schleifen). Der Befund steht auf `/admin/leads`.
- **Mengenobergrenze der Erinnerung liegt im ENDPUNKT** (200 je Lauf, Verweigerung über 500) und
  nicht in der Datenbank — anders als beim Fristenlauf, wo sie in `platform.run_lead_retention`
  sitzt. Grund: der wirksame Schritt (der Versand) liegt ausserhalb der Datenbank, eine reine
  DB-Funktion könnte ihn gar nicht bremsen. Oberhalb der Grenze wird **keine einzige** Mail
  versendet, nicht die erste Teilmenge.
- **Plan-Voraussetzung geprüft (21.07.2026):** Das Team liegt auf dem **Pro**-Plan. Pro erlaubt 100
  Cron-Jobs je Projekt, Mindestintervall eine Minute und **minutengenaue** Auslösung — `15 3 * * *`
  läuft also tatsächlich um 03:15 und nicht irgendwann in der Stunde. (Auf **Hobby** wären nur
  tägliche Jobs mit ±59 min Genauigkeit möglich; das trüge diesen Job zwar auch, aber nicht die
  Erinnerungs-Zeitfenster aus B4-2.)
- **Crons laufen ausschließlich im Production-Deployment** und immer gegen die jeweils **aktuelle**
  Production-URL — ein Preview-Deployment löst nichts aus.
- **Die Registrierung hängt am Deployment, nicht an der Datei:** Vercel liest `vercel.json` beim
  Build und registriert die Jobs des Production-Deployments. Eine geänderte Datei ohne
  Production-Deployment ändert **nichts**. Prüfen (nicht annehmen):
  `GET https://api.vercel.com/v1/projects/<projectId>/crons` → der Eintrag muss dort stehen.
- **✔ `CRON_SECRET` ist gefahrlos rotierbar** — im ausdrücklichen Gegensatz zu `LEAD_TOKEN_SECRET`
  (§1f). Der Wert ist zustandsbehaftet nur zwischen Vercel und dem Endpunkt; es hängen **keine
  bereits versendeten Links** daran, die er entwerten könnte. Neu setzen, neu deployen, fertig.
- **Fail-closed:** Fehlende Kopfzeile, falsches Geheimnis **und fehlendes `CRON_SECRET`** ergeben
  allesamt 401 — ohne Datenbankzugriff und ohne Laufdatensatz. Insbesondere der dritte Fall ist
  Absicht: ein ungeschützter Auslöser wäre ein fremdgesteuerter Massen-Anonymisierungslauf (ab B4-2
  ein fremdgesteuerter Massenversand).
- **Kontrolle im Betrieb:** `/admin/leads` zeigt den letzten Lauf samt Kennzahlen und hebt einen seit
  **über 48 Stunden** ausbleibenden erfolgreichen Lauf hervor. Das ist der vorgesehene Weg, ein
  vergessenes `CRON_SECRET` zu bemerken — ein nicht gelaufener Job meldet sich sonst nie.
- **⚠️ Zweite, nicht offensichtliche Voraussetzung: Deployment Protection (§1i).** Ohne
  Bypass-Secret verwirft Vercel die eigenen Cron-Aufrufe, bevor der Endpunkt sie sieht — kein Log,
  kein 401, keine Laufzeile. Bei „registriert, aber nichts passiert" **zuerst dort** nachsehen.
- **Nichts im Supabase-Dashboard zu tun:** wie §1f läuft alles über `public`-RPC-Wrapper.

### 1h. Resend-Webhook — Rückläufer und Beschwerden (B2-2, server-only)

Code: `apps/web/app/api/resend/webhook` · Vorlage: `apps/web/.env.example`

| Variable | Scope | Wert-Herkunft | Pflicht |
|---|---|---|---|
| `RESEND_WEBHOOK_SECRET` | Production (Preview optional) | Resend-Dashboard → **Webhooks** → Endpunkt → *Signing Secret* (beginnt mit `whsec_`) | ohne sie antwortet der Endpunkt **400** und **kein** Ereignis wird verarbeitet |
| `SUPABASE_SERVICE_ROLE_KEY` | s. §1d | derselbe Wert wie im Stripe-/Lead-/Cron-Pfad | ohne ihn kann der Webhook den RPC-Wrapper nicht aufrufen |

**Der Endpunkt ist gebaut, aber in Produktion noch NICHT scharf geschaltet.** Zum Aktivieren:

1. **Resend-Dashboard → Webhooks → Add Webhook.**
   - Endpoint URL: `https://coolin.at/api/resend/webhook`
   - Events (genau diese fünf — mehr abonnieren erzeugt nur ignorierte Zustellungen):
     `email.sent` · `email.delivered` · `email.delivery_delayed` · `email.bounced` ·
     `email.complained`
   - **`email.opened` und `email.clicked` NICHT abonnieren** (s. §2-Resend-a).
2. Das nach dem Anlegen angezeigte **Signing Secret** (`whsec_…`) als `RESEND_WEBHOOK_SECRET` in
   Vercel eintragen (Scope Production), **danach Redeploy** — Umgebungsvariablen greifen erst im
   nächsten Deployment.
3. Prüfen: ein anonymer `POST` auf `/api/resend/webhook` ohne gültige Signatur muss **400** liefern
   (nicht 404 — das hiesse, die Route existiert nicht, und nicht 200 — das hiesse, es wird ohne
   Prüfung angenommen).

- **Was der Webhook tut:** Beschwerde → Adresse dauerhaft sperren **und** alle Einwilligungen
  widerrufen. Dauerhafter Rückläufer → sperren, Einwilligungen **unberührt** (ein technisches
  Zustellversagen ist keine Willenserklärung der Person). Vorübergehender Rückläufer, Zustellung,
  Versand → nur protokollieren. **Er legt niemals einen Lead an.**
- **Eine Sperre lässt sich über die Oberfläche NICHT aufheben** — es gibt dafür bewusst keinen
  Wrapper (Entsperren wäre der Sache nach Erteilen, und die Regel lautet: der Admin kann widerrufen,
  nie erteilen). Ein begründeter Einzelfall bleibt ein bewusster Eingriff in der Datenbank.
- **✔ `RESEND_WEBHOOK_SECRET` ist gefahrlos rotierbar** — wie `CRON_SECRET` (§1g) und im
  ausdrücklichen Gegensatz zu `LEAD_TOKEN_SECRET` (§1f). Der Wert ist zustandsbehaftet nur zwischen
  Resend und diesem Endpunkt; es hängen keine bereits versendeten Links daran. Im Resend-Dashboard
  neu erzeugen, in Vercel setzen, neu deployen — Ereignisse, die dazwischen ankommen, werden mit 400
  abgelehnt und von Resend automatisch wiederholt.
- **Fail-closed:** fehlende Kopfzeile, ungültige Signatur **und fehlendes `RESEND_WEBHOOK_SECRET`**
  ergeben allesamt 400 ohne jeden Datenbankzugriff. Der dritte Fall ist der wichtige: ein
  ungeprüfter Endpunkt wäre ein offener Weg, beliebige Adressen dauerhaft zu sperren und
  Einwilligungen zu widerrufen.
- **Kontrolle im Betrieb:** `/admin/leads` zeigt dauerhafte Rückläufer und Beschwerden der letzten 30
  Tage und hebt sie hervor, sobald **eine** Beschwerde auftritt; `/admin/leads/<id>` zeigt die
  Ereignisse des einzelnen Leads samt Sperrgrund.
- **Nichts im Supabase-Dashboard zu tun:** wie §1f/§1g läuft alles über `public`-RPC-Wrapper.

---

### 1i. Deployment Protection — ⚠️ SONST LAUFEN DIE EIGENEN CRON-JOBS NICHT

Fundort: **Vercel → Project `peak-shaving-web` → Settings → Deployment Protection.**

**Ist-Zustand:** „Vercel Authentication / Require Log In" steht auf **Standard Protection**. Das schirmt
Preview- und generierte Deployment-URLs ab — gewollt, wird nicht abgeschaltet.

**Die Folge, die nicht offensichtlich ist:** Ohne ein Secret unter **„Protection Bypass for
Automation"** verwirft Vercel **die eigenen Cron-Aufrufe**, *bevor* sie den Endpunkt erreichen. Es
entsteht dabei

- **kein Log** (der Handler läuft nie),
- **kein 401** aus der Anwendung (die Prüfung von `CRON_SECRET` kommt gar nicht zum Zug),
- **kein Eintrag im Laufprotokoll** (`platform.job_runs` — die Zeile entsteht erst im Handler).

**Symptom, an dem es aufgefallen ist:** Beide Cron-Jobs korrekt registriert (per
`GET /v1/projects/<projectId>/crons` bestätigt), „View Logs" **leer**, und auf `/admin/leads` seit
Tagen die 48-Stunden-Warnung für beide Läufe.

**Warum die Ursache schwer zu finden ist:** Aufrufe über die **eigene Domain** (`coolin.at`) sind von
Deployment Protection **nicht** betroffen. Ein manueller Test mit `curl` gegen die Produktivdomain
liefert also sauber 401 bzw. 200 — der Endpunkt sieht in jeder Prüfung von Hand funktionsfähig aus,
während der plattformeigene Auslöser stumm verworfen wird.

**Behebung:** Unter **Deployment Protection → Protection Bypass for Automation** ein Secret anlegen
und **neu deployen** (Vercel setzt es dann bei den eigenen Cron-Aufrufen selbst). Danach erscheinen
Läufe wieder im Protokoll, und die 48-Stunden-Warnung auf `/admin/leads` verschwindet. **Genau diese
Warnung ist die vorgesehene Kontrolle** (§1g) — sie hat hier funktioniert.

**Merksatz:** Registrierter Cron + leere Logs + keine Laufzeile = zuerst Deployment Protection prüfen,
nicht `CRON_SECRET`.

---

## 2. Supabase-Dashboard-Einstellungen (nicht über Migrationen abgedeckt)

Diese Einstellungen sind **PostgREST-/Auth-Projektkonfiguration**, kein DB-Schema — `supabase db push`
überträgt sie NICHT. Sie müssen im Dashboard gesetzt werden.

### 2a. Exposed schemas → `monitor` hinzufügen  ⚠️ SONST 404 auf `/strom-check`

Project Settings → **API → „Exposed schemas"**. Aktuell exponiert das Cloud-Projekt nur den Default
`public, graphql_public` (verifiziert). Lokal steht in `supabase/config.toml` zusätzlich `monitor` —
**dieser Config-Teil wird von `db push` nicht mitgepusht.**

→ **`monitor` in die Liste aufnehmen** (Ergebnis: `public, graphql_public, monitor`). Ohne das
antwortet der Server-Read von `monitor.current_tariffs` mit `PGRST106 „Invalid schema: monitor"` und
`/strom-check` zeigt nichts. `platform` bleibt **bewusst draußen** (personenbezogene Auth-/Zahlungs-
Spiegel, nur über Server-Code/RLS erreichbar — verifiziert: derzeit korrekt nicht exponiert).

### 2b. Authentication → URL Configuration (sonst laufen Bestätigungs-/Reset-Links ins Leere)

**Authentication → „URL Configuration":**

- **Site URL:** die Produktionsadresse — `https://peak-shaving-web.vercel.app` (später `https://coolin.at`).
- **Redirect URLs** (Allowlist; Callback-Route ist `/auth/callback`, Glob `/**` deckt den Query-Parameter ab):
  - `https://peak-shaving-web.vercel.app/**`
  - für **Preview-Deployments** (dynamische URLs je Push) ein Wildcard-Eintrag im Muster deines Vercel-
    Team-/Projekt-Slugs, z. B. `https://peak-shaving-web-*-<dein-vercel-scope>.vercel.app/**`
  - beim DNS-Umzug zusätzlich `https://coolin.at/**`
- Lokal ist das bereits in `config.toml` gesetzt (`localhost:3000/**`, `127.0.0.1:3000/**`) — das betrifft
  nur den lokalen Stack, nicht die Cloud.

### 2c. Authentication → SMTP: Resend eintragen (sonst harte Rate-Limits)

Project Settings → **Authentication → „SMTP Settings" → Custom SMTP aktivieren:**

| Feld | Wert |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` (SSL) bzw. `587` |
| Username | `resend` |
| Password | ein **Resend-API-Key** (resend.com → API Keys) |
| Sender email | Adresse auf einer in Resend **verifizierten** Domain (z. B. `noreply@coolin.at`) |
| Sender name | z. B. `COOLiN ENERGY` |

- **Was passiert, wenn man es NICHT tut:** Supabase' eingebauter Mailversand hat **harte Rate-Limits**
  (wenige Mails pro Stunde) und ist ausdrücklich nur für Tests — in Produktion würden Registrierungs-
  Bestätigungs- und Passwort-Reset-Mails verzögert oder gar nicht zugestellt. **Für Produktion untauglich.**
- **Was du bei Resend selbst noch tun musst:** die Absender-**Domain verifizieren** (SPF- + DKIM-DNS-
  Einträge bei deinem DNS-Provider setzen). Ohne verifizierte Domain lehnt Resend die Sendung ab.
- Der API-Key für SMTP kann derselbe wie für das Kontaktformular sein oder ein separater — beides ok.

---

## 2-Stripe. Stripe-Dashboard-Einstellungen (T4-3)

Analog zu §2 (Supabase): Konfiguration im **Stripe-Dashboard**, die kein Code und keine Migration
abdeckt. Alles im **Test-Modus** für Preview, im **Live-Modus** für Production — die Schalter sind
getrennt (getrennte Keys, Endpoints, Preise, Portal-Configs).

### 2-Stripe-a. Produkt + Preis (falls per API nicht schon angelegt)

Produkt **„COOLiN Strom-Monitor"**, wiederkehrender Preis **monatlich, EUR, 4,90 €** (Platzhalter,
§12 #12). Reproduzierbar per API anlegbar (`stripe.products.create` / `stripe.prices.create`) oder im
Dashboard. Die **Price-ID** (`price_…`) nach Vercel als `STRIPE_MONITOR_PRICE_ID` (§1d).

### 2-Stripe-b. Webhook-Endpoint anlegen  ⚠️ SONST kommen in Produktion keine Events an

Developers → **Webhooks** → „Add endpoint":
- **Endpoint-URL:** `https://coolin.at/api/stripe/webhook` (bzw. die aktuelle Production-Domain).
- **Zu abonnierende Events (mindestens):** `checkout.session.completed`,
  `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
  (Der Handler ignoriert alles andere mit 200 — mehr zu abonnieren schadet nicht, ist aber unnötig.)
- Nach dem Anlegen das **Signing secret** (`whsec_…`) kopieren → Vercel `STRIPE_WEBHOOK_SECRET` (§1d).
  Das ist ein ANDERER Wert als das lokale `stripe listen`-Secret.
- **`stripe listen` ist nur für die lokale Entwicklung** (leitet an `localhost` weiter, eigenes,
  temporäres Signing-Secret). In Produktion zählt ausschließlich der Dashboard-Endpoint.

### 2-Stripe-c. API-Version des Endpoints auf die gepinnte Version setzen

Der Stripe-Client im Code pinnt **`2026-06-24.dahlia`** (`current_period_end` liegt dort auf dem
SubscriptionItem). Den Webhook-Endpoint auf **dieselbe** API-Version stellen, damit die
`data.object`-Payloads dieselbe Feld-Lage haben. Der Handler liest zwar item-first **mit
top-level-Fallback** (robust gegen eine alte Konto-Default-Version), aber ein passend versionierter
Endpoint ist die saubere Konfiguration. (Der genutzte Test-Account hat eine sehr alte Default-Version
`2016-07-06` — deshalb existiert der Fallback; ein frisch angelegter Endpoint sollte die neue Version tragen.)

### 2-Stripe-d. Customer Portal konfigurieren

Settings → Billing → **Customer portal**: einmalig eine Konfiguration aktivieren (Kündigung,
Zahlungsmittel, Rechnungen). Ohne eine (Default-)Portal-Konfiguration schlägt
`billingPortal.sessions.create` fehl → der Portal-Button auf `/konto` läuft in den neutralen
Fehlerzustand. Reproduzierbar auch per API (`stripe.billingPortal.configurations.create`, im Bau so
angelegt). Getrennt je Live-/Test-Modus.

---

## 2-Resend. Resend-Dashboard-Einstellungen (B2-2)

### 2-Resend-a. Öffnungs- und Klick-Verfolgung MUSS aus sein  ⚠️ DAUERHAFTE ZUSAGE

**Warum — der Unterschied, um den es geht.** Zustellstatus-Ereignisse (zugestellt, Rückläufer,
Beschwerde) meldet der **empfangende Mailserver**; sie entstehen ohne Zutun des Empfängers und sagen
nichts über sein Verhalten. Ein **Zählpixel** (Öffnungs-Verfolgung) und **umgeschriebene Links**
(Klick-Verfolgung) sind etwas anderes: sie erfassen, ob und wann eine bestimmte Person eine Mail
geöffnet und worauf sie geklickt hat, samt IP-Adresse — also Verhaltensbeobachtung. Das widerspricht
dem Grundsatz „kein IP-Tracking zur Profilbildung", auf dem die gesamte Analytics-Entscheidung
beruht (cookielos, kein Cookie-Banner, §1e), und es widerspricht der Datenschutzerklärung. Der
Betrieb braucht die Daten auch nicht: die einzige Kennzahl, die für die Zustellbarkeit zählt, ist die
Beschwerde- und Rückläuferquote — und die kommt aus den Zustellereignissen.

**Wo es steht (Resend-Dashboard):** Domains → die Domain (`coolin.at`) → Reiter **Configuration** →
*Enable tracking metrics* → **Open tracking** und **Click tracking** müssen **beide aus** sein.
Beides ist bei Resend **standardmässig deaktiviert** und muss aktiv eingeschaltet werden — der
erwartete Zustand ist also „aus", nicht „muss abgeschaltet werden".

**Prüfen statt annehmen** (liefert `open_tracking` / `click_tracking` je Domain):

```bash
curl -s -H "Authorization: Bearer $RESEND_API_KEY" https://api.resend.com/domains
```

**Abschalten, falls doch aktiv** (`:id` ist die Domain-ID aus der Antwort oben):

```bash
curl -s -X PATCH -H "Authorization: Bearer $RESEND_API_KEY" -H "Content-Type: application/json" \
  -d '{"open_tracking": false, "click_tracking": false}' \
  https://api.resend.com/domains/:id
```

**Bei einem Wechsel des Resend-Kontos oder einer neuen Absender-Domain erneut prüfen** — die
Einstellung hängt an der Domain, nicht am Konto, und eine neu angelegte Domain erbt sie nicht.

**Zweite Verteidigungslinie im Code:** Der Webhook-Endpunkt (`app/api/resend/webhook`) verwirft
`email.opened` und `email.clicked` unabhängig davon, ob sie abonniert oder aktiviert sind — sie
landen also auch dann nicht in der Datenbank, wenn diese Einstellung einmal falsch steht. Die
Einstellung bleibt trotzdem nötig: das Zählpixel wird beim Empfänger geladen und der Link über einen
fremden Server umgeleitet, ganz gleich, ob wir das Ereignis speichern.

### 2-Resend-b. Webhook-Endpunkt

Siehe **§1h** — dort steht die vollständige Anleitung (URL, die fünf zu abonnierenden Ereignisarten,
Signing Secret, Prüfschritt).

---

## 3. Was NICHT über das Dashboard läuft (Repo ist die Wahrheit)

- **Schema-Änderungen ausschließlich über Migrationen im Repo** (`supabase/migrations/**`) und
  `supabase db push`. **Niemand** ändert das Schema im **SQL-Editor** oder über Studio direkt in der
  Cloud — sonst laufen Repo und Cloud auseinander, und der nächste `db push` bzw. das DB-Gate schlägt
  fehl oder überschreibt still. Neue Migration → committen → `supabase db push`.
- **VERBINDLICHER STANDARD-SCHRITT (analog Vercel-Live-Check):** Jeder Bauabschnitt, der eine neue
  Migration enthält, pusht sie **am Abschluss automatisch** auf die Cloud — nicht erst bei expliziter
  Aufforderung. Abschluss-Block: (1) `supabase db push --linked`, (2) **gegen die Cloud** verifizieren
  (`supabase db query --linked` + `has_function_privilege`-Introspektion, **kein** Funktionsaufruf —
  Segfault-Vermeidung), (3) bei auth-/zahlungsrelevanten Änderungen den Betreiber zum Live-Test
  auffordern. Hintergrund: die T4-3-RPC-Wrapper-Migration blieb versehentlich lokal-only, wodurch der
  Live-Checkout scheiterte — genau dieser Schritt verhindert das künftig.
- **Seed** ist einmalig eingespielt (Platzhalter-Tarife). Er ist **nicht** Teil von `db push`.
- **Offener Punkt (Prinzip 1 · §12 #6):** Die aktuell in der Cloud liegenden Tarife sind **Platzhalter**
  mit erfundenen Anbieternamen („Blitz Energie" …), **keine echten österreichischen Tarife.**
  `/strom-check` bleibt deshalb **noindex und unverlinkt.** **Bevor die Route verlinkt oder indexiert
  wird, MÜSSEN echte Tarifdaten den Seed ersetzen** — erfundene Zahlen an echte Nutzer auszuliefern
  verletzt Prinzip 1 direkt.

---

## 3a. Tarifsätze nachtragen (B11) — Kalkulator, KEINE Datenbank, KEINE Migration

> **Diese Anleitung wird im November/Dezember 2026 unter Zeitdruck gelesen, wenn die
> Tarifverordnung (SNE-T-V) erscheint. Deshalb knapp und schrittweise.**

Die Tarifsätze des Kalkulators (Leistungspreis, Abrechnungsmodell, Mindestbemessung je
Netzbetreiber und Netzebene) liegen als getypte Datenschicht **im Code**, nicht in der Datenbank:
**genau eine Datei**, `packages/shared/src/tariff-catalog.ts`. Es gibt dafür kein Schema, keine
Migration, keine Admin-Bearbeitung und keinen Laufzeitabruf. Begründung ausführlich im Kopf der
Datei; kurz: Versionierung, Freigabe durch eine zweite Person und Unveränderlichkeit nach der
Auslieferung leistet die Versionsverwaltung bereits, und eine Datenbanklösung machte den
öffentlichen Rechner von einem Netzaufruf abhängig oder gäbe `anon` Zugriff auf `platform`.

### Einen bestehenden Satz nachtragen (der Regelfall: eine Ebene fehlt noch)

1. `packages/shared/src/tariff-catalog.ts` öffnen, in `TARIFF_SET_AT_2026.profiles` das Profil der
   Kombination suchen (z. B. `netzbetreiber: 'netz_noe', netzebene: 5`).
2. Das Profil **ersetzen** — `availability: 'pending_regulation'` samt `reason`/`note` fällt weg,
   `availability: 'available'` mit **allen drei** Preisfeldern tritt an seine Stelle:
   ```ts
   {
     netzbetreiber: 'netz_noe',
     netzebene: 5,
     availability: 'available',
     billingModel: 'monthly_max_average',   // was die Netzrechnung als Abrechnungszeitraum nennt
     leistungspreisEurPerKwYear: 00.00,     // aus dem Preisblatt, nicht geschätzt
     minBillableKw: 0,                      // 0 = kein Sockel angesetzt
   },
   ```
   Der Typ lässt kein halbes Profil zu: ein Preisfeld an einem `pending_regulation`-Profil bricht
   den Typecheck, ein fehlendes an einem `available`-Profil bricht den Test.
3. `sourceNote` des Satzes um die neue Fundstelle ergänzen (Preisblatt, Version, Abrufdatum).
4. `pnpm --filter shared test` — die Datei-Prüfung (`validateTariffSets`) meldet fehlende
   Preisfelder, doppelte Kombinationen und überschneidende Gültigkeiten im Klartext.
5. `pnpm typecheck && pnpm lint`, committen, PR. **Eine Datei, ein PR, kein Deployment-Sonderweg.**

**Kein Wert zur Hand? Dann NICHTS eintragen.** Das Profil bleibt `pending_regulation`, und der
Rechner sagt dem Nutzer, dass für diese Kombination nicht gerechnet wird. Ein erfundener
Vorgabewert ist schlimmer als ein fehlender — er sieht aus wie eine Aussage.

### Einen ganz neuen Stand anlegen (der Fall SNE-T-V zum Tarifjahr 2027)

1. Am bestehenden Satz `validUntil: '2026-12-31'` setzen. **Nicht überschreiben** — eine 2026
   archivierte Analyse muss auch 2028 noch sagen können, welcher Stand ihr zugrunde lag.
2. Einen neuen `TariffSet` anlegen (`id: 'at-2027'`, `validFrom: '2027-01-01'`, eigene
   `sourceNote`) und in `TARIFF_SETS` **hinter** den alten stellen.
3. Netzebene 7 von `pending_regulation` auf `available` umstellen — das ist der eigentliche Zweck
   von B11. Damit hört der Rechner auf, die Berechnung zu verweigern, und der Warteliste-Verweis
   verschwindet von selbst (er hängt an `availability`, nicht an einem Schalter).
4. Schritte 4–5 von oben. Die Datei-Prüfung schlägt an, falls das `validUntil` vergessen wurde:
   zwei gleichzeitig geltende Stände für dieselbe Kombination sind ein Fehler, kein Vorrang.

### Was dabei NICHT zu tun ist

- **Keine Migration.** Entstünde in dieser Aufgabe eine, wäre die Grundentscheidung missverstanden.
- **Nicht die Engine anfassen.** `packages/engine` kennt die Datenschicht nicht und darf es nie —
  `packages/engine/src/tariff/no-catalog-dependency.test.ts` prüft das über die tatsächlichen
  Importe und wird rot, sobald jemand es doch tut.
- **Keine Werte in archivierten Analysen nachziehen.** Die Preise stehen dort denormalisiert und
  bleiben, wie sie waren (B14-1, Regel (b)); ein neuer Stand ändert nur künftige Rechnungen.

---

## 4. Anhang — DB-Verbindung für Tooling (DB-Gate gegen die Cloud, einmalig)

Rein operativ, für den seltenen Fall, dass das DB-Gate (`packages/db-tests`) noch einmal gegen die Cloud
laufen soll. Die Ziel-DB kommt aus **Umgebungsvariablen** (Default bleibt lokal), es ist **kein**
Code-Änderung nötig:

- `SUPABASE_DB_URL` — **Session-Pooler** (IPv4), Muster
  `postgresql://postgres.<PROJECT_REF>:<PW>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=no-verify`
  (exakter String im **Connect**-Dialog; die Direktverbindung `db.<ref>.supabase.co` ist IPv6-only).
  Für node-postgres **`sslmode=no-verify`** (nicht `require` — das erzwingt strikte Zertifikatsprüfung
  und schlägt am Pooler-Zertifikat fehl).
- `SUPABASE_API_URL` — die Project-URL (GoTrue-Admin-API).
- `SUPABASE_SERVICE_ROLE_KEY` — nur transient für den Testlauf in der Shell, **nie** in eine Datei/ins Repo.

> Die **CI** (`.github/workflows/db-gate.yml`) bleibt bewusst auf einem frisch gestarteten **lokalen**
> Stack — sie wird **nicht** auf die Cloud umgebogen (eine CI gegen die Produktions-DB legt Testnutzer in
> der Produktion an).

---

## 5. Gedruckte Pfade — dauerhafte Zusagen ⚠️ NICHT UMBENENNEN

Ein Pfad, der auf Papier steht, ist keine interne Adresse mehr. Ein Brief, der in einem Betrieb im
Ordner liegt, wird auch in einem Jahr noch aus der Hand gescannt — zurückrufen lässt er sich nicht.
Für die hier aufgeführten Pfade gilt deshalb dauerhaft und ohne Ablaufdatum:

**`/warteliste/wko` (B3-4) — als QR-Code auf dem Postbrief der WKO-Aktion gedruckt.**

- Der Pfad darf **nie umbenannt**, **nie entfernt** und **nie auf eine andere Quelle umgehängt**
  werden — auch nicht im Zuge einer späteren Umstrukturierung der Seitenstruktur, und auch nicht
  „nur der Ordnung halber".
- Wird die Seite je inhaltlich ersetzt, **muss der Pfad bestehen bleiben und weiterleiten**
  (301 auf das Nachfolgeziel, Muster wie die `.html`-Redirects in `next.config.mjs`). Ein 404 an
  dieser Stelle ist ein toter Brief, kein Schönheitsfehler.
- Auch die **Zuordnung** ist Teil der Zusage: Das Segment `wko` zeigt auf den Einstiegspunkt
  `wko-postaktion-qr` (`apps/web/lib/leads/warteliste.ts`). Ein umgehängter Schlüssel schriebe die
  Rückläufe des Briefs still unter einer fremden Herkunft in den Bestand — die Seite funktionierte,
  die Leads kämen an, und die Auswertung auf `/admin/leads` wäre falsch, ohne dass es auffiele.
- Die Seite trägt bewusst **`noindex`** und steht **nicht in der sitemap** (sie ist inhaltlich fast
  identisch mit `/warteliste`; zwei indexierbare Fassungen desselben Textes wären ein Duplikat).
  Erreichbar bleibt sie selbstverständlich — `noindex` ist keine Sperre. Sie wird zudem **nirgends
  intern verlinkt**: Sie existiert für den gedruckten Zugang.

Dieselbe Zusage steht im Code an zwei Stellen: an der Erlaubnisliste
(`apps/web/lib/leads/warteliste.ts`) und an der Route selbst
(`apps/web/app/(site)/[locale]/warteliste/[quelle]/page.tsx`).

---

## 6. Archivierte Lastgänge — Zweckbindung ⚠️ RECHTLICHER VERMERK (B14)

Seit **B14-1** (`supabase/migrations/20260724150000_create_analysis_persistence.sql`) speichert
`platform.analyses` zu jeder Auslegung die **Quelldatei des Kunden** (gzip-komprimiert, mit
SHA-256-Prüfsumme über die unkomprimierte Fassung). Das ist keine Nebensache der Ablage, sondern eine
eigene datenschutzrechtliche Lage:

- Der archivierte Lastgang ist **Vertragsdurchführungsdatum eines Geschäftskunden**. Er wurde
  überlassen, damit **genau diese eine Auslegung** entsteht — und für nichts anderes.
- Eine Verwendung für einen **Branchen-Benchmark** ist nach `Fahrplan_2026.md`
  (**offene Entscheidung 6**) ein **EIGENER ZWECK**, nicht dieselbe Verarbeitung. Er muss **ab dem
  ersten Fall** in **AGB** und **Auftragsverarbeitungsvereinbarung** abgedeckt sein — vorher gar
  nicht, auch nicht „nur intern, nur aggregiert, nur zum Ausprobieren".
- **B14 baut dafür bewusst KEIN Kennzeichen und KEINE Auswertung.** Eine vorhandene Schaltfläche
  lädt dazu ein, sie zu benutzen, bevor die Grundlage steht; und ein Kennzeichen, das niemand
  gesetzt hat, sieht später aus wie eine Einwilligung, die niemand erteilt hat. Wer die Grundlage
  schafft, baut die Spalte **dann** — nicht vorsorglich.

**Aufbewahrung, bewusst abweichend vom Lead:** Die Analyse hängt **nicht** am Kaskadenlöschen des
Leads und wird von `platform.anonymize_lead` **nicht** angetastet. Eine bezahlte Analyse ist eine
kaufmännische Leistung mit **eigener Aufbewahrungspflicht** (7 Jahre ab Vertragsschluss, laut
B1-Entscheidung eine getrennte Rechtsgrundlage) und überlebt die werbliche Frist des Leads
(24 Monate ab letzter Interaktion, automatisch durchgesetzt seit B4-1). Deshalb steht
`customer_label` **denormalisiert** auf der Analyse: nach der Anonymisierung trägt der Lead keinen
Kundennamen mehr, die Geschäftsunterlage muss ihren behalten.

**Was das für den Betrieb heißt:** Der Blob wird ausschließlich über `public.admin_get_analysis_source`
herausgegeben (angemeldeter Admin, ein Aufruf pro Datei). Es gibt **keinen** Weg, Lastgänge gebündelt
zu exportieren, und es soll auch keiner entstehen, solange die Zweckbindung oben nicht erweitert ist.
Dieselbe Begründung steht im Kopf der Migration — sie gilt dort dem Datenmodell, hier dem Betrieb.

---

## 7. Partner-Bewerbungen — OFFENE Aufbewahrungsfrist ⚠️ RECHTLICHER VERMERK (B16-3)

Seit **B16-3** (`supabase/migrations/20260725150000_create_partner_applications.sql`) nimmt
`/partner-werden` Bewerbungen von Fachbetrieben entgegen und legt sie in
`platform.partner_applications` ab — mit Firma, Ansprechperson (Vor-/Nachname), E-Mail, Telefon,
Website und einem **Pflicht-Freitext**, in dem der Betrieb schildert, was er tut und warum er Partner
werden will. Zu jeder Bewerbung gehört ein Auth-Konto (bei der Bewerbung angelegt oder schon
vorhanden).

**⚠️ Für diese Tabelle gibt es KEINE Aufbewahrungsfrist und KEINEN Löschjob.** Das ist eine bewusst
offen gelassene Lücke, kein Versehen:

- Die bestehende Maschinerie (**B4-1**, `platform.run_lead_retention`, täglicher Vercel-Cron um
  03:15 UTC) greift **ausschließlich** auf `platform.leads` und fasst
  `platform.partner_applications` **nicht** an. Geprüft, nicht angenommen.
- Welche Frist für einen **abgelehnten** Antrag gilt — und ob ein genehmigter unter die
  kaufmännische 7-Jahres-Frist fällt, weil daraus eine Geschäftsbeziehung wurde —, gehört in
  **dieselbe juristische Prüfung wie die noch ausstehenden Einwilligungstexte**
  (`Fahrplan_2026.md` §7 „Fachliche Abhängigkeiten", Owner Martin).
- Eine hier erfundene Frist wäre genau die Sorte Zahl, die 2028 als Entscheidung dasteht, die
  niemand getroffen hat — dieselbe Abwägung, mit der B11 keine Tarifsätze rät.

**Zu tun, sobald die Prüfung vorliegt:** Frist festlegen, eine Migration mit dem Gegenstück zu
`platform.leads_due_for_anonymization`/`run_lead_retention` bauen und im bestehenden Cron-Endpunkt
(`apps/web/app/api/cron/lead-retention`) **oder** in einem eigenen anstoßen. Bis dahin bleibt die
Tabelle unbefristet — sie enthält Geschäftskontakte, keine Verbrauchsdaten, und es gibt für
**keine** Rolle ein `delete`-Grant.

**Ebenfalls offen und hier vermerkt, weil es den Betrieb betrifft:** Es gibt **keinen
Genehmigen-Weg**. Ein Antrag lässt sich im Admin-Bereich nur **ablehnen**; Genehmigen erzeugt in
B16-4 zusätzlich einen Partnereintrag, einen Kurz-Key und die Freischaltung des Kontos. Bis dahin
wird ein aufgenommener Fachbetrieb **von Hand** unter `/admin/partner` angelegt, und sein Antrag
bleibt auf „Offen" stehen. Weder in der Datenbank noch in der Oberfläche existiert ein Weg zum
Status `approved`.
