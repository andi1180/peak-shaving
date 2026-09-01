import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

/**
 * SERVER-ONLY Anthropic-Client des Tarifblatt-Scans — die erste KI-Anbindung in `apps/web`.
 *
 * Strukturell derselbe Fall wie `apps/website/lib/invoice-scan/ai-client.ts` (Delta 9b-2a), und
 * bewusst als EIGENE Datei statt als geteiltes Modul: `@/` zeigt in jeder App woandershin, die
 * ESLint-Bremse unten ist app-lokal, und die beiden Anbindungen sollen sich unabhängig
 * voneinander abschalten lassen. Der Rechnungs-Scan bleibt in diesem Schritt mit 0 Zeilen Diff
 * unangetastet.
 *
 * ── DER SCHLÜSSEL IST EIN GEHEIMNIS AUF DER EBENE DES SERVICE-ROLE-SCHLÜSSELS ─────────────────
 * Er ist auf die Rechnung des Kontos abrechenbar und hat kein Kontingent, das ihn begrenzte. Ein
 * Schlüssel im Browser-Bündel wäre also nicht bloss eine Datenschutzfrage, sondern eine offene
 * Kasse. Deshalb dieselben DREI SPERREN wie beim service_role-Client (T4-3) und beim KI-Client des
 * Rechners:
 *
 *   1. `import 'server-only'` — ein Import aus einer Client-Komponente bricht den Build HART.
 *   2. ESLint `no-restricted-imports` (root `eslint.config.mjs`) erlaubt den Import dieses Moduls
 *      in GENAU EINER Datei: `apps/web/lib/admin/tariff-scan/extract.ts`. Nicht das Verzeichnis —
 *      dort liegt auch die Server Action, und die soll den Client nicht selbst bauen können.
 *      Dieselbe engste Form wie bei `lib/auth/admin-api.ts` (B18-2a) und
 *      `lib/admin/grid-tariffs-actions.ts` (B21-2b).
 *   3. Zugriff auf die Env erst BEI GEBRAUCH (unten), nie als Modul-Konstante. Ohne den Schlüssel
 *      läuft der gesamte Admin-Bereich unverändert weiter; das Tarifformular bleibt von Hand
 *      ausfüllbar, und der Scan meldet sich sichtbar als „nicht eingerichtet".
 *
 * ── ⚠ DIE ENV HEISST `ANTHROPIC_API_KEY` UND IST NICHT `NEXT_PUBLIC_` ─────────────────────────
 * `NEXT_PUBLIC_`-präfixte Werte setzt Next zur Bauzeit TEXTUELL ins Client-Bündel ein. Unter diesem
 * Präfix stünde der Schlüssel im ausgelieferten JavaScript und wäre öffentlich. Der dynamische
 * Zugriff (`process.env.X` in einer Funktion, kein Literal auf Modulebene) ist hier ausdrücklich
 * richtig.
 *
 * ⚠ KORREKTUR (01.09.2026): DER SCHLÜSSEL IST IN `peak-shaving-web` GESETZT. Bis dahin stand hier
 * das Gegenteil (am 31.08.2026 gemessen: 16 Einträge, keiner davon KI), und `not_configured` galt
 * als der zu erwartende Produktionszustand. Über die Vercel-API scope-genau nachgemessen: die
 * Variable liegt für Production UND Preview vor. Der Schlüssel im Nachbarprojekt
 * `peak-shaving-website` ist ein anderer und unabhängig zu rotieren — die beiden Projekte lesen
 * ausschliesslich ihre EIGENEN Variablen. Einrichtung und Rotationshinweis in `DEPLOYMENT.md` §1l.
 */

/**
 * Das Modell für die Extraktion.
 *
 * ── DIESELBE WAHL WIE BEIM RECHNUNGS-SCAN, MIT HÖHEREM EINSATZ ────────────────────────────────
 * Dort gibt den Ausschlag, dass ein um den Faktor 10 falscher Leistungspreis in einer
 * Wirtschaftlichkeitsrechnung NICHT als Fehler auffällt, sondern als überraschend gutes Ergebnis.
 * Hier wiegt derselbe Fehler schwerer: Ein Tarifstand ist nachträglich nicht mehr änderbar (kein
 * `delete`-Grant, keine Update-Funktion — B21-2b) und geht in JEDE künftige Analyse dieser
 * Netzebene ein, nicht nur in die eines einzelnen Kunden. Ein Preisblatt mit mehreren Netzebenen
 * nebeneinander und saisonal ausgeschnittenen Fenstern ist ausserdem genau die Tabellen-Aufgabe,
 * bei der ein kleineres Modell Spalten verwechselt.
 *
 * ⚠ Die Kennung ist vollständig — KEIN Datums-Suffix anhängen.
 */
export const TARIFF_SHEET_SCAN_MODEL = 'claude-sonnet-5'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} fehlt. Der Tarifblatt-Scan braucht den KI-Zugang; s. DEPLOYMENT.md §1l.`,
    )
  }
  return value
}

/**
 * Frischer Client je Aufruf (kein Modul-Singleton — dieselbe Begründung wie beim Supabase-Client:
 * ein über Requests geteilter Client-Zustand ist in einer Server-Umgebung unnötig).
 */
export function createTariffSheetScanClient(): Anthropic {
  return new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') })
}

/** Ist der KI-Zugang eingerichtet? Für die Anzeige, ohne einen Client zu bauen. */
export function isTariffSheetScanConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}
