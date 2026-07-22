/**
 * Zugang zum Pro-Kalkulator (`/peak-shaving/kalkulator/rechner`) — B10, Schritt 2.
 *
 * ── WAS DIESES MODUL ABLÖST ─────────────────────────────────────────────────────────────────────
 * Bis hierher hing der Zugang an `lib/kalkulator-access.ts`: einem geteilten Zugangscode
 * (`coolin2026`), der im Client-Bundle stand und ausdrücklich KEINE Sicherheit war — er hielt
 * Zufallsbesucher ab, nicht einen Entschlossenen. Diese Datei ist gelöscht, samt dem Dialog
 * (`components/peak-shaving/calculator-gate.tsx`), in den man den Code eingeben konnte. Der Code
 * kann danach nichts mehr bewirken, weil es die Stelle nicht mehr gibt, an der er geprüft wurde.
 *
 * (Anmerkung, weil die Zeichenfolge dieselbe ist und sonst Verwirrung stiftet: In
 * `platform.redemption_codes` existiert seit T4-3 ein GUTSCHEINCODE namens `coolin2026` — für das
 * Produkt `monitor`. Das ist ein anderer Mechanismus mit anderer Wirkung: eingelöst wird er auf
 * `/konto`, und er schaltet den Strom-Monitor frei, nicht den Kalkulator. Codes sind global
 * eindeutig (`unique index on lower(code)`), es kann also gar keinen zweiten `coolin2026` für
 * `calculator_pro` geben.)
 *
 * ── DIE ZUGANGS-WAHRHEIT ────────────────────────────────────────────────────────────────────────
 * Ab jetzt: eine Sitzung (Supabase-Auth, T4-2) PLUS ein aktives Entitlement für `calculator_pro`.
 * Gelesen wird über denselben Wrapper, den die Kontoseite für den Monitor benutzt
 * (`public.get_my_entitlement`, T4-2) — das Produkt ist dort ein PARAMETER, es gibt bewusst keinen
 * zweiten Lesepfad und keine zweite Definition von „hat Zugang" (Invariante I1).
 *
 * Kein Browser-Client, keine `NEXT_PUBLIC_*`-Supabase-Env: Die Entscheidung fällt serverseitig,
 * BEVOR etwas gerendert wird (Invariante J1/J6, wie `/konto` und `/admin`).
 */
import 'server-only'
import { createClient } from '@/lib/supabase/server'

/**
 * Produktschlüssel des Pro-Kalkulators — Wert des Postgres-Enums `platform.product_key`, das seit
 * T4-1 BEIDE Produkte führt (`monitor`, `calculator_pro`). B10 Schritt 1 hat nachgewiesen, dass
 * der Lesepfad mit diesem zweiten Wert tatsächlich läuft und die Produkte voneinander isoliert
 * sind — ein Monitor-Abo schaltet den Kalkulator nicht frei.
 */
export const CALCULATOR_PRODUCT = 'calculator_pro' as const

/**
 * Die drei Zustände, die die Route unterscheiden MUSS — und der Grund, warum es drei sind und
 * nicht zwei: „nicht angemeldet" und „angemeldet, aber ohne Zugang" verlangen entgegengesetzte
 * Antworten. Der erste ist eine Umleitung (der Besucher kann selbst etwas tun: sich anmelden),
 * der zweite ausdrücklich KEINE — wer angemeldet ist und trotzdem umgeleitet würde, liefe im
 * Kreis. Er bekommt eine erklärende Seite mit einem Weg zum Zugang.
 */
export type CalculatorAccess =
  | { state: 'anonymous' }
  /** Die Adresse fährt mit: Der Anfrage-Zustand nennt sie, damit ein Nutzer mit zwei Konten den
   *  Fehler nicht beim Zugang sucht, wenn er ihn bei der Anmeldung gemacht hat. */
  | { state: 'no_entitlement'; email: string | undefined }
  | { state: 'granted' }

/**
 * Beantwortet für den AKTUELLEN Request, ob der Rechner ausgeliefert werden darf.
 *
 * ── FAIL CLOSED ─────────────────────────────────────────────────────────────────────────────────
 * Kann das Entitlement nicht gelesen werden (Netz, RLS, abgelaufenes JWT), gilt `no_entitlement` —
 * NICHT `granted`. Ein Lesefehler ist keine Zusage. Die Abwägung ist asymmetrisch: ein zu Unrecht
 * ausgesperrter zahlender Kunde sieht eine erklärende Seite mit einem Kontaktweg und meldet sich;
 * ein zu Unrecht freigeschalteter Besucher meldet sich nie, und niemand erfährt davon.
 *
 * Der Vergleich ist bewusst `=== true` und nicht truthy: `data` ist der rohe RPC-Rückgabewert.
 * Käme dort je etwas anderes als ein Boolean an (ein String `'false'` etwa wäre truthy), öffnete
 * eine lose Prüfung den Zugang. Ein Vergleich auf den einen erlaubten Wert kann das nicht.
 */
export async function getCalculatorAccess(): Promise<CalculatorAccess> {
  const supabase = await createClient()

  // `getUser()` (nicht `getSession()`): Es validiert das Token gegen den Auth-Server, statt einem
  // Cookie zu glauben. Dieselbe Wahl wie auf `/konto` und im Admin-Bereich.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { state: 'anonymous' }

  const { data, error } = await supabase.rpc('get_my_entitlement', { p_product: CALCULATOR_PRODUCT })
  if (error) {
    console.error('[kalkulator] get_my_entitlement:', error)
    return { state: 'no_entitlement', email: user.email }
  }

  return data === true ? { state: 'granted' } : { state: 'no_entitlement', email: user.email }
}
