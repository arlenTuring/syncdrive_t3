import {
  formatAttributeLegendBadgeText,
  formatAttributeLegendBadgeTitle,
  hexToRgba,
  softHighlightRingStyle,
  type AttributeIntervalLegend,
} from '../types/editor';

export const ATTRIBUTE_LEGEND_BADGE_CHIP_CLASS =
  'inline-flex h-[26px] items-center whitespace-nowrap rounded-lg border px-3 text-body-xs-bold';

export function AttributeLegendBadgeChip({
  item,
  className = ATTRIBUTE_LEGEND_BADGE_CHIP_CLASS,
  highlighted = false,
  compact = false,
}: {
  item: AttributeIntervalLegend;
  className?: string;
  highlighted?: boolean;
  /** 只顯示「名稱 班距」，運量與時段放在滑鼠提示（工具列空間不夠時用） */
  compact?: boolean;
}) {
  const full = formatAttributeLegendBadgeText(item);
  const headway = item.headwaySeconds != null && item.headwaySeconds > 0 ? ` ${item.headwaySeconds}秒` : '';
  return (
    <span
      className={`${className} transition-[box-shadow] duration-150`}
      style={{
        borderColor: hexToRgba(item.color, highlighted ? 0.82 : 0.45),
        backgroundColor: hexToRgba(item.color, highlighted ? 0.32 : 0.2),
        color: item.color,
        ...(highlighted ? softHighlightRingStyle(item.color) : {}),
      }}
      title={compact ? `${full}（${formatAttributeLegendBadgeTitle(item)}）` : formatAttributeLegendBadgeTitle(item)}
    >
      {compact ? `${item.name}${headway}` : full}
    </span>
  );
}
