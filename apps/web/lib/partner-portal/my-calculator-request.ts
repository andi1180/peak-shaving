/**
 * DIE EIGENE, LETZTE KALKULATOR-ANFRAGE — der reine Teil (B18-4, Portal-Oberfläche).
 *
 * REIN: kein `server-only`, kein `next/*`, kein Supabase-Client — dieselbe Aufteilung wie
 * `lib/partner-portal/leads.ts` (B18-6) und `lib/partner-portal/portal.ts` (B18-3). Der Leser
 * übersetzt die Antwort von `public.get_my_calculator_request` in einen Zustand, den die Oberfläche
 * kennt; die Verdrahtung steht in `calculator-request-server.ts`.
 *
 * ── VIER ZUSTÄNDE, UND KEINE ZWEI DAVON DÜRFEN VERSCHMELZEN ─────────────────────────────────────
 * An jedem hängt eine andere Darstellung, und drei davon sähen einander verwechselt richtig aus:
 *
 *   `request`  Es gibt eine (die letzte). Ihr Status entscheidet, was die Seite zeigt.
 *   `never`    Dieser Betrieb hat noch NIE angefragt → Beschreibung und Formular.
 *   `none`     Kein aktiver Partnerzugang. NICHT dasselbe wie `never`: Aus `never` folgt ein
 *              Formular, aus `none` die Erklärseite. Beides in einen Wert zu legen zwänge die
 *              Seite zu raten.
 *   `error`    Wir wissen es nicht.
 *
 * ── ⚠ `error` DARF NIE ZU EINEM FORMULAR FÜHREN ─────────────────────────────────────────────────
 * Ein Lesefehler als „noch nie angefragt" gelesen stellte einem Betrieb, dessen Anfrage seit
 * gestern offen ist, ein leeres Formular hin — er reichte ein zweites Mal ein, bekäme
 * `already_pending` und hielte das für einen Fehler. Deshalb ist ein unbekannter oder
 * fehlgeschlagener Rückgabewert ausdrücklich ein EIGENER Zustand und nicht der freundlichste
 * benachbarte. **Das deckt auch den Fall ab, dass die Migration auf der Zieldatenbank noch nicht
 * liegt:** PostgREST antwortet dann mit einem Fehler zur unbekannten Funktion, und der Reiter sagt
 * „gerade nicht abrufbar", statt eine Anfrage anzubieten, deren Vorgeschichte er nicht kennt.
 */

/** Die drei Zustände einer Anfrage — deckungsgleich mit `platform.calculator_request_status`. */
export const MY_CALCULATOR_REQUEST_STATUSES = ['pending', 'approved', 'rejected'] as const
export type MyCalculatorRequestStatus = (typeof MY_CALCULATOR_REQUEST_STATUSES)[number]

function isStatus(value: unknown): value is MyCalculatorRequestStatus {
  return (
    typeof value === 'string' &&
    (MY_CALCULATOR_REQUEST_STATUSES as readonly string[]).includes(value)
  )
}

/**
 * Die eigene Anfrage, so wie der Wrapper sie liefert.
 *
 * `reviewedAt` ist der Zeitpunkt der Entscheidung — bei `pending` `null`. Wer entschieden hat,
 * fährt bewusst NICHT mit (B18-4-Portal-Schema: eine Auskunft über unsere Organisation), ebenso
 * wenig der Benachrichtigungsvermerk.
 */
export type MyCalculatorRequest = {
  id: string
  status: MyCalculatorRequestStatus
  message: string
  createdAt: string | null
  reviewedAt: string | null
}

export type MyCalculatorRequestState =
  | { state: 'request'; request: MyCalculatorRequest }
  | { state: 'never' }
  | { state: 'none' }
  | { state: 'error' }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

export function readMyCalculatorRequest(
  data: unknown,
  error?: unknown,
): MyCalculatorRequestState {
  if (error) return { state: 'error' }

  const payload = asRecord(data)
  const status = payload ? asString(payload.status) : null

  if (status === 'none') return { state: 'none' }
  if (status !== 'ok') return { state: 'error' }

  /*
   * `request: null` ist die AUSSAGE „noch nie angefragt" und wird deshalb als eigener Zustand
   * gelesen. Ein FEHLENDES Feld dagegen ist keine Aussage — dann hat der Wrapper etwas anderes
   * geantwortet, als diese Fassung erwartet, und `error` ist die ehrliche Antwort.
   */
  if (payload!.request === null) return { state: 'never' }

  const row = asRecord(payload!.request)
  if (!row) return { state: 'error' }

  const id = asString(row.id)
  /*
   * Ohne Kennung oder ohne bekannten Status ist die Zeile nicht verwertbar — und sie zu verwerfen
   * hiesse hier, sie in ein Formular zu verwandeln (der Betrieb sähe „noch nie angefragt"). Genau
   * das darf nicht passieren, also `error`.
   */
  if (!id || !isStatus(row.status)) return { state: 'error' }

  return {
    state: 'request',
    request: {
      id,
      status: row.status,
      // Ein leerer Text ist kein Grund, den Zustand zu verwerfen: Die Anfrage besteht, ihr Text ist
      // nur nicht darstellbar. Die Datenbank lässt ihn ohnehin nicht leer entstehen.
      message: typeof row.message === 'string' ? row.message : '',
      createdAt: asString(row.created_at),
      reviewedAt: asString(row.reviewed_at),
    },
  }
}
