import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

/**
 * B24, Teil 1 — SERVER-ONLY Anthropic-Client des Batterie-Datenblatt-Scans.
 * Die FÜNFTE KI-Anbindung dieses Pakets.
 *
 * Wieder eine EIGENE Datei statt eines geteilten Moduls, aus den inzwischen viermal geprüften
 * Gründen: die Sperre unten benennt GENAU EINE erlaubte Datei; ein geteilter Client hätte fünf
 * erlaubte Orte und damit keine Sperre mehr. Und die Anbindungen sollen sich unabhängig
 * voneinander abschalten lassen.
 *
 * ⚠ Die vier bestehenden Extraktoren sind in diesem Bauabschnitt mit 0 Zeilen Diff unangetastet.
 *
 * ── DER SCHLÜSSEL IST EIN GEHEIMNIS AUF DER EBENE DES SERVICE-ROLE-SCHLÜSSELS ─────────────────
 * Er ist auf die Rechnung des Kontos abrechenbar und hat kein Kontingent, das ihn begrenzte — ein
 * Leck merkt man an der Abrechnung, nicht an einem Fehler. Deshalb dieselben Sperren wie bei den
 * vier bestehenden Anbindungen:
 *
 *   1. `import 'server-only'` — ein Import aus einer Client-Komponente bricht den Build HART.
 *   2. Die `exports`-Angabe der `package.json` gibt ausschliesslich `.` frei. Ein
 *      `import … from 'extractors/src/battery-spec-scan/ai-client'` löst von ausserhalb des
 *      Pakets weder in TypeScript (`moduleResolution: Bundler`) noch in webpack auf — das ist
 *      die härtere Sperre, weil sie keine Regel ist, sondern die Auflösung.
 *   3. ESLint `no-restricted-imports` (root `eslint.config.mjs`) erlaubt den Import dieses Moduls
 *      INNERHALB des Pakets in GENAU EINER Datei: `./extract.ts`. ⚠ Diese dritte Sperre ist mit
 *      diesem Bauabschnitt zum ersten Mal für `packages/extractors` überhaupt gesetzt — beim
 *      Anlegen gemessen: die bestehenden Blöcke sind auf `apps/**` beschränkt und haben die
 *      Extraktoren seit ihrem Umzug (B24) nicht mehr erreicht, obwohl der Kopf des Barrels das
 *      behauptete. Die Grössengrenze liegt dafür in `limits.ts`, damit der Barrel und die Server
 *      Action keinen Grund haben, dieses Modul anzufassen.
 *   4. Zugriff auf die Env erst BEI GEBRAUCH (unten), nie als Modul-Konstante. Ohne den Schlüssel
 *      läuft der Wizard unverändert weiter; die Station meldet sich sichtbar als „nicht
 *      eingerichtet", und die vier Felder lassen sich von Hand ausfüllen.
 *
 * ── ⚠ DIE ENV HEISST `ANTHROPIC_API_KEY` UND IST NICHT `NEXT_PUBLIC_` ─────────────────────────
 * `NEXT_PUBLIC_`-präfixte Werte setzt Next zur Bauzeit TEXTUELL ins Client-Bündel ein. Unter
 * diesem Präfix stünde der Schlüssel im ausgelieferten JavaScript und wäre öffentlich. Der
 * dynamische Zugriff (`process.env.X` in einer Funktion, kein Literal auf Modulebene) ist hier
 * richtig.
 *
 * Es ist derselbe Schlüssel wie bei den vier bestehenden Anbindungen (`DEPLOYMENT.md` §1-Website-c
 * und §1l); dieser Bauabschnitt braucht KEINE neue Umgebungsvariable.
 */

/**
 * Das Modell für den Scan.
 *
 * Dieselbe Stufe wie die vier bestehenden Anbindungen, und hier mit einem eigenen Grund: ein
 * Datenblatt steht VOLLER Zahlen, die fast die gesuchten sind — Brutto neben nutzbarer Kapazität,
 * Spitzen- neben Dauerleistung, Wechselrichter- neben Round-Trip-Wirkungsgrad, dazu oft eine
 * ganze Produktfamilie in einer Tabelle. Genau das ist die Aufgabe, bei der ein kleineres Modell
 * die Spalte verwechselt, und der Fehler fällt nachher nicht als Fehler auf, sondern als
 * Ergebnis.
 *
 * ⚠ Die Kennung ist vollständig — KEIN Datums-Suffix anhängen.
 */
export const BATTERY_SPEC_SCAN_MODEL = 'claude-sonnet-5'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} fehlt. Der Batterie-Datenblatt-Scan (B24) braucht den KI-Zugang; ` +
        `s. DEPLOYMENT.md §1-Website-c.`,
    )
  }
  return value
}

/** Frischer Client je Aufruf (kein Modul-Singleton — s. die vier bestehenden Anbindungen). */
export function createBatterySpecScanClient(): Anthropic {
  return new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') })
}

/** Ist der KI-Zugang eingerichtet? Für die Anzeige, ohne einen Client zu bauen. */
export function isBatterySpecScanConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}
