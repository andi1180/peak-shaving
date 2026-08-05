'use server'

/**
 * B19 — Server Action der intern erfassten Telefonanfrage.
 *
 * ── ⚠ IN DIESER DATEI STEHT KEIN MAILVERSAND, UND ES DARF AUCH KEINER DAZUKOMMEN ────────────────
 * Kein `deliverKontakt`, kein `handleKontaktSubmission`, kein Resend-Modul, kein
 * `lib/leads/mail.ts` — weder direkt noch über einen Umweg. Der öffentliche Weg stellt die Anfrage
 * intern zu und kann eine Bestätigungsmail an den Interessenten auslösen; dieser Weg tut beides
 * nicht. Wer anruft, hat um keine Mail gebeten.
 *
 * `lead-intake.test.ts` liest die Importe DIESER Datei und die von `lead-intake.ts` und wird rot,
 * sobald ein Mailmodul auftaucht. Der Wächter ist bewusst so gebaut, dass er den ganzen Pfad meint
 * und nicht nur die eine Zeile, die heute richtig ist.
 *
 * ── DIE AUTORISIERUNG HÄNGT AN DIESER DATEI, ANDERS ALS BEI DEN ÜBRIGEN LEAD-ACTIONS ────────────
 * Das ist der wichtigste Unterschied zu `lib/admin/leads-actions.ts` und der Grund, warum hier
 * ausdrücklich geprüft wird, statt sich auf den Wrapper zu verlassen: Die Admin-Wrapper sind
 * `authenticated`-only und rufen `platform.is_admin()` INTERN als erste Anweisung auf — ein Fehler
 * in der Action kann dort niemandem Schreibzugriff verschaffen. `public.capture_lead` ist das
 * Gegenteil: `service_role`-only, ohne jede Rollenprüfung im Rumpf (es ist der Wrapper des
 * ANONYMEN Erfassungspfads, der gar keinen eingeloggten Nutzer kennt). Fiele die Prüfung hier weg,
 * schriebe jeder, der die Action auslösen kann, unter Umgehung von RLS in den Lead-Bestand.
 *
 * Eine Server Action ist ein eigener, direkt adressierbarer Endpunkt — dass die Seite davor
 * `isCurrentUserAdmin()` prüft, schützt sie NICHT. Deshalb wird hier ein zweites Mal geprüft, und
 * zwar fail closed: alles ausser einem ausdrücklichen `true` gilt als „kein Zugang".
 *
 * ── KEIN service_role-IMPORT IN DIESER DATEI ────────────────────────────────────────────────────
 * `capture_lead` braucht ihn, aber die eslint-Erlaubnisliste nennt `lib/leads/**` und nicht
 * `lib/admin/**` — und das ist richtig so. Der Aufruf geht über `lib/leads/store.ts:captureLead`,
 * den bestehenden EINEN Datenbank-Rand des Lead-Pfads. Die Erlaubnisliste bleibt unverändert.
 */

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { captureLead } from '@/lib/leads/store'
import { LEADS_HREF } from './leads'
import { readPartnerList } from './partners'
import { readAttachOutcome, readMentionedBusinessList } from './mentioned-businesses'
import { planLeadIntake, type LeadIntakeInput } from './lead-intake'
import type { AdminState } from './schema'

const FORBIDDEN = 'Keine Berechtigung. Bitte laden Sie die Seite neu.'
const GENERIC = 'Das hat nicht geklappt. Bitte versuchen Sie es erneut.'

function text(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

/** Ein nicht angehaktes Kästchen sendet gar nichts — „fehlt" heisst `false`, nicht „ungültig". */
function checked(formData: FormData, name: string): boolean {
  return formData.get(name) !== null
}

/**
 * Nimmt eine telefonisch hereingekommene Anfrage in den Bestand auf.
 *
 * Gibt `AdminState` zurück wie alle Admin-Actions und leitet bewusst NICHT um: Die Erfolgsmeldung
 * nennt Name und Adresse, wie sie gespeichert wurden — am Telefon ist die falsch verstandene
 * E-Mail-Adresse der häufigste Fehler, und dies ist die einzige Gelegenheit, ihn zu bemerken. Eine
 * Weiterleitung auf die Liste verschluckte sie.
 */
export async function createLeadAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const values: LeadIntakeInput = {
    vorname: text(formData, 'vorname'),
    nachname: text(formData, 'nachname'),
    email: text(formData, 'email'),
    unternehmen: text(formData, 'unternehmen'),
    telefon: text(formData, 'telefon'),
    zuordnung: text(formData, 'zuordnung'),
    neueFirma: text(formData, 'neueFirma'),
    /*
     * `literal(true)` im Schema: Ein fehlendes Häkchen wird hier zu `false` und dort zu einer
     * Feldmeldung — nicht still zu „keine Einwilligung, aber speichern wir trotzdem".
     */
    datenschutz: checked(formData, 'datenschutz') as true,
    partnerFreigabe: checked(formData, 'partnerFreigabe'),
  }

  /** Zur Wiederanzeige, falls die Prüfung etwas beanstandet. Kästchen als `'on'`/`''`. */
  const echo: Record<string, string> = {
    vorname: values.vorname,
    nachname: values.nachname,
    email: values.email,
    unternehmen: values.unternehmen ?? '',
    telefon: values.telefon ?? '',
    zuordnung: values.zuordnung ?? '',
    neueFirma: values.neueFirma ?? '',
    datenschutz: values.datenschutz ? 'on' : '',
    partnerFreigabe: values.partnerFreigabe ? 'on' : '',
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { formError: FORBIDDEN, values: echo }

  const { data: isAdmin, error: adminError } = await supabase.rpc('is_admin')
  if (adminError) console.error('[admin/lead-intake] is_admin:', adminError)
  // Fail closed — auch ein Lesefehler ist keine Zusage (dieselbe Regel wie in `lib/admin/guard.ts`).
  if (isAdmin !== true) return { formError: FORBIDDEN, values: echo }

  /*
   * Die Fachbetriebe werden SERVERSEITIG neu gelesen, nicht aus dem Formular übernommen. Zwei
   * Gründe: Ein `<option>`-Wert ist im Browser in fünf Sekunden geändert, und an der Zuordnung
   * hängt später, wer ein Montageprojekt bekommt (B16-1). Und ein Betrieb kann zwischen Aufbau der
   * Seite und Klick stillgelegt worden sein — dann darf keine Freigabe an ihn mehr entstehen.
   */
  const [partnerRes, businessRes] = await Promise.all([
    supabase.rpc('admin_list_partners'),
    /*
     * Die formlos erfassten Firmen werden aus demselben Grund neu gelesen: Der Wert eines
     * `<option>` ist im Browser in fünf Sekunden geändert, und eine Kennung, die es nicht gibt,
     * bräche erst NACH dem Anlegen des Leads — als Datenbankfehler statt als Feldmeldung.
     */
    supabase.rpc('admin_list_mentioned_businesses'),
  ])

  if (partnerRes.error) {
    console.error('[admin/lead-intake] admin_list_partners:', partnerRes.error)
    return { formError: GENERIC, values: echo }
  }
  if (businessRes.error) {
    console.error('[admin/lead-intake] admin_list_mentioned_businesses:', businessRes.error)
    return { formError: GENERIC, values: echo }
  }

  const partners = readPartnerList(partnerRes.data)
  const businesses = readMentionedBusinessList(businessRes.data)
  if (partners === null || businesses === null) return { formError: FORBIDDEN, values: echo }
  const activeSlugs = partners.filter((partner) => partner.is_active).map((partner) => partner.slug)
  const businessIds = businesses.map((business) => business.id)

  const plan = planLeadIntake(values, activeSlugs, businessIds)
  if (!plan.ok) return { fieldErrors: plan.fieldErrors, values: echo }

  /*
   * Nachweisfelder der Einwilligung (B1-1: ausschliesslich Nachweis, nie Profilbildung). Sie
   * beschreiben hier bewusst die AUFNEHMENDE Stelle und nicht den Interessenten — der sass am
   * Telefon und hat keinen Browser benutzt. Etwas anderes einzutragen wäre eine Erfindung.
   */
  const headerList = await headers()
  const sourceIp = headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = headerList.get('user-agent')

  let leadId: string | null = null
  try {
    /*
     * NACHEINANDER, nicht nebenläufig: Der zweite Aufruf (die Partner-Freigabe) hängt am Lead, den
     * der erste anlegt. Parallel gestartet könnten beide denselben Lead anzulegen versuchen.
     */
    for (const call of plan.calls) {
      const result = await captureLead({ ...call, sourceIp, userAgent, locale: 'de' })
      leadId ??= result.leadId
    }
  } catch (cause) {
    /*
     * Anders als im öffentlichen Formular wird hier NICHT geschluckt. Dort gilt „eine verlorene
     * Kundenanfrage wiegt schwerer als ein verlorener Lead" — die Anfrage ist längst per Mail
     * zugestellt, der Lead ist die Zugabe. Hier ist der Lead das EINZIGE Ergebnis: Es gibt keine
     * Mail, kein zweites Artefakt und keinen Absender, der es noch einmal versuchen würde. Ein
     * stiller Fehlschlag hiesse, dass die Anfrage ersatzlos verschwindet, während auf dem
     * Bildschirm „gespeichert" steht.
     *
     * Die Adresse steht bewusst NICHT im Log-Text — ein Fehlerlog ist kein zulässiger zweiter
     * Speicherort für Personenbezug.
     */
    console.error('[admin/lead-intake] capture_lead:', cause)
    return { formError: GENERIC, values: echo }
  }

  /*
   * ── DIE FORMLOSE FIRMENERWÄHNUNG: ZWEITER AUFRUF, WEIL ES DEN LEAD VORHER NICHT GIBT ───────────
   * `public.capture_lead` ist der ANONYME Erfassungspfad (service_role-only) und wird für diesen
   * Zusatz bewusst NICHT erweitert — eine formlos genannte Firma entsteht ausschliesslich durch
   * eine angemeldete Person. `admin_attach_mentioned_business` ist deshalb `authenticated`-only
   * (`created_by = auth.uid()`) und läuft über den ANGEMELDETEN Client; die eslint-Erlaubnisliste
   * für `service_role` bleibt unangetastet.
   *
   * Für die aufnehmende Person ist es trotzdem EIN Vorgang: Anlegen-oder-Finden der Firma UND die
   * Zuordnung zum Lead passieren in EINER Transaktion in der Datenbank.
   *
   * ⚠ ZWEI AUFRUFE HEISST: ES GIBT EINEN TEILERFOLG. Der Lead steht dann bereits, die Zuordnung
   * nicht. Das wird NICHT als Erfolg quittiert und auch nicht als glatter Fehlschlag — beides wäre
   * falsch und beides führte zu einer zweiten, unnötigen Eingabe. Die Meldung sagt genau, was
   * gespeichert ist und was fehlt.
   */
  let mentionNote = ''
  if (plan.mention !== null) {
    const attach =
      leadId === null
        ? null
        : await supabase.rpc('admin_attach_mentioned_business', {
            p_lead_id: leadId,
            ...(plan.mention.kind === 'existing'
              ? { p_business_id: plan.mention.businessId }
              : { p_name: plan.mention.name }),
          })

    if (attach === null || attach.error) {
      if (attach?.error) {
        console.error('[admin/lead-intake] admin_attach_mentioned_business:', attach.error)
      }
      return {
        formError:
          'Der Lead wurde gespeichert, die Firmen-Zuordnung nicht. Bitte den Lead in der Liste öffnen und die Firma dort ergänzen — es wurde keine E-Mail versendet.',
        values: echo,
      }
    }

    const outcome = readAttachOutcome(attach.data)
    if (outcome?.status !== 'ok') {
      console.error('[admin/lead-intake] attach outcome:', outcome?.status ?? 'unlesbar')
      return {
        formError:
          'Der Lead wurde gespeichert, die Firmen-Zuordnung nicht. Bitte den Lead in der Liste öffnen und die Firma dort ergänzen — es wurde keine E-Mail versendet.',
        values: echo,
      }
    }

    /*
     * Der Name kommt aus der ANTWORT, nicht aus der Eingabe: Bei einer bereits erfassten Firma ist
     * das die gespeicherte Schreibweise — und genau die soll die Rückmeldung zeigen, damit sichtbar
     * wird, dass „elektro huber" auf den bestehenden Eintrag „Elektro Huber" gelaufen ist.
     */
    const firma = outcome.name ?? (plan.mention.kind === 'new' ? plan.mention.name : 'Firma')
    mentionNote = outcome.created
      ? ` „${firma}" wurde als Firma neu angelegt und zugeordnet.`
      : ` Firma „${firma}" zugeordnet.`
  }

  revalidatePath(LEADS_HREF)

  const name = `${values.vorname.trim()} ${values.nachname.trim()}`.trim()
  const disclosure = plan.calls.length > 1 ? ' Freigabe an den Fachbetrieb vermerkt.' : ''
  return {
    success: `${name} (${values.email.trim()}) wurde als Telefonanfrage gespeichert.${disclosure}${mentionNote} Es wurde keine E-Mail versendet.`,
  }
}
