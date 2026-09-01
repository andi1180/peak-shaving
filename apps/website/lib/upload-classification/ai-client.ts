import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

/**
 * Delta 17 — SERVER-ONLY Anthropic-Client der Dokument-Zuordnung. Die DRITTE KI-Anbindung des Repos.
 *
 * Strukturell derselbe Fall wie `apps/website/lib/invoice-scan/ai-client.ts` (Delta 9b-2a) und
 * `apps/web/lib/admin/tariff-scan/ai-client.ts` — und bewusst wieder eine EIGENE Datei statt eines
 * geteilten Moduls. Die Begründung ist dieselbe wie beim zweiten Mal und hier zusätzlich messbar:
 * die ESLint-Bremse unten ist app-lokal und benennt GENAU EINE erlaubte Datei; ein geteilter Client
 * hätte entweder mehrere erlaubte Dateien (und damit keine Bremse mehr) oder er zwänge beide
 * Anbindungen in eine gemeinsame Ausnahme. Ausserdem sollen sich die drei unabhängig voneinander
 * abschalten lassen: fällt die Zuordnung aus, bleiben Rechnungs-Scan und Tarifblatt-Scan intakt.
 *
 * ⚠ Der Rechnungs-Scan und der Tarifblatt-Scan sind in diesem Bauabschnitt mit 0 Zeilen Diff
 * unangetastet.
 *
 * ── DER SCHLÜSSEL IST EIN GEHEIMNIS AUF DER EBENE DES SERVICE-ROLE-SCHLÜSSELS ─────────────────
 * Er ist auf die Rechnung des Kontos abrechenbar und hat kein Kontingent, das ihn begrenzte. Ein
 * Schlüssel im Browser-Bündel wäre also nicht bloss eine Datenschutzfrage, sondern eine offene
 * Kasse. Deshalb dieselben DREI SPERREN wie bei den beiden bestehenden Anbindungen:
 *
 *   1. `import 'server-only'` — ein Import aus einer Client-Komponente bricht den Build HART.
 *   2. ESLint `no-restricted-imports` (root `eslint.config.mjs`) erlaubt den Import dieses Moduls
 *      in GENAU EINER Datei: `apps/website/lib/upload-classification/extract.ts`. Nicht das
 *      Verzeichnis — dort liegt auch die Server Action, und die soll den Client nicht selbst bauen
 *      können. Die beiden bestehenden Ausnahmedateien behalten die Sperre auf DIESES Modul (die
 *      Regel wird getauscht, nicht abgeschaltet — die Korrektur aus Delta 9b-2a).
 *   3. Zugriff auf die Env erst BEI GEBRAUCH (unten), nie als Modul-Konstante. Ohne den Schlüssel
 *      läuft der Rechner unverändert weiter; die Zuordnung meldet sich sichtbar als „nicht
 *      eingerichtet", und die drei bestehenden Einstiege sind unberührt.
 *
 * ── ⚠ DIE ENV HEISST `ANTHROPIC_API_KEY` UND IST NICHT `NEXT_PUBLIC_` ─────────────────────────
 * `NEXT_PUBLIC_`-präfixte Werte setzt Next zur Bauzeit TEXTUELL ins Client-Bündel ein. Unter diesem
 * Präfix stünde der Schlüssel im ausgelieferten JavaScript und wäre öffentlich. Der dynamische
 * Zugriff (`process.env.X` in einer Funktion, kein Literal auf Modulebene) ist hier ausdrücklich
 * richtig — anders als in `lib/tariff-data/client.ts`, wo literale Referenzen Pflicht sind.
 *
 * Es ist derselbe Schlüssel wie beim Rechnungs-Scan (`DEPLOYMENT.md` §1-Website-c); dieser
 * Bauabschnitt braucht KEINE neue Umgebungsvariable.
 *
 * ⚠ In dieser Datei stehen AUSSCHLIESSLICH Modellkennung und Client. Die Grössen-/Längengrenzen
 * liegen in `limits.ts` — sonst müsste die Server Action `./ai-client` importieren, und genau
 * diese relative Schreibweise umgeht die ESLint-Bremse (Begründung dort).
 */

/**
 * Das Modell für die Zuordnung.
 *
 * ── WARUM DIESELBE STUFE WIE DIE BEIDEN BESTEHENDEN SCANS, OBWOHL DIE AUFGABE GRÖBER IST ──────
 * Der Gedanke, hier eine günstigere Stufe zu nehmen, liegt nahe: ein Fehlurteil kostet nichts, weil
 * ein Mensch es in der Bestätigungsliste sieht und korrigiert — das ist genau die Stufe, die den
 * beiden anderen Scans vorgelagert fehlt. Er wird trotzdem NICHT umgesetzt, und der Grund ist
 * Messbarkeit statt Meinung: für diesen Bauabschnitt lag KEIN `ANTHROPIC_API_KEY` vor (er steht in
 * Vercel als `sensitive` und ist nicht zurücklesbar), ein Wechsel der Modellstufe wäre also gegen
 * die echte API ungeprüft. `claude-sonnet-5` ist die Stufe, für die dieser exakte Aufruf-Pfad
 * (Dokument-Block, `json_schema`) bereits gegen die echte API belegt ist.
 *
 * Eine günstigere Stufe ist ein eigener, MESSBARER Schritt: eine Handvoll echter Dokumente, beide
 * Stufen, Trefferquote nebeneinander. Sie hier still zu wählen hiesse, eine Kostenfrage über eine
 * Annahme zu entscheiden.
 *
 * ⚠ Die Kennung ist vollständig — KEIN Datums-Suffix anhängen.
 */
export const UPLOAD_CLASSIFICATION_MODEL = 'claude-sonnet-5'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} fehlt. Die Dokument-Zuordnung (Delta 17) braucht den KI-Zugang; ` +
        `s. DEPLOYMENT.md §1-Website-c.`,
    )
  }
  return value
}

/**
 * Frischer Client je Aufruf (kein Modul-Singleton — dieselbe Begründung wie beim Supabase-Client:
 * ein über Requests geteilter Client-Zustand ist in einer Server-Umgebung unnötig).
 */
export function createUploadClassificationClient(): Anthropic {
  return new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') })
}

/** Ist der KI-Zugang eingerichtet? Für die Anzeige, ohne einen Client zu bauen. */
export function isUploadClassificationConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}
