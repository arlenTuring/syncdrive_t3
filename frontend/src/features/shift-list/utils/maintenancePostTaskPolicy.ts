import type { TaskTypeKey } from '../../time-templates/types/editor';
import {
  extractFacilityMapCodes,
  resolvePreferredExitStationId,
  resolveExitStationIdsForFacilityCodes,
  resolveYardExitStationIdsForSection,
  type MaintenanceFirstTripOrigin,
} from './maintenanceFirstTripOrigins';

/**
 * 整備結束後接正線的策略（對齊排班引擎規則 §八／§十一）：
 *
 * | 任務類型 | 出場 | 輪替相位 | 整備後調度營運班次 |
 * |---------|------|---------|-------------------|
 * | 行檢 inspection | preTrip 設施→停靠 | 對齊出場站起點路線* | 有，代號 P |
 * | 充電 charging | charging 設施→停靠 | 僅單一出場站時對齊* | 無 |
 * | 待命 standby | mobile 設施→停靠 | 僅單一出場站時對齊* | 無 |
 * | 保養 servicing | maintenance 設施→停靠 | **對齊出場站**（例 M 系→T3→TN）* | 有，代號 M |
 * | 洗車 washing | carWash 設施→停靠 | 同保養 | 有，代號 W |
 *
 * 整備任務固定五類：充電／洗車／保養／行檢／待命，各自在場域設定 step 2
 * 有對應設施分類，<strong>一對一，不做聯集</strong>。
 * 洗車有自己的 `TaskTypeKey`（`washing`）：模板上排洗車就是洗車、排保養就是保養。
 *
 * 調度營運班次一律在整備<strong>結束之後</strong>才發車（不得佔用整備尾巴），
 * 且不受同方向班距約束；只受站位淨空限制。詳見文件 §10。
 *
 * *出場／相位對齊只在「該列之後還有正線模板視窗」時套用。
 * 純待命、沒有正線時不強制為出場站去跑某方向（例如 TN→N2W）。
 * 待命可派正線同樣僅限「該待命開始後仍有正線視窗」的列。
 *
 * 泛用禁令：保養／行檢／充電／待命連成一串整備時，串內不得掛任何正線卡；
 * 只有整備完成後「下一個模板就是正線」才允許調度／進場載客／正線脈衝。
 */

const YARD_TASK_TYPES = new Set([
  'charging',
  'servicing',
  'inspection',
  'standby',
  'washing',
]);

export function isYardTemplateTaskType(taskType: string): boolean {
  return YARD_TASK_TYPES.has(taskType);
}

/** 模板列是否在此分鐘（含）之後還有正線視窗 */
export function rowHasPassengerTemplateAtOrAfter(
  tasks: ReadonlyArray<{
    rowIndex: number;
    taskType: string;
    startMinute: number;
  }>,
  row: number,
  atOrAfterMinute: number,
): boolean {
  return tasks.some(
    (task) =>
      task.rowIndex === row
      && task.taskType === 'passenger'
      && task.startMinute >= atOrAfterMinute - 1e-9,
  );
}

/**
 * 若 atMinute 落在同列一串相接的整備內（或卡在銜接點），回傳該串結束分鐘；
 * 否則 null。例：保養 02:00–09:30 + 行檢 09:30–10:00 → at 09:30 得 10:00。
 */
export function resolveContiguousYardBusyUntilMinute(
  tasks: ReadonlyArray<{
    rowIndex: number;
    taskType: string;
    startMinute: number;
    durationMinutes: number;
  }>,
  row: number,
  atMinute: number,
): number | null {
  const yards = tasks
    .filter(
      (task) =>
        task.rowIndex === row
        && isYardTemplateTaskType(task.taskType)
        && task.durationMinutes > 1e-9,
    )
    .map((task) => ({
      start: task.startMinute,
      end: task.startMinute + task.durationMinutes,
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (yards.length === 0) return null;

  let coveringIndex = -1;
  for (let i = 0; i < yards.length; i += 1) {
    const yard = yards[i]!;
    // 落在區間內，或正好卡在結束／下一整備開始的銜接點
    if (
      atMinute + 1e-9 >= yard.start
      && atMinute < yard.end - 1e-9
    ) {
      coveringIndex = i;
      break;
    }
    if (Math.abs(atMinute - yard.end) <= 1e-6) {
      const next = yards[i + 1];
      if (next && Math.abs(next.start - yard.end) <= 1e-6) {
        coveringIndex = i + 1;
        break;
      }
    }
  }
  if (coveringIndex < 0) return null;

  let end = yards[coveringIndex]!.end;
  for (let i = coveringIndex + 1; i < yards.length; i += 1) {
    const next = yards[i]!;
    if (next.start > end + 1e-6) break;
    end = Math.max(end, next.end);
  }
  return end;
}

/**
 * 待命可否當正線派車窗：該列在待命開始後仍須有正線模板。
 * （純待命列＝備援待命，不強制跑出場交路。）
 */
export function isStandbyDispatchableForMainline(
  tasks: ReadonlyArray<{
    rowIndex: number;
    taskType: string;
    startMinute: number;
  }>,
  standby: { rowIndex: number; startMinute: number },
): boolean {
  return rowHasPassengerTemplateAtOrAfter(
    tasks,
    standby.rowIndex,
    standby.startMinute,
  );
}

/**
 * 整備出場相位對齊是否啟用：拓樸有出場站，且該列在整備結束後仍有正線。
 */
export function shouldApplyYardExitRotationAlign(args: {
  exitStationId: string | null | undefined;
  templateTasks: ReadonlyArray<{
    rowIndex: number;
    taskType: string;
    startMinute: number;
  }>;
  row: number;
  yardEndMinute: number;
}): boolean {
  if (!args.exitStationId?.trim()) return false;
  return rowHasPassengerTemplateAtOrAfter(
    args.templateTasks,
    args.row,
    args.yardEndMinute,
  );
}

export type YardPostTaskPolicy = {
  /**
   * 這一種整備做完之後，車實際停在哪一站（出場站）。
   * 只表達「車在哪」，<strong>不代表輪要從這裡起算</strong>——見
   * {@link alignRotationToExitStation}。
   */
  rotationExitStationId: string | null;
  /**
   * 輪替相位要不要對齊到出場站。
   *
   * <strong>false（保養／行檢）</strong>：出場站離首發站有一段距離，車會先跑一趟
   * <strong>外掛的調度營運班次</strong>把自己送到首發站，那一趟不算輪、也不受班距約束。
   * 輪仍然<strong>從首發站（關聯圖的起點，例 N2W）起算</strong>，結構不變。
   *
   * <strong>true（充電／待命）</strong>：設施就在首發站附近、沒有外掛班次，
   * 車真的就停在出場站，第一段只能從那裡發車。
   *
   * 2026-08-08 更正：舊版兩種都對齊，等於讓「外掛班次」改寫了輪的起點——
   * 行檢出場站是 T3上行，整輪就被鎖成 TN→NT→TS→ST、收尾停在 T3上行，
   * 於是所有經過整備的車全部堆在 T3上行 排隊。外掛不該改變輪的結構。
   */
  alignRotationToExitStation: boolean;
  /** 是否允許在此任務尾端插入進場載客 */
  allowEntryService: boolean;
  /** 進場載客可用的出場站集合（allowEntryService 時有意義） */
  entryServiceExitStationIds: string[];
};

const EMPTY_POLICY: YardPostTaskPolicy = {
  rotationExitStationId: null,
  alignRotationToExitStation: false,
  allowEntryService: false,
  entryServiceExitStationIds: [],
};

function resolveUniqueExitStationId(
  origins: MaintenanceFirstTripOrigin[],
  codes: string[],
): string | null {
  const stations = resolveExitStationIdsForFacilityCodes(origins, codes);
  return stations.length === 1 ? stations[0]! : null;
}

/**
 * 依模板任務類型與整備 body／拓樸，決定「整備結束後怎麼接正線」。
 */
export function resolveYardPostTaskPolicy(args: {
  taskType: TaskTypeKey | string;
  origins: MaintenanceFirstTripOrigin[];
  maintenanceBody: Record<string, unknown> | null | undefined;
}): YardPostTaskPolicy {
  const { taskType, origins, maintenanceBody } = args;
  if (origins.length === 0) return EMPTY_POLICY;

  if (taskType === 'inspection') {
    // 行檢設施同樣離正線起點站有一段距離，做完之後車要開過去才能上工，
    // 因此與保養一樣產生「整備後調度營運班次」（代號 P）。
    const preTripCodes = extractFacilityMapCodes(maintenanceBody, 'preTrip');
    const entryStations = resolveExitStationIdsForFacilityCodes(origins, preTripCodes);
    return {
      rotationExitStationId:
        resolvePreferredExitStationId(origins, preTripCodes)
        ?? (entryStations.length === 1 ? entryStations[0]! : null)
        ?? (entryStations[0] ?? null),
      // 行檢設施離首發站遠，靠外掛的調度營運班次把車送過去；輪仍從首發站起算
      alignRotationToExitStation: false,
      allowEntryService: true,
      entryServiceExitStationIds: entryStations,
    };
  }

  if (taskType === 'charging') {
    return {
      rotationExitStationId: resolveUniqueExitStationId(
        origins,
        extractFacilityMapCodes(maintenanceBody, 'charging'),
      ),
      // 充電沒有外掛班次，車真的就停在出場站，第一段只能從那裡發車
      alignRotationToExitStation: true,
      allowEntryService: false,
      entryServiceExitStationIds: [],
    };
  }

  if (taskType === 'standby') {
    return {
      rotationExitStationId: resolveUniqueExitStationId(
        origins,
        extractFacilityMapCodes(maintenanceBody, 'mobile'),
      ),
      // 待命同充電：沒有外掛班次，車就在出場站
      alignRotationToExitStation: true,
      allowEntryService: false,
      entryServiceExitStationIds: [],
    };
  }

  if (taskType === 'washing') {
    // 洗車與保養同型：設施離首發站遠，靠外掛的調度營運班次把車送過去；輪仍從首發站起算
    const entryStations = resolveYardExitStationIdsForSection(
      origins,
      maintenanceBody,
      'carWash',
    );
    return {
      rotationExitStationId:
        resolvePreferredExitStationId(
          origins,
          extractFacilityMapCodes(maintenanceBody, 'carWash'),
        )
        ?? (entryStations[0] ?? null),
      alignRotationToExitStation: false,
      allowEntryService: true,
      entryServiceExitStationIds: entryStations,
    };
  }

  if (taskType === 'servicing') {
    // 保養設施（例 M1–M4）→ 拓樸出場站（例 T3上行）；開輪必須對齊該站起點路線（TN），
    // 不可因「進場載客另有管道」就強制 phase 0（NT／N2W）——車還在場內。
    const entryStations = resolveYardExitStationIdsForSection(
      origins,
      maintenanceBody,
      'maintenance',
    );
    return {
      rotationExitStationId:
        // 只看 maintenance（M 系）。洗車已是獨立的 washing 類型，
        // 兩者一對一，不再聯集。
        resolvePreferredExitStationId(
          origins,
          extractFacilityMapCodes(maintenanceBody, 'maintenance'),
        )
        ?? (entryStations.length === 1 ? entryStations[0]! : null)
        ?? (entryStations[0] ?? null),
      // 保養同行檢：靠外掛班次送到首發站，輪不改結構
      alignRotationToExitStation: false,
      allowEntryService: true,
      entryServiceExitStationIds: entryStations,
    };
  }

  return EMPTY_POLICY;
}

/**
 * 建立「任務類型 → 出場站」對照。
 *
 * <code>purpose</code> 決定要不要把「靠外掛班次送到首發站」的類型包含進來：
 *
 * - <strong>'align'</strong>（掛車／路線指派用）：只含
 *   {@link YardPostTaskPolicy.alignRotationToExitStation} 為 true 的類型
 *   （充電／待命）。保養／行檢不含——它們的車會由外掛的調度營運班次送到首發站，
 *   <strong>輪仍從首發站起算，不可被出場站改寫相位</strong>。
 * - <strong>'validate'</strong>（驗證車在不在該站用）：含全部有出場站的類型。
 *   驗證要問的是「車實際停在哪」，跟輪的相位無關。
 */
/**
 * 「這一種整備做完，車<strong>可能</strong>停在哪幾站」。
 *
 * 保養涵蓋保養設施（M 系→T3上行）與洗車（W1→N2W），兩者都算 servicing，
 * 光看班次卡分不出這一趟是哪一種，所以可能的出場站不只一個。
 * 驗證「車在不在起點站」時必須接受<strong>全部</strong>可能，
 * 只拿偏好的那一個去比對會把合法班次誤判成錯誤（2026-08-08）。
 */
export function buildYardExitStationOptionsByTaskType(args: {
  origins: MaintenanceFirstTripOrigin[];
  maintenanceBody: Record<string, unknown> | null | undefined;
}): Partial<Record<TaskTypeKey, string[]>> {
  const map: Partial<Record<TaskTypeKey, string[]>> = {};
  for (const taskType of [
    'inspection',
    'charging',
    'standby',
    'servicing',
    'washing',
  ] as const) {
    const policy = resolveYardPostTaskPolicy({
      taskType,
      origins: args.origins,
      maintenanceBody: args.maintenanceBody,
    });
    const options = new Set(policy.entryServiceExitStationIds);
    if (policy.rotationExitStationId) options.add(policy.rotationExitStationId);
    if (options.size > 0) map[taskType] = [...options];
  }
  return map;
}

export function buildYardRotationExitByTaskType(args: {
  origins: MaintenanceFirstTripOrigin[];
  maintenanceBody: Record<string, unknown> | null | undefined;
  purpose?: 'align' | 'validate';
}): Partial<Record<TaskTypeKey, string>> {
  const purpose = args.purpose ?? 'align';
  const map: Partial<Record<TaskTypeKey, string>> = {};
  for (const taskType of [
    'inspection',
    'charging',
    'standby',
    'servicing',
    'washing',
  ] as const) {
    const policy = resolveYardPostTaskPolicy({
      taskType,
      origins: args.origins,
      maintenanceBody: args.maintenanceBody,
    });
    if (!policy.rotationExitStationId) continue;
    if (purpose === 'align' && !policy.alignRotationToExitStation) continue;
    map[taskType] = policy.rotationExitStationId;
  }
  return map;
}
