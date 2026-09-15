'use server'

/**
 * Server Action der Prompt-Pflege — die Anwendungsseite von
 * `public.admin_set_system_prompt_extension` (B24 Station 6).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ KEIN service_role, UND KEIN `isCurrentUserAdmin()` IN DIESER DATEI — beides mit Grund
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der Wrapper ist `authenticated`-only und prüft `platform.is_admin()` INTERN als erste Anweisung;
 * ohne Adminrolle WIRFT er mit `errcode 42501`. Die Autorisierung hängt damit nicht an dieser Datei,
 * und ein Fehler hier kann keinem Nicht-Admin Schreibzugriff verschaffen. Dieselbe Lage und dasselbe
 * Muster wie `open-questions-actions.ts` — und ausdrücklich NICHT wie `retail-tariffs-actions.ts`:
 * jene Funktionen sind SECURITY INVOKER und laufen als `service_role` ohne JWT, dort MUSS die
 * Prüfung im Anwendungscode stehen, weil die Datenbank nichts zu prüfen hat. Hier hat sie etwas.
 *
 * Es kommt ein zweiter Grund dazu: der Wrapper schreibt `created_by = auth.uid()`. Über
 * `service_role` wäre die Spalte strukturell leer — und WER einen Text gesetzt hat, der ab sofort
 * jedes Gespräch führt, ist die halbe Aussage. Die `no-restricted-imports`-Erlaubnisliste wurde für
 * diesen Pfad NICHT erweitert.
 *
 * ── ⚠ ES WIRD KEIN `p_valid_from` ÜBERGEBEN ────────────────────────────────────────────────────
 * Der Vorgabewert der Datenbank (`current_date`) ist für diese Oberfläche der richtige, und zwar
 * nicht aus Bequemlichkeit: Ein Datum in der Zukunft erzeugt einen Stand, der HEUTE noch nicht gilt
 * — `admin_get_...` zeigt ihn (es liest den offenen), `get_system_prompt_extension` liefert
 * weiterhin den alten. Die Seite zeigte dann einen Text, nach dem gerade nicht gesprochen wird, und
 * nichts an ihr sagte das. Eine Terminierung ist ein eigener Ausbau mit eigener Anzeige; hier wäre
 * sie ein Feld mit einer stillen Nebenwirkung.
 *
 * ── DIE FOLGE DAVON, UND SIE IST DIE EIGENTLICHE MECHANIK DIESER SEITE ─────────────────────────
 * Weil der Beginn immer HEUTE ist, trifft der Aufruf genau zwei Fälle: Der offene Stand ist älter
 * → er wird auf gestern geschlossen und ein neuer entsteht (`created`). Der offene Stand ist von
 * heute → sein Text wird in place ersetzt (`replaced`). Mehr kann hier nicht passieren, und die
 * Erfolgsmeldung unterscheidet die zwei, weil sie fachlich verschieden sind: Das eine ist eine neue
 * Fassung, das andere eine Korrektur, nach der der vorige Wortlaut des heutigen Tages NIRGENDS mehr
 * steht (diese Tabelle führt über eine in-place-Korrektur keine Historie).
 */
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { AdminState } from './schema'
import {
  PROMPT_EXTENSION_KIND_LABELS,
  SYSTEM_PROMPT_EXTENSIONS_HREF,
  isPromptExtensionKind,
} from './system-prompt-extensions'

const FORBIDDEN = 'Keine Berechtigung. Bitte laden Sie die Seite neu.'
const GENERIC = 'Das hat nicht geklappt. Bitte versuchen Sie es erneut.'

/**
 * Die EINE Meldung für einen leeren Text — benutzt von der Feldprüfung hier UND vom Status
 * `invalid_text` der Datenbank. Zwei Formulierungen für denselben Sachverhalt liefen beim nächsten
 * Umformulieren auseinander, und derselbe Klick bekäme je nach Weg eine andere Auskunft.
 */
const EMPTY_TEXT =
  'Bitte einen Text eintragen. Ein leeres Feld schaltet die Erweiterung NICHT ab — dafür gibt es ' +
  'bewusst keinen Weg; der bisherige Text bliebe unverändert stehen.'

/** SQLSTATE 42501 = insufficient_privilege. Die Rolle wurde zwischen Aufbau und Klick entzogen. */
function isForbidden(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42501'
}

/**
 * Setzt die Erweiterung EINER Art als heutigen Stand.
 *
 * ⚠ Die zwei Arten sind zwei unabhängige Ketten (Migration `20260915120000`): Dieser Aufruf fasst
 * ausschliesslich Stände DERSELBEN `kind` an. Ohne `p_kind` — also mit dem Vorgabewert `kunde` —
 * schlösse ein Energieberater-Schreibvorgang den offenen KUNDEN-Stand oder ersetzte dessen Text,
 * ohne jede Meldung. Deshalb wird die Art hier nie weggelassen und vorher gegen die bekannte
 * Wertemenge gehalten.
 */
export async function saveSystemPromptExtensionAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const kind = String(formData.get('kind') ?? '')
  const text = String(formData.get('text') ?? '')
  const values = { text }

  /*
   * Die Art kommt aus einem versteckten Feld, ist damit aber nicht vertrauenswürdiger als jede
   * andere Eingabe. Sie ist KEIN Feldfehler: Der Nutzer hat sie nicht eingegeben und könnte an
   * keinem Feld etwas korrigieren — eine Meldung am Textfeld schickte ihn auf die falsche Suche.
   */
  if (!isPromptExtensionKind(kind)) {
    return { formError: GENERIC, values }
  }

  /*
   * Die Leerprüfung steht hier UND im Wrapper (`invalid_text`), und das ist keine Verdopplung: der
   * Wrapper ist die harte Grenze (er sieht auch Aufrufe an diesem Formular vorbei), die Prüfung
   * hier liefert die Meldung AM FELD statt eines Status nach dem Roundtrip — und sie erspart einen
   * Schreibversuch, der nie etwas ändern könnte.
   */
  if (text.trim() === '') {
    return { fieldErrors: { text: EMPTY_TEXT }, values }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { formError: FORBIDDEN, values }

  const { data, error } = await supabase.rpc('admin_set_system_prompt_extension', {
    p_text: text,
    p_kind: kind,
  })

  if (error) {
    /*
     * Der Wrapper beantwortet seine fachlichen Fälle als STATUS; was hier als Ausnahme ankommt, ist
     * entweder sein 42501 (keine Adminrolle) oder ein echter Betriebsfehler. Die Rechtefläche
     * ändert sich dadurch nicht — die Meldung soll nur lesbar bleiben statt eine rohe Ausnahme zu
     * zeigen.
     */
    if (isForbidden(error)) return { formError: FORBIDDEN, values }
    console.error('[admin/ki-prompts] admin_set_system_prompt_extension:', error)
    return { formError: GENERIC, values }
  }

  const label = PROMPT_EXTENSION_KIND_LABELS[kind]
  const status = (data as { status?: unknown } | null)?.status

  switch (status) {
    case 'created':
      revalidatePath(SYSTEM_PROMPT_EXTENSIONS_HREF)
      return {
        success:
          `Neu gesetzt — „${label}" läuft ab sofort mit diesem Text. Der bisher gültige Stand ` +
          'wurde automatisch gestern beendet und bleibt als abgelöste Fassung erhalten.',
        values,
      }
    case 'replaced':
      revalidatePath(SYSTEM_PROMPT_EXTENSIONS_HREF)
      return {
        success:
          `Heutiger Stand korrigiert — „${label}" läuft ab sofort mit diesem Text. Es ist KEINE ` +
          'neue Fassung entstanden: der vorige Wortlaut von heute ist damit nirgends mehr zu finden.',
        values,
      }
    case 'invalid_text':
      // Erreichbar nur an der Feldprüfung oben vorbei (sie fängt auch reine Leerzeichen ab).
      return { fieldErrors: { text: EMPTY_TEXT }, values }
    case 'invalid_kind':
      // Ebenso unerreichbar, solange die Liste hier und der CHECK übereinstimmen — s. dort.
      console.error('[admin/ki-prompts] invalid_kind:', kind)
      return { formError: GENERIC, values }
    case 'invalid_valid_from':
    case 'duplicate_valid_from':
      /*
       * Beide setzen einen Beginn voraus, den diese Oberfläche nicht setzen kann (sie schickt kein
       * `p_valid_from`). Sie sind damit nur über einen Stand erreichbar, der an anderer Stelle in
       * die ZUKUNFT datiert wurde — dann ist „heute" tatsächlich zu früh, und die Meldung sagt das,
       * statt einen Fehler zu behaupten, den niemand hier verursacht hat.
       */
      return {
        formError:
          'Für diese Art gibt es bereits einen Stand, der später beginnt als heute. Er lässt sich ' +
          'über diese Seite nicht überschreiben — bitte in der Datenbank nachsehen.',
        values,
      }
    default:
      console.error('[admin/ki-prompts] unerwartete Antwort:', data)
      return { formError: GENERIC, values }
  }
}
