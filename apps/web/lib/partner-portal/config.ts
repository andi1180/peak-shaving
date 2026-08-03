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

/**
 * Die Aktivierungsseite (B18-2a) — das Ziel des Links aus der Freischaltungsmail.
 *
 * Sie liegt aus demselben Grund NICHT unter `/partner/` wie die beiden Nachbarn: dort sitzt seit
 * B16-2 das dynamische `[slug]`, und ein statisches Kindsegment machte diesen Kurz-Key für immer
 * unerreichbar.
 *
 * ── WARUM EINE EIGENE SEITE UND NICHT DER BESTEHENDE `/auth/callback` ───────────────────────────
 * Der Callback tauscht einen PKCE-`code` gegen eine Sitzung und wirkt dabei im GET. Genau das darf
 * dieser Link nicht: Ein Aktivierungstoken ist EINMALIG einlösbar (gemessen: die zweite Verwendung
 * antwortet HTTP 403 `otp_expired`), und Mailscanner in Unternehmen — bei der Zielgruppe dieser
 * Mail der Regelfall — rufen Links vorab ab. Ein wirkender GET verbrauchte den Token, bevor der
 * Mensch ihn sieht; der Fachbetrieb bekäme „Link ungültig" und käme ohne Rückfrage nicht mehr in
 * sein Portal. Deshalb dieselbe Bauform wie `/einwilligung-bestaetigen` (B1-2): der GET ZEIGT nur,
 * die Wirkung hängt am POST.
 */
export const PARTNER_AKTIVIEREN_HREF = '/partner-aktivieren'

/**
 * Name des Token-Parameters im Aktivierungslink.
 *
 * EINE Stelle, weil ihn drei Beteiligte teilen: die Mail (baut die URL), die Seite (liest den
 * Parameter) und das versteckte Formularfeld, über das der Token in den POST wandert. Derselbe
 * Name wie bei der Einwilligungsbestätigung (`CONFIRM_TOKEN_PARAM`, B1-2) — und derselbe Grund für
 * die Konstante.
 */
export const ACTIVATION_TOKEN_PARAM = 'token'
