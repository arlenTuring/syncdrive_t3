/**
 * 整備任務的設施列（equipmentRows）↔ 地圖設施的關聯。
 * ================================================
 *
 * 一列的識別是<strong>地圖設施 ID（equipmentId）</strong>，名稱（mapCode）只是顯示用的快照：
 * 地圖上把站點或格位改名，ID 不變，整備任務照樣指到同一個設施。整份任務另記 mapId，
 * 說明這些 ID 屬於哪一張圖。
 *
 * 讀取時（班表清單載入、調度、整備分佈都經過這裡）依 ID 從那張圖帶出目前的名稱；
 * 圖上已經沒有這個設施的列原樣保留並標 unresolved，不換成別的設施。
 *
 * 舊資料只有名稱、沒有 ID 時，只用明確的關聯補上：
 * 1. 這張圖上目前就叫這個名字、而且只有一個設施叫這個名字；
 * 2. 改過名的停靠站：班表當時記下的「站點 ID＋站名」（selectedRoutes[].stationDwells），
 *    再用這張圖停靠點的站點 ID 對回設施。同一個舊名對到兩個不同設施就不補。
 * 不比對相似名稱、編號或順序。
 */

export const EQUIPMENT_SECTION_KEYS = [
  'preTrip',
  'charging',
  'carWash',
  'maintenance',
  'mobile',
] as const;

export type MapFacilityRef = { id: string; name: string };

export type FacilityIndex = {
  mapId: string;
  byId: Map<string, MapFacilityRef>;
  /** 目前名稱（大寫）→ 設施 ID；同名多個設施的名稱不收 */
  byName: Map<string, string>;
  /** 舊名（大寫）→ 設施 ID；來自班表記錄的站點 ID＋站名，只收唯一對應 */
  byLegacyName: Map<string, string>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function key(name: string): string {
  return name.trim().toUpperCase();
}

/**
 * 設施名稱：跟整備任務下拉清單的來源同一套——
 * 停靠點是站名（map-operation-nodes effectiveStationName），其他設施是自訂名稱、沒有就用 ID
 * （map-field-equipment 的 mapCode）。
 */
function facilityName(facility: Record<string, unknown>): string {
  const params = asRecord(facility.parameters) ?? {};
  const custom = str(facility.customName);
  if (facility.type === 'DockingPoint') {
    return (
      custom ||
      str(params.stationName) ||
      str(params.stationId) ||
      str(facility.id)
    );
  }
  return custom || str(facility.id);
}

export function buildFacilityIndex(
  mapId: string,
  mapDocument: Record<string, unknown> | null,
  legacyStationNames: Array<{ name: string; stationId: string }> = [],
): FacilityIndex {
  const byId = new Map<string, MapFacilityRef>();
  const nameCount = new Map<string, string[]>();
  const facilityByStationId = new Map<string, string>();
  const areas: unknown[] = Array.isArray(mapDocument?.areas)
    ? mapDocument.areas
    : [];
  for (const area of areas) {
    const facilities = asRecord(area)?.facilities;
    for (const raw of Array.isArray(facilities) ? facilities : []) {
      const facility = asRecord(raw);
      const id = facility && typeof facility.id === 'string' ? facility.id : '';
      if (!facility || !id) continue;
      const name = facilityName(facility);
      byId.set(id, { id, name });
      const list = nameCount.get(key(name)) ?? [];
      list.push(id);
      nameCount.set(key(name), list);
      const stationId =
        facility.type === 'DockingPoint'
          ? str(asRecord(facility.parameters)?.stationId)
          : '';
      if (stationId) facilityByStationId.set(stationId, id);
    }
  }
  const byName = new Map<string, string>();
  for (const [name, ids] of nameCount)
    if (ids.length === 1) byName.set(name, ids[0]);

  const legacy = new Map<string, Set<string>>();
  for (const { name, stationId } of legacyStationNames) {
    const facilityId = facilityByStationId.get(stationId.trim());
    if (!facilityId || !name.trim()) continue;
    const set = legacy.get(key(name)) ?? new Set<string>();
    set.add(facilityId);
    legacy.set(key(name), set);
  }
  const byLegacyName = new Map<string, string>();
  for (const [name, ids] of legacy)
    if (ids.size === 1) byLegacyName.set(name, [...ids][0]);

  return { mapId, byId, byName, byLegacyName };
}

export type FacilityResolution = {
  body: Record<string, unknown>;
  /** 對不到這張圖任何設施的列（section／原名稱），呼叫端可以提示 */
  unresolved: Array<{
    section: string;
    mapCode: string;
    equipmentId: string | null;
  }>;
};

/**
 * 依設施 ID 帶出目前名稱；沒有 ID 的舊列用明確關聯補上 ID。回傳新的 body（不改輸入）。
 */
export function resolveTaskFacilities(
  body: Record<string, unknown>,
  index: FacilityIndex,
  /** 讀取時在找不到的列標 unresolved 給畫面提示；存檔時不寫這個標記 */
  options: { annotate?: boolean } = {},
): FacilityResolution {
  const annotate = options.annotate !== false;
  const next: Record<string, unknown> = { ...body, mapId: index.mapId };
  const unresolved: FacilityResolution['unresolved'] = [];
  for (const section of EQUIPMENT_SECTION_KEYS) {
    const value = asRecord(body[section]);
    if (!value || !Array.isArray(value.equipmentRows)) continue;
    next[section] = {
      ...value,
      equipmentRows: (value.equipmentRows as unknown[]).map((raw) => {
        const row = asRecord(raw);
        if (!row) return raw;
        const mapCode = str(row.mapCode);
        const storedId = str(row.equipmentId);
        // 「未指定」與空白列沒有設施可對
        if (!storedId && (!mapCode || key(mapCode) === 'UNSPECIFIED'))
          return row;
        const id =
          storedId ||
          index.byName.get(key(mapCode)) ||
          index.byLegacyName.get(key(mapCode)) ||
          '';
        const facility = id ? index.byId.get(id) : undefined;
        if (!facility) {
          unresolved.push({ section, mapCode, equipmentId: storedId || null });
          const { unresolved: _flag, ...plain } = row;
          void _flag;
          return annotate ? { ...plain, unresolved: true } : plain;
        }
        const { unresolved: _drop, ...rest } = row;
        void _drop;
        return { ...rest, equipmentId: facility.id, mapCode: facility.name };
      }),
    };
  }
  return { body: next, unresolved };
}
