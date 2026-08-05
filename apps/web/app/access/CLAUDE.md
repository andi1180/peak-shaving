# CLAUDE.md — Zugangsplattform (access.coolin.at)

> Wird geladen, sobald in diesem Verzeichnisbaum gearbeitet wird (nächstgelegene Datei gilt).
> **Maßgebliches Detaildokument: `../../../../Pflichtenheft_Zugangsplattform_MVP.md`** (Repo-Root) — bei Widerspruch gilt das Pflichtenheft.
> Diese Datei enthält die Regeln und Leitplanken des Moduls; das Pflichtenheft enthält Produkt, Markt, Recht und Bau-Reihenfolge.
>
> **Übergeordnet gelten zusätzlich:** `../../CLAUDE.md` (apps/web: Designsystem, Arbeitsregeln, Stack) und `../../DESIGN.md` (Tokens). Bei Widerspruch zwischen Website-Pflichtenheft und diesem Produkt gilt für Code dieses Moduls das Zugangsplattform-Pflichtenheft — dieselbe Regel, die für den Monitor in `apps/web/CLAUDE.md` festgehalten ist.
>
> **Naming-Hinweis (nur claude.ai-Projektordner, nicht Repo):** Dort heißt die Datei **`CLAUDE_Zugangsplattform.md`** (Pflichtenheft §8: „Eigene Dateien mit Suffix … niemals bare `CLAUDE.md`"), weil der Projektordner flach ist und bereits `CLAUDE.md`-Dateien anderer Produkte enthält. **Im Repo** heißt sie korrekt `CLAUDE.md` — hier eindeutig, weil eigener Ordner.

---

## Was wir bauen

Eine Plattform, über die PV-Installateure den **Fernzugriff auf Wechselrichter** ihrer Kundenanlagen verwalten: personengebunden statt über ein geteiltes Installateurspasswort, mit zwei unveränderlichen Protokollen (wer hat zugegriffen · wer hat wem die Berechtigung erteilt). Drittes eigenständiges Produkt neben Kalkulator und Monitor — **nicht** das Partner-Portal.

**Verkauft wird nicht der Zugang, sondern die Nachweisführung** (Pflichtenheft §7.4). Der Zugang allein ist bei Teltonika RMS direkt zu haben; COOLiNs Wert ist die Zuordnung zu einem konkreten Endkunden samt Compliance-Akte, der disziplinierte Entzug bei Mitarbeiterwechsel und ein lokaler Ansprechpartner. Wer hier Texte schreibt, hält sich an diese Trennlinie.

**Produktname und Subdomain sind Arbeitstitel** (§0, §9).

---

## Wo was liegt

```
apps/web/app/access/**          ← der Routen-Baum (eigenes Root-Layout, AUSSERHALB (site)/[locale])
apps/web/components/access/**   ← die UI des Bereichs (Rahmen, Panels)
apps/web/lib/access-host.ts     ← Host + Adressen + Render-Baum (REIN, kein server-only)
apps/web/lib/host-match.ts      ← der geteilte Host-Vergleich (auch vom Partner-Portal benutzt)
apps/web/lib/access-host.test.ts ← die Wächter des Moduls
```

**`lib/access/**` gibt es noch nicht — dort gehört alles hin, was Daten oder Geheimnisse anfasst** (RMS-Client, Leser, Server Actions), nach dem Vorbild von `lib/partner-portal/**`. Bewusst kein leerer Ordner auf Vorrat: ein Verzeichnis ohne Inhalt ist keine Struktur.

**Vorbild für jeden neuen Schritt ist das Partner-Portal** (`app/portal/**`, `components/portal/**`, `lib/partner-portal/**`, `lib/portal-host.ts`) — dasselbe Muster, bewiesen funktionsfähig. Nicht neu erfinden, was dort gelöst ist.

---

## Nicht verhandelbare Prinzipien

1. **Server-only für alles Sicherheitsrelevante.** RMS-API-Credentials und jede Zugriffs-/Freischaltungslogik dürfen **nie** im Client-Bundle landen (§8). Der Ort dafür ist ein Modul mit `import 'server-only'` unter `lib/access/`, nicht eine Komponente dieses Baums. Ein Test hält heute fest, dass der Bereich keine Client-Komponente und kein `process.env` enthält — wird eine nötig, ist das eine **bewusste** Entscheidung mit eigener Begründung.
2. **Trennung im Code, nicht in der Infrastruktur.** Dasselbe Repo, dieselbe App, dasselbe Vercel-Projekt wie Website und Partner-Portal (§8, entschieden). Was die Trennung trägt, ist das eigene Root-Layout: Der Baum kann den Website-Header technisch nicht erben, und `lib/routes.ts` kann seine Seiten per Konstruktion nicht in die sitemap aufnehmen. Ein Test verbietet zusätzlich jeden Import aus den Marketing-Komponenten.
3. **Generisches Rückgrat, konkrete Anbindung** (§8). Datenmodell und Protokolle sind objekttyp- und anbieteroffen (Organisation → Person → Rolle → Berechtigung auf ein Objekt → befristete Sitzung → unveränderliches Protokoll). Die Anbieter-Anbindung bleibt eng an Teltonika: **eine Schnittstelle, eine Implementierung, kein Plugin-Framework** — eine Abstraktion über eine Stichprobe von einem Hersteller wird von dessen Eigenheiten geformt und tut nur so, als sei sie neutral.
4. **Append-only Ledger, keine DELETE-Grants.** Zwei getrennte Protokolle (Zugriff **und** Berechtigung, §6.4) — nicht eines. Das Berechtigungsprotokoll ist das eigentliche Beweisstück für den Installateur gegenüber seinem NISG-pflichtigen Kunden. Muster 1:1 aus dem Kalkulator (`platform`-Schema, SECURITY-DEFINER-Wrapper, Rollen manuell per SQL).
5. **Keine Compliance-Zusage in Texten.** Die NISG-Nachweispflicht liegt **rechtlich beim Betreiber** (§2.6), nicht bei COOLiN und nicht beim Installateur. „NISG-konform" wäre eine Behauptung, die diese Plattform nicht einlösen kann. Ebenso: kein Preis (§7.2 ist interne Kalkulationsgrundlage, der SIM-Tarif in §7.3 ist offen), keine Zusage über Termine, kein Hersteller-/Gerätename in der Oberfläche (§0: objekttyp-offen).
6. **Kein iframe.** Nativ gebaut, von Anfang an (§8).

---

## Routing — wie der Host funktioniert

`access.coolin.at` zeigt auf **dasselbe** Vercel-Projekt wie coolin.at und partner.coolin.at (`peak-shaving-web`, Root Directory `apps/web`). Die Trennung entsteht vollständig in der Middleware:

| Aufruf | Antwort |
|---|---|
| `access.coolin.at/` | die Plattform (interner **Rewrite** auf `/access`, Adresszeile bleibt `/`) |
| `access.coolin.at/<alles andere>` | **308** auf denselben Pfad unter `SITE_URL` |
| `/access` auf **jedem** Host, mit und ohne Locale-Präfix | **404 ohne Rumpf** |

**Drei Regeln, die dabei nicht verhandelbar sind:**

- **Der 404-Wächter steht VOR der 308-Weiche.** Stünde er darunter, liefe ein Aufruf auf dem Plattform-Host zuerst in die Weiche — der interne Pfad stünde in einem `Location`-Header nach coolin.at und würde dort gerendert. Die Position ist als Quelltext-Test gepinnt.
- **Rewrite, nicht Redirect.** Ein Redirect schriebe den internen Pfad in die Adresszeile.
- **Der Hostname steht an genau EINER Stelle** (`lib/access-host.ts`). Der Vergleich selbst liegt in `lib/host-match.ts` und ist mit dem Partner-Portal geteilt: Zwei Fassungen desselben Vergleichs sind die Sorte Fehler, die kein Test fängt — weicht eine ab, verhalten sich Weiche und Indexierungssignal unterschiedlich, und beides sieht für sich genommen richtig aus.

**Warum die Adressen kein Bereichspräfix tragen:** Die Domain trägt die Bedeutung bereits — ein zusätzliches `/zugang` stünde in jeder Adresszeile und wiederholte nur, was der Host schon sagt. ⚠ Preis dieser Entscheidung: Jede Adresse, die hier belegt wird, ist auf diesem Host für eine gleichnamige Website-Seite verschattet. Die Kollision ist am Namen erkennbar und wird bewusst nicht abgefangen.

⚠ **Eine öffentliche Seite `/access` auf coolin.at ist ausgeschlossen**, solange der Render-Baum so heißt — der Wächter beantwortet den Pfad auf jedem Host mit 404.

---

## Was noch nicht gebaut ist — und was beim Bauen mitzuziehen ist

Baustein 1 hat **ausschließlich** Routing plus Platzhalter gebaut. Keine Auth, keine Datenbank, keine RMS-Anbindung. Reihenfolge laut §6: **6.2** (Schema + RLS, schema-first wie beim Kalkulator) → **6.1 + 6.6** (Auth verdrahten + Dashboard-Skeleton) → **6.5** (Stripe) → **6.3/6.4** (RMS, erst mit real registriertem Gerät).

**Die drei Stellen, die beim ersten Auth-Schritt (6.1) zwingend mitgezogen werden:**

1. **`ACCESS_HOST_PATHS` um `...AUTH_HREFS` erweitern** (abgeleitet aus `lib/auth/config.ts`, nicht abgetippt). Grund: `sanitizeNext` lässt ausschließlich seiten-INTERNE Pfade zu — ein Rücksprungziel auf einem anderen Host ist strukturell nicht darstellbar. Läge `/anmelden` nur auf der Hauptdomain, bräuchte es eine Host-Allowlist und damit ein zweites Open-Redirect-Verfahren. **`/konto` gehört zwingend mit**: es ist der Rückfallwert des gesamten Auth-Systems; fehlt es, verlässt jeder Anmeldevorgang, der sein `next` verliert, den Host. Ein Test hält den heutigen Zustand fest und wird dabei rot — das ist gewollt.
2. **Zugangsprüfung in JEDE Seite, nicht ins Layout.** Dass ein Layout `children` nicht rendert, verhindert nicht, dass Next die Seite rendert und ins Flight-Payload schreibt (im Admin-Bereich und im Portalbereich gemessen). Dazu gehört ein Wächter, der alle `page.tsx` des Baums liest — Vorbild `lib/portal-host.test.ts`.
3. **`export const dynamic = 'force-dynamic'`**, sobald eine Seite eine Sitzung oder Objektdaten liest. Eine zwischengespeicherte Fassung zeigte dem nächsten Besucher die Daten des vorigen.

**Weiter mitzudenken:**

- **Der Session-Refresh läuft bereits** (`updateSession` im Rewrite-Zweig der Middleware) — bewusst schon jetzt, weil die umgekehrte Reihenfolge refreshte Tokens still verwirft und Nutzer scheinbar zufällig aus der Sitzung fliegen.
- **Kein `next`-Parameter darf je auf den Render-Baum zeigen** — Rücksprungziel ist immer die Adresse AUF DEM HOST. Ein Test prüft das über den gesamten Quellbaum.
- **Eine zweite Sprache ist eine Entscheidung, kein Nachtrag.** Der Bereich liegt außerhalb der Sprach-Struktur und rendert unter `defaultLocale`; `/en/` liefe an der Adress-Abbildung vorbei. Ein Test bricht laut, sobald `routing.locales` wächst.
- **Rollenmodell** (§6.2): Firmenadmin / Techniker / Prüfer, rechtlich hergeleitet aus §2.4. Der Firmenadmin darf sich die Rolle nicht entziehen, solange kein zweiter existiert (Aussperrschutz — dasselbe Muster wie der Lockout-Guard in `admin_revoke_role`).
- **Betreiber-Referenz ist Pflichtfeld** (§6.2), Objekt-Zuordnung Installateur↔Objekt **zeitlich befristet** statt fix (Installateurwechsel kommt vor) — jede Um-/Neuzuweisung ist ein Protokolleintrag, kein geändertes Feld.
- **Offene Punkte, die vor dem Einfrieren des Sitzungsmodells (6.3) zu klären sind** (§9): Kann ein RMS-Connect-Link vorzeitig **widerrufen** werden oder läuft er nur ab? Davon hängt ab, ob „Entzug bei Mitarbeiterwechsel" sofort oder verzögert wirkt. Dazu: Aufbewahrungsdauer beider Protokolle (DSGVO ≠ NISG-Nachweisfristen) — Anwaltsthema, nicht hier zu entscheiden.

---

## Betrieb

- **Vercel:** `access.coolin.at` liegt auf Projekt **`peak-shaving-web`** und ist dort verifiziert. **DNS ist gesetzt** (CNAME → `b2155869eae4c165.vercel-dns-016.com.`) — bei world4you ist nichts nachzutragen.
- **`robots.txt` sagt auf diesem Host `Disallow: /`** (`app/robots.ts`, dieselbe Bedingung wie für den Portal-Host). Die Plattform ist kein Suchmaschineninhalt.
- **Ein Deployment dieses Moduls betrifft nur `peak-shaving-web`.** Die Zwei-Projekte-Regel aus der Root-`CLAUDE.md` (Arbeitsregel 4) gilt hier nicht — `apps/website` wird nicht berührt.
- **„Fertig" heißt live verifiziert:** gemergt UND per HTTP gegen `https://access.coolin.at` bestätigt, nicht „Vercel Ready".

---

## Stand & offene Entscheidungen

> Lebendiger Handover-Anker. Erledigtes wandert raus.

- **[GEBAUT: Baustein 1 — Subdomain & Routing-Grundgerüst]** (05.08.2026). `lib/access-host.ts` · `lib/host-match.ts` (neu, geteilt) · `middleware.ts` (drei Zweige) · `app/robots.ts` · `app/access/{layout,page}.tsx` · `components/access/shell.tsx` · `messages/de.json` (Namespace `Access`) · `lib/access-host.test.ts` (34 Tests). **Keine Migration, keine Auth, kein Datenbankzugriff, keine RMS-Anbindung.** `apps/website`, `packages/**` und die Website-Marketing-Bereiche mit 0 Zeilen Diff.
  - **[DIE GEMESSENE AUSGANGSLAGE]** `https://access.coolin.at/` antwortete vor dem Bau **200 mit der Marketing-Startseite**, `/leistungen` ebenfalls 200 — die Subdomain war eine indexierbare Zweitdomain mit identischem Inhalt. Exakt der Zustand, den B18-1a für `partner.coolin.at` beseitigt hat.
  - **[`lib/host-match.ts` IST NEU UND WIRD GETEILT]** Normalisierung (Port/FQDN-Punkt/Groß-Klein), die Zwei-Kopfzeilen-Regel (`host` **und** `x-forwarded-host`) und das Abtrennen des Locale-Präfixes lagen als private Helfer in `lib/portal-host.ts`. Beide Regeln sind **gemessen, nicht abgeleitet** — eine Kopie erbt den Code, nicht die Messung. `portal-host.ts` ist verhaltensgleich darauf umgestellt.
  - **[TEXTE SIND ARBEITSSTAND]** `Access.*` in `messages/de.json` trägt einen `"//"`-Vermerk mit fünf bindenden Leitplanken (kein Preis, kein Termin, keine Compliance-Zusage, kein Hersteller-/Gerätename, Produktname ist Arbeitstitel). Endgültige Formulierungen von Andreas/Martin.
  - **[KEIN FORMULAR AUF DER PLATZHALTERSEITE]** Es würde Anfragen erfassen, für die es keinen Empfänger-Prozess gibt — dasselbe Muster, aus dem der Betroffenheits-Check in B3 nicht platziert wurde. Der einzige Weg nach draußen ist `COMPANY.email` aus `lib/nav.ts` (der EINE Fundort der Kontaktdaten).
  - **[VERIFIKATION]** Statuscodes über vier Hosts gemessen (Plattform · Hauptdomain · Portal-Host · localhost): `/` → 200, alles Übrige → 308 auf `SITE_URL`, `/access` + `/access/tiefer` + `/de/access` → **404 auf beiden echten Hosts**, `/access-fremd` bekommt korrekt die gewöhnliche Behandlung. Portal-Host und localhost unverändert. Sitemap 25 URLs, **0×** `access`. Seite: `noindex, nofollow`, **0 Canonicals**, 0 Formulare, 0 Eingabefelder, 0 iframes, **0 Links in die Website**, 0× €/%/NISG/Teltonika im sichtbaren Text, **0 px Überlauf @375px, 0 Konsolenfehler**. Fünf Wächter-Proben bringen je gezielt Rot.
  - **[⚠ OFFENGELEGTE GRENZE DER WÄCHTER]** Die Quelltextprüfungen belegen, dass die Middleware die benannten Ableitungen **aufruft** und in welcher **Reihenfolge** — nicht, dass der Aufruf wirksam ist. Ein `if (false && …)` liefe durch (gemessen). Die realistischen Fehlerbilder (Zweig entfernt, Zweig verschoben) sind abgedeckt; eine gezielte Aushebelung ist es nicht.
