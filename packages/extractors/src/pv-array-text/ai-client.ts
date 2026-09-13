import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

/**
 * B24, Teil 1 — SERVER-ONLY Anthropic-Client der PV-Anlagen-Freitexterfassung.
 *
 * Wieder eine EIGENE Datei statt eines geteilten Moduls, aus den inzwischen mehrfach geprüften
 * Gründen: die ESLint-Bremse (`eslint.config.mjs`, Block `packages/extractors/src/**`) erlaubt den
 * Import dieses Moduls in GENAU EINER Datei — dem `extract.ts` daneben; ein geteilter Client hätte
 * mehrere erlaubte Orte und damit keine Bremse mehr. Und die Anbindungen sollen sich unabhängig
 * voneinander abschalten lassen.
 *
 * ⚠ Über der ESLint-Sperre steht eine härtere, die keine Regel ist: `exports` in der
 * `package.json` gibt ausschliesslich `.` frei — ein Deep-Import auf diese Datei löst von
 * ausserhalb des Pakets weder in TypeScript (`moduleResolution: Bundler`) noch in webpack auf.
 *
 * ── DER SCHLÜSSEL IST EIN GEHEIMNIS AUF DER EBENE DES SERVICE-ROLE-SCHLÜSSELS ─────────────────
 * Er ist auf die Rechnung des Kontos abrechenbar und hat kein Kontingent, das ihn begrenzte.
 * Deshalb dieselben DREI SPERREN wie bei den bestehenden Anbindungen:
 *
 *   1. `import 'server-only'` — ein Import aus einer Client-Komponente bricht den Build HART.
 *   2. ESLint `no-restricted-imports` (relativ UND aus dem Barrel heraus). Die Längengrenze liegt
 *      dafür in `limits.ts`, damit Barrel und Server Action keinen Grund haben, dieses Modul
 *      anzufassen.
 *   3. Zugriff auf die Env erst BEI GEBRAUCH (unten), nie als Modul-Konstante. Ohne den Schlüssel
 *      läuft der Wizard unverändert weiter; das Feld meldet sich sichtbar als „nicht eingerichtet",
 *      und die drei Felder lassen sich von Hand ausfüllen.
 *
 * ── ⚠ DIE ENV HEISST `ANTHROPIC_API_KEY` UND IST NICHT `NEXT_PUBLIC_` ─────────────────────────
 * `NEXT_PUBLIC_`-präfixte Werte setzt Next zur Bauzeit TEXTUELL ins Client-Bündel ein. Unter diesem
 * Präfix stünde der Schlüssel im ausgelieferten JavaScript und wäre öffentlich. Der dynamische
 * Zugriff (`process.env.X` in einer Funktion, kein Literal auf Modulebene) ist hier richtig.
 *
 * Es ist derselbe Schlüssel wie bei den übrigen Anbindungen (`DEPLOYMENT.md` §1-Website-c); dieser
 * Bauabschnitt braucht KEINE neue Umgebungsvariable.
 */

/**
 * Das Modell für die Erfassung.
 *
 * Dieselbe Stufe wie die bestehenden Anbindungen. ⚠ Die Kennung ist vollständig — KEIN
 * Datums-Suffix anhängen.
 */
export const PV_ARRAY_TEXT_MODEL = 'claude-sonnet-5'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} fehlt. Die PV-Anlagen-Erfassung braucht den KI-Zugang; s. DEPLOYMENT.md §1-Website-c.`,
    )
  }
  return value
}

/** Frischer Client je Aufruf (kein Modul-Singleton — s. die bestehenden Anbindungen). */
export function createPvArrayTextClient(): Anthropic {
  return new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') })
}

/** Ist der KI-Zugang eingerichtet? Für die Anzeige, ohne einen Client zu bauen. */
export function isPvArrayTextConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}
