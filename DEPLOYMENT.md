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
| `RESEND_TO` | optional | Empfänger der internen Benachrichtigung (Default: `energy@coolin.at`) | optional |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | optional | dash.cloudflare.com → Turnstile → Site | optional (sonst Honeypot) |
| `TURNSTILE_SECRET_KEY` | optional | dash.cloudflare.com → Turnstile → Site (Secret) | optional |

- **⚠️ `RESEND_FROM` GIBT ES NICHT MEHR.** Der Absender ist eine Konstante im Code
  (`MAIL_FROM` in `apps/web/lib/mail/send.ts`, Wert `COOLiN ENERGY <energy@coolin.at>`) — s. §9.
  Ein in Vercel noch gesetzter Wert wird nicht mehr gelesen und **kann dort entfernt werden**;
  stehen zu lassen schadet nicht, ist aber irreführend.
- **Seit B1-2 versendet derselbe Resend-Zugang zusätzlich die Double-Opt-in-Bestätigungsmail**
  (`apps/web/lib/leads/mail.ts`). Fehlt der Key, bleibt eine erteilte Einwilligung auf `pending` —
  rechtlich wirkungslos, aber ohne sichtbaren Fehler für den Absender. Der Fehlschlag steht als
  `[leads] Bestätigungsmail NICHT versendet …` im Vercel-Function-Log. S. §1f.
- **Der Schlüssel trägt inzwischen sieben Mails**, nicht nur das Kontaktformular: die vollständige
  Liste steht in §9. Fehlt er, versendet **keine** davon.

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
  `GET https://api.vercel.com/v9/projects/<projectId>?teamId=<teamId>` → Feld `crons` → der Eintrag muss dort stehen. **⚠️ NICHT `/v1/projects/<projectId>/crons`** — dieser Pfad antwortet **404** (27.08.2026 gemessen); die Crons hängen am Projektobjekt.
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
`GET /v1/projects/<projectId>/crons` bestätigt — **dieser Pfad antwortet heute 404, s. §1e/§1k**),
„View Logs" **leer**, und auf `/admin/leads` seit
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

### 1j. iframe-Einbettung des Kalkulators (`apps/website`) — GESETZT seit B18-4 (04.08.2026)

coolin.at (`apps/web`, Projekt `peak-shaving-web`) rahmt den Rechner (`apps/website`, Projekt
`peak-shaving-website`) unter `/peak-shaving/kalkulator/rechner` per `<iframe src={EMBEDDED_CALCULATOR_SRC}>`
ein (`apps/web/app/(site)/[locale]/peak-shaving/kalkulator/rechner/page.tsx`). Ob ein solches
`<iframe>` etwas anzeigt, entscheidet ausschließlich die GERAHMTE Seite (`apps/website`) über ihre
Response-Header — `X-Frame-Options` bzw. die CSP-Direktive `frame-ancestors`.

**Der Zustand ist ab jetzt eine Zusage, kein Zufall.** `apps/website/next.config.mjs` setzt über
`async headers()` auf **jeder** Route (`source: '/:path*'`):

```
Content-Security-Policy: frame-ancestors 'self' https://coolin.at https://www.coolin.at https://partner.coolin.at
```

**Warum das nötig war (der Befund bis 04.08.2026):** Es gab in `apps/website` keine
`headers()`-Funktion, kein `vercel.json`, keine `middleware.ts` — und damit keine einzige Stelle im
Repo, die `X-Frame-Options` oder eine CSP setzte (repo-weiter Sweep: 0 Treffer). Next.js setzt
`X-Frame-Options` nicht von sich aus. Die Einbettung funktionierte also nur, weil **nichts sie
verbot** — nicht, weil irgendwo eine Erlaubnis stand. Jede versehentlich hinzugefügte Härtung (ein
generisches `X-Frame-Options: DENY`, eine CSP ohne `frame-ancestors`-Ausnahme, ein Vercel-Preset)
hätte sie **kommentarlos** stillgelegt, und es gäbe keine bestehende Ausnahme, die jemand „vergessen"
hätte. Mit dem Partner-Portal kam ein DRITTER Rahmen-Ursprung dazu (`partner.coolin.at`) — der
Anlass, es einmal bewusst zu setzen statt ein zweites Mal auf Zufall zu bauen.

**Gemessen vorher/nachher (nicht gefolgert):**

| Rahmen-Ursprung | vor B18-4 | nach B18-4 |
|---|---|---|
| `https://www.coolin.at` | rahmt | rahmt |
| `https://partner.coolin.at` | rahmt | rahmt |
| `https://example.com` (nicht gelistet) | **rahmt ebenfalls** | **abgewiesen** |

Gemessen wird gegen ECHTE Herkünfte: eine öffentliche Seite der jeweiligen Domain wird geladen und
bekommt per JavaScript ein `<iframe>` auf den Rechner eingehängt — die Herkunft der Rahmen-Seite ist
damit echt (Schema, Host UND Port 443), und genau die bewertet `frame-ancestors`. Der Browser
protokolliert die Abweisung im Klartext („Framing … violates the following Content Security Policy
directive: frame-ancestors …"). Gegenprobe im lokalen Lauf: ein Ziel OHNE CSP rahmt aus derselben
nicht gelisteten Herkunft anstandslos — die Sperre kommt nachweislich von der Richtlinie und nicht
vom Messaufbau.

**⚠ Drei Punkte für den Betrieb:**

1. **Eine weitere Domain wird HIER eingetragen** (`apps/website/next.config.mjs`) — sonst zeigt das
   iframe dort einen leeren Rahmen, und der Grund steht nur in der Browser-Konsole.
2. **`https://coolin.at` steht defensiv in der Liste.** Der Apex liefert heute kein Dokument aus (er
   antwortet 308 auf `www`, s. §1b) und kann deshalb gar nicht als Rahmen-Ursprung auftreten. Wird
   die Richtung je umgestellt, greift die Erlaubnis ohne weitere Änderung; nur `www` zu listen legte
   die Einbettung bei genau dieser Umstellung still.
3. **Die Richtlinie führt AUSSCHLIESSLICH `frame-ancestors`.** Eine vollständige CSP (`default-src`,
   `script-src`, …) ist eine eigene, grössere Entscheidung mit realem Bruchrisiko für den Rechner
   selbst; sie wurde hier bewusst NICHT nebenbei mitgenommen.

---

### 1k. Spotpreis-Sync — dritter Cron-Job (B21-2a, server-only)

Code: `apps/web/app/api/cron/spot-price-sync/route.ts` · reine Logik:
`apps/web/lib/spot-prices/sync.ts` · Zeitplan: `apps/web/vercel.json` · Backfill:
`apps/web/scripts/backfill-spot-prices.mjs` · Ziel: `public.spot_prices` (B21-1) ·
fachliche Quelle: `Pflichtenheft_Kalkulator_Delta_Tarifoptimierung.md`, Delta 7.

**Keine neue Umgebungsvariable.** Der Job benutzt dasselbe `CRON_SECRET` und denselben
`SUPABASE_SERVICE_ROLE_KEY` wie die beiden Jobs aus §1g — ein zweites Geheimnis und eine zweite
Prüfvariante wären zwei Wege, dieselbe Aussenkante falsch zu machen. Alles aus §1g gilt unverändert
mit: Fail-closed, Crons nur in Production, Registrierung hängt am Deployment, **und insbesondere
Deployment Protection (§1i)** — ohne Bypass-Secret verwirft Vercel auch diesen Aufruf, bevor der
Endpunkt ihn sieht.

- **✅ REGISTRIERT (27.08.2026).** Die vier Schritte aus der früheren Fassung dieses Absatzes sind
  abgearbeitet — in genau dieser Reihenfolge, weil ein vor dem Grant registrierter Job täglich in
  einen **42501** gelaufen wäre (kein Datenschaden, keine Mail, aber ein täglich roter Lauf):
  (1) `supabase db push --linked` — lief **ohne** `SUPABASE_DB_PASSWORD` durch, nachdem die
  Konto-Ursache aus §4a behoben war; (2) Rechtefläche gegen die Cloud gemessen, nicht angenommen:
  `service_role` hat dort exakt `INSERT,SELECT,UPDATE` auf `spot_prices` und **gar nichts** auf
  `grid_tariffs`/`grid_tariff_rate_windows`, `anon`/`authenticated` unverändert nur `SELECT` auf
  allen drei, `DELETE` für keine Client-Rolle; ein `anon`-INSERT über die Data API wird mit
  **42501 `permission denied for table`** abgewiesen — also auf **Grant**-Ebene, der direkte Beleg,
  dass das `revoke all` aus B21-1 auch in der Cloud steht; (3) Backfill einmal gegen die Cloud:
  **8.759** Zeilen, Spanne 2025-08-27T19:00Z … 2026-08-27T17:00Z, 0 Duplikate, drei Werte gegen die
  aWATTar-Antwort nachgerechnet (126,12 Eur/MWh → 12,612 ct/kWh usw.); ein zweiter Lauf über einen
  Monat schrieb 743 Zeilen erneut und liess die Gesamtzahl bei **8.759** — das Upsert ist auch in
  der Cloud idempotent; (4) der `crons`-Eintrag steht in `apps/web/vercel.json`.
  **✅ Registrierung live bestätigt** (nicht angenommen): Production-Deployment
  `dpl_AgYuCM1LUXUoQSCqSaWyhqLSBF2z` für Merge-Commit `97bc53b` steht auf `READY`, und
  `GET https://api.vercel.com/v9/projects/<projectId>?teamId=<teamId>` führt im Feld `crons` alle drei
  Jobs mit genau diesem `deploymentId` und `disabledAt: null` — darunter
  `/api/cron/spot-price-sync` mit `20 13 * * *`.
  **⚠️ Der Prüfpfad ist `/v9/projects/<projectId>` (Feld `crons`), NICHT
  `/v1/projects/<projectId>/crons`** — Letzterer antwortet 404. Die Registrierung hängt am
  Production-Deployment, nicht an der Datei (§1g).
- **Vorgesehener Job 3:** `/api/cron/spot-price-sync`, täglich **13:20 UTC**. Holt die
  aWATTar-Marktpreise und legt sie per Upsert ab. **Versendet keine E-Mail** und erreicht niemanden.
- **⚠️ Warum 13:20 UTC — und warum trotz Sommerzeit nur EIN Eintrag.** Die Preise des Folgetags
  stehen nach der Day-Ahead-Auktion ab ungefähr **14 Uhr Ortszeit** fest. Diese Marke wandert übers
  Jahr, ein Vercel-Cron läuft dagegen in UTC und kennt keine Sommerzeit:

  | Jahreszeit | Ortszeit-Marke | entspricht |
  |---|---|---|
  | Winter (CET, UTC+1) | 14:00 | **13:00 UTC** |
  | Sommer (CEST, UTC+2) | 14:00 | **12:00 UTC** |

  `13:20 UTC` liegt in **beiden** Fällen sicher danach — 20 Minuten nach der späteren, winterlichen
  Marke. Zwei DST-abhängige Einträge wären zweimal dieselbe Aufgabe mit der Frage, welcher gerade
  gilt. Dieselbe Fixed-UTC-Konvention wie §1g, nur mit dem für die Schwankung nötigen Abstand.
- **Ein zu früher Lauf ist kein Schaden, nur ein leerer.** Die Quelle liefert dann weniger Einträge,
  das Upsert schreibt weniger Zeilen, `outcome` bleibt `success`. Real gemessen: das Fenster umfasst
  drei Tage, geliefert wurden 46 Stundenwerte (heute vollständig, morgen bis 23:00 Ortszeit,
  übermorgen noch nicht veröffentlicht).
- **Das abgefragte Fenster ist bewusst grösser als nötig** — `[heute 00:00 UTC, +3 Tage)` statt nur
  der Folgetag. Der Mehraufwand ist eine Anfrage; der Gewinn ist, dass ein einzelner ausgefallener
  Lauf sich am nächsten Tag von selbst repariert, statt eine Lücke zu hinterlassen, die niemand
  bemerkt. Möglich nur, weil `unique (provider, ts_start)` (B21-1) das wiederholte Schreiben
  desselben Zeitraums gefahrlos macht.
- **⚠️ Betriebsgrenze: aWATTar-Fair-Use, 100 Abfragen pro Tag.** Der Job braucht **eine**. Der
  Backfill braucht **eine** (ein einzelner Aufruf über den vollen Ankerzeitraum liefert 14.503
  lückenlose Stundenwerte, gemessen am 28.08.2026; die Quelle kennt weder Pagination noch eine
  Obergrenze). Der Abstand zur
  Grenze ist also gross, aber sie ist der Grund, warum es **keine** Wiederholungsschleife im
  Endpunkt gibt: ein fehlgeschlagener Lauf wartet auf den nächsten Tag, statt zu pollen.
- **Kein Laufprotokoll in `platform.job_runs`** — anders als die beiden Jobs aus §1g. Deren Wirkung
  ist unumkehrbar (eine Anonymisierung, eine versendete Mail) und muss nachvollziehbar sein. Hier
  ist die Wirkung ein Upsert öffentlicher Börsenpreise: wiederholbar, ohne Personenbezug, und der
  Zustand ist der Tabelleninhalt selbst. **Die Kontrolle im Betrieb ist deshalb eine Abfrage:**

  ```sql
  select max(ts_start) from public.spot_prices where provider = 'awattar_at';
  ```

  Liegt der Wert nicht mindestens beim morgigen Tagesende, ist der Sync stehengeblieben. Ein
  Protokoll daneben führte einen zweiten Wahrheitsort ein, der mit dem ersten auseinanderlaufen kann.
- **Grant:** Migration `20260827160000_grant_service_role_spot_prices_write.sql` gibt `service_role`
  auf `public.spot_prices` **`insert, update, select`**. Das `select` ist nicht überflüssig:
  `INSERT … ON CONFLICT DO UPDATE` verlangt es in PostgreSQL zusätzlich (Stufe für Stufe als rohes
  SQL gemessen — `insert, update` allein ergibt **42501**). Begründung und Messreihe stehen im Kopf
  der Migration. `grid_tariffs` und `grid_tariff_rate_windows` bleiben für alle Client-Rollen
  verschlossen; ihr Schreibweg ist das Admin-Pflege-UI.
- **Nichts im Supabase-Dashboard zu tun:** `public` ist über die Data API bereits per Default
  exponiert (§2a betrifft nur `monitor`).

#### Einmaliger Backfill — **fester Anker 1.1.2025 (Ortszeit) bis heute**

Holt die historischen Preise ab dem **festen Anker `2024-12-31T23:00:00Z`** bis zum Zeitpunkt des
Laufs. Bewusst ein Skript und **kein** zweiter Modus des Cron-Endpunkts: als offener HTTP-Pfad liesse
sich mit demselben Geheimnis ein beliebig grosser Abruf auslösen — ein Query-Parameter entschiede
dann über die Grösse des Vorgangs (dieselbe Überlegung, aus der §1g die Mengenobergrenze aus dem
Handler heraushält).

```bash
cd apps/web
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… pnpm backfill:spot-prices                      # ab 1.1.2025 Ortszeit
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… pnpm backfill:spot-prices --start 2024-01-01   # abweichender Anfang
```

**⚠️ Warum ein fester Anker und kein rollierendes Fenster (Nachtrag 28.08.2026).** Die erste Fassung
holte „die letzten zwölf Monate ab jetzt". Damit hängt das Ergebnis vom Tag des Laufs ab: der Lauf
vom 27.08.2026 begann bei `2025-08-27T19:00Z` und liess **alles davor leer** — eine Lücke, die
niemand sieht, weil die Tabelle gefüllt aussieht und `max(ts_start)` (die Betriebskontrolle oben)
nur das obere Ende prüft. Ein Neuaufbau (neue Umgebung, neues Projekt) reproduzierte sie an einem
anderen Datum erneut. Der Anker steht deshalb als Konstante `BACKFILL_ANCHOR_ISO` im Skript: derselbe
Aufruf liefert unabhängig vom Ausführungstag denselben Anfang.

**⚠️ Warum `23:00Z` am Vortag und nicht Mitternacht UTC (Nachtrag 29.08.2026).** Der Anker ist die
**Mitternacht der ORTSZEIT** des 1.1.2025 (Europe/Vienna, im Winter UTC+1) — dieselbe Ortszeit-Logik,
mit der Regel B beim Upload gegen den *Kalendertag* prüft
(`packages/shared/src/analysis-window.ts`). Ein österreichischer Kalenderjahr-2025-Lastgang beginnt
mit `01.01.2025 00:00` Ortszeit, in UTC also `2024-12-31T23:00:00Z`. Mit dem früheren Anker
`2025-01-01T00:00:00Z` hatte ausgerechnet dessen **erste Stunde** keinen Preis — und der
aWATTar-Vergleich fiele damit für **jeden** solchen Lastgang unter Delta 15 Regel C („nicht
berechenbar"). Das war keine betriebliche Lücke (kein stehengebliebener Cron), sondern eine
systematische Kante des Ankers, die sich nicht von selbst schliesst. Geschlossen ist sie auf der
Seite des **Bestands**, nicht der Abfrage: eine Stunde mehr Vorrat statt einer Sonderregel im
Abfragebereich. Die Zahl steht ein zweites Mal als `SPOT_PRICE_ANCHOR_ISO` in
`packages/shared/src/analysis-window.ts`; ein Wächter dort liest die Skriptdatei und hält beide
zusammen (`analysis-window.test.ts`). **Das Anker-DATUM (`SPOT_PRICE_ANCHOR_DATE`) ist dabei
unverändert `2025-01-01`** — Regel B lehnt weiterhin genau das ab, was sie vorher ablehnte.

**Der Nachzieh-Lauf vom 29.08.2026, gemessen** (Vorher-Baseline vor dem Lauf erhoben): 14.526
Einträge geholt, Tabelle **14.542 → 14.543** Zeilen — **genau eine neue Zeile**
(`2024-12-31T23:00:00Z`, 109 Eur/MWh → **10,9 ct/kWh**, gegen die echte aWATTar-Antwort
nachgerechnet). Alle 14.542 Bestandszeilen Zeile für Zeile in Anzahl UND Wert unverändert
(`ct_per_kwh`/`ts_end`/`provider`/`price_basis`), **0 Duplikate**, und über den gesamten Bereich
`2024-12-31T23:00Z … 2026-08-29T21:00Z` **kein einziger Nicht-Stunden-Sprung**.

Die Werte kommen aus der Shell, **nicht** aus einer Datei im Repo (§4, Prinzip S1). Das Skript ist
gefahrlos wiederholbar: derselbe Zeitraum ein zweites Mal geschrieben ergibt dieselbe Zeilenzahl
(gemessen — 743 Zeilen zweimal geschrieben, Tabelle danach 743 Zeilen, 0 Duplikate). **Der Nachtrag
selbst ist der grössere Beleg dafür:** der Lauf vom 28.08.2026 holte 14.503 Einträge über den
gesamten Zeitraum, davon 8.759 bereits vorhandene — die Tabelle wuchs von **8.759 auf 14.503** Zeilen
(+5.744 für Jan–Aug 2025), **0 Duplikate**, und alle 8.759 Bestandszeilen blieben in Anzahl UND Wert
unverändert (vorher/nachher Zeile für Zeile verglichen). Stichprobe aus dem neu gefüllten Bereich
gegen die echte aWATTar-Antwort nachgerechnet: 2025-03-15 09:00Z 71,91 Eur/MWh → 7,191 ct/kWh ·
10:00Z 72,64 → 7,264 · 11:00Z 63,17 → 6,317. Lückenprüfung über alle 14.503 Zeilen: **kein einziger
Nicht-Stunden-Sprung**.

### 1l. KI-Zugang für den Tarifblatt-Scan (Admin) ⚠️ ABRECHENBAR — GESETZT

```
ANTHROPIC_API_KEY = sk-ant-…
```

Ohne diese Variable meldet der Scan im Admin-Formular sichtbar **„Der Tarifblatt-Scan ist derzeit
nicht eingerichtet"**, und das Formular bleibt unverändert von Hand ausfüllbar.

**⚠️ KORREKTUR (01.09.2026): Der Schlüssel IST inzwischen gesetzt.** Bis dahin stand hier „NICHT
GESETZT — das ist heute der zu erwartende Zustand", gemessen am 31.08.2026 (16 Einträge, keiner
davon KI). Am 01.09.2026 über die Vercel-API scope-genau nachgemessen: `peak-shaving-web` führt
`ANTHROPIC_API_KEY` für **Production UND Preview**. `not_configured` ist damit **kein** zu
erwartender Produktionszustand mehr. Der Schlüssel im Nachbarprojekt `peak-shaving-website`
(§1-Website-c) bleibt davon unberührt: die beiden Vercel-Projekte lesen ausschliesslich ihre eigenen
Variablen, und die Werte sind unabhängig voneinander zu rotieren.

**⚠️ Er ist im Gegensatz zu den meisten anderen Variablen dieses Projekts als `encrypted` und nicht
als `sensitive` hinterlegt und damit ZURÜCKLESBAR** — über
`GET /v1/projects/peak-shaving-web/env/<envId>` liefert die API den Klartext (bei `sensitive` kommt
eine leere Zeichenkette, s. §1-Website-a). Das ist für eine Nachmessung praktisch und
sicherheitstechnisch die schwächere Einstellung: Wer Zugriff auf den Vercel-Token hat, hat damit
auch den abrechenbaren Schlüssel. Bei der nächsten Rotation als `sensitive` neu anlegen.

**Wo:** Vercel → Project **`peak-shaving-web`** → Settings → Environment Variables → Production
(+ Preview, wenn dort geprüft werden soll). Danach **Redeploy** — der Wert wird zur Laufzeit aus
`process.env` gelesen und erreicht ein bereits gebautes Deployment nicht.

**⚠️ Der Schlüssel ist kein geringeres Geheimnis als der service_role-Schlüssel.** Er ist auf die
Rechnung des Kontos abrechenbar und hat kein Kontingent, das ihn begrenzte — ein Leck merkt man an
der Abrechnung, nicht an einem Fehler. Vor dem Setzen im Anthropic-Dashboard ein **Ausgabenlimit**
hinterlegen. Der Wert ist danach aus Vercel **nicht mehr zurücklesbar** (Typ `sensitive`); wer lokal
prüfen will, holt ihn aus dem Anthropic-Dashboard.

**Es ist derselbe Schlüsselwert wie in `peak-shaving-website` verwendbar, aber ein eigener ist
besser:** zwei Schlüssel lassen sich getrennt rotieren und getrennt in der Abrechnung zuordnen.
**Bei einer Rotation sind beide Projekte zu erneuern**, wenn derselbe Wert an beiden Stellen steht.

#### Was der Scan tut — und was er ausdrücklich nicht tut

Ein hochgeladenes **Preisblatt (PDF)** geht an genau einen Empfänger (Anthropic), für genau einen
Zweck, und wird nirgends gespeichert: keine Datenbank, keine Datei, kein Log mit Inhalt. Aus der
Funktion kommen ausschliesslich die extrahierten Felder.

**Datenschutzrechtlich ist das unauffällig** — und das ist der Unterschied zum Rechnungs-Scan des
Rechners (§1-Website-c): Dort verlässt das Dokument EINES KUNDEN das Gerät, hier ein
**veröffentlichtes Preisblatt eines Netzbetreibers ohne jeden Personenbezug**. Es gibt hier niemanden
aufzuklären und nichts zu erlauben. Der Lastgang kommt in diesem Modul überhaupt nicht vor.

**Der Scan schreibt KEINE Zeile.** Er befüllt das Formular; angelegt wird ein Tarifstand
ausschliesslich, wenn ein Mensch die Werte bestätigt und absendet — über den unveränderten
Schreibweg aus §3c. Das ist keine Bequemlichkeit, sondern die Bedingung, unter der dieser Scan
gebaut wurde: **ein Tarifstand ist nachträglich nicht mehr änderbar** (kein Bearbeiten, kein
Löschen, kein `delete`-Grant) und geht in JEDE künftige Analyse dieser Netzebene ein.

#### Grenzen, die beim Prüfen zu erwarten sind

- **✅ BEHOBEN am 01.09.2026 — ein Preisblatt mit mehreren Netzebenen wird jetzt VOLLSTÄNDIG
  gelesen.** Bis dahin galt: „füllt die ebenenabhängigen Felder NICHT; übernommen werden nur
  Betreibername, Gültigkeitsbeginn und Preisbasis". Der Grund war, dass das Schema genau EINEN
  Tarifstand beschrieb und das Modell eine Zeile hätte auswählen müssen. Beantwortet wird die Frage
  jetzt von der Struktur: Die Antwort trägt eine **Liste von Kandidaten**, je einer für eine
  Kombination aus Netzebene und — auf Netzebene 7 — Messvariante, und die Oberfläche zeigt je
  Kandidat ein eigenes, vorbelegtes Formular. **Jede Zeile wird EINZELN geprüft und einzeln
  angelegt; es gibt bewusst keinen Sammel-Absenden-Knopf.** Gemessen an WN-EX0105: 7 Tarifzeilen,
  Netzebene 7 dreifach, alle 98 Feldwerte gegen das Papier geprüft. Der damals benannte Ausweg
  (dem Modell die im Formular gewählte Netzebene als Hinweis mitgeben) ist damit gegenstandslos und
  wurde NICHT gebaut — er hätte die Antwort von einem Formularzustand abhängig gemacht.
- **Eine Zeile, die sich keiner Netzebene sicher zuordnen lässt, wird WEGGELASSEN, nicht geraten.**
  Findet der Scan gar keine, bleibt es beim Einzelformular; übernommen sind dann nur die drei
  blattweiten Angaben, die Netzebene steht sichtbar auf „— bitte wählen —", und der Hinweis darunter
  nennt den Grund.
- **Der Betreibername kommt als Freitext, NIE als Kennung.** Passt er auf einen bereits eingetragenen
  Betrieb, wird dessen bestehende Kennung benutzt; sonst schaltet das Formular auf „Anderer
  Netzbetreiber …" und lässt das Kennungsfeld **leer**. Eine vom Modell erfundene `operator_id`
  erzeugte keine Ablehnung, sondern eine zweite Betreiber-Identität (§3c).
- **Betrag und Einheit des Grundpreises gelten nur als PAAR.** Fehlt eines, sind beide leer — ein
  übernommener Betrag ohne gelesene Einheit behauptete einen Leistungspreis, auch wenn auf dem Blatt
  eine Jahrespauschale steht (der Unterschied zwischen „Spitzenkappung lohnt sich" und
  „Leistungspreis 0, gar keine Spitzenkappung").
- **Ein unvollständig gelesenes Zeitfenster wird verworfen, nicht ergänzt.** Ein fehlendes Fenster
  sieht der Admin; ein mit geratener Uhrzeit erfundenes gälte rund um die Uhr.
- **Fachliche Dateigrenze 10 MB** (`MAX_TARIFF_SHEET_FILE_BYTES`); `bodySizeLimit` steht auf 24 MB
  und liegt bewusst darüber, damit die Anwendung ablehnt und nicht die Plattform.

#### ✅ Was gegen die ECHTE API gemessen ist (01.09.2026)

Der Bau-Schritt vom 31.08.2026 lief gegen einen **lokalen Stub** der Messages-API, weil kein
Schlüssel vorlag; geprüft war damit die Mechanik, nicht die Ablesequalität. **Beides ist jetzt an der
echten API und am echten Preisblatt gemessen** (WN-EX0105 Vers. 2/2026, zwei Seiten):

- **7 Tarifzeilen erkannt** — Netzebenen 3 bis 6 plus Netzebene 7 dreifach (mit Leistungsmessung,
  ohne Leistungsmessung, unterbrechbare Nutzung).
- **98 Feldwerte Feld für Feld gegen das Papier verglichen, 0 Abweichungen**: drei blattweite
  Angaben, 5 Werte je Kandidat und 10 Zeitfenster mit je 6 Feldern.
- **Die fachlich wichtigste Unterscheidung sitzt**: Netzebene 7 ohne Leistungsmessung steht auf dem
  Blatt als „54,00 (EUR/Jahr)" und kommt als `eur_per_year` zurück, alle übrigen als
  `eur_per_kw_year`. Das ist der Unterschied zwischen „Spitzenkappung lohnt sich" und
  „Leistungspreis 0, gar keine Spitzenkappung" (Delta 3).
- **Das SNAP-Fenster aus der Fussnote auf Seite 2** (1. April bis 30. September, 10:00 bis 16:00
  Uhr) landet bei allen drei Netzebene-7-Zeilen und ausdrücklich bei KEINER der Ebenen 3 bis 6 —
  die Fussnote sagt „gilt nur für Kund*innen auf Netzebene 7".
- **Der Grundpreis 0,00 der unterbrechbaren Nutzung** kommt als echte 0 durch, nicht als „nicht
  erkannt".

Der rekursive Schema-Wächter bleibt trotzdem bestehen und ist mit der Kandidatenliste sogar
wichtiger geworden: Die Aufzählungsfelder liegen jetzt zwei Ebenen tief, und ein Test, der nur die
obersten `properties` gelesen hätte, wäre mit dem Umbau still blind geworden.

**Offen bleibt:** ein Preisblatt, das „bisher" und „neu" NEBENEINANDER führt (die
Mehrfach-Zeitraum-Regel) — WN-EX0105 trägt nur einen Stand, der Fall war daran nicht messbar.

---

---

## 1-Website. Vercel — Projekt `peak-shaving-website` (= `apps/website`, der Kalkulator)

Bis B21-3a hatte dieses Projekt **überhaupt keine** eigene Umgebungsvariable: der Rechner lief
vollständig im Browser, ohne Datenbank, ohne Netzaufruf. Environment Variables liegen unter
**Vercel → Project `peak-shaving-website` → Settings → Environment Variables** — ein ANDERES Projekt
als das aus §1 (`peak-shaving-web`). Wer die Werte dort einträgt, hat nichts erreicht.

### 1-Website-a. Supabase-Lesezugang für Tarif- und Preisdaten (B21-3a, **client-seitig**)

| Variable | Scope | Wert-Herkunft (Dashboard-Feld) |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview, Development | Project Settings → API → **Project URL** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Preview, Development | Project Settings → API Keys → **`anon` `public`** |

- **✅ GESETZT (29.08.2026).** Beide Variablen stehen im Projekt `peak-shaving-website` für
  **Production und Preview** (vorher hatte das Projekt **null** Umgebungsvariablen — Baseline vor
  dem Eintrag gemessen). *Development* ist bewusst nicht gesetzt: der lokale Lauf liest
  `.env.local`, und ohne die läuft der Rechner ohnehin weiter (s. u.).
- **⚠️ Der Projekt-Ref ist `amdeupwgytuvgpacsywh`, NICHT `pvzkhkqfbflbnechlror`** — Letzteres ist die
  **Organisation** (so steht es auch in §4a-bis und in der Ausgabe von `supabase projects list`, wo
  beide Spalten nebeneinander stehen). Mit der Org-Kennung als Projekt-Ref antwortet
  `GET /v1/projects/<ref>/api-keys` mit **404**, was wie ein fehlendes Token-Recht aussieht und
  keines ist. Die Projekt-Kennung steht in `supabase/.temp/project-ref`.
- **Eingetragen ist der `anon`-Schlüssel (legacy JWT), wie die Tabelle es nennt.** Das Projekt führt
  daneben einen neueren `sb_publishable_…`-Schlüssel; **beide wurden gegen die Cloud geprüft und
  liefern dieselbe Zeile** (`spot_prices`, HTTP 200). Wer auf die neuen Schlüssel umstellt, stellt
  beide Projekte gemeinsam um — nicht nur dieses.

Dasselbe Supabase-Projekt wie in §1a (eine Plattform, ein Projekt) — nur unter den **`NEXT_PUBLIC_`**-
Namen, die das Root-`.env.example` seit jeher für genau diesen Fall reserviert.

#### ⚠️ Warum hier `NEXT_PUBLIC_`, obwohl §1a das ausdrücklich verbietet

Das ist kein Widerspruch, sondern der andere Fall. `apps/web` liest Supabase **ausschliesslich
server-seitig**; ein nicht-präfixter Name kann dort strukturell nie ins Client-Bündel gelangen, und
genau deshalb steht er dort so. `apps/website` ist das Gegenteil: der Rechner rechnet im Browser
(Prinzip 4), die Abfrage läuft im Browser, und eine nicht-präfixte Variable wäre dort schlicht
`undefined`. **Nicht die Namen aus §1a hier eintragen und nicht die Namen von hier dort** — beide
Projekte lesen nur ihre eigenen.

Der `anon`-Schlüssel ist öffentlich und für den Browser gedacht. Er schützt nichts; RLS tut es
(§3b: die drei Tabellen tragen genau eine SELECT-Policy und für keine Rolle ein Schreibrecht).

#### Fehlen sie, läuft der Rechner weiter

Beide Variablen sind **optional**. Ohne sie bricht weder Build noch Start: die Datenschicht meldet
`not_configured`, und die Peak-Shaving-Rechnung — die keine Marktpreise braucht — funktioniert
unverändert. Das ist Absicht: ein lokaler Lauf ohne `.env.local` soll den Rechner nicht lahmlegen.
**Was ohne sie NICHT geht, sobald B21-3b steht:** der aWATTar-Tarifvergleich.

#### Was dabei den Browser verlässt — und was nicht ⚠️ FÜR DEN DATENSCHUTZHINWEIS

Die Zusage aus Prinzip 4 bleibt: **Lastgang, Messwerte und Datei werden nicht hochgeladen.** Eine
Abfrage trägt aber zwangsläufig ihre Parameter mit — gewählter Netzbetreiber, Netzebene und die
**Zeitgrenzen des Lastgangs** (Delta 15 Regel A: das Abfragefenster IST der Lastgang). Aus „Juni 2025
bis Juni 2026" folgt nichts über einen Verbrauch, aber es ist mehr als nichts. Die Alternative —
die gesamte Preistabelle in den Browser laden — bedeutete rund 8.760 Zeilen je Analyse und liesse die
Zeitgrenzen trotzdem nicht verschwinden. Der Schnitt ist bewusst so gesetzt; er gehört in den
Datenschutzhinweis, nicht in eine Fussnote.

#### Prüfen, ob es wirkt

```bash
# Sind die Referenzdaten für `anon` überhaupt lesbar? (ohne Anmeldung, gegen die Cloud)
curl -s "https://<PROJECT_REF>.supabase.co/rest/v1/spot_prices?select=ts_start&limit=1" \
  -H "apikey: <ANON_KEY>"
```

Antwortet das mit einer Zeile, stimmt der Zugang. Ein `42501` bedeutet, dass die B21-1-Grants fehlen
(§3b), **nicht** dass die Variable falsch ist.

### 1-Website-b. Serverseitiger Schreibzugang für das Report-Gate (Delta 16b) ⚠️ HÖCHSTE TRAGWEITE

| Variable | Scope | Wert-Herkunft (Dashboard-Feld) |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Production, Preview | Project Settings → API Keys → **`service_role` `secret`** |
| `SUPABASE_URL` | optional | Project Settings → API → **Project URL** — fehlt sie, wird `NEXT_PUBLIC_SUPABASE_URL` benutzt |

- **✅ GESETZT UND AKTIV SEIT 30.08.2026.** `SUPABASE_SERVICE_ROLE_KEY` steht im Projekt
  `peak-shaving-website` als EIN Eintrag für **Production und Preview**, Typ `sensitive` (also nicht
  zurücklesbar — dieselbe Einstellung wie in §1a). Baseline vor dem Eintrag gemessen: das Projekt
  hatte **4** Einträge (die zwei `NEXT_PUBLIC_`-Variablen je Scope), danach **5**.
  `peak-shaving-web` ist dabei **unangetastet** geblieben — vorher wie nachher **16** Einträge.
- **`SUPABASE_URL` ist bewusst NICHT gesetzt.** Der Code liest sie mit Rückfall auf
  `NEXT_PUBLIC_SUPABASE_URL`, und die steht bereits (§1-Website-a). Eine zweite Variable mit
  demselben Wert wäre ein zweiter Ort, an dem beim nächsten Projektwechsel eine veraltete
  Projekt-URL stehen bleiben kann.
- **Es ist der `service_role`-Schlüssel vom Typ `legacy`** (JWT, 219 Zeichen) — derselbe, den §1a
  für `peak-shaving-web` nennt. Das Projekt führt daneben einen neueren `sb_secret_…`; eine
  Umstellung darauf betrifft **beide** Projekte gemeinsam und ist kein Nebeneffekt.
  ⚠️ Der Wert wurde **nicht** aus `peak-shaving-web` kopiert — dessen Variablen sind `sensitive`
  und damit nicht auslesbar. Er stammt aus der Quelle
  (`GET /v1/projects/<ref>/api-keys`, Projekt-Ref `amdeupwgytuvgpacsywh`) und wurde vor dem
  Eintragen **gegen die Cloud geprüft**: Payload trägt `"role": "service_role"`, ein RPC auf
  `get_active_consent_text` antwortet **200**, derselbe Aufruf mit dem `anon`-Schlüssel **42501**.
- **Ein neues Deployment ist Pflicht.** Die Variable wird zur LAUFZEIT gelesen; ein bereits
  gebautes Deployment bekommt sie nicht nachträglich. Am 30.08.2026 per Redeploy des
  Production-Deployments von `ab17e272` wirksam gemacht.

> ⚠️ **DAS IST DER MÄCHTIGSTE SCHLÜSSEL DES GESAMTEN PROJEKTS.** Er umgeht **jede** RLS: Wer ihn hat,
> liest und schreibt den kompletten Lead-Bestand, alle Einwilligungen, alle Zahlungsdaten und alle
> Analysen — quer über beide Produkte. Bis Delta 16b lag er ausschliesslich im Vercel-Projekt
> `peak-shaving-web`; seither liegt er in einem **zweiten** Projekt, und damit gibt es einen zweiten
> Ort, an dem er verlorengehen kann. Wer ihn rotiert, rotiert ihn in **BEIDEN** Projekten
> (`peak-shaving-web` §1a **und** `peak-shaving-website` hier) — ein einseitig rotierter Schlüssel
> legt genau eine der beiden Anwendungen still, und zwar erst beim nächsten echten Aufruf.

**⚠️ NIEMALS mit `NEXT_PUBLIC_` präfixen.** Next setzt `NEXT_PUBLIC_`-Werte zur Bauzeit **textuell**
ins Client-Bündel ein; unter diesem Präfix stünde der service_role-Schlüssel im ausgelieferten
JavaScript und wäre öffentlich. Das ist der Grund, warum diese App jetzt **zwei** Namensfamilien
führt: die aus §1-Website-a sind für den Browser bestimmt, die hier ausdrücklich nicht.

**Wofür genau — und für nichts sonst.** Der Schlüssel wird an **einer** Stelle gelesen
(`apps/website/lib/report-gate/service-role.ts`) und von **einer** Datei benutzt
(`apps/website/lib/report-gate/store.ts`), die genau **zwei** `public`-Wrapper aufruft:
`get_active_consent_text` (lesend, der anzuzeigende Einwilligungswortlaut) und `capture_lead`
(schreibend, Lead + Einwilligung). Beide sind `service_role`-only gegrantet — es gibt keine zweite
Tür. Ein Import des Client-Moduls aus irgendeiner anderen Datei ist ein **Lint-Fehler**
(`no-restricted-imports`, root `eslint.config.mjs`), und `import 'server-only'` bricht den Build,
falls er je aus einer Client-Komponente gezogen wird.

**Fehlt er, bleibt der Rechner vollständig benutzbar — aber der PDF-Knopf gibt nichts frei.** Der
Dialog holt den Einwilligungswortlaut serverseitig; ohne Zugang bekommt er `null`, zeigt die
Ankreuzmöglichkeit **gar nicht** und sagt im Klartext, dass die Zustimmung gerade nicht eingeholt
werden kann. Das ist Absicht und **fail closed**: ein Report mit Namen auf dem Deckblatt, ohne dass
eine Einwilligung entstanden ist, wäre schlimmer als ein Knopf, der nicht auslöst. Rechnen, Charts,
CSV-Export und Analyse-Bündel sind davon unberührt.

**Bot-Schutz:** Das Gate schützt sich mit einem **Honeypot** (verstecktes Feld `website`, immer
aktiv, serverseitig ausgewertet). **Turnstile gibt es in diesem Projekt NICHT** — es lebt
ausschliesslich in `peak-shaving-web` (§1c, `lib/kontakt/turnstile.ts`). Wer es hier nachrüstet,
braucht `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` **in diesem** Projekt und das
Widget im Dialog; die Schlüssel aus §1c gelten dort nicht mit.

#### Prüfen, ob es wirkt

```bash
# 1. Der Schlüssel darf NIRGENDS im ausgelieferten JavaScript stehen — gegen die PRODUKTION.
#    ⚠️ Mit einer GEGENPROBE fahren: der anon-Schlüssel MUSS gefunden werden, sonst greift der
#    Grep gar nicht und „0 Treffer" bedeutet nichts. Und Vorsicht beim JWT-Präfix
#    `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9` — das tragen anon UND service_role; das Payload
#    dekodieren und `role` lesen, statt am Präfix zu entscheiden.
BASE=https://peak-shaving-website-ten.vercel.app
curl -s "$BASE/rechner?embed=1" | grep -oE '/_next/static/chunks/[^"]+\.js' | sort -u > /tmp/c.txt
while read -r c; do curl -s "$BASE$c" | grep -c "service_role"; done < /tmp/c.txt   # alles 0

# 2. Wirkt das Gate live? Rechner öffnen, eine Analyse fahren, „Als PDF speichern" klicken.
#    Erscheint der Einwilligungstext (er beginnt mit „[MARTIN: Copy / rechtlich …"), ist der
#    serverseitige Zugang da. Steht stattdessen „Der Einwilligungstext ist gerade nicht abrufbar",
#    fehlt der Schlüssel — oder die Migration 20260830090100 ist nicht gepusht.
```

**Am 30.08.2026 live gegen die Produktion gemessen** (Playwright, voller 4-Schritt-Durchlauf):
Fail-closed-Meldung **verschwunden**, Einwilligungstext kommt aus `platform.consent_texts`, Haken
`unchecked`, ohne Haken **0** Druckvorgänge, Honeypot serverseitig abgewiesen (**0** Druckvorgänge),
Erfolg gibt den Druck frei und das Deckblatt trägt Name und Firma, **0 Konsolenfehler**. Über
`admin_list_leads` gegengelesen: Herkunft `rechner-report`, genau **eine** Einwilligung
`offer_contact` / `confirmed`. Der dafür angelegte Prüf-Lead (`…@example.invalid`) ist danach
**entfernt** und der Zählstand auf den vorher gemessenen Wert zurückgeführt worden — ein
synthetischer Eintrag verfälschte sonst genau die Statistik, für die es diese Herkunft gibt.
**11 Client-Chunks der Produktion geprüft: 0 Vorkommen des Schlüssels, 0 Vorkommen von
`service_role`; der einzige JWT im Bündel trägt `"role": "anon"`.**

### 1-Website-c. KI-Zugang für Rechnungs-Scan (Delta 9b-2) und PV-Auslegungs-Scan (B22c) ⚠️ ABRECHENBAR — GESETZT, ECHT GEPRÜFT

| Variable | Scope | Wert-Herkunft |
|---|---|---|
| `ANTHROPIC_API_KEY` | Production, Preview | console.anthropic.com → **API Keys** → neuen Schlüssel erzeugen (`sk-ant-…`) |

- **✅ GESETZT UND GEGEN DIE ECHTE API GEPRÜFT (31.08.2026).** Vercel `peak-shaving-website` führt
  `ANTHROPIC_API_KEY` für **Production und Preview**, Typ `sensitive`. Baseline vorher gemessen
  (Arbeitsregel 3): das Projekt hatte **5** Einträge, danach **6**. `peak-shaving-web` ist
  unangetastet und bekommt bewusst keinen KI-Zugang.
- **⚠️ DER WERT IST AUS VERCEL NICHT ZURÜCKLESBAR.** Typ `sensitive` heisst: `GET /v10/projects/
  <id>/env?decrypt=true` liefert den Namen und `value` mit **Länge 0**, und `vercel env pull` legt
  die Zeile mit leerem Wert an (beides am 31.08.2026 gemessen). Wer den Schlüssel lokal braucht
  — etwa um die Ablesequalität an echten Rechnungen nachzumessen —, holt ihn aus dem
  Anthropic-Dashboard, **nicht** aus Vercel.

> ⚠️ **DER ERSTE ECHTE AUFRUF HAT EINEN TOTALAUSFALL AUFGEDECKT (31.08.2026) — behoben.** Das
> JSON-Schema deklarierte die drei Aufzählungsfelder als `type: ['string', 'null']` mit `null` in
> der `enum`-Liste. Nach JSON Schema ist das gültig; die API weist es mit **HTTP 400** ab
> (`Invalid schema: Enum value 'wiener_netze' does not match declared type '['string', 'null']'`),
> und zwar **bevor das Modell die Rechnung sieht**. Wirkung: **jeder** Scan endete in `api_error`
> — das Modul war seit dem Merge von 9b-2a in Produktion vollständig funktionslos. Der Bau-Schritt
> hatte den Pfad gegen einen lokalen **Stub** der Messages-API gemessen, und ein Stub validiert das
> Schema nicht. Die Fassung ist jetzt `anyOf: [{ type, enum }, { type: 'null' }]`; ein Test in
> `packages/shared/src/invoice-scan.test.ts` pinnt sie und verbietet die Kombination „Typ-Union +
> `enum`" im gesamten Schema. **Lehre für den nächsten externen Dienst: ein Stub beweist die
> Mechanik, nicht die Annahme des Gegenübers.**

> ⚠️ **„LIVE PRÜFEN, OB DER SCHLÜSSEL WIRKT" GEHT VOR 9b-2b NICHT — und das ist keine Nachlässigkeit,
> sondern eine Eigenschaft des Bauschnitts.** `isInvoiceScanConfigured()` und `scanInvoice()` haben
> im gesamten Repo **null Aufrufer**: 9b-2a ist reines Backend, es gibt keine Route, keine Seite und
> kein Formular, das sie anfasst. Ein gesetzter Schlüssel ist damit über die ausgelieferte
> Anwendung **nicht beobachtbar**. Genau deshalb ist der Ausfall oben erst durch einen Aufruf
> **ausserhalb** der Anwendung gefunden worden — mit einem Bündel des echten Moduls
> (`esbuild --external:@anthropic-ai/sdk --external:server-only`, `node --conditions=react-server`)
> gegen die echten Rechnungen. Der erste Live-Nachweis über die Oberfläche entsteht mit 9b-2b.

- **Er gehört in `peak-shaving-website`, NICHT in `peak-shaving-web`.** Der Rechnungs-Scan lebt im
  Kalkulator; die Marketing-/Admin-App ruft kein Modell auf. Ein Schlüssel dort wäre eine dritte
  offene Fläche ohne Nutzen.
- **Ein neues Deployment ist Pflicht.** Die Variable wird zur LAUFZEIT gelesen (require-on-use,
  genau die Eigenschaft, die sie aus dem Bündel heraushält) — ein bereits gebautes Deployment
  bekommt sie nicht nachträglich. Dieselbe Falle wie bei §1-Website-b.

> ⚠️ **DIESER SCHLÜSSEL IST EINE OFFENE KASSE.** Anders als der `anon`-Schlüssel schützt ihn keine
> RLS, und anders als ein Formular-Geheimnis hat er kein Kontingent, das ihn begrenzte: Wer ihn hat,
> stellt beliebig viele Aufrufe auf die Rechnung des Kontos. Er gehört damit in dieselbe
> Sorgfaltsklasse wie der service_role-Schlüssel aus §1-Website-b. Ein Leck merkt man an der
> Abrechnung, nicht an einem Fehler — deshalb im Anthropic-Dashboard ein **Ausgabenlimit** setzen,
> bevor der Pfad live geht. Rotation ist gefahrlos: der Schlüssel ist zustandslos, es hängen keine
> versendeten Links daran (anders als `LEAD_TOKEN_SECRET`, §1e). Im Dashboard neu erzeugen, hier
> setzen, neu deployen, alten Schlüssel widerrufen.

**⚠️ NIEMALS mit `NEXT_PUBLIC_` präfixen.** Gleiche Begründung wie in §1-Website-b: Next setzt
solche Werte zur Bauzeit **textuell** ins Client-Bündel ein.

**Wofür genau — und für nichts sonst.** Der Schlüssel wird an **einer** Stelle gelesen
(`apps/website/lib/invoice-scan/ai-client.ts`) und von **einer** Datei benutzt
(`apps/website/lib/invoice-scan/extract.ts`), die **genau einen** Aufruf macht: eine hochgeladene
Rechnung als `document`-Block an die Messages-API, mit einem erzwungenen JSON-Schema. Es gibt
bewusst **keine** allgemeine, wiederverwendbare KI-Hilfsfunktion. Ein Import des Client-Moduls aus
irgendeiner anderen Datei ist ein **Lint-Fehler** (`no-restricted-imports`, root
`eslint.config.mjs`), und `import 'server-only'` bricht den Build, falls er je aus einer
Client-Komponente gezogen wird.

**Modell und Kosten.** `claude-sonnet-5` (Kennung in `ai-client.ts`, `INVOICE_SCAN_MODEL`). Eine
Rechnung von ein bis wenigen Seiten liegt in der Grössenordnung weniger Cent je Scan. Bewusst nicht
das kleinste Modell: ein um den Faktor 10 falsch abgelesener Leistungspreis fällt in einer
Wirtschaftlichkeitsrechnung **nicht als Fehler auf, sondern als überraschend gutes Ergebnis**
(dieselbe Überlegung wie bei der Eur/MWh-Umrechnung in §1k).

**Fehlt er, bleibt der Rechner vollständig benutzbar.** Der Scan meldet `not_configured` und macht
**keinen** Aufruf; Datei-Upload, Standardprofil, Rechnung, Charts, PDF und Analyse-Bündel sind
unberührt. Das ist Absicht — der Rechnungs-Scan ist ein dritter Einstieg, kein Fundament.

**⚠️ Was dabei den Browser verlässt — GEHÖRT IN DEN DATENSCHUTZHINWEIS.** Für den **Lastgang** gilt
Prinzip 4 unverändert: er wird nicht hochgeladen. Für die **Rechnung** gilt es nicht mehr — sie
geht als Datei an die Anthropic-API. Sie wird dabei **nirgends gespeichert** (keine Datenbank, keine
Datei, kein Log), und aus der Funktion kommen ausschliesslich die extrahierten Felder heraus. Der
Hinweis an den Kunden ist Teil der Oberfläche (9b-2b) und **muss** vor dem Livegang stehen. Ein
AV-Vertrag mit Anthropic ist dafür zu klären — er ist im ruhenden Monitor-Pflichtenheft schon
einmal als offener Rechtspunkt vermerkt worden und wird hier zum ersten Mal wirklich fällig.

#### Prüfen, ob es wirkt

```bash
# 1. Der Schlüssel darf NIRGENDS im ausgelieferten JavaScript stehen.
#    ⚠️ Mit GEGENPROBE fahren, sonst bedeutet „0 Treffer" nichts — und der Scan-Code muss
#    überhaupt im Build sein (ohne Oberfläche wird er wegoptimiert und der Grep ist wertlos).
cd apps/website && rm -rf .next
ANTHROPIC_API_KEY=SENTINEL_XYZ NEXT_PUBLIC_SUPABASE_ANON_KEY=SENTINEL_ANON npx next build
grep -rl SENTINEL_XYZ  .next          | wc -l   # muss 0 sein (GANZES .next, nicht nur static/)
grep -rl SENTINEL_ANON .next/static   | wc -l   # Positivkontrolle: muss >= 1 sein
grep -rl claude-sonnet-5 .next/server | wc -l   # Voraussetzung: >= 1, sonst ist der Code gar nicht drin

# 2. Wirkt der Scan live? Rechner öffnen, den Rechnungs-Einstieg wählen, eine Rechnung hochladen.
#    „Der Rechnungs-Scan ist nicht eingerichtet" heisst: Variable fehlt oder Deployment ist alt.
```

#### Nachtrag B22c (02.09.2026): derselbe Schlüssel, ein ZWEITER Verbraucher in dieser App

**Es ist KEINE neue Variable.** `ANTHROPIC_API_KEY` in `peak-shaving-website` trägt ab jetzt zwei
Anbindungen: den Rechnungs-Scan (`lib/invoice-scan/**`) und den PV-Auslegungs-Scan
(`lib/pv-design-scan/**`, die **sechste** KI-Anbindung des Projekts). Beide lesen ihn an je einer
Stelle, beide haben einen EIGENEN Client, und der ESLint-Eintrag erlaubt je Client GENAU EINE Datei
— ein gemeinsames Client-Modul hätte mehrere erlaubte Orte und damit keine Bremse mehr.

**Praktische Folge für die Rotation:** unverändert ein Wert an einem Ort — aber ein Widerruf legt ab
jetzt **beide** Scans still. Der Rechner bleibt in beiden Fällen vollständig benutzbar
(`not_configured`, kein Aufruf); Datei-Upload, Standardprofil, PV-Formular, PVGIS-Abruf, Rechnung,
Charts, PDF und Analyse-Bündel sind unberührt.

**⚠️ Der Scan liest ein PLANUNGSDOKUMENT, keine Rechnung — und das ist ein eigener
Datenschutz-Sachverhalt.** Ein PV-Angebot trägt üblicherweise Name und Adresse des Kunden im Kopf.
Die Datei geht wie die Rechnung an Anthropic, wird **nirgends gespeichert**, und aus der Funktion
kommen ausschliesslich die extrahierten Felder. Der Hinweis darauf steht sichtbar am Upload
(`components/flow/pv-design-panel.tsx`) und ist ausdrücklich ein ANDERER Satz als der des
PVGIS-Abrufs daneben: dorthin gehen nur Koordinate und Auslegung, hierhin die ganze Datei. Der
AV-Vertrag mit Anthropic bleibt derselbe offene Rechtspunkt.

**Grössengrenze und `bodySizeLimit`.** `MAX_PV_DESIGN_FILE_BYTES` = **8 MB**
(`lib/pv-design-scan/ai-client.ts`) — grösser als die 6 MB des Rechnungs-Scans, weil ein
Planungsexposé zwei Dutzend Seiten mit Diagrammen hat statt ein bis wenige (das vorliegende: 19
Seiten, 1,1 MB). `experimental.serverActions.bodySizeLimit` in `apps/website/next.config.mjs` ist
dafür von **8 auf 12 MB** angehoben: bei 8 MB läge die fachliche Grenze genau auf der
Plattformgrenze, und eine Datei knapp darunter scheiterte am Rumpf-Overhead statt an unserer
Prüfung. **Für den Rechnungs-Scan ändert das nichts an der zulässigen Grösse** — seine eigene
6-MB-Prüfung läuft unverändert in seiner Server Action; was sich ändert, ist die ART der Ablehnung
zwischen 8 und 12 MB (jetzt ein Satz aus der Anwendung statt eines Plattformfehlers).

> ✅ **GEGEN DIE ECHTE API UND DAS ECHTE DOKUMENT GEMESSEN (02.09.2026)** — anders als bei 9b-2a,
> das gegen einen Stub gebaut wurde und deshalb den HTTP-400-Totalausfall nicht gesehen hat. Voller
> 4-Schritt-Durchlauf über die echte Oberfläche gegen einen Production-Build, mit dem echten
> PV\*SOL-Exposé (19 Seiten) und einem echten PVGIS-Abruf: **30/30 Prüfungen grün, 0
> Konsolenfehler**, Extraktion 5,3 s. Gelesen wurden beide Modulflächen mit `4,25` und `5,95 kWp`,
> `90°` Neigung, `Südosten` und der gedruckten `133°`; PVGIS spiegelte daraus **Azimut −47°**
> zurück — die Konventions-Umrechnung ist damit end-to-end belegt und nicht bloss behauptet.
> Fehlerpfade einzeln gefahren: CSV im PDF-Feld → „Nur PDF" (ohne externen Kontakt), eine
> Stromrechnung → „Keine Modulfläche gefunden", zweiter Server ohne Schlüssel → „nicht verfügbar",
> und in allen drei Fällen blieb das Formular voll benutzbar.

> ⚠️ **WAS DAMIT NICHT GEMESSEN IST: DIE FORMATROBUSTHEIT.** Es liegt **genau ein**
> PV\*SOL-Dokument vor (eine Programmversion, ein Planer, eine Sprache). Ob die Feldbezeichner in
> anderen Versionen gleich heissen, ob PVsyst/Polysun/Hersteller-Konfiguratoren vergleichbare
> Felder ausweisen und ob deren Azimut-Zählweise dieselbe ist, ist **nicht ableitbar** — zwischen
> den zwei bisher gemessenen Werkzeugen ist sie es nachweislich nicht. Nötig sind fünf bis zehn
> echte Auslegungen verschiedener Herkunft, darunter mindestens ein Scan und mindestens ein
> Nicht-PV\*SOL-Werkzeug, je mit Feld-für-Feld-Abgleich gegen das Papier (Owner Martin,
> `Pflichtenheft_PV_Zeitreihengenerator.md` §4). Bis dahin trägt die Bestätigungsstufe die Last:
> der Scan belegt vor, er stellt nichts fest.

**Modell und Kosten (B22c).** `claude-sonnet-5` (`PV_DESIGN_SCAN_MODEL`). Bewusst nicht das
kleinste Modell, und der Grund ist gemessen: eine um 180° verwechselte Ausrichtung senkt die
ausgewiesene Ersparnis um **56 %**, und die falsche Zahl sieht völlig plausibel aus (eine schlecht
ausgerichtete Fassadenanlage). Ein 19-seitiges Dokument mit mehreren Modulflächen ist genau die
Aufgabe, bei der ein kleineres Modell Zeilen verwechselt.

**✅ ERLEDIGT AM 31.08.2026:** Der Extraktionspfad ist gegen das echte Modell gelaufen — dabei kam
zuerst der Schema-Totalausfall oben heraus, und nach dessen Behebung die Ablesequalität. Zwei echte
Jahresabrechnungen eines Bestandskunden (Wiener Netze, NE 7, H0 — eine volle Zwölf-Monats-Abrechnung,
eine reine Einspeise-Teilabrechnung) durch den Produktionspfad: **20 Felder, 0 falsche Werte**,
18 exakt richtig, 2 vorsichtig auf `null` gelassen. Insbesondere blieb der Leistungspreis leer, wo die
Netzleistung als Tagespauschale abgerechnet wird; der Energiepreis blieb leer bei einem Flex-Tarif
mit dreizehn Monatspreisen; und der Jahresverbrauch blieb auf der Teilabrechnung leer, obwohl eine
Einspeisemenge und ein Vorperioden-Verbrauch danebenstanden. **Dateien und Zahlen liegen bewusst
nicht im Repo und wurden nicht als Testfall committet** (Kundendaten gehören nicht in den Bestand,
auch nicht anonymisiert).

**✅ ERLEDIGT AM 31.08.2026 — die Mehrfach-Zeitraum-Regel steht.** Weist eine Rechnung denselben
Posten mit mehreren Sätzen für mehrere Gültigkeitszeiträume aus, gilt jetzt der Wert des **zuletzt
endenden Abschnitts** — nicht `null`, nicht der erste, nicht der grösste und ausdrücklich kein
Durchschnitt. Die Regel steht im System-Prompt (`apps/website/lib/invoice-scan/extract.ts`); der
`USER_PROMPT` ist mitgezogen, weil sein bisheriges „lass null, was nicht EINDEUTIG dasteht" ihr
direkt widersprochen hätte.

**⚠ OFFEN SEIT 02.09.2026 — die Grundgebühr des Lieferanten ist NEU und noch nicht an einer echten
Rechnung gemessen.** `rates.supplierBaseFeeEurPerMonth` (Delta 19 / §3.7.3) wird ab jetzt mitgelesen
und belegt das gleichnamige Feld in Schritt 2 vor. Geprüft ist bislang nur der prüfbare Teil
(Schema, Auswertung, die Trennlinie in der Anweisung — `packages/shared/src/invoice-scan.test.ts`);
es lag kein Schlüssel vor. **Worauf beim Nachmessen zu achten ist:** Auf derselben Rechnung stehen
ZWEI verbrauchsunabhängige Pauschalen — die des LIEFERANTEN und der Grundpreis des NETZBETREIBERS —,
und beide heissen oft wörtlich „Grundpreis". Der System-Prompt entscheidet deshalb am
RECHNUNGSABSCHNITT (Energielieferung gegen Netznutzung), nicht am Wort. Die gefährliche Fehlleistung
ist nicht ein leeres Feld, sondern der Netz-Posten an dieser Stelle: er sieht wie eine korrekte
Ablesung aus und verschiebt den Monatsvergleich zugunsten des Tarifwechsels (§3.7.3 legt ihn auf
ALLE DREI Reihen, diese Gebühr nur auf „Ihr Tarif heute"). **Beim Nachmessen also beide Beträge
gegen das Papier halten, nicht nur einen.** Ebenfalls zu prüfen: eine als TAGESpauschale
ausgewiesene Gebühr muss `null` bleiben, und `null` ist auch dort richtig, wo sich der Abschnitt
nicht zuordnen lässt.

**Zwei weitere Regeln stammen aus derselben Messreihe** und sind mit einer Sonde auf die ROHE
Modellantwort ermittelt worden, nicht erraten:

- **Vorzeichen.** Die Einspeisevergütung steht auf Rechnungen als Gutschrift mit Minuszeichen. Das
  Modell lieferte sie mal als `4.56`, mal als `-4.56`; `parseInvoiceExtraction` weist negative Werte
  ab, aus `-4.56` wurde also `null`. Von aussen sah das aus wie „mal erkannt, mal nicht" — tatsächlich
  war sie jedes Mal erkannt und einmal weggeworfen. Der Prompt verlangt jetzt den Betrag ohne Vorzeichen.
- **Bezug gegen Einspeisung.** Auf einer reinen Einspeise-Teilabrechnung steht unter den Netzentgelten
  „(Rest-)Einspeisung Erzeuger … 0,00 ct/kWh". Das Modell trug diese 0 als Netz-Arbeitspreis ein — eine
  Rechnung ganz ohne Netzbezug hätte damit „Netzentgelt = 0 ct/kWh" behauptet. Nicht sichtbar falsch,
  aber still falsch, und genau die Sorte Zahl, die in einer Wirtschaftlichkeitsrechnung als gutes
  Ergebnis erscheint statt als Fehler. `arbeitspreisNetzCtPerKwh` ist jetzt ausdrücklich auf BEZOGENE
  Energie eingegrenzt.

**Gemessen gegen die echte API** (`claude-sonnet-5`), drei Dokumente: eine synthetische
Mehrfach-Zeitraum-Rechnung (drei Arbeitspreis-Abschnitte, je zwei für Netznutzung, Netzleistung und
Einspeisung) und die beiden echten Kundenrechnungen. Auf der synthetischen trifft jedes der vier
Mehrfach-Felder den aktuellsten Satz — beim Arbeitspreis weder den ersten noch den grössten, bei der
Einspeisevergütung bewusst den *kleineren* der beiden, sodass „nimm den grössten" ausgeschlossen ist.
Auf den echten Rechnungen sind **alle sechs Zahlenfelder über drei Läufe bit-identisch**; der
Netz-Arbeitspreis der Teilabrechnung ist von `0` auf `null` gewechselt (die Abgrenzung greift), und
der Leistungspreis der Vollrechnung bleibt korrekt `null` — dort gibt es zwar zwei Zeitabschnitte,
aber die Netzleistung wird als **Tagespauschale** abgerechnet, nicht je kW; die Zeitraum-Regel darf
und soll dort nicht greifen.

**Nachbau der Prüfung:** die synthetische Rechnung ist ein Textdokument mit je zwei bis drei datierten
Abschnitten pro Posten, bei denen der jüngste Wert weder der erste noch der grösste ist. Sie liegt
bewusst **nicht im Repo** (dieselbe Regel wie bei den Prüf-PDFs aus 9b-2a: ein Artefakt, das nur eine
Extraktion auslöst, gehört nicht in den Bestand) und ist in wenigen Zeilen neu erzeugt. Gefahren wird
sie über ein esbuild-Bündel des echten Moduls ausserhalb des Repos
(`--external:@anthropic-ai/sdk --external:server-only`, `node --conditions=react-server`).

> ⚠️ **ZWEI PUNKTE BLEIBEN OFFEN — beide gemessen, beide bewusst nicht in diesem Schritt behoben.**
>
> **(a)** ~~`meteringVariant` ist weiterhin unbeständig.~~ **✅ ERLEDIGT AM 31.08.2026.** Die
> Benennungs-Regel steht jetzt im System-Prompt: je Wert eine Liste der Formulierungen, die
> österreichische Rechnungen tatsächlich verwenden, dazu die Verwechslung, die den Fall trug (das
> blosse Wort „Leistung" ist kein Hinweis auf eine Leistungsmessung — entscheidend ist je kW gegen
> je Tag), und als Vorbedingung: rechnet ein Dokument gar keinen Bezug ab, ist das Feld `null`. Die
> Schema-Beschreibung in `packages/shared` ist mitgezogen, weil ihr „…, wenn die Rechnung sie
> benennt" der Regel widersprach — keine Rechnung benennt die Variante mit dem Codewort des Schemas.
> **Gemessen: beide echten Rechnungen 5/5 bit-identisch in allen Feldern** (Vollrechnung
> `ohne_leistungsmessung`, Einspeise-Teilabrechnung `null`), Zeitraum-Regel unverändert korrekt.
> **⚠ Zwei Nebenbefunde aus derselben Messreihe, für den nächsten Prompt-Eingriff:** eine
> Prompt-Regel kann auf ein NACHBARFELD durchschlagen (die erste Fassung machte `minBillableKw`
> unbeständig — behoben mit einer ausdrücklichen Abgrenzung), und **ein Vorher-Zustand ist nur
> hergestellt, wenn AUCH `packages/shared/src/invoice-scan.ts` zurückgesetzt wird**: die
> Schema-Beschreibungen gehen mit an die API, ein Rücksetzen von `extract.ts` allein misst nichts.
> **Offen bleibt:** `unterbrechbar` ist nur synthetisch belegt, und die Musterlisten stammen aus
> zwei Rechnungen eines Lieferanten — bei ungewohnter Formulierung ist `null` der sichere Ausgang.
>
> **(b) Ein variabler Tarif liefert jetzt den letzten Monat.** Die Vollrechnung trägt einen
> Flex-Tarif mit dreizehn Monatspreisen; unter der neuen Regel steht der Juni-Preis im Formular. Das
> ist die beabsichtigte Folge — ein Jahresmittel wäre eine gerechnete Zahl, die nirgends auf dem
> Dokument steht. Fachlich ist ein Sommermonat als Grundlage einer Jahresrechnung aber eher zu
> niedrig. Der Wert bleibt in Schritt 2 editierbar; ob der Rechner für variable Tarife einen eigenen
> Hinweis braucht, ist eine offene Produktfrage.

---

### §1-Website-d. PVGIS-Anbindung (B22) — kein Schlüssel, aber eine Laufzeitgrenze

**Es ist NICHTS einzurichten.** PVGIS (Joint Research Centre der Europäischen Kommission,
`https://re.jrc.ec.europa.eu/api/v5_3/seriescalc`) ist offen und kostenlos: kein Konto, kein
Schlüssel, keine Umgebungsvariable, kein `not_configured`-Zustand. Der Rechner ruft den Dienst über
einen Proxy in `apps/website/lib/pvgis/` auf — nötig, weil PVGIS **keine CORS-Header** setzt
(gemessen: 0 Treffer auf `Access-Control-*`, weder auf die Antwort noch auf den Preflight) und
zusätzlich zwei Cookies setzt, die über einen Proxy gar nicht erst entstehen.

#### ⚠️ `maxDuration` steht in `app/rechner/page.tsx` — NICHT an der Server Action

Der naheliegende Ort wäre `lib/pvgis/actions.ts`. **Dort wirkt die Angabe nicht** (gemessen am
02.09.2026): Next liest `maxDuration` in `build/analysis/get-page-static-info.js` aus den Exporten
einer **Seiten-/Route-Datei**; ein `'use server'`-Modul wird dabei nicht betrachtet. Der Build bricht
deshalb auch nicht ab — er nimmt den Export kommentarlos hin und ignoriert ihn. Eine Server Action
läuft in der Funktion der Route, die sie auslöst; die einzige Route, die den Rechner rendert, ist
`/rechner`.

Der Wert ist **60**. Gemessen (B22a, gegen den echten Dienst): ein Wetterjahr 1,41 s, alle zehn in
EINEM Aufruf 7,80 s bei 8,2 MB Antwort. `PVGIS_TIMEOUT_MS` in `lib/pvgis/client.ts` bricht bei 25 s
selbst ab; die Plattformgrenze liegt bewusst darüber, damit dieser Abbruch greift und der Kunde die
benannte Meldung bekommt, statt dass die Anfrage vorher weggeschnitten wird und daraus ein
unerklärter Fehler wird. **60 s ist zugleich die Obergrenze, die JEDER Vercel-Tarif zulässt** — ein
höherer Wert wäre auf einem kleineren Tarif ein Deployment-Fehler. Die übrigen Server Actions dieser
Route erben die Grenze und brechen alle selbst früher ab.

#### Fairness gegenüber einem fremden, kostenlosen Dienst

- **EIN Aufruf für alle zehn Wetterjahre** (`startyear`/`endyear`), nicht zehn — dieselbe
  Datenmenge, ein Aufruf. Und es ist die ehrlichere Form: bei zehn Einzelaufrufen könnte einer
  scheitern, und aus dem Zehn-Jahres-Mittel würde still ein Neun-Jahres-Mittel.
- **Ein Aufruf JE MODULFLÄCHE**, nacheinander und nicht parallel. Zwei Flächen sind der Normalfall
  und kosten rund 16 s.
- Eine **prozesslokale Frequenzgrenze** (20 Aufrufe/Minute) steht VOR dem externen Kontakt. ⚠ Sie
  begrenzt je Instanz, nicht global — eine Bremse gegen den offensichtlichen Missbrauch, keine
  Quote (s. Kopf von `lib/pvgis/client.ts`).

#### ⚠️ Was den Browser verlässt — FÜR DEN DATENSCHUTZHINWEIS

Hinaus gehen **Koordinate (aus der PLZ), Neigung, Ausrichtung, kWp und der Wetterjahr-Zeitraum**.
**Der Lastgang nicht** — der Proxy liefert ein Referenzprofil zurück, die Verrechnung
Verbrauch − Erzeugung geschieht im Browser. Es ist die **zweite** benannte Ausnahme von Prinzip 4
(die erste ist der Rechnungs-Scan, §1-Website-c; die dritte, kleinere ist B21-3a). Entschärft ist
sie gemessen: innerhalb einer Stadt (≤ 13 km) liegt der Ertragsunterschied unter 1 % — die Anwendung
erhebt deshalb **nie** eine hausgenaue Adresse, und der Panel-Text sagt das im Klartext.

#### ⚠️ PLZ-Koordinaten: GeoNames, CC BY 4.0 — die Namensnennung ist eine LIZENZBEDINGUNG

`packages/shared/src/plz-centroids.ts` (2.501 österreichische Postleitzahlen) ist aus dem
GeoNames-Datensatz `AT.zip` abgeleitet (abgerufen 02.09.2026, Lizenz **Creative Commons Attribution
4.0**). Die Lizenz verlangt die Nennung mit Link auf `www.geonames.org`. Sie steht deshalb an **zwei**
Orten: im Kopf des Codemoduls und **sichtbar in der Oberfläche** (Fuss des PV-Schätzformulars in
Schritt 2). **Wer die Tabelle an einer dritten Stelle verwendet, nimmt die Nennung mit** — sonst ist
die Nutzung nicht mehr lizenzkonform. Ein Austausch des Datensatzes ist ein PR mit einer Datei; die
Ableitungsregeln und die gemessene Güte stehen im Kopf des Moduls.

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

### 2c. Authentication → SMTP: Resend eintragen (sonst harte Rate-Limits) ⚠️ SIEHE AUCH §9

Project Settings → **Authentication → „SMTP Settings" → Custom SMTP aktivieren:**

| Feld | Wert |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` (SSL) bzw. `587` |
| Username | `resend` |
| Password | ein **Resend-API-Key** (resend.com → API Keys) |
| Sender email | **`energy@coolin.at`** — dieselbe Adresse wie alle übrigen Mails (§9), **nicht** `noreply@` |
| Sender name | `COOLiN ENERGY` |

- **Was passiert, wenn man es NICHT tut:** Supabase' eingebauter Mailversand hat **harte Rate-Limits**
  (wenige Mails pro Stunde), **landet nachweislich im Spam** und ist ausdrücklich nur für Tests — in
  Produktion würden Registrierungs-Bestätigungs- und Passwort-Reset-Mails verzögert, im Spam-Ordner
  oder gar nicht zugestellt. **Für Produktion untauglich.**
- **⚠️ Custom SMTP hebt das Auth-Ratenlimit NICHT automatisch an.** Zusätzlich
  **Authentication → Rate Limits → „Emails sent per hour"** eigens hochsetzen. Ein zu niedriges Limit
  hat in **B16-3 real dazu geführt, dass Kontoanlagen mit HTTP 429 `over_email_send_rate_limit`
  scheiterten** (gemessen, ~33 s nach einem vorherigen Versuch) — s. §9.
- **Was du bei Resend selbst noch tun musst:** die Absender-**Domain verifizieren** (SPF- + DKIM-DNS-
  Einträge bei deinem DNS-Provider setzen). Für `coolin.at` ist das erledigt.
- **Die Auth-Mail-Vorlagen liegen ebenfalls im Dashboard** (Authentication → Email Templates) und sind
  **getrennt zu pflegen** — sie stehen nicht im Repo und ziehen bei Textänderungen im Code nicht nach.
- Der API-Key für SMTP kann derselbe wie für den übrigen Versand sein oder ein separater — beides ok.

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

> **⚠ Querverweis seit B21-1 (27.08.2026): dieser Abschnitt ist NICHT MEHR die einzige Wahrheit über
> Netzbetreiber-Tarifsätze.** Mit B21-1 existieren die Datenbank-Tabellen `public.grid_tariffs` und
> `public.grid_tariff_rate_windows` (s. §3b), die **perspektivisch denselben fachlichen Gegenstand
> abdecken**: Grundpreis, Netzebene, Leistungsmessungs-Variante, Gültigkeitszeitraum.
>
> **B11 bleibt bis auf Weiteres unverändert in Kraft, und dieser Abschnitt gilt weiter.** Die
> Tabellen sind heute LEER und haben keinen Schreibweg; der Kalkulator liest ausschliesslich das
> Codemodul. Ob und wann `grid_tariffs` das Codemodul ablöst, ist eine **noch nicht getroffene
> Entscheidung** — sie fällt ausdrücklich nicht nebenbei beim Nachtragen eines Satzes. Bis dahin
> gilt: **hier eintragen, nicht in die Datenbank.** Wer es umgekehrt tut, ändert nichts am Verhalten
> des Rechners und glaubt trotzdem, einen Satz gepflegt zu haben.


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

## 3b. Referenzdaten-Tabellen im `public`-Schema (B21-1) — Tarifzeilen und Spotpreise

Seit **27.08.2026** stehen drei Tabellen im `public`-Schema. Sie tragen **öffentliche Referenzdaten**
— veröffentlichte Preisblätter der Netzbetreiber und Börsen-Spotpreise —, **keinen Personenbezug**:

| Tabelle | Inhalt |
|---|---|
| `public.grid_tariffs` | eine effektiv datierte Tarifzeile je Netzbetreiber / Netzebene / Leistungsmessungs-Variante / Stand |
| `public.grid_tariff_rate_windows` | beliebig viele Zeitfenster je Tarifzeile (`normal`, `snap`, künftig `winter`) |
| `public.spot_prices` | historische Marktpreise je Zeitscheibe (Quelle aWATTar), Unique auf `(provider, ts_start)` |

Fachliche Tiefe: `Pflichtenheft_Kalkulator_Delta_Tarifoptimierung.md` (Delta 5, 6, 7). Migration:
`supabase/migrations/20260827120000_create_grid_tariffs_and_spot_prices.sql`.

### Im Dashboard ist NICHTS zu tun ✅

Anders als seinerzeit bei `monitor` (§2a): **`public` ist über die Data API bereits per Default
exponiert.** Die „Exposed schemas"-Liste bleibt unverändert `public, graphql_public, monitor`.

**Stand Cloud (verifiziert 27.08.2026):** Migration `20260827120000` angewandt, `supabase migration
list --linked` zeigt lokal = Cloud. Gegen die Cloud gemessen: `anon` und `authenticated` lesen alle
drei Tabellen (leer, kein Fehler), alle sechs Schreibversuche (2 Rollen × 3 Tabellen) scheitern mit
**42501 `permission denied for table`** — auf Grant-Ebene, nicht an der RLS-Policy. Die Tabellen
sind leer und sollen es bis B21-2 bleiben.

### Das Rechte-Muster — und die Falle, die es nötig macht ⚠️

Beide Schichten sind gesetzt, jede für sich reicht gegen einen Schreibzugriff:

- **RLS aktiv, ausschliesslich eine SELECT-Policy** `to anon, authenticated using (true)`. Es gibt
  keinen INSERT/UPDATE/DELETE-Pfad, auch nicht als Policy.
- **`revoke all … from public, anon, authenticated, service_role`, danach gezielt `grant select
  to anon, authenticated`.** `service_role` bekommt bewusst **gar keinen** Grant — auch keinen
  lesenden: es gibt heute keinen serverseitigen Verbraucher, und der Schreibweg (B21-2) entscheidet
  in seinem eigenen PR, welche Rolle wie schreibt.

> **⚠ Warum der `revoke` nicht weggelassen werden darf — gemessen, nicht abgeleitet.**
> Supabase vergibt per ALTER DEFAULT PRIVILEGES auf **NEUE Tabellen im `public`-Schema** automatisch
> **ALLE** Tabellenrechte an `anon`, `authenticated` und `service_role` — INSERT, UPDATE, DELETE und
> TRUNCATE eingeschlossen. Nachgewiesen in einer zurückgerollten Transaktion gegen PostgreSQL 17.6:
> ein blosses `create table public.…` liefert allen drei Rollen ungefragt
> `DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE`.
>
> Für **Funktionen** ist diese Falle seit T4-2 in einem Dutzend Migrationen dokumentiert; für
> **Tabellen** war sie bis B21-1 nie relevant, weil das Repo im `public`-Schema ausschliesslich
> Funktionen anlegte. Das `monitor`-Muster (§2a, Migration `20260717174454`) ist deshalb **nicht
> wortgleich übertragbar**: `monitor` steht nicht in `pg_default_acl`, dort genügte ein blosser
> `grant select`.
>
> **Wer künftig eine Tabelle in `public` anlegt, nimmt den `revoke`-Block mit.** Ohne ihn entsteht
> ein öffentlich beschreibbarer Datenbestand, und zwar lautlos: der Lesepfad funktioniert
> unverändert, und keine Oberfläche zeigt einen Unterschied. Abgesichert im DB-Gate
> (`packages/db-tests/src/grid-tariffs-schema.test.ts`) — dort wird die Rechtefläche gegen
> `information_schema.role_table_grants` **gemessen**. Ein blosser Schreibversuch genügt dafür
> nicht: RLS weist ihn auch dann mit 42501 ab, wenn der Grant fälschlich vorhanden ist.

### Pflege: es gibt heute KEINEN Schreibweg

Die drei Tabellen sind mit B21-1 **leer** und bleiben es. Kein Wrapper, kein Cron-Endpunkt, kein
Admin-UI, kein Schreib-Grant. Der tägliche aWATTar-Abruf (Muster wie die Cron-Jobs in §1g) und das
gemeinsame Admin-Pflege-UI für Netzbetreiber- und Stromanbieter-Tarife kommen mit **B21-2**.

**Zeilen werden nie in-place überschrieben.** Ein neues Preisblatt ist eine **neue Zeile** mit
eigenem `valid_from`; am Vorgänger wird `valid_until` gesetzt. Eine 2026 archivierte Analyse (§6,
B14) muss auch 2028 noch sagen können, welcher Stand ihr zugrunde lag. Nebeneffekt desselben
Entwurfs: Existiert für einen Zeitraum keine Zeile, gibt es automatisch keine Berechnungsgrundlage —
genau die Verweigerung, die §3a heute im Code abbildet, ohne eine Zeile Sonderfall-Code.

---

## 3c. Netzbetreiber-Tarife pflegen (B21-2b/2c/2d/2e) — Admin-UI, kein Dashboard-Eingriff

Seit **28.08.2026** gibt es für `public.grid_tariffs` und `public.grid_tariff_rate_windows` einen
Schreibweg: den Admin-Bereich unter **`/admin/netzbetreiber-tarife`**. Migrationen:
`supabase/migrations/20260828090000_create_grid_tariff_write_path.sql` (Anlegen),
`…20260901120000_create_grid_tariff_delete_path.sql` (Löschen, seit **01.09.2026**),
`…20260902180000_add_grid_tariff_rate_window.sql` (ein Zeitfenster ergänzen + Notizfeld, seit
**02.09.2026**) und `…20260903090000_backfill_grid_tariff.sql` (einen FRÜHEREN Stand nachtragen,
seit **03.09.2026**). Fachliche Tiefe: `Pflichtenheft_Kalkulator_Delta_Tarifoptimierung.md`, Delta 5
und Delta 10.

### Im Dashboard ist NICHTS zu tun ✅

Wie schon bei §3b: `public` ist über die Data API bereits per Default exponiert, die
„Exposed schemas"-Liste bleibt unverändert. Es gibt auch keine neue Umgebungsvariable — der
Schreibweg benutzt den bereits gesetzten `SUPABASE_SERVICE_ROLE_KEY` (§1d).

### Was der Pflegeweg kann — und was ausdrücklich nicht

| | |
|---|---|
| **Anlegen** | Tarifzeile + 1..n Zeitfenster, in EINEM Vorgang |
| **Ablösen** | Der bisher offene Stand derselben Kombination wird automatisch auf `valid_from − 1 Tag` beendet |
| **Früheren Stand nachtragen** | ✅ seit B21-2e: EINE Zeile je Vorgang, **nur VOR dem ältesten** vorhandenen Stand — sie bekommt ihr `valid_until` aus dessen `valid_from − 1 Tag` und wird dadurch **NICHT** zum aktuellen Stand |
| **Eine Lücke MITTEN in der Historie füllen** | ❌ bewusst nicht — der Guard misst gegen `min(valid_from)`, ein Tag dazwischen wird abgewiesen (s. u.) |
| **Löschen** | ✅ seit B21-2c: GENAU EINE Zeile je Vorgang, samt ihren Zeitfenstern (Kaskade) — **mit vollständigem Abzug im Löschprotokoll** |
| **Zeitfenster ergänzen** | ✅ seit B21-2d: EIN Fenster je Vorgang, **nur an einen OFFENEN Stand** — und **nicht mehr einzeln entfernbar** |
| **Notiz je Zeitfenster** | ✅ seit B21-2d: Freitext für Menschen (Preisblatt-Fussnote, Begründung des Zuschnitts) — geht in **keine** Berechnung ein |
| **Bearbeiten** | ❌ gibt es nicht — weder im UI noch in der Datenbank. ⚠️ Das ANHÄNGEN eines Fensters ist kein Bearbeiten: es ändert keine bestehende Zeile, kann eine aber **verdrängen** (s. u.) |
| **Ein einzelnes Zeitfenster entfernen** | ❌ kein `delete` auf `grid_tariff_rate_windows`, für keine Rolle — rückgängig macht das nur das Löschen des GANZEN Stands (protokolliert) |
| **Rückwirkend korrigieren** | ❌ bewusst nicht: ein neuer Stand muss NACH dem Beginn des offenen liegen |
| **Mehrere auf einmal löschen** | ❌ keine Mehrfachauswahl, ein Aufruf = eine Zeile |

Eine rückwirkende Korrektur eines bereits gerechneten Zeitraums bleibt damit ein **seltener Eingriff
von Hand** (SQL-Editor im Dashboard) und ist kein Knopf. Der Grund ist derselbe wie beim Append-only
der Analyse-Ablage (§6): Sie ändert nachträglich, was einem Kunden gegenüber bereits gerechnet wurde.

### Das Löschen (B21-2c) — wofür es da ist, und wofür nicht ⚠️

**Wofür:** Probeeinträge. Der Pflegeweg hängt nur an, und ein vertippter Stand blieb bisher nicht nur
für immer stehen — er **belegte die Kombination**, sodass jeder echte Stand mit demselben oder
früherem Beginn auf `invalid_valid_from` lief (`unique nulls not distinct`, §3b). Genau das behebt
das Löschen; nach dem Entfernen läuft dieselbe Anlage durch (im DB-Gate gemessen).

**Wofür nicht:** die Korrektur eines Zeitraums, für den bereits einem Kunden gegenüber gerechnet
wurde. Dass diese Unterscheidung nicht bloss eine Absichtserklärung bleibt, ist der Grund für das
Protokoll:

| | |
|---|---|
| **Tabelle** | `public.grid_tariff_deletions` — `grid_tariff_id`, `deleted_by`, `deleted_at`, `tariff_snapshot` |
| **Der Abzug** | die **vollständige** Elternzeile plus Schlüssel `rate_windows` mit **allen** Zeitfenstern |
| **Warum die Fenster mit müssen** | die ct/kWh-Sätze stehen dort, nicht auf der Elternzeile — ein Protokoll ohne sie sähe vollständig aus und wäre es nicht |
| **Kein Fremdschlüssel** | die referenzierte Zeile existiert danach nicht mehr; ein FK wäre entweder unmöglich (`restrict`) oder selbstzerstörend (`cascade`) |
| **Rechte** | RLS an, **keine Policy**, für `service_role` **nur `INSERT`** — kein SELECT, kein UPDATE, kein DELETE; für `anon`/`authenticated` **gar kein Recht** (Muster `platform.admin_exports`/`job_runs`) |
| **Ansicht** | ❌ es gibt (noch) keine — gelesen wird bei Bedarf im SQL-Editor |

> **Wiederherstellen** ist damit von Hand möglich und war der Zweck des Abzugs: `tariff_snapshot`
> enthält alle Werte, die `public.create_grid_tariff` als Argumente braucht.

`public.delete_grid_tariff(p_tariff_id, p_deleted_by)` erledigt Protokoll und Löschung in **einer**
Transaktion — getrennt wäre jeder Aufruf über PostgREST seine eigene, und ein Abbruch hinterliesse
entweder eine Spur ohne Vorgang oder einen Vorgang ohne Spur. Eine **unbekannte Kennung wirft**
(`P0001 not_found`) statt still zu melden, es sei gelöscht worden; die Oberfläche macht daraus die
Bitte, neu zu laden (live gemessen: der Knopf einer inzwischen anderswo entfernten Zeile zeigt genau
diesen Satz und schreibt **keine** Protokollzeile).

### Ein Zeitfenster ergänzen (B21-2d) — wofür, und was dabei still passieren kann ⚠️

**Wofür:** Ein Preisblatt-Nachtrag oder ein beim Abtippen übersehenes Fenster. Bis dahin gab es
dafür nur einen Weg — den ganzen Stand löschen und neu anlegen, protokolliert und mit neuer
Kennung. Das ist für eine ERGÄNZUNG zu viel.

**Nur an einen OFFENEN Stand.** Ein abgelöster Stand ist eine abgeschlossene Aussage über einen
VERGANGENEN Zeitraum; ein nachträglich angehängtes Fenster änderte rückwirkend den Preis, mit dem
einem Kunden gegenüber bereits gerechnet wurde — und zwar unsichtbar: die Zeile sähe danach
lediglich um ein Fenster reicher aus. Die Oberfläche bietet den Weg dort gar nicht erst an, und
`public.add_grid_tariff_rate_window` weist ihn zusätzlich mit **`P0001 closed_tariff`** ab. Eine
unbekannte Kennung wirft **`P0001 not_found`** statt still nichts zu tun.

> ⚠️ **DIE FALLE, gegen die dieser Abschnitt gebaut ist: ein neues Fenster kann ein bestehendes
> VERDRÄNGEN, ohne dass irgendetwas gelöscht wird.** Überlappende Fenster sind der Regelfall (ein
> ganztägiges `normal` plus ausgeschnittene Hochlastfenster), und welches gilt, entscheidet die
> ENGERE Abdeckung — nicht die Reihenfolge der Eingabe. Das verdrängte Fenster steht danach
> unverändert in der Liste **und gilt trotzdem nicht mehr**. Das Formular rechnet deshalb beim
> Tippen aus, welches Fenster in welchem Teilzeitraum durch welchen Satz ersetzt würde, und zeigt
> es im Klartext (Beispiel: „Dieses Fenster verdrängt vom 01.04. bis 30.09. zwischen 11:00 und
> 13:00 das Fenster ‚snap' (5,58 → 9,90 ct/kWh)."). **Es sperrt nicht** — eine Verdrängung ist oft
> genau das Gewollte —, sondern verlangt eine Bestätigung.
>
> Gerechnet wird das mit **derselben** Auswahlregel, die der Kalkulator später anwendet
> (`packages/shared/src/tariff-window-rules.ts`, B21-2d Teil A). Eine im Admin-Bereich nachgebaute
> Regel wäre eine zweite Auslegung — die Warnung sagte dann etwas anderes, als die Engine rechnet.

**Die Notiz** (`grid_tariff_rate_windows.note`) ist Freitext für Menschen: Preisblatt-Fussnote,
Begründung des Zuschnitts. Sie ist nullable, ohne Default und **ohne CHECK** (die Längengrenze steht
im Formularschema und meldet sich am Feld, statt als rohes 23514 abzuweisen); der Kalkulator liest
die Spalte **nicht** (sie steht nicht in der Spaltenliste von
`apps/website/lib/tariff-data/grid-tariffs.ts`). Sie heisst `note` und nicht `comment`, weil
`COMMENT` ein SQL-Schlüsselwort ist. Der Löschabzug nimmt sie **automatisch** mit — B21-2c schreibt
ihn über `to_jsonb(w)` und zählt keine Spalten auf.

**`create_grid_tariff` ist dafür per `create or replace` bei UNVERÄNDERTER Signatur nachgezogen**
(Grants bleiben): auch Fenster der ersten Stunde können eine Notiz tragen. Ein Aufrufer, der `note`
nicht mitschickt, bleibt gültig — `jsonb_to_recordset` liefert für ein fehlendes Feld `null`.

### Einen früheren Stand nachtragen (B21-2e) — wofür, und die eine Falle ⚠️

**Wofür:** Ein Lastgang reicht weiter zurück als die erfassten Preisblätter. Bis dahin gab es dafür
gar keinen Weg — `create_grid_tariff` hängt ausschliesslich nach vorne an und weist alles, was nicht
hinter dem offenen Stand beginnt, mit `invalid_valid_from` ab; blieb nur der SQL-Editor.

**Der Weg liegt an der ÄLTESTEN Zeile einer Kombination** („Früheren Stand ergänzen"), nicht im
Abschnitt „Neuen Tarifstand anlegen". `public.backfill_grid_tariff` setzt das `valid_until` der
neuen Zeile selbst auf `valid_from` der bisher ältesten **minus einen Tag** — lückenlos und
überlappungsfrei, spiegelbildlich zum Ablösen. Die bestehende Nachbarzeile wird dabei **nicht
angefasst**.

> ⚠️ **DIE FALLE, gegen die der Rumpf gebaut ist: „NUR GESCHLOSSENE ZEILEN".** Die naheliegende
> Umsetzung kopiert die Abfrage aus `create_grid_tariff` — und die filtert auf `valid_until is null`,
> sucht also den OFFENEN Stand. Es gibt aber Kombinationen ohne offenen Stand: der offene wurde über
> `delete_grid_tariff` entfernt, die abgelösten stehen weiter da. Auf den offenen gefiltert fände die
> Funktion nichts und legte die neue Zeile **OHNE `valid_until`** an — ein **offener Stand in der
> VERGANGENHEIT**, unter dem eine Analyse fortan jeden Zeitraum bis heute mit einem historischen
> Preisblatt rechnete, ohne dass irgendetwas danach aussähe. Deshalb misst der Guard gegen
> `min(valid_from)` über **ALLE** Zeilen, offene wie geschlossene; im DB-Gate ist genau dieser Fall
> der zentrale Wächter.

**Statuswerte** (bewusst ANDERE als beim Anlegen, damit eine Antwort allein sagt, welche Funktion sie
gegeben hat): `backfilled` · `not_before_oldest` (mit `min_valid_from`) · `no_existing_stand` ·
`no_windows`; dazu `P0001`: `duplicate_valid_from`, `invalid_input`, `invalid_window`.

| | |
|---|---|
| **Richtung der Korrektur** | „muss **VOR** diesem Tag beginnen" — beim Anlegen ist es „**NACH**". Ein übernommener Satz schickte den Eintragenden in die verkehrte Richtung |
| **Kombination** | fest aus der Karte (verstecktes Feld), kein Auswahlfeld — der Guard bezieht sich auf GENAU diese |
| **Anzeigename** | kommt aus dem Bestand; der Wrapper hat dafür **keinen Parameter** (sonst stünde dieselbe Kennung mit zwei Namen in der Liste) |
| **Bestätigung** | Ankreuzmöglichkeit, die den entstehenden Zeitraum mit **beiden** Daten nennt und die Unumkehrbarkeit benennt |
| **Kennzeichnung** | `grid_tariffs.backfilled_at` (nullable, **kein Default**) — in der Liste als „nachgetragen am …". `null` heisst „regulär vorwärts angehängt" und ist für jede vor B21-2e entstandene Zeile bereits die zutreffende Aussage |
| **Sperre** | `pg_advisory_xact_lock` mit **demselben** Schlüssel wie `create_grid_tariff` — er ist das Einzige, was Backfill und Anlage gegeneinander serialisiert (gemessen); das ERGEBNIS hängt nicht an ihm, die beiden können ihre Entscheidungen nicht gegenseitig verschieben |
| **Bearbeiten** | ❌ weiterhin nicht — rückgängig macht das nur das Löschen des ganzen Stands (protokolliert) |

**Ein passiver Hinweis, kein Ablaufdatum:** Ein offener Stand, der seit **15 Monaten** unverändert
ist (gemessen an `created_at`, nicht an `valid_from`), bekommt in der Liste einen Satz dazu. Er
**sperrt nichts** — ein Tarifstand verfällt nicht, solange kein neues Preisblatt erschienen ist, und
ein automatisches Ende erfände eine Lücke, die es fachlich nicht gibt. Die Schwelle liegt bewusst
hinter einem vollen Jahreszyklus samt Quartal Puffer: bei 12 Monaten stünde der Hinweis im
Normalbetrieb jedes Jahr für ein paar Wochen da und wäre bald ein Möbelstück.

### Die Rechtefläche — gemessen, nicht abgeleitet ⚠️

`service_role` bekommt **je Tabelle verschieden viel**, und zwar exakt so viel, wie der Schreibweg
tatsächlich braucht:

| Tabelle | `anon` / `authenticated` | `service_role` |
|---|---|---|
| `public.grid_tariffs` | `SELECT` | `DELETE, INSERT, SELECT, UPDATE` |
| `public.grid_tariff_rate_windows` | `SELECT` | `INSERT, SELECT` |
| `public.grid_tariff_deletions` | *(gar nichts)* | `INSERT` |

**B21-2e hat daran NICHTS geändert** — der Nachtrag kommt mit den bereits vergebenen Rechten aus.
Stufenmessung (je Stufe genau ein Recht entzogen, Funktion echt aufgerufen): `grid_tariffs`
INSERT + SELECT + UPDATE (das `for update`) und `grid_tariff_rate_windows` INSERT sind nötig;
`grid_tariff_rate_windows.SELECT` und `grid_tariffs.DELETE` sind es **nicht** (⚠️ Unterschied zu
`add_grid_tariff_rate_window`, das schon für sein `returning id` ein SELECT auf den Zeitfenstern
braucht — der Backfill fügt sie ohne `returning` ein und zählt über `get diagnostics`).

> ⚠️ **Was B21-2c daran geändert hat — und was ausdrücklich nicht.** Dazugekommen sind `DELETE` auf
> `grid_tariffs` (der Löschweg selbst) und `SELECT` auf `grid_tariff_rate_windows` (er LIEST die
> Zeitfenster für den Abzug — nicht „vorsichtshalber", s. den Absatz darunter). **`DELETE` auf der
> Kind-Tabelle kommt NICHT dazu:** Stufe für Stufe gemessen, dass die Kaskade allein mit dem
> DELETE-Recht auf der Elternzeile läuft (die referentielle Aktion läuft im systemeigenen
> Constraint-Trigger mit den Rechten des Eigentümers). Der 42501-Nachweis für die Kind-Tabelle steht
> deshalb weiterhin im DB-Gate und belegt jetzt etwas Schärferes: die Zeitfenster verschwinden, ohne
> dass irgendein Weg sie löschen dürfte.
>
> | Stufe (Aufruf von `delete_grid_tariff` als `service_role`) | Ergebnis |
> |---|---|
> | volle Grants | OK — Eltern 0, Kinder 0, Protokoll 1 |
> | ohne `DELETE` auf `grid_tariffs` | 42501 `grid_tariffs` |
> | ohne `SELECT` auf `grid_tariff_rate_windows` | 42501 `grid_tariff_rate_windows` |
> | ohne `INSERT` auf `grid_tariff_deletions` | 42501 `grid_tariff_deletions` |
> | ohne `SELECT` auf `grid_tariffs` | 42501 `grid_tariffs` |
> | ohne `UPDATE` auf `grid_tariffs` | 42501 `grid_tariffs` — das `select … for update` verlangt es |
> | **zusätzlich** `DELETE` auf `grid_tariff_rate_windows` | OK, **kein Unterschied** |

> **⚠ Warum `grid_tariffs` SELECT braucht und `grid_tariff_rate_windows` nicht.**
> Gegen den lokalen Stack (PostgreSQL 17.6) in zurückgerollten Transaktionen Stufe für Stufe
> gemessen, indem `public.create_grid_tariff` unter `set local role service_role` mit einer bereits
> offenen Vorgängerzeile **tatsächlich aufgerufen** wurde (nur so läuft der UPDATE-Zweig überhaupt an):
>
> | Grant-Stufe | Ergebnis des Aufrufs |
> |---|---|
> | kein Grant | 42501 `grid_tariffs` |
> | `grid_tariffs`: insert | 42501 `grid_tariffs` |
> | `grid_tariffs`: insert + select | 42501 `grid_tariffs` ← UPDATE fehlt |
> | `grid_tariffs`: insert + update | 42501 `grid_tariffs` ← SELECT fehlt |
> | `grid_tariffs`: insert + select + update | 42501 `grid_tariff_rate_windows` |
> | + `rate_windows`: insert | **OK** |
> | + `rate_windows`: insert + select + update | OK (kein Unterschied) |
>
> `grid_tariffs` braucht SELECT nicht für eine Leseabfrage der Anwendung, sondern weil die Funktion
> die offene Zeile SUCHT und die neue mit `returning id` anlegt; UPDATE braucht sie fürs Schliessen
> der Vorgängerin. Für die Zeitfenster genügt INSERT — die Funktion liest dort nichts, und der
> Fremdschlüssel braucht zur Laufzeit **kein** `references`-Recht (die Prüfung läuft im systemeigenen
> Constraint-Trigger).
>
> **Ein SELECT-Grant „vorsichtshalber" wäre hier kein harmloser Überschuss, sondern ein falscher
> Beleg** — er behauptete, der Schreibweg lese diese Tabelle, und der nächste Umbau nähme das als
> gegeben. Abgesichert im DB-Gate (`packages/db-tests/src/grid-tariff-write-path.test.ts`), das die
> Rechtefläche EXAKT vergleicht.

**Kein `TRUNCATE` für irgendeine Rolle**, und **kein `DELETE` ausser dem einen aus B21-2c**: `anon`
und `authenticated` bleiben auf allen drei Tabellen ausschliesslich lesend (auf dem Löschprotokoll
nicht einmal das), die Zeitfenster bleiben für jede Rolle unlöschbar.

> ⚠️ **B21-2d bringt KEIN neues Tabellenrecht** — die Tabelle oben gilt unverändert. Alle vier
> Rechte, die `public.add_grid_tariff_rate_window` braucht, stehen bereits; Stufe für Stufe
> gemessen, je Stufe genau ein Recht entzogen und die Funktion echt aufgerufen:
>
> | Stufe (Aufruf als `service_role`) | Ergebnis |
> |---|---|
> | volle Grants (Stand nach B21-2b/2c) | OK, `window_count 1` |
> | ohne `INSERT` auf `grid_tariff_rate_windows` | 42501 `grid_tariff_rate_windows` |
> | ohne `SELECT` auf `grid_tariff_rate_windows` | 42501 `grid_tariff_rate_windows` |
> | ohne `SELECT` auf `grid_tariffs` | 42501 `grid_tariffs` |
> | ohne `UPDATE` auf `grid_tariffs` | 42501 `grid_tariffs` — das `select … for update` verlangt es |
> | **zusätzlich** `DELETE` auf `grid_tariff_rate_windows` | OK, **kein Unterschied** |
>
> **Nebenbefund, beim Messen aufgeschlagen:** Das `SELECT` auf `grid_tariff_rate_windows` verlangt
> schon das `returning id` DES INSERT — der 42501 trifft die INSERT-Anweisung, nicht die Zählabfrage
> darunter. Wer die Zählung je entfernt, weil sie entbehrlich scheint, braucht das Recht trotzdem.

### ⚠️ Die Autorisierung liegt hier im Anwendungscode, nicht in der Datenbank

Das ist die **einzige** Stelle des Systems, an der das so ist, und sie muss offen dastehen:

- Jeder andere Admin-Schreibweg ruft einen `admin_*`-Wrapper in `platform`, der `platform.is_admin()`
  als erste Anweisung selbst prüft. Ein Fehler im Anwendungscode kann dort niemandem Schreibzugriff
  verschaffen.
- `public.create_grid_tariff` **und** `public.delete_grid_tariff` (B21-2c) sind **SECURITY INVOKER**
  und laufen als `service_role` — die trägt kein JWT, `auth.uid()` ist leer, es gibt in der Datenbank
  nichts zu prüfen.

Die Zugangsentscheidung fällt deshalb in **`apps/web/lib/admin/grid-tariffs-actions.ts`**
(`isCurrentUserAdmin()` als erste Anweisung beider Actions, fail-closed) und zusätzlich im Layout des
Admin-Bereichs. **Beim Löschen wiegt das schwerer als beim Anlegen** — ein Fehler dort legt nicht
etwas Falsches an, sondern entfernt etwas Richtiges. Deshalb ist die Prüfung zusätzlich als Test
festgehalten (`apps/web/lib/admin/grid-tariffs-actions.test.ts`: ohne Adminrolle entsteht **kein**
service_role-Client und **kein** RPC), und live gemessen ist sie auch: derselbe Action-Aufruf
byte-gleich wiederholt ergibt mit der Sitzung eines Nicht-Admins „Keine Berechtigung" und eine
unveränderte Zeile, mit der eines Admins die Löschung samt Protokolleintrag.
Die ESLint-Erlaubnisliste für den service_role-Client ist dafür um **genau diese eine Datei**
erweitert (Muster `lib/auth/admin-api.ts`).

Warum trotzdem so: B21-1 hat für diese Tabellen bewusst den **direkten** Tabellenzugriff statt des
RPC-Wrapper-Musters gewählt (veröffentlichte Preisblätter, kein Personenbezug, `anon`-lesbar). Ein
Schreib-Grant für `authenticated` wäre die Alternative gewesen — er gälte aber für **jedes**
angemeldete Konto, nicht nur für Admins; einfangen liesse sich das nur mit einer RLS-Policy, die
ihrerseits `platform.is_admin()` aufruft, also mit genau dem Wrapper-Muster, das B21-1 verworfen hat.

**Stand Cloud (verifiziert 28.08.2026):** Migration `20260828090000` angewandt, `migration list
--linked` zeigt lokal = Cloud. Gegen die Cloud gemessen: Rechtefläche exakt wie in der Tabelle oben;
`public.create_grid_tariff` existiert **genau einmal**, ist **SECURITY INVOKER** (`prosecdef = false`)
und hat EXECUTE **nur** für `service_role` (`anon`/`authenticated` je `false`, per
`has_function_privilege` — kein Aufruf als Rolle ohne Grant, Arbeitsregel 5). Beide Tabellen weiterhin
**leer**, `spot_prices` mit unverändert 8.759 Zeilen unberührt.

**Stand Cloud (verifiziert 01.09.2026, B21-2c):** Migration `20260901120000` angewandt,
`migration list --linked` zeigt lokal = Cloud. **Vorher-Baseline vor dem Push gemessen**
(Arbeitsregel 3): `grid_tariffs` `INSERT,SELECT,UPDATE` · `grid_tariff_rate_windows` `INSERT` ·
`delete_grid_tariff` existierte **nicht** · `grid_tariff_deletions` existierte **nicht** ·
1 Tarifzeile / 1 Zeitfenster / 14.615 Spotpreise. **Nachher:** Rechtefläche exakt wie in der Tabelle
oben, `delete_grid_tariff` existiert genau einmal mit `prosecdef = false` und EXECUTE nur für
`service_role`, `grid_tariff_deletions` mit RLS aktiv und **0 Policies**. **Der Bestand ist
unberührt** — dieselbe eine Tarifzeile (Wiener Netze NE 7, `ohne_leistungsmessung`, gültig ab
01.01.2025), dasselbe Zeitfenster, unverändert 14.615 Spotpreise, Löschprotokoll leer.

**Stand Cloud (verifiziert 02.09.2026, B21-2d):** Migration `20260902180000` angewandt,
`migration list --linked` zeigt lokal = Cloud. **Vorher-Baseline vor dem Push gemessen**
(Arbeitsregel 3): `add_grid_tariff_rate_window` existierte **0×**, die Spalte
`grid_tariff_rate_windows.note` **0×**, Rechtefläche `INSERT,SELECT` bzw.
`DELETE,INSERT,SELECT,UPDATE`, Bestand 7 Tarifzeilen / 10 Zeitfenster / 1 Löschprotokollzeile /
14.663 Spotpreise. **Nachher:** die Funktion existiert genau einmal mit `prosecdef = false`, EXECUTE
nur für `service_role` (`anon`/`authenticated` je `false`, per `has_function_privilege` — kein
Aufruf als Rolle ohne Grant, Arbeitsregel 5), die Spalte ist `text`, nullable, ohne Default, und die
**Rechtefläche ist Zeichen für Zeichen unverändert**.

**Der Weg ist gegen die Produktion FUNKTIONAL gemessen, nicht nur introspektiv** — und zwar an
eigens angelegten Test-Ständen unter dem Betreiber `zz_b21_2d_probe`, damit die sieben echten
Wiener-Netze-Zeilen unangetastet bleiben: Fenster an einen offenen Stand angehängt (`added`,
`window_count 2`, Notiz gespeichert) · zweiter Stand angelegt, der den ersten ablöst · Anhängen an
den abgelösten Stand → **`P0001 closed_tariff`**, und die Zeile bekam nachweislich **kein** drittes
Fenster · unbekannte Kennung → **`P0001 not_found`** · beide Test-Stände über den Löschweg entfernt,
der Abzug trägt die Notiz automatisch mit. **Endstand: unverändert 7 Tarifzeilen / 10 Zeitfenster /
14.663 Spotpreise, 0 Test-Reste, 0 Zeitfenster mit Notiz.**

> ⚠️ Das Löschprotokoll ist dabei von 1 auf **3** Zeilen gewachsen (die zwei Test-Stände). Das ist
> beabsichtigt und nicht rückgängig zu machen — es gibt für `grid_tariff_deletions` bewusst kein
> `delete`-Grant. Beide Zeilen sind an `operator_id = 'zz_b21_2d_probe'` und
> `deleted_by = 'b21-2d-probe@test.local'` als Prüfvorgänge erkennbar.

**Stand Cloud (verifiziert 03.09.2026, B21-2e):** Migration `20260903090000` angewandt,
`migration list --linked` zeigt lokal = Cloud. **Vorher-Baseline vor dem Push gemessen**
(Arbeitsregel 3): `backfill_grid_tariff` existierte **0×**, die Spalte `grid_tariffs.backfilled_at`
**0×**, Rechtefläche exakt wie in der Tabelle oben, Bestand 7 Tarifzeilen / 10 Zeitfenster /
3 Löschprotokollzeilen / 14.663 Spotpreise, alle sieben Zeilen `valid_from = 2026-01-01` und **keine**
mit `valid_until`. **Nachher:** die Funktion existiert genau einmal mit `prosecdef = false`, EXECUTE
nur für `service_role` (`anon`/`authenticated`/`public` je `false`, per `has_function_privilege` —
kein Aufruf als Rolle ohne Grant, Arbeitsregel 5), die Spalte ist `timestamptz`, **nullable, ohne
Default**, und die **Rechtefläche ist Zeichen für Zeichen unverändert** — der Nachtrag kommt mit den
bereits vergebenen Rechten aus (s. die Stufenmessung weiter oben).

**Der reine Push hat am Datenbestand NICHTS geändert:** dieselben sieben Zeilen mit denselben IDs,
dasselbe `valid_from`, weiterhin keine mit `valid_until` — und **alle sieben tragen `backfilled_at`
= `null`**. Das ist kein ausgebliebener Backfill, sondern bereits die zutreffende Aussage: sie wurden
vorwärts angehängt, nicht nachgetragen (deshalb gibt es bewusst keinen Default).

**Der Weg ist gegen die Produktion FUNKTIONAL gemessen, nicht nur introspektiv** — an einer eigens
angelegten Kombination unter dem Betreiber `zz_b21_2e_probe`, damit die sieben echten
Wiener-Netze-Zeilen unangetastet bleiben; jeder Aufruf als **`service_role`** (die Grants greifen
also wirklich):

| Vorgang | Ergebnis |
|---|---|
| `create_grid_tariff`, `valid_from 2026-01-01`, 1 Fenster | `created`, `window_count 1` |
| `backfill_grid_tariff`, `valid_from 2025-01-01`, 1 Fenster | **`backfilled`**, `new_valid_until` **2025-12-31** (= `2026-01-01 − 1 Tag`), `preceded_valid_from 2026-01-01` |
| Zustand danach | neue Zeile 2025-01-01 → 2025-12-31 mit **gesetztem `backfilled_at`**; die 2026er Zeile **unverändert offen** und `backfilled_at = null` |
| Anzeigename der neuen Zeile | aus dem Bestand übernommen (der Wrapper hat dafür keinen Parameter) |
| `backfill_grid_tariff`, `valid_from 2025-06-01` (MITTEN in der Historie) | **`not_before_oldest`** mit `min_valid_from 2025-01-01` — und **keine dritte Zeile** entstanden |
| beide Testzeilen über `delete_grid_tariff` entfernt | je `deleted`, Kaskade nimmt das Zeitfenster mit |

**Endstand: unverändert 7 Tarifzeilen / 10 Zeitfenster / 14.663 Spotpreise, 0 Test-Reste, alle sieben
`backfilled_at = null`.** Der Löschabzug trägt die neue Spalte **automatisch** mit (`to_jsonb(t)`,
B21-2c zählt keine Spalten auf) — im Protokoll der nachgetragenen Testzeile steht `backfilled_at`
mit Zeitstempel, in dem der vorwärts angelegten `null`.

> ⚠️ Das Löschprotokoll ist dabei von 3 auf **5** Zeilen gewachsen (die zwei Test-Stände). Das ist
> beabsichtigt und nicht rückgängig zu machen — es gibt für `grid_tariff_deletions` bewusst kein
> `delete`-Grant. Beide Zeilen sind an `operator_id = 'zz_b21_2e_probe'` und
> `deleted_by = 'b21-2e-probe@test.local'` als Prüfvorgänge erkennbar. **Die Alternative wäre
> gewesen, an einer ECHTEN Wiener-Netze-Zeile nachzutragen und sie anschliessend ganz zu löschen** —
> also produktive Preisblattdaten zu entfernen und mit neuer Kennung neu anzulegen; die gemessene
> Aussage wäre dieselbe gewesen, der Preis ungleich höher.

### Offen: die Preisblätter selbst

⚠️ Der frühere Satz „die Tabellen sind weiterhin leer" stimmt seit dem **01.09.2026** nicht mehr:
`grid_tariffs` führt die **sieben** Zeilen des Wiener-Netze-Preisblatts WN-EX0105 (NE 3–6 plus die
drei NE-7-Varianten, alle gültig ab 01.01.2026) mit **10** Zeitfenstern. Was weiterhin fehlt, sind
die **übrigen Netzbetreiber** — ihre Zahlen kommen aus deren Preisblättern — und, für Netzebene 7 ab
2027, die noch nicht erlassene Tarifverordnung (SNE-T-V). Bis dahin gibt es für diese Zeiträume
automatisch keine Berechnungsgrundlage; genau das ist der Nebeneffekt der Effektiv-Datierung und kein
Mangel (§3b) — und **für einen Zeitraum VOR dem ältesten erfassten Stand ist genau das ab B21-2e
nachträglich behebbar**, ohne SQL-Editor.

**Stromanbieter-Tarife (`retail_tariffs`) sind NICHT Teil von B21-2b** — Delta 5 nennt beide Seiten
gemeinsam, für diesen Bauabschnitt ist ausdrücklich entschieden, nur die Netzbetreiber-Seite zu bauen.
Es gibt dafür weder Tabelle noch Wrapper noch UI.

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

## 4a. Supabase-CLI liefert 403 — die Ursache ist der eingeloggte ACCOUNT, nicht die Verlinkung

Diagnostiziert **und behoben** am **04.08.2026**, nachdem derselbe Befund über **sechs Sitzungen** hinweg
als „Management-API 403" abgehakt und jedes Mal mit `SUPABASE_DB_PASSWORD` umgangen wurde
(Symptom-Beschreibung ohne Ursache: `apps/web/CLAUDE.md`, B18-6-Eintrag).

> **Das richtige Konto ist `andreas.dax@adx-ventures.com`** (Organisation **COOLiN**,
> `pvzkhkqfbflbnechlror`). Nach dem Wechsel darauf laufen `orgs list`, `projects list`
> (`coolin_energy` erscheint mit **●** als linked), `migration list --linked` **ohne**
> `SUPABASE_DB_PASSWORD` und die Management-API `/database/query` (HTTP 201). Der Abschnitt bleibt
> stehen, weil der Zustand jederzeit wiederkehrt, sobald ein anderes Konto angemeldet wird.

**Das Symptom:** `supabase projects list` zeigt ausschliesslich „Website" (`whuolerrayccbugpnsau`);
`supabase migration list --linked`, `db push --linked` (ohne Passwort) und die Management-API
`/database/query` antworten **403**. `supabase db push --linked` **mit** manuell gesetztem
`SUPABASE_DB_PASSWORD` läuft dagegen zuverlässig durch.

**Die Ursache:** Die CLI ist mit dem **falschen Konto** angemeldet — `office@alinadax.com`. Dieses Konto
ist Mitglied in **genau einer** Organisation, `atelier-dax-web` (`testevhdtrabdskvgwlh`), und die enthält
**genau ein** Projekt: „Website". `coolin_energy` (`amdeupwgytuvgpacsywh`) liegt in einer **anderen**
Organisation, `pvzkhkqfbflbnechlror` — nachzulesen ohne jeden Netzaufruf in
`supabase/.temp/linked-project.json`. Die beiden Organisations-IDs nebeneinander sind der ganze Befund.

**Warum das Passwort trotzdem funktioniert — und warum das die Fehlersuche sechsmal in die Irre geführt
hat:** Es sind **zwei unabhängige Zugangswege**. `SUPABASE_DB_PASSWORD` geht als Postgres-Rolle direkt an
die Datenbank und kennt weder Konto noch Organisation. Alles andere (`projects list`, `migration list`,
`db dump`, `/database/query`, auch das „Initialising login role..." vor `db push`) läuft über die
**Management-API** und damit über die Kontoberechtigung. Dass der Passwort-Weg funktioniert, beweist,
dass die **Verlinkung korrekt** ist — und sagt über den Token **nichts**. Genau diese Trennung macht den
403 zu einem Berechtigungs-, nicht zu einem Konfigurationsproblem.

**Wo die Zugangsdaten wirklich liegen** (nachgesehen, nicht geraten — CLI v2.95.4,
`internal/utils/credentials/store.go`): im **macOS-Schlüsselbund** über `zalando/go-keyring`, Dienst
`"Supabase CLI"`, Konto = **Profilname** (Vorgabe `supabase`, änderbar per globalem `--profile`). Der Wert
ist als `go-keyring-base64:<base64>` verpackt. **`~/.supabase/access-token` existiert auf diesem Rechner
nicht** — sein Fehlen ist deshalb **kein** Beleg für „nicht eingeloggt" und darf nicht mehr als solcher
gelesen werden.

**Diagnose in einem Befehl — vor jeder weiteren Vermutung:**

```
supabase orgs list      # zeigt es nur testevhdtrabdskvgwlh → falsches Konto.
```

⚠️ **Aber nicht als Positivbeleg lesen:** `orgs list` liefert mit dem *korrekten* Konto eine **leere**
Tabelle (27.08.2026 gemessen). Der belastbare Befehl ist `supabase projects list` — siehe §4a-bis.

**Was ausdrücklich NICHT die Ursache war** (geprüft und ausgeschlossen, damit es niemand erneut prüft):
`SUPABASE_ACCESS_TOKEN` ist **nirgends** gesetzt — nicht in der Umgebung, nicht in `~/.zprofile` (die
einzige vorhandene Shell-Profildatei), nicht in einer `.env` im Repo. Ein Schlüsselbund-Leserecht-Problem
liegt ebenfalls nicht vor: die CLI liest den Eintrag ohne Nachfrage und bekommt eine echte API-Antwort.
Die Reihenfolge bleibt trotzdem richtig — **eine gesetzte `SUPABASE_ACCESS_TOKEN` überstimmt jeden
`supabase login` stillschweigend**, sie ist deshalb weiterhin das Erste, was man ausschliesst.

**Die Behebung — der Weg, der am 04.08.2026 tatsächlich funktioniert hat:** im Dashboard als das richtige
Konto einen Personal Access Token erzeugen (Account → Access Tokens) und

```
supabase login --token sbp_…
```

Das überschreibt den Schlüsselbund-Eintrag direkt; ein vorheriges `supabase logout` ist nicht nötig.

⚠️ **Warum NICHT der Browser-Weg (`supabase logout` + `supabase login`):** `logout` löscht nur den
**lokalen** Token. Die Dashboard-Sitzung im Browser gehört weiterhin dem falschen Konto, und der
Login-Flow bestätigt sie **ohne Kontoauswahl** — man landet wortgleich beim selben 403 und hält den Login
für wirkungslos. Das ist die wahrscheinlichste Erklärung dafür, dass frühere Login-Versuche folgenlos
blieben. Wer diesen Weg dennoch geht, muss sich **vorher auf `supabase.com` abmelden** oder ein privates
Fenster verwenden.

Prüfbefehl danach: `supabase migration list --linked` muss **ohne** `SUPABASE_DB_PASSWORD` durchlaufen.

**Ein alter Token bleibt serverseitig gültig, bis er widerrufen wird.** `supabase logout` und ein
überschreibender `--token`-Login entfernen ihn nur lokal. Ein Token, der nicht mehr gebraucht wird oder
irgendwo im Klartext aufgetaucht ist, gehört im Dashboard unter Account → Access Tokens gelöscht.

---

### 4a-bis. Der Rückfall vom 27.08.2026 — die Ursache, gemessen statt vermutet

Der 403 kehrte am **27.08.2026** zurück und blockierte den Cloud-Push von B21-2a. Der Abschnitt oben
sagte richtig „falsches Konto", aber nicht **wodurch** — und genau das hat die Wiederholung nicht
verhindert. Hier steht der konkrete Hergang.

**Der Zeitstempel ist der ganze Befund.** Der Schlüsselbund führt zu jedem Eintrag ein Erstell- und
ein Änderungsdatum:

```
security find-generic-password -s "Supabase CLI" -a "supabase" 2>&1 | grep -E 'cdat|mdat'
  cdat = 2026-07-24 09:16:30Z   ← Erstellung
  mdat = 2026-08-07 14:50:57Z   ← letzte ÜBERSCHREIBUNG
```

Die Behebung vom **04.08.2026** hat funktioniert. Am **07.08.2026 um 14:50:57Z** wurde der Eintrag
**erneut überschrieben** — mit dem falschen Konto. Die Shell-History zeigt womit:

```
…/Developer/atelier-dax-web    (npm install, npm run dev)
supabase logout                ← ~/.zsh_history Zeile 644
supabase login                 ← ~/.zsh_history Zeile 645   Browser-Flow, KEIN --token
…/Developer/atelier-dax-web    (weiter im selben Projekt)
```

Also exakt die Sequenz, vor der dieser Abschnitt bereits warnt: `logout` löscht nur lokal, der
Browser-Flow bestätigt die noch offene Dashboard-Sitzung **ohne Kontoauswahl**. In der gesamten
History steht **kein einziges** `supabase login --token` (`grep -c` → 0) — die 04.08-Behebung lief in
einer Agenten-Sitzung, deren Befehle nicht in `~/.zsh_history` landen.

**Die strukturelle Ursache — und der Grund, warum es wiederkam:** Die CLI hält **genau einen
rechnerweiten Token** (Schlüsselbund-Konto = Profilname, Vorgabe `supabase`). Auf diesem Rechner
liegen **zwei Projekte unter zwei verschiedenen Supabase-Konten**. Jede Anmeldung im einen kippt
stillschweigend die des anderen. Das ist kein Bedienfehler, sondern eine geteilte Ressource ohne
Trennung — es wird sich wiederholen, solange beide Konten denselben Slot benutzen.

**Was es erneut NICHT war** (nachgemessen, damit es niemand ein drittes Mal prüft):
`SUPABASE_ACCESS_TOKEN` ist nirgends gesetzt. Es gibt auf diesem Rechner **überhaupt keine
Shell-Profildatei, die `supabase` erwähnt** — `~/.zshrc`, `~/.zshenv`, `~/.bashrc`, `~/.profile`
existieren nicht; `~/.zprofile` existiert und enthält keinen Treffer. **Es gibt also keine „Zeile in
einer Profildatei", die man korrigieren könnte.**

#### ⚠️ `--profile` ist KEINE Isolation — gemessen, und der naive Einsatz macht es schlimmer

Naheliegend wäre, den COOLiN-Token über `--profile` in einem eigenen Slot zu halten. In CLI v2.95.4
ist `--profile` aber **kein benannter Credential-Slot, sondern ein Pfad zu einer Profil-Konfigdatei**
(gedacht für abweichende Deployments; verlangt `name`, `api_url`, `dashboard_url`, `project_host` in
`snake_case`). Und — das ist der gefährliche Teil — **die Benutzung schreibt einen klebrigen globalen
Zeiger** `~/.supabase/profile`. Solange der existiert, benutzt **jeder** nachfolgende Befehl **ohne**
Flag dieses Profil, `login` eingeschlossen.

In beide Richtungen gemessen (`mdat`-Vergleich vor/nach):

| Vorgang | Zeiger | `coolin`-Slot | Vorgabe-Slot |
|---|---|---|---|
| `--profile …/coolin.toml login --token` | wird gesetzt | **neu** | unverändert ✔ |
| danach `supabase login` **ohne** Flag | steht auf coolin | **überschrieben** ⚠️ | unverändert ⚠️ |
| Zeiger gelöscht, dann `supabase login` ohne Flag | bleibt weg | **unverändert** ✔ | neu ✔ |

Zeile 2 ist die Falle: ein zurückgelassener Zeiger dreht die Wirkung um — dann zerstört ausgerechnet
der Login im **anderen** Projekt den COOLiN-Token. Wer `--profile` benutzt, **muss**
`~/.supabase/profile` danach entfernen.

#### Der Weg, der am 27.08.2026 tatsächlich funktioniert hat

Einmalig einrichten — eigener Schlüsselbund-Slot, Zeiger sofort wieder weg:

```bash
cat > ~/.supabase/coolin.toml <<'EOF'
name = "coolin"
api_url = "https://api.supabase.com"
dashboard_url = "https://supabase.com/dashboard"
project_host = "supabase.co"
EOF
supabase --profile ~/.supabase/coolin.toml login --token sbp_…   # Token des COOLiN-Kontos
rm -f ~/.supabase/profile        # ⚠️ PFLICHT — sonst gilt die Falle oben
```

Danach jede Cloud-Operation dieses Repos **ohne** `--profile`, mit dem Token per Aufruf aus dem
eigenen Slot:

```bash
export SUPABASE_ACCESS_TOKEN=$(security find-generic-password -w -s "Supabase CLI" -a coolin   | sed 's/^go-keyring-base64://' | base64 -d)
supabase db push --linked
```

Das ist echte Trennung: `SUPABASE_ACCESS_TOKEN` überstimmt den Schlüsselbund (die Eigenschaft, vor der
der Abschnitt oben warnt — hier **bewusst und auf einen Aufruf begrenzt** genutzt), es entsteht kein
klebriger Zeiger, und ein `supabase login` im anderen Projekt trifft nur den Vorgabe-Slot. Genau so
gemessen: mit Vorgabe-Slot auf dem Fremdkonto lieferte `supabase projects list` **0** Treffer für
`coolin_energy`, mit gesetzter Variable die Zeile `● pvzkhkqfbflbnechlror | coolin_energy`.

#### Diagnose: `projects list`, nicht `orgs list`

⚠️ **`supabase orgs list` liefert mit dem korrekten Konto eine LEERE Tabelle** (27.08.2026 gemessen) —
der Prüfbefehl aus dem Abschnitt oben sieht damit aus wie ein Fehlschlag, obwohl alles stimmt.
Aussagekräftig ist:

```bash
supabase projects list    # muss `coolin_energy` in pvzkhkqfbflbnechlror mit ● (linked) zeigen
```

Zeigt es stattdessen nur „Website" in `testevhdtrabdskvgwlh`, ist der Vorgabe-Slot aktiv — dann die
Variable aus dem Block darüber setzen.

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

**Ergänzt mit B16-4a (26.07.2026) — es GIBT jetzt einen Genehmigen-Weg, und er ist unumkehrbar.**
Ein Antrag lässt sich auf seiner Detailseite genehmigen; dabei entsteht in EINER Transaktion ein
Fachbetrieb mit den Angaben aus dem Antrag, sein Kurz-Key wird vergeben und das Konto verknüpft
(`public.admin_approve_partner_application`). Für den Betrieb bedeutet das dreierlei:

- **Der Kurz-Key ist danach unveränderlich** (Trigger `platform.guard_partner_slug`) und wandert in
  Links, die der Fachbetrieb an seine Bestandskunden verschickt. Es gibt keinen Weg zurück — weder
  eine Umbenennung noch eine Löschung (für `platform.partners` hat **keine** Rolle ein
  `delete`-Grant). Die Oberfläche verlangt dafür ein ausdrückliches Häkchen.
- **Der genehmigte Betrieb wird NICHT benachrichtigt.** Es geht keine automatische Nachricht raus;
  Partner-Portal und Mail sind B16-4b. Bis dahin muss der Kontakt von Hand aufgenommen und der
  Empfehlungslink weitergegeben werden. Der Hinweis steht nach jeder Genehmigung auf der Seite.
- **Ein Antrag ohne verknüpftes Konto ist nicht genehmigbar** (`no_account`). Der Fall entsteht
  real, wenn die Kontoanlage bei der Bewerbung scheitert (gemessen: `429
  over_email_send_rate_limit`) — der Antrag entsteht dann trotzdem, ein daraus genehmigter Partner
  hätte aber nie ein Login. Ausweg: erneut bewerben lassen, oder den Betrieb von Hand anlegen und
  sein Konto unter `/admin/partner` verknüpfen (`public.admin_link_partner_account` — der Weg, über
  den auch der erste, von Hand aufgenommene Partner sein Konto bekommt).

**Ergänzt mit B18-4 (04.08.2026) — eine ZWEITE Tabelle ohne Aufbewahrungsfrist.**
`platform.calculator_requests` (Kalkulator-Anfragen von Fachbetrieben) fällt in dieselbe offene
juristische Prüfung. Geprüft, nicht angenommen: `platform.run_lead_retention` greift unverändert
**ausschließlich** auf `platform.leads`; es gibt für **keine** Rolle ein `delete`-Grant.

Der Fall wiegt allerdings **leichter als bei den Bewerbungen**, und das ist der Unterschied, den man
bei der Prüfung mitgeben sollte: Die Tabelle enthält **keine eigenen Kontaktdaten** — keine E-Mail,
keinen Namen, keine Telefonnummer. Sie führt einen Verweis auf den Fachbetrieb (`partner_slug`), den
Begründungstext des Betriebs, den Status und drei Zeitstempel. Alles Personenbezogene liegt an
`platform.partners` bzw. `auth.users` und folgt deren Lebenszyklus (`reviewed_by` ist
`on delete set null` — das Konto des Prüfers bleibt löschbar, der Vorgang bleibt über `reviewed_at`
belegt). Der Begründungstext ist ein Freitext, den der Betrieb über sein eigenes Geschäft schreibt;
ob darin Personenbezug landet, entscheidet er selbst.

---

## 8. Kontoexistenz auf `/registrieren` — bewusst offengelegt (B16-4a)

**Entschieden, nicht offen.** Der Registrierungsweg `/registrieren` verrät durch HTTP 422
`user_already_exists` und durch 429 bei Wiederholung, ob eine E-Mail-Adresse ein Konto hat (gemessen
gegen GoTrue in der Fassung dieses Projekts, B16-3). Das bleibt bewusst so:

- Die Auskunft ist für den Nutzer **nützlich** — sie erspart ihm das Warten auf eine
  Bestätigungsmail, die nie kommt.
- Der verratene Umstand hat **geringe Aussagekraft**: Kalkulator-, Monitor- und Partnerkonten teilen
  denselben Bestand, „hat irgendein Konto" sagt also nichts darüber, was jemand nutzt.
- Der **Bewerbungsweg `/partner-werden` verschluckt den Fehler bewusst**, weil dort
  Wettbewerbsinformation entstünde („dieser Betrieb bewirbt sich als Partner").
- Die saubere Lösung — immer neutrale Antwort, stattdessen eine Hinweismail an das bestehende Konto
  — kostet eine **privilegierte Existenzabfrage auf einem öffentlichen Pfad** und ist bei der
  aktuellen Nutzerzahl unverhältnismäßig.

**Erneut zu bewerten**, wenn Enumeration beobachtet wird (auffällige Serien von 422/429 auf
`/registrieren`) oder wenn die Kontozugehörigkeit selbst schützenswert wird.

---

## 9. Ausgehende E-Mail — EIN Absender, EIN Versandweg ⚠️ BETRIEBSREGEL

**Ausgehende Mail läuft grundsätzlich über Resend, Absender `energy@coolin.at`.** Das gilt AUCH für
die Auth-Mails von Supabase (Registrierungsbestätigung, Passwort-Zurücksetzen): der eingebaute
Supabase-Versand landet nachweislich im Spam. Diese Umstellung ist **Dashboard-Konfiguration**
(Authentication → SMTP Settings, s. §2c) und **nicht im Repo abbildbar**. Zusätzlich ist
**Authentication → Rate Limits → „Emails sent per hour" eigens hochzusetzen** — Custom SMTP hebt das
Auth-Ratenlimit **NICHT** automatisch an. Ein zu niedriges Limit hat in **B16-3 real dazu geführt,
dass Kontoanlagen mit 429 scheiterten** (`over_email_send_rate_limit`); seit **PR #43** bricht die
Bewerbung in diesem Fall sichtbar ab, statt einen Antrag ohne Konto zu hinterlassen. Auch die
**Auth-Mail-Vorlagen liegen im Dashboard** und sind getrennt zu pflegen.

> **⚠ NACHTRAG B18-2a (03.08.2026) — der Absatz oben gilt weiter, aber der PARTNER-Weg hängt nicht
> mehr daran.** Die Partner-Bewerbung legt ihr Konto seit B18-2a über die GoTrue-**Admin**-API an und
> versendet dabei **gar keine Mail** (`lib/auth/admin-api.ts`); der 429-Fall kann dort also nicht mehr
> auftreten. Das Ratenlimit bleibt trotzdem hochzusetzen — es betrifft weiterhin die Registrierung
> über `/registrieren` und das Passwort-Zurücksetzen. **Und es hat eine Nebenwirkung verloren, die
> benannt gehört: Es war bis hierher die faktische Bremse gegen massenhafte Kontoanlage über das
> öffentliche Bewerbungsformular.** Was jetzt dort schützt, steht als offener Betriebspunkt am Ende
> dieses Abschnitts (Turnstile).

**Warum `energy@coolin.at` und ausdrücklich kein `noreply@`:** Die Adresse ist in Resend verifiziert
(SPF+DKIM auf coolin.at) und liefert nachweislich zu — sie ist die einzige, für die das belegt ist.
`noreply@`-Adressen werden von Filtern tendenziell schlechter bewertet, und bei einer Mail, die
jemand unerwartet bekommt, muss eine Rückfrage möglich sein. Eine Antwort, die ins Leere läuft, ist
im besten Fall eine verlorene Rückfrage und im schlechtesten eine Beschwerde.

**Der Absender steht im Code, nicht in der Umgebung:** `MAIL_FROM` in
`apps/web/lib/mail/send.ts` — **eine** Definition für alle Mails. `RESEND_FROM` gibt es nicht mehr
(§1c). Gepinnt in `apps/web/lib/mail/sender.test.ts`, das jeden Versandpfad einmal echt auslöst.

### Was dieses System verschickt (Stand 03.08.2026, B18-2a)

**Über Resend — sieben Mails, alle mit demselben Absender:**

| Anlass | Empfänger | Code | Reply-To |
|---|---|---|---|
| Kontaktformular | intern (`RESEND_TO`, sonst `energy@coolin.at`) | `lib/kontakt/deliver.ts` | der Absender des Formulars |
| Double-Opt-in-Bestätigung (B1-2) | Interessent | `lib/leads/mail.ts` | — |
| Zusendung des Rechenergebnisses (B3-2) | Interessent | `lib/leads/mail.ts` | — |
| Vertragsablauf-Erinnerung (B4-2, Cron) | Interessent | `lib/leads/mail.ts` | — |
| Partner-Bewerbung, Benachrichtigung (B16-3) | intern | `lib/partner-application/mail.ts` | der Bewerber |
| Partner-Bewerbung, Eingangsbestätigung (B16-3) | Bewerber | `lib/partner-application/mail.ts` | — |
| Partner-Freischaltung **inkl. Aktivierungslink** (B16-4b + B18-2a) | Fachbetrieb | `lib/partner-portal/mail.ts` | — |

- **Die Zahl ist unverändert sieben** — B18-2a hat keine Mail hinzugefügt, sondern eine ENTFERNT
  (die Supabase-Bestätigungsmail bei der Bewerbung, s. u.) und dafür den **Aktivierungslink in die
  bestehende Freischaltungsmail gelegt**. Ein Bewerber bekommt damit genau zwei Mails über den
  gesamten Weg: die Eingangsbestätigung und, nach der Prüfung, die Freischaltung.
- Der Aktivierungsblock erscheint **nur, wenn das Konto tatsächlich noch unbestätigt ist** — ein von
  Hand aufgenommener Fachbetrieb mit bestehendem Konto bekommt die Mail unverändert ohne ihn.
- **Ohne Aktivierungslink geht die Mail gar nicht raus** (`send_failed`, im Admin-Bereich als
  „erneut senden" sichtbar): Eine Freischaltung ohne ihn lüde in einen Zugang ein, der sich nicht
  öffnen lässt.

- Das **Kontaktformular schickt dem Absender KEINE eigene Bestätigung.** Kreuzt er zusätzlich die
  Marketing-Einwilligung an, bekommt er die Double-Opt-in-Mail — das ist eine andere Sache.
- **Abmeldelink (RFC 8058) trägt genau EINE dieser Mails: die Vertragsablauf-Erinnerung.** Sie ist
  die einzige bestellte Aussendung. Die übrigen sechs sind transaktional — abgemeldet werden kann
  eine Aussendung, nicht die Antwort auf einen Vorgang, den der Empfänger selbst angestossen hat.
- Der **Fristendurchsetzungs-Lauf (B4-1, `lead-retention`, täglich 03:15 UTC) versendet bewusst
  KEINE E-Mail** — er anonymisiert nur.

**NICHT über Resend, sondern von Supabase selbst versendet — per Code NICHT erreichbar:**

| Anlass | Auslöser im Code |
|---|---|
| Registrierungsbestätigung (`/registrieren`) | `supabase.auth.signUp` (`lib/auth/actions.ts`, `lib/auth/sign-up.ts`) |
| „Bestätigungsmail erneut senden" (aus dem Login-Fehlerzustand) | `supabase.auth.resend` (`lib/auth/actions.ts`) |
| Passwort-Zurücksetzen | `supabase.auth.resetPasswordForEmail` (`lib/auth/actions.ts`) |

- **⚠ ENTFALLEN MIT B18-2a: die Bestätigungsmail bei der PARTNER-BEWERBUNG.** Sie ging bis dahin
  sofort beim Absenden des Formulars raus — der Bewerber musste sein Konto also bestätigen, bevor er
  wusste, ob er angenommen wird, und bekam nach der Freischaltung eine zweite Mail. Die Kontoanlage
  läuft jetzt über die GoTrue-**Admin**-API (`lib/auth/admin-api.ts`, `email_confirm: false`) und
  versendet nichts; das Konto ist bis zum Klick auf den Aktivierungslink nicht anmeldefähig
  (gemessen: HTTP 400 `email_not_confirmed`).
- **Die zweite Zeile ist der eine Weg, auf dem ein Bewerber doch eine Supabase-Mail sieht:** Wer sich
  vor der Freischaltung anzumelden versucht, bekommt auf `/anmelden` den bestehenden Knopf
  „Bestätigungsmail erneut senden". Das ist gewollt und unverändert (T4-2) — er fordert sie selbst
  an, und die Adresse gehört ihm.

Diese beiden hängen **ausschliesslich an der Dashboard-Konfiguration** (§2c): Absender, Versandweg,
Ratenlimit und Vorlagen sind dort eingestellt, nicht im Repo. Der Code kann sie weder umleiten noch
selbst versenden — er löst sie nur aus. **Das ist eine Feststellung, kein Arbeitsauftrag:** Es gibt
in `apps/web` keinen Weg, diese Mails über `lib/mail/send.ts` zu schicken, und es soll auch keiner
gebaut werden (er müsste GoTrues Bestätigungs-Token nachbauen).

### ⚠️ OFFEN — von Andreas zu bestätigen

**Ist die Umstellung auf Custom SMTP (§2c) in der Cloud bereits erfolgt?** Vom Repo aus **nicht
prüfbar**: Auth-SMTP-Einstellungen und das Auth-Ratenlimit sind Projektkonfiguration und werden von
`supabase db push` nicht erfasst; der Resend-API-Key ist in Vercel als „sensitive" hinterlegt und
damit auch nicht auslesbar (dieselbe Grenze wie bei der Öffnungs-/Klick-Verfolgung, §2-Resend-a).

**Zu bestätigen sind drei Dinge, einzeln:**

1. Custom SMTP aktiv, **Sender email = `energy@coolin.at`** (nicht `noreply@`).
2. **Authentication → Rate Limits → „Emails sent per hour" hochgesetzt** — das ist der Punkt, der bei
   aktivem Custom SMTP am ehesten übersehen wird, weil das eine ohne das andere funktioniert bis zum
   ersten Andrang.
3. Die **Auth-Mail-Vorlagen** einmal durchgesehen (Absenderbezeichnung, Ton, Links auf die
   Produktionsdomain).

Bis das bestätigt ist, gilt der Zustand als **unbekannt**, nicht als erledigt.

### ✅ ERLEDIGT — Turnstile ist scharf, und ein Wächter hält es so (B18-2a → 03.08.2026)

**Der Punkt war der wichtigste Betriebspunkt von B18-2a. Er ist geschlossen — die Werte sind
gesetzt, und ein erneutes Vergessen bricht ab jetzt den Build, statt monatelang still zu bleiben.**

**Der Ausgangszustand:** Bis B18-2a war das Supabase-Auth-Ratenlimit die — unbeabsichtigte — Bremse
gegen massenhafte Kontoanlage über das öffentliche Bewerbungsformular. Die Kontoanlage läuft seither
über die Admin-API und kennt dieses Limit nicht mehr. Es schützte danach allein der Honeypot, und
der hält Formular-Crawler auf, nicht ein Skript, das drei Feldnamen kennt.

> **⚠️ KORREKTUR AM NACHWEISVERFAHREN (03.08.2026) — WER TURNSTILE PRÜFT, DARF NICHT IM HTML SUCHEN.**
> Der ursprüngliche Befund dieses Abschnitts lautete „0 Vorkommen von `cf-turnstile` /
> `challenges.cloudflare.com` im ausgelieferten HTML, **also** ist der Site-Key nicht gesetzt". Der
> Schluss ist FALSCH, und zwar unabhängig vom Ergebnis: `components/kontakt/turnstile-widget.tsx`
> rendert serverseitig nur ein `<div className="mt-2">` — die Klasse `cf-turnstile` kommt dort gar
> nicht vor, und das Cloudflare-Script wird erst nach der Hydration per
> `document.createElement` eingehängt. **Beide Zeichenketten sind im Server-HTML immer 0, auch bei
> vollständig scharfem Turnstile.** Nachgemessen am 03.08.2026 nach der Behebung: `/partner-werden`
> liefert weiterhin 0× `cf-turnstile` im HTML — und Turnstile ist trotzdem aktiv.
>
> **Die zwei Prüfungen, die tatsächlich tragen:**
> 1. *Der Site-Key im Client-Bundle.* Er wird zur Build-Zeit inlined:
>    `curl -s https://www.coolin.at/partner-werden` → die `/_next/static/chunks/…`-URLs einsammeln,
>    diese abrufen und nach `0x4…` (Turnstile-Site-Key-Präfix) bzw. nach
>    `challenges.cloudflare.com` greppen. Am 03.08.2026 beides gefunden → das Widget ist scharf.
> 2. *Der Build selbst.* Seit dem Wächter unten ist ein erfolgreiches Production-Deployment der
>    Beweis, dass **beide** Werte gesetzt sind — ohne sie käme es gar nicht zustande. Das ist die
>    verlässlichere der beiden Prüfungen, weil sie nicht vergessen werden kann.

**Was jetzt gilt:** Beide Schlüssel sind in Vercel gesetzt (Scope **Production + Preview**) —
belegt durch beide Prüfungen oben am Production-Deployment des Commits `e6687d5` —

| Variable | Scope | Hinweis |
|---|---|---|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Production + Preview | im Browser sichtbar, bei Turnstile unkritisch |
| `TURNSTILE_SECRET_KEY` | Production + Preview | **nie** `NEXT_PUBLIC_` |

Der Schutz greift damit zugleich für `/kontakt` und die Lead-Erfassung, die denselben Mechanismus
benutzen. Einzeln gesetzt wäre jeweils harmlos, aber wirkungslos (Widget ohne Prüfung bzw. Prüfung
ohne Widget → Letzteres lehnt ab); erst beide zusammen ergeben den Schutz.

**⚠️ WER DIESE WERTE ENTFERNT, BRICHT DEN PRODUKTIONSBUILD — und zwar mit Absicht.** Seit dem
03.08.2026 gibt es `apps/web/lib/env.guard.ts`: Läuft ein Build unter der Produktivdomain
(`IS_PRODUCTION_SITE`, also `NEXT_PUBLIC_SITE_URL=https://coolin.at`) und fehlt einer der beiden
Werte, bricht `next build` beim Sammeln der Seitendaten mit einer Meldung ab, die den fehlenden Wert
benennt. Der Grund steht oben: Das Fehlen war an nichts zu erkennen — die Formulare funktionierten
weiter, nur der Schutz fehlte. Ein Wächter, der erst zur Laufzeit meckert, hätte dieselbe Stille
erzeugt.

**Was der Wächter ausdrücklich NICHT tut:** Preview-Builds und lokale Builds laufen weiterhin ohne
beide Werte durch (gemessen, Exit 0) — auch jetzt, wo sie in Preview gesetzt SIND. Und
`lib/kontakt/turnstile.ts` bleibt unverändert env-gated: Ohne Secret wird die serverseitige Prüfung
weiterhin übersprungen statt verweigert, sonst wäre jedes Formular lokal unbenutzbar. Der Wächter
ist orthogonal dazu — er entscheidet nicht, wie geprüft wird, sondern nur, dass die Werte da sind,
wo es keinen Grund gibt, sie nicht zu haben.

**Bei einem künftigen Domainwechsel mitzudenken:** Die Bedingung hängt an `PRODUCTION_ORIGIN` in
`apps/web/lib/site.ts` — derselben einen Stelle, an der die Produktivdomain steht. Ein Umzug ist
dort ein Wort, nicht zwei.

### ⚠️ OFFEN — B18-2a: Lebensdauer des Aktivierungslinks prüfen

Der Aktivierungslink der Freischaltungsmail ist ein GoTrue-Magic-Link und verfällt nach der
Einstellung **Authentication → Email → „Email OTP Expiration"** (lokal `otp_expiry = 3600`, also eine
Stunde). Für eine Mail, die unangekündigt in ein Geschäftspostfach fällt, ist das knapp.

**Bewusst NICHT im Code geändert:** Der Wert gilt plattformweit (auch für Registrierungsbestätigung
und Passwort-Zurücksetzen) und liegt in der Projektkonfiguration, nicht im Repo. **Der Rückweg
existiert bereits und ist gemessen:** „Benachrichtigung senden" im Admin-Bereich unter „Partner"
erzeugt einen frischen Link, und die Mail sagt das im Klartext („Falls er nicht mehr funktioniert,
schreiben Sie uns kurz"). Zu entscheiden ist allein, ob der Wert im Dashboard hochgesetzt wird —
Supabase warnt oberhalb einer Stunde im Security-Advisor, die Abwägung gehört zu Andreas.
