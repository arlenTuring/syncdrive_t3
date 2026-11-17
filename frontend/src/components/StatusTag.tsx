import { badgeToneColors, cn, type BadgeTone } from './ui';

/** 自訂配色（分類色，例如任務類型）；狀態意義請改用 tone */
export type StatusTagStyle = {
  container: string;
  dot: string;
};

type StatusTagProps = {
  label: string;
  /** 狀態語意（故障、警告、正常、資訊、離線…）：顏色由設計系統決定 */
  tone?: BadgeTone;
  /** 分類用的自訂配色；有 tone 時忽略 */
  style?: StatusTagStyle;
};

/** 帶圓點的狀態標籤（固定高 26px）。新程式優先用 tone；純狀態標記也可以直接用 components/ui 的 Badge。 */
export function StatusTag({ label, tone, style }: StatusTagProps) {
  const colors = tone ? badgeToneColors(tone) : style ?? badgeToneColors('neutral');
  return (
    <span className={cn('inline-flex h-[26px] w-fit max-w-none flex-none items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1', colors.container)}>
      <span className={cn('size-2 shrink-0 rounded-full', colors.dot)} />
      <span className="shrink-0 text-body-s-bold text-text-primary">{label}</span>
    </span>
  );
}
