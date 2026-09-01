import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

/**
 * Delta 18 — SERVER-ONLY Anthropic-Client der Report-Anfrage-Übersetzung.
 * Die FÜNFTE KI-Anbindung des Repos und die zweite, die kein Dokument sendet, sondern nur Text.
 *
 * Wieder eine EIGENE Datei statt eines geteilten Moduls, aus den inzwischen viermal geprüften
 * Gründen: die ESLint-Bremse unten ist app-lokal und benennt GENAU EINE erlaubte Datei; ein
 * geteilter Client hätte mehrere erlaubte Orte und damit keine Bremse mehr. Und die fünf
 * Anbindungen sollen sich unabhängig voneinander abschalten lassen.
 *
 * ⚠ Die vier bestehenden Extraktions-Module sind in diesem Bauabschnitt mit 0 Zeilen Diff
 * unangetastet.
 *
 * ── DER SCHLÜSSEL IST EIN GEHEIMNIS AUF DER EBENE DES SERVICE-ROLE-SCHLÜSSELS ─────────────────
 * Er ist auf die Rechnung des Kontos abrechenbar und hat kein Kontingent, das ihn begrenzte.
 * Deshalb dieselben DREI SPERREN wie bei den vier bestehenden Anbindungen:
 *
 *   1. `import 'server-only'` — ein Import aus einer Client-Komponente bricht den Build HART.
 *   2. ESLint `no-restricted-imports` (root `eslint.config.mjs`) erlaubt den Import dieses Moduls
 *      in GENAU EINER Datei: `apps/website/lib/report-request/extract.ts`. **Und zwar auch
 *      RELATIV** — das Muster gegen `./ai-client` steht von Anfang an; die Längengrenze liegt
 *      dafür in `limits.ts`, damit die Server Action keinen Grund hat, dieses Modul anzufassen.
 *   3. Zugriff auf die Env erst BEI GEBRAUCH (unten), nie als Modul-Konstante. Ohne den Schlüssel
 *      läuft der Report unverändert weiter; das Feld meldet sich sichtbar als „nicht eingerichtet",
 *      und das Annahmen-Panel daneben bleibt vollständig bedienbar.
 *
 * ── ⚠ DIE ENV HEISST `ANTHROPIC_API_KEY` UND IST NICHT `NEXT_PUBLIC_` ─────────────────────────
 * `NEXT_PUBLIC_`-präfixte Werte setzt Next zur Bauzeit TEXTUELL ins Client-Bündel ein. Unter diesem
 * Präfix stünde der Schlüssel im ausgelieferten JavaScript und wäre öffentlich. Der dynamische
 * Zugriff (`process.env.X` in einer Funktion, kein Literal auf Modulebene) ist hier richtig.
 *
 * Es ist derselbe Schlüssel wie bei den vier bestehenden Anbindungen (`DEPLOYMENT.md`
 * §1-Website-c); dieser Bauabschnitt braucht KEINE neue Umgebungsvariable.
 */

/**
 * Das Modell für die Übersetzung.
 *
 * Dieselbe Stufe wie die vier bestehenden Anbindungen. Eine günstigere liegt auch hier nahe (die
 * Aufgabe ist gröber als ein Rechnungs-Scan, und eine Fehlübersetzung fängt die Bestätigungsstufe
 * ab) — sie ist trotzdem NICHT gewählt: `claude-sonnet-5` ist die Stufe, für die dieser exakte
 * Aufruf-Pfad (`json_schema`) belegt ist, und ein Wechsel gehört als eigener, MESSBARER Schritt
 * gemacht, nicht nebenbei.
 *
 * ⚠ Die Kennung ist vollständig — KEIN Datums-Suffix anhängen.
 */
export const REPORT_REQUEST_MODEL = 'claude-sonnet-5'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} fehlt. Die Report-Anfrage (Delta 18) braucht den KI-Zugang; ` +
        `s. DEPLOYMENT.md §1-Website-c.`,
    )
  }
  return value
}

/** Frischer Client je Aufruf (kein Modul-Singleton — s. die vier bestehenden Anbindungen). */
export function createReportRequestClient(): Anthropic {
  return new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') })
}

/** Ist der KI-Zugang eingerichtet? Für die Anzeige, ohne einen Client zu bauen. */
export function isReportRequestConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}
