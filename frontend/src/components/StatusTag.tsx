import { Badge, type BadgeColors, type BadgeTone } from './ui';

/** 自訂分類色；狀態意義請改用 tone（同 components/ui 的 BadgeColors） */
export type StatusTagStyle = BadgeColors;

/**
 * 表格狀態欄用的帶圓點標籤＝ Badge size="md" dot。保留這個名稱讓既有畫面不用改；新程式直接用 Badge。
 */
export function StatusTag({ label, tone, style }: { label: string; tone?: BadgeTone; style?: StatusTagStyle }) {
  return (
    <Badge size="md" dot tone={tone} colors={tone ? undefined : style}>
      {label}
    </Badge>
  );
}
