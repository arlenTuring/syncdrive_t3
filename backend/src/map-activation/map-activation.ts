/**
 * 設為主要地圖（使用中地圖）之前的檢查
 * ================================
 *
 * 主要地圖不是「這張圖正在被編輯」，而是整個系統在讀的那一張：
 *
 * <table>
 *   <tr><td>車輛定位</td><td>MQTT 遙測的座標落在哪一塊軌道、哪一個格位</td></tr>
 *   <tr><td>訂單</td><td>班次的站點、下一站、到站判定</td></tr>
 *   <tr><td>儀表板</td><td>圖台、整備分佈、車輛分佈</td></tr>
 *   <tr><td>模擬器</td><td>讀 /syncdrive-api/map/library/active 跑車</td></tr>
 * </table>
 *
 * 部署中的班表是照某一張地圖的路線與站點排出來的（selectedRoutes 存路線 id 與站序）。
 * 換成一張沒有這些路線、站點的地圖，訂單就找不到站、車輛對不到路線——營運直接斷掉。
 * 所以切換前要先比對，<strong>接不上就不給換</strong>（先換部署班表，或在這張圖補上路線）；
 * 接得上但站序不同只提醒（行車時間與停站會跟班表對不上）。
 */

export type ActivationIssueCode =
  | 'ROUTE_MISSING'
  | 'STATION_MISSING'
  | 'ROUTE_STATIONS_CHANGED'
  | 'NO_ROUTES'
  | 'NO_STATIONS';

export type ActivationIssue = {
  code: ActivationIssueCode;
  message: string;
};

export type ActivationCheckResult = {
  mapId: string;
  displayName: string | null;
  /** 這張已經是主要地圖 */
  alreadyActive: boolean;
  currentActive: { mapId: string; displayName: string | null };
  routeCount: number;
  stationCount: number;
  deployedShift: { shiftId: string; shiftName: string } | null;
  /** 擋下切換的問題 */
  blockers: ActivationIssue[];
  /** 可以切換，但要讓使用者知道 */
  warnings: ActivationIssue[];
  canActivate: boolean;
};

export type CandidateMap = {
  mapId: string;
  displayName: string | null;
  routes: Array<{
    routeId: string;
    displayName?: string;
    stationIds: string[];
  }>;
  /** 這張圖上的點位：停靠站＋路線經過的途經點、折返點 */
  stationIds: ReadonlySet<string>;
};

export type DeployedShiftInput = {
  shiftId: string;
  shiftName: string;
  body: Record<string, unknown>;
} | null;

type ShiftRoute = {
  routeId: string;
  routeName: string | null;
  stationIds: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function shiftRoutes(body: Record<string, unknown>): ShiftRoute[] {
  const raw = Array.isArray(body.selectedRoutes) ? body.selectedRoutes : [];
  const out: ShiftRoute[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row || typeof row.routeId !== 'string' || !row.routeId.trim())
      continue;
    const name =
      (typeof row.routeName === 'string' && row.routeName.trim()) ||
      (typeof row.routeCode === 'string' && row.routeCode.trim()) ||
      null;
    out.push({
      routeId: row.routeId.trim(),
      routeName: name,
      stationIds: Array.isArray(row.stationIds)
        ? row.stationIds.filter(
            (id): id is string => typeof id === 'string' && id.trim() !== '',
          )
        : [],
    });
  }
  return out;
}

/** 地圖文件裡的路線（mapDocument.routes） */
export function mapDocumentRoutes(
  mapDocument: Record<string, unknown> | null | undefined,
): CandidateMap['routes'] {
  const raw = Array.isArray(mapDocument?.routes) ? mapDocument.routes : [];
  const out: CandidateMap['routes'] = [];
  for (const item of raw) {
    const row = asRecord(item);
    const routeId = typeof row?.routeId === 'string' ? row.routeId.trim() : '';
    if (!row || !routeId) continue;
    out.push({
      routeId,
      displayName:
        typeof row.displayName === 'string' ? row.displayName : undefined,
      stationIds: Array.isArray(row.stationIds)
        ? row.stationIds.filter((id): id is string => typeof id === 'string')
        : [],
    });
  }
  return out;
}

function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export function checkMapActivation(args: {
  candidate: CandidateMap;
  currentActive: { mapId: string; displayName: string | null };
  deployedShift: DeployedShiftInput;
}): ActivationCheckResult {
  const { candidate, currentActive, deployedShift } = args;
  const blockers: ActivationIssue[] = [];
  const warnings: ActivationIssue[] = [];

  if (candidate.stationIds.size === 0) {
    blockers.push({
      code: 'NO_STATIONS',
      message: '這張地圖沒有任何站點或路線點位，訂單無法判定到站。',
    });
  }
  if (candidate.routes.length === 0) {
    warnings.push({
      code: 'NO_ROUTES',
      message: '這張地圖沒有任何路線，之後無法用它排班。',
    });
  }

  if (deployedShift) {
    const routesById = new Map(
      candidate.routes.map((route) => [route.routeId, route]),
    );
    const missingStations = new Set<string>();
    const missingRoutes: string[] = [];
    for (const route of shiftRoutes(deployedShift.body)) {
      const label = route.routeName
        ? `${route.routeName}（${route.routeId}）`
        : route.routeId;
      const onMap = routesById.get(route.routeId);
      if (!onMap) {
        missingRoutes.push(label);
      } else if (
        route.stationIds.length > 0 &&
        !sameSequence(route.stationIds, onMap.stationIds)
      ) {
        warnings.push({
          code: 'ROUTE_STATIONS_CHANGED',
          message: `路線 ${label} 的站序跟部署中的班表不同，行車時間與停站會對不上。`,
        });
      }
      for (const stationId of route.stationIds) {
        if (
          candidate.stationIds.size > 0 &&
          !candidate.stationIds.has(stationId)
        ) {
          missingStations.add(stationId);
        }
      }
    }
    if (missingRoutes.length > 0) {
      blockers.push({
        code: 'ROUTE_MISSING',
        message: `部署中的班表「${deployedShift.shiftName}」用到的 ${missingRoutes.length} 條路線這張地圖沒有：${missingRoutes.join('、')}。`,
      });
    }
    if (missingStations.size > 0) {
      blockers.push({
        code: 'STATION_MISSING',
        message: `部署中的班表經過的 ${missingStations.size} 個點位這張地圖找不到：${[...missingStations].join('、')}。`,
      });
    }
  }

  return {
    mapId: candidate.mapId,
    displayName: candidate.displayName,
    alreadyActive: candidate.mapId === currentActive.mapId,
    currentActive,
    routeCount: candidate.routes.length,
    stationCount: candidate.stationIds.size,
    deployedShift: deployedShift
      ? { shiftId: deployedShift.shiftId, shiftName: deployedShift.shiftName }
      : null,
    blockers,
    warnings,
    canActivate: blockers.length === 0,
  };
}
