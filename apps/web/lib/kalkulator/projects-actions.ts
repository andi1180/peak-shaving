'use server'

import 'server-only'

import { getLocale } from 'next-intl/server'

import { redirectToLocalized } from '@/lib/auth/server-helpers'
import { createClient } from '@/lib/supabase/server'
import {
  MAX_PROJECT_LABEL_LENGTH,
  projectChatHref,
  type NewProjectState,
} from './projects'

/**
 * B24 — „Neues Projekt starten" (achter Bauschritt).
 *
 * ── ⚠ ES GIBT KEINE FORMULAR/CHAT-AUSWAHL, UND DAS IST EINE ENTSCHEIDUNG ─────────────────────
 * Delta §8 sieht vor, dass der Kunde beim Projektstart zwischen Formular und Chat wählt (Standard:
 * Chat). Die Auswahl ist hier bewusst NICHT gebaut: Der Formular-Weg (`apps/website`,
 * `step-tariff.tsx` & Geschwister) ist an das Projekt-Modell überhaupt nicht angebunden — er kennt
 * weder `platform.projects` noch `platform.project_messages`, läuft in einer anderen App und in
 * einem anderen Deployment, und sein Ergebnis landet in keiner Projektzeile. Eine Auswahl „Formular
 * oder Chat" böte damit einen Weg an, der genau dieses Projekt nicht befüllt — der Kunde wählte
 * „Formular", landete im Rechner und käme mit einem Ergebnis zurück, das sein Projekt nie gesehen
 * hat. **Jedes hier angelegte Projekt ist ein Chat-Projekt.** Die Anbindung des Formular-Wegs ist
 * ein eigener Schritt; erst danach ergibt die Weiche einen Sinn.
 *
 * ── DER REDIRECT IST TEIL DER HANDLUNG, NICHT EIN NACHSATZ ───────────────────────────────────
 * Wer ein Projekt anlegt, will hineingehen. Ein Erfolgszustand mit „angelegt" und einer Liste
 * darunter machte aus einer Handlung zwei. `redirectToLocalized` wirft (NEXT_REDIRECT), die
 * Funktion erfüllt ihren Rückgabetyp also nur auf den Fehlerpfaden.
 */
export async function createProjectAction(
  _prev: NewProjectState,
  formData: FormData,
): Promise<NewProjectState> {
  const raw = formData.get('label')
  const label = typeof raw === 'string' ? raw.trim() : ''

  /*
   * ⚠ Die Prüfung steht hier UND in der Datenbank, und beide sind nötig: `create_my_project`
   * antwortet auf einen leeren Wert mit `{status: invalid_label}` statt mit einem rohen 23514 aus
   * dem CHECK (die harte Grenze), hier entsteht die Meldung AM FELD, die ein Mensch lesen kann.
   * Dieselbe Aufteilung wie bei den grid_tariff-Wrappern: Grenze im Schema, Satz im Rumpf.
   */
  if (label === '') return { fieldError: 'labelRequired', label: '' }
  if (label.length > MAX_PROJECT_LABEL_LENGTH) return { fieldError: 'labelTooLong', label }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // Die Seite rendert das Formular nur angemeldet; das ist die Rückfalllinie (Sitzung zwischen
  // Seitenaufbau und Absenden abgelaufen). Eine Server Action ist über ihre Kennung ausserdem
  // direkt aufrufbar — dass die Seite davor prüft, schützt sie nicht.
  if (!user) return { formError: 'notSignedIn', label }

  const { data, error } = await supabase.rpc('create_my_project', { p_customer_label: label })
  if (error) {
    console.error('[projekte] create_my_project:', error)
    return { formError: 'generic', label }
  }

  const result = data as { status?: string; project_id?: string } | null
  if (result?.status === 'invalid_label') return { fieldError: 'labelRequired', label }
  if (result?.status !== 'ok' || !result.project_id) {
    console.error('[projekte] create_my_project: unerwarteter Status', result?.status)
    return { formError: 'generic', label }
  }

  redirectToLocalized(projectChatHref(result.project_id), await getLocale())
}
