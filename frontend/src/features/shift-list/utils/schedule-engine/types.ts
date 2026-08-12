import type { ScheduleEngineTaskType, ScheduleTask } from '../../../time-templates/types/editor';
import type {
  ShiftScheduleSelectedRoute,
  ShiftScheduleStationDwell,
} from '../../types/create';
import type { RouteSuccessorPolicy } from './routeSuccessorPolicy';

export type ScheduleBlockSource =
  | 'template_bar'
  | 'transition'
  | 'dispatch'
  /** 進場載客：保養尾端長出、載客開往真正首班起點站的短交路（不算輪替，計入運能） */
  | 'entry_service'
  /**
   * 站位讓渡：車跑完一輪，在共用站位空等下一個班距脈衝時會撞到別列車，
   * 改讓它沿關聯圖次要邊先開去別站等，時間到了再回來接原本排定的下一段
   * （不算輪替，計入運能；見文件 §8.2）。
   */
  | 'relief_loop'
  /**
   * 出場移動：整備做完後，車還停在整備設施裡（例 M2），
   * 這一段把它從設施開到該設施在拓樸上連到的轉乘站（例 T3上行）。
   * 時長取拓樸上該「設施 → 站」邊的空駛秒數，不需要另外規劃路徑。
   *
   * 排法是<strong>往前貼</strong>：結束時刻貼齊後面那一段的發車時刻（零秒緩衝），
   * 由此往前推出開始時刻——不是整備一做完就開出去，而是要走之前才就位，
   * 免得白白佔著轉乘站的站格。後面那一段（調度營運班次或正線）<strong>時間不動</strong>。
   *
   * 空間不夠時（整備結束到發車之間塞不下這段空駛），
   * 這是<strong>全系統唯一</strong>可以佔用整備尾巴時間的卡。
   */
  | 'yard_exit_move'
  /**
   * 整備入廠卡：車輛確定不能再跑正線時，<strong>提前</strong>開進接下來
   * 預計進入的整備區。卡片結束＝車抵達設施，整備就從那一刻直接開始——
   * 整備<strong>開始時刻提前、結束時刻不動</strong>，所以整備時長變長。
   * 與 MO 剛好對稱：MO 吃整備尾巴，MI 長整備的頭。
   */
  | 'yard_entry_move'
  | 'yard_entry_move';

export type GeneratedScheduleBlock = {
  id: string;
  timelineRow: number;
  taskType: ScheduleEngineTaskType;
  label: string;
  templateTaskId?: string;
  routeId?: string;
  /** 同 routeId 可重複選取時，用來綁定關聯圖節點。舊產物可由 selected routes 唯一反查。 */
  routeInstanceId?: string;
  routeName?: string;
  routeCode?: string;
  /** 模板甘特上的發車錨點（分鐘，自 00:00 起） */
  anchorStartMinute: number;
  plannedStartMinute: number;
  plannedEndMinute: number;
  travelSeconds: number;
  dwellSeconds: number;
  source: ScheduleBlockSource;
  /** 手動製作：此班次卡各站靠站秒數（選定路線後可編輯） */
  stationDwells?: ShiftScheduleStationDwell[];
  /** 手動製作：此班次卡靠站緩衝秒數 */
  dwellSlackSeconds?: number;
  /** 調度班次：首班起點站 stationId */
  firstTripOriginStationId?: string;
  /** 調度班次：首班起點站顯示名 */
  firstTripOriginLabel?: string;
  /** 進場載客：來源整備區段代號（班次代號 = 整備代號 + 路線代號 + 開始時刻） */
  entryServiceSectionCode?: string;
  /** 出場移動：出發的整備設施節點 id（具體到哪一台，例 M2 那一格） */
  yardExitFacilityNodeId?: string;
  /** 出場移動：出發的整備設施顯示名／代號（例 M2） */
  yardExitFacilityLabel?: string;
  /** 出場移動：抵達的轉乘站 stationId */
  yardExitStationId?: string;
  /** 出場移動：抵達的轉乘站顯示名（例 T3上行） */
  yardExitStationLabel?: string;
  /**
   * 轉場卡：來源／目的整備類型自己的代號（使用者在整備任務自訂，1–2 個大寫
   * 英文字母）。卡面代號＝這個代號 + I（入廠）／O（出廠），由
   * {@link resolveMoveCardPrefix} 依 source 動態組成——沒有「MO／MI／PI／PO」
   * 這種寫死的固定四種，代號完全跟著使用者設定走：充電代號 E 就是 EI／EO，
   * 保養代號 M 就是 MI／MO，行檢代號 P 就是 PI／PO。
   */
  yardExitSectionCode?: string;
  /**
   * 轉場卡：來源／目的整備類型的中文名（充電／洗車／保養／行檢／待命／調度），
   * 只給 UI 顯示用（hover 標題），不影響卡面代號或排班邏輯。
   */
  yardExitSectionLabel?: string;
  /** 出場移動：是否吃掉了整備尾巴時間（空間不足時才會發生） */
  yardExitAteYardTail?: boolean;
  /**
   * 整備任務區塊本身（充電／洗車／保養／行檢／待命）：這一段實際停在哪一台
   * 具體設施（例 M2）——由它自己的入廠卡或出廠卡（或轉場卡的對應那一側）
   * 解出來就寫回這裡，讓這張任務卡自己也知道、也能顯示車停在哪。
   * 入廠、出廠是兩個各自獨立算的流程，但兩者指的一定是同一段停留，
   * 所以哪一側先解出來，另一側就要沿用同一台，不能各自獨立再挑一次。
   */
  yardFacilityNodeId?: string;
  /** 整備任務區塊本身：實際停留設施的顯示名／代號（例 M2） */
  yardFacilityLabel?: string;
  /**
   * 整備任務區塊本身：這一段停的如果是<strong>正線停靠站</strong>（只有待命可以），
   * 這裡是該站的 stationId。
   *
   * 車停在停靠站待命就是實實在在把那一格佔住——別台車那段時間進不來，
   * 那條路線也就排不了。所以它必須跟正線一樣進站位佔用表，讓站位求解器看得到、
   * 有機會閃避；只當成「整備任務」放著不管的話，排出來的班表是假的。
   * 停在設施格（充電樁、維修坑）不佔正線站位，這個欄位就不會有值。
   */
  yardFacilityStationId?: string;
  /**
   * 整備任務區塊本身：<strong>整段時間內沒有任何一台該類設施是空的</strong>。
   * 車實際上沒地方停——這不是「移動卡排不出來」（那只是路徑問題），
   * 是產能不足。UI 必須把這件事直接標在卡面上，不能只靠 hover，
   * 否則使用者看到的就只是一張「沒掛設施」的普通整備卡，完全不知道出事。
   */
  yardFacilityUnavailable?: boolean;
  /**
   * 調度營運班次（entry_service）落點診斷（文件 §10.3）——
   * 只在這一段抵達某個站位時實際查得到「該站淨空時刻」才會寫入；
   * 沒有別的車佔著那個站位就不寫（代表這段完全不受站位限制）。
   */
  entryServiceBerthCheck?: {
    /** 這一段抵達的站位 */
    arriveStationId: string;
    /** 該站淨空時刻（分鐘，自 00:00 起） */
    berthClearMinute: number;
    /** 抵達時刻 − 淨空時刻（秒）；正值代表還有餘裕，理論上不應為負 */
    slackSeconds: number;
  };
  /**
   * 調度班次前綴（Yard Dispatch Prefix）：
   * 整備（行檢／充電／待命）出場站 ≠ 首班路線首站時，引擎在整備後第一個正線班次
   * 上寫入此前綴（= 整備代號 + 路線代號，如「ATN」）。
   * 班次代號顯示為 `{yardDispatchPrefix}{HHMM}`（不含列碼）。
   * 僅 taskType=passenger source=template_bar 的班次可能有此欄位。
   */
  yardDispatchPrefix?: string;
  /**
   * 這一趟為了讓只是路過的別列車先通過，往後挪了幾分鐘（見 yieldIdleBlockArrival）。
   * 有值就代表<strong>已經讓過</strong>——收斂迴圈的下一輪不再讓第二次，
   * 否則會跟站位求解互推到迴圈跑滿。
   */
  berthArrivalYieldedMinutes?: number;
};

export type FeasibilityViolationCode =
  | 'MISSING_TEMPLATE_TASKS'
  | 'NO_ROUTE_FOR_TASK_TYPE'
  | 'MISSING_TRAVEL_TIME'
  | 'STATION_LEG_TRAVEL_INCOMPLETE'
  | 'STATION_LEG_TRAVEL_INVALID'
  | 'STATION_TIMING_INFEASIBLE'
  | 'STATION_BERTH_COLLISION'
  /**
   * 整備轉場卡（入廠 MI／出廠 MO／整備間轉場）排不出來：設施未設定、
   * 拓樸沒有可通的邊／路徑，或設施被別列車佔著（警告）。三種轉場共用
   * 同一個模組、同一個代號——見 insertMaintenanceTransferCards.ts。
   */
  | 'MAINTENANCE_TRANSFER_UNRESOLVED'
  /**
   * 整備設施不足：這一段整備的<strong>整段時間內，該類設施沒有任何一台是空的</strong>
   * ——車沒地方停。這跟轉場卡排不出來（路徑問題）是兩回事，處置也不同：
   * 前者要加設施／錯開整備時段，後者是補拓樸的邊（警告）。
   */
  | 'MAINTENANCE_FACILITY_UNAVAILABLE'
  | 'MAINTENANCE_FACILITY_YIELDED'
  /** 本來可以提早進廠，設施被佔只好晚進；代價是車在站位上多等（警告） */
  | 'MAINTENANCE_ENTRY_EARLY_BLOCKED'
  | 'ROUTE_ALIGNED_TO_VEHICLE_LOCATION'
  | 'ROUTE_ORIGIN_AWAY_FROM_VEHICLE'
  | 'GEOMETRY_NOT_CONVERGED'
  /** 後車進站太貼著前車離站，不滿足碰撞保護時間×2（警告） */
  | 'STATION_BERTH_PROTECTION_GAP'
  /** 空等會撞到別列車，但關聯圖上沒有可用的讓渡路線，只能留在原地（警告） */
  | 'STATION_BERTH_RELIEF_UNAVAILABLE'
  /** 滯留車往後挪、讓只是路過的先通過（警告，零代價讓步） */
  | 'STATION_BERTH_ARRIVAL_YIELDED'
  /** 生成期為清站位而延後發車（警告） */
  | 'STATION_BERTH_DELAYED'
  /** 生成期站位約束依拓撲改選路線（警告；代號沿用） */
  | 'STATION_BERTH_BACKUP_USED'
  | 'ANCHOR_CONFLICT'
  | 'TIMELINE_OVERLAP'
  | 'HEADWAY_PHYSICAL_IMPOSSIBLE'
  | 'HEADWAY_BELOW_TARGET'
  | 'UNSERVED_SERVICE_PULSE'
  | 'INSUFFICIENT_TIMELINES'
  | 'RECOVERY_INSUFFICIENT'
  | 'ROUTE_SWITCH_BUFFER_INSUFFICIENT'
  /** 有關聯圖，但 through verification／全優先路徑無法建立可信 successor。 */
  | 'ROUTE_SUCCESSOR_POLICY_INVALID'
  /** 同一車時間線的相鄰正線未依 successor 行駛。 */
  | 'ROUTE_SUCCESSOR_MISMATCH'
  /** 舊班次僅存 routeId，且無法唯一解析 selected route instance。 */
  | 'ROUTE_INSTANCE_AMBIGUOUS'
  /** 前趟終點站與後趟起點站不連續。 */
  | 'ROUTE_STATION_DISCONTINUITY'
  | 'CLOCK_ALIGN_VIOLATION'
  | 'TURNAROUND_LIMIT_EXCEEDED'
  | 'ROUTE_ROTATION_OVER_TURNAROUND'
  /** 時間線上正線未跑完路線群組一整輪（例：只跑下行未跑上行） */
  | 'ROTATION_CYCLE_INCOMPLETE'
  /** 保養／行檢後調度無法接到首班起點站 */
  | 'MAINTENANCE_DISPATCH_UNREACHABLE'
  /** 站位讓渡：已插入次要邊讓車先去別站等，避開共用站位碰撞（資訊性） */
  | 'STATION_BERTH_RELIEF_INSERTED'
  /** 整備結束後的第一段班次，起點站不是該整備設施的出場站——車不在那裡，開不了 */
  | 'YARD_EXIT_STATION_MISMATCH';

/** 策略說明｜演算法極限｜可調整建議（見 feasibilityIssueMeta.ts） */
export type FeasibilityIssueKind = 'policy' | 'limit' | 'actionable';

export type FeasibilityIssue = {
  code: FeasibilityViolationCode;
  severity: 'error' | 'warning';
  message: string;
  detail?: Record<string, unknown>;
  /** 議題分類；缺省時由 code 推導 */
  kind?: FeasibilityIssueKind;
  /** 給使用者的調整建議或極限說明 */
  guidance?: string;
};

export type GeneratedScheduleTimeline = {
  row: number;
  blocks: GeneratedScheduleBlock[];
};

export type GeneratedSchedulePlan = {
  shiftId?: string;
  generatedAt: string;
  scheduleRowCount: number;
  timelines: GeneratedScheduleTimeline[];
  /** 路線指派算法識別碼 */
  routeAssignmentAlgorithm?: string;
  /** 時刻生成算法識別碼（headway 模式） */
  timetableGenerationAlgorithm?: string;
};

export type ShiftScheduleFeasibilityReport = {
  ok: boolean;
  errors: FeasibilityIssue[];
  warnings: FeasibilityIssue[];
};

/** Step 5 手動調整的還原／復原歷史（寫入草稿 scheduleOutput） */
export type PlanAdjustHistoryEntry = {
  plan: GeneratedSchedulePlan;
  feasibilityReport: ShiftScheduleFeasibilityReport;
};

export type GenerateShiftScheduleResult = {
  plan: GeneratedSchedulePlan | null;
  report: ShiftScheduleFeasibilityReport;
};

export type SchedulingContext = {
  shiftId?: string;
  scheduleRowCount: number;
  passengerRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds: number;
  /** Step 4 關聯圖／折返錨點繼任策略 */
  successorPolicy?: RouteSuccessorPolicy;
};

/** 班表產出時綁定的整備任務快照，供管理引擎引用 */
export type ShiftScheduleMaintenanceTaskBinding = {
  taskId: string;
  taskName: string;
  skipped: boolean;
  /** 整備任務完整 body（設施、途經點、觸發條件等） */
  body: Record<string, unknown> | null;
  /** 班表 Step 2 各整備區塊正線優先讓渡餘裕指紋，供新鮮度比對 */
  entrySlackFingerprint?: string;
  /** 班表 Step 2 各整備區塊代號指紋 */
  sectionCodeFingerprint?: string;
  publishStatus?: string;
  usageStatus?: string;
  sourceUpdatedAt?: string;
  boundAt: string;
};

/** 寫入 operation_shifts.body 的班表產出（Step 5 生成、Step 6 確認） */
/** 排班產出儲存版本號：引擎邏輯／代號規則變更時遞增，自動作廢舊版快取 */
export const CURRENT_SHIFT_SCHEDULE_OUTPUT_VERSION = 2;

export type ShiftScheduleStoredOutput = {
  outputVersion: number;
  generatedAt: string;
  plan: GeneratedSchedulePlan | null;
  feasibilityReport: ShiftScheduleFeasibilityReport;
  maintenanceTaskBinding: ShiftScheduleMaintenanceTaskBinding;
  timeTemplateRef: {
    templateId: string;
    templateName: string;
    /** 空時段正線讓渡餘裕（秒），供新鮮度比對與引擎回放 */
    emptyIntervalMainlineSlackSeconds?: number;
  };
  routeGroupsRef: {
    mapId: string;
    selectedRouteIds: string[];
    /** 恢復時間、靠站緩衝、切換緩衝等參數指紋，供新鮮度比對 */
    paramsFingerprint?: string;
  };
  /** Step 5 還原／復原棧；與 plan 同步寫入草稿 */
  planAdjustHistory?: PlanAdjustHistoryEntry[];
  planAdjustHistoryIndex?: number;
  /**
   * 發布前檢查紀錄。班表可以手動改，所以檢查是<strong>可重跑的動作</strong>，
   * 不是生成時算一次就算數；`planFingerprint` 對不上目前的 plan
   * 就代表檢查後又被改過，狀態回到「未檢查」。詳見 schedulePublishCheck.ts。
   */
  publishCheck?: {
    checkedAt: string;
    planFingerprint: string;
    publishSafe: boolean;
    publishBlockingCount: number;
    publishBlockingByCode: Record<string, number>;
  };
};

export type ResolvedTemplateTask = {
  task: ScheduleTask;
  route: ShiftScheduleSelectedRoute | null;
  occupancySeconds: number;
  travelSeconds: number;
  dwellSeconds: number;
};

export { pushIssue } from './feasibilityIssueMeta';

export function minuteToSecond(minute: number): number {
  return Math.round(minute * 60);
}

export function secondToMinute(second: number): number {
  return second / 60;
}
