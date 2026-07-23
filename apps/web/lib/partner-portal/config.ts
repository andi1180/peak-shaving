/**
 * KONSTANTEN DES PARTNER-PORTALS (B16-4b, Fahrplan_2026.md B16).
 *
 * REIN: kein `server-only`, kein `next/*`, keine Datenbank. Die Route braucht den Pfad, die
 * Anmeldeseite das Rücksprungziel, `lib/routes.ts` den Eintrag für den Platten-Abgleich, und die
 * Tests alles drei.
 *
 * ── DER PFAD LIEGT AUSDRÜCKLICH NICHT UNTER `/partner/` ─────────────────────────────────────────
 * Dieselbe harte Auflage wie bei `/partner-werden` (B16-3), und aus demselben Grund: Dort sitzt seit
 * B16-2 das dynamische Segment `[slug]` (die Landingpage eines Fachbetriebs). Ein statisches
 * Kindsegment `/partner/portal` machte den Kurz-Key „portal" für immer unerreichbar — und zwar
 * still: Der betroffene Betrieb bekäme einen Empfehlungslink, der auf eine ganz andere Seite führt,
 * und der Fehler fiele erst auf, wenn seine Serienmail bereits in hunderten Postfächern liegt. Ein
 * Kurz-Key ist nach dem Anlegen unveränderlich (`guard_partner_slug`, B16-1) — es gäbe also nicht
 * einmal einen Weg zurück.
 *
 * `/partner-portal` ist ein eigenes Geschwistersegment und kollidiert mit keinem denkbaren Slug.
 * Die Schreibweise folgt `/partner-werden`: deutsches Wort, Bindestrich, kein Präfix.
 */

/** Das eingeloggte Partner-Portal — OHNE Locale-Präfix, wie alle Hrefs unter `app/(site)/[locale]`. */
export const PARTNER_PORTAL_HREF = '/partner-portal'
