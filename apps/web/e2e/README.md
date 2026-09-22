# Läufe über die echte Oberfläche

Hier liegen Playwright-Skripte, die eine Aussage prüfen, die sich **nur** im Browser prüfen lässt —
also eine, an der Server Action, `revalidatePath`, Server-Komponente und Client-Zustand gemeinsam
hängen. Alles, was ohne Renderer richtig oder falsch ist, gehört weiter nach `lib/**/*.test.ts`
(`vitest.config.ts` schliesst Komponententests bewusst aus, und das bleibt so).

## ⚠ Playwright ist keine Repo-Abhängigkeit

Das ist Absicht: ein Browser-Runner im Monorepo zöge eine ~130-MB-Abhängigkeit in jeden
Installationslauf, obwohl es heute genau ein solches Skript gibt. Installiert wird in einem
Wegwerf-Ordner ausserhalb des Repos:

```
mkdir -p /tmp/pw && cd /tmp/pw && npm init -y && npm i playwright
```

Der Pfad dorthin wird über `PLAYWRIGHT_MODULE` übergeben. ⚠ **Nicht `NODE_PATH` und nicht „aus dem
Ordner starten":** Node löst Importe relativ zur Skriptdatei auf, nicht zum Arbeitsverzeichnis —
beides scheitert mit `ERR_MODULE_NOT_FOUND`.

```
PLAYWRIGHT_MODULE=/tmp/pw/node_modules/playwright/index.js \
  node apps/web/e2e/rechnung-station.mjs
```

## Voraussetzungen

1. Lokaler Stack läuft (`npx supabase start`) — das Skript spricht `psql` im Container an.
2. Ein Next-Server auf `BASE` (Vorgabe `http://127.0.0.1:3977`).
3. Ein **Admin-Konto** und ein Projekt mit Segment und mindestens einem Zählpunkt. Einmalig:

```sql
insert into platform.user_roles (user_id, role) values ('<auth-user-id>', 'admin');
insert into platform.projects (id, customer_label, segment, created_by)
values ('11111111-1111-4111-8111-111111111111', 'E2E Rechnung-Station', 'betrieb', '<auth-user-id>');
insert into platform.metering_points (id, project_id)
values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111');
```

⚠ **Fixtures danach wieder abräumen** — `packages/db-tests` pinnt absolute Admin-Zahlen, ein
zurückgelassener Test-Admin macht das DB-Gate rot, ohne dass am Code etwas falsch ist.

## rechnung-station.mjs

Fährt die fünf Schritte der Rechnung-Station nach (öffnen · vorhandene Rechnung entfernen · Werte
von Hand eintragen · weiter · zurück) und prüft, dass der erfasste Stand wieder dasteht. Er war
der Nachweis für den Fix vom 22.09.2026: **ohne ihn rot, mit ihm grün.** Die Ausgangslage stellt er
selbst her (`rechnung-station.seed.sql`).
