import type { CanvasElementProps, ChildWidget } from '../types';

/**
 * 一個畫布群組元件身上，所有「承載子元件樹」的欄位——不是只有 `children`。
 * 匯出時收集資料來源、匯入時重建 ID，兩邊都要走過同一份清單，不然新增一種
 * 樣板變體（雙畫板／Tab 畫布／泛用群組多樣板）就容易漏掉一邊，這正是既有
 * `exportTemplate.ts`／`importTemplate.ts` 已經發生過的落差（只顧到
 * `children`／`childrenDefault`／`childrenNormal`，沒顧到 `childrenTabN`、
 * `tabs[].children`）。集中在這一支，兩邊 import 它、不要各自列一次。
 */
const CHILDREN_TAB_KEYS = Array.from({ length: 9 }, (_, i) => `childrenTab${i + 1}`) as Array<
  keyof CanvasElementProps
>;

/** 讀取：回傳這個元件身上所有非空的子元件陣列（供匯出時收集資料來源綁定）。 */
export function collectAllChildArrays(el: CanvasElementProps): ChildWidget[][] {
  const arrays: ChildWidget[][] = [];
  if (el.children?.length) arrays.push(el.children);
  if (el.childrenDefault?.length) arrays.push(el.childrenDefault);
  if (el.childrenNormal?.length) arrays.push(el.childrenNormal);
  for (const key of CHILDREN_TAB_KEYS) {
    const arr = el[key] as ChildWidget[] | undefined;
    if (arr?.length) arrays.push(arr);
  }
  if (el.tabs?.length) {
    for (const tab of el.tabs) if (tab.children?.length) arrays.push(tab.children);
  }
  if (el.genericGroup?.templates?.length) {
    for (const tpl of el.genericGroup.templates) if (tpl.children?.length) arrays.push(tpl.children);
  }
  return arrays;
}

/** 改寫：對每一個子元件陣列套用同一個轉換函式（如重新產生 ID），回傳新的元件物件。 */
export function mapAllChildArrays(
  el: CanvasElementProps,
  fn: (children: ChildWidget[]) => ChildWidget[],
): CanvasElementProps {
  const next: CanvasElementProps = { ...el, children: fn(el.children ?? []) };

  if (el.childrenDefault?.length) next.childrenDefault = fn(el.childrenDefault);
  if (el.childrenNormal?.length) next.childrenNormal = fn(el.childrenNormal);

  for (const key of CHILDREN_TAB_KEYS) {
    const arr = el[key] as ChildWidget[] | undefined;
    if (arr?.length) (next as unknown as Record<string, unknown>)[key as string] = fn(arr);
  }

  if (el.tabs?.length) {
    next.tabs = el.tabs.map((tab) => (tab.children?.length ? { ...tab, children: fn(tab.children) } : tab));
  }

  if (el.genericGroup?.templates?.length) {
    next.genericGroup = {
      ...el.genericGroup,
      templates: el.genericGroup.templates.map((tpl) =>
        tpl.children?.length ? { ...tpl, children: fn(tpl.children) } : tpl,
      ),
    };
  }

  return next;
}
