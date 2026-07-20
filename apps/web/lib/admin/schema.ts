/**
 * Validierung + State-Contract der Admin-Formulare (T4-4).
 *
 * REIN: kein `server-only`, kein `next/*`-Import — die Client-Formulare importieren von hier den
 * Initialzustand, die Server Actions die Schemata. Gleiche Aufteilung wie `lib/auth/schema.ts` /
 * `lib/redemption/schema.ts` (eine `'use server'`-Datei darf nur async Actions exportieren).
 *
 * ── UNTERSCHIED ZU DEN AUTH-FORMULAREN, BEWUSST ──────────────────────────────────────────────────
 * Dort sind Fehlerwerte KEYS (`emailRequired`), die das Formular gegen `messages/de.json` auflöst.
 * Hier stehen fertige deutsche SÄTZE: der Admin-Bereich liegt außerhalb der next-intl-Struktur und
 * hat keinen Übersetzungskontext. Ein Key-Umweg ohne Wörterbuch wäre eine Indirektion ohne Nutzen.
 */
import { z } from 'zod'
import { PRODUCT_KEYS, ROLES } from './config'

/**
 * Rückgabe aller Admin-Server-Actions. Ein gemeinsamer Zustand für alle sechs, weil sie strukturell
 * gleich sind: Erfolgsmeldung ODER Fehler (formular-weit bzw. am Feld). `values` trägt die Eingabe
 * zurück ins Formular, damit eine abgelehnte Anlage nicht neu getippt werden muss.
 */
export type AdminState = {
  /** Fertige Erfolgsmeldung, z. B. „Ziel ‚wien-energie' angelegt." */
  success?: string
  /** Formular-weiter Fehler (fertiger Text). */
  formError?: string
  /** Feld-Fehler (fertiger Text), Schlüssel = `name` des Feldes. */
  fieldErrors?: Record<string, string>
  /** Zur Wiederanzeige mitgeführte Eingabewerte. */
  values?: Record<string, string>
}

export const ADMIN_INITIAL_STATE: AdminState = {}

/** Erste Meldung je Feld. Reihenfolge egal — die Formulare fokussieren nach ihrer FIELD_ORDER. */
export function toFieldErrors(issues: z.ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of issues) {
    const field = issue.path[0]
    if (typeof field === 'string' && !(field in out)) out[field] = issue.message
  }
  return out
}

// ── Scraper-Ziel ──────────────────────────────────────────────────────────────────────────────────
// Der Slug wird hier auf dieselbe Form geprüft wie im Wrapper (`^[a-z0-9][a-z0-9-]*$`). Doppelt,
// aber nicht redundant: die DB bleibt die harte Grenze (sie sieht auch Aufrufe an diesem Formular
// vorbei), das Schema hier liefert die Meldung AM FELD statt eines Status nach dem Roundtrip.
export const scrapeTargetSchema = z.object({
  providerSlug: z
    .string()
    .trim()
    .min(1, 'Bitte einen Kurz-Key angeben.')
    .max(64, 'Höchstens 64 Zeichen.')
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      'Nur Kleinbuchstaben, Ziffern und Bindestriche, beginnend mit Buchstabe oder Ziffer.',
    ),
  providerName: z.string().trim().min(1, 'Bitte den Anbieternamen angeben.').max(200, 'Zu lang.'),
  tariffPageUrl: z
    .string()
    .trim()
    .min(1, 'Bitte die Adresse der Tarifseite angeben.')
    .url('Bitte eine vollständige Adresse angeben, z. B. https://beispiel.at/tarife'),
  networkArea: z.string().trim().max(200, 'Zu lang.').optional(),
  sortPriority: z.coerce
    .number({ invalid_type_error: 'Bitte eine ganze Zahl angeben.' })
    .int('Bitte eine ganze Zahl angeben.')
    .min(0, 'Mindestens 0.')
    .max(9999, 'Höchstens 9999.'),
  notes: z.string().trim().max(2000, 'Zu lang.').optional(),
  isActive: z.boolean(),
})

// ── Rollenvergabe ────────────────────────────────────────────────────────────────────────────────
export const roleSchema = z.object({
  userId: z.string().uuid('Bitte eine Nutzer-ID auswählen.'),
  role: z.enum(ROLES, { errorMap: () => ({ message: 'Unbekannte Rolle.' }) }),
})

// ── Gutscheincode ────────────────────────────────────────────────────────────────────────────────
export const codeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3, 'Mindestens 3 Zeichen.')
    .max(64, 'Höchstens 64 Zeichen.')
    .regex(/^\S+$/, 'Der Code darf keine Leerzeichen enthalten.'),
  productKey: z.enum(PRODUCT_KEYS, { errorMap: () => ({ message: 'Unbekanntes Produkt.' }) }),
  /**
   * Leer = unbegrenzt (Marketing-/Partner-Code, in der DB NULL). Bewusst `''` → undefined statt
   * `0`: ein leeres Feld ist „keine Obergrenze", nicht „null Einlösungen".
   */
  maxRedemptions: z
    .union([z.literal(''), z.coerce.number().int('Bitte eine ganze Zahl angeben.').min(1, 'Mindestens 1.')])
    .transform((v) => (v === '' ? undefined : v))
    .optional(),
  /** Leer = unbefristet. `datetime-local` liefert lokale Zeit ohne Zone. */
  expiresAt: z
    .union([z.literal(''), z.string().datetime({ local: true })])
    .transform((v) => (v === '' ? undefined : v))
    .optional(),
  note: z.string().trim().max(500, 'Zu lang.').optional(),
})

/** Nur die ID + der Zielzustand — für die Schnell-Toggles (Ziel aktiv/inaktiv, Code aktiv/inaktiv). */
export const toggleSchema = z.object({
  id: z.string().uuid('Unbekannter Eintrag.'),
  isActive: z.boolean(),
})
