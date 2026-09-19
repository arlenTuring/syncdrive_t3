import type { RouteProgressWidget } from '../types';

export function resolveStationLabelAppearance(
  widget: RouteProgressWidget,
  active: boolean,
  fallbackFontSize: number,
) {
  return {
    color: active
      ? (widget.stationLabelActiveColor ?? widget.activeColor)
      : (widget.stationLabelInactiveColor ?? widget.inactiveColor),
    fontSize: widget.fontSize ?? fallbackFontSize,
    wrap: widget.stationLabelWrap ?? true,
    maxLines: Math.min(6, Math.max(1, Math.round(widget.stationLabelMaxLines ?? 2))),
  };
}
