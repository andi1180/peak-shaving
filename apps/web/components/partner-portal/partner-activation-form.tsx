'use client'

/**
 * Der eine Knopf, der einen Partnerzugang freischaltet (B18-2a).
 *
 * ── WARUM ÜBERHAUPT EIN KNOPF UND NICHT EIN WIRKENDER LINK ──────────────────────────────────────
 * Weil ein Aktivierungstoken EINMALIG einlösbar ist (gemessen: die zweite Verwendung antwortet
 * HTTP 403 `otp_expired`) und Mailscanner in Unternehmen Links vorab abrufen. Ein wirkender GET
 * verbrauchte den Token, bevor der Mensch ihn sieht — der Fachbetrieb bekäme „Link ungültig" und
 * käme ohne Rückfrage nicht mehr in sein Portal. Dieselbe Bauform und dieselbe Begründung wie bei
 * `/einwilligung-bestaetigen` (B1-2).
 *
 * ── WARUM EINE KLIENT-KOMPONENTE ────────────────────────────────────────────────────────────────
 * Der Erfolgsfall endet in einer Umleitung ins Portal und braucht keinen Zustand; der FEHLERfall
 * schon — ein blankes `<form action={…}>` kann den Rückgabewert nicht anzeigen, und ausgerechnet
 * „dieser Link wirkt nicht mehr" fiele lautlos unter den Tisch. Dieselbe Überlegung wie bei
 * `components/admin/action-button.tsx`.
 *
 * Progressive Enhancement bleibt gewahrt: Es ist ein echtes `<form>`, das auch ohne JavaScript
 * abschickt; `useActionState` ergänzt nur Ladezustand und Fehleranzeige ohne Neuladen.
 */
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { AuthFormError, AuthSubmit } from '@/components/auth/form-parts'
import {
  activatePartnerAccountAction,
  type PartnerActivationState,
} from '@/lib/partner-portal/activation-actions'
import { ACTIVATION_TOKEN_PARAM } from '@/lib/partner-portal/config'

const INITIAL: PartnerActivationState = {}

export function PartnerActivationForm({ token }: { token: string }) {
  const t = useTranslations('PartnerActivation')
  const [state, formAction, isPending] = useActionState(activatePartnerAccountAction, INITIAL)

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {/*
       * Der Token reist als verstecktes Feld mit — die Action bekommt ihn dadurch im POST und
       * nicht aus der URL eines GET, den ein Mailscanner ausgelöst haben könnte.
       */}
      <input type="hidden" name={ACTIVATION_TOKEN_PARAM} value={token} />

      {state.error && <AuthFormError>{t(`errors.${state.error}`)}</AuthFormError>}

      <AuthSubmit isPending={isPending} label={t('submit')} pendingLabel={t('submitPending')} />
    </form>
  )
}
