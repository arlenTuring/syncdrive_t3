import { useEffect, useState } from 'react';
import { getNowMinutes } from './chartAxis';

/** 每 30 秒更新一次，讓運能趨勢圖 X 軸與現在時間同步 */
export function useChartNow(enabled: boolean, intervalMs = 30_000): number {
  const [now, setNow] = useState(() => getNowMinutes());
  useEffect(() => {
    if (!enabled) return;
    setNow(getNowMinutes());
    const id = window.setInterval(() => setNow(getNowMinutes()), intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs]);
  return now;
}
