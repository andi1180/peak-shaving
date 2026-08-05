/**
 * WIE DIESE ANWENDUNG DEN HOST EINER ANFRAGE BEWERTET — EINE Fassung, alle Subdomains.
 *
 * REIN: kein `server-only`, kein `next/server`, keine Datenbank, kein Request-Objekt. Die
 * Middleware liest das im Edge-Runtime, `app/robots.ts` in einer Server Component, und die Tests
 * prüfen es ohne Request.
 *
 * ── WARUM ES DIESE DATEI GIBT (und sie mit dem Zugangsplattform-Baustein entstanden ist) ─────────
 * `lib/portal-host.ts` (B18-1a) hielt Normalisierung, Zwei-Kopfzeilen-Regel und das Abtrennen des
 * Locale-Präfixes als PRIVATE Helfer. Solange es genau eine Subdomain gab, war das richtig. Mit
 * `access.coolin.at` (Zugangsplattform, Baustein 1) gibt es eine zweite, die exakt dieselben drei
 * Fragen stellt — und eine kopierte Fassung wäre genau die Sorte Fehler, gegen die `portal-host.ts`
 * im eigenen Kopf argumentiert: „Ein String-Vergleich an mehreren Orten … Weicht eine der Stellen
 * ab, verhalten sich Weiche und Indexierungssignal unterschiedlich, und beides sieht für sich
 * genommen richtig aus."
 *
 * Die Verdopplung wäre hier besonders teuer, weil beide Regeln GEMESSEN und nicht abgeleitet sind
 * (s. u.): Eine zweite Fassung erbt die Messung nicht, sondern nur den Code — und ein späterer Fix
 * an einer Stelle liesse die andere still zurückfallen.
 *
 * Die HOSTNAMEN selbst stehen bewusst NICHT hier, sondern je Produkt in seiner eigenen Datei
 * (`lib/portal-host.ts`, `lib/access-host.ts`). Diese Datei beantwortet „stimmt dieser Host mit
 * jenem überein", nicht „welche Subdomains gibt es".
 */

import { routing } from '@/i18n/routing'

/** Der Ausschnitt, den beide Aufrufer erfüllen: `request.headers` und `await headers()`. */
export type HostHeaders = { get(name: string): string | null }

/**
 * Host-Kopfzeile auf die reine Namensform bringen.
 *
 * Ein Port (`localhost:3000`) und die FQDN-Schreibweise mit Punkt am Ende (`partner.coolin.at.`)
 * bezeichnen denselben Host. Ohne Normalisierung wäre die zweite Form ein NICHT erkannter
 * Subdomain-Host — und damit wieder eine vollständige Zweitdomain. Die Normalisierung kann nur
 * zusätzliche Schreibweisen ALS diesen Host erkennen, nie einen fremden Host dazu machen.
 *
 * Der Port wird nur als abschliessendes `:<Ziffern>` entfernt, damit eine IPv6-Adresse (`[::1]`)
 * nicht mitten im Literal abgeschnitten wird.
 */
export function normalizeHost(host: string | null | undefined): string {
  if (!host) return ''
  return host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
}

/**
 * Bezeichnet `host` den erwarteten Host? EXAKTER Vergleich nach Normalisierung.
 *
 * ── DIE VERGLEICHSRICHTUNG IST DIE EIGENTLICHE ENTSCHEIDUNG ─────────────────────────────────────
 * Verglichen wird AUSSCHLIESSLICH gegen den einen, exakt benannten Host. Es gibt bewusst KEINEN
 * Ausdruck der Form „alles, was nicht die Hauptdomain ist" — der wäre die naheliegende Umkehrung
 * und stillschweigend falsch: Eine lokale Entwicklung (`localhost:3000`) und jedes
 * Preview-Deployment (`*.vercel.app`) sind WEDER die Hauptdomain NOCH eine der Subdomains. Mit der
 * weiten Fassung würde jede Preview zur Subdomain (die Startseite einer Preview leitete auf die
 * Produktivdomain um, und niemand bemerkte es beim Testen der Subdomain-Routen, weil die ja
 * bleiben). Mit der engen Fassung verhalten sich beide exakt wie bisher.
 */
export function matchesHost(host: string | null | undefined, expected: string): boolean {
  return normalizeHost(host) === expected
}

/**
 * Läuft DIESE Anfrage über den erwarteten Host?
 *
 * ── ⚠ WARUM ZWEI KOPFZEILEN, UND WARUM DAS GEMESSEN IST (B18-1a-Nachbesserung) ──────────────────
 * Der naheliegende Weg — allein `host` — ist an einer Stelle nachweislich falsch, und zwar an
 * genau der, an der es am meisten weh tut: Leitet eine Server Action mit `redirect('/')` weiter,
 * rendert Next das ZIEL innerhalb derselben Antwort und lässt dafür die Middleware ein zweites Mal
 * laufen — mit einer INTERNEN Anfrage. Gemessen gegen den Production-Build:
 *
 *     POST /anmelden   host= partner.coolin.at   x-forwarded-host= partner.coolin.at
 *     GET  /           host= localhost:3990      x-forwarded-host= partner.coolin.at
 *
 * `host` trägt dort den Server selbst, `x-forwarded-host` den echten Host. Ohne die zweite
 * Kopfzeile bekäme ein Nutzer unmittelbar nach dem Anmelden die MARKETING-Startseite zu sehen
 * (die Adresse `/` stimmte, der Inhalt nicht) und erst nach einem Neuladen seinen Bereich — und
 * beim Abmelden dasselbe. Ein Fehler, den kein Statuscode und kein Location-Header zeigt.
 *
 * ── DIE VERKNÜPFUNG IST BEWUSST „ODER", ALSO MONOTON ────────────────────────────────────────────
 * Sie kann eine Anfrage nur ZUSÄTZLICH als diesen Host erkennen, nie eine als etwas anderes
 * ausweisen — dieselbe Richtung wie die Normalisierung oben, und aus demselben Grund. Praktisch:
 * Wer `x-forwarded-host: <subdomain>` von Hand mitschickt, bekommt für seine eigene Anfrage die
 * ENGERE Behandlung (der Bereich der Subdomain oder ein 308 auf die kanonische Basis, dazu
 * `Disallow: /`) — niemals eine weitere. Die umgekehrte Verknüpfung („nur wenn beide zustimmen")
 * wäre der gefährliche Entwurf: Mit ihr liesse sich die 308-Weiche abschalten und die vollständige
 * Website unter der Subdomain ausliefern — genau der Zustand, den B18-1a beseitigt hat.
 */
export function requestMatchesHost(headers: HostHeaders, expected: string): boolean {
  return (
    matchesHost(headers.get('host'), expected) ||
    matchesHost(headers.get('x-forwarded-host'), expected)
  )
}

/**
 * Entfernt ein führendes Locale-Segment.
 *
 * `localePrefix: 'as-needed'` (i18n/routing.ts) liefert Deutsch OHNE Präfix aus — `/de/anmelden`
 * ist aber weiterhin eine gültige Adresse (next-intl leitet sie auf `/anmelden` um), und eine
 * zweite Sprache brächte `/en/anmelden`. Die Host-Weichen laufen VOR dem Locale-Routing und sehen
 * deshalb den rohen Pfad. Ohne diesen Schritt würde `/de/anmelden` auf einem Subdomain-Host
 * weggeleitet, mitten im Anmeldevorgang.
 */
export function stripLocale(pathname: string): string {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}`) return '/'
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1)
  }
  return pathname
}
