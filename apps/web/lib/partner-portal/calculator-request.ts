/**
 * DIE KALKULATOR-ANFRAGE EINES FACHBETRIEBS — der reine Teil (B18-4).
 *
 * REIN: kein `server-only`, kein `next/*`, kein Supabase-Client. Was hier steht, ist ohne laufende
 * Datenbank prüfbar — dieselbe Aufteilung wie `lib/partner-portal/leads.ts` (B18-6) und
 * `lib/partner-portal/portal.ts` (B18-3): der Leser übersetzt die Antwort des Wrappers in einen
 * Zustand, den die Oberfläche kennt, und die Verdrahtung bleibt woanders.
 *
 * ── DER LESER RÄT NICHTS ────────────────────────────────────────────────────────────────────────
 * Jede Antwort, die nicht eindeutig einem bekannten Zustand entspricht, wird zu `error` — und
 * `error` ist ausdrücklich ETWAS ANDERES als „ging nicht durch". Eine unbekannte Antwort als
 * Ablehnung zu lesen hiesse, einem Betrieb zu sagen, seine Anfrage sei nicht angekommen, obwohl
 * niemand das weiss; als Erfolg gelesen wäre es die umgekehrte Lüge. Dieselbe Trennung wie zwischen
 * „leer" und „gerade nicht abrufbar" im Anfragen-Reiter (B18-6).
 */

/**
 * Die Obergrenze des Begründungstexts — dieselbe Zahl wie der CHECK auf
 * `platform.calculator_requests.message`.
 *
 * ⚠ SIE STEHT HIER NUR FÜR DEN HINWEIS VOR DEM ABSENDEN, NICHT ALS ENTSCHEIDUNG. Entschieden wird
 * in der Datenbank: `public.submit_calculator_request` weist zu langen Text mit
 * `{status: message_too_long, max_length}` ab und liefert die geltende Zahl MIT. Eine Oberfläche,
 * die diese Konstante anzeigt und trotzdem den zurückgegebenen Wert auswertet, kann deshalb nicht
 * still auseinanderlaufen — sie könnte höchstens vorab die falsche Zahl nennen. Das DB-Gate pinnt
 * den Rückgabewert auf 4000.
 */
export const MAX_CALCULATOR_REQUEST_MESSAGE_LENGTH = 4000

/**
 * Was aus einer Einreichung geworden ist. Sechs Werte, weil sechs verschiedene Sätze folgen:
 *
 *   `ok`                Die Anfrage liegt vor.
 *   `none`              Kein aktiver Partnerzugang — deckt „kein Partner", „stillgelegt" und „nicht
 *                       angemeldet" in EINER Antwort ab (so wie der Wrapper; die Anwendung kann den
 *                       dritten Zustand gar nicht erst erfinden, s. `get_my_partner`, B16-4b).
 *   `missing_fields`    Der Begründungstext fehlt.
 *   `message_too_long`  Zu lang — mit der Zahl, die tatsächlich gilt.
 *   `already_pending`   ⚠ Es liegt bereits eine offene Anfrage vor. KEIN Fehler des Betriebs und
 *                       ausdrücklich kein stilles Verwerfen: Zeitpunkt und Kennung fahren mit,
 *                       damit die Oberfläche sagen kann, seit wann sie offen ist.
 *   `error`             Wir wissen es nicht (s. Kopf).
 */
export type CalculatorRequestSubmission =
  | { status: 'ok'; requestId: string }
  | { status: 'none' }
  | { status: 'missing_fields' }
  | { status: 'message_too_long'; maxLength: number }
  | { status: 'already_pending'; requestId: string; createdAt: string | null }
  | { status: 'error' }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * Übersetzt die Antwort von `public.submit_calculator_request`.
 *
 * `error` liegt vor, sobald der Aufruf selbst scheitert ODER die Antwort keinen bekannten Zustand
 * trägt. ⚠ Das deckt ausdrücklich den Fall ab, dass die Migration auf der Zieldatenbank noch nicht
 * liegt: PostgREST antwortet dann mit einem Fehler zur unbekannten Funktion, und die Oberfläche
 * sagt „gerade nicht möglich" — sie behauptet nicht, der Betrieb habe keinen Partnerzugang.
 */
export function readCalculatorRequestSubmission(
  data: unknown,
  error?: unknown,
): CalculatorRequestSubmission {
  if (error) return { status: 'error' }

  const row = asRecord(data)
  const status = row ? asString(row.status) : null

  switch (status) {
    case 'ok': {
      const requestId = asString(row?.request_id)
      // Ein `ok` ohne Kennung ist kein Erfolg, den man weitermelden kann — die Kennung ist es, die
      // die interne Benachrichtigung überhaupt zuordenbar macht.
      return requestId ? { status: 'ok', requestId } : { status: 'error' }
    }
    case 'none':
      return { status: 'none' }
    case 'missing_fields':
      return { status: 'missing_fields' }
    case 'message_too_long': {
      const max = typeof row?.max_length === 'number' ? row.max_length : null
      return {
        status: 'message_too_long',
        // Fehlt die Zahl, gilt die hier hinterlegte — dann steht in der Meldung eine Zahl, die
        // stimmt, statt gar keiner.
        maxLength: max ?? MAX_CALCULATOR_REQUEST_MESSAGE_LENGTH,
      }
    }
    case 'already_pending': {
      const requestId = asString(row?.request_id)
      return requestId
        ? { status: 'already_pending', requestId, createdAt: asString(row?.created_at) }
        : { status: 'error' }
    }
    default:
      return { status: 'error' }
  }
}
