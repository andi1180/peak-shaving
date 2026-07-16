import { createNavigation } from 'next-intl/navigation'
import { routing } from './routing'

/**
 * Locale-bewusste Navigations-APIs. IMMER diese statt `next/link` verwenden —
 * sie setzen das Locale-Präfix automatisch, sobald eine zweite Sprache aktiv
 * ist. Genau das macht den späteren Sprach-Toggle zu einem Config-Flag
 * statt zu einer Suche über alle Links.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing)
