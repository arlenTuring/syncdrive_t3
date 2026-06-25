/** 元件外框：僅在明確設定背景或邊框時才繪製（預設透明） */
export function resolveWidgetChrome(widget: {
  backgroundColor?: string;
  borderWidth?: number;
  borderColor?: string;
  borderRadius?: number;
}): {
  backgroundColor: string;
  borderRadius?: number;
  border: string;
} {
  const bg = widget.backgroundColor?.trim();
  const hasBg = !!bg && bg !== 'transparent';
  const borderW = widget.borderWidth ?? 0;
  return {
    backgroundColor: hasBg ? widget.backgroundColor! : 'transparent',
    borderRadius: widget.borderRadius,
    border: borderW > 0 ? `${borderW}px solid ${widget.borderColor ?? 'transparent'}` : 'none',
  };
}
