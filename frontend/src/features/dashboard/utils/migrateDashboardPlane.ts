import type { DashboardPlane, CanvasElementProps, ChildWidget } from '../types';
import { migrateChildWidgetGenerics } from './migrateWidgetGenerics';
import {
  needsDashboardRuntimePatch,
  patchDashboardRuntimeFixes,
} from './migrateVehicleMonitorProtocol';
import { upgradeSystemQueries } from './systemQueries';
import { ensureTransitionShiftTemplate } from './shiftCardTemplates';
import { EVENT_CENTER_LIST_SQL } from '../constants/demoSql';
import { STATION_ETA_INVALIDATE_TAGS, STATION_ETA_URL, type StationEtaWidget, type TabListWidget, type TextWidget } from '../types';

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

function stationUrl(widget: StationEtaWidget): string {
  const values = (event: 'arrive' | 'depart') => widget.stations
    .filter(station => (station.events?.length ? station.events : ['arrive']).includes(event))
    .map(station => encodeURIComponent(station.stationId));
  const arrive = values('arrive');
  const depart = values('depart');
  const query = [arrive.length ? `arrive=${arrive.join(',')}` : '', depart.length ? `depart=${depart.join(',')}` : '', `limit=${widget.limit || 3}`].filter(Boolean).join('&');
  return `${widget.dataUrl || STATION_ETA_URL}?${query}`;
}

/** 專用 ETA 元件只做一次資料形狀遷移；ID 與整體外框不變，左側站名使用可編輯文字元件。 */
export function migrateStationEtaChildren(children: ChildWidget[]): ChildWidget[] {
  const out: ChildWidget[] = [];
  for (const child of children) {
    if (child.type !== 'station-eta') { out.push(child); continue; }
    const labelWidth = Math.min(38, Math.max(28, Math.round(child.width * 0.16)));
    const station = child.title.split(/\s+/)[0] || child.stations[0]?.label || '站點';
    const stacked = /^(N2W|S2W)$/i.test(station) ? station.split('').join('\n') : station;
    const label: TextWidget = {
      id: `${child.id}-station-label`, type: 'text', x: child.x, y: child.y, width: labelWidth, height: child.height,
      content: stacked, fontSize: Math.max(12, child.fontSize), lineHeight: 1.05, fontFamily: 'system-ui', fontWeight: 'bold',
      color: child.color, textAlign: 'center', verticalAlign: 'center', borderRadius: child.borderRadius,
      borderWidth: 1, borderColor: child.borderColor, backgroundColor: child.backgroundColor, colorRulesEnabled: false,
    };
    const columns = [
      ['vehicle_name', '車輛名稱', 48, 'text'],
      ['task_label', '目前任務標籤', 42, 'text'],
      ['at', '剩餘時間', 48, 'countdown'],
      ['event_label', '事件類型', 38, 'text'],
      ['station_name', '事件所屬站點名稱', 54, 'text'],
    ] as const;
    const list: TabListWidget = {
      id: child.id, type: 'tab-list', x: child.x + labelWidth, y: child.y, width: Math.max(10, child.width - labelWidth), height: child.height,
      label: station, showTabBar: false, activeTabId: 'events', rowHeight: 20, fontSize: Math.max(9, child.fontSize - 2),
      textColor: child.color, headerHeight: 22, headerFontSize: 8, headerTextColor: child.mutedColor,
      backgroundColor: child.backgroundColor, borderColor: child.borderColor, borderWidth: 1, borderRadius: child.borderRadius,
      tabs: [{
        id: 'events', label: station, dataUrl: stationUrl(child), dataRowPath: 'events', rowKeyField: 'key',
        refreshMode: child.refreshMode ?? 'event', freshnessPolicy: child.freshnessPolicy,
        refreshInterval: child.refreshInterval, invalidateTags: child.invalidateTags ?? [...STATION_ETA_INVALIDATE_TAGS],
        columns: columns.map(([fieldKey, name, width, format]) => ({ id: `${child.id}-${fieldKey}`, name, fieldKey, width, format, children: [] })),
      }],
    };
    out.push(label, list);
  }
  return out;
}

function migrateCanvasElement(el: CanvasElementProps): CanvasElementProps {
  let next: CanvasElementProps = {
    ...el,
    children: migrateStationEtaChildren((el.children ?? [])
      .filter(c => !REMOVED_WIDGET_TYPES.has(c.type))
      .map(stripWidgetDemoBehavior)),
  };
  if (!next.shiftCenterRange && next.children.some(child =>
    'dataUrl' in child && child.dataUrl?.startsWith('/syncdrive-api/operation-metrics/shift-center'))) {
    next = {
      ...next,
      shiftCenterRange: { dateMode: 'operating', startTime: '00:00', timezone: 'Asia/Taipei' },
    };
  }
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
  const upgraded = upgradeSystemQueries(patched).plane;
  // 班次群組補上獨立的過渡班次卡（已經有就不動）
  return switchEventCarouselKey(ensureTransitionShiftTemplate(upgraded).plane);
}

/**
 * 事件輪播的 slot key 從 event_id 改成 event_key（2026-10-05）。
 *
 * event_id 是車端原值，不同車、不同日可以相同；拿它當 key，兩台車撞號時輪播的列會互相頂替。
 * 只改「SQL 已經是目前系統版本（有 event_key 欄位）」而且 key 還是 event_id 的元件；
 * 使用者自己改過的查詢沒有 event_key，維持原樣。
 */
export function switchEventCarouselKey(plane: DashboardPlane): DashboardPlane {
  let changed = false;
  const elements = (plane.elements ?? []).map((el) => {
    if (el.slotKeyField !== 'event_id' || el.sqlQuery !== EVENT_CENTER_LIST_SQL) return el;
    changed = true;
    return { ...el, slotKeyField: 'event_key' };
  });
  return changed ? { ...plane, elements } : plane;
}
