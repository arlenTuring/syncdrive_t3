/**
 * 泛用群組多樣板的子畫布資料存取——平行於 tabCanvas.ts，同一套模式（虛擬 canvasId
 * 進入獨立編輯、回寫時 patch 回正確的那一份 children），只是儲存位置更直接：
 * `genericGroup.templates[i].children`，不像 Tab 清單那樣要映射到
 * `childrenTab1..9` 這種歷史相容欄位。
 */
import type { CanvasElementProps, ChildWidget, GroupTemplateDef } from '../types';

export const TEMPLATE_CANVAS_ID_PREFIX = 'generic-template:';

export function getGroupTemplates(el: CanvasElementProps): GroupTemplateDef[] {
  return el.genericGroup?.templates ?? [];
}

export function findGroupTemplate(el: CanvasElementProps, templateId: string): GroupTemplateDef | null {
  return getGroupTemplates(el).find(t => t.id === templateId) ?? null;
}

/** 取得指定樣板的子元件樹 */
export function getTemplateChildren(el: CanvasElementProps, templateId: string): ChildWidget[] {
  return findGroupTemplate(el, templateId)?.children ?? [];
}

/** 更新指定樣板的子元件樹（回傳新的 CanvasElementProps patch） */
export function buildTemplateChildrenPatch(
  el: CanvasElementProps,
  templateId: string,
  children: ChildWidget[],
): Partial<CanvasElementProps> {
  const templates = getGroupTemplates(el);
  if (!templates.some(t => t.id === templateId)) return {};
  return {
    genericGroup: {
      ...el.genericGroup,
      templates: templates.map(t => (t.id === templateId ? { ...t, children } : t)),
    },
  };
}

export function patchTemplateChild(
  el: CanvasElementProps,
  templateId: string,
  childId: string,
  patch: Partial<ChildWidget>,
): Partial<CanvasElementProps> {
  const children = getTemplateChildren(el, templateId).map(c =>
    c.id === childId ? ({ ...c, ...patch } as ChildWidget) : c,
  );
  return buildTemplateChildrenPatch(el, templateId, children);
}

export function deleteTemplateChild(
  el: CanvasElementProps,
  templateId: string,
  childId: string,
): Partial<CanvasElementProps> {
  const children = getTemplateChildren(el, templateId).filter(c => c.id !== childId);
  return buildTemplateChildrenPatch(el, templateId, children);
}

export function addTemplateChild(
  el: CanvasElementProps,
  templateId: string,
  child: ChildWidget,
): Partial<CanvasElementProps> {
  const children = [...getTemplateChildren(el, templateId), child];
  return buildTemplateChildrenPatch(el, templateId, children);
}

// ─── 虛擬 canvasId 工具（與 tabCanvas.ts 的 makeTabCanvasId 系列同義） ───────────

export function makeTemplateCanvasId(templateId: string): string {
  return `${TEMPLATE_CANVAS_ID_PREFIX}${templateId}`;
}

export function parseTemplateCanvasId(virtualId: string): string | null {
  if (!virtualId.startsWith(TEMPLATE_CANVAS_ID_PREFIX)) return null;
  return virtualId.slice(TEMPLATE_CANVAS_ID_PREFIX.length);
}

export function isTemplateCanvasId(id: string): boolean {
  return id.startsWith(TEMPLATE_CANVAS_ID_PREFIX);
}

// ─── 樣板清單管理（新增／複製，供 PropertiesPanel 的樣板清單 UI 用） ────────────

function newTemplateId(): string {
  return `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createGroupTemplate(name: string): GroupTemplateDef {
  return { id: newTemplateId(), name, children: [] };
}

export function duplicateGroupTemplate(source: GroupTemplateDef, name?: string): GroupTemplateDef {
  return {
    ...source,
    id: newTemplateId(),
    name: name ?? `${source.name} 複本`,
    isDefault: false,
    children: source.children.map(c => ({ ...c, id: `${c.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` })),
  };
}
