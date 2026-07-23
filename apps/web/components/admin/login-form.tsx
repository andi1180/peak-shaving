'use client'

/**
 * Das Anmeldeformular des Admin-Eingangs (B17).
 *
 * ── ES IST DASSELBE FORMULAR, NICHT EIN ZWEITES ──────────────────────────────────────────────────
 * Es ruft `signInAction` aus `lib/auth/actions.ts` (T4-2) — dieselbe Server Action, die auch
 * `/anmelden` benutzt. Damit gibt es weiterhin genau EINEN Anmeldeweg im Code: eine Sitzung, eine
 * Fehlerbehandlung, eine Stelle, an der `sanitizeNext` das Rücksprungziel prüft. Ein nachgebauter
 * `signInWithPassword`-Aufruf wäre ein zweiter Ort, an dem sich das Anmeldeverhalten ändern lässt —
 * und der eine, den beim nächsten Auth-Fix niemand mitzieht.
 *
 * Auch die Bausteine (`AuthField`, `AuthFormError`, `AuthSubmit`) sind die der Kundenanmeldung: die
 * Feld-, Fehler- und Fokus-Führung ist eine gelöste Aufgabe und soll hier nicht ein zweites Mal
 * gelöst werden.
 *
 * ── WARUM DIE TEXTE TROTZDEM AUS ZWEI QUELLEN KOMMEN ─────────────────────────────────────────────
 * Feldbeschriftungen und Fehlermeldungen kommen aus `messages/de.json` (`Konto.shared` /
 * `Konto.errors`) — sie gehören zur geteilten Anmeldelogik, und `signInAction` gibt ihre SCHLÜSSEL
 * zurück; eine eigene Zuordnung wäre eine zweite Auslegung derselben Fehler. Alles, was NUR diesen
 * Eingang betrifft (Überschrift, Knopfbeschriftung, Hinweise), steht dagegen im Code — so hält es
 * der gesamte Admin-Bereich seit T4-4 (Begründung in `lib/admin/schema.ts`).
 *
 * ── WAS HIER BEWUSST FEHLT ───────────────────────────────────────────────────────────────────────
 * Kein „Noch kein Konto?", kein Partner-Hinweis, kein „Passwort vergessen?". Dieser Eingang bedient
 * genau einen Zweck. Admin-Rollen werden ausschliesslich direkt in Supabase vergeben — es gibt
 * bewusst keinen Weg über die Oberfläche, Admin zu werden. Ebenso fehlt das „Bestätigungsmail
 * erneut senden" der Kundenanmeldung: ein Admin-Konto entsteht nicht über die öffentliche
 * Registrierung, sein Bestätigungszustand ist keine Frage, die dieser Eingang lösen soll.
 */
import * as React from 'react'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { signInAction } from '@/lib/auth/actions'
import { NEXT_PARAM } from '@/lib/auth/config'
import { AUTH_INITIAL_STATE } from '@/lib/auth/schema'
import { AuthField, AuthFormError, AuthSubmit, useFocusFirstError } from '@/components/auth/form-parts'

const FIELD_ORDER = ['email', 'password'] as const

export function AdminLoginForm({ next }: { next: string }) {
  const t = useTranslations('Konto')
  const [state, formAction, isPending] = useActionState(signInAction, AUTH_INITIAL_STATE)
  const prefix = `admin-login-${React.useId()}`
  useFocusFirstError(state.fieldErrors, FIELD_ORDER, prefix)

  const fe = state.fieldErrors
  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {/*
       * Das Rücksprungziel ist der Admin-Bereich (B10-2-Mechanismus, unverändert benutzt). Als
       * verstecktes Feld, weil die Server Action per POST läuft und den Query-String der Seite nicht
       * sieht — und `signInAction` schickt den Wert noch einmal durch `sanitizeNext`, denn dieses
       * Feld ist im Browser frei änderbar. Was daraus folgen könnte, ist eine Weiterleitung auf
       * einen anderen INTERNEN Pfad; einen Zugang verschafft das niemandem, darüber entscheidet
       * allein die Rollenprüfung dahinter.
       */}
      <input type="hidden" name={NEXT_PARAM} value={next} />
      {state.formError && <AuthFormError>{t(`errors.${state.formError}`)}</AuthFormError>}
      <AuthField
        id={`${prefix}-email`}
        name="email"
        type="email"
        autoComplete="email"
        label={t('shared.emailLabel')}
        defaultValue={state.email}
        error={fe?.email ? t(`errors.${fe.email}`) : undefined}
        autoFocus
      />
      <AuthField
        id={`${prefix}-password`}
        name="password"
        type="password"
        autoComplete="current-password"
        label={t('shared.passwordLabel')}
        error={fe?.password ? t(`errors.${fe.password}`) : undefined}
      />
      <AuthSubmit
        isPending={isPending}
        label="Anmelden"
        pendingLabel={t('shared.submitting')}
      />
    </form>
  )
}
