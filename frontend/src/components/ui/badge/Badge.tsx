import type { ReactNode } from 'react';
import { cn } from '../cn';
import { badgeClass, type BadgeTone } from '../variants';

/**
 * 狀態標籤。tone 的意思固定：error＝故障／錯誤、warning＝警告、success＝正常、
 * info＝資訊、inactive＝離線／未啟用、theme＝選取或主題、neutral＝一般標記。
 */
export function Badge({ tone = 'neutral', dot = false, className, children }: { tone?: BadgeTone; dot?: boolean; className?: string; children: ReactNode }) {
  const style = badgeClass(tone);
  return (
    <span className={cn(style.container, className)}>
      {dot ? <span className={style.dot} /> : null}
      {children}
    </span>
  );
}
