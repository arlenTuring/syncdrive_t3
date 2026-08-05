/**
 * 可行性議題分類：讓 Step 6 警告／錯誤不再只像「判決」，
 * 而能區分策略說明、演算法極限、使用者可調項。
 */

import type { FeasibilityIssue, FeasibilityViolationCode } from './types';

/** 策略說明｜演算法極限｜可調整建議 */
export type FeasibilityIssueKind = 'policy' | 'limit' | 'actionable';

export type FeasibilityIssueMeta = {
  kind: FeasibilityIssueKind;
  /** 給使用者的下一步／極限說明 */
  guidance: string;
  kindLabel: string;
  /** 同類型摺疊群組標題 */
  groupTitle: string;
};

const KIND_LABEL: Record<FeasibilityIssueKind, string> = {
  policy: '策略說明',
  limit: '演算法極限',
  actionable: '可調整',
};

const GROUP_TITLE: Record<FeasibilityViolationCode, string> = {
  MISSING_TEMPLATE_TASKS: '缺少可排班任務',
  NO_ROUTE_FOR_TASK_TYPE: '任務無可用路線',
  MISSING_TRAVEL_TIME: '缺少行駛／停靠時間',
  STATION_LEG_TRAVEL_INCOMPLETE: '站間 leg 不完整',
  STATION_LEG_TRAVEL_INVALID: '站間 leg 無效',
  STATION_TIMING_INFEASIBLE: '逐站時刻超出班次卡',
  STATION_BERTH_COLLISION: '停靠點站位碰撞',
  STATION_BERTH_DELAYED: '站位約束延後',
  STATION_BERTH_BACKUP_USED: '站位約束改派備用',
  ANCHOR_CONFLICT: '錨點衝突',
  TIMELINE_OVERLAP: '時間線任務重疊',
  HEADWAY_PHYSICAL_IMPOSSIBLE: '班距低於物理下限',
  HEADWAY_BELOW_TARGET: '班距低於目標',
  UNSERVED_SERVICE_PULSE: '班距需求未被承接',
  INSUFFICIENT_TIMELINES: '時間線列數不足',
  RECOVERY_INSUFFICIENT: '恢復空檔不足',
  ROUTE_SWITCH_BUFFER_INSUFFICIENT: '換線空檔不足',
  ROUTE_SUCCESSOR_POLICY_INVALID: '路線繼任策略無效',
  ROUTE_SUCCESSOR_MISMATCH: '相鄰路線不符繼任關係',
  ROUTE_INSTANCE_AMBIGUOUS: '路線實例無法辨識',
  ROUTE_STATION_DISCONTINUITY: '相鄰停靠點不連續',
  CLOCK_ALIGN_VIOLATION: '未對齊 10 秒格',
  TURNAROUND_LIMIT_EXCEEDED: '單線超過折返時限',
  ROUTE_ROTATION_OVER_TURNAROUND: '路線組合超過折返時限',
  ROTATION_CYCLE_INCOMPLETE: '未跑完一整輪',
  MAINTENANCE_DISPATCH_UNREACHABLE: '略過進場載客',
};

const DEFAULT_META: Record<FeasibilityViolationCode, Omit<FeasibilityIssueMeta, 'kindLabel' | 'groupTitle'>> = {
  MISSING_TEMPLATE_TASKS: {
    kind: 'actionable',
    guidance: '請回到 Step 3 確認時間模板有正線視窗與有效班距，或檢查模板是否載入成功。',
  },
  NO_ROUTE_FOR_TASK_TYPE: {
    kind: 'actionable',
    guidance: '請回到 Step 4 為正線任務配置可用路線，並確認執行順序完整。',
  },
  MISSING_TRAVEL_TIME: {
    kind: 'actionable',
    guidance: '請在 Step 4 補齊該路線的行駛時間或站間 leg，並確認停靠秒數完整。',
  },
  STATION_LEG_TRAVEL_INCOMPLETE: {
    kind: 'actionable',
    guidance: '站間 leg 不完整時引擎會退回整線 avg／min；建議回地圖／路線群組補齊 leg 以提高精度。',
  },
  STATION_LEG_TRAVEL_INVALID: {
    kind: 'actionable',
    guidance: '請修正無效的站間 leg（負值或缺欄），再重新生成。',
  },
  STATION_TIMING_INFEASIBLE: {
    kind: 'actionable',
    guidance:
      '班次卡秒數不足以容納完整停靠、最快站間行駛與 10 秒到站對齊。請延長該趟、修正 leg／停靠秒數，或重新生成。',
  },
  STATION_BERTH_COLLISION: {
    kind: 'limit',
    guidance:
      '生成時已嘗試「延後發車／改派備用」仍無法清開同一停靠點的到站～離站重疊。請加時間線、縮短靠站、或手動改備援點。這不是班距警告。',
  },
  STATION_BERTH_DELAYED: {
    kind: 'policy',
    guidance:
      '站位占用約束把後車整趟延後（10 秒格），讓前車離站後再進站。屬正常求解，不是錯誤。',
  },
  STATION_BERTH_BACKUP_USED: {
    kind: 'policy',
    guidance:
      '站位超限時，僅在關聯圖繼任成立下成對改派備用槽（TN→TNB 且圖上下一主線→其備用）。不會留下 TN 再接 NTB。',
  },
  ANCHOR_CONFLICT: {
    kind: 'limit',
    guidance:
      '同車無法在下一錨點前結束本趟。可試：加時間線列數、縮短停靠／恢復、或放寬該正線視窗。',
  },
  TIMELINE_OVERLAP: {
    kind: 'actionable',
    guidance: '請調整重疊的兩張班次卡，或刪除／移動其中一張後再驗證。',
  },
  HEADWAY_PHYSICAL_IMPOSSIBLE: {
    kind: 'actionable',
    guidance:
      '以目前車隊列數與單車週期，物理上撐不起此時距。請增加時間線列數，或縮短該路線占用（行駛／停靠）。',
  },
  HEADWAY_BELOW_TARGET: {
    kind: 'limit',
    guidance:
      '跨時段班距下限刻意取「兩班時段較嚴者」，不是誤判。此對班多半來自補完回程、掛車延後或多車擠班，而非乾淨脈衝。可試：增加列數、略降恢復／換線、拉長整備讓渡；或接受該方向略過部分脈衝。',
  },
  UNSERVED_SERVICE_PULSE: {
    kind: 'limit',
    guidance:
      '此班距脈衝沒有任何可用車能在下一脈衝前承接，實際 PPHPD 會下降（警告，非硬錯誤）。請檢查可用車視窗、整備錯開、機動可派或交路週期。',
  },
  INSUFFICIENT_TIMELINES: {
    kind: 'actionable',
    guidance: '目標班距所需車數高於目前列數。請在時間模板提高 scheduleRowCount，或放寬尖峰班距。',
  },
  RECOVERY_INSUFFICIENT: {
    kind: 'actionable',
    guidance: '請加大兩班空檔、略降 Step 4 最低恢復時間，或調整相鄰班次時刻後再驗證。',
  },
  ROUTE_SWITCH_BUFFER_INSUFFICIENT: {
    kind: 'actionable',
    guidance: '換線空檔＝恢復＋換線緩衝。請加大空檔，或調降前一路線的換線緩衝／恢復時間。',
  },
  ROUTE_SUCCESSOR_POLICY_INVALID: {
    kind: 'actionable',
    guidance: '關聯圖存在但導通驗證已失效或沒有全優先路徑。請回 Step 4 重新驗證並鎖定導通組合。',
  },
  ROUTE_SUCCESSOR_MISMATCH: {
    kind: 'actionable',
    guidance: '請依 Step 4 關聯圖指定的 successor 重排相鄰班次；不可用 executionOrder 取代圖關係。',
  },
  ROUTE_INSTANCE_AMBIGUOUS: {
    kind: 'actionable',
    guidance: '同一路線被選取多次。請重新生成以寫入 routeInstanceId，或移除重複且無法辨識的路線實例。',
  },
  ROUTE_STATION_DISCONTINUITY: {
    kind: 'actionable',
    guidance: '前一趟終點站必須等於下一趟起點站。請修正 successor 關係或路線停靠點。',
  },
  CLOCK_ALIGN_VIOLATION: {
    kind: 'actionable',
    guidance: '發車與占用須落在 10 秒格。請將時刻對齊 10 秒倍數後再存。',
  },
  TURNAROUND_LIMIT_EXCEEDED: {
    kind: 'actionable',
    guidance: '單路線最快一圈已超折返時限。請縮短該線停靠／行駛，或放寬時間模板的折返時限。',
  },
  ROUTE_ROTATION_OVER_TURNAROUND: {
    kind: 'limit',
    guidance:
      '鎖定全優先組合的最快一輪超過折返時限。請回 Step 4 調整該組合的占用／換線／恢復，或放寬折返時限；若營運可接受可僅作警示繼續微調。',
  },
  ROTATION_CYCLE_INCOMPLETE: {
    kind: 'limit',
    guidance:
      '引擎寧願撤未成輪去程，也不硬塞違規回程。可試：加大整備切入餘裕、加列數、略降恢復／換線，或放寬該時段班距。',
  },
  MAINTENANCE_DISPATCH_UNREACHABLE: {
    kind: 'policy',
    guidance:
      '時間不夠或不追班時才會接；接不上就略過，交給後面的車。要強制接上可加長保養尾巴或拉開前班間距。',
  },
};

export function resolveFeasibilityIssueKind(
  code: FeasibilityViolationCode,
): FeasibilityIssueKind {
  return DEFAULT_META[code]?.kind ?? 'actionable';
}

export function resolveFeasibilityIssueMeta(
  issue: Pick<FeasibilityIssue, 'code' | 'kind' | 'guidance'>,
): FeasibilityIssueMeta {
  const defaults = DEFAULT_META[issue.code] ?? {
    kind: 'actionable' as const,
    guidance: '請檢查相關步驟輸入後重新生成；若仍無解，多半已觸及演算法極限。',
  };
  const kind = issue.kind ?? defaults.kind;
  return {
    kind,
    guidance: issue.guidance?.trim() || defaults.guidance,
    kindLabel: KIND_LABEL[kind],
    groupTitle: GROUP_TITLE[issue.code] ?? issue.code,
  };
}

/** 寫入前補齊 kind／guidance（呼叫端可覆寫） */
export function enrichFeasibilityIssue(issue: FeasibilityIssue): FeasibilityIssue {
  const meta = resolveFeasibilityIssueMeta(issue);
  return {
    ...issue,
    kind: meta.kind,
    guidance: meta.guidance,
  };
}

export function pushIssue(
  bucket: FeasibilityIssue[],
  issue: FeasibilityIssue,
): void {
  bucket.push(enrichFeasibilityIssue(issue));
}
