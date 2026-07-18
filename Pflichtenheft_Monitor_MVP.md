# Pflichtenheft — Haushalts-Energiemonitor MVP

> **Plattform-Kontext:** COOLiN ENERGY (COOLiN GmbH, Wien). Drittes Produkt neben Pro-Kalkulator (B2B, live) und Firmen-Monitoring (B2B, geplant). Läuft unter der Dachmarke COOLiN Energy (`coolin.at`).
> **Dokumenttyp:** Technisches Pflichtenheft für den Haushalts-Energiemonitor (B2C/kleine Betriebe). Engine + Produktkonzept.
> **Bezug:** Eigenständiger Bauabschnitt im gemeinsamen Monorepo (`github.com/andi1180/peak-shaving`). Teilt Auth-/Entitlement-/Stripe-Infrastruktur mit dem künftigen Kalkulator-Portal. Bei Widerspruch zu allgemeinen Repo-Regeln (`CLAUDE.md`) gilt dieses Dokument für den Monitor.
> **Stand:** Juli 2026 · Erste vollständige Fassung nach strategischer Klärung (Andreas ↔ Advisor-Session). Wir bauen auf die **finale Lösung** hin, nicht auf einen MVP — der Zeitpunkt für einen Demo-/MVP-Schnitt wird von Andreas separat entschieden. · Sprache: Deutsch (Projektsprache).
>
> **Legende:** `[ANNAHME]` = getroffene Annahme, vor Livegang zu bestätigen · `[MARTIN]` = Domänen-/Markt-Input oder Freigabe erforderlich · `[RECHT]` = juristische Klärung/DSGVO vor Livegang · `[v2]` = bewusst nicht in erster Ausbaustufe, architektonisch vorzusehen · `[OFFEN-KOMMERZIELL]` = kommerzielle Entscheidung bewusst offen gehalten, blockiert den Bau **nicht**.

---

## 0. Zweck & Scope-Grenze

**Zweck des Monitors:** Privathaushalten (und kleinen Betrieben) niederschwellig zeigen, dass sie beim Strom zu viel zahlen, und ihnen konkrete günstigere Alternativen nennen. Wer eine **laufende** Überwachung will, abonniert sie. Das Produkt ist COOLiNs erste bewusste Öffnung über das bisherige Gewerbepublikum hinaus.

**Strategisches Primärziel: Reichweite & Vertrauensaufbau, nicht Direktumsatz.** Der österreichische Strommarkt hat ein Wechsel-Trägheits-Problem (z. B. ~85 % der Wiener Haushalte bei Wien Energie, geringer Wechseldruck). Der Monitor sensibilisiert die Masse fürs Thema Energiekosten. Funnel-Logik: energiekostenbewusste Haushalte und **kleine Betriebe** lassen sich später leichter Richtung Peak Shaving (Pro-Kalkulator) konvertieren, sobald sie ohnehin schon kostenbewusst sind.

> **Funnel-Präzisierung `[ANNAHME]`:** Der direkte Sprung „Privathaushalt → Gewerbespeicher-Investition" ist groß; der Haushalt ist selten der Investitionsentscheider. Der Funnel trägt primär über **kleine Betriebe** (Bäcker, Gastro, Handel), die im Monitor landen und bereits COOLiNs Kalkulator-Zielgruppe sind. Onboarding-Sprache und spätere Cross-Sell-Logik daran ausrichten.

**Leitprinzip gegen Scope-Creep:** Der Monitor beantwortet **eine** ehrliche Frage — „Zahlst du zu viel, und was wäre die Alternative?" — und überwacht diese Antwort im Abo **laufend**. Alles andere ist `[v2]`.

**Abgrenzung zu den anderen COOLiN-Produkten:**
- **Pro-Kalkulator** (B2B, live): Peak-Shaving-Analyse aus echtem Lastgang, dataless, loginlos, iframe-Übergangslösung. **Nicht** verwechseln — der Monitor ist login- und abo-basiert von Tag 1.
- **Firmen-Monitoring** (B2B, geplant): umfassendere Gewerbe-Überwachung, wird Teil des Pro-Kalkulators. Nicht Gegenstand dieses Dokuments. **Möglicher Synergiepunkt:** ein Tarif-Datenpartner, der Haushalts- **und** Gewerbestrom abdeckt (siehe §7), bedient beide.

---

## 1. Grundprinzipien (nicht verhandelbar)

Diese Prinzipien sind die Konsequenz der strategischen Klärung und bestimmen jede Detailentscheidung. Sie stehen bewusst zuerst, weil in der Diskussion mehrfach verlockende Abkürzungen auftauchten, die alle gegen das Nordstern-Ziel (Vertrauen/Reichweite) arbeiten.

1. **Ehrlich grob schlägt bewusst ungenau.** Der Gratis-Check ist grob, **weil** er mit wenigen Feldern rechnet — nicht weil er künstlich verschlechtert wurde. Es wird **niemals** Genauigkeit absichtlich zurückgehalten, um das Abo attraktiver zu machen. Sobald ein Nutzer merkt, dass die Abo-Zahl stark von der geschönt-schlechten Gratis-Zahl abweicht, ist das Vertrauen zerstört — und Vertrauen ist das einzige Produktziel. (Explizit verworfen: Felder künstlich beschneiden.)

2. **Keine Reibung als Verkaufsstrategie.** Das Abo verkauft sich über **Wert** (Bequemlichkeit + Automatisierung), nicht über **Schmerz**. Jede künstliche Hürde an der Funnel-Spitze kostet Reichweite — das Gegenteil des Produktziels. (Explizit verworfen: IP-basierte Sperre des Gratis-Checks; Formular nach jeder Nutzung leeren, um Nutzer zu zermürben.) Wiederkehrende Gratis-Nutzer sind die **wärmsten Leads**, nicht Schmarotzer — sie werden umworben, nicht bestraft.

3. **Ehrliche Zahlen: Dauerpreis ist die Überschrift, Bonus separat.** Ein Wechselbonus ist fast immer ein einmaliger Erstjahres-Effekt. Die Ersparnis-Headline basiert auf dem **Folgejahres-/Dauerpreis**; der Bonus wird getrennt und transparent ausgewiesen. Bonus **nie** in die Haupt-Ersparnis mischen. Genau diese Ehrlichkeit ist das Alleinstellungsmerkmal gegenüber reinen Vergleichsseiten.

4. **Nur der Energiepreis ist vergleichbar.** Netzkosten, Steuern und Abgaben sind netzgebietsabhängig und für alle Lieferanten gleich — kein Anbieterwechsel senkt sie. Verglichen wird ausschließlich der **Energie-Anteil** des Lieferanten. Ein Nutzer, der versehentlich seinen Gesamtpreis einträgt, erzeugt eine Fantasie-Ersparnis; das muss die Engine **aktiv abfangen** (§5.3).

5. **COOLiN ist Software-/Informationsanbieter, nicht Energie-Vermittler.** Die eigentliche Vertragsabwicklung beim Wechsel läuft über einen externen, lizenzierten Partner. COOLiN verlinkt nur (mit Affiliate-Tracking). Diese regulatorische Grenze ist nicht verhandelbar.

6. **Der Nutzer soll den Monitor vergessen dürfen.** Kernwert des Abos ist passive Überwachung: einmal Daten eingeben, dann im Hintergrund laufen lassen, nur bei relevanter Ersparnis eine Mail bekommen. Kein Dashboard-Zwang, keine Interaktions-Erwartung. Das prägt UI-Umfang und Benachrichtigungslogik (§8, §9).

7. **Self-Service von Tag 1.** Alles, was pro Nutzer passiert — Registrierung, Zahlung, Dateneingabe, Einstellungen, Kündigung, Löschung — läuft ohne Eingreifen von Andreas/Martin. Die **einzige** laufende manuelle Pflicht des Teams ist, die Tarif-Tabelle korrekt/aktuell zu halten (zentral, einmal für alle — §7).

8. **KI an den Rändern, Determinismus im Kern.** KI ist zulässig für Aufgaben am Rand des Systems: Scraping-Extraktion (§7), Rechnungsscan (§5.2/T6), später natürlichsprachige Ergebnis-Erklärung. KI ist **ausgeschlossen** im Vergleichs-Rechenkern (`packages/tariff-monitor`, §3): gleiche Eingabe muss gleiche Zahl liefern, nachprüfbar und haftungssicher. Diese Grenze ist nicht verhandelbar.

---

## 2. Geschäftsmodell `[OFFEN-KOMMERZIELL]`

> **Bewusst offen gehalten.** Die genaue Monetarisierung ist im Bau nur ein **Entitlement-Gate**, kein Engine-Bestandteil. Ein späterer Wechsel zwischen „Abo", „gratis + Affiliate" oder „beidem" kostet praktisch nichts, solange §3 (Engine ist monetarisierungs-agnostisch) eingehalten wird. Die Marktfrage — zahlen genug Leute für einen anderswo gratis verfügbaren Vergleich? — klärt Andreas mit Martin. Sie blockiert den Bau **nicht**.

**Freemium-Grundstruktur (Arbeitsannahme, nicht final):**

| Stufe | Umfang | Kostentreiber für COOLiN |
|---|---|---|
| **Gratis** | Einmaliger/manueller Check. Nur die 4 Pflichtfelder (§5.1), manuelle Eingabe. Grobes, aber ehrliches Ergebnis + konkrete Alternativen. Momentaufnahme. | Faktisch null (nur Tabellenvergleich, **kein** KI-Scan). |
| **Abo (Arbeitsannahme 4,90 €/Monat)** | (a) **KI-Rechnungsscan** (Bequemlichkeit), (b) **Detailfelder** → präziser, auf Jahreskosten normalisierter Vergleich inkl. Bonus/Folgejahr, (c) **laufende Überwachung** (täglicher Cron + proaktive Benachrichtigung). | KI-API-Kosten (Scan) + Cron-Betrieb. |

**Zwei Differenzierungs-Achsen (bewusst gewählt):**
- **Genauigkeit:** Der Scan liefert nicht *per se* Genauigkeit — mehr **Felder** tun das. Der Scan ist nur der bequeme Weg, die Detailfelder zu füllen. Die Engine denkt „je mehr Felder, desto genau" (§5.1), **nicht** „wenn Scan, dann genau". Praktisch sind Scan und Detailfelder ans Abo gekoppelt, aber die Kopplung liegt im Entitlement-Layer, nicht in der Engine.
- **Automatisierung:** Der eigentliche verkaufte Mehrwert, den es gratis nirgends gibt — der Markt ändert sich, der Gratis-Nutzer weiß es nicht, der Abonnent wird informiert.

**Warum der KI-Scan hinter die Bezahlschranke gehört:** Er ist der einzige reale Pro-Nutzung-Kostentreiber (API). Die Bezahlgrenze läuft damit **entlang des tatsächlichen Kostentreibers** — sauber und selbsttragend.

**Zusätzliche Einnahmequelle (Bonus, NICHT Fundament):** Affiliate-Provision über einen Wechsel-Partner beim tatsächlichen Anbieterwechsel. Bewusst **nicht** als tragende Kalkulationsgrundlage, weil die Konditionen nicht in COOLiNs Kontrolle liegen (Partner kann Sätze einseitig ändern/kündigen). Falls Affiliate tragfähig wird, ist sogar denkbar, den Monitor **ganz gratis** zu machen — genau deshalb muss die Engine monetarisierungs-agnostisch bleiben (§3).

---

## 3. Architektur-Leitplanke: Monetarisierungs-agnostische Engine

**Die Engine weiß nichts von Abos.** Scraping, Vergleichslogik, Ersparnis-Berechnung und Benachrichtigungs-Formatierung sind frei von Abo-Wissen. Genau **zwei** Stellen entscheiden Kommerzielles, beide als Flag:

1. **`hasActiveMonitor` (Entitlement):** entscheidet, ob der tägliche Cron für einen Nutzer läuft und ob Scan/Detailfelder verfügbar sind.
2. **Affiliate-Flag:** entscheidet, ob an ein Ergebnis ein getrackter Wechsel-Link angehängt wird.

Beide sind Flags, keine Verzweigungen quer durch den Code. Konsequenz: „Monitor gratis machen" = ein Flag umlegen, kein Umbau. Die **grobe** (Gratis) vs. **normalisierte** (Abo) Berechnung wird über die vorhandene **Feld-Tiefe** gesteuert (§5.1), nicht über ein Abo-Flag — eine Detailfeld-Berechnung würde für einen Gratis-Nutzer identisch rechnen, wenn die Felder da wären. Die Kopplung „Detailfelder nur im Abo" lebt im Entitlement-/UI-Layer.

---

## 4. Systemarchitektur

### 4.1 Architektur-Entscheidungen (gesetzt)

- **Gleiches Monorepo**, kein separates Repo. Teilt die künftige Supabase-Auth/Entitlement-Infrastruktur (Multi-Abo-Container) mit dem Pro-Kalkulator.
- **Der Monitor ist der erste echte Anlass, die Portal-Schicht zu bauen**, die im Kalkulator bewusst geparkt wurde (Login, Entitlements, Self-Service, Stripe). Bewusste Konsequenz: **Mit dem Monitor entsteht das Fundament, auf dem später auch der Kalkulator-Portalteil sitzt.** Das ist der korrekte Moment dafür.
- **KEIN iframe.** Der iframe beim Pro-Kalkulator war eine bewusste, dataless/loginlose Übergangslösung (Altlast `apps/website`). Der Monitor hat Abo + Login von Anfang an — ein iframe würde Session/Auth/Stripe-Handoff über die Cross-Origin-Grenze zwingen. Unnötig, weil die native Lösung ohnehin für Phase 2 gebaut wird.
- **KEINE native Mobile-App.** `[ANNAHME]` Zwei zusätzliche Codebases, App-Store-Reviews, Push-Zertifikate — überdimensioniert für ein Zwei-Personen-Team bei einem Produkt, das im Kern „einmal eingeben, dann passiv Mails bekommen" ist. Eine **responsive Web-App** deckt 100 % ab. Push später via PWA oder schlicht Mail/SMS, ohne App.

### 4.2 Package- & Repo-Struktur

```
/packages/tariff-monitor   ← Scraping + Vergleichslogik + Normalisierung + Cron-Job (Herzstück)
/packages/shared           ← geteilte Typen/Konstanten (ggf. Erweiterung des bestehenden)
/apps/web (bzw. /apps/portal, künftig) ← UI-Route: Gratis-Check + eingeloggtes Dashboard
/supabase                  ← Schema, Migrations, RLS, Auth, Entitlements (erstmalig real gebaut)
```

Die **Website-Hülle** (Nav, Shop-Kacheln, Checkout-Einstieg, Produktseite) wird in der **Website-Session** gebaut, **nicht hier** — dort wird auch „Peak Shaving" zu „Produkte ▾" umbenannt (im Website-Pflichtenheft §4.2 vorgesehen, sobald mehrere echte Produkte existieren — das ist jetzt der Fall). **Diese Session baut Engine + Produktkonzept + eingeloggte Funktion.**

**Monitor-Arbeitsregeln (`CLAUDE.md`):** Die Monitor-spezifischen Repo-Regeln leben in **`packages/tariff-monitor/CLAUDE.md`** (entschieden 07/2026). Grund: Dort sitzt das Herzstück; CC lädt die `CLAUDE.md` des jeweiligen Arbeitsordners automatisch. Die UI-Route in `apps/web` fällt unter die dortige `apps/web/CLAUDE.md` (Website) plus diese Spec. **Namenskonvention (siehe `README_Doku-Struktur.md`):** im Repo heißt die Datei bare `CLAUDE.md` (eindeutig durch den Ordner), im claude.ai-Projektordner trägt sie den Suffix `CLAUDE_Monitor.md`. Bei jeder Änderung an dieser Zuordnung ist `README_Doku-Struktur.md` (Tabelle + Pflegehinweis) nachzuziehen.

### 4.3 Auth & Zahlung (gesetzt)

- **Supabase Auth** (passt zum geparkten Portal-Plan) + **Stripe** (Checkout + Subscription-Verwaltung).
- Entitlement (`hasActiveMonitor`) wird aus dem Stripe-Subscription-Status abgeleitet und in Supabase gespiegelt (Webhook-getrieben, damit der Cron-Job ohne Stripe-Live-Call entscheiden kann).
- **Auth-Entscheidungen (in T4-2 real gebaut):**
  - **Server Actions statt Client-SDK.** Sämtliche Auth-Vorgänge (Registrierung/Login/Logout/Reset) laufen als Server Actions bzw. Route Handler; **kein `createBrowserClient`**, kein Supabase-Artefakt im Client-Bundle. Die in T3 erreichte Eigenschaft „`.next/static` = 0 Supabase-Treffer" bleibt mit dem Login erhalten. Formulare sind echte `<form>`-Elemente mit Server Action.
  - **E-Mail-Bestätigung verpflichtend.** `enable_confirmations = true`: ein Konto mit unbestätigter Adresse kann sich nicht einloggen — das Produkt verkauft E-Mail-Benachrichtigungen (§8), eine unbestätigte Adresse wäre Post an Fremde + DSGVO-Problem. (Lokal Mailpit; Cloud: produktionstauglicher SMTP/Resend im Dashboard.)
  - **RPC-Wrapper statt Schema-Exposition.** `platform` bleibt aus der öffentlichen REST-API (`[api].schemas`) draußen; Server-Reads laufen ausschließlich über SECURITY-DEFINER-Wrapper im `public`-Schema (`get_my_entitlement`/`get_my_profile`), einzeln an `authenticated` gegrantet, nie an `anon`. Die Entitlement-Anzeige kennt kein Stripe und keine `subscriptions`-Tabelle — nur den Wrapper (§3, genau zwei kommerzielle Flags).

### 4.4 Supabase-Struktur (gesetzt, in T2 real gebaut)

- **EIN Supabase-Projekt für die gesamte COOLiN-Plattform** (Organisation „CoolIn"), Region **EU/Frankfurt** (DSGVO, österreichische Nutzer). Kein separates Projekt je Produkt.
- **Produkt-Trennung über eigene Postgres-Schemas** innerhalb dieses einen Projekts, nicht über getrennte Projekte. Aktuell: Schema `monitor` (Tarif-Zeitreihe + Scraper-Betriebstabellen, §7) **und Schema `platform`** (geteiltes Auth-/Rollen-/Entitlement-/Stripe-Spiegel-Fundament, seit **T4-1** real gebaut — trägt Monitor UND künftigen Kalkulator-Portalteil). `platform` liegt bewusst getrennt von den Produkt-Schemas: ein Produkt-Schema darf nie eine Abhängigkeit des geteilten Fundaments werden (Abhängigkeitsrichtung immer Produkt → Fundament, nie umgekehrt). Ggf. weitere Produkt-Schemas später (Kalkulator-Portalteil).
- **`platform` wird bewusst NICHT in `[api].schemas` exponiert** (anders als das öffentliche `monitor`). Diese Tabellen tragen personenbezogene Auth-/Zahlungs-Spiegel und werden ausschließlich von Server-Code (service_role bzw. RLS-geschützte Reads) gelesen — nie über die öffentliche REST-API mit anon-Key. Transport-Ebenen-Schutz zusätzlich zu RLS.
- **Begründung:** Monitor und Kalkulator-Portalteil teilen Auth/Entitlements/Stripe (§4.1, Multi-Abo-Container). Getrennte Projekte würden diesen geteilten Container zerreißen — getrennte User-Tabellen, getrennte Logins, kein gemeinsames Konto über beide Produkte hinweg.
- **Env-Konvention:** server-only Supabase-Zugriff läuft über **nicht-präfixte** Variablen (`SUPABASE_URL`/`SUPABASE_ANON_KEY`); `NEXT_PUBLIC_SUPABASE_*` bleibt für das künftige client-seitige Auth-SDK (T4) reserviert. Ein nicht-präfixter Name kann strukturell nicht ins Client-Bundle lecken (Next.js ersetzt nur `NEXT_PUBLIC_*` textuell beim Build).

---

## 5. Datenmodell & Onboarding

### 5.1 Dreistufige Feld-Tiefe

Der Vergleich braucht ein garantiertes Minimum, sonst rechnet er Unsinn. „Je mehr desto besser" gilt für die Genauigkeit, **nicht** für das Minimum.

**Stufe 1 — Gratis-Pflichtfelder (4, ohne diese kein Vergleich):**
- Jahresverbrauch (kWh)
- Aktueller **Energie-Arbeitspreis** (ct/kWh) — nur Lieferantenanteil, **nicht** Gesamtpreis (§1 Prinzip 4, §5.3)
- Grundgebühr (€/Monat oder €/Jahr)
- PLZ (→ Netzgebiet)

→ grober, ehrlicher Vergleich. Kennt keinen Bonus → gibt Dauerpreis-Näherung. Der Gratis-Check weist offen aus: *„grobe Schätzung; für die genaue Berechnung inkl. Wechselbonus und Folgejahr → Abo."* (ehrliche Einschränkung, zugleich bester Abo-Verkaufstext).

**Stufe 2 — Abo-Detailfelder (präziser, normalisierter Vergleich):**
- Anbieter + Tarifname (exaktes Matching gegen Scraping-Tabelle, saubere „du bist bei X"-Anzeige)
- Bonus (Betrag + Bedingung + Gültigkeit erstes Jahr)
- Preisgarantie-Dauer
- Vertragsbindung / Kündigungsfrist
- Abrechnungsmodus (monatlich/jährlich)
- Ökostrom ja/nein
- optional: Zählpunkt/Netzgebiet exakt

**Stufe 3 — KI-Rechnungsscan (Abo-exklusiv):** die bequeme Methode, Stufe 2 zu füllen. Kostentreiber → hinter Bezahlschranke.

### 5.2 Ein Formular, zwei Füllwege

Es gibt **genau ein** Formular. Manuell = leer starten. Scan = vorausgefüllt starten. Danach ist der Zustand identisch — kein Sonderpfad. Beide münden in dieselbe Bestätigungs-Ansicht (analog zum Mapping-Confirmation-Muster des Pro-Kalkulators).

**KI-Extraktion (server-seitig, gesetzt):**
- Rechnung → Backend → Claude API (Vision). **API-Key nie im Browser.**
- Das Rechnungsbild wird **nicht gespeichert**, nur die **bestätigten Felder** (§10 DSGVO). Bewusste, dokumentierte Abkehr vom dataless-Prinzip des Kalkulators — beim Monitor ohnehin unvermeidbar (Abo + Login + laufende Speicherung), aber als Entscheidung festgehalten, nicht als Versehen.
- **Konfidenz pro Feld:** Die KI liefert je Feld ein „sicher/unsicher". Unsichere Felder werden im vorausgefüllten Formular **markiert** (z. B. gelb, „bitte prüfen"). Sonst nickt der Nutzer einen falschen Scan durch — schlimmer als kein Scan.
- **Scan → KI schlägt vor → Nutzer bestätigt/korrigiert.** Der Scan ersetzt die Bestätigung nie.

### 5.3 Plausibilitäts-Automatik (gestuft)

Fängt den häufigsten und gefährlichsten Fehler ab (Energiepreis ≠ Gesamtpreis, §1 Prinzip 4):

1. **Range-Check:** Energiepreis außerhalb ~5–40 ct/kWh → Warnung. `[MARTIN]` Grenzwerte marktrealistisch bestätigen.
2. **Gesamtpreis-Verdacht:** Eingegebener Preis liegt im typischen Brutto-Gesamt-Band (~25–35 ct), obwohl Energiepreis gefragt war → gezielte Warnung: „Das sieht nach dem Gesamtpreis inkl. Netz und Steuern aus — wir brauchen nur den Energiepreis deines Lieferanten."
3. **Abgleich gegen Scraping-Tabelle:** Nutzer gibt Anbieter + Tarifname an, wir kennen den Tarif → Vergleich eingegebener Preis vs. hinterlegter Preis. Abweichung → Flag. Stärkster Check, prüft gegen echte Daten.
4. **Rechnungs-Rückrechnung (nur Scan):** Die KI extrahiert **zusätzlich den Gesamt-Rechnungsbetrag** — nicht zur Anzeige, sondern zur **Selbstvalidierung**: passt `Energiepreis × Verbrauch + Grundgebühr + geschätzte Netzkosten + Steuern` ≈ ausgewiesener Gesamtbetrag? Wenn nicht, hat die KI falsch extrahiert → Feld als unsicher markieren.

### 5.4 Tarif als Kosten-Objekt (Normalisierung)

Ein Tarif ist **kein** einzelner Preis, sondern ein Kosten-Objekt. Alles wird auf **Jahreskosten** normalisiert, sonst ist nichts vergleichbar. Das ist die eigentliche Komplexität der Engine — nicht das Scraping.

Felder je Tarif: Arbeitspreis (ct/kWh), Grundgebühr (€/Jahr), Bonus (Betrag + Bedingung + Gültigkeit 1. Jahr), Preisgarantie-Dauer, Bindung/Kündigungsfrist, Abrechnung (monatlich/jährlich), Ökostrom (bool).

Ausgabe je Vergleich: **Erstjahres-Kosten** (mit Bonus) und **Folgejahres-/Dauerkosten** (ohne Bonus). Headline-Ersparnis = Dauerpreis-Differenz; Bonus separat ausgewiesen (§1 Prinzip 3).

**Preisgarantie und Bindung werden mitgeführt UND angezeigt** (gesetzt) — ein 2 ct billigerer Tarif ohne Garantie neben einem mit 12-Monats-Garantie ist relevante Info und kostet nur ein Feld. Zurückhalten wäre die halbe Wahrheit.

---

## 6. Nutzer-Flow

1. Nutzer kommt über `coolin.at` auf die Monitor-Produktseite (Website-Session).
2. **Gratis-Check VOR Login.** Daten eingeben (manuell), sofort Ergebnis + konkrete Alternativen. Kein Konto nötig — Reichweiten-Hebel.
3. **Wiederkehrer:** Der Gratis-Check speichert **lokal im Browser** (localStorage, clientseitig, DSGVO-unkritisch, verlässt das Gerät nie). Rückkehrer sehen ihre letzte Eingabe vorausgefüllt: *„Willkommen zurück — dein Tarif von letztem Mal ist noch da, neu vergleichen?"* Kein serverseitiges Tracking, keine Löschung, kein Zwang. Bequemlichkeit als Köder (§1 Prinzip 2). Der wiederholte Selbst-Check ist zugleich der natürliche Abo-Aufhänger: *„Du checkst regelmäßig selbst — lass das uns automatisch machen."*
4. **Will laufende Überwachung → Registrierung + Abo** (Stripe Checkout). Erst hier entsteht ein Konto.
5. **Datenübernahme:** Die im Gratis-Check eingegebenen Daten wandern ins Konto. Der Nutzer landet **nicht** vor einem leeren Formular — das würde Arbeit statt Wert fühlbar machen.
6. **Ab jetzt:** täglicher Cron vergleicht den gespeicherten Tarif gegen die Tarif-Tabelle, benachrichtigt bei Überschreiten **der individuell eingestellten** Schwelle (§8).

**Gratis-Check-Rate-Limit:** Kein IP-Tracking zur Sperre (§1 Prinzip 2). Nur ein technisches **Rate-Limit auf den KI-Scan-Endpunkt** gegen automatisierten Massenmissbrauch (API-Kostenschutz) — das ist der einzige teure Endpunkt, und im Gratis-Check ohnehin nicht verfügbar; das Limit greift also v. a. serverseitig als Missbrauchsbremse.

---

## 7. Datenquelle & Scraping

> **Die Datenquelle ist kein offener Punkt — sie IST das Produkt.** Ohne Vergleichsdaten kein Monitor. Deshalb baut das Produkt auf dem einen Weg, der **nicht** auf Partnerantworten wartet: eigenes kuratiertes Scraping.

**Ausgeschlossen:** E-Control Tarifkalkulator — deren Nutzungsbedingungen verbieten die Weitergabe der Daten an Dritte explizit (auch als Webservice).

**Affiliate-Partner (separate Spur, betrifft nur das Wechsel-Backend, nicht den Kern):**
- **Durchblicker.at** — etabliertes Affiliate-Programm, aber nur Link/Widget-basiert (Provision pro Abschluss), **keine Rohdaten-API**. Provisionssätze nicht öffentlich → direkt anfragen. AGB erlauben einseitige Anpassung.
- **tarife.at** (Geizhals) — kein öffentliches Partnerprogramm gefunden, deckt aber **Haushalts- UND Gewerbestrom** ab → potenziell **ein** Partner für beide COOLiN-Zielgruppen. Noch nicht kontaktiert.

**Kern-Datenweg: kuratiertes Scraping der Top 15–20 Anbieter.** Nicht alle ~350 (unrealistisch für ein Zweier-Team). Die größten (Wien Energie, Verbund, EVN, Salzburg AG, TIWAG, KELAG, Energie Graz, oekostrom, aWATTar, …) decken die überwiegende Mehrheit der Haushalte ab — ausreichend für den Sensibilisierungszweck.

**Scraping-Design:**
- **Zentral einmal täglich** scrapen → eigene Tarif-Tabelle → **alle** Nutzer dagegen vergleichen (nicht pro Nutzer live). Billiger, schonender gegenüber Anbieter-Sites, macht den Gratis-Check sofort schnell. Tägliche Kadenz fängt die Obergrenze der realen Änderungsrate (täglich–monatlich, unregelmäßig).
- **Historisierend, nicht überschreibend.** Die Tarif-Tabelle ist eine **Zeitreihe**. Grund: die spätere Tarifentwicklungs-Kurve (§9, `[v2]`) lässt sich nur nachbauen, wenn ab Tag 1 historisiert wird. Wichtige Architektur-Entscheidung, jetzt festgelegt, obwohl die Anzeige später kommt.
- **Abdeckungs-Grenze:** Neue Tarife der Top 15–20 werden beim nächsten Lauf automatisch erfasst. Ein brandneuer Tarif eines **nicht** gelisteten Anbieters wird nicht erfasst — bewusst akzeptiert. **Disclaimer sichtbar:** wir vergleichen die größten Anbieter, nicht den kompletten Markt. Sonst haften wir für Vollständigkeit, die wir nicht liefern.

**Extraktions-Methode (gesetzt, bisher offener Punkt):**
- **KI-gestützte Extraktion ist der Default („Weg C").** Der Scraper lädt die Anbieterseite und lässt ein LLM (Claude API) die Tarif-Werte extrahieren — **keine** handgeschriebenen CSS-Selektoren pro Anbieter als Regelfall.
- **Optionaler Override:** `monitor.scrape_targets.extraction_config` (jsonb) kann bei Bedarf eine präzise Extraktions-Regel hinterlegen, die dann Vorrang hat. Das ist die Ausnahme für Problemfälle, nicht der Regelfall.
- **Zweck:** maximaler Admin-Selfservice — ein neuer Anbieter ist per URL-Eingabe einrichtbar, ohne Entwickler-Einsatz pro Anbieter.
- **Ehrliche Grenze:** Anbieter, die Preise erst nach Formular-Interaktion oder per JavaScript ausliefern, brauchen weiterhin technische Nacharbeit. Die KI nimmt die Selektor-Arbeit für den Normalfall ab, macht das Scraping aber nicht wartungsfrei.
- **Plausibilitätspflicht:** KI-extrahierte Werte laufen durch dieselbe Plausibilitäts-Automatik (§5.3) und die `scrape_runs`-Alert-Logik wie jeder andere Wert — nie ungeprüft live.

**Admin-Selfservice (Zielbild, gebaut mit T4):**
- Andreas verwaltet über das Admin-UI: Anbieter anlegen/deaktivieren, `tariff_page_url`, Netzgebiet, Logo, Sortierpriorität, Notizen.
- „Extraktion jetzt testen"-Funktion: zeigt vor Freigabe, was die KI aus der Seite zieht.
- Extrahierte Werte ansehen/korrigieren/bestätigen vor Live-Schaltung (dasselbe Muster wie §5.2: KI schlägt vor, Mensch bestätigt — nie blind übernehmen).
- Scrape-Status/Alerts aus `monitor.scrape_runs` einsehbar (welcher Anbieter liefert nichts).
- `extraction_config`-Override einsehbar/editierbar (technischer Ausnahmefall, s. o.).
- **Zeitpunkt:** Das Admin-UI wird **mit T4** gebaut, nicht vorher — es braucht Auth, und ein vorgezogenes Sonder-Login wäre Wegwerf-Auth neben dem geteilten T4-Container (§4.4). Übergangsweise pflegt Andreas Targets direkt in Supabase Studio.

`[MARTIN/RECHT]` **Scraping-ToS-Risiko vor Bau kurz mit Martin/Anwalt gegenchecken.** Kein Blocker, aber nicht ignorieren.

`[ANNAHME]` **Wartung der Tarif-Tabelle ist die einzige laufende manuelle Team-Pflicht** (§1 Prinzip 7). Jeder Anbieter = eigene Website-Struktur → Scraper brechen bei Redesigns. Robustheits-/Alarmierungs-Mechanismus (Scraper liefert 0 Tarife oder unplausible Werte → Team-Alert) einplanen.

---

## 8. Benachrichtigung

- **Auslöse-Schwelle: in € pro Jahr UND in %**, nicht nur %. 10 % auf kleiner Rechnung sind irrelevant, 5 % auf großer viel. Default z. B. „ab 50 €/Jahr **oder** 10 %". Nutzer-einstellbar (§9).
- **Frequenz-Deckel:** höchstens X Benachrichtigungen pro Zeitraum (z. B. max. 1 / 14 Tage, außer die Ersparnis steigt deutlich). Löst das Spam-Problem („niemand will täglich 0,50 €-Mails").
- **Bindungs-bewusstes Benachrichtigen:** Ist der Nutzer noch in Vertragsbindung, meldet der Monitor sich **dann**, wenn er wirklich wechseln **kann** (bzw. rechtzeitig vor Kündigungsfrist). Verhindert Frust-Mails über nicht hebbare Ersparnisse — und hebt den Monitor von dummen Vergleichsseiten ab.
- **Kanal:** E-Mail zuerst. SMS/Push `[v2]`.

---

## 9. Self-Service-Portal (eingeloggter Bereich)

Alles ohne Team-Eingriff (§1 Prinzip 7). Einstellbar:

- **Auslöse-Schwelle** (€/Jahr und %, §8).
- **Benachrichtigungs-Frequenz-Deckel** (§8).
- **Eigene Tarifdaten bearbeiten** (Verbrauch, Preis, Anbieter). Kritisch: Nach einem Wechsel muss der Nutzer seinen **neuen** Tarif hinterlegen, sonst vergleicht der Monitor gegen Vergangenes.
- **Vergleichs-Präferenzen / Filter:** nur Ökostrom? keine Vorauskasse/Kaution? maximale Vertragsbindung? — bestimmt, **welche** Alternativen überhaupt als „besser" gelten. Sonst empfiehlt der Monitor Tarife, die der Nutzer aus Prinzip nie nähme → Vertrauensverlust.
- **Pausieren / Bindungs-Datum:** „in Bindung bis Monat X → erst dann benachrichtigen" (§8).
- **Benachrichtigungskanal** (E-Mail; später SMS/Push).
- **Konto/Abo-Verwaltung:** Abo kündigen, Rechnungen einsehen (Stripe-Portal), **Daten löschen** (DSGVO, §10) — alles self-service.

**Dashboard-Umfang bewusst schlank** (§1 Prinzip 6). Kein Dashboard um des Dashboards willen.

`[v2]` **Tarifentwicklungs-Chart:** eigener Tarif vs. Marktdurchschnitt/bester Tarif über Zeit — visualisiert „die Schere geht auf", stärker als jede Zahl. Braucht die historisierte Zeitreihe (§7), wird erst über Wochen/Monate aussagekräftig. **Datenbasis ab Tag 1 sammeln, Anzeige später.** Weitere Dashboards vorerst bewusst weglassen.

---

## 10. DSGVO & Datenschutz

Anders als der dataless Pro-Kalkulator speichert der Monitor **personenbezogene, laufend gespeicherte** Verbrauchs-/Vertragsdaten. Früh mitgedacht, nicht nachgerüstet.

- **Rechnungsbild wird NICHT gespeichert** (§5.2) — nur zur Extraktion durchgereicht, dann verworfen. Nur bestätigte Felder werden persistiert. Entschärft die Sensibilität erheblich (Rechnung enthält Name, Adresse, Zählpunkt, teils Bankdaten).
- **Gratis-Check speichert clientseitig** (localStorage) — verlässt das Gerät nie, kein serverseitiges personenbezogenes Datum.
- **Kein IP-Tracking zur Verhaltenssperre** (§1 Prinzip 2, §6). IP nur flüchtig für technisches Rate-Limit des Scan-Endpunkts, nicht zur Profilbildung gespeichert.
- **Löschkonzept self-service** (§9): Nutzer löscht Konto + alle personenbezogenen Daten selbst.
- **Zweckbindung & Einwilligung** beim Abo-Onboarding (gespeicherte Vertragsdaten, Zweck Überwachung/Benachrichtigung). Einwilligung versioniert.

`[RECHT]` Datenschutzerklärung, Einwilligungstext, Aufbewahrungsfristen, AV-Vertrag mit Anthropic (KI-Scan als Auftragsverarbeitung) vor Livegang final klären.

---

## 11. Was NICHT in der ersten Ausbaustufe ist

`[v2]`, architektonisch vorzusehen, jetzt nicht gebaut:
- Native Mobile-App (§4.1 — bewusst dauerhaft verworfen, nicht nur verschoben).
- SMS/Push-Benachrichtigung (E-Mail zuerst).
- Tarifentwicklungs-Chart & weitere Dashboards (Datenbasis aber ab Tag 1 sammeln, §9).
- Rohdaten-API-Partnerschaft für den Vergleich (falls je verfügbar; Kern bleibt eigenes Scraping).
- Scraping-Abdeckung über die Top 15–20 hinaus.
- Cross-Sell-Automatik Monitor → Pro-Kalkulator (Funnel manuell/später).

---

## 12. Offene Punkte

| # | Punkt | Owner | Blockiert |
|---|---|---|---|
| 1 | `[OFFEN-KOMMERZIELL]` Abo-Preis & Modell final: reines Abo vs. gratis+Affiliate vs. beides. Zahlungsbereitschaft am Markt validieren. | Andreas/Martin | **Nichts am Bau** — nur das Entitlement-Flag (§3). |
| 2 | Datenpartner-Antworten einholen: Durchblicker **und** tarife.at anschreiben — (a) tatsächliche Provisionssätze Strom-Wechsel Haushalt, (b) Gewerbestrom ebenfalls möglich?, (c) Deep-Links zu konkretem Tarif technisch machbar? | Andreas | Nur Affiliate-Backend, nicht den Kern. |
| 3 | Scraping-ToS-Risiko Top 15–20 gegenchecken. | Martin/Recht | Kein Blocker, vor Bau kurz klären (§7). |
| 4 | Plausibilitäts-Grenzwerte (Energiepreis-Range, Gesamtpreis-Band) marktrealistisch bestätigen. | Martin | Genauigkeit der Abfang-Logik (§5.3). |
| 5 | Netzkosten-Schätzung je Netzgebiet für Rechnungs-Rückrechnung (§5.3 Stufe 4). | Martin | Selbstvalidierung des Scans. |
| 6 | Konkrete Liste der Top 15–20 Anbieter + jeweilige Tarif-Seiten-URLs (Scraper-Targets). Wird künftig über das Admin-UI gepflegt (§7, ab T4), nicht im Code — die Liste blockiert den Scraper-**Bau**, nicht die Datenstruktur (`monitor.scrape_targets` steht bereits, T2). | Andreas/Martin | Scraper-Bau. |
| 7 | DSGVO-Paket: Datenschutzerklärung, Einwilligung, Aufbewahrung, AV-Vertrag Anthropic (KI-Scan). | Recht | Livegang, nicht Bau (§10). |
| 8 | Regulatorische Bestätigung: COOLiN als reiner Software-/Info-Anbieter, Wechselabwicklung ausschließlich über Partner. | Martin/Recht | Affiliate-Livegang (§1 Prinzip 5). |
| 9 | Die getrennte Bonus-Zeile im Ergebnis (§1.3) konnte mit den Seed-Platzhalter-Tarifen (T3) nicht live durchgespielt werden — jeder Bonus-Tarif ist dort beim Dauerpreis strukturell dominiert. Bei echten Tarifdaten (§12 #6) gegenprüfen. | Andreas/Martin (liefert echte Daten) | Nichts am Bau — reine Verifikation. |
| 10 | Zwei offene technische Detailfragen aus T1: (a) `billingCycle`-Effekt auf die Jahressumme (aktuell bewusst ohne Verrechnung); (b) Plausibilitäts-Stufe 4 misst die Abweichung relativ zum beobachteten Rechnungsbetrag, nicht zum erwarteten Wert — bei der T6-Verdrahtung bewusst bestätigen, ob das weiterhin die richtige Bezugsgröße ist. | Team | (a) eine künftige unterjährige Abschlagslogik, (b) T6 (KI-Rechnungsscan). |

---

## 13. Baureihenfolge

Wir bauen auf die **finale Lösung** hin (Entscheidung Andreas), nicht auf einen MVP; der Demo-/MVP-Schnitt wird separat entschieden. Engine zuerst und getestet (Muster aus dem Kalkulator: Logik + Fixtures vor UI-Verdrahtung), UI als paralleler Track gegen einen stabilen Output-Contract.

1. **T1 — Tarif-Engine** (`/packages/tariff-monitor`): Kosten-Objekt-Typen, Normalisierung auf Jahreskosten (inkl. Bonus/Folgejahr-Trennung), Vergleichslogik mit Präferenz-Filtern, Plausibilitäts-Automatik (§5.3). Rein & getestet gegen Fixtures. **ABGESCHLOSSEN** (Normalisierung, Vergleich mit Präferenz-Filtern, Plausibilität Stufen 1–4 mit Dependency Injection, integriertes T1-Gate; 62 Tests).
2. **T2 — Scraper + historisierende Tarif-Tabelle** (§7): Top-15–20-Scraper, tägliche Kadenz, Zeitreihen-Schema, Robustheits-Alerts. Supabase-Schema für Tarife. **Datenschicht ABGESCHLOSSEN** (`monitor.tariff_snapshots` historisierend/append-only, `monitor.current_tariffs`, `monitor.scrape_targets`, `monitor.scrape_runs`, RLS/Least-Privilege). **Scraper-Hälfte (Extraktionscode, §7) OFFEN** — blockiert auf §12 #6 (Anbieterliste) + §12 #3 (ToS-Check).
3. **T3 — Gratis-Check-UI** (client-side, kein Login, localStorage-Merken, §6). Nutzt T1 gegen T2-Tabelle. **ABGESCHLOSSEN** (Route `/strom-check` in `apps/web`, `noindex`; Server liest `current_tariffs` mit 1-Tag-ISR, Vergleich läuft vollständig client-seitig, Eingabe verlässt das Gerät nie — §10, gemessen: 0 Netzwerk-Requests beim Absenden; Plausi-Warnungen, Dauerpreis-Headline mit Bonus strikt getrennt, Abo-Teaser mittlerer Prominenz ohne Festpreis; produktive Randfälle wie leere/nicht erreichbare Tarif-Tabelle und Rückkehrer-UX gehärtet).
4. **T4 — Auth + Stripe + Entitlements** (§4.3): erstes echtes Portal-Fundament (geteilt mit künftigem Kalkulator-Portal). `hasActiveMonitor` aus Stripe-Webhook. In **vier Teile** geschnitten:
   - **T4-1 Schema — ABGESCHLOSSEN:** Postgres-Schema `platform` (profiles/customers/subscriptions/entitlements/stripe_events/user_roles), RLS/Grants/Trigger (Entitlement-Ableitung + Out-of-order-/Append-only-/Idempotenz-Schutz), Funktionen `is_admin`/`has_entitlement` — plus ein ausführbares **DB-Gate** (`packages/db-tests`, Invarianten I1–I10 gegen den lokalen Stack) und ein separater CI-Workflow (`db-gate.yml`). REIN Datenbank.
   - **T4-2 Auth — ABGESCHLOSSEN:** Supabase-Auth in `apps/web` (Registrierung + E-Mail-Bestätigung, Login, Logout, Passwort-Reset self-service, server-geschützte Kontoseite) über **Server Actions** (kein Client-SDK, kein Supabase im Client-Bundle), `@supabase/ssr`-Server-Clients, Middleware komponiert next-intl + Session-Refresh. Zugriff auf `platform` nur über public-RPC-Wrapper (`get_my_entitlement`/`get_my_profile`, authenticated-only). Zentrale zod-Env-Validierung (server/client getrennt). Plus 0a-Fail-open-Constraint auf `entitlements`. 12/12 E2E-Flows + 21/21 DB-Gate grün.
   - **T4-3 Stripe:** Checkout + Webhook-Handler (schreibt `platform.subscriptions`/`stripe_events`; die Entitlement-Zeile leitet der DB-Trigger ab, nicht der Handler).
   - **T4-4 Admin-UI:** Scraper-Targets (§7) + Nutzer-/Rollenverwaltung, braucht denselben Auth-Container.

   Die Scraper-Restarbeit (T2) wartet auf externe Zulieferung (§12 #6/#3) und blockiert T4 nicht.
5. **T5 — Eingeloggtes Dashboard + Self-Service** (§9): Datenübernahme aus Gratis-Check, Einstellungen, Konto/Löschung.
6. **T6 — KI-Rechnungsscan** (server-side, Claude API, Konfidenz-Flags, §5.2): Abo-exklusiv.
7. **T7 — Cron + Benachrichtigung** (§8): täglicher Vergleich je Abonnent, Schwellen-/Frequenz-/Bindungslogik, E-Mail.

Reihenfolge innerhalb T1: Logik zuerst, testbar, dann UI. T1–T7 sonst so parallel wie möglich gegen den Output-Contract.

---

## 14. Akzeptanzkriterien (Definition of Done)

- Die Engine normalisiert zwei reale Beispiel-Tarife korrekt auf Jahreskosten und trennt Bonus (Erstjahr) sauber vom Dauerpreis; Headline-Ersparnis basiert auf dem Dauerpreis.
- Die Plausibilitäts-Automatik fängt einen als Energiepreis eingetragenen Gesamtpreis (~28 ct) ab und warnt gezielt.
- Der KI-Scan liefert je Feld ein Konfidenz-Flag; die Rechnungs-Rückrechnung erkennt eine widersprüchliche Extraktion.
- Der Gratis-Check läuft ohne Login, ohne Server-Persistenz der Verbrauchsdaten, merkt die letzte Eingabe clientseitig und zeigt konkrete Alternativen + Mehrheitsabdeckungs-Disclaimer.
- Der Scraper füllt die historisierende Tarif-Tabelle (Zeitreihe, nicht überschreibend) und alarmiert bei 0/unplausiblen Ergebnissen.
- Registrierung, Abo (Stripe), Datenübernahme aus dem Gratis-Check, alle Einstellungen aus §9 sowie Kündigung und Datenlöschung funktionieren vollständig self-service.
- Der Cron benachrichtigt einen Test-Abonnenten nur bei Überschreiten seiner individuellen Schwelle, respektiert den Frequenz-Deckel und das Bindungs-Datum.
- Die Engine enthält **kein** Abo-Wissen; `hasActiveMonitor` und Affiliate sind die einzigen zwei kommerziellen Flags (§3).

---

## 15. Session-Handover-Notiz

*Für nahtlose Fortsetzung, falls das Kontextfenster einer Session voll wird oder die Implementierung in einer neuen Session startet:*

- **Diese Session** hat das Produktkonzept vollständig durchdiskutiert und dieses Pflichtenheft erzeugt. **Noch kein Code, noch kein CC-Prompt.**
- **Drei Sessions, ein Repo:** Website (Marketing/`coolin.at`), Kalkulator (Pro-Kalkulator Fine-Tuning), Monitor (dieses Dokument). Jede mit eigener Doku pro Bauabschnitt. Bei Änderungen an geteilter Infrastruktur (Supabase-Auth/Entitlements/Stripe) müssen Monitor- und Kalkulator-Doku synchron gehalten werden — der Monitor baut dieses Fundament **erstmals real**.
- **Doku-Struktur & Namenskonvention:** `README_Doku-Struktur.md` ist das Register aller Doku-Dateien und ihrer Repo-Entsprechungen. Repo: bare `CLAUDE.md` je Ordner (Root = Kalkulator, `apps/web/` = Website, `packages/tariff-monitor/` = Monitor). Projektordner: Suffix-Namen (`CLAUDE_Monitor.md` etc.). **Bei jeder strukturellen Doku-Änderung `README_Doku-Struktur.md` mitpflegen** (Tabelle + Pflegehinweis) — der Monitor-Repo-Ort ist jetzt entschieden (`packages/tariff-monitor/`) und dort nachzutragen.
- **Nächster Schritt (Implementierung):** neue Session, beginnend mit T1 (Tarif-Engine, §13). Dieses Pflichtenheft ist die kanonische Spec; `CLAUDE.md` hält die Repo-Regeln.
- **Kernentscheidungen, die nicht neu diskutiert werden müssen** (alle mit Begründung oben): monetarisierungs-agnostische Engine (§3); ehrlich grob statt bewusst ungenau (§1.1); Dauerpreis-Headline + Bonus separat (§1.3); nur Energiepreis vergleichen (§1.4); kuratiertes Scraping Top 15–20, zentral täglich, historisierend (§7); ein Formular / zwei Füllwege / KI-Scan server-side mit Konfidenz-Flags (§5.2); kein iframe, keine native App (§4.1); Supabase Auth + Stripe (§4.3); Self-Service komplett, Tarif-Tabellen-Wartung als einzige Team-Pflicht (§1.7); kein IP-Tracking, kein Formular-Löschen zur Zermürbung (§1.2, §6).
- **Bewusst offen (blockiert Bau nicht):** Abo-Modell final (§12 #1), Datenpartner-Antworten (§12 #2).

---

*Änderungen an diesem Pflichtenheft werden versioniert. Diese Fassung ist das Ergebnis der strategischen Advisor-Session; alle `[ANNAHME]`-Punkte sind vor Livegang zu bestätigen, die offenen Punkte (§12) sind die realen Blocker für den Livegang — nicht der Code. Kommerzielle Entscheidungen (§2) sind bewusst offen und dank §3 ohne Umbau nachziehbar.*
