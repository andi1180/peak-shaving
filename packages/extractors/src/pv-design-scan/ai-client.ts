import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

/**
 * B22c — SERVER-ONLY Anthropic-Client der SECHSTEN KI-Anbindung des Projekts.
 *
 * ── WARUM EIN EIGENER CLIENT UND NICHT DER DES RECHNUNGS-SCANS ────────────────────────────────
 * Dieselbe Begründung wie bei den vier Anbindungen davor: eine geteilte Client-Datei hätte
 * mehrere erlaubte Orte und damit keine Bremse mehr, und die Anbindungen sollen sich unabhängig
 * voneinander abschalten lassen. Der ESLint-Eintrag nennt deshalb GENAU EINE Datei
 * (`packages/extractors/src/pv-design-scan/extract.ts`) — und ausdrücklich auch relativ. Über
 * allem steht seit der Konsolidierung die Paketgrenze selbst: `exports` gibt nur `.` frei, ein
 * Deep-Import auf diese Datei löst von ausserhalb gar nicht erst auf.
 *
 * ── DER SCHLÜSSEL IST EIN GEHEIMNIS AUF DER EBENE DES SERVICE-ROLE-SCHLÜSSELS ─────────────────
 * Er ist auf die Rechnung des Kontos abrechenbar und hat kein Kontingent, das ihn begrenzte. Ein
 * Schlüssel im Browser-Bündel wäre also nicht bloss eine Datenschutzfrage, sondern eine offene
 * Kasse. Deshalb dieselben DREI SPERREN wie überall:
 *
 *   1. `import 'server-only'` — ein Import aus einer Client-Komponente bricht den Build HART.
 *   2. ESLint `no-restricted-imports` (root `eslint.config.mjs`), eine erlaubte Datei.
 *   3. Zugriff auf die Env erst BEI GEBRAUCH (unten), nie als Modul-Konstante. Ohne den Schlüssel
 *      läuft der Rechner unverändert weiter; er wird ausschliesslich für diesen Scan gebraucht.
 *
 * ⚠ Die Env heisst `ANTHROPIC_API_KEY` und ist NICHT `NEXT_PUBLIC_`-präfixt — unter diesem Präfix
 * setzte Next den Wert zur Bauzeit TEXTUELL ins Client-Bündel ein. Einrichtung und
 * Rotationshinweis: `DEPLOYMENT.md` §1-Website-c.
 *
 * ── ⚠ DIE LÜCKE AUS DELTA 17 IST MIT DER KONSOLIDIERUNG GESCHLOSSEN ──────────────────────────
 * Bis hierher stand die Grössengrenze inline in dieser Datei, und die Folge war offengelegt: die
 * Server Action zog `MAX_PV_DESIGN_FILE_BYTES` RELATIV (`./ai-client`), ein Verzeichnis-Muster
 * gegen diese Schreibweise war deshalb nicht setzbar, und die in Delta 17 Teil 1 gemessene Lücke
 * bestand fort. Der Vorsatz lautete, die Konstante „für beide Verzeichnisse gemeinsam, in einem
 * eigenen Schritt" herauszulösen.
 *
 * Das ist geschehen (`./limits.ts`) — und nicht als Aufräumarbeit: der Barrel dieses Pakets muss
 * die Grenze exportieren, und läge sie hier, wäre er ein zweiter Importeur des Clients. Die
 * Sperre unten ist damit am neuen Ort erstmals lückenlos, auch relativ.
 */

/**
 * Das Modell für die Extraktion.
 *
 * ── WARUM SONNET UND NICHT DAS KLEINSTE MODELL ────────────────────────────────────────────────
 * Dieselbe Überlegung wie beim Rechnungs-Scan, und sie wiegt hier eher schwerer: was ein
 * Lesefehler kostet, ist gemessen. Eine um 180° verwechselte Ausrichtung senkt die ausgewiesene
 * Ersparnis um **56 %** (Bestandsaufnahme 3.3) — und die falsche Zahl sieht völlig plausibel aus
 * (eine schlecht ausgerichtete Fassadenanlage). Ein 19-seitiges Planungsdokument mit Tabellen,
 * Diagrammen und mehreren Modulflächen ist genau die Aufgabe, bei der ein kleineres Modell Zeilen
 * verwechselt.
 *
 * ⚠ Die Kennung ist vollständig — KEIN Datums-Suffix anhängen.
 */
export const PV_DESIGN_SCAN_MODEL = 'claude-sonnet-5'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} fehlt. Der PV-Auslegungs-Scan (B22c) braucht den KI-Zugang; ` +
        `s. DEPLOYMENT.md §1-Website-c.`,
    )
  }
  return value
}

/** Frischer Client je Aufruf — kein Modul-Singleton (dieselbe Begründung wie überall sonst). */
export function createPvDesignScanClient(): Anthropic {
  return new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') })
}

/** Ist der KI-Zugang eingerichtet? Für die Anzeige, ohne einen Client zu bauen. */
export function isPvDesignScanConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}
