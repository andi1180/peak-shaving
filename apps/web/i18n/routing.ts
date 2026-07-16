import { defineRouting } from 'next-intl/routing'

/**
 * i18n-Routing (Pflichtenheft §8.7).
 *
 * Phase 1 ist NUR Deutsch — aber die Struktur ist die eines mehrsprachigen
 * Projekts. Eine weitere Sprache = ein Eintrag in `locales` + eine Datei
 * `messages/<locale>.json`. KEIN Strukturumbau.
 *
 * `localePrefix: 'as-needed'` heißt: die Default-Locale läuft OHNE Präfix
 * (`/leistungen`, nicht `/de/leistungen`) — die bestehenden URLs und die
 * SEO-Arbeit (§6) bleiben damit unangetastet. Erst eine zweite Sprache
 * bekommt ihr Präfix (`/en/leistungen`).
 */
export const routing = defineRouting({
  locales: ['de'],
  defaultLocale: 'de',
  localePrefix: 'as-needed',
})

export type Locale = (typeof routing.locales)[number]
