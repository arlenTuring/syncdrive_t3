import type { DashboardPlane, CanvasElementProps, ChildWidget } from '../types';
import { migrateChildWidgetGenerics } from './migrateWidgetGenerics';
import {
  needsDashboardRuntimePatch,
  patchDashboardRuntimeFixes,
} from './migrateVehicleMonitorProtocol';
import { upgradeSystemQueries } from './systemQueries';
import { ensureTransitionShiftTemplate, alignShiftCardLayouts } from './shiftCardTemplates';
import { EVENT_CENTER_LIST_SQL } from '../constants/demoSql';
import { STATION_ETA_INVALIDATE_TAGS, STATION_ETA_URL, type StationEtaWidget, type TabListWidget } from '../types';

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

/** 2026-10 曾把站點 ETA 拆成「直排站名文字＋表格」的那三張（以元件 ID 與資料契約確認） */
const LEGACY_ETA_TABLE_IDS = new Set(['eta-n2w', 'eta-s2w', 'eta-t3']);

/**
 * 三站到站動態卡片在即時圖台（地圖元件 vq53epo 的畫布單位）的位置與尺寸：標題、主卡、後續列由上而下，
 * 高度剛好排完正常三筆（比例見 stationEtaModel cardScale）。寬度比設計稿 320:254 略寬，是為了讓
 * 「出發」標記與「SW上發2」這類站名在後續列完整顯示，字級不因此放大。
 * 位置是對這張圖台的道路、站點、號誌量出來的空白區（四周至少留 6），不壓道路與設備；
 * 原本橫長條的表格位置放不下直式卡片，所以 N2W／S2W 移到上下道路之間的空隙。
 */
export const STATION_ETA_LAYOUT: Readonly<Record<string, { x: number; y: number; width: number; height: number }>> = {
  'eta-t3': { x: 401, y: 186, width: 310, height: 226 },
  'eta-s2w': { x: 1920, y: 235, width: 236, height: 159 },
  'eta-n2w': { x: 2280, y: 235, width: 236, height: 159 },
};

/** 表格的 station-eta 網址 → 停靠點設定（站點 ID 與到站／出發，順序照網址） */
function stationsFromUrl(url: string): { base: string; stations: StationEtaWidget['stations']; limit: number } {
  const [base, query = ''] = url.split('?');
  const params = new URLSearchParams(query);
  const list = (key: string) => (params.get(key) ?? '').split(',').map(id => id.trim()).filter(Boolean);
  const arrive = list('arrive');
  const depart = list('depart');
  const stations: StationEtaWidget['stations'] = [];
  for (const id of [...arrive, ...depart]) {
    if (stations.some(station => station.stationId === id)) continue;
    const events: Array<'arrive' | 'depart'> = [];
    if (arrive.includes(id)) events.push('arrive');
    if (depart.includes(id)) events.push('depart');
    stations.push({ stationId: id, label: id, events });
  }
  const limit = Number(params.get('limit'));
  return { base, stations, limit: Number.isFinite(limit) && limit >= 1 ? Math.min(10, Math.floor(limit)) : 3 };
}

/**
 * 站點到站資訊改回專用的到站動態卡片（type: 'station-eta'）。
 *
 * 只轉已確認的三張舊表格（eta-n2w／eta-s2w／eta-t3，且資料來源是 station-eta），連同旁邊的
 * 直排站名文字（{id}-station-label）合成一張卡：站名放進卡片標題。元素 ID、站點集合、
 * 到站／出發、筆數、重查設定保留。卡片是直式（標題、主卡、後續列由上而下），放不進舊表格的橫長條，
 * 位置與尺寸用 STATION_ETA_LAYOUT；不搬動、不縮放其他東西。標題一律「站名 進站動態」，
 * 底層的出發設定照留，列內另外標「出發」。
 * 舊表格的欄位設定（欄寬、欄名）在卡片用不到，不保留。轉過就不再是表格，第二次執行不會再變。
 */
export function migrateStationEtaChildren(children: ChildWidget[]): ChildWidget[] {
  const legacy = new Map<string, TabListWidget>();
  for (const child of children) {
    if (child.type !== 'tab-list' || !LEGACY_ETA_TABLE_IDS.has(child.id)) continue;
    if (child.tabs.some(tab => tab.dataUrl?.startsWith(STATION_ETA_URL))) legacy.set(child.id, child);
  }
  if (legacy.size === 0) return children;
  const labels = new Map<string, ChildWidget>();
  for (const child of children) {
    const owner = child.id.endsWith('-station-label') ? child.id.slice(0, -'-station-label'.length) : '';
    if (child.type === 'text' && legacy.has(owner)) labels.set(owner, child);
  }
  const out: ChildWidget[] = [];
  for (const child of children) {
    if (child.type === 'text' && [...labels.values()].includes(child)) continue;
    const list = legacy.get(child.id);
    if (!list) { out.push(child); continue; }
    const tab = list.tabs.find(t => t.dataUrl?.startsWith(STATION_ETA_URL))!;
    const label = labels.get(list.id);
    const left = Math.min(list.x, label?.x ?? list.x);
    const top = Math.min(list.y, label?.y ?? list.y);
    const right = Math.max(list.x + list.width, label ? label.x + label.width : -Infinity);
    const bottom = Math.max(list.y + list.height, label ? label.y + label.height : -Infinity);
    const { base, stations, limit } = stationsFromUrl(tab.dataUrl ?? STATION_ETA_URL);
    const station = (list.label || tab.label || '').trim() || stations[0]?.stationId || '站點';
    const layout = STATION_ETA_LAYOUT[list.id] ?? { x: left, y: top, width: right - left, height: bottom - top };
    const card: StationEtaWidget = {
      id: list.id, type: 'station-eta', ...layout,
      title: `${station} 進站動態`,
      stations, limit,
      fontSize: 12, color: '#F3F4F6', mutedColor: '#9CA3AF',
      backgroundColor: '#212734', borderColor: '#4E525C', borderRadius: 20,
      dataUrl: base || STATION_ETA_URL,
      refreshMode: tab.refreshMode ?? 'event',
      ...(tab.freshnessPolicy ? { freshnessPolicy: tab.freshnessPolicy } : {}),
      ...(tab.refreshInterval != null ? { refreshInterval: tab.refreshInterval } : {}),
      invalidateTags: tab.invalidateTags ?? [...STATION_ETA_INVALIDATE_TAGS],
    };
    out.push(card);
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
  // 班次群組補上獨立的過渡班次卡（已經有就不動）；三種班次卡統一成「班次在前、車號在底列中間」
  const withTransition = ensureTransitionShiftTemplate(upgraded).plane;
  return switchEventCarouselKey(alignShiftCardLayouts(withTransition).plane);
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
