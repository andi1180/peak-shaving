'use server'

import { TARIFF_PREFERENCES, TARIFF_PREFERENCE_KEY, type TariffPreference } from './tariff-draft'
import type { AdminState } from './schema'
import {
  GENERIC,
  UNKNOWN_PROJECT,
  UUID,
  readProjectId,
  writeMeteringPointDraftFields,
} from './data-entry-actions-shared'

// ── Tarif ────────────────────────────────────────────────────────────────────────────────────────
/**
 * B24, Teil 1 — die Tarif-Station, die fünfte und letzte je Zählpunkt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ EINE ACTION, EIN FELD — DIE SCHMALSTE STATION DES WIZARDS
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Sie erhebt keine Zahl, liest keine Datei und löst KEINEN abrechenbaren Modellaufruf aus. Sie
 * hält einen WUNSCH fest: soll die Analyse den bestehenden Stromtarif als gegeben nehmen, oder
 * soll sie einen besseren vorschlagen? Das ist eine Anweisung an den Schritt, der den Entwurf
 * verbraucht (Teil 2) — kein Eingabewert für die Rechnung selbst.
 *
 * ── ⚠ DIE WAHL IST GESPEICHERT, NICHT EINE WEICHE ─────────────────────────────────────────────
 * Anders als „Haben Sie Lastgangsdaten?" (Lastgang-Station) und „Haben Sie bereits einen
 * Batteriespeicher?" (Batterie-Station) lebt diese Antwort NICHT in `useState`. Jene zwei sind
 * Aussagen über den Bearbeitungsmoment und verzweigen nur, welches Formular erscheint; diese ist
 * eine Aussage über den Kunden und muss den Seitenaufbau überdauern — sonst stünde beim nächsten
 * Öffnen des Wizards nicht mehr da, was er wollte.
 *
 * ── ⚠ ES GIBT KEINEN VERGLEICH UND KEINEN VORSCHLAG, und das ist Absicht ──────────────────────
 * `public.retail_tariffs` (13.09.2026) und `public.spot_prices` stehen bereit und werden hier mit
 * KEINEM Aufruf angefasst. Diese Station hält fest, WAS gewünscht ist; welcher Tarif dann der
 * bessere wäre, ist eine Rechnung über gepflegte Preisdaten und ein eigener Schritt. Beides
 * zugleich zu bauen hiesse, einen Vergleich zu zeigen, bevor feststeht, ob ihn jemand will.
 */

/**
 * „Behalten" oder „optimieren" — GENAU EIN Feld, GENAU EIN Aufruf.
 *
 * ⚠ Der Wert wird gegen `TARIFF_PREFERENCES` geprüft und nicht bloss auf „nicht leer": an den zwei
 * Knöpfen vorbei ist jede Zeichenkette möglich, und eine unbekannte landete sonst als Wunsch im
 * Entwurf, den später niemand deuten kann.
 */
export async function saveMeteringPointTariffPreferenceAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  const answer = String(formData.get('preference') ?? '')
  if (!(TARIFF_PREFERENCES as readonly string[]).includes(answer)) {
    return { formError: GENERIC }
  }
  const preference = answer as TariffPreference

  const failure = await writeMeteringPointDraftFields(
    projectId,
    meteringPointId,
    [{ field: TARIFF_PREFERENCE_KEY, value: preference }],
    'Tarifwahl',
  )
  if (failure) return failure

  return {
    success:
      preference === 'behalten'
        ? 'Vermerkt: der aktuelle Stromtarif wird beibehalten.'
        : 'Vermerkt: die Analyse soll einen optimalen Tarif vorschlagen.',
  }
}
