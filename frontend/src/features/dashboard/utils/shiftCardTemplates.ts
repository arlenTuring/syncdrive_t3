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

/**
 * 過渡卡標題：跟正線卡一樣是班次代號（trip_code，例 IN102135），短名稱（待命 D3）與訂單 ID 放在提示。
 * 2026-10-11 前的過渡卡標題是短名稱 {display_code}；使用者要三種卡同一個格式——班次在前面。
 */
export const TRANSITION_TITLE_CONTENT = '{trip_code}';
export const TRANSITION_TITLE_TOOLTIP = '{display_code}｜{shift_key}';
/** 舊版系統綁定：標題短名稱、提示放代號 */
const LEGACY_TRANSITION_TITLE = { content: '{display_code}', tooltip: '{trip_code}｜{shift_key}' };

function textContent(child: ChildWidget): string {
  return child.type === 'text' ? ((child as { content?: string }).content ?? '').trim() : '';
}

function isTripCodeTitle(child: ChildWidget): boolean {
  return textContent(child) === '{trip_code}';
}

function isLegacyTransitionTitle(child: ChildWidget): boolean {
  return textContent(child) === LEGACY_TRANSITION_TITLE.content
    && (child as { tooltip?: string }).tooltip === LEGACY_TRANSITION_TITLE.tooltip;
}

function asTransitionTitle(child: ChildWidget): ChildWidget {
  return { ...child, content: TRANSITION_TITLE_CONTENT, tooltip: TRANSITION_TITLE_TOOLTIP } as ChildWidget;
}

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
      if (isTripCodeTitle(copy)) return asTransitionTitle(copy);
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

/**
 * 既有的過渡卡標題還是舊版系統綁定（短名稱 {display_code}、提示放代號）：改回班次代號。
 * 只改「正好是系統原本那個綁定」的標題，使用者改過的內容不動。可以重複執行。
 */
function withTransitionTitle(el: CanvasElementProps): CanvasElementProps {
  const group = el.genericGroup;
  const templates = group?.templates;
  if (!group || !templates?.length) return el;
  let changed = false;
  const next = templates.map((tpl) => {
    if (tpl.id !== TRANSITION_TEMPLATE_ID || !tpl.children.some(isLegacyTransitionTitle)) return tpl;
    changed = true;
    return { ...tpl, children: tpl.children.map((c) => (isLegacyTransitionTitle(c) ? asTransitionTitle(c) : c)) };
  });
  return changed ? { ...el, genericGroup: { ...group, templates: next } } : el;
}

function withTransitionTemplate(el: CanvasElementProps): CanvasElementProps {
  const group = el.genericGroup;
  const templates = group?.templates;
  if (!group || !templates?.length) return el;
  if (templates.some((tpl) => tpl.id === TRANSITION_TEMPLATE_ID)) return withTransitionTitle(el);
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

/**
 * 三種班次卡同一個格式：標籤後面緊接班次代號，車號在底列正中間（發車、結束之間）。
 * ================================================
 *
 * 系統原本的排法是標籤、車號、代號擠在上排（整備卡還是車號在前、代號在後），看不出哪個是班次。
 * 只動「車號還跟標題在同一排」的系統樣板（正線、過渡、整備），而且只改這幾個元件的位置、寬度
 * 與標題字型；使用者已經把車號搬走、或自己換過標題內容的樣板不動。改完車號就不在上排了，
 * 第二次執行不會再變。
 */
const SHIFT_CARD_TEMPLATE_IDS = new Set(['tpl-mainline', TRANSITION_TEMPLATE_ID, 'tpl-maintenance']);
const KIND_BADGE_FIELDS = new Set(['{direction_label}', '{maint_type_label}']);
const VEHICLE_WIDTH = 64;
const TITLE_STYLE = { fontSize: 16, color: '#F3F4F6', textAlign: 'left' };
const VEHICLE_STYLE = { fontSize: 16, color: '#F3F4F6', textAlign: 'center' };

type Box = ChildWidget & { x: number; y: number; width: number; height: number };

function isBox(child: ChildWidget): child is Box {
  const c = child as Partial<Box>;
  return [c.x, c.y, c.width, c.height].every((v) => typeof v === 'number' && Number.isFinite(v));
}

export function alignShiftCardLayout(tpl: GroupTemplateDef): GroupTemplateDef {
  if (!SHIFT_CARD_TEMPLATE_IDS.has(tpl.id)) return tpl;
  const children = tpl.children;
  const find = (match: (c: ChildWidget) => boolean) => children.find((c) => match(c) && isBox(c)) as Box | undefined;
  const title = find(isTripCodeTitle);
  const vehicle = find((c) => textContent(c) === '{vehicle_code}');
  const kindBadge = find((c) => c.type === 'status-badge' && KIND_BADGE_FIELDS.has((c as StatusBadgeWidget).valueField ?? ''));
  const status = find((c) => c.type === 'status-badge' && (c as StatusBadgeWidget).valueField === '{status_label}');
  const depart = find((c) => textContent(c).startsWith('發車'));
  const end = find((c) => textContent(c).startsWith('結束'));
  if (!title || !vehicle || !kindBadge || !status || !depart) return tpl;
  // 車號已經不在標題那一排（已經改過、或使用者自己排的）：不動
  if (Math.abs(vehicle.y - title.y) > 8) return tpl;

  // 卡寬取卡片底色（左上角那塊色塊）：整備卡的進度條比卡片寬，拿最右邊的元件會算偏
  const background = children.find((c) => c.type === 'color-block' && isBox(c) && c.x === 0 && c.y === 0) as Box | undefined;
  const cardWidth = background?.width
    ?? tpl.templateWidth
    ?? Math.max(...children.filter(isBox).map((c) => c.x + c.width));
  const titleX = kindBadge.x + kindBadge.width + 4;
  const vehicleX = Math.round((cardWidth - VEHICLE_WIDTH) / 2);
  const vehicleRight = vehicleX + VEHICLE_WIDTH;

  const next = children.map((child) => {
    if (child === title) {
      return { ...child, ...TITLE_STYLE, x: titleX, width: Math.max(40, status.x - 4 - titleX) } as ChildWidget;
    }
    if (child === vehicle) {
      return { ...child, ...VEHICLE_STYLE, x: vehicleX, y: depart.y - 2, width: VEHICLE_WIDTH, height: depart.height + 4 } as ChildWidget;
    }
    if (child === depart) {
      return { ...child, width: Math.min(depart.width, vehicleX - 2 - depart.x) } as ChildWidget;
    }
    if (end && child === end && end.x < vehicleRight + 2) {
      // 靠右對齊：右緣至少拉到卡片內緣，窄卡（整備 269）的「結束 HH:MM」才不會被截斷
      const right = Math.max(end.x + end.width, cardWidth - 6);
      return { ...child, x: vehicleRight + 2, width: right - (vehicleRight + 2) } as ChildWidget;
    }
    return child;
  });
  return { ...tpl, children: next };
}

/** 回傳新版面與這次調整了幾個樣板（0＝都已經是新格式，不變） */
export function alignShiftCardLayouts(plane: DashboardPlane): { plane: DashboardPlane; changed: number } {
  let changed = 0;
  const elements = plane.elements.map((el) => {
    const group = el.genericGroup;
    if (!group?.templates?.length) return el;
    let touched = false;
    const templates = group.templates.map((tpl) => {
      const next = alignShiftCardLayout(tpl);
      if (next !== tpl) { touched = true; changed += 1; }
      return next;
    });
    return touched ? { ...el, genericGroup: { ...group, templates } } : el;
  });
  return { plane: changed > 0 ? { ...plane, elements } : plane, changed };
}
