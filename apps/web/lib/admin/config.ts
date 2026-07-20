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
 * Die Produkte, für die HEUTE ein Gutscheincode ausgestellt werden darf — eine ECHTE Teilmenge von
 * `PRODUCT_KEYS`, und zwar aus einem fachlichen Grund, nicht aus Bequemlichkeit.
 *
 * Der Pro-Kalkulator prüft `platform.entitlements` an KEINER Stelle: sein Zugang hängt weiterhin am
 * separaten, DB-losen Zugangscode in `lib/kalkulator-access.ts`. Ein für `calculator_pro`
 * eingelöster Gutscheincode schriebe also brav eine Entitlement-Zeile, die im echten Kalkulator
 * nichts bewirkt — der Kunde hätte bezahlt und stünde trotzdem vor dem Code-Dialog. Das ist der
 * unangenehmste aller Fehler: er sieht bis zum Einlösen wie ein Erfolg aus.
 *
 * Deshalb steht `calculator_pro` NICHT zur Auswahl. Der Enum-Wert bleibt in der Datenbank (und in
 * `PRODUCT_KEYS`, damit bestehende Zeilen weiter korrekt beschriftet werden) — er wird nur nicht
 * mehr angeboten. Sobald Phase 2 den Kalkulator an das Entitlement-System anbindet, ist die
 * Rücknahme dieser Einschränkung ein Einzeiler hier.
 */
export const CODE_PRODUCT_KEYS = ['monitor'] as const
export type CodeProductKey = (typeof CODE_PRODUCT_KEYS)[number]

/**
 * Die vergebbaren Rollen — Spiegel des CHECK auf `platform.user_roles.role`. Aktuell genau eine.
 * Wird der CHECK per Migration geweitet, ist diese Liste mitzuziehen (die DB bleibt die harte Grenze).
 */
export const ROLES = ['admin'] as const
export type Role = (typeof ROLES)[number]
