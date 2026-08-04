import { PORTAL_HOST_ROOT, PORTAL_MARKETING_PATH } from '@/lib/portal-host'

/**
 * DIE REITER DES PORTALBEREICHS (B18-3) — Fundort der Navigationspunkte.
 *
 * REIN: kein `server-only`, kein `next/*`, keine Datenbank. Der Rahmen liest die Liste, die
 * Navigation stellt sie dar, ein Test prüft sie gegen die Ablage.
 *
 * ── DIE HREFS SIND DIE ADRESSEN AUF DEM PORTAL-HOST, NICHT DIE RENDER-PFADE ─────────────────────
 * `/` und `/marketing` — nicht `/portal` und `/portal/marketing`. Der Render-Baum ist von aussen
 * unerreichbar (`lib/portal-host.ts`); ein Link dorthin führte in die 404 des Wächters. Sie kommen
 * deshalb ABGELEITET aus `PORTAL_AREA_PATHS`-Konstanten statt getippt: zwei Auslegungen derselben
 * Adresse liefen beim ersten Umbenennen auseinander, und zwar still — der Reiter wäre da, nur der
 * Klick ginge ins Leere.
 *
 * ── BESCHRIFTUNG ALS SCHLÜSSEL, NICHT ALS TEXT ─────────────────────────────────────────────────
 * Anders als im Admin-Bereich (`lib/admin/nav.ts`, wo die Labels als deutsche Zeichenketten stehen)
 * ist der Portalbereich kundengerichtet und folgt dem Nachrichtenkatalog wie der Rest der Seite
 * (§8.7). Die Punkte tragen deshalb einen Schlüssel unter `PartnerPortal.nav.*`; die Auflösung
 * passiert in der Navigation.
 *
 * ⚠ B18-4 (Peak Shaving) und B18-6 (Leads) sind bewusst NICHT als deaktivierte Platzhalter
 * angelegt: Ein Reiter, der nichts tut, ist Bauaufwand, den der tatsächliche Bau wieder anfassen
 * muss — und er verspricht dem Fachbetrieb etwas, das es noch nicht gibt. Sie kommen als je EIN
 * Eintrag in dieser Liste plus eine Datei unter `app/portal/`.
 */
export type PortalNavItem = {
  /** Adresse AUF DEM PORTAL-HOST. */
  href: string
  /** Schlüssel unter `PartnerPortal.nav` in `messages/de.json`. */
  labelKey: string
}

export const PORTAL_NAV_ITEMS: readonly PortalNavItem[] = [
  { href: PORTAL_HOST_ROOT, labelKey: 'general' },
  { href: PORTAL_MARKETING_PATH, labelKey: 'marketing' },
] as const
