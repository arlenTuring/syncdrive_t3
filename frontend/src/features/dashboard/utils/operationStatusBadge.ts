import type { ChildWidget, DashboardPlane, StatusBadgeRule, StatusBadgeWidget } from '../types';

/**
 * 儀表板「營運狀態」標籤
 * ====================
 *
 * 綁後端 GET /syncdrive-api/operation-status：正常營運／降級運轉中／未部署班表／調度暫停中／營運狀態未知，
 * 取最嚴重的一種（規則見 backend operation-status.ts）。降級啟用或解除、調度開關、部署班表時後端發
 * domain:operation_status 失效通知，標籤馬上重查。不分模擬或真實，看的都是系統自己的狀態。
 *
 * 範本原本只放了一個沒接資料的標籤，顯示「尚未設定（營運狀態來源）」（2026-11-17 使用者問「為什麼是尚未設定」）。
 * 已經存下來的儀表板由 bindOperationStatusBadges 在載入時補上綁定：只認「沒有任何綁定、而且文字還是範本原文」的
 * 那一個，使用者自己改過的不動；補過之後有綁定，再跑也不會變。
 */
export const OPERATION_STATUS_URL = '/syncdrive-api/operation-status';
export const OPERATION_STATUS_INVALIDATE_TAGS = ['domain:operation_status'] as const;
export const LEGACY_OPERATION_STATUS_PLACEHOLDER = '尚未設定（營運狀態來源）';

export const OPERATION_STATUS_RULES: StatusBadgeRule[] = [
  { value: 'normal', label: '正常營運', bgColor: '#1B4332', textColor: '#86efac' },
  { value: 'dispatch_paused', label: '調度暫停中', bgColor: '#422006', textColor: '#fcd34d' },
  { value: 'no_schedule', label: '未部署班表', bgColor: '#450a0a', textColor: '#fca5a5' },
  { value: 'degraded', label: '降級運轉中', bgColor: '#431407', textColor: '#fdba74' },
  { value: 'unknown', label: '營運狀態未知', bgColor: '#3f3f46', textColor: '#e4e4e7' },
];

/** 營運狀態標籤的資料綁定與顯示規則（範本與已存儀表板共用） */
export function operationStatusBadgeBinding(): Pick<
  StatusBadgeWidget,
  'dataUrl' | 'valueField' | 'rules' | 'defaultLabel' | 'refreshInterval' | 'refreshMode' | 'invalidateTags' | 'showDot'
> {
  return {
    dataUrl: OPERATION_STATUS_URL,
    valueField: 'status_code',
    rules: OPERATION_STATUS_RULES.map((rule) => ({ ...rule })),
    defaultLabel: '讀取營運狀態…',
    refreshInterval: 0,
    refreshMode: 'event',
    invalidateTags: [...OPERATION_STATUS_INVALIDATE_TAGS],
    showDot: true,
  };
}

function isUnboundPlaceholder(child: ChildWidget): child is StatusBadgeWidget {
  if (child.type !== 'status-badge') return false;
  const badge = child as StatusBadgeWidget;
  const bound = !!(badge.dataUrl?.trim() || badge.sqlQuery?.trim() || badge.mqttTopic?.trim());
  return !bound && badge.defaultLabel === LEGACY_OPERATION_STATUS_PLACEHOLDER;
}

export function bindOperationStatusBadges(plane: DashboardPlane): { plane: DashboardPlane; bound: string[] } {
  const bound: string[] = [];
  const elements = (plane.elements ?? []).map((element) => {
    const children = element.children ?? [];
    if (!children.some(isUnboundPlaceholder)) return element;
    return {
      ...element,
      children: children.map((child) => {
        if (!isUnboundPlaceholder(child)) return child;
        bound.push(child.id);
        return { ...child, ...operationStatusBadgeBinding() } as ChildWidget;
      }),
    };
  });
  return { plane: bound.length ? { ...plane, elements } : plane, bound };
}
