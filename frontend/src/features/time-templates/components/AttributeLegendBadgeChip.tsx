import {
  formatAttributeLegendBadgeText,
  formatAttributeLegendBadgeTitle,
  hexToRgba,
  softHighlightRingStyle,
  type AttributeIntervalLegend,
} from '../types/editor';

export const ATTRIBUTE_LEGEND_BADGE_CHIP_CLASS =
  'inline-flex h-[26px] items-center whitespace-nowrap rounded-lg border px-3 text-xs font-medium';

export function AttributeLegendBadgeChip({
  item,
  className = ATTRIBUTE_LEGEND_BADGE_CHIP_CLASS,
  highlighted = false,
}: {
  item: AttributeIntervalLegend;
  className?: string;
  highlighted?: boolean;
}) {
  return (
    <span
      className={`${className} transition-[box-shadow] duration-150`}
      style={{
        borderColor: hexToRgba(item.color, highlighted ? 0.82 : 0.45),
        backgroundColor: hexToRgba(item.color, highlighted ? 0.32 : 0.2),
        color: item.color,
        ...(highlighted ? softHighlightRingStyle(item.color) : {}),
      }}
      title={formatAttributeLegendBadgeTitle(item)}
    >
      {formatAttributeLegendBadgeText(item)}
    </span>
  );
}
