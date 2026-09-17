import type { RouteProgressWidget, RouteStation } from '../types';

export interface RouteStationJsonItem {
  name?: string;
  station_id?: string;
  stationId?: string;
  remain_pct?: number;
  remainPct?: number;
  /** origin / intermediate / terminal，來自班表站序 */
  role?: string;
  /** 停留秒數；轉線點這類只是經過的站是 0 */
  dwell_seconds?: number;
  dwellSeconds?: number;
}

/**
 * 這一站車會不會停。
 *
 * 起點與終點一定停；中間站看停留秒數，0 秒的是轉線點那種經過而已的點。
 * 兩個欄位都沒帶的資料（像整備班表自己組的兩站）一律當成停靠站，不隱藏。
 */
function isStoppingStation(item: RouteStationJsonItem): boolean {
  const role = String(item.role ?? '').trim().toLowerCase();
  if (!role) return true;
  if (role === 'origin' || role === 'terminal' || role === 'destination') return true;
  const dwell = num(item.dwell_seconds ?? item.dwellSeconds);
  return dwell === undefined || dwell > 0;
}

function num(n: unknown): number | undefined {
  if (n === null || n === undefined || n === '') return undefined;
  const v = Number(n);
  return Number.isNaN(v) ? undefined : v;
}

function parseJsonStations(raw: unknown): RouteStationJsonItem[] | null {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) return raw as RouteStationJsonItem[];
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return null;
    try {
      const parsed = JSON.parse(t) as unknown;
      return Array.isArray(parsed) ? (parsed as RouteStationJsonItem[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** 依站數將錨點等距分布在 0–100 */
export function evenStationAnchors(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  return Array.from({ length: count }, (_, i) => (i / (count - 1)) * 100);
}

export function resolveRouteStations(
  widget: RouteProgressWidget,
  variables: Record<string, unknown>,
  sqlRow: Record<string, unknown> | null,
): RouteStation[] {
  const source = widget.stationSource ?? (widget.dynamicStationFields ? 'legacy-columns' : 'manual');

  if (source === 'json') {
    const key = widget.stationsJsonVarKey ?? 'route_stations';
    const raw = variables[key] ?? sqlRow?.[key];
    const items = parseJsonStations(raw);
    if (items && items.length > 0) {
      const anchors = evenStationAnchors(items.length);
      // 只藏不刪：錨點仍照完整站序等距分布，車子的位置才不會因為少畫幾站就跳掉。
      const stopsOnly = (widget.stationDisplayFilter ?? 'stops') === 'stops';
      return items.map((item, i) => ({
        id: `json-${i}`,
        name: String(item.name ?? `站${i + 1}`),
        stationId: String(item.station_id ?? item.stationId ?? '').trim() || undefined,
        value: anchors[i] ?? 0,
        remainPct: num(item.remain_pct ?? item.remainPct),
        hidden: stopsOnly && !isStoppingStation(item),
      }));
    }
    const legacyNames = ['st_a', 'st_b', 'st_c']
      .map((k) => variables[k] ?? sqlRow?.[k])
      .filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
      .map((v) => String(v));
    if (legacyNames.length >= 2) {
      const anchors = evenStationAnchors(legacyNames.length);
      return legacyNames.map((name, i) => ({
        id: `legacy-json-${i}`,
        name,
        value: anchors[i] ?? 0,
      }));
    }
  }

  if (source === 'legacy-columns' && widget.dynamicStationFields?.length) {
    const fields = widget.dynamicStationFields;
    const names = fields.map((f) =>
      String(variables[f] ?? sqlRow?.[f] ?? `—`),
    );
    const anchors = evenStationAnchors(names.length);
    const fallback = [...widget.stations].sort((a, b) => a.value - b.value);
    return names.map((name, i) => ({
      id: `legacy-${i}`,
      name,
      value: anchors[i] ?? fallback[i]?.value ?? i * 50,
      remainPct: undefined,
    }));
  }

  return [...widget.stations].sort((a, b) => a.value - b.value);
}
