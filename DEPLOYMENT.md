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

### 1d. Diese Variablen dieser Runde bewusst NICHT setzen

- **`SUPABASE_SERVICE_ROLE_KEY`** — wird erst mit dem Stripe-Webhook (**T4-3**) gebraucht (server-only,
  umgeht RLS). Keine Env auf Vorrat (S3). Das Schema in `env.server.ts` trägt sie später ohne Umbau.
- **`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`** — ebenfalls erst T4-3.

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

## 3. Was NICHT über das Dashboard läuft (Repo ist die Wahrheit)

- **Schema-Änderungen ausschließlich über Migrationen im Repo** (`supabase/migrations/**`) und
  `supabase db push`. **Niemand** ändert das Schema im **SQL-Editor** oder über Studio direkt in der
  Cloud — sonst laufen Repo und Cloud auseinander, und der nächste `db push` bzw. das DB-Gate schlägt
  fehl oder überschreibt still. Neue Migration → committen → `supabase db push`.
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
