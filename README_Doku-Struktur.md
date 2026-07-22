# Doku-Struktur — Fakten & aktueller Stand

## Oberste Quelle: `Fahrplan_2026.md`

Seit 20.07.2026 ist **`Fahrplan_2026.md`** (Repo-Root) die kanonische Quelle für Reihenfolge, Umfang und Begründung aller Bauabschnitte — bei Widerspruch zu einem Pflichtenheft gilt diese Datei. Der Haushalts-Tarifmonitor (Dokumente unten mit „RUHEND" markiert) ist eingestellt; Details und die neue Bauabschnitts-Nummerierung (B0–B15) stehen dort.

**Session-Einstieg, in dieser Reihenfolge:** `Fahrplan_2026.md` → diese Datei (Landkarte) → die `CLAUDE.md` der betroffenen App → `DEPLOYMENT.md`.

## Aktuelle Dateien in diesem claude.ai-Projektordner

- `CLAUDE_Website.md` — Arbeitsregeln Website
- `Pflichtenheft_Website_Coolin.md` — Detaildokument Website. **Seit 21.07.2026: §15 „Lead- und Einwilligungsverwaltung (Bauabschnitt B1)"** — Datenmodell in fachlicher Sprache, die drei Einwilligungszwecke und die Double-Opt-in-Regel, die drei Einwilligungstexte im Wortlaut (Arbeitsstand, juristisch ungeprüft), Abmeldung und Sperrliste, Aufbewahrungsfristen und Anonymisierung, Grenzen des Admin-Bereichs, offene rechtliche Punkte. **Neu seit 24.07.2026 vier weitere Kapitel im selben Stil:**
  - **§16 „Erfassungsstellen und Segmentierung" (B3-1/B3-2/B3-4)** — ein Backend mit vielen kontextspezifischen Einstiegspunkten; der Zweck einer Einwilligung kommt ausschließlich aus der Registry, nie vom Client; welche Einstiegspunkte platziert sind und welcher bewusst nicht (Betroffenheits-Check); die Segmentierungsmerkmale und was die Anonymisierung von ihnen entfernt; die zwei Zusammenführungsregeln; Warteliste und gedruckter QR-Zugang; Vorname/Nachname getrennt.
  - **§17 „Zeitgesteuerte Vorgänge" (B4-1/B4-2)** — die zwei täglichen Läufe, die Protokollpflicht auch für den leeren und den verweigerten Lauf, die Mengenbegrenzung mit Verweigerung statt Abschneiden, die Vertragsablauf-Erinnerung ohne Angebot.
  - **§18 „Bestandspflege und Ausfuhr" (B2-1)** — neun korrigierbare Felder, die E-Mail-Adresse ausdrücklich nicht darunter; Zweckbindung bei Versorger und Vertragsende; die filtergebundene, protokollierte Ausfuhr, die kein Versandweg ist.
  - **§19 „Rückläufer und Beschwerden" (B2-2)** — Beschwerde widerruft, Rückläufer sperrt nur, vorübergehender Rückläufer tut nichts; kein Öffnungs- und kein Klick-Tracking, dauerhaft; keine Entsperrmöglichkeit.

  **Alle Kapitel bewusst ohne Schema-Details** — geschrieben für die Beurteilung durch Fachfremde ohne Repo-Zugang; die Wahrheit über das Schema liegt in `supabase/migrations/` und `packages/db-tests/`.
- `CLAUDE_PEAKSHAVING.md` — Arbeitsregeln Kalkulator
- `Pflichtenheft_Kalkulator_MVP.md` — Detaildokument Kalkulator
- `DESIGN.md` — Design-Tokens Kalkulator
- `CLAUDE_Monitor.md` — Arbeitsregeln Monitor **(RUHEND seit 20.07.2026, s. `Fahrplan_2026.md`)**
- `Pflichtenheft_Monitor_MVP.md` — Detaildokument Monitor **(RUHEND seit 20.07.2026, s. `Fahrplan_2026.md`)**
- `DEPLOYMENT.md` — **Betriebshandbuch (neu im Arbeitsordner seit 24.07.2026)**: Cron-Zeitpläne und Fehlerbilder, Webhook-Aktivierung, Deployment Protection, dauerhafte Zusagen (keine Öffnungs-/Klick-Verfolgung, gedruckte Pfade), Anleitung zum Nachtragen von Tarifsätzen. **Niemals echte Werte** — nur Namen, Fundorte, Verfahren.

## Entsprechung im Repo (github.com/andi1180/peak-shaving)

| Hier im Projektordner | Im Repo |
|---|---|
| `CLAUDE_Website.md` | `apps/web/CLAUDE.md` |
| `Pflichtenheft_Website_Coolin.md` | `apps/web/Pflichtenheft_Website_Coolin.md` |
| `CLAUDE_PEAKSHAVING.md` | `CLAUDE.md` (Repo-Root) |
| `Pflichtenheft_Kalkulator_MVP.md` | `Pflichtenheft_Kalkulator_MVP.md` (Repo-Root) |
| `CLAUDE_Monitor.md` | `packages/tariff-monitor/CLAUDE.md` **(RUHEND)** |
| `Pflichtenheft_Monitor_MVP.md` | `Pflichtenheft_Monitor_MVP.md` (Repo-Root) **(RUHEND)** |
| `DEPLOYMENT.md` | `DEPLOYMENT.md` (Repo-Root) — **neu im Arbeitsordner seit 24.07.2026**, s. unten |

## Regel

**Hier im Projektordner:** jede `CLAUDE_*.md` trägt einen Bauabschnitt-Suffix im Namen (`_Website`, `_PEAKSHAVING`, `_Monitor`). Keine Datei heißt hier bare `CLAUDE.md`.

**Im Repo:** jede Datei heißt exakt `CLAUDE.md`, eindeutig durch ihren Ordner (Repo-Root = Kalkulator, `apps/web/` = Website, künftiger Monitor-Ordner = Monitor).

Grund: Claude Code lädt im Repo automatisch die `CLAUDE.md` des jeweiligen Arbeitsordners — dort ist der einheitliche Name funktional nötig und durch den Ordner eindeutig. Hier im flachen Projektordner hat der Dateiname keine technische Funktion; der Suffix ist die einzige Unterscheidung zwischen den drei Bauabschnitten.

## Weitere Repo-Dokumente

Neben den Arbeitsregeln/Pflichtenheften gibt es operative Dokumente (sie beschreiben keinen Bauabschnitt, sondern Einrichtung/Betrieb):

| Im Repo | Zweck | Projektordner |
|---|---|---|
| `DESIGN.md` (Root) | Design-Tokens Kalkulator | ja |
| `apps/web/DESIGN.md` | Design-Tokens/Prinzipien Website + Monitor-UI | nein |
| `DEPLOYMENT.md` (Root) | **Betriebshandbuch** (s. u.) | **ja — neu seit 24.07.2026** |

**`DEPLOYMENT.md` gehört ab sofort in den Arbeitsordner** — bisher war sie dort ausdrücklich ausgenommen. Begründung: Sie ist längst nicht mehr nur die Notiz „welche Env-Variable wohin" von der Cloud-Anbindung, sondern das **Betriebshandbuch** der Plattform. Sie führt inzwischen die Zeitpläne und Fehlerbilder der beiden Cron-Jobs (§1g), die Aktivierung des Zustell-Webhooks (§1h), die **Deployment Protection als Ursache stumm verworfener Cron-Aufrufe** (§1i), die dauerhafte Zusage „keine Öffnungs-/Klick-Verfolgung" samt Prüf- und Abschaltbefehl (§2-Resend-a), die Anleitung zum Nachtragen von Tarifsätzen (§3a), die **gedruckten Pfade als dauerhafte Zusagen** (§5) und den Zweckbindungsvermerk zu archivierten Lastgängen (§6). Wer im Betrieb etwas beurteilen oder nachvollziehen soll, braucht sie zur Hand.

**Sie enthält weiterhin NIEMALS echte Werte** — nur Namen, Fundorte und Verfahren. Das ist die Bedingung, unter der sie im Arbeitsordner liegen darf.

## Pflegehinweis

Der Repo-Ort der Monitor-Engine ist entschieden: `packages/tariff-monitor/` (bare `CLAUDE.md` dort, Suffix-Kopie `CLAUDE_Monitor.md` hier).

**`[korrigiert 24.07.2026]` Die frühere Pflicht, Änderungen an geteilter Infrastruktur (Supabase-Auth/Entitlements/Stripe/`platform`) mit der Monitor-Doku synchron zu halten, ist AUSSER KRAFT** — außer Kraft gesetzt mit B14-2, nicht erfüllt. Die Regel entstand, als der Monitor das aktive Produkt war und `platform` dort gebaut wurde. Seit 20.07.2026 sind `Pflichtenheft_Monitor_MVP.md` und `packages/tariff-monitor/CLAUDE.md` **ruhend gestellt und ausdrücklich nur historisch zu lesen**; neue Einträge dort nachzutragen machte genau diese Kennzeichnung falsch — die Dateien behaupteten einen aktuellen Stand, den sie sonst nicht führen. **Maßgeblich für `platform` sind die Root-`CLAUDE.md` und die Handover-Logs der AKTIVEN Apps** (`apps/web/CLAUDE.md`). Die Monitor-Dokumente bleiben unangetastet — sie beschreiben korrekt den Stand bei ihrer Ruhestellung.
