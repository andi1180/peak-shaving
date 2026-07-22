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
import { CODE_PRODUCT_KEYS, ROLES } from './config'

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
// Zwei Schemata, weil es zwei verschiedene Vorgänge sind:
//   roleSchema        — Entzug (und alles, was ein Ziel AUS DER LISTE meint): die user_id ist da.
//   roleByEmailSchema — Vergabe an jemanden, der NOCH KEINE Rolle hat und damit per Definition
//                       nicht in der Admin-Liste steht. Es gibt keine user_id zum Auswählen.
export const roleSchema = z.object({
  userId: z.string().uuid('Bitte eine Nutzer-ID auswählen.'),
  role: z.enum(ROLES, { errorMap: () => ({ message: 'Unbekannte Rolle.' }) }),
})

export const roleByEmailSchema = z.object({
  // Nur Grundform-Prüfung: ob es das Konto WIRKLICH gibt, weiß allein die Datenbank
  // (`user_not_found`). Ein strengeres Muster hier täuschte eine Prüfung vor, die es nicht gibt.
  email: z
    .string()
    .trim()
    .min(1, 'Bitte die E-Mail-Adresse des Kontos angeben.')
    .max(320, 'Zu lang.')
    .email('Bitte eine gültige E-Mail-Adresse angeben.'),
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
  /**
   * NUR die heute code-fähigen Produkte (`CODE_PRODUCT_KEYS`), nicht alle Enum-Werte: ein Code für
   * ein Produkt, das den Zugang gar nicht über Entitlements prüft, wäre ein stiller Blindgänger.
   * Begründung am Fundort der Liste (`lib/admin/config.ts`).
   */
  productKey: z.enum(CODE_PRODUCT_KEYS, { errorMap: () => ({ message: 'Unbekanntes Produkt.' }) }),
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

// ── Fachbetrieb anlegen (B16-2) ──────────────────────────────────────────────────────────────────
/**
 * Der Slug wird hier auf GENAU dieselbe Form geprüft wie der CHECK auf `platform.partners.slug`
 * (`^[a-z0-9-]+$`, B16-1 — wörtlich derselbe wie bei `platform.lead_sources.key` seit B1-1). Doppelt,
 * aber nicht redundant, und hier mit einem eigenen Gewicht: Der Slug ist NACH DEM ANLEGEN
 * UNVERÄNDERLICH (Trigger `guard_partner_slug`), weil er in Mails steht, die ein Fachbetrieb an
 * hunderte Bestandskunden verschickt. Eine Meldung am Feld, BEVOR jemand ihn vergibt, ist deshalb
 * mehr wert als bei jedem anderen Formular dieses Bereichs — der Wrapper würde ihn zwar ebenfalls
 * ablehnen (`invalid_slug` statt 23514), aber erst nach einem Roundtrip und ohne Feldbezug.
 *
 * `toLowerCase()` statt einer Ablehnung: Der Wrapper schreibt den Slug ohnehin kleingeschrieben
 * (B16-1), und „Raymann-Elektro" abzuweisen, statt daraus „raymann-elektro" zu machen, wäre eine
 * Hürde ohne Ertrag — die Bedeutung ist eindeutig, es gibt keine zweite Lesart. Die
 * Formatprüfung läuft NACH dem Kleinschreiben, sonst wäre jeder Grossbuchstabe ein Fehler.
 */
export const partnerSlugSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, 'Mindestens 2 Zeichen.')
    .max(64, 'Höchstens 64 Zeichen.')
    .regex(
      /^[a-z0-9-]+$/,
      'Nur Kleinbuchstaben, Ziffern und Bindestriche — keine Unterstriche, keine Umlaute.',
    ),
  displayName: z
    .string()
    .trim()
    .min(1, 'Bitte den Firmennamen des Fachbetriebs angeben.')
    .max(200, 'Zu lang.'),
})

/** Nur die ID + der Zielzustand — für die Schnell-Toggles (Ziel aktiv/inaktiv, Code aktiv/inaktiv). */
export const toggleSchema = z.object({
  id: z.string().uuid('Unbekannter Eintrag.'),
  isActive: z.boolean(),
})
