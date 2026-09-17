// D5 — PV-Anomalie: Monate, in denen eine vorhandene Anlage keinen Mittagseinbruch zeigt.
export { detectPvOutageMonths } from './outage-months'
export {
  PV_DAY_WINDOW_FROM_HOUR,
  PV_DAY_WINDOW_TO_HOUR,
  PV_NEAR_ZERO_KW,
  PV_OUTAGE_MIN_DAYS_PER_MONTH,
} from './outage-months'
export type { PvOutageMonth } from './outage-months'
