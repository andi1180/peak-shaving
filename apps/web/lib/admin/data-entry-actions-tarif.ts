'use server'

import {
  TARIFF_COMPARISON_BASE_FEE_KEY,
  TARIFF_COMPARISON_DRAFT_KEYS,
  TARIFF_COMPARISON_ENERGY_PRICE_KEY,
  TARIFF_COMPARISON_PRICE_BASES,
  TARIFF_COMPARISON_PRICE_BASIS_KEY,
  TARIFF_COMPARISON_PROVIDER_NAME_KEY,
} from './tariff-draft'
import {
  ANALYSIS_ASSUMPTION_DRAFT_KEYS,
  ANALYSIS_HORIZON_YEARS_MAX,
  ANALYSIS_HORIZON_YEARS_MIN,
  DEPRECIATION_YEARS_MAX,
  DEPRECIATION_YEARS_MIN,
  netFromEntered,
  SUBSIDY_PROGRAM_DRAFT_KEYS,
  SUBSIDY_PROGRAM_LABEL_MAX,
  SUBSIDY_PROGRAMS_MAX,
  subsidyProgramDraftKeys,
} from 'shared'
import { isSubsidyMode, parseAmountInput } from './analysis-assumptions-draft'
import type { AdminState } from './schema'
import {
  GENERIC,
  UNKNOWN_PROJECT,
  UUID,
  clearMeteringPointDraftFields,
  readProjectId,
  replaceMeteringPointDraftFields,
  writeMeteringPointDraftFields,
} from './data-entry-actions-shared'

// ── Tarif ────────────────────────────────────────────────────────────────────────────────────────
/**
 * B24, Teil 1 — die Tarif-Station, die fünfte und letzte je Zählpunkt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ZWEI ACTIONS FÜR EINE EINZIGE ANGABE — DIE SCHMALSTE STATION DES WIZARDS
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Sie liest keine Datei und löst KEINEN abrechenbaren Modellaufruf aus. Was sie festhält, ist eine
 * ANGABE des Kunden — ein selbst gefundener Vergleichstarif — und sonst nichts. Speichern und
 * Löschen dieser Angabe sind die zwei Actions dieser Datei.
 *
 * ── ⚠ ES GIBT KEINE TARIF-WAHL MEHR (Fachentscheidung 15.09.2026) ─────────────────────────────
 * Bis hierher stand hier zusätzlich `saveMeteringPointTariffPreferenceAction`: ein WUNSCH
 * („behalten" oder „optimieren"), der als Anweisung an die spätere Analyse gedacht war. Er ist
 * ERSATZLOS entfernt, samt seinem Entwurfsfeld (s. Kopf von `lib/admin/tariff-draft.ts`). Der
 * Vergleich mit aWATTar ist ab jetzt automatisch und keine Entscheidung, die die Dateneingabe
 * abfragen müsste — der Vergleich kostet nichts, und ob der Kunde tatsächlich wechselt, ist seine
 * eigene, spätere Entscheidung.
 *
 * ── ⚠ ES GIBT KEINEN VORSCHLAG, und das ist Absicht ───────────────────────────────────────────
 * `public.retail_tariffs` (13.09.2026) und `public.spot_prices` stehen bereit und werden hier mit
 * KEINEM Aufruf angefasst. Diese Station hält fest, WAS der Kunde gefunden hat; welcher Tarif der
 * bessere wäre, ist eine Rechnung über gepflegte Preisdaten und ein eigener Schritt.
 */

/**
 * Der selbst gefundene Vergleichstarif — vier Felder, EIN Aufruf, alle vier oder keines.
 *
 * ⚠ FREIWILLIG: es gibt keinen Vorgabewert und keine Warnung, wenn das Formular leer bleibt.
 * Einmal begonnen (irgendein Feld ausgefüllt und abgeschickt), müssen aber ALLE vier stimmen: ein
 * halb eingetragener Vergleich (Name ohne Preis, Preis ohne Basis) ist nicht weniger irreführend
 * als ein erfundener.
 *
 * KEINE erfundene Ober-/Untergrenze für die Beträge — dieselbe Begründung wie bei den
 * Lieferanten-Tarifen im Katalog: ein Betrag von 2,41 statt 24,1 ct/kWh ist eine gültige Zahl und
 * ein Tippfehler des Nutzers, das fängt kein Schema.
 *
 * ⚠ `.replace(',', '.')` VOR der Zahlprüfung: die Anzeige dieser Karte formatiert mit Komma
 * (de-AT). Ohne diese Zeile würde ein von einem Vergleichsportal abgetippter Preis wie „14,94" als
 * ungültig abgelehnt — der Nutzer tippt genau das, was er auf der fremden Seite sieht.
 *
 * ⚠ Die zwei Beträge gehen als ZAHL in den Entwurf, nicht als Zeichenkette: `DraftValue` lässt
 * `number` zu (`lib/project-chat/draft.ts`), und ein „14,94" als String müsste jeder spätere Leser
 * erneut auslegen — mit derselben Komma-Frage, die hier gerade beantwortet wurde.
 */
export async function saveMeteringPointTariffComparisonAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  const providerName = String(formData.get('providerName') ?? '').trim()
  const priceBasis = String(formData.get('priceBasis') ?? '')
  const energyPriceRaw = String(formData.get('energyPriceCtPerKwh') ?? '')
  const baseFeeRaw = String(formData.get('baseFeeEurPerMonth') ?? '')

  const fieldErrors: Record<string, string> = {}
  if (providerName === '') {
    fieldErrors.providerName = 'Bitte den Namen des gefundenen Anbieters angeben.'
  }
  if (!(TARIFF_COMPARISON_PRICE_BASES as readonly string[]).includes(priceBasis)) {
    fieldErrors.priceBasis = 'Bitte angeben, ob der gefundene Preis netto oder brutto ist.'
  }
  const energyPrice = Number(energyPriceRaw.replace(',', '.'))
  if (energyPriceRaw.trim() === '' || !Number.isFinite(energyPrice) || energyPrice < 0) {
    fieldErrors.energyPriceCtPerKwh = 'Bitte den Arbeitspreis als Zahl angeben.'
  }
  const baseFee = Number(baseFeeRaw.replace(',', '.'))
  if (baseFeeRaw.trim() === '' || !Number.isFinite(baseFee) || baseFee < 0) {
    fieldErrors.baseFeeEurPerMonth = 'Bitte die Grundgebühr als Zahl angeben.'
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, values: { providerName, priceBasis } }
  }

  const failure = await writeMeteringPointDraftFields(
    projectId,
    meteringPointId,
    [
      { field: TARIFF_COMPARISON_PROVIDER_NAME_KEY, value: providerName },
      { field: TARIFF_COMPARISON_ENERGY_PRICE_KEY, value: energyPrice },
      { field: TARIFF_COMPARISON_BASE_FEE_KEY, value: baseFee },
      { field: TARIFF_COMPARISON_PRICE_BASIS_KEY, value: priceBasis },
    ],
    'Vergleichstarif',
  )
  if (failure) return failure

  return { success: `Vermerkt: Vergleich mit ${providerName}.` }
}

/**
 * Den eingetragenen Vergleichstarif wieder entfernen — ALLE VIER Felder gemeinsam.
 *
 * ⚠ WARUM DIE VIER NICHT EINZELN LÖSCHBAR SIND: `currentComparison` (die Leseseite) gibt `null`
 * zurück, sobald EINES der vier fehlt. Bliebe eines stehen, verschwände die Zusammenfassung
 * trotzdem — und mit ihr der Löschknopf, der das übrige Feld noch hätte entfernen können. Der
 * Zählpunkt trüge danach dauerhaft einen halben Vergleich, den keine Oberfläche mehr anzeigt und
 * kein Weg mehr erreicht. Die Liste steht deshalb als EINE Konstante neben den vier Schlüsseln
 * (`TARIFF_COMPARISON_DRAFT_KEYS`), nicht hier abgeschrieben.
 *
 * Kein neuer Löschhelfer: `clearMeteringPointDraftFields` (PR #223) entfernt benannte Schlüssel
 * samt ihrer `_provenance`-Vermerke und liest den Entwurf dafür frisch — genau der Rahmen, den der
 * Löschweg der Batterie- und der PV-Station schon benutzt.
 */
export async function deleteMeteringPointTariffComparisonAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  const failure = await clearMeteringPointDraftFields(
    projectId,
    meteringPointId,
    TARIFF_COMPARISON_DRAFT_KEYS,
    'Vergleichstarif löschen',
  )
  if (failure) return failure

  return { success: 'Vergleichstarif gelöscht.' }
}

type ParsedSubsidyProgram = {
  label: string
  eurPerKwh: number
  maxKwh: number | null
  maxPercent: number | null
}

/**
 * Die Programmzeilen „€ pro kWh" (`program0…` bis `program2…`). Eine ganz leere Zeile zählt nicht;
 * in einer ausgefüllten ist der Satz Pflicht.
 */
function parseSubsidyPrograms(
  formData: FormData,
  fieldErrors: Record<string, string>,
  values: Record<string, string>,
): ParsedSubsidyProgram[] {
  const programs: ParsedSubsidyProgram[] = []
  for (let i = 0; i < SUBSIDY_PROGRAMS_MAX; i++) {
    const raw = (name: string) => {
      const value = String(formData.get(`program${i}${name}`) ?? '').trim()
      values[`program${i}${name}`] = value
      return value
    }
    const label = raw('Label')
    const rateRaw = raw('EurPerKwh')
    const maxKwhRaw = raw('MaxKwh')
    const maxPercentRaw = raw('MaxPercent')
    if (label === '' && rateRaw === '' && maxKwhRaw === '' && maxPercentRaw === '') continue

    const rate = parseAmountInput(rateRaw)
    const maxKwh = parseAmountInput(maxKwhRaw)
    const maxPercent = parseAmountInput(maxPercentRaw)
    if (label.length > SUBSIDY_PROGRAM_LABEL_MAX) {
      fieldErrors[`program${i}Label`] = `Höchstens ${SUBSIDY_PROGRAM_LABEL_MAX} Zeichen.`
    }
    if (!(Number.isFinite(rate) && rate > 0)) {
      fieldErrors[`program${i}EurPerKwh`] = 'Bitte einen Betrag über 0 € pro kWh angeben.'
    }
    if (maxKwhRaw !== '' && !(Number.isFinite(maxKwh) && maxKwh > 0)) {
      fieldErrors[`program${i}MaxKwh`] = 'Bitte eine Menge über 0 kWh angeben.'
    }
    if (maxPercentRaw !== '' && !(maxPercent > 0 && maxPercent <= 100)) {
      fieldErrors[`program${i}MaxPercent`] = 'Bitte einen Anteil über 0 und höchstens 100 % angeben.'
    }
    programs.push({
      label,
      eurPerKwh: rate,
      maxKwh: maxKwhRaw === '' ? null : maxKwh,
      maxPercent: maxPercentRaw === '' ? null : maxPercent,
    })
  }
  return programs
}

/**
 * Die Annahmen der Wirtschaftlichkeit — Betrachtungshorizont, Förderung und (nur Gewerbe, am
 * Marker `taxFields` erkannt) die Steuerangaben, EIN Aufruf.
 *
 * Leer heisst „keine Angabe": der Schlüssel wird entfernt, und der Lauf rechnet wie ohne
 * (10 Jahre, ohne Förderung). Prozent, Fixbetrag und Programme „€ pro kWh" schliessen einander
 * aus — gespeichert wird genau ein Modus, die anderen werden im selben Schreibvorgang entfernt. Ein
 * Fixbetrag bzw. Programmsatz steht netto im Entwurf, die eingegebene Basis daneben (H3).
 */
export async function saveMeteringPointAnalysisAssumptionsAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  const horizonRaw = String(formData.get('horizonYears') ?? '').trim()
  const subsidyMode = String(formData.get('subsidyMode') ?? '')
  const subsidyRaw = String(formData.get('subsidyValue') ?? '').trim()
  const priceBasis = String(formData.get('subsidyPriceBasis') ?? '')
  const withTax = formData.get('taxFields') === '1'
  const ifbRaw = String(formData.get('investitionsfreibetragPercent') ?? '').trim()
  const taxRateRaw = String(formData.get('taxRatePercent') ?? '').trim()
  const depreciationRaw = String(formData.get('depreciationYears') ?? '').trim()

  const fieldErrors: Record<string, string> = {}
  const horizon = Number(horizonRaw)
  if (
    horizonRaw !== '' &&
    !(
      Number.isInteger(horizon) &&
      horizon >= ANALYSIS_HORIZON_YEARS_MIN &&
      horizon <= ANALYSIS_HORIZON_YEARS_MAX
    )
  ) {
    fieldErrors.horizonYears = `Bitte eine ganze Zahl von ${ANALYSIS_HORIZON_YEARS_MIN} bis ${ANALYSIS_HORIZON_YEARS_MAX} Jahren angeben.`
  }

  const programValues: Record<string, string> = {}
  const programs =
    subsidyMode === 'per_kwh' ? parseSubsidyPrograms(formData, fieldErrors, programValues) : []
  const subsidy = parseAmountInput(subsidyRaw)
  if (subsidyMode !== 'per_kwh' && subsidyRaw !== '') {
    if (!isSubsidyMode(subsidyMode)) {
      fieldErrors.subsidyMode = 'Bitte wählen, ob die Förderung ein Anteil oder ein Fixbetrag ist.'
    } else if (subsidyMode === 'percent' && !(subsidy > 0 && subsidy <= 100)) {
      fieldErrors.subsidyValue = 'Bitte einen Anteil über 0 und höchstens 100 % angeben.'
    } else if (subsidyMode === 'fixed' && !(Number.isFinite(subsidy) && subsidy > 0)) {
      fieldErrors.subsidyValue = 'Bitte einen Betrag über 0 € angeben.'
    }
  }
  const ifb = parseAmountInput(ifbRaw)
  const taxRate = parseAmountInput(taxRateRaw)
  const depreciation = Number(depreciationRaw)
  if (withTax) {
    const percentError = 'Bitte einen Wert über 0 und höchstens 100 % angeben.'
    if (ifbRaw !== '' && !(ifb > 0 && ifb <= 100)) fieldErrors.investitionsfreibetragPercent = percentError
    if (taxRateRaw !== '' && !(taxRate > 0 && taxRate <= 100)) fieldErrors.taxRatePercent = percentError
    if (
      depreciationRaw !== '' &&
      !(
        Number.isInteger(depreciation) &&
        depreciation >= DEPRECIATION_YEARS_MIN &&
        depreciation <= DEPRECIATION_YEARS_MAX
      )
    ) {
      fieldErrors.depreciationYears = `Bitte eine ganze Zahl von ${DEPRECIATION_YEARS_MIN} bis ${DEPRECIATION_YEARS_MAX} Jahren angeben.`
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    return {
      fieldErrors,
      values: {
        horizonYears: horizonRaw,
        subsidyMode,
        subsidyValue: subsidyRaw,
        investitionsfreibetragPercent: ifbRaw,
        taxRatePercent: taxRateRaw,
        depreciationYears: depreciationRaw,
        ...programValues,
      },
    }
  }
  if (
    ((subsidyRaw !== '' && subsidyMode === 'fixed') || programs.length > 0) &&
    priceBasis !== 'net' &&
    priceBasis !== 'gross'
  ) {
    return { formError: GENERIC }
  }

  const keys = ANALYSIS_ASSUMPTION_DRAFT_KEYS
  const set: { field: string; value: number | string }[] = []
  const clear: string[] = []
  if (horizonRaw === '') clear.push(keys.horizonYears)
  else set.push({ field: keys.horizonYears, value: horizon })

  const basis = priceBasis === 'gross' ? 'gross' : 'net'
  if (subsidyMode === 'per_kwh') {
    clear.push(
      keys.subsidyPercent,
      keys.fixedSubsidyEur,
      keys.fixedSubsidyPriceBasis,
      ...SUBSIDY_PROGRAM_DRAFT_KEYS,
    )
    if (programs.length > 0) set.push({ field: keys.subsidyProgramsPriceBasis, value: basis })
    programs.forEach((program, i) => {
      const k = subsidyProgramDraftKeys(i)
      set.push({ field: k.eurPerKwh, value: netFromEntered(program.eurPerKwh, basis) })
      if (program.label !== '') set.push({ field: k.label, value: program.label })
      if (program.maxKwh !== null) set.push({ field: k.maxKwh, value: program.maxKwh })
      if (program.maxPercent !== null) set.push({ field: k.maxPercent, value: program.maxPercent })
    })
  } else if (subsidyRaw === '') {
    clear.push(
      keys.subsidyPercent,
      keys.fixedSubsidyEur,
      keys.fixedSubsidyPriceBasis,
      ...SUBSIDY_PROGRAM_DRAFT_KEYS,
    )
  } else if (subsidyMode === 'percent') {
    set.push({ field: keys.subsidyPercent, value: subsidy })
    clear.push(keys.fixedSubsidyEur, keys.fixedSubsidyPriceBasis, ...SUBSIDY_PROGRAM_DRAFT_KEYS)
  } else {
    set.push(
      { field: keys.fixedSubsidyEur, value: netFromEntered(subsidy, basis) },
      { field: keys.fixedSubsidyPriceBasis, value: basis },
    )
    clear.push(keys.subsidyPercent, ...SUBSIDY_PROGRAM_DRAFT_KEYS)
  }

  if (withTax) {
    for (const [field, raw, value] of [
      [keys.investitionsfreibetragPercent, ifbRaw, ifb],
      [keys.taxRatePercent, taxRateRaw, taxRate],
      [keys.depreciationYears, depreciationRaw, depreciation],
    ] as const) {
      if (raw === '') clear.push(field)
      else set.push({ field, value })
    }
  }

  const failure = await replaceMeteringPointDraftFields(
    projectId,
    meteringPointId,
    set,
    clear,
    'Annahmen Wirtschaftlichkeit',
  )
  if (failure) return failure

  return { success: 'Annahmen für die Wirtschaftlichkeit gespeichert.' }
}
