import { getTranslations } from 'next-intl/server'
import { PartnerPortalPage } from '@/components/partner-portal/partner-portal-page'
import { PortalCalculatorPanel } from '@/components/portal/calculator-panel'
import { PortalShell } from '@/components/portal/shell'
import { ANMELDEN_HREF, NEXT_PARAM } from '@/lib/auth/config'
import { redirectToLocalized } from '@/lib/auth/server-helpers'
import { CALCULATOR_FRAME_STYLE, EMBEDDED_CALCULATOR_SRC } from '@/lib/config'
import { getCalculatorAccess } from '@/lib/kalkulator/access'
import { PORTAL_KALKULATOR_PATH } from '@/lib/portal-host'
import { readMyCalculatorRequestState } from '@/lib/partner-portal/calculator-request-server'
import { readPortal } from '@/lib/partner-portal/read'
import { routing } from '@/i18n/routing'

/**
 * DER REITER „KALKULATOR" (B18-4) — das Werkzeug, sobald es freigeschaltet ist; davor Beschreibung
 * und Anfrage.
 *
 * ⚠ VON AUSSEN AUF KEINEM HOST ERREICHBAR. Adressiert wird er als `/kalkulator` auf
 * `partner.coolin.at`; die Middleware schreibt intern hierher um. Begründung: `PORTAL_RENDER_ROOT`
 * in `lib/portal-host.ts`.
 *
 * ── ⚠ DIE ZUGANGSPRÜFUNG STEHT HIER, NICHT IM LAYOUT ────────────────────────────────────────────
 * Dieselbe Lehre wie in den drei bestehenden Reitern: Dass ein Layout `children` nicht rendert,
 * verhindert nicht, dass Next die Seite rendert und ins Flight-Payload schreibt. Ein Test in
 * `lib/portal-host.test.ts` misst das für JEDE Seite unter dem Render-Baum, diese eingeschlossen.
 *
 * ── DIE REIHENFOLGE DER DREI AUFRUFE IST DIE FACHLICHE ENTSCHEIDUNG DIESER SEITE ────────────────
 * 1. `readPortal()` — angemeldet? aktive Partnerzeile? (die Frage jedes Reiters)
 * 2. `getCalculatorAccess()` — hat dieses Konto `calculator_pro`? Steht VOR allem Übrigen: Wer den
 *    Zugang hat, soll das Werkzeug sehen und nicht erst eine Beschreibung davon. Gelesen über
 *    denselben Wrapper wie die öffentliche Rechner-Route und die Kontoseite
 *    (`public.get_my_entitlement`) — es gibt bewusst keinen zweiten Lesepfad und keine zweite
 *    Definition von „hat Zugang" (Invariante I1), und der ist fail-closed.
 * 3. `readMyCalculatorRequestState()` — nur, wenn KEIN Zugang besteht. Ohne diesen Schritt wüsste
 *    die Seite nicht, ob bereits eine Anfrage läuft: Sie zeigte jedem ein leeres Formular, auch dem,
 *    dessen Anfrage seit gestern offen ist — der reichte ein zweites Mal ein, bekäme
 *    `already_pending` und hielte das für einen Fehler. Genau dafür ist der Wrapper entstanden.
 *
 * Der dritte Aufruf entfällt im `granted`-Fall vollständig: Wer den Zugang hat, braucht die Frage
 * nicht beantwortet, und ein Rundlauf, dessen Ergebnis niemand ansieht, ist Aufwand ohne Ertrag.
 *
 * ── DER iframe LIEGT HIER UND NICHT IM PANEL ────────────────────────────────────────────────────
 * Er rendert vollflächig — ohne `Container`, ohne Rand, ohne Radius: Der Rechner bringt seinen
 * eigenen Grund und seine eigene Innenbreite mit, ein Kasten darum wäre doppelter Rahmen. Dieselbe
 * Entscheidung wie auf `/peak-shaving/kalkulator/rechner`; `EMBEDDED_CALCULATOR_SRC` und
 * `CALCULATOR_FRAME_STYLE` sind dieselben Konstanten (`lib/config.ts`), dritte Verwendung, nichts
 * Neues.
 *
 * ⚠ Die Höhe rechnet mit `var(--header-h)` — das ist die Höhe des ÖFFENTLICHEN Website-Headers.
 * Der Portal-Rahmen ist etwas flacher, der iframe damit ein paar Pixel kürzer als der freie Platz.
 * Bewusst so gelassen: Die Alternative wäre eine zweite Höhenkonstante für denselben Zweck, und ein
 * zu KURZER Rahmen ist der harmlose Fehler (der Rechner scrollt darin ohnehin selbst) — ein zu
 * langer erzeugte einen doppelten Scrollbalken.
 */
export const dynamic = 'force-dynamic'

export default async function Page() {
  const portal = await readPortal()

  // Serverseitig, BEVOR irgendetwas gerendert oder ausgeliefert wird (Invariante J6).
  if (!portal) {
    redirectToLocalized(ANMELDEN_HREF, routing.defaultLocale, {
      [NEXT_PARAM]: PORTAL_KALKULATOR_PATH,
    })
  }

  if (portal.state.state !== 'partner') {
    return (
      <PortalShell active={null}>
        <PartnerPortalPage state={portal.state} referralUrl={portal.referralUrl} />
      </PortalShell>
    )
  }

  const access = await getCalculatorAccess()

  if (access.state === 'granted') {
    const t = await getTranslations('PartnerPortal.calculator')
    return (
      <PortalShell active={PORTAL_KALKULATOR_PATH}>
        <iframe
          src={EMBEDDED_CALCULATOR_SRC}
          title={t('iframeTitle')}
          className="block w-full border-0"
          style={CALCULATOR_FRAME_STYLE}
        />
      </PortalShell>
    )
  }

  const request = await readMyCalculatorRequestState()

  return (
    <PortalShell active={PORTAL_KALKULATOR_PATH}>
      <PortalCalculatorPanel request={request} />
    </PortalShell>
  )
}
