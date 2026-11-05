import type {
  SwitchPlanBlock,
  SwitchPlanSingle,
  SwitchPlanSwitch,
  SwitchPlanVariant,
  SwitchRules,
  TariffSwitchPlan,
} from 'shared'

export const DEFAULT_SWITCH_RULES: SwitchRules = {
  blockMonths: 6,
  minSavingShare: 0.05,
  minSavingEur: 50,
}

const MONTHS_PER_YEAR = 12

export type SwitchPlanTariff = { id: string; monthlyEur: (number | null)[] }

function monthsFrom(startMonth: number, length: number): number[] {
  return Array.from({ length }, (_, i) => (startMonth + i) % MONTHS_PER_YEAR)
}

/**
 * Rein und ohne Bezug zur Analyse: wer zwölf Monatswerte je Tarif hat, ob gemessen oder prognostiziert,
 * bekommt den Plan. Zwei Startmonate im Abstand von sechs Monaten ergeben mit vertauschten Tarifen
 * denselben Plan, deshalb genügen die Starts 0..5 über alle geordneten Paare.
 */
export function computeSwitchPlan(
  tariffs: SwitchPlanTariff[],
  rules: SwitchRules = DEFAULT_SWITCH_RULES,
): TariffSwitchPlan {
  if (tariffs.length < 2) throw new RangeError('computeSwitchPlan braucht mindestens zwei Tarife.')

  const series = new Map<string, number[]>()
  for (const { id, monthlyEur } of tariffs) {
    if (monthlyEur.length !== MONTHS_PER_YEAR || monthlyEur.some((value) => value === null)) {
      return { status: 'insufficient_data', reason: 'missing_months' }
    }
    series.set(id, monthlyEur as number[])
  }
  const costOf = (id: string, months: number[]) =>
    months.reduce((sum, month) => sum + series.get(id)![month]!, 0)

  const allMonths = monthsFrom(0, MONTHS_PER_YEAR)
  const singles: SwitchPlanSingle[] = tariffs.map(({ id }) => ({
    tariffId: id,
    annualEur: costOf(id, allMonths),
  }))

  const switches: SwitchPlanSwitch[] = []
  for (let startMonth = 0; startMonth < rules.blockMonths; startMonth++) {
    const firstMonths = monthsFrom(startMonth, rules.blockMonths)
    const secondMonths = monthsFrom(startMonth + rules.blockMonths, rules.blockMonths)
    for (const { id: first } of tariffs) {
      for (const { id: second } of tariffs) {
        if (first === second) continue
        const blocks: [SwitchPlanBlock, SwitchPlanBlock] = [
          { tariffId: first, months: firstMonths },
          { tariffId: second, months: secondMonths },
        ]
        const annualEur = costOf(first, firstMonths) + costOf(second, secondMonths)
        switches.push({ startMonth, blocks, annualEur })
      }
    }
  }

  // `reduce` mit strikt kleiner: bei Gleichstand bleibt der früher erzeugte Plan stehen.
  const bestSingle = singles.reduce((best, s) => (s.annualEur < best.annualEur ? s : best))
  const bestSwitch = switches.reduce((best, s) => (s.annualEur < best.annualEur ? s : best))

  const savingVsBestSingleEur = bestSingle.annualEur - bestSwitch.annualEur
  const savingShare = bestSingle.annualEur > 0 ? savingVsBestSingleEur / bestSingle.annualEur : null
  // `> 0` zusätzlich: bei auf 0 gesetzten Schwellen gewänne sonst der Wechsel den Gleichstand.
  const switchPays =
    savingVsBestSingleEur > 0 &&
    savingVsBestSingleEur >= rules.minSavingEur &&
    savingShare !== null &&
    savingShare >= rules.minSavingShare

  const variants: SwitchPlanVariant[] = [
    ...singles.map((single) => ({ kind: 'single' as const, ...single })),
    ...switches.map((plan) => ({ kind: 'switch' as const, ...plan })),
  ]

  return {
    status: 'ok',
    singles,
    bestSingle,
    bestSwitch,
    savingVsBestSingleEur,
    savingShare,
    result: switchPays
      ? { kind: 'switch', blocks: bestSwitch.blocks }
      : { kind: 'single', tariffId: bestSingle.tariffId },
    variants,
  }
}
