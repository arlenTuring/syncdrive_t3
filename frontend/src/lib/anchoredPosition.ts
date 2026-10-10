const VIEWPORT_GAP = 8;

export interface AnchoredPosition {
  top: number;
  left: number;
  placement: 'bottom' | 'top';
}

/** 純計算（給測試用）：下方放得下就往下，否則往上；水平依對齊方式並夾在視窗內 */
export function computeAnchoredPosition(
  anchor: { top: number; bottom: number; left: number; right: number },
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
  align: 'start' | 'end',
  offset = 4,
): AnchoredPosition {
  const spaceBelow = viewport.height - anchor.bottom - offset - VIEWPORT_GAP;
  const spaceAbove = anchor.top - offset - VIEWPORT_GAP;
  const placement = spaceBelow >= panel.height || spaceBelow >= spaceAbove ? 'bottom' : 'top';
  const rawTop = placement === 'bottom' ? anchor.bottom + offset : anchor.top - offset - panel.height;
  const top = Math.min(Math.max(VIEWPORT_GAP, rawTop), Math.max(VIEWPORT_GAP, viewport.height - panel.height - VIEWPORT_GAP));
  const rawLeft = align === 'end' ? anchor.right - panel.width : anchor.left;
  const left = Math.min(Math.max(VIEWPORT_GAP, rawLeft), Math.max(VIEWPORT_GAP, viewport.width - panel.width - VIEWPORT_GAP));
  return { top, left, placement };
}
