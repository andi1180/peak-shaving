# DEPLOYMENT.md — Cloud-Setup (Supabase + Vercel)

> Operative Anleitung: **welche Variable wohin, welche Dashboard-Einstellung wo.**
> **Diese Datei enthält NIEMALS echte Werte** (Prinzip S1): keine Keys, kein DB-Passwort,
> keine Project-Ref, keine Projekt-URL. Alles davon lebt ausschließlich im Supabase-/Vercel-
> Dashboard bzw. in gitignoreten `.env*.local`-Dateien. Hier stehen nur **Namen und Fundorte**.
>
> Stand: Cloud-Projekt „coolin_energy" (Org „CoolIn", Region **EU / Frankfurt / eu-central-1**)
> ist mit dem Repo verknüpft, alle Migrationen sind gepusht, Seed ist eingespielt. Was noch fehlt,
> damit ein Deploy tatsächlich läuft, steht unten.

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
