import type { CanvasElementProps, ChildWidget, DashboardPlane } from '../types';
import { VEHICLE_DISTRIBUTION_URL } from '../constants/demoSql';

/**
 * 左下角統計「營運中／整備中／待命中」的元件：原名「車輛分佈」，分類改成依任務用途後改稱「營運分佈」。
 *
 * 只改名稱（外層畫布的 label、segment-bar 的 title），綁定的 API、位置、尺寸、配色都不動。
 * 認元件靠綁定（segment-bar 的 dataUrl 是 /facility/vehicle-distribution），不是全專案替換字串——
 * 底部的「車輛狀態／車輛資訊」卡片不受影響。已經改過名、或使用者自訂過別的名稱的不動。
 */
export const OPERATION_DISTRIBUTION_TITLE = '營運分佈';
const LEGACY_TITLE = '車輛分佈';

function isDistributionBar(child: ChildWidget): boolean {
  return child.type === 'segment-bar'
    && ((child as { dataUrl?: string }).dataUrl ?? '').split('?')[0].endsWith(VEHICLE_DISTRIBUTION_URL);
}

export function renameOperationDistribution(element: CanvasElementProps): CanvasElementProps {
  const children = element.children ?? [];
  if (!children.some(isDistributionBar)) return element;
  let changed = false;
  const nextChildren = children.map((child) => {
    if (!isDistributionBar(child) || (child as { title?: string }).title !== LEGACY_TITLE) return child;
    changed = true;
    return { ...child, title: OPERATION_DISTRIBUTION_TITLE } as ChildWidget;
  });
  const relabel = element.label === LEGACY_TITLE;
  if (!changed && !relabel) return element;
  return { ...element, ...(relabel ? { label: OPERATION_DISTRIBUTION_TITLE } : {}), children: nextChildren };
}

export function renameOperationDistributions(plane: DashboardPlane): { plane: DashboardPlane; upgraded: string[] } {
  const upgraded: string[] = [];
  const elements = plane.elements.map((element) => {
    const next = renameOperationDistribution(element);
    if (next !== element) upgraded.push(element.id);
    return next;
  });
  return { plane: upgraded.length ? { ...plane, elements } : plane, upgraded };
}
