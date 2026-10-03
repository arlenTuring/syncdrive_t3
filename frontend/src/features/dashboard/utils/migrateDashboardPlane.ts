import type { DashboardPlane, CanvasElementProps, ChildWidget } from '../types';
import { migrateChildWidgetGenerics } from './migrateWidgetGenerics';
import {
  needsDashboardRuntimePatch,
  patchDashboardRuntimeFixes,
} from './migrateVehicleMonitorProtocol';
import { upgradeSystemQueries } from './systemQueries';

const REMOVED_WIDGET_TYPES = new Set([
  'schematic-track',
  'event-center-panel',
  'shift-center-panel',
  'shift-progress-block',
  'event-log',
]);

const DEMO_BEHAVIOR_KEYS = [
  'demoAnimate',
  'demoAnimateSequence',
  'demoAnimateIntervalMs',
  'demoSyncShiftPct',
  'demoSpeed',
  'demoLoad',
] as const;

function stripWidgetDemoBehavior(child: ChildWidget): ChildWidget {
  const next = { ...child } as Record<string, unknown>;
  for (const key of DEMO_BEHAVIOR_KEYS) delete next[key];
  return migrateChildWidgetGenerics(next as unknown as ChildWidget);
}

function migrateCanvasElement(el: CanvasElementProps): CanvasElementProps {
  let next: CanvasElementProps = {
    ...el,
    children: (el.children ?? [])
      .filter(c => !REMOVED_WIDGET_TYPES.has(c.type))
      .map(stripWidgetDemoBehavior),
  };
  if (next.canvasKind === 'map-platform') {
    if (next.mapId === 'vtms-main-loop' || next.mapId === 'vtms-current') {
      next = { ...next, mapId: 't3-main-version' };
    }
    if (next.label === '即時圖台') {
      next = {
        ...next,
        mapId: next.mapId || 't3-main-version',
      };
    }
    return next;
  }

  const mapChild = next.children.find(c => c.type === 'map-canvas');
  if (mapChild && mapChild.type === 'map-canvas') {
    const overlays = next.children.filter(c => c.type !== 'map-canvas');
    const legacyMapId = mapChild.mapId === 'vtms-main-loop' || mapChild.mapId === 'vtms-current';
    next = {
      ...next,
      canvasKind: 'map-platform',
      mapId: legacyMapId ? 't3-main-version' : (mapChild.mapId || 't3-main-version'),
      zoomFactor: mapChild.zoomFactor ?? 1.35,
      backgroundColor: '#020617',
      children: overlays,
    };
  }
  return next;
}

/**
 * 載入版面時的處理。
 *
 * <h3>這裡曾經有一整條「範本遷移鏈」，已經移除</h3>
 * 原本會依 <code>demoLayoutVersion</code> 逐級套用十七個 migrateXxx，每一個都
 * <code>cloneDemoPlane()</code> 拿寫死的範本改寫使用者的面板；判定「壞掉」時還會整張
 * 換成範本。
 *
 * 問題是那個版本號<strong>後端根本不存</strong>（平面資料表只有 id／name／elements…），
 * 所以每次從資料庫讀回來都是 0，十七個遷移<strong>每次都重跑</strong>，把使用者調好的
 * 版面改寫回範本，再存回資料庫，下次又是 0——無限循環。使用者看到的就是
 * 「明明存好了，重整又變回去」，而且完全沒有提示。
 *
 * 這類程式的問題是它<strong>比使用者更相信自己</strong>：把合法資料判定成髒資料，
 * 用寫死的範本覆蓋。使用者存了什麼，就該讀回什麼；真的要升級舊格式，那是一次性的
 * 資料轉換，不是每次載入都跑的東西。
 *
 * <code>migrateCanvasElement</code> 處理舊元件欄位；系統內建監控元件若使用舊版資料
 * 協議，另只替換其 SQL／MQTT 綁定。兩者都不改使用者排過的座標、尺寸與版面。
 */
export function migratePlane(plane: DashboardPlane): DashboardPlane {
  const compatible = {
    ...plane,
    elements: (plane.elements ?? []).map(migrateCanvasElement),
  };
  const patched = needsDashboardRuntimePatch(compatible)
    ? patchDashboardRuntimeFixes(compatible)
    : compatible;
  // 每次都跑：只換「確定是系統舊版原文」的 SQL（含泛用群組內部來源），其他不動；第二次跑不會再變
  return upgradeSystemQueries(patched).plane;
}
