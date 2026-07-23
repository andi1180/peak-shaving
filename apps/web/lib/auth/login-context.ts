/**
 * In WELCHEM Zusammenhang steht eine Anmeldung? (B16-Einstieg, Folgeschritt)
 *
 * REIN — kein `server-only`, kein `next/*`, kein Supabase-Client. Die Ableitung ist eine
 * Zeichenketten-Entscheidung und wird genau so geprüft: ohne Sitzung, ohne Formular, ohne Datenbank.
 *
 * ── WARUM DIE FRAGE ÜBERHAUPT ENTSTEHT ───────────────────────────────────────────────────────────
 * Es gibt genau EINE Anmeldeseite, und sie wird von mehreren Wegen geteilt: dem Kalkulator-Zugang
 * (B10-2), dem Partner-Portal (B16-4b) und dem gewöhnlichen Konto. Bis hierher sah sie in allen
 * Fällen gleich aus — was für den Kalkulator und das Konto richtig ist und für den Fachbetrieb
 * eine Sackgasse war: Er kam über `/partner-portal`, fand „Noch kein Konto? Jetzt registrieren"
 * und landete auf `/registrieren` — einem Formular, das ihm ein Konto anlegt, ihn aber KEINEN
 * Schritt näher an sein Portal bringt. Der Zugang dorthin entsteht ausschliesslich über eine
 * Bewerbung samt Genehmigung (B16-3/B16-4a); ein selbst angelegtes Konto trägt keine Partnerzeile
 * und sieht im Portal denselben Erklärzustand wie jeder Monitor-Kunde. Er hätte also ein Konto
 * gehabt und wäre trotzdem nicht weitergekommen — und die naheliegende Vermutung wäre gewesen,
 * dass etwas kaputt ist.
 *
 * ── DIE UNTERSCHEIDUNG HÄNGT AM RÜCKSPRUNGZIEL, NICHT AN EINEM EIGENEN PARAMETER ─────────────────
 * `?next=` existiert seit B10-2 und trägt bereits die Information, WOHIN jemand wollte, bevor ihn
 * die Zugangsprüfung angehalten hat. Ein zweiter Parameter („?kontext=partner") wäre eine zweite
 * Angabe über denselben Sachverhalt — beide frei setzbar, und bei Widerspruch müsste jemand
 * entscheiden, welche gilt. Dieselbe Überlegung wie bei der Herkunft eines Registrierungs-Leads
 * (`lib/leads/registration-source.ts`), und bewusst dasselbe Muster: ein Pfadvergleich MIT
 * Grenzprüfung auf dem bereits sanierten Wert.
 *
 * ── DER ÜBERGEBENE WERT MUSS BEREITS SANIERT SEIN ────────────────────────────────────────────────
 * Diese Funktion prüft NICHT auf Open Redirect — das tut `sanitizeNext` (`lib/auth/config.ts`), und
 * zwar VOR dem Aufruf hier. Beides zu vermischen hiesse, die Sicherheitsprüfung an einer Stelle zu
 * wiederholen, an der sie niemand vermutet. Ein manipuliertes Ziel fällt dadurch von selbst auf
 * `default` zurück: Was `sanitizeNext` verwirft, kommt hier als Vorgabewert oder leer an, und beides
 * ist kein Partner-Ziel.
 *
 * ── WAS DIESE FUNKTION NICHT IST ─────────────────────────────────────────────────────────────────
 * KEINE Zugangsentscheidung. Sie sagt, welchen Text und welchen Ausweg die Anmeldeseite zeigt —
 * nicht, wer sich anmelden darf und wer ein Partner ist. Das entscheidet ausschliesslich
 * `public.get_my_partner` hinter der Anmeldung (B16-4b, gebunden an `auth.uid()`); ein aus dem
 * Rücksprungziel abgeleiteter Zustand wäre über die URL frei wählbar und dürfte deshalb nie mehr
 * bewirken als die Wahl einer Überschrift.
 */

import { PARTNER_PORTAL_HREF } from '@/lib/partner-portal/config'

/**
 * `partner` = die Anmeldung führt ins Partner-Portal. `default` = alles Übrige, ausdrücklich
 * INKLUSIVE des Kalkulator-Zugangs: Der ist seit B10-2 ein enger Kreis ohne Selfservice, und der
 * bestehende Weg über `/registrieren` mit durchgereichtem `next` funktioniert dort seit B10-5 —
 * eine eigene Beschriftung brächte nichts und würde einen geprüften Trichter anfassen.
 */
export type LoginContext = 'partner' | 'default'

/**
 * Kontext aus dem bereits sanierten Rücksprungziel.
 *
 * Der Vergleich läuft gegen den PFAD ohne Query und Fragment, und er verlangt entweder Gleichheit
 * oder einen Schrägstrich dahinter — sonst zählte ein erfundenes `/partner-portal-fremd` als
 * Partner-Anmeldung, obwohl es eine andere Route ist. Umgekehrt ist `/partner-werden` (die
 * Bewerbung) ausdrücklich KEIN Partner-Kontext: Wer dorthin zurückwill, bewirbt sich gerade erst,
 * und der Verweis „Noch kein Konto? → Partner werden" führte ihn im Kreis dahin zurück.
 */
export function loginContextForNext(sanitizedNext: string | null | undefined): LoginContext {
  if (!sanitizedNext) return 'default'

  const path = sanitizedNext.split(/[?#]/, 1)[0] ?? ''
  const isPartnerPortal =
    path === PARTNER_PORTAL_HREF || path.startsWith(`${PARTNER_PORTAL_HREF}/`)

  return isPartnerPortal ? 'partner' : 'default'
}
