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
  /** 對應《排班引擎算法全覽-審核.html》章節錨點，逐則問題頁用來附「詳見 §N」連結 */
  docAnchor: { id: string; label: string } | null;
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
  FACILITY_SLOT_COLLISION: '設施格同時被兩台車佔用',
  FACILITY_HANDOVER_GAP: '設施格交接時間不足',
  STATION_BERTH_PROTECTION_GAP: '碰撞保護時間不足',
  STATION_BERTH_RELIEF_UNAVAILABLE: '沒有可用的讓渡路線',
  STATION_BERTH_ARRIVAL_YIELDED: '滯留車晚一點進站讓路',
  STATION_BERTH_DELAYED: '站位約束延後',
  STATION_BERTH_DELAY_SOURCE: '站位延後成因',
  GEOMETRY_BEST_ROUND_USED: '改用最佳輪次結果',
  GEOMETRY_PASS_REVERTED: '幾何處理被撤回',
  STATION_BERTH_BACKUP_USED: '站位約束改選路線',
  ANCHOR_CONFLICT: '錨點衝突',
  TIMELINE_OVERLAP: '時間線任務重疊',
  HEADWAY_PHYSICAL_IMPOSSIBLE: '班距低於物理下限',
  HEADWAY_BELOW_TARGET: '班距低於目標',
  HEADWAY_PHASE_EVENED: '已把發車相位推回等間隔',
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
  STATION_BERTH_RELIEF_INSERTED: '站位讓渡（次要邊）',
  YARD_EXIT_STATION_MISMATCH: '整備出場站接不上',
  MAINTENANCE_TRANSFER_UNRESOLVED: '整備轉場卡排不出來',
  MAINTENANCE_TRANSFER_REQUIRED_MISSING: '必要的整備轉場排不出來，車到不了下一段',
  VEHICLE_LOCATION_DISCONTINUITY: '車的位置接不起來（缺移動）',
  MOVE_JUNCTION_CONFLICT: '移動卡在同一個轉折點貼太近',
  MAINTENANCE_FACILITY_UNAVAILABLE: '整備設施不足，車沒地方停',
  MAINTENANCE_FACILITY_YIELDED: '已請別列車換設施讓位',
  MAINTENANCE_ENTRY_EARLY_BLOCKED: '提早進廠被擋，車在站位上多等',
  ROUTE_ALIGNED_TO_VEHICLE_LOCATION: '已改派路線，配合車輛實際停放位置',
  ROUTE_ALIGNED_TO_MAINTENANCE_ENTRY: '已改派路線，讓車開到進得了廠的那一站',
  ROUTE_ORIGIN_AWAY_FROM_VEHICLE: '出廠卡要空跑一段（車不在下一班的起點）',
  GEOMETRY_NOT_CONVERGED: '幾何後處理未收斂'
};

/** 全部 31 個代號（型別 exhaustive 檢查來源）；供文件覆蓋率測試核對 §13。 */
export const ALL_FEASIBILITY_VIOLATION_CODES: FeasibilityViolationCode[] =
  Object.keys(GROUP_TITLE) as FeasibilityViolationCode[];

const DOC_ANCHOR: Partial<Record<FeasibilityViolationCode, { id: string; label: string }>> = {
  MISSING_TEMPLATE_TASKS: { id: 's3', label: '§3 完整流水線' },
  NO_ROUTE_FOR_TASK_TYPE: { id: 's3', label: '§3 完整流水線' },
  MISSING_TRAVEL_TIME: { id: 's3', label: '§3 完整流水線' },
  STATION_LEG_TRAVEL_INCOMPLETE: { id: 's3', label: '§3 完整流水線' },
  STATION_LEG_TRAVEL_INVALID: { id: 's3', label: '§3 完整流水線' },
  STATION_TIMING_INFEASIBLE: { id: 's9', label: '§9 Expand 與物理占用' },
  ANCHOR_CONFLICT: { id: 's9', label: '§9 Expand 與物理占用' },
  STATION_BERTH_COLLISION: { id: 's8', label: '§8 站位約束決策' },
  FACILITY_SLOT_COLLISION: { id: 's6', label: '§6 整備與設施佔用' },
  FACILITY_HANDOVER_GAP: { id: 's6', label: '§6 整備與設施佔用' },
  STATION_BERTH_PROTECTION_GAP: { id: 's8', label: '§8 站位約束決策' },
  STATION_BERTH_RELIEF_UNAVAILABLE: { id: 's8', label: '§8.2 站位讓渡' },
  STATION_BERTH_ARRIVAL_YIELDED: { id: 's8', label: '§8 站位約束決策' },
  STATION_BERTH_DELAYED: { id: 's8', label: '§8 站位約束決策' },
  STATION_BERTH_DELAY_SOURCE: { id: 's8', label: '§8 站位約束決策' },
  GEOMETRY_BEST_ROUND_USED: { id: 's3', label: '§3 幾何後處理收斂迴圈' },
  GEOMETRY_PASS_REVERTED: { id: 's3', label: '§3 幾何後處理收斂迴圈' },
  STATION_BERTH_BACKUP_USED: { id: 's8', label: '§8 站位約束決策' },
  TIMELINE_OVERLAP: { id: 's6', label: '§6 整備讓渡：開頭 vs 尾巴' },
  HEADWAY_PHYSICAL_IMPOSSIBLE: { id: 's5', label: '§5 掛車決策（脈衝）' },
  HEADWAY_BELOW_TARGET: { id: 's5', label: '§5 掛車決策（脈衝）' },
  HEADWAY_PHASE_EVENED: { id: 's5', label: '§5 掛車決策（脈衝）' },
  UNSERVED_SERVICE_PULSE: { id: 's5', label: '§5 掛車決策（脈衝）' },
  INSUFFICIENT_TIMELINES: { id: 's14', label: '§14 端到端範例（車隊下限）' },
  RECOVERY_INSUFFICIENT: { id: 's1', label: '§1 核心原則（S1–S4 閘門）' },
  ROUTE_SWITCH_BUFFER_INSUFFICIENT: { id: 's1', label: '§1 核心原則（S1–S4 閘門）' },
  CLOCK_ALIGN_VIOLATION: { id: 's1', label: '§1 核心原則（S1–S4 閘門）' },
  ROUTE_SUCCESSOR_POLICY_INVALID: { id: 's7', label: '§7 關聯圖：一台車跑完這條接哪條' },
  ROUTE_SUCCESSOR_MISMATCH: { id: 's7', label: '§7 關聯圖：一台車跑完這條接哪條' },
  ROUTE_INSTANCE_AMBIGUOUS: { id: 's7', label: '§7 關聯圖：一台車跑完這條接哪條' },
  ROUTE_STATION_DISCONTINUITY: { id: 's7', label: '§7 關聯圖：一台車跑完這條接哪條' },
  TURNAROUND_LIMIT_EXCEEDED: { id: 's3', label: '§3 完整流水線' },
  ROUTE_ROTATION_OVER_TURNAROUND: { id: 's3', label: '§3 完整流水線' },
  ROTATION_CYCLE_INCOMPLETE: { id: 's1', label: '§1 核心原則（服從順序）' },
  MAINTENANCE_DISPATCH_UNREACHABLE: { id: 's10', label: '§10 進場載客' },
  STATION_BERTH_RELIEF_INSERTED: { id: 's8', label: '§8 站位約束決策' },
  YARD_EXIT_STATION_MISMATCH: { id: 's10', label: '§10 整備後的調度營運班次' },
  MAINTENANCE_TRANSFER_UNRESOLVED: { id: 's10', label: '§10 整備後的調度營運班次' },
  MAINTENANCE_TRANSFER_REQUIRED_MISSING: { id: 's10', label: '§10.5 整備轉場小卡' },
  VEHICLE_LOCATION_DISCONTINUITY: { id: 's10', label: '§10.5 整備轉場小卡' },
  MOVE_JUNCTION_CONFLICT: { id: 's10', label: '§10.5 整備轉場小卡' },
  MAINTENANCE_FACILITY_UNAVAILABLE: { id: 's10', label: '§10.5 整備轉場小卡' },
  MAINTENANCE_FACILITY_YIELDED: { id: 's10', label: '§10.5 整備轉場小卡' },
  MAINTENANCE_ENTRY_EARLY_BLOCKED: { id: 's10', label: '§10.5 整備轉場小卡' },
  ROUTE_ALIGNED_TO_VEHICLE_LOCATION: { id: 's7', label: '§7 路線關聯圖' },
  ROUTE_ALIGNED_TO_MAINTENANCE_ENTRY: { id: 's10', label: '§10.5 整備轉場小卡' },
  ROUTE_ORIGIN_AWAY_FROM_VEHICLE: { id: 's7', label: '§7 路線關聯圖' },
  GEOMETRY_NOT_CONVERGED: { id: 's3', label: '§3 流水線' },
};

const DEFAULT_META: Record<FeasibilityViolationCode, Omit<FeasibilityIssueMeta, 'kindLabel' | 'groupTitle' | 'docAnchor'>> = {
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
  FACILITY_SLOT_COLLISION: {
    kind: 'limit',
    guidance:
      '同一個設施格在同一時刻只能停一台車。這一則以「車實際還在裡面」為準——整備做完到出場移動開始之間，車仍佔著那一格（時間軸上就是那張「暫停」卡）。先前設施佔用只記 [整備開始, 整備結束]，那段帳上是空的，所以兩台車同格量不出來；補上暫停卡之後才現形。要消掉它：讓前一台早一點開走（出場移動可以提前），或把後一台改排到別的格子。',
  },
  FACILITY_HANDOVER_GAP: {
    kind: 'limit',
    guidance:
      '兩台車在同一個設施格交接時，中間至少要隔「2 × 碰撞保護時間」——與站位同一套規則，留給兩台車移動的差異緩衝。前一台還沒完全開出來，後一台就不能開進去。要消掉它：讓前一台早一點開走，或把後一台的進場時刻往後挪。',
  },
  STATION_BERTH_COLLISION: {
    kind: 'limit',
    guidance:
      '生成時已嘗試「延後發車／改派備用」仍無法清開同一停靠點的到站～離站重疊。請加時間線、縮短靠站、或手動改備援點。這不是班距警告。',
  },
  STATION_BERTH_PROTECTION_GAP: {
    kind: 'actionable',
    guidance:
      '規則是「後車到站 ≥ 前車實際離站 + 2 × 碰撞保護時間」——站位在「前車離站 + 1 倍」就空了，後車還要花同樣的時間才能開進來，所以是兩倍。前車若因調度滯留在站上，以真正開走的時刻起算。訊息會直接告訴你「同時最多有幾台車停在這個停靠點」：只要超過 1 台，就代表該時段的車比班距需要的多，多出來的車跑完一輪沒有下一個脈衝可接，只好停在原地等，於是全擠在同一個停靠點。這不是把兩班拉開就能解的——要減少該時段的時間線列數、把多餘的車安排進整備／待命，或讓它們改停別的站位（關聯圖上要有終點在別站的備用路線）。',
  },
  STATION_BERTH_ARRIVAL_YIELDED: {
    kind: 'policy',
    guidance:
      '一台車跑完一趟停在站上等下一趟，這段空等會擋住只是路過的別列車。既有機制只會延後後車；這裡改成讓滯留的那台晚一點進站——它反正要在站上空等，晚幾分鐘到沒有損失，下一趟的發車時刻與班距完全不變。屬正常求解，不是錯誤。',
  },
  STATION_BERTH_RELIEF_UNAVAILABLE: {
    kind: 'limit',
    guidance:
      '車跑完一輪、在終點站空等下一個脈衝時會擋到別列車。引擎已經試過讓它先開去別站等再回來，但關聯圖上沒有「從這裡出發、又回得來」的路線可用，只能留在原地。這不是漏掉沒處理，是沒有可用的替代動線。要消掉它：減少該時段同時在線的車、把多餘的車安排進整備／待命，或讓其中一台改停別的站位。',
  },
  STATION_BERTH_DELAYED: {
    kind: 'policy',
    guidance:
      '站位占用約束把後車整趟延後（10 秒格），讓前車離站後再進站。屬正常求解，不是錯誤。',
  },
  GEOMETRY_PASS_REVERTED: {
    // 過程紀錄：某道處理被安全閘拒絕，不是場域容量極限
    kind: 'policy',
    guidance:
      '幾何後處理的每一道跑完都會用同一把全域尺打分（不碰撞 > 班距 > 班次穩定），讓整張班表變差的就整道撤回，連同它寫進報告的訊息一起收回。所以這一則不代表班表有問題——那些動作等於沒發生。它的用途是指出哪一道處理的策略與其他處理衝突：撤回次數高的那幾道應該回頭檢討它到底想解什麼問題，而不是留著讓它每一輪都做白工。',
  },
  GEOMETRY_BEST_ROUND_USED: {
    kind: 'limit',
    guidance:
      '幾何後處理迴圈裡的十二道處理會互相推翻，跑滿輪數仍未收斂到不動點。引擎已改為在過程中按全域評分（不碰撞 > 班距 > 班次穩定）留下最好的一版，並用它作為結果，所以輸出不會比過程中最好的那一輪差。看到這一則代表班表可用但還不是穩定解——同樣的輸入稍微變動，結果可能明顯不同。要根治要讓那些處理不再互相推翻，不是調輪數上限。',
  },
  STATION_BERTH_DELAY_SOURCE: {
    kind: 'actionable',
    guidance:
      '這一則講的是「誰把別人推晚的」。站位求解在幾何收斂迴圈裡每一輪都會延後班次，但過去只有第一輪的延後會被回報，後面幾輪完全看不到——實測有單筆班次被往後推了 520 秒卻在報告上查不到任何紀錄。現在把整個迴圈的延後累計起來，依「擋路的那一張卡」歸戶：某一台車佔著某一站不走，累計害多少班次、被推遲多少秒。要消掉它：處理被指名的那一張卡（讓它離開站位、改路線、或改時刻），而不是去調延後上限。',
  },
  STATION_BERTH_BACKUP_USED: {
    kind: 'policy',
    guidance:
      '這一趟原本要跑的路線會跟別台車搶同一個停靠點，所以改跑關聯圖上另一條接得起來的路線。改完之後這台車就停在新路線的終點站，再從那裡接下一趟（可以在站上等）。這不是「整組換成備用路線」，只是這一趟改走別條。屬正常求解，不是錯誤。',
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
  HEADWAY_PHASE_EVENED: {
    kind: 'policy',
    guidance:
      '站位求解為了清開停靠點會把個別班次往後延，每延一次同一條路線的發車相位就歪一次，班距因此忽大忽小、運能曲線出現低谷。這一步把每一班往「與前後班等間隔」的位置靠（一次走一半，數輪收斂），只在該列自己的空檔內微調，而且移動之前已經逐站確認過不會造成碰撞——挪過去會撞的那些整筆放棄、完全不動。不新增也不刪除任何班次。屬正常求解，不是錯誤。',
  },
  HEADWAY_BELOW_TARGET: {
    kind: 'limit',
    guidance:
      '跨時段班距下限刻意取「兩班時段較嚴者」，不是誤判。此對班多半來自補完回程、掛車延後或多車擠班，而非乾淨脈衝。可試：增加列數、略降恢復／換線、拉長整備讓渡；或接受該方向略過部分脈衝。',
  },
  UNSERVED_SERVICE_PULSE: {
    kind: 'limit',
    guidance:
      '此班距脈衝在一般與補掛輪都找不到能及時出發的車，實際 PPHPD 會下降（警告，非硬錯誤）。請檢查可用車視窗、整備錯開、待命可派、交路週期，或增加時間線列數。',
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
  YARD_EXIT_STATION_MISMATCH: {
    kind: 'actionable',
    guidance:
      '車做完整備之後就停在該設施的出場站，下一趟一定要從那一站發車。這則代表排出來的班次起點站不是那裡——車根本不在，開不了。多半是整備任務沒設定該區段的設施、或設施在路網拓樸上找不到對應停靠點，請回 Step 2 補齊；也可能是關聯圖上從出場站沒有可接的路線。',
  },
  MAINTENANCE_FACILITY_UNAVAILABLE: {
    kind: 'limit',
    guidance:
      '那段時間該類設施一台都不空，車沒地方停。這是產能問題，不是路徑問題。加設施、把同時段的整備錯開、或減少該時段整備的車數。設施數顯示 0 代表這一類根本沒設定設施。',
  },
  MAINTENANCE_ENTRY_EARLY_BLOCKED: {
    kind: 'limit',
    guidance:
      '車在正線跑完、沒地方去時可以提早進整備區——但提早是選配，不能排擠準時進廠的車，所以只能用那一格本來就沒人要的時間。這則代表提早被擋下了：車因此得在正線站位上多等，那段時間它佔著停靠點，可能連帶造成站位碰撞或碰撞保護不足。要消掉它：加該類設施、把同時段的整備錯開，或讓這台車改停別的站位。',
  },
  MAINTENANCE_FACILITY_YIELDED: {
    kind: 'policy',
    guidance:
      '這一段整備原本沒地方停。求解器發現擋路的那台車自己也停得下別台設施，就請它換過去、把位子讓出來——兩邊的時間都沒有動，只是換了格子，所以沒有代價。會看到某一列的整備跑到跟平常不同的設施上，那是這個機制造成的，不是排錯。',
  },
  GEOMETRY_NOT_CONVERGED: {
    kind: 'limit',
    guidance:
      '站位求解、讓渡、班距修復這幾道會互相影響，所以跑到版面不再變動為止。跑滿上限仍在變，代表還沒到不動點——下面的站位與班距問題有一部分可能只是還沒處理完，不一定是設定有問題。先看有沒有能減少互相干擾的地方（車太多、整備全擠在同一時段），再考慮改設定。',
  },
  ROUTE_ALIGNED_TO_MAINTENANCE_ENTRY: {
    kind: 'policy',
    guidance:
      '車跑完最後一趟正線要進廠，但它停的那一站在路網拓樸上到不了任何一台設施，入廠卡就排不出來。這裡把那一趟改成同起點、但終點在「進得了廠」那一站的路線。一般換線不准動終點（下一趟起點會跟著歪），但這一趟的下一段是整備——出廠時的起點站由設施的出場站決定，跟這一趟的終點無關，所以換得安全。屬正常求解，不是錯誤。',
  },
  ROUTE_ORIGIN_AWAY_FROM_VEHICLE: {
    kind: 'actionable',
    guidance:
      '出廠卡會把車從整備位置開到下一班的起點——這是正常機制，不是錯誤。這則只是把代價講出來（空跑多久、途經哪些點）讓你判斷值不值得。想省掉的話，方向是讓車一開始就停得離下一班起點更近，而不是硬補一條路線。',
  },
  ROUTE_ALIGNED_TO_VEHICLE_LOCATION: {
    kind: 'policy',
    guidance:
      '車停的位置跟原本指派的路線起點不同，已改成同終點、從車所在位置出發的那一條，省掉一段空跑。終點與發車時刻都不動，交路後面不受影響。這是最佳化結果不是問題；不想讓某條路線被這樣用，把它從關聯圖的後繼拿掉。',
  },
  MAINTENANCE_TRANSFER_UNRESOLVED: {
    // 只剩「不需要轉場卡」這一種；必要轉場失敗改走 MAINTENANCE_TRANSFER_REQUIRED_MISSING（硬錯誤）
    kind: 'policy',
    guidance:
      '轉場卡三種：入廠、出廠、整備間轉場。代號跟著該段整備的區段代號走（充電 E → EI／EO，行檢 P → PI／PO）。這一則是「不需要」：訊息會寫出依據——車從哪一格開始、下一段接的是什麼（同一格續留，或由整備間轉場負責）。通常是刻意保留的備援車，確認模板排班是不是故意的就好。',
  },
  MAINTENANCE_TRANSFER_REQUIRED_MISSING: {
    kind: 'limit',
    guidance:
      '車下一段要去的地方跟它現在停的地方不同，引擎試過所有候選（設施、路徑、轉折點錯開、可動時段內的出發時刻）仍排不出合法移動。班表與班次保留供檢查，但這一則會擋發布——車實際上到不了。原因訊息寫著卡在哪：路徑被別列車在同一個轉折點卡住，就看那一刻前後誰能讓；時段不夠，就要一起調整前後班次，不是只移動轉場卡。',
  },
  VEHICLE_LOCATION_DISCONTINUITY: {
    kind: 'limit',
    guidance:
      '這是對班表本身的連續性檢查（手改過的班表也會重驗）：前一張卡結束時車在某一格或某一站，下一張卡卻要它在另一個地方，中間沒有任何移動卡。補一張移動卡，或把前後兩段改成同一個地點。',
  },
  MOVE_JUNCTION_CONFLICT: {
    kind: 'limit',
    guidance:
      '移動卡是車真的開在路網上：不同列車經過同一個中途節點（例如多座設施共用的入口點）至少要差開 2 × 碰撞保護時間。這一則是對班表本身的檢查，時刻由卡片途經節點沿拓樸行駛秒數推算。要消掉它：讓其中一張移動卡早一點或晚一點出發，或改走不經過同一點的路徑。',
  },
  STATION_BERTH_RELIEF_INSERTED: {
    kind: 'policy',
    guidance:
      '車跑完一輪、在共用站位空等下一個脈衝時會撞到別列車，已自動沿關聯圖次要邊插入一段讓它先去別站等，時間到了再回來接原排定的下一段。屬正常求解，不是錯誤；若不想要這種讓渡，可在關聯圖移除該次要邊。',
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
    docAnchor: DOC_ANCHOR[issue.code] ?? null,
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
