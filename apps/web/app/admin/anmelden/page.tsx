import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { EmblemImage } from '@/components/brand/emblem-image'
import { WordmarkA } from '@/components/brand/wordmark'
import { Container } from '@/components/ui/layout'
import { AdminLoginForm } from '@/components/admin/login-form'
import { ADMIN_HREF, adminNextTarget } from '@/lib/admin/config'
import { NEXT_PARAM } from '@/lib/auth/config'
import { createClient } from '@/lib/supabase/server'

/*
 * Der Anmelde-Eingang des Admin-Bereichs (B17) — die EINZIGE Route unterhalb von `/admin`, die
 * anonym erreichbar ist. Sie liegt deshalb ausserhalb der Route-Group `(intern)`, in der die
 * Zugangsschranke sitzt.
 *
 * ── ER ERHÖHT DIE SICHERHEIT NICHT, ER SCHAFFT KLARHEIT ──────────────────────────────────────────
 * Kein zweites Authentifizierungssystem: derselbe Supabase-Auth-Bestand, dieselbe Sitzung, dieselbe
 * Server Action (`signInAction`) und dieselbe Rollenprüfung aus T4 (`platform.user_roles`). Wer
 * diese Adresse kennt, hat dadurch keinen Vorteil — der Schutz liegt unverändert hinter der
 * Anmeldung. Was der eigene Eingang bringt, ist Eindeutigkeit: ein Admin landet nach dem Anmelden im
 * Verwaltungsbereich und nicht auf der Kontoseite, und nach dem Abmelden wieder hier.
 *
 * ── EINE BESTEHENDE SITZUNG WIRD OHNE ANSEHEN DER ROLLE WEITERGESCHICKT ──────────────────────────
 * Wer bereits angemeldet ist, wird auf `/admin` umgeleitet — und dort entscheidet der unveränderte
 * Guard. Das ist Absicht und der Kern der Anforderung „keine Sonderbehandlung": Diese Seite prüft
 * KEINE Rolle und kann deshalb auch nichts über sie verraten. Ein Konto ohne Admin-Rolle bekommt am
 * Ziel dieselbe neutrale „Kein Zugriff"-Seite wie eh und je; es erfährt hier nicht, dass ihm etwas
 * fehlt. (Muster identisch zu `/anmelden`, das eine bestehende Sitzung ebenfalls sofort ans Ziel
 * schickt, statt ein Formular zu zeigen, das nichts mehr zu tun hätte.)
 *
 * ── WAS ES HIER BEWUSST NICHT GIBT ───────────────────────────────────────────────────────────────
 * Keinen Verweis auf Registrierung, Partnerprogramm oder Passwort-Zurücksetzen für Kunden. Und
 * ausdrücklich keinen Weg, Admin zu werden: Rollen werden dauerhaft direkt in Supabase vergeben —
 * das ist eine Festlegung, keine Vertagung. Umgekehrt bekommt `/anmelden` KEINEN Link hierher: der
 * Kundenlogin behält sein Verhalten und seine Verweise unverändert.
 */

/** Die Sitzung wird bei jedem Aufruf gelesen — eine zwischengespeicherte Fassung wäre eine Aussage
 *  über den Anmeldezustand eines fremden Besuchers. */
export const dynamic = 'force-dynamic'

/*
 * EIGENER TITEL — die eine Stelle im Bereich, die sich benennen darf und soll.
 *
 * Der geschützte Zweig trägt seit T4-4 bewusst den nichtssagenden Titel aus `app/admin/layout.tsx`:
 * er gilt auch für die „Kein Zugriff"-Antwort, und die soll die Existenz eines Verwaltungsbereichs
 * nicht ausplaudern. Hier ist die Lage umgekehrt — die Seite IST der Eingang, sie benennt sich im
 * Text ohnehin, und man erreicht sie nur, wenn man ihre Adresse kennt.
 *
 * `robots` steht NICHT hier: `noindex, nofollow` kommt aus dem Root-Layout und gilt für alles unter
 * `/admin`. Next führt Metadaten feldweise zusammen — ein überschriebener `title` lässt `robots`
 * unberührt. So bleibt die Indexierbarkeit des Bereichs an EINEM Fundort. In der sitemap steht die
 * Route ohnehin nicht: `lib/routes.ts` liest ausschliesslich `app/(site)/[locale]/`.
 */
export const metadata: Metadata = {
  title: 'Admin-Anmeldung — COOLiN ENERGY',
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  /*
   * Das Rücksprungziel kommt von der Zugangsschranke (`lib/admin/guard.ts`): Wer abgemeldet
   * `/admin/leads` aufruft, soll nach dem Anmelden DORT landen und nicht auf der Übersicht.
   * `adminNextTarget` prüft den Wert (intern, innerhalb `/admin`); `signInAction` prüft ihn ein
   * zweites Mal, weil das versteckte Feld im Browser frei änderbar ist.
   */
  const next = adminNextTarget((await searchParams)[NEXT_PARAM])

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  /*
   * Eine bestehende Sitzung geht auf `/admin` — ohne Ansehen der Rolle und BEWUSST ohne das
   * Rücksprungziel: Wer hier mit eigener Sitzung landet, hat die Adresse selbst aufgerufen; ein
   * mitgeschicktes `next` wäre dann nicht seine Absicht, sondern ein Wert aus der URL.
   */
  if (user) redirect(ADMIN_HREF)

  return (
    <Container className="py-16 sm:py-24">
      <div className="mx-auto w-full max-w-md">
        {/*
         * Marke und Bereichskennzeichnung stehen ÜBER der Karte, nicht darin: wer hier landet, soll
         * an einem Blick erkennen, wessen Verwaltung er vor sich hat — und dass es die Verwaltung
         * ist und nicht die Kundenanmeldung.
         */}
        <div className="flex items-center gap-3">
          <EmblemImage size={40} className="h-10 w-10" />
          <WordmarkA className="h-10 w-auto text-navy" />
        </div>
        <p className="mt-6 text-small font-semibold uppercase tracking-wide text-accent">
          Admin-Bereich
        </p>
        <h1 className="mt-2 text-h2 text-ink">Anmeldung zur Verwaltung</h1>
        <p className="mt-3 text-body text-text-muted">
          Interner Zugang für COOLiN ENERGY. Bitte melden Sie sich mit Ihrem Konto an.
        </p>
        <div className="mt-8 rounded-lg border border-line bg-surface p-6 sm:p-8">
          <AdminLoginForm next={next} />
        </div>
      </div>
    </Container>
  )
}
