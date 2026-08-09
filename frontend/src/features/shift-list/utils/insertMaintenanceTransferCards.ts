import type { PointTopology, PointTopologyEdge } from '../../map-editor/types/pointTopology';
import type { MapAreaObject } from '../../map-editor/types/area';
import { getFacilityDockingPoint } from '../../map-editor/utils/facilityDockingPoint';
import { facilityDockingTopologyNodeId } from '../../map-editor/utils/pointTopology';
import type { TaskTypeKey } from '../../time-templates/types/editor';
import type { ShiftScheduleSelectedRoute } from '../types/create';
import { edgeSeconds, findTopologyPath } from './findTopologyPath';
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
  moveCardFacilityIsFree,
  type MoveCardFacilityBooking,
} from './moveCardShared';
import { SCHEDULE_DAY_MINUTES } from './scheduleDayCycle';
import {
  minuteToSecond,
  secondToMinute,
  type GeneratedScheduleBlock,
  type GeneratedSchedulePlan,
} from './schedule-engine/types';

/**
 * 整備轉場卡（MI／MO／整備間轉場）
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
 *   <li><strong>入廠（entry，MI）</strong>：只在整備串「串首」（前面接正線或本來就沒有
 *   前一段整備）補。車一跑完正線就能走，越早到、整備就從越早開始——
 *   <strong>開始時刻提前、結束時刻不動</strong>，時長變長。</li>
 *   <li><strong>出廠（exit，MO）</strong>：只在整備串「串尾」（後面接正線）補。
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
 *
 * 調度入／出廠卡（PI／PO，見 insertParkMoveCards.ts）刻意<strong>不</strong>併進來：
 * 觸發條件是「兩段正線之間的空檔長到會佔死站位」的營運策略門檻，不是
 * 時間模板裡「這一段是不是整備任務」的結構性判斷，跟這裡的三段規則
 * 本質不同，硬併只會讓一個模組同時扛兩種互不相干的觸發邏輯。
 */

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
  skipped: Array<{
    timelineRow: number;
    /** 對應的整備任務區塊 id，讓警告能掛回那張卡（UI 靠這個標 ⚠） */
    blockId?: string;
    taskType?: string;
    fromTaskType?: string;
    toTaskType?: string;
    reason: string;
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
};

export function insertMaintenanceTransferCards(args: {
  timelines: GeneratedSchedulePlan['timelines'];
  topology: PointTopology | null | undefined;
  /**
   * 地圖場域管理模組的 Area 容器清單（含各 Area 底下的 facilities）。
   * 整備間轉場用這個判斷兩座設施是不是同一個場區——同區域直接當 0 秒示意轉移，
   * 不查拓樸找路徑；使用者不可能把每一對設施組合的路徑都手動連好。
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
  } = args;
  const skipped: MaintenanceTransferCardsResult['skipped'] = [];
  const facilityUnavailable: MaintenanceTransferCardsResult['facilityUnavailable'] = [];
  let inserted = 0;
  let ateYardTail = 0;
  let yardHeadExtended = 0;
  let laterTaskCompressed = 0;

  if (!topology || topology.nodes.length === 0) {
    return {
      timelines, inserted, ateYardTail, yardHeadExtended, laterTaskCompressed,
      skipped, facilityUnavailable,
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

  const codesBySection = new Map<MaintenanceBodySectionKey, string[]>();
  const facilityNodesFor = (taskType: string) => {
    const section = FACILITY_SECTION_BY_TASK_TYPE[taskType as TaskTypeKey];
    if (!section) return [];
    let codes = codesBySection.get(section);
    if (!codes) {
      codes = extractFacilityMapCodes(maintenanceBody, section);
      codesBySection.set(section, codes);
    }
    return topology.nodes.filter(
      (node) => node.kind === 'facility' && nodeMatchesMoveCardCodes(node, codes!),
    );
  };

  // 入廠、出廠、轉場三段共用同一份設施佔用表——同一台設施同一時刻只能停
  // 一台車，不分是被哪一種卡佔的。
  const bookings: MoveCardFacilityBooking[] = [];

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
  function assignYardFacility(
    block: GeneratedScheduleBlock,
    nodeId: string,
    label: string,
  ): void {
    yardBlockFacility.set(block.id, { nodeId, label });
    block.yardFacilityNodeId = nodeId;
    block.yardFacilityLabel = label;

    const startSecond = minuteToSecond(block.plannedStartMinute);
    const endSecond = minuteToSecond(block.plannedEndMinute);
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
   * 這台設施對<strong>整段連續停留</strong>都是空的嗎。
   *
   * 只檢查「正在決定的這一段」是不夠的：跨午夜的
   * 「保養 20:33–24:00 ＋ 保養 00:00–07:50」是一次選擇、一起佔位，
   * 若只拿前半段去問「空不空」，選到的設施可能在後半段早就被別列車訂走，
   * 佔位時就直接壓上去變成兩台車同時佔一格。要選就要整條鏈一起問。
   *
   * 正在決定的那一段用傳入的預定時間窗（它的時刻還沒寫回區塊），
   * 鏈上其他段用它們目前的時間窗。
   */
  function stayFacilityIsFree(
    facilityNodeId: string,
    block: GeneratedScheduleBlock,
    timelineRow: number,
    startSecond: number,
    endSecond: number,
  ): boolean {
    if (!moveCardFacilityIsFree(bookings, facilityNodeId, startSecond, endSecond, timelineRow)) {
      return false;
    }
    for (const member of collectStay(block)) {
      if (member.id === block.id) continue;
      if (
        !moveCardFacilityIsFree(
          bookings,
          facilityNodeId,
          minuteToSecond(member.plannedStartMinute),
          minuteToSecond(member.plannedEndMinute),
          timelineRow,
        )
      ) {
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
  };
  function newTally(): RejectTally {
    return { noPath: 0, facilityBusy: 0, junctionBusy: 0, noTime: 0 };
  }
  function describeReject(tally: RejectTally, candidateCount: number): string {
    const parts: string[] = [];
    if (tally.facilityBusy > 0) {
      parts.push(`${tally.facilityBusy} 台設施在這段時間被別列車佔著`);
    }
    if (tally.junctionBusy > 0) {
      parts.push(`${tally.junctionBusy} 條路徑會跟別列車在同一個轉折點撞上（差距不到 2 倍碰撞保護時間）`);
    }
    if (tally.noTime > 0) {
      parts.push(`${tally.noTime} 條路徑的移動時間塞不進這段空檔`);
    }
    if (tally.noPath > 0) {
      parts.push(`${tally.noPath} 台設施在拓樸上沒有可通的路徑`);
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
  type JunctionBooking = { nodeId: string; instant: number; timelineRow: number };
  const junctionBookings: JunctionBooking[] = [];

  /**
   * 兩個時刻在日循環上的最短間距——23:59:50 與 00:00:10 相差 20 秒，
   * 不是 23 小時 59 分。跨午夜的移動卡時刻會落在 1440 分以上，
   * 直接相減會把「其實只差 20 秒」算成「差了一整天」，碰撞就漏掉了。
   */
  const daySeconds = minuteToSecond(SCHEDULE_DAY_MINUTES);
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

  function bookJunction(nodeId: string, instant: number, timelineRow: number): void {
    if (collisionBufferSeconds <= 0) return;
    junctionBookings.push({ nodeId, instant, timelineRow });
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

  // ---- 入廠（MI）：只在串首補，開始時刻提前、結束不動 ----
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
      if (!prevPax || !previousPassenger?.routeId) continue;
      const stationId = routeEndStation.get(previousPassenger.routeId);
      const fromNodeId = stationId ? nodeIdByStationId.get(stationId) : undefined;
      if (!fromNodeId) {
        skipped.push({
          timelineRow: timeline.row,
          blockId: yard.id,
          taskType: yard.taskType,
          reason: `前一段載客的終點站在拓樸上找不到對應節點（${stationId ?? '未知'}）`,
        });
        continue;
      }

      const facilities = facilityNodesFor(yard.taskType);
      if (facilities.length === 0) {
        skipped.push({
          timelineRow: timeline.row,
          blockId: yard.id,
          taskType: yard.taskType,
          reason: '整備任務沒設定這一類的設施，或設施不在拓樸上',
        });
        continue;
      }

      const freeSecond = minuteToSecond(previousPassenger.plannedEndMinute + prevPax.offsetMinute)
        + Math.max(0, minimumRecoveryTimeSeconds);
      const yardStartSecond = minuteToSecond(yard.plannedStartMinute);
      const yardEndSecond = minuteToSecond(yard.plannedEndMinute);
      if (freeSecond >= yardStartSecond - 1e-9) continue;
      // 繞回前一天尾巴時，入廠卡會落在 00:00 之前（負時刻）。要正確表達得把
      // 這一段整備整條鏈重新基準到「跨夜」座標（開始 23:5x、結束 +1440），
      // 牽動渲染與各種驗證，尚未做——先不插卡，設施仍由收尾補掃負責指派，
      // 不會變成沒人管的整備。
      if (freeSecond < 0) continue;

      let chosen: {
        nodeId: string; label: string; seconds: number;
        gatewayNodeId: string; gatewayInstant: number;
      } | null = null;
      const tally = newTally();
      for (const facility of facilities) {
        const path = findTopologyPath(topology, fromNodeId, facility.id);
        if (!path) { tally.noPath += 1; continue; }
        const arriveSecond = freeSecond + path.avgSeconds;
        if (arriveSecond >= yardStartSecond - 1e-9) { tally.noTime += 1; continue; }
        // 要佔的是「抵達 → 整備做完」整段（車在裡面的全程），檢查窗必須跟
        // 佔用窗一致——只檢查頭部那一小段的話，別列車早就訂走整段的設施
        // 還是會被判定成空的。
        if (
          !stayFacilityIsFree(facility.id, yard, timeline.row, arriveSecond, yardEndSecond)
        ) {
          tally.facilityBusy += 1;
          continue;
        }
        const gateway = resolveGatewayFromPath(path, arriveSecond, 'arriving-at-facility', fromNodeId);
        if (!junctionIsFree(gateway.nodeId, gateway.instant, timeline.row)) {
          tally.junctionBusy += 1;
          continue;
        }
        if (!chosen || path.avgSeconds < chosen.seconds) {
          chosen = {
            nodeId: facility.id, label: facility.label || facility.id, seconds: path.avgSeconds,
            gatewayNodeId: gateway.nodeId, gatewayInstant: gateway.instant,
          };
        }
      }
      if (!chosen) {
        skipped.push({
          timelineRow: timeline.row,
          blockId: yard.id,
          taskType: yard.taskType,
          reason: `排不出入廠卡：${describeReject(tally, facilities.length)}`,
        });
        continue;
      }
      bookJunction(chosen.gatewayNodeId, chosen.gatewayInstant, timeline.row);

      const arriveSecond = freeSecond + chosen.seconds;
      const card: GeneratedScheduleBlock = {
        id: `yardentry-${yard.id}-${Math.round(freeSecond)}`,
        timelineRow: timeline.row,
        taskType: 'dispatch',
        label: `整備入廠 · → ${chosen.label}`,
        anchorStartMinute: secondToMinute(freeSecond),
        plannedStartMinute: secondToMinute(freeSecond),
        plannedEndMinute: secondToMinute(arriveSecond),
        travelSeconds: chosen.seconds,
        dwellSeconds: 0,
        source: 'yard_entry_move',
        yardExitFacilityNodeId: chosen.nodeId,
        yardExitFacilityLabel: chosen.label,
        yardExitStationId: stationId,
        yardExitSectionCode:
          resolveMaintenanceSectionCodeForTaskType(yard.taskType, sectionCodes) ?? undefined,
        yardExitSectionLabel: resolveMaintenanceSectionLabelForTaskType(yard.taskType) ?? undefined,
      };
      timeline.blocks.push(card);

      yard.plannedStartMinute = secondToMinute(arriveSecond);
      yardHeadExtended += 1;
      // 時刻定案後才綁設施——assignYardFacility 會用當下的 [開始, 結束] 佔位
      assignYardStay(yard, chosen.nodeId, chosen.label);
      inserted += 1;
    }
  }

  // ---- 整備間轉場：串內部兩段不同類型整備銜接，出廠卡＋入廠卡成對 ----
  for (const timeline of timelines) {
    const sorted = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );
    // 走完整條線（含最後一段）——最後一段的下一段照日循環繞回第一段，
    // 「充電 22:00–24:00 接 保養 00:00–02:40」這種跨午夜的銜接才看得到。
    for (let i = 0; i < sorted.length; i += 1) {
      const earlier = sorted[i]!;
      const laterNeighbor = immediateNextCyclic(sorted, i);
      if (!laterNeighbor) continue;
      const later = laterNeighbor.block;
      /** 後一段繞到隔天時 = +1440；當日之內 = 0 */
      const laterOffsetMinute = laterNeighbor.offsetMinute;
      const laterOffsetSecond = minuteToSecond(laterOffsetMinute);
      if (!YARD_TASK_TYPES.has(earlier.taskType) || !YARD_TASK_TYPES.has(later.taskType)) {
        continue;
      }
      if (earlier.taskType === later.taskType) continue;

      const allExitFacilities = facilityNodesFor(earlier.taskType);
      const entryFacilities = facilityNodesFor(later.taskType);
      if (allExitFacilities.length === 0 || entryFacilities.length === 0) {
        skipped.push({
          timelineRow: timeline.row,
          blockId: later.id,
          fromTaskType: earlier.taskType,
          toTaskType: later.taskType,
          reason: '其中一種整備類型沒設定設施，或設施不在拓樸上',
        });
        continue;
      }

      // earlier 停在哪台設施如果已經被入廠卡或前一段轉場定案，這裡只能沿用
      // 同一台——不能各自獨立再挑一次，那樣車會憑空從一台設施跳到另一台。
      const earlierAssigned = yardBlockFacility.get(earlier.id);
      const exitFacilities = earlierAssigned
        ? allExitFacilities.filter((f) => f.id === earlierAssigned.nodeId)
        : allExitFacilities;
      if (exitFacilities.length === 0) {
        skipped.push({
          timelineRow: timeline.row,
          blockId: later.id,
          fromTaskType: earlier.taskType,
          toTaskType: later.taskType,
          reason: `來源設施已被固定在 ${earlierAssigned!.label}（入廠或前一段轉場定案），這裡到不了`,
        });
        continue;
      }

      // 時序運算在「跟 earlier 同一條時間軸」的位移座標上做（後一段繞到隔天時
      // 會是 1440 以上）；設施佔用檢查則必須換回各區塊自己的日內座標，
      // 否則跨午夜那一段會拿 1440+ 的窗去比別列車 0–1440 的窗，永遠比不到。
      const departSecond = minuteToSecond(earlier.plannedEndMinute);
      const laterEndSecond = minuteToSecond(later.plannedEndMinute) + laterOffsetSecond;

      let chosen: {
        exitNodeId: string;
        exitLabel: string;
        entryNodeId: string;
        entryLabel: string;
        midNodeId: string;
        midLabel: string;
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
        /** 後一段實際開始時刻（位移座標）；只會等於或晚於它原訂的開始 */
        finalLaterStartSecond: number;
      } | null = null;

      const tally = newTally();
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

          if (sameArea) {
            // 同一區域：不查拓樸，直接視為 0 秒的示意轉移——開始跟結束是同一刻。
            midNodeId = entryFacility.id;
            midLabel = entryFacility.label || entryFacility.id;
            exitLegSeconds = 0;
            entryLegSeconds = 0;
          } else {
            const path = findTopologyPath(topology, exitFacility.id, entryFacility.id);
            if (!path || path.edges.length === 0) { tally.noPath += 1; continue; }
            // 分界點取第一段邊的終點：出廠卡永遠是「離開這座設施專屬的那一段
            // 邊」（例 E2 → N2W下行出發），入廠卡吸收掉中間所有正線轉乘直到
            // 目的設施（例 N2W下行出發 → T3下行 → M1）——出廠短、入廠長，
            // 入廠卡負責吸收這段真實的移動距離。
            exitGateway = resolveGatewayFromPath(path, departSecond, 'leaving-facility', exitFacility.id);
            midNodeId = exitGateway.nodeId;
            midLabel = nodeById.get(midNodeId)?.label || midNodeId;
            exitLegSeconds = exitGateway.instant - departSecond;
            entryLegSeconds = Math.max(0, path.avgSeconds - exitLegSeconds);
            entryGateway = resolveGatewayFromPath(
              path,
              departSecond + path.avgSeconds,
              'arriving-at-facility',
              entryFacility.id,
            );
          }

          const totalSeconds = exitLegSeconds + entryLegSeconds;
          const arriveSecond = departSecond + totalSeconds;
          // 後一段只會被<strong>往後推</strong>，絕不會被往前拉——兩段之間本來就
          // 有空檔時（車提早到、在那邊等），它照原訂時刻開始。少了這個 max，
          // 空檔一大就會把後一段硬拉到抵達時刻，跨午夜那一對甚至會被拉成負時刻。
          const laterStartSecond = minuteToSecond(later.plannedStartMinute) + laterOffsetSecond;
          const finalLaterStartSecond = Math.max(laterStartSecond, arriveSecond);
          if (finalLaterStartSecond >= laterEndSecond - 1e-9) { tally.noTime += 1; continue; }
          // 前一段整備在它自己的全程都佔著出廠那台設施；後一段從實際開始佔到做完
          if (
            !stayFacilityIsFree(
              exitFacility.id,
              earlier,
              timeline.row,
              minuteToSecond(earlier.plannedStartMinute),
              departSecond,
            )
            || !stayFacilityIsFree(
              entryFacility.id,
              later,
              timeline.row,
              finalLaterStartSecond - laterOffsetSecond,
              laterEndSecond - laterOffsetSecond,
            )
          ) {
            tally.facilityBusy += 1;
            continue;
          }
          if (
            (exitGateway && !junctionIsFree(exitGateway.nodeId, exitGateway.instant, timeline.row))
            || (entryGateway && !junctionIsFree(entryGateway.nodeId, entryGateway.instant, timeline.row))
          ) {
            tally.junctionBusy += 1;
            continue;
          }
          if (!chosen || totalSeconds < chosen.exitLegSeconds + chosen.entryLegSeconds) {
            chosen = {
              exitNodeId: exitFacility.id,
              exitLabel: exitFacility.label || exitFacility.id,
              entryNodeId: entryFacility.id,
              entryLabel: entryFacility.label || entryFacility.id,
              midNodeId,
              midLabel,
              exitLegSeconds,
              entryLegSeconds,
              sameArea,
              exitGateway,
              entryGateway,
              finalLaterStartSecond,
            };
          }
        }
      }
      if (!chosen) {
        skipped.push({
          timelineRow: timeline.row,
          blockId: later.id,
          fromTaskType: earlier.taskType,
          toTaskType: later.taskType,
          reason:
            `排不出整備間轉場（出廠＋入廠）：${describeReject(tally, exitFacilities.length * entryFacilities.length)}`,
        });
        continue;
      }
      if (chosen.exitGateway) bookJunction(chosen.exitGateway.nodeId, chosen.exitGateway.instant, timeline.row);
      if (chosen.entryGateway) bookJunction(chosen.entryGateway.nodeId, chosen.entryGateway.instant, timeline.row);

      const midSecond = departSecond + chosen.exitLegSeconds;
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
        id: `yardtransit-out-${earlier.id}-${Math.round(departSecond)}`,
        timelineRow: timeline.row,
        taskType: 'dispatch',
        label: `整備出廠 · ${chosen.exitLabel} → ${exitOtherSideLabel}`,
        anchorStartMinute: secondToMinute(departSecond),
        plannedStartMinute: secondToMinute(departSecond),
        plannedEndMinute: secondToMinute(midSecond),
        travelSeconds: chosen.exitLegSeconds,
        dwellSeconds: 0,
        source: 'yard_exit_move',
        yardExitFacilityNodeId: chosen.exitNodeId,
        yardExitFacilityLabel: chosen.exitLabel,
        yardExitStationId: chosen.midNodeId,
        yardExitStationLabel: exitOtherSideLabel,
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
      if (later.plannedStartMinute > laterStartBefore + 1e-9) laterTaskCompressed += 1;
      // 時刻定案後才綁設施——兩段各自用自己的完整時長佔住各自那一台
      assignYardStay(earlier, chosen.exitNodeId, chosen.exitLabel);
      assignYardStay(later, chosen.entryNodeId, chosen.entryLabel);
      inserted += 1;
    }
  }

  // ---- 出廠（MO）：只在串尾補，往前貼齊、零秒緩衝，空間不夠可吃整備尾巴 ----
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
      if (!nextPax) continue;
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

    const allFacilities = facilityNodesFor(yard.taskType);
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
        return path ? { facility, seconds: path.avgSeconds, edges: path.edges } : null;
      })
      .filter((c): c is { facility: (typeof facilities)[number]; seconds: number; edges: PointTopologyEdge[] } => c !== null)
      .sort((a, b) => a.seconds - b.seconds);
    if (candidates.length === 0) {
      skipped.push({
        timelineRow: timeline.row,
        blockId: yard.id,
        taskType: yard.taskType,
        reason: `整備設定的設施拓樸上都沒有連到 ${stationId}`,
      });
      continue;
    }

    const departSecond = minuteToSecond(nextStartMinute);
    const yardEndSecond = minuteToSecond(yard.plannedEndMinute);
    const yardStartSecond = minuteToSecond(yard.plannedStartMinute);

    let chosen: {
      nodeId: string; label: string; seconds: number;
      gatewayNodeId: string; gatewayInstant: number;
    } | null = null;
    let chosenStart = 0;
    const tally = newTally();
    for (const { facility, seconds, edges } of candidates) {
      const startSecond = departSecond - seconds;
      // 出場移動不得早於整備開始（那代表整備根本沒做）
      if (startSecond < yardStartSecond - 1e-9) { tally.noTime += 1; continue; }
      if (!stayFacilityIsFree(facility.id, yard, timeline.row, yardStartSecond, startSecond)) {
        tally.facilityBusy += 1;
        continue;
      }
      const gateway = resolveGatewayFromPath({ edges }, startSecond, 'leaving-facility', stationNodeId);
      if (!junctionIsFree(gateway.nodeId, gateway.instant, timeline.row)) {
        tally.junctionBusy += 1;
        continue;
      }
      chosen = {
        nodeId: facility.id, label: facility.label || facility.id, seconds,
        gatewayNodeId: gateway.nodeId, gatewayInstant: gateway.instant,
      };
      chosenStart = startSecond;
      break;
    }
    if (!chosen) {
      skipped.push({
        timelineRow: timeline.row,
        blockId: yard.id,
        taskType: yard.taskType,
        reason: `排不出出廠卡：${describeReject(tally, candidates.length)}`,
      });
      continue;
    }
    bookJunction(chosen.gatewayNodeId, chosen.gatewayInstant, timeline.row);

    // 空間不夠 → 吃整備尾巴（全系統唯一有此特權的卡）
    const eatsTail = chosenStart < yardEndSecond - 1e-9;
    if (eatsTail) {
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
      plannedEndMinute: nextStartMinute,
      travelSeconds: chosen.seconds,
      dwellSeconds: 0,
      source: 'yard_exit_move',
      yardExitFacilityNodeId: chosen.nodeId,
      yardExitFacilityLabel: chosen.label,
      yardExitStationId: stationId,
      yardExitStationLabel: stationLabel,
      yardExitSectionCode:
        resolveMaintenanceSectionCodeForTaskType(yard.taskType, sectionCodes) ?? undefined,
      yardExitSectionLabel: resolveMaintenanceSectionLabelForTaskType(yard.taskType) ?? undefined,
      yardExitAteYardTail: eatsTail || undefined,
    };
    timeline.blocks.push(card);
    // 吃過尾巴之後才綁設施——佔用窗要用縮短後的實際結束時刻
    assignYardStay(yard, chosen.nodeId, chosen.label);
    inserted += 1;
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
  for (const timeline of timelines) {
    const sweepSorted = [...timeline.blocks].sort(
      (a, b) => a.plannedStartMinute - b.plannedStartMinute,
    );
    for (let i = 0; i < sweepSorted.length; i += 1) {
      const yard = sweepSorted[i]!;
      if (!YARD_TASK_TYPES.has(yard.taskType)) continue;
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

      const startSecond = minuteToSecond(yard.plannedStartMinute);
      const endSecond = minuteToSecond(yard.plannedEndMinute);
      const free = facilities.find((facility) =>
        stayFacilityIsFree(facility.id, yard, timeline.row, startSecond, endSecond));
      if (free) {
        assignYardStay(yard, free.id, free.label || free.id);
        continue;
      }

      yard.yardFacilityUnavailable = true;
      facilityUnavailable.push({
        timelineRow: timeline.row,
        blockId: yard.id,
        taskType: yard.taskType,
        facilityCount: facilities.length,
        reason: `這段時間 ${facilities.length} 台設施全被別列車佔著，這台車沒地方停`,
      });
    }
  }

  for (const timeline of timelines) {
    timeline.blocks.sort((a, b) => a.plannedStartMinute - b.plannedStartMinute);
  }

  return {
    timelines, inserted, ateYardTail, yardHeadExtended, laterTaskCompressed,
    skipped, facilityUnavailable,
  };
}
