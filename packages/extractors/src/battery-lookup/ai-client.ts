import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

/**
 * B24, Teil 1 — SERVER-ONLY Anthropic-Client der Marke/Typ-Recherche.
 * Die SECHSTE KI-Anbindung dieses Pakets — und die ERSTE, die ein WERKZEUG benutzt.
 *
 * Wieder eine EIGENE Datei statt eines geteilten Moduls, aus den inzwischen fünfmal geprüften
 * Gründen: die Sperre unten benennt GENAU EINE erlaubte Datei; ein geteilter Client hätte sechs
 * erlaubte Orte und damit keine Sperre mehr. Und die Anbindungen sollen sich unabhängig
 * voneinander abschalten lassen — was hier besonders zählt, weil dieser Weg als einziger neben den
 * Modellkosten noch Suchkosten verursacht (s. `limits.ts`).
 *
 * ⚠ Die fünf bestehenden Extraktoren sind in diesem Bauabschnitt mit 0 Zeilen Diff unangetastet.
 *
 * ── DER SCHLÜSSEL IST EIN GEHEIMNIS AUF DER EBENE DES SERVICE-ROLE-SCHLÜSSELS ─────────────────
 * Er ist auf die Rechnung des Kontos abrechenbar und hat kein Kontingent, das ihn begrenzte — ein
 * Leck merkt man an der Abrechnung, nicht an einem Fehler. Deshalb dieselben vier Sperren wie bei
 * den fünf bestehenden Anbindungen:
 *
 *   1. `import 'server-only'` — ein Import aus einer Client-Komponente bricht den Build HART.
 *   2. Die `exports`-Angabe der `package.json` gibt ausschliesslich `.` frei. Ein
 *      `import … from 'extractors/src/battery-lookup/ai-client'` löst von ausserhalb des Pakets
 *      weder in TypeScript (`moduleResolution: Bundler`) noch in webpack auf — das ist die härtere
 *      Sperre, weil sie keine Regel ist, sondern die Auflösung.
 *   3. ESLint `no-restricted-imports` (root `eslint.config.mjs`) erlaubt den Import dieses Moduls
 *      INNERHALB des Pakets in GENAU EINER Datei: `./extract.ts`. ⚠ Der Block dort ist auf
 *      `packages/extractors/src/**` gemustert und erfasst dieses neue Verzeichnis deshalb OHNE
 *      Änderung — die relative Schreibweise (`./ai-client`), der Griff aus einem fremden
 *      Extraktor-Verzeichnis und der Griff aus dem Barrel sind alle drei bereits gesperrt.
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
 * Es ist derselbe Schlüssel wie bei den fünf bestehenden Anbindungen (`DEPLOYMENT.md` §1l); dieser
 * Bauabschnitt braucht KEINE neue Umgebungsvariable.
 *
 * ⚠ ER BRAUCHT ABER EINE FREIGABE, DIE DIE ANDEREN FÜNF NICHT BRAUCHEN: die Websuche lässt sich
 * organisationsweit in der Claude Console abschalten. Ist sie dort aus, antwortet die API auf eine
 * Anfrage MIT dem Werkzeug mit HTTP 400 — nicht mit einem Fehlercode im Suchergebnis. Für den
 * Aufrufer ist das ein `api_error`; der Ausweg ist die Freigabe in der Console, nicht der Code.
 */

/**
 * Das Modell für die Recherche.
 *
 * Dieselbe Stufe wie die fünf bestehenden Anbindungen, und hier mit einem eigenen Grund: die
 * Aufgabe ist nicht Ablesen, sondern Suchen, Vergleichen und ABSTAND NEHMEN — die Regel „lieber
 * nichts als geraten" muss gegen eine Fülle plausibler Zahlen aus Händlerseiten durchgehalten
 * werden, die fast die gesuchten sind. Genau dort verwechselt ein kleineres Modell die Spalte, und
 * der Fehler fällt nachher nicht als Fehler auf, sondern als Ergebnis.
 *
 * ⚠ Die Kennung ist vollständig — KEIN Datums-Suffix anhängen.
 */
export const BATTERY_LOOKUP_MODEL = 'claude-sonnet-5'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} fehlt. Die Marke/Typ-Recherche (B24) braucht den KI-Zugang; ` +
        `s. DEPLOYMENT.md §1l.`,
    )
  }
  return value
}

/** Frischer Client je Aufruf (kein Modul-Singleton — s. die fünf bestehenden Anbindungen). */
export function createBatteryLookupClient(): Anthropic {
  return new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') })
}

/** Ist der KI-Zugang eingerichtet? Für die Anzeige, ohne einen Client zu bauen. */
export function isBatteryLookupConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}
