import type { BatteryCandidate } from './battery'

/**
 * PLATZHALTER-Katalog für den öffentlichen Rechner (`apps/website`).
 * Martins echter Batteriekatalog ist weiterhin offen (Pflichtenheft §8, OP#2) — bis dahin
 * arbeitet die Öffentlichkeitsseite mit diesen synthetischen Kandidaten, konsistent mit dem
 * Prinzip „mit synthetischen Daten arbeiten, solange nicht von Martin geliefert" (CLAUDE.md).
 * Namen/Preise/Kenndaten sind FREI ERFUNDEN — `manufacturer` trägt bewusst die bestehende
 * `[MARTIN: Katalog]`-Konvention aus der UI, um Platzhalter-Status auch im Report sichtbar zu
 * halten. NICHT verwechseln mit `engine`s `recommendation/dummy-catalog.ts`: jener Katalog ist
 * ausschließlich Test-Fixture für die Engine-Testsuite und wird hier bewusst NICHT
 * importiert/wiederverwendet — sonst koppelt eine Testdaten-Änderung an das Produktionsverhalten
 * des öffentlichen Rechners.
 *
 * `demo-com-c250` (Container-Klasse) ist eine ausdrückliche ÜBERGANGSLÖSUNG für
 * Grosskunden-Lastgänge (z. B. Hotellerie): der bis dahin grösste Kandidat (60 kWh / 30 kW) ist
 * dort zu klein, um überhaupt eine sinnvolle Kappung zu zeigen, und die Empfehlung liefe
 * zwangsläufig gegen die Leistungsgrenze. Seine Werte sind wie alle übrigen eine plausible
 * GRÖSSENORDNUNG und keine zitierte Herstellerzahl — er ist zu ersetzen bzw. zu prüfen, sobald
 * Martins Katalog eine echte Grossanlage liefert (Fahrplan_2026.md, „Fachliche Abhängigkeiten").
 */
export const DEMO_BATTERY_CATALOG: BatteryCandidate[] = [
  {
    id: 'demo-com-c25',
    name: 'PeakStore C25', // [MARTIN: Katalog]
    manufacturer: '[MARTIN: Katalog]',
    class: 'commercial',
    usableCapacityKwh: 25,
    maxPowerKw: 15,
    roundTripEfficiency: 0.91,
    pricePerKwh: 270,
    inverterIncluded: true,
    requiresFoundation: false,
    controlType: 'dynamic',
  },
  {
    id: 'demo-com-c40',
    name: 'PeakStore C40', // [MARTIN: Katalog]
    manufacturer: '[MARTIN: Katalog]',
    class: 'commercial',
    usableCapacityKwh: 40,
    maxPowerKw: 20,
    roundTripEfficiency: 0.9,
    pricePerKwh: 250,
    inverterIncluded: true,
    requiresFoundation: true,
    foundationCost: 1500,
    controlType: 'dynamic',
  },
  {
    id: 'demo-com-c60',
    name: 'PeakStore C60', // [MARTIN: Katalog]
    manufacturer: '[MARTIN: Katalog]',
    class: 'commercial',
    usableCapacityKwh: 60,
    maxPowerKw: 30,
    roundTripEfficiency: 0.92,
    pricePerKwh: 235,
    inverterIncluded: false,
    extraInverterCost: 3200,
    requiresFoundation: true,
    foundationCost: 1800,
    controlType: 'dynamic',
  },
  {
    // ÜBERGANGSLÖSUNG Grosskunden (s. Dateikopf) — Container-Klasse, bis Martins Katalog eine
    // echte Grossanlage liefert. `foundationCost` liegt bewusst weit über den 1500–1800 der
    // Schrankgeräte: eine Container-Aufstellung braucht Fundament und eine Ertüchtigung des
    // Netzanschlusses. Wie alle Zahlen dieser Datei eine Grössenordnung, kein Herstellerpreis.
    id: 'demo-com-c250',
    name: 'PeakStore C250', // [MARTIN: Katalog]
    manufacturer: '[MARTIN: Katalog]',
    class: 'commercial',
    usableCapacityKwh: 250,
    maxPowerKw: 125, // 0,5C wie C40/C60
    roundTripEfficiency: 0.93,
    pricePerKwh: 210, // setzt das fallende Muster fort: 270 → 250 → 235 → 210
    inverterIncluded: true,
    requiresFoundation: true,
    foundationCost: 14500,
    controlType: 'dynamic',
  },
  {
    id: 'demo-res-r10',
    name: 'HomeStore R10', // [MARTIN: Katalog]
    manufacturer: '[MARTIN: Katalog]',
    class: 'residential',
    usableCapacityKwh: 10,
    maxPowerKw: 5,
    roundTripEfficiency: 0.88,
    pricePerKwh: 550,
    inverterIncluded: true,
    requiresFoundation: false,
    controlType: 'static',
  },
  {
    id: 'demo-res-r15',
    name: 'HomeStore R15', // [MARTIN: Katalog]
    manufacturer: '[MARTIN: Katalog]',
    class: 'residential',
    usableCapacityKwh: 15,
    maxPowerKw: 7.5,
    roundTripEfficiency: 0.88,
    pricePerKwh: 500,
    inverterIncluded: false,
    extraInverterCost: 2500,
    requiresFoundation: false,
    controlType: 'static',
  },
]
