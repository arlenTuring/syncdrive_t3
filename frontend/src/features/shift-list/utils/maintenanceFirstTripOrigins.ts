import type { PointTopology } from '../../map-editor/types/pointTopology';
import { isDispatchAfterServiceEdge } from '../../map-editor/utils/pointTopology';
import { snapUpToClockAlignSeconds } from './schedule-engine/physics';

/**
 * 整備／保養結束後可接到的「首班起點站」。
 * 來自目前啟用地圖拓樸：設施 → 停靠（整備後發車）邊。
 * 同一停靠點若有多個設施指向，空駛秒數取最壞（最長）值，規劃才不會低估。
 */
export type MaintenanceFirstTripOrigin = {
  /** 停靠點 stationId（對應路線 stationIds[0]） */
  stationId: string;
  /** 顯示名稱 */
  label: string;
  /** 場內設施 → 此站的規劃空駛秒數（10 秒格向上） */
  deadheadSeconds: number;
  /** 指向此站的設施節點 id */
  facilityNodeIds: string[];
  /** 指向此站的設施顯示名／代號（對齊整備任務 equipment.mapCode） */
  facilityLabels: string[];
};

function resolveEdgeTravelSeconds(edge: {
  avgTravelTimeSeconds: number | null;
  minTravelTimeSeconds: number | null;
}): number | null {
  const avg = edge.avgTravelTimeSeconds;
  const min = edge.minTravelTimeSeconds;
  if (typeof avg === 'number' && Number.isFinite(avg) && avg >= 0) {
    return snapUpToClockAlignSeconds(Math.round(avg));
  }
  if (typeof min === 'number' && Number.isFinite(min) && min >= 0) {
    return snapUpToClockAlignSeconds(Math.round(min));
  }
  return null;
}

/**
 * 從目前地圖的點位拓樸抽出「首班起點站」目錄。
 * 不另載其他地圖；呼叫端應傳入該班表所用／DB 啟用地圖的 pointTopology。
 */
export function buildMaintenanceFirstTripOriginsFromTopology(
  topology: PointTopology | null | undefined,
): MaintenanceFirstTripOrigin[] {
  if (!topology || topology.nodes.length === 0 || topology.edges.length === 0) {
    return [];
  }

  const nodeById = new Map(topology.nodes.map((node) => [node.id, node] as const));
  const byStation = new Map<
    string,
    {
      label: string;
      deadheadSeconds: number;
      facilityNodeIds: Set<string>;
      facilityLabels: Set<string>;
    }
  >();

  for (const edge of topology.edges) {
    const from = nodeById.get(edge.fromNodeId);
    const to = nodeById.get(edge.toNodeId);
    if (!isDispatchAfterServiceEdge(from, to)) continue;

    const stationId = to?.stationId?.trim() || to?.id?.trim();
    if (!stationId || !from || !to) continue;

    const travel = resolveEdgeTravelSeconds(edge);
    // 缺時間仍列為可達起點，空駛以 0 計（畫面可看出無拓樸時間）
    const deadheadSeconds = travel ?? 0;
    const label = to.label?.trim() || stationId;
    const facilityLabel = from.label?.trim() || from.id;
    const existing = byStation.get(stationId);
    if (!existing) {
      byStation.set(stationId, {
        label,
        deadheadSeconds,
        facilityNodeIds: new Set([from.id]),
        facilityLabels: new Set([facilityLabel]),
      });
      continue;
    }
    existing.facilityNodeIds.add(from.id);
    existing.facilityLabels.add(facilityLabel);
    existing.deadheadSeconds = Math.max(existing.deadheadSeconds, deadheadSeconds);
    if (!existing.label && label) existing.label = label;
  }

  return [...byStation.entries()]
    .map(([stationId, value]) => ({
      stationId,
      label: value.label,
      deadheadSeconds: value.deadheadSeconds,
      facilityNodeIds: [...value.facilityNodeIds].sort((a, b) => a.localeCompare(b)),
      facilityLabels: [...value.facilityLabels].sort((a, b) => a.localeCompare(b, 'zh-Hant')),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'));
}

export function findFirstTripOriginForStation(
  origins: MaintenanceFirstTripOrigin[],
  stationId: string | null | undefined,
): MaintenanceFirstTripOrigin | null {
  const key = stationId?.trim();
  if (!key) return null;
  return origins.find((origin) => origin.stationId === key) ?? null;
}

/** 依時間線列輪詢偏好的首班起點站（分散上下行出口） */
export function preferFirstTripOriginForRow(
  origins: MaintenanceFirstTripOrigin[],
  rowIndex: number,
): MaintenanceFirstTripOrigin | null {
  if (origins.length === 0) return null;
  const index = ((rowIndex - 1) % origins.length + origins.length) % origins.length;
  return origins[index] ?? origins[0] ?? null;
}

function normalizeFacilityCode(raw: string): string {
  return raw.trim().toUpperCase();
}

function facilityCodeMatches(mapCode: string, facilityId: string, facilityLabel: string): boolean {
  const code = normalizeFacilityCode(mapCode);
  if (!code || code === 'UNSPECIFIED') return false;
  const id = normalizeFacilityCode(facilityId);
  const label = normalizeFacilityCode(facilityLabel);
  return (
    code === id
    || code === label
    || label === code
    || label.startsWith(code)
    || id.endsWith(code)
  );
}

/** 整備任務 body 內含 equipmentRows 的區段鍵 */
export type MaintenanceBodySectionKey =
  | 'preTrip'
  | 'charging'
  | 'carWash'
  | 'maintenance'
  | 'mobile';

/** 從整備任務 body 抽出指定區段的設施代號（equipment.mapCode） */
export function extractFacilityMapCodes(
  maintenanceBody: Record<string, unknown> | null | undefined,
  sectionKey: MaintenanceBodySectionKey,
): string[] {
  const section =
    maintenanceBody?.[sectionKey] && typeof maintenanceBody[sectionKey] === 'object'
      ? (maintenanceBody[sectionKey] as Record<string, unknown>)
      : null;
  if (!section || section.stepEnabled === false) return [];
  const rows = Array.isArray(section.equipmentRows) ? section.equipmentRows : [];
  const codes: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const mapCode = (row as { mapCode?: unknown }).mapCode;
    if (typeof mapCode !== 'string' || !mapCode.trim()) continue;
    const normalized = normalizeFacilityCode(mapCode);
    if (normalized === 'UNSPECIFIED') continue;
    if (!codes.includes(normalized)) codes.push(normalized);
  }
  return codes;
}

/** @deprecated 請改用 extractFacilityMapCodes(..., 'preTrip') */
export function extractPreTripFacilityMapCodes(
  maintenanceBody: Record<string, unknown> | null | undefined,
): string[] {
  return extractFacilityMapCodes(maintenanceBody, 'preTrip');
}

/**
 * 依設施代號對到拓樸出場站；回傳所有命中站（依命中數高→低）。
 */
export function resolveExitStationIdsForFacilityCodes(
  origins: MaintenanceFirstTripOrigin[],
  codes: string[],
): string[] {
  if (origins.length === 0 || codes.length === 0) return [];

  const hits = new Map<string, number>();
  for (const origin of origins) {
    let count = 0;
    const labelById = new Map(
      origin.facilityNodeIds.map((id, i) => [id, origin.facilityLabels[i] ?? id] as const),
    );
    for (const facId of origin.facilityNodeIds) {
      const facLabel = labelById.get(facId) ?? facId;
      if (codes.some((code) => facilityCodeMatches(code, facId, facLabel))) {
        count += 1;
      }
    }
    for (const facLabel of origin.facilityLabels) {
      if (
        !origin.facilityNodeIds.some((id) => (labelById.get(id) ?? '') === facLabel)
        && codes.some((code) => facilityCodeMatches(code, '', facLabel))
      ) {
        count += 1;
      }
    }
    if (count > 0) hits.set(origin.stationId, count);
  }

  if (hits.size === 0) return [];
  return [...hits.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([stationId]) => stationId);
}

/**
 * 取命中最多的出場站（多站時取第一名）。
 */
export function resolvePreferredExitStationId(
  origins: MaintenanceFirstTripOrigin[],
  codes: string[],
): string | null {
  return resolveExitStationIdsForFacilityCodes(origins, codes)[0] ?? null;
}

/**
 * 行前出場站：依整備任務「行前」設施代號，對到拓樸設施→停靠邊。
 * 行前通常只指向單一停靠（如 T3）；多個時取命中最多者。
 */
export function resolveInspectionExitStationId(
  origins: MaintenanceFirstTripOrigin[],
  maintenanceBody: Record<string, unknown> | null | undefined,
): string | null {
  return resolvePreferredExitStationId(
    origins,
    extractFacilityMapCodes(maintenanceBody, 'preTrip'),
  );
}

/**
 * 保養／洗車可出場站集合：依 maintenance + carWash 設施代號過濾拓樸。
 * 若 body 無代號或對不到任何站，回傳全部拓樸出場站（維持最壞情況語意）。
 */
export function resolveServicingExitStationIds(
  origins: MaintenanceFirstTripOrigin[],
  maintenanceBody: Record<string, unknown> | null | undefined,
): string[] {
  const codes = [
    ...extractFacilityMapCodes(maintenanceBody, 'maintenance'),
    ...extractFacilityMapCodes(maintenanceBody, 'carWash'),
  ];
  const uniqueCodes = [...new Set(codes)];
  if (uniqueCodes.length === 0) {
    return origins.map((origin) => origin.stationId);
  }
  const matched = resolveExitStationIdsForFacilityCodes(origins, uniqueCodes);
  return matched.length > 0
    ? matched
    : origins.map((origin) => origin.stationId);
}

/**
 * 在執行順序中，找「起點站＝exitStationId」的路線索引（0-based）。
 * 找不到回 null。
 */
export function resolveRotationOffsetForExitStation(
  passengerRoutes: Array<{ stationIds: string[] }>,
  exitStationId: string | null | undefined,
): number | null {
  const key = exitStationId?.trim();
  if (!key || passengerRoutes.length === 0) return null;
  const index = passengerRoutes.findIndex(
    (route) => (route.stationIds[0]?.trim() ?? '') === key,
  );
  return index >= 0 ? index : null;
}
