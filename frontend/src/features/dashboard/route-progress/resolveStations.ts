import type { RouteProgressWidget, RouteStation } from '../types';

export interface RouteStationJsonItem {
  name?: string;
  remain_pct?: number;
  remainPct?: number;
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
      return items.map((item, i) => ({
        id: `json-${i}`,
        name: String(item.name ?? `站${i + 1}`),
        value: anchors[i] ?? 0,
        remainPct: num(item.remain_pct ?? item.remainPct),
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
