import type { ReactNode } from 'react';
import { cn } from '../cn';
import { badgeToneColors, type BadgeTone } from '../variants';

/** 自訂分類色（例如任務類型、使用中／未使用這類分類）：container＝底色（＋文字色）、dot＝圓點色 */
export type BadgeColors = { container: string; dot: string };

export type BadgeSize = 'sm' | 'md';

const SIZES: Record<BadgeSize, { box: string; text: string }> = {
  /** 行內小標籤 */
  sm: { box: 'gap-1.5 px-2.5 py-0.5', text: 'text-body-xs-bold' },
  /** 表格裡的狀態欄（固定高 26） */
  md: { box: 'h-[26px] gap-1 px-3 py-1', text: 'text-body-s-bold text-text-primary' },
};

/**
 * 狀態標籤（系統唯一一套；StatusTag 也是用它）。
 * tone 的意思固定：error＝故障／錯誤、warning＝警告、success＝正常、info＝資訊、
 * inactive＝離線／未啟用、theme＝選取或主題、neutral＝一般標記。分類用的自訂色給 colors。
 */
export function Badge({
  tone = 'neutral',
  colors,
  size = 'sm',
  dot = false,
  className,
  children,
}: {
  tone?: BadgeTone;
  colors?: BadgeColors;
  size?: BadgeSize;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const palette = colors ?? badgeToneColors(tone);
  const sizing = SIZES[size];
  return (
    <span className={cn('inline-flex w-fit max-w-none flex-none shrink-0 items-center whitespace-nowrap rounded-lg', sizing.box, palette.container, className)}>
      {dot ? <span className={cn('size-2 shrink-0 rounded-full', palette.dot)} /> : null}
      <span className={cn('shrink-0', sizing.text)}>{children}</span>
    </span>
  );
}
