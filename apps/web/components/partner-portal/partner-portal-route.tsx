import { PartnerPortalPage } from '@/components/partner-portal/partner-portal-page'
import { ANMELDEN_HREF, NEXT_PARAM } from '@/lib/auth/config'
import { redirectToLocalized } from '@/lib/auth/server-helpers'
import { readPortal } from '@/lib/partner-portal/read'

/**
 * DER PORTALBEREICH — EINE Fassung, zwei Adressen (B18-1a-Nachbesserung).
 *
 * Bis hierher stand dieser Ablauf im Rumpf von `app/(site)/[locale]/partner-portal/page.tsx`. Seit
 * `partner.coolin.at/` denselben Bereich bedient, gibt es dafür zwei Routen — und genau deshalb
 * steht er hier: Eine zweite, kopierte Fassung liefe auseinander, und zwar an der teuersten Stelle,
 * die dieses Produkt hat. Die drei Zustände (nicht angemeldet → Anmeldung, angemeldet ohne
 * Partnerzeile → Erklärzustand, angemeldet mit aktiver Partnerzeile → Portal) sind eine fachliche
 * Entscheidung, keine Darstellungsfrage; sie ausgerechnet je Host getrennt zu pflegen hiesse, dass
 * ein Fachbetrieb je nach Adresse etwas anderes zu sehen bekommt.
 *
 * Verschoben, NICHT umgeschrieben: Die Begründungen zu den drei Zuständen, zu `force-dynamic` und
 * zur Nicht-Umleitung des Erklärzustands stehen unverändert im Kopf der Route
 * `/partner-portal`; die Ableitung selbst liegt weiterhin in `lib/partner-portal/portal.ts`, die
 * Darstellung in `partner-portal-page.tsx`.
 *
 * ── DER EINZIGE UNTERSCHIED ZWISCHEN DEN BEIDEN ADRESSEN IST DAS RÜCKSPRUNGZIEL ─────────────────
 * `signInNext` sagt, wohin die Anmeldung zurückführt — und das ist AUF DEMSELBEN HOST zu lesen:
 * auf coolin.at `/partner-portal`, auf dem Portal-Host `/`. Der Wert läuft unverändert durch den
 * bestehenden Mechanismus (`NEXT_PARAM` + `sanitizeNext` in `signInAction`); hier wird NICHTS
 * nachgebaut und ausdrücklich keine Host-Allowlist eingeführt: `sanitizeNext` lässt seiten-INTERNE
 * Pfade zu, und ein interner Pfad bleibt beim Umleiten von sich aus auf dem Host, von dem er kam.
 * Genau deshalb genügt `/` — es gibt keine Adresse, die einen anderen Host tragen müsste.
 */
export async function PartnerPortalRoute({
  locale,
  /** Rücksprungziel nach der Anmeldung — ein seiten-interner Pfad auf DEMSELBEN Host. */
  signInNext,
}: {
  locale: string
  signInNext: string
}) {
  /*
   * Sitzung und Partnerzeile kommen seit B18-3 aus `readPortal` (`lib/partner-portal/read.ts`) —
   * demselben Leseweg, den der Portalbereich auf `partner.coolin.at` benutzt. Diese Route ist davon
   * im VERHALTEN unberührt: Sie leitet weiterhin selbst um, mit ihrem eigenen Rücksprungziel.
   */
  const portal = await readPortal()

  // Serverseitig, BEVOR irgendetwas gerendert oder ausgeliefert wird (Invariante J6).
  if (!portal) {
    redirectToLocalized(ANMELDEN_HREF, locale, { [NEXT_PARAM]: signInNext })
  }

  return <PartnerPortalPage state={portal.state} referralUrl={portal.referralUrl} />
}
