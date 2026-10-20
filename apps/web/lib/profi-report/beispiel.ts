/*
 * Seitenbilder des Beispiel-Reports (Schritt 4a, `public/beispiel-report/`) — Pfade und Masse für
 * Hero-Stapel und Blätterleiste. Rein; von Server- und Client-Komponenten benutzt.
 */
import { BEISPIEL_REPORT_DIR } from './links'

export type PagerPage = { page: number; title: string; text: string }
export type PagerTocEntry = { title: string; page: number }

const pad = (page: number) => String(page).padStart(2, '0')
export const pageImage = (page: number) => `${BEISPIEL_REPORT_DIR}/seite-${pad(page)}.webp`
export const pageThumb = (page: number) => `${BEISPIEL_REPORT_DIR}/seite-${pad(page)}-vorschau.webp`

/** Seitenbilder: A4 bei 150 dpi. Vorschaubilder: 160 px breit. */
export const PAGE_SIZE = { width: 1241, height: 1754 } as const
export const THUMB_SIZE = { width: 160, height: 227 } as const

/** Das Kapitel, in dem eine Seite liegt: der letzte Eintrag, der auf oder vor ihr beginnt. */
export function chapterOf(toc: PagerTocEntry[], page: number): number | null {
  let found: number | null = null
  for (const entry of toc) if (entry.page <= page) found = entry.page
  return found
}
