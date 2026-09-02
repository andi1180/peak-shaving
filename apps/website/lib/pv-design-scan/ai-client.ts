import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

/**
 * B22c — SERVER-ONLY Anthropic-Client der SECHSTEN KI-Anbindung des Projekts.
 *
 * ── WARUM EIN EIGENER CLIENT UND NICHT DER DES RECHNUNGS-SCANS ────────────────────────────────
 * Dieselbe Begründung wie bei den vier Anbindungen davor: eine geteilte Client-Datei hätte
 * mehrere erlaubte Orte und damit keine Bremse mehr, und die Anbindungen sollen sich unabhängig
 * voneinander abschalten lassen. Der ESLint-Eintrag nennt deshalb GENAU EINE Datei
 * (`lib/pv-design-scan/extract.ts`), und alle bestehenden Ausnahmeblöcke sind um diesen Client
 * erweitert — die Regel wird getauscht, nicht abgeschaltet (die Korrektur aus Delta 9b-2a).
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
 * ── ⚠ KEIN `limits.ts` — bewusst nach dem Muster des RECHNUNGS-Scans, nicht dem der drei jüngeren ─
 * `lib/battery-text` und `lib/report-request` halten ihre Grenzen in einem eigenen `limits.ts`,
 * damit die Server Action daneben keinen Grund hat, das Client-Modul zu importieren, und ein
 * ESLint-Muster auch die RELATIVE Schreibweise (`./ai-client`) sperren kann. Hier steht die Grenze
 * inline wie in `lib/invoice-scan/ai-client.ts`, und die Folge ist offengelegt: `actions.ts` zieht
 * `MAX_PV_DESIGN_FILE_BYTES` relativ aus dieser Datei, ein Verzeichnis-Muster gegen die relative
 * Schreibweise ist deshalb NICHT gesetzt, und die in Delta 17 gemessene Lücke besteht für dieses
 * Verzeichnis genauso fort wie für `lib/invoice-scan`. Sie zu schliessen heisst, die Konstante in
 * ein eigenes Modul ohne Schlüsselzugriff zu lösen — für beide Verzeichnisse gemeinsam, in einem
 * eigenen Schritt (s. CLAUDE.md, Delta 17).
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

/**
 * Obergrenze der hochgeladenen Datei in Bytes.
 *
 * ⚠ Grösser als beim Rechnungs-Scan (6 MB), und der Grund ist die Dokumentart: eine Rechnung ist
 * ein bis wenige Seiten, ein PV-Exposé sind zwei Dutzend mit Diagrammen und Fotos (das
 * vorliegende: 19 Seiten, 18 Bild-XObjects, 1,1 MB). 8 MB ist dafür grosszügig und hält die
 * Anfrage weit unter der API-Grenze von 32 MB, auch nach der base64-Aufblähung um rund ein
 * Drittel.
 *
 * Der Wert ist die FACHLICHE Grenze; das `bodySizeLimit` in `next.config.mjs` liegt bewusst etwas
 * darüber, damit die Anwendung ablehnt und mit einem Satz antwortet, statt dass die Plattform die
 * Anfrage vorher abschneidet (Muster aus B14-2).
 */
export const MAX_PV_DESIGN_FILE_BYTES = 8 * 1024 * 1024

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
