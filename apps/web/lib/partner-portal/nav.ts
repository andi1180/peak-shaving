import {
  PORTAL_HOST_ROOT,
  PORTAL_KALKULATOR_PATH,
  PORTAL_LEADS_PATH,
  PORTAL_MARKETING_PATH,
} from '@/lib/portal-host'

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
 * ⚠ B18-4 (Peak Shaving) ist bewusst NICHT als deaktivierter Platzhalter angelegt: Ein Reiter, der
 * nichts tut, ist Bauaufwand, den der tatsächliche Bau wieder anfassen muss — und er verspricht dem
 * Fachbetrieb etwas, das es noch nicht gibt. Er kommt als EIN Eintrag in dieser Liste plus eine
 * Datei unter `app/portal/`. Bei „Leads" (B18-6) war es genau das.
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
  /*
   * B18-6. Die Reihenfolge folgt dem Weg eines Fachbetriebs: erst wer er bei uns ist (Allgemein),
   * dann womit er verweist (Marketing), dann was dabei herausgekommen ist (Leads) — und nicht der
   * Wichtigkeit, sonst stünde dieser Punkt vorne und der Betrieb sähe beim ersten Aufruf eine leere
   * Liste, bevor er überhaupt einen Link verschickt hat.
   */
  { href: PORTAL_LEADS_PATH, labelKey: 'leads' },
  /*
   * B18-4. Er steht ANS ENDE und nicht nach vorn, obwohl er das teuerste Werkzeug hinter dieser
   * Anmeldung ist: Die Reihenfolge folgt weiterhin dem Weg eines Fachbetriebs (wer er ist → womit
   * er verweist → was dabei herauskam → womit er rechnet). Und für den überwiegenden Teil der
   * Betriebe zeigt dieser Reiter zunächst kein Werkzeug, sondern eine Anfrage — vorne stünde damit
   * ein Punkt, hinter dem noch nichts liegt.
   *
   * ⚠ Der oben stehende Vermerk „B18-4 ist bewusst NICHT als deaktivierter Platzhalter angelegt"
   * ist damit eingelöst: Der Reiter entsteht in dem Schritt, der ihn füllt — ein Eintrag hier, ein
   * Eintrag in `PORTAL_AREA_PATHS`, eine Datei unter `app/portal/`.
   */
  { href: PORTAL_KALKULATOR_PATH, labelKey: 'calculator' },
] as const
