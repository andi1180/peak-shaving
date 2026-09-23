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

## batterie-station.mjs

Prüft, dass sich Kenndaten **nachtragen** lassen: „Ja, es gibt einen Speicher" ohne Zahlen
speichern · weg-navigieren · zurück · die vier Felder müssen editierbar dastehen. Die Gegenprobe
im selben Lauf wiegt gleich schwer — sobald ein Kenndatenfeld gesetzt ist, muss das Formular weg
sein (sonst gäbe es zwei Plätze für dieselben Werte). Nachweis für den Fix vom 22.09.2026:
**ohne ihn rot, mit ihm grün.**

⚠ Er benutzt denselben Zählpunkt wie `rechnung-station.mjs` und leert dessen Entwurf. Die beiden
Läufe sind deshalb nacheinander zu fahren, nicht gleichzeitig.

## rechnung-station.mjs

Fährt die fünf Schritte der Rechnung-Station nach (öffnen · vorhandene Rechnung entfernen · Werte
von Hand eintragen · weiter · zurück) und prüft, dass der erfasste Stand wieder dasteht. Er war
der Nachweis für den Fix vom 22.09.2026: **ohne ihn rot, mit ihm grün.** Die Ausgangslage stellt er
selbst her (`rechnung-station.seed.sql`).

## battery-catalog-rte-source.mjs

Prüft am Batteriekatalog (`/admin/batteriespeicher/<id>`), dass eine Auswahl das Speichern
übersteht: Kenndaten + Quelle „Datenblatt" eintragen · speichern · **ein zweites Mal speichern,
ohne etwas zu ändern** · neu laden. Nachweis für den Fix vom 23.09.2026: **ohne ihn rot (4
Fehlschläge), mit ihm grün.**

⚠ **Der zweite Speichern-Klick ist der Kern.** React setzt das Formular nach jeder abgeschlossenen
Action zurück, und ein `<select>` fällt dabei auf den Stand des SEITENAUFBAUS zurück (sein
`defaultValue` wirkt nur beim Einhängen). Das leere Feld schickt beim nächsten Speichern seinen
leeren Wert mit — und `admin_update_battery` deutet leer als LÖSCHEN. Der Anzeigefehler löscht also
die gerade gespeicherte Angabe; nachgewiesen wird das an der Datenbank, nicht am Bildschirm. Ein
Test, der nur nach dem Neuladen hinschaut, wäre vor dem Fix grün geblieben, solange nur einmal
gespeichert wurde.

Ausgangslage und Aufräumen macht er selbst (`battery-catalog-rte-source.seed.sql`, das Testgerät
wird am Ende gelöscht). Er braucht kein Projekt und keinen Zählpunkt, nur das Admin-Konto.

## admin-select-form-reset.mjs

Derselbe Fehler wie oben, aber für die ÜBRIGEN Admin-Formulare — seit 23.09.2026 behebt ihn
`AdminSelect` selbst (`useSelectValueOnFormReset`), und dieser Lauf hält den Nachweis offen. Er
fährt drei Formulare in einer Sitzung, ausgewählt nach den drei Bauarten, in denen `AdminSelect`
vorkommt:

1. **Lead bearbeiten** — `defaultValue` aus der Serverzeile nach `revalidatePath`. ⚠ Der zweite
   Speichern-Klick wiegt hier am schwersten: `admin_update_lead` deutet leer als LÖSCHEN.
2. **Kostenbaustein bearbeiten** — ein Feld OHNE Leer-Eintrag: es fällt nicht auf „nichts" zurück,
   sondern auf den falschen Wert `fundament`.
3. **Lieferanten-Tarif anlegen** — `defaultValue` aus `state.values`, also aus der ABGELEHNTEN
   Eingabe; der Quellenbeleg bleibt absichtlich leer.

Nachweis für den Fix: **ohne ihn rot (6 Fehlschläge), mit ihm grün.** Ausgangslage und Aufräumen
macht er selbst (`admin-select-form-reset.seed.sql`); er braucht nur das Admin-Konto.

Vollständiger Befund samt Prüfung des Altbestands: `AdminSelect_Audit.md` im Repo-Root.
