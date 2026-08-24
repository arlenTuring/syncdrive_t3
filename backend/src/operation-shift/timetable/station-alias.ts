import * as fs from 'fs';
import { backendScriptPath } from '../../common/backend-script-path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mapPublishedStore = require(backendScriptPath('map-published-store.js'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mapOperationNodes = require(backendScriptPath('map-operation-nodes.js'));

/** 虛擬渡線端點：不算乘客可見停靠點 */
export function isVirtualCrossoverStationId(stationId: string): boolean {
  const id = stationId.trim();
  return /^xo_\d+_[ab]$/i.test(id) || /^xowp:/i.test(id);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function resolveFacilityDockingAlias(
  facility: Record<string, unknown>,
): string | null {
  const params = asRecord(facility.parameters);
  const dock = asRecord(params?.facilityDockingPoint);
  if (!dock || typeof dock.xM !== 'number' || typeof dock.yM !== 'number') {
    return null;
  }
  const customAlias = typeof dock.alias === 'string' ? dock.alias.trim() : '';
  if (customAlias) return customAlias;
  const base =
    (typeof facility.customName === 'string' && facility.customName.trim()) ||
    (typeof facility.name === 'string' && facility.name.trim()) ||
    String(facility.id ?? '設施');
  return `${base}停靠點`;
}

/**
 * 自地圖文件建立 stationId → 別名（停靠點顯示名）。
 * 正線停靠：customName／stationName；設施停靠：fdock 別名。
 * 座標缺失仍列入（班表／頁籤需要別名，不應因 refField 空值漏站）。
 */
export function buildStationAliasIndexFromMapDocument(
  mapDocument: Record<string, unknown> | null | undefined,
): Map<string, string> {
  const index = new Map<string, string>();
  if (!mapDocument) return index;

  try {
    const registry = mapOperationNodes.collectStationsFromMap(mapDocument) as {
      stations?: Array<{ stationId: string; stationName: string }>;
    };
    for (const station of registry.stations ?? []) {
      if (station.stationId && station.stationName) {
        index.set(station.stationId, station.stationName);
      }
    }
  } catch {
    // ignore
  }

  const areas = Array.isArray(mapDocument.areas) ? mapDocument.areas : [];
  for (const area of areas) {
    const areaObj = asRecord(area);
    const facilities = Array.isArray(areaObj?.facilities)
      ? areaObj.facilities
      : [];
    for (const facility of facilities) {
      const fac = asRecord(facility);
      if (!fac || typeof fac.id !== 'string') continue;

      // 正線 DockingPoint：即使無座標也收別名
      if (fac.type === 'DockingPoint') {
        const params = asRecord(fac.parameters) ?? {};
        const stationId =
          typeof params.stationId === 'string' ? params.stationId.trim() : '';
        if (stationId) {
          const name =
            (typeof fac.customName === 'string' && fac.customName.trim()) ||
            (typeof params.stationName === 'string' &&
              params.stationName.trim()) ||
            stationId;
          if (!index.has(stationId)) {
            index.set(stationId, name);
          } else {
            // 優先已寫的 customName（地圖別名準則）
            const custom =
              typeof fac.customName === 'string' ? fac.customName.trim() : '';
            if (custom) index.set(stationId, custom);
          }
        }
      }

      const alias = resolveFacilityDockingAlias(fac);
      if (alias) {
        index.set(`fdock:${fac.id}`, alias);
      }
    }
  }

  return index;
}

export function resolveMapIdFromShiftBody(
  body: Record<string, unknown>,
): string | null {
  if (
    typeof body.routeGroupsMapId === 'string' &&
    body.routeGroupsMapId.trim()
  ) {
    return body.routeGroupsMapId.trim();
  }
  const output = asRecord(body.scheduleOutput);
  const ref = asRecord(output?.routeGroupsRef);
  if (typeof ref?.mapId === 'string' && ref.mapId.trim()) {
    return ref.mapId.trim();
  }
  return null;
}

export function loadMapDocumentForShift(body: Record<string, unknown>): {
  mapId: string | null;
  mapDocument: Record<string, unknown> | null;
} {
  const candidates: string[] = [];
  const fromBody = resolveMapIdFromShiftBody(body);
  if (fromBody) candidates.push(fromBody);

  try {
    const active = mapPublishedStore.readActiveMapConfig() as {
      libraryId?: string;
      mapId?: string;
    } | null;
    const activeId = (active?.libraryId || active?.mapId || '').trim();
    if (activeId && !candidates.includes(activeId)) {
      candidates.push(activeId);
    }
  } catch {
    // ignore
  }

  for (const mapId of candidates) {
    const entry = mapPublishedStore.readPublishedEntry(mapId) as {
      mapDocument?: Record<string, unknown>;
    } | null;
    if (entry?.mapDocument) {
      return { mapId, mapDocument: entry.mapDocument };
    }
    try {
      const filePath = mapPublishedStore.resolveMapJsonPath(mapId) as
        | string
        | null;
      if (filePath && fs.existsSync(filePath)) {
        const mapDocument = JSON.parse(
          fs.readFileSync(filePath, 'utf8'),
        ) as Record<string, unknown>;
        return { mapId, mapDocument };
      }
    } catch {
      // try next
    }
  }

  return { mapId: fromBody, mapDocument: null };
}

export function resolveStationAlias(
  stationId: string,
  aliasIndex: Map<string, string>,
  fallbackName?: string | null,
): string {
  return aliasIndex.get(stationId)?.trim() || fallbackName?.trim() || stationId;
}
