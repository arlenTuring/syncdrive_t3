import { useEffect, useState } from 'react';
import { useOperatingClock } from '../utils/operatingClock';

export function clockMinutes(ms: number): number {
  const date = new Date(ms);
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

/**
 * 即時時間軸的「現在」：營運時間（正式營運＝實際時間；加速重播時照倍速推進、暫停時停住），
 * 跟後端取樣、上方摘要、班次狀態同一個時鐘。
 */
export function useChartNow(enabled: boolean, intervalMs = 2_000): { nowMs: number; nowMin: number; rate: number } {
  const clock = useOperatingClock();
  const [nowMs, setNowMs] = useState(() => clock.operatingNow());
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNowMs(clock.operatingNow()), intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs, clock]);
  return { nowMs, nowMin: clockMinutes(nowMs), rate: clock.rate };
}
