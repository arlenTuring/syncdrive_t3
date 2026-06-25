import type { ChildWidget, DashboardPlane, CanvasElementProps } from '../types';
import { inferInvalidateTagsFromSql } from './inferInvalidateTagsFromSql';

function patchSqlWidget(w: ChildWidget): ChildWidget {
  const sql = (w as { sqlQuery?: string }).sqlQuery;
  if (!sql?.trim()) return w;
  const binding = w as ChildWidget & {
    refreshInterval?: number;
    refreshMode?: string;
    mqttTopic?: string;
  };
  if (binding.refreshMode === 'event' || binding.refreshMode === 'stream') return w;
  if (binding.refreshMode === 'poll') return w;
  const tags = inferInvalidateTagsFromSql(sql);
  if (tags.length === 0) return w;
  if (binding.refreshInterval && binding.refreshInterval > 0) {
    return { ...w, refreshInterval: 0, refreshMode: 'event' as const } as ChildWidget;
  }
  if (binding.refreshInterval === 0 || binding.refreshInterval === undefined) {
    return { ...w, refreshMode: 'event' as const } as ChildWidget;
  }
  return w;
}

function patchCanvasElement(el: CanvasElementProps): CanvasElementProps {
  const tags = inferInvalidateTagsFromSql(el.sqlQuery);
  const nextEl: CanvasElementProps = {
    ...el,
    children: (el.children ?? []).map(patchSqlWidget),
    ...((el.childrenDefault ?? []).length
      ? { childrenDefault: el.childrenDefault!.map(patchSqlWidget) }
      : {}),
    ...((el.childrenNormal ?? []).length
      ? { childrenNormal: el.childrenNormal!.map(patchSqlWidget) }
      : {}),
  };
  if (el.sqlQuery?.trim() && tags.length > 0 && el.refreshMode !== 'poll') {
    nextEl.refreshInterval = 0;
    nextEl.refreshMode = 'event';
  }
  return nextEl;
}

/** 將 legacy 15s 輪詢改為寫庫後 event 推送重查（泛用模板遷移） */
export function patchEventDrivenSqlRefresh(plane: DashboardPlane): DashboardPlane {
  return {
    ...plane,
    elements: plane.elements.map(patchCanvasElement),
  };
}
