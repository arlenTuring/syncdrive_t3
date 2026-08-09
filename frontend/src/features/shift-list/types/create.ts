import {
  emptyShiftScheduleActionSettingsDraft,
  isActionSettingsDraftComplete,
  parseShiftScheduleActionSettings,
  syncActionSettingsWithSelectedRoutes,
  type ShiftScheduleActionSettingsDraft,
} from '../utils/actionSettings';
import {
  CURRENT_SHIFT_SCHEDULE_OUTPUT_VERSION,
  type ShiftScheduleStoredOutput,
} from '../utils/schedule-engine/types';
import {
  emptyMaintenanceEntrySlackBySectionInput,
  normalizeEmptyIntervalMainlineSlackSecondsInput,
  normalizeMaintenanceEntrySlackBySectionInput,
  buildMaintenanceEntrySlackFingerprint,
  parseEmptyIntervalMainlineSlackSeconds,
  type MaintenanceEntrySlackBySectionInput,
} from '../utils/resolveMaintenanceEntrySlackSeconds';
import {
  emptyMaintenanceSectionCodeBySection,
  normalizeMaintenanceSectionCodeBySection,
  buildMaintenanceSectionCodeFingerprint,
  isMaintenanceSectionCodesComplete,
  type MaintenanceSectionCodeBySection,
} from '../utils/maintenanceSectionCode';
import {
  SHIFT_SCHEDULE_DEFAULT_SWITCH_BUFFER_SECONDS,
  SHIFT_SCHEDULE_DEFAULT_DWELL_SLACK_SECONDS,
  SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
  SHIFT_SCHEDULE_DEFAULT_RECOVERY_TIME_SECONDS,
  SHIFT_SCHEDULE_DEFAULT_COLLISION_PROTECTION_SECONDS,
  normalizeSwitchBufferAfterSeconds,
  normalizeDwellSlackSeconds,
  normalizeMinimumRecoveryTimeSeconds,
  normalizeCollisionProtectionSeconds,
  applyDwellSlackSeconds,
  resolveStationDwellMode,
  stationDwellSkipsSlack,
  applyStationDwellWithSlack,
  snapUpToClockAlignSeconds,
  isClockAlignedSeconds,
  sortSelectedRoutesByExecutionOrder,
  sumStationDwellSeconds,
  sumStationDwellSecondsWithSlack,
  areStationDwellsComplete,
  isStationDwellEntryComplete,
  resolveRouteCycleSeconds,
  resolveRouteMinTurnaroundBudgetSeconds,
  isMainlineRouteWithinTurnaroundLimit,
  resolveNextRouteInExecutionOrder,
  resolveInterTripGapSeconds,
  resolveRouteRotationMinSeconds,
  buildRouteGroupsParamsFingerprint,
  isStationDwellRequired,
  looksLikeDefaultCrossoverPortalStationId,
  resolveStationDwellListRole,
  formatStationDwellRoleLabel,
} from '../utils/schedule-engine/physics';
import { parseShiftScheduleStoredOutput } from '../utils/buildShiftScheduleOutput';
import {
  emptyShiftRouteRelationGraph,
  parseShiftRouteRelationGraph,
  syncRouteRelationGraphWithRoutes,
  type ShiftRouteRelationGraph,
} from '../utils/routeRelationGraph';
import {
  emptyShiftRouteThroughAnchorsDraft,
  isThroughVerificationCurrent,
  parseShiftRouteThroughAnchorsDraft,
  type ShiftRouteThroughAnchorsDraft,
} from '../utils/routeRelationThroughCycles';

export type {
  ShiftRouteRelationGraph,
  ShiftRouteRelationLink,
  ShiftRouteRelationNextKind,
  ShiftRouteRelationNode,
} from '../utils/routeRelationGraph';
export type { ShiftRouteThroughAnchorsDraft } from '../utils/routeRelationThroughCycles';
export {
  emptyShiftRouteRelationGraph,
  parseShiftRouteRelationGraph,
  syncRouteRelationGraphWithRoutes,
} from '../utils/routeRelationGraph';
export {
  emptyShiftRouteThroughAnchorsDraft,
  isThroughVerificationCurrent,
  parseShiftRouteThroughAnchorsDraft,
} from '../utils/routeRelationThroughCycles';

export {
  SHIFT_SCHEDULE_DEFAULT_SWITCH_BUFFER_SECONDS,
  SHIFT_SCHEDULE_DEFAULT_DWELL_SLACK_SECONDS,
  SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
  SHIFT_SCHEDULE_DEFAULT_RECOVERY_TIME_SECONDS,
  SHIFT_SCHEDULE_DEFAULT_COLLISION_PROTECTION_SECONDS,
  normalizeSwitchBufferAfterSeconds,
  normalizeDwellSlackSeconds,
  normalizeMinimumRecoveryTimeSeconds,
  normalizeCollisionProtectionSeconds,
  applyDwellSlackSeconds,
  resolveStationDwellMode,
  stationDwellSkipsSlack,
  applyStationDwellWithSlack,
  snapUpToClockAlignSeconds,
  isClockAlignedSeconds,
  sortSelectedRoutesByExecutionOrder,
  sumStationDwellSeconds,
  sumStationDwellSecondsWithSlack,
  areStationDwellsComplete,
  isStationDwellEntryComplete,
  resolveRouteCycleSeconds,
  resolveRouteMinTurnaroundBudgetSeconds,
  isMainlineRouteWithinTurnaroundLimit,
  resolveNextRouteInExecutionOrder,
  resolveInterTripGapSeconds,
  resolveRouteRotationMinSeconds,
  buildRouteGroupsParamsFingerprint,
  isStationDwellRequired,
  looksLikeDefaultCrossoverPortalStationId,
  resolveStationDwellListRole,
  formatStationDwellRoleLabel,
};

export type CreateShiftScheduleStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const CREATE_SHIFT_SCHEDULE_STEPS: Array<{
  step: CreateShiftScheduleStep;
  label: string;
}> = [
  { step: 1, label: '基本資料' },
  { step: 2, label: '整備任務' },
  { step: 3, label: '時間模板' },
  { step: 4, label: '路線群組' },
  { step: 5, label: '行動設定' },
  { step: 6, label: '調整班表' },
  { step: 7, label: '整體預覽' },
];

export const CREATE_SHIFT_SCHEDULE_STEP_HEADERS: Record<CreateShiftScheduleStep, string> = {
  1: '設定班表基本資料',
  2: '選擇整備任務規則包',
  3: '選擇時間模板',
  4: '設定路線群組與停靠時間',
  5: '設定站間行動清單',
  6: '調整自動生成的班表細節',
  7: '確認班表細節並完成建立',
};

export const SHIFT_SCHEDULE_BODY_EDITOR_VERSION = 3;

export type ShiftScheduleBasicDraft = {
  name: string;
  version: string;
  remarks: string;
};

/** 參數生成（引擎）或手動製作（拖拉班次卡） */
export type ShiftScheduleCreationMode = 'parametric' | 'manual';

export type ShiftScheduleMaintenanceTaskDraft = {
  taskId: string;
  taskName: string;
  /** 略過整備任務設定時為 true */
  skipped: boolean;
  /**
   * 各整備區塊的正線優先讓渡餘裕（秒，字串表單值）。
   * 正線回程來不及時最多可占用整備開頭此秒數；整備結束時間不變。
   * 屬班表策略參數，不寫入整備任務本體；手動製作可不填。
   */
  entrySlackBySection: MaintenanceEntrySlackBySectionInput;
  /**
   * 各整備區塊代號（1–2 大寫英文字母，無預設）。
   * 班次代號 = 整備代號 + 列碼(A/B/C…) + 開始 HHMM。
   */
  sectionCodeBySection: MaintenanceSectionCodeBySection;
  /** 選定整備任務各區塊是否啟用（載入 detail 後寫入，供代號必填判斷） */
  sectionEnabled: {
    charging: boolean;
    carWash: boolean;
    maintenance: boolean;
    preTrip: boolean;
    mobile: boolean;
    /** 整備任務第 5 步「調度任務」是否啟用；決定 parkIn／parkOut 代號是否必填 */
  };
};

export type ShiftScheduleTimeTemplateDraft = {
  templateId: string;
  templateName: string;
  /**
   * 空時段正線讓渡餘裕（秒）。僅當時間模板全日有未排定時間屬性的空時段時使用；
   * 無空時段時可忽略（預設仍為 600）。
   */
  emptyIntervalMainlineSlackSeconds: string;
};

import type { TaskTypeKey } from '../../time-templates/types/editor';
import {
  resolveRouteTravelTimesFromBody,
} from '../../map-editor/utils/routePlanning';
import {
  parseStationLegTravels,
  type ShiftScheduleStationLegTravel,
} from '../utils/stationLegTravel';

/** 單一站點停靠時間（班表 Step 4） */
export type ShiftStationDwellMode = 'seconds' | 'no_stop' | 'line_change';

export type ShiftScheduleStationDwell = {
  stationId: string;
  stationName: string;
  /**
   * 停靠秒數。
   * - dwellMode=seconds：必填正整數
   * - no_stop／line_change：固定 0，且不加靠站緩衝
   * - 首站／虛擬渡線等 dwellRequired=false：固定 0
   */
  dwellSeconds: number | null;
  /**
   * 停靠方式；未設定時視為 seconds（舊草稿相容）。
   * no_stop＝不停靠；line_change＝換線停靠（兩者實際秒數皆 0、不加緩衝）。
   */
  dwellMode?: ShiftStationDwellMode;
  /**
   * 是否需填寫停靠時間。
   * false＝首站（出發）／虛擬渡線端點等（僅顯示「首站／途經」，不設秒數）。
   */
  dwellRequired?: boolean;
};

export type { ShiftScheduleStationLegTravel };

export type ShiftScheduleSelectedRoute = {
  /**
   * 槽內條目唯一鍵（主路線／備用各一）。
   * 同一 catalog routeId 可出現在不同槽（例如 A 槽主路線同時是 B 槽備用）。
   */
  instanceId: string;
  routeId: string;
  routeName: string;
  /** 路線代號（必填）：班次卡／衝突訊息顯示用，非固定 D／U */
  routeCode?: string | null;
  groupId: string;
  groupName: string;
  stationIds: string[];
  stationDwells: ShiftScheduleStationDwell[];
  /** 各站停靠時間已確認鎖定 */
  stationDwellsConfirmed: boolean;
  /**
   * 相鄰站間行駛時間（由地圖點位拓撲展開快照）。
   * 完整時引擎／站點時刻以此為準；缺省則回退整線 avg/min 與均分估算。
   */
  stationLegTravels: ShiftScheduleStationLegTravel[];
  avgTravelTimeSeconds: number | null;
  minTravelTimeSeconds: number | null;
  /** 執行順序（1 起算，僅主路線）；排班時同任務類型依此順序輪替 */
  executionOrder: number;
  /**
   * 完成此路線後、切換至其他路線前的緩衝秒數。
   * 實際接續對象依排班／關聯設定而定，UI 不預先標示「接哪一條」。
   */
  switchBufferAfterSeconds: number;
  /**
   * 靠站緩衝秒數（路線局域）。各站有效停靠 = 停靠 + 緩衝秒數（停靠為 0 時不加）。
   * 用於吸收開關門硬體延遲與靠站作業緩衝。
   */
  dwellSlackSeconds: number;
  /**
   * 備用路線：指向所屬主路線槽的 instanceId。
   * 未設定／null＝主路線（參與執行順序與排班輪替）。
   */
  backupForInstanceId?: string | null;
  /**
   * @deprecated 舊草稿相容：指向主路線 routeId。新資料請用 backupForInstanceId。
   */
  backupForRouteId?: string | null;
  /**
   * 服務方向標籤 id（同向班距／運能用）。未設定＝暫不歸組。
   * 必須對應 routeGroups.serviceDirectionTags 內的 id。
   */
  serviceDirectionId?: string | null;
  /**
   * 服務方向顯示名稱（冗餘備份）。
   * 標籤清單若遺失，運能圖仍可用此欄顯示，避免露出 UUID。
   */
  serviceDirectionName?: string | null;
};

/** 服務方向標籤：同標籤的路線視為同一方向流（班距／運能） */
export type ShiftScheduleServiceDirectionTag = {
  id: string;
  name: string;
};

export function createServiceDirectionTagId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `sdir-${crypto.randomUUID()}`;
  }
  return `sdir-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function parseShiftScheduleServiceDirectionTags(
  raw: unknown,
): ShiftScheduleServiceDirectionTag[] {
  if (!Array.isArray(raw)) return [];
  const out: ShiftScheduleServiceDirectionTag[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name });
  }
  return out;
}

/**
 * 標籤清單遺失但路線仍掛著 serviceDirectionId 時，從路線重建標籤，
 * 避免運能圖只剩 UUID、以及 parse 時把方向指派清掉。
 */
export function recoverServiceDirectionTagsFromRoutes(
  tags: ShiftScheduleServiceDirectionTag[],
  routes: ShiftScheduleSelectedRoute[],
): ShiftScheduleServiceDirectionTag[] {
  const byId = new Map(tags.map((tag) => [tag.id, tag] as const));
  let autoIndex = 0;
  for (const route of routes) {
    const id = route.serviceDirectionId?.trim();
    if (!id || byId.has(id)) continue;
    autoIndex += 1;
    const fromRoute = route.serviceDirectionName?.trim();
    byId.set(id, {
      id,
      name: fromRoute || `服務方向 ${autoIndex}`,
    });
  }
  return [...byId.values()];
}

export function createSelectedRouteInstanceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `sel-${crypto.randomUUID()}`;
  }
  return `sel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function resolveSelectedRouteInstanceId(route: ShiftScheduleSelectedRoute): string {
  const id = route.instanceId?.trim();
  return id || route.routeId;
}

export function isPrimarySelectedRoute(route: ShiftScheduleSelectedRoute): boolean {
  return !route.backupForInstanceId?.trim() && !route.backupForRouteId?.trim();
}

/** 此主路線槽內已佔用的 catalog routeId（主＋備用），單槽不可重複 */
export function listRouteIdsInPrimarySlot(
  routes: ShiftScheduleSelectedRoute[],
  primaryInstanceId: string,
): Set<string> {
  const primaryId = primaryInstanceId.trim();
  const primary = routes.find(
    (item) =>
      resolveSelectedRouteInstanceId(item) === primaryId && isPrimarySelectedRoute(item),
  );
  const out = new Set<string>();
  if (!primary) return out;
  out.add(primary.routeId);
  for (const route of routes) {
    if (route.backupForInstanceId?.trim() === primaryId) {
      out.add(route.routeId);
      continue;
    }
    if (
      !route.backupForInstanceId?.trim()
      && route.backupForRouteId?.trim() === primary.routeId
      && !isPrimarySelectedRoute(route)
    ) {
      out.add(route.routeId);
    }
  }
  return out;
}

export type ShiftScheduleRouteGroupsDraft = {
  mapId: string;
  selectedRoutes: ShiftScheduleSelectedRoute[];
  /**
   * 恢復時間（秒）：同 timeline 兩趟正線之間至少保留的可吸收延誤空檔。
   */
  minimumRecoveryTimeSeconds: number | null;
  /**
   * 碰撞保護時間（秒）：A 車從某站位發車後，要多久才確定駛離會互相碰撞的那段空間。
   * 後車到站不得早於前車實際離站 + 2 × 此值（前車滯留在站上時以真正開走的時刻起算）。
   * null＝沿用預設 30 秒。這是防碰撞下限，不影響班距目標。
   */
  collisionProtectionSeconds?: number | null;
  /**
   * 服務方向標籤清單（使用者自訂）。
   * 各路線以 serviceDirectionId 單選其一；同標籤＝同向班距／運能。
   */
  serviceDirectionTags?: ShiftScheduleServiceDirectionTag[];
  /** 路線關聯圖（方格接續）；舊草稿缺省為空 */
  routeRelationGraph?: ShiftRouteRelationGraph;
  /**
   * 折返錨點＋已鎖定全優先路線組合（參數生成必填）。
   * 舊草稿缺省視為未鎖定；鎖定後引擎只走這些組合。
   */
  throughAnchors?: ShiftRouteThroughAnchorsDraft;
};

export type ShiftScheduleCreateDraft = {
  /** 參數生成 | 手動製作 */
  creationMode: ShiftScheduleCreationMode;
  basic: ShiftScheduleBasicDraft;
  maintenanceTask: ShiftScheduleMaintenanceTaskDraft;
  timeTemplate: ShiftScheduleTimeTemplateDraft;
  routeGroups: ShiftScheduleRouteGroupsDraft;
  /** Step 5：站間行動設定（參數生成／手動製作共用） */
  actionSettings: ShiftScheduleActionSettingsDraft;
  /** Step 6 引擎產物 + 整備任務綁定；Step 7 唯讀預覽用 */
  scheduleOutput: ShiftScheduleStoredOutput | null;
  currentStep: CreateShiftScheduleStep;
  maxReachedStep: CreateShiftScheduleStep;
};

export const SHIFT_SCHEDULE_UNTITLED_NAME = '未完成的班表';

export function resolveShiftScheduleDraftName(name: string): string {
  const trimmed = name.trim();
  return trimmed || SHIFT_SCHEDULE_UNTITLED_NAME;
}

export function displayShiftScheduleDraftName(storedName: string): string {
  const trimmed = storedName.trim();
  if (!trimmed || trimmed === SHIFT_SCHEDULE_UNTITLED_NAME) return '';
  return trimmed;
}

export function emptyShiftScheduleCreateDraft(
  creationMode: ShiftScheduleCreationMode = 'parametric',
): ShiftScheduleCreateDraft {
  return {
    creationMode,
    basic: {
      name: '',
      version: '',
      remarks: '',
    },
    maintenanceTask: {
      taskId: '',
      taskName: '',
      skipped: false,
      entrySlackBySection: emptyMaintenanceEntrySlackBySectionInput(),
      sectionCodeBySection: emptyMaintenanceSectionCodeBySection(),
      sectionEnabled: {
        charging: false,
        carWash: false,
        maintenance: false,
        preTrip: false,
        mobile: false,
      },
    },
    timeTemplate: {
      templateId: '',
      templateName: '',
      emptyIntervalMainlineSlackSeconds: normalizeEmptyIntervalMainlineSlackSecondsInput(
        undefined,
      ),
    },
    routeGroups: {
      mapId: '',
      selectedRoutes: [],
      minimumRecoveryTimeSeconds: null,
      collisionProtectionSeconds: null,
      serviceDirectionTags: [],
      routeRelationGraph: emptyShiftRouteRelationGraph(),
      throughAnchors: emptyShiftRouteThroughAnchorsDraft(),
    },
    actionSettings: emptyShiftScheduleActionSettingsDraft(),
    scheduleOutput: null,
    currentStep: 1,
    maxReachedStep: 1,
  };
}

export function emptyStationDwellsFromIds(
  stationIds: string[],
  stationNameById?: ReadonlyMap<string, string>,
): ShiftScheduleStationDwell[] {
  return stationIds.map((stationId, index) => {
    const isOrigin = index === 0;
    const isCrossover = looksLikeDefaultCrossoverPortalStationId(stationId);
    if (isOrigin || isCrossover) {
      return {
        stationId,
        stationName: stationNameById?.get(stationId) ?? stationId,
        dwellSeconds: 0,
        dwellRequired: false,
      };
    }
    return {
      stationId,
      stationName: stationNameById?.get(stationId) ?? stationId,
      dwellSeconds: null,
      dwellMode: 'seconds' as const,
    };
  });
}

export function isSelectedRouteDwellReady(
  route: ShiftScheduleSelectedRoute,
  turnaroundLimitSeconds: number | null,
  minimumRecoveryTimeSeconds = 0,
): boolean {
  if (!areStationDwellsComplete(route.stationDwells)) {
    return false;
  }
  return isMainlineRouteWithinTurnaroundLimit(
    route,
    turnaroundLimitSeconds,
    minimumRecoveryTimeSeconds,
  );
}

export function normalizeSelectedRouteExecutionOrders(
  routes: ShiftScheduleSelectedRoute[],
): ShiftScheduleSelectedRoute[] {
  const withIds = routes.map((route, index) => ({
    ...route,
    instanceId: route.instanceId?.trim()
      ? route.instanceId.trim()
      : `${isPrimarySelectedRoute(route) ? 'p' : 'b'}-${route.routeId || 'x'}-${index}`,
  }));

  const primaries = sortSelectedRoutesByExecutionOrder(
    withIds.filter((route) => isPrimarySelectedRoute(route)),
  ).map((route, index) => ({
    ...route,
    executionOrder: index + 1,
    backupForInstanceId: null,
    backupForRouteId: null,
  }));
  const primaryByInstanceId = new Map(
    primaries.map((route) => [resolveSelectedRouteInstanceId(route), route] as const),
  );
  const primaryByRouteId = new Map(primaries.map((route) => [route.routeId, route] as const));

  const backups = withIds
    .filter((route) => !isPrimarySelectedRoute(route))
    .map((route) => {
      const byInstance = route.backupForInstanceId?.trim();
      const parent =
        (byInstance ? primaryByInstanceId.get(byInstance) : null)
        ?? (route.backupForRouteId?.trim()
          ? primaryByRouteId.get(route.backupForRouteId.trim())
          : null);
      if (!parent) return null;
      return {
        ...route,
        backupForInstanceId: resolveSelectedRouteInstanceId(parent),
        backupForRouteId: parent.routeId,
        executionOrder: parent.executionOrder,
      };
    })
    .filter((route): route is ShiftScheduleSelectedRoute => route != null);

  return [...primaries, ...backups];
}

export function nextExecutionOrder(routes: ShiftScheduleSelectedRoute[]): number {
  const primaries = routes.filter((route) => isPrimarySelectedRoute(route));
  if (primaries.length === 0) return 1;
  return primaries.reduce((max, route) => Math.max(max, route.executionOrder), 0) + 1;
}

/** @deprecated 請改用 nextExecutionOrder */
export function nextExecutionOrderForTaskType(
  routes: ShiftScheduleSelectedRoute[],
  _taskType: TaskTypeKey | null,
): number {
  return nextExecutionOrder(routes);
}

export function moveSelectedRouteExecutionOrder(
  routes: ShiftScheduleSelectedRoute[],
  routeId: string,
  direction: 'up' | 'down',
): ShiftScheduleSelectedRoute[] {
  const primaries = sortSelectedRoutesByExecutionOrder(
    routes.filter((route) => isPrimarySelectedRoute(route)),
  );
  const index = primaries.findIndex(
    (route) =>
      resolveSelectedRouteInstanceId(route) === routeId || route.routeId === routeId,
  );
  if (index < 0) return routes;

  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= primaries.length) return routes;

  const reordered = [...primaries];
  const tmp = reordered[index]!;
  reordered[index] = reordered[swapIndex]!;
  reordered[swapIndex] = tmp;

  const orderByInstanceId = new Map(
    reordered.map((route, idx) => [resolveSelectedRouteInstanceId(route), idx + 1] as const),
  );

  return normalizeSelectedRouteExecutionOrders(
    routes.map((route) => {
      if (!isPrimarySelectedRoute(route)) return route;
      return {
        ...route,
        executionOrder:
          orderByInstanceId.get(resolveSelectedRouteInstanceId(route)) ?? route.executionOrder,
      };
    }),
  );
}

/** 將指定正線設為火車頭（執行順序第 1）；其餘依原相對順序順延 */
export function setSelectedRouteAsHead(
  routes: ShiftScheduleSelectedRoute[],
  routeId: string,
): ShiftScheduleSelectedRoute[] {
  const primaries = sortSelectedRoutesByExecutionOrder(
    routes.filter((route) => isPrimarySelectedRoute(route)),
  );
  const index = primaries.findIndex(
    (route) =>
      resolveSelectedRouteInstanceId(route) === routeId || route.routeId === routeId,
  );
  if (index < 0) return routes;
  if (index === 0) return normalizeSelectedRouteExecutionOrders(routes);

  const target = primaries[index]!;
  const reordered = [target, ...primaries.filter((_, i) => i !== index)];
  const orderByInstanceId = new Map(
    reordered.map((route, idx) => [resolveSelectedRouteInstanceId(route), idx + 1] as const),
  );

  return normalizeSelectedRouteExecutionOrders(
    routes.map((route) => {
      if (!isPrimarySelectedRoute(route)) return route;
      return {
        ...route,
        executionOrder:
          orderByInstanceId.get(resolveSelectedRouteInstanceId(route)) ?? route.executionOrder,
      };
    }),
  );
}

export function resolveRouteOrderPosition(
  routes: ShiftScheduleSelectedRoute[],
  routeId: string,
): {
  executionOrder: number;
  showControls: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
} {
  const route = routes.find(
    (item) =>
      resolveSelectedRouteInstanceId(item) === routeId || item.routeId === routeId,
  );
  if (!route || !isPrimarySelectedRoute(route)) {
    return {
      executionOrder: 0,
      showControls: false,
      canMoveUp: false,
      canMoveDown: false,
    };
  }

  const sorted = sortSelectedRoutesByExecutionOrder(
    routes.filter((item) => isPrimarySelectedRoute(item)),
  );
  const index = sorted.findIndex(
    (item) => resolveSelectedRouteInstanceId(item) === resolveSelectedRouteInstanceId(route),
  );

  return {
    executionOrder: route.executionOrder,
    showControls: sorted.length > 1,
    canMoveUp: index > 0,
    canMoveDown: index >= 0 && index < sorted.length - 1,
  };
}

export function shouldInvalidateShiftScheduleOutput(
  prev: ShiftScheduleCreateDraft,
  next: ShiftScheduleCreateDraft,
): boolean {
  if (!prev.scheduleOutput?.plan) return false;

  // 與產出班表當下比對：語意未變則不失效（避免誤觸或正規化觸發 onChange）
  if (isShiftScheduleOutputFresh({ ...next, scheduleOutput: prev.scheduleOutput })) {
    return false;
  }

  return true;
}

export type RouteGroupsCycleSummary = {
  recoverySeconds: number;
  totalMinTravelSeconds: number;
  totalAvgTravelSeconds: number;
  totalDwellWithSlackSeconds: number;
  totalSwitchBufferSeconds: number;
  totalMinCycleSeconds: number;
  totalAvgCycleSeconds: number;
};

/** Step 4 通盤循環綜合值（與路線群組步驟底部看板同源） */
export function summarizeRouteGroupsCycle(
  routeGroups: ShiftScheduleRouteGroupsDraft,
): RouteGroupsCycleSummary {
  const recoverySeconds = normalizeMinimumRecoveryTimeSeconds(
    routeGroups.minimumRecoveryTimeSeconds,
  );
  let totalMinTravelSeconds = 0;
  let totalAvgTravelSeconds = 0;
  let totalDwellWithSlackSeconds = 0;
  let totalSwitchBufferSeconds = 0;

  for (const route of routeGroups.selectedRoutes) {
    totalMinTravelSeconds += route.minTravelTimeSeconds ?? 0;
    totalAvgTravelSeconds += route.avgTravelTimeSeconds ?? 0;
    totalSwitchBufferSeconds += normalizeSwitchBufferAfterSeconds(
      route.switchBufferAfterSeconds,
    );
    for (const [index, dwell] of route.stationDwells.entries()) {
      totalDwellWithSlackSeconds += applyStationDwellWithSlack(
        dwell,
        route.dwellSlackSeconds,
        index,
      );
    }
  }

  const totalMinCycleSeconds =
    totalMinTravelSeconds + totalDwellWithSlackSeconds + totalSwitchBufferSeconds + recoverySeconds;
  const totalAvgCycleSeconds =
    totalAvgTravelSeconds + totalDwellWithSlackSeconds + totalSwitchBufferSeconds + recoverySeconds;

  return {
    recoverySeconds,
    totalMinTravelSeconds,
    totalAvgTravelSeconds,
    totalDwellWithSlackSeconds,
    totalSwitchBufferSeconds,
    totalMinCycleSeconds,
    totalAvgCycleSeconds,
  };
}

export function isShiftScheduleOutputFresh(draft: ShiftScheduleCreateDraft): boolean {
  const output = draft.scheduleOutput;
  if (!output || !output.plan) return false;

  // 版本號不符即表示算碼／引擎邏輯已更新，作廢快取重新計算
  if (output.outputVersion !== CURRENT_SHIFT_SCHEDULE_OUTPUT_VERSION) {
    return false;
  }

  if (output.timeTemplateRef.templateId !== draft.timeTemplate.templateId.trim()) {
    return false;
  }

  if (output.maintenanceTaskBinding.skipped !== draft.maintenanceTask.skipped) {
    return false;
  }
  if (
    !draft.maintenanceTask.skipped
    && output.maintenanceTaskBinding.taskId !== draft.maintenanceTask.taskId.trim()
  ) {
    return false;
  }

  const currentMaintSlackFingerprint = buildMaintenanceEntrySlackFingerprint(
    draft.maintenanceTask.entrySlackBySection,
  );
  const storedMaintSlackFingerprint =
    output.maintenanceTaskBinding.entrySlackFingerprint;
  if (
    draft.creationMode !== 'manual'
    && (
      !storedMaintSlackFingerprint
      || storedMaintSlackFingerprint !== currentMaintSlackFingerprint
    )
  ) {
    return false;
  }

  const currentSectionCodeFingerprint = buildMaintenanceSectionCodeFingerprint(
    draft.maintenanceTask.sectionCodeBySection,
  );
  const storedSectionCodeFingerprint =
    output.maintenanceTaskBinding.sectionCodeFingerprint;
  if (
    !storedSectionCodeFingerprint
    || storedSectionCodeFingerprint !== currentSectionCodeFingerprint
  ) {
    return false;
  }

  const currentEmptySlack = parseEmptyIntervalMainlineSlackSeconds(
    draft.timeTemplate.emptyIntervalMainlineSlackSeconds,
  );
  const storedEmptySlack = output.timeTemplateRef.emptyIntervalMainlineSlackSeconds;
  if (
    draft.creationMode !== 'manual'
    && (
      storedEmptySlack == null
      || storedEmptySlack !== currentEmptySlack
    )
  ) {
    return false;
  }

  if (output.routeGroupsRef.mapId !== draft.routeGroups.mapId) {
    return false;
  }

  const currentRouteIds = draft.routeGroups.selectedRoutes
    .map((route) => route.routeId)
    .sort()
    .join('\0');
  const storedRouteIds = [...output.routeGroupsRef.selectedRouteIds].sort().join('\0');
  if (currentRouteIds !== storedRouteIds) {
    return false;
  }

  const currentFingerprint = buildRouteGroupsParamsFingerprint(draft.routeGroups);
  const storedFingerprint = output.routeGroupsRef.paramsFingerprint;
  if (!storedFingerprint || storedFingerprint !== currentFingerprint) {
    return false;
  }

  return true;
}

export function serializeShiftScheduleBody(
  draft: ShiftScheduleCreateDraft,
): Record<string, unknown> {
  return {
    editorVersion: SHIFT_SCHEDULE_BODY_EDITOR_VERSION,
    creationMode: draft.creationMode,
    version: draft.basic.version,
    remarks: draft.basic.remarks,
    maintenanceTaskId: draft.maintenanceTask.taskId,
    maintenanceTaskName: draft.maintenanceTask.taskName,
    maintenanceTaskSkipped: draft.maintenanceTask.skipped,
    maintenanceEntrySlackBySection: normalizeMaintenanceEntrySlackBySectionInput(
      draft.maintenanceTask.entrySlackBySection,
    ),
    maintenanceSectionCodeBySection: normalizeMaintenanceSectionCodeBySection(
      draft.maintenanceTask.sectionCodeBySection,
    ),
    maintenanceSectionEnabled: draft.maintenanceTask.sectionEnabled,
    timeTemplateId: draft.timeTemplate.templateId,
    timeTemplateName: draft.timeTemplate.templateName,
    emptyIntervalMainlineSlackSeconds: normalizeEmptyIntervalMainlineSlackSecondsInput(
      draft.timeTemplate.emptyIntervalMainlineSlackSeconds,
    ),
    routeGroupsMapId: draft.routeGroups.mapId,
    selectedRoutes: draft.routeGroups.selectedRoutes,
    minimumRecoveryTimeSeconds: draft.routeGroups.minimumRecoveryTimeSeconds,
    collisionProtectionSeconds: draft.routeGroups.collisionProtectionSeconds ?? null,
    serviceDirectionTags: recoverServiceDirectionTagsFromRoutes(
      draft.routeGroups.serviceDirectionTags ?? [],
      draft.routeGroups.selectedRoutes,
    ),
    routeRelationGraph: draft.routeGroups.routeRelationGraph ?? emptyShiftRouteRelationGraph(),
    throughAnchors:
      draft.routeGroups.throughAnchors ?? emptyShiftRouteThroughAnchorsDraft(),
    actionSettings: draft.actionSettings,
    scheduleOutput: draft.scheduleOutput,
    currentStep: draft.currentStep,
    maxReachedStep: draft.maxReachedStep,
  };
}

function parseStationDwells(
  raw: unknown,
  stationIds: string[],
): ShiftScheduleStationDwell[] {
  const byId = new Map<string, ShiftScheduleStationDwell>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const stationId = typeof o.stationId === 'string' ? o.stationId.trim() : '';
      if (!stationId) continue;
      const dwellRequired =
        o.dwellRequired === false
          ? false
          : o.dwellRequired === true
            ? true
            : undefined;
      const dwellMode: ShiftStationDwellMode | undefined =
        o.dwellMode === 'no_stop' || o.dwellMode === 'line_change' || o.dwellMode === 'seconds'
          ? o.dwellMode
          : undefined;
      const dwellRaw = o.dwellSeconds;
      let dwellSeconds: number | null = null;
      if (dwellMode === 'no_stop' || dwellMode === 'line_change') {
        dwellSeconds = 0;
      } else if (typeof dwellRaw === 'number' && Number.isFinite(dwellRaw)) {
        const rounded = Math.round(dwellRaw);
        if (dwellRequired === false || looksLikeDefaultCrossoverPortalStationId(stationId)) {
          dwellSeconds = Math.max(0, rounded);
        } else if (rounded > 0) {
          dwellSeconds = rounded;
        }
      } else if (dwellRequired === false || looksLikeDefaultCrossoverPortalStationId(stationId)) {
        dwellSeconds = 0;
      }
      byId.set(stationId, {
        stationId,
        stationName:
          typeof o.stationName === 'string' && o.stationName.trim()
            ? o.stationName
            : stationId,
        dwellSeconds:
          dwellMode === 'no_stop' || dwellMode === 'line_change' ? 0 : dwellSeconds,
        ...(dwellMode ? { dwellMode } : {}),
        ...(dwellRequired !== undefined ? { dwellRequired } : {}),
      });
    }
  }

  if (stationIds.length === 0) {
    return [...byId.values()];
  }

  return stationIds.map((stationId, index) => {
    const existing = byId.get(stationId);
    if (existing) {
      if (index === 0) {
        return {
          ...existing,
          dwellSeconds: 0,
          dwellRequired: false,
          dwellMode: undefined,
        };
      }
      return existing;
    }
    if (index === 0 || looksLikeDefaultCrossoverPortalStationId(stationId)) {
      return {
        stationId,
        stationName: stationId,
        dwellSeconds: 0,
        dwellRequired: false,
      };
    }
    return { stationId, stationName: stationId, dwellSeconds: null };
  });
}

export function parseShiftScheduleSelectedRoutes(raw: unknown): ShiftScheduleSelectedRoute[] {
  if (!Array.isArray(raw)) return [];
  const out: ShiftScheduleSelectedRoute[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const routeId = typeof o.routeId === 'string' ? o.routeId.trim() : '';
    if (!routeId) continue;
    const stationIds = Array.isArray(o.stationIds)
      ? o.stationIds.filter((id): id is string => typeof id === 'string')
      : [];
    const stationDwells = parseStationDwells(o.stationDwells, stationIds);
    out.push({
      instanceId:
        typeof o.instanceId === 'string' && o.instanceId.trim()
          ? o.instanceId.trim()
          : '',
      routeId,
      routeName: typeof o.routeName === 'string' ? o.routeName : '',
      routeCode:
        typeof o.routeCode === 'string' && o.routeCode.trim()
          ? o.routeCode.trim().toUpperCase()
          : undefined,
      groupId: typeof o.groupId === 'string' ? o.groupId : '',
      groupName: typeof o.groupName === 'string' ? o.groupName : '',
      stationIds,
      stationDwells,
      stationDwellsConfirmed: o.stationDwellsConfirmed === true,
      stationLegTravels: parseStationLegTravels(o.stationLegTravels),
      ...resolveRouteTravelTimesFromBody(o),
      executionOrder:
        typeof o.executionOrder === 'number' && o.executionOrder > 0
          ? Math.round(o.executionOrder)
          : 0,
      switchBufferAfterSeconds: normalizeSwitchBufferAfterSeconds(o.switchBufferAfterSeconds),
      // 舊草稿 dwellSlackPercent 改為秒數；數值沿用（10% → 10 秒）
      dwellSlackSeconds: normalizeDwellSlackSeconds(
        o.dwellSlackSeconds ?? o.dwellSlackPercent,
      ),
      backupForInstanceId:
        typeof o.backupForInstanceId === 'string' && o.backupForInstanceId.trim()
          ? o.backupForInstanceId.trim()
          : null,
      backupForRouteId:
        typeof o.backupForRouteId === 'string' && o.backupForRouteId.trim()
          ? o.backupForRouteId.trim()
          : null,
      serviceDirectionId:
        typeof o.serviceDirectionId === 'string' && o.serviceDirectionId.trim()
          ? o.serviceDirectionId.trim()
          : null,
      serviceDirectionName:
        typeof o.serviceDirectionName === 'string' && o.serviceDirectionName.trim()
          ? o.serviceDirectionName.trim()
          : null,
    });
  }
  return normalizeSelectedRouteExecutionOrders(out);
}

function migrateStepFromEditorV1(step: number): number {
  if (step === 2) return 3;
  if (step === 3) return 2;
  return step;
}

/** editor v2（六步）→ v3：在路線群組後插入行動設定 */
function migrateStepFromEditorV2(step: number): number {
  if (step >= 5) return step + 1;
  return step;
}

function clampStep(step: number): CreateShiftScheduleStep {
  return Math.min(7, Math.max(1, step)) as CreateShiftScheduleStep;
}

export function buildShiftScheduleDraftFromStored(
  name: string,
  body: Record<string, unknown>,
): ShiftScheduleCreateDraft {
  const editorVersion =
    typeof body.editorVersion === 'number' ? body.editorVersion : 1;

  const rawCurrentStep =
    typeof body.currentStep === 'number' ? body.currentStep : 1;
  const rawMaxReachedStep =
    typeof body.maxReachedStep === 'number' ? body.maxReachedStep : rawCurrentStep;

  let migratedCurrent = rawCurrentStep;
  let migratedMax = rawMaxReachedStep;
  if (editorVersion < 2) {
    migratedCurrent = migrateStepFromEditorV1(migratedCurrent);
    migratedMax = migrateStepFromEditorV1(migratedMax);
  }
  if (editorVersion < 3) {
    migratedCurrent = migrateStepFromEditorV2(migratedCurrent);
    migratedMax = migrateStepFromEditorV2(migratedMax);
  }

  const currentStep = clampStep(migratedCurrent);
  const maxReachedStep = clampStep(Math.max(currentStep, migratedMax));

  const selectedRoutes = parseShiftScheduleSelectedRoutes(body.selectedRoutes);
  const actionSettings = syncActionSettingsWithSelectedRoutes(
    parseShiftScheduleActionSettings(body.actionSettings),
    selectedRoutes.filter((route) => isPrimarySelectedRoute(route)),
  );

  return {
    creationMode:
      body.creationMode === 'manual' ? 'manual' : 'parametric',
    basic: {
      name: displayShiftScheduleDraftName(name),
      version: typeof body.version === 'string' ? body.version : '',
      remarks: typeof body.remarks === 'string' ? body.remarks : '',
    },
    maintenanceTask: {
      taskId: typeof body.maintenanceTaskId === 'string' ? body.maintenanceTaskId : '',
      taskName:
        typeof body.maintenanceTaskName === 'string'
          ? body.maintenanceTaskName
          : '',
      skipped: body.maintenanceTaskSkipped === true,
      entrySlackBySection: normalizeMaintenanceEntrySlackBySectionInput(
        body.maintenanceEntrySlackBySection
        && typeof body.maintenanceEntrySlackBySection === 'object'
          ? (body.maintenanceEntrySlackBySection as Partial<MaintenanceEntrySlackBySectionInput>)
          : undefined,
      ),
      sectionCodeBySection: normalizeMaintenanceSectionCodeBySection(
        body.maintenanceSectionCodeBySection
        && typeof body.maintenanceSectionCodeBySection === 'object'
          ? (body.maintenanceSectionCodeBySection as Partial<MaintenanceSectionCodeBySection>)
          : undefined,
      ),
      sectionEnabled: parseSectionEnabled(body.maintenanceSectionEnabled),
    },
    timeTemplate: {
      templateId: typeof body.timeTemplateId === 'string' ? body.timeTemplateId : '',
      templateName:
        typeof body.timeTemplateName === 'string' ? body.timeTemplateName : '',
      emptyIntervalMainlineSlackSeconds: normalizeEmptyIntervalMainlineSlackSecondsInput(
        body.emptyIntervalMainlineSlackSeconds,
      ),
    },
    routeGroups: {
      mapId: typeof body.routeGroupsMapId === 'string' ? body.routeGroupsMapId : '',
      selectedRoutes: (() => {
        const tags = recoverServiceDirectionTagsFromRoutes(
          parseShiftScheduleServiceDirectionTags(body.serviceDirectionTags),
          selectedRoutes,
        );
        const tagById = new Map(tags.map((tag) => [tag.id, tag] as const));
        return selectedRoutes.map((route) => {
          const id = route.serviceDirectionId?.trim() || null;
          if (!id || !tagById.has(id)) {
            return { ...route, serviceDirectionId: null, serviceDirectionName: null };
          }
          const tag = tagById.get(id)!;
          return {
            ...route,
            serviceDirectionId: id,
            serviceDirectionName:
              route.serviceDirectionName?.trim() || tag.name,
          };
        });
      })(),
      minimumRecoveryTimeSeconds: normalizeMinimumRecoveryTimeSeconds(
        body.minimumRecoveryTimeSeconds,
      ),
      collisionProtectionSeconds: normalizeCollisionProtectionSeconds(
        body.collisionProtectionSeconds,
      ),
      serviceDirectionTags: recoverServiceDirectionTagsFromRoutes(
        parseShiftScheduleServiceDirectionTags(body.serviceDirectionTags),
        selectedRoutes,
      ),
      routeRelationGraph: syncRouteRelationGraphWithRoutes(
        parseShiftRouteRelationGraph(body.routeRelationGraph),
        selectedRoutes.filter((route) => isPrimarySelectedRoute(route)),
      ),
      throughAnchors: parseShiftRouteThroughAnchorsDraft(body.throughAnchors),
    },
    actionSettings,
    scheduleOutput: parseShiftScheduleStoredOutput(body.scheduleOutput),
    currentStep,
    maxReachedStep,
  };
}

function parseSectionEnabled(raw: unknown): ShiftScheduleMaintenanceTaskDraft['sectionEnabled'] {
  const base = {
    charging: false,
    carWash: false,
    maintenance: false,
    preTrip: false,
    mobile: false,
  };
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Record<string, unknown>;
  return {
    charging: o.charging === true,
    carWash: o.carWash === true,
    maintenance: o.maintenance === true,
    preTrip: o.preTrip === true,
    mobile: o.mobile === true,
  };
}

export function isShiftScheduleBasicStepComplete(basic: ShiftScheduleBasicDraft): boolean {
  return basic.name.trim().length > 0 && basic.version.trim().length > 0;
}

export function isCreateShiftScheduleStepComplete(
  step: CreateShiftScheduleStep,
  draft: ShiftScheduleCreateDraft,
  nameUniqueOk: boolean,
  turnaroundLimitSeconds: number | null = null,
): boolean {
  if (step === 1) {
    return isShiftScheduleBasicStepComplete(draft.basic) && nameUniqueOk;
  }
  if (step === 2) {
    if (draft.maintenanceTask.skipped) return true;
    if (!draft.maintenanceTask.taskId.trim()) return false;
    return isMaintenanceSectionCodesComplete(
      draft.maintenanceTask.sectionCodeBySection,
      draft.maintenanceTask.sectionEnabled,
    );
  }
  if (step === 3) {
    return draft.timeTemplate.templateId.trim().length > 0;
  }
  if (step === 4) {
    const routes = draft.routeGroups.selectedRoutes;
    if (draft.creationMode === 'manual') {
      return (
        routes.length > 0
        && routes.every(
          (route) =>
            route.executionOrder > 0
            && Boolean(route.routeCode?.trim())
            && isSelectedRouteDwellReady(route, turnaroundLimitSeconds, 0),
        )
      );
    }
    const recoverySeconds = draft.routeGroups.minimumRecoveryTimeSeconds;
    const primaryRoutes = routes.filter((route) => isPrimarySelectedRoute(route));
    const anchors = draft.routeGroups.throughAnchors ?? emptyShiftRouteThroughAnchorsDraft();
    const preferredId = anchors.preferredThroughCycleId?.trim() || '';
    const preferredOk =
      preferredId.length > 0
      && (anchors.listedThroughCycles ?? []).some((cycle) => cycle.id === preferredId);
    const throughOk = isThroughVerificationCurrent({
      anchors,
      routes: primaryRoutes,
      graph: draft.routeGroups.routeRelationGraph ?? emptyShiftRouteRelationGraph(),
      minimumRecoveryTimeSeconds: recoverySeconds,
      turnaroundLimitSeconds,
    });
    return (
      recoverySeconds !== null
      && routes.length > 0
      && preferredOk
      && throughOk
      && routes.every(
        (route) =>
          route.executionOrder > 0
          && Boolean(route.routeCode?.trim())
          && isSelectedRouteDwellReady(route, turnaroundLimitSeconds, recoverySeconds ?? undefined),
      )
    );
  }
  if (step === 5) {
    // 允許空白行動；已建立的行動須填完
    return isActionSettingsDraftComplete(draft.actionSettings);
  }
  if (step === 6) {
    if (draft.creationMode === 'manual') {
      return draft.scheduleOutput?.plan != null;
    }
    return (
      draft.scheduleOutput?.plan != null
      && draft.scheduleOutput.feasibilityReport.ok === true
    );
  }
  if (step === 7) {
    return draft.scheduleOutput?.plan != null;
  }
  return true;
}

/** 依建立方式取得可見步驟 */
export function resolveVisibleCreateShiftSteps(
  creationMode: ShiftScheduleCreationMode,
): Array<{ step: CreateShiftScheduleStep; label: string }> {
  void creationMode;
  return CREATE_SHIFT_SCHEDULE_STEPS.map(({ step, label }) => ({ step, label }));
}

/** 下一步 */
export function resolveNextCreateShiftStep(
  current: CreateShiftScheduleStep,
  creationMode: ShiftScheduleCreationMode,
): CreateShiftScheduleStep | null {
  const visible = resolveVisibleCreateShiftSteps(creationMode);
  const index = visible.findIndex((item) => item.step === current);
  if (index < 0 || index >= visible.length - 1) return null;
  return visible[index + 1]!.step;
}

/** 上一步 */
export function resolvePreviousCreateShiftStep(
  current: CreateShiftScheduleStep,
  creationMode: ShiftScheduleCreationMode,
): CreateShiftScheduleStep | null {
  const visible = resolveVisibleCreateShiftSteps(creationMode);
  const index = visible.findIndex((item) => item.step === current);
  if (index <= 0) return null;
  return visible[index - 1]!.step;
}

export function isShiftScheduleStepComplete(
  draft: ShiftScheduleCreateDraft,
  nameUnique: boolean,
  turnaroundLimitSeconds: number | null = null,
): boolean {
  return isCreateShiftScheduleStepComplete(
    draft.currentStep,
    draft,
    nameUnique,
    turnaroundLimitSeconds,
  );
}
