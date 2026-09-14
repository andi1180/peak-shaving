'use server'

/**
 * Server Actions des Abschnitts „Lieferanten-Tarife" — der EINZIGE Schreibweg auf
 * `public.retail_tariffs`.
 *
 * ── ⚠ DIESE DATEI TRÄGT DIE AUTORISIERUNG, UND DAS IST DIESELBE ABWEICHUNG WIE BEI DEN NETZTARIFEN ─
 * Jeder andere Admin-Schreibweg dieses Systems ruft einen `admin_*`-Wrapper in `platform`, der
 * `platform.is_admin()` als erste Anweisung selbst prüft. Ein Fehler im Anwendungscode kann dort
 * niemandem Schreibzugriff verschaffen.
 *
 * Hier ist es anders, und die Begründung steht im Kopf der Migration `20260913120100`: Die Tabelle
 * liegt in `public`, sie trägt veröffentlichte Listenpreise ohne Personenbezug, und sie folgt
 * deshalb dem direkten Tabellenzugriff statt des Wrapper-Musters. `public.create_retail_tariff` und
 * `public.confirm_retail_tariff` sind SECURITY INVOKER, laufen als `service_role` — und
 * `service_role` trägt kein JWT. `auth.uid()` ist leer; es gibt in der Datenbank nichts zu prüfen.
 *
 *   ⇒ Die Zugangsentscheidung fällt in GENAU ZWEI Zeilen: `isCurrentUserAdmin()` als erste Anweisung
 *     JEDER der beiden Actions, VOR dem Anlegen des Clients. Eine Server Action ist ein eigener,
 *     direkt adressierbarer Endpunkt — dass die Seite davor prüft, schützt sie NICHT (Lehre aus B19).
 *
 * Fail closed: alles ausser einem ausdrücklichen `true` gilt als „kein Zugang", auch ein Fehler beim
 * Lesen der Rolle.
 *
 * ── ES ENTSTEHT KEINE ZWEITE ART VON AUSNAHME ──────────────────────────────────────────────────
 * Derselbe Aufruferkreis, dieselbe Prüfstelle, dieselbe eng geführte ESLint-Erlaubnisliste für den
 * service_role-Client — die ist um GENAU DIESE EINE DATEI erweitert (Muster
 * `lib/admin/grid-tariffs-actions.ts`), nicht um ein Verzeichnis.
 *
 * ── ⚠ WARUM DIE BESTÄTIGUNG EINE DATENBANKFUNKTION AUFRUFT UND KEIN `.update()` IST ───────────
 * `service_role` hat auf `retail_tariffs` UPDATE — nicht, um Zeilen zu ändern, sondern für das
 * Schliessen der Vorgängerin und die Zeilensperre im Anlageweg. Über PostgREST liesse sich mit
 * diesem Recht JEDE Spalte überschreiben, auch der Preis selbst. Ein `.update({ checked_at })` von
 * hier aus wäre technisch kürzer und machte „nie in-place überschrieben" zu einer Konvention statt
 * einer Regel: Der nächste Umbau setzte ein zweites Feld dazu, und niemandem fiele es auf.
 * `public.confirm_retail_tariff` kann strukturell nichts anderes anfassen — die Auflage aus dem Kopf
 * der Schreibweg-Migration verlangt genau das.
 */
import { revalidatePath } from 'next/cache'
import { isCurrentUserAdmin } from './guard'
import { currentUserEmail } from './session'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { RETAIL_TARIFFS_HREF } from './retail-tariffs'
import { readRetailTariffForm, retailTariffSchema } from './retail-tariffs-schema'
import { toFieldErrors } from './schema'
import type { AdminState } from './schema'

const FORBIDDEN = 'Keine Berechtigung. Bitte laden Sie die Seite neu.'
const GENERIC = 'Das hat nicht geklappt. Bitte versuchen Sie es erneut.'

/** de-AT, wie überall im Admin-Bereich — ein zweites Datumsformat wäre ein zweiter Fundort. */
function formatDay(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium', timeZone: 'UTC' }).format(parsed)
}

/**
 * Legt einen Lieferanten-Tarifstand an und schliesst dabei die bisher offene Zeile derselben
 * Kombination (Anbieter + Segment).
 *
 * Der ganze Vorgang ist EIN Datenbankaufruf. Über PostgREST wären Suchen, Schliessen und Anlegen
 * drei getrennte Transaktionen: Zwei gleichzeitige Aufrufe läsen beide „es gibt keine offene Zeile"
 * und legten beide eine an — mit verschiedenem `valid_from`, sodass der Unique-Constraint NICHT
 * greift. Begründung in voller Länge im Kopf der Migration.
 */
export async function createRetailTariffAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const values = Object.fromEntries(
    [...formData.entries()]
      .filter(([, v]) => typeof v === 'string')
      .map(([k, v]) => [k, String(v)]),
  )

  /*
   * Die Rollenprüfung steht VOR der Formprüfung: Wer keinen Zugang hat, soll nicht erfahren, welche
   * Felder das Formular kennt und wie sie geprüft werden.
   */
  if (!(await isCurrentUserAdmin())) return { formError: FORBIDDEN, values }

  const parsed = retailTariffSchema.safeParse(readRetailTariffForm(formData))
  if (!parsed.success) {
    return { fieldErrors: toFieldErrors(parsed.error.issues), values }
  }
  const input = parsed.data

  /*
   * `created_by` ist die Adresse des Kontos, das den Stand eingetragen hat — nicht seine Kennung:
   * Eine UUID sagt niemandem, WER 2028 diesen Vergleichspreis verantwortet hat. Fehlt sie (die
   * Sitzung ist zwischen Prüfung und Klick weggefallen), steht ein erkennbarer Platzhalter da statt
   * eines leeren Strings, der später wie eine Angabe aussähe.
   */
  const createdBy = (await currentUserEmail()) ?? 'unbekannt'

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.rpc('create_retail_tariff', {
    p_provider_id: input.providerId,
    p_provider_name: input.providerName,
    p_segment: input.segment,
    p_energy_price_ct_per_kwh: input.energyPriceCtPerKwh,
    p_base_fee_eur_per_month: input.baseFeeEurPerMonth,
    p_price_basis: input.priceBasis,
    p_source_url: input.sourceUrl,
    p_valid_from: input.validFrom,
    p_created_by: createdBy,
  })

  if (error) {
    /*
     * Die Funktion beantwortet ihre fachlichen Fälle als STATUS; was hier ankommt, ist entweder eine
     * ihrer `raise`-Ausnahmen (P0001, Meldung = der Fall) oder ein echter Betriebsfehler.
     */
    const code = (error as { code?: string }).code
    if (code === 'P0001') {
      switch (error.message) {
        case 'duplicate_valid_from':
          return {
            fieldErrors: {
              validFrom:
                'Für diesen Anbieter und diese Kundengruppe gibt es bereits einen Stand mit genau ' +
                'diesem Beginn. Ein bestehender Stand wird nicht überschrieben — eine rückwirkende ' +
                'Korrektur ist hier bewusst nicht möglich.',
            },
            values,
          }
        case 'invalid_input':
          return {
            formError:
              'Mindestens ein Wert liegt ausserhalb dessen, was die Datenbank zulässt ' +
              '(Kundengruppe, Preisbasis oder ein leerer Quellenbeleg).',
            values,
          }
      }
    }
    console.error('[admin/retail-tariffs] create_retail_tariff:', error)
    return { formError: GENERIC, values }
  }

  const result = (data ?? {}) as {
    status?: unknown
    closed_count?: unknown
    closed_valid_until?: unknown
    open_valid_from?: unknown
  }

  switch (result.status) {
    case 'created': {
      revalidatePath(RETAIL_TARIFFS_HREF)
      const closed = Number(result.closed_count ?? 0)
      const until = typeof result.closed_valid_until === 'string' ? result.closed_valid_until : null

      return {
        success:
          'Tarifstand angelegt.' +
          (closed > 0 && until
            ? ` Der bisher gültige Stand wurde automatisch zum ${formatDay(until)} beendet — es ` +
              'entsteht dadurch weder eine Lücke noch eine Überschneidung.'
            : ' Für diesen Anbieter und diese Kundengruppe gab es noch keinen offenen Stand.'),
        /*
         * ⚠ AUCH IM ERFOLGSFALL FAHREN DIE EINGABEN MIT — dieselbe Begründung wie beim Anlegen eines
         * Netzbetreiber-Stands: Das Formular ersetzt sich danach durch eine reine Anzeige dessen, was
         * angelegt wurde, und die Felder sind dort unkontrolliert. Ohne diese Zeile wäre der
         * angelegte Stand für den Eintragenden im selben Moment unsichtbar, in dem er unumkehrbar
         * wird — und hier gibt es nicht einmal einen Löschweg, um nachzusehen.
         */
        values,
      }
    }
    case 'invalid_valid_from': {
      const open = typeof result.open_valid_from === 'string' ? result.open_valid_from : null
      return {
        fieldErrors: {
          validFrom:
            (open
              ? `Der bisher gültige Stand beginnt am ${formatDay(open)}. `
              : 'Es gibt bereits einen gültigen Stand. ') +
            'Ein neuer Stand muss NACH diesem Tag beginnen — dieser Weg hängt nur neue Preise an ' +
            'und korrigiert keine bestehenden.',
        },
        values,
      }
    }
    default:
      console.error('[admin/retail-tariffs] unerwartete Antwort:', data)
      return { formError: GENERIC, values }
  }
}

/**
 * Bestätigt einen unveränderten Stand: setzt AUSSCHLIESSLICH `checked_at` auf jetzt.
 *
 * ── WOFÜR DAS GUT IST ──────────────────────────────────────────────────────────────────────────
 * `valid_from` sagt, ab wann der Preis gilt; `checked_at` sagt, wann zuletzt jemand nachgesehen hat,
 * dass er noch dasteht. Ohne diesen Weg gäbe es die zweite Aussage nur beim ANLEGEN — ein Stand vom
 * 1. Jänner, der heute noch stimmt, sähe dauerhaft aus wie ein Bestand von neun Monaten, und die
 * Veraltet-Anzeige wäre nach kurzer Zeit ein Möbelstück, das niemand mehr liest.
 *
 * ⚠ Der Zeitpunkt ist KEIN Parameter — die Datenbank nimmt `now()`. Ein Parameter wäre die
 * Einladung, ein Prüfdatum zu behaupten, das nie stattgefunden hat.
 */
export async function confirmRetailTariffAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  if (!(await isCurrentUserAdmin())) return { formError: FORBIDDEN }

  const tariffId = String(formData.get('tariffId') ?? '')
  /*
   * Der Wert kommt aus einem verborgenen Feld, ist damit aber nicht vertrauenswürdiger als jede
   * andere Eingabe. Geprüft wird die FORM, nicht die Existenz: eine unbekannte, aber wohlgeformte
   * Kennung beantwortet die Datenbank selbst mit `not_found` — und das ist die ehrlichere Antwort
   * als eine erfundene hier.
   */
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tariffId)) {
    return { formError: 'Es wurde keine gültige Tarifzeile übergeben. Bitte die Seite neu laden.' }
  }

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.rpc('confirm_retail_tariff', { p_id: tariffId })

  if (error) {
    console.error('[admin/retail-tariffs] confirm_retail_tariff:', error)
    return { formError: GENERIC }
  }

  const result = (data ?? {}) as { status?: unknown; checked_at?: unknown }

  switch (result.status) {
    case 'confirmed':
      revalidatePath(RETAIL_TARIFFS_HREF)
      return { success: 'Als weiterhin zutreffend bestätigt — der Prüfzeitpunkt steht auf heute.' }
    case 'not_found':
      /*
       * Der reale Fall: zwei offene Browser-Fenster, eines hat den Stand inzwischen abgelöst. Ein
       * allgemeines „hat nicht geklappt" liesse den Admin die Ursache suchen, die es nicht gibt.
       *
       * ⚠ Ohne `revalidatePath`: Es wurde nichts geändert, und ein Neurendern behauptete das
       * Gegenteil. Die Meldung sagt, was zu tun ist.
       */
      return {
        formError:
          'Diesen Tarifstand gibt es nicht mehr — vermutlich wurde er inzwischen an anderer ' +
          'Stelle abgelöst. Bitte die Seite neu laden.',
      }
    default:
      console.error('[admin/retail-tariffs] unerwartete Antwort:', data)
      return { formError: GENERIC }
  }
}
