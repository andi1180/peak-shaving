/*
 * Schnellzugriff (Leadgen 6): wo der Profi-Report-Button im Header und die mobile Leiste unten
 * stehen. Rein, ohne React — die Komponente liest nur den Pfad und den fokussierten Knoten.
 */
import { PROFI_REPORT_HREF } from '@/lib/nav'

export type QuickAccessVariant = 'profi_report' | 'jetzt_anfragen'

/** Konto, Partnerportal, Login, eingebetteter Rechner und Bestätigungs-/Abmeldeseiten. */
const EXCLUDED_PATHS = [
  '/anmelden',
  '/login',
  '/registrieren',
  '/konto',
  '/passwort-neu',
  '/passwort-vergessen',
  '/partner-portal',
  '/partner-aktivieren',
  '/kalkulator',
  '/peak-shaving/kalkulator/rechner',
  '/einwilligung-bestaetigen',
  '/abmelden',
]

function normalize(pathname: string): string {
  const path = pathname.replace(/^\/de(?=\/|$)/, '').replace(/\/+$/, '')
  return path === '' ? '/' : path
}

/** `null`: kein Schnellzugriff (Header bleibt wie vor Schritt 6). */
export function quickAccessVariant(pathname: string): QuickAccessVariant | null {
  const path = normalize(pathname)
  if (EXCLUDED_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return null
  return path === PROFI_REPORT_HREF ? 'jetzt_anfragen' : 'profi_report'
}

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

type FocusTarget = { tagName?: string; type?: string; isContentEditable?: boolean }

/** Eingabe-, Auswahl- oder Textfeld — solange eines davon den Fokus hat, weicht die Leiste. */
export function isTextEntry(target: FocusTarget | null | undefined): boolean {
  if (!target?.tagName) return false
  const tag = target.tagName.toLowerCase()
  if (tag === 'textarea' || tag === 'select') return true
  if (tag === 'input') return !NON_TEXT_INPUT_TYPES.has((target.type ?? 'text').toLowerCase())
  return target.isContentEditable === true
}
