# db-tests — DB-Gate für die Supabase-Schemas

Ausführbares Integrations-Gate, das die Sicherheits-Invarianten der Supabase-Schemas gegen den
**laufenden lokalen Stack** prüft: RLS, Grants, Trigger, Cascades. Aktuell abgedeckt: das
`platform`-Schema (T4-1, Auth/Rollen/Entitlements/Stripe-Spiegel), Invarianten **I1–I10**, die
public-RPC-Wrapper (T4-2/T4-3/T4-4, Gutscheincodes), das **Lead- und Einwilligungsfundament**
(B1-1: Zugriffsgrenzen, Unveränderlichkeit der Einwilligungstexte, Double-Opt-in-Sperre,
Aufbewahrungsfristen, Überleben der Sperrliste) sowie den **Erfassungs-, Bestätigungs- und
Abmeldepfad** darauf (B1-2: `capture_lead` & Co. — keine zweite offene Bestätigung je Lead und
Zweck, gesperrte Adressen erzeugen keine Einwilligung, abgelaufene Tokens bestätigen nicht,
Bestätigen ist idempotent, und der Lesepfad des Bestätigungs-GET verändert nachweislich nichts)
sowie den **Admin-Pfad** darauf (B1-3: die sechs neuen Wrapper sind `authenticated`-only und lehnen
einen Nicht-Admin mit SQLSTATE 42501 ab statt mit einer leeren Antwort; „Kunde" hebt die
Aufbewahrung auf 84 Monate und der Rückweg wird abgelehnt; die Anonymisierung entfernt die
Identitätsmerkmale, lässt Einwilligungsnachweis und Sperrliste stehen, ist idempotent und für
`service_role` **wie für `postgres`** unumkehrbar; die Filter der Lead-Liste liefern konsistente
Trefferzahlen).

Warum ein Gate statt Prosa: ein RLS-/Grant-Fehler auf Zugangsrechten oder Zahlungsstatus ist ein
Datenleck über Nutzergrenzen hinweg und beim Klicken unsichtbar (Pflichtenheft §10). Jeder Test
stellt seinen Zustand **real** her — echte Nutzer über die GoTrue-Admin-API, echte Rollen, echte
Transaktionen — und räumt danach auf (wiederholbar ohne `db reset` dazwischen).

## Eigenes Package, bewusst KEIN `test`-Script

Dieses Paket hat **kein** `test`-Script, sondern `test:db`. Grund: `pnpm -r test`
(`pnpm -r --if-present run test`) soll dieses Gate **nicht** einsammeln — es braucht Docker + einen
laufenden Stack, den nicht jede Umgebung (und nicht die schnelle Standard-CI `test.yml`) hat. Das
Gate läuft ausschließlich explizit (`pnpm --filter db-tests test:db`) bzw. im separaten
CI-Workflow `.github/workflows/db-gate.yml`.

## Lokal ausführen

```bash
supabase start          # Docker-Stack hochfahren (falls nicht schon läuft)
supabase db reset       # Migrationen + Seed anwenden (bringt u. a. das platform-Schema)
pnpm --filter db-tests test:db
```

Ist der Stack nicht erreichbar, **scheitert** der Lauf mit einer klaren Meldung
(`… Supabase-Stack/DB nicht erreichbar … supabase start`) — er überspringt sich **nicht** still.

## Konfiguration

Defaults zielen auf den lokalen Stack; überschreibbar per Env (so speist die CI die Werte aus
`supabase status -o env`):

| Env | Default | Zweck |
|---|---|---|
| `SUPABASE_DB_URL` | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` | direkte pg-Verbindung (RLS/Grants/Trigger) |
| `SUPABASE_API_URL` | `http://127.0.0.1:54321` | GoTrue-Admin-API (echte Nutzer anlegen/löschen) |
| `SUPABASE_SERVICE_ROLE_KEY` | statischer lokaler Dev-Key | Auth der Admin-API |

## Wie RLS faithful getestet wird

Das `platform`-Schema ist **bewusst nicht** über die REST-API exponiert (personenbezogene
Auth-/Zahlungsdaten). Ein `supabase-js`-`.from()`-Client könnte es also gar nicht erreichen. Die
Tests gehen deshalb direkt über Postgres und setzen `request.jwt.claims` + `SET LOCAL ROLE` **exakt
wie PostgREST/GoTrue** — `auth.uid()` liest `claims->>'sub'`, die `user_id` ist die echte id des über
die Admin-API angelegten Nutzers. Das ist keine Simulation, sondern derselbe Mechanismus, den die
Plattform zur Laufzeit nutzt.
