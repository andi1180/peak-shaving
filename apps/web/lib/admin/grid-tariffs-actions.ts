'use server'

/**
 * Server Action des Abschnitts „Netzbetreiber-Tarife" (B21-2b) — der EINZIGE Schreibweg auf
 * `public.grid_tariffs` und `public.grid_tariff_rate_windows`.
 *
 * ── ⚠ DIESE DATEI TRÄGT DIE AUTORISIERUNG, UND DAS IST EINE ABWEICHUNG ──────────────────────────
 * Jeder andere Admin-Schreibweg dieses Systems ruft einen `admin_*`-Wrapper in `platform`, der
 * `platform.is_admin()` als erste Anweisung selbst prüft. Ein Fehler im Anwendungscode kann dort
 * niemandem Schreibzugriff verschaffen.
 *
 * Hier ist es anders, und der Grund steht in der Migration `20260828090000`: Die Tabellen liegen in
 * `public`, sie tragen veröffentlichte Preisblätter ohne Personenbezug, und B21-1 hat für sie
 * bewusst den direkten Tabellenzugriff statt des Wrapper-Musters gewählt. `public.create_grid_tariff`
 * ist deshalb SECURITY INVOKER, läuft als `service_role` — und `service_role` trägt kein JWT.
 * `auth.uid()` ist leer; es gibt in der Datenbank nichts zu prüfen.
 *
 *   ⇒ Die Zugangsentscheidung fällt in GENAU ZWEI Zeilen: `isCurrentUserAdmin()` unten, VOR dem
 *     Anlegen des Clients. Eine Server Action ist ein eigener, direkt adressierbarer Endpunkt —
 *     dass die Seite davor prüft, schützt sie NICHT (dieselbe Lehre wie in B19).
 *
 * Fail closed: alles ausser einem ausdrücklichen `true` gilt als „kein Zugang", auch ein Fehler beim
 * Lesen der Rolle.
 *
 * ── WARUM `service_role` UND NICHT DER ANGEMELDETE CLIENT ───────────────────────────────────────
 * `authenticated` hat auf beiden Tabellen ausschliesslich `select` (B21-1) und bekommt in B21-2b
 * bewusst kein Schreibrecht: ein Schreib-Grant für `authenticated` gälte für JEDES angemeldete
 * Konto, nicht nur für Admins — RLS könnte das nur mit einer Policy einfangen, die ihrerseits
 * `platform.is_admin()` aufriefe, also mit dem Wrapper-Muster, das B21-1 für diese Tabellen
 * verworfen hat. Die eslint-Erlaubnisliste ist dafür um GENAU DIESE EINE DATEI erweitert (Muster
 * `lib/auth/admin-api.ts`, B18-2a), nicht um ein Verzeichnis.
 */
import { revalidatePath } from 'next/cache'
import { isCurrentUserAdmin } from './guard'
import { currentUserEmail } from './session'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { GRID_TARIFFS_HREF } from './grid-tariffs'
import {
  addRateWindowSchema,
  gridTariffFieldErrors,
  gridTariffSchema,
  readAddRateWindowForm,
  readGridTariffForm,
} from './grid-tariffs-schema'
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
 * Legt einen Tarifstand an und schliesst dabei die bisher offene Zeile derselben Kombination.
 *
 * Der ganze Vorgang ist EIN Datenbankaufruf, und das ist keine Bequemlichkeit: Über PostgREST wäre
 * jeder einzelne Schreibvorgang seine eigene Transaktion, und ein Abbruch nach dem zweiten liesse
 * eine Tarifzeile ohne Zeitfenster stehen — bei bereits geschlossener Vorgängerin. Begründung in
 * voller Länge im Kopf der Migration.
 */
export async function createGridTariffAction(
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

  const parsed = gridTariffSchema.safeParse(readGridTariffForm(formData))
  if (!parsed.success) {
    return { fieldErrors: gridTariffFieldErrors(parsed.error.issues), values }
  }
  const input = parsed.data

  /*
   * `created_by` ist die Adresse des Kontos, das den Stand eingetragen hat — nicht seine Kennung:
   * Eine UUID sagt niemandem, WER 2027 diesen Leistungspreis verantwortet hat. Fehlt sie (die
   * Sitzung ist zwischen Prüfung und Klick weggefallen), steht ein erkennbarer Platzhalter da statt
   * eines leeren Strings, der später wie eine Angabe aussähe.
   */
  const createdBy = (await currentUserEmail()) ?? 'unbekannt'

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.rpc('create_grid_tariff', {
    p_operator_id: input.operatorId,
    p_operator_name: input.operatorName,
    p_netzebene: input.netzebene,
    p_metering_variant: input.meteringVariant ?? undefined,
    p_grundpreis_amount: input.grundpreisAmount,
    p_grundpreis_unit: input.grundpreisUnit,
    p_netzverlust_ct_per_kwh: input.netzverlustCtPerKwh,
    p_price_basis: input.priceBasis,
    p_valid_from: input.validFrom,
    p_created_by: createdBy,
    p_windows: input.windows.map((w) => ({
      label: w.label,
      month_day_from: w.monthDayFrom ?? null,
      month_day_to: w.monthDayTo ?? null,
      time_from: w.timeFrom,
      time_to: w.timeTo,
      ct_per_kwh: w.ctPerKwh,
      // B21-2d: `jsonb_to_recordset` liest das Feld seit `20260902180000` mit; ein fehlendes ergibt
      // dort null. Bewusst `?? null` statt Weglassen — so steht im Aufruf, dass es die Spalte gibt.
      note: w.note ?? null,
    })),
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
                'Für diese Kombination gibt es bereits einen Stand mit genau diesem Beginn. ' +
                'Ein bestehender Stand wird nicht überschrieben — eine rückwirkende Korrektur ist ' +
                'hier bewusst nicht möglich.',
            },
            values,
          }
        case 'invalid_window':
          return {
            formError:
              'Mindestens ein Zeitfenster konnte nicht gelesen werden. Bitte Uhrzeiten als HH:MM ' +
              'und den Arbeitspreis als Zahl angeben.',
            values,
          }
        case 'invalid_input':
          return {
            formError:
              'Mindestens ein Wert liegt ausserhalb dessen, was die Datenbank zulässt ' +
              '(Netzebene, Einheit oder Preisbasis).',
            values,
          }
      }
    }
    console.error('[admin/grid-tariffs] create_grid_tariff:', error)
    return { formError: GENERIC, values }
  }

  const result = (data ?? {}) as {
    status?: unknown
    window_count?: unknown
    closed_count?: unknown
    closed_valid_until?: unknown
    open_valid_from?: unknown
  }

  switch (result.status) {
    case 'created': {
      revalidatePath(GRID_TARIFFS_HREF)
      const windows = Number(result.window_count ?? 0)
      const closed = Number(result.closed_count ?? 0)
      const until = typeof result.closed_valid_until === 'string' ? result.closed_valid_until : null

      return {
        success:
          `Tarifstand angelegt, mit ${windows} ${windows === 1 ? 'Zeitfenster' : 'Zeitfenstern'}.` +
          (closed > 0 && until
            ? ` Der bisher gültige Stand wurde automatisch zum ${formatDay(until)} beendet — es ` +
              'entsteht dadurch weder eine Lücke noch eine Überschneidung.'
            : ' Für diese Kombination gab es noch keinen offenen Stand.'),
        /*
         * ⚠ AUCH IM ERFOLGSFALL FAHREN DIE EINGABEN MIT — und das ist keine Kosmetik.
         * Das Formular ersetzt sich nach einem `created` durch eine reine Anzeige dessen, was
         * angelegt wurde (s. `components/admin/grid-tariff-form.tsx`), und die Felder sind dort
         * unkontrolliert: was der Admin getippt hat, steht danach nirgends mehr im Browser.
         * Ohne diese Zeile wäre der angelegte Stand für ihn im selben Moment unsichtbar, in dem
         * er unumkehrbar wird — und das Einzige, was ihm bliebe, wäre ein Löschvorgang mit
         * Protokoll (B21-2c), um überhaupt nachzusehen, was er abgeschickt hat.
         *
         * Es ist derselbe `values`-Slot, den die Fehlerfälle ohnehin benutzen (AdminState); es
         * entsteht kein zweiter Rückkanal und kein neues Feld.
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
            'Ein neuer Stand muss NACH diesem Tag beginnen — dieser Weg hängt nur neue Sätze an ' +
            'und korrigiert keine bestehenden.',
        },
        values,
      }
    }
    case 'no_windows':
      return {
        formError:
          'Ohne Zeitfenster ist die Tarifzeile unvollständig — bitte mindestens eines angeben.',
        values,
      }
    default:
      console.error('[admin/grid-tariffs] unerwartete Antwort:', data)
      return { formError: GENERIC, values }
  }
}

/**
 * Entfernt GENAU EINE Tarifzeile samt ihrer Zeitfenster und hinterlässt dabei einen vollständigen
 * Abzug in `public.grid_tariff_deletions` (B21-2c).
 *
 * ── WARUM ES DIESEN WEG ÜBERHAUPT GIBT ──────────────────────────────────────────────────────────
 * Der Pflegeweg hängt nur an. Ein vertippter PROBEEINTRAG blieb damit für immer stehen — und er
 * belegt die Kombination, sodass jeder echte Stand mit demselben oder früherem Beginn auf
 * `invalid_valid_from` läuft. Das Löschen behebt genau das. Es ist ausdrücklich ein Werkzeug für
 * Testzeilen und KEINE rückwirkende Korrektur eines bereits gerechneten Zeitraums; dass jede
 * Löschung protokolliert wird, ist der Unterschied zwischen beidem.
 *
 * ── DIESELBE ZUGANGSENTSCHEIDUNG WIE BEIM ANLEGEN, AN DERSELBEN STELLE ──────────────────────────
 * `public.delete_grid_tariff` ist wie `create_grid_tariff` SECURITY INVOKER und prüft KEINE Rolle
 * (der Aufrufer ist `service_role` und trägt kein JWT). Die Prüfung steht deshalb hier, als erste
 * Anweisung und fail closed — eine Server Action ist ein eigener, direkt adressierbarer Endpunkt;
 * dass die Seite davor prüft, schützt sie nicht.
 */
export async function deleteGridTariffAction(
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

  const deletedBy = (await currentUserEmail()) ?? 'unbekannt'

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.rpc('delete_grid_tariff', {
    p_tariff_id: tariffId,
    p_deleted_by: deletedBy,
  })

  if (error) {
    const code = (error as { code?: string }).code
    if (code === 'P0001' && error.message === 'not_found') {
      return {
        formError:
          'Diese Tarifzeile gibt es nicht mehr — vermutlich wurde sie inzwischen an anderer ' +
          'Stelle entfernt. Bitte die Seite neu laden.',
      }
    }
    console.error('[admin/grid-tariffs] delete_grid_tariff:', error)
    return { formError: GENERIC }
  }

  const result = (data ?? {}) as { status?: unknown; window_count?: unknown }

  if (result.status !== 'deleted') {
    console.error('[admin/grid-tariffs] unerwartete Antwort beim Löschen:', data)
    return { formError: GENERIC }
  }

  revalidatePath(GRID_TARIFFS_HREF)
  const windows = Number(result.window_count ?? 0)
  return {
    success:
      `Tarifstand gelöscht, mit ${windows} ${windows === 1 ? 'Zeitfenster' : 'Zeitfenstern'}. ` +
      'Ein vollständiger Abzug der Zeile bleibt im Löschprotokoll erhalten.',
  }
}

/**
 * Hängt GENAU EIN Zeitfenster an einen bestehenden, OFFENEN Tarifstand (B21-2d).
 *
 * ── WARUM ES DIESEN WEG GIBT ────────────────────────────────────────────────────────────────────
 * Der Anlageweg nimmt alle Zeitfenster in EINEM Vorgang entgegen. Wird später ein Fenster
 * nachgereicht (ein Preisblatt-Nachtrag, ein beim Abtippen übersehenes SNAP-Fenster), gab es dafür
 * bisher nur einen Weg: den ganzen Stand löschen und neu anlegen — protokolliert (B21-2c) und mit
 * einer neuen Kennung. Das ist für eine ERGÄNZUNG zu viel.
 *
 * ── ⚠ NUR AN EINEN OFFENEN STAND, UND DIE REGEL STEHT IN DER DATENBANK ─────────────────────────
 * Die Oberfläche bietet den Weg an einem abgelösten Stand gar nicht erst an; `add_grid_tariff_rate_window`
 * lehnt ihn zusätzlich mit `closed_tariff` ab. Beides zusammen ist keine Verdopplung, sondern zwei
 * Reichweiten: Eine Server Action ist ein eigener, direkt adressierbarer Endpunkt — dass eine Seite
 * einen Knopf weglässt, ist keine Regel.
 *
 * Dieselbe Zugangsentscheidung an derselben Stelle wie in den beiden Actions darüber: die Funktion
 * ist SECURITY INVOKER und prüft KEINE Rolle (der Aufrufer ist `service_role` und trägt kein JWT).
 */
export async function addRateWindowAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const values = Object.fromEntries(
    [...formData.entries()]
      .filter(([, v]) => typeof v === 'string')
      .map(([k, v]) => [k, String(v)]),
  )

  if (!(await isCurrentUserAdmin())) return { formError: FORBIDDEN, values }

  const parsed = addRateWindowSchema.safeParse(readAddRateWindowForm(formData))
  if (!parsed.success) {
    /*
     * `toFieldErrors` genügt hier, wo `gridTariffFieldErrors` beim Anlageformular nötig ist: Dieses
     * Formular trägt GENAU EIN Fenster mit flachen Feldnamen (`label`, `timeFrom`, …), die Pfade des
     * Schemas sind also bereits die Feldnamen. Beim Anlegen sind es Array-Pfade (`windows.2.timeFrom`),
     * und erst deren Übersetzung bringt die Meldung an die richtige ZEILE.
     */
    return { fieldErrors: toFieldErrors(parsed.error.issues), values }
  }
  const input = parsed.data

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.rpc('add_grid_tariff_rate_window', {
    p_tariff_id: input.tariffId,
    p_label: input.label,
    p_month_day_from: input.monthDayFrom ?? undefined,
    p_month_day_to: input.monthDayTo ?? undefined,
    p_time_from: input.timeFrom,
    p_time_to: input.timeTo,
    p_ct_per_kwh: input.ctPerKwh,
    p_note: input.note ?? undefined,
  })

  if (error) {
    const code = (error as { code?: string }).code
    if (code === 'P0001') {
      switch (error.message) {
        case 'not_found':
          return {
            formError:
              'Diese Tarifzeile gibt es nicht mehr — vermutlich wurde sie inzwischen entfernt. ' +
              'Bitte die Seite neu laden.',
            values,
          }
        case 'closed_tariff':
          /*
           * Über die Oberfläche unerreichbar (das Formular erscheint nur am offenen Stand). Der Fall
           * ist trotzdem real: Zwischen dem Laden der Seite und dem Klick kann ein neuer Stand
           * angelegt worden sein, der diesen hier abgelöst hat.
           */
          return {
            formError:
              'Dieser Stand ist inzwischen abgelöst. An einen abgelösten Stand lässt sich kein ' +
              'Zeitfenster mehr hängen — er ist eine abgeschlossene Aussage über einen vergangenen ' +
              'Zeitraum. Bitte die Seite neu laden; das Fenster gehört an den aktuellen Stand.',
            values,
          }
      }
    }
    console.error('[admin/grid-tariffs] add_grid_tariff_rate_window:', error)
    return { formError: GENERIC, values }
  }

  const result = (data ?? {}) as { status?: unknown; window_count?: unknown }

  if (result.status !== 'added') {
    console.error('[admin/grid-tariffs] unerwartete Antwort beim Anhängen:', data)
    return { formError: GENERIC, values }
  }

  revalidatePath(GRID_TARIFFS_HREF)
  const count = Number(result.window_count ?? 0)
  return {
    success:
      `Zeitfenster hinzugefügt. Diese Tarifzeile trägt jetzt ${count} davon. ` +
      'Ein hinzugefügtes Fenster lässt sich nicht mehr einzeln entfernen — rückgängig macht das ' +
      'nur das Löschen des ganzen Tarifstands (protokolliert).',
    /*
     * ⚠ AUCH IM ERFOLGSFALL FAHREN DIE EINGABEN MIT — aus demselben Grund wie beim Anlegen
     * (s. dortiger Kommentar): Das Formular ersetzt sich danach durch eine reine Anzeige des
     * Hinzugefügten, und seine Felder sind unkontrolliert.
     */
    values,
  }
}
