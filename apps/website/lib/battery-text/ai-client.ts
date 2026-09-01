import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

/**
 * Delta 17 Teil 2 — SERVER-ONLY Anthropic-Client der Batterie-Freitexterfassung.
 * Die VIERTE KI-Anbindung des Repos und die erste, die kein Dokument sendet, sondern nur Text.
 *
 * Wieder eine EIGENE Datei statt eines geteilten Moduls, aus den inzwischen dreimal geprüften
 * Gründen: die ESLint-Bremse unten ist app-lokal und benennt GENAU EINE erlaubte Datei; ein
 * geteilter Client hätte mehrere erlaubte Orte und damit keine Bremse mehr. Und die vier
 * Anbindungen sollen sich unabhängig voneinander abschalten lassen.
 *
 * ⚠ Die drei bestehenden Scan-/Zuordnungsmodule sind in diesem Bauabschnitt mit 0 Zeilen Diff
 * unangetastet.
 *
 * ── DER SCHLÜSSEL IST EIN GEHEIMNIS AUF DER EBENE DES SERVICE-ROLE-SCHLÜSSELS ─────────────────
 * Er ist auf die Rechnung des Kontos abrechenbar und hat kein Kontingent, das ihn begrenzte.
 * Deshalb dieselben DREI SPERREN wie bei den drei bestehenden Anbindungen:
 *
 *   1. `import 'server-only'` — ein Import aus einer Client-Komponente bricht den Build HART.
 *   2. ESLint `no-restricted-imports` (root `eslint.config.mjs`) erlaubt den Import dieses Moduls
 *      in GENAU EINER Datei: `apps/website/lib/battery-text/extract.ts`. **Und zwar auch RELATIV**
 *      — das Muster gegen `./ai-client` ist hier von Anfang an gesetzt, statt wie in Teil 1 erst
 *      nach einer Messung nachgezogen zu werden. Die Grössen-/Längengrenze liegt dafür in
 *      `limits.ts`, damit die Server Action keinen Grund hat, dieses Modul anzufassen.
 *   3. Zugriff auf die Env erst BEI GEBRAUCH (unten), nie als Modul-Konstante. Ohne den Schlüssel
 *      läuft der Rechner unverändert weiter; das Feld meldet sich sichtbar als „nicht eingerichtet".
 *
 * ── ⚠ DIE ENV HEISST `ANTHROPIC_API_KEY` UND IST NICHT `NEXT_PUBLIC_` ─────────────────────────
 * `NEXT_PUBLIC_`-präfixte Werte setzt Next zur Bauzeit TEXTUELL ins Client-Bündel ein. Unter diesem
 * Präfix stünde der Schlüssel im ausgelieferten JavaScript und wäre öffentlich. Der dynamische
 * Zugriff (`process.env.X` in einer Funktion, kein Literal auf Modulebene) ist hier richtig.
 *
 * Es ist derselbe Schlüssel wie beim Rechnungs-Scan und bei der Dokument-Zuordnung
 * (`DEPLOYMENT.md` §1-Website-c); dieser Bauabschnitt braucht KEINE neue Umgebungsvariable.
 */

/**
 * Das Modell für die Erfassung.
 *
 * Dieselbe Stufe wie die drei bestehenden Anbindungen — und aus demselben Grund wie in Teil 1:
 * für diesen Bauabschnitt lag KEIN `ANTHROPIC_API_KEY` vor (in Vercel `sensitive`, nicht
 * zurücklesbar), ein Wechsel auf eine günstigere Stufe wäre also gegen die echte API ungeprüft.
 * `claude-sonnet-5` ist die Stufe, für die dieser Aufruf-Pfad (`json_schema`) belegt ist.
 *
 * ⚠ Die Kennung ist vollständig — KEIN Datums-Suffix anhängen.
 */
export const BATTERY_TEXT_MODEL = 'claude-sonnet-5'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} fehlt. Die Batterie-Erfassung (Delta 17) braucht den KI-Zugang; ` +
        `s. DEPLOYMENT.md §1-Website-c.`,
    )
  }
  return value
}

/** Frischer Client je Aufruf (kein Modul-Singleton — s. die drei bestehenden Anbindungen). */
export function createBatteryTextClient(): Anthropic {
  return new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') })
}

/** Ist der KI-Zugang eingerichtet? Für die Anzeige, ohne einen Client zu bauen. */
export function isBatteryTextConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}
