'use server'

/**
 * Server Action des Analysen-Abschnitts (B14-2) — der EINE Schreibweg ins Archiv.
 *
 * ── KEIN service_role, und die eslint-Erlaubnisliste bleibt unverändert ─────────────────────────
 * `public.admin_create_analysis` ist SECURITY DEFINER mit `platform.is_admin()`-Prüfung und
 * ausschliesslich an `authenticated` gegrantet — ausdrücklich AUCH als Schreibweg (B14-1: „eine
 * Analyse entsteht durch einen MENSCHEN, der sie verantwortet"). Über den service_role-Client
 * gerufen wäre `auth.uid()` null und `created_by` strukturell leer; die Urheberschaft einer
 * Geschäftsunterlage wäre dann nicht mehr feststellbar. Diese Datei importiert deshalb den
 * ANGEMELDETEN Client, genau wie die Lead-Actions (B1-3) und die Export-Route (B2-1).
 *
 * ── DIE ENTSCHEIDUNGEN LIEGEN NICHT HIER ────────────────────────────────────────────────────────
 * Was ein gültiges Bündel ist, ob es zur Datei gehört und welche fünf Auszüge daraus entstehen,
 * entscheidet `lib/admin/analysis-upload.ts` — rein, ohne Request und ohne Datenbank. Diese Datei
 * holt die Sitzung, liest das Formular und setzt den RPC ab. Scheitert die Prüfung, entsteht KEIN
 * RPC-Aufruf: die Datenbank wird nicht einmal befragt.
 */
import { revalidatePath } from 'next/cache'
import type { Json } from '@/db-types'
import { createClient } from '@/lib/supabase/server'
import { ANALYSES_HREF, DEFAULT_ANALYSIS_KIND, ANALYSIS_KINDS, type AnalysisKind } from './analyses'
import { prepareAnalysisUpload } from './analysis-upload'
import type { AdminState } from './schema'

const FORBIDDEN = 'Keine Berechtigung. Bitte laden Sie die Seite neu.'
const GENERIC = 'Das hat nicht geklappt. Bitte versuchen Sie es erneut.'

/** SQLSTATE 42501 = insufficient_privilege — angemeldet, aber keine Adminrolle. */
function isForbidden(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42501'
}

function readKind(value: FormDataEntryValue | null): AnalysisKind {
  const raw = typeof value === 'string' ? value : ''
  return (ANALYSIS_KINDS as readonly string[]).includes(raw)
    ? (raw as AnalysisKind)
    : DEFAULT_ANALYSIS_KIND
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

/**
 * Legt eine Analyse an.
 *
 * Gibt `AdminState` zurück wie alle Admin-Actions (Erfolgsmeldung ODER Fehler, plus die Eingaben
 * zur Wiederanzeige) — es wird bewusst NICHT umgeleitet: die Erfolgsmeldung nennt die abgeleiteten
 * Kennzahlen, und die sind das Einzige, woran ein Mensch sieht, dass das richtige Bündel
 * archiviert wurde. Eine Weiterleitung auf die Liste verschluckte sie.
 */
export async function createAnalysisAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const values = {
    customerLabel: text(formData, 'customerLabel'),
    siteLabel: text(formData, 'siteLabel'),
    analysisKind: readKind(formData.get('analysisKind')),
    leadId: text(formData, 'leadId'),
    supersedesId: text(formData, 'supersedesId'),
  }

  const bundleFile = formData.get('bundle')
  const sourceFile = formData.get('sourceFile')

  if (!(bundleFile instanceof File) || bundleFile.size === 0) {
    return { fieldErrors: { bundle: 'Bitte die Bündel-Datei (.json) auswählen.' }, values }
  }
  if (!(sourceFile instanceof File) || sourceFile.size === 0) {
    return {
      fieldErrors: { sourceFile: 'Bitte die Ursprungsdatei auswählen (dieselbe wie im Rechner).' },
      values,
    }
  }

  const prepared = await prepareAnalysisUpload({
    bundleText: await bundleFile.text(),
    sourceFileName: sourceFile.name,
    sourceFile: new Uint8Array(await sourceFile.arrayBuffer()),
    form: values,
  })

  if (!prepared.ok) {
    return prepared.field
      ? { fieldErrors: { [prepared.field]: prepared.message }, values }
      : { formError: prepared.message, values }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { formError: FORBIDDEN, values }

  /*
   * `p_inputs`/`p_result` sind im reinen Prüfmodul bewusst `unknown`: es darf die generierten
   * Datenbanktypen nicht kennen (sonst wäre es nicht mehr ohne Schema testbar) — und es soll die
   * beiden Blöcke ausdrücklich NICHT anfassen, sondern wortgleich durchreichen. Die Zusicherung auf
   * `Json` steht deshalb genau hier, an der einzigen Stelle, die mit der Datenbank spricht.
   */
  const { data, error } = await supabase.rpc('admin_create_analysis', {
    ...prepared.prepared.args,
    p_inputs: prepared.prepared.args.p_inputs as Json,
    p_result: prepared.prepared.args.p_result as Json,
  })

  if (error) {
    if (isForbidden(error)) return { formError: FORBIDDEN, values }
    console.error('[admin/analysen] admin_create_analysis:', error)
    /*
     * 22023 = invalid_parameter_value: die Datenbank hat eine der B14-1-Prüfungen gezogen
     * (Prüfsumme, gzip-Bindung, Pflichtfeld). Der Text stammt dann von dort und ist fachlich
     * aussagekräftig — er wird durchgereicht statt durch „hat nicht geklappt" ersetzt.
     */
    if ((error as { code?: string }).code === '22023') {
      return { formError: `Die Datenbank hat den Vorgang abgelehnt: ${error.message}`, values }
    }
    return { formError: GENERIC, values }
  }

  const status = (data as { status?: unknown } | null)?.status
  if (status !== 'ok') {
    console.error('[admin/analysen] admin_create_analysis: unerwartete Antwort', data)
    return { formError: GENERIC, values }
  }

  revalidatePath(ANALYSES_HREF)

  const { extracts, bundle } = prepared.prepared
  return {
    success:
      `Analyse archiviert. Eingefroren: abgerechnete Leistung ${extracts.billedKwBefore.toFixed(1)} kW → ` +
      `${extracts.billedKwAfter.toFixed(1)} kW, Ersparnis ${Math.round(extracts.annualSavingEur)} €/Jahr` +
      (extracts.recommendedBatteryLabel ? `, Empfehlung ${extracts.recommendedBatteryLabel}` : '') +
      `. Engine ${bundle.engineVersion} (${bundle.engineCommitSha.slice(0, 10)}). ` +
      'Diese Zeile ist unveränderlich — eine Korrektur ist eine neue Analyse, die diese ersetzt.',
  }
}
