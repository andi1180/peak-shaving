/**
 * Konstanten des Admin-Bereichs (T4-4). Reines Konstanten-Modul ohne `server-only` und ohne
 * `next/*`-Import — es wird von der MIDDLEWARE (Edge-Runtime), von Server Components UND von
 * Client-Komponenten gelesen. Gleiche Rolle wie `lib/auth/config.ts` für den Auth-Bereich.
 */

/**
 * Basispfad des Admin-Bereichs — OHNE Locale-Präfix. Die Route liegt bewusst außerhalb von
 * `app/(site)/[locale]/`: ein interner Verwaltungsbereich ist kein Seiteninhalt und braucht keine
 * Übersetzung (Website-Pflichtenheft Prinzip 5 zielt auf öffentliche, indexierbare Seiten).
 * Die Middleware nimmt genau diesen Pfad vom next-intl-Routing aus.
 */
export const ADMIN_HREF = '/admin'

/**
 * Die Produkte, für die ein Gutscheincode ausgestellt werden kann — Spiegel des Postgres-Enums
 * `platform.product_key`. Weicht die Liste ab, lehnt die Datenbank den Wert ohnehin ab; sie steht
 * hier, damit das Formular ein Auswahlfeld statt eines freien Textfelds zeigen kann.
 */
export const PRODUCT_KEYS = ['monitor', 'calculator_pro'] as const
export type ProductKey = (typeof PRODUCT_KEYS)[number]

/** Anzeigenamen der Produkte (der Enum-Wert selbst ist kein Nutzertext). */
export const PRODUCT_LABELS: Record<ProductKey, string> = {
  monitor: 'Strom-Monitor',
  calculator_pro: 'Kalkulator Pro',
}

/**
 * Die vergebbaren Rollen — Spiegel des CHECK auf `platform.user_roles.role`. Aktuell genau eine.
 * Wird der CHECK per Migration geweitet, ist diese Liste mitzuziehen (die DB bleibt die harte Grenze).
 */
export const ROLES = ['admin'] as const
export type Role = (typeof ROLES)[number]
