import type { BatteryCandidate } from 'shared'

/**
 * SYNTHETISCHER Dummy-Katalog (§3.8) — Martins echter Batteriekatalog ist weiterhin offen
 * (Pflichtenheft §8, OP#2). Namen/Preise/Kenndaten sind FREI ERFUNDEN, dienen nur dem Testen von
 * `recommendBattery` gegen eine plausible Mischung an Kandidaten. NICHT als reales Produktangebot
 * verwenden, NICHT in Worker/UI verdrahten.
 *
 * Mischung: 'residential' (klein, `static`) vs. 'commercial' (groß, `dynamic`) — passend zur
 * Konvention in `packages/shared/battery.ts` („residential oft static, commercial dynamic").
 * `dummy-res-m10-lowpower` hat bewusst ein extrem niedriges `maxPowerKw` (1,5 kW) gegenüber dem
 * ~50-kW-Jahres-Peak des Demo-Bäckerei-Lastgangs, um die "Leistung reicht nicht"-Warnung (§3.8) zu
 * testen. `dummy-com-s40`/`dummy-com-l100` haben `requiresFoundation`; `dummy-res-m10-lowpower`/
 * `dummy-com-l100` haben `inverterIncluded: false`.
 */
export const DUMMY_BATTERY_CATALOG: BatteryCandidate[] = [
  {
    id: 'dummy-res-s5',
    name: 'Dummy Residential S5',
    manufacturer: 'Dummy Corp',
    class: 'residential',
    usableCapacityKwh: 5,
    maxPowerKw: 2.5,
    roundTripEfficiency: 0.9,
    pricePerKwh: 750,
    inverterIncluded: true,
    requiresFoundation: false,
    controlType: 'static',
  },
  {
    id: 'dummy-res-m10-lowpower',
    name: 'Dummy Residential M10 LowPower',
    manufacturer: 'Dummy Corp',
    class: 'residential',
    usableCapacityKwh: 10,
    maxPowerKw: 1.5,
    roundTripEfficiency: 0.9,
    pricePerKwh: 650,
    inverterIncluded: false,
    extraInverterCost: 1800,
    requiresFoundation: false,
    controlType: 'static',
  },
  {
    id: 'dummy-res-l15',
    name: 'Dummy Residential L15',
    manufacturer: 'Dummy Corp',
    class: 'residential',
    usableCapacityKwh: 15,
    maxPowerKw: 7.5,
    roundTripEfficiency: 0.88,
    pricePerKwh: 600,
    inverterIncluded: true,
    requiresFoundation: false,
    controlType: 'static',
  },
  {
    id: 'dummy-com-s40',
    name: 'Dummy Commercial S40',
    manufacturer: 'Dummy Corp',
    class: 'commercial',
    usableCapacityKwh: 40,
    maxPowerKw: 20,
    roundTripEfficiency: 0.92,
    pricePerKwh: 380,
    inverterIncluded: true,
    requiresFoundation: true,
    foundationCost: 2200,
    controlType: 'dynamic',
  },
  {
    id: 'dummy-com-m60',
    name: 'Dummy Commercial M60',
    manufacturer: 'Dummy Corp',
    class: 'commercial',
    usableCapacityKwh: 60,
    maxPowerKw: 30,
    roundTripEfficiency: 0.9,
    pricePerKwh: 350,
    inverterIncluded: true,
    requiresFoundation: false,
    controlType: 'dynamic',
  },
  {
    id: 'dummy-com-l100',
    name: 'Dummy Commercial L100',
    manufacturer: 'Dummy Corp',
    class: 'commercial',
    usableCapacityKwh: 100,
    maxPowerKw: 50,
    roundTripEfficiency: 0.93,
    pricePerKwh: 320,
    inverterIncluded: false,
    extraInverterCost: 3500,
    requiresFoundation: true,
    foundationCost: 4000,
    controlType: 'dynamic',
  },
]
