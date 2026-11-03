/**
 * Markierung „internes Gerät": Geräte von COOLiN (Admin-Bereich besucht oder über `/intern` gesetzt)
 * senden keine Analytics-Ereignisse. Merkmal ist ein localStorage-Eintrag, nicht die IP.
 *
 * Jeder Zugriff steht in try/catch: ohne localStorage (privates Fenster, gesperrter Speicher, Server)
 * gilt das Gerät als nicht markiert und die Messung läuft normal.
 */

export const INTERNAL_DEVICE_KEY = 'coolin_intern'

/** Die Schalter-Seite; sie selbst wird nie gemessen. */
export const INTERN_HREF = '/intern'

export type DeviceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function browserStorage(): DeviceStorage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function isInternalDevice(store: DeviceStorage | null = browserStorage()): boolean {
  try {
    return store?.getItem(INTERNAL_DEVICE_KEY) === '1'
  } catch {
    return false
  }
}

/** `false`, wenn der Speicher nicht beschreibbar ist — die Oberfläche sagt das dann. */
export function setInternalDevice(
  internal: boolean,
  store: DeviceStorage | null = browserStorage(),
): boolean {
  try {
    if (!store) return false
    if (internal) store.setItem(INTERNAL_DEVICE_KEY, '1')
    else store.removeItem(INTERNAL_DEVICE_KEY)
    return true
  } catch {
    return false
  }
}
