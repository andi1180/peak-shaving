// Min-Max-Downsampling für die Jahresübersicht des Lastgang-Charts (§6.2, DESIGN.md-Vorbehalt
// zu 35.040 Punkten). Statt jedes 15-min-Rohpunkts nur Min+Max je Zeit-Bucket behalten — das
// erhält Lastspitzen (die für Peak Shaving fachlich relevant sind), auch wenn ein Bucket mehrere
// Stunden abdeckt. Bewusst KEIN Zoom-/Vollauflösungs-UI (nicht Teil dieses Prompts): die
// `caughtPeaks`-Marker kommen ohnehin exakt aus dem `dispatchTrace`, nicht aus dieser Kurve.
export type SamplePoint = { x: number; y: number }

const TARGET_BUCKETS = 1500

export function downsampleMinMax(points: SamplePoint[]): SamplePoint[] {
  if (points.length <= TARGET_BUCKETS * 2) return points

  const bucketSize = Math.ceil(points.length / TARGET_BUCKETS)
  const out: SamplePoint[] = []

  for (let start = 0; start < points.length; start += bucketSize) {
    const end = Math.min(start + bucketSize, points.length)
    let min = points[start]!
    let max = points[start]!
    for (let i = start + 1; i < end; i++) {
      const p = points[i]!
      if (p.y < min.y) min = p
      if (p.y > max.y) max = p
    }
    // Chronologische Reihenfolge innerhalb des Buckets wahren, sonst zackt die Linie zeitlich zurück.
    if (min.x <= max.x) {
      out.push(min)
      if (max.x !== min.x) out.push(max)
    } else {
      out.push(max)
      out.push(min)
    }
  }
  return out
}
