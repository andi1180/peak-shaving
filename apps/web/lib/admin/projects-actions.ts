'use server'

/**
 * Server Action der Projektliste — die Anwendungsseite von `public.admin_create_project`
 * (B24, Account/Projekt-Fundament; Oberfläche Teil 1 Schritt 1).
 *
 * ── KEIN service_role, exakt wie die Lead-, Partner-, Analyse- und Rückfragen-Actions ───────────
 * Der Wrapper ist `authenticated`-only und prüft `platform.is_admin()` INTERN als erste Anweisung.
 * Die Autorisierung hängt damit nicht an dieser Datei; ein Fehler hier kann keinem Nicht-Admin
 * Schreibzugriff verschaffen. Es kommt derselbe zweite Grund dazu wie bei
 * `open-questions-actions.ts`: der Wrapper schreibt `created_by = auth.uid()`. Über `service_role`
 * wäre die Spalte strukturell leer — und WER ein Projekt angelegt hat, ist die Angabe, an der man
 * ein admin-geführtes Projekt (`account_id is null`) überhaupt jemandem zuordnen kann. Die
 * `no-restricted-imports`-Erlaubnisliste wurde für diesen Pfad NICHT erweitert.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ES WIRD GENAU EIN FELD ERFASST — und das ist eine Entscheidung, keine Sparsamkeit
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `admin_create_project(p_customer_label, p_account_id)` nimmt zwar zwei Parameter; erfasst wird
 * hier nur der erste.
 *
 *   * `p_account_id` bleibt weg. Ein Projekt, das ein Admin anlegt, ist per Delta §2.2 ein
 *     admin-geführtes (`account_id is null`) — entweder ein eigenes COOLiN-Projekt oder eines
 *     stellvertretend für einen Kunden ohne Konto. Ein Feld dafür setzte voraus, dass es eine
 *     Kontoauswahl gibt, und die gibt es im Admin-Bereich nicht.
 *   * SEGMENT UND BRANCHE werden hier ausdrücklich NICHT gefragt. Sie entstehen im Gespräch über
 *     die bestehenden Werkzeuge `set_segment`/`set_industry` (dritter bzw. sechster Bauschritt) und
 *     landen über `update_project_draft` am Projekt. Sie hier ein zweites Mal zu erfassen hiesse,
 *     zwei Schreibwege für dieselbe Angabe zu haben — und der eine wüsste nicht, was der andere
 *     getan hat. `admin_create_project` kennt die zwei Felder ohnehin nicht.
 */
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { AdminState } from './schema'
import { PROJECTS_HREF } from './projects'

const FORBIDDEN = 'Keine Berechtigung. Bitte laden Sie die Seite neu.'
const GENERIC = 'Das hat nicht geklappt. Bitte versuchen Sie es erneut.'

/** SQLSTATE 42501 = insufficient_privilege. Die Rolle wurde zwischen Aufbau und Klick entzogen. */
function isForbidden(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42501'
}

/**
 * Legt ein admin-geführtes Projekt an (`account_id` bleibt null).
 *
 * Die Erfolgsmeldung sagt im Klartext, was als Nächstes fehlt: das Projekt ist ein leerer Container
 * — Dateneingabe und Report gibt es in diesem Bauschritt noch nicht. Ohne den Satz sähe ein frisch
 * angelegtes Projekt aus wie eines, an dem etwas kaputt ist.
 */
export async function createAdminProjectAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const customerLabel = String(formData.get('customerLabel') ?? '')
  const values = { customerLabel }

  /*
   * Die Leerprüfung steht hier UND im Wrapper (`invalid_label`), und das ist keine Verdopplung:
   * der Wrapper ist die harte Grenze (er sieht auch Aufrufe an diesem Formular vorbei, und der
   * CHECK `projects_customer_label_not_blank` dahinter noch einmal), die Prüfung hier liefert die
   * Meldung AM FELD statt eines Status nach dem Roundtrip — und erspart einen Schreibversuch, der
   * ohnehin nichts anlegen könnte.
   */
  if (customerLabel.trim() === '') {
    return {
      fieldErrors: {
        customerLabel:
          'Bitte eine Bezeichnung angeben. Sie ist die einzige Angabe, an der dieses Projekt ' +
          'später in der Liste wiederzuerkennen ist.',
      },
      values,
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { formError: FORBIDDEN, values }

  const { data, error } = await supabase.rpc('admin_create_project', {
    p_customer_label: customerLabel,
  })

  if (error) {
    if (isForbidden(error)) return { formError: FORBIDDEN, values }
    console.error('[admin/projects] admin_create_project:', error)
    return { formError: GENERIC, values }
  }

  const status = (data as { status?: unknown } | null)?.status
  switch (status) {
    case 'ok':
      revalidatePath(PROJECTS_HREF)
      return {
        success:
          `Projekt „${customerLabel.trim()}" angelegt. Es steht jetzt in der Liste — Dateneingabe ` +
          'und Report folgen in einem eigenen Schritt.',
      }
    case 'invalid_label':
      // Erreichbar nur an der Feldprüfung oben vorbei (Leerzeichen fängt sie bereits ab).
      return { fieldErrors: { customerLabel: 'Bitte eine Bezeichnung angeben.' }, values }
    default:
      console.error('[admin/projects] unerwartete Antwort:', data)
      return { formError: GENERIC, values }
  }
}
