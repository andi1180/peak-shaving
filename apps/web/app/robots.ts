import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { isAccessHost } from '@/lib/access-host'
import { isPortalHost } from '@/lib/portal-host'
import { absoluteUrl, IS_PRODUCTION_SITE } from '@/lib/site'

/**
 * /robots.txt (Pflichtenheft §6.4).
 *
 * DIE SEITE VERBIETET SICH SELBST, SOLANGE SIE NICHT AUF coolin.at LIEGT.
 * Das ist der Kern dieser Datei: Bis zum DNS-Umzug (§12) läuft der Neubau auf
 * `peak-shaving-web.vercel.app`. Eine indexierte vercel.app-Adresse würde nach
 * dem Umzug gegen die echte coolin.at antreten — mit identischem Inhalt, also
 * als Duplikat, das man anschließend mühsam wieder aus dem Index bekommt. Die
 * Preview ist zum Ansehen da, nicht zum Ranken.
 *
 * Die Weiche hängt an `SITE_URL` (`lib/site.ts`), nicht an `VERCEL_ENV` — die
 * Begründung steht bei `IS_PRODUCTION_SITE`. Damit bleibt der Cutover EIN
 * Handgriff: `NEXT_PUBLIC_SITE_URL=https://coolin.at` in Vercel setzen schaltet
 * Canonicals, hreflang, OG-Bild und robots gemeinsam scharf.
 *
 * WARUM HIER KEINE `disallow`-EINTRÄGE FÜR DIE noindex-SEITEN STEHEN (die
 * rechner-Hülle, `/styleguide`) — das ist die Falle, die §6.4 mit „robots darf
 * noindex nicht widersprechen" meint, und sie wirkt genau andersherum, als man
 * denkt: `Disallow` verbietet das CRAWLEN, nicht das Indexieren. Eine gesperrte
 * Seite darf Google nicht abrufen — und sieht damit ihr eigenes `noindex` NIE.
 * Die URL kann dann trotzdem im Index landen (ohne Inhalt, allein über Links).
 * Ein `noindex` wirkt nur, wenn der Crawler die Seite lesen darf. Also: lesen
 * lassen. Die beiden Seiten schließen sich selbst aus, sauberer geht es nicht.
 *
 * ── B18-1a: DIESELBE FRAGE, EINMAL PRO HOST ─────────────────────────────────────────────────────
 * `IS_PRODUCTION_SITE` beantwortet „liegt diese AUSLIEFERUNG unter der richtigen Adresse" und kommt
 * aus der Umgebung. Seit `partner.coolin.at` auf dasselbe Vercel-Projekt zeigt, genügt das nicht
 * mehr: Beide Hosts teilen sich dieselbe Auslieferung und bekämen damit dieselbe `robots.txt` —
 * die Subdomain wäre eine indexierbare Zweitdomain mit identischem Inhalt. Der Host der ANFRAGE ist
 * deshalb die zweite Bedingung, und `headers()` macht diese Route dafür dynamisch: Eine Antwort,
 * die vom Host abhängt, darf nicht beim Bauen festgeschrieben werden.
 *
 * WARUM HIER UND NICHT IN `lib/routes.ts` ODER IN DER SEITEN-METADATA: Jene beiden entscheiden je
 * PFAD. Der Portal-Host ist eine Frage des HOSTS — dieselbe `/anmelden` ist auf beiden Hosts
 * dieselbe Datei. Ein Eintrag dort könnte den Host gar nicht sehen, und er wäre zusätzlich
 * redundant: Die Pfade, die auf dem Portal-Host überhaupt erreichbar BLEIBEN (Portal + Auth), sind
 * in `lib/routes.ts` bereits ausnahmslos `indexable: false` und tragen ihr `noindex` schon heute.
 * Ein Test in `lib/portal-host.test.ts` hält genau diese Deckungsgleichheit fest — sie ist der
 * Grund, warum hier EINE Bedingung genügt und nirgends sonst etwas nachzutragen ist. Alles andere
 * auf diesem Host ist ein 308 auf die kanonische Basis, also ohnehin kein indexierbarer Inhalt.
 *
 * ⚠ WARUM KEINE POSITIVE ALLOWLIST INDEXIERBARER HOSTS (das wäre die strengere Fassung):
 * GEMESSEN am 03.08.2026 leitet der Apex `coolin.at` per 308 auf `www.coolin.at` um — ausgeliefert
 * wird die Seite also unter `www`, während `NEXT_PUBLIC_SITE_URL` (und damit `SITE_URL`,
 * `PRODUCTION_ORIGIN` und jeder Canonical) auf den Apex OHNE `www` lautet. Eine Regel „indexierbar
 * nur unter dem kanonischen Host" setzte damit die GESAMTE Seite auf `Disallow: /`, weil der
 * einzige Host, der überhaupt mit 200 antwortet, nicht der kanonische ist. Diese Weiche fügt
 * deshalb ausschliesslich eine VERBIETENDE Bedingung hinzu und erteilt nirgends eine neue Erlaubnis.
 * Die verbleibende Lücke — ein weiterer, unbekannter Host auf derselben Auslieferung bekäme
 * `Allow` — ist bekannt und gehört in die Domain-Konfiguration in Vercel, nicht in den Code.
 *
 * ⚠ FÜR B18-2 MITZUDENKEN: Solange NICHTS auf `partner.coolin.at` verlinkt, ist `Disallow: /` hier
 * die vollständige Antwort. Sobald der Login-Knopf im öffentlichen Header dorthin zeigt, entsteht
 * ein crawlbarer Link auf einen Host, den der Crawler nicht betreten darf — und genau dann greift
 * die Warnung weiter oben in umgekehrter Richtung: Die URL kann ohne Inhalt im Index landen, weil
 * Google das `noindex` der Anmeldeseite nicht mehr lesen darf. Das ist kein Grund, hier heute etwas
 * anderes zu tun (die Alternative wäre, den gesamten Zweitdomain-Crawl zu erlauben), aber es ist der
 * Zeitpunkt, an dem die Abwägung neu ansteht.
 *
 * ── ZUGANGSPLATTFORM (Baustein 1): DIESELBE FRAGE, DRITTER HOST ────────────────────────────────
 * `access.coolin.at` zeigt ebenfalls auf dieses Vercel-Projekt und lieferte vor Baustein 1
 * gemessen die komplette Website aus. Die Bedingung ist deshalb um diesen Host erweitert, nicht
 * verallgemeinert: Es bleibt bei EINER verbietenden Prüfung je namentlich benanntem Host — eine
 * Negativ-Regel („alles, was nicht die Hauptdomain ist") setzte jede Preview und jede lokale
 * Entwicklung auf `Disallow: /`, und beim Testen fiele es nicht auf, weil die Seiten ja weiterhin
 * ausgeliefert werden. Die Ableitung selbst liegt je Produkt in seiner eigenen Datei; hier steht
 * kein Hostname.
 *
 * Die Zugangsplattform braucht darüber hinaus nichts in `lib/routes.ts`: Ihr Render-Baum liegt
 * ausserhalb von `app/(site)/[locale]/` und kann per Konstruktion in keine sitemap geraten.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get('host')

  if (isPortalHost(host) || isAccessHost(host) || !IS_PRODUCTION_SITE) {
    return {
      rules: [{ userAgent: '*', disallow: '/' }],
      /*
       * BEWUSST OHNE `sitemap`: Eine sitemap ist eine Einladung zum Crawlen —
       * neben einem „Disallow: /" wäre sie ein Widerspruch in derselben Datei.
       * Die sitemap selbst bleibt erreichbar und korrekt, sie wird hier nur nicht
       * beworben.
       */
    }
  }

  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: absoluteUrl('/sitemap.xml'),
  }
}
