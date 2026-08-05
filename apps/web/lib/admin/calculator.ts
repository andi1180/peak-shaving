/**
 * DIE ADRESSE DES KALKULATOR-BEREICHS IM ADMIN (B18-4).
 *
 * Rein: kein `server-only`, kein `next/*`, kein Supabase-Client — wie die übrigen Adress-Module des
 * Admin-Bereichs (`leads.ts`, `analyses.ts`, `partners.ts`, `calculator-requests.ts`). Es gibt hier
 * bewusst NICHTS weiter zu lesen oder zu übersetzen: der Bereich zeigt den Rechner im iframe, und
 * der bringt seinen eigenen Zustand mit.
 *
 * ── ⚠ EIGENER GESCHWISTERPFAD, UND ZWAR IN BEIDE RICHTUNGEN ─────────────────────────────────────
 * `components/admin/nav.tsx` markiert einen Punkt als aktiv, sobald der Pfad mit ihm BEGINNT
 * (genauer: `pathname === href || pathname.startsWith(`${href}/`)`). Daraus folgen zwei Auflagen,
 * die man leicht nur zur Hälfte erfüllt:
 *
 *   1. Dieser Pfad darf KEIN Unterpfad von `/admin/kalkulator-anfragen` sein.
 *   2. `/admin/kalkulator-anfragen` darf KEIN Unterpfad von diesem sein.
 *
 * Die zweite ist die unauffälligere und war der Grund, warum der Prüf-Eingang in B18-4 nicht
 * `/admin/kalkulator/anfragen` heisst: Ein Kalkulator-Bereich unter `/admin/kalkulator` hätte ihn
 * geschluckt, und beide Punkte stünden gleichzeitig aktiv. `/admin/kalkulator` und
 * `/admin/kalkulator-anfragen` sind deshalb GESCHWISTER — der Bindestrich ist kein Trennzeichen im
 * Sinne der Präfix-Regel, `'/admin/kalkulator-anfragen'.startsWith('/admin/kalkulator/')` ist
 * `false`. Das ist gemessen (`calculator-ui.test.ts`), nicht abgelesen: die Regel hängt am
 * angehängten Schrägstrich, und ohne ihn wäre genau dieses Paar der erste Kollisionsfall.
 *
 * Ein Fehler dieser Art fällt in keinem Build und in keinem Typecheck auf — beide Seiten
 * funktionieren, es stehen nur zwei Punkte gleichzeitig aktiv und niemand weiss, wo er ist.
 */
export const ADMIN_CALCULATOR_HREF = '/admin/kalkulator'
