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
  /**
   * <strong>暫停：卡片做完了，沒有任何指令叫車走，所以它還在原地。</strong>
   *
   * 與 <code>standby</code>（待命）語意不同，不可混用：待命是<strong>指令</strong>
   * ——為了下一趟要去的地方，先開到那裡等；暫停是<strong>沒有指令</strong>——整備卡
   * 或正線卡在卡內把事情做完了，剩下的空隙車就停在那裡，但時間軸上沒有任何東西
   * 記載這件事。
   *
   * <strong>為什麼要把它變成一張卡。</strong>先前這段是靠各偵測器自己推論的：站位
   * 佔用用 <code>actualDepartMinute</code> 把佔用延長到車真正開走，所以站位碰撞抓得
   * 到「賴站擋人」。但那是<strong>某一個偵測器內部的推論</strong>——沒有複製那段推論
   * 的地方就有同樣的盲點。設施佔用就是活生生的例子：它只記
   * <code>[整備開始, 整備結束]</code>，於是「整備做完、還沒開走」的那段帳上是空的，
   * 別台車就把格子訂走了（2026-08-24 使用者查出：列4 充電到 00:00:00、00:01:00 才
   * 開走，列7 卻在 00:01:00 抵達同一格 E3，零間隔交接）。
   *
   * 使用者（2026-08-24）：「當你的機制有辦法補滿所有的時間空隙的時候，就能真正的
   * 去看待任何的碰撞跟移動……這不是一種裝飾，而是你架構上再做最後驗證以及修正所
   * 需要考慮到自己可能會產生演算法缺陷的問題。」把位置在時間軸上補成完整且明示的
   * 事實，任何偵測器都不必再自己推論一次。
   */
  | 'hold';

/**
 * 系統為了解除某筆資源衝突，替這一趟<strong>增加</strong>的靠站緩衝。
 *
 * 只能增加、不改基本停靠秒數，也不寫回原始設定：原始緩衝（路線或單班設定）另外記在
 * {@link baseSlackSeconds}，實際採用＝原始＋系統增加。重新生成一律從原始設定重算，
 * 不會拿上次的結果再往上加。只有正式採用的候選才會寫這個欄位。
 */
export type DwellSlackAdjustment = {
  /** 原始設定緩衝（秒）：單班明確設定就用單班，否則路線設定 */
  baseSlackSeconds: number;
  /** 系統增加量（秒）；實際緩衝＝baseSlackSeconds＋addedSeconds */
  addedSeconds: number;
  /**
   * 系統增加的等待只加在這一站（站序 index，白皮書 GEN-03「在指定站增加」）。2026-09-30 起新產生的
   * 調整都有這個欄位；沒有的是舊紀錄，意思是每個適用站都加 addedSeconds（相容舊班表）。
   */
  stationIndex?: number;
  /** 為了解哪一筆衝突（代號＋資源），給報告與定位用 */
  reason: {
    code: string;
    resourceId: string;
    resourceLabel: string;
    /** 衝突另一方的卡片 */
    counterpartBlockIds: string[];
    message: string;
  };
  /** 受影響的每一站（只有適用緩衝的站） */
  affectedStops: Array<{
    order: number;
    stationId: string;
    stationName: string;
    baseDwellSeconds: number;
    dwellBeforeSeconds: number;
    dwellAfterSeconds: number;
    arrivalBeforeMinute: number;
    departureBeforeMinute: number;
    arrivalAfterMinute: number;
    departureAfterMinute: number;
  }>;
  /** 調整前的班次卡起訖 */
  blockBefore: { startMinute: number; endMinute: number };
};

/** 午夜切開的兩張整備卡合成一張之後，記住它是哪兩張合的 */
export type MidnightJoin = {
  /** 日頭那張卡原本的 id（模板任務的對照、舊問題的指向都靠它） */
  headBlockId: string;
  /** 兩張卡原本的交界（日尾那張原本的結束分鐘；1440 的整數倍） */
  splitMinute: number;
};

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
  /**
   * 這一趟所屬交路的識別／起班時刻／來源時段／班距目標，從 ScheduleTask 原封不動
   * 帶過來（見 ScheduleTask 的欄位說明）——不靠解析 id 猜。非掛車產生的區塊沒有
   * 這些欄位；班距檢查／修復拿得到就優先用，拿不到才退回用當下時刻查時段的舊邏輯。
   */
  cycleChainId?: string;
  cycleOriginSecond?: number;
  cycleOriginIntervalId?: string;
  cycleHeadwayTargetSeconds?: number;
  /**
   * 這一趟承接的是哪一個班距脈衝（見 {@link ServicePulseRecord}）。同一輪展開的每一腿都記同一個。
   * 發布檢查靠它核對「應開的脈衝都有車開」；手動新增的班次沒有這個欄位。
   */
  servicePulseId?: string;
  /** 模板甘特上的發車錨點（分鐘，自 00:00 起） */
  anchorStartMinute: number;
  plannedStartMinute: number;
  plannedEndMinute: number;
  /** 充電模板要求的有效作業秒數，重排時保持原值。 */
  requiredChargingSeconds?: number;
  travelSeconds: number;
  dwellSeconds: number;
  source: ScheduleBlockSource;
  /** 手動製作：此班次卡各站靠站秒數（選定路線後可編輯） */
  stationDwells?: ShiftScheduleStationDwell[];
  /** 手動製作：此班次卡靠站緩衝秒數（明確設定才生效，0 也是設定） */
  dwellSlackSeconds?: number;
  /** 系統增加的靠站緩衝與原因；沒有就是沒調整（見 DwellSlackAdjustment） */
  dwellSlackAdjustment?: DwellSlackAdjustment;
  /**
   * 殘留衝突修復為了解某筆資源衝突，改了這一趟的發車／到站時刻（在合法行駛範圍內，
   * 或整串推移）。記下原本的起訖與原因，報表才能揭露「這一班為什麼跟原本排的不一樣」。
   */
  conflictRetime?: {
    blockBefore: { startMinute: number; endMinute: number };
    description: string;
    reason: DwellSlackAdjustment['reason'];
  };
  /** 調度班次：首班起點站 stationId */
  firstTripOriginStationId?: string;
  /** 調度班次：首班起點站顯示名 */
  firstTripOriginLabel?: string;
  /** 進場載客：來源整備區段代號（班次代號 = 整備代號 + 路線代號 + 開始時刻） */
  entryServiceSectionCode?: string;
  /**
   * 進場載客從路線中途加入（白皮書 DISPATCH-01～03）：加入站 stationId／顯示名。
   * 有值時這一趟只跑加入站之後的站；站序、停靠、站間行駛一律由 routeForJoinedBlock 換成截短那一段。
   */
  entryJoinedAtStationId?: string;
  entryJoinedAtStationName?: string;
  /** 出場移動：出發的整備設施節點 id（具體到哪一台，例 M2 那一格） */
  yardExitFacilityNodeId?: string;
  /** 出場移動：出發的整備設施顯示名／代號（例 M2） */
  yardExitFacilityLabel?: string;
  /** 出場移動：抵達的轉乘站 stationId */
  yardExitStationId?: string;
  /** 出場移動：抵達的轉乘站顯示名（例 T3上行） */
  yardExitStationLabel?: string;
  /**
   * 這張移動卡實際<strong>途經的節點名稱</strong>（含起訖），依行進順序。
   *
   * 移動卡先前只顯示「起點 → 設施」兩端，中間走哪一條看不出來——使用者
   * （2026-08-24）：「我需要你這張卡補足這些移動的節點，他應該要跟正常卡一樣是有
   * 分段的，這樣我才知道你是到 T3上行 還是 T3下行 過去的 H1」。載客卡本來就看得到
   * 停靠序，調度移動沒有理由是黑箱。
   */
  yardMoveViaLabels?: string[];
  /**
   * 跟 yardMoveViaLabels 一一對應的路網節點 id（排班結束時依當時的路網記下）。
   *
   * 檢查、佔用、訂單途經點都用這一份對回路網；名稱只拿來顯示。地圖改名（2026-11-18 充電洗車入口點
   * 改叫 CHG）之後名稱對不到，只存名稱的班表 104 張移動卡被判成缺行駛時間、整份不能發布。
   * 舊班表沒有這個欄位：照舊用名稱對。
   */
  yardMoveViaNodeIds?: string[];
  /**
   * 這張移動卡用哪一種行駛時間排的。沒寫＝均（平均行駛時間）；'min'＝快（最短行駛時間）。
   *
   * 出廠卡緊貼下一班發車，用均排的話經過沿途各點的時刻是固定的，剛好有車就過不去。
   * 均排不進去時改用快：晚一點出發、同一時刻到站，經過中途各點的時刻跟著往後挪。
   * 排卡與所有安全檢查都用這個欄位算經過時刻，兩邊才會一致。
   */
  yardMovePace?: 'min';
  /**
   * 這一班是車上線後的第一班，而且是從這一輪的中途加入：前面有幾段沒有開（
   * 見 roundJoin.ts）。
   *
   * 一輪原本固定從循環起點開始；車停的整備位置離另一個站比較近時，可以直接從那一站加入這一輪，
   * 之後各段時刻不變。沒開的那幾段就是少掉的載客班次，「一輪要跑完」的檢查把它們算進來。
   */
  roundJoinSkippedLegs?: number;
  /**
   * 這張整備卡的位置（yardFacilityNodeId）不要重挑。出入廠排卡時，停設施格的整備原本會依當時的
   * 時刻重新挑位置；呼叫端已經照某個位置安排了前後班次時（例如把從中途加入少開的班次加回來，
   * 前提是車留在它實際停的地方）標上這個，位置就照寫好的用。位置被別台車佔用時照樣由驗證回報。
   */
  yardFacilityPinned?: boolean;
  /**
   * 這張移動卡必須經過的途經點（不含起訖），只在引擎走的<strong>不是唯一最短路</strong>時才有。
   *
   * 訂單原本只給起訖兩點，車端自己規劃路徑；引擎改走替代路線（例如最短路必經的月台被
   * 折返車佔住）、或兩條路一樣快時，車可能開去另一條，排班檢查過的路線跟實際開的不同。
   * 有這一欄時，後端把它寫進訂單 <code>stations[]</code>（role＝intermediate，協議允許
   * 交叉軌道途經點），車端照站序規劃，就會走同一條路。
   * stationId 是協議用的點位識別碼（拓樸節點的 stationId）；offsetSeconds 是從卡片開始
   * 起算的計畫經過秒數（照路段平均行駛時間累加）。
   */
  yardMoveStops?: Array<{ stationId: string; name: string; offsetSeconds: number }>;
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
  /**
   * 整備任務區塊本身：停留設施所屬的場區（分區入口 id）。場區內的格位由車在區內自己
   * 移動，前後兩台車交接同一格只要求不重疊，不另外要求隔兩倍碰撞保護。
   */
  yardZoneId?: string;
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
   * 這張整備卡是午夜切開的兩張合成的（見 mergeMidnightSplitYardCards）：
   * 記住日頭那張原本的 id 與兩張原本的交界。plannedEndMinute 會超過 1440。
   */
  midnightJoin?: MidnightJoin;
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
  /**
   * 這一班的發車時刻已經被「相位均分」推回過一次（見 evenOutRouteHeadwayPhase）。
   * 收斂迴圈的下一輪不再推第二次，否則會跟站位求解互推到迴圈跑滿。
   */
  headwayPhaseEvened?: boolean;
};

export type FeasibilityViolationCode =
  | 'MISSING_TEMPLATE_TASKS'
  | 'NO_ROUTE_FOR_TASK_TYPE'
  | 'MISSING_TRAVEL_TIME'
  | 'STATION_LEG_TRAVEL_INCOMPLETE'
  | 'STATION_LEG_TRAVEL_INVALID'
  | 'STATION_TIMING_INFEASIBLE'
  | 'STATION_BERTH_COLLISION'
  | 'FACILITY_SLOT_COLLISION'
  | 'FACILITY_HANDOVER_GAP'
  /**
   * 整備轉場卡（入廠 MI／出廠 MO／整備間轉場）排不出來：設施未設定、
   * 拓樸沒有可通的邊／路徑，或設施被別列車佔著（警告）。三種轉場共用
   * 同一個模組、同一個代號——見 insertMaintenanceTransferCards.ts。
   */
  | 'MAINTENANCE_TRANSFER_UNRESOLVED'
  /**
   * 必要的整備轉場卡排不出來：車下一段要去的地方跟它現在停的地方不同，卻沒有
   * 合法移動可用（硬錯誤、擋發布）。「不需要轉場卡」的情形仍走
   * MAINTENANCE_TRANSFER_UNRESOLVED（策略說明）。
   */
  | 'MAINTENANCE_TRANSFER_REQUIRED_MISSING'
  /**
   * 車的位置在時間軸上接不起來：前一張卡結束時車在某一格（或某一站），下一張卡
   * 卻要它在另一個地方，中間沒有任何移動卡（硬錯誤、擋發布）。只看班表本身，
   * 手改過的班表重驗證也抓得到。
   */
  | 'VEHICLE_LOCATION_DISCONTINUITY'
  /**
   * 不同列車的移動卡（出入廠、讓站、轉場）經過同一個轉折點的時刻太近，不滿足
   * 2 × 碰撞保護（警告、擋發布）。
   */
  | 'MOVE_JUNCTION_CONFLICT'
  | 'MOVE_PATH_CONFLICT'
  | 'MOVE_PATH_SHIFTED'
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
  /** 車上線時從一輪的中途加入，前面幾段沒有開（警告） */
  | 'ROUND_JOINED_MIDWAY'
  /** 進廠前那一趟改開到進得了廠的那一站（警告） */
  | 'ROUTE_ALIGNED_TO_MAINTENANCE_ENTRY'
  | 'ROUTE_ORIGIN_AWAY_FROM_VEHICLE'
  | 'GEOMETRY_NOT_CONVERGED'
  /** 共用搜尋預算用盡、仍有安全問題：搜尋未完成（不是已證明無解），禁止發布 */
  | 'SCHEDULE_SEARCH_INCOMPLETE'
  /** 系統為了排移動縮短了整備工作時間（晚開始／提早結束），逐筆揭露（警告） */
  | 'MAINTENANCE_WORK_SHORTENED'
  /** 模板上的整備被刪掉，或剩下的工作時間低於最低工作時間（錯誤，禁止發布） */
  | 'MAINTENANCE_WORK_INSUFFICIENT'
  /** 生成前的必要資料不完整（沒選地圖、路網缺、站點或設施找不到、本次必要路段缺時間）：不生成 */
  | 'SCHEDULE_DATA_INCOMPLETE'
  /** 後車進站太貼著前車離站，不滿足碰撞保護時間×2（警告） */
  | 'STATION_BERTH_PROTECTION_GAP'
  | 'STATION_BERTH_DELAY_SOURCE'
  | 'GEOMETRY_BEST_ROUND_USED'
  | 'GEOMETRY_PASS_REVERTED'
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
  /** 已把發車相位推回等間隔，補償站位延後造成的班距歪斜（警告） */
  | 'HEADWAY_PHASE_EVENED'
  | 'UNSERVED_SERVICE_PULSE'
  /** 班表沒有應開服務明細（舊產物或缺資料），無法核對載客服務是否完整：擋發布 */
  | 'SERVICE_DEMAND_UNVERIFIABLE'
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
  /** 整備後插入的調度載客（含從路線中途加入）：從哪裡出來、在哪一站加入、服務哪些站、接哪一班（資訊性，DISPATCH-05） */
  | 'ENTRY_SERVICE_INSERTED'
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
  /**
   * 應開服務明細：時刻表班距展開的每一個脈衝，以及掛車結果（見 {@link ServicePulseRecord}）。
   * 發布檢查用它核對載客服務完整；沒有這份明細（舊產物）就無法核對，不給發布。
   * 非範本模式（沒有班距脈衝）為空陣列。
   */
  servicePulses?: ServicePulseRecord[];
};

/**
 * 一個班距脈衝（應開服務的最小單位）與它的掛車結果。
 *
 * 脈衝由時間模板的時段班距展開（generateDirectionalDeparturesFromHeadway），每個脈衝掛上一台車
 * 後展開成一整輪交路（數趟載客）。<code>assigned</code> 以外的狀態都代表這個脈衝沒有車開。
 */
export type ServicePulseRecord = {
  /** 穩定識別：時段＋目標發車秒，同一份輸入每次產生都一樣 */
  pulseId: string;
  /** 時刻表訂的目標發車時刻（秒，自 00:00 起） */
  departureSecond: number;
  headwaySeconds: number;
  intervalId: string;
  intervalName?: string;
  /** 起班路線（輪替第一條） */
  routeId: string;
  status: ServicePulseStatus;
  /** 沒車開時的原因（各列為何不能接，或整輪為何被退回） */
  reason?: string;
  rowRejections?: Record<string, string>;
  /** 有掛上車時：哪一列、實際起班秒數、展開了幾趟 */
  assignedRow?: number;
  actualStartSecond?: number;
  legCount?: number;
  /** 這一班是由「待命提早結束」的車接的（待命後緊接正線、值勤中的車都開不了） */
  standbyRelease?: boolean;
};

export type ServicePulseStatus =
  /** 有車承接，已展開成載客班次 */
  | 'assigned'
  /** 掛車時出了問題（路線不在執行順序、選上的那一列展不出整輪或會壓進整備）：擋發布 */
  | 'unserved'
  /**
   * 車不夠：至少一列有正線視窗，但每一列都有硬性理由接不了（在整備、延遲超過上限、會吃掉
   * 整備超過讓渡額度、班距太近），放寬補掛、壓縮、讓班距都試過。照使用者規則（2026-11-10）
   * 仍屬未滿足的應開需求；沒有任何一台車被指定過。
   */
  | 'no_vehicle'
  /** 所有列在這個時刻都沒有正線視窗（時間模板沒有安排車） */
  | 'no_service_window';

/**
 * 可跨班表比較的驗收指標。
 *
 * <strong>為什麼需要：問題代號的「原始則數」不能拿來比較兩份班表。</strong>
 * 大部分代號是<strong>事件計數</strong>，會隨班表實際跑多少班次縮放——班次少，
 * 事件自然少。2026-08-16 實測到的教訓：某次改動讓
 * <code>STATION_BERTH_BACKUP_USED</code> 從 69 降到 62（看似改善 10%），
 * 但同一份班表的正線班次也從 988 掉到 892（同樣 -10%）；換算成「每班次」是
 * 6.98% 對 6.95%，<strong>根本沒有改善</strong>，只是跑得比較少。
 * 少跑車永遠能讓事件計數變好看，所以只看則數會系統性地獎勵「砍服務」。
 *
 * 各代號的性質不同，要分開處理：
 * <ul>
 *   <li><code>UNSERVED_SERVICE_PULSE</code>：分母是時刻表訂的脈衝需求，
 *       <strong>不隨班次縮放</strong>，可以直接比——但更好的表達是承接率。</li>
 *   <li><code>HEADWAY_BELOW_TARGET</code>、<code>STATION_BERTH_*</code>：
 *       每班次／每對相鄰班次一則，<strong>必須除以班次數</strong>才有意義。</li>
 * </ul>
 */
export type ScheduleServiceMetrics = {
  /** 實際排出的正線班次數 */
  passengerTripCount: number;
  /** 正線總營運時間（秒）＝各班次佔用加總 */
  passengerOccupancySeconds: number;
  /** 時刻表要求的班距脈衝總數（服務需求分母）；非範本模式為 0 */
  servicePulseDemand: number;
  /** 沒有任何車能承接的脈衝數（＝UNSERVED_SERVICE_PULSE 則數） */
  servicePulseUnserved: number;
  /** 承接率 = (demand - unserved) / demand；demand 為 0 時回 null */
  servicePulseServedRatio: number | null;
  /** 每班次的備用站使用率；班次為 0 時回 null */
  backupBerthPerTrip: number | null;
  /** 每班次的班距低於目標率；班次為 0 時回 null */
  headwayBelowTargetPerTrip: number | null;
  /** 各時間線的班次數（索引 = row） */
  tripsByRow: Record<number, number>;
  /**
   * 班次分佈離散度 =（最多的一列 - 最少的一列）/ 平均。
   * 對應「班次穩定運行」：同樣的總班次，攤平在各列比集中在少數列好。
   */
  tripsByRowSpread: number | null;
};

export type ShiftScheduleFeasibilityReport = {
  ok: boolean;
  errors: FeasibilityIssue[];
  warnings: FeasibilityIssue[];
  /** 可跨班表比較的服務量指標；見 {@link ScheduleServiceMetrics} */
  metrics?: ScheduleServiceMetrics;
  /** 這份班表的搜尋用量：有沒有搜完、花多久、用了幾次 */
  search?: ScheduleSearchSummary;
  /** 引擎跑了兩個派車版本時，兩份的比較依據與選了哪一份 */
  variantSelection?: ScheduleVariantSelection;
  /** 派車回饋：從排不出的移動卡、被刪的班次推出的限制，以及每一輪有沒有採用 */
  assignmentFeedback?: {
    cuts: Array<{ pulseId: string; row: number; reason: string }>;
    rounds: Array<{
      round: number;
      cuts: Array<{ pulseId: string; row: number; reason: string }>;
      adopted: boolean;
      /** [擋發布的問題數, −載客班次, 班距低於目標] */
      before: number[];
      after: number[];
    }>;
  };
};

/**
 * 派車版本：
 * - base：脈衝的某一腿晚於既有同向班次卻貼太近時，放棄這台車、換下一台。
 * - alt：同樣情況改成把這一腿往後推到所需班距（仍守延遲上限）。
 */
export type ShiftScheduleVariant = 'base' | 'alt';

export type ScheduleSearchSummary = {
  variant: ShiftScheduleVariant;
  stages?: Array<{ round: number; stage: string; elapsedMs: number }>;
  feedbackRounds?: number;
  totalElapsedMs?: number;
  candidates: number;
  evaluations: number;
  duplicatesSkipped: number;
  elapsedMs: number;
  /** null＝搜完；其餘＝因哪個上限停下（沒搜完） */
  exhaustedBy: 'candidates' | 'evaluations' | 'time' | null;
  limits: { maxCandidates: number; maxEvaluations: number; timeLimitMs: number };
};

export type ScheduleVariantSelection = {
  chosen: ShiftScheduleVariant;
  /** 為什麼是這份：比較結果、另一份沒有班表、另一份執行失敗、不需要另一份 */
  why: 'compared' | 'alt-has-no-plan' | 'alt-failed' | 'base-fully-served';
  keyOrder: string[];
  baseKey?: number[];
  altKey?: number[];
  safetyNotWorse?: boolean;
  baseSearch?: ScheduleSearchSummary;
  altSearch?: ScheduleSearchSummary;
  altFailure?: string;
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
// 7：移動卡途經點記下節點 id（yardMoveViaNodeIds），地圖改名不再讓班表過不了檢查（2026-11-18）
export const CURRENT_SHIFT_SCHEDULE_OUTPUT_VERSION = 7;

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
    /** 檢查當下的安全設定／路網指紋（舊紀錄沒有：視為未檢查） */
    settingsFingerprint?: string;
    topologyFingerprint?: string;
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
