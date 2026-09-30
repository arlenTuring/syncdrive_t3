import { engineTrace, engineTraceEnabled } from './schedule-engine/engineTrace';
import type { SearchBudget } from './schedule-engine/searchBudget';
import {
  resolveMaintenanceEntrySlackSeconds,
  type MaintenanceEntrySlackBySection,
} from './resolveMaintenanceEntrySlackSeconds';
import { diagnoseJunctionBlock, solveJunctionShift, type JunctionShiftQuery } from './junctionShift';
import type { PointTopology, PointTopologyEdge } from '../../map-editor/types/pointTopology';
import type { MapAreaObject } from '../../map-editor/types/area';
import { getFacilityDockingPoint } from '../../map-editor/utils/facilityDockingPoint';
import { facilityDockingTopologyNodeId } from '../../map-editor/utils/pointTopology';
import type { TaskTypeKey } from '../../time-templates/types/editor';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import {
  edgeSeconds,
  explainTopologyPathGap,
  findTopologyPath,
  missingTravelTimeEdgesBetween,
  type TopologyEdgeRef,
} from './findTopologyPath';
import {
  extractFacilityMapCodes,
  type MaintenanceBodySectionKey,
} from './maintenanceFirstTripOrigins';
import {
  resolveMaintenanceSectionCodeForTaskType,
  resolveMaintenanceSectionLabelForTaskType,
  type MaintenanceSectionCodeBySection,
} from './maintenanceSectionCode';
import {
  FACILITY_SECTION_BY_TASK_TYPE,
  YARD_TASK_TYPES,
  nodeMatchesMoveCardCodes,
  findMoveCardFacilityConflict,
  moveCardFacilityIsFree,
  type MoveCardFacilityBooking,
} from './moveCardShared';
import { SCHEDULE_DAY_MINUTES } from './scheduleDayCycle';
import { SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS, snapUpToClockAlignSeconds } from './schedule-engine/physics';
import { collectStationBerthOccupancies } from './stationBerthOccupancy';
import { isWorkYardTaskType, minimumYardWorkSeconds as minimumYardWorkSecondsFor, nonZeroYardWorkSeconds } from './yardWorkMinimum';
import {
  minuteToSecond,
  secondToMinute,
  type GeneratedScheduleBlock,
  type GeneratedSchedulePlan,
} from './schedule-engine/types';

/**
 * 整備轉場卡（入廠／出廠／整備間轉場）
 * ================================
 *
 * 每一種整備任務（充電／洗車／保養／行檢／待命）都用<strong>同一套轉場機制</strong>：
 * 車進去前補一張入廠卡、出來後補一張出廠卡、跟另一種整備直接銜接時補一對
 * 出廠＋入廠——不是四張各自寫死的卡片，是同一個模組依「這一段整備的左右
 * 鄰居是什麼」自己判斷該補哪一種、去哪個設施、算多久。前身是三個各自獨立、
 * 各自重讀一次拓樸／各自建一份設施佔用表的檔案
 * （insertYardExitMoveCards／insertYardEntryMoveCards／
 * insertYardTransitionMoveCards），這裡合併成一個：拓樸、設施代號比對、
 * 路徑搜尋、設施佔用表只建一份，三段規則共用。
 *
 * 三段規則本身是<strong>三種不同的時序邏輯</strong>，不是重複的程式碼硬湊在一起——
 * 各自對應「車要開進整備」「車要開出整備」「兩段不同整備直接銜接」三種
 * 完全不同的情境，本來就該算法不同：
 *
 * <ol>
 *   <li><strong>入廠（entry）</strong>：只在整備串「串首」（前面接正線或本來就沒有
 *   前一段整備）補。車一跑完正線就能走，越早到、整備就從越早開始——
 *   <strong>開始時刻提前、結束時刻不動</strong>，時長變長。</li>
 *   <li><strong>出廠（exit）</strong>：只在整備串「串尾」（後面接正線）補。
 *   往前貼齊下一段發車時刻，零秒緩衝；空間不夠時<strong>唯一有特權</strong>
 *   吃掉整備的尾巴。</li>
 *   <li><strong>整備間轉場（transition）</strong>：串「內部」兩段不同類型整備直接
 *   銜接（例：充電做完接著去保養）——前一段跑滿全長、結束不動；出廠卡
 *   接入廠卡、中間是真實的路網移動時間；後一段開始被推遲到入廠卡抵達
 *   那一刻、結束不動，運輸成本佔的是後一段的工作時間。</li>
 * </ol>
 *
 * 三段規則在「左右鄰居是誰」這件事上互斥、不重疊：入廠只在左鄰居不是
 * 整備任務時才補；出廠只在右鄰居不是整備任務時才補；轉場只在左右鄰居
 * <strong>都是</strong>整備任務、且類型不同時才補。所以三段可以照順序各掃一遍
 * 全部時間線，不必互相協調誰先誰後——但仍然共用<strong>同一份</strong>設施佔用表，
 * 讓入廠、出廠、轉場三種卡片都看得到彼此佔走的設施時段，不會兩張卡
 * 各自以為設施是空的而撞車。
 *
 * 設施路徑一律走 {@link findTopologyPath}（拓樸最短路徑），不再有出廠卡
 * 獨立用「聚合後的每站最快空駛時間」這種另一套資料來源——路徑只有一種
 * 找法，多一套就是多一份要保持同步的重複。
 * */

/** 這一段是否需要車「人已經在轉乘站上」才能開始 */
function requiresVehicleAtStation(block: GeneratedScheduleBlock): boolean {
  return block.taskType === 'passenger';
}

function resolveBlockOriginStationId(
  block: GeneratedScheduleBlock,
): string | null {
  const dwells = block.stationDwells;
  if (Array.isArray(dwells) && dwells.length > 0) {
    return dwells[0]?.stationId?.trim() || null;
  }
  return null;
}

/**
 * 日循環鄰居（整份班表是一天 00:00–24:00 無限重複）
 * ================================================
 *
 * 一條時間線的<strong>最後一段之後，接的是它自己的第一段</strong>——同一台車
 * 隔天照跑同一份班表。所以「前一段」「下一段」不能只看陣列的前後：當日最前面
 * 那一段的前一段，是當日最後面那一段（時刻要減一天）；反之亦然。
 *
 * <code>offsetMinute</code> 就是這個時刻換算：往前繞回去是 −1440，
 * 往後繞過去是 +1440，當日之內則是 0。取用時一律用
 * <code>block.plannedXxxMinute + offsetMinute</code>，才會落在跟自己同一個
 * 時間軸上比較。
 */
type CyclicNeighbor = { block: GeneratedScheduleBlock; offsetMinute: number };

function findPrevCyclic(
  sorted: GeneratedScheduleBlock[],
  index: number,
  predicate: (block: GeneratedScheduleBlock) => boolean,
): CyclicNeighbor | null {
  for (let k = index - 1; k >= 0; k -= 1) {
    if (predicate(sorted[k]!)) return { block: sorted[k]!, offsetMinute: 0 };
  }
  // 當日之內找不到 → 繞回當日最後面（同一台車前一天的尾巴）
  for (let k = sorted.length - 1; k > index; k -= 1) {
    if (predicate(sorted[k]!)) {
      return { block: sorted[k]!, offsetMinute: -SCHEDULE_DAY_MINUTES };
    }
  }
  return null;
}

function findNextCyclic(
  sorted: GeneratedScheduleBlock[],
  index: number,
  predicate: (block: GeneratedScheduleBlock) => boolean,
): CyclicNeighbor | null {
  for (let k = index + 1; k < sorted.length; k += 1) {
    if (predicate(sorted[k]!)) return { block: sorted[k]!, offsetMinute: 0 };
  }
  // 當日之內找不到 → 繞到當日最前面（同一台車隔天的開頭）
  for (let k = 0; k < index; k += 1) {
    if (predicate(sorted[k]!)) {
      return { block: sorted[k]!, offsetMinute: SCHEDULE_DAY_MINUTES };
    }
  }
  return null;
}

/**
 * 整天沒有載客的列：這一段整備前一刻／下一刻車在哪，照日循環找相鄰的整備段。
 *
 * 「不需要入出廠卡」必須有地點依據，不能只因為全天沒有載客就認定——車總是從
 * 某一格來、往某一格去。找得到相鄰整備段（或整天只有自己這一段）才回傳依據；
 * 相鄰的是別的東西、或根本找不到，回傳 null，呼叫端就要當成必要轉場失敗。
 */
function describeYardOnlyNeighborBasis(
  sorted: GeneratedScheduleBlock[],
  index: number,
  direction: 'prev' | 'next',
): string | null {
  const self = sorted[index]!;
  const n = sorted.length;
  for (let step = 1; step <= n; step += 1) {
    const k = direction === 'prev'
      ? (index - step + n * 2) % n
      : (index + step) % n;
    const neighbor = sorted[k]!;
    if (neighbor.taskType === 'dispatch' || neighbor.taskType === 'idle') continue;
    if (neighbor.id === self.id) {
      return `整天只有這一段整備，車前後都停在同一格（${self.yardFacilityLabel ?? '同一格'}），不需要移動`;
    }
    if (!YARD_TASK_TYPES.has(neighbor.taskType)) return null;
    const where = neighbor.yardFacilityLabel ?? neighbor.yardFacilityNodeId ?? '尚未定案的格位';
    const sameType = neighbor.taskType === self.taskType;
    return direction === 'prev'
      ? `車是從前一段「${neighbor.label}」（${where}）接過來的——`
        + (sameType ? '同類整備同格續留' : '兩段之間由整備間轉場負責')
      : `這段做完接著是「${neighbor.label}」（${where}）——`
        + (sameType ? '同類整備同格續留' : '兩段之間由整備間轉場負責');
  }
  return null;
}

/** 緊鄰的前一段／後一段（含跨日繞回）；整條線只有自己一段時回傳 null */
function immediatePrevCyclic(
  sorted: GeneratedScheduleBlock[],
  index: number,
): CyclicNeighbor | null {
  if (sorted.length < 2) return null;
  return index > 0
    ? { block: sorted[index - 1]!, offsetMinute: 0 }
    : { block: sorted[sorted.length - 1]!, offsetMinute: -SCHEDULE_DAY_MINUTES };
}

function immediateNextCyclic(
  sorted: GeneratedScheduleBlock[],
  index: number,
): CyclicNeighbor | null {
  if (sorted.length < 2) return null;
  return index < sorted.length - 1
    ? { block: sorted[index + 1]!, offsetMinute: 0 }
    : { block: sorted[0]!, offsetMinute: SCHEDULE_DAY_MINUTES };
}

/** 排不出移動時擋住的那一筆佔用（秒為日循環座標，可能跨午夜） */
export type TransferBlocker = {
  /**
   * junction：別列車的移動先訂走了轉折點。nodeId 是那張卡（blockingBlockId）停的設施，
   * 呼叫端可以請它換個位置、它的移動路徑與時刻就跟著變；撞在哪個轉折點見 junctionNodeId。
   */
  kind: 'facility' | 'mainline-berth' | 'reserved-for-yard-task' | 'junction';
  nodeId: string;
  /** kind='junction'：撞在哪個轉折點 */
  junctionNodeId?: string;
  /**
   * 這個擋路者限制了什麼：
   * - destination-occupied：要去的格子在那段時間有人
   * - origin-next-occupant：原格有人要進來，所以不能在原格多等（可延後範圍因此縮小）
   * - junction：轉折點被它的移動訂走
   */
  role?: 'destination-occupied' | 'origin-next-occupant' | 'junction';
  /**
   * 擋路的是引擎排出來、可以重新安排的東西（整備停哪一格、移動卡時刻），不是使用者固定的規則。
   * 呼叫端只對 adjustable 的擋路者試「請它換位置／改時刻」。
   */
  adjustable?: boolean;
  blockingRow: number;
  blockingBlockId?: string;
  occupiedFrom: number;
  occupiedTo: number;
  wantedFrom: number;
  wantedTo: number;
  requiredGapSeconds: number;
};

export type MaintenanceTransferCardsResult = {
  timelines: GeneratedSchedulePlan['timelines'];
  /** 插入的卡數（入廠、出廠各算一張；轉場的出廠＋入廠成對算一次） */
  inserted: number;
  /** 出廠卡吃到整備尾巴的次數 */
  ateYardTail: number;
  /** 入廠卡讓整備頭部提前而變長的次數 */
  yardHeadExtended: number;
  /** 轉場卡讓後一段整備被壓縮時長的次數 */
  laterTaskCompressed: number;
  /**
   * 系統為了排移動而縮短的整備工作時間（晚開始或提早結束），逐筆記下：哪一張卡、少了幾秒、
   * 剩下多少、使用者設定的最少作業時長與讓渡餘裕。報告要逐筆列出、可以點到那張卡。
   */
  yardWorkShortened: Array<{
    timelineRow: number;
    blockId: string;
    taskType: string;
    kind: 'late-start' | 'early-end';
    seconds: number;
    remainingWorkSeconds: number;
    minimumWorkSeconds: number;
    /** 晚開始時：使用者設定的讓渡餘裕（上限） */
    limitSeconds?: number;
    reason: string;
  }>;
  skipped: Array<{
    timelineRow: number;
    /** 對應的整備任務區塊 id，讓警告能掛回那張卡（UI 靠這個標 ⚠） */
    blockId?: string;
    taskType?: string;
    fromTaskType?: string;
    toTaskType?: string;
    reason: string;
    /**
     * 這一列整天都沒有前／後載客班次——車沒有要去的地方，本來就不需要入出廠卡，
     * 不是排不出來。跟「有後續任務、但排不出合法移動」的必要轉場失敗分開；
     * 預設（不填）就是後者，呼叫端只在確認全天無載客任務時才標 'not_needed'。
     */
    necessity?: 'not_needed';
    /**
     * 出廠往後錯開才過得去時：下一班要晚幾秒發車。只有呼叫端能判斷整串後移划不划算
     * （要看全域班距、站位），這裡只把候選交出去。
     */
    exitDelay?: { nextBlockId: string; seconds: number };
    /**
     * 只因為轉折點已被別列車的移動先預約走而排不出時，這一趟<strong>原訂時刻</strong>
     * 會經過的節點。呼叫端可以把它們先保留給這一列、整段重排一次，讓彈性較大的移動
     * （例如可以晚一點出發的整備間轉場）去閃它——先處理到的先贏，不代表先處理到的
     * 比較沒得挪。
     */
    junctionReservation?: Array<{ nodeId: string; instant: number }>;
    /** 候選被設施／站位擋下時，擋住的是誰（節點、卡片、時間線、佔用時段、需要間隔） */
    blockers?: TransferBlocker[];
    /** 候選因路網某幾段沒填行駛時間而到不了：缺的是哪幾段 */
    missingTravelTimeEdges?: TopologyEdgeRef[];
    /**
     * 第一組候選的離開時間窗：最早、最晚可以離開前一個位置的時刻（日內秒），各被什麼限制，
     * 那個限制是使用者固定的規則（作業不截尾、作業不歸零、安全間隔）還是引擎可以重排的結果。
     */
    departureWindow?: {
      earliestSecond: number;
      earliestReason: string;
      earliestFixed: boolean;
      latestSecond: number;
      latestReason: string;
      latestFixed: boolean;
    };
    /**
     * 所有候選都只輸在「缺行駛時間」（沒有被佔、沒有撞轉折點、不是時間不夠）：
     * 這是缺資料，不是排程衝突。呼叫端不必再為它搜移動時刻，直接回報待補資料。
     */
    onlyMissingData?: boolean;
  }>;
  /**
   * 整段時間內找不到任何一台空設施的整備任務——車沒地方停，是產能不足，
   * 跟「移動卡排不出來」（路徑問題）分開回報，處置方式完全不同。
   */
  facilityUnavailable: Array<{
    timelineRow: number;
    blockId: string;
    taskType: string;
    /** 該類設施總數（0 代表根本沒設定） */
    facilityCount: number;
    reason: string;
  }>;
  /**
   * 決策樹第三層成功的案例：請已經佔著格子的別列車換一台，把位子讓出來。
   * 只換格子、不動任何人的時間，所以是無代價的讓步。
   */
  facilityYields: Array<{
    timelineRow: number;
    blockId: string;
    taskType: string;
    facilityLabel: string;
    /** 被請去換格子的那幾列 */
    movedRows: number[];
  }>;
  /**
   * 本來可以提早進廠，但那段時間設施被別列車佔著，只好晚點進——
   * 代價是車得在正線站位上多等，這是「設施不足」換成「站位碰撞」的來源。
   */
  /**
   * 待命在原定位置排不出入廠（例如路程塞不進空檔），改到待命清單上另一個允許、到得了的位置。
   * 進場、停留、出場都跟著新位置重算；呼叫端要讓使用者看得到換了哪裡、為什麼。
   */
  standbyRelocations: Array<{
    timelineRow: number;
    blockId: string;
    fromLabel: string;
    toLabel: string;
    /** 換過去的位置（節點 id）；呼叫端要「再換一個」時用來排除 */
    toNodeId: string;
    reason: string;
  }>;
  entryEarlyBlocked: Array<{
    timelineRow: number;
    blockId: string;
    taskType: string;
    facilityLabel: string;
    /** 少提早了幾分鐘 */
    blockedMinutes: number;
    /** 車因此得多停在哪一站 */
    waitStationName: string;
  }>;
};

export function insertMaintenanceTransferCards(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  topology: PointTopology | null | undefined;
  /**
   * 地圖場域管理模組的 Area 容器清單（含各 Area 底下的 facilities）。
   * 挑位置時用來偏好同一個場區（只影響排序）。移動時間一律照拓樸路徑：同區域但沒有路徑、
   * 或路徑缺行駛時間，就是到不了、要報出缺哪一段，不當 0 秒（2026-09-28）。
   */
  areas?: MapAreaObject[] | null;
  maintenanceBody: Record<string, unknown> | null | undefined;
  selectedRoutes: ShiftScheduleSelectedRoute[];
  minimumRecoveryTimeSeconds: number;
  /**
   * 碰撞保護時間（秒，跟 §8 站位碰撞保護同一個數字）。不同列車的移動卡
   * 若會在同一個轉折點（例如多座設施共用的入廠閘門 T3下行）碰頭，
   * 兩者經過那個轉折點的時刻至少要差開 2 倍碰撞保護時間——車是真的走在
   * 實體道路上，不可能兩台同時出現在同一個點。
   */
  collisionProtectionSeconds: number;
  /** 整備區塊代號；用來把來源／目的整備類型的代號算好寫進卡片 */
  sectionCodes?: MaintenanceSectionCodeBySection | null;
  /**
   * 只跑「決定去哪」就回來，不產生任何卡片。
   *
   * 站位求解器在收斂迴圈裡跑，而卡片必須等時刻定案後才能插（要貼齊下一段發車）。
   * 待命佔的停靠站又得讓求解器<strong>在迴圈裡</strong>看得到，否則只能事後報錯、
   * 沒有任何閃避的機會。所以把「決定去哪」跟「插卡」拆成兩次呼叫：
   * 迴圈前先決定（decideOnly），迴圈後再插卡（沿用已寫在區塊上的地點）。
   */
  decideOnly?: boolean;
  /**
   * 事先保留的轉折點經過時刻（見 skipped[].junctionReservation）：排卡前就寫進
   * 預約表，其他列規劃時會閃開；保留那一列自己不受影響。
   */
  reservedJunctionPasses?: Array<{ nodeId: string; instant: number; timelineRow: number }>;
  /**
   * 某一段整備不要選的位置（依整備區塊）。呼叫端發現某張卡佔的位置害別列車排不開時，
   * 排除它整段重算：挑位（pickLocationForStay）與待命替換都改用允許清單上的下一個位置。
   * 只會在使用者設定的允許清單內換，不會借用清單外的位置。
   */
  avoidYardSpots?: ReadonlyArray<{ blockId: string; nodeId: string }>;
  /** 整次生成共用的搜尋預算（見 schedule-engine/searchBudget.ts）；轉場重試會扣它 */
  searchBudget?: SearchBudget;
  /**
   * 使用者設定的各整備區段讓渡餘裕（秒）：整備開始最多能晚多少。有給就以它為上限，
   * 不用程式裡的倍數推算（見 yardStartPushLimitSeconds）。
   */
  maintenanceEntrySlackBySection?: MaintenanceEntrySlackBySection | null;
}): MaintenanceTransferCardsResult {
  const {
    timelines,
    topology,
    areas,
    maintenanceBody,
    selectedRoutes,
    minimumRecoveryTimeSeconds,
    collisionProtectionSeconds,
    sectionCodes,
    decideOnly = false,
  } = args;
  const skipped: MaintenanceTransferCardsResult['skipped'] = [];
  const facilityUnavailable: MaintenanceTransferCardsResult['facilityUnavailable'] = [];
  const facilityYields: MaintenanceTransferCardsResult['facilityYields'] = [];
  const entryEarlyBlocked: MaintenanceTransferCardsResult['entryEarlyBlocked'] = [];
  const standbyRelocations: MaintenanceTransferCardsResult['standbyRelocations'] = [];
  /** 已經報過「沒地方停」的整段停留成員——同一段被日循環切成兩塊時只報一則 */
  const stayReported = new Set<string>();
  let inserted = 0;
  let ateYardTail = 0;
  let yardHeadExtended = 0;
  let laterTaskCompressed = 0;
  const yardWorkShortened: MaintenanceTransferCardsResult['yardWorkShortened'] = [];

  if (!topology || topology.nodes.length === 0) {
    return {
      timelines, inserted, ateYardTail, yardHeadExtended, laterTaskCompressed, yardWorkShortened,
      skipped, facilityUnavailable, facilityYields, entryEarlyBlocked, standbyRelocations,
    };
  }

  /**
   * 設施節點 id → 所在 Area id。走法跟拓樸編輯器的 areaNameByNodeId 一樣
   * （PointTopologyEditorDialog.tsx）：走訪 areas → area.facilities，
   * 一座設施「屬於哪個 Area」是地圖 JSON 裡結構性的事實，不是靠座標算出來的。
   */
  const facilityAreaId = new Map<string, string>();
  for (const area of areas ?? []) {
    for (const facility of area.facilities) {
      if (
        facility.type !== 'DockingPoint'
        && facility.type !== 'Waypoint'
        && facility.type !== 'Facility'
      ) {
        continue;
      }
      facilityAreaId.set(facility.id, area.id);
      if (facility.type === 'Facility') {
        const dock = getFacilityDockingPoint(facility);
        if (dock) {
          facilityAreaId.set(facilityDockingTopologyNodeId(facility.id), area.id);
        }
      }
    }
  }

  const routeStartStation = new Map<string, string>();
  const routeEndStation = new Map<string, string>();
  for (const route of selectedRoutes) {
    const ids = route.stationIds ?? [];
    const start = ids[0]?.trim();
    const end = ids[ids.length - 1]?.trim();
    if (!route.routeId) continue;
    if (start) routeStartStation.set(route.routeId, start);
    if (end) routeEndStation.set(route.routeId, end);
  }

  /** stationId → 拓樸節點 id（停靠節點的 stationId 才是路線用的站碼） */
  const nodeIdByStationId = new Map<string, string>();
  const nodeById = new Map(topology.nodes.map((node) => [node.id, node] as const));
  for (const node of topology.nodes) {
    const stationId = node.stationId?.trim();
    if (stationId) nodeIdByStationId.set(stationId, node.id);
  }

  /**
   * 站點 id → 使用者看得懂的名字。
   *
   * 回報訊息裡直接印 <code>station_2</code> 這種內部 id，使用者根本不知道那是哪一站
   * （2026-08-11 使用者指正）。拓樸節點上就有 label，拿它來寫。
   */
  /**
   * 把拓樸路徑轉成可讀的節點名稱序列（含起訖）。
   *
   * 移動卡先前只顯示兩端，中間走哪一條看不出來——使用者要能分辨「經 T3上行」還是
   * 「經 T3下行」進 H1。節點沒有標籤時退回 id，不要整段消失。
   */
  function pathViaLabels(path: { nodeIds: string[] } | null | undefined): string[] {
    if (!path) return [];
    return path.nodeIds.map(
      (nodeId) => nodeById.get(nodeId)?.label?.trim() || nodeId,
    );
  }

  function stationDisplayName(stationId: string | null | undefined): string {
    const id = stationId?.trim();
    if (!id) return '未知站點';
    const nodeId = nodeIdByStationId.get(id);
    const label = nodeId ? nodeById.get(nodeId)?.label?.trim() : undefined;
    if (label) return label;
    // 拓樸上根本沒有這一站時（「找不到對應節點」那一則就是這種情形），
    // 退回路線設定裡的站名——那才是使用者在畫面上看到的名字
    for (const route of selectedRoutes) {
      const dwell = route.stationDwells?.find((item) => item.stationId === id);
      const name = dwell?.stationName?.trim();
      if (name) return name;
    }
    return id;
  }

  const codesBySection = new Map<MaintenanceBodySectionKey, string[]>();
  /** 呼叫端要求這一段不要停的位置（見 avoidYardSpots） */
  const avoidedSpotsFor = (blockId: string) => new Set((args.avoidYardSpots ?? [])
    .filter((spot) => spot.blockId === blockId).map((spot) => spot.nodeId));
  /** 這一段可以停的設施：允許清單扣掉被要求避開的位置 */
  const facilityNodesForBlock = (block: { id: string; taskType: string }) => {
    const avoided = avoidedSpotsFor(block.id);
    return facilityNodesFor(block.taskType).filter((node) => !avoided.has(node.id));
  };
  const facilityNodesFor = (taskType: string) => {
    const section = FACILITY_SECTION_BY_TASK_TYPE[taskType as TaskTypeKey];
    if (!section) return [];
    let codes = codesBySection.get(section);
    if (!codes) {
      codes = extractFacilityMapCodes(maintenanceBody, section);
      codesBySection.set(section, codes);
    }
    // 待命（standby）可以停在正線停靠站上候用，所以它的可用節點含 docking；
    // 其他整備任務一定要進實體設施格（充電要有充電樁、保養要有維修坑），
    // 不能佔著正線站位當工作區。整備任務 UI 也只有待命那一步會把停靠站列進來。
    const allowDocking = taskType === 'standby';
    return topology.nodes.filter(
      (node) =>
        (node.kind === 'facility' || (allowDocking && node.kind === 'docking'))
        && nodeMatchesMoveCardCodes(node, codes!),
    );
  };

  // 入廠、出廠、轉場三段共用同一份設施佔用表——同一台設施同一時刻只能停
  // 一台車，不分是被哪一種卡佔的。
  const bookings: MoveCardFacilityBooking[] = [];

  const daySeconds = minuteToSecond(SCHEDULE_DAY_MINUTES);

  /**
   * 一段時間窗在日循環上實際覆蓋到的區段（0 ≤ t < 一天）。
   * 待命可以從 23:40 停到隔天 01:20，也可能因為入廠卡提前抵達而讓窗口起點
   * 落到 0 以前——直接拿原始秒數去比大小會把「跨午夜」誤判成「差了一整天」。
   */
  function daySegmentsOf(startSecond: number, endSecond: number): Array<[number, number]> {
    const span = endSecond - startSecond;
    if (span <= 0) return [];
    if (span >= daySeconds) return [[0, daySeconds]];
    const start = ((startSecond % daySeconds) + daySeconds) % daySeconds;
    const end = start + span;
    if (end <= daySeconds) return [[start, end]];
    return [[start, daySeconds], [0, end - daySeconds]];
  }

  /** 回報訊息用的時刻字串；跨午夜的秒數先繞回日循環內 */
  function formatSecondOfDay(second: number): string {
    const wrapped = Math.round(((second % daySeconds) + daySeconds) % daySeconds);
    const hh = Math.floor(wrapped / 3600);
    const mm = Math.floor((wrapped % 3600) / 60);
    const ss = wrapped % 60;
    return [hh, mm, ss].map((v) => String(v).padStart(2, '0')).join(':');
  }

  function cyclicWindowsOverlap(
    aStart: number, aEnd: number,
    bStart: number, bEnd: number,
  ): boolean {
    const a = daySegmentsOf(aStart, aEnd);
    const b = daySegmentsOf(bStart, bEnd);
    return a.some(([as, ae]) => b.some(([bs, be]) => as < be - 1e-9 && bs < ae - 1e-9));
  }

  /**
   * 最近一次「這一格不能用」的具體原因：擋住的節點、卡片、時間線、佔用時段、需要的間隔。
   * 排不出轉場時，訊息要能讓使用者直接定位到擋住的那張卡——只寫「設施被佔用」查不下去。
   */
  type FacilityBlocker = TransferBlocker;
  let lastBlocker: FacilityBlocker | null = null;
  function noteBlocker(blocker: FacilityBlocker): void {
    lastBlocker = blocker;
  }
  /** 設施佔用表查詢；被擋時記下是誰 */
  function facilityBookingIsFree(
    facilityNodeId: string,
    timelineRow: number,
    startSecond: number,
    endSecond: number,
    requiredGapSeconds = 0,
  ): boolean {
    const hit = findMoveCardFacilityConflict(bookings, facilityNodeId, startSecond, endSecond, timelineRow);
    if (hit) {
      noteBlocker({
        kind: 'facility',
        nodeId: facilityNodeId,
        blockingRow: hit.timelineRow,
        blockingBlockId: hit.blockId,
        occupiedFrom: hit.startSecond,
        occupiedTo: hit.endSecond,
        wantedFrom: startSecond,
        wantedTo: endSecond,
        requiredGapSeconds,
      });
    }
    return !hit;
  }
  function describeBlocker(blocker: FacilityBlocker): string {
    const label = nodeById.get(blocker.nodeId)?.label || blocker.nodeId;
    const who = `時間線 ${blocker.blockingRow}${blocker.blockingBlockId ? `（卡片 ${blocker.blockingBlockId}）` : ''}`;
    const occupied = `${formatSecondOfDay(blocker.occupiedFrom)}–${formatSecondOfDay(blocker.occupiedTo)}`;
    const wanted = `${formatSecondOfDay(blocker.wantedFrom)}–${formatSecondOfDay(blocker.wantedTo)}`;
    const what = blocker.kind === 'mainline-berth'
      ? `${label}（正線站位）被 ${who} ${occupied} 佔用（含保護時間）`
      : blocker.kind === 'reserved-for-yard-task'
        ? `${label} 保留給 ${who} ${occupied} 的整備`
        : `${label} 被 ${who} ${occupied} 佔用`;
    return `${what}，本列需要 ${wanted}`
      + (blocker.requiredGapSeconds > 0 ? `，交接至少要隔 ${blocker.requiredGapSeconds} 秒` : '');
  }

  /**
   * 正線停靠站的<strong>載客</strong>佔用表：stationId → 各列車壓住那一格的時間窗。
   *
   * 待命可以停在正線停靠站上（使用者指定的），那一格被壓住的期間別台車就進不來。
   * 挑地點時<strong>一定要看得到這張表</strong>——先前只查 {@link bookings}（整備卡
   * 自己的設施預約），載客班次在待命眼中永遠是不存在的，於是待命一律賴在
   * 「車剛跑完停著的那個終端站」（移動成本 0，必勝任何設施），把全天最忙的
   * 站位壓住一兩個小時，期間每一班經過的車都變成 STATION_BERTH_COLLISION。
   * 求解器救不了：它只會延後（上限約 2 分鐘）或改走備用線，對付兩小時的佔用無效。
   *
   * 定義直接沿用 {@link collectStationBerthOccupancies}——站位佔用只能有一套定義，
   * 這裡自己再寫一套「什麼叫佔住」就是下一個對不起來的地方。
   */
  let mainlineBerthUsage: Map<
    string,
    Array<{ startSecond: number; endSecond: number; timelineRow: number; blockId: string }>
  > | null = null;
  function mainlineBerthWindows(stationId: string) {
    if (!mainlineBerthUsage) {
      mainlineBerthUsage = new Map();
      // 待命自己造成的佔用要排除：那是這個模組正在決定的東西，且待命彼此
      // 之間的互斥已經由 bookings（同一個設施節點）管住了。
      const standbyBlockIds = new Set<string>();
      for (const timeline of timelines) {
        for (const block of timeline.blocks) {
          if (block.taskType === 'standby') standbyBlockIds.add(block.id);
        }
      }
      const occupancies = collectStationBerthOccupancies(timelines, selectedRoutes, {
        collisionProtectionSeconds,
      });
      for (const occ of occupancies) {
        if (standbyBlockIds.has(occ.blockId)) continue;
        const list = mainlineBerthUsage.get(occ.stationId) ?? [];
        // 前後各留一份保護時間：待命當後車時要等前車 protectedUntil 才能進來，
        // 當前車時也要在後車到站前 2 倍保護時間就先讓出去，跟
        // findStationBerthCollisions 的判定同一套算術。
        const protectionSeconds = Math.max(0, collisionProtectionSeconds) * 2;
        list.push({
          startSecond: minuteToSecond(occ.startMinute) - protectionSeconds,
          endSecond: minuteToSecond(occ.protectedUntilMinute),
          timelineRow: occ.timelineRow,
          blockId: occ.blockId,
        });
        mainlineBerthUsage.set(occ.stationId, list);
      }
    }
    return mainlineBerthUsage.get(stationId) ?? [];
  }

  /**
   * 這個節點在 [startSecond, endSecond) 這段時間可以讓這台車壓住嗎。
   * 設施格不佔正線站位，永遠可用；停靠節點才要問載客班次。
   */
  function dockingBerthIsFree(
    nodeId: string,
    timelineRow: number,
    startSecond: number,
    endSecond: number,
  ): boolean {
    const node = nodeById.get(nodeId);
    if (node?.kind !== 'docking') return true;
    const stationId = node.stationId?.trim();
    if (!stationId) return true;
    const hit = mainlineBerthWindows(stationId).find(
      (window) =>
        window.timelineRow !== timelineRow
        && cyclicWindowsOverlap(startSecond, endSecond, window.startSecond, window.endSecond),
    );
    if (hit) {
      noteBlocker({
        kind: 'mainline-berth',
        nodeId,
        blockingRow: hit.timelineRow,
        blockingBlockId: hit.blockId,
        occupiedFrom: hit.startSecond,
        occupiedTo: hit.endSecond,
        wantedFrom: startSecond,
        wantedTo: endSecond,
        requiredGapSeconds: Math.max(0, collisionProtectionSeconds) * 2,
      });
    }
    return !hit;
  }

  /**
   * 整備區塊 id → 已經確定停留的具體設施。同一段整備任務只會停在同一台
   * 設施裡——入廠、出廠（或轉場卡對應的那一側）三段各自獨立算，但指的
   * 是同一段停留，哪一側先解出來，另一側就要沿用同一台，不能各自挑各自
   * 覺得最快的那台，那樣車會憑空從一台設施跳到另一台設施。
   * 執行順序是 入廠 → 轉場 → 出廠，晚執行的一定看得到早執行的結果。
   */
  const yardBlockFacility = new Map<string, { nodeId: string; label: string }>();
  /** 整備區塊 id → 它在 bookings 裡那一筆佔用（可就地更新，時刻變動時同步） */
  const yardBookingByBlockId = new Map<string, MoveCardFacilityBooking>();

  /**
   * 把一段整備任務綁到一台具體設施，同時<strong>用它自己的完整時長</strong>
   * 佔住那台設施。
   *
   * 佔用的是整備任務本身的 [開始, 結束]，不是移動卡的那一小段——車在裡面
   * 做整備的整段時間，那一格都不可能再讓別台車用。這件事必須跟「挑設施時
   * 檢查空不空」用<strong>同一個時間窗</strong>：先前入廠卡檢查的是
   * 「抵達 → 原訂整備開始」那一小段、佔用的卻是整段，窗口對不上，於是
   * 別列車早就訂走整段的設施還是會被判定成空的，排出兩台車同時佔同一格。
   *
   * 呼叫時機一律在該段整備的時刻異動<strong>之後</strong>；同一段被多個
   * 流程（入廠／轉場／出廠）先後定案時就地更新同一筆佔用，不會重複累加。
   */
  /**
   * 車<strong>真正離開</strong>這一格的時刻。
   *
   * 整備結束不等於車開走：整備做完之後，車還停在格子裡，直到下一張卡把它帶走
   * ——可能是出場移動卡，也可能直接就是下一班正線（設施的出場站正好是發車站時，
   * 引擎不會插移動卡）。實測（2026-08-24）九筆設施格重疊全部是後者：
   *
   * <pre>
   *   E2  時間線 1  充電做完 12:00:00，car 停在格子裡到 12:10:30 才跑正線
   *       時間線 3  12:00:40 就進來了                        → 重疊 590 秒
   * </pre>
   *
   * 預約只鎖到整備結束的話，那段「做完了還沒走」在帳上是空的，別台車就訂進來了。
   * 這個函式回傳的是<strong>下一張有長度的卡開始的時刻</strong>——車在那之前都還在
   * 這一格。
   */
  function vehicleLeavesFacilityAtSecond(block: GeneratedScheduleBlock): number {
    const endSecond = minuteToSecond(block.plannedEndMinute);
    /*
     * 看<strong>目前</strong>這條線上的卡（含已插入的移動卡），不是插卡前的鏈。
     *
     * 出廠卡可能吃掉整備尾巴、讓車提早離格；只看插卡前的鏈，下一張有長度的卡永遠是
     * 下一班載客，佔用就一路算到發車——別列車因此以為這一格還被佔著，排不出本來排得出
     * 的轉場（2026-09-28 重播：時間線 6 15:53:20 就出廠，佔用卻記到 16:00:30，
     * 擋掉時間線 4 16:00 的充電轉待命）。
     */
    const timeline = timelines.find((item) => item.row === block.timelineRow);
    if (!timeline) return endSecond;
    let leave = Number.POSITIVE_INFINITY;
    for (const next of timeline.blocks) {
      if (next === block) continue;
      if (next.plannedEndMinute - next.plannedStartMinute <= 1e-9) continue;
      if (next.plannedStartMinute < block.plannedEndMinute - 1e-9) continue;
      leave = Math.min(leave, minuteToSecond(next.plannedStartMinute));
    }
    return Number.isFinite(leave) ? Math.max(endSecond, leave) : endSecond;
  }

  /**
   * 車<strong>真正進到</strong>這一格的時刻。
   *
   * 提早到設施只是等待，整備照原訂時刻開始（白皮書 YARD-07）——但從抵達那一刻起車就在格子裡，
   * 格位從抵達就被佔住。前一張有長度的卡是開進同一格的入廠卡時，回傳它的抵達時刻；否則就是
   * 整備自己的開始時刻。
   */
  function vehicleArrivesFacilityAtSecond(block: GeneratedScheduleBlock, nodeId: string): number {
    const startSecond = minuteToSecond(block.plannedStartMinute);
    const timeline = timelines.find((item) => item.row === block.timelineRow);
    if (!timeline) return startSecond;
    let previous: GeneratedScheduleBlock | null = null;
    for (const other of timeline.blocks) {
      if (other === block) continue;
      if (other.plannedEndMinute - other.plannedStartMinute <= 1e-9) continue;
      if (other.plannedEndMinute > block.plannedStartMinute + 1e-9) continue;
      if (!previous || other.plannedEndMinute > previous.plannedEndMinute) previous = other;
    }
    if (previous?.source === 'yard_entry_move' && previous.yardExitFacilityNodeId?.trim() === nodeId) {
      return Math.min(startSecond, minuteToSecond(previous.plannedEndMinute));
    }
    return startSecond;
  }

  function assignYardFacility(
    block: GeneratedScheduleBlock,
    nodeId: string,
    label: string,
  ): void {
    yardBlockFacility.set(block.id, { nodeId, label });
    block.yardFacilityNodeId = nodeId;
    block.yardFacilityLabel = label;
    // 停的是正線停靠站才記 stationId——它要進站位佔用表；設施格不佔正線站位
    const node = nodeById.get(nodeId);
    block.yardFacilityStationId =
      node?.kind === 'docking' ? node.stationId?.trim() || undefined : undefined;

    // 從車進格（提早到的等待也算）鎖到車真正開走，不是整備的起訖——前後那段車都在格子裡
    const startSecond = vehicleArrivesFacilityAtSecond(block, nodeId);
    const endSecond = vehicleLeavesFacilityAtSecond(block);
    const existing = yardBookingByBlockId.get(block.id);
    if (existing) {
      existing.facilityNodeId = nodeId;
      existing.startSecond = startSecond;
      existing.endSecond = endSecond;
      return;
    }
    const booking: MoveCardFacilityBooking = {
      facilityNodeId: nodeId,
      startSecond,
      endSecond,
      timelineRow: block.timelineRow,
      blockId: block.id,
    };
    bookings.push(booking);
    yardBookingByBlockId.set(block.id, booking);
  }

  /**
   * 每條時間線在<strong>插卡之前</strong>的原始排序，用來走「同一段連續停留」的鏈。
   * 之後插入的移動卡都是 dispatch，不會混進整備鏈裡，所以這份索引一直有效。
   */
  const chainContext = new Map<
    string,
    { sorted: GeneratedScheduleBlock[]; index: number }
  >();
  for (const timeline of timelines) {
    const sortedBlocks = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );
    sortedBlocks.forEach((block, index) => {
      chainContext.set(block.id, { sorted: sortedBlocks, index });
    });
  }

  /**
   * 把一台設施指派給<strong>整段連續停留</strong>——緊鄰的同類型整備（跨午夜也算）
   * 是同一段停留，車不會中途換格子，所以那一整串都要一起佔住同一台設施。
   *
   * 只指派其中一段的話，另一段在別列車眼中就是空的：跨午夜的
   * 「保養 20:33–24:00 ＋ 保養 00:00–07:50」如果只有前半段佔位，
   * 別列車就會把同一格排進 00:00–07:50，變成兩台車同時佔一格。
   */
  /** 收集這一段所屬的整條連續停留（含自己），緊鄰的同類型整備都算，跨午夜也算 */
  function collectStay(block: GeneratedScheduleBlock): GeneratedScheduleBlock[] {
    const visited = new Set<string>([block.id]);
    const stay: GeneratedScheduleBlock[] = [block];
    const queue: GeneratedScheduleBlock[] = [block];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const ctx = chainContext.get(current.id);
      if (!ctx) continue;
      for (const neighbor of [
        immediatePrevCyclic(ctx.sorted, ctx.index),
        immediateNextCyclic(ctx.sorted, ctx.index),
      ]) {
        if (!neighbor) continue;
        if (neighbor.block.taskType !== block.taskType) continue;
        if (visited.has(neighbor.block.id)) continue;
        visited.add(neighbor.block.id);
        stay.push(neighbor.block);
        queue.push(neighbor.block);
      }
    }
    return stay;
  }

  function assignYardStay(
    block: GeneratedScheduleBlock,
    nodeId: string,
    label: string,
  ): void {
    for (const member of collectStay(block)) {
      assignYardFacility(member, nodeId, label);
    }
  }

  /**
   * 這個地點對<strong>整段連續停留</strong>都是空的嗎。
   *
   * 兩種資源都要問：設施格問 {@link bookings}（整備卡彼此的預約），
   * 正線停靠節點還要多問 {@link mainlineBerthWindows}（載客班次壓住那一格的時段）。
   * 只問前者的話，待命眼中正線永遠是空的，會直接壓在最忙的終端站上。
   *
   * 只檢查「正在決定的這一段」是不夠的：跨午夜的
   * 「保養 20:33–24:00 ＋ 保養 00:00–07:50」是一次選擇、一起佔位，
   * 若只拿前半段去問「空不空」，選到的設施可能在後半段早就被別列車訂走，
   * 佔位時就直接壓上去變成兩台車同時佔一格。要選就要整條鏈一起問。
   *
   * 正在決定的那一段用傳入的預定時間窗（它的時刻還沒寫回區塊），
   * 鏈上其他段用它們目前的時間窗。
   */
  /**
   * 這一格是不是<strong>留給真整備的</strong>——待命不准拿。
   *
   * 「決定去哪」與「收尾補掃」兩處是用兩階段（真整備先挑、待命只能拿剩下的）
   * 做到設施優先。但插卡的三段（入廠、整備間轉場、出廠）<strong>沒有</strong>
   * 這一層：它們照時間線順序邊插卡邊搶，第 2 列的待命就這樣拿走最後一格充電樁，
   * 第 7 列真的要充電的車卻補不到（2026-08-10 埋探針實測抓到）。
   *
   * 那三段不能像前兩處一樣「延後處理」——它們<strong>當下就需要一台設施</strong>
   * 才產得出卡片。所以改成在同一個入口把規則寫死：待命要拿一格之前，
   * 先看有沒有哪一段真整備在同一時間需要它而且還沒著落。有的話就讓開。
   *
   * 只擋設施格，不擋正線停靠站——真整備不會停在停靠站上，沒有競爭關係。
   * 只在待命身上做這個檢查，所以掃描成本只跟待命的數量成正比。
   */
  function facilityReservedForRealYardTask(
    facilityNodeId: string,
    standbyBlock: GeneratedScheduleBlock,
    startSecond: number,
    endSecond: number,
  ): GeneratedScheduleBlock | null {
    if (nodeById.get(facilityNodeId)?.kind === 'docking') return null;
    for (const timeline of timelines) {
      for (const block of timeline.blocks) {
        if (block.id === standbyBlock.id) continue;
        if (block.taskType === 'standby') continue;
        if (!YARD_TASK_TYPES.has(block.taskType)) continue;
        // 已經有地方停的不必替它保留——它的佔用本來就在 bookings 裡擋著了
        if (yardBlockFacility.has(block.id)) continue;
        if (
          !cyclicWindowsOverlap(
            startSecond,
            endSecond,
            minuteToSecond(block.plannedStartMinute),
            minuteToSecond(block.plannedEndMinute),
          )
        ) {
          continue;
        }
        if (facilityNodesFor(block.taskType).some((node) => node.id === facilityNodeId)) {
          return block;
        }
      }
    }
    return null;
  }

  function stayFacilityIsFree(
    facilityNodeId: string,
    block: GeneratedScheduleBlock,
    timelineRow: number,
    startSecond: number,
    endSecond: number,
  ): boolean {
    lastBlocker = null;
    if (!facilityBookingIsFree(facilityNodeId, timelineRow, startSecond, endSecond)) {
      return false;
    }
    if (!dockingBerthIsFree(facilityNodeId, timelineRow, startSecond, endSecond)) {
      return false;
    }
    // 設施優先：待命不准拿走真整備同一時間需要、而且還沒著落的格子
    if (block.taskType === 'standby') {
      const reservedFor = facilityReservedForRealYardTask(facilityNodeId, block, startSecond, endSecond);
      if (reservedFor) {
        noteBlocker({
          kind: 'reserved-for-yard-task',
          nodeId: facilityNodeId,
          blockingRow: reservedFor.timelineRow,
          blockingBlockId: reservedFor.id,
          occupiedFrom: minuteToSecond(reservedFor.plannedStartMinute),
          occupiedTo: minuteToSecond(reservedFor.plannedEndMinute),
          wantedFrom: startSecond,
          wantedTo: endSecond,
          requiredGapSeconds: 0,
        });
        return false;
      }
    }
    for (const member of collectStay(block)) {
      if (member.id === block.id) continue;
      const memberStart = minuteToSecond(member.plannedStartMinute);
      const memberEnd = minuteToSecond(member.plannedEndMinute);
      if (!facilityBookingIsFree(facilityNodeId, timelineRow, memberStart, memberEnd)) {
        return false;
      }
      if (!dockingBerthIsFree(facilityNodeId, timelineRow, memberStart, memberEnd)) {
        return false;
      }
    }
    return true;
  }

  /**
   * 候選被淘汰的原因計數，用來組出「到底卡在哪」的具體訊息。
   * 全部混寫成一句「找不到路徑／設施被佔／轉折點太近」使用者根本分不出
   * 該去補拓樸、加設施，還是這個時段本來就排不下——每一種的處置完全不同。
   */
  type RejectTally = {
    noPath: number;
    facilityBusy: number;
    junctionBusy: number;
    noTime: number;
    /** noPath 裡面，是因為缺行駛時間（有路但沒填時間）的次數 */
    noPathMissingTime: number;
    /** 缺行駛時間的邊（去重） */
    missingEdges: TopologyEdgeRef[];
    /**
     * 第一筆轉折點衝突的細節：撞在哪個點、原本想幾點經過、可以挪多少、
     * 是誰擋著。只寫「會跟別列車在同一個轉折點撞上」使用者無從判斷是
     * 「真的塞不下」還是「演算法沒挪」——2026-08-10 就是卡在這裡查不下去。
     */
    junctionDetail: string | null;
    /** 第一筆「到不了」的細節：沒有連通，還是哪一段沒有行駛時間 */
    noPathDetail: string | null;
    /** 第一筆設施被佔的細節（見 describeBlocker）與結構化資料 */
    facilityDetail: string | null;
    facilityBlockers: FacilityBlocker[];
    /** 轉折點被誰的移動訂走（可以請它換位置的那幾張卡） */
    junctionBlockers: TransferBlocker[];
    /** 縮小可延後範圍的那一方（原格下一台要進來的車） */
    limitBlockers: TransferBlocker[];
    departureWindow: NonNullable<MaintenanceTransferCardsResult['skipped'][number]['departureWindow']> | null;
  };
  function newTally(): RejectTally {
    return {
      noPath: 0, facilityBusy: 0, junctionBusy: 0, noTime: 0, noPathMissingTime: 0, missingEdges: [],
      junctionDetail: null, noPathDetail: null, facilityDetail: null, facilityBlockers: [], junctionBlockers: [],
      limitBlockers: [], departureWindow: null,
    };
  }
  /** 候選到不了：計數，並寫下缺的是哪一段（沒有路徑或沒有行駛時間，含起終點） */
  function tallyNoPath(tally: RejectTally, fromNodeId: string, toNodeId: string): void {
    tally.noPath += 1;
    tally.noPathDetail ??= explainTopologyPathGap(topology, fromNodeId, toNodeId);
    const missing = missingTravelTimeEdgesBetween(topology, fromNodeId, toNodeId);
    if (!missing?.length) return;
    tally.noPathMissingTime += 1;
    for (const edge of missing) {
      if (!tally.missingEdges.some((item) => item.fromNodeId === edge.fromNodeId && item.toNodeId === edge.toNodeId)) {
        tally.missingEdges.push(edge);
      }
    }
  }
  /** 失敗紀錄要帶的缺資料欄位：缺哪幾段、是不是只輸在缺資料 */
  function dataGapFields(...tallies: RejectTally[]): {
    missingTravelTimeEdges?: TopologyEdgeRef[];
    onlyMissingData?: boolean;
  } {
    const edges: TopologyEdgeRef[] = [];
    for (const tally of tallies) {
      for (const edge of tally.missingEdges) {
        if (!edges.some((item) => item.fromNodeId === edge.fromNodeId && item.toNodeId === edge.toNodeId)) edges.push(edge);
      }
    }
    if (edges.length === 0) return {};
    const onlyMissingData = tallies.every((tally) =>
      tally.facilityBusy === 0 && tally.junctionBusy === 0 && tally.noTime === 0
      && tally.noPath === tally.noPathMissingTime);
    return { missingTravelTimeEdges: edges, ...(onlyMissingData ? { onlyMissingData } : {}) };
  }
  /** 候選因設施被佔而淘汰：計數，並把最近一次的擋住者記進明細 */
  function tallyFacilityBusy(tally: RejectTally): void {
    tally.facilityBusy += 1;
    const blocker = lastBlocker;
    if (!blocker) return;
    tally.facilityBlockers.push({ ...blocker, adjustable: blocker.adjustable ?? Boolean(blocker.blockingBlockId) });
    tally.facilityDetail ??= describeBlocker(blocker);
  }
  /** 組出「撞在哪、想幾點過、有多少挪動空間、誰擋著」 */
  function describeJunctionBlock(
    /** 跟求解用的是<strong>同一組</strong>時刻（已含設施造成的位移） */
    points: Array<{ nodeId: string; instant: number } | null>,
    timelineRow: number,
    minShiftSeconds: number,
    maxShiftSeconds: number,
    /** 這組時刻已經含了多少外部位移（例如等目的設施空出來），寫進說明 */
    appliedShiftSeconds = 0,
  ): string {
    const diagnosis = diagnoseJunctionBlock(junctionQuery(points, timelineRow, minShiftSeconds, maxShiftSeconds));
    const parts = diagnosis.points.map((point) => {
      const label = nodeById.get(point.nodeId)?.label || point.nodeId;
      const blockers = point.bookingsInWindow.map((booking) =>
        `時間線 ${booking.timelineRow} ${formatSecondOfDay(booking.instant)}${booking.reserved ? '（保留）' : ''}`);
      return blockers.length > 0
        ? `${label} 檢查 ${formatSecondOfDay(point.instant)} 經過，搜尋窗內有 ${blockers.join('、')}`
        : `${label} 檢查 ${formatSecondOfDay(point.instant)} 經過`;
    });
    const range = `可挪動範圍 ${Math.round(minShiftSeconds)}～${Math.max(0, Math.round(maxShiftSeconds))} 秒`
      + (appliedShiftSeconds !== 0 ? `（時刻已含等設施空出的位移 ${Math.round(appliedShiftSeconds)} 秒）` : '');
    return `${parts.join('；')}；${range}，每個點要跟別列車差開 ${collisionBufferSeconds} 秒，範圍內每個位移都會碰到其中至少一筆`;
  }
  function describeReject(tally: RejectTally, candidateCount: number): string {
    const parts: string[] = [];
    if (tally.facilityBusy > 0) {
      parts.push(
        `${tally.facilityBusy} 台設施在這段時間被別列車佔著`
        + (tally.facilityDetail ? `（${tally.facilityDetail}）` : ''),
      );
    }
    if (tally.junctionBusy > 0) {
      parts.push(
        `${tally.junctionBusy} 條路徑會跟別列車在同一個轉折點撞上`
        + (tally.junctionDetail ? `（${tally.junctionDetail}）` : ''),
      );
    }
    if (tally.noTime > 0) {
      parts.push(`${tally.noTime} 條路徑的移動時間塞不進這段空檔`);
    }
    if (tally.noPath > 0) {
      parts.push(
        `${tally.noPath} 台設施到不了`
        + (tally.noPathDetail ? `（${tally.noPathDetail}）` : ''),
      );
    }
    if (parts.length === 0) return `${candidateCount} 個候選全數不可用`;
    return `${candidateCount} 個候選都不行——${parts.join('；')}`;
  }

  /**
   * 轉折點碰撞緩衝：不同列車的移動卡經過同一個轉折點（例如多座設施共用的
   * 入廠閘門 T3下行）的時刻，至少要差開 2 倍碰撞保護時間——車是真的走在
   * 實體道路上，不可能兩台同時出現在同一個點，這跟 §8 站位碰撞保護是
   * 同一個道理、同一個數字。
   */
  const collisionBufferSeconds = Math.max(0, collisionProtectionSeconds) * 2;

  /**
   * 整備開始最多可以晚多久＝<strong>車最多可以晚多久才進得到設施</strong>。
   *
   * 這不是 §6 的「整備讓渡」——那條講的是<strong>正線要用時間、整備讓出開頭</strong>，
   * 觸發者是正線。這裡講的是物理：整備要等車真的進到設施才做得起來，
   * 車幾點到，工作就幾點開始。原本只做了一半——「早到就早開工」有，
   * 「晚到就晚開工」沒有，於是「設施要到 00:00 才空出來」加上「整備 00:00
   * 開始」兩個限制一夾，可挪動範圍就是 0 秒，跟別列車撞在同一個轉折點上就無解。
   * 實際上只要晚 30 秒進廠就過了，對一段 90 分鐘的充電根本不算什麼。
   *
   * 上限抓在幾倍碰撞保護時間：夠閃開轉折點、夠等前一台車讓出設施就好。
   * 真的要等更久，那是設施不足或時段安排的問題，該回報讓使用者去調，
   * 不是把整備的工作時間吃光。
   */
  /**
   * 設施格交接：兩台車在同一格一出一進，至少要隔 2 × 碰撞保護（跟最終驗證
   * FACILITY_HANDOVER_GAP 同一條規則）。
   *
   * 只檢查<strong>正在挪的那一端</strong>，而且由<strong>進格的那一方讓</strong>：入廠／
   * 轉場入格時看「進格前」這段有沒有別列車剛離開，被擋就把進格時刻往後找。離格方
   * 照原訂時刻走不檢查（別人的進格時刻此時可能還沒定案，先處理的一方若因此被判
   * 不能離格，就會排不出轉場）；只有為了閃避而多留時，才不能留到擋住別人。
   * 整段停留另一端的時刻是別處定案、挪不動的，拿緩衝重驗那一端只會把格子判成全滿。
   */
  let handoverEnforced = true;
  function handoverEdgeIsClear(
    facilityNodeId: string,
    timelineRow: number,
    edgeSecond: number,
    side: 'entering' | 'leaving',
  ): boolean {
    if (collisionBufferSeconds <= 0 || !handoverEnforced) return true;
    lastBlocker = null;
    const [from, to] = side === 'entering'
      ? [edgeSecond - collisionBufferSeconds, edgeSecond]
      : [edgeSecond, edgeSecond + collisionBufferSeconds];
    return facilityBookingIsFree(facilityNodeId, timelineRow, from, to, collisionBufferSeconds);
  }
  /**
   * 整備開始最多可以晚多久：<strong>使用者設定的讓渡餘裕</strong>（整備設定的各區段）。
   * 沒有傳設定的呼叫端（單元測試、舊路徑）才退回「幾倍碰撞保護時間」。
   */
  function yardStartPushLimitSeconds(taskType: string): number {
    if (args.maintenanceEntrySlackBySection) {
      return resolveMaintenanceEntrySlackSeconds(taskType as TaskTypeKey, args.maintenanceEntrySlackBySection);
    }
    return Math.max(60, collisionBufferSeconds * 4);
  }
  /**
   * 移動（入廠晚到、整備間轉場）之後整備至少要留下的工作時間：不能是零就好（使用者 2026-09-30：
   * 模板不會替移動留時間，移動可以佔用後一段作業的開頭，低於設定作業時長時逐筆揭露）。
   */
  function minimumYardWorkSeconds(taskType: string): number {
    void taskType;
    return nonZeroYardWorkSeconds();
  }
  /** 整備設定裡的作業時長（沒有設定的是一個刻度）；只用來在報告裡對照 */
  function configuredWorkSeconds(taskType: string): number {
    return minimumYardWorkSecondsFor(taskType, maintenanceBody);
  }
  /**
   * reserved：呼叫端事先保留、那一列還沒真的排出移動的經過時刻。
   * owner：這次經過是為了哪一張整備卡、停哪個設施（排不出時回報「被誰擋」，呼叫端可以請它換位置）。
   */
  type JunctionBooking = {
    nodeId: string;
    instant: number;
    timelineRow: number;
    reserved?: boolean;
    owner?: { blockId: string; facilityNodeId: string };
  };
  const junctionBookings: JunctionBooking[] = [];
  if (collisionBufferSeconds > 0) {
    for (const pass of args.reservedJunctionPasses ?? []) junctionBookings.push({ ...pass, reserved: true });
  }

  /**
   * 兩個時刻在日循環上的最短間距——23:59:50 與 00:00:10 相差 20 秒，
   * 不是 23 小時 59 分。跨午夜的移動卡時刻會落在 1440 分以上，
   * 直接相減會把「其實只差 20 秒」算成「差了一整天」，碰撞就漏掉了。
   */
  function cyclicGapSeconds(a: number, b: number): number {
    const raw = Math.abs(a - b) % daySeconds;
    return Math.min(raw, daySeconds - raw);
  }

  function junctionIsFree(nodeId: string, instant: number, timelineRow: number): boolean {
    if (collisionBufferSeconds <= 0) return true;
    return !junctionBookings.some((b) =>
      b.nodeId === nodeId
      && b.timelineRow !== timelineRow
      && cyclicGapSeconds(b.instant, instant) < collisionBufferSeconds - 1e-9);
  }

  function bookJunction(
    nodeId: string,
    instant: number,
    timelineRow: number,
    owner?: { blockId: string; facilityNodeId: string },
  ): void {
    if (collisionBufferSeconds <= 0) return;
    // 這一列真的排出經過這個點的移動了：它自己在這個點的保留就作廢（時刻可能已經不同），
    // 不然沒人用的舊保留會繼續擋住別列車的搜尋
    for (let index = junctionBookings.length - 1; index >= 0; index -= 1) {
      const booking = junctionBookings[index]!;
      if (booking.reserved && booking.timelineRow === timelineRow && booking.nodeId === nodeId) {
        junctionBookings.splice(index, 1);
      }
    }
    junctionBookings.push({ nodeId, instant, timelineRow, ...(owner ? { owner } : {}) });
  }

  /**
   * 轉折點排不出時，記下可挪範圍內擋路的那幾筆預約是誰的移動。
   * 只記有 owner 的（真的排出來的移動）；呼叫端保留的經過時刻不是任何一張卡，請不走。
   */
  function tallyJunctionBlockers(
    tally: RejectTally,
    points: Array<{ nodeId: string; instant: number } | null>,
    timelineRow: number,
    minShiftSeconds: number,
    maxShiftSeconds: number,
  ): void {
    for (const point of points) {
      if (!point) continue;
      for (const booking of junctionBookings) {
        if (!booking.owner || booking.nodeId !== point.nodeId || booking.timelineRow === timelineRow) continue;
        const inWindow = [-daySeconds, 0, daySeconds].some((wrap) => {
          const at = booking.instant + wrap;
          return at > point.instant + minShiftSeconds - collisionBufferSeconds - 1e-9
            && at < point.instant + maxShiftSeconds + collisionBufferSeconds + 1e-9;
        });
        if (!inWindow) continue;
        if (tally.junctionBlockers.some((item) => item.blockingBlockId === booking.owner!.blockId)) continue;
        tally.junctionBlockers.push({
          kind: 'junction',
          role: 'junction',
          adjustable: true,
          nodeId: booking.owner.facilityNodeId,
          junctionNodeId: point.nodeId,
          blockingRow: booking.timelineRow,
          blockingBlockId: booking.owner.blockId,
          occupiedFrom: booking.instant,
          occupiedTo: booking.instant,
          wantedFrom: point.instant,
          wantedTo: point.instant,
          requiredGapSeconds: collisionBufferSeconds,
        });
      }
    }
  }
  /** 失敗紀錄的擋路者：設施被佔的與轉折點被訂走的一起交出去 */
  function blockersOf(tally: RejectTally): {
    blockers?: TransferBlocker[];
    departureWindow?: NonNullable<MaintenanceTransferCardsResult['skipped'][number]['departureWindow']>;
  } {
    const seen = new Set<string>();
    const all = [...tally.limitBlockers, ...tally.junctionBlockers, ...tally.facilityBlockers].filter((item) => {
      const key = `${item.role ?? item.kind}|${item.blockingBlockId ?? item.blockingRow}|${item.nodeId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return {
      ...(all.length > 0 ? { blockers: all.slice(0, 12) } : {}),
      ...(tally.departureWindow ? { departureWindow: tally.departureWindow } : {}),
    };
  }

  /**
   * 轉折點撞上時<strong>把時刻挪開</strong>，不是放棄。
   *
   * 多座設施共用一個入廠閘門，兩台車先後進廠當然會在那個點碰頭——那是常態，
   * 不是「排不出來」。原本一撞就整張卡作廢、回報「1 條路徑會跟別列車在同一個
   * 轉折點撞上」，等於把該由排班解掉的事丟回給使用者（2026-08-10 使用者指正：
   * 「我很清楚這樣一定會撞到，所以才需要排班調度演算法去做優化解」）。
   *
   * 可挪的範圍由呼叫端給（例如入廠卡：最早可以走的時刻 ～ 再晚就趕不上整備開始）。
   * 候選不用盲掃：會擋路的就是那幾筆既有預約，答案一定緊貼在它們的緩衝邊緣上，
   * 所以只試「零位移」與各筆預約的前後緣，取位移量最小的那一個。
   *
   * @returns 相對 baseInstant 的位移秒數；範圍內無解回傳 null
   */
  function junctionQuery(
    points: Array<{ nodeId: string; instant: number } | null>,
    timelineRow: number,
    minShiftSeconds: number,
    maxShiftSeconds: number,
  ): JunctionShiftQuery {
    return {
      points,
      bookings: junctionBookings,
      timelineRow,
      minShift: minShiftSeconds,
      maxShift: maxShiftSeconds,
      bufferSeconds: collisionBufferSeconds,
      daySeconds,
      alignSeconds: SHIFT_SCHEDULE_CLOCK_ALIGN_SECONDS,
    };
  }
  function resolveJunctionShiftSeconds(
    /** 這一趟移動會經過的轉折點與經過時刻；時刻跟出發時刻是等量平移的關係 */
    points: Array<{ nodeId: string; instant: number } | null>,
    timelineRow: number,
    minShiftSeconds: number,
    maxShiftSeconds: number,
  ): number | null {
    return solveJunctionShift(junctionQuery(points, timelineRow, minShiftSeconds, maxShiftSeconds));
  }

  /**
   * 從一條路徑取「設施專屬邊之外、其他列車也可能經過的那個轉折點」，
   * 跟經過那一刻的時間——跟出廠／入廠卡分界點用的是同一種「設施專屬邊」
   * 概念（見檔案開頭說明），只是這裡要的是那個邊另一端的轉折點本身。
   * 沒有邊（起訖點就是同一個節點）時退回起訖點本身，仍要佔用/檢查它。
   */
  function resolveGatewayFromPath(
    path: { edges: PointTopologyEdge[] },
    referenceInstant: number,
    direction: 'arriving-at-facility' | 'leaving-facility',
    fallbackNodeId: string,
  ): { nodeId: string; instant: number } {
    if (path.edges.length === 0) return { nodeId: fallbackNodeId, instant: referenceInstant };
    if (direction === 'arriving-at-facility') {
      const lastEdge = path.edges[path.edges.length - 1]!;
      return { nodeId: lastEdge.fromNodeId, instant: referenceInstant - edgeSeconds(lastEdge, 'avg') };
    }
    const firstEdge = path.edges[0]!;
    return { nodeId: firstEdge.toNodeId, instant: referenceInstant + edgeSeconds(firstEdge, 'avg') };
  }

  // 前一次 decideOnly 呼叫的結果，哪些要沿用、哪些要重算：
  //
  // <strong>佔了正線停靠站的待命必須原封不動</strong>——站位求解器整個收斂迴圈
  // 都是照那個地點在閃避的，這時候改地點等於推翻求解結果。
  //
  // 其餘的（停設施格的）<strong>重新決定</strong>：迴圈會推移時刻，用迴圈前的
  // 舊時刻挑出來的設施，到這時候可能已經不適用了。它們不佔正線站位，
  // 重挑不會動搖求解器的任何前提。
  for (const timeline of timelines) {
    for (const block of timeline.blocks) {
      if (!YARD_TASK_TYPES.has(block.taskType)) continue;
      const nodeId = block.yardFacilityNodeId;
      if (!nodeId || yardBlockFacility.has(block.id)) continue;
      if (block.yardFacilityStationId) {
        assignYardFacility(block, nodeId, block.yardFacilityLabel ?? nodeId);
      } else if (!decideOnly) {
        block.yardFacilityNodeId = undefined;
        block.yardFacilityLabel = undefined;
      }
    }
  }

  // ---- 決定去哪：先真整備、後待命 ----
  //
  // 這一段<strong>只決定每一段整備停在哪一台設施／哪一個停靠站</strong>，
  // 不產生任何卡片。抽出來獨立跑有兩個理由：
  //
  // 1. <strong>設施優先</strong>：真正需要那套設備的任務（充電要充電樁、保養要
  //    維修坑）必須先挑；待命只是來調節位置的，拿剩下的就好。原本選設施散在
  //    入廠／轉場／出廠三個 pass 裡，一段整備由哪個 pass 先碰到它決定，
  //    先後順序取決於它在串裡的位置，不是任務的重要性——待命會把樁佔走。
  // 2. <strong>待命的選點邏輯跟其他整備相反</strong>：其他整備是「設備在哪就得去
  //    哪」，待命是「下一步要去哪，就先待在順路的地方」。待命是調節位置用的，
  //    要看的是<strong>出去</strong>的成本，不是進來的成本。
  //
  // 兩者共用同一個成本函式：<strong>進來 + 出去的總移動秒數最小</strong>。
  // 同區域轉場是 0 秒，所以「待在下一站同一區」會自然勝出；待命若原地不動，
  // 進來那段也是 0 秒，一樣自然浮出來，不需要另外寫特例。

  /** 兩點之間的移動秒數；同一個 Area 視為 0 秒示意轉移，到不了回 null */
  /**
   * 路徑的<strong>外部成本</strong>：這條路會從別的班次身上拿走多少時間。
   *
   * 挑設施原本只比「移動時間」，比不出「這條路徑會連累多少人」。於是兩個看起來
   * 相鄰的點，引擎會為了走得通而繞一大圈——那幾百秒車一直在路網上，
   * 每經過一個共用轉折點就把那個點鎖住 2 倍碰撞保護時間，別的車那段時間過不去。
   *
   * 曾經想用「超過 N 秒就拒絕」來擋，被使用者正確地否決：那個 N 是從當下這張
   * 地圖反推出來的，換一張圖就會把合法路徑判成到不了（2026-08-11，已 revert）。
   * 正解是<strong>把代價算進成本</strong>——路徑越複雜、經過的共用點越多，
   * 成本自然越高，這條分支就在最佳化時被剪掉，不需要任何絕對門檻，
   * 量綱也跟著地圖與使用者設定的碰撞保護時間縮放。
   *
   * 中途節點數 ＝ 邊數 − 1（頭尾是起訖點，不算「經過」）。
   */
  function pathExternalitySeconds(path: { edges: PointTopologyEdge[] }): number {
    if (collisionBufferSeconds <= 0) return 0;
    return Math.max(0, path.edges.length - 1) * collisionBufferSeconds;
  }

  /**
   * 挑設施時用來<strong>比較</strong>的成本＝實際移動時間 ＋ 外部成本。
   *
   * 只用在比較。卡片上寫的、時刻推算用的仍然是<strong>實際移動時間</strong>
   * （<code>path.avgSeconds</code>）——外部成本是決策用的權重，不是車真的多花的時間，
   * 混用會讓抵達時刻算錯。
   */
  function pathDecisionCost(path: { edges: PointTopologyEdge[]; avgSeconds: number }): number {
    return path.avgSeconds + pathExternalitySeconds(path);
  }

  /** 挑地點時用的比較成本（含外部性）；到不了回 null */
  function moveDecisionCost(fromNodeId: string | null, toNodeId: string | null): number | null {
    if (!fromNodeId || !toNodeId) return null;
    if (fromNodeId === toNodeId) return 0;
    const fromArea = facilityAreaId.get(fromNodeId);
    const toArea = facilityAreaId.get(toNodeId);
    const path = findTopologyPath(topology, fromNodeId, toNodeId);
    // 到不了就是到不了，同區域也一樣（實錄：同區域的備用停靠位被當成 0 成本，待命停進去之後到不了充電樁）
    if (!path) return null;
    // 保留同區域的選位偏好；這個排序權重不能當成實際移動秒數。
    if (fromArea && fromArea === toArea) return 0;
    return pathDecisionCost(path);
  }

  /**
   * 實際移動秒數。只有同一個節點是 0；不同節點沒有路徑（或路徑缺行駛時間）就是到不了，
   * 同一個 Area 也一樣——Area 是地圖上的容器，不代表裡面任兩點之間可以瞬間抵達。
   * （同 Area 的「選位偏好」留在 moveDecisionCost，那是排序權重，不是時間。）
   */
  function moveSeconds(fromNodeId: string | null, toNodeId: string | null): number | null {
    if (!fromNodeId || !toNodeId) return null;
    if (fromNodeId === toNodeId) return 0;
    const path = findTopologyPath(topology, fromNodeId, toNodeId);
    return path ? path.avgSeconds : null;
  }

  /** 這一段整備的前一個／後一個「車必須在那裡」的位置；查不到回 null（該段成本不計） */
  function resolveAnchor(
    sorted: GeneratedScheduleBlock[],
    index: number,
    direction: 'prev' | 'next',
  ): string | null {
    const find = direction === 'prev' ? findPrevCyclic : findNextCyclic;
    // 相鄰整備還沒定案就跳過它、繼續找下一個有地點的——車最後總要到那裡，
    // 只看緊鄰那一段會漏掉「這個位置根本到不了下一個定案地點」（實錄：待命挑了到不了充電樁的停靠位）
    const hit = find(
      sorted,
      index,
      (b) => b.taskType === 'passenger' || (YARD_TASK_TYPES.has(b.taskType) && yardBlockFacility.has(b.id)),
    );
    if (!hit) return null;
    if (hit.block.taskType === 'passenger') {
      // 正線：前一段看它的終點站，下一段看它的起點站
      const routeId = hit.block.routeId;
      if (!routeId) return null;
      const stationId = direction === 'prev'
        ? routeEndStation.get(routeId)
        : routeStartStation.get(routeId);
      return stationId ? nodeIdByStationId.get(stationId) ?? null : null;
    }
    // 相鄰（已定案）的整備：用它的設施
    return yardBlockFacility.get(hit.block.id)?.nodeId ?? null;
  }

  /**
   * 依「進來 + 出去總移動最小」挑一個位置，並確認整段時間都空得下來。
   * 到不了的候選直接淘汰；兩邊都查不到錨點時退回「隨便一個空的」。
   */
  function pickLocationForStay(
    yard: GeneratedScheduleBlock,
    timelineRow: number,
    candidates: ReadonlyArray<{ id: string; label?: string }>,
    prevAnchor: string | null,
    nextAnchor: string | null,
    /** 車最早可以離開上一段的時刻；入廠卡會用它算提前抵達，null＝無從得知 */
    freeSecond: number | null,
  ): { nodeId: string; label: string } | null {
    let best: { nodeId: string; label: string; tier: number; cost: number } | null = null;
    const startSecond = minuteToSecond(yard.plannedStartMinute);
    /**
     * 檢查窗口要問到<strong>車真正開走</strong>，不是整備結束。
     *
     * 兩者必須用同一個定義——預約鎖到車開走（見 assignYardFacility），挑格子時卻只
     * 問到整備結束的話，「做完了還沒走」那段就會被判定成空的。實測（2026-08-24）
     * 剩下的四筆重疊全是這樣來的：擋人的都是待命，而待命在指派順序上排最後，它自己
     * 的整備窗不與後車重疊，重疊的是它結束之後還沒開走的那幾分鐘。
     */
    const endSecond = vehicleLeavesFacilityAtSecond(yard);
    const traced: Array<Record<string, unknown>> | null = engineTraceEnabled() ? [] : null;
    const avoided = avoidedSpotsFor(yard.id);
    for (const candidate of candidates) {
      if (avoided.has(candidate.id)) {
        traced?.push({ id: candidate.id, reject: 'avoided' });
        continue;
      }
      // 抵達時刻要用<strong>實際</strong>移動時間；排名要用含外部性的比較成本。
      // 兩者混用的話，外部成本會被當成車真的多花的時間，抵達時刻就算錯了。
      const inSeconds = prevAnchor ? moveSeconds(prevAnchor, candidate.id) : 0;
      const inCost = prevAnchor ? moveDecisionCost(prevAnchor, candidate.id) : 0;
      const outCost = nextAnchor ? moveDecisionCost(candidate.id, nextAnchor) : 0;
      // 錨點存在卻到不了 → 這個候選不能用（車開不過去／開不出來）
      if (inSeconds === null || inCost === null || outCost === null) {
        traced?.push({ id: candidate.id, reject: 'unreachable' });
        continue;
      }
      // 入廠卡會讓車<strong>提前抵達</strong>，車一到就佔著那一格——保留窗口必須
      // 從「實際抵達」算起，不能只鎖 [整備開始, 結束]。少鎖這段頭部的話，
      // 別列車會被排進那個空隙，等到要產生入廠卡時才發現位置被佔、整張卡作廢。
      const arriveSecond = freeSecond === null ? startSecond : freeSecond + inSeconds;
      const holdFrom = Math.min(startSecond, arriveSecond);
      if (!stayFacilityIsFree(candidate.id, yard, timelineRow, holdFrom, endSecond)) {
        traced?.push({ id: candidate.id, reject: 'busy' });
        continue;
      }
      // 設施格永遠優先於正線停靠站，跟移動成本無關。
      //
      // 純比移動時間的話停靠站必勝：車跑完正線就停在那一格，成本 0，任何設施
      // 都 > 0——待命於是系統性地選擇「原地不動」，而原地就是終端站最忙的站位。
      // 壓住正線一格是要付營運代價的（那條路線那段時間排不了車），移動個幾分鐘
      // 進設施才是便宜的選項。所以先分層、層內才比移動成本：停靠站是
      // <strong>沒設施可去時的退路</strong>，不是預設解。
      const tier = nodeById.get(candidate.id)?.kind === 'docking' ? 1 : 0;
      const cost = inCost + outCost;
      traced?.push({ id: candidate.id, tier, inCost, outCost });
      if (!best || tier < best.tier || (tier === best.tier && cost < best.cost)) {
        best = { nodeId: candidate.id, label: candidate.label || candidate.id, tier, cost };
      }
    }
    if (traced) {
      engineTrace('stay-pick', {
        decideOnly, row: timelineRow, blockId: yard.id, taskType: yard.taskType,
        prevAnchor, nextAnchor, picked: best?.nodeId ?? null, candidates: traced,
      });
    }
    return best ? { nodeId: best.nodeId, label: best.label } : null;
  }

  /** 依時刻排好的（時間線、區塊、該線排序、索引），供兩階段指派共用 */
  const yardSlots: Array<{
    timeline: GeneratedSchedulePlan['timelines'][number];
    block: GeneratedScheduleBlock;
    sorted: GeneratedScheduleBlock[];
    index: number;
  }> = [];
  for (const timeline of timelines) {
    const sorted = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );
    sorted.forEach((block, index) => {
      if (!YARD_TASK_TYPES.has(block.taskType)) return;
      yardSlots.push({ timeline, block, sorted, index });
    });
  }
  yardSlots.sort((a, b) => a.block.plannedStartMinute - b.block.plannedStartMinute);

  for (const priorityPhase of ['facility-first', 'standby-last'] as const) {
    for (const slot of yardSlots) {
      const isStandby = slot.block.taskType === 'standby';
      if ((priorityPhase === 'facility-first') === isStandby) continue;
      if (yardBlockFacility.has(slot.block.id)) continue;

      const candidates = facilityNodesFor(slot.block.taskType);
      if (candidates.length === 0) continue;   // 沒設施的情形由收尾補掃回報

      // 跟入廠卡同一套算法：前一段載客跑完 + 最低恢復時間才是車能走的時刻
      const prevPax = findPrevCyclic(
        slot.sorted,
        slot.index,
        (b) => b.taskType === 'passenger',
      );
      const freeSecond = prevPax
        ? minuteToSecond(prevPax.block.plannedEndMinute + prevPax.offsetMinute)
          + Math.max(0, minimumRecoveryTimeSeconds)
        : null;

      const picked = pickLocationForStay(
        slot.block,
        slot.timeline.row,
        candidates,
        resolveAnchor(slot.sorted, slot.index, 'prev'),
        resolveAnchor(slot.sorted, slot.index, 'next'),
        freeSecond,
      );
      if (picked) assignYardStay(slot.block, picked.nodeId, picked.label);
    }
  }

  if (decideOnly) {
    return {
      timelines, inserted, ateYardTail, yardHeadExtended, laterTaskCompressed, yardWorkShortened,
      skipped, facilityUnavailable, facilityYields, entryEarlyBlocked, standbyRelocations,
    };
  }

  // ---- 入廠：只在串首補，開始時刻提前、結束不動 ----
  for (const timeline of timelines) {
    const sorted = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );
    for (let i = 0; i < sorted.length; i += 1) {
      const yard = sorted[i]!;
      if (!YARD_TASK_TYPES.has(yard.taskType)) continue;
      // 連續整備串只在串首入廠：左鄰居是別種整備由轉場處理，同種整備不需要。
      // 「左鄰居」要照日循環算——當日第一段的左鄰居是當日最後一段。
      const prevNeighbor = immediatePrevCyclic(sorted, i);
      if (prevNeighbor && YARD_TASK_TYPES.has(prevNeighbor.block.taskType)) continue;

      // 往回找最近一段載客，找不到就繞回當日最後一段（同一台車前一天的尾巴）
      const prevPax = findPrevCyclic(sorted, i, (b) => b.taskType === 'passenger');
      const previousPassenger = prevPax?.block;
      if (!prevPax) {
        // 這一列整天沒有前面的載客任務——要有「車前一刻在哪」的依據才算不需要；
        // 找不到依據就當必要轉場失敗，不假設車本來就在格子裡。
        const basis = describeYardOnlyNeighborBasis(sorted, i, 'prev');
        skipped.push(basis
          ? {
            timelineRow: timeline.row,
            blockId: yard.id,
            taskType: yard.taskType,
            reason: `這一列整天沒有載客班次；${basis}，不需要入廠卡`,
            necessity: 'not_needed',
          }
          : {
            timelineRow: timeline.row,
            blockId: yard.id,
            taskType: yard.taskType,
            reason: '這一列整天沒有載客班次，前一刻也查不出車停在哪，無從排入廠卡',
          });
        continue;
      }
      if (!previousPassenger?.routeId) {
        // 沉默略過的話，畫面上就是「這段整備沒有入廠卡」，跟排不出來、
        // 跟同區域 0 秒轉移長得一模一樣。要卡而給不出卡，一律講原因。
        skipped.push({
          timelineRow: timeline.row,
          blockId: yard.id,
          taskType: yard.taskType,
          reason: '前一段載客沒有路線代號，查不出它停在哪一站，無從算入廠路徑',
        });
        continue;
      }
      const stationId = routeEndStation.get(previousPassenger.routeId);
      const fromNodeId = stationId ? nodeIdByStationId.get(stationId) : undefined;
      if (!fromNodeId) {
        skipped.push({
          timelineRow: timeline.row,
          blockId: yard.id,
          taskType: yard.taskType,
          reason: `前一段載客的終點站在拓樸上找不到對應節點（${stationDisplayName(stationId)}）`,
        });
        continue;
      }

      const allFacilities = facilityNodesForBlock(yard);
      if (allFacilities.length === 0) {
        skipped.push({
          timelineRow: timeline.row,
          blockId: yard.id,
          taskType: yard.taskType,
          reason: '整備任務沒設定這一類的設施，或設施不在拓樸上',
        });
        continue;
      }
      /**
       * <strong>進不去就換一格，不要在外面乾等。</strong>
       *
       * 挑設施時把「提早抵達」算進了窗口（{@link pickLocationForStay} 的 holdFrom），
       * 但下訂位只鎖 [整備開始, 結束]，提早那一段從來沒被真的訂下來；加上指派順序是
       * 設施類優先、待命最後，於是排得出這種版面（2026-08-19 實測）：列6 的充電挑
       * 到 E3 時 E3 從 08:37 起是空的，之後列4 的待命看到 E3 在 07:30–09:00 沒人訂
       * 就進去了，等到要生入廠卡，列6 已經進不去——車只好在別的格子乾等 22 分鐘，
       * 班表上就是「一張空的入場卡、一大段等待、又一張入場卡、才開始充電」。
       *
       * 使用者（2026-08-19）：「你很擺明第一張是要進去充電站的，為什麼不是第一張
       * 就進去，然後把充電卡拉到該入場卡後呢？」
       *
       * 所以在產生卡片之前先補一刀：本來排定的那一格若在車抵達的當下就有人，
       * 而同一類設施裡有另一格<strong>從抵達到整備結束都空著</strong>，就換過去。
       * 只動這一台、只在真的進不去時才動——不像「全場預留頭部」那樣讓設施憑空
       * 變稀缺（那個版本實測 warning 162 → 219，還多一筆硬錯誤）。
       */
      {
        const current = yardBlockFacility.get(yard.id);
        const freeSec =
          minuteToSecond(previousPassenger.plannedEndMinute + prevPax.offsetMinute)
          + Math.max(0, minimumRecoveryTimeSeconds);
        const yardStartSec = minuteToSecond(yard.plannedStartMinute);
        const yardEndSec = minuteToSecond(yard.plannedEndMinute);
        const currentPath = current
          ? findTopologyPath(topology, fromNodeId, current.nodeId)
          : null;
        const idealArrive = currentPath ? freeSec + currentPath.avgSeconds : yardStartSec;
        const blockedNow =
          current != null
          && idealArrive < yardStartSec - 1e-9
          && !stayFacilityIsFree(current.nodeId, yard, timeline.row, idealArrive, yardEndSec);
        if (blockedNow) {
          let alternative: { id: string; label: string; seconds: number } | null = null;
          for (const facility of allFacilities) {
            if (facility.id === current!.nodeId) continue;
            // 整備要進實體設施格，不能佔正線停靠站當工作區
            if (nodeById.get(facility.id)?.kind === 'docking') continue;
            const path = findTopologyPath(topology, fromNodeId, facility.id);
            if (!path) continue;
            const arrive = freeSec + path.avgSeconds;
            // 換過去也還是不能提早的話，換了沒有意義
            if (arrive >= yardStartSec - 1e-9) continue;
            if (!stayFacilityIsFree(facility.id, yard, timeline.row, arrive, yardEndSec)) continue;
            if (!alternative || path.avgSeconds < alternative.seconds) {
              alternative = {
                id: facility.id,
                label: (facility.label ?? '').trim() || facility.id,
                seconds: path.avgSeconds,
              };
            }
          }
          if (alternative) {
            assignYardStay(yard, alternative.id, alternative.label);
          } else {
            /**
             * <strong>擋在頭上的是「待命」的話，請它讓開。</strong>
             *
             * 使用者（2026-08-18）：「你在設施使用的時候當然不能互換，但你是待命的
             * 當然哪裡都可以去」。待命只是站在那裡等，沒有非在某一格不可的理由；
             * 充電／保養／行檢是一到就要開工的，被待命佔著頭就只能在外面乾等。
             *
             * 實測（2026-08-19）：列6 08:37 就跑完了，四支充電樁在 08:37–10:30 之間
             * 全都有事，唯一能讓它提早進去的是 E3——而 E3 那段時間坐著列4 的待命。
             * 待命挪走，列6 就能一到就開充，不必先借別格站 22 分鐘。
             *
             * 只挪到<strong>另一個實體設施格</strong>。挪去正線停靠站會改變車做完
             * 待命之後的所在地，下一趟就發不了車（實測會直接變成
             * YARD_EXIT_STATION_MISMATCH 硬錯誤）。
             */
            const squatters: GeneratedScheduleBlock[] = [];
            for (const timelineItem of timelines) {
              for (const other of timelineItem.blocks) {
                if (other.taskType !== 'standby') continue;
                if (other.yardFacilityNodeId?.trim() !== current!.nodeId) continue;
                if (minuteToSecond(other.plannedEndMinute) <= idealArrive + 1e-9) continue;
                if (minuteToSecond(other.plannedStartMinute) >= yardStartSec - 1e-9) continue;
                squatters.push(other);
              }
            }
            const moves: Array<{ block: GeneratedScheduleBlock; id: string; label: string }> = [];
            for (const squatter of squatters) {
              const row = timelines.find((item) => item.blocks.includes(squatter))?.row;
              if (row == null) break;
              let target: { id: string; label: string } | null = null;
              for (const facility of facilityNodesFor('standby')) {
                if (facility.id === current!.nodeId) continue;
                if (nodeById.get(facility.id)?.kind !== 'facility') continue;
                if (
                  !stayFacilityIsFree(
                    facility.id,
                    squatter,
                    row,
                    minuteToSecond(squatter.plannedStartMinute),
                    minuteToSecond(squatter.plannedEndMinute),
                  )
                ) continue;
                target = { id: facility.id, label: (facility.label ?? '').trim() || facility.id };
                break;
              }
              if (!target) { moves.length = 0; break; }
              moves.push({ block: squatter, id: target.id, label: target.label });
            }
            // 全部挪得動才動——挪一半等於把問題換個地方發生
            if (squatters.length > 0 && moves.length === squatters.length) {
              for (const move of moves) assignYardStay(move.block, move.id, move.label);
            }
          }
        }
      }

      // 地點已由「決定去哪」階段定案，這裡只負責產生卡片——不能再自己挑一台，
      // 否則入廠卡會指向 A、出廠卡指向 B，車等於中途瞬移換格子。
      const assigned = yardBlockFacility.get(yard.id);
      const facilities = assigned
        ? allFacilities.filter((f) => f.id === assigned.nodeId)
        : allFacilities;
      if (facilities.length === 0) {
        skipped.push({
          timelineRow: timeline.row,
          blockId: yard.id,
          taskType: yard.taskType,
          reason: `設施已定案在 ${assigned!.label}，但入廠方向到不了`,
        });
        continue;
      }

      const freeSecond = minuteToSecond(previousPassenger.plannedEndMinute + prevPax.offsetMinute)
        + Math.max(0, minimumRecoveryTimeSeconds);
      const yardStartSecond = minuteToSecond(yard.plannedStartMinute);
      const yardEndSecond = minuteToSecond(yard.plannedEndMinute);
      if (freeSecond >= yardEndSecond - 1e-9) {
        // 車跑完正線的時候整備視窗<strong>整段都過去了</strong>，怎麼讓都塞不下。
        skipped.push({
          timelineRow: timeline.row,
          blockId: yard.id,
          taskType: yard.taskType,
          reason:
            `整備視窗整段都在車跑完正線之前（前一段載客 ${formatSecondOfDay(freeSecond)} 才空出來、`
            + `整備 ${formatSecondOfDay(yardStartSecond)}–${formatSecondOfDay(yardEndSecond)}），塞不進任何移動`,
        });
        continue;
      }
      let chosen: {
        nodeId: string; label: string; seconds: number;
        /** 含外部性的比較成本；只用來排名，不是車真的花的時間 */
        decisionCost: number;
        departureSecond: number;
        gatewayNodeId: string; gatewayInstant: number;
        /** 這條路徑實際途經的節點名稱（含起訖），給卡片顯示分段用 */
        viaLabels: string[];
      } | null = null;
      let tally = newTally();
      /**
       * 候選池：先用「決定去哪」定案的位置。待命在那裡排不出入廠（路程塞不進空檔、位置被佔）時，
       * 再試待命清單上其他允許、到得了的位置——換位置是整組重算：入廠卡指向新位置，停留整段
       * 改佔新位置（assignYardStay），之後的轉場與出廠階段都沿用新位置，不只改設施欄位。
       * 只對待命做：真整備的設施是「設備在哪就得去哪」，不能隨便換。
       */
      const pools: Array<typeof facilities> = [facilities];
      if (assigned && yard.taskType === 'standby') {
        const avoided = avoidedSpotsFor(yard.id);
        const alternatives = allFacilities
          .filter((item) => item.id !== assigned.nodeId && !avoided.has(item.id))
          .map((item) => ({ item, cost: moveDecisionCost(fromNodeId, item.id) }))
          .filter((entry): entry is { item: typeof entry.item; cost: number } => entry.cost !== null)
          .sort((x, y) => x.cost - y.cost)
          .map((entry) => entry.item);
        if (alternatives.length > 0) pools.push(alternatives);
      }
      let firstTally: RejectTally | null = null;
      let relocated = false;
      for (const [poolIndex, pool] of pools.entries()) {
        // 先找守交接間隔的候選；全滅才退一步只求排得出移動（缺移動比交接不足更糟，
        // 交接不足仍由最終驗證 FACILITY_HANDOVER_GAP 擋發布）
        for (const enforceHandover of [true, false]) {
          handoverEnforced = enforceHandover;
          tally = newTally();
          for (const facility of pool) {
            const path = findTopologyPath(topology, fromNodeId, facility.id);
            if (!path) { tallyNoPath(tally, fromNodeId, facility.id); continue; }
            // 車一空出來就走——不站在正線格子上等，能提早進整備格就提早進，
            // 整備跟著提早開始沒有關係（2026-08-10 使用者裁決）。
            // freeSecond 可能是負的（前一段載客在前一天），那就照負的算，
            // 最後整張連整備區塊一起平移一天，避免出現負時刻。
            const preferredDeparture = freeSecond;
            /**
             * 整備開始跟著<strong>實際進廠時刻</strong>走，兩個方向都是。
             *
             * 早到就早開工（原本就有），晚到就晚開工（原本沒有）。這跟整備間轉場的
             * 既有規則是同一條——後一段開始被推遲、結束不動，運輸成本佔的是後一段
             * 自己的工作時間；入廠卡先前只做了一半。
             *
             * 順序上仍然<strong>優先最早</strong>：偏好出發＝車一空出來就走，
             * 設施與轉折點的搜尋都取最小位移，所以只有在真的被擋住時才會超過原訂開始。
             */
            const latestDeparture = Math.min(
              // 讓渡是「讓一點」，不是把整備吃掉——最多往後推幾倍碰撞保護時間，
              // 夠閃開轉折點、夠等前一台車讓出設施就好。真的要等更久，那是設施
              // 不足或時段安排的問題，該回報讓使用者去調，不是把工作時間吃光。
              yardStartSecond + yardStartPushLimitSeconds(yard.taskType),
              yardEndSecond - minimumYardWorkSeconds(yard.taskType),
            ) - path.avgSeconds;
            if (latestDeparture < preferredDeparture - 1e-9) { tally.noTime += 1; continue; }

            /**
             * 這台設施在「抵達 → 整備做完」整段都是空的嗎。
             *
             * 要佔的是車在裡面的全程，檢查窗必須跟佔用窗一致——只檢查頭部那一小段
             * 的話，別列車早就訂走整段的設施還是會被判定成空的。
             */
            const facilityFreeFor = (departure: number) =>
              stayFacilityIsFree(
                facility.id, yard, timeline.row, departure + path.avgSeconds, yardEndSecond,
              )
              && handoverEdgeIsClear(facility.id, timeline.row, departure + path.avgSeconds, 'entering');

            /**
             * 提早到不了就晚一點到，不是整張卡作廢。
             *
             * 前一台車還在這格裡（例如它充到 24:00 才出來），車就沒辦法 23:53 進去；
             * 但整備本來就從 00:00 開始，晚一點出發、剛好 00:00 到，一樣成立。
             * 原本只試「最早出發」一個時刻，一被擋就報「設施被別列車佔著」，
             * 使用者看畫面覺得空蕩蕩卻排不進去（2026-08-10 使用者追問）。
             *
             * 出發時刻越晚，要佔的窗口只會越短、越不可能撞到——這個單調性讓
             * 「最早可行的出發時刻」可以直接二分找出來，不必逐秒掃。
             */
            let departureSecond: number;
            if (facilityFreeFor(preferredDeparture)) {
              departureSecond = preferredDeparture;
            } else if (!facilityFreeFor(latestDeparture)) {
              // 連「剛好趕上整備開始」都塞不進去，那是真的沒位置
              tallyFacilityBusy(tally);
              continue;
            } else {
              let busy = preferredDeparture;
              let free = latestDeparture;
              for (let step = 0; step < 32 && free - busy > 1; step += 1) {
                const mid = (busy + free) / 2;
                if (facilityFreeFor(mid)) free = mid; else busy = mid;
              }
              // 對齊排程 10 秒刻度；對齊後超出可動範圍才退回原秒數
              // 二分停在邊界上方 1 秒內，先試邊界所在的那一格刻度
              const lowest = snapUpToClockAlignSeconds(busy);
              const aligned = facilityFreeFor(lowest) ? lowest : snapUpToClockAlignSeconds(free);
              departureSecond = aligned <= latestDeparture + 1e-9 ? aligned : Math.ceil(free);
            }

            // 轉折點撞上就再往後挪一點（挪到還趕得上整備開始為止）。閘門時刻與
            // 出發時刻是等量平移的關係，位移可以直接在閘門上算完再回推。
            // 往後挪只會讓設施佔用窗更短，不會把剛解好的設施衝突變回來。
            const baseArrive = departureSecond + path.avgSeconds;
            const baseGateway = resolveGatewayFromPath(
              path, baseArrive, 'arriving-at-facility', fromNodeId,
            );
            const shift = resolveJunctionShiftSeconds(
              [baseGateway],
              timeline.row,
              0,
              latestDeparture - departureSecond,
            );
            if (shift === null) {
              tally.junctionBusy += 1;
              tally.junctionDetail ??= describeJunctionBlock(
                [baseGateway], timeline.row, 0, latestDeparture - departureSecond,
              );
              tallyJunctionBlockers(tally, [baseGateway], timeline.row, 0, latestDeparture - departureSecond);
              continue;
            }

            departureSecond += shift;
            const gateway = {
              nodeId: baseGateway.nodeId,
              instant: baseGateway.instant + shift,
            };
            /**
             * <strong>挑設施要一起比「能多早進去」，不是只比「開過去多久」。</strong>
             *
             * 每一台候選設施上面已經二分找出了「最早可行的出發時刻」——那正是
             * 「這台設施讓我多早進得去」。但成本函式只看移動時間與外部性，
             * 完全沒用到它：於是一台讓車 18:30 就能進的遠設施，會輸給一台
             * 要等到 19:00 的近設施，即使多繞的那點路遠比多等半小時划算
             * （2026-08-12 使用者：「因為要選近的地方去佔才對」——近，但也要進得去）。
             *
             * <strong>等待的代價不用寫死係數。</strong>車在等的時候是杵在正線停靠站上，
             * 代價就是<strong>那段時間會擋到幾班車</strong>——直接數該站在這段等待窗內
             * 有幾個載客佔用，再乘以碰撞保護時間，跟路徑外部性用<strong>同一種計價</strong>。
             * 忙站上多等一分鐘很貴，閒站上等再久也不花錢，比例自己會浮現，
             * 不需要任何人去調一個魔術數字。
             */
            const waitSeconds = Math.max(0, departureSecond - preferredDeparture);
            let blockedTrips = 0;
            if (waitSeconds > 1e-9 && stationId) {
              for (const window of mainlineBerthWindows(stationId)) {
                if (
                  cyclicWindowsOverlap(
                    preferredDeparture,
                    departureSecond,
                    window.startSecond,
                    window.endSecond,
                  )
                ) {
                  blockedTrips += 1;
                }
              }
            }
            const waitCost = blockedTrips * collisionBufferSeconds;
            const decisionCost = pathDecisionCost(path) + waitCost;
            if (!chosen || decisionCost < chosen.decisionCost) {
              chosen = {
                nodeId: facility.id, label: facility.label || facility.id, seconds: path.avgSeconds,
                decisionCost,
                departureSecond,
                gatewayNodeId: gateway.nodeId, gatewayInstant: gateway.instant,
                viaLabels: pathViaLabels(path),
              };
            }
          }
          if (chosen) break;
        }
        if (chosen) {
          relocated = poolIndex > 0;
          break;
        }
        firstTally ??= tally;
      }
      handoverEnforced = true;
      if (!chosen) {
        const reportTally = firstTally ?? tally;
        skipped.push({
          timelineRow: timeline.row,
          blockId: yard.id,
          taskType: yard.taskType,
          reason: `排不出入廠卡：${describeReject(reportTally, facilities.length)}`
            + (pools.length > 1 ? `；待命清單上其他 ${pools[1]!.length} 個位置也排不出（${describeReject(tally, pools[1]!.length)}）` : ''),
          ...blockersOf(reportTally),
          ...dataGapFields(...(pools.length > 1 && reportTally !== tally ? [reportTally, tally] : [reportTally])),
        });
        continue;
      }
      if (relocated && assigned && firstTally) {
        standbyRelocations.push({
          timelineRow: timeline.row,
          blockId: yard.id,
          fromLabel: assigned.label,
          toLabel: chosen.label,
          toNodeId: chosen.nodeId,
          reason: describeReject(firstTally, facilities.length),
        });
      }
      /**
       * <strong>「提早進廠」是選配，不是特權。</strong>
       *
       * 使用者當初的要求是「有機會不站格子就先去整備格，提早開始整備並沒有關係」——
       * 關鍵在<strong>有機會</strong>。原本的實作把提早當成無條件的權利：車一有空就
       * 往前佔，結果<strong>排擠掉準時進廠的車</strong>。
       *
       * 實際案例（2026-08-12 使用者查出來的）：EG1926 提早了將近半小時進充電樁，
       * 於是 19:00 準時要充電的 EE1900 沒樁可用——而照時間模板算，充電尖峰同時需求
       * 剛好等於 4 台樁，本來<strong>剛好夠</strong>。提早的那台把別人的位子先坐了。
       *
       * 所以提早只能用<strong>那一格本來就沒人要</strong>的時間：往前拉到別列車的
       * 預約為止就停。拉不動就照原訂時刻進廠，不會比不做這件事更糟。
       */
      const plannedDepartureSecond = chosen.departureSecond;
      const plannedArriveSecond = plannedDepartureSecond + chosen.seconds;
      let arriveSecond = plannedArriveSecond;
      const assignedFacilityId = yard.yardFacilityNodeId?.trim();
      /**
       * <strong>光看「有沒有預約」擋不住排擠。</strong>
       *
       * 前一版只比對既有的設施預約，但被排擠掉的那台<strong>本來就沒拿到設施</strong>，
       * 沒有預約可比——提早的車看到格子是空的就進去了。實測：時間線 7 的充電模板是
       * 20:00–21:30，實際 19:26:40 就進了 E1，於是 19:00–20:30 的 EE1900 沒樁可用。
       *
       * 更糟的是提早會<strong>讓自己也搬不走</strong>：E2、E3 要 19:30 才空，
       * 19:26:40 卡在門檻前四分鐘，於是讓位機制回報「請不走」——提早這個動作
       * 同時製造了問題、又消滅了解法。
       *
       * 所以要看的是<strong>同時段有幾台車要用這批設施</strong>（含還沒拿到格子的），
       * 超過設施數就不准再往前佔。這跟「沒有可用設施」訊息裡算的尖峰需求是同一個數字。
       */
      if (assignedFacilityId && arriveSecond < yardStartSecond - 1e-9) {
        const pool = new Set(facilities.map((item) => item.id));
        const rivals: Array<[number, number]> = [];
        for (const timelineItem of timelines) {
          for (const other of timelineItem.blocks) {
            if (other.id === yard.id) continue;
            if (!YARD_TASK_TYPES.has(other.taskType)) continue;
            if (other.source !== 'template_bar') continue;
            if (!facilityNodesFor(other.taskType).some((node) => pool.has(node.id))) continue;
            rivals.push([
              minuteToSecond(other.plannedStartMinute),
              minuteToSecond(other.plannedEndMinute),
            ]);
          }
        }
        /** 這一刻有幾台別的車要用這批設施 */
        const rivalsAt = (at: number) =>
          rivals.filter(([from, to]) =>
            daySegmentsOf(from, to).some(([s2, e2]) => {
              const t = ((at % daySeconds) + daySeconds) % daySeconds;
              return t >= s2 - 1e-9 && t < e2 - 1e-9;
            })).length;
        // 從最想要的時刻往後退，退到「連自己算進去都還排得下」為止
        const probes = [
          arriveSecond,
          ...rivals.map(([, to]) => to).filter((to) => to > arriveSecond && to < yardStartSecond),
          yardStartSecond,
        ].sort((a, b) => a - b);
        for (const probe of probes) {
          if (rivalsAt(probe) + 1 <= facilities.length) {
            arriveSecond = probe;
            break;
          }
          arriveSecond = yardStartSecond;
        }
      }
      if (assignedFacilityId && arriveSecond < yardStartSecond - 1e-9) {
        for (const booking of bookings) {
          if (booking.facilityNodeId !== assignedFacilityId) continue;
          if (booking.timelineRow === timeline.row) continue;
          if (booking.endSecond <= arriveSecond + 1e-9) continue;
          if (booking.startSecond >= yardStartSecond - 1e-9) continue;
          if (booking.endSecond > arriveSecond) arriveSecond = booking.endSecond;
        }
        if (arriveSecond > yardStartSecond) arriveSecond = yardStartSecond;
        /**
         * <strong>提早被擋下，代價會落到站位上。</strong>
         *
         * 車提早進廠是有原因的——它在正線跑完了、沒地方去。不讓它提早進廠，
         * 它就繼續杵在前一趟的終點站佔著站位，於是「設施不足」被無聲地換成
         * 「站位碰撞」——把使用者最頭痛的兩件事互相搬家，不是解決
         * （2026-08-12 使用者提醒：「那 EG1926 提前進來一定有他的理由吧，
         * 如果有機制取消，那這列車有地方去停等嗎」）。
         *
         * 所以要講出來：本來可以提早多久、被誰擋住、車因此會在哪一站多停多久。
         */
        const blockedSeconds = arriveSecond - plannedArriveSecond;
        if (blockedSeconds > 1e-9) {
          entryEarlyBlocked.push({
            timelineRow: timeline.row,
            blockId: yard.id,
            taskType: yard.taskType,
            facilityLabel: yard.yardFacilityLabel ?? assignedFacilityId,
            blockedMinutes: blockedSeconds / 60,
            waitStationName: stationDisplayName(stationId),
          });
        }
      }
      /**
       * 轉折點預約要用<strong>最後定案</strong>的時刻：上面為了不佔別人的格子可能把抵達往後挪，
       * 經過轉折點的時刻也跟著挪。先前在挪之前就預約，卡片實際經過的時刻跟預約對不上，
       * 別列車照舊預約排進同一刻（2026-09-29 重播：兩列同一秒經過充電洗車入口點）。
       * 挪過之後的時刻撞到別人的預約，就退回原本檢查過的抵達時刻。
       */
      {
        const shift = arriveSecond - plannedArriveSecond;
        if (Math.abs(shift) > 1e-9 && !junctionIsFree(chosen.gatewayNodeId, chosen.gatewayInstant + shift, timeline.row)) {
          arriveSecond = plannedArriveSecond;
          // 退回原本的抵達時刻：先前記下的「提早被擋」不再成立
          for (let k = entryEarlyBlocked.length - 1; k >= 0; k -= 1) {
            if (entryEarlyBlocked[k]!.blockId === yard.id) entryEarlyBlocked.splice(k, 1);
          }
        }
        bookJunction(
          chosen.gatewayNodeId, chosen.gatewayInstant + (arriveSecond - plannedArriveSecond), timeline.row,
          { blockId: yard.id, facilityNodeId: chosen.nodeId },
        );
      }
      const departureSecond = arriveSecond - chosen.seconds;
      /**
       * 出發落在午夜之前（前一段載客在前一天）時，把<strong>卡片與整備區塊
       * 一起</strong>往後平移一天，避免出現負時刻。
       *
       * 平移之後整備記成「開始 23:5x、結束落在 1440 之後」——這正是既有跨夜卡的
       * 表示法，渲染端切成日尾＋日頭兩段，無限捲動下兩段實體相鄰，看起來就是
       * 連續的一張。日循環上的位置完全沒變，只是換一個不會變負數的寫法。
       *
       * 設施佔用表也已經改成日循環比對（moveCardShared.ts），
       * 「23:5x–25:30」與別列車的「00:00–01:30」現在比得出重疊，
       * 不會因為平移而漏判成兩台車佔同一格。
       */
      // 前一段載客在前一天（日循環繞回來）時一律平移，不只看出發是否落在午夜前：
      // 為了等設施交接而晚到午夜之後出發時，卡片若記在 00:0x 那一端，就跟前一天
      // 23:4x 的末班不相鄰——暫停卡補不上那段站上等待、站位佔用也看不到它
      const dayShiftMinute = departureSecond < 0 || prevPax.offsetMinute < 0
        ? SCHEDULE_DAY_MINUTES
        : 0;
      const card: GeneratedScheduleBlock = {
        id: `yardentry-${yard.id}-${Math.round(departureSecond)}`,
        timelineRow: timeline.row,
        taskType: 'dispatch',
        label: `整備入廠 · → ${chosen.label}`,
        anchorStartMinute: secondToMinute(departureSecond) + dayShiftMinute,
        plannedStartMinute: secondToMinute(departureSecond) + dayShiftMinute,
        plannedEndMinute: secondToMinute(arriveSecond) + dayShiftMinute,
        travelSeconds: chosen.seconds,
        dwellSeconds: 0,
        source: 'yard_entry_move',
        yardExitFacilityNodeId: chosen.nodeId,
        yardExitFacilityLabel: chosen.label,
        yardExitStationId: stationId,
        // 站名要一起帶，畫面才不會退回顯示原始 id。UI 是
        // 「yardExitStationLabel ?? yardExitStationId」，少了 label 使用者看到的
        // 就是 station_2 這種內部代號（2026-08-24 使用者回報）。
        yardExitStationLabel: stationDisplayName(stationId),
        yardMoveViaLabels: chosen.viaLabels,
        yardExitSectionCode:
          resolveMaintenanceSectionCodeForTaskType(yard.taskType, sectionCodes) ?? undefined,
        yardExitSectionLabel: resolveMaintenanceSectionLabelForTaskType(yard.taskType) ?? undefined,
      };
      timeline.blocks.push(card);

      /**
       * 提早到是<strong>等待</strong>，不是提早開工（白皮書 YARD-07）：作業類整備照原訂時刻開始，
       * 抵達到開始之間車在格子裡等，格位從抵達就算佔用（見 vehicleArrivesFacilityAtSecond、
       * collectFacilityOccupancies），最後由 fillYardHoldGaps 補一張「等待」卡呈現。
       * 待命本身就是等待，提早到就提早開始待命，沒有工作量的問題。
       * 抵達落在午夜之前時整備區塊整個往後平移一天（開始 23:5x、結束 1440＋），日循環位置不變。
       */
      const earlyWait = arriveSecond < yardStartSecond - 1e-9 && isWorkYardTaskType(yard.taskType);
      yard.plannedStartMinute = secondToMinute(earlyWait ? yardStartSecond : arriveSecond) + dayShiftMinute;
      yard.plannedEndMinute += dayShiftMinute;
      // 被設施或轉折點擋住而晚進廠時，整備開始被推遲、結束不動＝工作時間變短，
      // 跟整備間轉場的「後一段被壓縮」是同一件事，計進同一個數字。
      // 注意這不是 §6 的整備讓渡（那是正線來要時間），是車進不去而已。
      if (arriveSecond > yardStartSecond + 1e-9) {
        laterTaskCompressed += 1;
        yardWorkShortened.push({
          timelineRow: timeline.row,
          blockId: yard.id,
          taskType: yard.taskType,
          kind: 'late-start',
          seconds: Math.round(arriveSecond - yardStartSecond),
          remainingWorkSeconds: Math.round(yardEndSecond - arriveSecond),
          minimumWorkSeconds: configuredWorkSeconds(yard.taskType),
          limitSeconds: yardStartPushLimitSeconds(yard.taskType),
          reason: '入廠要等設施空出來或錯開轉折點，車晚到，整備跟著晚開始、結束不動',
        });
      } else if (!earlyWait && arriveSecond < yardStartSecond - 1e-9) yardHeadExtended += 1;
      // 時刻定案後才綁設施——assignYardFacility 會用當下的 [開始, 結束] 佔位
      assignYardStay(yard, chosen.nodeId, chosen.label);
      inserted += 1;
    }
  }

  /**
   * 一對相鄰整備（earlier → later）的整備間轉場：出廠卡＋入廠卡成對。
   *
   * 抽成函式是為了<strong>重算</strong>：轉場階段排在出廠階段之前，排到某一列時，別列車的
   * 出廠卡可能還沒定案，它在設施裡的佔用暫時算到「下一班發車」為止；出廠階段排好後
   * （出廠卡可能吃掉整備尾巴、提早離格），那一格其實早就空了。只算一次的話，這一列會
   * 帶著過期的「設施被佔」一路失敗到最終報告（2026-09-28 重播實測：時間線 4 的充電轉
   * 待命就是這樣被判失敗）。出廠階段之後會用最新的佔用表對失敗的轉場再試一次。
   *
   * 失敗寫進 sink；成功就插卡並綁設施。
   */
  function processTransitPair(
    timeline: GeneratedSchedulePlan['timelines'][number],
    sorted: GeneratedScheduleBlock[],
    i: number,
    sink: MaintenanceTransferCardsResult['skipped'],
  ): void {
    const earlier = sorted[i]!;
    const laterNeighbor = immediateNextCyclic(sorted, i);
    if (!laterNeighbor) return;
    const later = laterNeighbor.block;
    /** 後一段繞到隔天時 = +1440；當日之內 = 0 */
    const laterOffsetMinute = laterNeighbor.offsetMinute;
    const laterOffsetSecond = minuteToSecond(laterOffsetMinute);
    if (!YARD_TASK_TYPES.has(earlier.taskType) || !YARD_TASK_TYPES.has(later.taskType)) {
      return;
    }
    if (earlier.taskType === later.taskType) return;

    const allExitFacilities = facilityNodesForBlock(earlier);
    const allEntryFacilities = facilityNodesForBlock(later);
    if (allExitFacilities.length === 0 || allEntryFacilities.length === 0) {
      sink.push({
        timelineRow: timeline.row,
        blockId: later.id,
        fromTaskType: earlier.taskType,
        toTaskType: later.taskType,
        reason: '其中一種整備類型沒設定設施，或設施不在拓樸上',
      });
      return;
    }

    // earlier 停在哪台設施如果已經被入廠卡或前一段轉場定案，這裡只能沿用
    // 同一台——不能各自獨立再挑一次，那樣車會憑空從一台設施跳到另一台。
    // 兩側的地點都已由「決定去哪」階段定案，這裡只能沿用，不能再自己挑一台。
    // 只收斂出廠側而放任入廠側的話，繞日那一對（後一段是當日第一段）會反過來
    // 把前面已經定案的地點改寫掉，車就在資料上瞬移換格子。
    const earlierAssigned = yardBlockFacility.get(earlier.id);
    const exitFacilities = earlierAssigned
      ? allExitFacilities.filter((f) => f.id === earlierAssigned.nodeId)
      : allExitFacilities;
    const laterAssigned = yardBlockFacility.get(later.id);
    const entryFacilities = laterAssigned
      ? allEntryFacilities.filter((f) => f.id === laterAssigned.nodeId)
      : allEntryFacilities;
    if (exitFacilities.length === 0 || entryFacilities.length === 0) {
      const pinned = exitFacilities.length === 0 ? earlierAssigned! : laterAssigned!;
      sink.push({
        timelineRow: timeline.row,
        blockId: later.id,
        fromTaskType: earlier.taskType,
        toTaskType: later.taskType,
        reason: `設施已定案在 ${pinned.label}，但這個方向到不了`,
      });
      return;
    }

    // 時序運算在「跟 earlier 同一條時間軸」的位移座標上做（後一段繞到隔天時
    // 會是 1440 以上）；設施佔用檢查則必須換回各區塊自己的日內座標，
    // 否則跨午夜那一段會拿 1440+ 的窗去比別列車 0–1440 的窗，永遠比不到。
    const departSecond = minuteToSecond(earlier.plannedEndMinute);
    const laterEndSecond = minuteToSecond(later.plannedEndMinute) + laterOffsetSecond;
    /** 後一段最晚要在這一刻開始，才留得下整備設定的作業時長 */
    const laterLatestStartSecond = laterEndSecond - minimumYardWorkSeconds(later.taskType);

    let chosen: {
      exitNodeId: string;
      exitLabel: string;
      entryNodeId: string;
      entryLabel: string;
      midNodeId: string;
      midLabel: string;
      /** 這一對轉場實際途經的節點名稱（含起訖），給卡片顯示分段用 */
      viaLabels: string[];
      exitLegSeconds: number;
      entryLegSeconds: number;
      /**
       * 兩座設施是不是在地圖 JSON 上同一個 Area 容器底下——同一區域就直接
       * 當 0 秒的示意轉移，不查拓樸找路徑；卡面顯示「設施 → 設施」
       * （例 M1 → H1），不印任何轉折點。使用者畫地圖時不可能把每一對設施
       * 組合的路徑都連好，這個判斷完全不看拓樸，只看 Area 容器結構。
       */
      sameArea: boolean;
      exitGateway: { nodeId: string; instant: number } | null;
      entryGateway: { nodeId: string; instant: number } | null;
      /** 沿路徑經過的每一個中途節點與時刻（已含位移）；全部都要預約，不只閘門 */
      passes: Array<{ nodeId: string; instant: number }>;
      /** 為了閃開轉折點碰撞，出廠時刻往後挪了幾秒（0＝沒挪） */
      departureShiftSeconds: number;
      /** 含外部性的比較成本；只用來排名 */
      decisionCost: number;
      /** 後一段實際開始時刻（位移座標）；只會等於或晚於它原訂的開始 */
      finalLaterStartSecond: number;
    } | null = null;

    let tally = newTally();
    /** 只輸在轉折點時，原訂時刻要經過的節點（最先試的那組設施） */
    let transferReservation: Array<{ nodeId: string; instant: number }> | null = null;
    // 先找守交接間隔的候選；全滅才退一步只求排得出移動（缺移動比交接不足更糟，
    // 交接不足仍由最終驗證 FACILITY_HANDOVER_GAP 擋發布）
    /** 守交接間隔那一輪的淘汰紀錄：擋路者與時間窗照完整安全規則回報，不用放寬後那一輪的 */
    let strictTally: RejectTally | null = null;
    for (const enforceHandover of [true, false]) {
      handoverEnforced = enforceHandover;
      tally = newTally();
      if (enforceHandover) strictTally = tally;
      for (const exitFacility of exitFacilities) {
        for (const entryFacility of entryFacilities) {
          const exitAreaId = facilityAreaId.get(exitFacility.id);
          const entryAreaId = facilityAreaId.get(entryFacility.id);
          const sameArea = Boolean(exitAreaId) && exitAreaId === entryAreaId;

          let midNodeId: string;
          let midLabel: string;
          let exitLegSeconds: number;
          let entryLegSeconds: number;
          // 同一區域是 0 秒示意轉移，沒有真實移動，不會有轉折點碰撞問題
          let exitGateway: { nodeId: string; instant: number } | null = null;
          let entryGateway: { nodeId: string; instant: number } | null = null;
          /**
           * 路徑上每一個中途節點的經過時刻。跨區轉場會沿正線走（例：充電洗車入口點 →
           * N2W下行出發 → T3下行 → 整備調度入口點），只預約頭尾兩個閘門的話，中間那幾個
           * 點跟別列車的移動貼在一起也看不到；最終驗證（MOVE_JUNCTION_CONFLICT）看的是
           * 全部中途節點，求解時要用同一把尺。
           */
          let pathPasses: Array<{ nodeId: string; instant: number }> = [];
          /** 這一對轉場的外部成本（路徑經過的共用轉折點會鎖住別人多久） */
          let externalitySeconds = 0;

          let transferVia: string[];
          /**
           * 拓樸上的實際路徑才算數，同一個 Area 也一樣。
           *
           * 先前同 Area 查不到路徑就當 0 秒示意轉移（2026-08-09：使用者不可能把每一對設施
           * 都連好）。但 Area 容器可能大到整張圖只有一個，兩座不同設施之間沒有路徑、或路徑上
           * 某段沒填行駛時間，都不代表車可以瞬間抵達——那樣排出來的時刻與佔用都不成立。
           * 現在只有「同一個實體節點」才是 0 秒；不同節點缺路徑或缺時間就是到不了，訊息寫出
           * 缺的是哪一段（2026-09-28）。sameArea 只留作卡面顯示用。
           */
          const transferPath = findTopologyPath(topology, exitFacility.id, entryFacility.id);
          const placeholder = transferPath !== null && transferPath.edges.length === 0;
          /**
           * 作業類前一段跑滿全長才出廠：整備尾巴沒有授權，不能為了讓後一段留足作業時長而提早結束
           * （白皮書 YARD-07）。後一段放不下作業時長就回報，由使用者調整模板（YARD-06）。
           * 前一段是待命（不是作業）時可以提早離開，把移動時間讓出來，待命至少留一個刻度。
           */
          const travelSecondsForWork = transferPath && !placeholder ? transferPath.avgSeconds : 0;
          const earlyDepartureShift = !isWorkYardTaskType(earlier.taskType)
            ? -snapUpToClockAlignSeconds(Math.max(0, departSecond + travelSecondsForWork - laterLatestStartSecond))
            : 0;
          const candidateDepartSecond = departSecond + earlyDepartureShift;
          if (
            earlyDepartureShift < 0
            && candidateDepartSecond
              < minuteToSecond(earlier.plannedStartMinute) + minimumYardWorkSeconds(earlier.taskType) - 1e-9
          ) {
            tally.noTime += 1;
            continue;
          }
          void sameArea;
          if (placeholder) {
            // 同一個實體節點：車不用移動，開始跟結束是同一刻
            midNodeId = entryFacility.id;
            midLabel = entryFacility.label || entryFacility.id;
            exitLegSeconds = 0;
            entryLegSeconds = 0;
            transferVia = [
              exitFacility.label || exitFacility.id,
              entryFacility.label || entryFacility.id,
            ];
          } else {
            const path = transferPath;
            if (!path || path.edges.length === 0) { tallyNoPath(tally, exitFacility.id, entryFacility.id); continue; }
            transferVia = pathViaLabels(path);
            // 分界點取第一段邊的終點：出廠卡永遠是「離開這座設施專屬的那一段
            // 邊」（例 E2 → N2W下行出發），入廠卡吸收掉中間所有正線轉乘直到
            // 目的設施（例 N2W下行出發 → T3下行 → M1）——出廠短、入廠長，
            // 入廠卡負責吸收這段真實的移動距離。
            exitGateway = resolveGatewayFromPath(path, candidateDepartSecond, 'leaving-facility', exitFacility.id);
            midNodeId = exitGateway.nodeId;
            midLabel = nodeById.get(midNodeId)?.label || midNodeId;
            exitLegSeconds = exitGateway.instant - candidateDepartSecond;
            entryLegSeconds = Math.max(0, path.avgSeconds - exitLegSeconds);
            entryGateway = resolveGatewayFromPath(
              path,
              candidateDepartSecond + path.avgSeconds,
              'arriving-at-facility',
              entryFacility.id,
            );
            externalitySeconds = pathExternalitySeconds(path);
            let passInstant = candidateDepartSecond;
            pathPasses = path.edges.slice(0, -1).map((edge) => {
              passInstant += edgeSeconds(edge, 'avg');
              return { nodeId: edge.toNodeId, instant: passInstant };
            });
          }

          const totalSeconds = exitLegSeconds + entryLegSeconds;
          const baseArriveSecond = candidateDepartSecond + totalSeconds;
          // 後一段只會被<strong>往後推</strong>，絕不會被往前拉——兩段之間本來就
          // 有空檔時（車提早到、在那邊等），它照原訂時刻開始。少了這個 max，
          // 空檔一大就會把後一段硬拉到抵達時刻，跨午夜那一對甚至會被拉成負時刻。
          const laterStartSecond = minuteToSecond(later.plannedStartMinute) + laterOffsetSecond;
          // 一秒都不挪就已經超過後一段的結束了 = 這段路本來就塞不進空檔，
          // 跟設施有沒有被佔無關，要分開報，否則使用者會去找根本不存在的佔用
          if (Math.max(laterStartSecond, baseArriveSecond) > laterLatestStartSecond + 1e-9) {
            tally.noTime += 1;
            continue;
          }
          // 前一段整備在它自己的全程都佔著出廠那台設施，這個窗是固定的，挪不動
          if (
            !stayFacilityIsFree(
              exitFacility.id,
              earlier,
              timeline.row,
              minuteToSecond(earlier.plannedStartMinute),
              candidateDepartSecond,
            )
          ) {
            tallyFacilityBusy(tally);
            continue;
          }

          /**
           * 晚一點出廠也是解。
           *
           * 車在原本那台設施裡多留一會兒，後一段整備就晚一點開始——那本來就是
           * 轉場的既有規則（後一段被往後推、結束不動）。目的設施被前一台車佔著
           * 時，多等一下等它走就好，不必整張卡作廢。
           *
           * 往後挪只會讓「後一段佔用目的設施」的窗口變短，所以可行性是單調的，
           * 最早可行的位移可以二分找出來。上限是後一段還剩得下時間。
           *
           * <strong>但晚走也要有格子可待。</strong>車多留的那幾分鐘還是佔著出廠
           * 那台設施，所以位移還有第二道上限：出廠設施保持空著到什麼時候。少了
           * 這道上限，出廠設施的預約會在<strong>別人已經挑完之後</strong>才被撐
           * 大，後車眼中那格當時是空的，於是直接開進來——2026-08-25 實測剩下的
           * 兩筆重疊（E3 241 秒、M1 401 秒）全是這樣來的。挪不動就換一組設施，
           * 這正是候選迴圈存在的意義。
           */
          /**
           * 位移 shift 之下，車實際離開出廠設施的時刻。
           *
           * 必須跟 {@link vehicleLeavesFacilityAtSecond} 用同一個定義（下一張非零
           * 長度卡的起點），否則檢查與預約會各說各話：同區域轉場的兩張移動卡是
           * 零長度示意卡，車其實一路待到後一段整備開始。
           */
          const exitStayEndAt = (shift: number) =>
            totalSeconds > 0
              ? candidateDepartSecond + shift
              : Math.max(laterStartSecond, baseArriveSecond + shift);
          const exitFacilityFreeAt = (shift: number) =>
            stayFacilityIsFree(
              exitFacility.id,
              earlier,
              timeline.row,
              minuteToSecond(earlier.plannedStartMinute),
              exitStayEndAt(shift),
            )
            // 原訂時刻離格不檢查交接：交接由進格的那一方讓（它看得到我何時走）。
            // 只有我為了閃避而多留時，才不能留到擋住別人已排好的進格
            && (shift <= 0 || handoverEdgeIsClear(exitFacility.id, timeline.row, exitStayEndAt(shift), 'leaving'));
          let maxShift = Math.max(0, laterLatestStartSecond - baseArriveSecond);
          /** 最晚離開被什麼限制：後一段要留下作業時間（固定規則），或原格下一台要進來（可重排） */
          let latestReason = `後一段「${later.label}」要留下作業時間，最晚 ${formatSecondOfDay(laterLatestStartSecond)} 開始`;
          let latestFixed = true;
          if (maxShift > 0 && !exitFacilityFreeAt(maxShift)) {
            let free = 0;
            let busy = maxShift;
            for (let step = 0; step < 32 && busy - free > 1; step += 1) {
              const mid = (free + busy) / 2;
              if (exitFacilityFreeAt(mid)) free = mid; else busy = mid;
            }
            maxShift = Math.floor(free);
            // 可延後範圍是被「原格下一台要進來」縮小的：那一台也要交給搜尋，不能只報最後撞到的轉折點
            exitFacilityFreeAt(busy);
            const limiter = lastBlocker as TransferBlocker | null;
            if (limiter) {
              tally.limitBlockers.push({ ...limiter, role: 'origin-next-occupant', adjustable: Boolean(limiter.blockingBlockId) });
              latestReason = `原格「${exitFacility.label || exitFacility.id}」`
                + `時間線 ${limiter.blockingRow} 要進來（${formatSecondOfDay(limiter.occupiedFrom)}），交接要隔 ${collisionBufferSeconds} 秒`;
              latestFixed = false;
            }
          }
          tally.departureWindow ??= {
            earliestSecond: candidateDepartSecond,
            earliestReason: isWorkYardTaskType(earlier.taskType)
              ? `「${earlier.label}」是作業，做滿才走（不截尾）`
              : `「${earlier.label}」至少留一個刻度`,
            earliestFixed: true,
            latestSecond: candidateDepartSecond + maxShift,
            latestReason,
            latestFixed,
          };
          // 一秒都不挪就已經佔到別人的格子——這組設施不能用，換下一組
          if (!exitFacilityFreeAt(0)) { tallyFacilityBusy(tally); continue; }
          const entryFacilityFreeAt = (shift: number) => {
            const start = Math.max(laterStartSecond, baseArriveSecond + shift);
            if (start > laterLatestStartSecond + 1e-9) return false;
            // 提早到只是等待（後一段照原訂開始），但車從抵達起就在目的格裡：佔用從抵達算起
            const occupyFrom = Math.min(start, baseArriveSecond + shift);
            return stayFacilityIsFree(
              entryFacility.id,
              later,
              timeline.row,
              occupyFrom - laterOffsetSecond,
              laterEndSecond - laterOffsetSecond,
            )
            && handoverEdgeIsClear(entryFacility.id, timeline.row, occupyFrom - laterOffsetSecond, 'entering');
          };
          let facilityShift: number;
          if (entryFacilityFreeAt(0)) {
            facilityShift = 0;
          } else if (!entryFacilityFreeAt(maxShift)) {
            tallyFacilityBusy(tally);
            continue;
          } else {
            let busy = 0;
            let free = maxShift;
            for (let step = 0; step < 32 && free - busy > 1; step += 1) {
              const mid = (busy + free) / 2;
              if (entryFacilityFreeAt(mid)) free = mid; else busy = mid;
            }
            const lowest = snapUpToClockAlignSeconds(busy);
            const aligned = entryFacilityFreeAt(lowest) ? lowest : snapUpToClockAlignSeconds(free);
            facilityShift = aligned <= maxShift + 1e-9 ? aligned : Math.ceil(free);
          }

          // 轉折點撞上就再往後挪一點。往後挪只會讓目的設施的佔用窗更短，
          // 不會把剛解好的設施衝突變回來。
          // 閃轉折點：作業類前一段只能晚一點出廠（不吃尾巴）；前一段是待命才可以提早離開
          const earliestJunctionShift = !isWorkYardTaskType(earlier.taskType)
            ? Math.min(
              0,
              minuteToSecond(earlier.plannedStartMinute) + minimumYardWorkSeconds(earlier.taskType) - candidateDepartSecond,
            )
            : 0;
          const junctionShift = resolveJunctionShiftSeconds(
            pathPasses.length > 0
              ? pathPasses.map((pass) => ({ ...pass, instant: pass.instant + facilityShift }))
              : [
                  exitGateway && { ...exitGateway, instant: exitGateway.instant + facilityShift },
                  entryGateway && { ...entryGateway, instant: entryGateway.instant + facilityShift },
                ],
            timeline.row,
            earliestJunctionShift,
            maxShift - facilityShift,
          );
          if (junctionShift === null) {
            transferReservation ??= (pathPasses.length > 0
              ? pathPasses
              : [exitGateway, entryGateway].filter((p): p is { nodeId: string; instant: number } => p != null)
            ).map((pass) => ({ ...pass, instant: pass.instant + facilityShift }));
            tally.junctionBusy += 1;
            tally.junctionDetail ??= describeJunctionBlock(
              (pathPasses.length > 0 ? pathPasses : [exitGateway, entryGateway])
                .map((pass) => pass && { ...pass, instant: pass.instant + facilityShift }),
              timeline.row,
              earliestJunctionShift,
              maxShift - facilityShift,
              facilityShift,
            );
            tallyJunctionBlockers(
              tally,
              (pathPasses.length > 0 ? pathPasses : [exitGateway, entryGateway])
                .map((pass) => pass && { ...pass, instant: pass.instant + facilityShift }),
              timeline.row,
              earliestJunctionShift,
              maxShift - facilityShift,
            );
            continue;
          }
          const departureShift = facilityShift + junctionShift;
          if (departureShift < 0) {
            // 提早離開待命、提早到：車從抵達起就在目的格裡等，那一格要從抵達起空著
            const earlyArriveSecond = baseArriveSecond + departureShift;
            if (
              !stayFacilityIsFree(
                entryFacility.id, later, timeline.row,
                earlyArriveSecond - laterOffsetSecond, laterEndSecond - laterOffsetSecond,
              )
              || !handoverEdgeIsClear(entryFacility.id, timeline.row, earlyArriveSecond - laterOffsetSecond, 'entering')
            ) {
              tallyFacilityBusy(tally);
              continue;
            }
          }
          if (departureShift !== 0) {
            if (exitGateway) exitGateway = { ...exitGateway, instant: exitGateway.instant + departureShift };
            if (entryGateway) entryGateway = { ...entryGateway, instant: entryGateway.instant + departureShift };
          }
          const arriveSecond = baseArriveSecond + departureShift;
          // 後一段只會被往後推：提早到是等待，不提前開工（白皮書 YARD-07）
          const finalLaterStartSecond = Math.max(laterStartSecond, arriveSecond);
          // 後一段被推遲後，剩下的工作時間不少於整備設定的作業時長（轉場的移動時間本來就佔後一段開頭）
          if (finalLaterStartSecond > laterEndSecond - minimumYardWorkSeconds(later.taskType) + 1e-9) {
            tally.noTime += 1;
            continue;
          }
          // 同區域是 0 秒示意轉移、沒有真實路徑，外部成本自然是 0
          const decisionCost = totalSeconds + externalitySeconds;
          if (!chosen || decisionCost < chosen.decisionCost) {
            chosen = {
              exitNodeId: exitFacility.id,
              exitLabel: exitFacility.label || exitFacility.id,
              entryNodeId: entryFacility.id,
              entryLabel: entryFacility.label || entryFacility.id,
              midNodeId,
              midLabel,
              viaLabels: transferVia,
              exitLegSeconds,
              entryLegSeconds,
              // 卡面「設施 → 設施」只給真的沒有路徑的示意轉移；有實際路徑就照分段顯示
              sameArea: placeholder,
              exitGateway,
              entryGateway,
              passes: pathPasses.map((pass) => ({ ...pass, instant: pass.instant + departureShift })),
              departureShiftSeconds: earlyDepartureShift + departureShift,
              decisionCost,
              finalLaterStartSecond,
            };
          }
        }
      }
      if ((chosen as unknown) !== null) break;
    }
    handoverEnforced = true;
    if (!chosen) {
      sink.push({
        timelineRow: timeline.row,
        blockId: later.id,
        fromTaskType: earlier.taskType,
        toTaskType: later.taskType,
        reason:
          `排不出整備間轉場（出廠＋入廠）：${describeReject(tally, exitFacilities.length * entryFacilities.length)}`
          + (tally.noTime > 0 && isWorkYardTaskType(earlier.taskType)
            ? `；「${earlier.label}」是作業、尾巴不能截短，移動時間只能佔用「${later.label}」的開頭，`
              + '但佔完之後「' + later.label + '」會沒有工作時間（整備不能歸零）'
            : ''),
        ...(transferReservation ? { junctionReservation: transferReservation } : {}),
        ...blockersOf(strictTally ?? tally),
        ...dataGapFields(tally),
      });
      return;
    }
    const transferOwner = { blockId: later.id, facilityNodeId: chosen.entryNodeId };
    if (chosen.passes.length > 0) {
      for (const pass of chosen.passes) bookJunction(pass.nodeId, pass.instant, timeline.row, transferOwner);
    } else {
      if (chosen.exitGateway) bookJunction(chosen.exitGateway.nodeId, chosen.exitGateway.instant, timeline.row, transferOwner);
      if (chosen.entryGateway) bookJunction(chosen.entryGateway.nodeId, chosen.entryGateway.instant, timeline.row, transferOwner);
    }

    // 為閃開轉折點／等目的格交接而延後的出廠時刻——車在原本那台設施裡多留這幾秒
    const actualDepartSecond = departSecond + chosen.departureShiftSeconds;
    // 延後出廠時車還在原格裡：作業類整備照原訂時刻做完，多出的是等待（格位佔用一路算到實際離格，
    // 見 vehicleLeavesFacilityAtSecond；畫面由 fillYardHoldGaps 補卡）。待命本身就是等待，順延即可。
    if (chosen.departureShiftSeconds > 0 && !isWorkYardTaskType(earlier.taskType)) {
      earlier.plannedEndMinute = secondToMinute(actualDepartSecond);
    } else if (chosen.departureShiftSeconds < 0) {
      // 只有待命會走到這裡：提早離開待命，把移動時間讓給後一段（逐筆記錄）
      yardWorkShortened.push({
        timelineRow: timeline.row,
        blockId: earlier.id,
        taskType: earlier.taskType,
        kind: 'early-end',
        seconds: Math.round(-chosen.departureShiftSeconds),
        remainingWorkSeconds: Math.round(actualDepartSecond - minuteToSecond(earlier.plannedStartMinute)),
        minimumWorkSeconds: configuredWorkSeconds(earlier.taskType),
        reason: `待命提早結束，把移動時間讓給下一段「${later.label}」（待命不是作業，不影響工作量）`,
      });
      earlier.plannedEndMinute = secondToMinute(actualDepartSecond);
    }
    const midSecond = actualDepartSecond + chosen.exitLegSeconds;
    const arriveSecond = midSecond + chosen.entryLegSeconds;

    const exitCode =
      resolveMaintenanceSectionCodeForTaskType(earlier.taskType, sectionCodes) ?? undefined;
    const entryCode =
      resolveMaintenanceSectionCodeForTaskType(later.taskType, sectionCodes) ?? undefined;
    const exitLabel = resolveMaintenanceSectionLabelForTaskType(earlier.taskType) ?? undefined;
    const entryLabel = resolveMaintenanceSectionLabelForTaskType(later.taskType) ?? undefined;

    // 同一區域（只隔一個轉折點）：卡面直接顯示「設施 → 設施」，不印中間那個
    // 轉折點的站名——使用者不需要知道車繞了哪個轉乘站，只需要知道從哪一台
    // 設施到哪一台設施。隔更多段才維持顯示「設施 → 轉折點」兩段式。
    const exitOtherSideLabel = chosen.sameArea ? chosen.entryLabel : chosen.midLabel;
    const entryOtherSideLabel = chosen.sameArea ? chosen.exitLabel : chosen.midLabel;

    const exitCard: GeneratedScheduleBlock = {
      id: `yardtransit-out-${earlier.id}-${Math.round(actualDepartSecond)}`,
      timelineRow: timeline.row,
      taskType: 'dispatch',
      label: `整備出廠 · ${chosen.exitLabel} → ${exitOtherSideLabel}`,
      anchorStartMinute: secondToMinute(actualDepartSecond),
      plannedStartMinute: secondToMinute(actualDepartSecond),
      plannedEndMinute: secondToMinute(midSecond),
      travelSeconds: chosen.exitLegSeconds,
      dwellSeconds: 0,
      source: 'yard_exit_move',
      yardExitFacilityNodeId: chosen.exitNodeId,
      yardExitFacilityLabel: chosen.exitLabel,
      yardExitStationId: chosen.midNodeId,
      yardExitStationLabel: exitOtherSideLabel,
      yardMoveViaLabels: chosen.viaLabels,
      yardExitSectionCode: exitCode,
      yardExitSectionLabel: exitLabel,
    };
    const entryCard: GeneratedScheduleBlock = {
      id: `yardtransit-in-${later.id}-${Math.round(midSecond)}`,
      timelineRow: timeline.row,
      taskType: 'dispatch',
      label: `整備入廠 · ${entryOtherSideLabel} → ${chosen.entryLabel}`,
      anchorStartMinute: secondToMinute(midSecond),
      plannedStartMinute: secondToMinute(midSecond),
      plannedEndMinute: secondToMinute(arriveSecond),
      travelSeconds: chosen.entryLegSeconds,
      dwellSeconds: 0,
      source: 'yard_entry_move',
      yardExitFacilityNodeId: chosen.entryNodeId,
      yardExitFacilityLabel: chosen.entryLabel,
      yardExitStationId: chosen.midNodeId,
      yardExitStationLabel: entryOtherSideLabel,
      // 入廠卡從分界點接續：途經點也從分界點算起。整串路徑放在出廠卡上，
      // 兩張卡各自從自己的開始時刻往下推，經過時刻才不會重複又錯位
      yardMoveViaLabels: chosen.sameArea ? chosen.viaLabels : chosen.viaLabels.slice(1),
      yardExitSectionCode: entryCode,
      yardExitSectionLabel: entryLabel,
    };
    timeline.blocks.push(exitCard, entryCard);

    // 寫回時要扣掉位移，換回後一段自己的日內座標
    // （跨午夜時是 1440+，扣掉 1440 才是它自己的 00:0x）
    const laterStartBefore = later.plannedStartMinute;
    later.plannedStartMinute =
      secondToMinute(chosen.finalLaterStartSecond) - laterOffsetMinute;
    // 只有真的被推遲才算「時長被壓縮」；車提早到、在那邊等的不算
    if (later.plannedStartMinute > laterStartBefore + 1e-9) {
      laterTaskCompressed += 1;
      yardWorkShortened.push({
        timelineRow: timeline.row,
        blockId: later.id,
        taskType: later.taskType,
        kind: 'late-start',
        seconds: Math.round((later.plannedStartMinute - laterStartBefore) * 60),
        remainingWorkSeconds: Math.round((later.plannedEndMinute - later.plannedStartMinute) * 60),
        minimumWorkSeconds: configuredWorkSeconds(later.taskType),
        reason: '整備間轉場的移動時間佔用後一段的開頭（前一段跑滿全長，後一段晚開始、結束不動）',
      });
    }
    // 時刻定案後才綁設施——兩段各自用自己的完整時長佔住各自那一台
    assignYardStay(earlier, chosen.exitNodeId, chosen.exitLabel);
    assignYardStay(later, chosen.entryNodeId, chosen.entryLabel);
    inserted += 1;
  }

  // ---- 整備間轉場：串內部兩段不同類型整備銜接，出廠卡＋入廠卡成對 ----
  for (const timeline of timelines) {
    const sorted = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );
    // 走完整條線（含最後一段）——最後一段的下一段照日循環繞回第一段，
    // 「充電 22:00–24:00 接 保養 00:00–02:40」這種跨午夜的銜接才看得到。
    for (let i = 0; i < sorted.length; i += 1) processTransitPair(timeline, sorted, i, skipped);
  }

  // ---- 出廠：只在串尾補，往前貼齊、零秒緩衝，空間不夠可吃整備尾巴 ----
  type Pending = {
    timeline: GeneratedSchedulePlan['timelines'][number];
    yard: GeneratedScheduleBlock;
    next: GeneratedScheduleBlock;
    /** 下一段載客的發車時刻（已含日循環位移；繞到隔天時會 > 1440） */
    nextStartMinute: number;
  };
  const pending: Pending[] = [];

  for (const timeline of timelines) {
    const sorted = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );
    for (let i = 0; i < sorted.length; i += 1) {
      const yard = sorted[i]!;
      if (!YARD_TASK_TYPES.has(yard.taskType)) continue;

      // 連續整備串只在串尾出場：右鄰居是別種整備由轉場處理，同種整備不需要。
      // 「下一段」照日循環算——當日最後一段的下一段，是同一台車隔天的第一段，
      // 所以整備排在當日尾巴時仍然找得到它要銜接的那一段載客（時刻 +1440）。
      const nextPax = findNextCyclic(sorted, i, requiresVehicleAtStation);
      if (!nextPax) {
        // 繞一整圈都沒有載客班次＝這一列整天只有整備。仍然要講出「做完之後車去哪」
        // 的依據（下一段整備、或整天就這一段）才算不需要出廠卡；這通常是刻意保留的
        // 備援車，但也可能是模板排錯，所以照樣回報，不安靜吞掉。
        const basis = describeYardOnlyNeighborBasis(sorted, i, 'next');
        skipped.push(basis
          ? {
            timelineRow: timeline.row,
            blockId: yard.id,
            taskType: yard.taskType,
            reason: `這一列整天沒有載客班次；${basis}，不需要出廠卡（若非刻意保留備援車，請檢查模板排班）`,
            necessity: 'not_needed',
          }
          : {
            timelineRow: timeline.row,
            blockId: yard.id,
            taskType: yard.taskType,
            reason: '這一列整天沒有載客班次，做完之後也查不出車要去哪，無從排出廠卡',
          });
        continue;
      }
      const nextYard = findNextCyclic(
        sorted,
        i,
        (b) => YARD_TASK_TYPES.has(b.taskType),
      );
      const nextPaxStart = nextPax.block.plannedStartMinute + nextPax.offsetMinute;
      if (
        nextYard
        && nextYard.block.plannedStartMinute + nextYard.offsetMinute < nextPaxStart
      ) {
        // 後面還有整備排在這一段載客之前 → 這一段不是串尾，交給串尾處理
        continue;
      }
      pending.push({ timeline, yard, next: nextPax.block, nextStartMinute: nextPaxStart });
    }
  }

  // 早的整備先挑設施，晚的才需要讓
  pending.sort((a, b) => a.yard.plannedStartMinute - b.yard.plannedStartMinute);

  for (const { timeline, yard, next, nextStartMinute } of pending) {
    // 要的是「這一段自己從哪一站發車」＝路線起點站。
    // 不能用 firstTripOriginStationId——那個欄位在調度營運班次上存的是
    // 「要把車送到的首班起點站」（終點側），拿來當起點會查到完全另一站。
    const stationId = (next.routeId ? routeStartStation.get(next.routeId) : undefined)
      || resolveBlockOriginStationId(next)
      || next.firstTripOriginStationId?.trim();
    if (!stationId) {
      skipped.push({
        timelineRow: timeline.row,
        blockId: yard.id,
        taskType: yard.taskType,
        reason: '下一段載客查不到起點站',
      });
      continue;
    }
    const stationNodeId = nodeIdByStationId.get(stationId);
    if (!stationNodeId) {
      skipped.push({
        timelineRow: timeline.row,
        blockId: yard.id,
        taskType: yard.taskType,
        reason: `${stationId} 在拓樸上找不到對應節點`,
      });
      continue;
    }
    const stationLabel = nodeById.get(stationNodeId)?.label || stationId;

    const allFacilities = facilityNodesForBlock(yard);
    if (allFacilities.length === 0) {
      skipped.push({
        timelineRow: timeline.row,
        blockId: yard.id,
        taskType: yard.taskType,
        reason: '整備任務沒設定這一類的設施，或設施不在拓樸上',
      });
      continue;
    }

    // 這一段停在哪台設施如果已經被入廠卡或前一段轉場定案，出廠只能沿用
    // 同一台——不能各自獨立再挑一次，那樣車會憑空從一台設施跳到另一台。
    const yardAssigned = yardBlockFacility.get(yard.id);
    const facilities = yardAssigned
      ? allFacilities.filter((f) => f.id === yardAssigned.nodeId)
      : allFacilities;
    if (facilities.length === 0) {
      skipped.push({
        timelineRow: timeline.row,
        blockId: yard.id,
        taskType: yard.taskType,
        reason: `設施已被固定在 ${yardAssigned!.label}（入廠或前一段轉場定案），這裡到不了`,
      });
      continue;
    }

    // 快的先挑：佔整備尾巴的風險最小
    const candidates = facilities
      .map((facility) => {
        const path = findTopologyPath(topology, facility.id, stationNodeId);
        if (!path) return null;
        // seconds 是卡片與時刻要用的實際移動時間；decisionCost 只用來排序
        return {
          facility,
          seconds: path.avgSeconds,
          decisionCost: pathDecisionCost(path),
          edges: path.edges,
          viaLabels: pathViaLabels(path),
        };
      })
      .filter((c): c is {
        facility: (typeof facilities)[number];
        seconds: number;
        decisionCost: number;
        edges: PointTopologyEdge[];
        viaLabels: string[];
      } => c !== null)
      .sort((a, b) => a.decisionCost - b.decisionCost);
    if (candidates.length === 0) {
      skipped.push({
        timelineRow: timeline.row,
        blockId: yard.id,
        taskType: yard.taskType,
        reason: `整備設定的設施在拓樸上都到不了「${stationDisplayName(stationId)}」`
          + (facilities[0] ? `（例：${explainTopologyPathGap(topology, facilities[0].id, stationNodeId) ?? '無路徑'}）` : ''),
      });
      continue;
    }

    const departSecond = minuteToSecond(nextStartMinute);
    const yardEndSecond = minuteToSecond(yard.plannedEndMinute);
    const yardStartSecond = minuteToSecond(yard.plannedStartMinute);

    let chosen: {
      nodeId: string; label: string; seconds: number;
      gatewayNodeId: string; gatewayInstant: number;
      /** 這條路徑實際途經的節點名稱（含起訖），給卡片顯示分段用 */
      viaLabels: string[];
    } | null = null;
    let chosenStart = 0;
    const tally = newTally();
    /** 提早出廠時車在站上等下一班的那段（秒）；0＝照原訂貼齊發車 */
    let chosenEarlySeconds = 0;
    /** 往後錯開轉折點要晚多少才過得去（只做診斷，要連同後續班次一起挪） */
    let laterNeededSeconds: number | null = null;
    /** 只輸在轉折點時，原訂時刻要經過的節點（最優先的那台設施） */
    let exitReservation: Array<{ nodeId: string; instant: number }> | null = null;
    /**
     * 出廠最早什麼時候可以離格。作業類整備要做滿到原訂結束：尾巴沒有授權，不能為了出場移動截短
     * （白皮書 YARD-07）。放不下就回報「下一班要晚多少」，交給呼叫端連同後續班次一起評估。
     * 待命不是作業，提早離開待命仍可以（剩下不少於一個刻度）。
     */
    const earliestLeaveSecond = isWorkYardTaskType(yard.taskType)
      ? yardEndSecond
      : yardStartSecond + minimumYardWorkSeconds(yard.taskType);
    for (const { facility, seconds, edges, viaLabels } of candidates) {
      const startSecond = departSecond - seconds;
      if (startSecond < earliestLeaveSecond - 1e-9) {
        tally.noTime += 1;
        // 下一班要晚這麼多，出廠移動才放得進整備結束之後
        const needed = snapUpToClockAlignSeconds(earliestLeaveSecond - startSecond);
        if (laterNeededSeconds == null || needed < laterNeededSeconds) laterNeededSeconds = needed;
        continue;
      }
      // 出廠時刻釘在下一班發車，交接由之後進格的那一方讓
      if (!stayFacilityIsFree(facility.id, yard, timeline.row, yardStartSecond, startSecond)) {
        tallyFacilityBusy(tally);
        continue;
      }
      const gateway = resolveGatewayFromPath({ edges }, startSecond, 'leaving-facility', stationNodeId);
      let shift = 0;
      if (!junctionIsFree(gateway.nodeId, gateway.instant, timeline.row)) {
        /**
         * <strong>轉折點撞上：往前找，不是放棄。</strong>
         *
         * 抵達時刻不必釘死在下一班發車——車可以早一點出廠、到站上等。候選不用逐秒掃：
         * 擋路的就是那幾筆轉折點預約，答案貼在它們的緩衝邊緣。每個候選都要：
         * 可以再多吃一點整備尾巴（出廠卡本來就有這個特權），但剩下的工作時間不少於整備設定的
         * 作業時長（沒有設定的至少留一個刻度）；到站後等待的那段站位沒有別列車要用。
         * 多吃的量照樣記進 yardWorkShortened、在報告逐筆列出。
         * 往後錯開則要連同下一班與交路一起挪，這裡只算出要晚多少、寫進原因。
         */
        const earliestStart = earliestLeaveSecond;
        const candidateShifts: number[] = [];
        for (const booking of junctionBookings) {
          if (booking.nodeId !== gateway.nodeId || booking.timelineRow === timeline.row) continue;
          for (const wrap of [-daySeconds, 0, daySeconds]) {
            candidateShifts.push(booking.instant - collisionBufferSeconds + wrap - gateway.instant);
          }
        }
        const stationWaitIsFree = (arriveSecond: number) =>
          !mainlineBerthWindows(stationId).some(
            (window) =>
              window.timelineRow !== timeline.row
              && cyclicWindowsOverlap(arriveSecond, departSecond, window.startSecond, window.endSecond),
          );
        const earlier = candidateShifts
          .map((value) => -snapUpToClockAlignSeconds(-value))
          .filter((value) => value < 0 && startSecond + value >= earliestStart - 1e-9)
          .sort((a, b) => b - a);
        let found: number | null = null;
        for (const value of earlier) {
          if (!junctionIsFree(gateway.nodeId, gateway.instant + value, timeline.row)) continue;
          if (!stationWaitIsFree(startSecond + value + seconds)) continue;
          found = value;
          break;
        }
        if (found == null) {
          exitReservation ??= [{ nodeId: gateway.nodeId, instant: gateway.instant }];
          const later = resolveJunctionShiftSeconds([gateway], timeline.row, 1, daySeconds / 2);
          if (later != null) laterNeededSeconds = later;
          tally.junctionBusy += 1;
          tallyJunctionBlockers(tally, [gateway], timeline.row, earliestStart - startSecond, 0);
          tally.junctionDetail ??= describeJunctionBlock([gateway], timeline.row, 0, 0)
            + `；往前（最早 ${formatSecondOfDay(earliestStart)} 才能離格、到站後的等待不撞站位）`
            + `找不到可行出發時刻`;
          continue;
        }
        shift = found;
      }
      chosen = {
        nodeId: facility.id, label: facility.label || facility.id, seconds,
        gatewayNodeId: gateway.nodeId, gatewayInstant: gateway.instant + shift,
        viaLabels,
      };
      chosenStart = startSecond + shift;
      chosenEarlySeconds = -shift;
      break;
    }
    if (!chosen) {
      skipped.push({
        timelineRow: timeline.row,
        blockId: yard.id,
        taskType: yard.taskType,
        ...(laterNeededSeconds != null
          ? { exitDelay: { nextBlockId: next.id, seconds: laterNeededSeconds } }
          : {}),
        ...(exitReservation ? { junctionReservation: exitReservation } : {}),
        ...blockersOf(tally),
        ...dataGapFields(tally),
        reason: `排不出出廠卡：${describeReject(tally, candidates.length)}`
          + (laterNeededSeconds != null
            ? `；往後錯開至少要晚 ${Math.round(laterNeededSeconds)} 秒，但下一班 `
              + `${formatSecondOfDay(departSecond)} 發車，需連同後續班次與交路一起後移，不能只挪出廠卡`
            : ''),
      });
      continue;
    }
    bookJunction(chosen.gatewayNodeId, chosen.gatewayInstant, timeline.row, { blockId: yard.id, facilityNodeId: chosen.nodeId });

    // 空間不夠 → 吃整備尾巴（全系統唯一有此特權的卡）
    const eatsTail = chosenStart < yardEndSecond - 1e-9;
    if (eatsTail) {
      yardWorkShortened.push({
        timelineRow: timeline.row,
        blockId: yard.id,
        taskType: yard.taskType,
        kind: 'early-end',
        seconds: Math.round(yardEndSecond - chosenStart),
        remainingWorkSeconds: Math.round(chosenStart - yardStartSecond),
        minimumWorkSeconds: configuredWorkSeconds(yard.taskType),
        reason: '整備結束到下一班發車之間放不下出廠移動，出廠卡吃掉整備尾巴',
      });
      yard.plannedEndMinute = secondToMinute(chosenStart);
      ateYardTail += 1;
    }

    const card: GeneratedScheduleBlock = {
      id: `yardexit-${yard.id}-${Math.round(chosenStart)}`,
      timelineRow: timeline.row,
      taskType: 'dispatch',
      label: `出場移動 · ${chosen.label} → ${stationLabel}`,
      anchorStartMinute: secondToMinute(chosenStart),
      plannedStartMinute: secondToMinute(chosenStart),
      plannedEndMinute: chosenEarlySeconds > 0
        ? secondToMinute(chosenStart + chosen.seconds)
        : nextStartMinute,
      travelSeconds: chosen.seconds,
      dwellSeconds: 0,
      source: 'yard_exit_move',
      yardExitFacilityNodeId: chosen.nodeId,
      yardExitFacilityLabel: chosen.label,
      yardExitStationId: stationId,
      yardExitStationLabel: stationLabel,
      yardMoveViaLabels: chosen.viaLabels,
      yardExitSectionCode:
        resolveMaintenanceSectionCodeForTaskType(yard.taskType, sectionCodes) ?? undefined,
      yardExitSectionLabel: resolveMaintenanceSectionLabelForTaskType(yard.taskType) ?? undefined,
      yardExitAteYardTail: eatsTail || undefined,
    };
    timeline.blocks.push(card);
    // 提早到站後在站上等的那段，由 fillYardHoldGaps 依「出廠目的站＝下一班起點站」補暫停卡
    // 吃過尾巴之後才綁設施——佔用窗要用縮短後的實際結束時刻
    assignYardStay(yard, chosen.nodeId, chosen.label);
    inserted += 1;
  }

  // ---- 重算：整備間轉場失敗的，用出廠階段之後的佔用表再試 ----
  // 見 processTransitPair 的說明。只重試轉場（出廠＋入廠成對）；每一輪至少要多排成一筆
  // 才繼續，沒有進展就停，失敗的保留原因。重試成功的會從 skipped 移除，不會重複插卡
  // （同一對只會有一組 yardtransit 卡：失敗那次沒有插任何卡）。
  if (!decideOnly) {
    for (let round = 0; round < 3; round += 1) {
      let progressed = false;
      for (let index = skipped.length - 1; index >= 0; index -= 1) {
        const skip = skipped[index]!;
        if (!skip.fromTaskType || !skip.toTaskType || !skip.blockId) continue;
        const timeline = timelines.find((item) => item.row === skip.timelineRow);
        if (!timeline) continue;
        const sorted = [...timeline.blocks].sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
        const laterIndex = sorted.findIndex((block) => block.id === skip.blockId);
        if (laterIndex < 0) continue;
        const earlierIndex = sorted.findIndex((block, k) => {
          const next = immediateNextCyclic(sorted, k);
          return next?.block.id === skip.blockId && block.taskType === skip.fromTaskType;
        });
        if (earlierIndex < 0) continue;
        // 重試也是搜尋：扣整次生成共用的預算，用盡就保留目前的失敗原因
        if (args.searchBudget && !args.searchBudget.tryCandidate()) break;
        const retrySink: MaintenanceTransferCardsResult['skipped'] = [];
        processTransitPair(timeline, sorted, earlierIndex, retrySink);
        if (retrySink.length === 0) {
          engineTrace('transfer-retry', { row: skip.timelineRow, blockId: skip.blockId, outcome: 'resolved', before: skip.reason });
          skipped.splice(index, 1);
          progressed = true;
        } else {
          // 還是排不出：換成最新的原因（舊原因可能是過期的佔用）
          engineTrace('transfer-retry', { row: skip.timelineRow, blockId: skip.blockId, outcome: 'still-failing', reason: retrySink[0]!.reason });
          skipped[index] = retrySink[0]!;
        }
      }
      if (!progressed) break;
    }
  }

  // ---- 收尾：每一段整備都必須有一台實體設施，不管有沒有排出移動卡 ----
  //
  // 車在整備廠裡一定佔著某一格，這是跟「移動卡排不排得出來」無關的獨立事實。
  // 前面三段只有在<strong>成功插出卡</strong>時才會綁設施——所以出現過這種
  // 破口：移動卡因為路徑／時間排不出來（或那一段根本不需要移動卡，例如前面
  // 沒有載客可回溯），整備任務就一路沒有設施，既沒佔位、也沒有任何標記，
  // 畫面上看起來只是一張普通的整備卡，使用者完全不知道車其實沒地方停。
  //
  // 這裡補掃一遍：還沒綁設施的，就用它自己的完整時長去找一台空的補上；
  // 真的一台都不空，才是產能不足——標記在區塊上並單獨回報，
  // 讓 UI 可以把「沒地方停」直接畫在卡面，而不是靜靜地少一段資訊。
  /**
   * 補掃也要<strong>設施優先、待命最後</strong>。
   *
   * 「決定去哪」那一關已經是這個順序（真整備先挑、待命只能拿剩下的），
   * 但補掃原本是一條時間線一條走、誰先掃到誰拿——第 2 列的待命就這樣搶走
   * 最後一格充電樁，第 7 列真的要充電的車卻補不到。決定階段守住的優先權，
   * 在這裡漏光了（2026-08-10 使用者：「我不希望因為待命有可以停在 E1 的權利，
   * 就不讓別人有需要充電的去充」）。
   *
   * 充電樁的本職是讓車恢復運行；待命停在那裡是<strong>順便</strong>，
   * 順便的事永遠不該擋住本職。
   */
  /**
   * <strong>長段先挑，不要照列序。</strong>
   *
   * 原本是 <code>for 每一列 { for 每一段 }</code>，等於先來先得。短段先挑走一台格子、
   * 又在中間留下一個誰都用不掉的空檔，長段就被卡死——而長段其實只有一種放法。
   *
   * 實測（2026-08-12）：列 6 的保養 09:40–13:00 報「沒地方停」，但那個時刻 M1、M2
   * 明明是空的——它們稍後被列 7 短段訂走，於是沒有<strong>任何一台</strong>整段空著。
   * 這不是設施不夠，是挑的順序不對。
   *
   * 長段優先是這類裝箱問題的標準解：長段的可行位置最少，先給它挑；短段彈性大，
   * 撿剩下的通常還是塞得進去。分相（設施優先／待命最後）維持不變。
   */
  const sweepCandidates: Array<{
    timeline: (typeof timelines)[number];
    sweepSorted: GeneratedScheduleBlock[];
    index: number;
    block: GeneratedScheduleBlock;
    durationMinutes: number;
  }> = [];
  for (const timeline of timelines) {
    const sweepSorted = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );
    for (let i = 0; i < sweepSorted.length; i += 1) {
      const block = sweepSorted[i]!;
      if (!YARD_TASK_TYPES.has(block.taskType)) continue;
      sweepCandidates.push({
        timeline,
        sweepSorted,
        index: i,
        block,
        durationMinutes: block.plannedEndMinute - block.plannedStartMinute,
      });
    }
  }
  sweepCandidates.sort((a, b) => {
    if (a.durationMinutes !== b.durationMinutes) {
      return b.durationMinutes - a.durationMinutes;
    }
    if (a.block.plannedStartMinute !== b.block.plannedStartMinute) {
      return a.block.plannedStartMinute - b.block.plannedStartMinute;
    }
    return a.block.id.localeCompare(b.block.id);
  });

  for (const sweepPhase of ['facility-first', 'standby-last'] as const) {
    for (const candidate of sweepCandidates) {
      const { timeline, sweepSorted, index: i } = candidate;
      if (
        (sweepPhase === 'facility-first')
        === (candidate.block.taskType === 'standby')
      ) continue;
      const yard = candidate.block;
      if (yardBlockFacility.has(yard.id)) continue;

      // 緊鄰的同類型整備＝<strong>同一段連續停留</strong>（跨午夜也算，日循環上
      // 它們本來就相接），車不會中途換格子——直接沿用同一台，不要再挑一次。
      // 這正是「保養 20:33–24:00」接「保養 00:00–07:50」被誤判成兩段、
      // 第二段找不到空位而誤報「沒地方停」的那個坑。
      const sameStayNeighbor = [
        immediatePrevCyclic(sweepSorted, i),
        immediateNextCyclic(sweepSorted, i),
      ].find((neighbor) =>
        neighbor
        && neighbor.block.taskType === yard.taskType
        && neighbor.block.yardFacilityNodeId != null);
      if (sameStayNeighbor?.block.yardFacilityNodeId) {
        assignYardStay(
          yard,
          sameStayNeighbor.block.yardFacilityNodeId,
          sameStayNeighbor.block.yardFacilityLabel ?? sameStayNeighbor.block.yardFacilityNodeId,
        );
        continue;
      }

      const facilities = facilityNodesFor(yard.taskType);
      if (facilities.length === 0) {
        yard.yardFacilityUnavailable = true;
        facilityUnavailable.push({
          timelineRow: timeline.row,
          blockId: yard.id,
          taskType: yard.taskType,
          facilityCount: 0,
          reason: '這一類整備沒有設定任何設施，或設定的設施不在路網拓樸上',
        });
        continue;
      }

      /**
       * <strong>報錯要以「整段連續停留」為單位，不是以區塊為單位。</strong>
       *
       * 20:30 睡到 07:50 的過夜保養，在日循環上被切成 20:30–24:00 與 00:00–07:50
       * 兩塊。指派成功時已經有 <code>sameStayNeighbor</code> 把它們綁成同一台設施；
       * 但<strong>兩塊都失敗</strong>時走的是下面的回報路徑，那裡沒有這層合併，於是
       * 同一件事報兩則，而且各自拿半段的長度去算「往後挪多少就有解」——
       * 算出「往後挪 890 分鐘」這種對使用者毫無意義的建議
       * （2026-08-12 使用者指正：列 9／10 那樣排是有意義的，不要叫他挪）。
       *
       * 合併後長度是真的 680 分鐘，結論就會正確地變成「整天塞不下」——
       * 那才是該講的話：不是挪，是縮短或加設施。
       */
      const stayChain: GeneratedScheduleBlock[] = [yard];
      let chainStartBlock = yard;
      for (const direction of [-1, 1] as const) {
        let cursor = i;
        for (;;) {
          const current = sweepSorted[cursor]!;
          const neighbor = direction < 0
            ? immediatePrevCyclic(sweepSorted, cursor)
            : immediateNextCyclic(sweepSorted, cursor);
          if (!neighbor) break;
          if (neighbor.block.taskType !== yard.taskType) break;
          if (yardBlockFacility.has(neighbor.block.id)) break;
          if (stayChain.includes(neighbor.block)) break;
          // 必須真的<strong>首尾相接</strong>才算同一段停留；同型但中間有空檔的
          // 是兩次獨立的整備，合併會誇大長度、把「挪得動」講成「挪不動」
          const touching = direction < 0
            ? Math.abs(
              (neighbor.block.plannedEndMinute + neighbor.offsetMinute)
              - current.plannedStartMinute,
            ) < 1e-6
            : Math.abs(
              (neighbor.block.plannedStartMinute + neighbor.offsetMinute)
              - current.plannedEndMinute,
            ) < 1e-6;
          if (!touching) break;
          stayChain.push(neighbor.block);
          if (direction < 0) chainStartBlock = neighbor.block;
          const nextCursor = sweepSorted.indexOf(neighbor.block);
          if (nextCursor < 0) break;
          cursor = nextCursor;
        }
      }
      const stayMinutes = stayChain.reduce(
        (sum, item) => sum + (item.plannedEndMinute - item.plannedStartMinute),
        0,
      );
      const startSecond = minuteToSecond(chainStartBlock.plannedStartMinute);
      const endSecond = startSecond + stayMinutes * 60;
      const free = facilities.find((facility) =>
        stayFacilityIsFree(facility.id, yard, timeline.row, startSecond, endSecond));
      if (free) {
        assignYardStay(yard, free.id, free.label || free.id);
        continue;
      }

      /**
       * 決策樹第三層：<strong>請已經佔著格子的人換一台</strong>。
       *
       * 前兩層都是這台車自己讓（挑別的格子、挪自己的時間）。都走不通時，還剩
       * 一種可能：擋路的那台車<strong>自己也能停別處</strong>，只是先搶先贏而已。
       * 這不改任何人的時間，只換格子，所以沒有代價——真正有代價的讓步
       * （挪整備時窗、拆待命）要等成本能互相比較才做。
       *
       * 只做<strong>一層</strong>：被請走的那台必須自己找得到整段都空的格子，不能再去
       * 請第三台讓。多層連鎖的收益遞減、失敗回捲卻很容易出錯。
       *
       * 換不成就整組回捲——中途放棄卻留下半套搬遷，比一開始不搬更糟。
       */
      let yielded = false;
      /** 讓位為什麼沒成——沒有這個，使用者只看到「沒有可用設施」，無從判斷 */
      const yieldNotes: string[] = [];
      for (const facility of facilities) {
        const occupants = sweepCandidates
          .map((item) => item.block)
          .filter((other) =>
            other.id !== yard.id
            && yardBlockFacility.get(other.id)?.nodeId === facility.id
            && cyclicWindowsOverlap(
              startSecond,
              endSecond,
              minuteToSecond(other.plannedStartMinute),
              minuteToSecond(other.plannedEndMinute),
            ));
        if (occupants.length === 0) {
          yieldNotes.push(`${facility.label || facility.id} 沒有可請走的佔用者`);
          continue;
        }
        const undo: Array<{ block: GeneratedScheduleBlock; nodeId: string; label: string }> = [];
        let allMoved = true;
        for (const occupant of occupants) {
          const original = yardBlockFacility.get(occupant.id);
          if (!original) { allMoved = false; break; }
          const occupantStart = minuteToSecond(occupant.plannedStartMinute);
          const occupantEnd = minuteToSecond(occupant.plannedEndMinute);
          const elsewhere = facilityNodesFor(occupant.taskType).find((target) =>
            target.id !== facility.id
            && stayFacilityIsFree(
              target.id,
              occupant,
              occupant.timelineRow,
              occupantStart,
              occupantEnd,
            ));
          if (!elsewhere) {
            allMoved = false;
            yieldNotes.push(
              `${facility.label || facility.id} 上的時間線 ${occupant.timelineRow}`
              + `（${formatSecondOfDay(occupantStart)}–${formatSecondOfDay(occupantEnd)}）`
              + `找不到別台可以整段容納它的設施，請不走`,
            );
            break;
          }
          undo.push({ block: occupant, nodeId: original.nodeId, label: original.label });
          assignYardStay(occupant, elsewhere.id, elsewhere.label || elsewhere.id);
        }
        if (
          allMoved
          && stayFacilityIsFree(facility.id, yard, timeline.row, startSecond, endSecond)
        ) {
          assignYardStay(yard, facility.id, facility.label || facility.id);
          facilityYields.push({
            timelineRow: timeline.row,
            blockId: yard.id,
            taskType: yard.taskType,
            facilityLabel: facility.label || facility.id,
            movedRows: occupants.map((item) => item.timelineRow),
          });
          yielded = true;
          break;
        }
        if (allMoved) {
          yieldNotes.push(
            `${facility.label || facility.id} 上的佔用者都搬得走，`
            + `但搬完之後這一台仍然容納不了這段停留`,
          );
        }
        for (const item of undo) {
          assignYardStay(item.block, item.nodeId, item.label);
        }
      }
      if (yielded) continue;

      // 解不掉就照實講「卡在哪一種資源」。設施格滿了跟停靠站被載客班次壓著
      // 是兩種完全不同的處置：前者要加設施，後者要改待命時段或改班表。
      // 混寫成一句「全被別列車佔著」使用者無從判斷該動哪裡。
      let facilityBusy = 0;
      let berthBusy = 0;
      for (const facility of facilities) {
        if (nodeById.get(facility.id)?.kind === 'docking') berthBusy += 1;
        else facilityBusy += 1;
      }
      const parts: string[] = [];
      if (facilityBusy > 0) {
        /**
         * <strong>要指名是誰佔著。</strong>
         *
         * 只說「4 台設施格被別列車佔著」，使用者看畫面上 E1 明明空的，只會覺得
         * 程式在亂講——他看到的是<strong>這一段時窗</strong>，而檢查的是<strong>整段
         * 連續停留</strong>（跨午夜、接續的同型整備算同一段），兩者常常不一樣。
         * 把每一台的佔用者與時段列出來，落差自己就會顯現
         * （2026-08-12 使用者：「我看 EE1900 還有一個充電樁 E1 可以用呀」）。
         */
        const holders: string[] = [];
        for (const facility of facilities) {
          if (nodeById.get(facility.id)?.kind === 'docking') continue;
          const clash = bookings.find((booking) =>
            booking.facilityNodeId === facility.id
            && booking.timelineRow !== timeline.row
            && cyclicWindowsOverlap(
              startSecond,
              endSecond,
              booking.startSecond,
              booking.endSecond,
            ));
          holders.push(
            clash
              ? `${facility.label || facility.id} 被時間線 ${clash.timelineRow} 佔著`
                + `（${formatSecondOfDay(clash.startSecond)}–${formatSecondOfDay(clash.endSecond)}）`
              : `${facility.label || facility.id} 這段時間是空的，但這台車的整段停留`
                + `（${formatSecondOfDay(startSecond)}–${formatSecondOfDay(endSecond)}）撐不完`,
          );
        }
        parts.push(`${facilityBusy} 台設施格：${holders.join('；')}`);
      }
      if (berthBusy > 0) {
        parts.push(`${berthBusy} 個停靠站這段時間有載客班次要用（待命壓住站位會擋掉那條路線）`);
      }
      /**
       * 「沒地方停」要講<strong>要等多久</strong>才有地方停。
       *
       * 只說「全被別列車佔著」，使用者不知道該把這段整備往後挪 5 分鐘還是
       * 40 分鐘、還是根本得加設施（2026-08-10 使用者：這些錯誤怎麼改進）。
       * 擋路的就是既有的那幾筆預約，最早空出來的時刻直接從裡面取。
       */
      let earliestFree: { label: string; second: number } | null = null;
      for (const facility of facilities) {
        if (nodeById.get(facility.id)?.kind === 'docking') continue;
        let freeAt = startSecond;
        for (const booking of bookings) {
          if (booking.facilityNodeId !== facility.id) continue;
          if (booking.timelineRow === timeline.row) continue;
          if (booking.endSecond <= startSecond + 1e-9) continue;
          if (booking.startSecond >= endSecond - 1e-9) continue;
          freeAt = Math.max(freeAt, booking.endSecond);
        }
        if (freeAt <= startSecond + 1e-9) continue;
        if (!earliestFree || freeAt < earliestFree.second) {
          earliestFree = { label: facility.label || facility.id, second: freeAt };
        }
      }
      /**
       * <strong>缺格子，還是擺不下？</strong>兩者的處置完全相反，講錯會叫使用者白花錢。
       *
       * 同一時刻真的有 6 台車要用 4 台格子＝<strong>產能不足</strong>，怎麼挪都是白挪，
       * 只能加設施或把某一段整備整個移到別的時段；同時刻只有 3 台車搶 4 台格子卻仍
       * 塞不進去＝<strong>擺放問題</strong>，是空檔被切碎，挪得動。
       *
       * 尖峰同時需求直接數：與本段重疊、且吃同一批設施的整備段有幾個（含自己）。
       */
      const sameFacilityPool = new Set(facilities.map((item) => item.id));
      const competitors = sweepCandidates
        .map((item) => item.block)
        .filter((other) =>
          other.id !== yard.id
          && facilityNodesFor(other.taskType).some((node) => sameFacilityPool.has(node.id))
          && cyclicWindowsOverlap(
            startSecond,
            endSecond,
            minuteToSecond(other.plannedStartMinute),
            minuteToSecond(other.plannedEndMinute),
          ));
      /**
       * <strong>要數的是「同一瞬間」有幾台，不是「這段窗內出現過幾台」。</strong>
       * 後者對長段完全失真——00:00–07:50 的保養窗內會經過 18 段整備，寫成
       * 「同時有 18 台車要用 4 台設施、缺 14 台」是胡說（2026-08-12 實測）。
       * 取窗內每個變化點取樣，數同時重疊者的最大值。
       */
      const selfSegments = daySegmentsOf(startSecond, endSecond);
      const competitorSegments = competitors.map((other) =>
        daySegmentsOf(
          minuteToSecond(other.plannedStartMinute),
          minuteToSecond(other.plannedEndMinute),
        ));
      const covers = (segments: Array<[number, number]>, at: number) =>
        segments.some(([from, to]) => at >= from - 1e-9 && at < to - 1e-9);
      const samplePoints = [
        ...selfSegments.map(([from]) => from),
        ...competitorSegments.flat().map(([from]) => from),
      ];
      let peakOthers = 0;
      for (const at of samplePoints) {
        if (!covers(selfSegments, at)) continue;
        const concurrent = competitorSegments.filter((segments) => covers(segments, at)).length;
        if (concurrent > peakOthers) peakOthers = concurrent;
      }
      const peakDemand = peakOthers + 1;
      if (peakDemand > facilities.length) {
        parts.push(
          `同時有 ${peakDemand} 台車要用這 ${facilities.length} 台設施，`
          + `缺 ${peakDemand - facilities.length} 台`,
        );
      } else {
        parts.push(
          `同時只有 ${peakDemand} 台車要用這 ${facilities.length} 台設施，`
          + `數量是夠的，卡在空檔被切得太碎`,
        );
      }
      /**
       * <strong>「最早空出來的是 M4（13:00）」還不夠用。</strong>
       *
       * 那只回答「某一台什麼時候放手」，不回答<strong>「整段塞不塞得下」</strong>——
       * 一台格子 13:00 空出來，但 13:20 又被訂走，對一段 200 分鐘的保養毫無意義。
       * 使用者照這個數字把整備往後挪，挪完還是排不進去，白跑一趟。
       *
       * 這裡直接掃整個日循環：以 5 分鐘為步長，找<strong>最早的起點</strong>，使得存在
       * 一台設施在「起點 → 起點＋這段長度」<strong>整段</strong>都沒有別列車的預約。
       * 找不到就代表這個長度整天都塞不下，那要講的是<strong>另一件事</strong>——
       * 不是「往後挪」，是「這段太長／設施太少」。
       *
       * 只用設施預約做純區間運算，不碰停靠站與整備鏈：這是<strong>診斷</strong>，
       * 給使用者判斷用，不是自動挪動。寧可算得寬鬆一點，也不要因為算太嚴格
       * 而漏講「其實挪一下就有解」。
       */
      const wantSeconds = endSecond - startSecond;
      const probeStepSeconds = 300;
      let feasibleStartSecond: number | null = null;
      if (wantSeconds > 0 && wantSeconds < daySeconds) {
        for (let offset = 0; offset < daySeconds; offset += probeStepSeconds) {
          const probeStart = startSecond + offset;
          const fits = facilities.some((facility) =>
            nodeById.get(facility.id)?.kind !== 'docking'
            && moveCardFacilityIsFree(
              bookings,
              facility.id,
              probeStart,
              probeStart + wantSeconds,
              timeline.row,
            ));
          if (fits) {
            feasibleStartSecond = probeStart;
            break;
          }
        }
      }
      if (feasibleStartSecond != null && feasibleStartSecond > startSecond + 1e-9) {
        const shiftMinutes = Math.round((feasibleStartSecond - startSecond) / 60);
        parts.push(
          `往後挪 ${shiftMinutes} 分鐘（改成 ${formatSecondOfDay(feasibleStartSecond)} 開始）`
          + `就有一台設施整段空著`,
        );
      } else if (feasibleStartSecond == null) {
        parts.push(
          `這段長 ${Math.round(wantSeconds / 60)} 分鐘，整天找不到任何一台設施能整段空這麼久`
          + `——挪時段沒有用，只能縮短這段整備或加設施`,
        );
        // 已經說死「整天塞不下」，再補一句「某台 22:00 會空出來」只會讓人以為有救。
        // 那台 22:00 空出來，也撐不到 680 分鐘。
        earliestFree = null;
      }
      // 算得出「往後挪多少就整段塞得下」時，這句就是多餘的——它只講某一台何時
      // 放手，不保證放手之後撐得住整段，兩句並排只會讓使用者去挪錯的那個數字
      if (earliestFree && feasibleStartSecond == null) {
        const waitMinutes = Math.round((earliestFree.second - startSecond) / 60);
        // 只講「最早要等到幾點」這個事實，不要寫成「挪過去就排得進去」——
        // 挪過去之後那一格可能又被別的車訂走，講死了會讓使用者白跑一趟
        parts.push(
          `最早空出來的是 ${earliestFree.label}（${formatSecondOfDay(earliestFree.second)}，`
          + `比這段整備的開始晚 ${waitMinutes} 分鐘）`,
        );
      }

      if (yieldNotes.length > 0) {
        parts.push(`已試過請別列車換設施讓位：${yieldNotes.join('；')}`);
      }

      const window = `${formatSecondOfDay(startSecond)}–${formatSecondOfDay(endSecond)}`;
      // 整段停留都標旗標（UI 每一塊卡面都要看得到出事），但<strong>只報一則</strong>：
      // 同一段被日循環切成兩塊，報兩次只是同一件事講兩遍
      for (const member of stayChain) member.yardFacilityUnavailable = true;
      if (!stayReported.has(yard.id)) {
        for (const member of stayChain) stayReported.add(member.id);
        facilityUnavailable.push({
          timelineRow: timeline.row,
          blockId: yard.id,
          taskType: yard.taskType,
          facilityCount: facilities.length,
          reason: `${window} 這台車沒地方停——${parts.join('；')}`,
        });
      }
    }
  }

  for (const timeline of timelines) {
    timeline.blocks.sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
  }

  return {
    timelines, inserted, ateYardTail, yardHeadExtended, laterTaskCompressed, yardWorkShortened,
    skipped, facilityUnavailable, facilityYields, entryEarlyBlocked, standbyRelocations,
  };
}
