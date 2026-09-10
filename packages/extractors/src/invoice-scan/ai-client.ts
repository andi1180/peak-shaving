import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

/**
 * Delta 9b-2a — SERVER-ONLY Anthropic-Client. Die ERSTE KI-Anbindung des gesamten Repos.
 *
 * ⚠ SEIT DER KONSOLIDIERUNG (B24) LIEGT DIESE DATEI IN `packages/extractors` UND NICHT MEHR IN
 * `apps/website`. Der Grund steht im Kopf von `../index.ts`: der Projekt-Chat in `apps/web`
 * braucht dieselbe Ableselogik, die zwei Apps importieren einander nie, und zwei Fassungen
 * desselben Prompts liefen beim nächsten Umbau auseinander. Am Verhalten ändert der Umzug nichts.
 *
 * ── WAS HIER NEU IST ───────────────────────────────────────────────────────────────────────────
 * Bis hierher gab es im Projekt keine Zeile KI-Anbindung (repo-weit gemessen: kein SDK, kein
 * Schlüssel, kein Aufruf). Diese Datei ist der einzige Ort, an dem ein Client entsteht — und der
 * einzige, der den Schlüssel liest.
 *
 * ── DER SCHLÜSSEL IST EIN GEHEIMNIS AUF DER EBENE DES SERVICE-ROLE-SCHLÜSSELS ─────────────────
 * Er ist auf die Rechnung des Kontos abrechenbar und hat kein Kontingent, das ihn begrenzte. Ein
 * Schlüssel im Browser-Bündel wäre also nicht bloss eine Datenschutzfrage, sondern eine offene
 * Kasse. Deshalb dieselben DREI SPERREN wie beim service_role-Schlüssel (Delta 16b,
 * `lib/report-gate/service-role.ts`):
 *
 *   1. `import 'server-only'` — ein Import aus einer Client-Komponente bricht den Build HART.
 *   2. ESLint `no-restricted-imports` (root `eslint.config.mjs`) erlaubt den Import dieses Moduls
 *      in GENAU EINER Datei: `packages/extractors/src/invoice-scan/extract.ts`. Nicht das
 *      Verzeichnis, und ausdrücklich AUCH RELATIV (`./ai-client`) — daneben liegt der Barrel-Weg
 *      des Pakets, und der soll sich den Client nicht selbst bauen können.
 *   4. Und seit der Konsolidierung eine vierte, härtere Sperre, die keine Regel ist, sondern die
 *      Auflösung: dieses Paket exportiert AUSSCHLIESSLICH `.` (`exports` in `package.json`). Ein
 *      `import … from 'extractors/src/invoice-scan/ai-client'` löst weder in TypeScript
 *      (`moduleResolution: Bundler`) noch in webpack auf — von ausserhalb des Pakets ist der
 *      Client nicht erreichbar, nicht einmal versehentlich.
 *   3. Zugriff auf die Env erst BEI GEBRAUCH (unten), nie als Modul-Konstante. Ohne den Schlüssel
 *      läuft der Rechner unverändert weiter; er wird ausschliesslich beim Rechnungs-Scan gebraucht.
 *
 * ── ⚠ DIE ENV HEISST `ANTHROPIC_API_KEY` UND IST NICHT `NEXT_PUBLIC_` ─────────────────────────
 * `NEXT_PUBLIC_`-präfixte Werte setzt Next zur Bauzeit TEXTUELL ins Client-Bündel ein. Unter diesem
 * Präfix stünde der Schlüssel im ausgelieferten JavaScript und wäre öffentlich. Der dynamische
 * Zugriff (`process.env.X` in einer Funktion, kein Literal auf Modulebene) ist hier ausdrücklich
 * richtig — anders als in `lib/tariff-data/client.ts`, wo literale Referenzen Pflicht sind, weil
 * der Wert im Browser gebraucht wird. Hier ist das Gegenteil der Fall.
 *
 * Einrichtung und Rotationshinweis: `DEPLOYMENT.md` §1-Website-c.
 *
 * ⚠ DIE GRÖSSENGRENZE STEHT NICHT MEHR HIER, sondern in `./limits.ts` — dort ist begründet,
 * warum die Auslagerung mit diesem Schritt keine Aufräumarbeit war, sondern die Bedingung dafür,
 * dass Sperre 2 am neuen Ort überhaupt halten kann.
 */

/**
 * Das Modell für die Extraktion.
 *
 * ── WARUM SONNET UND NICHT DAS KLEINSTE MODELL ────────────────────────────────────────────────
 * Der Auftrag lautet „schnell und günstig, aber für strukturierte Extraktion angemessen". Der
 * Ausschlag gibt, was ein Lesefehler kostet: ein um den Faktor 10 falscher Leistungspreis fällt in
 * einer Wirtschaftlichkeitsrechnung NICHT als Fehler auf, sondern als überraschend gutes Ergebnis
 * (dieselbe Überlegung wie bei der Eur/MWh-Umrechnung in B21-2a). Ein gescanntes, oft schief
 * fotografiertes Rechnungsblatt mit mehreren Preisspalten ist genau die Aufgabe, bei der ein
 * kleineres Modell Zahlen verwechselt. Sonnet ist die günstigste Stufe, der ich das zutraue.
 *
 * ⚠ Die Kennung ist vollständig — KEIN Datums-Suffix anhängen.
 */
export const INVOICE_SCAN_MODEL = 'claude-sonnet-5'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} fehlt. Der Rechnungs-Scan (Delta 9b-2) braucht den KI-Zugang; ` +
        `s. DEPLOYMENT.md §1-Website-c.`,
    )
  }
  return value
}

/**
 * Frischer Client je Aufruf (kein Modul-Singleton — dieselbe Begründung wie beim Supabase-Client:
 * ein über Requests geteilter Client-Zustand ist in einer Server-Umgebung unnötig).
 */
export function createInvoiceScanClient(): Anthropic {
  return new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') })
}

/** Ist der KI-Zugang eingerichtet? Für die Anzeige, ohne einen Client zu bauen. */
export function isInvoiceScanConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}
