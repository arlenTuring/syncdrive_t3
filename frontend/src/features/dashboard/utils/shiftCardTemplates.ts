import type { CanvasElementProps, ChildWidget, DashboardPlane, GroupTemplateDef, StatusBadgeWidget } from '../types';

/**
 * 班次卡樣板：正線、過渡、整備各一套（泛用群組 genericGroup.templates）。
 *
 * 系統範例原本只有「正線班次卡」與「整備班表卡」，過渡（出廠、入廠、暫停、待命）套正線卡、
 * 標籤底色被 SQL 的 direction_pill_bg 寫成藍色，使用者改不了。這裡補一套獨立的「過渡班次卡」：
 *
 * - 從現有的正線卡複製（保留使用者對正線卡的排版與資料綁定），子元件換新 ID。
 * - 標籤預設「過渡」、紫底白字，顏色存在樣板自己的設定裡；拿掉 variableBgKey，資料不能把它改回藍色。
 * - 條件 business_kind = TRANSITION，排在正線卡前面——泛用群組依序比對、命中第一個，
 *   選樣板仍然只看設定，渲染器不認得任何業務分類。
 *
 * 只在找得到系統正線卡（tpl-mainline）、而且還沒有過渡卡時新增；可以重複執行，不會重複新增，
 * 也不動使用者調過的正線／整備樣板、資料來源與其他規則。
 */

export const TRANSITION_TEMPLATE_ID = 'tpl-transition';
export const TRANSITION_TEMPLATE_NAME = '過渡班次卡';
export const TRANSITION_LABEL_BG = '#6D28D9';
export const TRANSITION_LABEL_COLOR = '#FFFFFF';

function isDirectionBadge(child: ChildWidget): child is StatusBadgeWidget {
  return child.type === 'status-badge' && (child as StatusBadgeWidget).valueField === '{direction_label}';
}

export function buildTransitionTemplate(mainline: GroupTemplateDef): GroupTemplateDef {
  return {
    ...mainline,
    id: TRANSITION_TEMPLATE_ID,
    name: TRANSITION_TEMPLATE_NAME,
    isDefault: false,
    conditions: [{ field: 'business_kind', operator: 'eq', value: 'TRANSITION' }],
    children: mainline.children.map((child) => {
      const copy = { ...child, id: `${child.id}-tr` } as ChildWidget;
      if (!isDirectionBadge(copy)) return copy;
      const badge = { ...copy } as StatusBadgeWidget;
      delete badge.variableBgKey;
      delete badge.variableColorKey;
      return {
        ...badge,
        defaultLabel: '過渡',
        defaultBgColor: TRANSITION_LABEL_BG,
        defaultTextColor: TRANSITION_LABEL_COLOR,
      } as ChildWidget;
    }),
  };
}

function withTransitionTemplate(el: CanvasElementProps): CanvasElementProps {
  const group = el.genericGroup;
  const templates = group?.templates;
  if (!group || !templates?.length) return el;
  if (templates.some((tpl) => tpl.id === TRANSITION_TEMPLATE_ID)) return el;
  const mainlineIndex = templates.findIndex((tpl) => tpl.id === 'tpl-mainline');
  if (mainlineIndex < 0) return el;
  const next = [...templates];
  next.splice(mainlineIndex, 0, buildTransitionTemplate(templates[mainlineIndex]));
  return { ...el, genericGroup: { ...group, templates: next } };
}

/** 回傳新版面與這次新增了幾處（0＝已經有了，不變） */
export function ensureTransitionShiftTemplate(plane: DashboardPlane): { plane: DashboardPlane; added: number } {
  let added = 0;
  const elements = plane.elements.map((el) => {
    const next = withTransitionTemplate(el);
    if (next !== el) added += 1;
    return next;
  });
  return { plane: added > 0 ? { ...plane, elements } : plane, added };
}
