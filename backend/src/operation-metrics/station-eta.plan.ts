import type { DispatchStation, PlannedDispatch } from '../dispatch/dispatch.plan';
import type { PlannedStop, StationHoldSpan } from './station-eta';

/**
 * 每日計畫 → 進站動態要用的站點事件（純函式）。
 *
 * 使用者 2026-11-20：只要車要到那一站就要有資料，不分卡片種類；給月台乘客看的畫面由月台自己過濾。
 * 所以每一張卡只要起點、終點或途經點是站就算：
 *
 * <table>
 *   <tr><td>載客（上行／下行）</td><td>起站出發、中途站「載客上行／載客下行」；終點站抵達「終點下車」</td></tr>
 *   <tr><td>出場、入廠移動</td><td>起點出發、終點抵達都是「出場」或「入廠」；經過不停的站（停留 0 秒）一筆「通過」。
 *       沒有記途經站的移動卡，用起點、終點補成兩站</td></tr>
 *   <tr><td>月台暫停、待命</td><td>不另外產生到站或出發（車本來就停在站上），記成停留時段，
 *       出發那一筆標「出發前在站上暫停／待命」</td></tr>
 *   <tr><td>場區整備（充電、保養、行檢、待命）</td><td>在場區格位，不是站，不列</td></tr>
 * </table>
 *
 * 一張卡的身分是「營運日｜班次代號」：班次代號只在同一營運日內唯一，前一天延續到凌晨的卡跟今天同代號的卡
 * 要分開。
 */
export type StationPlan = {
  stops: PlannedStop[];
  /** 卡片身分 → 站序（站 id） */
  stopsByTrip: Map<string, string[]>;
  names: Map<string, string>;
  holds: StationHoldSpan[];
  /** 訂單號 → 卡片身分（車端回報的是訂單號） */
  keyByOrderId: Map<string, string>;
};

export function tripKeyOf(operatingDay: string, tripCode: string): string {
  return `${operatingDay}|${tripCode}`;
}

/** 載客卡的方向：卡片名稱是「上行」或「下行」；判不出來就只寫「載客」 */
function rideIntent(item: PlannedDispatch): string {
  const label = `${item.cardLabel ?? ''} ${item.routeName ?? ''}`;
  if (label.includes('上行')) return '載客上行';
  if (label.includes('下行')) return '載客下行';
  return '載客';
}

function moveIntent(item: PlannedDispatch): string {
  if (item.transitionPurpose === 'yard_exit') return '出場';
  if (item.transitionPurpose === 'yard_entry') return '入廠';
  return '移動';
}

/** 沒有記站序的移動卡：起點出發、終點抵達 */
function endpointStations(item: PlannedDispatch): DispatchStation[] {
  if (!item.origin || !item.destination || item.origin.id === item.destination.id) return [];
  return [
    { order: 1, stationId: item.origin.id, stationName: item.origin.name, role: 'origin', arriveAt: null, departAt: item.departAt, dwellSeconds: 0 },
    { order: 2, stationId: item.destination.id, stationName: item.destination.name, role: 'terminal', arriveAt: item.arriveAt, departAt: null, dwellSeconds: 0 },
  ];
}

export function buildStationPlan(sources: Array<{ operatingDay: string; planned: PlannedDispatch[] }>): StationPlan {
  const out: StationPlan = { stops: [], stopsByTrip: new Map(), names: new Map(), holds: [], keyByOrderId: new Map() };
  for (const { operatingDay, planned } of sources) {
    for (const item of planned) {
      if (item.stationHold) {
        if (item.origin) {
          out.holds.push({
            vehicleCode: item.vehicleCode,
            stationId: item.origin.id,
            startAt: item.departAt,
            endAt: item.arriveAt,
            label: item.cardLabel || '暫停',
          });
        }
        continue;
      }
      if (item.kind === 'maintenance') continue;
      const stations = item.stations.length >= 2 ? item.stations : item.kind === 'movement' ? endpointStations(item) : item.stations;
      if (stations.length === 0) continue;
      const key = tripKeyOf(operatingDay, item.tripCode);
      out.keyByOrderId.set(item.orderId, key);
      out.stopsByTrip.set(key, stations.map((s) => s.stationId));
      const passenger = item.kind === 'passenger';
      const word = passenger ? rideIntent(item) : moveIntent(item);
      const last = stations.length - 1;
      stations.forEach((station, index) => {
        out.names.set(station.stationId, station.stationName);
        if (station.arriveAt == null && station.departAt == null) return;
        const pass = !passenger && index > 0 && index < last && !(station.dwellSeconds > 0);
        out.stops.push({
          tripCode: item.tripCode,
          tripKey: key,
          vehicleCode: item.vehicleCode,
          stationId: station.stationId,
          stationName: station.stationName,
          taskLabel: item.cardLabel || item.routeName || item.tripCode,
          arriveIntent: passenger && index === last ? '終點下車' : word,
          departIntent: word,
          ...(pass ? { pass: true } : {}),
          stopIndex: index,
          arriveAt: station.arriveAt ?? null,
          departAt: station.departAt ?? null,
        });
      });
    }
  }
  return out;
}
