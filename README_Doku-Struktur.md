# Doku-Struktur — Fakten & aktueller Stand

## Oberste Quelle: `Fahrplan_2026.md`

Seit 20.07.2026 ist **`Fahrplan_2026.md`** (Repo-Root) die kanonische Quelle für Reihenfolge, Umfang und Begründung aller Bauabschnitte — bei Widerspruch zu einem Pflichtenheft gilt diese Datei. Der Haushalts-Tarifmonitor (Dokumente unten mit „RUHEND" markiert) ist eingestellt; Details und die neue Bauabschnitts-Nummerierung (B0–B15) stehen dort.

**Session-Einstieg, in dieser Reihenfolge:** `Fahrplan_2026.md` → diese Datei (Landkarte) → die `CLAUDE.md` der betroffenen App → `DEPLOYMENT.md`.

## Aktuelle Dateien in diesem claude.ai-Projektordner

- `CLAUDE_Website.md` — Arbeitsregeln Website
- `Pflichtenheft_Website_Coolin.md` — Detaildokument Website
- `CLAUDE_PEAKSHAVING.md` — Arbeitsregeln Kalkulator
- `Pflichtenheft_Kalkulator_MVP.md` — Detaildokument Kalkulator
- `DESIGN.md` — Design-Tokens Kalkulator
- `CLAUDE_Monitor.md` — Arbeitsregeln Monitor **(RUHEND seit 20.07.2026, s. `Fahrplan_2026.md`)**
- `Pflichtenheft_Monitor_MVP.md` — Detaildokument Monitor **(RUHEND seit 20.07.2026, s. `Fahrplan_2026.md`)**

## Entsprechung im Repo (github.com/andi1180/peak-shaving)

| Hier im Projektordner | Im Repo |
|---|---|
| `CLAUDE_Website.md` | `apps/web/CLAUDE.md` |
| `Pflichtenheft_Website_Coolin.md` | `apps/web/Pflichtenheft_Website_Coolin.md` |
| `CLAUDE_PEAKSHAVING.md` | `CLAUDE.md` (Repo-Root) |
| `Pflichtenheft_Kalkulator_MVP.md` | `Pflichtenheft_Kalkulator_MVP.md` (Repo-Root) |
| `CLAUDE_Monitor.md` | `packages/tariff-monitor/CLAUDE.md` **(RUHEND)** |
| `Pflichtenheft_Monitor_MVP.md` | `Pflichtenheft_Monitor_MVP.md` (Repo-Root) **(RUHEND)** |

## Regel

**Hier im Projektordner:** jede `CLAUDE_*.md` trägt einen Bauabschnitt-Suffix im Namen (`_Website`, `_PEAKSHAVING`, `_Monitor`). Keine Datei heißt hier bare `CLAUDE.md`.

**Im Repo:** jede Datei heißt exakt `CLAUDE.md`, eindeutig durch ihren Ordner (Repo-Root = Kalkulator, `apps/web/` = Website, künftiger Monitor-Ordner = Monitor).

Grund: Claude Code lädt im Repo automatisch die `CLAUDE.md` des jeweiligen Arbeitsordners — dort ist der einheitliche Name funktional nötig und durch den Ordner eindeutig. Hier im flachen Projektordner hat der Dateiname keine technische Funktion; der Suffix ist die einzige Unterscheidung zwischen den drei Bauabschnitten.

## Weitere Repo-Dokumente (nur im Repo, kein Projektordner-Zwilling)

Neben den Arbeitsregeln/Pflichtenheften gibt es rein operative Dokumente, die nur im Repo leben (sie beschreiben keinen Bauabschnitt, sondern Einrichtung/Betrieb):

| Im Repo | Zweck |
|---|---|
| `DESIGN.md` (Root) | Design-Tokens Kalkulator |
| `apps/web/DESIGN.md` | Design-Tokens/Prinzipien Website + Monitor-UI |
| `DEPLOYMENT.md` (Root) | Cloud-Setup Supabase + Vercel: welche Env-Variable wohin, welche Dashboard-Einstellung wo (Namen/Fundorte, **keine Werte**). Angelegt bei der Cloud-Anbindung. |

## Pflegehinweis

Der Repo-Ort der Monitor-Engine ist entschieden: `packages/tariff-monitor/` (bare `CLAUDE.md` dort, Suffix-Kopie `CLAUDE_Monitor.md` hier). Bei Änderungen an geteilter Infrastruktur (Supabase-Auth/Entitlements/Stripe) Monitor- und Kalkulator-Doku synchron halten (§15).
