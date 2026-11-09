/*
 * Bereich „Software" (/software): die fünf Module als Datenliste. Pfade und Bilder stehen hier,
 * die Texte in `messages/de.json` → `Software` (Wortlaut aus `docs/software-module/texte.md`).
 */
export const SOFTWARE_HREF = '/software'

export type SoftwareModule = {
  /** Schlüssel in `Software.Modules` und Grundlage des Nav-Schlüssels. */
  key: string
  slug: string
}

export const SOFTWARE_MODULES: readonly SoftwareModule[] = [
  { key: 'energieCockpit', slug: 'energie-cockpit' },
  { key: 'ladesteuerung', slug: 'ladesteuerung' },
  { key: 'tarifWaechter', slug: 'tarif-waechter' },
  { key: 'peakWaechter', slug: 'peak-waechter' },
  { key: 'waermepumpenManager', slug: 'waermepumpen-manager' },
]

export function softwareModuleHref(mod: SoftwareModule): string {
  return `${SOFTWARE_HREF}/${mod.slug}`
}

/** Liegt unter `public/software/`, 2400×1520 (Seitenverhältnis 1200:760). */
export function softwareModuleImage(mod: SoftwareModule): string {
  return `/software/${mod.slug}.png`
}

/** Nav-Schlüssel des Moduls (`Nav.software<Key>`). */
export function softwareNavKey(mod: SoftwareModule): string {
  return `software${mod.key.charAt(0).toUpperCase()}${mod.key.slice(1)}`
}

export function findSoftwareModule(key: string): SoftwareModule {
  const mod = SOFTWARE_MODULES.find((m) => m.key === key)
  if (!mod) throw new Error(`Software-Modul "${key}" ist in SOFTWARE_MODULES nicht bekannt`)
  return mod
}

/**
 * Bestehendes Kontaktthema „Energiemanagement & Effizienz" für den CTA — kein eigenes Thema.
 * Nur der Schlüssel steht hier: `lib/nav.ts` liest diese Datei, und `lib/kontakt/themen.ts`
 * importiert `lib/nav.ts` (sonst ein Ringimport).
 */
export const SOFTWARE_KONTAKT_THEMA = 'energiemanagement'

/**
 * Meta-Description aus dem Lead: ganze Sätze, solange sie in `max` Zeichen passen. Passt schon der
 * erste Satz nicht, wird an der letzten Wortgrenze gekürzt.
 */
export function metaDescriptionFromLead(lead: string, max = 160): string {
  const sentences = lead.split(/(?<=[.!?])\s+/)
  let out = ''
  for (const sentence of sentences) {
    const next = out ? `${out} ${sentence}` : sentence
    if (next.length > max) break
    out = next
  }
  if (out) return out
  const cut = lead.slice(0, max - 1)
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`
}
