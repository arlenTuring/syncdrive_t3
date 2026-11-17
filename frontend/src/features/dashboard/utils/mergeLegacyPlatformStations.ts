import type { ChildWidget, StationEtaWidget } from '../types';

/**
 * 進站動態卡片的舊站點代號：一個月台拆成兩個點（n2w_d_end 到站、n2w_d_start 發車）。
 *
 * 地圖 v0.5（2026-11-12）起一個月台只有一個點（n2w_d），舊代號查不到任何班次，
 * 卡片一直顯示「暫無資料」（2026-11-17 使用者發現 N2W、S2W 兩張空白，T3 本來就是單點所以正常）。
 *
 * 載入時把 xxx_start／xxx_end 合回 xxx：同一個月台的到站、發車合在一筆，順序照第一次出現的位置；
 * 名稱沿用新代號。沒有舊代號的卡片原樣回傳，合過之後再跑也不會變。
 */
const LEGACY_SUFFIX = /^(.+)_(start|end)$/;

export function mergeLegacyPlatformStations(child: ChildWidget): ChildWidget {
  if (child.type !== 'station-eta') return child;
  const widget = child as StationEtaWidget;
  if (!widget.stations.some((station) => LEGACY_SUFFIX.test(station.stationId))) return child;
  type Event = 'arrive' | 'depart';
  // events 省略＝只列到站（舊設定），見 StationEtaWidget
  const eventsOf = (events: Event[] | undefined): Event[] => [...(events ?? ['arrive'])];
  const merged: Array<StationEtaWidget['stations'][number] & { events: Event[] }> = [];
  for (const station of widget.stations) {
    const match = LEGACY_SUFFIX.exec(station.stationId);
    const stationId = match ? match[1]! : station.stationId;
    const existing = merged.find((item) => item.stationId === stationId);
    if (existing) {
      for (const event of eventsOf(station.events)) if (!existing.events.includes(event)) existing.events.push(event);
      continue;
    }
    const legacyLabel = station.label === station.stationId;
    merged.push({ ...station, stationId, label: match && legacyLabel ? stationId : station.label, events: eventsOf(station.events) });
  }
  for (const station of merged) station.events.sort((a, b) => (a === b ? 0 : a === 'arrive' ? -1 : 1));
  return { ...widget, stations: merged } as ChildWidget;
}
