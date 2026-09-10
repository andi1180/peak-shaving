import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

/**
 * B24 — SERVER-ONLY Anthropic-Client des Projekt-Chats. Die SIEBTE KI-Anbindung des Repos.
 *
 * ── ⚠ WAS HIER ANDERS IST ALS BEI DEN SECHS BESTEHENDEN ─────────────────────────────────────────
 * Die sechs Anbindungen (Rechnungs-Scan, Tarifblatt-Scan, Upload-Zuordnung, Batterie-Freitext,
 * Report-Anfrage, PV-Scan) sind EINSCHÜSSIG: eine Nachricht hinein, ein Schema heraus, kein
 * Zustand (Bestandsaufnahme, Befund C). Diese hier ist die erste mit einer SCHLEIFE — Werkzeugaufruf,
 * Ergebnis, weiter — und damit die erste, bei der EIN Nutzer-Turn mehrere abrechenbare Aufrufe
 * auslöst. Deshalb steht die Obergrenze unten im selben Modul wie der Schlüssel: sie ist keine
 * Bedienhilfe, sondern die einzige Sperre gegen eine Schleife, die sich nicht mehr beendet.
 *
 * ── DER SCHLÜSSEL IST EIN GEHEIMNIS AUF DER EBENE DES SERVICE-ROLE-SCHLÜSSELS ──────────────────
 * Er ist auf die Rechnung des Kontos abrechenbar und hat kein Kontingent, das ihn begrenzte. Ein
 * Leck merkt man an der Abrechnung, nicht an einem Fehler. Deshalb dieselben DREI SPERREN wie beim
 * Tarifblatt-Scan (`lib/admin/tariff-scan/ai-client.ts`) und beim service_role-Schlüssel:
 *
 *   1. `import 'server-only'` — ein Import aus einer Client-Komponente bricht den Build HART.
 *   2. ESLint `no-restricted-imports` (root `eslint.config.mjs`) erlaubt dieses Modul in GENAU
 *      EINER Datei: `apps/web/lib/project-chat/model.ts`. Nicht das Verzeichnis — daneben liegen
 *      der Werkzeug-Ausführer und die Schleife, und die sollen sich ihren Zugang nicht selbst
 *      bauen können.
 *   3. Zugriff auf die Env erst BEI GEBRAUCH, nie als Modul-Konstante. Ohne den Schlüssel läuft
 *      der gesamte übrige Admin-Bereich unverändert weiter.
 */

/**
 * Das Modell des Chats.
 *
 * ── SONNET, UND ZWAR AUSDRÜCKLICH ALS ERSTE FASSUNG ───────────────────────────────────────────
 * Die MECHANIK dieses Schritts (Schleife, Werkzeug-Vertrag, Persistenz) ist gut spezifizierbar und
 * verlangt keine Spitzenstufe; sie ist an den Werkzeugschemata und den Ausführer-Tests messbar.
 * Die GESPRÄCHSFÜHRUNG ist es nicht — ob das Modell beide Wege aus §3.3 wirklich anbietet, ob es
 * früh genug nach dem Segment fragt, ob es eine Annahme sauber begründet, entscheidet sich am Ton
 * und ist gegen einen echten Vergleichsfall abzustimmen. Diese Abstimmung ist ein EIGENER Schritt,
 * und ein Wechsel auf Opus ist dort eine der Stellschrauben. Die Kennung steht deshalb an genau
 * einer Stelle.
 *
 * ⚠ Die Kennung ist vollständig — KEIN Datums-Suffix anhängen.
 */
export const PROJECT_CHAT_MODEL = 'claude-sonnet-5'

/**
 * Antwortlänge je Modellaufruf.
 *
 * Ein Chat-Turn ist eine Gesprächsantwort plus womöglich ein paar Werkzeugaufrufe, kein Dokument.
 * 8192 ist dafür grosszügig und hält den Aufruf ohne Streaming weit unter jeder HTTP-Zeitgrenze
 * (der SDK-Vorgabewert liegt bei 10 Minuten).
 */
export const PROJECT_CHAT_MAX_TOKENS = 8192

/**
 * ⚠ DIE OBERGRENZE DER WERKZEUGAUFRUFE JE NUTZER-TURN — der Deadlock-Schutz.
 *
 * Ein Modell, das sein eigenes Werkzeugergebnis nicht akzeptiert, ruft dasselbe Werkzeug erneut
 * auf. Ohne Obergrenze liefe das, bis die Anfrage abbricht — und jeder Durchlauf ist abrechenbar.
 * Acht ist die Zahl, unter der ein ehrlicher Turn bequem bleibt (Dokument einordnen, auslesen,
 * drei, vier Felder setzen, eine Rückfrage stellen) und über der nichts mehr entsteht, was ein
 * Mensch als Fortschritt erkennen würde.
 *
 * ⚠ ES IST KEINE KOSTENBREMSE. Sie begrenzt EINEN Turn, nicht die Zahl der Turns und nicht die
 * Ausgaben eines Kontos — die gehört zu Delta §6.3 und ist ausdrücklich noch nicht gebaut. Solange
 * sie fehlt, hat dieser Pfad bewusst KEINEN HTTP-Rand (s. Kopf von `chat.ts`).
 */
export const MAX_TOOL_CALLS_PER_TURN = 8

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} fehlt. Der Projekt-Chat (B24) braucht den KI-Zugang; s. DEPLOYMENT.md §1l.`,
    )
  }
  return value
}

/**
 * Frischer Client je Aufruf (kein Modul-Singleton — dieselbe Begründung wie bei den sechs
 * bestehenden Anbindungen: ein über Requests geteilter Client-Zustand bringt in einer
 * Server-Umgebung nichts und verwischt die Zuordnung).
 */
export function createProjectChatClient(): Anthropic {
  return new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') })
}

/** Ist der KI-Zugang eingerichtet? Für die Anzeige, ohne einen Client zu bauen. */
export function isProjectChatConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}
