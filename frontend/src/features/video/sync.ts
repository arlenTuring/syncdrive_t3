import type { Manifest, TimelineItem } from './api';

/** 同步門檻（待實測調整的初值）：<250ms 不干預；250–1000ms 微調播放速度；>1000ms 直接定位 */
export const SYNC_IGNORE_MS = 250;
export const SYNC_SEEK_MS = 1_000;

export function segmentAt(manifest: Manifest | null, t: number | null) {
  if (!manifest || t === null) return null;
  return manifest.segments.find((s) => s.start <= t && t < s.end) ?? null;
}

export function timelineAt(timeline: TimelineItem[] | undefined, t: number | null) {
  if (!timeline || t === null) return null;
  return timeline.find((x) => x.from <= t && t < x.to) ?? null;
}

export function nextAvailable(manifest: Manifest | null, t: number) {
  return manifest?.segments.find((s) => s.start > t)?.start ?? null;
}

/** 依誤差決定動作（純函式，方便測試） */
export function syncAction(expectedSec: number, actualSec: number, speed: number): { kind: 'none' } | { kind: 'rate'; rate: number } | { kind: 'seek'; to: number } {
  const diffMs = (actualSec - expectedSec) * 1000;
  const abs = Math.abs(diffMs);
  if (abs < SYNC_IGNORE_MS) return { kind: 'none' };
  if (abs <= SYNC_SEEK_MS) return { kind: 'rate', rate: speed * (diffMs > 0 ? 0.9 : 1.1) };
  return { kind: 'seek', to: expectedSec };
}

