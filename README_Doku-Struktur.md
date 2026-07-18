# Doku-Struktur — Fakten & aktueller Stand

## Aktuelle Dateien in diesem claude.ai-Projektordner

- `CLAUDE_Website.md` — Arbeitsregeln Website
- `Pflichtenheft_Website_Coolin.md` — Detaildokument Website
- `CLAUDE_PEAKSHAVING.md` — Arbeitsregeln Kalkulator
- `Pflichtenheft_Kalkulator_MVP.md` — Detaildokument Kalkulator
- `DESIGN.md` — Design-Tokens Kalkulator
- `CLAUDE_Monitor.md` — Arbeitsregeln Monitor (angelegt sobald Monitor-Session startet)
- `Pflichtenheft_Monitor_MVP.md` — Detaildokument Monitor (angelegt sobald Monitor-Session startet)

## Entsprechung im Repo (github.com/andi1180/peak-shaving)

| Hier im Projektordner | Im Repo |
|---|---|
| `CLAUDE_Website.md` | `apps/web/CLAUDE.md` |
| `Pflichtenheft_Website_Coolin.md` | `apps/web/Pflichtenheft_Website_Coolin.md` |
| `CLAUDE_PEAKSHAVING.md` | `CLAUDE.md` (Repo-Root) |
| `Pflichtenheft_Kalkulator_MVP.md` | `Pflichtenheft_Kalkulator_MVP.md` (Repo-Root) |
| `CLAUDE_Monitor.md` | `packages/tariff-monitor/CLAUDE.md` |
| `Pflichtenheft_Monitor_MVP.md` | `Pflichtenheft_Monitor_MVP.md` (Repo-Root) |

## Regel

**Hier im Projektordner:** jede `CLAUDE_*.md` trägt einen Bauabschnitt-Suffix im Namen (`_Website`, `_PEAKSHAVING`, `_Monitor`). Keine Datei heißt hier bare `CLAUDE.md`.

**Im Repo:** jede Datei heißt exakt `CLAUDE.md`, eindeutig durch ihren Ordner (Repo-Root = Kalkulator, `apps/web/` = Website, künftiger Monitor-Ordner = Monitor).

Grund: Claude Code lädt im Repo automatisch die `CLAUDE.md` des jeweiligen Arbeitsordners — dort ist der einheitliche Name funktional nötig und durch den Ordner eindeutig. Hier im flachen Projektordner hat der Dateiname keine technische Funktion; der Suffix ist die einzige Unterscheidung zwischen den drei Bauabschnitten.

## Pflegehinweis

Der Repo-Ort der Monitor-Engine ist entschieden: `packages/tariff-monitor/` (bare `CLAUDE.md` dort, Suffix-Kopie `CLAUDE_Monitor.md` hier). Bei Änderungen an geteilter Infrastruktur (Supabase-Auth/Entitlements/Stripe) Monitor- und Kalkulator-Doku synchron halten (§15).
