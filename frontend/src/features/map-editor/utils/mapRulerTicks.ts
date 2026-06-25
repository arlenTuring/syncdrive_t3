import { SNAP_METERS } from '../constants/map'

/** 在可視範圍內產生約 targetTicks 個「好讀」刻度間隔（公尺）；橫軸可用較大 targetTicks 讓刻度較密 */
export function pickNiceMeterStep(
  visibleSpanMeters: number,
  targetTicks = 6,
): number {
  if (!Number.isFinite(visibleSpanMeters) || visibleSpanMeters <= 0) {
    return SNAP_METERS
  }
  const raw = visibleSpanMeters / targetTicks
  const pow10 = 10 ** Math.floor(Math.log10(raw))
  const n = raw / pow10
  let nice: number
  if (n <= 1) nice = 1
  else if (n <= 2) nice = 2
  else if (n <= 5) nice = 5
  else nice = 10
  const step = nice * pow10
  return Math.max(SNAP_METERS, step)
}

export function formatMeterRulerLabel(
  meters: number,
  decimals = 2,
): string {
  const a = Math.abs(meters)
  if (a >= 1000) return `${(meters / 1000).toFixed(decimals)}k`
  return String(Math.round(meters))
}
